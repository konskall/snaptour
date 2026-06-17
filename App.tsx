import React, { useState, useEffect, useRef } from 'react';
import { PhotoInput } from './components/PhotoInput';
import { TourCard } from './components/TourCard';
import { LandmarkSelector } from './components/LandmarkSelector';
import { HistoryView } from './components/HistoryView';
import { ScanningView } from './components/ScanningView';
import { SkeletonCard } from './components/SkeletonCard';
import { ChatView } from './components/ChatView';
import { identifyLandmarkFromImage, getLandmarkDetails, generateNarrationAudio } from './services/geminiService';
import { saveHistoryItem, getHistory, createThumbnail, clearHistory, deleteHistoryItem, migrateLocalHistory } from './services/storageService';
import { auth, isFirebaseConfigured } from './services/firebase';
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { AppState, AnalysisResult, LandmarkIdentification, User, HistoryItem } from './types';
import { Loader2, Globe, History, UserCircle, LogOut, Zap, AlertTriangle, ExternalLink } from 'lucide-react';
import { Logo } from './components/Logo';
import { LANGUAGES, translations } from './translations';

const VIEW_KEY = 'snaptour_view';

// Restore the last meaningful view (history / result) across a page refresh,
// so reloading doesn't kick the user back to the home screen.
function loadPersistedView(): { state: AppState; result: AnalysisResult | null; selectedImage: string | null } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null');
    if (saved?.state === AppState.SHOWING_RESULT && saved.result) {
      return { state: AppState.SHOWING_RESULT, result: saved.result as AnalysisResult, selectedImage: saved.selectedImage ?? null };
    }
    if (saved?.state === AppState.VIEWING_HISTORY) {
      return { state: AppState.VIEWING_HISTORY, result: null, selectedImage: null };
    }
  } catch { /* ignore malformed/unavailable storage */ }
  return { state: AppState.IDLE, result: null, selectedImage: null };
}

