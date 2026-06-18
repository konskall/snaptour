import React, { useState, useRef, useEffect, useMemo } from 'react';
import { HistoryItem, Translation } from '../types';
import { Calendar, MapPin, Home, Trash2, CheckCircle, XCircle, Image as ImageIcon, Share2, Check, Search, Star } from 'lucide-react';

interface HistoryViewProps {
  items: HistoryItem[];
  onClose: () => void;
  onClear: () => void;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (item: HistoryItem) => void;
  t: Translation;
}

const HistoryThumbnail = ({ thumbnail, alt }: { thumbnail: string, alt: string }) => {
  const [error, setError] = useState(false);

  if (error || !thumbnail) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-800 text-slate-600">
        <ImageIcon size={32} opacity={0.5} />
      </div>
    );
  }

  return (
    <img
      src={`data:image/jpeg;base64,${thumbnail}`}
      alt={alt}
      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
      loading="lazy"
      onError={() => setError(true)}
    />
  );
};

export const HistoryView: React.FC<HistoryViewProps> = ({ items, onClose, onClear, onSelect, onDelete, onToggleFavorite, t }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [sharedId, setSharedId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [type, setType] = useState('');
  const [favOnly, setFavOnly] = useState(false);

  // Distinct country / type values present in the saved items (powers the dropdowns).
  const countries = useMemo(
    () => Array.from(new Set(items.map(i => (i.info?.country || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const types = useMemo(
    () => Array.from(new Set(items.map(i => (i.info?.category || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => {
      if (favOnly && !i.favorite) return false;
      if (country && (i.info?.country || '') !== country) return false;
      if (type && (i.info?.category || '') !== type) return false;
      if (q && !i.landmarkName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, country, type, favOnly]);

  // Share a saved landmark — like the result view: the SnapTour app link (branded
  // preview) with a ?l= deep link that opens this landmark on the recipient's side.
  const handleShare = async (item: HistoryItem) => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?l=${encodeURIComponent(item.landmarkName)}`;
    const text = t.shareText.replace('{name}', item.landmarkName);
    if (navigator.share) {
      try { await navigator.share({ title: item.landmarkName, text, url: shareUrl }); } catch { /* cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(`${text} ${shareUrl}`);
        setSharedId(item.id);
        setTimeout(() => setSharedId(null), 2000);
      } catch { /* clipboard unavailable */ }
    }
  };

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const hasFilters = items.length > 0;

  return (
    <div className="flex flex-col w-full h-full p-6 pt-header animate-fade-in bg-slate-900 overflow-hidden">

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
        <h2 ref={headingRef} tabIndex={-1} className="text-3xl font-bold text-white outline-none">{t.historyTitle}</h2>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {items.length > 0 && (
             <div className="relative">
                {showConfirm ? (
                  <div className="flex items-center gap-1.5 bg-red-900/50 border border-red-800 rounded-full px-1 py-1 animate-fade-in">
                     <span className="text-xs text-red-200 pl-2.5 font-medium">{t.confirmClear}</span>
                     <button
                       onClick={() => { onClear(); setShowConfirm(false); }}
                       className="p-1.5 bg-red-600 rounded-full text-white hover:bg-red-500 transition-colors"
                       aria-label={t.confirmClear}
                     >
                       <CheckCircle size={15} />
                     </button>
                     <button
                        onClick={() => setShowConfirm(false)}
                        className="p-1.5 bg-slate-700 rounded-full text-slate-300 hover:bg-slate-600 transition-colors"
                        aria-label={t.close}
                     >
                       <XCircle size={15} />
                     </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="bg-slate-800/80 hover:bg-red-900/40 text-slate-400 hover:text-red-400 p-2 rounded-full transition-colors border border-slate-700"
                    title={t.clearHistory}
                    aria-label={t.clearHistory}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
             </div>
          )}

          <button
            onClick={onClose}
            className="bg-slate-800/80 hover:bg-slate-700 text-slate-200 py-2 px-3.5 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5 border border-slate-700"
          >
            <Home size={15} />
            <span>{t.home}</span>
          </button>
        </div>
      </div>

      {/* Search + filters */}
      {hasFilters && (
        <div className="flex flex-col sm:flex-row gap-2 mb-5 shrink-0">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              style={{ fontSize: '16px' }}
              className="w-full bg-slate-800/70 border border-slate-700 rounded-full pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFavOnly(v => !v)}
              aria-pressed={favOnly}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold border transition-colors ${
                favOnly
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-800/70 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <Star size={15} className={favOnly ? 'fill-amber-300' : ''} />
              <span>{t.favoritesOnly}</span>
            </button>
            {countries.length > 1 && (
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                aria-label={t.filterAll}
                className="bg-slate-800/70 border border-slate-700 rounded-full px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 max-w-[40vw]"
              >
                <option value="">{t.filterAll}</option>
                {countries.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {types.length > 1 && (
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                aria-label={t.filterAll}
                className="bg-slate-800/70 border border-slate-700 rounded-full px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 max-w-[40vw]"
              >
                <option value="">{t.filterAll}</option>
                {types.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pb-safe">
        {items.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-700 rounded-2xl">
            <MapPin size={48} className="mb-4 opacity-50" />
            <p>{t.noHistory}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-700 rounded-2xl">
            <Search size={48} className="mb-4 opacity-50" />
            <p>{t.noResults}</p>
          </div>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className="relative">
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-label={item.landmarkName}
                className="w-full text-left bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden flex flex-col sm:flex-row hover:bg-slate-800 transition-colors group cursor-pointer active:scale-[0.99] transition-transform"
              >
                {/* Image Container */}
                <div className="w-full h-48 sm:w-48 sm:h-48 flex-shrink-0 bg-slate-900 relative overflow-hidden">
                  <HistoryThumbnail thumbnail={item.thumbnail} alt={item.landmarkName} />
                </div>
                <div className="p-4 flex flex-col justify-center flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-xl font-bold text-white truncate w-full group-hover:text-indigo-400 transition-colors">{item.landmarkName}</h3>
                    <div className="flex-shrink-0 flex items-center text-xs text-slate-400 bg-slate-900/80 px-2 py-1 rounded-full whitespace-nowrap">
                      <Calendar size={12} className="mr-1" />
                      {new Date(item.timestamp).toLocaleDateString()}, {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {/* country / type chips when available */}
                  {(item.info?.country || item.info?.category) && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {item.info?.country && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-300 bg-slate-700/50 border border-slate-600/50 rounded-full px-2 py-0.5">
                          {item.info.countryCode && (
                            <img src={`https://cdn.jsdelivr.net/gh/HatScripts/circle-flags/flags/${item.info.countryCode}.svg`} alt="" width={12} height={12} loading="lazy" className="w-3 h-3 rounded-full" />
                          )}
                          {item.info.country}
                        </span>
                      )}
                      {item.info?.category && (
                        <span className="text-[11px] text-slate-300 bg-slate-700/50 border border-slate-600/50 rounded-full px-2 py-0.5">{item.info.category}</span>
                      )}
                    </div>
                  )}
                  <p className="text-slate-400 text-sm line-clamp-2 sm:line-clamp-3 leading-relaxed">
                    {item.summary}
                  </p>
                </div>
              </button>

              {/* Per-item actions grouped in one pill so they read as a clear toolbar
                  instead of separate icons blending into the photo behind them. */}
              <div className="absolute top-2 right-2 sm:left-2 sm:right-auto z-10 flex items-center gap-0.5 bg-slate-900/85 backdrop-blur-md rounded-full p-1 border border-slate-700/60 shadow-lg">
                <button
                  type="button"
                  onClick={() => onToggleFavorite(item)}
                  aria-label={`${item.favorite ? t.removeFavorite : t.addFavorite}: ${item.landmarkName}`}
                  aria-pressed={!!item.favorite}
                  title={item.favorite ? t.removeFavorite : t.addFavorite}
                  className={`p-2 rounded-full transition-colors ${
                    item.favorite ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400 hover:bg-white/10'
                  }`}
                >
                  <Star size={16} className={item.favorite ? 'fill-amber-400' : ''} />
                </button>
                <button
                  type="button"
                  onClick={() => handleShare(item)}
                  aria-label={`${t.share}: ${item.landmarkName}`}
                  title={t.share}
                  className="p-2 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                >
                  {sharedId === item.id ? <Check size={16} className="text-green-400" /> : <Share2 size={16} />}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  aria-label={`${t.deleteItem}: ${item.landmarkName}`}
                  title={t.deleteItem}
                  className="p-2 rounded-full text-slate-300 hover:text-red-400 hover:bg-white/10 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
