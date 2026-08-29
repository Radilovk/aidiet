/**
 * Nutrition library bridge — maps LIBRARY_* data to NutriPlan catalog/registry format.
 * Used by food-registry overlay, meal-template-engine, and future Slot Assembler.
 */

import { FOOD_CATALOG } from './food-catalog-data.js';
import { normalizeFoodKey } from './food-utils.js';
import {
  repairLibraryFood,
  portionCeilingForGroup,
  repairReadyMealIngredients,
  isCoherentReadyMeal,
  libraryNutritionPer100g,
} from './nutrition-library-repair.js';
import {
  LIBRARY_FOODS,
  LIBRARY_READY_MEALS,
  LIBRARY_MEAL_TEMPLATES,
  LIBRARY_PROTOCOL_RULES,
  LIBRARY_FOOD_GROUPS,
  NUTRITION_LIBRARY_VERSION,
  LIBRARY_ORCHESTRATOR,
} from './nutrition-library-data.js';

export {
  LIBRARY_FOODS,
  LIBRARY_READY_MEALS,
  LIBRARY_MEAL_TEMPLATES,
  LIBRARY_PROTOCOL_RULES,
  LIBRARY_FOOD_GROUPS,
  NUTRITION_LIBRARY_VERSION,
  LIBRARY_ORCHESTRATOR,
};

/** library group_id → NutriPlan catalog group */
const GROUP_TO_CATALOG = {
  vegetables: 'vegetable',
  fruits: 'fruit',
  whole_grains: 'carb',
  refined_grains: 'carb',
  legumes: 'legume',
  fish: 'protein',
  meat: 'protein',
  eggs: 'protein',
  dairy: 'dairy',
  nuts_seeds: 'fat',
  fats: 'fat',
  herbs_spices: 'condiment',
  beverages: 'beverage',
  sweets: 'condiment',
  plant_protein: 'protein',
  seafood: 'protein',
  condiments: 'condiment',
};

/** library group_id → ADLE slots */
const GROUP_TO_SLOTS = {
  vegetables: ['VOL'],
  fruits: ['ENG'],
  whole_grains: ['ENG'],
  refined_grains: ['ENG'],
  legumes: ['PRO', 'ENG'],
  fish: ['PRO'],
  meat: ['PRO'],
  eggs: ['PRO', 'FAT'],
  dairy: ['PRO', 'FAT'],
  nuts_seeds: ['FAT', 'PRO'],
  fats: ['FAT'],
  herbs_spices: ['VOL'],
  beverages: ['VOL'],
  sweets: ['ENG'],
  plant_protein: ['PRO'],
  seafood: ['PRO'],
  condiments: ['VOL', 'FAT'],
};

/** library group_id → meal timing */
const GROUP_TO_TIMING = {
  vegetables: ['main', 'snack'],
  fruits: ['breakfast', 'snack', 'late_snack'],
  whole_grains: ['breakfast', 'main'],
  refined_grains: ['breakfast', 'main', 'snack'],
  legumes: ['main'],
  fish: ['main', 'snack'],
  meat: ['main'],
  eggs: ['breakfast', 'main', 'snack', 'late_snack'],
  dairy: ['breakfast', 'snack', 'main', 'late_snack'],
  nuts_seeds: ['snack', 'late_snack', 'breakfast'],
  fats: ['main', 'snack', 'late_snack'],
  herbs_spices: ['main'],
  beverages: ['breakfast', 'snack', 'late_snack'],
  sweets: ['snack', 'late_snack'],
  plant_protein: ['main', 'snack'],
  seafood: ['main'],
  condiments: ['main', 'snack'],
};

/** library meal_type → NutriPlan timing + slot label */
export const LIBRARY_MEAL_TYPE_MAP = {
  breakfast: { timing: 'breakfast', slotLabel: 'Хранене 1' },
  lunch: { timing: 'main', slotLabel: 'Хранене 2' },
  snack: { timing: 'snack', slotLabel: 'Хранене 3' },
  dinner: { timing: 'main', slotLabel: 'Хранене 4' },
  late_snack: { timing: 'late_snack', slotLabel: 'Хранене 5' },
};

/** NutriPlan slot → library meal template id */
export const SLOT_TO_TEMPLATE_ID = {
  'Хранене 1': 'tpl_breakfast',
  'Хранене 2': 'tpl_lunch',
  'Хранене 3': 'tpl_snack',
  'Хранене 4': 'tpl_dinner',
  'Хранене 5': 'tpl_late_snack',
};

