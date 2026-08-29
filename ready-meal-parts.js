/**
 * Decomposition maps for catalog ready_meal entries (scalingMode: decompose).
 * Shares sum ≈ 1 per meal; solver scales the resulting raw lines.
 */

import { MEAL_DISHES, dishToParts } from './meal-dishes.js';

/**
 * Dish id → its products.
 *
 * Base list from meal-dishes.js, then whatever the admin overlay adds or
 * disables. Mutated in place by `applyDishOverlayParts` so every consumer that
 * already holds this object sees admin edits without a restart.
 */
export const READY_MEAL_PARTS = Object.fromEntries(
  MEAL_DISHES.map(d => [d.id, dishToParts(d)]),
);

const BASE_DISH_PART_IDS = Object.keys(READY_MEAL_PARTS);

/**
 * @param {Array<{ id: string, products?: Array<{name: string, share: number}> }>} dishes
 * @param {string[]} disabledIds
 */
export function applyDishOverlayParts(dishes = [], disabledIds = []) {
  for (const key of Object.keys(READY_MEAL_PARTS)) delete READY_MEAL_PARTS[key];
  const disabled = new Set(disabledIds.map(String));
  for (const d of MEAL_DISHES) {
    if (disabled.has(d.id)) continue;
    READY_MEAL_PARTS[d.id] = dishToParts(d);
  }
  for (const d of dishes) {
    if (!d?.id || disabled.has(d.id) || !Array.isArray(d.products) || !d.products.length) continue;
    READY_MEAL_PARTS[d.id] = d.products.map(p => ({ name: p.name, share: p.share }));
  }
  return BASE_DISH_PART_IDS.length;
}

export const SCALING_DECOMPOSE = 'decompose';
export const SCALING_ATOMIC = 'atomic_fixed';

/** @param {object|null|undefined} entry */
export function getEntryScalingMode(entry) {
  if (!entry) return null;
  if (entry.scalingMode === SCALING_ATOMIC || entry.scalingMode === SCALING_DECOMPOSE) {
    return entry.scalingMode;
  }
  if (entry.group !== 'ready_meal') return null;
  if (entry.fixedNutrition && Number(entry.fixedNutrition.kcal) > 0) return SCALING_ATOMIC;
  if (READY_MEAL_PARTS[entry.id]) return SCALING_DECOMPOSE;
  return SCALING_DECOMPOSE;
}
