/** Нормализация на текст за matching и tag extraction. */
export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-я\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text) {
  const norm = normalizeText(text);
  return norm ? norm.split(' ') : [];
}

/**
 * Token overlap score: брой съвпадащи думи / max(думи в заявката, думи в кандидата).
 */
export function tokenOverlapScore(queryTokens, candidateTokens) {
  if (!queryTokens?.length || !candidateTokens?.length) return 0;
  const candidateSet = new Set(candidateTokens);
  let overlap = 0;
  for (const token of new Set(queryTokens)) {
    if (candidateSet.has(token)) overlap++;
  }
  return overlap / Math.max(new Set(queryTokens).size, candidateSet.size);
}
