/**
 * Repair layer for the auto-generated nutrition library.
 *
 * `nutrition-library-data.js` is an import artefact: some rows carry mangled
 * Cyrillic/Latin names, a blanket 150 g portion, composite dishes filed as raw
 * foods, and starches filed as vegetables. Every consumer used to work around
 * those rows with ad-hoc name regexes; this module normalises a row once, by
 * stable `id`, so the rest of the pipeline can trust the data.
 *
 * Keyed by id — never by name — because the names are exactly what is broken.
 */

/** id → correct Bulgarian name (mixed-script import damage). */
export const LIBRARY_NAME_FIXES = {
  food_sparkling_water: 'Минерална вода',
  food_salsa: 'Салса',
  food_tarator: 'Таратор',
  food_ghee: 'Гхи',
  food_olive_oil_extra: 'Зехтин (extra virgin)',
  food_nut_таhan: 'Тахан',
  food_parsley: 'Магданоз',
  food_mint: 'Мента',
  food_soup_chicken: 'Пилешка супа',
  food_kebab_chicken: 'Пилешки кебап',
  food_pork_chop: 'Свинска котлета',
  food_brazil_nuts: 'Бразилски орех',
  food_macadamia: 'Макадамия',
  food_pecans: 'Пекан',
  food_walnuts_raw: 'Сурови орехи',
  food_protein_bar: 'Протеиново барче',
  food_banitsa: 'Баница (порция)',
  food_calamari: 'Калмари',
  food_cucumber_mini: 'Корнишони',
  food_sweet_potato_baked: 'Печен сладък картоф',
  food_mushroom_portobello: 'Портобело',
  food_romaine: 'Ромен салата',
  food_watercress: 'Кресон',
  food_grill_veg: 'Печени зеленчуци',
  food_brussels: 'Брюкселско зеле',
  food_carrot_fodmap: 'Морков (нисък FODMAP)',
  food_rice_fodmap: 'Ориз (нисък FODMAP)',
  food_smoothie_base: 'Смути база',
};

/** id → correct library group (import misclassification). */
export const LIBRARY_GROUP_FIXES = {
  // Starchy roots belong in the energy pool, not among leafy volume foods.
  food_sweet_potato_baked: 'whole_grains',
  // Legume spread — a real protein/fat component, not a table condiment.
  food_hummus: 'legumes',
};

/**
 * Rows that must never enter the atomic food pool.
 * Composite dishes (they belong to the ready-meal pool), assembly bases, and
 * exact duplicates of another row.
 */
export const LIBRARY_DROP_IDS = new Set([
  'food_tarator',        // composite dish
  'food_soup_chicken',   // composite dish
  'food_kebab_chicken',  // composite dish
  'food_banitsa',        // composite pastry
  'food_smoothie_base',  // assembly base, not a food
  'food_nut_таhan',      // duplicate of Тахан (food_tahini)
  'food_coconut_flakes', // carries coconut-oil macros — duplicate of Кокосово масло
]);

/**
 * Composite dish names — script-agnostic net for rows this table does not list
 * by id. Applied after the name repair, so it sees clean Cyrillic.
 */
export const COMPOSITE_DISH_NAME =
  /яхния|супа|таратор|баница|кебап|смути|с картофи|с пиле|ориз с|риба с|каша|омлет|сандвич|на скара|на фурна|купа с|плескавиц|мусака|боул/i;

/** Herbs and spices that import as vegetables. */
export const HERB_SPICE_NAME =
  /^(босилек|риган|мащерка|синап|горчица|чили|черен пипер|бял пипер|червен пипер|кимион|ким|копър|магданоз|мента|дафинов|хрян|стевия|оцет|куркума|канела|джинджифил|сумак|салвия|чубрица|розмарин|естрагон|кориандър)/i;

/**
 * Animal-derived foods that sit in plant groups, so `excluded_in` alone cannot
 * classify them. Butter and ghee are dairy fats; honey is an animal product.
 */
