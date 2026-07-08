/**
 * Food nutrition engine — parse meal descriptions, lookup per-100g values, calculate macros.
 *
 * Division of labor (deliberately simple):
 *   - The AI composes each meal: products + grams. Culinary sense is its job.
 *   - The backend owns the arithmetic: macros/kcal are always computed FROM the grams
 *     via this database, then all grams are scaled by ONE shared factor to the meal's
 *     calorie target (composition and ratios stay exactly as the AI wrote them).
 *   - One bounded exception: protein drivers may be pre-adjusted ±20% toward the
 *     protein target before scaling (protein is the macro clients actually track).
 * There is NO per-item macro solver and NO product add/remove "repair" here — those
 * produced distorted portions and absurd combinations; structural product problems
 * are the AI-retry path's job, with precise validation errors.
 */

import {
  FOOD_NUTRITION_PER_100G,
  FOOD_ALIASES,
  GENERIC_FOOD_PROFILE,
} from './food-nutrition-data.js';
import { normalizeFoodKey } from './food-utils.js';
import { resolveCatalogEntry } from './food-catalog.js';

export { normalizeFoodKey } from './food-utils.js';

export const GRAM_ROUND_STEP = 10;

// Percentage-based validation tolerance: calories are the backend's own arithmetic
// (scaling guarantees them except in pathological cases), macros follow the AI's
// product mix so they get more slack. A small absolute floor keeps tiny targets
// from becoming impossibly strict.
export const CALORIE_TOLERANCE_PERCENT = 0.05;
export const MACRO_TOLERANCE_PERCENT = 0.10;
const MIN_CALORIE_TOLERANCE_KCAL = 25;
const MIN_MACRO_TOLERANCE_G = 3;

export function calorieTolerance(targetKcal) {
  return Math.max(MIN_CALORIE_TOLERANCE_KCAL, Math.round((Number(targetKcal) || 0) * CALORIE_TOLERANCE_PERCENT));
}

export function macroTolerance(targetGrams) {
  return Math.max(MIN_MACRO_TOLERANCE_G, Math.round((Number(targetGrams) || 0) * MACRO_TOLERANCE_PERCENT));
}

const CONDIMENT_MAX_GRAMS = 15;

const GRAM_LINE_RE = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(g|г)\b(?:\s*[—\-]\s*(.+))?$/i;

/** @typedef {{ kcal: number, p: number, c: number, f: number }} NutritionProfile */
/** @typedef {{ name: string, grams: number, key: string, profile: NutritionProfile, unknown?: boolean }} ParsedFoodItem */

function arrayToProfile(arr) {
  return { kcal: arr[0], p: arr[1], c: arr[2], f: arr[3] };
}

function buildDbIndex(extraDb = {}) {
  const index = new Map();
  for (const [rawKey, values] of Object.entries(FOOD_NUTRITION_PER_100G)) {
    index.set(normalizeFoodKey(rawKey), arrayToProfile(values));
  }
  for (const [rawKey, values] of Object.entries(extraDb)) {
    if (Array.isArray(values)) index.set(normalizeFoodKey(rawKey), arrayToProfile(values));
    else if (values && typeof values === 'object') index.set(normalizeFoodKey(rawKey), values);
  }
  return index;
}

/**
 * Lookup nutrition profile by product name (exact → alias → substring).
 */
