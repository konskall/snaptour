import React, { useRef, useEffect } from 'react';
import { HelpCircle, CheckCircle, RefreshCcw, MapPinOff, Camera } from 'lucide-react';
import { LandmarkIdentification, Translation } from '../types';

interface LandmarkSelectorProps {
  identification: LandmarkIdentification;
  onSelect: (name: string) => void;
  onCancel: () => void;
  t: Translation;
}

export const LandmarkSelector: React.FC<LandmarkSelectorProps> = ({ identification, onSelect, onCancel, t }) => {
  const conf = Number.isFinite(identification.confidence) ? identification.confidence : 0;

  // The model returns confidence 0 (and ideally an empty name) when the photo isn't a
  // landmark. Only treat the primary name as a real guess when confidence > 0, so a
  // "not a landmark" reply never becomes a selectable — and then mis-narrated — option.
  const options = Array.from(new Set(
    [
      ...(conf > 0 && identification.name ? [identification.name] : []),
      ...(identification.alternatives ?? []),
    ]
      .map((s) => (s || '').trim())
      .filter(Boolean)
  ));

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  // No usable candidates → it isn't a landmark. Send the user straight to a new scan.
  if (options.length === 0) {
    return (
      <div className="w-full h-full overflow-y-auto custom-scrollbar animate-fade-in">
        <div className="flex flex-col items-center justify-center min-h-full px-6 pt-header pb-safe">
          <div className="max-w-md w-full bg-slate-800/80 backdrop-blur-lg border border-slate-700 rounded-3xl p-8 shadow-2xl text-center">
            <div className="bg-slate-500/20 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-slate-300">
              <MapPinOff size={32} />
            </div>
            <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-white mb-2 outline-none">{t.notLandmarkTitle}</h2>
            <p className="text-slate-400 mb-8">{t.notLandmark}</p>
            <button
              onClick={onCancel}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] shadow-lg shadow-indigo-500/25"
            >
              <Camera size={20} />
              {t.scanAnother}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto custom-scrollbar animate-fade-in">
      <div className="flex flex-col items-center justify-center min-h-full px-6 pt-header pb-safe">
        <div className="max-w-md w-full bg-slate-800/80 backdrop-blur-lg border border-slate-700 rounded-3xl p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="bg-amber-500/20 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-amber-400">
              <HelpCircle size={32} />
            </div>
            <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-white mb-2 outline-none">{t.selectMatch}</h2>
            <p className="text-slate-400 mb-2">{t.uncertain}</p>
            <div className="inline-block px-3 py-1 rounded-full bg-slate-700/80 text-xs font-mono text-slate-300 border border-slate-600">
              {t.confidence}: {(conf * 100).toFixed(0)}%
            </div>
          </div>

          <div className="space-y-3">
            {options.map((option, idx) => (
              <button
                key={idx}
                onClick={() => onSelect(option)}
                className="w-full group relative flex items-center justify-between bg-slate-700/50 hover:bg-indigo-600 text-left text-slate-200 hover:text-white font-medium py-4 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] border border-slate-600 hover:border-indigo-500"
              >
                <span>{option}</span>
                <CheckCircle size={18} className="opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>

          <div className="mt-6 pt-6 border-t border-slate-700/50">
            <button
              onClick={onCancel}
              className="w-full py-3 px-4 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700/50 font-medium transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCcw size={16} />
              {t.noneOfThese}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
