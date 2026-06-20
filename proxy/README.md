# SnapTour Gemini proxy (Cloudflare Worker)

Keeps the Gemini API key **out of the browser bundle**. The app calls this Worker instead of
Google directly; the Worker verifies the caller's **Firebase ID token** (so only our app's
users — including anonymous ones — can use it), then injects the real key and forwards the
request to the Gemini API.

100% free: Cloudflare Workers free tier (no credit card), Firebase stays on the free **Spark**
plan (token verification uses Google's public certs, **not** the Admin SDK / Cloud Functions).

## One-time setup

```bash
cd proxy
npm install

# 1) Log in to your (free) Cloudflare account
npx wrangler login

# 2) Store the real Gemini key as a secret (you'll be prompted to paste it)
npx wrangler secret put GEMINI_KEY

# 3) Deploy
npx wrangler deploy
```

`wrangler deploy` prints your Worker URL, e.g. `https://snaptour-proxy.<you>.workers.dev`.

### Also required (Firebase console, free)
- **Authentication → Sign-in method → Anonymous → Enable.**
  The app signs every visitor in anonymously so their requests carry a verifiable token.
  (Google sign-in still works and takes over when used.)

### Config (in `wrangler.toml`)
- `FIREBASE_PROJECT_ID` — your project id (default `snaptour-cd55f`). Must match the token's audience.
- `ALLOWED_ORIGINS` — comma-separated origins allowed by CORS (default `https://konskall.github.io`).
  Add `http://localhost:3000` while developing if needed.

## Turn it on in the app
Set the build variable **`GEMINI_PROXY_URL`** to the Worker URL (GitHub → Settings → Secrets and
variables → Actions → **Variables**), then redeploy the site. The app auto-switches to the proxy.

Verify a scan works end-to-end, **then** delete the `API_KEY` secret from GitHub Actions — the
key is no longer needed in the bundle. (Until `GEMINI_PROXY_URL` is set, the app keeps using the
old direct-key path, so nothing breaks.)

## Notes
- `compatibility_date` is set in `wrangler.toml`; `jose` runs on the Workers runtime via WebCrypto
  (no `nodejs_compat` flag needed).
- Per-user metering / free-tier limits can be added at the marked spot in `worker.js` using
  Workers KV or D1 (both have free tiers).
