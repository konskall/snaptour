# Cloud-Synced Scan History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a signed-in user's scan history follow their Google account across devices, replacing the device-local localStorage-only model.

**Architecture:** Firebase Auth (Google) provides identity; Cloud Firestore stores one document per scan under `users/{uid}/history/{itemId}`. The static SPA talks to Firestore directly with per-user security rules. localStorage becomes an offline read-cache and the sole store in guest mode. Pure list logic (sort/cap/evict) is isolated in `historyUtils.ts` for unit testing; Firestore I/O wrappers stay thin.

**Tech Stack:** React 19, TypeScript (strict), Vite 8, Firebase JS SDK v11 (modular), Vitest + jsdom for tests.

## Global Constraints

- Vite `base: './'` (GitHub Pages) — do not change.
- Firebase free (Spark) tier; no paid services.
- History cap: **50 items** per user (newest kept).
- Firestore document size limit: **1 MiB** — never store all thumbnails in one doc.
- Scope: history sync only. No favorites/settings.
- Preserve guest/unconfigured fallback: if Firebase env is missing, the app keeps working with localStorage only.
- Firebase env vars (build-time, injected like the existing `API_KEY`): `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`.
- Existing `HistoryItem` shape (from `types.ts`): `{ id: string; timestamp: number; thumbnail: string; landmarkName: string; summary: string; detailedInfo?: string; groundingSources?: GroundingChunk[] }`.

---

### Task 1: Test infrastructure (Vitest + jsdom)

**Files:**
- Modify: `package.json` (add devDeps + `test` script)
- Create: `vitest.config.ts`
- Create: `services/__tests__/sanity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` command running Vitest in a jsdom environment (so `localStorage` exists in tests).

- [ ] **Step 1: Install test dependencies**

Run:
```bash
npm install -D vitest@^2 jsdom@^25
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
```

- [ ] **Step 3: Add the `test` script to `package.json`**

In the `"scripts"` block, add:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Write a sanity test**

Create `services/__tests__/sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs and has jsdom localStorage', () => {
    localStorage.setItem('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
  });
});
```

- [ ] **Step 5: Run the test, expect PASS**

Run: `npm test`
Expected: 1 passed, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts services/__tests__/sanity.test.ts
git commit -m "test: add Vitest + jsdom harness"
```

---

### Task 2: Pure history list logic (`historyUtils.ts`)

**Files:**
- Create: `services/historyUtils.ts`
- Test: `services/__tests__/historyUtils.test.ts`

**Interfaces:**
- Consumes: `HistoryItem` from `../types`.
- Produces:
  - `MAX_HISTORY_ITEMS: number` (= 50)
  - `sortByNewest(items: HistoryItem[]): HistoryItem[]` — returns a new array sorted by `timestamp` descending.
  - `capItems(items: HistoryItem[]): HistoryItem[]` — sorts by newest then keeps the first `MAX_HISTORY_ITEMS`.
  - `idsToEvict(items: HistoryItem[]): string[]` — given any items, returns the `id`s beyond the newest `MAX_HISTORY_ITEMS` (empty when within cap).

- [ ] **Step 1: Write the failing tests**

Create `services/__tests__/historyUtils.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sortByNewest, capItems, idsToEvict, MAX_HISTORY_ITEMS } from '../historyUtils';
import type { HistoryItem } from '../../types';

const mk = (id: string, ts: number): HistoryItem => ({
  id, timestamp: ts, thumbnail: '', landmarkName: id, summary: '',
});

