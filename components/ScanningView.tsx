import React from 'react';
import { Translation } from '../types';
import { Scan, Loader2, MapPin } from 'lucide-react';

interface ScanningViewProps {
  imageSrc: string | null;
  t: Translation;
  hasGps?: boolean;
}

export const ScanningView: React.FC<ScanningViewProps> = ({ imageSrc, t, hasGps }) => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full p-6 animate-fade-in relative z-20">
      <div className="relative max-w-sm w-full aspect-[3/4] rounded-3xl overflow-hidden shadow-2xl border border-slate-700/50 bg-slate-900">
        
        {/* Image being scanned */}
        {imageSrc ? (
          <img 
            src={imageSrc} 
            alt="Analyzing" 
            className="w-full h-full object-cover opacity-60"
          />
        ) : (
          <div className="w-full h-full bg-slate-800" />
        )}
        
        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/0 via-slate-900/10 to-slate-900/80 pointer-events-none" />

        {/* Scanning Line Animation */}
        <div className="scan-line" />
        
        {/* Grid Overlay for "Tech" feel */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.1)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

        {/* Status Text Container */}
        <div className="absolute bottom-0 left-0 right-0 p-8 text-center">
           <div className="flex justify-center mb-4">
              <div className="relative">
                <div className="absolute inset-0 bg-indigo-500 blur-lg opacity-40 animate-pulse rounded-full"></div>
                <div className="bg-slate-900/90 backdrop-blur-md p-3 rounded-full border border-indigo-500/50 relative">
                   <Scan size={24} className="text-indigo-400 animate-pulse" />
                </div>
              </div>
           </div>
           <h3 className="text-xl font-bold text-white mb-1">{t.analyzing}</h3>
           <p className="text-sm text-indigo-300 animate-pulse">{t.identifying_sub}</p>
           
           {/* Show GPS indicator if location was found */}
           {hasGps && (
             <div className="mt-3 inline-flex items-center gap-1 bg-emerald-500/20 px-2 py-1 rounded-full border border-emerald-500/30">
               <MapPin size={10} className="text-emerald-400" />
               <span className="text-[10px] font-medium text-emerald-300">Location Found</span>
             </div>
           )}
        </div>
      </div>
    </div>
  );
};
