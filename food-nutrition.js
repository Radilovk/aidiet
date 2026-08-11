/**
 * Food nutrition engine — parse meal descriptions, lookup per-100g values, calculate macros.
 *
 * Division of labor:
 *   - The AI composes each meal: catalog products only (no grams/kcal/macros).
 *   - The backend solves grams deterministically (meal-solver.js) toward slot targets.
 *   - Structural infeasibility (wrong products for the macro profile) → AI retry/repair.
 */

import {
  FOOD_NUTRITION_PER_100G,
  FOOD_ALIASES,
  GENERIC_FOOD_PROFILE,
} from './food-nutrition-data.js';
import { normalizeFoodKey } from './food-utils.js';
import { resolveCatalogEntry } from './food-catalog.js';
import { FOOD_CATALOG } from './food-catalog-data.js';
import { MAX_LATE_SNACK_CALORIES, SLOT_CALORIE_TOLERANCE_PERCENT, SLOT_CALORIE_TOLERANCE_MIN_KCAL } from './plan-normalize.js';
import { solveMealGrams } from './meal-solver.js';

export { normalizeFoodKey } from './food-utils.js';

export const GRAM_ROUND_STEP = 10;
export const GRAM_ROUND_STEP_LARGE = 50;
export const GRAM_LARGE_THRESHOLD = 50;

// Adequacy contract — see plan-normalize.js SLOT_CALORIE_TOLERANCE_* (single source).
export const CALORIE_TOLERANCE_PERCENT = SLOT_CALORIE_TOLERANCE_PERCENT;
export const MACRO_TOLERANCE_PERCENT = 0.10;
const MIN_CALORIE_TOLERANCE_KCAL = SLOT_CALORIE_TOLERANCE_MIN_KCAL;
const MIN_MACRO_TOLERANCE_G = 3;

export function calorieTolerance(targetKcal) {
  return Math.max(MIN_CALORIE_TOLERANCE_KCAL, Math.round((Number(targetKcal) || 0) * CALORIE_TOLERANCE_PERCENT));
}

export function macroTolerance(targetGrams) {
  return Math.max(MIN_MACRO_TOLERANCE_G, Math.round((Number(targetGrams) || 0) * MACRO_TOLERANCE_PERCENT));
}

const CONDIMENT_MAX_GRAMS = 15;
const DAIRY_MAX_GRAMS = 300;

/** Max realistic single-meal plate weight — aligns with max plated slot (~900 kcal). */
export const MAX_MEAL_WEIGHT_GRAMS = 900;

/** Catalog ready_meal → raw product lines (weight shares, sum ≈ 1). */
const READY_MEAL_PARTS = {
  meal_rice_chicken: [{ name: 'ориз', share: 0.42 }, { name: 'пилешко месо', share: 0.58 }],
  meal_fish_potato: [{ name: 'картофи', share: 0.55 }, { name: 'риба', share: 0.45 }],
  meal_omelet: [{ name: 'яйца', share: 1 }],
  meal_boiled_egg: [{ name: 'яйца', share: 1 }],
  meal_chicken_salad: [{ name: 'пилешко месо', share: 0.55 }, { name: 'зеленчук', share: 0.45 }],
  meal_green_salad: [{ name: 'зеленчук', share: 1 }],
  meal_oatmeal: [{ name: 'овесени ядки', share: 1 }],
  meal_yogurt_oats: [{ name: 'кисело мляко', share: 0.6 }, { name: 'овесени ядки', share: 0.4 }],
  meal_chicken_soup: [{ name: 'пилешко месо', share: 0.35 }, { name: 'зеленчук', share: 0.65 }],
  meal_veg_soup: [{ name: 'зеленчук', share: 1 }],
  meal_lentil_stew: [{ name: 'леща', share: 0.7 }, { name: 'зеленчук', share: 0.3 }],
  meal_bean_stew: [{ name: 'боб', share: 0.7 }, { name: 'зеленчук', share: 0.3 }],
  meal_chicken_sandwich: [{ name: 'пилешко месо', share: 0.4 }, { name: 'хляб', share: 0.6 }],
  meal_cottage_bowl: [{ name: 'извара', share: 1 }],
  meal_skry_bowl: [{ name: 'скир', share: 1 }],
};

