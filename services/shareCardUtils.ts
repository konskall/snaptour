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
