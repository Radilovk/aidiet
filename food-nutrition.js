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
import { buildRegistryIndex } from './food-registry.js';
import { READY_MEAL_PARTS, getEntryScalingMode, SCALING_ATOMIC } from './ready-meal-parts.js';
import { MAX_LATE_SNACK_CALORIES, SLOT_CALORIE_TOLERANCE_PERCENT, SLOT_CALORIE_TOLERANCE_MIN_KCAL } from './plan-normalize.js';
import { solveMealGrams, totalsFor } from './meal-solver.js';
import { GRAM_STEP_SMALL, GRAM_STEP_LARGE, GRAM_LARGE_MIN, gramRoundStep, snapGrams } from './gram-rounding.js';
import { maxPortionGrams, minPortionGrams } from './portion-limits.js';
import { getLibraryNutritionPer100g } from './nutrition-library-bridge.js';

export { normalizeFoodKey } from './food-utils.js';
export { snapGrams, gramRoundStep, GRAM_STEP_SMALL as GRAM_ROUND_STEP, GRAM_STEP_LARGE as GRAM_ROUND_STEP_LARGE, GRAM_LARGE_MIN as GRAM_LARGE_THRESHOLD } from './gram-rounding.js';

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

// Portion ceilings now live in portion-limits.js — one table for every food.

/** How far above a slot target the gram bounds may reach, so the solver can trade. */
const BOUNDS_HEADROOM = 1.35;

/** Max realistic single-meal plate weight — aligns with max plated slot (~900 kcal). */
export const MAX_MEAL_WEIGHT_GRAMS = 900;

export { READY_MEAL_PARTS } from './ready-meal-parts.js';

/** Re-export; canonical map in ready-meal-parts.js */

