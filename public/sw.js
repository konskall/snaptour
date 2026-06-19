/* SnapTour service worker — makes the app load offline (so saved tours, which are
   reconstructed entirely from the local history cache, can be read with no network).

   Strategy:
   - Navigations: network-first, falling back to the cached app shell when offline.
   - Same-origin assets (content-hashed → immutable): cache-first; cached on first fetch.
     (This also bypasses GitHub Pages' fixed 10-minute cache on repeat visits.)
   - Google Fonts + the flag CDN: cache-first (static, helps offline).
   - Everything else (Gemini, Firebase, Google Maps, googleapis): straight to the network,
     untouched. Only GET is ever intercepted, so API writes are never affected. */

const SHELL_CACHE = 'snaptour-shell-v1';
const RUNTIME_CACHE = 'snaptour-runtime-v1';
const BASE = self.registration.scope; // e.g. https://konskall.github.io/snaptour/
const SHELL_URL = BASE;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.add(SHELL_URL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

const cacheFirst = async (req, cacheName) => {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  } catch (e) {
    return cached || Response.error();
  }
};

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept Gemini/Firestore writes etc.

  const url = new URL(req.url);

  // App navigations → network-first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(SHELL_URL, copy)).catch(() => {});
          return res;
        })
        .catch(async () => (await caches.match(SHELL_URL)) || (await caches.match(req)) || Response.error()),
    );
    return;
  }

  // Same-origin (hashed build assets, icons, manifest) → cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // Static third-party assets we control the use of → cache-first.
  if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  // Everything else: leave it to the network (no respondWith).
});
