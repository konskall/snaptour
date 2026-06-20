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

      {/* Main Content Card — premium glass over a soft brand glow */}
      <div className="relative z-10 max-w-md w-full">
        <div aria-hidden="true" className="absolute -inset-3 rounded-[2rem] bg-gradient-to-br from-indigo-500/25 via-cyan-400/10 to-transparent blur-2xl pointer-events-none" />
        <div className="relative bg-slate-900/30 backdrop-blur-2xl border border-white/10 ring-1 ring-white/5 rounded-[1.75rem] p-8 shadow-2xl">
        <div className="text-center mb-8">
          {/* Hero: the branded camera artwork over a soft colour glow that echoes its palette. */}
          <div className="relative mx-auto mb-4" style={{ width: 168, height: 128 }}>
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                width: 250,
                height: 250,
                background: 'radial-gradient(closest-side, rgba(168,85,247,0.75), rgba(236,72,153,0.45) 44%, rgba(34,211,238,0.24) 66%, transparent 80%)',
                filter: 'blur(13px)',
              }}
            />
            <picture>
              {/* Relative paths resolve against the app's document base (/snaptour/). */}
              <source srcSet="camera-hero.webp" type="image/webp" />
              <img
                src="camera-hero.png"
                alt=""
                width={168}
                height={126}
                decoding="async"
                fetchPriority="high"
                className="relative w-[168px] h-auto drop-shadow-[0_10px_22px_rgba(0,0,0,0.45)]"
              />
            </picture>
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
              className="sheen w-full cursor-pointer flex items-center justify-center gap-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-300 active:scale-95 transform hover:scale-[1.02] shadow-lg shadow-indigo-500/30 border border-indigo-400/50"
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
              className={`w-full group/btn flex items-center justify-center gap-3 font-semibold py-4 px-6 rounded-xl transition-all duration-300 active:scale-95 ${
                isCoarsePointer
                  ? 'bg-slate-700/80 hover:bg-slate-600/80 text-slate-200 border border-indigo-500/30 hover:border-indigo-500/50'
                  : 'sheen bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/30 border border-indigo-400/50 transform hover:scale-[1.02]'
              }`}
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

          {/* Elegant "or" divider between photo and location discovery.
              slate-400 (not 500) so the glyph reads clearly — matches the "supports" line below. */}
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-widest text-slate-400">
            <span className="h-px flex-1 bg-white/10" />
            {t.or}
            <span className="h-px flex-1 bg-white/10" />
          </div>

          {/* "Near me now" — discover landmarks around the user without a photo */}
          <button
            onClick={onNearMe}
            className="w-full group/near flex items-center justify-center gap-3 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-200 font-semibold py-4 px-6 rounded-xl transition-all duration-300 active:scale-95 border border-emerald-500/30 hover:border-emerald-500/50"
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