export function lookupFoodProfile(name, extraDb = {}, { strictCatalog = true } = {}) {
  const index = buildDbIndex(extraDb);
  const normalized = normalizeFoodKey(name);
  if (!normalized) {
    return { profile: arrayToProfile(GENERIC_FOOD_PROFILE), key: 'generic', unknown: true };
  }

  const catalogHit = resolveCatalogEntry(name);
  if (catalogHit.entry) {
    const catalogKey = normalizeFoodKey(catalogHit.entry.nutritionKey);
    if (index.has(catalogKey)) {
      return { profile: index.get(catalogKey), key: catalogHit.entry.name, unknown: false };
    }
  } else if (strictCatalog) {
    return { profile: arrayToProfile(GENERIC_FOOD_PROFILE), key: normalized, unknown: true };
  }

  const aliasTarget = FOOD_ALIASES[normalized];
  if (aliasTarget) {
    const aliasKey = normalizeFoodKey(aliasTarget);
    if (index.has(aliasKey)) {
      return { profile: index.get(aliasKey), key: aliasTarget, unknown: false };
    }
  }

  if (index.has(normalized)) {
    return { profile: index.get(normalized), key: normalized, unknown: false };
  }

  let bestKey = '';
  let bestLen = 0;
  for (const [key] of index) {
    if (key.length < 3) continue;
    if (normalized.includes(key) || key.includes(normalized)) {
      if (key.length > bestLen) {
        bestLen = key.length;
        bestKey = key;
      }
    }
  }
  if (bestKey) {
    return { profile: index.get(bestKey), key: bestKey, unknown: false };
  }

  return { profile: arrayToProfile(GENERIC_FOOD_PROFILE), key: normalized, unknown: true };
}

/** Parse meal.description into product + gram rows. */
export function parseMealDescription(description) {
  const items = [];
  if (!description) return items;

  let lines = String(description).split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0].includes(';')) {
    lines = lines[0].split(';').map(s => s.trim()).filter(Boolean);
  }

  for (const line of lines) {
    const chunks = line.split(';').map(s => s.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean);
    for (const chunk of chunks) {
      const m = chunk.match(GRAM_LINE_RE);
      if (!m) continue;
      const name = m[1].trim();
      const grams = Math.max(1, Math.round(parseFloat(String(m[2]).replace(',', '.'))));
      const { profile, key, unknown } = lookupFoodProfile(name);
      items.push({ name, grams, key, profile, unknown: !!unknown });
    }
  }
  return items;
}

export function roundGrams(grams, step = GRAM_ROUND_STEP) {
  const g = Number(grams) || 0;
  if (g <= 0) return step;
  return Math.max(step, Math.round(g / step) * step);
}

function getCatalogMeta(name) {
  const { entry } = resolveCatalogEntry(name);
  if (!entry) return { slots: [], group: null };
  return { slots: entry.slots || [], group: entry.group || null };
}

function isCondimentItem(item) {
  return getCatalogMeta(item.name).group === 'condiment';
}

function capCondimentGrams(item, grams) {
  return isCondimentItem(item) ? Math.min(grams, CONDIMENT_MAX_GRAMS) : grams;
}

export function nutritionFromGrams(profile, grams) {
  const factor = (Number(grams) || 0) / 100;
  const p = profile.p * factor;
  const c = profile.c * factor;
  const f = profile.f * factor;
  return {
    p,
    c,
    f,
    kcal: Math.round(p * 4 + c * 4 + f * 9),
  };
}

export function sumItemNutrition(items) {
  return items.reduce(
    (acc, item) => {
      const n = nutritionFromGrams(item.profile, item.grams);
      acc.p += n.p;
      acc.c += n.c;
      acc.f += n.f;
      acc.kcal += n.kcal;
      acc.grams += item.grams;
      if (item.unknown) acc.unknowns.push(item.name);
      return acc;
    },
    { p: 0, c: 0, f: 0, kcal: 0, grams: 0, unknowns: [] }
  );
}

export function macrosToNutritionProfile(macros) {
  if (!macros) return { p: 0, c: 0, f: 0, kcal: 0 };
  const p = Number(macros.protein) || 0;
  const c = Number(macros.carbs) || 0;
  const f = Number(macros.fats) || 0;
  return { p, c, f, kcal: Math.round(p * 4 + c * 4 + f * 9) };
}

