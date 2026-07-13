/**
 * Build-time преводи на упражнения (име + инструкции).
 * Източник: scripts/translate-exercises.mjs → data/exercise-translations-bg.json
 */

export const TRANSLATIONS_FILE = 'exercise-translations-bg.json';

/** Извлича EN текст за превод. */
export function pickInstructionsEn(instructions) {
  if (!instructions) return '';
  if (typeof instructions === 'string') return instructions.trim();
  if (Array.isArray(instructions)) return instructions.join(' ').trim();
  const raw = instructions.en || Object.values(instructions).find((v) => typeof v === 'string') || '';
  return Array.isArray(raw) ? raw.join(' ').trim() : String(raw).trim();
}

/** Връща BG ако вече съществува в dataset-а. */
export function pickInstructionsBg(instructions) {
  if (!instructions || typeof instructions !== 'object' || Array.isArray(instructions)) return '';
  const raw = instructions.bg;
  if (!raw) return '';
  return Array.isArray(raw) ? raw.join(' ').trim() : String(raw).trim();
}

/**
 * @param {object} raw — суров запис от exercises dataset
 * @param {Record<string, {nameBg?: string, instructionsBg?: string}>} translations
 */
export function translationForExercise(raw, translations = {}) {
  const id = String(raw?.id ?? '');
  return translations[id] || translations[raw?.id] || null;
}

export function mergeExerciseTranslation(entry, raw, translations = {}, maxChars = 1200) {
  const tr = translationForExercise(raw, translations);
  const instructionsBg = tr?.instructionsBg || pickInstructionsBg(raw?.instructions) || '';
  const instructionsEn = pickInstructionsEn(raw?.instructions);
  const instructions = (instructionsBg || instructionsEn).slice(0, maxChars);

  return {
    ...entry,
    nameBg: tr?.nameBg || entry.nameBg || '',
    instructions,
    instructionsLang: instructionsBg ? 'bg' : (instructionsEn ? 'en' : ''),
  };
}
