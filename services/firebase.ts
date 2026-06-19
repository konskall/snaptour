import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const config = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

export function isFirebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.appId);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (isFirebaseConfigured()) {
  app = initializeApp(config);
  // initializeAuth (not getAuth) WITHOUT a popupRedirectResolver. getAuth() eagerly wires
  // the popup/redirect resolver, which pulls firebaseapp.com/__/auth/iframe.js (~90 KiB)
  // + getProjectConfig into the initial-load critical path on EVERY visit. We keep the same
  // browser persistence (indexedDB → localStorage) so existing sessions are still restored,
  // and pass browserPopupRedirectResolver explicitly only at the sign-in / redirect-return
  // call sites (see App.tsx) so the iframe loads on demand, not at startup.
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  });
  db = getFirestore(app);
}

export { auth, db };
