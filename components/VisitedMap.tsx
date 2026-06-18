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

// Teardrop pin as an inline SVG (favorites in amber, others emerald). Using a divIcon
// avoids Leaflet's default PNG marker assets, which break under bundlers.
const pinSvg = (favorite?: boolean) => {
  const fill = favorite ? '#f59e0b' : '#10b981';
  return `<svg width="30" height="30" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))">
    <path fill="${fill}" stroke="#fff" stroke-width="1.5" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
    <circle cx="12" cy="9" r="2.6" fill="#fff"/>
  </svg>`;
};

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
          iconSize: [30, 30],
          iconAnchor: [15, 30],
          popupAnchor: [0, -28],
        }),
        title: p.item.landmarkName,
      }).addTo(map);

      // Popup with a thumbnail + name; clicking it opens the landmark detail.
      const el = document.createElement('div');
      el.className = 'st-pin-popup';
      el.style.cssText = 'cursor:pointer;width:160px;';
      const thumb = p.item.thumbnail
        ? `<img src="data:image/jpeg;base64,${p.item.thumbnail}" alt="" style="width:100%;height:84px;object-fit:cover;border-radius:8px;display:block;margin-bottom:6px;" />`
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
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 py-3 shrink-0">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2 min-w-0">
          <MapPinned size={22} className="text-emerald-400 shrink-0" />
          <span className="truncate">{t.mapTitle}</span>
        </h2>
        <button
          onClick={onClose}
          className="shrink-0 bg-slate-800/80 hover:bg-slate-700 text-slate-200 py-2 px-3.5 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5 border border-slate-700"
        >
          <Home size={15} />
          <span>{t.home}</span>
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
