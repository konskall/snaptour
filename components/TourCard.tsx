import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Play, Pause, ExternalLink, MapPin, Sparkles, Loader2, Share2, Check, MessageCircle, Map as MapIcon, Compass, ChevronDown, ChevronUp, VolumeX } from 'lucide-react';
import { AnalysisResult, Translation, NearbyPlace } from '../types';
import { getNearbyPlaces, splitTextForTTS, generateAudioChunk } from '../services/geminiService';

interface TourCardProps {
  result: AnalysisResult;
  onReset: () => void;
  onChat: () => void;
  t: Translation;
  langCode?: string;
}

interface AudioSegment {
  text: string;
  buffer: AudioBuffer | null;
  status: 'pending' | 'loading' | 'ready' | 'error';
}

export const TourCard: React.FC<TourCardProps> = ({ result, onReset, onChat, t, langCode = 'en' }) => {
  // UI States
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isAudioUnavailable, setIsAudioUnavailable] = useState(false);
  
  // Data States
  const [segments, setSegments] = useState<AudioSegment[]>([]);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  
  // Misc UI
  const [justShared, setJustShared] = useState(false);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);

  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const isMountedRef = useRef(true);

  // --- INITIALIZATION ---

  useEffect(() => {
    isMountedRef.current = true;
    
    // 1. Initialize Segments
    // Use smaller chunks (e.g. 1-2 sentences) for faster perceived speed
    const textChunks = splitTextForTTS(result.detailedInfo);
    const initialSegments: AudioSegment[] = textChunks.map(chunk => ({
      text: chunk,
      buffer: null,
      status: 'pending'
    }));
    setSegments(initialSegments);
    
    // 2. Start Loading First Chunk Immediately
    if (initialSegments.length > 0) {
      loadSegment(0, initialSegments);
    } else {
      setIsAudioUnavailable(true);
    }

    // 3. Fetch Nearby Places
    const fetchNearby = async () => {
      setLoadingNearby(true);
      const places = await getNearbyPlaces(result.landmarkName, langCode);
      if (isMountedRef.current) {
        setNearbyPlaces(places);
        setLoadingNearby(false);
      }
    };
    fetchNearby();

    return () => {
      isMountedRef.current = false;
      stopAudio();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [result.landmarkName, langCode]);

  // --- AUDIO LOGIC ---

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  // Helper to load a specific segment
  const loadSegment = async (index: number, currentSegmentsState: AudioSegment[]) => {
    if (index >= currentSegmentsState.length) return;
    const segment = currentSegmentsState[index];
    
    // Skip if already loading or ready or error
    if (segment.status !== 'pending') return;

    // Update status to loading locally to prevent double-fetch
    setSegments(prev => {
        const newSegs = [...prev];
        if (newSegs[index]) newSegs[index].status = 'loading';
        return newSegs;
    });

    try {
      const buffer = await generateAudioChunk(segment.text);
      
      if (!isMountedRef.current) return;

      setSegments(prev => {
        const newSegments = [...prev];
        if (buffer) {
          newSegments[index] = { ...newSegments[index], buffer, status: 'ready' };
        } else {
          newSegments[index] = { ...newSegments[index], status: 'error' };
          // If the very first chunk fails, mark audio as unavailable
          if (index === 0) setIsAudioUnavailable(true);
        }
        return newSegments;
      });
    } catch (e) {
      console.error("Failed to load segment", index);
      setSegments(prev => {
          const newSegs = [...prev];
          if (newSegs[index]) newSegs[index].status = 'error';
          return newSegs;
      });
    }
  };

  // --- THE PLAYLIST CONTROLLER (UseEffect State Machine) ---
  // This effect watches `isPlaying` and `currentSegmentIndex`.
  // It ensures the correct segment plays, waits for loading, or moves to the next.
  useEffect(() => {
    if (!isPlaying) return; // Do nothing if paused

    // Check if finished
    if (currentSegmentIndex >= segments.length) {
      setIsPlaying(false);
      setCurrentSegmentIndex(0);
      pauseTimeRef.current = 0;
      return;
    }

    const segment = segments[currentSegmentIndex];

    // If already playing this segment physically, do nothing
    if (sourceNodeRef.current) return;

    if (segment.status === 'ready' && segment.buffer) {
      // --- READY TO PLAY ---
      setIsBuffering(false);
      
      const ctx = getAudioContext();
      // Note: We do NOT await resume() here to avoid race conditions. 
      // Context resumption is handled in toggleAudio handler.

      const source = ctx.createBufferSource();
      source.buffer = segment.buffer;
      source.connect(ctx.destination);
      
      // Handle offset (resume from pause)
      const offset = pauseTimeRef.current;
      source.start(0, offset);
      
      startTimeRef.current = ctx.currentTime - offset;
      sourceNodeRef.current = source;

      // PRELOAD NEXT SEGMENT
      if (currentSegmentIndex + 1 < segments.length) {
          loadSegment(currentSegmentIndex + 1, segments);
      }

      // Handle End of Segment
      source.onended = () => {
        sourceNodeRef.current = null;
        // Only advance if we are still "playing" state (not paused by user)
        // We check the ref inside the callback to be safe, but react state update will trigger re-run
        if (isMountedRef.current) {
           // Reset pause time for next segment
           pauseTimeRef.current = 0;
           // Move to next index -> This triggers the Effect again!
           setCurrentSegmentIndex(prev => prev + 1);
        }
      };

    } else if (segment.status === 'pending') {
      // --- NEED TO LOAD ---
      setIsBuffering(true);
      loadSegment(currentSegmentIndex, segments);
    } else if (segment.status === 'loading') {
      // --- WAITING FOR NETWORK ---
      setIsBuffering(true);
    } else if (segment.status === 'error') {
      // --- ERROR, SKIP ---
      setCurrentSegmentIndex(prev => prev + 1);
    }

  }, [isPlaying, currentSegmentIndex, segments]); // Re-run when these change

  const toggleAudio = async () => {
    if (isPlaying) {
      // PAUSE
      if (sourceNodeRef.current && audioContextRef.current) {
        // Important: Remove onended to prevent auto-advancing when we manually stop
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop();
        // Save position
        pauseTimeRef.current = audioContextRef.current.currentTime - startTimeRef.current;
        sourceNodeRef.current = null;
      }
      setIsPlaying(false);
      setIsBuffering(false);
    } else {
      // PLAY
      // Ensure context is running (required for iOS/Autoplay policies)
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch (e) {
          console.error("Failed to resume audio context", e);
        }
      }
      setIsPlaying(true);
    }
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.onended = null;
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
    setIsBuffering(false);
    pauseTimeRef.current = 0;
    setCurrentSegmentIndex(0);
  };

  const handleShare = async () => {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(result.landmarkName)}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: result.landmarkName,
          text: `Check out ${result.landmarkName} on Google Maps!`,
          url: mapsUrl,
        });
      } catch (err) { console.log('Error sharing', err); }
    } else {
      try {
        await navigator.clipboard.writeText(mapsUrl);
        setJustShared(true);
        setTimeout(() => setJustShared(false), 2000);
      } catch (err) { console.error('Failed to copy', err); }
    }
  };

  // Filter out unique links to avoid duplicates
  const uniqueSources = result.groundingSources.filter(
    (source, index, self) =>
      index === self.findIndex((s) => s.web?.uri === source.web?.uri)
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center p-0 pt-28 sm:p-6 pointer-events-none">
      {/* Overlay Background Gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none" />

      {/* Card Content */}
      <div className="relative pointer-events-auto w-full max-w-2xl mx-auto bg-slate-900/90 backdrop-blur-xl border-t sm:border border-slate-700/50 sm:rounded-3xl shadow-2xl overflow-hidden max-h-[85dvh] flex flex-col animate-slide-up">
        
        {/* Header Image/Title Area */}
        <div className="p-6 pb-2 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-indigo-400 mb-1">
                <MapPin size={16} />
                <span className="text-xs font-bold tracking-wider">{t.landmarkLabel}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">{result.landmarkName}</h1>
            </div>
            
            {/* Audio & Chat Controls */}
            <div className="flex gap-3">
              <button
                onClick={onChat}
                className="w-12 h-12 rounded-full bg-slate-700/80 hover:bg-slate-600 text-indigo-300 flex items-center justify-center border border-slate-600 transition-all hover:scale-105"
                title={t.askGuide}
              >
                <MessageCircle size={20} />
              </button>

              <div className="flex-shrink-0 w-12 h-12">
                {isBuffering || (segments.length === 0 && !isAudioUnavailable) ? (
                   <div className="w-12 h-12 rounded-full bg-indigo-600/50 border border-indigo-500/50 flex items-center justify-center">
                     <Loader2 size={20} className="text-indigo-200 animate-spin" />
                   </div>
                ) : isAudioUnavailable ? (
                   <div className="w-12 h-12 rounded-full bg-slate-800 border border-red-900/50 flex items-center justify-center group relative cursor-help">
                     <VolumeX size={20} className="text-red-400" />
                     <div className="absolute top-full right-0 mt-2 w-32 bg-slate-900 text-white text-[10px] p-2 rounded-lg border border-slate-700 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center">
                       {t.audioLimit}
                     </div>
                   </div>
                ) : (
                  <button
                    onClick={toggleAudio}
                    className="w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/30 transition-all hover:scale-105"
                  >
                    {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 pt-2 overflow-y-auto custom-scrollbar space-y-6 flex-1 min-h-0">
          
          <div className="prose prose-invert prose-sm">
            <p className="text-slate-300 leading-relaxed text-base">
              {result.detailedInfo}
            </p>
          </div>

          <div className="space-y-2">
             <div className="flex items-center gap-2 text-indigo-400">
               <MapIcon size={14} />
               <span className="text-xs font-bold tracking-wider">{t.viewMap}</span>
             </div>
             <div className="w-full h-32 rounded-xl overflow-hidden border border-slate-700 bg-slate-800 relative group">
               <iframe 
                 width="100%" 
                 height="100%" 
                 frameBorder="0" 
                 style={{ border: 0 }}
                 src={`https://www.google.com/maps?q=${encodeURIComponent(result.landmarkName)}&output=embed`}
                 allowFullScreen
                 className="opacity-60 group-hover:opacity-100 transition-opacity"
               ></iframe>
               <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]" />
             </div>
          </div>

          {(loadingNearby || nearbyPlaces.length > 0) && (
            <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
               <h3 className="text-xs font-semibold text-slate-400 mb-3 flex items-center gap-2">
                 <Compass size={12} className="text-emerald-400" />
                 {t.nearbyTitle}
               </h3>
               {loadingNearby ? (
                 <Loader2 size={16} className="animate-spin text-slate-500" />
               ) : nearbyPlaces.length > 0 ? (
                 <div className="space-y-3">
                   {nearbyPlaces.map((place, idx) => (
                     <a
                       key={idx}
                       href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`}
                       target="_blank"
                       rel="noopener noreferrer"
                       className="flex flex-col p-2 -mx-2 rounded-lg hover:bg-slate-700/50 transition-colors group cursor-pointer"
                     >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-200 group-hover:text-indigo-300 transition-colors">
                            {place.name}
                          </span>
                          <ExternalLink size={12} className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <span className="text-xs text-slate-400 line-clamp-2">{place.description}</span>
                     </a>
                   ))}
                 </div>
               ) : (
                 <p className="text-xs text-slate-500 italic">No nearby places found.</p>
               )}
            </div>
          )}

          {uniqueSources.length > 0 && (
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
              <button 
                onClick={() => setIsSourcesOpen(!isSourcesOpen)}
                className="w-full p-4 flex items-center justify-between bg-slate-800/30 hover:bg-slate-800/50 transition-colors"
              >
                <h3 className="text-xs font-semibold text-slate-400 tracking-wider flex items-center gap-2">
                  <Sparkles size={12} className="text-amber-400" />
                  {t.verifiedSources}
                  <span className="bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded text-[10px] ml-1">
                    {uniqueSources.length}
                  </span>
                </h3>
                {isSourcesOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </button>
              
              {isSourcesOpen && (
                <div className="p-4 pt-0 space-y-2 animate-fade-in border-t border-slate-700/30 mt-2">
                  {uniqueSources.map((source, idx) => (
                    source.web && (
                      <a
                        key={idx}
                        href={source.web.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700/50 transition-colors group"
                      >
                        <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center text-slate-400 group-hover:text-indigo-400 transition-colors flex-shrink-0">
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
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-slate-800 bg-slate-900/50 backdrop-blur-sm flex gap-3 shrink-0">
           <button onClick={handleShare} className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors flex items-center justify-center gap-2 border border-slate-700">
            {justShared ? <Check size={18} className="text-green-400" /> : <Share2 size={18} />}
            <span>{justShared ? t.shareSuccess : t.share}</span>
          </button>
          <button onClick={onReset} className="flex-[2] py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25">
            {t.scanAnother}
          </button>
        </div>
      </div>
    </div>
  );
};