export function expandReadyMealItems(items, extraDb = {}) {
  const out = [];
  for (const item of items) {
    const { entry } = resolveCatalogEntry(item.name);
    if (!entry || entry.group !== 'ready_meal') {
      out.push(item);
      continue;
    }
    if (entry.genericOf) {
      const parent = FOOD_CATALOG.find(e => e.id === entry.genericOf);
      if (parent) {
        const { profile, key, unknown } = lookupFoodProfile(parent.name, extraDb);
        out.push({ ...item, name: parent.name, profile, key, unknown: !!unknown });
        continue;
      }
    }
    const parts = READY_MEAL_PARTS[entry.id];
    if (!parts?.length) {
      out.push(item);
      continue;
    }
    for (const part of parts) {
      const grams = roundGrams(item.grams * part.share);
      const { profile, key, unknown } = lookupFoodProfile(part.name, extraDb);
      out.push({ name: part.name, grams, key, profile, unknown: !!unknown });
    }
  }
  return out;
}

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
      if (m) {
        const name = m[1].trim();
        const grams = Math.max(1, Math.round(parseFloat(String(m[2]).replace(',', '.'))));
        const { profile, key, unknown } = lookupFoodProfile(name);
        items.push({ name, grams, key, profile, unknown: !!unknown });
        continue;
      }
      const name = chunk.trim();
      if (!name) continue;
      const { profile, key, unknown } = lookupFoodProfile(name);
      items.push({ name, grams: 0, key, profile, unknown: !!unknown });
    }
  }
  return expandReadyMealItems(items);
}

/** ≤50g → 10g steps; >50g → 50g steps (main foods). */
export function gramRoundStep(grams) {
  const g = Number(grams) || 0;
  return g > GRAM_LARGE_THRESHOLD ? GRAM_ROUND_STEP_LARGE : GRAM_ROUND_STEP;
}

export function roundGrams(grams, step) {
  const g = Number(grams) || 0;
  const effectiveStep = step ?? gramRoundStep(g);
  if (g <= 0) return effectiveStep;
  return Math.max(GRAM_ROUND_STEP, Math.round(g / effectiveStep) * effectiveStep);
}

function getCatalogMeta(name) {
  const { entry } = resolveCatalogEntry(name);
  if (!entry) return { slots: [], group: null };
  return { slots: entry.slots || [], group: entry.group || null };
}

function isCondimentItem(item) {
  return getCatalogMeta(item.name).group === 'condiment';
}

function isDairyItem(item) {
  return getCatalogMeta(item.name).group === 'dairy';
}

function boundsForItem(item) {
  const { group } = getCatalogMeta(item.name);
  switch (group) {
    case 'condiment': return { min: 5, max: CONDIMENT_MAX_GRAMS };
    case 'vegetable':
    case 'fruit': return { min: 30, max: 150 };
    case 'dairy':
    case 'protein': return { min: 30, max: DAIRY_MAX_GRAMS };
    default: return { min: 20, max: 400 };
  }
}

function seedGramsForItem(item, bounds) {
  if (item.grams > 0) return item.grams;
  const mid = Math.round((bounds.min + bounds.max) / 2);
  return roundGrams(mid);
}

function capCondimentGrams(item, grams) {
  return isCondimentItem(item) ? Math.min(grams, CONDIMENT_MAX_GRAMS) : grams;
}

