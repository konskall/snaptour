import React, { useEffect, useState, useRef } from 'react';
import { Play, Pause, ExternalLink, MapPin, Sparkles, Loader2, Share2, Check } from 'lucide-react';
import { AnalysisResult, Translation } from '../types';

interface TourCardProps {
  result: AnalysisResult;
  onReset: () => void;
  t: Translation;
  isAudioLoading?: boolean;
}

export const TourCard: React.FC<TourCardProps> = ({ result, onReset, t, isAudioLoading = false }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [justShared, setJustShared] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);

  // Initialize audio context lazily
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  const playAudio = async () => {
    if (!result.audioBuffer) return;
    
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Create a new source node
    const source = ctx.createBufferSource();
    source.buffer = result.audioBuffer;
    source.connect(ctx.destination);
    
    // Determine start time based on pause
    const offset = pauseTimeRef.current % result.audioBuffer.duration;
    source.start(0, offset);
    
    startTimeRef.current = ctx.currentTime - offset;
    sourceNodeRef.current = source;
    setIsPlaying(true);

    source.onended = () => {
       // Only reset if we naturally finished
       setIsPlaying(false);
       pauseTimeRef.current = 0;
    };
  };

  const pauseAudio = () => {
    if (sourceNodeRef.current && audioContextRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current.disconnect();
      pauseTimeRef.current = audioContextRef.current.currentTime - startTimeRef.current;
      sourceNodeRef.current = null;
      setIsPlaying(false);
    }
  };

  const toggleAudio = () => {
    if (isPlaying) {
      pauseAudio();
    } else {
      playAudio();
    }
  };

  const handleShare = async () => {
    // Generate Google Maps URL for the location
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(result.landmarkName)}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: result.landmarkName,
          text: `Check out ${result.landmarkName} on Google Maps!`,
          url: mapsUrl,
        });
      } catch (err) {
        console.log('Error sharing', err);
      }
    } else {
      // Fallback to clipboard - Copy the URL
      try {
        await navigator.clipboard.writeText(mapsUrl);
        setJustShared(true);
        setTimeout(() => setJustShared(false), 2000);
      } catch (err) {
        console.error('Failed to copy', err);
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sourceNodeRef.current) {
        sourceNodeRef.current.stop();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Filter out unique links to avoid duplicates
  const uniqueSources = result.groundingSources.filter(
    (source, index, self) =>
      index === self.findIndex((s) => s.web?.uri === source.web?.uri)
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center p-0 sm:p-6 pointer-events-none">
      {/* Overlay Background Gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none" />

      {/* Card Content */}
      <div className="relative pointer-events-auto w-full max-w-2xl mx-auto bg-slate-900/90 backdrop-blur-xl border-t sm:border border-slate-700/50 sm:rounded-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col animate-slide-up">
        
        {/* Header Image/Title Area */}
        <div className="p-6 pb-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-indigo-400 mb-1">
                <MapPin size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">{t.landmarkLabel}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">{result.landmarkName}</h1>
            </div>
            
            {/* Audio Control Button */}
            <div className="flex-shrink-0 w-12 h-12">
              {isAudioLoading ? (
                 <div className="w-12 h-12 rounded-full bg-indigo-600/50 border border-indigo-500/50 flex items-center justify-center">
                   <Loader2 size={20} className="text-indigo-200 animate-spin" />
                 </div>
              ) : result.audioBuffer ? (
                <button
                  onClick={toggleAudio}
                  className="w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30 transition-all hover:scale-105"
                >
                  {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 pt-2 overflow-y-auto custom-scrollbar space-y-6">
          
          {/* Main Description */}
          <div className="prose prose-invert prose-sm">
            <p className="text-slate-300 leading-relaxed text-base">
              {result.detailedInfo}
            </p>
          </div>

          {/* Sources / Grounding */}
          {uniqueSources.length > 0 && (
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Sparkles size={12} className="text-amber-400" />
                {t.verifiedSources}
              </h3>
              <div className="space-y-2">
                {uniqueSources.map((source, idx) => (
                  source.web && (
                    <a
                      key={idx}
                      href={source.web.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700/50 transition-colors group"
                    >
                      <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center text-slate-400 group-hover:text-indigo-400 transition-colors">
                        <ExternalLink size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200 truncate group-hover:text-indigo-300 transition-colors">
                          {source.web.title}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{new URL(source.web.uri).hostname}</p>
                      </div>
                    </a>
                  )
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50 backdrop-blur-sm flex gap-3">
           <button
            onClick={handleShare}
            className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors flex items-center justify-center gap-2 border border-slate-700"
          >
            {justShared ? <Check size={18} className="text-green-400" /> : <Share2 size={18} />}
            <span>{justShared ? t.shareSuccess : t.share}</span>
          </button>
          
          <button
            onClick={onReset}
            className="flex-[2] py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25"
          >
            {t.scanAnother}
          </button>
        </div>
      </div>
    </div>
  );
};