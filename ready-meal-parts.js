/**
 * Decomposition maps for catalog ready_meal entries (scalingMode: decompose).
 * Shares sum ≈ 1 per meal; solver scales the resulting raw lines.
 */

import { buildLibraryReadyMealParts } from './nutrition-library-bridge.js';

/** @type {Record<string, Array<{ name: string, share: number }>>} */
const BASE_READY_MEAL_PARTS = {
  meal_rice_chicken: [{ name: 'ориз', share: 0.42 }, { name: 'пилешко месо', share: 0.58 }],
  meal_fish_potato: [{ name: 'картофи', share: 0.55 }, { name: 'риба', share: 0.45 }],
  meal_omelet: [{ name: 'яйца', share: 0.65 }, { name: 'зеленчук', share: 0.35 }],
  meal_boiled_egg: [{ name: 'яйца', share: 0.7 }, { name: 'зеленчук', share: 0.3 }],
  meal_chicken_salad: [{ name: 'пилешко месо', share: 0.55 }, { name: 'зеленчук', share: 0.45 }],
  meal_green_salad: [{ name: 'зеленчук', share: 1 }],
  meal_oatmeal: [{ name: 'овесени ядки', share: 0.5 }, { name: 'кисело мляко', share: 0.35 }, { name: 'ябълка', share: 0.15 }],
  meal_yogurt_oats: [{ name: 'кисело мляко', share: 0.6 }, { name: 'овесени ядки', share: 0.4 }],
  meal_chicken_soup: [{ name: 'пилешко месо', share: 0.35 }, { name: 'зеленчук', share: 0.65 }],
  meal_veg_soup: [{ name: 'зеленчук', share: 1 }],
  meal_lentil_stew: [{ name: 'леща', share: 0.7 }, { name: 'зеленчук', share: 0.3 }],
  meal_bean_stew: [{ name: 'боб', share: 0.7 }, { name: 'зеленчук', share: 0.3 }],
  meal_chicken_sandwich: [{ name: 'пилешко месо', share: 0.4 }, { name: 'хляб', share: 0.6 }],
  meal_cottage_bowl: [{ name: 'извара', share: 1 }],
  meal_skry_bowl: [{ name: 'скир', share: 1 }],
  meal_grilled_chicken: [{ name: 'пилешко месо', share: 0.65 }, { name: 'зеленчук', share: 0.35 }],
  meal_baked_fish: [{ name: 'риба', share: 0.55 }, { name: 'зеленчук', share: 0.45 }],
  meal_pasta_chicken: [{ name: 'паста', share: 0.45 }, { name: 'пилешко месо', share: 0.55 }],
  meal_bulgur_chicken: [{ name: 'булгур', share: 0.42 }, { name: 'пилешко месо', share: 0.58 }],
  meal_quinoa_chicken: [{ name: 'киноа', share: 0.42 }, { name: 'пилешко месо', share: 0.58 }],
  meal_buckwheat_chicken: [{ name: 'елда', share: 0.42 }, { name: 'пилешко месо', share: 0.58 }],
  meal_beef_potato: [{ name: 'картофи', share: 0.5 }, { name: 'говеждо', share: 0.5 }],
  meal_pork_potato: [{ name: 'картофи', share: 0.5 }, { name: 'свинско', share: 0.5 }],
  meal_chicken_broccoli: [{ name: 'пилешко месо', share: 0.55 }, { name: 'броколи', share: 0.45 }],
  meal_chicken_breast_rice: [{ name: 'ориз', share: 0.4 }, { name: 'пилешки гърди', share: 0.6 }],
  meal_turkey_rice: [{ name: 'ориз', share: 0.42 }, { name: 'пуешко филе', share: 0.58 }],
  meal_salmon_salad: [{ name: 'сьомга', share: 0.55 }, { name: 'маруля', share: 0.45 }],
  meal_tuna_salad: [{ name: 'риба тон', share: 0.5 }, { name: 'маруля', share: 0.5 }],
  meal_mackerel_potato: [{ name: 'картофи', share: 0.5 }, { name: 'скумрия', share: 0.5 }],
  meal_tofu_rice: [{ name: 'ориз', share: 0.45 }, { name: 'тофу', share: 0.55 }],
  meal_lentil_rice: [{ name: 'ориз', share: 0.4 }, { name: 'леща', share: 0.6 }],
  meal_chickpea_salad: [{ name: 'нахут', share: 0.55 }, { name: 'маруля', share: 0.45 }],
  meal_egg_potato: [{ name: 'картофи', share: 0.55 }, { name: 'яйца', share: 0.45 }],
  meal_avocado_egg: [{ name: 'яйца', share: 0.6 }, { name: 'авокадо', share: 0.4 }],
  meal_cheese_sandwich: [{ name: 'хляб', share: 0.55 }, { name: 'сирене', share: 0.45 }],
  meal_hummus_bread: [{ name: 'хляб', share: 0.55 }, { name: 'хумус', share: 0.45 }],
  meal_chicken_spinach: [{ name: 'пилешко месо', share: 0.55 }, { name: 'спанак', share: 0.45 }],
  meal_fish_veg: [{ name: 'риба', share: 0.55 }, { name: 'зеленчук', share: 0.45 }],
};

/** Base catalog + nutrition-library ready meals. */
export const READY_MEAL_PARTS = {
  ...BASE_READY_MEAL_PARTS,
  ...buildLibraryReadyMealParts(),
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
