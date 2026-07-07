/**
 * Food nutrition engine — parse meal descriptions, lookup per-100g values, calculate macros.
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
const CONDIMENT_MAX_GRAMS = 15;
// Realistic max grams per food group (prevents absurd portions, e.g. 130g nuts).
const GROUP_CAPS = {
  fat: 40, protein: 260, dairy: 400, legume: 260,
  carb: 220, vegetable: 260, fruit: 260, ready_meal: 450,
  condiment: CONDIMENT_MAX_GRAMS, default: 300,
};
// kcal-weighted so hitting P/C/F also lands calories (kcal = 4P + 4C + 9F).
const MACRO_WEIGHTS = { p: 4, c: 4, f: 9 };

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

function isReadyMealItem(item) {
  return getCatalogMeta(item.name).group === 'ready_meal';
}

function itemHasSlot(item, slot) {
  return getCatalogMeta(item.name).slots.includes(slot);
}

function itemGroup(item) {
  return getCatalogMeta(item.name).group;
}

function clampItemGrams(item, grams) {
  const group = itemGroup(item);
  const cap = GROUP_CAPS[group] || GROUP_CAPS.default;
  const min = group === 'condiment' ? GRAM_ROUND_STEP : GRAM_ROUND_STEP;
  return roundGrams(Math.min(Math.max(grams, min), cap));
}

/**
 * Balance grams toward P/C/F targets via kcal-weighted coordinate-descent least squares.
 * Robust to coupled macros (e.g. nuts add both fat and protein) and converges to 10g steps.
 * Backend owns the numbers; AI only picks products + rough grams.
 */
export function balanceItemsToMacroTargets(items, target, dessertNutrition = null) {
  if (!items.length || !target) return items;

  let targetP = Number(target.protein) || 0;
  let targetC = Number(target.carbs) || 0;
  let targetF = Number(target.fats) || 0;
  let targetKcal = Number(target.calories) || 0;

  if (dessertNutrition) {
    targetP = Math.max(0, targetP - dessertNutrition.p);
    targetC = Math.max(0, targetC - dessertNutrition.c);
    targetF = Math.max(0, targetF - dessertNutrition.f);
    targetKcal = Math.max(50, targetKcal - dessertNutrition.kcal);
  }

  const working = items.map(it => ({
    ...it,
    grams: isCondimentItem(it) ? Math.min(it.grams, CONDIMENT_MAX_GRAMS) : roundGrams(it.grams),
  }));

  // A single composite/ready meal has no separable drivers — scale by calories only.
  if (working.length === 1 && isReadyMealItem(working[0]) && targetKcal > 0) {
    return scaleItemsToTargetCalories(working, targetKcal + (dessertNutrition?.kcal || 0), dessertNutrition);
  }

  const variable = working.filter(it => !isCondimentItem(it));
  const perGram = (it) => ({ p: it.profile.p / 100, c: it.profile.c / 100, f: it.profile.f / 100 });

  // Coordinate descent: for each item solve the 1-D weighted least-squares optimum
  // holding the others fixed, then clamp+round. Repeat until stable.
  for (let iter = 0; iter < 60; iter++) {
    let maxChange = 0;
    for (const it of variable) {
      const v = perGram(it);
      const denom = MACRO_WEIGHTS.p * v.p * v.p + MACRO_WEIGHTS.c * v.c * v.c + MACRO_WEIGHTS.f * v.f * v.f;
      if (denom <= 0) continue;

      let rp = targetP, rc = targetC, rf = targetF;
      for (const other of working) {
        if (other === it) continue;
        rp -= (other.profile.p / 100) * other.grams;
        rc -= (other.profile.c / 100) * other.grams;
        rf -= (other.profile.f / 100) * other.grams;
      }

      const numer = MACRO_WEIGHTS.p * v.p * rp + MACRO_WEIGHTS.c * v.c * rc + MACRO_WEIGHTS.f * v.f * rf;
      const optimal = clampItemGrams(it, numer / denom);
      maxChange = Math.max(maxChange, Math.abs(optimal - it.grams));
      it.grams = optimal;
    }
    if (maxChange < GRAM_ROUND_STEP) break;
  }

  // Realism floor: a pure vegetable side should be a visible portion.
  for (const it of variable) {
    if (itemHasSlot(it, 'VOL') && !itemHasSlot(it, 'PRO') && !itemHasSlot(it, 'ENG') && it.grams < 50) {
      it.grams = 50;
    }
  }

  return working;
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

/** Scale item grams so total kcal approaches target (preserves product ratios). */
export function scaleItemsToTargetCalories(items, targetKcal, dessertNutrition = null) {
  if (!items.length || !targetKcal || targetKcal <= 0) return items;

  const base = sumItemNutrition(items);
  let goal = targetKcal;
  if (dessertNutrition?.kcal > 0) {
    goal = Math.max(50, targetKcal - dessertNutrition.kcal);
  }
  if (base.kcal <= 0) return items;

  const factor = goal / base.kcal;
  return items.map(item => ({
    ...item,
    grams: roundGrams(item.grams * factor),
  }));
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
    return { ...item, profile, key, unknown: !!unknown };
  });

  const dessertNutrition = (meal.dessert && typeof meal.dessert === 'object')
    ? macrosToNutritionProfile(meal.dessert.macros)
    : null;
  const dessertWeight = (meal.dessert && typeof meal.dessert === 'object' && meal.dessert.weight)
    ? parseFloat(String(meal.dessert.weight).match(/(\d+(?:\.\d+)?)/)?.[1] || '0')
    : 0;

  const targetKcal = Number(target?.calories) || Number(meal.calories) || 0;
  const hasMacroTargets = target && (Number(target.protein) > 0 || Number(target.carbs) > 0 || Number(target.fats) > 0);

  if (hasMacroTargets) {
    items = balanceItemsToMacroTargets(items, target, dessertNutrition);
  } else if (targetKcal > 0) {
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
