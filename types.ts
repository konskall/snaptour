export interface LandmarkInfo {
  name: string;
  description: string;
  facts: string[];
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
}

export interface LandmarkIdentification {
  name: string;
  confidence: number;
  alternatives: string[];
}

export interface User {
  name: string;
  email: string;
  picture: string;
  accessToken?: string;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  thumbnail: string; // Base64
  landmarkName: string;
  summary: string;
  detailedInfo?: string; // Optional for backward compatibility
  groundingSources?: GroundingChunk[]; // Optional for backward compatibility
}

export enum AppState {
  IDLE = 'IDLE',
  ANALYZING_IMAGE = 'ANALYZING_IMAGE',
  SELECTING_LANDMARK = 'SELECTING_LANDMARK',
  FETCHING_DETAILS = 'FETCHING_DETAILS',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  SHOWING_RESULT = 'SHOWING_RESULT',
  VIEWING_HISTORY = 'VIEWING_HISTORY',
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
  tryAgain: string;
  landmarkLabel: string;
  scanAnother: string;
  verifiedSources: string;
  oops: string;
  selectMatch: string;
  uncertain: string;
  confidence: string;
  noneOfThese: string;
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
}