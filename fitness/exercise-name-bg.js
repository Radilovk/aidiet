/**
 * Нормализация на EN имена + филтър за полово-специфични варианти в dataset-а.
 */
import { normalizeText } from './normalize.js';

/** (male), (female), (men), (women) и български варианти */
export const GENDER_SPECIFIC_NAME_RE = /\((male|female|men|women|man|woman|мъж|жена|мъже|жени)\)/i;

/** Версии/маркери, които махаме преди превод или match */
const VERSION_SUFFIX_RE = /\s+v\.?\s*\d+\s*$/i;

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isGenderSpecificExerciseName(name) {
  return GENDER_SPECIFIC_NAME_RE.test(String(name || ''));
}

/**
 * Неутрално име за превод/lookup — без (male)/(female) и v.2.
 * @param {string} name
 * @returns {string}
 */
export function neutralExerciseName(name) {
  return String(name || '')
    .replace(GENDER_SPECIFIC_NAME_RE, '')
    .replace(VERSION_SUFFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ключ за речник/патърн match.
 * @param {string} name
 */
export function exerciseNameLookupKey(name) {
  return normalizeText(neutralExerciseName(name));
}
