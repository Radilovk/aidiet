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
import { FOOD_CATALOG } from './food-catalog-data.js';
import { MAX_LATE_SNACK_CALORIES, SLOT_CALORIE_TOLERANCE_PERCENT, SLOT_CALORIE_TOLERANCE_MIN_KCAL } from './plan-normalize.js';

export { normalizeFoodKey } from './food-utils.js';

export const GRAM_ROUND_STEP = 10;

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

/** Max realistic single-meal plate weight — athlete mains with veg-heavy AI picks must stay under this. */
export const MAX_MEAL_WEIGHT_GRAMS = 800;
const BULK_ITEM_MAX_GRAMS = 150;
const BULK_KCAL_PER_100G_MAX = 50;

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
      if (!m) continue;
      const name = m[1].trim();
      const grams = Math.max(1, Math.round(parseFloat(String(m[2]).replace(',', '.'))));
      const { profile, key, unknown } = lookupFoodProfile(name);
      items.push({ name, grams, key, profile, unknown: !!unknown });
    }
  }
  return expandReadyMealItems(items);
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

function isDairyItem(item) {
  return getCatalogMeta(item.name).group === 'dairy';
}

function isPortionCappedProtein(item) {
  if (isBulkItem(item)) return false;
  const { group, slots } = getCatalogMeta(item.name);
  if (group === 'dairy') return false;
  return group === 'protein' || slots?.includes('PRO');
}

function capCondimentGrams(item, grams) {
  return isCondimentItem(item) ? Math.min(grams, CONDIMENT_MAX_GRAMS) : grams;
}