describe('historyUtils', () => {
  it('MAX_HISTORY_ITEMS is 50', () => {
    expect(MAX_HISTORY_ITEMS).toBe(50);
  });

  it('sortByNewest orders by timestamp descending without mutating input', () => {
    const input = [mk('a', 1), mk('b', 3), mk('c', 2)];
    const out = sortByNewest(input);
    expect(out.map(i => i.id)).toEqual(['b', 'c', 'a']);
    expect(input.map(i => i.id)).toEqual(['a', 'b', 'c']); // unchanged
  });

  it('capItems keeps only the newest MAX_HISTORY_ITEMS', () => {
    const items = Array.from({ length: 55 }, (_, i) => mk(`id${i}`, i));
    const out = capItems(items);
    expect(out).toHaveLength(50);
    expect(out[0].id).toBe('id54'); // newest first
    expect(out.at(-1)!.id).toBe('id5');
  });

  it('idsToEvict returns ids beyond the cap (oldest), empty when within cap', () => {
    expect(idsToEvict(Array.from({ length: 10 }, (_, i) => mk(`x${i}`, i)))).toEqual([]);
    const evict = idsToEvict(Array.from({ length: 52 }, (_, i) => mk(`x${i}`, i)));
    expect(evict.sort()).toEqual(['x0', 'x1'].sort()); // two oldest
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `npm test -- historyUtils`
Expected: FAIL — "Cannot find module '../historyUtils'".

- [ ] **Step 3: Implement `services/historyUtils.ts`**

```ts
import type { HistoryItem } from '../types';

export const MAX_HISTORY_ITEMS = 50;

export function sortByNewest(items: HistoryItem[]): HistoryItem[] {
  return [...items].sort((a, b) => b.timestamp - a.timestamp);
}

export function capItems(items: HistoryItem[]): HistoryItem[] {
  return sortByNewest(items).slice(0, MAX_HISTORY_ITEMS);
}

export function idsToEvict(items: HistoryItem[]): string[] {
  return sortByNewest(items).slice(MAX_HISTORY_ITEMS).map(i => i.id);
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `npm test -- historyUtils`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add services/historyUtils.ts services/__tests__/historyUtils.test.ts
git commit -m "feat: add pure history list helpers (sort/cap/evict)"
```

---

### Task 3: Firebase initialization module (`services/firebase.ts`)

**Files:**
- Modify: `package.json` (add `firebase`)
- Modify: `vite.config.ts` (define Firebase env vars)
- Create: `services/firebase.ts`
- Test: `services/__tests__/firebase.test.ts`

**Interfaces:**
- Consumes: build-time `process.env.FIREBASE_*` vars.
- Produces:
  - `isFirebaseConfigured(): boolean` — true only when the required env vars are present.
  - `auth: Auth | null` — Firebase Auth instance, or `null` when unconfigured.
  - `db: Firestore | null` — Firestore instance, or `null` when unconfigured.

- [ ] **Step 1: Install Firebase**

Run:
```bash
npm install firebase@^11
```

- [ ] **Step 2: Wire env vars in `vite.config.ts`**

In the `define` block, add the Firebase keys alongside the existing two:
```ts
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY || ""),
      'process.env.GOOGLE_CLIENT_ID': JSON.stringify(env.GOOGLE_CLIENT_ID || ""),
      'process.env.FIREBASE_API_KEY': JSON.stringify(env.FIREBASE_API_KEY || ""),
      'process.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(env.FIREBASE_AUTH_DOMAIN || ""),
      'process.env.FIREBASE_PROJECT_ID': JSON.stringify(env.FIREBASE_PROJECT_ID || ""),
      'process.env.FIREBASE_APP_ID': JSON.stringify(env.FIREBASE_APP_ID || ""),
      'process.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(env.FIREBASE_STORAGE_BUCKET || ""),
      'process.env.FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(env.FIREBASE_MESSAGING_SENDER_ID || ""),
    },
```

- [ ] **Step 3: Write the failing test**

Create `services/__tests__/firebase.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('isFirebaseConfigured', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FIREBASE_API_KEY = '';
    process.env.FIREBASE_PROJECT_ID = '';
    process.env.FIREBASE_APP_ID = '';
  });

  it('returns false when required env vars are empty', async () => {
    const { isFirebaseConfigured } = await import('../firebase');
    expect(isFirebaseConfigured()).toBe(false);
  });
});
```

- [ ] **Step 4: Run test, expect FAIL**

Run: `npm test -- firebase`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `services/firebase.ts`**

```ts
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
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
  auth = getAuth(app);
  db = getFirestore(app);
}

export { auth, db };
```

- [ ] **Step 6: Run test, expect PASS**

Run: `npm test -- firebase`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts services/firebase.ts services/__tests__/firebase.test.ts
git commit -m "feat: add Firebase init module with config gating"
```

---

### Task 4: Cloud-backed history service (`storageService.ts`)

**Files:**
- Modify: `services/storageService.ts` (rework; keep `createThumbnail` unchanged)
- Test: `services/__tests__/storageService.test.ts`

**Interfaces:**
- Consumes: `db` from `./firebase`; `capItems`, `idsToEvict`, `MAX_HISTORY_ITEMS` from `./historyUtils`; Firestore modular functions.
- Produces (all keyed by **`uid`**, all async):
  - `createThumbnail(base64Image: string): Promise<string>` (unchanged)
  - `getHistory(uid: string): Promise<HistoryItem[]>`
  - `saveHistoryItem(uid: string, item: HistoryItem): Promise<void>`
  - `clearHistory(uid: string): Promise<void>`
  - `migrateLocalHistory(uid: string, email: string): Promise<void>` (implemented in Task 5)
- Cache key: `snaptour_history_${uid}`. Legacy key (read-only, for migration): `snaptour_history_${email}`.

- [ ] **Step 1: Write the failing tests (guest/cache paths, db === null)**

Create `services/__tests__/storageService.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Force guest mode: no Firestore. Exercises the localStorage cache paths.
vi.mock('../firebase', () => ({ db: null }));

import { getHistory, saveHistoryItem, clearHistory } from '../storageService';
import type { HistoryItem } from '../../types';

const mk = (id: string, ts: number): HistoryItem => ({
  id, timestamp: ts, thumbnail: '', landmarkName: id, summary: '',
});

describe('storageService (guest / cache mode, db=null)', () => {
  beforeEach(() => localStorage.clear());

  it('getHistory returns [] when nothing stored', async () => {
    expect(await getHistory('u1')).toEqual([]);
  });

  it('saveHistoryItem writes to the uid cache, newest first', async () => {
    await saveHistoryItem('u1', mk('a', 1));
    await saveHistoryItem('u1', mk('b', 2));
    const out = await getHistory('u1');
    expect(out.map(i => i.id)).toEqual(['b', 'a']);
  });

  it('saveHistoryItem caps the cache at 50 newest', async () => {
    for (let i = 0; i < 55; i++) await saveHistoryItem('u1', mk(`id${i}`, i));
    const out = await getHistory('u1');
    expect(out).toHaveLength(50);
    expect(out[0].id).toBe('id54');
  });

  it('clearHistory empties the uid cache', async () => {
    await saveHistoryItem('u1', mk('a', 1));
    await clearHistory('u1');
    expect(await getHistory('u1')).toEqual([]);
  });

  it('history is isolated per uid', async () => {
    await saveHistoryItem('u1', mk('a', 1));
    expect(await getHistory('u2')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `npm test -- storageService`
Expected: FAIL — the reworked async signatures don't exist yet.

- [ ] **Step 3: Rework `services/storageService.ts`**

Keep `createThumbnail` exactly as-is at the top of the file. Replace the
`saveHistoryItem` / `getHistory` / `clearHistory` exports with:

```ts
import { HistoryItem } from '../types';
import { db } from './firebase';
import { capItems, idsToEvict } from './historyUtils';
import {
  collection, doc, getDocs, setDoc, query, orderBy, writeBatch,
} from 'firebase/firestore';

// ---- localStorage cache (also the sole store in guest mode) ----
const cacheKey = (uid: string) => `snaptour_history_${uid}`;

function readCache(uid: string): HistoryItem[] {
  try {
    const raw = localStorage.getItem(cacheKey(uid));
    return raw ? capItems(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function writeCache(uid: string, items: HistoryItem[]): void {
  const capped = capItems(items);
  try {
    localStorage.setItem(cacheKey(uid), JSON.stringify(capped));
  } catch (e: any) {
    // Quota: drop oldest until it fits.
    const shrinking = [...capped];
    while (shrinking.length > 1) {
      shrinking.pop();
      try { localStorage.setItem(cacheKey(uid), JSON.stringify(shrinking)); return; }
      catch { /* keep shrinking */ }
    }
    console.error('Failed to write history cache', e);
  }
}

// ---- Firestore ----
const historyCol = (uid: string) => collection(db!, 'users', uid, 'history');

export async function getHistory(uid: string): Promise<HistoryItem[]> {
  if (!db) return readCache(uid);
  try {
    const snap = await getDocs(query(historyCol(uid), orderBy('timestamp', 'desc')));
    const items = capItems(snap.docs.map(d => d.data() as HistoryItem));
    writeCache(uid, items);
    return items;
  } catch (e) {
    console.error('getHistory failed; using cache', e);
    return readCache(uid);
  }
}

export async function saveHistoryItem(uid: string, item: HistoryItem): Promise<void> {
  writeCache(uid, [item, ...readCache(uid)]); // optimistic cache update
  if (!db) return;
  try {
    await setDoc(doc(historyCol(uid), item.id), item);
    const snap = await getDocs(query(historyCol(uid), orderBy('timestamp', 'desc')));
    const evict = idsToEvict(snap.docs.map(d => d.data() as HistoryItem));
    if (evict.length) {
      const batch = writeBatch(db);
      evict.forEach(id => batch.delete(doc(historyCol(uid), id)));
      await batch.commit();
    }
  } catch (e) {
    console.error('saveHistoryItem failed (kept in local cache)', e);
  }
}

export async function clearHistory(uid: string): Promise<void> {
  localStorage.removeItem(cacheKey(uid));
  if (!db) return;
  try {
    const snap = await getDocs(historyCol(uid));
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (e) {
    console.error('clearHistory failed', e);
  }
}
```

(Remove the old `email`-keyed implementations of these three functions. Deletions use `writeBatch(...).delete(...)`, so `deleteDoc` is intentionally not imported.)

- [ ] **Step 4: Run tests, expect PASS**

Run: `npm test -- storageService`
Expected: all pass (db is mocked to `null`, so only cache paths run).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add services/storageService.ts services/__tests__/storageService.test.ts
git commit -m "feat: cloud-backed history service keyed by uid with cache fallback"
```

---

### Task 5: One-time local-history migration (`migrateLocalHistory`)

**Files:**
- Modify: `services/storageService.ts` (add `migrateLocalHistory`)
- Test: `services/__tests__/migrate.test.ts`

**Interfaces:**
- Consumes: `db` from `./firebase`, Firestore `collection`/`doc`/`getDocs`/`query`/`limit`/`writeBatch`.
- Produces: `migrateLocalHistory(uid: string, email: string): Promise<void>`.
- Behavior: in guest mode (`db === null`) it is a no-op. With Firestore it uploads legacy `snaptour_history_${email}` items **only if** the cloud history is empty, then removes the legacy key.

- [ ] **Step 1: Write the failing test (guest mode no-op + legacy key untouched when db=null)**

Create `services/__tests__/migrate.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../firebase', () => ({ db: null }));

import { migrateLocalHistory } from '../storageService';

describe('migrateLocalHistory (guest mode, db=null)', () => {
  beforeEach(() => localStorage.clear());

  it('is a no-op and resolves when Firestore is unavailable', async () => {
    localStorage.setItem('snaptour_history_a@b.com', JSON.stringify([
      { id: '1', timestamp: 1, thumbnail: '', landmarkName: 'x', summary: '' },
    ]));
    await expect(migrateLocalHistory('uid1', 'a@b.com')).resolves.toBeUndefined();
    // Legacy data is left intact in guest mode (nothing to migrate to).
    expect(localStorage.getItem('snaptour_history_a@b.com')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `npm test -- migrate`
Expected: FAIL — `migrateLocalHistory` not exported.

- [ ] **Step 3: Implement `migrateLocalHistory` in `services/storageService.ts`**

Add `limit` to the `firebase/firestore` import, then append:
```ts
const legacyKey = (email: string) => `snaptour_history_${email}`;

export async function migrateLocalHistory(uid: string, email: string): Promise<void> {
  if (!db) return;
  const raw = localStorage.getItem(legacyKey(email));
  if (!raw) return;
  try {
    const localItems = capItems(JSON.parse(raw) as HistoryItem[]);
    if (localItems.length === 0) return;
    const existing = await getDocs(query(historyCol(uid), limit(1)));
    if (!existing.empty) return; // cloud already has data — don't overwrite
    const batch = writeBatch(db);
    localItems.forEach(it => batch.set(doc(historyCol(uid), it.id), it));
    await batch.commit();
    localStorage.removeItem(legacyKey(email));
  } catch (e) {
    console.error('migrateLocalHistory failed', e);
  }
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `npm test -- migrate`
Expected: pass.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add services/storageService.ts services/__tests__/migrate.test.ts
git commit -m "feat: one-time migration of local history to Firestore on first login"
```

---

### Task 6: Update `User` type

**Files:**
- Modify: `types.ts:29-34`

**Interfaces:**
- Produces: `User { uid: string; name: string; email: string; picture: string; }` (drops `accessToken`).

- [ ] **Step 1: Replace the `User` interface**

```ts
export interface User {
  uid: string;
  name: string;
  email: string;
  picture: string;
}
```

- [ ] **Step 2: Type-check (expect errors in App.tsx, fixed in Task 7)**

Run: `npx tsc --noEmit`
Expected: errors only in `App.tsx` (references to `accessToken` / old login). That is fine — Task 7 fixes them. Do not commit yet; this change is committed together with Task 7.

---

### Task 7: Firebase Auth integration in `App.tsx`

**Files:**
- Modify: `App.tsx` (login/logout/session effect + history call sites)

**Interfaces:**
- Consumes: `auth`, `isFirebaseConfigured` from `./services/firebase`; `onAuthStateChanged`, `GoogleAuthProvider`, `signInWithPopup`, `signInWithRedirect`, `getRedirectResult`, `signOut` from `firebase/auth`; `getHistory`, `saveHistoryItem`, `clearHistory`, `migrateLocalHistory`, `createThumbnail` from `./services/storageService`.

- [ ] **Step 1: Update imports (top of `App.tsx`)**

Replace the storage import (line 10) and add Firebase imports:
```ts
import { saveHistoryItem, getHistory, createThumbnail, clearHistory, migrateLocalHistory } from './services/storageService';
import { auth, isFirebaseConfigured } from './services/firebase';
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
```

- [ ] **Step 2: Replace the session-restore effect (lines 75-88) with an auth-state listener**

```ts
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
```

- [ ] **Step 3: Replace `handleGoogleLogin` (lines 105-178)**

```ts
const handleGoogleLogin = async () => {
  setIsUserMenuOpen(false);
  if (!auth || !isFirebaseConfigured()) {
    alert('Sign-in is not configured. Set the FIREBASE_* secrets.');
    return;
  }
  const provider = new GoogleAuthProvider();
  try {
    if (isInAppBrowser) {
      await signInWithRedirect(auth, provider); // popups blocked in in-app browsers
    } else {
      await signInWithPopup(auth, provider);    // onAuthStateChanged handles the rest
    }
  } catch (err) {
    console.error('Google sign-in failed', err);
    alert('Sign-in failed. Please try again.');
  }
};
```

- [ ] **Step 4: Replace `handleLogout` (lines 180-193)**

```ts
const handleLogout = async () => {
  setIsUserMenuOpen(false);
  try { if (auth) await signOut(auth); } catch (e) { console.error('Sign-out failed', e); }
  // onAuthStateChanged clears user + history; reset the view if needed
  if (state === AppState.VIEWING_HISTORY) setState(AppState.IDLE);
};
```

- [ ] **Step 5: Update `handleClearHistory` (lines 195-200) to use `uid` and await**

```ts
const handleClearHistory = async () => {
  if (user) {
    await clearHistory(user.uid);
    setUserHistory([]);
  }
};
```

- [ ] **Step 6: Update the save-history call site in `fetchDetails` (lines 298-311)**

```ts
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
        await saveHistoryItem(user.uid, historyItem);
        setUserHistory(await getHistory(user.uid));
      }
```

- [ ] **Step 7: Remove now-dead GSI plumbing**

Delete: the `declare global { interface Window { google: any } }` block (lines 16-20), the `isGoogleScriptLoaded` state (line 39), and the "Poll for Google Script Load" effect (lines 64-73). Leave the `isInAppBrowser` state and its detection effect (still used by `handleGoogleLogin`).

- [ ] **Step 8: Type-check, expect PASS**

Run: `npx tsc --noEmit`
Expected: exit 0 (Task 6 + Task 7 together resolve all `User`/login errors).

- [ ] **Step 9: Build, expect success**

Run: `npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 10: Commit (types + App together)**

```bash
git add types.ts App.tsx
git commit -m "feat: replace GSI login with Firebase Auth (Google) and uid-keyed history"
```

---

### Task 8: Remove GSI script, add Firestore rules & env docs

**Files:**
- Modify: `index.html` (remove `accounts.google.com/gsi/client` script tag)
- Create: `firestore.rules`
- Create: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: deployable security rules and documented env vars.

- [ ] **Step 1: Remove the GSI script from `index.html`**

Delete the line:
```html
  <script src="https://accounts.google.com/gsi/client" async defer></script>
```

- [ ] **Step 2: Create `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/history/{doc} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

- [ ] **Step 3: Create `.env.example`**

```
# Gemini
API_KEY=
# Google OAuth (legacy GSI client id — no longer required after Firebase Auth)
GOOGLE_CLIENT_ID=
# Firebase Web config (Project settings -> Your apps -> Web app)
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=
```

- [ ] **Step 4: Build, expect success**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add index.html firestore.rules .env.example
git commit -m "chore: drop GSI script, add Firestore rules and env example"
```

---

### Task 9: Manual cross-device acceptance test

**Prerequisite (done once by the user in the Firebase console):** project created, Authentication → Google enabled, authorized domains include `konskall.github.io` and `localhost`, web config copied into env/secrets, and `firestore.rules` published.

**Files:** none (verification only).

- [ ] **Step 1: Run with Firebase env locally**

Create a local `.env` from `.env.example` filled with real Firebase values, then:
Run: `npm run dev`
Expected: app loads with no "Setup Required" banner for Firebase.

- [ ] **Step 2: Sign in and scan**

In browser A: sign in with Google, scan/upload a landmark photo, confirm it appears under History.

- [ ] **Step 3: Verify cross-device sync**

In a different browser/profile B (or another device): sign in with the **same** Google account, open History.
Expected: the item from browser A appears.

- [ ] **Step 4: Verify isolation & clear**

Sign in with a different Google account → history is empty. Back on account A, use "Clear History" → list empties and stays empty after reload.

- [ ] **Step 5: Verify migration**

With pre-existing localStorage history under the legacy `snaptour_history_<email>` key and an empty cloud history, sign in → the local items appear in History (migrated) and the legacy key is removed.

---

## Self-Review Notes

- **Spec coverage:** Firestore data model (Task 4/5), security rules (Task 8), Firebase Auth replacing GSI (Task 7), one-time migration (Task 5), guest fallback (db=null paths, Tasks 4/5), 50-item cap (Tasks 2/4), config/env (Tasks 3/8), testing (Tasks 1-5 unit, Task 9 manual). All spec sections map to a task.
- **Type consistency:** history functions are uid-keyed and async across Tasks 4/5/7; `User.uid` (Task 6) is produced before its consumers (Task 7); `capItems`/`idsToEvict` names match between Task 2 and Task 4.
- **Placeholder scan:** no TBD/TODO; every code step contains full code; commands have expected output.
- **Note on offline persistence** (spec "resilience, optional"): intentionally deferred (YAGNI); the cache-fallback in `getHistory` already covers read-offline.