const FOOD_ID_TO_NUTRITION_KEY = {
  food_oats: 'овесени ядки',
  food_rice: 'ориз',
  food_brown_rice: 'ориз кафяв',
  food_quinoa: 'киноа',
  food_buckwheat: 'елда',
  food_bread_whole: 'хляб пълнозърнест',
  food_pasta_whole: 'паста',
  food_egg: 'яйца',
  food_egg_whites: 'яйчни белтъци',
  food_yogurt: 'кисело мляко',
  food_milk: 'мляко',
  food_kefir: 'кефир',
  food_cheese: 'сирене',
  food_chicken: 'пилешко месо',
  food_turkey: 'пуешко филе',
  food_beef: 'говеждо',
  food_pork: 'свинско',
  food_salmon: 'сьомга',
  food_tuna: 'риба тон',
  food_cod: 'треска',
  food_shrimp: 'скариди',
  food_tofu: 'тофу',
  food_tempeh: 'темпе',
  food_lentils: 'леща',
  food_chickpeas: 'нахут',
  food_beans: 'боб',
  food_olive_oil: 'зехтин',
  food_avocado: 'авокадо',
  food_butter: 'масло',
  food_almonds: 'бадеми',
  food_walnuts: 'орехи',
  food_chia: 'семена чиа',
  food_flax: 'ленено семе',
  food_blueberries: 'боровинки',
  food_banana: 'банан',
  food_apple: 'ябълка',
  food_zucchini: 'тиквичка',
  food_broccoli: 'броколи',
  food_spinach: 'спанак',
  food_potato: 'картофи',
  food_tomato: 'домат',
  food_lettuce_mix: 'салата',
  food_carrot: 'морков',
  food_tomato_sauce: 'доматено пюре',
  food_hummus: 'хумус',
  food_skyr: 'скир',
  food_cottage: 'извара',
  food_chicken_breast: 'пилешки гърди',
};

function fixNutritionKeyFromFoodId(foodId, nameBg) {
  if (FOOD_ID_TO_NUTRITION_KEY[foodId]) return FOOD_ID_TO_NUTRITION_KEY[foodId];
  return normalizeFoodKey(nameBg);
}


function universalityForGroup(groupId) {
  if (['meat', 'fish', 'seafood', 'eggs', 'dairy'].includes(groupId)) return 4;
  if (['vegetables', 'fruits', 'whole_grains', 'fats', 'nuts_seeds'].includes(groupId)) return 4;
  if (['herbs_spices', 'beverages', 'condiments'].includes(groupId)) return 3;
  return 3;
}

/** Convert one library food row → catalog entry (for overlay). */
export function libraryFoodToCatalogEntry(food) {
  const fixed = repairLibraryFood(food);
  if (!fixed) return null;
  const { id, name, groupId, portionG } = fixed;
  const nutritionKey = fixNutritionKeyFromFoodId(id, name);
  // Portion may have been clamped down — rescale the stored macros with it so a
  // 150g "portion of basil" does not advertise 150g worth of nutrition.
  const portionRatio = Number(food.portion_g) > 0 ? portionG / Number(food.portion_g) : 1;
  return {
    id: `lib_${id}`,
    name,
    nutritionKey,
    group: GROUP_TO_CATALOG[groupId] || 'vegetable',
    slots: GROUP_TO_SLOTS[groupId] || ['VOL'],
    timing: GROUP_TO_TIMING[groupId] || ['main'],
    universality: universalityForGroup(groupId),
    vegan: fixed.vegan,
    vegetarian: fixed.vegetarian,
    libraryGroupId: groupId,
    portionG,
    maxPortionG: portionCeilingForGroup(groupId),
    libraryTags: fixed.tags,
    allowedIn: fixed.allowedIn,
    excludedIn: fixed.excludedIn,
    fixedNutrition: portionG ? {
      kcal: Math.round((Number(food.kcal) || 0) * portionRatio),
      p: Math.round((Number(food.protein_g) || 0) * portionRatio * 10) / 10,
      c: Math.round((Number(food.carbs_g) || 0) * portionRatio * 10) / 10,
      f: Math.round((Number(food.fat_g) || 0) * portionRatio * 10) / 10,
      weightGrams: portionG,
    } : null,
    source: 'nutrition_library',
  };
}

/**
 * Nutrition profiles for library foods, keyed the same way the catalog is.
 * Merged into the nutrition database so no catalog entry is ever priced by a
 * fuzzy name match.
 * @returns {Record<string, [number, number, number, number]>}
 */
export function getLibraryNutritionPer100g() {
  /** @type {Record<string, [number, number, number, number]>} */
  const out = {};
  for (const food of LIBRARY_FOODS) {
    const fixed = repairLibraryFood(food);
    if (!fixed) continue;
    const per100 = libraryNutritionPer100g(food);
    if (!per100) continue;
    const key = normalizeFoodKey(fixNutritionKeyFromFoodId(fixed.id, fixed.name));
    if (key) out[key] = per100;
  }
  return out;
}

/** Library foods as catalog overlay — all entries with lib_ prefix for assembler. */
export function getLibraryCatalogOverlay() {
  return LIBRARY_FOODS.map(food => libraryFoodToCatalogEntry(food)).filter(Boolean);
}

/** Ready meals from library as catalog ready_meal entries. */
export function getLibraryReadyMealCatalogEntries() {
  return usableLibraryReadyMeals().meals.map(meal => {
    const mealType = LIBRARY_MEAL_TYPE_MAP[meal.meal_type] || LIBRARY_MEAL_TYPE_MAP.lunch;
    return {
      id: meal.id,
      name: meal.name_bg,
      nutritionKey: normalizeFoodKey(meal.name_bg),
      group: 'ready_meal',
      slots: ['PRO', 'ENG', 'VOL', 'FAT'],
      timing: [mealType.timing],
      universality: 4,
      vegan: (meal.diet_profiles || []).includes('vegan'),
      vegetarian: true,
      libraryMealType: meal.meal_type,
      libraryIngredients: meal.ingredients,
      fixedNutrition: {
        kcal: meal.kcal,
        p: meal.protein_g,
        c: meal.carbs_g,
        f: meal.fat_g,
      },
      source: 'nutrition_library',
    };
  });
}

