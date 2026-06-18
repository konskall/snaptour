# 📍 SnapTour — AI Landmark Recognition & Audio Tours

Snap a photo of any landmark and instantly get its name, a concise history, an audio
narration, a map, nearby places, and a chat guide — powered by Google Gemini.

**🔗 Live:** https://konskall.github.io/snaptour/

![SnapTour](https://konskall.github.io/snaptour/ogsnaptour.png?v=3)

---

## ✨ Features

- **📸 Instant recognition** — take or upload a photo and Gemini identifies the landmark from the image. When it isn't sure, it offers a few alternatives to pick from; when the photo clearly isn't a landmark, it says so and sends you straight back to a new scan (no nonsense results).
- **📍 Location‑aware** — uses the photo's embedded **EXIF GPS** (or your **live device location** for a camera shot) to disambiguate similar or lesser‑known places. Location only refines a landmark that's actually visible — it never invents a place for a non‑landmark photo. A small **GPS** badge shows when a location hint was used.
- **📖 Concise history** — a to‑the‑point, natural (non‑theatrical) summary with 2–3 genuinely interesting facts, grounded with Google Search when it helps.
- **🔊 Two voices** — the primary **Play** uses the device's **native voice** (instant, no network, no quota); an optional **HD** button uses Gemini's premium voice.
- **💬 Ask the Guide** — chat about the landmark (hours, tickets, trivia…), short and human.
- **🗺️ Map & 5 nearby places** — embedded map plus AI suggestions for what's around.
- **🔗 Shareable deep links** — share a SnapTour link that opens the **exact landmark** on the recipient's side (`?l=…`), with a rich Open Graph preview.
- **☁️ Cloud history** — sign in with Google to sync visited landmarks across devices (Firestore); each entry shows date + time and has per‑item **share** and **delete**. Falls back to a local cache when signed out.
- **🌍 7 languages** — English, Español, Français, Deutsch, 中文, हिन्दी, Ελληνικά.
- **📱 Installable PWA** — full‑screen, offline‑aware shell, safe‑area aware on iOS/Android.

---

## 🧠 How recognition works

```
photo ──▶ downscale to ~1024px ──▶ identify (vision + Google Search + optional GPS hint)
                                        │
                          confidence ≥ 0.8 & has a name?
                            │ yes                  │ no
                            ▼                      ▼
                     fetch details        show alternatives to pick
                     (grounded)            (or "not a landmark" → new scan)
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
        narration      map + nearby      Ask the Guide
   (native / HD voice)   (5 places)         (chat)
```

Large phone photos are downscaled client‑side before upload (the vision model
downsamples anyway), so scans stay fast with no loss of accuracy.

---

## 🧱 Tech stack

| Area | Tech |
|------|------|
| UI | React 19 + TypeScript, Tailwind CSS 3 |
| Build | Vite 8 (Rolldown), code‑split AI SDK |
| AI | Google Gemini via `@google/genai` — see model map below |
| Auth & data | Firebase Authentication (Google) + Cloud Firestore |
| Testing | Vitest + jsdom |
| Hosting | GitHub Pages (via GitHub Actions) |

**Model map**

| Task | Model |
|------|-------|
| Identify + details (Google Search grounding) | `gemini-2.5-flash-lite` |
| Chat + nearby places | `gemini-3.1-flash-lite` |
| HD voice (text‑to‑speech) | `gemini-2.5-flash-preview-tts` |
| Default voice | Browser **Web Speech** (`speechSynthesis`) — no API call |

---

## 🚀 Getting started

### Prerequisites
- Node.js 20+ (CI uses 24)
- A **Gemini API key** — https://aistudio.google.com/apikey
- A **Firebase project** with Authentication (Google provider) and Cloud Firestore enabled

### Install & run

```bash
git clone https://github.com/konskall/snaptour.git
cd snaptour
npm install

# create your local env file and fill in the values
cp .env.example .env      # Windows: copy .env.example .env

npm run dev               # starts the Vite dev server (URL printed in the console)
```

### Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Where to find it |
|----------|------------------|
| `API_KEY` | Google AI Studio (Gemini API key) |
| `FIREBASE_API_KEY` | Firebase → Project settings → Your apps → Web app |
| `FIREBASE_AUTH_DOMAIN` | " |
| `FIREBASE_PROJECT_ID` | " |
| `FIREBASE_STORAGE_BUCKET` | " |
| `FIREBASE_MESSAGING_SENDER_ID` | " |
| `FIREBASE_APP_ID` | " |

> The Firebase Web config values are public by design. Keep secrets out of source
> control — `.env` is git‑ignored and CI reads everything from **GitHub Secrets**.

### Firebase setup
1. **Authentication** → enable the **Google** sign‑in provider.
2. **Firestore** → create the database; security rules live in [`firestore.rules`](firestore.rules) (each user can only read/write `users/{uid}/history/**`).
3. **Authentication → Settings → Authorized domains** → add `konskall.github.io` (and `localhost` for dev).

---

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite (Vitest) |
| `npm run test:watch` | Watch mode |

---

## 🗂️ Project structure

```
App.tsx                 # App shell, state machine, header, auth + deep-link (?l=) wiring
index.tsx / index.html  # Entry + document (viewport / PWA / Open Graph metas)
index.css               # Tailwind layers + safe-area / animation helpers
components/             # PhotoInput, ScanningView, LandmarkSelector,
                        # SkeletonCard, TourCard, ChatView, HistoryView, Logo
services/
  geminiService.ts      # All Gemini calls (identify / details / chat / nearby / TTS)
  locationUtils.ts      # EXIF GPS reader + device geolocation (graceful fallbacks)
  firebase.ts           # Firebase init + isFirebaseConfigured()
  storageService.ts     # Firestore-backed history, image scaling/thumbnails, local cache
  historyUtils.ts       # Capping / dedupe helpers (unit-tested)
  audioUtils.ts         # PCM decode helpers for TTS
hooks/useDialog.ts      # Accessible modal (focus trap / Escape / restore)
translations.ts         # i18n strings for 7 languages
firestore.rules         # Per-user Firestore security rules
.github/workflows/      # GitHub Pages deploy
```

---

## 🚢 Deployment

Pushing to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
which builds with the secrets below and publishes `dist/` to **GitHub Pages**.

Add these under **GitHub → Settings → Secrets and variables → Actions**:
`API_KEY`, `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`,
`FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`.

> If a build banner says **“Setup Required: Missing …”**, a secret is missing or empty.
> GitHub Pages caches the HTML briefly — after a deploy you may need a hard refresh
> (or to reopen the PWA) to pick up the new build.

---

## ⚠️ Notes & limits

- AI‑generated content may contain errors — always verify important information.
- **Free‑tier quotas** (Gemini): the model and **Google Search grounding** have separate
  daily limits, and the TTS preview model is very limited (≈10 requests/day) — which is
  why the default voice is the browser's native voice. Enable billing on the key's Google
  Cloud project for production‑grade limits and full grounding.
- **API key exposure**: the app calls Gemini directly from the browser, so the key is
  present in the client bundle. For production, restrict the key (HTTP‑referrer + API
  restrictions) or route calls through a server / Cloud Function proxy.

---

## 👤 Credits

Created by **[KonsKall](https://www.linkedin.com/in/konstantinos-kalliakoudis-902b90103)**.
