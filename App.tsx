import React, { useState, useEffect, useRef } from 'react';
import { PhotoInput } from './components/PhotoInput';
import { TourCard } from './components/TourCard';
import { LandmarkSelector } from './components/LandmarkSelector';
import { HistoryView } from './components/HistoryView';
import { ScanningView } from './components/ScanningView';
import { SkeletonCard } from './components/SkeletonCard';
import { ChatView } from './components/ChatView';
import { identifyLandmarkFromImage, getLandmarkDetails, generateNarrationAudio } from './services/geminiService';
import { saveHistoryItem, getHistory, createThumbnail, clearHistory } from './services/storageService';
import { AppState, AnalysisResult, LandmarkIdentification, User, HistoryItem } from './types';
import { Loader2, Globe, History, UserCircle, LogOut, Zap, AlertTriangle, ExternalLink } from 'lucide-react';
import { Logo } from './components/Logo';
import { LANGUAGES, translations } from './translations';

declare global {
  interface Window {
    google: any;
  }
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [identificationResult, setIdentificationResult] = useState<LandmarkIdentification | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [langCode, setLangCode] = useState<string>('en');
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [isAudioUnavailable, setIsAudioUnavailable] = useState(false);
  const [missingCreds, setMissingCreds] = useState<string[]>([]);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  
  // User & History State
  const [user, setUser] = useState<User | null>(null);
  const [userHistory, setUserHistory] = useState<HistoryItem[]>([]);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isGoogleScriptLoaded, setIsGoogleScriptLoaded] = useState(false);

  // Refs for click-outside detection
  const langMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const t = translations[langCode] || translations['en'];
  const currentLangName = LANGUAGES.find(l => l.code === langCode)?.name || 'English';

  useEffect(() => {
    const missing = [];
    if (!process.env.API_KEY) missing.push("API_KEY");
    if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
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

  // Poll for Google Script Load (fix for In-App browsers like LinkedIn)
  useEffect(() => {
    const checkGoogle = setInterval(() => {
      if (window.google) {
        setIsGoogleScriptLoaded(true);
        clearInterval(checkGoogle);
      }
    }, 500);
    return () => clearInterval(checkGoogle);
  }, []);

  // Check for saved user session on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('snaptour_user_session');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        setUserHistory(getHistory(parsedUser.email));
      } catch (e) {
        console.error("Failed to restore session", e);
        localStorage.removeItem('snaptour_user_session');
      }
    }
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

  const handleGoogleLogin = () => {
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

    const performMockLogin = () => {
       console.warn("Using Mock Login (Demo Mode) - Missing CLIENT_ID");
       const mockUser: User = {
         name: "Guest Traveler",
         email: "guest@snaptour.app",
         picture: "https://ui-avatars.com/api/?name=Guest+Traveler&background=random&color=fff&background=6366f1",
         accessToken: "mock_token_123"
       };
       setUser(mockUser);
       localStorage.setItem('snaptour_user_session', JSON.stringify(mockUser)); // Save session
       setUserHistory(getHistory(mockUser.email));
    };

    // 1. Critical: Check if Client ID exists. If NOT, we are likely in dev mode or not configured.
    if (!CLIENT_ID) {
      performMockLogin();
      setIsUserMenuOpen(false);
      return;
    }

    // 2. Client ID exists, so we EXPECT Google Login to work.
    // If window.google is missing, it's a network/browser loading issue or blocked by In-App Browser.
    // We should NOT fallback to mock login here, as it confuses users (logging them in as Guest).
    if (!window.google) {
        console.error("Google Sign-In script not loaded yet.");
        // If we are in an in-app browser, the banner is already showing. 
        // If not, show a generic alert.
        if (!isInAppBrowser) {
           alert("Google Sign-In is still initializing or blocked. Please refresh the page.");
        }
        return;
    }

    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        callback: async (tokenResponse: any) => {
          if (tokenResponse && tokenResponse.access_token) {
            try {
              const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
              });
              const userInfo = await userInfoRes.json();
              const newUser = {
                name: userInfo.name,
                email: userInfo.email,
                picture: userInfo.picture,
                accessToken: tokenResponse.access_token
              };
              setUser(newUser);
              localStorage.setItem('snaptour_user_session', JSON.stringify(newUser)); // Save session
              setUserHistory(getHistory(userInfo.email));
            } catch (error) {
              console.error("Failed to fetch user info", error);
            }
          }
        },
      });
      client.requestAccessToken();
    } catch (err) {
      console.error("Google Login Error:", err);
      // Only fallback if there's a hard crash in the library, though alert is better
      alert("An error occurred starting Google Sign-In. Please try again.");
    }
    setIsUserMenuOpen(false);
  };

  const handleLogout = () => {
    if (window.google && user?.accessToken && user.accessToken !== "mock_token_123") {
      window.google.accounts.oauth2.revoke(user?.accessToken, () => {
        console.log('Consent revoked');
      });
    }
    localStorage.removeItem('snaptour_user_session'); // Clear session
    setUser(null);
    setUserHistory([]);
    setIsUserMenuOpen(false);
    if (state === AppState.VIEWING_HISTORY) {
       setState(AppState.IDLE);
    }
  };

  const handleClearHistory = () => {
    if (user) {
      clearHistory(user.email);
      setUserHistory([]);
    }
  };

  const handleHistorySelect = async (item: HistoryItem) => {
    const textContent = item.detailedInfo || item.summary;
    setResult({
      landmarkName: item.landmarkName,
      detailedInfo: textContent,
      groundingSources: item.groundingSources || [],
      audioBuffer: null 
    });
    setSelectedImage(`data:image/jpeg;base64,${item.thumbnail}`);
    setState(AppState.SHOWING_RESULT);
    setIsAudioUnavailable(false); // Reset status

    setIsGeneratingAudio(true);
    try {
      const audioBuffer = await generateNarrationAudio(textContent);
      if (!audioBuffer) {
        setIsAudioUnavailable(true);
      }
      setResult((prev) => {
        if (prev && prev.landmarkName === item.landmarkName) {
          return { ...prev, audioBuffer };
        }
        return prev;
      });
    } catch (audioError) {
      console.error("Failed to regenerate audio from history", audioError);
      setIsAudioUnavailable(true);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handleImageSelect = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result as string;
      const base64Image = base64Data.split(',')[1];
      const mimeType = file.type;
      setSelectedImage(base64Data);
      processTour(base64Image, mimeType, base64Data);
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
      setIsAudioUnavailable(false); // Reset audio status
      const { text: detailedInfo, sources } = await getLandmarkDetails(landmarkName, currentLangName);
      setResult({
        landmarkName,
        detailedInfo,
        groundingSources: sources,
        audioBuffer: null
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
        saveHistoryItem(user.email, historyItem);
        setUserHistory(getHistory(user.email)); 
      }

      setIsGeneratingAudio(true);
      try {
        const audioBuffer = await generateNarrationAudio(detailedInfo);
        if (!audioBuffer) {
           setIsAudioUnavailable(true);
        }
        setResult((prev) => {
          if (prev && prev.landmarkName === landmarkName) {
            return { ...prev, audioBuffer };
          }
          return prev;
        });
      } catch (audioError) {
        console.error("Audio generation failed", audioError);
        setIsAudioUnavailable(true);
      } finally {
        setIsGeneratingAudio(false);
      }
    } catch (error: any) {
      console.error(error);
      if (error.message?.includes("429") || error.status === 429 || JSON.stringify(error).includes("RESOURCE_EXHAUSTED")) {
         setErrorMsg(t.quotaError);
      } else {
         setErrorMsg(t.error);
      }
      setState(AppState.ERROR);
      setIsGeneratingAudio(false);
    }
  };

  const resetApp = () => {
    setState(AppState.IDLE);
    setSelectedImage(null);
    setResult(null);
    setIdentificationResult(null);
    setErrorMsg('');
    setIsGeneratingAudio(false);
    setIsAudioUnavailable(false);
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
    <div className="relative w-full h-screen overflow-hidden bg-slate-900 text-white" style={backgroundStyle}>
      {selectedImage && <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-all duration-1000" />}

      {/* In-App Browser Warning Banner */}
      {isInAppBrowser && (
        <div className="absolute top-0 left-0 right-0 bg-amber-600 text-white z-[110] px-4 py-3 flex items-center justify-center shadow-xl animate-slide-down">
           <div className="flex items-center gap-3 text-center">
             <ExternalLink size={20} className="flex-shrink-0" />
             <span className="text-sm font-bold">
               {t.inAppBrowserWarning}
             </span>
           </div>
        </div>
      )}

      {missingCreds.length > 0 && !isInAppBrowser && (
        <div className="absolute top-0 left-0 right-0 bg-red-600 text-white z-[100] px-4 py-2 flex items-center justify-between shadow-xl">
           <div className="flex items-center gap-2">
             <AlertTriangle size={18} className="fill-white text-red-600" />
             <span className="text-sm font-bold">
               Setup Required: Missing {missingCreds.join(" & ")}. 
               Check GitHub Settings &rarr; Secrets.
             </span>
           </div>
           <button onClick={() => setMissingCreds([])} className="text-xs bg-red-800 hover:bg-red-700 px-2 py-1 rounded">Dismiss</button>
        </div>
      )}

      <div className={`absolute ${isInAppBrowser ? 'top-16' : missingCreds.length > 0 ? 'top-10' : 'top-0'} left-0 right-0 p-6 z-40 flex items-center justify-between pointer-events-none transition-all`}>
        {/* Brand */}
        <div 
          onClick={resetApp}
          className="flex items-center gap-2 pointer-events-auto cursor-pointer group"
        >
          <div className="bg-black/20 backdrop-blur-md p-2 rounded-2xl border border-white/10 shadow-lg group-hover:bg-white/10 transition-colors">
             <Logo className="w-8 h-8 drop-shadow-lg" />
          </div>
          <span className="font-bold tracking-tight text-white text-xl drop-shadow-md">
            Snap<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">Tour</span>
          </span>
        </div>

        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Language Selector */}
          <div className="relative" ref={langMenuRef}>
            <button 
              onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
              className="flex items-center gap-2 bg-black/20 backdrop-blur-md px-3 py-2 rounded-full border border-white/10 hover:bg-white/10 transition-colors shadow-lg"
            >
              {currentLang && (
                <img 
                  src={`https://flagcdn.com/w40/${currentLang.countryCode}.png`}
                  alt={currentLang.name}
                  className="w-5 h-3.5 object-cover rounded-sm"
                />
              )}
              {/* Show only Name, not Flag emoji since we use image now */}
              <span className="text-sm font-medium hidden sm:inline">
                {currentLang?.name || 'English'}
              </span>
            </button>

            {isLangMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-50 animate-fade-in">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => handleLanguageChange(lang.code)}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-700 transition-colors flex items-center justify-between ${langCode === lang.code ? 'bg-slate-700/50 text-indigo-400' : 'text-slate-200'}`}
                  >
                    <div className="flex items-center">
                      <img 
                        src={`https://flagcdn.com/w40/${lang.countryCode}.png`}
                        alt={lang.name}
                        className="w-5 h-3.5 object-cover rounded-sm mr-3"
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
                 className="flex items-center gap-2 bg-white text-slate-900 px-4 py-2 rounded-full font-medium text-sm hover:bg-slate-200 transition-colors shadow-lg border border-slate-300"
               >
                 <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                   <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                   <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                   <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                   <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                 </svg>
                 <span className="hidden sm:inline">{t.login}</span>
                 <span className="sm:hidden">Sign in</span>
               </button>
            ) : (
                // LOGGED IN - Show Avatar & Menu
               <>
                 <button
                   onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                   className="flex items-center gap-2 bg-black/20 backdrop-blur-md px-2 py-2 sm:px-3 sm:py-2 rounded-full border border-white/10 hover:bg-white/10 transition-colors shadow-lg"
                 >
                   <img src={user.picture} alt={user.name} className="w-5 h-5 rounded-full border border-white/20" />
                   <span className="text-sm font-medium hidden sm:inline max-w-[80px] truncate">{user.name}</span>
                 </button>

                 {isUserMenuOpen && (
                   <div className="absolute right-0 top-full mt-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-50 animate-fade-in">
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
        </div>
      </div>

      {/* Main Content Area */}
      <div className="relative z-10 w-full h-full flex flex-col">
        
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
            t={t} 
            isAudioLoading={isGeneratingAudio}
            isAudioUnavailable={isAudioUnavailable}
            langCode={langCode}
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
          <div className="flex flex-col items-center justify-center h-full p-8 text-center animate-fade-in">
            <div className="bg-red-500/20 p-6 rounded-full mb-6 text-red-400">
               <Zap size={48} />
            </div>
            <h3 className="text-2xl font-bold mb-2">{t.oops}</h3>
            <p className="text-slate-300 mb-8 max-w-xs mx-auto">{errorMsg}</p>
            <button 
              onClick={resetApp}
              className="px-6 py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-200 transition-colors"
            >
              {t.tryAgain}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
