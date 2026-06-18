// Location helpers used to give the landmark-recognition model a geographic hint.
// Everything here degrades gracefully to `null` so the scan always works image-only
// if location is unavailable or denied.

export interface GeoCoords {
  lat: number;
  lng: number;
}

// Current device location — only meaningful for a LIVE camera capture (it's "where
// you are now"). Returns null on denial / timeout / unsupported. Never throws.
export function getDeviceLocation(timeoutMs = 6000): Promise<GeoCoords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (v: GeoCoords | null) => {
      if (!settled) { settled = true; resolve(v); }
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => finish(null),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
      );
    } catch {
      finish(null);
    }
    // Hard backstop in case the callback never fires.
    setTimeout(() => finish(null), timeoutMs + 1000);
  });
}

// Read GPS coordinates embedded in a photo's EXIF (where the photo was actually
// taken). Best signal for an uploaded gallery photo. JPEG only; returns null for
// other formats or photos without GPS tags. Never throws.
export async function getExifGps(file: File): Promise<GeoCoords | null> {
  try {
    if (!/jpe?g/i.test(file.type)) return null; // GPS EXIF lives in JPEG
    // EXIF sits near the start; reading the first chunk avoids loading large files.
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not JPEG

    let offset = 2;
    const len = view.byteLength;
    while (offset + 4 <= len) {
      if (view.getUint8(offset) !== 0xff) { offset++; continue; } // re-align to a marker
      const marker = view.getUint8(offset + 1);
      if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan → no more metadata
      const size = view.getUint16(offset + 2);
      if (size < 2) break;
      if (marker === 0xe1 && offset + 10 <= len && view.getUint32(offset + 4) === 0x45786966) {
        // APP1 with "Exif" header → TIFF block starts after "Exif\0\0"
        const gps = parseTiffForGps(view, offset + 10);
        if (gps) return gps;
      }
      offset += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}

function parseTiffForGps(view: DataView, tiff: number): GeoCoords | null {
  try {
    const le = view.getUint16(tiff) === 0x4949; // 'II' little-endian, 'MM' big-endian
    const u16 = (o: number) => view.getUint16(o, le);
    const u32 = (o: number) => view.getUint32(o, le);

    const ifd0 = tiff + u32(tiff + 4);
    let gpsIfd = 0;
    const n0 = u16(ifd0);
    for (let i = 0; i < n0; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (u16(entry) === 0x8825) { gpsIfd = tiff + u32(entry + 8); break; } // GPS IFD pointer
    }
    if (!gpsIfd) return null;

    let latRef = '', lngRef = '';
    let lat: number | null = null, lng: number | null = null;
    const gn = u16(gpsIfd);
    for (let i = 0; i < gn; i++) {
      const entry = gpsIfd + 2 + i * 12;
      const tag = u16(entry);
      if (tag === 1) latRef = String.fromCharCode(view.getUint8(entry + 8));      // N / S
      else if (tag === 3) lngRef = String.fromCharCode(view.getUint8(entry + 8)); // E / W
      else if (tag === 2) lat = readDMS(view, tiff + u32(entry + 8), le);          // latitude
      else if (tag === 4) lng = readDMS(view, tiff + u32(entry + 8), le);          // longitude
    }
    if (lat == null || lng == null) return null;
    if (latRef === 'S') lat = -lat;
    if (lngRef === 'W') lng = -lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

// 3 RATIONALs (deg, min, sec), each numerator/denominator (8 bytes) → decimal degrees.
function readDMS(view: DataView, off: number, le: boolean): number {
  const u32 = (o: number) => view.getUint32(o, le);
  const deg = u32(off) / u32(off + 4);
  const min = u32(off + 8) / u32(off + 12);
  const sec = u32(off + 16) / u32(off + 20);
  return deg + min / 60 + sec / 3600;
}
