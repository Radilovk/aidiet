/** Shared food string normalization */
export function normalizeFoodKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^[•\-\*]\s*/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
