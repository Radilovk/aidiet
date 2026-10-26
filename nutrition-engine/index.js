/**
 * Двигател на хранителния план — пътят, по който работи диетолог:
 *
 *   профил (код) → енергия и макроси → хранителна схема в обменни порции
 *   → разпределение по храненията → седмично меню от реални ястия
 *   → проследяване и корекция всяка седмица (monitoring.js)
 *
 * Всичко е детерминистично: едни и същи данни дават един и същ план.
 */

import { compileProfile, slotsFor, reproductiveStatus } from '../profile-code.js';
import { macroTargetsFor } from '../macro-targets.js';
import { extractQuestionnaireBlockedTerms } from '../questionnaire-engine-map.js';
import { interactionsFor } from '../drug-interactions.js';
import { buildFoodPolicy } from './policy.js';
import { prescribe } from './prescription.js';
import { planWeek, hashSeed } from './week-planner.js';
import { GROUPS } from './knowledge.js';
import { dayTotals } from './plan-shape.js';
import { metabolicWeek, menuQuality, describeMetabolicWeek } from './metabolic.js';
import { fiberPer100, microPer100 } from './fiber.js';
import { microReport } from './micronutrients.js';
import { food } from './knowledge.js';

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
 * Промените в плана, които двигателят разбира — единственият списък: от него
 * се пишат инструкциите на чата, по него се проверява всичко, което AI върне.
 * Плюс exclude_food:<храна>.
 */
export const PLAN_MODIFICATION_CODES = {
  '3_meals_per_day': '3 хранения дневно (без междинни)',
  no_intermediate_meals: 'без междинни хранения (= 3 хранения)',
  '4_meals_per_day': '4 хранения дневно (с една междинна закуска)',
  '5_meals_per_day': '5 хранения дневно (връща междинните закуски)',
  vegetarian: 'вегетарианско — без месо и риба',
  no_dairy: 'без млечни продукти',
  low_carb: 'нисковъглехидратно',
  increase_protein: 'повече белтък (+15%)',
  smaller_portions: 'по-малки порции, разпределени в повече хранения',
  simplify_meals: 'по-прости ястия, по-малко готвене, повторения',
  more_variety: 'повече разнообразие в основните ястия',
  more_volume: 'повече обем (зеленчуци) при същите калории',
  gentle_digestion: 'щадящо храносмилането (без храни, които подуват)',
  time_restricted_eating: 'хранене в часови прозорец в почивните дни (интермитентно гладуване)',
};
const MEAL_COUNT_CODES = ['3_meals_per_day', 'no_intermediate_meals', '4_meals_per_day', '5_meals_per_day'];

/**
 * Добавя нови промени към текущите: само познати кодове и exclude_food:…;
 * новият брой хранения заменя стария (3 и 4 хранения не се трупат).
 * @param {unknown[]} existing
 * @param {unknown[]} incoming
 * @returns {{ merged: string[], accepted: string[], rejected: string[] }}
 */
export function mergePlanModifications(existing = [], incoming = []) {
  const valid = (m) => PLAN_MODIFICATION_CODES[m] || /^exclude_food:.{2,60}$/.test(m);
  const merged = (Array.isArray(existing) ? existing : []).map(m => String(m).trim()).filter(valid);
  const accepted = [];
  const rejected = [];
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const m = String(raw ?? '').trim();
    if (!valid(m)) { if (m) rejected.push(m); continue; }
    if (MEAL_COUNT_CODES.includes(m)) {
      for (let i = merged.length - 1; i >= 0; i--) if (MEAL_COUNT_CODES.includes(merged[i])) merged.splice(i, 1);
    }
    if (!merged.includes(m)) merged.push(m);
    accepted.push(m);
  }
  return { merged, accepted, rejected };
}

/**
 * Промените, поискани от клиента (чат) или от седмичния преглед, приложени
 * към профила като кодове — не като текст към модел.
 */