export const NON_VEGAN_IDS = new Set(['food_butter', 'food_ghee', 'food_honey']);

/** Library group → realistic single-serving ceiling in grams. */
export const GROUP_PORTION_CEILING = {
  herbs_spices: 5,
  condiments: 20,
  sweets: 30,
  fats: 30,
  nuts_seeds: 40,
  beverages: 250,
  fruits: 200,
  vegetables: 250,
  dairy: 250,
  eggs: 150,
  meat: 200,
  fish: 200,
  seafood: 200,
  legumes: 250,
  whole_grains: 250,
  refined_grains: 250,
  plant_protein: 200,
};

/** Ceiling used when a group is unknown. */
const DEFAULT_PORTION_CEILING = 200;

export function portionCeilingForGroup(groupId) {
  return GROUP_PORTION_CEILING[groupId] ?? DEFAULT_PORTION_CEILING;
}

/** True when the row is a composite dish / base that must stay out of the food pool. */
export function isDroppedLibraryFood(id, name) {
  if (LIBRARY_DROP_IDS.has(id)) return true;
  return COMPOSITE_DISH_NAME.test(String(name || ''));
}

/**
 * Normalise one raw library row.
 * @returns {null | { id: string, name: string, groupId: string, portionG: number,
 *   vegan: boolean, vegetarian: boolean, excludedIn: string[], allowedIn: string[],
 *   tags: string[], fodmapHigh: boolean }}
 *   `null` when the row must not become a catalog entry.
 */
export function repairLibraryFood(food) {
  if (!food?.id) return null;
  const id = String(food.id);
  const name = LIBRARY_NAME_FIXES[id] || food.name_bg || food.name || '';
  if (!name) return null;
  if (isDroppedLibraryFood(id, name)) return null;

  let groupId = LIBRARY_GROUP_FIXES[id] || food.group_id || 'vegetables';
  if (HERB_SPICE_NAME.test(name.trim())) groupId = 'herbs_spices';
  else if (/макарон|паста|спагет/i.test(name)) groupId = 'refined_grains';

  const ceiling = portionCeilingForGroup(groupId);
  const rawPortion = Number(food.portion_g) || 0;
  // The import wrote a blanket 150 g on most rows — clamp, never trust upward.
  const portionG = rawPortion > 0 ? Math.min(rawPortion, ceiling) : ceiling;

  // `excluded_in` lists the diets a food is FORBIDDEN in — it is not a badge of
  // membership. Reading it as one flagged every animal product vegan and every
  // oil, nut and avocado non-vegan.
  const excluded = new Set((food.excluded_in || []).map(String));
  const animalGroup = ['meat', 'fish', 'seafood', 'eggs', 'dairy'].includes(groupId);
  const fleshGroup = ['meat', 'fish', 'seafood'].includes(groupId);

  const vegan = !excluded.has('vegan') && !animalGroup && !NON_VEGAN_IDS.has(id);
  const vegetarian = vegan || (!excluded.has('vegetarian') && !fleshGroup);

  const tags = food.tags || [];
  return {
    id,
    name,
    groupId,
    portionG,
    vegan,
    vegetarian,
    excludedIn: [...excluded],
    allowedIn: food.allowed_in || [],
    tags,
    fodmapHigh: tags.includes('fodmap_high'),
  };
}

/**
 * Ready-meal ingredient repair.
 *
 * Twelve library dishes carry `food_herbal_tea` where their real ingredient
 * should be — a placeholder the importer left behind. The dish names say what
 * belongs there. Anything still incoherent after this table is dropped by
 * `isCoherentReadyMeal`, because a dish whose product list is wrong must never
 * reach a client, however good its macros look.
 */
