// Fetch a real representative photo for a landmark from the Wikipedia REST summary
// API (CORS-enabled, no key). Used for entries that have no user photo — "Near me
// now" picks and shared deep links — so they show an actual image instead of an empty
// placeholder. Always resolves to null on any failure (offline, 404, timeout) so the
// caller can fall back to the designed placeholder.
//
// The endpoint returns ~320px Commons thumbnails and sends Access-Control-Allow-Origin: *
// (verified). English Wikipedia gives the best hit-rate; localized/long names often
// miss and gracefully fall back.
export async function fetchLandmarkImage(name: string, timeoutMs = 3500): Promise<string | null> {
  // Identification names look like "Acropolis of Athens, Greece (Ακρόπολη Αθηνών)".
  // Strip the ", City, Country" tail and any "(...)" so the title matches a wiki page.
  const title = (name || '').split(/[,(]/)[0].trim();
  if (!title) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const src = data?.thumbnail?.source;
    return typeof src === 'string' && /^https:\/\//.test(src) ? src : null;
  } catch {
    return null; // offline / aborted / parse error → caller uses the placeholder
  } finally {
    clearTimeout(timer);
  }
}
