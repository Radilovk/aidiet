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

/** AI/каталог bodyPart → стойност от exercises-dataset за matchExercise. */
const BODY_PART_MATCH_ALIASES = {
  core: 'waist',
  abs: 'waist',
  abdominals: 'waist',
  abdominal: 'waist',
  obliques: 'waist',
};

export function normalizeBodyPartForMatch(bodyPart) {
  const norm = normalizeText(bodyPart);
  return BODY_PART_MATCH_ALIASES[norm] || norm;
}

/** Дали bodyPart hint-ът е съвместим с записа (body_part / target от dataset). */
export function exerciseMatchesBodyHint(bodyPart, entry) {
  const norm = normalizeBodyPartForMatch(bodyPart);
  if (!norm || !entry) return false;
  const parts = new Set([entry.bodyNorm, entry.targetNorm].filter(Boolean));
  if (parts.has(norm)) return true;
  if (norm === 'waist' && parts.has('abs')) return true;
  return false;
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
