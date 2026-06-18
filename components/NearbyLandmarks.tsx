import React, { useRef, useEffect } from 'react';
import { LocateFixed, Loader2, MapPin, ChevronRight, Home, MapPinOff, Compass } from 'lucide-react';
import { NearbyPlace, Translation } from '../types';

interface NearbyLandmarksProps {
  places: NearbyPlace[];
  loading: boolean;
  denied: boolean;       // location permission denied / unavailable
  onSelect: (name: string) => void;
  onClose: () => void;
  t: Translation;
}

// "Near me now": famous landmarks around the user's current location, discovered via
// device GPS without taking a photo. Picking one runs the normal details pipeline.
export const NearbyLandmarks: React.FC<NearbyLandmarksProps> = ({ places, loading, denied, onSelect, onClose, t }) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  return (
    <div className="w-full h-full overflow-y-auto custom-scrollbar animate-fade-in">
      <div className="flex flex-col items-center min-h-full px-6 pt-header pb-safe">
        <div className="max-w-md w-full bg-slate-800/80 backdrop-blur-lg border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-2xl my-auto">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="bg-emerald-500/20 w-12 h-12 rounded-2xl flex items-center justify-center text-emerald-400 shrink-0 border border-emerald-500/30">
                <LocateFixed size={24} />
              </div>
              <div className="min-w-0">
                <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-white outline-none leading-tight">{t.nearMeTitle}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{t.nearMeSubtitle}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label={t.home}
              title={t.home}
              className="shrink-0 bg-slate-700/60 hover:bg-slate-700 text-slate-300 p-2 rounded-full border border-slate-600 transition-colors"
            >
              <Home size={16} />
            </button>
          </div>

          {/* Body */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-3">
              <Loader2 size={28} className="animate-spin text-emerald-400" />
              <p className="text-sm">{t.locating}</p>
            </div>
          ) : denied ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-4">
              <MapPinOff size={40} className="text-slate-500" />
              <p className="text-sm text-slate-400 max-w-xs">{t.locationDenied}</p>
              <button
                onClick={onClose}
                className="mt-1 py-2.5 px-5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-semibold transition-colors"
              >
                {t.home}
              </button>
            </div>
          ) : places.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
              <Compass size={40} className="text-slate-500" />
              <p className="text-sm text-slate-400">{t.nearMeEmpty}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {places.map((place, idx) => (
                <button
                  key={idx}
                  onClick={() => onSelect(place.name)}
                  className="w-full group flex items-center gap-3 bg-slate-700/40 hover:bg-emerald-600/90 text-left rounded-xl p-3.5 border border-slate-600 hover:border-emerald-500 transition-all duration-200 hover:scale-[1.01]"
                >
                  <span className="shrink-0 text-emerald-400 group-hover:text-white transition-colors">
                    <MapPin size={18} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-100 group-hover:text-white truncate">{place.name}</span>
                    {place.description && (
                      <span className="block text-xs text-slate-400 group-hover:text-emerald-100 line-clamp-1">{place.description}</span>
                    )}
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-slate-500 group-hover:text-white transition-colors" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
