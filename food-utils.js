/** Shared food string normalization */

const normalizedCache = new Map();
const NORMALIZED_CACHE_MAX = 20000;

export function normalizeFoodKey(name) {
  const raw = String(name || '');
  let key = normalizedCache.get(raw);
  if (key !== undefined) return key;
  key = raw
    .toLowerCase()
    .replace(/^[•\-\*]\s*/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Имената на храни и ястия са краен набор; таванът пази от свободен текст.
  if (normalizedCache.size >= NORMALIZED_CACHE_MAX) normalizedCache.clear();
  normalizedCache.set(raw, key);
  return key;
}
