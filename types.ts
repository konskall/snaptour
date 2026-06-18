
// Structured, factual metadata about a landmark used by the "Useful info" card,
// the visited-places map (coordinates), passport stamps and history filters
// (country / category). Unknown fields come back as "" (strings) or null
// (numbers) — never undefined — so they are safe to persist to Firestore and
// easy to hide in the UI.
export interface LandmarkMeta {
  country: string;       // localized display name, "" if unknown
  countryCode: string;   // ISO 3166-1 alpha-2, lowercase — stable key + flag, "" if unknown
  city: string;          // "" if unknown
  category: string;      // localized type, e.g. "Monument" / "Μνημείο", "" if unknown
  lat: number | null;    // approx landmark latitude (map pin), null if unknown
  lng: number | null;    // approx landmark longitude, null if unknown
  openingHours: string;  // localized, "" if unknown / not applicable
  ticket: string;        // localized (price or "Free"), "" if unknown
  bestTime: string;      // localized best time to visit, "" if not applicable
  website: string;       // official site URL, "" if unknown
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface AnalysisResult {
  landmarkName: string;
  detailedInfo: string;
  groundingSources: GroundingChunk[];
  audioBuffer: AudioBuffer | null;
  nativeTTSFallback?: boolean; // New flag for fallback
  meta?: LandmarkMeta;         // structured "useful info" (hours, ticket, site, type, location)
}

export interface LandmarkIdentification {
  name: string;
  confidence: number;
  alternatives: string[];
}

export interface User {
  uid: string;
  name: string;
  email: string;
  picture: string;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  thumbnail: string; // Base64
  landmarkName: string;
  summary: string;
  detailedInfo?: string; // Optional for backward compatibility
  groundingSources?: GroundingChunk[]; // Optional for backward compatibility
  // Added for map / passport / filters (all optional → older items still load):
  favorite?: boolean;        // user ⭐ flag
  info?: LandmarkMeta;       // structured useful-info (also powers country/type filters + passport)
  lat?: number;              // best-known latitude for the visited map (real scan GPS if used, else estimate)
  lng?: number;              // best-known longitude
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
}

export interface NearbyPlace {
  name: string;
  description: string;
}

export enum AppState {
  IDLE = 'IDLE',
  ANALYZING_IMAGE = 'ANALYZING_IMAGE',
  SELECTING_LANDMARK = 'SELECTING_LANDMARK',
  FETCHING_DETAILS = 'FETCHING_DETAILS',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  SHOWING_RESULT = 'SHOWING_RESULT',
  VIEWING_HISTORY = 'VIEWING_HISTORY',
  NEARBY = 'NEARBY',                 // "Near me now": landmarks around the user, no photo
  VIEWING_MAP = 'VIEWING_MAP',       // visited-places map
  VIEWING_PASSPORT = 'VIEWING_PASSPORT', // travel passport / achievements
  CHATTING = 'CHATTING',
  ERROR = 'ERROR'
}

export interface Translation {
  startTitle: string;
  startSubtitle: string;
  uploadBtn: string;
  cameraBtn: string;
  supports: string;
  analyzing: string;
  fetching: string;
  generating: string;
  identifying_sub: string;
  error: string;
  quotaError: string;
  tryAgain: string;
  landmarkLabel: string;
  scanAnother: string;
  verifiedSources: string;
  oops: string;
  selectMatch: string;
  uncertain: string;
  confidence: string;
  noneOfThese: string;
  notLandmarkTitle: string;
  notLandmark: string;
  login: string;
  logout: string;
  history: string;
  historyTitle: string;
  noHistory: string;
  home: string;
  share: string;
  shareSuccess: string;
  shareError: string;
  clearHistory: string;
  confirmClear: string;
  deleteItem: string;
  featureScan: string;
  featureScanDesc: string;
  featureLearn: string;
  featureLearnDesc: string;
  featureListen: string;
  featureListenDesc: string;
  recent: string;
  createdBy: string;
  disclaimer: string;
  // New features
  askGuide: string;
  chatPlaceholder: string;
  chatTitle: string;
  nearbyTitle: string;
  viewMap: string;
  close: string;
  inAppBrowserWarning: string;
  signIn: string;
  dismiss: string;
  signInFailed: string;
  signInNotConfigured: string;
  chatError: string;
  shareText: string;
  // "Near me now"
  nearMeBtn: string;
  nearMeTitle: string;
  nearMeSubtitle: string;
  nearMeEmpty: string;
  locationDenied: string;
  locating: string;
  // "Useful info" card
  usefulInfo: string;
  infoHours: string;
  infoTicket: string;
  infoBestTime: string;
  infoWebsite: string;
  infoType: string;
  infoLocation: string;
  // Narration voice & speed
  voiceLabel: string;
  speedLabel: string;
  voiceDefault: string;
  // Visited map
  mapMenu: string;
  mapTitle: string;
  mapEmpty: string;
  // Passport / achievements
  passportMenu: string;
  passportTitle: string;
  statLandmarks: string;
  statCountries: string;
  statContinents: string;
  passportEmpty: string;
  // History search / filters / favorites
  searchPlaceholder: string;
  favoritesOnly: string;
  addFavorite: string;
  removeFavorite: string;
  noResults: string;
  filterAll: string;
}
