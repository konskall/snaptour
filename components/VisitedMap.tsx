import React, { useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Home, MapPinned } from 'lucide-react';
import { HistoryItem, Translation } from '../types';
import { itemCoords } from '../services/geoUtils';

interface VisitedMapProps {
  items: HistoryItem[];
  onClose: () => void;
  onSelect: (item: HistoryItem) => void;
  t: Translation;
}

// Pin drawn as the SnapTour brand logo (teardrop + camera lens), so the visited
// markers match the app icon. Favorites keep their amber body as a quick visual cue;
// regular pins use the brand cyan. A divIcon avoids Leaflet's default PNG marker
// assets, which break under bundlers. Shape mirrors components/Logo.tsx.
// Pre-rendered once per variant (favorite/regular). The markup is identical for every
// marker of the same kind, so we don't rebuild the string per history item on map mount.
const buildPin = (body: string, depth: string) =>
  `<svg width="30" height="36" viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))">
    <path fill="${depth}" transform="translate(5,5)" d="M90 50C90 75 50 115 50 115C50 115 10 75 10 50C10 25 30 10 50 10C70 10 90 25 90 50Z"/>
    <path fill="${body}" d="M90 50C90 75 50 115 50 115C50 115 10 75 10 50C10 25 30 10 50 10C70 10 90 25 90 50Z"/>
    <path d="M25 30C25 30 35 20 50 20C65 20 70 25 70 25" stroke="white" stroke-width="4" stroke-linecap="round" opacity="0.3"/>
    <circle cx="50" cy="50" r="25" fill="#0F172A"/>
    <path d="M45 40L60 50L45 60V40Z" fill="#22D3EE" stroke="#06B6D4" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="50" cy="50" r="20" stroke="#1E293B" stroke-width="2"/>
  </svg>`;
const PIN_REGULAR = buildPin('#06B6D4', '#F97316');  // brand cyan
const PIN_FAVORITE = buildPin('#f59e0b', '#b45309'); // amber/gold for favorites
const pinSvg = (favorite?: boolean) => (favorite ? PIN_FAVORITE : PIN_REGULAR);

// Visited-places map: pins for every history item that has coordinates (the real
// scan GPS when available, otherwise the model's estimate). Tapping a pin opens the
// landmark. Leaflet + its CSS load only in this lazily-imported chunk.
const VisitedMap: React.FC<VisitedMapProps> = ({ items, onClose, onSelect, t }) => {
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // Keep the latest onSelect without re-running the map-build effect.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const points = items
    .map((item) => {
      const c = itemCoords(item);
      return c ? { item, ...c } : null;
    })
    .filter((p): p is { item: HistoryItem; lat: number; lng: number } => p !== null);

  useEffect(() => {
    if (!mapElRef.current || points.length === 0 || mapRef.current) return;

    const map = L.map(mapElRef.current, {
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
    });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const latlngs: L.LatLngExpression[] = [];
    for (const p of points) {
      latlngs.push([p.lat, p.lng]);
      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: '',
          html: pinSvg(p.item.favorite),
          iconSize: [30, 36],
          iconAnchor: [15, 36],
          popupAnchor: [0, -34],
        }),
        title: p.item.landmarkName,
      }).addTo(map);

      // Popup with a thumbnail + name; clicking it opens the landmark detail.
      const el = document.createElement('div');
      el.className = 'st-pin-popup';
      el.style.cssText = 'cursor:pointer;width:160px;';
      // Thumbnails are dual-format: a base64 blob (user photos) OR an absolute URL
      // (Wikimedia image for photo-less "Near me now" items). Same branch the other
      // consumers use (HistoryView / App.handleHistorySelect) — without it a URL would
      // become a broken `src="data:image/jpeg;base64,https://…"`.
      const thumbSrc = p.item.thumbnail
        ? (p.item.thumbnail.includes('://') ? p.item.thumbnail : `data:image/jpeg;base64,${p.item.thumbnail}`)
        : '';
      const thumb = thumbSrc
        ? `<img src="${thumbSrc.replace(/"/g, '&quot;')}" alt="" style="width:100%;height:84px;object-fit:cover;border-radius:8px;display:block;margin-bottom:6px;" />`
        : '';
      el.innerHTML = `${thumb}<div style="font-weight:700;font-size:13px;line-height:1.3;color:#0f172a;">${p.item.landmarkName.replace(/</g, '&lt;')}</div>`;
      el.addEventListener('click', () => onSelectRef.current(p.item));
      marker.bindPopup(el, { closeButton: true, minWidth: 160 });
    }

    if (latlngs.length === 1) {
      map.setView(latlngs[0], 12);
    } else {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
    }
    // The container is inside a flex layout; ensure Leaflet measured it correctly.
    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return (
    <div className="flex flex-col w-full h-full bg-slate-900 animate-fade-in pt-header">
      {/* Header — smaller title (was clipping on small screens) + icon-only home */}
      <div className="flex items-center justify-between gap-3 px-6 py-3 shrink-0">
        <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 min-w-0">
          <MapPinned size={20} className="text-emerald-400 shrink-0" />
          <span className="truncate">{t.mapTitle}</span>
        </h2>
        <button
          onClick={onClose}
          title={t.home}
          aria-label={t.home}
          className="shrink-0 w-9 h-9 rounded-full grid place-items-center bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
        >
          <Home size={17} />
        </button>
      </div>

      {/* Map / empty state */}
      {points.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 px-6 pb-safe">
          <MapPinned size={48} className="mb-4 opacity-50" />
          <p className="text-center max-w-xs">{t.mapEmpty}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 relative">
          <div ref={mapElRef} className="absolute inset-0" />
        </div>
      )}
    </div>
  );
};

export default VisitedMap;