/** Decompose map: meal id → [{ name, share }] from library ingredient grams. */
/** Library ready meals whose ingredient list survives repair + coherence check. */
function usableLibraryReadyMeals() {
  const foodById = new Map(LIBRARY_FOODS.map(f => [f.id, f]));
  const out = [];
  for (const meal of LIBRARY_READY_MEALS) {
    const repaired = repairReadyMealIngredients(meal);
    if (!repaired) continue;
    if (!isCoherentReadyMeal(repaired, foodById)) continue;
    if (!repaired.ingredients.reduce((s, i) => s + (i.grams || 0), 0)) continue;
    out.push({ ...meal, ingredients: repaired.ingredients });
  }
  return { meals: out, foodById };
}

export function buildLibraryReadyMealParts() {
  const { meals, foodById } = usableLibraryReadyMeals();
  const parts = {};
  for (const meal of meals) {
    const totalG = meal.ingredients.reduce((s, i) => s + (i.grams || 0), 0);
    parts[meal.id] = meal.ingredients.map(ing => {
      const food = foodById.get(ing.food_id);
      const name = food?.name_bg || ing.food_id;
      const nutritionKey = fixNutritionKeyFromFoodId(ing.food_id, name);
      return { name: nutritionKey, share: ing.grams / totalG };
    });
  }
  return parts;
}

export function resolveLibraryFoodById(id) {
  return LIBRARY_FOODS.find(f => f.id === id) || null;
}

export function getMealTemplateForSlot(slotLabel) {
  const tplId = SLOT_TO_TEMPLATE_ID[slotLabel];
  return LIBRARY_MEAL_TEMPLATES.find(t => t.id === tplId) || null;
}

export function getDietProfileRules(profileId) {
  return LIBRARY_PROTOCOL_RULES.diet_profiles?.[profileId] || null;
}

export function filterLibraryFoodsByDiet(profileId, extraExcludedGroups = []) {
  const rules = getDietProfileRules(profileId) || {};
  const excludeGroups = new Set([...(rules.exclude_groups || []), ...extraExcludedGroups]);
  const excludeTags = new Set(rules.exclude_tags || []);
  return LIBRARY_FOODS.filter(food => {
    if (excludeGroups.has(food.group_id)) return false;
    if ((food.excluded_in || []).includes(profileId)) return false;
    if (excludeTags.size && (food.tags || []).some(t => excludeTags.has(t))) return false;
    return true;
  });
}

/** Merge stats for diagnostics. */
/**
 * Merge base catalog with overlay entries — the single implementation shared by
 * the registry and the merge stats, so the two can never report different sets.
 *
 * An overlay row whose name already exists in the curated base catalog is
 * dropped rather than merged: the ids differ, so both used to survive, and a
 * library *food* then shadowed a base *dish* of the same name.
 */
export function mergeCatalogEntries(base, overlays = []) {
  const byId = new Map(base.map(e => [e.id, e]));
  // Names, aliases AND nutrition keys: the registry indexes all three, so a
  // library food colliding on any of them shadows the curated entry.
  const baseKeys = new Set();
  for (const e of base) {
    baseKeys.add(normalizeFoodKey(e.name));
    baseKeys.add(normalizeFoodKey(e.nutritionKey));
    for (const alias of e.aliases || []) baseKeys.add(normalizeFoodKey(alias));
  }
  baseKeys.delete('');
  for (const e of overlays) {
    if (!e?.id) continue;
    if (baseKeys.has(normalizeFoodKey(e.name))) continue;
    if (baseKeys.has(normalizeFoodKey(e.nutritionKey))) continue;
    byId.set(e.id, e);
  }
  return [...byId.values()];
}

export function getLibraryMergeStats() {
  const overlay = getLibraryCatalogOverlay();
  const readyCatalog = getLibraryReadyMealCatalogEntries();
  // Count what the registry actually merges, not a second reimplementation of
  // the merge — the two drifted apart once name-collision dropping was added.
  const mergedTotal = mergeCatalogEntries(FOOD_CATALOG, [...overlay, ...readyCatalog]).length;
  return {
    version: NUTRITION_LIBRARY_VERSION,
    libraryFoods: LIBRARY_FOODS.length,
    catalogOverlay: overlay.length,
    baseCatalog: FOOD_CATALOG.length,
    mergedTotal,
    readyMeals: LIBRARY_READY_MEALS.length,
    readyMealCatalog: readyCatalog.length,
    mealTemplates: LIBRARY_MEAL_TEMPLATES.length,
    dietProfiles: Object.keys(LIBRARY_PROTOCOL_RULES.diet_profiles || {}).length,
  };
}
