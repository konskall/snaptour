import React, { useState, useRef, useEffect, useMemo } from 'react';
import { HistoryItem, LandmarkMeta, Translation } from '../types';
import { Calendar, MapPin, Home, Trash2, Share2, Check, Search, Star, Landmark } from 'lucide-react';
import { gradientFor } from '../services/placeholderUtils';
import { buildShareUrl } from '../services/shareCardUtils';
import { ConfirmDialog } from './ConfirmDialog';

interface HistoryViewProps {
  items: HistoryItem[];
  onClose: () => void;
  onClear: () => void;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (item: HistoryItem) => void;
  langCode?: string;
  t: Translation;
}

// Designed fallback for entries with no photo (e.g. "Near me now" picks whose
// Wikimedia lookup also missed): a stable gradient + flag + landmark icon + name,
// so the card looks intentional rather than broken.
const HistoryPlaceholder = ({ info, alt }: { info?: LandmarkMeta; alt: string }) => (
  <div className={`absolute inset-0 bg-gradient-to-br ${gradientFor(info?.countryCode || alt)} flex flex-col items-center justify-center p-4 text-white overflow-hidden`}>
    {info?.countryCode && (
      <img
        src={`https://cdn.jsdelivr.net/gh/HatScripts/circle-flags/flags/${info.countryCode}.svg`}
        alt="" aria-hidden="true"
        className="absolute -right-7 -bottom-7 w-32 h-32 opacity-20"
        loading="lazy"
      />
    )}
    <Landmark size={38} className="opacity-90 mb-2 drop-shadow" />
    <p className="relative text-center text-sm font-semibold leading-tight line-clamp-2 drop-shadow">{alt}</p>
  </div>
);

const HistoryThumbnail = ({ thumbnail, alt, info }: { thumbnail: string, alt: string, info?: LandmarkMeta }) => {
  const [error, setError] = useState(false);

  if (error || !thumbnail) {
    return <HistoryPlaceholder info={info} alt={alt} />;
  }

  // Thumbnails are either a stored base64 string (user photos) or an absolute URL
  // (a fetched Wikimedia image for photo-less items).
  const src = thumbnail.includes('://') ? thumbnail : `data:image/jpeg;base64,${thumbnail}`;

  return (
    <img
      src={src}
      alt={alt}
      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
      loading="lazy"
      onError={() => setError(true)}
    />
  );
};

