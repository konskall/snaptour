import React, { useRef, useEffect, useState } from 'react';
import { Home, Award, MapPin, Globe2, Flag, Mountain, X, ChevronRight } from 'lucide-react';
import { HistoryItem, Translation } from '../types';
import { buildPassport, getContinent, localizeContinent } from '../services/geoUtils';
import { useDialog } from '../hooks/useDialog';

interface PassportViewProps {
  items: HistoryItem[];
  onClose: () => void;
  onSelect: (item: HistoryItem) => void;
  langCode: string;
  t: Translation;
}

const flagUrl = (code: string) => `https://cdn.jsdelivr.net/gh/HatScripts/circle-flags/flags/${code}.svg`;

const StatCard: React.FC<{ icon: React.ReactNode; value: number; label: string; onClick: () => void }> = ({ icon, value, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex-1 bg-slate-800/60 hover:bg-slate-800 border border-slate-700 hover:border-indigo-500/50 rounded-2xl p-4 flex flex-col items-center text-center transition-all hover:scale-[1.02] active:scale-95"
  >
    <span className="text-indigo-400 mb-1.5">{icon}</span>
    <span className="text-2xl sm:text-3xl font-bold text-white tabular-nums">{value}</span>
    <span className="text-[11px] sm:text-xs text-slate-400 mt-0.5">{label}</span>
  </button>
);

// Bottom-sheet / centered modal listing the items behind a stat.
const PassportListModal: React.FC<{ title: string; closeLabel: string; onClose: () => void; children: React.ReactNode }> = ({ title, closeLabel, onClose, children }) => {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-6 pointer-events-none">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative pointer-events-auto w-full max-w-md bg-slate-900 border-t sm:border border-slate-700 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[80dvh] animate-slide-up"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-700 shrink-0">
          <h3 className="font-bold text-white text-lg">{title}</h3>
          <button onClick={onClose} aria-label={closeLabel} className="p-2 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto custom-scrollbar p-3 space-y-1 flex-1 min-h-0 pb-safe-sheet">{children}</div>
      </div>
    </div>
  );
};

// Travel passport: lightweight gamification on top of history — totals (each opens a
// list modal) plus a "stamp" per distinct country. Pure aggregation lives in
// geoUtils.buildPassport (unit-tested).
export const PassportView: React.FC<PassportViewProps> = ({ items, onClose, onSelect, langCode, t }) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const [modal, setModal] = useState<null | 'landmarks' | 'countries' | 'continents'>(null);

  const { landmarks, countries, continents } = buildPassport(items);

  // Continent rows: localized name + how many distinct countries you've visited there.
  const continentRows = continents.map((cont) => ({
    name: localizeContinent(cont, langCode),
    count: countries.filter((c) => getContinent(c.code) === cont).length,
  }));

  const modalTitle = modal === 'landmarks' ? t.statLandmarks : modal === 'countries' ? t.statCountries : t.statContinents;

  return (
    <div className="flex flex-col w-full h-full p-6 pt-header bg-slate-900 overflow-hidden animate-fade-in">
      {/* Header — smaller title (was clipping) + icon-only home */}
      <div className="flex items-center justify-between gap-3 mb-5 shrink-0">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl sm:text-2xl font-bold text-white outline-none flex items-center gap-2 min-w-0">
          <Award size={22} className="text-amber-400 shrink-0" />
          <span className="truncate">{t.passportTitle}</span>
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

      <div className="flex-1 overflow-y-auto custom-scrollbar pb-safe">
        {landmarks === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-700 rounded-2xl">
            <Award size={48} className="mb-4 opacity-50" />
            <p className="text-center max-w-xs px-4">{t.passportEmpty}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Stats — each opens a list modal */}
            <div className="flex gap-3">
              <StatCard icon={<MapPin size={20} />} value={landmarks} label={t.statLandmarks} onClick={() => setModal('landmarks')} />
              <StatCard icon={<Flag size={20} />} value={countries.length} label={t.statCountries} onClick={() => setModal('countries')} />
              <StatCard icon={<Mountain size={20} />} value={continents.length} label={t.statContinents} onClick={() => setModal('continents')} />
            </div>

            {/* Country stamps */}
            {countries.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {countries.map((c) => (
                  <div
                    key={c.code || c.name}
                    className="relative bg-slate-800/50 border border-slate-700 rounded-2xl p-4 flex flex-col items-center text-center overflow-hidden"
                  >
                    <div className="absolute inset-2 rounded-xl border-2 border-dashed border-slate-600/40 pointer-events-none" />
                    {c.code ? (
                      <img src={flagUrl(c.code)} alt={c.name} width={44} height={44} loading="lazy" decoding="async" className="w-11 h-11 rounded-full ring-2 ring-white/15 mb-2 relative" />
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

      {/* List modals */}
      {modal && (
        <PassportListModal title={modalTitle} closeLabel={t.close} onClose={() => setModal(null)}>
          {modal === 'landmarks' && items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-800 text-left transition-colors group"
            >
              {item.info?.countryCode ? (
                <img src={flagUrl(item.info.countryCode)} alt="" className="w-6 h-6 rounded-full ring-1 ring-white/10 shrink-0" loading="lazy" />
              ) : (
                <span className="w-6 h-6 rounded-full bg-slate-700 grid place-items-center text-slate-400 shrink-0"><MapPin size={13} /></span>
              )}
              <span className="flex-1 min-w-0 text-sm text-slate-200 truncate group-hover:text-white">{item.landmarkName}</span>
              <ChevronRight size={16} className="shrink-0 text-slate-600 group-hover:text-indigo-400" />
            </button>
          ))}

          {modal === 'countries' && countries.map((c) => (
            <div key={c.code || c.name} className="w-full flex items-center gap-3 p-2.5 rounded-xl">
              {c.code ? (
                <img src={flagUrl(c.code)} alt="" className="w-6 h-6 rounded-full ring-1 ring-white/10 shrink-0" loading="lazy" />
              ) : (
                <span className="w-6 h-6 rounded-full bg-slate-700 grid place-items-center text-slate-400 shrink-0"><Globe2 size={13} /></span>
              )}
              <span className="flex-1 min-w-0 text-sm text-slate-200 truncate">{c.name}</span>
              <span className="shrink-0 text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">×{c.count}</span>
            </div>
          ))}

          {modal === 'continents' && continentRows.map((r) => (
            <div key={r.name} className="w-full flex items-center gap-3 p-2.5 rounded-xl">
              <span className="w-6 h-6 rounded-full bg-slate-700 grid place-items-center text-emerald-400 shrink-0"><Mountain size={13} /></span>
              <span className="flex-1 min-w-0 text-sm text-slate-200 truncate">{r.name}</span>
              <span className="shrink-0 text-[11px] font-bold text-slate-300 bg-slate-700/60 border border-slate-600 rounded-full px-2 py-0.5">×{r.count}</span>
            </div>
          ))}
        </PassportListModal>
      )}
    </div>
  );
};
