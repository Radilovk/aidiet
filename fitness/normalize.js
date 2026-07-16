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
