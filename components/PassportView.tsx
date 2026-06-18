import React, { useRef, useEffect } from 'react';
import { Home, Award, MapPin, Globe2, Flag, Mountain } from 'lucide-react';
import { HistoryItem, Translation } from '../types';
import { buildPassport } from '../services/geoUtils';

interface PassportViewProps {
  items: HistoryItem[];
  onClose: () => void;
  t: Translation;
}

const StatCard: React.FC<{ icon: React.ReactNode; value: number; label: string }> = ({ icon, value, label }) => (
  <div className="flex-1 bg-slate-800/60 border border-slate-700 rounded-2xl p-4 flex flex-col items-center text-center">
    <span className="text-indigo-400 mb-1.5">{icon}</span>
    <span className="text-2xl sm:text-3xl font-bold text-white tabular-nums">{value}</span>
    <span className="text-[11px] sm:text-xs text-slate-400 mt-0.5">{label}</span>
  </div>
);

// Travel passport: lightweight gamification on top of history — totals plus a
// "stamp" per distinct country (with flag + visit count). Pure aggregation lives in
// geoUtils.buildPassport (unit-tested).
export const PassportView: React.FC<PassportViewProps> = ({ items, onClose, t }) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const { landmarks, countries, continents } = buildPassport(items);

  return (
    <div className="flex flex-col w-full h-full p-6 pt-header bg-slate-900 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5 shrink-0">
        <h2 ref={headingRef} tabIndex={-1} className="text-3xl font-bold text-white outline-none flex items-center gap-2 min-w-0">
          <Award size={26} className="text-amber-400 shrink-0" />
          <span className="truncate">{t.passportTitle}</span>
        </h2>
        <button
          onClick={onClose}
          className="shrink-0 bg-slate-800/80 hover:bg-slate-700 text-slate-200 py-2 px-3.5 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5 border border-slate-700"
        >
          <Home size={15} />
          <span>{t.home}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pb-safe">
        {landmarks === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-700 rounded-2xl">
            <Award size={48} className="mb-4 opacity-50" />
            <p className="text-center max-w-xs px-4">{t.passportEmpty}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Stats */}
            <div className="flex gap-3">
              <StatCard icon={<MapPin size={20} />} value={landmarks} label={t.statLandmarks} />
              <StatCard icon={<Flag size={20} />} value={countries.length} label={t.statCountries} />
              <StatCard icon={<Mountain size={20} />} value={continents.length} label={t.statContinents} />
            </div>

            {/* Country stamps */}
            {countries.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {countries.map((c) => (
                  <div
                    key={c.code || c.name}
                    className="relative bg-slate-800/50 border border-slate-700 rounded-2xl p-4 flex flex-col items-center text-center overflow-hidden"
                  >
                    {/* faint stamp ring */}
                    <div className="absolute inset-2 rounded-xl border-2 border-dashed border-slate-600/40 pointer-events-none" />
                    {c.code ? (
                      <img
                        src={`https://cdn.jsdelivr.net/gh/HatScripts/circle-flags/flags/${c.code}.svg`}
                        alt={c.name}
                        width={44}
                        height={44}
                        loading="lazy"
                        decoding="async"
                        className="w-11 h-11 rounded-full ring-2 ring-white/15 mb-2 relative"
                      />
                    ) : (
                      <span className="w-11 h-11 rounded-full bg-slate-700 flex items-center justify-center text-slate-400 mb-2 relative">
                        <Globe2 size={22} />
                      </span>
                    )}
                    <span className="text-sm font-semibold text-white truncate w-full relative">{c.name}</span>
                    <span className="mt-1 text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5 relative">
                      ×{c.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