export function expandReadyMealItems(items, extraDb = {}) {
  const out = [];
  const index = buildRegistryIndex();
  for (const item of items) {
    const { entry } = resolveCatalogEntry(item.name);
    if (!entry || entry.group !== 'ready_meal') {
      out.push(item);
      continue;
    }
    if (getEntryScalingMode(entry) === SCALING_ATOMIC) {
      out.push(item);
      continue;
    }
    if (entry.genericOf) {
      const parent = index.byId.get(entry.genericOf);
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
      // Делът пътува с продукта: той е формата на ястието, а не следствие
      // от грамажа, който solver-ът ще избере.
      out.push({
        name: part.name, grams, key, profile, unknown: !!unknown,
        share: part.share, referenceGrams: part.grams,
      });
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

let libraryProfileCache = null;

function libraryProfiles() {
  if (!libraryProfileCache) libraryProfileCache = getLibraryNutritionPer100g();
  return libraryProfileCache;
}

function buildDbIndex(extraDb = {}) {
  const index = new Map();
  // Library-derived profiles first, so the curated table always overrides them.
  for (const [rawKey, values] of Object.entries(libraryProfiles())) {
    index.set(normalizeFoodKey(rawKey), arrayToProfile(values));
  }
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

/** <50g → 5g steps; ≥50g → 50g steps. */
export function roundGrams(grams, step) {
  if (step != null) {
    const g = Number(grams) || 0;
    if (g <= 0) return step;
    return Math.max(step, Math.round(g / step) * step);
  }
  return snapGrams(grams);
}

function getCatalogMeta(name) {
  const { entry } = resolveCatalogEntry(name);
  if (!entry) return { slots: [], group: null, nutritionKey: null, maxPortionG: null };
  return {
    slots: entry.slots || [],
    group: entry.group || null,
    nutritionKey: entry.nutritionKey || null,
    maxPortionG: entry.maxPortionG || null,
  };
}

/**
 * Границите вървят по същата мрежа като грамажите (5/50 г).
 * Иначе клампването сервира стойност извън нея.
 */
function gridCeil(grams) {
  const g = Math.max(0, Number(grams) || 0);
  if (g <= GRAM_STEP_SMALL) return GRAM_STEP_SMALL;
  if (g <= GRAM_LARGE_MIN) return Math.ceil(g / GRAM_STEP_SMALL) * GRAM_STEP_SMALL;
  return Math.ceil(g / GRAM_STEP_LARGE) * GRAM_STEP_LARGE;
}

function gridFloor(grams) {
  const g = Math.max(0, Number(grams) || 0);
  if (g < GRAM_LARGE_MIN) {
    return Math.max(GRAM_STEP_SMALL, Math.floor(g / GRAM_STEP_SMALL) * GRAM_STEP_SMALL);
  }
  return Math.floor(g / GRAM_STEP_LARGE) * GRAM_STEP_LARGE;
}

/** Realistic serving window for one item, from catalog metadata + portion-limits. */
function portionWindow(item) {
  const meta = getCatalogMeta(item.name);
  const descriptor = {
    name: item.name,
    nutritionKey: meta.nutritionKey,
    group: meta.group,
    maxPortionG: meta.maxPortionG,
  };
  const max = gridFloor(maxPortionGrams(descriptor));
  const min = Math.min(gridCeil(minPortionGrams(descriptor)), max);
  return { min, max, group: meta.group, slots: meta.slots };
}

/**
 * Clamp every bound to its item's realistic serving window.
 * Applied after each widening pass — a cap that only guards the seed grams is
 * a cap the solver walks straight past.
 */
function clampBoundsToPortions(items, bounds) {
  return bounds.map((b, i) => {
    const { min, max } = portionWindow(items[i]);
    const hi = Math.min(b.max, max);
    const lo = Math.min(b.min, hi);
    return { min: Math.max(lo, Math.min(min, hi)), max: hi };
  });
}

function kcalPer100(profile) {
  const p = Number(profile?.p) || 0;
  const c = Number(profile?.c) || 0;
  const f = Number(profile?.f) || 0;
  return Math.max(15, p * 4 + c * 4 + f * 9);
}

function macroShareForItem(group, slots = []) {
  if (group === 'protein' || group === 'dairy' || slots.includes('PRO')) return 0.38;
  if (group === 'carb' || group === 'legume' || slots.includes('ENG')) return 0.42;
  if (group === 'fat' || slots.includes('FAT')) return 0.14;
  if (group === 'vegetable' || group === 'fruit' || slots.includes('VOL')) return 0.06;
  return 0.1;
}

/**
 * Slot-target-aware gram bounds, never wider than a realistic serving.
 * A slot the composition cannot reach is reported infeasible so the caller can
 * change the products — it is not reached by over-serving one of them.
 */
/**
 * Решаване на ястие: една променлива — мащабът.
 *
 * Ястието е курирано и носи пропорцията си (грамажите за една порция). Значи
 * има точно една степен на свобода: колко голяма да е порцията. Затова тук
 * няма многомерно търсене — обхожда се мащабът и се взима този, който е
 * най-близо до целта на храненето.
 *
 * Всеки продукт спира на собствения си реалистичен таван (маруля 120 г), така
 * че голямото хранене расте през хляба и месото, а не през листата. Това е и
 * причината списъкът да е универсален: едно и също ястие обслужва 1500 и 2700
 * kcal клиент — различава се само порцията.
 */
function solveDishScale(items, target, maxTotalGrams) {
  const refs = items.map(i => Number(i.referenceGrams) || 0);
  if (refs.some(r => r <= 0)) return null;
  const targetKcal = Number(target?.kcal) || 0;
  if (!(targetKcal > 0)) return null;

  const windows = items.map(item => portionWindow(item));
  // Мащабът е един за цялото ястие и се ограничава от най-стегнатия продукт.
  // Ако вместо това всеки продукт се клампваше поотделно, ястието се
  // разтягаше през хляба, докато яйцата опират в тавана си — и спираше да
  // бъде същото ястие. Ястие, което не стига слота, просто не се избира.
  const minScale = Math.max(0.35, ...refs.map((ref, i) => windows[i].min / ref));
  const maxScale = Math.min(
    ...refs.map((ref, i) => windows[i].max / ref),
    maxTotalGrams / refs.reduce((a, b) => a + b, 0),
  );
  if (maxScale < minScale) return null;

  let best = null;
  const seen = new Set();
  for (let scale = minScale; scale <= maxScale + 1e-9; scale += 0.02) {
    const grams = refs.map(ref => snapGrams(ref * scale));
    const key = grams.join(',');
    if (seen.has(key)) continue;
    seen.add(key);

    const totals = totalsFor(items, grams);
    if (totals.grams > maxTotalGrams) continue;
    // kcal решава; макросите са мек критерий между близки мащаби.
    let cost = 3 * Math.abs(totals.kcal - targetKcal) / targetKcal;
    if (target.p > 0) cost += 0.5 * Math.abs(totals.p - target.p) / target.p;
    if (target.c > 0) cost += 0.3 * Math.abs(totals.c - target.c) / target.c;
    if (target.f > 0) cost += 0.3 * Math.abs(totals.f - target.f) / target.f;
    if (!best || cost < best.cost) best = { grams, totals, cost };
  }
  if (!best) return null;

  const kcalOk = Math.abs(best.totals.kcal - targetKcal)
    <= Math.max(SLOT_CALORIE_TOLERANCE_MIN_KCAL, targetKcal * SLOT_CALORIE_TOLERANCE_PERCENT);
  return {
    grams: best.grams,
    totals: best.totals,
    feasible: kcalOk,
    reason: kcalOk ? '' : 'порцията на ястието не стига целта — избери друго ястие',
  };
}

/**
 * Обхват на калориите за ястие или композиция
, при реалистични порции.
 */
export function computeMealItemBounds(items, slotTarget, maxTotalGrams = MAX_MEAL_WEIGHT_GRAMS) {
  const slotKcal = Number(slotTarget?.kcal ?? slotTarget?.calories) || 0;

  let bounds = items.map((item) => {
    const { min, max, group, slots } = portionWindow(item);
    let hi = min;
    if (slotKcal > 0) {
      const k100 = kcalPer100(item.profile);
      const share = macroShareForItem(group, slots);
      hi = Math.max(hi, snapGrams(((slotKcal * share) / k100) * 100 * 1.15));
    } else {
      hi = Math.round((min + max) / 2);
    }
    return { min, max: Math.max(min, Math.min(hi, max)) };
  });

  // Widen until the set can comfortably overshoot the slot. Stopping at the
  // target itself left the solver no room to trade grams between items, so any
  // macro pull dropped the meal below its kcal and the slot read infeasible.
  for (let pass = 0; pass < 8 && slotKcal > 0; pass++) {
    const maxKcal = totalsFor(
      items.map(it => ({ profile: it.profile })),
      bounds.map(b => b.max),
    ).kcal;
    if (maxKcal >= slotKcal * BOUNDS_HEADROOM) break;
    bounds = clampBoundsToPortions(items, bounds.map((b, i) => {
      const k100 = kcalPer100(items[i].profile);
      const boost = k100 < 90 ? 1.22 : 1.12;
      return { min: b.min, max: Math.round(b.max * boost) };
    }));
  }

  const sumMax = bounds.reduce((s, b) => s + b.max, 0);
  if (sumMax > maxTotalGrams) {
    const sumMin = bounds.reduce((s, b) => s + b.min, 0);
    const slack = Math.max(0, maxTotalGrams - sumMin);
    const flex = bounds.map(b => b.max - b.min);
    const flexSum = flex.reduce((a, b) => a + b, 0);
    if (flexSum > 0) {
      bounds = bounds.map((b, i) => ({
        min: b.min,
        max: Math.max(b.min, Math.round(b.min + flex[i] * (slack / flexSum))),
      }));
    }
  }

  return clampBoundsToPortions(items, bounds);
}

/**
 * Energy window a product set can reach within realistic portions.
 * Lets the composer add or drop a component when a slot is out of reach,
 * instead of the solver over-serving one product to close the gap.
 * @returns {{ minKcal: number, maxKcal: number }}
 */
export function compositionCapacity(products = [], slotTarget = {}, maxTotalGrams = MAX_MEAL_WEIGHT_GRAMS) {
  const items = products
    .map(p => (typeof p === 'string' ? { name: p } : p))
    .map(p => ({
      name: p.name, referenceGrams: p.grams,
      profile: lookupFoodProfile(p.name).profile, grams: 0,
    }))
    .filter(item => item.profile);
  if (!items.length) return { minKcal: 0, maxKcal: 0 };

  const refs = items.map(i => Number(i.referenceGrams) || 0);
  if (refs.every(r => r > 0)) {
    const windows = items.map(item => portionWindow(item));
    const minScale = Math.max(0.35, ...refs.map((ref, i) => windows[i].min / ref));
    const maxScale = Math.min(
      ...refs.map((ref, i) => windows[i].max / ref),
      maxTotalGrams / refs.reduce((a, b) => a + b, 0),
    );
    if (maxScale >= minScale) {
      const at = scale => totalsFor(items, refs.map(ref => snapGrams(ref * scale))).kcal;
      return { minKcal: at(minScale), maxKcal: at(maxScale) };
    }
  }

  const kcal = Number(slotTarget?.kcal ?? slotTarget?.calories) || 0;
  const bounds = computeMealItemBounds(items, { kcal }, maxTotalGrams);
  const profiles = items.map(it => ({ profile: it.profile }));
  return {
    minKcal: totalsFor(profiles, bounds.map(b => b.min)).kcal,
    maxKcal: totalsFor(profiles, bounds.map(b => b.max)).kcal,
  };
}


function seedGramsForItem(item, bounds, slotTarget, itemCount = 1) {
  if (item.grams > 0) return item.grams;
  const slotKcal = Number(slotTarget?.kcal ?? slotTarget?.calories) || 0;
  if (slotKcal > 0 && item.profile) {
    const { group, slots } = getCatalogMeta(item.name);
    const k100 = kcalPer100(item.profile);
    const share = macroShareForItem(group, slots);
    const grams = (slotKcal * share / k100) * 100;
    return roundGrams(Math.min(bounds.max, Math.max(bounds.min, grams)));
  }
  const mid = Math.round((bounds.min + bounds.max) / 2);
  return roundGrams(mid);
}

function capItemGrams(item, grams) {
  const { min, max } = portionWindow(item);
  return Math.max(Math.min(grams, max), Math.min(grams, min));
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
    return { ...item, profile, key, unknown: !!unknown };
  });

  // Ястие → връщаме декларираните дялове върху продуктите му. Описанието е
  // разгънато на продукти, така че без това solver-ът не знае, че марулята в
  // сандвича е гарнитура, а не носеща съставка.
  const dishParts = meal.dishId ? READY_MEAL_PARTS[meal.dishId] : null;
  if (dishParts?.length) {
    // Ключът е каталожното име, както го изписва описанието: частта е записана
    // „говеждо“, а на клиента се показва „Говеждо месо“ — без това съответствие
    // ястието губеше порцията си и падаше на общия solver.
    const partByKey = new Map();
    for (const part of dishParts) {
      partByKey.set(normalizeFoodKey(part.name), part);
      const catalogName = resolveCatalogEntry(part.name).entry?.name;
      if (catalogName) partByKey.set(normalizeFoodKey(catalogName), part);
    }
    items = items.map(item => {
      const part = partByKey.get(normalizeFoodKey(item.name))
        ?? partByKey.get(normalizeFoodKey(item.key));
      return part ? { ...item, share: part.share, referenceGrams: part.grams } : item;
    });
  }

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

  const plateBudget = Math.max(200, MAX_MEAL_WEIGHT_GRAMS - dessertWeight);
  const bounds = computeMealItemBounds(items, slotTarget, plateBudget);

  const maxAchievable = totalsFor(
    items.map(it => ({ profile: it.profile })),
    bounds.map(b => b.max),
  );
  // A slot the composition cannot reach is reported infeasible, but it is still
  // filled with the best portions available. Returning early left the meal with
  // no grams and no calories at all, and the day quietly lost that budget.
  const unreachable = slotTarget.kcal > 0 && maxAchievable.kcal < slotTarget.kcal * 0.82;
  const unreachableReason = 'композицията не носи slot kcal — добави по-калоричен PRO/ENG източник';

  items = items.map((item, i) => ({
    ...item,
    grams: capItemGrams(item, seedGramsForItem(item, bounds[i], slotTarget, items.length)),
  }));

  const solved = solveDishScale(items, slotTarget, plateBudget)
    || solveMealGrams(items, slotTarget, bounds, plateBudget);
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
    feasible: solved.feasible && !unreachable,
    reason: unreachable ? unreachableReason : (solved.reason || ''),
  };
}

/** Sync nutrition for all meals in a weekPlan chunk (atomic-first day budget). */
export { syncWeekPlanNutritionFromDatabase } from './meal-day-sync.js';

export function profileToKvArray(profile) {
  return [profile.kcal, profile.p, profile.c, profile.f];
}

export function kvArrayToProfile(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return null;
  return { kcal: arr[0], p: arr[1], c: arr[2], f: arr[3] };
}
