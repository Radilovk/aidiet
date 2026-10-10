/**
 * Двигател на хранителния план — пътят, по който работи диетолог:
 *
 *   профил (код) → енергия и макроси → хранителна схема в обменни порции
 *   → разпределение по храненията → седмично меню от реални ястия
 *   → проследяване и корекция всяка седмица (monitoring.js)
 *
 * Всичко е детерминистично: едни и същи данни дават един и същ план.
 */

import { compileProfile, slotsFor } from '../profile-code.js';
import { macroTargetsFor } from '../macro-targets.js';
import { extractQuestionnaireBlockedTerms } from '../questionnaire-engine-map.js';
import { buildFoodPolicy } from './policy.js';
import { prescribe } from './prescription.js';
import { planWeek, hashSeed } from './week-planner.js';
import { GROUPS } from './knowledge.js';
import { dayTotals } from './plan-shape.js';

export { ENGINE_ID, ENGINE_VERSION, FREE_MEAL, dayTotals, weeklySchemeFromPlan, isEnginePlan, reconcileEnginePlan, recomputeMealFromDescription } from './plan-shape.js';


function hasSweetsCraving(userData) {
  const list = Array.isArray(userData?.foodCravings) ? userData.foodCravings : [userData?.foodCravings];
  return list.some(c => /слад|шоколад|dessert|sweet/i.test(String(c || '')));
}

function adherenceMap(raw) {
  if (raw instanceof Map) return raw;
  if (raw && typeof raw === 'object') return new Map(Object.entries(raw));
  return null;
}

const PATTERN_RANK = { omnivore: 0, pescatarian: 1, vegetarian: 2, vegan: 3 };
const SLOT_ORDER = ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5'];

/**
 * Промените, поискани от клиента (чат) или от седмичния преглед, приложени
 * към профила като кодове — не като текст към модел.
 */
export function applyModifications(profile, mods = []) {
  const set = new Set(mods);
  const out = { ...profile, diet: { ...profile.diet }, exclusions: [...profile.exclusions], slots: [...profile.slots] };
  if (set.has('vegetarian') && PATTERN_RANK[out.diet.pattern] < PATTERN_RANK.vegetarian) out.diet.pattern = 'vegetarian';
  if (set.has('low_carb') && out.diet.style !== 'keto') out.diet.style = 'low_carb';
  if (set.has('no_dairy') && !out.exclusions.includes('LAC')) out.exclusions.push('LAC');
  if (set.has('no_intermediate_meals') || set.has('3_meals_per_day')) out.slots = slotsFor(3, out.skipsBreakfast);
  if (set.has('4_meals_per_day')) out.slots = slotsFor(4, out.skipsBreakfast);
  if (set.has('smaller_portions')) {
    const extra = ['Хранене 3', 'Хранене 5'].find(s => !out.slots.includes(s));
    if (extra) out.slots = SLOT_ORDER.filter(s => out.slots.includes(s) || s === extra);
  }
  out.mealsPerDay = out.slots.length;
  return out;
}

/** Повече белтък: +15%, до 2.2 г/кг; енергията идва от въглехидратите. */
function increaseProtein(macros, profile) {
  const cap = Math.round((Number(profile.weightKg) || 70) * 2.2);
  const protein = Math.min(cap, Math.round(macros.protein * 1.15));
  const added = protein - macros.protein;
  return { protein, carbs: Math.max(0, macros.carbs - added), fats: macros.fats };
}

/**
 * @param {object} userData
 * @param {{ kcal: number, macros?: { protein: number, carbs: number, fats: number }, seed?: number|string, slotAvoid?: Array<{ day: number, type: string, avoid: string[] }>,
 *   freeDayNumber?: number|null, previousWeek?: Iterable<string>, date?: Date, dietaryModifier?: string }} options
 */
export function buildNutritionPlan(userData, options) {
  const hints = userData?._aiHints || null;
  const mods = [...new Set([
    ...(Array.isArray(userData?.planModifications) ? userData.planModifications.map(String) : []),
    ...(hints?.approach || []),
  ])];
  const profile = applyModifications(compileProfile(userData || {}, { dietaryModifier: options.dietaryModifier }), mods);
  const kcal = Math.round(Number(options.kcal) || 0);
  if (!(kcal > 0)) throw new Error('Липсва дневен калориен прием за плана');
  const macroTargets = macroTargetsFor(profile, kcal);
  let macros = options.macros || {
    protein: macroTargets.protein,
    carbs: macroTargets.carbs,
    fats: macroTargets.fats,
  };
  if (mods.includes('increase_protein')) macros = increaseProtein(macros, profile);

  const policy = buildFoodPolicy(profile, {
    blockedTerms: userData?._engineBlockedTerms || extractQuestionnaireBlockedTerms(userData || {}),
    loves: [userData?.dietLove, ...(hints?.loves || [])].filter(Boolean).join(', '),
    adherence: adherenceMap(userData?._adherenceRatio),
    date: options.date,
    sweetsCraving: hasSweetsCraving(userData),
    extraExcludeFlags: mods.includes('gentle_digestion') ? ['high_fodmap'] : [],
    onlyFoods: Array.isArray(userData?.userFoodList) ? userData.userFoodList.map(String) : [],
  });
  const prescription = prescribe({ kcal, macros }, profile.slots, policy, {
    skipsBreakfast: profile.skipsBreakfast,
    extraVeg: mods.includes('more_volume') ? 1 : 0,
  });
  const seed = typeof options.seed === 'number' ? options.seed : hashSeed(options.seed ?? userData?.email ?? userData?.name ?? '');
  const freeDayNumber = options.freeDayNumber === undefined ? (policy.allowsFreeMeal ? 7 : null) : options.freeDayNumber;
  const week = planWeek({
    prescription,
    policy,
    seed,
    freeDayNumber,
    morningDrink: profile.skipsBreakfast,
    previousWeek: new Set(options.previousWeek || []),
    slotAvoid: options.slotAvoid || [],
    simplify: mods.includes('simplify_meals'),
    variety: mods.includes('more_variety'),
  });

  const weekPlan = {};
  week.days.forEach((day, i) => {
    weekPlan[`day${i + 1}`] = { meals: day.meals, dailyTotals: dayTotals(day.meals) };
  });

  return { profile, policy, prescription, weekPlan, freeDayNumber, stats: week.stats, macros, modifications: mods };
}

/** Хранителната схема с думи — както диетологът я дава на клиента. */
export function describeExchanges(prescription) {
  const order = ['STA', 'PRO', 'VEG', 'FRU', 'MLK', 'FAT', 'SWT'];
  const fmt = (n) => String(n).replace('.', ',');
  const day = order
    .filter(g => prescription.daily[g] > 0)
    .map(g => `${GROUPS[g].label}: ${fmt(prescription.daily[g])}`)
    .join(' · ');
  const meals = prescription.slots.map(slot => {
    const q = prescription.meals[slot].quota;
    const parts = order.filter(g => q[g] > 0).map(g => `${GROUPS[g].label.toLowerCase()} ${fmt(q[g])}`);
    return `${slot}: ${parts.join(', ') || '—'}`;
  });
  return { day, meals };
}

