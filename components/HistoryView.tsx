import React, { useState } from 'react';
import { HistoryItem, Translation } from '../types';
import { Calendar, MapPin, Home, Trash2, CheckCircle, XCircle, Image as ImageIcon } from 'lucide-react';

interface HistoryViewProps {
  items: HistoryItem[];
  onClose: () => void;
  onClear: () => void;
  onSelect: (item: HistoryItem) => void;
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

export const HistoryView: React.FC<HistoryViewProps> = ({ items, onClose, onClear, onSelect, t }) => {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className="flex flex-col w-full h-full p-6 pt-24 animate-fade-in bg-slate-900 overflow-hidden">
      
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h2 className="text-3xl font-bold text-white">{t.historyTitle}</h2>
        
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {items.length > 0 && (
             <div className="relative">
                {showConfirm ? (
                  <div className="flex items-center gap-2 bg-red-900/50 border border-red-800 rounded-full px-1 py-1 animate-fade-in">
                     <span className="text-xs text-red-200 pl-3 font-medium">{t.confirmClear}</span>
                     <button 
                       onClick={() => { onClear(); setShowConfirm(false); }}
                       className="p-2 bg-red-600 rounded-full text-white hover:bg-red-500"
                     >
                       <CheckCircle size={16} />
                     </button>
                     <button 
                        onClick={() => setShowConfirm(false)}
                        className="p-2 bg-slate-700 rounded-full text-slate-300 hover:bg-slate-600"
                     >
                       <XCircle size={16} />
                     </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="bg-slate-800 hover:bg-red-900/40 text-slate-400 hover:text-red-400 p-3 rounded-full transition-all duration-300 border border-slate-700 shadow-lg"
                    title={t.clearHistory}
                  >
                    <Trash2 size={20} />
                  </button>
                )}
             </div>
          )}

          <button 
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-white p-3 px-5 rounded-full transition-all duration-300 flex items-center gap-2 border border-slate-700 shadow-lg"
          >
            <Home size={20} />
            <span className="font-medium">{t.home}</span>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pb-20">
        {items.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-700 rounded-2xl">
            <MapPin size={48} className="mb-4 opacity-50" />
            <p>{t.noHistory}</p>
          </div>
        ) : (
          items.map((item) => (
            <div 
              key={item.id} 
              onClick={() => onSelect(item)}
              className="bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden flex flex-col sm:flex-row hover:bg-slate-800 transition-colors group cursor-pointer active:scale-[0.99] transition-transform"
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
                    {new Date(item.timestamp).toLocaleDateString()}
                  </div>
                </div>
                <p className="text-slate-400 text-sm line-clamp-3 sm:line-clamp-4 leading-relaxed">
                  {item.summary}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};