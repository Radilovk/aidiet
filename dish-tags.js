/**
 * Dish tags — catalog metadata for Step 3 filtering and weekly rotation.
 * Tags are inferred from dish products/flags plus optional explicit tags in meal-dishes.js.
 */

import { resolveCatalogDietProfile } from './diet-registry.js';
import { buildQuestionnaireDietHints } from './questionnaire-engine-map.js';
import { normalizeFoodKey } from './food-utils.js';

const GLUTEN_PRODUCT_TERMS = [
  'пълнозърнест хляб', 'хляб', 'паста', 'овесени ядки', 'овес',
];

const LIQUID_PRODUCT_TERMS = [
  'мляко', 'кисело мляко', 'растително мляко', 'кефир', 'скир', 'йогурт',
];

const SWEET_PRODUCT_TERMS = [
  'мед', 'малини', 'боровинки', 'банан', 'ябълка', 'портокал', 'плодове',
];

const CARB_PRODUCT_TERMS = [
  'ориз', 'паста', 'картофи', 'хляб', 'овесени', 'боб', 'леща', 'нахут',
];

function productNameHasAny(name, terms) {
  const key = normalizeFoodKey(name);
  return terms.some(t => key.includes(normalizeFoodKey(t)));
}

/**
 * Infer tags from a raw dish record (meal-dishes shape).
 * @param {{ tags?: string[], vegan?: boolean, vegetarian?: boolean,
 *   timing?: string[], products?: Array<{name: string, grams?: number}> }} dish
 * @returns {string[]}
 */
export function inferDishTags(dish) {
  const tags = new Set(dish.tags || []);
  if (dish.vegan) tags.add('vegan');
  if (dish.vegetarian) tags.add('vegetarian');

  const products = dish.products || [];
  const names = products.map(p => p.name);
  const totalGrams = products.reduce((s, p) => s + (p.grams || 0), 0) || 1;

  if (!names.some(n => productNameHasAny(n, GLUTEN_PRODUCT_TERMS))) {
    tags.add('gluten_free');
  }

  const liquidGrams = products
    .filter(p => productNameHasAny(p.name, LIQUID_PRODUCT_TERMS))
    .reduce((s, p) => s + (p.grams || 0), 0);
  if (dish.timing?.includes('breakfast') && liquidGrams / totalGrams >= 0.45) {
    tags.add('liquid_breakfast');
  }

  if (names.some(n => productNameHasAny(n, SWEET_PRODUCT_TERMS))) {
    tags.add('sweet_slot');
  }

  if (!tags.has('low_carb')) {
    const carbParts = products.filter(p => CARB_PRODUCT_TERMS.some(
      t => normalizeFoodKey(p.name).includes(normalizeFoodKey(t)),
    ));
    const carbGrams = carbParts.reduce((s, p) => s + (p.grams || 0), 0);
    const hasMajorStarch = carbParts.some(p => (p.grams || 0) >= 40);
    if (!hasMajorStarch && carbGrams / totalGrams <= 0.2) tags.add('low_carb');
  }

  return [...tags];
}

/** Tags for a catalog entry (precomputed dishTags or inferred on the fly). */
export function dishTagList(entry) {
  if (entry?.dishTags?.length) return entry.dishTags;
  return inferDishTags({
    tags: entry?.tags,
    vegan: entry?.vegan,
    vegetarian: entry?.vegetarian,
    timing: entry?.timing,
    products: entry?.products,
  });
}

/**
 * @param {object} entry catalog entry
 * @param {{ requireAll?: string[], prefer?: string[], exclude?: string[] }|null} filter
 */
export function dishMatchesTagFilter(entry, filter) {
  if (!filter) return true;
  const tags = new Set(dishTagList(entry));
  for (const t of filter.requireAll || []) {
    if (!tags.has(t)) return false;
  }
  for (const t of filter.exclude || []) {
    if (tags.has(t)) return false;
  }
  return true;
}

/** Higher score = better match for preferred tags (used in pick tie-break). */
export function preferTagScore(entry, prefer = []) {
  if (!prefer?.length) return 0;
  const tags = new Set(dishTagList(entry));
  return prefer.filter(t => tags.has(t)).length;
}

/**
 * Resolve tag filter from questionnaire + diet profile for one slot.
 * @param {object|null} userData
 * @param {object|null} strategy
 * @param {string} slotType
 */
export function resolveDishTagFilter(userData, strategy, slotType) {
  const filter = { requireAll: [], prefer: [], exclude: [] };
  const dietCtx = {
    dietaryModifier: strategy?.dietaryModifier || '',
    dietPreference: userData?.dietPreference ?? null,
    dietDislike: userData?.dietDislike || '',
  };
  const profile = resolveCatalogDietProfile(dietCtx);
  const hints = String(userData?._engineDietHints || buildQuestionnaireDietHints(userData)).toLowerCase();
  const modifier = String(strategy?.dietaryModifier || '').toLowerCase();

  if (profile.glutenFree || /без глутен|gluten/.test(hints)) {
    filter.requireAll.push('gluten_free');
  }

  const wantsLowCarb = profile.keto
    || /кето|нисковъглехидрат|keto|low carb|инсулин/.test(hints);
  const mainSlot = slotType === 'Хранене 1' || slotType === 'Хранене 2' || slotType === 'Хранене 4';
  if (wantsLowCarb && mainSlot) filter.prefer.push('low_carb');
  if (/кетоген|keto/.test(modifier) && (slotType === 'Хранене 2' || slotType === 'Хранене 4')) {
    filter.requireAll.push('low_carb');
  }

  if (profile.vegan) filter.requireAll.push('vegan');
  else if (profile.vegetarian) filter.requireAll.push('vegetarian');

  const habits = Array.isArray(userData?.eatingHabits)
    ? userData.eatingHabits.join(' ').toLowerCase()
    : '';
  if (slotType === 'Хранене 1' && /течна|смути|шейк/.test(habits)) {
    filter.prefer.push('liquid_breakfast');
  }

  const hasRules = filter.requireAll.length || filter.prefer.length || filter.exclude.length;
  return hasRules ? filter : null;
}
