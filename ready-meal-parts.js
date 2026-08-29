/**
 * Decomposition maps for catalog ready_meal entries (scalingMode: decompose).
 * Shares sum ≈ 1 per meal; solver scales the resulting raw lines.
 */

import { buildLibraryReadyMealParts } from './nutrition-library-bridge.js';

/** @type {Record<string, Array<{ name: string, share: number }>>} */
const BASE_READY_MEAL_PARTS = {
  meal_rice_chicken: [{ name: 'ориз', share: 0.35 }, { name: 'пилешко месо', share: 0.45 }, { name: 'зеленчук', share: 0.2 }],
  meal_fish_potato: [{ name: 'картофи', share: 0.4 }, { name: 'риба', share: 0.4 }, { name: 'броколи', share: 0.2 }],
  meal_omelet: [{ name: 'яйца', share: 0.6 }, { name: 'зеленчук', share: 0.3 }, { name: 'зехтин', share: 0.1 }],
  meal_boiled_egg: [{ name: 'яйца', share: 0.5 }, { name: 'пълнозърнест хляб', share: 0.3 }, { name: 'домат', share: 0.2 }],
  meal_chicken_salad: [{ name: 'пилешко месо', share: 0.45 }, { name: 'зеленчук', share: 0.35 }, { name: 'зехтин', share: 0.2 }],
  meal_green_salad: [{ name: 'зеленчук', share: 0.55 }, { name: 'краставица', share: 0.25 }, { name: 'зехтин', share: 0.2 }],
  meal_oatmeal: [{ name: 'овесени ядки', share: 0.4 }, { name: 'мляко', share: 0.45 }, { name: 'бадеми', share: 0.15 }],
  meal_yogurt_oats: [{ name: 'кисело мляко', share: 0.6 }, { name: 'овесени ядки', share: 0.4 }],
  meal_chicken_soup: [{ name: 'пилешко месо', share: 0.35 }, { name: 'зеленчук', share: 0.45 }, { name: 'ориз', share: 0.2 }],
  meal_veg_soup: [{ name: 'зеленчук', share: 0.6 }, { name: 'картофи', share: 0.3 }, { name: 'зехтин', share: 0.1 }],
  meal_lentil_stew: [{ name: 'леща', share: 0.55 }, { name: 'зеленчук', share: 0.3 }, { name: 'зехтин', share: 0.15 }],
  meal_bean_stew: [{ name: 'боб', share: 0.55 }, { name: 'зеленчук', share: 0.3 }, { name: 'зехтин', share: 0.15 }],
  meal_chicken_sandwich: [{ name: 'пилешко месо', share: 0.35 }, { name: 'хляб', share: 0.45 }, { name: 'маруля', share: 0.2 }],
  meal_cottage_bowl: [{ name: 'извара', share: 0.6 }, { name: 'домат', share: 0.25 }, { name: 'орехи', share: 0.15 }],
  meal_skry_bowl: [{ name: 'скир', share: 0.6 }, { name: 'боровинки', share: 0.25 }, { name: 'бадеми', share: 0.15 }],
  meal_grilled_chicken: [{ name: 'пилешко месо', share: 0.5 }, { name: 'зеленчук', share: 0.35 }, { name: 'зехтин', share: 0.15 }],
  meal_baked_fish: [{ name: 'риба', share: 0.45 }, { name: 'картофи', share: 0.35 }, { name: 'зеленчук', share: 0.2 }],
  meal_pasta_chicken: [{ name: 'паста', share: 0.4 }, { name: 'пилешко месо', share: 0.4 }, { name: 'домат', share: 0.2 }],
  meal_bulgur_chicken: [{ name: 'булгур', share: 0.35 }, { name: 'пилешко месо', share: 0.45 }, { name: 'чушка', share: 0.2 }],
  meal_quinoa_chicken: [{ name: 'киноа', share: 0.35 }, { name: 'пилешко месо', share: 0.45 }, { name: 'спанак', share: 0.2 }],
  meal_buckwheat_chicken: [{ name: 'елда', share: 0.35 }, { name: 'пилешко месо', share: 0.45 }, { name: 'гъби', share: 0.2 }],
  meal_beef_potato: [{ name: 'картофи', share: 0.4 }, { name: 'говеждо', share: 0.4 }, { name: 'морков', share: 0.2 }],
  meal_pork_potato: [{ name: 'картофи', share: 0.4 }, { name: 'свинско', share: 0.4 }, { name: 'зеле', share: 0.2 }],
  meal_chicken_broccoli: [{ name: 'пилешко месо', share: 0.45 }, { name: 'броколи', share: 0.35 }, { name: 'ориз', share: 0.2 }],
  meal_chicken_breast_rice: [{ name: 'ориз', share: 0.35 }, { name: 'пилешки гърди', share: 0.45 }, { name: 'броколи', share: 0.2 }],
  meal_turkey_rice: [{ name: 'ориз', share: 0.35 }, { name: 'пуешко филе', share: 0.45 }, { name: 'тиквичка', share: 0.2 }],
  meal_salmon_salad: [{ name: 'сьомга', share: 0.45 }, { name: 'маруля', share: 0.3 }, { name: 'пълнозърнест хляб', share: 0.25 }],
  meal_tuna_salad: [{ name: 'риба тон', share: 0.4 }, { name: 'маруля', share: 0.3 }, { name: 'царевица', share: 0.3 }],
  meal_mackerel_potato: [{ name: 'картофи', share: 0.4 }, { name: 'скумрия', share: 0.4 }, { name: 'спанак', share: 0.2 }],
  meal_tofu_rice: [{ name: 'ориз', share: 0.35 }, { name: 'тофу', share: 0.45 }, { name: 'броколи', share: 0.2 }],
  meal_lentil_rice: [{ name: 'ориз', share: 0.35 }, { name: 'леща', share: 0.45 }, { name: 'морков', share: 0.2 }],
  meal_chickpea_salad: [{ name: 'нахут', share: 0.5 }, { name: 'маруля', share: 0.3 }, { name: 'зехтин', share: 0.2 }],
  meal_egg_potato: [{ name: 'картофи', share: 0.45 }, { name: 'яйца', share: 0.35 }, { name: 'чушка', share: 0.2 }],
  meal_avocado_egg: [{ name: 'яйца', share: 0.45 }, { name: 'авокадо', share: 0.3 }, { name: 'пълнозърнест хляб', share: 0.25 }],
  meal_cheese_sandwich: [{ name: 'хляб', share: 0.45 }, { name: 'сирене', share: 0.35 }, { name: 'домат', share: 0.2 }],
  meal_hummus_bread: [{ name: 'хляб', share: 0.45 }, { name: 'хумус', share: 0.35 }, { name: 'краставица', share: 0.2 }],
  meal_chicken_spinach: [{ name: 'пилешко месо', share: 0.45 }, { name: 'спанак', share: 0.3 }, { name: 'картофи', share: 0.25 }],
  meal_fish_veg: [{ name: 'риба', share: 0.45 }, { name: 'зеленчук', share: 0.3 }, { name: 'киноа', share: 0.25 }],
  meal_oat_plant_berries: [{ name: 'овесени ядки', share: 0.35 }, { name: 'растително мляко', share: 0.45 }, { name: 'боровинки', share: 0.2 }],
  meal_tofu_toast: [{ name: 'тофу', share: 0.45 }, { name: 'пълнозърнест хляб', share: 0.35 }, { name: 'домат', share: 0.2 }],
  meal_chia_plant_bowl: [{ name: 'семена чиа', share: 0.25 }, { name: 'растително мляко', share: 0.55 }, { name: 'малини', share: 0.2 }],
  meal_avocado_toast: [{ name: 'авокадо', share: 0.4 }, { name: 'пълнозърнест хляб', share: 0.4 }, { name: 'домат', share: 0.2 }],
  meal_bean_salad: [{ name: 'бял боб', share: 0.5 }, { name: 'маруля', share: 0.3 }, { name: 'зехтин', share: 0.2 }],
  meal_tempeh_bulgur: [{ name: 'темпе', share: 0.4 }, { name: 'булгур', share: 0.4 }, { name: 'чушка', share: 0.2 }],
  meal_pea_quinoa: [{ name: 'киноа', share: 0.45 }, { name: 'грах', share: 0.35 }, { name: 'морков', share: 0.2 }],
  meal_egg_avocado_spinach: [{ name: 'яйца', share: 0.45 }, { name: 'авокадо', share: 0.3 }, { name: 'спанак', share: 0.25 }],
  meal_cottage_nuts_veg: [{ name: 'извара', share: 0.55 }, { name: 'орехи', share: 0.15 }, { name: 'краставица', share: 0.3 }],
  meal_salmon_avocado: [{ name: 'сьомга', share: 0.5 }, { name: 'авокадо', share: 0.25 }, { name: 'маруля', share: 0.25 }],
  meal_chicken_cheese_salad: [{ name: 'пилешко месо', share: 0.45 }, { name: 'сирене', share: 0.2 }, { name: 'маруля', share: 0.35 }],
  meal_beef_mushrooms: [{ name: 'говеждо', share: 0.45 }, { name: 'гъби', share: 0.35 }, { name: 'зехтин', share: 0.2 }],
  meal_chicken_bulgur_salad: [{ name: 'пилешко месо', share: 0.4 }, { name: 'булгур', share: 0.35 }, { name: 'краставица', share: 0.25 }],
  meal_turkey_potato: [{ name: 'пуешко филе', share: 0.4 }, { name: 'картофи', share: 0.4 }, { name: 'зелен фасул', share: 0.2 }],
  meal_cod_quinoa: [{ name: 'треска', share: 0.4 }, { name: 'киноа', share: 0.35 }, { name: 'броколи', share: 0.25 }],
  meal_yogurt_oats_nuts: [{ name: 'кисело мляко', share: 0.5 }, { name: 'овесени ядки', share: 0.35 }, { name: 'орехи', share: 0.15 }],
  meal_egg_bread_cheese: [{ name: 'яйца', share: 0.4 }, { name: 'пълнозърнест хляб', share: 0.35 }, { name: 'сирене', share: 0.25 }],
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
