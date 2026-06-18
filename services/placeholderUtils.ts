// Deterministic gradient for landmark cards that have no photo, so a placeholder
// looks designed (and stable across refreshes) rather than broken. Pure helper.
const GRADIENTS = [
  'from-indigo-600 to-purple-800',
  'from-sky-600 to-blue-800',
  'from-emerald-600 to-teal-800',
  'from-amber-600 to-orange-800',
  'from-rose-600 to-pink-800',
  'from-violet-600 to-fuchsia-800',
  'from-cyan-600 to-sky-800',
  'from-teal-600 to-emerald-800',
];

// Stable index from a seed (country code or name) so the same landmark always gets
// the same colour.
export function gradientFor(seed: string): string {
  let h = 0;
  const s = seed || 'snaptour';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}