// The single bounded macro lever: protein drivers may move ±20% toward the protein
// target before calorie scaling. One factor across all drivers, so a chicken+rice
// dish stays the same dish with a slightly bigger/smaller chicken portion.
export const PROTEIN_ADJUST_MAX_PERCENT = 0.2;

function isProteinDriverItem(item) {
  if (getCatalogMeta(item.name).slots.includes('PRO')) return true;
  return (Number(item.profile?.p) || 0) >= 15; // fallback for non-catalog items
}

export function adjustProteinItemsTowardTarget(items, targetProtein) {
  const goal = Number(targetProtein) || 0;
  if (goal <= 0 || !items.length) return items;

  const totals = sumItemNutrition(items);
  const deficit = goal - totals.p;
  if (Math.abs(deficit) <= macroTolerance(goal)) return items;

  const driverProtein = items.reduce(
    (sum, it) => sum + (isProteinDriverItem(it) && !isCondimentItem(it) ? (it.profile.p / 100) * it.grams : 0),
    0
  );
  if (driverProtein <= 0) return items;

  const factor = Math.min(
    1 + PROTEIN_ADJUST_MAX_PERCENT,
    Math.max(1 - PROTEIN_ADJUST_MAX_PERCENT, (driverProtein + deficit) / driverProtein)
  );
  return items.map(it =>
    isProteinDriverItem(it) && !isCondimentItem(it)
      ? { ...it, grams: roundGrams(it.grams * factor) }
      : it
  );
}

// Stability guards for calorie scaling: a wildly under/over-portioned AI pick gets
// capped instead of blown up into an implausible plate (validation then reports the
// residual gap and the AI retries); rounding nudges keep the composition recognizable.
export const SCALE_FACTOR_MIN = 0.5;
export const SCALE_FACTOR_MAX = 3;
const RESIDUAL_STOP_KCAL = 20;
const MAX_NUDGE_STEPS_PER_ITEM = 3;

/**
 * Scale item grams so total kcal approaches target with ONE shared factor —
 * preserves the AI's product ratios. After 10g rounding, items are nudged one
 * step at a time toward the goal (an oil line is ~88kcal per step, so plain
 * rounding alone can leave a visible kcal gap).
 */
export function scaleItemsToTargetCalories(items, targetKcal, dessertNutrition = null) {
  if (!items.length || !targetKcal || targetKcal <= 0) return items;

  const base = sumItemNutrition(items);
  let goal = targetKcal;
  if (dessertNutrition?.kcal > 0) {
    goal = Math.max(50, targetKcal - dessertNutrition.kcal);
  }
  if (base.kcal <= 0) return items;

  const factor = Math.min(SCALE_FACTOR_MAX, Math.max(SCALE_FACTOR_MIN, goal / base.kcal));
  const scaled = items.map(item => ({
    ...item,
    grams: capCondimentGrams(item, roundGrams(item.grams * factor)),
  }));

  const nudges = new Map();
  for (let guard = 0; guard < 12; guard++) {
    const residual = goal - sumItemNutrition(scaled).kcal;
    if (Math.abs(residual) <= RESIDUAL_STOP_KCAL) break;
    const dir = Math.sign(residual);

    let best = null;
    let bestAbs = Math.abs(residual);
    for (const item of scaled) {
      const nextGrams = item.grams + GRAM_ROUND_STEP * dir;
      if (nextGrams < GRAM_ROUND_STEP) continue;
      if (isCondimentItem(item) && nextGrams > CONDIMENT_MAX_GRAMS) continue;
      if ((nudges.get(item) || 0) >= MAX_NUDGE_STEPS_PER_ITEM) continue;
      const stepKcal = ((Number(item.profile.kcal) || (item.profile.p * 4 + item.profile.c * 4 + item.profile.f * 9)) / 100) * GRAM_ROUND_STEP * dir;
      const abs = Math.abs(residual - stepKcal);
      if (abs < bestAbs) {
        bestAbs = abs;
        best = item;
      }
    }

    if (!best) break;
    best.grams += GRAM_ROUND_STEP * dir;
    nudges.set(best, (nudges.get(best) || 0) + 1);
  }

  return scaled;
}