export function applyModifications(profile, mods = []) {
  const set = new Set(mods);
  const out = { ...profile, diet: { ...profile.diet }, exclusions: [...profile.exclusions], slots: [...profile.slots], behaviors: [...(profile.behaviors || [])] };
  if (set.has('vegetarian') && PATTERN_RANK[out.diet.pattern] < PATTERN_RANK.vegetarian) out.diet.pattern = 'vegetarian';
  if (set.has('low_carb') && out.diet.style !== 'keto') out.diet.style = 'low_carb';
  if (set.has('no_dairy') && !out.exclusions.includes('LAC')) out.exclusions.push('LAC');
  if (set.has('no_intermediate_meals') || set.has('3_meals_per_day')) out.slots = slotsFor(3, out.skipsBreakfast);
  if (set.has('4_meals_per_day')) out.slots = slotsFor(4, out.skipsBreakfast);
  if (set.has('5_meals_per_day')) out.slots = slotsFor(5, out.skipsBreakfast);
  // Часовият прозорец е като избран „Фастинг“ — но не и при лекарства с риск от хипогликемия.
  if (set.has('time_restricted_eating') && !out.behaviors.includes('IF') && !(out.adjustments || []).some(a => /^MEDS_NO_FASTING/.test(a))) {
    out.behaviors = [...out.behaviors, 'IF'];
  }
  if (set.has('smaller_portions')) {
    const extra = ['Хранене 3', 'Хранене 5'].find(s => !out.slots.includes(s));
    if (extra) out.slots = SLOT_ORDER.filter(s => out.slots.includes(s) || s === extra);
  }
  out.mealsPerDay = out.slots.length;
  return out;
}

