import { getProxyAuthToken } from './firebase';

// Builds the public share URL for a landmark. When the Worker proxy is configured
// (GEMINI_PROXY_URL), the URL points at the Worker's /s endpoint, so social platforms
// (WhatsApp, Messenger, iMessage, Telegram, Facebook, …) render ONE per-landmark Open Graph
// preview (photo + name) and the Worker 302-redirects real users to the app's deep link.
// Without a proxy (e.g. local dev) it falls back to the direct app deep link. Only the
// landmark id travels — the recipient opens it in their own language.
export function buildShareUrl(landmarkName: string): string {
  const enc = encodeURIComponent(landmarkName);
  const proxy = (process.env.GEMINI_PROXY_URL || '').replace(/\/+$/, '');
  if (proxy) return `${proxy}/s?l=${enc}`;
  return `${window.location.origin}${window.location.pathname}?l=${enc}`;
}

// In-session cache of minted short URLs, keyed by landmark name. The Worker's /shorten is
// idempotent (deterministic code), so this just spares repeat round-trips and — crucially —
// lets a share handler read a ready short URL SYNCHRONOUSLY (iOS needs navigator.share to fire
// inside the tap gesture, with no awaiting). Pre-warm with prewarmShortUrls(), read with
// getCachedShortUrl(), and the per-name in-flight set prevents duplicate concurrent mints.
const shortUrlCache = new Map<string, string>();
const shortUrlInFlight = new Set<string>();

// Synchronous read of an already-minted short URL (or null if not minted yet). Safe to call
// inside a tap handler — no await, so it never breaks the iOS share gesture.
export function getCachedShortUrl(landmarkName: string): string | null {
  return shortUrlCache.get(landmarkName) || null;
}

// Mints a SHORT share URL (…/s/<code>) via the Worker's /shorten endpoint, so the shared link
// isn't a long percent-encoded landmark name. Returns null on any failure (no proxy, no token,
// KV not configured, network error) — callers then fall back to buildShareUrl()'s long form.
// Pre-call this when a result is shown so the short URL is ready synchronously at share time.
export async function mintShortShareUrl(landmarkName: string): Promise<string | null> {
  const cached = shortUrlCache.get(landmarkName);
  if (cached) return cached;
  const proxy = (process.env.GEMINI_PROXY_URL || '').replace(/\/+$/, '');
  if (!proxy) return null;
  try {
    const token = await getProxyAuthToken();
    if (!token) return null;
    const res = await fetch(`${proxy}/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: landmarkName }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.code) return null;
    const url = `${proxy}/s/${data.code}`;
    shortUrlCache.set(landmarkName, url);
    return url;
  } catch {
    return null;
  }
}

// Fire-and-forget pre-minting of short URLs for a batch of landmarks (e.g. the visible history
// list), so each item's short URL is cached and ready when its share button is tapped. Already
// cached or in-flight names are skipped, so this is cheap to call on every render. The browser's
// per-host connection cap naturally throttles the burst.
export function prewarmShortUrls(landmarkNames: string[]): void {
  for (const name of landmarkNames) {
    if (!name || shortUrlCache.has(name) || shortUrlInFlight.has(name)) continue;
    shortUrlInFlight.add(name);
    mintShortShareUrl(name).finally(() => shortUrlInFlight.delete(name));
  }
}
