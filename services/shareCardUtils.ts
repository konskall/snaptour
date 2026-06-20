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

// Mints a SHORT share URL (…/s/<code>) via the Worker's /shorten endpoint, so the shared link
// isn't a long percent-encoded landmark name. Returns null on any failure (no proxy, no token,
// KV not configured, network error) — callers then fall back to buildShareUrl()'s long form.
// Pre-call this when a result is shown so the short URL is ready synchronously at share time
// (iOS requires navigator.share to fire inside the tap gesture — no awaiting at tap time).
export async function mintShortShareUrl(landmarkName: string): Promise<string | null> {
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
    return data && data.code ? `${proxy}/s/${data.code}` : null;
  } catch {
    return null;
  }
}