// Temporary on-device diagnostics — visible only with ?debug in the URL.
// Renders a fixed bar at the very bottom of the visual viewport so we can see
// the real height numbers (and whether it reaches the screen bottom) on iOS.
const DebugViewport: React.FC = () => {
  const [info, setInfo] = useState('');
  useEffect(() => {
    const read = () => {
      const vv = window.visualViewport;
      const standalone = (window.navigator as any).standalone === true
        || window.matchMedia('(display-mode: standalone)').matches;
      const appH = getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim();
      setInfo(
        `inner=${window.innerHeight} screen=${window.screen.height} ` +
        `client=${document.documentElement.clientHeight} ` +
        `vv=${vv ? Math.round(vv.height) : 'n/a'} appH=${appH || '—'} ` +
        `standalone=${standalone} dpr=${window.devicePixelRatio}`
      );
    };
    read();
    window.addEventListener('resize', read);
    window.visualViewport?.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('resize', read);
    };
  }, []);
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
      background: 'rgba(220,0,0,0.92)', color: '#fff', fontSize: '11px',
      lineHeight: 1.3, padding: '6px 8px', textAlign: 'center',
      pointerEvents: 'none', fontFamily: 'monospace', wordBreak: 'break-all',
    }}>
      {info}
    </div>
  );
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(() => loadPersistedView().state);
  const [selectedImage, setSelectedImage] = useState<string | null>(() => loadPersistedView().selectedImage);
  const [identificationResult, setIdentificationResult] = useState<LandmarkIdentification | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(() => loadPersistedView().result);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [langCode, setLangCode] = useState<string>(() => {
    try { return localStorage.getItem('snaptour_lang') || 'en'; } catch { return 'en'; }
  });
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [missingCreds, setMissingCreds] = useState<string[]>([]);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  
  // User & History State
  const [user, setUser] = useState<User | null>(null);
  const [userHistory, setUserHistory] = useState<HistoryItem[]>([]);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  // Refs for click-outside detection
  const langMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  // Refs to the menu trigger buttons for focus restore on Escape
  const langBtnRef = useRef<HTMLButtonElement>(null);
  const userBtnRef = useRef<HTMLButtonElement>(null);
  // The overlay header floats above content; measure its real height (incl.
  // notch safe-area + any setup banner) so every view can offset clear of it.
  const headerRef = useRef<HTMLElement>(null);

  const t = translations[langCode] || translations['en'];
  const currentLangName = LANGUAGES.find(l => l.code === langCode)?.name || 'English';

  // Keep the document language in sync for a11y / correct hyphenation & voice selection,
  // and remember the choice across refreshes / sessions.
  useEffect(() => {
    document.documentElement.lang = langCode;
    try { localStorage.setItem('snaptour_lang', langCode); } catch { /* storage unavailable */ }
  }, [langCode]);

  // Persist the current view so a refresh restores history / a landmark result
  // instead of resetting to the home screen. Transient/loading states are not
  // persisted (their async work is gone after a reload).
  useEffect(() => {
    try {
      if ((state === AppState.SHOWING_RESULT || state === AppState.CHATTING) && result) {
        sessionStorage.setItem(VIEW_KEY, JSON.stringify({
          state: AppState.SHOWING_RESULT,
          result: { ...result, audioBuffer: null }, // AudioBuffer isn't serialisable; regenerated on demand
          selectedImage,
        }));
      } else if (state === AppState.VIEWING_HISTORY) {
        sessionStorage.setItem(VIEW_KEY, JSON.stringify({ state: AppState.VIEWING_HISTORY }));
      } else {
        sessionStorage.removeItem(VIEW_KEY);
      }
    } catch { /* sessionStorage unavailable / quota exceeded */ }
  }, [state, result, selectedImage]);

  // Publish the live header height to a CSS var so views (via .pt-header) clear it
  // exactly — accounts for the notch, the setup banner and late font reflow.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      const bottom = el.getBoundingClientRect().bottom;
      if (bottom > 0) root.style.setProperty('--header-h', `${Math.round(bottom)}px`);
    };
    update();
    // Re-measure after first paint and after web fonts settle, since either can
    // change the header height/position before the layout is final.
    const raf = requestAnimationFrame(update);
    (document as any).fonts?.ready?.then(update).catch(() => {});
    // The header has `transition-all`, so a banner toggling its `top` animates
    // over ~150ms — re-measure once that settles (plus a safety net).
    const settle = window.setTimeout(update, 300);
    el.addEventListener('transitionend', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      el.removeEventListener('transitionend', update);
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [isInAppBrowser, missingCreds.length]);

  useEffect(() => {
    const missing = [];
    if (!process.env.API_KEY) missing.push("API_KEY");
    if (!isFirebaseConfigured()) missing.push("FIREBASE_*");
    setMissingCreds(missing);
  }, []);

  // Detect In-App Browser (Specifically LinkedIn where Google Login fails)
  useEffect(() => {
    const ua = navigator.userAgent || navigator.vendor || (window as any).opera;
    // Regex to detect ONLY LinkedIn based on user feedback
    if (/(LinkedInApp)/i.test(ua)) {
      setIsInAppBrowser(true);
    }
  }, []);

  // Subscribe to Firebase auth state (handles session persistence + redirect return)
  useEffect(() => {
    if (!auth) return;
    getRedirectResult(auth).catch(err => console.error('Redirect sign-in failed', err));
    const unsub = onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
      if (fbUser) {
        const mapped: User = {
          uid: fbUser.uid,
          name: fbUser.displayName || 'Traveler',
          email: fbUser.email || '',
          picture: fbUser.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(fbUser.displayName || 'T')}&background=6366f1&color=fff`,
        };
        setUser(mapped);
        await migrateLocalHistory(mapped.uid, mapped.email);
        setUserHistory(await getHistory(mapped.uid));
      } else {
        setUser(null);
        setUserHistory([]);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setIsLangMenuOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Escape closes whichever dropdown menu is open and restores focus to its trigger
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isLangMenuOpen) {
        setIsLangMenuOpen(false);
        langBtnRef.current?.focus();
      }
      if (isUserMenuOpen) {
        setIsUserMenuOpen(false);
        userBtnRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLangMenuOpen, isUserMenuOpen]);

  const handleGoogleLogin = async () => {
    setIsUserMenuOpen(false);
    if (!auth || !isFirebaseConfigured()) {
      alert(t.signInNotConfigured);
      return;
    }
    const provider = new GoogleAuthProvider();
    // Always show the Google account chooser, so logout -> login can pick a different account
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      if (isInAppBrowser) {
        await signInWithRedirect(auth, provider); // popups blocked in in-app browsers
      } else {
        await signInWithPopup(auth, provider);    // onAuthStateChanged handles the rest
      }
    } catch (err) {
      console.error('Google sign-in failed', err);
      alert(t.signInFailed);
    }
  };

  const handleLogout = async () => {
    setIsUserMenuOpen(false);
    try { if (auth) await signOut(auth); } catch (e) { console.error('Sign-out failed', e); }
    // onAuthStateChanged clears user + history; reset the view if needed
    if (state === AppState.VIEWING_HISTORY) setState(AppState.IDLE);
  };

  const handleClearHistory = async () => {
    if (user) {
      await clearHistory(user.uid);
      setUserHistory([]);
    }
  };

  const handleDeleteHistoryItem = async (id: string) => {
    if (user) {
      setUserHistory(await deleteHistoryItem(user.uid, id));
    }
  };

  const handleGenerateAudio = async () => {
    if (!result || isGeneratingAudio) return;
    
    setIsGeneratingAudio(true);

    try {
      const audioBuffer = await generateNarrationAudio(result.detailedInfo);
      
      if (audioBuffer) {
        setResult(prev => prev ? { ...prev, audioBuffer, nativeTTSFallback: false } : null);
      } else {
        // AI failed silently (returned null), fallback to native
        console.warn("AI Audio failed, switching to Native TTS");
        setResult(prev => prev ? { ...prev, nativeTTSFallback: true } : null);
      }
    } catch (error) {
      console.warn("Audio generation API failed, switching to Native TTS:", error);
      // Fallback to Native TTS on any error (429, 503, etc.)
      setResult(prev => prev ? { ...prev, nativeTTSFallback: true } : null);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handleHistorySelect = async (item: HistoryItem) => {
    const textContent = item.detailedInfo || item.summary;
    setResult({
      landmarkName: item.landmarkName,
      detailedInfo: textContent,
      groundingSources: item.groundingSources || [],
      audioBuffer: null,
      nativeTTSFallback: false
    });
    setSelectedImage(`data:image/jpeg;base64,${item.thumbnail}`);
    setState(AppState.SHOWING_RESULT);

    // Reset Audio State - user must click play to generate
    setIsGeneratingAudio(false);
  };

  const handleImageSelect = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result as string;
      // Guard against an invalid / non-data-URL FileReader result
      if (typeof base64Data !== 'string' || !base64Data.startsWith('data:') || !base64Data.includes(',')) {
        setErrorMsg(t.error);
        setState(AppState.ERROR);
        return;
      }
      const base64Image = base64Data.split(',')[1];
      const mimeType = file.type;
      // Use a downscaled thumbnail for the on-screen background/state to avoid
      // holding a full-res image in React state; the original is sent to processTour.
      const thumb = await createThumbnail(base64Data);
      setSelectedImage(`data:image/jpeg;base64,${thumb}`);
      processTour(base64Image, mimeType, base64Data);
    };
    reader.onerror = () => {
      setErrorMsg(t.error);
      setState(AppState.ERROR);
    };
    reader.readAsDataURL(file);
  };

  const processTour = async (base64Image: string, mimeType: string, fullImageData: string) => {
    try {
      setState(AppState.ANALYZING_IMAGE);
      const idResult = await identifyLandmarkFromImage(base64Image, mimeType, currentLangName);
      setIdentificationResult(idResult);
      const CONFIDENCE_THRESHOLD = 0.8;
      if (idResult.confidence >= CONFIDENCE_THRESHOLD) {
        fetchDetails(idResult.name, fullImageData);
      } else {
        setState(AppState.SELECTING_LANDMARK);
      }
    } catch (error: any) {
      console.error(error);
      // Check for Rate Limit / Quota Exceeded
      if (error.message?.includes("429") || error.status === 429 || JSON.stringify(error).includes("RESOURCE_EXHAUSTED")) {
         setErrorMsg(t.quotaError);
      } else {
         setErrorMsg(t.error);
      }
      setState(AppState.ERROR);
    }
  };

  const fetchDetails = async (landmarkName: string, imageOverride?: string) => {
    try {
      setState(AppState.FETCHING_DETAILS);

      // Reset Audio State - user must click play to generate
      setIsGeneratingAudio(false);

      const { text: detailedInfo, sources } = await getLandmarkDetails(landmarkName, currentLangName);
      setResult({
        landmarkName,
        detailedInfo,
        groundingSources: sources,
        audioBuffer: null,
        nativeTTSFallback: false
      });
      setState(AppState.SHOWING_RESULT);

      const imageToSave = imageOverride || selectedImage;
      if (user && imageToSave) {
        const thumbnail = await createThumbnail(imageToSave);
        const historyItem: HistoryItem = {
           id: Date.now().toString(),
           timestamp: Date.now(),
           landmarkName: landmarkName,
           summary: detailedInfo.substring(0, 100) + "...",
           detailedInfo: detailedInfo, 
           groundingSources: sources, 
           thumbnail: thumbnail
        };
        setUserHistory(await saveHistoryItem(user.uid, historyItem));
      }
      
      // We do NOT automatically generate audio anymore to prevent hitting rate limits
      // Audio is generated on-demand when the user clicks Play

    } catch (error: any) {
      console.error(error);
      if (error.message?.includes("429") || error.status === 429 || JSON.stringify(error).includes("RESOURCE_EXHAUSTED")) {
         setErrorMsg(t.quotaError);
      } else {
         setErrorMsg(t.error);
      }
      setState(AppState.ERROR);
    }
  };

  const resetApp = () => {
    setState(AppState.IDLE);
    setSelectedImage(null);
    setResult(null);
    setIdentificationResult(null);
    setErrorMsg('');
    setIsGeneratingAudio(false);
  };

  const handleLanguageChange = (code: string) => {
    setLangCode(code);
    setIsLangMenuOpen(false);
  };

  const backgroundStyle = selectedImage ? {
    backgroundImage: `url(${selectedImage})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  } : {};

  // Find current language object
  const currentLang = LANGUAGES.find(l => l.code === langCode);

  return (
    <div className="relative w-full overflow-hidden bg-slate-900 text-white" style={{ ...backgroundStyle, height: 'var(--app-height, 100dvh)' }}>
      {new URLSearchParams(window.location.search).has('debug') && <DebugViewport />}
      {selectedImage && <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-all duration-1000" />}

      {/* In-App Browser Warning Banner */}
      {isInAppBrowser && (
        <div className="absolute top-0 left-0 right-0 bg-amber-600 text-white z-[110] px-4 py-3 flex items-center justify-center shadow-xl animate-slide-down" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
           <div className="flex items-center gap-3 text-center">
             <ExternalLink size={20} className="flex-shrink-0" />
             <span className="text-sm font-bold">
               {t.inAppBrowserWarning}
             </span>
           </div>
        </div>
      )}

      {missingCreds.length > 0 && !isInAppBrowser && (
        <div className="absolute top-0 left-0 right-0 bg-red-600 text-white z-[100] px-4 py-2 flex items-center justify-between shadow-xl" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
           <div className="flex items-center gap-2">
             <AlertTriangle size={18} className="fill-white text-red-600" />
             {/* Intentionally English-only: admin/deploy-time setup notice, never shown to end customers */}
             <span className="text-sm font-bold">
               Setup Required: Missing {missingCreds.join(" & ")}.
               Check GitHub Settings &rarr; Secrets.
             </span>
           </div>
           <button onClick={() => setMissingCreds([])} className="text-xs bg-red-800 hover:bg-red-700 px-2 py-1 rounded">{t.dismiss}</button>
        </div>
      )}

      <header
        ref={headerRef}
        className={`absolute ${isInAppBrowser ? 'top-16' : missingCreds.length > 0 ? 'top-10' : 'top-0'} left-0 right-0 p-6 z-40 flex items-center justify-between pointer-events-none transition-all`}
        style={{
          // Keep existing p-6 (1.5rem) baseline while honoring device safe-area insets
          paddingTop: 'calc(1.5rem + env(safe-area-inset-top))',
          paddingLeft: 'calc(1.5rem + env(safe-area-inset-left))',
          paddingRight: 'calc(1.5rem + env(safe-area-inset-right))',
        }}
      >
        {/* Brand */}
        <button
          type="button"
          onClick={resetApp}
          aria-label="Go to home"
          className="flex items-center gap-2 pointer-events-auto cursor-pointer group"
        >
          <div className="bg-black/20 backdrop-blur-md p-2 rounded-2xl border border-white/10 shadow-lg group-hover:bg-white/10 transition-colors">
             <Logo className="w-8 h-8 drop-shadow-lg" />
          </div>
          <h1 className="font-bold tracking-tight text-white text-xl drop-shadow-md">
            Snap<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">Tour</span>
          </h1>
        </button>

        <nav aria-label="Account and language" className="flex items-center gap-3 pointer-events-auto">
          {/* Language Selector */}
          <div className="relative" ref={langMenuRef}>
            <button
              ref={langBtnRef}
              onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
              aria-haspopup="menu"
              aria-expanded={isLangMenuOpen}
              aria-controls="lang-menu"
              className="flex items-center gap-2 bg-black/20 backdrop-blur-md px-3 py-2 rounded-full border border-white/10 hover:bg-white/10 transition-colors shadow-lg"
            >
              {currentLang && (
                <img
                  src={`https://cdn.jsdelivr.net/gh/HatScripts/circle-flags/flags/${currentLang.countryCode}.svg`}
                  alt={currentLang.name}
                  width={22}
                  height={22}
                  decoding="async"
                  className="w-[22px] h-[22px] rounded-full ring-1 ring-white/20"
                />
              )}
              {/* Show only Name, not Flag emoji since we use image now */}
              <span className="text-sm font-medium hidden sm:inline">
                {currentLang?.name || 'English'}
              </span>
            </button>

            {isLangMenuOpen && (
              <div id="lang-menu" role="menu" className="absolute right-0 top-full mt-2 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-50 animate-fade-in">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    role="menuitem"
                    onClick={() => handleLanguageChange(lang.code)}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-700 transition-colors flex items-center justify-between ${langCode === lang.code ? 'bg-slate-700/50 text-indigo-400' : 'text-slate-200'}`}
                  >
                    <div className="flex items-center">
                      <img
                        src={`https://cdn.jsdelivr.net/gh/HatScripts/circle-flags/flags/${lang.countryCode}.svg`}
                        alt={lang.name}
                        width={22}
                        height={22}
                        decoding="async"
                        className="w-[22px] h-[22px] rounded-full ring-1 ring-white/10 mr-3"
                      />
                      <span>{lang.label}</span>
                    </div>
                    {langCode === lang.code && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User / Login Button */}
          <div className="relative" ref={userMenuRef}>
            {!user ? (
              // NOT LOGGED IN - Show Google Button Directly
               <button
                 onClick={handleGoogleLogin}
                 aria-label={t.login}
                 title={t.login}
                 className="flex items-center justify-center bg-black/20 backdrop-blur-md p-2.5 rounded-full border border-white/10 hover:bg-white/10 transition-colors shadow-lg"
               >
                 <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                   <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                   <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                   <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                   <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                 </svg>
               </button>
            ) : (
                // LOGGED IN - Show Avatar & Menu
               <>
                 <button
                   ref={userBtnRef}
                   onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                   aria-haspopup="menu"
                   aria-expanded={isUserMenuOpen}
                   aria-controls="user-menu"
                   className="flex items-center gap-2 bg-black/20 backdrop-blur-md px-2 py-2 sm:px-3 sm:py-2 rounded-full border border-white/10 hover:bg-white/10 transition-colors shadow-lg"
                 >
                   <img src={user.picture} alt={user.name} className="w-5 h-5 rounded-full border border-white/20" />
                   <span className="text-sm font-medium hidden sm:inline max-w-[80px] truncate">{user.name}</span>
                 </button>

                 {isUserMenuOpen && (
                   <div id="user-menu" role="menu" className="absolute right-0 top-full mt-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-50 animate-fade-in">
                     <div className="px-4 py-3 border-b border-slate-700">
                       <p className="text-sm font-semibold text-white">{user.name}</p>
                       <p className="text-xs text-slate-400 truncate">{user.email}</p>
                     </div>
                     <button
                       role="menuitem"
                       onClick={() => {
                         setState(AppState.VIEWING_HISTORY);
                         setIsUserMenuOpen(false);
                       }}
                       className="w-full text-left px-4 py-3 text-sm hover:bg-slate-700 transition-colors flex items-center gap-3 text-slate-200"
                     >
                       <History size={16} className="text-indigo-400" />
                       {t.history}
                     </button>
                     <button
                       role="menuitem"
                       onClick={handleLogout}
                       className="w-full text-left px-4 py-3 text-sm hover:bg-slate-700 transition-colors flex items-center gap-3 text-red-300"
                     >
                       <LogOut size={16} />
                       {t.logout}
                     </button>
                   </div>
                 )}
               </>
            )}
          </div>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 w-full h-full flex flex-col">
        
        {state === AppState.IDLE && (
          <PhotoInput onImageSelect={handleImageSelect} t={t} />
        )}

        {state === AppState.SELECTING_LANDMARK && identificationResult && (
          <LandmarkSelector 
            identification={identificationResult}
            onSelect={(name) => fetchDetails(name)}
            onCancel={resetApp}
            t={t}
          />
        )}
        
        {state === AppState.VIEWING_HISTORY && (
          <HistoryView
            items={userHistory}
            onClose={() => setState(AppState.IDLE)}
            onClear={handleClearHistory}
            onSelect={handleHistorySelect}
            onDelete={handleDeleteHistoryItem}
            t={t}
          />
        )}

        {/* LOADING STATES */}
        
        {state === AppState.ANALYZING_IMAGE && (
          <ScanningView imageSrc={selectedImage} t={t} />
        )}

        {state === AppState.FETCHING_DETAILS && (
          <SkeletonCard 
            t={t} 
            landmarkName={identificationResult?.name} 
          />
        )}

        {/* RESULTS & ERRORS */}

        {state === AppState.SHOWING_RESULT && result && (
          <TourCard 
            result={result} 
            onReset={resetApp} 
            onChat={() => setState(AppState.CHATTING)}
            onGenerateAudio={handleGenerateAudio}
            t={t}
            isAudioLoading={isGeneratingAudio}
            langCode={langCode}
            langName={currentLangName}
          />
        )}
        
        {state === AppState.CHATTING && result && (
          <ChatView 
            landmarkName={result.landmarkName} 
            onClose={() => setState(AppState.SHOWING_RESULT)}
            t={t}
            langCode={currentLangName}
          />
        )}

        {state === AppState.ERROR && (
          <div className="flex flex-col items-center justify-center h-full p-8 pt-header pb-safe text-center animate-fade-in">
            <div className="bg-red-500/20 p-6 rounded-full mb-6 text-red-400">
               <Zap size={48} />
            </div>
            <h2 className="text-2xl font-bold mb-2">{t.oops}</h2>
            <p className="text-slate-300 mb-8 max-w-xs mx-auto">{errorMsg}</p>
            <button 
              onClick={resetApp}
              className="px-6 py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-200 transition-colors"
            >
              {t.tryAgain}
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
