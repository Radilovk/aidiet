/**
 * Decomposition maps for catalog ready_meal entries (scalingMode: decompose).
 * Shares sum ≈ 1 per meal; solver scales the resulting raw lines.
 */

/** @type {Record<string, Array<{ name: string, share: number }>>} */
export const READY_MEAL_PARTS = {
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
