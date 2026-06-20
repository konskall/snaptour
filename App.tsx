import React, { useState, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import { PhotoInput } from './components/PhotoInput';
import { TourCard } from './components/TourCard';
import { LandmarkSelector } from './components/LandmarkSelector';
import { HistoryView } from './components/HistoryView';
import { ScanningView } from './components/ScanningView';
import { SkeletonCard } from './components/SkeletonCard';
import { ChatView } from './components/ChatView';
import { NearbyLandmarks } from './components/NearbyLandmarks';
import { PassportView } from './components/PassportView';
import { Toast, type ToastType } from './components/Toast';
import { identifyLandmarkFromImage, getLandmarkDetails, generateNarrationAudio, getLandmarkInfo, getNearbyLandmarks, prefetchSdk } from './services/geminiService';
import { getDeviceLocation, getExifGps } from './services/locationUtils';
import { detectInAppBrowser, type InAppInfo } from './services/browserUtils';
import { saveHistoryItem, subscribeHistory, createThumbnail, createScaledImage, clearHistory, deleteHistoryItem, migrateLocalHistory, setFavorite, clearCache } from './services/storageService';
import { fetchLandmarkImage } from './services/wikimediaService';
import { auth, isFirebaseConfigured } from './services/firebase';
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, browserPopupRedirectResolver, type User as FirebaseUser } from 'firebase/auth';
import { AppState, AnalysisResult, LandmarkIdentification, LandmarkMeta, User, HistoryItem, NearbyPlace } from './types';
import { Loader2, History, LogOut, Zap, AlertTriangle, ExternalLink, MapPinned, Award, X } from 'lucide-react';
import { Logo } from './components/Logo';
import { LANGUAGES, translations } from './translations';

// Leaflet + its CSS are heavy, so the visited-places map loads only when opened.
const VisitedMap = lazy(() => import('./components/VisitedMap'));

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

