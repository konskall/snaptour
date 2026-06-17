# Design: Cloud-synced scan history (Firebase)

- **Date:** 2026-06-17
- **Status:** Approved (design); pending implementation plan
- **Author:** KonsKall + Claude

## Problem

SnapTour has working Google login, but a user's scan history is stored only in
the browser's `localStorage` (keyed by `snaptour_history_${email}` in
`services/storageService.ts`). The history is therefore device-local: signing in
with the same Google account on a different device or browser shows an empty
history. The app is a static SPA deployed to GitHub Pages and currently has no
backend.

## Goal

When a user signs in with their Google account, their scan history follows the
account across devices and browsers.

## Non-goals (YAGNI)

- Syncing anything other than scan history (no favorites, settings, or preferences).
- Sharing history between users or any social features.
- Changing the hosting model (stays on GitHub Pages).
- Real-time multi-tab live updates (a refresh-on-load model is sufficient).

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Backend | **Firebase Cloud Firestore** | Serverless, free tier, client SDK talks directly to the DB from a static SPA (no server to host), fits the existing Google ecosystem. |
| Identity | **Firebase Auth (Google provider)** | Firestore security rules need a Firebase identity (`request.auth.uid`). Native Google sign-in; Firebase manages tokens/session and gives a stable `uid`. Replaces the custom GSI token-client flow. |
| History storage shape | **One document per scan** in a per-user subcollection | A single document holding 50 base64 thumbnails (~4 MB) exceeds Firestore's 1 MiB/doc limit; per-item docs stay well under it. |

## Architecture

New and changed units:

- **`services/firebase.ts` (new):** initializes the Firebase app from Vite env
  vars and exports `auth` and `db` (Firestore). Single place that knows about
  Firebase config. If config is absent, exports `null` so the app can fall back
  to guest/local mode.
- **`services/storageService.ts` (reworked):** becomes the history service.
  Public interface stays intent-stable but keys on `uid` instead of `email`:
  - `getHistory(uid): Promise<HistoryItem[]>`
  - `saveHistoryItem(uid, item): Promise<void>`
  - `clearHistory(uid): Promise<void>`
  - `migrateLocalHistory(uid, email): Promise<void>` (one-time)
  Cloud (Firestore) is the source of truth when signed in; `localStorage` is kept
  as a read cache / offline fallback and as the sole store in guest mode.
  `createThumbnail` is unchanged.
- **`App.tsx` (changed):** login/logout/session logic switches to Firebase Auth.
  `onAuthStateChanged` drives the `user` state; the manual `snaptour_user_session`
  localStorage entry is removed (Firebase persists the session itself).
- **`types.ts` (changed):** the `User` interface gains a `uid: string` field
  (from the Firebase auth user). All history calls key on `uid`; `displayName →
  name`, `photoURL → picture`, `email → email`. The now-unused `accessToken`
  field is dropped. Note the history-service methods become **async**
  (Promise-returning), so the `App.tsx` call sites that currently read history
  synchronously must `await` them.

## Data model (Firestore)

```
users/{uid}/history/{itemId}
  timestamp: number
  landmarkName: string
  summary: string
  detailedInfo?: string
  groundingSources?: GroundingChunk[]
  thumbnail: string   // base64, ~40-130 KB (500px JPEG q0.7), well under 1 MiB
```

- `itemId` = the existing client-generated `HistoryItem.id`.
- 50-item cap per user: when adding beyond 50, delete the oldest document
  (`orderBy(timestamp, asc) limit 1`).

## Security rules

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

Each signed-in user can read/write only their own history; no anonymous access.

## Flows

**Login:** `signInWithPopup(GoogleAuthProvider)` on normal browsers;
`signInWithRedirect` fallback for in-app browsers (LinkedIn etc., already
detected in `App.tsx`). `onAuthStateChanged` fires with the Firebase user
(`uid, displayName, email, photoURL`) → map to the existing `User` type → load
history from `users/{uid}/history` → set state.

**Save scan:** after a successful analysis, write a doc to Firestore and update
the local cache, then refresh the list. Enforce the 50-item cap.

**Logout:** Firebase `signOut()` → clear in-memory state and local cache.

**Cross-device:** same Google account → same `uid` → same Firestore history. ✓

## One-time migration

On first sign-in, if `localStorage` holds history under the legacy
`snaptour_history_${email}` key and the user's Firestore history is empty, upload
the local items to Firestore (preserving the user's existing history), then mark
migration done. Afterwards Firestore is authoritative.

## Guest mode & graceful degradation

If Firebase is not configured (missing env) or the user is in guest/mock mode,
the app keeps the current localStorage-only behavior with no sync, preserving the
existing "Setup Required" banner and graceful degradation.

## Error handling & resilience

- A Firestore write failure (offline, quota) must never block showing the scan
  result. Keep the local copy and surface a soft, non-blocking warning.
- Optionally enable Firestore offline persistence so a signed-in user can browse
  cached history offline and writes sync when back online (can be deferred).

## Configuration (one-time, done by the user)

1. Create a Firebase project (or add Firebase to the existing Google Cloud
   project that owns `GOOGLE_CLIENT_ID`).
2. Enable **Authentication → Sign-in method → Google**.
3. Add authorized domains: `konskall.github.io` and `localhost`.
4. Create a Web App, copy its config, and add the values as Vite env vars /
   GitHub Secrets (same mechanism as `API_KEY` / `GOOGLE_CLIENT_ID`):
   `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`,
   `FIREBASE_APP_ID` (and `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`
   if needed). The Firebase web `apiKey` is a public client identifier, not a
   secret; it is kept in env only for consistency.
5. Publish the Firestore security rules above.

## Affected files

- `services/firebase.ts` — new
- `services/storageService.ts` — reworked to cloud-backed history service
- `App.tsx` — Firebase Auth login/logout/session; history load/save call sites
- `index.html` — remove the `accounts.google.com/gsi/client` script (no longer
  needed once GSI is replaced); Firebase SDK is bundled via npm
- `package.json` — add `firebase` dependency
- `.env` / GitHub Secrets — Firebase config keys
- `firestore.rules` — new (security rules, for reference/deploy)

## Testing

- Unit tests for the history service with a mocked Firestore:
  save / get / clear / 50-item eviction / one-time migration.
- Manual cross-device acceptance test: sign in on two browsers/devices, scan on
  one, confirm it appears on the other after sign-in.

## Risks / open items

- Switching login from the custom GSI flow to Firebase Auth changes working code;
  must verify the in-app-browser (LinkedIn) path still works via redirect.
- Firestore free (Spark) limits (50K reads/day, 20K writes/day, 1 GiB) are ample
  for personal scale; revisit if usage grows.
