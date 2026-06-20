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

// ---- Share-link route (GET /s) --------------------------------------------------------
// A shared SnapTour link is routed through this Worker so social crawlers get a
// per-landmark Open Graph preview (photo + name) — something a static GitHub Pages SPA
// can't give them (crawlers don't run the app's JS). Real users are 302-redirected to the
// app's deep link so it opens that landmark. Needs no secret, no token, no KV.
const DEFAULT_APP_URL = 'https://konskall.github.io/snaptour/';
const DEFAULT_OG_IMAGE = 'https://konskall.github.io/snaptour/ogsnaptour.jpg?v=4';
const CRAWLER_RE = /facebookexternalhit|facebot|twitterbot|telegrambot|telegram|whatsapp|slackbot|slack-imgproxy|discordbot|linkedinbot|pinterest|redditbot|googlebot|google-inspectiontool|bingbot|applebot|vkshare|embedly|quora|showyoubot|outbrain|skypeuripreview|nuzzel|flipboard|bitlybot|tumblr|mastodon|line-poker|yandex|petalbot/i;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Best-effort representative image for a landmark, from Wikipedia (edge-cached). Returns null
// on miss so the caller can fall back to the default SnapTour social image.
async function wikiImage(name) {
  const q = (name || '').replace(/\s*\(.*?\)\s*/g, ' ').split(',')[0].trim();
  if (!q) return null;
  const lang = /[Ͱ-Ͽ]/.test(q) ? 'el' : 'en'; // Greek → el.wikipedia, else en
  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'SnapTour/1.0 (link preview)' }, cf: { cacheTtl: 86400, cacheEverything: true } },
    );
    if (!res.ok) return null;
    const j = await res.json();
    return j?.originalimage?.source || j?.thumbnail?.source || null;
  } catch {
    return null;
  }
}

async function handleShare(url, req, env) {
  const appBase = env.APP_URL || DEFAULT_APP_URL;
  // /s/<code> → resolve the landmark from KV (short links). /s?l=<name> → name in the query
  // (fallback / old links). If KV isn't configured, the /s/<code> form just yields an empty name.
  let name = '';
  let hl = '';
  const codeMatch = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{1,32})$/);
  if (codeMatch && env.LINKS) {
    const raw = await env.LINKS.get(codeMatch[1]);
    if (raw) { try { const o = JSON.parse(raw); name = (o.name || '').slice(0, 200); hl = (o.hl || '').slice(0, 5); } catch { /* ignore */ } }
  } else {
    name = (url.searchParams.get('l') || '').slice(0, 200);
    hl = (url.searchParams.get('hl') || '').slice(0, 5);
  }

  // The app deep link the recipient ultimately opens.
  const dest = new URL(appBase);
  if (name) dest.searchParams.set('l', name);
  if (hl) dest.searchParams.set('hl', hl);
  const destStr = dest.toString();

  // Humans → straight to the app. Only crawlers get the OG HTML.
  if (!CRAWLER_RE.test(req.headers.get('User-Agent') || '')) {
    return Response.redirect(destStr, 302);
  }

  const title = name ? `${name} · SnapTour` : 'SnapTour - AI Landmark Recognition & Audio Tours';
  const desc = name
    ? `Discover ${name} with SnapTour — AI landmark recognition & narrated audio tours.`
    : 'Discover landmark history instantly with AI recognition & narrated audio tours.';
  const image = (await wikiImage(name)) || DEFAULT_OG_IMAGE;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="SnapTour">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(destStr)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(destStr)}">
<meta http-equiv="refresh" content="0; url=${esc(destStr)}">
</head><body>
<p>Opening ${esc(name || 'SnapTour')}… <a href="${esc(destStr)}">Tap here if it doesn't open.</a></p>
<script>location.replace(${JSON.stringify(destStr)});</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}

// Short-link minter: stores a random code → {name, hl} in KV so a shared URL is tiny
// (…/s/<code>) instead of carrying a long percent-encoded landmark name. Requires a valid
// Firebase token (our app's users) to prevent abuse. If no KV is bound, returns 503 so the
// app gracefully falls back to the long /s?l= URL.
function randomCode(n) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

async function handleShorten(req, env, cors) {
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
  if (!env.LINKS) return json({ error: 'KV not configured' }, 503); // app falls back to the long URL
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const uid = token ? await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID) : null;
  if (!uid) return json({ error: 'Unauthorized' }, 401);
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const name = (body.name || '').toString().slice(0, 200);
  if (!name) return json({ error: 'Missing name' }, 400);
  const hl = (body.hl || '').toString().slice(0, 5);
  const code = randomCode(7);
  // Codes auto-expire after a year so KV never grows unbounded (it's tiny anyway).
  await env.LINKS.put(code, JSON.stringify({ name, hl }), { expirationTtl: 60 * 60 * 24 * 365 });
  return json({ code }, 200);
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
    // Share-link route: handled before the Gemini-proxy auth/CORS path (no token needed).
    const url = new URL(req.url);
    if (req.method === 'GET' && (url.pathname === '/s' || url.pathname.startsWith('/s/'))) {
      return handleShare(url, req, env);
    }

    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = corsHeaders(req, allowed);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Short-link minter (POST /shorten) — auth'd, writes the code→landmark mapping to KV.
    if (req.method === 'POST' && url.pathname === '/shorten') {
      return handleShorten(req, env, cors);
    }
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
