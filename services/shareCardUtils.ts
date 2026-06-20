// Renders a branded, shareable PNG "card" for a landmark on an offscreen canvas, so a shared
// post shows a FINISHED image (photo + name + branding) instead of the site's generic Open
// Graph link preview (GitHub Pages serves the same static OG tags for every ?l= URL because
// crawlers don't run the SPA). Returns a PNG Blob, or null if rendering fails (the caller then
// shares just the link).
//
// Taint-safety: the only external asset is the optional photo. We load it with
// crossOrigin='anonymous', so a non-CORS image FAILS to load (→ we fall back to a brand
// gradient) rather than tainting the canvas — therefore toBlob() can never throw a
// SecurityError. data: URIs (user scans) load regardless and are same-origin-clean.

const W = 1080;
const H = 1350; // 4:5 — works for IG feed, Stories, WhatsApp, Messenger.

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Hex gradients parallel to placeholderUtils' GRADIENTS so a photo-less card still looks
// designed and is stable per landmark.
const GRADIENTS: [string, string][] = [
  ['#4f46e5', '#6b21a8'],
  ['#0284c7', '#1e40af'],
  ['#059669', '#115e59'],
  ['#d97706', '#9a3412'],
  ['#e11d48', '#9d174d'],
  ['#7c3aed', '#a21caf'],
  ['#0891b2', '#075985'],
  ['#0d9488', '#065f46'],
];

function gradientFor(seed: string): [string, string] {
  let h = 0;
  const s = seed || 'snaptour';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // CORS-clean or it won't load (no taint) — see header note
    let settled = false;
    const done = (v: HTMLImageElement | null) => { if (!settled) { settled = true; resolve(v); } };
    img.onload = () => done(img.naturalWidth ? img : null);
    img.onerror = () => done(null);
    img.src = src;
    // Never let a slow image hang the share gesture.
    setTimeout(() => done(img.complete && img.naturalWidth ? img : null), 4000);
  });
}

// Draw an image cover-fit (fill the box, centre-crop the overflow).
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = img.naturalWidth / img.naturalHeight;
  const r = w / h;
  let sw: number, sh: number, sx: number, sy: number;
  if (ir > r) { sh = img.naturalHeight; sw = sh * r; sx = (img.naturalWidth - sw) / 2; sy = 0; }
  else { sw = img.naturalWidth; sh = sw / r; sx = 0; sy = (img.naturalHeight - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

// Word-wrap `text` into at most `maxLines` lines that each fit `maxWidth`; ellipsize on overflow.
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  let overflow = false;
  for (let i = 0; i < words.length; i++) {
    const test = cur ? cur + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width <= maxWidth || !cur) {
      cur = test;
    } else {
      lines.push(cur);
      cur = words[i];
      if (lines.length === maxLines) { overflow = true; cur = ''; break; }
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (overflow && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.replace(/\s*\S+$/, '');
    lines[lines.length - 1] = (last || lines[lines.length - 1]) + '…';
  }
  return lines;
}

function firstSentence(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{20,170}?[.!?])(\s|$)/);
  if (m) return m[1];
  return t.length > 150 ? t.slice(0, 149).trimEnd() + '…' : t;
}

// SnapTour brand mark: a map-pin (cyan→teal) with a white play triangle, + the wordmark.
// Drawn entirely with canvas paths (no external/SVG asset) so it can never taint the canvas.
function drawBrand(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  // The actual SnapTour logo (mirrors index.html, viewBox 0 0 100 120): orange offset +
  // cyan pin + dark inner circle + cyan play triangle. Drawn via Path2D from the same SVG
  // path data — pure canvas, so no external/SVG asset and no canvas taint.
  const scale = 0.52;
  const pinH = 120 * scale;
  const pinW = 100 * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const pin = new Path2D('M90 50C90 75 50 115 50 115C50 115 10 75 10 50C10 25 30 10 50 10C70 10 90 25 90 50Z');
  ctx.save();
  ctx.translate(5, 5);
  ctx.fillStyle = '#F97316';          // orange offset (the logo's signature peek)
  ctx.fill(pin);
  ctx.restore();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = '#06B6D4';           // cyan body (with a soft drop shadow to pop on photos)
  ctx.fill(pin);
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(50, 50, 25, 0, Math.PI * 2); // dark inner circle
  ctx.fillStyle = '#0F172A';
  ctx.fill();
  ctx.fillStyle = '#22D3EE';           // play triangle
  ctx.fill(new Path2D('M45 40L60 50L45 60V40Z'));
  ctx.restore();
  // Wordmark: "Snap" white + "Tour" cyan, vertically centred on the pin.
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `800 46px ${FONT}`;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 8;
  const tx = x + pinW + 16;
  const ty = y + pinH / 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Snap', tx, ty);
  const snapW = ctx.measureText('Snap').width;
  ctx.fillStyle = '#22D3EE';
  ctx.fillText('Tour', tx + snapW, ty);
  ctx.restore();
}

