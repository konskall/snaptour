// Pure geo / aggregation helpers shared by the visited-places map and the travel
// passport. Kept free of React / DOM / network so they are trivially unit-testable.
import type { HistoryItem } from '../types';

// ISO 3166-1 alpha-2 → continent. Grouped by continent for readability, then
// inverted into a flat lookup. Codes that span continents are assigned their
// most common geographic grouping (e.g. Russia→Europe, Turkey→Asia, Egypt→Africa).
const CONTINENT_GROUPS: Record<string, string[]> = {
  Europe: ['al','ad','at','by','be','ba','bg','hr','cy','cz','dk','ee','fi','fr','de','gr','hu','is','ie','it','xk','lv','li','lt','lu','mt','md','mc','me','nl','mk','no','pl','pt','ro','ru','sm','rs','sk','si','es','se','ch','ua','gb','va'],
  Asia: ['af','am','az','bh','bd','bt','bn','kh','cn','ge','in','id','ir','iq','il','jp','jo','kz','kw','kg','la','lb','my','mv','mn','mm','np','kp','om','pk','ps','ph','qa','sa','sg','kr','lk','sy','tw','tj','th','tl','tr','tm','ae','uz','vn','ye','hk','mo'],
  Africa: ['dz','ao','bj','bw','bf','bi','cm','cv','cf','td','km','cg','cd','ci','dj','eg','gq','er','sz','et','ga','gm','gh','gn','gw','ke','ls','lr','ly','mg','mw','ml','mr','mu','ma','mz','na','ne','ng','rw','st','sn','sc','sl','so','za','ss','sd','tz','tg','tn','ug','zm','zw'],
  'North America': ['ag','bs','bb','bz','ca','cr','cu','dm','do','sv','gd','gt','ht','hn','jm','mx','ni','pa','kn','lc','vc','tt','us','gl','pr','bm'],
  'South America': ['ar','bo','br','cl','co','ec','gy','py','pe','sr','uy','ve','gf','fk'],
  Oceania: ['au','fj','ki','mh','fm','nr','nz','pw','pg','ws','sb','to','tv','vu','nc','pf','gu'],
  Antarctica: ['aq'],
};

const CONTINENT_BY_CC: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [continent, codes] of Object.entries(CONTINENT_GROUPS)) {
    for (const code of codes) map[code] = continent;
  }
  return map;
})();

// Continent for an ISO alpha-2 code, or null if unknown / unmapped.
export function getContinent(countryCode?: string | null): string | null {
  if (!countryCode) return null;
  return CONTINENT_BY_CC[countryCode.toLowerCase()] ?? null;
}

// Localized continent display names (the internal keys above stay English).
const CONTINENT_NAMES: Record<string, Record<string, string>> = {
  Europe: { en: 'Europe', es: 'Europa', fr: 'Europe', de: 'Europa', zh: '欧洲', hi: 'यूरोप', el: 'Ευρώπη' },
  Asia: { en: 'Asia', es: 'Asia', fr: 'Asie', de: 'Asien', zh: '亚洲', hi: 'एशिया', el: 'Ασία' },
  Africa: { en: 'Africa', es: 'África', fr: 'Afrique', de: 'Afrika', zh: '非洲', hi: 'अफ़्रीका', el: 'Αφρική' },
  'North America': { en: 'North America', es: 'América del Norte', fr: 'Amérique du Nord', de: 'Nordamerika', zh: '北美洲', hi: 'उत्तरी अमेरिका', el: 'Βόρεια Αμερική' },
  'South America': { en: 'South America', es: 'América del Sur', fr: 'Amérique du Sud', de: 'Südamerika', zh: '南美洲', hi: 'दक्षिण अमेरिका', el: 'Νότια Αμερική' },
  Oceania: { en: 'Oceania', es: 'Oceanía', fr: 'Océanie', de: 'Ozeanien', zh: '大洋洲', hi: 'ओशिनिया', el: 'Ωκεανία' },
  Antarctica: { en: 'Antarctica', es: 'Antártida', fr: 'Antarctique', de: 'Antarktis', zh: '南极洲', hi: 'अंटार्कटिका', el: 'Ανταρκτική' },
};

export function localizeContinent(continent: string, lang: string): string {
  return CONTINENT_NAMES[continent]?.[lang] ?? CONTINENT_NAMES[continent]?.en ?? continent;
}

// Best-known coordinates for a history item: the real scan GPS if it was stored,
// otherwise the model's estimate from the landmark metadata. null if neither.
export function itemCoords(item: HistoryItem): { lat: number; lng: number } | null {
  const lat = item.lat ?? item.info?.lat ?? null;
  const lng = item.lng ?? item.info?.lng ?? null;
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

// ---- Distance / direction between two coordinates (great-circle) ----
// Used by the result card to show "you're ~350 m away · NE". Pure + unit-tested.

const EARTH_RADIUS_M = 6371000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export interface LatLng { lat: number; lng: number; }

// Great-circle distance in METERS between two points (Haversine).
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Initial bearing from `a` to `b` in degrees, normalized to [0, 360) (0 = North,
// 90 = East). Meaningful as a general "which way" cue, not a phone-heading compass.
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Bearing → 8-point compass index (0 = N, 1 = NE, … 7 = NW), for the localized
// `compass8` label arrays.
export function cardinal8(bearing: number): number {
  return Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
}

export interface CountryStamp {
  code: string;   // ISO alpha-2 (for the flag), "" if unknown
  name: string;   // localized display name (most recent wins)
  count: number;  // landmarks visited in this country
}

export interface PassportStats {
  landmarks: number;        // total scanned landmarks
  countries: CountryStamp[]; // one stamp per distinct country, most-visited first
  continents: string[];     // distinct continents reached
}

// Aggregate history items into passport stats. Items are assumed newest-first
// (the store keeps them sorted), so the first display name seen for a country
// wins. Items with no country are still counted toward `landmarks`.
export function buildPassport(items: HistoryItem[]): PassportStats {
  const byCode = new Map<string, CountryStamp>();
  const continents = new Set<string>();

  for (const item of items) {
    const code = (item.info?.countryCode || '').toLowerCase();
    const name = (item.info?.country || '').trim();
    if (!code && !name) continue; // no geography on this item
    const key = code || name.toLowerCase();
    const existing = byCode.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byCode.set(key, { code, name: name || code.toUpperCase(), count: 1 });
    }
    const continent = getContinent(code);
    if (continent) continents.add(continent);
  }

  const countries = Array.from(byCode.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );

  return { landmarks: items.length, countries, continents: Array.from(continents).sort() };
}
