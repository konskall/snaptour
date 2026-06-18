import React, { useState, useRef, useEffect } from 'react';
import { HistoryItem, Translation } from '../types';
import { Calendar, MapPin, Home, Trash2, CheckCircle, XCircle, Image as ImageIcon, Share2, Check } from 'lucide-react';

interface HistoryViewProps {
  items: HistoryItem[];
  onClose: () => void;
  onClear: () => void;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
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

export const HistoryView: React.FC<HistoryViewProps> = ({ items, onClose, onClear, onSelect, onDelete, t }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [sharedId, setSharedId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

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

  return (
    <div className="flex flex-col w-full h-full p-6 pt-header animate-fade-in bg-slate-900 overflow-hidden">

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
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

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pb-safe">
        {items.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-700 rounded-2xl">
            <MapPin size={48} className="mb-4 opacity-50" />
            <p>{t.noHistory}</p>
          </div>
        ) : (
          items.map((item) => (
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
                  <p className="text-slate-400 text-sm line-clamp-3 sm:line-clamp-4 leading-relaxed">
                    {item.summary}
                  </p>
                </div>
              </button>

              {/* Per-item actions (share + delete), over the thumbnail corner */}
              <div className="absolute top-2 right-2 sm:left-2 sm:right-auto z-10 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => handleShare(item)}
                  aria-label={`${t.share}: ${item.landmarkName}`}
                  title={t.share}
                  className="p-2 rounded-full bg-slate-900/80 backdrop-blur-sm text-slate-200 hover:bg-indigo-600 hover:text-white border border-slate-700/60 shadow-lg transition-colors"
                >
                  {sharedId === item.id ? <Check size={16} className="text-green-400" /> : <Share2 size={16} />}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  aria-label={`${t.deleteItem}: ${item.landmarkName}`}
                  title={t.deleteItem}
                  className="p-2 rounded-full bg-slate-900/80 backdrop-blur-sm text-slate-200 hover:bg-red-600 hover:text-white border border-slate-700/60 shadow-lg transition-colors"
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