export const HistoryView: React.FC<HistoryViewProps> = ({ items, onClose, onClear, onSelect, onDelete, onToggleFavorite, langCode = 'en', t }) => {
  // Format dates in the app's selected language, not the OS locale (zh → zh-Hans for BCP 47).
  const dateLocale = langCode === 'zh' ? 'zh-Hans' : langCode;
  // Pending destructive action awaiting confirmation in the modal.
  const [confirm, setConfirm] = useState<{ kind: 'all' } | { kind: 'item'; item: HistoryItem } | null>(null);
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

  // Share a saved landmark — the LINK only (the Worker /s endpoint renders a per-landmark
  // Open Graph preview on the recipient's side). Only the landmark id travels in the URL, so
  // the recipient opens it in their own language. Desktop copies the link.
  const handleShare = async (item: HistoryItem) => {
    const shareUrl = buildShareUrl(item.landmarkName);
    const text = t.shareText.replace('{name}', item.landmarkName);

    const copyLink = async () => {
      try {
        await navigator.clipboard.writeText(`${text} ${shareUrl}`);
        setSharedId(item.id);
        setTimeout(() => setSharedId(null), 2000);
      } catch { /* clipboard unavailable */ }
    };

    const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (isTouch && navigator.share) {
      try { await navigator.share({ title: item.landmarkName, text, url: shareUrl }); return; }
      catch (err) { if ((err as { name?: string })?.name === 'AbortError') return; }
    }

    await copyLink();
  };

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const hasFilters = items.length > 0;

  return (
    <div className="flex flex-col w-full h-full p-6 pt-header animate-fade-in bg-slate-900 overflow-hidden">

      {/* Header — title + icon-only actions on one compact row (no "Home" label,
          favorites toggle moved here from the filter row to save vertical space). */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl sm:text-3xl font-bold text-white outline-none truncate">{t.historyTitle}</h2>

        <div className="flex items-center gap-1.5 shrink-0">
          {items.length > 0 && (
            <button
              onClick={() => setFavOnly(v => !v)}
              aria-pressed={favOnly}
              title={t.favoritesOnly}
              aria-label={t.favoritesOnly}
              className={`w-9 h-9 rounded-full grid place-items-center border transition-colors ${
                favOnly
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <Star size={17} className={favOnly ? 'fill-amber-300' : ''} />
            </button>
          )}

          {items.length > 0 && (
              <button
                onClick={() => setConfirm({ kind: 'all' })}
                className="w-9 h-9 rounded-full grid place-items-center bg-slate-800/80 hover:bg-red-900/40 text-slate-400 hover:text-red-400 transition-colors border border-slate-700"
                title={t.clearHistory}
                aria-label={t.clearHistory}
              >
                <Trash2 size={16} />
              </button>
          )}

          <button
            onClick={onClose}
            title={t.home}
            aria-label={t.home}
            className="w-9 h-9 rounded-full grid place-items-center bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors border border-slate-700"
          >
            <Home size={17} />
          </button>
        </div>
      </div>

      {/* Search + inline filters (favorites toggle lives in the header now) */}
      {hasFilters && (
        <div className="flex gap-2 mb-5 shrink-0">
          <div className="relative flex-1 min-w-0">
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
          {countries.length > 1 && (
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              aria-label={t.filterByCountry}
              className="shrink-0 bg-slate-800/70 border border-slate-700 rounded-full px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 max-w-[30vw]"
            >
              <option value="">{t.filterAll}</option>
              {countries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {types.length > 1 && (
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              aria-label={t.filterByType}
              className="shrink-0 bg-slate-800/70 border border-slate-700 rounded-full px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 max-w-[30vw]"
            >
              <option value="">{t.filterAll}</option>
              {types.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
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
                aria-label={`${item.landmarkName}, ${new Date(item.timestamp).toLocaleDateString(dateLocale)}`}
                className="w-full text-left bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden flex flex-col sm:flex-row hover:bg-slate-800 transition-colors group cursor-pointer active:scale-[0.99] transition-transform"
              >
                {/* Image Container */}
                <div className="w-full h-48 sm:w-48 sm:h-48 flex-shrink-0 bg-slate-900 relative overflow-hidden">
                  <HistoryThumbnail thumbnail={item.thumbnail} alt={item.landmarkName} info={item.info} />
                </div>
                <div className="p-4 flex flex-col justify-center flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-xl font-bold text-white truncate w-full group-hover:text-indigo-400 transition-colors">{item.landmarkName}</h3>
                    <div className="flex-shrink-0 flex items-center text-xs text-slate-400 bg-slate-900/80 px-2 py-1 rounded-full whitespace-nowrap">
                      <Calendar size={12} className="mr-1" />
                      {new Date(item.timestamp).toLocaleDateString(dateLocale)}, {new Date(item.timestamp).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
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
                  onClick={() => setConfirm({ kind: 'item', item })}
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

      {/* Delete confirmation (per-item or clear-all) */}
      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'all' ? t.clearHistory : t.deleteItem}
          message={confirm.kind === 'all' ? t.confirmClearAll : t.confirmDeleteItem}
          confirmLabel={confirm.kind === 'all' ? t.clearHistory : t.deleteItem}
          cancelLabel={t.cancel}
          onConfirm={() => {
            if (confirm.kind === 'all') onClear();
            else onDelete(confirm.item.id);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
};