function capItemGrams(item, grams) {
  let g = capCondimentGrams(item, grams);
  if (isDairyItem(item) || isPortionCappedProtein(item)) g = Math.min(g, DAIRY_MAX_GRAMS);
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

function kcalPer100(item) {
  const p = item.profile;
  if (!p) return 0;
  return p.kcal || (p.p * 4 + p.c * 4 + p.f * 9);
}

/** Volume fillers — cap portions; calorie-dense items carry the target. */
function isBulkItem(item) {
  const { group, slots } = getCatalogMeta(item.name);
  if (group === 'vegetable' || group === 'fruit') return true;
  if (slots?.includes('VOL')) return true;
  const k = kcalPer100(item);
  return k > 0 && k < BULK_KCAL_PER_100G_MAX;
}

function sumGrams(items) {
  return items.reduce((s, it) => s + (Number(it.grams) || 0), 0);
}

function nudgeItemsTowardKcal(items, goal) {
  const scaled = items.map(item => ({ ...item }));
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
      if (isBulkItem(item) && nextGrams > BULK_ITEM_MAX_GRAMS) continue;
      if ((nudges.get(item) || 0) >= MAX_NUDGE_STEPS_PER_ITEM) continue;
      const stepKcal = (kcalPer100(item) / 100) * GRAM_ROUND_STEP * dir;
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

function trimToMaxWeight(items) {
  const working = items.map(i => ({ ...i }));
  let total = sumGrams(working);
  if (total <= MAX_MEAL_WEIGHT_GRAMS) return working;

  // Large overshoot: proportional trim (step-trim alone caps at ~24×10g reduction).
  if (total > MAX_MEAL_WEIGHT_GRAMS) {
    const ratio = MAX_MEAL_WEIGHT_GRAMS / total;
    const proportional = working.map(item => ({
      ...item,
      grams: capItemGrams(item, Math.max(GRAM_ROUND_STEP, roundGrams(item.grams * ratio))),
    }));
    if (sumGrams(proportional) <= MAX_MEAL_WEIGHT_GRAMS) return proportional;
    working.splice(0, working.length, ...proportional);
  }

  for (let guard = 0; guard < 24 && sumGrams(working) > MAX_MEAL_WEIGHT_GRAMS; guard++) {
    const candidates = [...working].filter(i => i.grams > GRAM_ROUND_STEP);
    candidates.sort((a, b) => {
      const bulkDiff = (isBulkItem(b) ? 1 : 0) - (isBulkItem(a) ? 1 : 0);
      return bulkDiff || b.grams - a.grams;
    });
    const target = candidates[0];
    if (!target) break;
    target.grams = Math.max(GRAM_ROUND_STEP, target.grams - GRAM_ROUND_STEP);
  }
  return working;
}

function scaleUniform(items, goal) {
  const base = sumItemNutrition(items);
  if (base.kcal <= 0) return items;
  const factor = Math.min(SCALE_FACTOR_MAX, Math.max(SCALE_FACTOR_MIN, goal / base.kcal));
  const scaled = items.map(item => ({
    ...item,
    grams: capItemGrams(item, roundGrams(item.grams * factor)),
  }));
  return nudgeItemsTowardKcal(scaled, goal);
}

/**
 * Cap bulk (veg/fruit) portions, scale calorie-dense items to the remaining kcal budget.
 * Prevents uniform upscaling from turning 700kcal targets into 1kg plates.
 */
function scaleWithBulkCap(items, goal) {
  const bulk = items.filter(isBulkItem);
  const dense = items.filter(it => !isBulkItem(it));
  if (!dense.length) return scaleUniform(items, goal);

  const bulkCapped = bulk.map(item => ({
    ...item,
    grams: capItemGrams(item, Math.min(roundGrams(item.grams), BULK_ITEM_MAX_GRAMS)),
  }));
  const bulkKcal = sumItemNutrition(bulkCapped).kcal;
  let denseScaled = scaleUniform(dense, Math.max(50, goal - bulkKcal));
  let trimmedBulk = bulkCapped;

  const denseGrams = sumGrams(denseScaled);
  const allowedBulk = Math.max(0, MAX_MEAL_WEIGHT_GRAMS - denseGrams);
  const bulkGrams = sumGrams(trimmedBulk);
  if (bulkGrams > allowedBulk && allowedBulk >= 0 && bulkGrams > 0) {
    const ratio = allowedBulk / bulkGrams;
    trimmedBulk = bulkCapped.map(item => ({
      ...item,
      grams: capItemGrams(item, Math.max(GRAM_ROUND_STEP, roundGrams(item.grams * ratio))),
    }));
    const trimmedBulkKcal = sumItemNutrition(trimmedBulk).kcal;
    denseScaled = scaleUniform(dense, Math.max(50, goal - trimmedBulkKcal));
  }

  let result = [...trimmedBulk, ...denseScaled];
  return nudgeItemsTowardKcal(result, goal);
}

/**
 * Scale item grams so total kcal approaches target.
 * Bulk items (veg/fruit) stay capped; dense items absorb the calorie budget.
 */
export function scaleItemsToTargetCalories(items, targetKcal, dessertNutrition = null) {
  if (!items.length || !targetKcal || targetKcal <= 0) return items;

  let goal = targetKcal;
  if (dessertNutrition?.kcal > 0) {
    goal = Math.max(50, targetKcal - dessertNutrition.kcal);
  }

  const base = sumItemNutrition(items);
  if (base.kcal <= 0) return items;

  const hasBulk = items.some(isBulkItem);
  const uniformFactor = Math.min(SCALE_FACTOR_MAX, Math.max(SCALE_FACTOR_MIN, goal / base.kcal));
  const projectedWeight = sumGrams(items.map(item => ({
    ...item,
    grams: roundGrams(item.grams * uniformFactor),
  })));

  if (!hasBulk || projectedWeight <= MAX_MEAL_WEIGHT_GRAMS) {
    return scaleUniform(items, goal);
  }

  return scaleWithBulkCap(items, goal);
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
    return { ok: true, unknowns: [] };
  }

  let items = parseMealDescription(meal.description);
  if (!items.length) {
    return { ok: false, unknowns: ['no-parsed-items'] };
  }

  items = items.map(item => {
    const { profile, key, unknown } = lookupFoodProfile(item.name, extraDb);
    return { ...item, profile, key, unknown: !!unknown, grams: capItemGrams(item, item.grams) };
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
    if (sumGrams(items) > MAX_MEAL_WEIGHT_GRAMS) {
      items = trimToMaxWeight(items);
    }
  }

  items = items.map(item => ({ ...item, grams: capItemGrams(item, item.grams) }));

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
      meal.calories = Math.min(Math.round(p * 4 + c * 4 + f * 9), cap);
    }
  }

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
