/**
 * Diet registry — narrowing-only constraints (ceilings, exclusions).
 * Complements isDietCompatible; never widens allowed sets or macro intervals.
 *
 * Single source for diet flags + blocked terms from dietaryModifier AND dietPreference.
 */

import { FOOD_NUTRITION_PER_100G } from './food-nutrition-data.js';
import { normalizeFoodKey } from './food-utils.js';

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

function asPreferenceList(dietPreference) {
  if (Array.isArray(dietPreference)) return dietPreference.map(String).filter(Boolean);
  if (dietPreference) return [String(dietPreference)];
  return [];
}

/** Merge all user/strategy diet signals into one constraint string. */
export function resolveDietConstraintText({
  dietaryModifier = '',
  dietPreference = null,
  dietDislike = '',
} = {}) {
  return [
    dietaryModifier,
    ...asPreferenceList(dietPreference),
    dietDislike,
  ].filter(Boolean).join(' | ');
}

/** Catalog compatibility flags — derived from modifier + preferences (not profile ids). */
export function resolveCatalogDietProfile(ctx = {}) {
  const text = resolveDietConstraintText(ctx).toLowerCase();
  const prefs = asPreferenceList(ctx.dietPreference).map(p => p.toLowerCase());
  const combined = [text, ...prefs].join(' ');
  return {
    vegan: combined.includes('веган') || combined.includes('vegan'),
    vegetarian: combined.includes('вегетариан') || combined.includes('vegetarian'),
    pescatarian: combined.includes('пескетариан') || combined.includes('pescatarian'),
    keto: /кето|нисковъглехидрат|keto|low carb/.test(combined),
    glutenFree: combined.includes('без глутен') || combined.includes('глuten free'),
  };
}

export function getDietRegistryVersion() {
  return REGISTRY_VERSION;
}

function normalizeDietKey(modifier = '') {
  return normalizeFoodKey(String(modifier).replace(/\([^)]*\)/g, ''));
}

function rulesForText(text = '') {
  const key = normalizeDietKey(text);
  if (!key) return [];
  const matched = [];
  for (const [ruleKey, rule] of Object.entries(DIET_NARROWING_RULES)) {
    if (key.includes(normalizeFoodKey(ruleKey))) matched.push(rule);
  }
  return matched;
}

function collectMatchingRules(ctx) {
  const rules = [];
  const seen = new Set();
  const push = (rule) => {
    if (!rule || seen.has(rule)) return;
    seen.add(rule);
    rules.push(rule);
  };

  if (typeof ctx === 'string') {
    for (const r of rulesForText(ctx)) push(r);
    return rules;
  }

  for (const r of rulesForText(resolveDietConstraintText(ctx))) push(r);
  for (const pref of asPreferenceList(ctx?.dietPreference)) {
    for (const r of rulesForText(pref)) push(r);
  }
  if (ctx?.dietaryModifier) {
    for (const r of rulesForText(ctx.dietaryModifier)) push(r);
  }
  return rules;
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
