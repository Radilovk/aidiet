/**
 * Diet registry — narrowing-only constraints (ceilings, exclusions).
 * Complements isDietCompatible; never widens allowed sets or macro intervals.
 *
 * Single source for diet flags + blocked terms from dietaryModifier AND dietPreference.
 */

import { FOOD_NUTRITION_PER_100G } from './food-nutrition-data.js';
import { catalogDietFlagsOf, dietFromSignals } from './profile-code.js';

const REGISTRY_VERSION = 'diet_v2';

const ANIMAL_MEAT_TERMS = [
  'пилешко', 'пиле', 'пилешки', 'говеждо', 'телешко', 'телешки', 'свинско', 'свински',
  'агнешко', 'агнешки', 'патешко', 'гъши', 'пуешко', 'кайма', 'шунка', 'бекон', 'колбас',
  'салам', 'наденица', 'кебап',
];

const FISH_TERMS = [
  'риба', 'сьомга', 'скумрия', 'треска', 'тон', 'тилапия', 'скарид', 'миди',
];

const DAIRY_EGG_TERMS = [
  'мляко', 'кисело мляко', 'сирене', 'кашкавал', 'извара', 'скир', 'кефир', 'сметана', 'масло',
  'йогурт', 'ricotta', 'рикота', 'яйце', 'яйца', 'омлет', 'сурова',
];

/** @type {Record<string, { maxFatShare?: number, maxCarbShare?: number, blockedTerms?: string[] }>} */
export const DIET_NARROWING_RULES = {
  кетогенна: { maxCarbShare: 0.12 },
  keto: { maxCarbShare: 0.12 },
  нисковъглехидрат: { maxCarbShare: 0.22 },
  'без млечни': { blockedTerms: DAIRY_EGG_TERMS.filter(t => !t.includes('яй')) },
  веган: { blockedTerms: [...ANIMAL_MEAT_TERMS, ...FISH_TERMS, ...DAIRY_EGG_TERMS] },
  vegan: { blockedTerms: [...ANIMAL_MEAT_TERMS, ...FISH_TERMS, ...DAIRY_EGG_TERMS] },
  вегетариан: { blockedTerms: [...ANIMAL_MEAT_TERMS, ...FISH_TERMS] },
  vegetarian: { blockedTerms: [...ANIMAL_MEAT_TERMS, ...FISH_TERMS] },
  пескетариан: { blockedTerms: ANIMAL_MEAT_TERMS },
  pescatarian: { blockedTerms: ANIMAL_MEAT_TERMS },
};

/**
 * Catalog compatibility flags — from the same rules as the client profile code.
 * Diet style and pattern come only from the modifier and preferences; disliked
 * foods add exclusions, never a diet ("не обичам кето" is not keto). Keto and
 * low-carb are different diets.
 */
export function resolveCatalogDietProfile(ctx = {}) {
  return catalogDietFlagsOf(dietFromSignals(ctx));
}

export function getDietRegistryVersion() {
  return REGISTRY_VERSION;
}

/** Which narrowing rule each catalog flag turns on. */
const RULE_BY_FLAG = [
  ['keto', DIET_NARROWING_RULES.keto],
  ['lowCarb', DIET_NARROWING_RULES['нисковъглехидрат']],
  ['dairyFree', DIET_NARROWING_RULES['без млечни']],
  ['vegan', DIET_NARROWING_RULES.vegan],
  ['vegetarian', DIET_NARROWING_RULES.vegetarian],
  ['pescatarian', DIET_NARROWING_RULES.pescatarian],
];

function collectMatchingRules(ctx) {
  const flags = resolveCatalogDietProfile(typeof ctx === 'string' ? { dietaryModifier: ctx } : (ctx || {}));
  return RULE_BY_FLAG.filter(([flag]) => flags[flag]).map(([, rule]) => rule);
}

function shareOfKcal(nutritionKey, macroIdx) {
  const a = FOOD_NUTRITION_PER_100G[nutritionKey];
  if (!a) return 0;
  const kcal = a[1] * 4 + a[2] * 4 + a[3] * 9;
  if (kcal <= 0) return 0;
  const macroKcal = macroIdx === 3 ? a[3] * 9 : a[macroIdx] * 4;
  return macroKcal / kcal;
}

function isCarbDominantEntry(entry) {
  const slots = entry.slots || [];
  const group = entry.group || '';
  return slots.includes('ENG') || group === 'carb' || group === 'fruit'
    || (group === 'ready_meal' && !entry.fixedNutrition);
}

function isFatDominantEntry(entry) {
  const slots = entry.slots || [];
  const group = entry.group || '';
  return slots.includes('FAT') || group === 'fat';
}

function mergedRuleLimits(rules) {
  let maxCarbShare = 1;
  let maxFatShare = 1;
  const blockedTerms = new Set();
  for (const rule of rules) {
    if (rule.maxCarbShare != null) maxCarbShare = Math.min(maxCarbShare, rule.maxCarbShare);
    if (rule.maxFatShare != null) maxFatShare = Math.min(maxFatShare, rule.maxFatShare);
    for (const term of rule.blockedTerms || []) blockedTerms.add(term);
  }
  return { maxCarbShare, maxFatShare, blockedTerms: [...blockedTerms] };
}

/**
 * Additional narrowing — call after isDietCompatible.
 * @param {object} entry catalog entry
 * @param {string|object} modifierOrCtx dietaryModifier string OR { dietaryModifier, dietPreference, dietDislike }
 */
export function passesDietRegistry(entry, modifierOrCtx = '') {
  const rules = collectMatchingRules(modifierOrCtx);
  if (!rules.length) return true;

  const { maxCarbShare, maxFatShare, blockedTerms } = mergedRuleLimits(rules);
  const nKey = entry.nutritionKey || entry.name;

  if (maxFatShare < 1 && isFatDominantEntry(entry) && shareOfKcal(nKey, 3) > maxFatShare) {
    return false;
  }
  if (maxCarbShare < 1 && isCarbDominantEntry(entry) && shareOfKcal(nKey, 2) > maxCarbShare) {
    return false;
  }

  if (blockedTerms.length) {
    const nameLower = entry.name.toLowerCase();
    const keyLower = String(nKey).toLowerCase();
    for (const term of blockedTerms) {
      const t = String(term).toLowerCase();
      if (t.length < 3) continue;
      if (nameLower.includes(t) || keyLower.includes(t)) return false;
    }
  }
  return true;
}
