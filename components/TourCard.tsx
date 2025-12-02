import React, { useEffect, useState, useRef } from 'react';
import { Play, Pause, ExternalLink, MapPin, Sparkles, Loader2, Share2, Check, MessageCircle, Map as MapIcon, Compass, ChevronDown, ChevronUp, Volume2 } from 'lucide-react';
import { AnalysisResult, Translation, NearbyPlace } from '../types';
import { getNearbyPlaces } from '../services/geminiService';

interface TourCardProps {
  result: AnalysisResult;
  onReset: () => void;
  onChat: () => void;
  onGenerateAudio: () => void;
  t: Translation;
  isAudioLoading?: boolean;
  isAudioUnavailable?: boolean;
  langCode?: string;
}

export const TourCard: React.FC<TourCardProps> = ({ result, onReset, onChat, onGenerateAudio, t, isAudioLoading = false, isAudioUnavailable = false, langCode = 'en' }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [justShared, setJustShared] = useState(false);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false); 
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  
  // LOCK: Prevents rapid clicking from creating overlapping audio streams
  const isAudioOpInProgress = useRef<boolean>(false);

  // Native TTS Ref to prevent garbage collection and allow pause/resume
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Initialize audio context lazily
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      // Use webkitAudioContext for older iOS support if needed, though window.AudioContext is standard now
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  // iOS HELPER: "Warm up" the audio context with a silent buffer
  // This forces iOS Safari to unlock the audio thread during a direct user interaction
  const unlockAudioContext = () => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(e => console.warn("Audio resume failed", e));
    }
    
    // Play a tiny silent buffer. This tells iOS "we are playing audio now"
    // and keeps the context alive during the async API fetch.
    try {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        // We don't need to keep a reference to this source, it's just a key to unlock the door
    } catch (e) {
        console.warn("Audio unlock failed", e);
    }
  };

  useEffect(() => {
    // Fetch nearby places when card loads
    const fetchNearby = async () => {
      setLoadingNearby(true);
      const places = await getNearbyPlaces(result.landmarkName, langCode);
      setNearbyPlaces(places);
      setLoadingNearby(false);
    };
    fetchNearby();
  }, [result.landmarkName, langCode]);

  // --- NATIVE TTS LOGIC ---

  const speakNative = () => {
     if (!result.detailedInfo) return;

     if (window.speechSynthesis.paused && window.speechSynthesis.speaking) {
         window.speechSynthesis.resume();
         setIsPlaying(true);
         return;
     }

     window.speechSynthesis.cancel(); 
     
     const utterance = new SpeechSynthesisUtterance(result.detailedInfo);
     utteranceRef.current = utterance;

     utterance.rate = 0.9; 
     utterance.pitch = 1.0;

     const setVoiceAndSpeak = () => {
         const voices = window.speechSynthesis.getVoices();
         const voice = voices.find(v => v.lang.startsWith(langCode)) || voices.find(v => v.lang.includes(langCode));
         if (voice) {
            utterance.voice = voice;
         }
         
         utterance.onend = () => {
             setIsPlaying(false);
             utteranceRef.current = null;
         };
         
         utterance.onerror = (e) => {
             console.error("TTS Error", e);
             setIsPlaying(false);
             utteranceRef.current = null;
         };

         utterance.onstart = () => {
             setIsPlaying(true);
         };

         window.speechSynthesis.speak(utterance);
     };

     if (window.speechSynthesis.getVoices().length === 0) {
         window.speechSynthesis.onvoiceschanged = () => {
             window.speechSynthesis.onvoiceschanged = null;
             setVoiceAndSpeak();
         };
     } else {
         setVoiceAndSpeak();
     }
     
     setIsPlaying(true);
  };

  const pauseNative = () => {
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        setIsPlaying(false);
    }
  };

  // --- AI AUDIO LOGIC (STRICT CLEANUP) ---

  // Helper: Aggressively stop and disconnect the current source
  const stopAiAudio = () => {
    if (sourceNodeRef.current) {
        const source = sourceNodeRef.current;
        // 1. Remove listener to prevent triggering "onended" logic which might reset state incorrectly
        source.onended = null;
        
        // 2. Try stopping
        try {
            source.stop();
        } catch (e) {
            // Ignore errors if already stopped/not started
        }
        
        // 3. Disconnect
        try {
            source.disconnect();
        } catch (e) {}
        
        // 4. Nullify reference
        sourceNodeRef.current = null;
    }
  };

  const playAudio = async () => {
    if (!result.audioBuffer) return;
    
    // GUARD: If an operation is already in progress, ignore this click
    if (isAudioOpInProgress.current) return;
    isAudioOpInProgress.current = true;

    try {
        // STEP 1: Nuclear cleanup of any existing audio
        stopAiAudio();

        const ctx = getAudioContext();
        
        // Ensure context is running (Critical for iOS)
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        // STEP 2: Create new source
        const source = ctx.createBufferSource();
        source.buffer = result.audioBuffer;
        source.connect(ctx.destination);
        
        // STEP 3: Calculate offset
        const offset = pauseTimeRef.current % result.audioBuffer.duration;
        
        // STEP 4: Start
        source.start(0, offset);
        
        // STEP 5: Update References
        startTimeRef.current = ctx.currentTime - offset;
        sourceNodeRef.current = source;
        setIsPlaying(true);

        // STEP 6: Handle natural finish
        source.onended = () => {
           setIsPlaying(false);
           pauseTimeRef.current = 0;
           sourceNodeRef.current = null;
        };

    } catch (error) {
        console.error("Audio Playback Error:", error);
        setIsPlaying(false);
    } finally {
        // Release lock
        isAudioOpInProgress.current = false;
    }
  };

  const pauseAudio = () => {
    // GUARD: If an operation is already in progress, ignore
    if (isAudioOpInProgress.current) return;
    
    if (sourceNodeRef.current && audioContextRef.current) {
       // Capture current time BEFORE stopping
       pauseTimeRef.current = audioContextRef.current.currentTime - startTimeRef.current;
       
       // Stop audio
       stopAiAudio();
       setIsPlaying(false);
    }
  };

  // --- CONTROLLER ---

  const handleAudioClick = async () => {
    if (isAudioLoading) return;

    // CRITICAL FIX FOR IOS:
    // We must "unlock" the AudioContext immediately inside the click handler.
    // Even if we are going to wait for the API, the context must be resumed NOW.
    if (!result.nativeTTSFallback) {
        unlockAudioContext();
    }

    // Handle Native TTS logic
    if (result.nativeTTSFallback) {
        if (isPlaying) {
            pauseNative();
        } else {
            speakNative();
        }
        return;
    }

    // Handle AI Audio logic
    if (result.audioBuffer) {
        if (isPlaying) {
            pauseAudio();
        } else {
            playAudio();
        }
        return;
    }

    // Generate if nothing exists
    onGenerateAudio();
  };

  // AUTO-PLAY LOGIC
  useEffect(() => {
    if (isAudioLoading) return;

    // AI Audio Auto-play
    // We strictly check lock and references to avoid double-play
    if (result.audioBuffer && !isPlaying && !sourceNodeRef.current && !isAudioOpInProgress.current) {
       // NOTE: Auto-play might fail on iOS if the "unlock" didn't work, 
       // but handleAudioClick has already pre-warmed the context, so it should succeed.
       playAudio();
    } 
  }, [result.audioBuffer, isAudioLoading]);

  // Clean up on unmount or when result changes
  useEffect(() => {
    return () => {
      stopAiAudio();
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
    };
  }, []);

  // When result changes (new scan), stop everything and reset
  useEffect(() => {
      setIsPlaying(false);
      pauseTimeRef.current = 0;
      stopAiAudio();
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
  }, [result.landmarkName]);


  const handleShare = async () => {
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
      try {
        await navigator.clipboard.writeText(mapsUrl);
        setJustShared(true);
        setTimeout(() => setJustShared(false), 2000);
      } catch (err) {
        console.error('Failed to copy', err);
      }
    }
  };

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
                {isAudioLoading ? (
                   <div className="w-12 h-12 rounded-full bg-indigo-600/50 border border-indigo-500/50 flex items-center justify-center">
                     <Loader2 size={20} className="text-indigo-200 animate-spin" />
                   </div>
                ) : (
                  <button
                    onClick={handleAudioClick}
                    className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-105 ${
                        result.nativeTTSFallback 
                            ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-500/30' 
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/30'
                    }`}
                  >
                    {result.nativeTTSFallback ? (
                        isPlaying ? <Pause size={20} fill="currentColor" /> : <Volume2 size={20} className="ml-0.5" />
                    ) : result.audioBuffer ? (
                        isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />
                    ) : (
                        <Play size={20} fill="currentColor" className="ml-1 opacity-70" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 pt-2 overflow-y-auto custom-scrollbar space-y-6 flex-1 min-h-0">
          
          {/* Main Description */}
          <div className="prose prose-invert prose-sm">
            <p className="text-slate-300 leading-relaxed text-base">
              {result.detailedInfo}
            </p>
          </div>

          {/* Mini-Map */}
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

          {/* Nearby Places */}
          {(loadingNearby || nearbyPlaces.length > 0) && (
            <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
               {/* Removed 'uppercase' class to respect lowercase request */}
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

          {/* Sources / Grounding - COLLAPSIBLE DROPDOWN */}
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
                {isSourcesOpen ? (
                  <ChevronUp size={16} className="text-slate-400" />
                ) : (
                  <ChevronDown size={16} className="text-slate-400" />
                )}
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
        <div className="p-4 pb-8 sm:pb-4 border-t border-slate-800 bg-slate-900/50 backdrop-blur-sm flex gap-3 shrink-0">
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
