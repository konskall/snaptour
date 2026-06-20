// SnapTour Gemini proxy — Cloudflare Worker (free tier, no card).
//
// Why: the Gemini API key must NOT ship in the static GitHub Pages bundle. This Worker
// holds the key server-side and forwards requests to the Gemini API. To stop anyone from
// using it as a free Gemini gateway, every request must carry a valid Firebase ID token
// (the app signs users in — anonymously if they haven't used Google). We verify that token
// against Google's public certs (no Firebase Admin SDK / no Blaze plan needed), then inject
// the real key and forward.
//
// Secrets / vars (see wrangler.toml + README):
//   GEMINI_KEY           (secret)  — the real Gemini API key
//   FIREBASE_PROJECT_ID  (var)     — e.g. "snaptour-cd55f" (the token audience/issuer)
//   ALLOWED_ORIGINS      (var)     — comma-separated allowed origins for CORS

import { importX509, jwtVerify, decodeProtectedHeader } from 'jose';

const GEMINI = 'https://generativelanguage.googleapis.com';
// Public X.509 certs for Firebase Auth ID tokens (rotate ~daily; we cache per Cache-Control).
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache = { keys: null, exp: 0 };

async function getCerts() {
  if (certCache.keys && Date.now() < certCache.exp) return certCache.keys;
  const res = await fetch(CERTS_URL);
  const keys = await res.json();
  const m = (res.headers.get('cache-control') || '').match(/max-age=(\d+)/);
  certCache = { keys, exp: Date.now() + (m ? parseInt(m[1], 10) * 1000 : 3600_000) };
  return keys;
}

// Returns the uid if the Firebase ID token is valid, else null. Never throws.
async function verifyFirebaseToken(token, projectId) {
  try {
    const { kid } = decodeProtectedHeader(token);
    const pem = (await getCerts())[kid];
    if (!pem) return null;
    const key = await importX509(pem, 'RS256');
    const { payload } = await jwtVerify(token, key, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

function corsHeaders(req, allowed) {
  const origin = req.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  // Fail-CLOSED: only emit Allow-Origin for an explicitly-allowed origin. If ALLOWED_ORIGINS
  // is unset/empty, nothing matches → no CORS header → browsers from any origin are blocked.
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    // Reflect the headers the SDK asks for (x-goog-api-key, x-goog-api-client, authorization, …)
    // so we stay robust to SDK header changes. Returned ONLY for an allowed origin, so there is
    // no cross-origin abuse surface (the real gate is the Allow-Origin match + the token check).
    headers['Access-Control-Allow-Headers'] =
      req.headers.get('Access-Control-Request-Headers')
      || 'authorization, content-type, x-goog-api-key, x-goog-api-client';
  }
  return headers;
}

export default {
  async fetch(req, env) {
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = corsHeaders(req, allowed);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors });
    }

    // 1) Authenticate: only our app's users (incl. anonymous) may call.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const uid = token ? await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID) : null;
    if (!uid) {
      return new Response(JSON.stringify({ error: { message: 'Unauthorized: missing/invalid token' } }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // 2) [future] per-uid metering / free-tier limits go here (Workers KV / D1).

    // 3) Forward to Gemini with the REAL key (never trust a client-supplied ?key=).
    const inUrl = new URL(req.url);
    inUrl.searchParams.delete('key');
    const target = GEMINI + inUrl.pathname + (inUrl.search || '');
    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
        body: await req.text(),
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: { message: 'Upstream fetch failed' } }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // 4) Stream the response straight back (preserves time-to-first-byte for streaming).
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
