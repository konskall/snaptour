import React, { useRef } from 'react';
import { Camera, Upload, Image as ImageIcon, LocateFixed } from 'lucide-react';
import { Translation } from '../types';

interface PhotoInputProps {
  onImageSelect: (file: File, source: 'camera' | 'upload') => void;
  onNearMe: () => void;
  t: Translation;
}

export const PhotoInput: React.FC<PhotoInputProps> = ({ onImageSelect, onNearMe, t }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Touch devices honor the camera <input capture>; on desktop `capture` is ignored, so the
  // camera button would just open the same file picker as Upload — show it only on touch.
  const isCoarsePointer = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, source: 'camera' | 'upload') => {
    if (e.target.files && e.target.files[0]) {
      onImageSelect(e.target.files[0], source);
    }
  };

  return (
    <div className="relative w-full h-full overflow-y-auto custom-scrollbar animate-fade-in">

      {/* Background Image Layer - Fixed to ensure full coverage on all devices */}
      <div className="fixed inset-0 z-0 w-full h-full">
        <img
          src="https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?q=70&w=1920&auto=format&fit=crop"
          srcSet="https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?q=70&w=640&auto=format&fit=crop 640w, https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?q=70&w=828&auto=format&fit=crop 828w, https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?q=70&w=1280&auto=format&fit=crop 1280w, https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?q=70&w=1920&auto=format&fit=crop 1920w"
          sizes="100vw"
          fetchPriority="high"
          decoding="async"
          alt="Travel Background"
          className="w-full h-full object-cover object-center"
        />
        {/* Dark gradient overlay for text readability — lightened from 70/40/80 to 52/28/68
            (slate-900 = rgb(15,23,42)). Inline gradient because these opacities aren't
            standard Tailwind steps. */}
        <div
          className="absolute inset-0"
          style={{ backgroundImage: 'linear-gradient(to bottom, rgba(15,23,42,0.52), rgba(15,23,42,0.28) 50%, rgba(15,23,42,0.68))' }}
        />
      </div>

      {/* Column: card centered in the free space, credits pinned to the bottom.
          Clears the overlay header (pt-header) and the home indicator (pb-safe). */}
      <div className="relative z-10 flex flex-col min-h-full px-6 pt-header pb-safe">

      {/* Card area — centered in the available vertical space */}
      <div className="flex-1 flex flex-col items-center justify-center w-full">

      {/* Main Content Card */}
      <div className="relative z-10 max-w-md w-full bg-slate-800/60 backdrop-blur-xl border border-slate-700/50 rounded-3xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="bg-indigo-500/20 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 text-indigo-400 border border-indigo-500/30">
            <Camera size={32} />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{t.startTitle}</h2>
          <p className="text-slate-300 font-medium">{t.startSubtitle}</p>
        </div>

        <div className="space-y-4">
          
          {/* Camera trigger (touch only) — see isCoarsePointer above */}
          {isCoarsePointer && (
          <div className="relative">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              id="cameraInput"
              className="hidden"
              onChange={(e) => handleFileChange(e, 'camera')}
            />
            <label 
              htmlFor="cameraInput"
              className="w-full cursor-pointer flex items-center justify-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] shadow-lg shadow-indigo-500/25 border border-indigo-400"
            >
              <Camera size={20} />
              <span>{t.cameraBtn}</span>
            </label>
          </div>
          )}

          {/* Upload Button (SECOND - SLATE) — button + its hidden input wrapped
              together so there's no empty layout child disturbing the spacing rhythm. */}
          <div className="relative">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full group/btn relative flex items-center justify-center gap-3 bg-slate-700/80 hover:bg-slate-600/80 text-slate-200 font-semibold py-4 px-6 rounded-xl transition-all duration-300 border border-indigo-500/30 hover:border-indigo-500/50"
            >
              <Upload size={20} className="group-hover:-translate-y-0.5 transition-transform" />
              <span>{t.uploadBtn}</span>
            </button>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={(e) => handleFileChange(e, 'upload')}
            />
          </div>

          {/* Divider between photo-based and location-based discovery */}
          <div className="h-px bg-white/10" />

          {/* "Near me now" — discover landmarks around the user without a photo */}
          <button
            onClick={onNearMe}
            className="w-full group/near relative flex items-center justify-center gap-3 bg-slate-700/60 hover:bg-slate-600/70 text-slate-200 font-semibold py-4 px-6 rounded-xl transition-all duration-300 border border-emerald-500/30 hover:border-emerald-500/50"
          >
            <LocateFixed size={20} className="text-emerald-400 group-hover/near:scale-110 transition-transform" />
            <span>{t.nearMeBtn}</span>
          </button>

        </div>
        
        <div className="mt-4 pt-6 border-t border-white/15 flex items-center justify-center gap-2 text-xs text-slate-400">
          <ImageIcon size={14} />
          <span>{t.supports}</span>
        </div>
      </div>
      </div>

      {/* Footer / Credits / Disclaimer — pinned to the bottom of the screen.
          Text shadow + lighter colors keep it legible over the brighter photo. */}
      <div className="relative z-20 text-center space-y-1 pt-6 pointer-events-auto shrink-0 [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
        <p className="text-[11px] sm:text-xs text-slate-200/90 mx-auto">
           {t.disclaimer}
        </p>
        <p className="text-[11px] sm:text-xs text-slate-200 font-medium">
           {t.createdBy}{" "}
           <a
             href="https://www.linkedin.com/in/konstantinos-kalliakoudis-902b90103"
             target="_blank"
             rel="noopener noreferrer"
             className="text-white hover:text-indigo-300 transition-colors underline decoration-white/50 hover:decoration-indigo-300 underline-offset-2"
           >
             KonsKall
           </a>
        </p>
      </div>
      </div>
    </div>
  );
};