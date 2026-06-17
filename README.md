# 📍 SnapTour — AI Landmark Recognition & Audio Tours

Snap a photo of any landmark and instantly get its name, a rich history, an audio
narration, a map, nearby places, and a chat guide — powered by Google Gemini.

**🔗 Live:** https://konskall.github.io/snaptour/

![SnapTour](https://konskall.github.io/snaptour/ogsnaptour.png?v=3)

---

## ✨ Features

- **📸 Instant recognition** — take or upload a photo; Gemini identifies the landmark (with a confirmation step when it's unsure).
- **📖 Rich history** — a narrated, grounded summary with **verified web sources** (Google Search grounding).
- **🔊 Audio narration** — natural text‑to‑speech, with a native‑voice fallback if the AI audio is unavailable.
- **💬 Ask the Guide** — chat about the landmark (hours, tickets, trivia…).
- **🗺️ Map & nearby places** — embedded map plus AI suggestions for what's around.
- **☁️ Cloud history** — sign in with Google to sync your visited landmarks across devices (Firestore), with a local cache fallback.
- **🌍 7 languages** — English, Español, Français, Deutsch, 中文, हिन्दी, Ελληνικά.
- **📱 Installable PWA** — full‑screen, offline‑aware shell, safe‑area aware on iOS/Android.

---

## 🧱 Tech stack

| Area | Tech |
|------|------|
| UI | React 19 + TypeScript, Tailwind CSS 3 |
| Build | Vite 8 (Rolldown), code‑split AI SDK |
| AI | Google Gemini — `gemini-3.1-flash-lite` (text) + `gemini-3.1-flash-tts-preview` (speech) via `@google/genai` |
| Auth & data | Firebase Authentication (Google) + Cloud Firestore |
| Testing | Vitest + jsdom |
| Hosting | GitHub Pages (via GitHub Actions) |

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

npm run dev               # http://localhost:3000
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
| `npm run build` | Type‑check + production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite (Vitest) |
| `npm run test:watch` | Watch mode |

---

## 🗂️ Project structure

```
App.tsx                 # App shell, state machine, header, auth wiring
index.tsx / index.html  # Entry + document (viewport / PWA metas)
index.css               # Tailwind layers + safe-area / animation helpers
components/             # PhotoInput, ScanningView, LandmarkSelector,
                        # SkeletonCard, TourCard, ChatView, HistoryView, Logo
services/
  geminiService.ts      # All Gemini calls (identify / details / chat / nearby / TTS)
  firebase.ts           # Firebase init + isFirebaseConfigured()
  storageService.ts     # Firestore-backed history (+ local cache, migration)
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

---

## ⚠️ Notes

- AI‑generated content may contain errors — always verify important information.
- The Gemini free tier has per‑minute/per‑day rate limits; enable billing on the
  key's Google Cloud project for production‑grade limits.

---

## 👤 Credits

Created by **[KonsKall](https://www.linkedin.com/in/konstantinos-kalliakoudis-902b90103)**.
