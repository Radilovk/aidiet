/**
 * Diet registry — narrowing-only constraints (ceilings, exclusions).
 * Complements isDietCompatible; never widens allowed sets or macro intervals.
 */

import { FOOD_NUTRITION_PER_100G } from './food-nutrition-data.js';
import { normalizeFoodKey } from './food-utils.js';

const REGISTRY_VERSION = 'diet_v1';

function shareOfKcal(nutritionKey, macroIdx) {
  const a = FOOD_NUTRITION_PER_100G[nutritionKey];
  if (!a) return 0;
  const kcal = a[1] * 4 + a[2] * 4 + a[3] * 9;
  if (kcal <= 0) return 0;
  const macroKcal = macroIdx === 3 ? a[3] * 9 : a[macroIdx] * 4;
  return macroKcal / kcal;
}

/** @type {Record<string, { maxFatShare?: number, maxCarbShare?: number, blockedTerms?: string[] }>} */
export const DIET_NARROWING_RULES = {
  кетогенна: { maxCarbShare: 0.12 },
  keto: { maxCarbShare: 0.12 },
  нисковъглехидрат: { maxCarbShare: 0.22 },
  'без млечни': {
    blockedTerms: ['мляко', 'кисело мляко', 'сирене', 'кашкавал', 'извара', 'скир', 'кефир', 'сметана'],
  },
};

function normalizeDietKey(modifier = '') {
  return normalizeFoodKey(String(modifier).replace(/\([^)]*\)/g, ''));
}

export function getDietRegistryVersion() {
  return REGISTRY_VERSION;
}

function matchRule(dietaryModifier = '') {
  const key = normalizeDietKey(dietaryModifier);
  for (const [k, rule] of Object.entries(DIET_NARROWING_RULES)) {
    if (key.includes(normalizeFoodKey(k))) return rule;
  }
  return null;
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

/** Additional narrowing — call after isDietCompatible. */
export function passesDietRegistry(entry, dietaryModifier = '') {
  const rule = matchRule(dietaryModifier);
  if (!rule) return true;

  const nKey = entry.nutritionKey || entry.name;
  // Share-based ceilings apply to macro-dominant roles only.
  // VOL vegetables are low-kcal → carb share is misleading for keto narrowing.
  if (rule.maxFatShare != null && isFatDominantEntry(entry) && shareOfKcal(nKey, 3) > rule.maxFatShare) {
    return false;
  }
  if (rule.maxCarbShare != null && isCarbDominantEntry(entry) && shareOfKcal(nKey, 2) > rule.maxCarbShare) {
    return false;
  }

  if (rule.blockedTerms?.length) {
    const nameLower = entry.name.toLowerCase();
    const keyLower = String(nKey).toLowerCase();
    for (const term of rule.blockedTerms) {
      const t = String(term).toLowerCase();
      if (t.length < 3) continue;
      if (nameLower.includes(t) || keyLower.includes(t)) return false;
    }
  }
  return true;
}