const App: React.FC = () => {
  // Parse the persisted view ONCE (it reads sessionStorage + may include a base64 image),
  // instead of three times across the lazy useState initializers.
  const persistedView = useMemo(() => loadPersistedView(), []);
  const [state, setState] = useState<AppState>(persistedView.state);
  const [selectedImage, setSelectedImage] = useState<string | null>(persistedView.selectedImage);
  const [identificationResult, setIdentificationResult] = useState<LandmarkIdentification | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(persistedView.result);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [langCode, setLangCode] = useState<string>(() => {
    const isSupported = (c?: string | null): c is string => !!c && LANGUAGES.some(l => l.code === c);
    try {
      // 1) A DELIBERATE in-app choice wins — gated on the manual flag so a previously
      //    auto-detected value can never freeze the language (the old build persisted
      //    the detected code on every load, which is why device-language stopped applying).
      if (localStorage.getItem('snaptour_lang_manual')) {
        const saved = localStorage.getItem('snaptour_lang');
        if (isSupported(saved)) return saved;
      }
      // 2) Otherwise follow the DEVICE language; English if it isn't one we support.
      //    We deliberately do NOT honour a shared link's language: the recipient should
      //    read a shared landmark in THEIR OWN language (the one they understand), not the
      //    sender's — so the share link carries only the landmark id, never a language.
      const base = (navigator.language || 'en').toLowerCase().split('-')[0];
      return isSupported(base) ? base : 'en';
    } catch { return 'en'; }
  });
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  // Whether the latest scan used a location hint (EXIF / device GPS) — drives a small
  // badge on the result. Not relevant for history items.
  const [scanUsedLocation, setScanUsedLocation] = useState(false);
  // "Near me now" state
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyDenied, setNearbyDenied] = useState(false);
  const [nearbyError, setNearbyError] = useState(false); // API failure (vs genuinely none nearby)
  const [nearbyFallback, setNearbyFallback] = useState(false); // NEARBY shown as a fallback after a scan couldn't identify a landmark
  const [missingCreds, setMissingCreds] = useState<string[]>([]);
  const [inAppInfo, setInAppInfo] = useState<InAppInfo>({ inApp: false, name: '', isIOS: false, isAndroid: false });
  const isInAppBrowser = inAppInfo.inApp;
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const showInAppBanner = isInAppBrowser && !bannerDismissed;
  // In-app toast (replaces native alert()) for transient notices like sign-in errors.
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const showToast = (message: string, type: ToastType = 'info') => setToast({ message, type });
  
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
  // Monotonic id for the in-flight scan/details request. Each new processTour/fetchDetails
  // bumps it; an async path bails after its awaits if it's no longer the latest, so two
  // quick scans can't have the slower one clobber the newer result (or double-save).
  const latestRequestId = useRef(0);

  const t = translations[langCode] || translations['en'];
  const currentLangName = LANGUAGES.find(l => l.code === langCode)?.name || 'English';

  // Keep the document language in sync for a11y / correct hyphenation & voice selection.
  // NOTE: we deliberately do NOT persist langCode here — auto-detected values must stay
  // ephemeral so the app keeps following the device language. Only a deliberate menu pick
  // (handleLanguageChange) is persisted.
  useEffect(() => {
    document.documentElement.lang = langCode;
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
  }, [showInAppBanner, missingCreds.length]);

  useEffect(() => {
    const missing = [];
    // In proxy mode the key lives in the Worker, so a client-side API_KEY isn't required.
    if (!process.env.GEMINI_PROXY_URL && !process.env.API_KEY) missing.push("API_KEY");
    if (!isFirebaseConfigured()) missing.push("FIREBASE_*");
    setMissingCreds(missing);
  }, []);

  // Detect social in-app browsers (Instagram, Facebook, TikTok, LinkedIn, …). Their
  // embedded WebViews block GPS and OAuth popups, so we steer users to a real browser
  // (see the banner + the "Near me" denied state) and use redirect sign-in below.
  useEffect(() => {
    setInAppInfo(detectInAppBrowser());
  }, []);

  // Warm the heavy Gemini SDK chunk while the browser is idle, so the first scan doesn't
  // wait on the network fetch+parse. Best-effort; falls back to a short timeout where
  // requestIdleCallback is unavailable (Safari/iOS).
  useEffect(() => {
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void) => number);
    if (ric) { const id = ric(() => prefetchSdk()); return () => (window as any).cancelIdleCallback?.(id); }
    const tid = window.setTimeout(prefetchSdk, 2500);
    return () => window.clearTimeout(tid);
  }, []);

  // Subscribe to Firebase auth state (handles session persistence + redirect return)
  const historyUnsubRef = useRef<null | (() => void)>(null);
  useEffect(() => {
    if (!auth) return;
    // Only finish a redirect sign-in if we actually started one (set right before
    // signInWithRedirect). This keeps the popup/redirect resolver iframe off the normal
    // load path; onAuthStateChanged alone restores a persisted session without it.
    if (sessionStorage.getItem('st_redirecting')) {
      sessionStorage.removeItem('st_redirecting');
      getRedirectResult(auth, browserPopupRedirectResolver).catch(err => console.error('Redirect sign-in failed', err));
    }
    const unsub = onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
      // Tear down any previous user's live history subscription.
      historyUnsubRef.current?.();
      historyUnsubRef.current = null;
      // Anonymous users exist only to carry a token to the Gemini proxy — they are NOT a real
      // login, so the UI treats them as logged-out (show the sign-in button, no history sync).
      if (fbUser && !fbUser.isAnonymous) {
        const mapped: User = {
          uid: fbUser.uid,
          name: fbUser.displayName || t.defaultUserName,
          email: fbUser.email || '',
          picture: fbUser.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(fbUser.displayName || 'T')}&background=6366f1&color=fff`,
        };
        setUser(mapped);
        await migrateLocalHistory(mapped.uid, mapped.email);
        // Live, cross-device history: updates here when this user scans on another device.
        historyUnsubRef.current = subscribeHistory(mapped.uid, setUserHistory);
      } else {
        setUser(null);
        setUserHistory([]);
      }
    });
    return () => {
      unsub();
      historyUnsubRef.current?.();
      historyUnsubRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: PointerEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setIsLangMenuOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    // pointerdown (not mousedown) so a touch tap elsewhere also dismisses the dropdowns.
    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
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
      showToast(t.signInNotConfigured, 'info');
      return;
    }
    const provider = new GoogleAuthProvider();
    // Always show the Google account chooser, so logout -> login can pick a different account
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      // Pass the resolver explicitly (auth was initialized without one — see services/firebase.ts).
      // iOS Safari (and iOS WebViews) OPEN the popup but, with a cross-domain authDomain, can't
      // deliver its result back to the page ("popup opens, then nothing → still logged out").
      // Use a full-page redirect on iOS (and in-app browsers); popup is reliable on desktop & Android.
      if (isInAppBrowser || inAppInfo.isIOS) {
        sessionStorage.setItem('st_redirecting', '1'); // so we run getRedirectResult on return
        await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
      } else {
        await signInWithPopup(auth, provider, browserPopupRedirectResolver);    // onAuthStateChanged handles the rest
      }
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      // User closed/cancelled the chooser (or a fast double-tap superseded the first call) — not a
      // real failure, so don't alarm them with an error toast; they can just tap again.
      if (/cancelled-popup-request|popup-closed-by-user/i.test(code)) return;
      // iOS Safari / standalone PWA can still refuse the popup outright (it must open synchronously
      // inside the tap). Fall back to a full-page redirect rather than failing the login.
      if (/popup-blocked|web-storage-unsupported|operation-not-supported/i.test(code)) {
        try {
          sessionStorage.setItem('st_redirecting', '1');
          await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
          return;
        } catch (e) {
          console.error('Redirect fallback failed', e);
        }
      }
      console.error('Google sign-in failed', err);
      showToast(t.signInFailed, 'error');
    }
  };

  const handleLogout = async () => {
    setIsUserMenuOpen(false);
    const uid = user?.uid; // capture before sign-out clears it
    try { if (auth) await signOut(auth); } catch (e) { console.error('Sign-out failed', e); }
    // Drop the on-device history cache (PII) so it doesn't linger on a shared device.
    if (uid) clearCache(uid);
    // Also drop the persisted view (it may hold the last result + photo) so it can't be
    // re-hydrated into another user's session on a shared device.
    try { sessionStorage.removeItem(VIEW_KEY); } catch { /* storage unavailable */ }
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

  const handleToggleFavorite = async (item: HistoryItem) => {
    if (user) {
      setUserHistory(await setFavorite(user.uid, item.id, !item.favorite));
    }
  };

  // Leave the social in-app browser for the user's real browser, where GPS & login work.
  // Android: jump straight to Chrome via an intent: URL. iOS: Safari can't be force-opened
  // from a WebView, so copy the link for the user to paste (plus the on-screen ••• hint).
  const APP_URL = 'https://konskall.github.io/snaptour/';
  const handleOpenExternally = async () => {
    if (inAppInfo.isAndroid) {
      try {
        window.location.href =
          'intent://konskall.github.io/snaptour/#Intent;scheme=https;package=com.android.chrome;end';
        return;
      } catch { /* fall through to copy */ }
    }
    try {
      await navigator.clipboard.writeText(APP_URL);
      showToast(t.linkCopied, 'success');
    } catch {
      showToast(APP_URL, 'info');
    }
  };

  // "Near me now": discover famous landmarks around the user's current location, no
  // photo. Picking one runs the same details pipeline as a scan.
  const handleNearMe = async () => {
    setIsUserMenuOpen(false);
    // Clear any prior result/image so a near-me pick (which has no photo) doesn't
    // inherit a stale thumbnail when it's saved to history.
    setSelectedImage(null);
    setResult(null);
    setNearbyPlaces([]);
    setNearbyDenied(false);
    setNearbyError(false);
    setNearbyFallback(false); // explicit "Near me", not a post-scan fallback
    setNearbyLoading(true);
    setState(AppState.NEARBY);
    const coords = await getDeviceLocation();
    if (!coords) {
      setNearbyDenied(true);
      setNearbyLoading(false);
      return;
    }
    const places = await getNearbyLandmarks(coords, currentLangName);
    if (places === null) { // a real failure (network / quota / parse), not "none nearby"
      setNearbyError(true);
      setNearbyLoading(false);
      return;
    }
    setNearbyPlaces(places);
    setNearbyLoading(false);
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
      nativeTTSFallback: false,
      meta: item.info, // restore the Useful info card from saved metadata
    });
    // Thumbnails are base64 (user photos) or an absolute URL (fetched Wikimedia image);
    // empty → no background (the card sits on the dark surface).
    setSelectedImage(
      item.thumbnail
        ? (item.thumbnail.includes('://') ? item.thumbnail : `data:image/jpeg;base64,${item.thumbnail}`)
        : null,
    );
    setState(AppState.SHOWING_RESULT);
    setScanUsedLocation(false); // history items have no live-location badge

    // Reset Audio State - user must click play to generate
    setIsGeneratingAudio(false);
  };

  const handleImageSelect = (file: File, source: 'camera' | 'upload' = 'upload') => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result as string;
      // Guard against an invalid / non-data-URL FileReader result
      if (typeof base64Data !== 'string' || !base64Data.startsWith('data:') || !base64Data.includes(',')) {
        setErrorMsg(t.error);
        setState(AppState.ERROR);
        return;
      }
      // Decode the on-screen thumbnail and the ~1024px model upload from the same source
      // concurrently (instead of back-to-back) so the two heavy decode/encode passes
      // overlap; show the background as soon as the thumbnail is ready.
      const thumbP = createThumbnail(base64Data);
      const scaledP = createScaledImage(base64Data, 1024);
      const thumb = await thumbP;
      setSelectedImage(`data:image/jpeg;base64,${thumb}`);
      const scaled = await scaledP;
      processTour(scaled.base64, scaled.mimeType, base64Data, source, file);
    };
    reader.onerror = () => {
      setErrorMsg(t.error);
      setState(AppState.ERROR);
    };
    reader.readAsDataURL(file);
  };

  // A scan didn't yield a usable landmark (an alley, an ordinary spot, or an unparseable
  // reply). Instead of a dead-end, try to be useful from the user's location: show notable
  // places around them. Degrades gracefully via `onUnavailable` when there's no GPS/data,
  // so we never surface the scary "failed to analyze" screen for an honest non-landmark.
  const goNearbyFallback = async (
    reqId: number,
    scanCoords: { lat: number; lng: number } | undefined,
    onUnavailable: () => void,
  ) => {
    setNearbyFallback(true);
    setNearbyPlaces([]);
    setNearbyDenied(false);
    setNearbyError(false);
    setNearbyLoading(true);
    setState(AppState.NEARBY);
    let coords = scanCoords;
    if (!coords) coords = (await getDeviceLocation()) || undefined;
    if (reqId !== latestRequestId.current) return; // superseded by a newer scan
    if (!coords) { setNearbyFallback(false); setNearbyLoading(false); onUnavailable(); return; }
    const places = await getNearbyLandmarks(coords, currentLangName);
    if (reqId !== latestRequestId.current) return;
    if (!places || places.length === 0) { setNearbyFallback(false); setNearbyLoading(false); onUnavailable(); return; }
    setNearbyPlaces(places);
    setNearbyLoading(false);
  };

  const processTour = async (base64Image: string, mimeType: string, fullImageData: string, source: 'camera' | 'upload' = 'upload', file?: File) => {
    const reqId = ++latestRequestId.current;
    // Declared outside the try so the catch fallback can reuse any location we found
    // (avoids a second getDeviceLocation prompt on the error path).
    let coords: { lat: number; lng: number } | undefined;
    try {
      setIdentificationResult(null); // start each scan fresh — never carry a prior scan's guess
      setState(AppState.ANALYZING_IMAGE);
      // Location hint to disambiguate the landmark: the photo's own EXIF GPS first
      // (correct even for old uploads), then the live device location for a camera
      // capture. Anything missing/denied → image-only, exactly as before.
      try {
        const exif = file ? await getExifGps(file) : null;
        coords = exif || (source === 'camera' ? await getDeviceLocation() : null) || undefined;
      } catch { coords = undefined; }
      setScanUsedLocation(!!coords);
      const idResult = await identifyLandmarkFromImage(base64Image, mimeType, currentLangName, coords);
      if (reqId !== latestRequestId.current) return; // a newer scan superseded this one
      setIdentificationResult(idResult);
      const CONFIDENCE_THRESHOLD = 0.8;
      // Require a non-empty name too: the model returns an empty name for "not a
      // landmark", which must never be auto-fetched (it would narrate nonsense).
      const hasOptions = (idResult.confidence > 0 && !!idResult.name) || (idResult.alternatives?.length ?? 0) > 0;
      if (idResult.confidence >= CONFIDENCE_THRESHOLD && idResult.name) {
        fetchDetails(idResult.name, fullImageData, coords);
      } else if (hasOptions) {
        // Uncertain but plausible candidates → let the user pick.
        setState(AppState.SELECTING_LANDMARK);
      } else {
        // Not a landmark → be useful from the GPS location instead of a dead-end.
        // If there's no location/data, fall back to the friendly "not a landmark" screen
        // (SELECTING_LANDMARK renders it because identificationResult has no options).
        await goNearbyFallback(reqId, coords, () => setState(AppState.SELECTING_LANDMARK));
      }
    } catch (error: any) {
      if (reqId !== latestRequestId.current) return; // a newer scan superseded this one
      console.error(error);
      // Rate limit / quota → nothing else will work either, show the error.
      if (error.message?.includes("429") || error.status === 429 || JSON.stringify(error).includes("RESOURCE_EXHAUSTED")) {
         setErrorMsg(t.quotaError);
         setState(AppState.ERROR);
         return;
      }
      // Other failures (the grounded identify model choked): the lighter nearby model may
      // still help if we know where the user is — reuse the coords we already collected
      // (EXIF / device) and only re-request if we have none.
      await goNearbyFallback(reqId, coords, () => { setErrorMsg(t.error); setState(AppState.ERROR); });
    }
  };

  const fetchDetails = async (
    landmarkName: string,
    imageOverride?: string,
    scanCoords?: { lat: number; lng: number },
    opts?: { save?: boolean; deepLink?: boolean },
  ) => {
    const reqId = ++latestRequestId.current;
    try {
      setState(AppState.FETCHING_DETAILS);

      // Reset Audio State - user must click play to generate
      setIsGeneratingAudio(false);

      // For photo-less entries (Near me now / deep link) fetch a real representative
      // image so the result + history aren't bare. Runs in parallel with the grounded
      // calls, so it adds no latency (details is the long pole) and is best-effort.
      // Deep links must NOT reuse the ambient `selectedImage` (it may be a stale photo
      // restored from the persisted view of the previous landmark), so ignore it here.
      const ambientImage = opts?.deepLink ? null : selectedImage;
      const needsImage = !(imageOverride || ambientImage);

      // Grounded narrative + structured "useful info" in parallel. Info is a non-grounded
      // call on a separate quota bucket and is best-effort — it never blocks the result.
      const [{ text: detailedInfo, sources }, info, wikiImage] = await Promise.all([
        getLandmarkDetails(landmarkName, currentLangName),
        getLandmarkInfo(landmarkName, currentLangName).catch(() => null),
        needsImage ? fetchLandmarkImage(landmarkName).catch(() => null) : Promise.resolve(null),
      ]);
      if (reqId !== latestRequestId.current) return; // a newer request superseded this one — don't commit or save
      const meta: LandmarkMeta | undefined = info || undefined;
      // Use the fetched image as the result-view background when we had no photo.
      if (wikiImage) setSelectedImage(wikiImage);
      setResult({
        landmarkName,
        detailedInfo,
        groundingSources: sources,
        audioBuffer: null,
        nativeTTSFallback: false,
        meta,
      });
      setState(AppState.SHOWING_RESULT);

      // Save when there's an image to attach (a photo scan) or when the caller asks
      // (e.g. a "Near me now" pick, which has no photo). Deep links don't save.
      const imageToSave = imageOverride || ambientImage;
      if (user && (imageToSave || opts?.save)) {
        // User photos → downscaled base64 thumbnail; photo-less items → the Wikimedia
        // image URL (or '' → the designed placeholder in History).
        const thumbnail = imageToSave ? await createThumbnail(imageToSave) : (wikiImage || '');
        // Best coordinates for the visited map: real scan GPS if we had it, else the
        // model's estimate from the metadata.
        const lat = scanCoords?.lat ?? meta?.lat ?? undefined;
        const lng = scanCoords?.lng ?? meta?.lng ?? undefined;
        const historyItem: HistoryItem = {
           // Collision-proof id: two scans finishing in the same millisecond must not share
           // a Firestore doc id. Prefer randomUUID; fall back to time+random where unavailable.
           id: (typeof crypto !== 'undefined' && crypto.randomUUID)
             ? crypto.randomUUID()
             : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
           timestamp: Date.now(),
           landmarkName: landmarkName,
           summary: detailedInfo.substring(0, 100) + "...",
           detailedInfo: detailedInfo,
           groundingSources: sources,
           thumbnail: thumbnail,
           ...(meta ? { info: meta } : {}),
           ...(lat != null && lng != null ? { lat, lng } : {}),
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

  // Deep link: a shared SnapTour URL carries ?l=<landmark>. On first load, open that
  // landmark directly (fetch its details + show the result), then strip the param so a
  // refresh doesn't re-fetch and normal view-persistence applies.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current) return;
    let landmark = '';
    try { landmark = new URLSearchParams(window.location.search).get('l') || ''; } catch { /* ignore */ }
    landmark = landmark.trim().slice(0, 120);
    if (!landmark) return;
    deepLinkHandled.current = true;
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
    setSelectedImage(null); // drop any stale photo restored from the persisted view
    fetchDetails(landmark, undefined, undefined, { deepLink: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetApp = () => {
    setState(AppState.IDLE);
    setSelectedImage(null);
    setResult(null);
    setIdentificationResult(null);
    setErrorMsg('');
    setIsGeneratingAudio(false);
    setScanUsedLocation(false);
    setNearbyPlaces([]);
    setNearbyDenied(false);
    setNearbyLoading(false);
    setNearbyFallback(false);
  };

  const handleLanguageChange = (code: string) => {
    setLangCode(code);
    setIsLangMenuOpen(false);
    // Persist as a DELIBERATE choice: it sticks across sessions and overrides device-language
    // detection on the next load (the manual flag is what the initializer checks for).
    try {
      localStorage.setItem('snaptour_lang', code);
      localStorage.setItem('snaptour_lang_manual', '1');
    } catch { /* storage unavailable */ }
  };

  // Memoized so an unrelated re-render (toast, menu toggle, audio state) doesn't recreate
  // the object and re-trigger the root element's background style recalculation.
  const backgroundStyle = useMemo(() => selectedImage ? {
    backgroundImage: `url(${selectedImage})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  } : {}, [selectedImage]);

  // Find current language object
  const currentLang = LANGUAGES.find(l => l.code === langCode);

  return (
    <div className="relative w-full overflow-hidden bg-slate-900 text-white" aria-busy={state === AppState.ANALYZING_IMAGE || state === AppState.FETCHING_DETAILS} style={{ ...backgroundStyle, height: 'var(--app-height, 100vh)' }}>
      {selectedImage && <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-all duration-1000" />}

      {/* Screen-reader announcement for async loading states (visually hidden). */}
      <div className="sr-only" role="status" aria-live="polite">
        {state === AppState.ANALYZING_IMAGE ? t.analyzing : state === AppState.FETCHING_DETAILS ? t.fetching : ''}
      </div>

      {/* In-app toast (replaces native alert) */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} closeLabel={t.close} />}

      {/* In-app browser banner: these WebViews block GPS & login, so steer users out.
          Dismissible — the header `top` offset and --header-h tracking key off showInAppBanner. */}
      {showInAppBanner && (
        <div className="absolute top-0 left-0 right-0 bg-amber-600 text-white z-[110] px-3 py-3 flex items-center gap-2 shadow-xl animate-slide-down" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
           <ExternalLink size={18} className="shrink-0" />
           <span className="text-xs font-semibold leading-snug flex-1 min-w-0">
             {inAppInfo.name ? `${inAppInfo.name}: ` : ''}{t.inAppBrowserWarning}
           </span>
           <button
             onClick={handleOpenExternally}
             className="shrink-0 text-xs font-bold bg-white/20 hover:bg-white/30 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
           >
             {inAppInfo.isAndroid ? t.openInBrowser : t.copyLink}
           </button>
           <button
             onClick={() => setBannerDismissed(true)}
             aria-label={t.dismiss}
             title={t.dismiss}
             className="shrink-0 p-1 rounded-md hover:bg-white/20 transition-colors"
           >
             <X size={16} />
           </button>
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
        className={`absolute ${showInAppBanner ? 'top-16' : missingCreds.length > 0 ? 'top-10' : 'top-0'} left-0 right-0 p-6 z-40 flex items-center justify-between pointer-events-none transition-all`}
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
          aria-label={t.home}
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
              <span className="text-sm font-medium hidden sm:inline [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
                {currentLang?.name || 'English'}
              </span>
            </button>

            {isLangMenuOpen && (
              <div id="lang-menu" className="absolute right-0 top-full mt-2 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-50 animate-fade-in">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => handleLanguageChange(lang.code)}
                    aria-current={langCode === lang.code ? 'true' : undefined}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-700 transition-colors flex items-center justify-between ${langCode === lang.code ? 'bg-slate-700/50 text-indigo-400' : 'text-slate-200'}`}
                  >
                    <div className="flex items-center">
                      <img
                        src={`https://cdn.jsdelivr.net/gh/HatScripts/circle-flags/flags/${lang.countryCode}.svg`}
                        alt={lang.name}
                        width={22}
                        height={22}
                        loading="lazy"
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
                 className="flex items-center justify-center bg-black/20 backdrop-blur-md p-2 rounded-full border border-white/10 hover:bg-white/10 transition-colors shadow-lg"
               >
                 <svg className="w-[22px] h-[22px] flex-shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
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
                   aria-expanded={isUserMenuOpen}
                   aria-controls="user-menu"
                   className="flex items-center gap-2 bg-black/20 backdrop-blur-md px-3 py-2 rounded-full border border-white/10 hover:bg-white/10 transition-colors shadow-lg"
                 >
                   <img src={user.picture} alt={user.name} className="w-[22px] h-[22px] rounded-full ring-1 ring-white/20 object-cover" />
                   <span className="text-sm font-medium hidden sm:inline max-w-[80px] truncate">{user.name}</span>
                 </button>

                 {isUserMenuOpen && (
                   <div id="user-menu" className="absolute right-0 top-full mt-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-50 animate-fade-in">
                     <div className="px-4 py-3 border-b border-slate-700">
                       <p className="text-sm font-semibold text-white">{user.name}</p>
                       <p className="text-xs text-slate-400 truncate">{user.email}</p>
                     </div>
                     <button
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
                       onClick={() => {
                         setState(AppState.VIEWING_MAP);
                         setIsUserMenuOpen(false);
                       }}
                       className="w-full text-left px-4 py-3 text-sm hover:bg-slate-700 transition-colors flex items-center gap-3 text-slate-200"
                     >
                       <MapPinned size={16} className="text-emerald-400" />
                       {t.mapMenu}
                     </button>
                     <button
                       onClick={() => {
                         setState(AppState.VIEWING_PASSPORT);
                         setIsUserMenuOpen(false);
                       }}
                       className="w-full text-left px-4 py-3 text-sm hover:bg-slate-700 transition-colors flex items-center gap-3 text-slate-200"
                     >
                       <Award size={16} className="text-amber-400" />
                       {t.passportMenu}
                     </button>
                     <button
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
          <PhotoInput onImageSelect={handleImageSelect} onNearMe={handleNearMe} t={t} />
        )}

        {state === AppState.NEARBY && (
          <NearbyLandmarks
            places={nearbyPlaces}
            loading={nearbyLoading}
            denied={nearbyDenied}
            error={nearbyError}
            onRetry={handleNearMe}
            onSelect={(name) => fetchDetails(name, undefined, undefined, { save: true })}
            onClose={resetApp}
            fallback={nearbyFallback}
            inAppBrowser={isInAppBrowser}
            isAndroid={inAppInfo.isAndroid}
            onOpenExternally={handleOpenExternally}
            t={t}
          />
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
            onToggleFavorite={handleToggleFavorite}
            langCode={langCode}
            t={t}
          />
        )}

        {state === AppState.VIEWING_MAP && (
          <Suspense fallback={
            <div role="status" className="flex items-center justify-center h-full pt-header">
              <Loader2 size={32} aria-hidden="true" className="animate-spin text-emerald-400" />
              <span className="sr-only">{t.loading}</span>
            </div>
          }>
            <VisitedMap
              items={userHistory}
              onClose={() => setState(AppState.IDLE)}
              onSelect={handleHistorySelect}
              t={t}
            />
          </Suspense>
        )}

        {state === AppState.VIEWING_PASSPORT && (
          <PassportView
            items={userHistory}
            onClose={() => setState(AppState.IDLE)}
            onSelect={handleHistorySelect}
            langCode={langCode}
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
            locatedByGps={scanUsedLocation}
            imageSrc={selectedImage || undefined}
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
