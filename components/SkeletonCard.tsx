import React from 'react';
import { Translation } from '../types';
import { MapPin } from 'lucide-react';

interface SkeletonCardProps {
  t: Translation;
  landmarkName?: string;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({ t, landmarkName }) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center p-0 sm:p-6 pointer-events-none">
      {/* Overlay Background Gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none" />

      {/* Card Content Skeleton */}
      <div className="relative pointer-events-auto w-full max-w-2xl mx-auto bg-slate-900/95 backdrop-blur-xl border-t sm:border border-slate-700/50 sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-pulse">
        
        {/* Header Image/Title Area Skeleton */}
        <div className="p-6 pb-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-indigo-400/50 mb-2">
                <MapPin size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">{t.landmarkLabel}</span>
              </div>
              
              {/* Title Skeleton - If we have the name, show it, otherwise show bar */}
              {landmarkName ? (
                 <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">{landmarkName}</h1>
              ) : (
                 <div className="h-8 w-3/4 bg-slate-700 rounded-lg mb-2"></div>
              )}
            </div>
            
            {/* Audio Button Skeleton */}
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-slate-700/50"></div>
          </div>
        </div>

        {/* Body Content Skeleton */}
        <div className="p-6 pt-6 space-y-6">
          
          {/* Paragraph Lines */}
          <div className="space-y-3">
            <div className="h-4 bg-slate-700/50 rounded w-full"></div>
            <div className="h-4 bg-slate-700/50 rounded w-11/12"></div>
            <div className="h-4 bg-slate-700/50 rounded w-full"></div>
            <div className="h-4 bg-slate-700/50 rounded w-4/5"></div>
            <div className="h-4 bg-slate-700/50 rounded w-5/6"></div>
          </div>

          {/* Source Box Skeleton */}
          <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
            <div className="h-3 w-32 bg-slate-700/50 rounded mb-3"></div>
            <div className="space-y-3">
               <div className="flex gap-3">
                  <div className="w-8 h-8 rounded bg-slate-700/50"></div>
                  <div className="flex-1 space-y-2">
                     <div className="h-3 w-3/4 bg-slate-700/50 rounded"></div>
                     <div className="h-2 w-1/2 bg-slate-700/30 rounded"></div>
                  </div>
               </div>
               <div className="flex gap-3">
                  <div className="w-8 h-8 rounded bg-slate-700/50"></div>
                  <div className="flex-1 space-y-2">
                     <div className="h-3 w-2/3 bg-slate-700/50 rounded"></div>
                     <div className="h-2 w-1/3 bg-slate-700/30 rounded"></div>
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* Footer Actions Skeleton */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex gap-3">
          <div className="flex-1 h-12 rounded-xl bg-slate-800"></div>
          <div className="flex-[2] h-12 rounded-xl bg-slate-800"></div>
        </div>
        
        {/* Loading Text Overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
           <div className="bg-slate-900/80 px-4 py-2 rounded-full backdrop-blur-md border border-slate-700/50">
              <p className="text-sm font-medium text-indigo-300">{t.fetching}</p>
           </div>
        </div>

      </div>
    </div>
  );
};