export interface ShareCardOpts {
  name: string;
  photoSrc?: string | null;
  fact?: string;
  city?: string;
  country?: string;
}

export async function buildShareCard(opts: ShareCardOpts): Promise<Blob | null> {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // --- Background: the photo (cover) or a stable brand gradient fallback ---
    let drewPhoto = false;
    if (opts.photoSrc) {
      const img = await loadImage(opts.photoSrc);
      if (img) { try { drawCover(ctx, img, 0, 0, W, H); drewPhoto = true; } catch { drewPhoto = false; } }
    }
    if (!drewPhoto) {
      const [c1, c2] = gradientFor(opts.country || opts.name);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, c1);
      bg.addColorStop(1, c2);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
    }

    // --- Dark scrim for text legibility (light at top, heavy at the bottom) ---
    const scrim = ctx.createLinearGradient(0, 0, 0, H);
    scrim.addColorStop(0, 'rgba(2,6,23,0.38)');
    scrim.addColorStop(0.42, 'rgba(2,6,23,0.04)');
    scrim.addColorStop(0.70, 'rgba(2,6,23,0.52)');
    scrim.addColorStop(1, 'rgba(2,6,23,0.93)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, H);

    // --- Brand mark (top-left) ---
    drawBrand(ctx, 64, 84);

    // --- Bottom text block, built upward from the baseline ---
    const pad = 72;
    const maxW = W - pad * 2;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    // Leave generous bottom space so chat apps that overlay a send-time + read receipts on
    // the bottom-right (e.g. Instagram DMs) don't cover the text.
    let y = H - 104;

    // Fact (lowest), up to 2 lines. The font MUST be set BEFORE wrap() measures, otherwise
    // it measures with the default 10px font, never wraps, and the line overflows to the right.
    if (opts.fact) {
      ctx.font = `400 36px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.90)';
      const factLines = wrap(ctx, firstSentence(opts.fact), maxW, 2);
      for (let i = factLines.length - 1; i >= 0; i--) { ctx.fillText(factLines[i], pad, y); y -= 48; }
      y -= 14;
    }

    // Location (cyan)
    const loc = [opts.city, opts.country].map(s => (s || '').trim()).filter(Boolean).join(', ');
    if (loc) {
      ctx.font = `600 38px ${FONT}`;
      ctx.fillStyle = '#67e8f9';
      ctx.fillText(loc.length > 46 ? loc.slice(0, 45) + '…' : loc, pad, y);
      y -= 66;
    }

    // Name (big, bold, up to 3 lines, auto-shrink to fit)
    let nameSize = 90;
    let nameLines: string[] = [];
    while (nameSize >= 52) {
      ctx.font = `800 ${nameSize}px ${FONT}`;
      nameLines = wrap(ctx, opts.name, maxW, 3);
      // measure widest line; if any overflows even after wrapping, shrink
      const widest = Math.max(...nameLines.map(l => ctx.measureText(l).width));
      if (widest <= maxW) break;
      nameSize -= 8;
    }
    const lineH = nameSize * 1.08;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 12;
    for (let i = nameLines.length - 1; i >= 0; i--) { ctx.fillText(nameLines[i], pad, y); y -= lineH; }
    ctx.shadowColor = 'transparent';

    // --- Export to PNG ---
    return await new Promise<Blob | null>((resolve) => {
      try { canvas.toBlob((b) => resolve(b), 'image/png', 0.92); }
      catch { resolve(null); }
    });
  } catch {
    return null;
  }
}