/** Таван на белтъка в грамове; освободената енергия отива към въглехидратите. */
function capProtein(macros, capG) {
  if (!(capG > 0) || macros.protein <= capG) return macros;
  return { protein: capG, carbs: macros.carbs + (macros.protein - capG), fats: macros.fats };
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
 * @param {{ kcal: number, macros?: { protein: number, carbs: number, fats: number }, seed?: number|string, slotAvoid?: Array<{ day: number, type: string, avoid: string[] }>, dishPreference?: Record<string, number>,
 *   freeDayNumber?: number|null, previousWeek?: Iterable<string>, date?: Date, dietaryModifier?: string, metabolic?: boolean }} options
 *   metabolic: false — без метаболитната седмица (всички дни с една цел)
 */
export function buildNutritionPlan(userData, options) {
  const hints = userData?._aiHints || null;
  const mods = [...new Set([
    ...(Array.isArray(userData?.planModifications) ? userData.planModifications.map(String) : []),
    ...(hints?.approach || []),
    ...(userData?._enrichment?.hints?.approach || []),
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
  // Граница за безопасност от изследвания (бъбречна функция): белтъкът не минава
  // тавана в г/кг, а енергията отива към въглехидратите.
  const proteinCap = Number(userData?._enrichment?.safety?.proteinCapPerKg);
  if (proteinCap > 0 && profile.weightKg) macros = capProtein(macros, Math.round(profile.weightKg * proteinCap));

  const policy = buildFoodPolicy(profile, {
    blockedTerms: [
      ...(userData?._engineBlockedTerms || extractQuestionnaireBlockedTerms(userData || {})),
      // Храни, които влизат в конфликт с лекарство (грейпфрут при статин, тирамин при МАО инхибитор).
      ...interactionsFor(userData || {}).blockFoods,
    ],
    loves: [userData?.dietLove, ...(hints?.loves || [])].filter(Boolean).join(', '),
    adherence: adherenceMap(userData?._adherenceRatio),
    date: options.date,
    sweetsCraving: hasSweetsCraving(userData),
    extraExcludeFlags: mods.includes('gentle_digestion') ? ['high_fodmap'] : [],
    onlyFoods: Array.isArray(userData?.userFoodList) ? userData.userFoodList.map(String) : [],
  });
  // Рефлукс: без хранене 2–3 часа преди лягане — късната закуска отпада.
  const slots = policy.noLateMeal && profile.slots.length > 3 ? profile.slots.filter(s => s !== 'Хранене 5') : profile.slots;
  const rxOptions = {
    skipsBreakfast: profile.skipsBreakfast,
    noLateMeal: policy.noLateMeal,
    extraVeg: mods.includes('more_volume') ? 1 : 0,
  };
  const prescription = prescribe({ kcal, macros }, slots, policy, rxOptions);
  // Метаболитната седмица: тренировъчни и почивни дни, горивото и часът му,
  // часовият прозорец. Средното за седмицата е точно kcal и macros.
  const metabolic = options.metabolic === false ? null : metabolicWeek(profile, userData || {}, { kcal, macros }, slots);
  const dayPrescriptions = metabolic
    ? metabolic.days.map(d => prescribe({ kcal: d.kcal, macros: d.macros }, d.slots, policy, {
      ...rxOptions,
      skipsBreakfast: rxOptions.skipsBreakfast || !d.slots.includes('Хранене 1'),
      groupBias: d.bias,
      mealScale: d.slots.length < slots.length ? slots.length / d.slots.length : 1,
    }))
    : null;
  const seed = typeof options.seed === 'number' ? options.seed : hashSeed(options.seed ?? userData?.email ?? userData?.name ?? '');
  const freeDayNumber = options.freeDayNumber === undefined ? (policy.allowsFreeMeal ? 7 : null) : options.freeDayNumber;
  const week = planWeek({
    prescription,
    policy,
    seed,
    freeDayNumber,
    // Напитката е вместо закуска — не и когато закуската е върната заради порциите.
    // Без отделна карта „Напитка“: който не закусва, просто започва с първото хранене.
    morningDrink: false,
    previousWeek: new Set(options.previousWeek || []),
    slotAvoid: options.slotAvoid || [],
    simplify: mods.includes('simplify_meals'),
    variety: mods.includes('more_variety'),
    dishPreference: options.dishPreference || {},
    dayPrescriptions,
  });

  const weekPlan = {};
  week.days.forEach((day, i) => {
    weekPlan[`day${i + 1}`] = { meals: day.meals, dailyTotals: dayTotals(day.meals) };
    const d = metabolic?.days[i];
    if (d) {
      // Какъв е денят и защо — приложението го показва над храненията.
      weekPlan[`day${i + 1}`].energy = {
        kind: d.kind,
        kcal: d.kcal,
        protein: d.macros.protein,
        carbs: d.macros.carbs,
        fats: d.macros.fats,
        ...(d.timing.post ? { postWorkoutMeal: d.timing.post } : {}),
        ...(d.timing.pre ? { preWorkoutMeal: d.timing.pre } : {}),
        // Въглехидратите — преди тренировката, след нея белтък и зеленчуци (metabolic.js, принцип 7).
        ...(d.carbsBefore ? { carbsBefore: true } : {}),
        ...(d.window ? { window: d.window } : {}),
      };
    }
  });
  const weekFoods = week.days.map(d => ({ meals: d.foods || [] }));
  const quality = menuQuality(weekFoods, { food, fiberPer100 }, profile, kcal);
  // Микронутриентите — само измерване на готовото меню (не влизат в подбора).
  // Нуждите — и при бременност/кърмене; при бъбречна граница или висок калий калият не се съветва нагоре.
  const repro = reproductiveStatus(userData || {});
  const enr = userData?._enrichment || {};
  const restrictK = Number(enr.safety?.proteinCapPerKg) > 0 || (enr.labs || []).some(l => l.key === 'potassium' && l.status === 'high');
  const micro = microReport(weekFoods, microPer100, profile, { pregnant: repro.pregnant, lactating: repro.lactating, restrictK });
  const metabolicPlan = metabolic ? {
    training: { days: metabolic.week.days, source: metabolic.week.source, slot: metabolic.week.slot, fuel: metabolic.week.fuel, types: metabolic.week.types, sessionKcal: metabolic.week.sessionKcal },
    fasting: metabolic.fasting,
    text: describeMetabolicWeek(metabolic, profile),
    quality,
    micro,
  } : { quality, micro };

  return { profile, policy, prescription, weekPlan, freeDayNumber, stats: week.stats, macros, modifications: mods, metabolicPlan };
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