function capItemGrams(item, grams) {
  let g = capCondimentGrams(item, grams);
  if (isDairyItem(item)) g = Math.min(g, DAIRY_MAX_GRAMS);
  const { group } = getCatalogMeta(item.name);
  if (group === 'protein') g = Math.min(g, DAIRY_MAX_GRAMS);
  return g;
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

export function formatMealDescription(items) {
  return items.map(item => `• ${item.name} ${item.grams}g`).join('\n');
}

export function formatMealWeight(totalGrams, dessertWeightGrams = 0) {
  const total = Math.round((Number(totalGrams) || 0) + (Number(dessertWeightGrams) || 0));
  if (total <= 0) return '';
  return `${total}г`;
}

/** Total plated grams from description (+ fixed dessert weight when present). */
export function mealWeightGramsFromDescription(meal) {
  if (!meal) return 0;
  const items = parseMealDescription(meal.description);
  let total = items.reduce((s, it) => s + (Number(it.grams) || 0), 0);
  if (meal.dessert && typeof meal.dessert === 'object' && meal.dessert.weight) {
    const m = String(meal.dessert.weight).match(/(\d+(?:\.\d+)?)/);
    if (m) total += parseFloat(m[1]);
  }
  return Math.round(total);
}

/**
 * Apply database nutrition to a single meal.
 * Sets description, weight, macros, calories from calculated values.
 */
export function applyMealNutritionFromDatabase(meal, target = null, extraDb = {}) {
  if (!meal || meal.type === 'Свободно хранене' || meal.type === 'Напитка') {
    return { ok: true, unknowns: [], feasible: true, reason: '' };
  }

  let items = parseMealDescription(meal.description);
  if (!items.length) {
    return { ok: false, unknowns: ['no-parsed-items'], feasible: false, reason: 'липсват продукти' };
  }

  items = items.map(item => {
    const { profile, key, unknown } = lookupFoodProfile(item.name, extraDb);
    const bounds = boundsForItem({ ...item, name: item.name });
    const grams = seedGramsForItem({ ...item, profile }, bounds);
    return { ...item, profile, key, unknown: !!unknown, grams: capItemGrams({ ...item, name: item.name }, grams) };
  });

  const dessertNutrition = (meal.dessert && typeof meal.dessert === 'object')
    ? macrosToNutritionProfile(meal.dessert.macros)
    : null;
  const dessertWeight = (meal.dessert && typeof meal.dessert === 'object' && meal.dessert.weight)
    ? parseFloat(String(meal.dessert.weight).match(/(\d+(?:\.\d+)?)/)?.[1] || '0')
    : 0;

  const slotTarget = {
    kcal: Number(target?.calories) || Number(meal.calories) || 0,
    p: Math.max(0, (Number(target?.protein) || 0) - (dessertNutrition?.p || 0)),
    c: Math.max(0, (Number(target?.carbs) || 0) - (dessertNutrition?.c || 0)),
    f: Math.max(0, (Number(target?.fats) || 0) - (dessertNutrition?.f || 0)),
  };
  if (dessertNutrition?.kcal > 0) {
    slotTarget.kcal = Math.max(50, slotTarget.kcal - dessertNutrition.kcal);
  }

  const bounds = items.map(it => boundsForItem(it));
  const solved = solveMealGrams(items, slotTarget, bounds, MAX_MEAL_WEIGHT_GRAMS);
  items = items.map((it, i) => ({ ...it, grams: capItemGrams(it, solved.grams[i]) }));

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

  if (meal.type === 'Хранене 5') {
    const cap = Math.min(MAX_LATE_SNACK_CALORIES, Number(target?.calories) || MAX_LATE_SNACK_CALORIES);
    if (meal.calories > cap) {
      const ratio = cap / meal.calories;
      p = Math.round(p * ratio);
      c = Math.round(c * ratio);
      f = Math.round(f * ratio);
      meal.macros = { protein: p, carbs: c, fats: f };
      meal.calories = Math.round(p * 4 + c * 4 + f * 9);
    }
  }

  return {
    ok: true,
    unknowns: totals.unknowns,
    feasible: solved.feasible,
    reason: solved.reason || '',
  };
}

/** Sync nutrition for all meals in a weekPlan chunk. Returns unknown product names and infeasible slots. */
export function syncWeekPlanNutritionFromDatabase(weekPlan, strategy, startDay, endDay, extraDb = {}) {
  const unknowns = [];
  const infeasible = [];
  if (!weekPlan || !strategy?.weeklyScheme) return { unknowns, infeasible };

  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (let d = startDay; d <= endDay; d++) {
    const day = weekPlan[`day${d}`];
    const dayTarget = strategy.weeklyScheme[dayKeys[d - 1]];
    if (!day?.meals?.length) continue;

    for (const meal of day.meals) {
      const target = dayTarget?.mealBreakdown?.find(m => m.type === meal.type) || null;
      const result = applyMealNutritionFromDatabase(meal, target, extraDb);
      if (result.unknowns?.length) unknowns.push(...result.unknowns);
      if (result.feasible === false) {
        infeasible.push({ day: d, type: meal.type, reason: result.reason || 'неосъществим слот' });
      }
    }
  }
  return { unknowns: [...new Set(unknowns)], infeasible };
}

export function profileToKvArray(profile) {
  return [profile.kcal, profile.p, profile.c, profile.f];
}

export function kvArrayToProfile(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return null;
  return { kcal: arr[0], p: arr[1], c: arr[2], f: arr[3] };
}
