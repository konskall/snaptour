import React, { useEffect, useState, useRef } from 'react';
import { Pause, ExternalLink, MapPin, Sparkles, Loader2, Share2, Check, MessageCircle, Map as MapIcon, Compass, ChevronDown, ChevronUp, Volume2, LocateFixed, SlidersHorizontal, Clock, Ticket, Tag, Sun, Globe, Navigation } from 'lucide-react';
import { AnalysisResult, Translation, NearbyPlace } from '../types';
import { getNearbyPlaces } from '../services/geminiService';
import { getDeviceLocation } from '../services/locationUtils';
import { haversineMeters, bearingDeg, cardinal8 } from '../services/geoUtils';

interface TourCardProps {
  result: AnalysisResult;
  onReset: () => void;
  onChat: () => void;
  onGenerateAudio: () => void;
  t: Translation;
  isAudioLoading?: boolean;
  langCode?: string;
  langName: string;
  locatedByGps?: boolean;
}

export const TourCard: React.FC<TourCardProps> = ({ result, onReset, onChat, onGenerateAudio, t, isAudioLoading = false, langCode = 'en', langName, locatedByGps = false }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  // Which audio engine is active: the instant browser voice ('native', the default)
  // or the slower premium Gemini voice ('ai', opt-in via the HD button).
  const [activeEngine, setActiveEngine] = useState<'native' | 'ai' | null>(null);
  const [justShared, setJustShared] = useState(false);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);

  // Distance + direction to this landmark from the user's current position. We only
  // auto-locate when geolocation permission is ALREADY granted (no surprise prompt on
  // load); otherwise the user taps "Show distance". The "Directions" deep-link needs
  // only the landmark's own coordinates.
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'denied'>('idle');

  const requestDistance = async () => {
    setGeoState('loading');
    const c = await getDeviceLocation();
    if (c) { setUserCoords(c); setGeoState('idle'); }
    else setGeoState('denied');
  };

  const formatDistance = (m: number) => {
    if (m < 950) return `${Math.max(1, Math.round(m / 10) * 10)} ${t.unitM}`;
    const km = m / 1000;
    return `${km < 9.5 ? km.toFixed(1) : Math.round(km)} ${t.unitKm}`;
  };

  // Native-voice controls: playback speed + which installed voice to use. Persisted
  // so a traveler's preference sticks across landmarks/sessions. Affects only the
  // instant browser voice (the HD voice is a separate Gemini engine).
  const [rate, setRate] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem('snaptour_voice_rate') || ''); return v >= 0.5 && v <= 2 ? v : 0.95; }
    catch { return 0.95; }
  });
  const [voiceURI, setVoiceURI] = useState<string>(() => {
    try { return localStorage.getItem('snaptour_voice_uri') || ''; } catch { return ''; }
  });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  
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
      const places = await getNearbyPlaces(result.landmarkName, langName);
      setNearbyPlaces(places);
      setLoadingNearby(false);
    };
    fetchNearby();
  }, [result.landmarkName, langName]);

  // Load installed system voices (populated asynchronously on some browsers) and
  // persist the user's voice/speed preferences.
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices?.() || []);
    load();
    window.speechSynthesis?.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load);
  }, []);
  useEffect(() => { try { localStorage.setItem('snaptour_voice_rate', String(rate)); } catch { /* ignore */ } }, [rate]);
  useEffect(() => { try { localStorage.setItem('snaptour_voice_uri', voiceURI); } catch { /* ignore */ } }, [voiceURI]);

  // Voices offered in the picker: those matching the current UI language, or all if none match.
  const langVoices = voices.filter(v => v.lang?.toLowerCase().startsWith(langCode.toLowerCase()));
  const voiceOptions = langVoices.length ? langVoices : voices;

  // --- NATIVE TTS LOGIC ---

  // Optional rate/voice overrides let a setting change restart playback immediately
  // with the new value (React state may not have flushed yet at call time).
  const speakNative = (rateArg = rate, voiceArg = voiceURI) => {
     if (!result.detailedInfo) return;

     if (window.speechSynthesis.paused && window.speechSynthesis.speaking) {
         window.speechSynthesis.resume();
         setIsPlaying(true);
         return;
     }

     window.speechSynthesis.cancel();

     const utterance = new SpeechSynthesisUtterance(result.detailedInfo);
     utteranceRef.current = utterance;

     utterance.rate = rateArg;
     utterance.pitch = 1.0;

     const setVoiceAndSpeak = () => {
         const all = window.speechSynthesis.getVoices();
         const voice = (voiceArg && all.find(v => v.voiceURI === voiceArg))
            || all.find(v => v.lang.startsWith(langCode)) || all.find(v => v.lang.includes(langCode));
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
         const h = () => {
             window.speechSynthesis.removeEventListener('voiceschanged', h);
             setVoiceAndSpeak();
         };
         window.speechSynthesis.addEventListener('voiceschanged', h);
     } else {
         setVoiceAndSpeak();
     }
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

  // PRIMARY control: the instant browser (native) voice — no network, no quota,
  // starts speaking immediately.
  const handleNativePlay = () => {
    // If the premium voice is currently playing, stop it first.
    if (activeEngine === 'ai') {
      stopAiAudio();
      pauseTimeRef.current = 0;
      setIsPlaying(false);
    }
    if (isPlaying && activeEngine === 'native') {
      pauseNative();
    } else {
      setActiveEngine('native');
      speakNative();
    }
  };

  // Apply a speed / voice change. If the native voice is mid-sentence, restart it
  // immediately with the new setting (SpeechSynthesis can't retune a live utterance).
  const changeRate = (r: number) => {
    setRate(r);
    if (activeEngine === 'native' && isPlaying) { window.speechSynthesis.cancel(); speakNative(r, voiceURI); }
  };
  const changeVoice = (uri: string) => {
    setVoiceURI(uri);
    if (activeEngine === 'native' && isPlaying) { window.speechSynthesis.cancel(); speakNative(rate, uri); }
  };

  // SECONDARY control: the premium Gemini "HD" voice (slower + limited daily quota).
  // Generates on first use, then plays/pauses the cached buffer.
  const handleAiPlay = () => {
    if (isAudioLoading) return;
    // Stop the native voice if it's speaking.
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    if (activeEngine === 'native') setIsPlaying(false);
    // iOS: unlock the AudioContext inside the user gesture before any async wait.
    unlockAudioContext();

    if (result.audioBuffer) {
      if (isPlaying && activeEngine === 'ai') {
        pauseAudio();
      } else {
        setActiveEngine('ai');
        playAudio();
      }
    } else {
      // No buffer yet → generate; the auto-play effect plays it once ready.
      setActiveEngine('ai');
      onGenerateAudio();
    }
  };

  // AUTO-PLAY LOGIC
  useEffect(() => {
    if (isAudioLoading) return;

    // AI Audio Auto-play
    // We strictly check lock and references to avoid double-play
    if (result.audioBuffer && !isPlaying && !sourceNodeRef.current && !isAudioOpInProgress.current) {
       // NOTE: Auto-play might fail on iOS if the "unlock" didn't work,
       // but handleAiPlay has already pre-warmed the context, so it should succeed.
       setActiveEngine('ai');
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
      setActiveEngine(null);
      pauseTimeRef.current = 0;
      stopAiAudio();
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
  }, [result.landmarkName]);

  // Reset distance state per landmark, then silently fetch it ONLY if geolocation
  // permission was already granted (so we never trigger a permission prompt on load).
  useEffect(() => {
    setUserCoords(null);
    setGeoState('idle');
    if (result.meta?.lat == null || result.meta?.lng == null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions.query({ name: 'geolocation' as PermissionName })
      .then(async (status) => {
        if (cancelled || status.state !== 'granted') return;
        setGeoState('loading');
        const c = await getDeviceLocation();
        if (cancelled) return;
        if (c) { setUserCoords(c); setGeoState('idle'); } else setGeoState('denied');
      })
      .catch(() => { /* permissions API unavailable → leave idle (tap to reveal) */ });
    return () => { cancelled = true; };
  }, [result.landmarkName, result.meta?.lat, result.meta?.lng]);


  const handleShare = async () => {
    // Share the SnapTour app URL (not a Maps link) so the rich link preview shows
    // the SnapTour branding/icon from the site's Open Graph tags (og:image). The
    // ?l= deep link makes the recipient's app open this landmark directly; the query
    // string is ignored by the static host, so the OG preview is unaffected.
    const base = `${window.location.origin}${window.location.pathname}`;
    const shareUrl = `${base}?l=${encodeURIComponent(result.landmarkName)}`;
    const text = t.shareText.replace('{name}', result.landmarkName);

    if (navigator.share) {
      try {
        await navigator.share({
          title: result.landmarkName,
          text,
          url: shareUrl,
        });
      } catch (err) {
        console.log('Error sharing', err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${text} ${shareUrl}`);
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
          {/* Caption — own full-width row so the location icon + label always stay
              inline (never orphaned onto a second line) and use the whole card width. */}
          <div className="flex items-center gap-2 text-indigo-400 mb-1.5 min-w-0">
            <MapPin size={16} className="shrink-0" />
            <span className="text-xs font-bold tracking-wider truncate">{t.landmarkLabel}</span>
            {locatedByGps && (
              <span
                title="Identified using your location"
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5 shrink-0"
              >
                <LocateFixed size={11} />
                GPS
              </span>
            )}
          </div>

          {/* Title — own full-width row so long names wrap minimally. */}
          <h2 id="tour-title" className="text-xl sm:text-3xl font-bold text-white leading-tight break-words">{result.landmarkName}</h2>

          {/* Audio & Chat controls — a primary full-width "Listen" action (the instant
              native voice) plus secondary icon buttons, so the row fills the width with
              no wasted space on small screens. */}
          <div className="flex items-center gap-2 mt-3">
              {/* PRIMARY: instant browser (native) voice — fills remaining width */}
              <button
                onClick={handleNativePlay}
                aria-label={isPlaying && activeEngine === 'native' ? t.pause : t.listen}
                aria-pressed={isPlaying && activeEngine === 'native'}
                className="flex-1 min-w-0 h-12 rounded-full flex items-center justify-center gap-2 font-semibold shadow-lg transition-all hover:scale-[1.02] bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/30"
              >
                {isPlaying && activeEngine === 'native'
                  ? <Pause size={20} fill="currentColor" className="shrink-0" />
                  : <Volume2 size={20} className="shrink-0" />}
                <span className="truncate">{isPlaying && activeEngine === 'native' ? t.pause : t.listen}</span>
              </button>

              {/* Ask the guide */}
              <button
                onClick={onChat}
                className="flex-shrink-0 w-12 h-12 rounded-full bg-slate-700/80 hover:bg-slate-600 text-indigo-300 flex items-center justify-center border border-slate-600 transition-all hover:scale-105"
                title={t.askGuide}
                aria-label={t.askGuide}
              >
                <MessageCircle size={20} />
              </button>

              {/* SECONDARY: premium Gemini HD voice (opt-in, limited quota) */}
              <button
                onClick={handleAiPlay}
                disabled={isAudioLoading}
                aria-label={isAudioLoading ? 'Loading HD voice' : (isPlaying && activeEngine === 'ai' ? 'Pause HD voice' : 'HD voice')}
                aria-pressed={isPlaying && activeEngine === 'ai'}
                title="HD voice (AI)"
                className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center border transition-all hover:scale-105 relative disabled:cursor-default ${
                  activeEngine === 'ai'
                    ? 'bg-purple-600 hover:bg-purple-500 text-white border-purple-400 shadow-lg shadow-purple-500/30'
                    : 'bg-slate-700/80 hover:bg-slate-600 text-purple-300 border-slate-600'
                }`}
              >
                {isAudioLoading
                  ? <Loader2 size={18} className="animate-spin" />
                  : (isPlaying && activeEngine === 'ai'
                      ? <Pause size={18} fill="currentColor" />
                      : <Sparkles size={18} />)}
                <span className="absolute -bottom-0.5 -right-0.5 text-[8px] font-bold bg-slate-900 text-slate-200 rounded px-0.5 leading-tight border border-slate-700">HD</span>
              </button>

              {/* Voice & speed settings (affects the standard browser voice) */}
              <button
                onClick={() => setShowVoiceMenu(v => !v)}
                aria-label={t.voiceLabel}
                aria-expanded={showVoiceMenu}
                title={t.voiceLabel}
                className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center border transition-all hover:scale-105 ${
                  showVoiceMenu
                    ? 'bg-slate-600 text-white border-slate-500'
                    : 'bg-slate-700/80 hover:bg-slate-600 text-slate-300 border-slate-600'
                }`}
              >
                <SlidersHorizontal size={18} />
              </button>
          </div>

          {/* Voice & speed panel — collapsible, applies to the standard (native) voice.
              mt-3 keeps clear separation from the controls row (it was flush before). */}
          {showVoiceMenu && (
            <div className="mt-3 mb-2 rounded-xl border border-slate-700 bg-slate-800/80 p-3 space-y-3 animate-fade-in shadow-lg">
              <div className="flex items-center gap-2 text-slate-300">
                <SlidersHorizontal size={13} className="text-indigo-400" />
                <span className="text-xs font-semibold tracking-wide">{t.voiceLabel}</span>
              </div>
              {/* Speed */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-16 shrink-0">{t.speedLabel}</span>
                <div className="flex gap-1.5 flex-wrap">
                  {[0.75, 1, 1.25, 1.5].map((r) => (
                    <button
                      key={r}
                      onClick={() => changeRate(r)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                        Math.abs(rate - r) < 0.01
                          ? 'bg-indigo-600 text-white border-indigo-500'
                          : 'bg-slate-700/60 text-slate-300 border-slate-600 hover:bg-slate-700'
                      }`}
                    >
                      {r}×
                    </button>
                  ))}
                </div>
              </div>
              {/* Voice picker */}
              {voiceOptions.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 flex items-center text-slate-400" aria-hidden="true"><Volume2 size={14} /></span>
                  <select
                    value={voiceURI}
                    onChange={(e) => changeVoice(e.target.value)}
                    aria-label={t.voiceLabel}
                    className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">{t.voiceDefault}</option>
                    {voiceOptions.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="p-6 pt-2 overflow-y-auto custom-scrollbar space-y-6 flex-1 min-h-0">
          
          {/* Main Description */}
          <div className="prose prose-invert prose-sm">
            <p className="text-slate-300 leading-relaxed text-base">
              {result.detailedInfo}
            </p>
          </div>

          {/* Useful info — structured practical facts (hours, ticket, best time, site).
              Each row renders only when the model returned a value for it. */}
          {(() => {
            const m = result.meta;
            if (!m) return null;
            const location = [m.city, m.country].map(s => (s || '').trim()).filter(Boolean).join(', ');
            const rows: { icon: React.ReactNode; label: string; value: React.ReactNode }[] = [];
            if (location) rows.push({
              icon: <MapPin size={15} />,
              label: t.infoLocation,
              value: (
                <span className="inline-flex items-center gap-1.5">
                  {m.countryCode && (
                    <img
                      src={`https://cdn.jsdelivr.net/gh/HatScripts/circle-flags/flags/${m.countryCode}.svg`}
                      alt="" width={14} height={14} loading="lazy" decoding="async"
                      className="w-3.5 h-3.5 rounded-full ring-1 ring-white/10"
                    />
                  )}
                  {location}
                </span>
              ),
            });
            if (m.category) rows.push({ icon: <Tag size={15} />, label: t.infoType, value: m.category });
            if (m.openingHours) rows.push({ icon: <Clock size={15} />, label: t.infoHours, value: m.openingHours });
            if (m.ticket) rows.push({ icon: <Ticket size={15} />, label: t.infoTicket, value: m.ticket });
            if (m.bestTime) rows.push({ icon: <Sun size={15} />, label: t.infoBestTime, value: m.bestTime });
            if (m.website) {
              let host = m.website;
              try { host = new URL(m.website).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
              rows.push({
                icon: <Globe size={15} />,
                label: t.infoWebsite,
                value: (
                  <a href={m.website} target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-indigo-200 underline decoration-indigo-400/40 underline-offset-2 break-all">
                    {host}
                  </a>
                ),
              });
            }
            if (rows.length === 0) return null;
            return (
              <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
                <h3 className="text-xs font-semibold text-slate-400 mb-3 flex items-center gap-2">
                  <Sparkles size={12} className="text-amber-400" />
                  {t.usefulInfo}
                </h3>
                <dl className="space-y-2.5">
                  {rows.map((row, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-indigo-400 mt-0.5 shrink-0">{row.icon}</span>
                      <dt className="text-xs text-slate-500 w-20 shrink-0 pt-0.5">{row.label}</dt>
                      <dd className="text-sm text-slate-200 flex-1 min-w-0">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })()}

          {/* Distance + direction to here, and a Directions deep-link. Shown whenever we
              know the landmark's coordinates. Distance/direction appear once we have the
              user's location (granted silently or via the "Show distance" tap). */}
          {(() => {
            const lat = result.meta?.lat, lng = result.meta?.lng;
            if (lat == null || lng == null) return null;
            const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
            let distEl: React.ReactNode;
            if (userCoords) {
              const m = haversineMeters(userCoords, { lat, lng });
              const dir = t.compass8[cardinal8(bearingDeg(userCoords, { lat, lng }))];
              distEl = (
                <span className="text-slate-200">
                  <span className="font-semibold">{formatDistance(m)}</span>
                  <span className="text-slate-400"> · {dir}</span>
                </span>
              );
            } else if (geoState === 'loading') {
              distEl = <span className="text-slate-400 inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" />…</span>;
            } else if (geoState === 'denied') {
              distEl = <span className="text-slate-500 text-xs">{t.distanceUnavailable}</span>;
            } else {
              distEl = (
                <button onClick={requestDistance} className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2 decoration-indigo-400/40">
                  {t.showDistance}
                </button>
              );
            }
            return (
              <div className="flex items-center justify-between gap-3 bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
                <div className="min-w-0 flex items-center gap-2 text-sm">
                  <Compass size={16} className="text-emerald-400 shrink-0" />
                  {distEl}
                </div>
                <a
                  href={dirUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
                >
                  <Navigation size={15} />
                  {t.directions}
                </a>
              </div>
            );
          })()}

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
                 title={`${t.viewMap}: ${result.landmarkName}`}
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
                aria-expanded={isSourcesOpen}
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

        {/* Footer Actions — solid app colour (not translucent) so the bottom edge that
            Safari tints its toolbar from is the app colour, never black. */}
        <div className="p-4 pb-safe-sheet border-t border-slate-800 bg-slate-900 flex gap-2.5 shrink-0">
           <button onClick={handleShare} className="flex-1 py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-colors flex items-center justify-center gap-2 border border-slate-700">
            {justShared ? <Check size={16} className="text-green-400" /> : <Share2 size={16} />}
            <span>{justShared ? t.shareSuccess : t.share}</span>
          </button>
          <button onClick={onReset} className="flex-[2] py-2.5 px-4 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 shadow-md shadow-indigo-500/20">
            {t.scanAnother}
          </button>
        </div>
      </div>
    </div>
  );
};