export function formatMealDescription(items) {
  return items.map(item => `• ${item.name} ${item.grams}g`).join('\n');
}

export function formatMealWeight(totalGrams, dessertWeightGrams = 0) {
  const total = Math.round((Number(totalGrams) || 0) + (Number(dessertWeightGrams) || 0));
  if (total <= 0) return '';
  return `${total}г`;
}

/**
 * Apply database nutrition to a single meal.
 * Sets description, weight, macros, calories from calculated values.
 */
export function applyMealNutritionFromDatabase(meal, target = null, extraDb = {}) {
  if (!meal || meal.type === 'Свободно хранене' || meal.type === 'Напитка') {
    return { ok: true, unknowns: [] };
  }

  let items = parseMealDescription(meal.description);
  if (!items.length) {
    return { ok: false, unknowns: ['no-parsed-items'] };
  }

  items = items.map(item => {
    const { profile, key, unknown } = lookupFoodProfile(item.name, extraDb);
    return { ...item, profile, key, unknown: !!unknown, grams: capCondimentGrams(item, item.grams) };
  });

  const dessertNutrition = (meal.dessert && typeof meal.dessert === 'object')
    ? macrosToNutritionProfile(meal.dessert.macros)
    : null;
  const dessertWeight = (meal.dessert && typeof meal.dessert === 'object' && meal.dessert.weight)
    ? parseFloat(String(meal.dessert.weight).match(/(\d+(?:\.\d+)?)/)?.[1] || '0')
    : 0;

  const targetKcal = Number(target?.calories) || Number(meal.calories) || 0;
  const proteinGoal = Math.max(0, (Number(target?.protein) || 0) - (dessertNutrition?.p || 0));

  if (proteinGoal > 0) {
    items = adjustProteinItemsTowardTarget(items, proteinGoal);
  }
  if (targetKcal > 0) {
    items = scaleItemsToTargetCalories(items, targetKcal, dessertNutrition);
  }

  const totals = sumItemNutrition(items);
  let p = Math.round(totals.p);
  let c = Math.round(totals.c);
  let f = Math.round(totals.f);

  if (dessertNutrition) {
    p += Math.round(dessertNutrition.p);
    c += Math.round(dessertNutrition.c);
    f += Math.round(dessertNutrition.f);
  }

  meal.description = formatMealDescription(items);
  meal.weight = formatMealWeight(totals.grams, dessertWeight);
  meal.macros = { protein: p, carbs: c, fats: f };
  meal.calories = Math.round(p * 4 + c * 4 + f * 9);

  return { ok: true, unknowns: totals.unknowns };
}

/** Sync nutrition for all meals in a weekPlan chunk. Returns unknown product names. */
export function syncWeekPlanNutritionFromDatabase(weekPlan, strategy, startDay, endDay, extraDb = {}) {
  const unknowns = [];
  if (!weekPlan || !strategy?.weeklyScheme) return unknowns;

  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (let d = startDay; d <= endDay; d++) {
    const day = weekPlan[`day${d}`];
    const dayTarget = strategy.weeklyScheme[dayKeys[d - 1]];
    if (!day?.meals?.length) continue;

    for (const meal of day.meals) {
      const target = dayTarget?.mealBreakdown?.find(m => m.type === meal.type) || null;
      const result = applyMealNutritionFromDatabase(meal, target, extraDb);
      if (result.unknowns?.length) unknowns.push(...result.unknowns);
    }
  }
  return [...new Set(unknowns)];
}

export function profileToKvArray(profile) {
  return [profile.kcal, profile.p, profile.c, profile.f];
}

export function kvArrayToProfile(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return null;
  return { kcal: arr[0], p: arr[1], c: arr[2], f: arr[3] };
}
