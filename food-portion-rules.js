/**
 * Shared portion rules — single source of truth for prompts, validation, and scaling.
 * AI composes grams from mealBreakdown + catalog per-100g values.
 * Backend scales proportions toward the calorie target and rounds on these same steps.
 */

import { normalizeFoodKey } from './food-utils.js';
import { resolveCatalogEntry } from './food-catalog.js';

export const GRAM_ROUND_STEP = 10;
export const MAIN_GRAM_ROUND_STEP = 50;

const SMALL_ADDITIVE_KEYS = new Set([
  'зехтин', 'олио', 'ядки', 'бадеми', 'орехи', 'кашу', 'лешници', 'фъстъци', 'шамфъстък',
  'фъстъчено масло', 'бадемово масло', 'тахан', 'масло', 'кокосово масло', 'слънчогледово масло',
  'семена чиа', 'ленено семе', 'тиквени семки', 'слънчогледови семки', 'мед',
  'соев сос', 'хумус', 'горчица', 'лимонов сок', 'оцет', 'доматено пюре', 'кокосово мляко',
  'канела', 'куркума', 'джинджифил',
]);

export const COUNTABLE_UNITS = {
  'яйца': { unit: 60, singular: 'яйце', plural: 'яйца', catalog: 'Яйца' },
  'варено яйце': { unit: 60, singular: 'варено яйце', plural: 'варени яйца', catalog: 'Варено яйце' },
  'ябълка': { unit: 150, singular: 'ябълка', plural: 'ябълки', catalog: 'Ябълка' },
  'банан': { unit: 120, singular: 'банан', plural: 'банана', catalog: 'Банан' },
  'киви': { unit: 80, singular: 'киви', plural: 'киви', catalog: 'Киви' },
  'портокал': { unit: 150, singular: 'портокал', plural: 'портокали', catalog: 'Портокал' },
  'мандарина': { unit: 80, singular: 'мандарина', plural: 'мандари', catalog: 'Мандарина' },
  'праскова': { unit: 150, singular: 'праскова', plural: 'праскови', catalog: 'Праскова' },
  'круша': { unit: 150, singular: 'круша', plural: 'круши', catalog: 'Круша' },
  'грейпфрут': { unit: 200, singular: 'грейпфрут', plural: 'грейпфрута', catalog: 'Грейпфрут' },
};

export const PORTION_RULES_PROMPT =
  'Грамажи: изчисли от mealBreakdown kcal/P/C/F и стойностите на 100g в каталога. ' +
  'Основни продукти — на 50g (100, 150, 200); добавки (зехтин, ядки, подправки) — на 10g; ' +
  'яйца — 60g/бр. (напр. 2 яйца (120g)); конкретни плодове — брой × среден грамаж (напр. 1 ябълка (150g)).';

function getCatalogGroup(name) {
  const { entry } = resolveCatalogEntry(name);
  return entry?.group || null;
}

function resolveCountableKey(name) {
  const normalized = normalizeFoodKey(name);
  if (COUNTABLE_UNITS[normalized]) return normalized;
  for (const [key, spec] of Object.entries(COUNTABLE_UNITS)) {
    if (normalized === normalizeFoodKey(spec.singular) || normalized === normalizeFoodKey(spec.plural)) {
      return key;
    }
  }
  return null;
}

export function resolveCountableCatalogName(label) {
  const key = resolveCountableKey(label);
  return key ? COUNTABLE_UNITS[key].catalog : null;
}

export function getCountableSpec(item) {
  const key = resolveCountableKey(item?.key || item?.name);
  return key ? COUNTABLE_UNITS[key] : null;
}

function isSmallAdditiveItem(item) {
  if (getCatalogGroup(item?.name) === 'condiment') return true;
  return SMALL_ADDITIVE_KEYS.has(normalizeFoodKey(item?.key || item?.name));
}

export function getGramStep(item) {
  if (isSmallAdditiveItem(item)) return GRAM_ROUND_STEP;
  const countable = getCountableSpec(item);
  if (countable) return countable.unit;
  return MAIN_GRAM_ROUND_STEP;
}

export function roundGrams(grams, step = GRAM_ROUND_STEP) {
  const g = Number(grams) || 0;
  if (g <= 0) return step;
  return Math.max(step, Math.round(g / step) * step);
}

export function roundGramsForItem(item, grams) {
  const step = getGramStep(item);
  const rounded = roundGrams(grams, step);
  const countable = getCountableSpec(item);
  if (!countable) return rounded;
  const count = Math.max(1, Math.round(rounded / countable.unit));
  return count * countable.unit;
}

/** Validate one parsed item's grams against shared rules (for AI retry before backend sync). */
export function validateItemGrams(item) {
  const grams = Number(item.grams) || 0;
  if (grams <= 0) return `${item.name}: липсва грамаж`;

  const countable = getCountableSpec(item);
  if (countable) {
    if (grams % countable.unit !== 0) {
      const count = Math.max(1, Math.round(grams / countable.unit));
      const example = count === 1
        ? `1 ${countable.singular} (${countable.unit}g)`
        : `${count} ${countable.plural} (${count * countable.unit}g)`;
      return `${item.name} ${grams}g — използвай ${countable.unit}g/бр., напр. ${example}`;
    }
    return null;
  }

  const step = getGramStep(item);
  if (grams % step !== 0) {
    const nearest = roundGrams(grams, step);
    return `${item.name} ${grams}g — закръгли на ${step}g (напр. ${nearest}g)`;
  }
  return null;
}

export function formatCountableLine(item, spec) {
  const count = Math.max(1, Math.round(item.grams / spec.unit));
  const grams = count * spec.unit;
  const label = count === 1 ? spec.singular : spec.plural;
  return `• ${count} ${label} (${grams}g)`;
}

export function formatItemLine(item) {
  const spec = getCountableSpec(item);
  if (spec) return formatCountableLine(item, spec);
  return `• ${item.name} ${item.grams}g`;
}