export const READY_MEAL_INGREDIENT_FIXES = {
  meal_oats_egg_berries: { food_herbal_tea: 'food_oats' },
  meal_bread_egg_avocado: { food_herbal_tea: 'food_bread_whole' },
  meal_turkey_potato_salad: { food_herbal_tea: 'food_lettuce' },
  meal_fish_potato_salad: { food_herbal_tea: 'food_lettuce' },
  meal_shrimp_pasta: { food_herbal_tea: 'food_pasta' },
  meal_pork_beans: { food_herbal_tea: 'food_white_beans' },
  meal_chicken_salad_dinner: { food_herbal_tea: 'food_lettuce' },
  meal_mackerel_salad: { food_herbal_tea: 'food_lettuce' },
  meal_eggplant_turkey: { food_herbal_tea: 'food_eggplant' },
  // Two placeholders in one dish: the tuna itself and its salad base.
  meal_tuna_salad: { food_herbal_tea: ['food_tuna', 'food_lettuce'] },
};

/** Dishes the repair cannot rescue — no sensible ingredient exists for them. */
export const READY_MEAL_DROP_IDS = new Set([
  'meal_protein_shake',   // a shake of herbal tea and banana
  'meal_cheese_crackers', // crackers are not in the library at all
]);

/** Library groups that may never stand in as a dish ingredient. */
const NON_INGREDIENT_GROUPS = new Set(['beverages']);

/**
 * Apply the ingredient fixes to one ready meal.
 * @returns {null | { id: string, ingredients: Array<{food_id: string, grams: number}> }}
 */
export function repairReadyMealIngredients(meal) {
  if (!meal?.id) return null;
  if (READY_MEAL_DROP_IDS.has(meal.id)) return null;
  const fixes = READY_MEAL_INGREDIENT_FIXES[meal.id] || {};
  const usedReplacements = new Map();

  const ingredients = (meal.ingredients || []).map((ing) => {
    const fix = fixes[ing.food_id];
    if (!fix) return { ...ing };
    if (Array.isArray(fix)) {
      const n = usedReplacements.get(ing.food_id) || 0;
      usedReplacements.set(ing.food_id, n + 1);
      return { ...ing, food_id: fix[Math.min(n, fix.length - 1)] };
    }
    return { ...ing, food_id: fix };
  });

  return { id: meal.id, ingredients };
}

/**
 * A ready meal is usable only when every ingredient is a real food, no
 * ingredient repeats, and nothing from a non-ingredient group is in it.
 * @param {{ ingredients?: Array<{food_id: string}> }} meal
 * @param {Map<string, { group_id?: string }>} foodById
 */
export function isCoherentReadyMeal(meal, foodById) {
  const ingredients = meal?.ingredients || [];
  if (!ingredients.length) return false;
  const seen = new Set();
  for (const ing of ingredients) {
    const food = foodById.get(ing.food_id);
    if (!food) return false;
    if (NON_INGREDIENT_GROUPS.has(food.group_id)) return false;
    if (seen.has(ing.food_id)) return false;
    seen.add(ing.food_id);
  }
  return true;
}

/**
 * Per-100 g macros derived from a raw library row.
 * The library states macros for one portion; the pipeline works per 100 g.
 * Without this, ninety-odd library foods had no nutrition entry at all and fell
 * through to a fuzzy substring match — which is how a dish once acquired the
 * macros of herbal tea.
 * @returns {null | [number, number, number, number]} [kcal, protein, carbs, fat]
 */
export function libraryNutritionPer100g(food) {
  const portion = Number(food?.portion_g) || 0;
  if (portion <= 0) return null;
  const factor = 100 / portion;
  const p = Math.round((Number(food.protein_g) || 0) * factor * 10) / 10;
  const c = Math.round((Number(food.carbs_g) || 0) * factor * 10) / 10;
  const f = Math.round((Number(food.fat_g) || 0) * factor * 10) / 10;
  const kcal = Math.round((Number(food.kcal) || 0) * factor);
  if (kcal <= 0 && p <= 0 && c <= 0 && f <= 0) return null;
  return [kcal, p, c, f];
}
