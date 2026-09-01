/**
 * Day-level nutrition sync — atomic-first, budget redistribution, then solver.
 * Frozen scheme slot targets in strategy are never rewritten.
 */

import {
  applyMealNutritionFromDatabase,
  macrosToNutritionProfile,
  mealAchievableKcal,
} from './food-nutrition.js';
import {
  resolveAtomicEntryFromDescription,
  SCALING_ATOMIC,
} from './food-registry.js';
import { isMealCaloriesAdequate, FIRST_MEAL_SLOT } from './plan-normalize.js';

const SKIP_TYPES = new Set(['Свободно хранене', 'Напитка']);

/**
 * Колко може да се измести целта на един слот, за да се събере денят.
 *
 * Грамажите вървят на стъпки от 50 г и едно ястие не може да улучи произволно
 * число калории; разликата се пренася към следващите основни хранения. Това е
 * договорът, по който слотът се решава — и по който трябва да се проверява.
 */
export const MEAL_CARRY_MAX_DISTORTION = 0.25;

function dessertNutrition(meal) {
  if (!meal?.dessert || typeof meal.dessert !== 'object') return null;
  return macrosToNutritionProfile(meal.dessert.macros);
}

/** Apply fixed restaurant / menu portion — no gram scaling. */
export function applyAtomicMealNutrition(meal, schemeTarget) {
  const entry = resolveAtomicEntryFromDescription(meal.description);
  if (!entry?.fixedNutrition) {
    return { ok: false, feasible: false, reason: 'липсва fixedNutrition за атомарно ястие', unknowns: [] };
  }

  const fixed = entry.fixedNutrition;
  const weight = Number(fixed.weightGrams) || 0;
  meal.description = `• ${entry.name}`;
  meal.weight = weight > 0 ? `${Math.round(weight)}г` : '';
  meal.macros = {
    protein: Math.round(Number(fixed.p) || 0),
    carbs: Math.round(Number(fixed.c) || 0),
    fats: Math.round(Number(fixed.f) || 0),
  };
  meal.calories = Math.round(Number(fixed.kcal) || 0);
  meal.scalingMode = SCALING_ATOMIC;

  const targetKcal = Number(schemeTarget?.calories) || 0;
  const feasible = targetKcal <= 0 || isMealCaloriesAdequate(meal.calories, targetKcal);
  return {
    ok: true,
    feasible,
    reason: feasible ? '' : 'атомарната порция не пасва в слота — избери друго ястие',
    unknowns: [],
    kcalDelta: meal.calories - targetKcal,
  };
}

function isAtomicMeal(meal) {
  return resolveAtomicEntryFromDescription(meal.description) != null;
}

/**
 * @deprecated Per-slot scheme targets are frozen — do not shift solver targets across meals.
 * Kept for tests documenting the old behaviour.
 */
export function adjustDecomposableTargets(decomposable, kcalDrift) {
  if (!decomposable.length || !kcalDrift) return;

  const totalScheme = decomposable.reduce((s, x) => s + (Number(x.schemeTarget?.calories) || 0), 0);
  if (totalScheme <= 0) return;

  let remaining = kcalDrift;
  for (const item of decomposable) {
    const share = (Number(item.schemeTarget?.calories) || 0) / totalScheme;
    const adjust = Math.round(kcalDrift * share);
    item.solveTarget.calories = Math.max(50, (Number(item.solveTarget.calories) || 0) - adjust);
    remaining -= adjust;
  }
  if (remaining !== 0 && decomposable.length) {
    const last = decomposable[decomposable.length - 1];
    last.solveTarget.calories = Math.max(50, (Number(last.solveTarget.calories) || 0) - remaining);
  }
}

/**
 * Целта на слота — в границите на преноса и на мрежата на ястието.
 *
 * Ястието не носи произволно число калории: грамажите вървят на стъпки и
 * между две съседни порции има дупка. Преносът избира най-близката стойност,
 * която ястието наистина има, вместо да иска нещо по средата на дупката.
 */
function carryTargetFor(meal, wanted, floor, ceiling) {
  const bounded = Math.max(floor, Math.min(ceiling, wanted));
  const options = [bounded, floor, ceiling]
    .map(k => mealAchievableKcal(meal, k))
    .filter(k => k > 0);
  if (!options.length) return bounded;
  const inBand = options.filter(k => k >= floor && k <= ceiling);
  const pool = inBand.length ? inBand : options;
  return pool.reduce((best, k) =>
    Math.abs(k - bounded) < Math.abs(best - bounded) ? k : best);
}

/**
 * Sync one day: atomics first, redistribute drift, then decomposable solver path.
 */
export function syncDayMealsNutrition(day, dayScheme, extraDb = {}) {
  const unknowns = [];
  const infeasible = [];
  if (!day?.meals?.length) return { unknowns, infeasible };

  const breakdown = dayScheme?.mealBreakdown || [];
  const atomic = [];
  const decomposable = [];

  for (const meal of day.meals) {
    if (SKIP_TYPES.has(meal.type)) continue;
    const schemeTarget = breakdown.find(m => m.type === meal.type);
    if (!schemeTarget) continue;

    if (isAtomicMeal(meal)) {
      atomic.push({ meal, schemeTarget });
    } else {
      decomposable.push({ meal, schemeTarget });
    }
  }

  for (const { meal, schemeTarget } of atomic) {
    const result = applyAtomicMealNutrition(meal, schemeTarget);
    if (result.unknowns?.length) unknowns.push(...result.unknowns);
    if (!result.feasible) {
      infeasible.push({ type: meal.type, reason: result.reason || 'атомарен слот' });
    }
  }

  // Грамажите вървят на стъпки от 50 г, така че едно ястие не може да улучи
  // произволно число калории. Договорът е дневният сбор: каквото един слот не
  // догони или прехвърли, се пренася към следващите основни хранения — H3 и H5
  // имат твърди тавани и не могат да поемат разлика.
  //
  // Два кръга: първият решава слотовете, вторият дава на основните хранения
  // остатъка на деня. Един кръг не стигаше, защото последният слот трябваше да
  // поеме всичко, натрупано преди него.
  const CARRY_RECIPIENTS = new Set([FIRST_MEAL_SLOT, 'Хранене 2', 'Хранене 4']);
  const dayTargetKcal = decomposable.reduce(
    (sum, x) => sum + (Number(x.schemeTarget?.calories) || 0), 0);

  const solveRound = (carryStart) => {
    let carry = carryStart;
    for (let i = 0; i < decomposable.length; i++) {
      const { meal, schemeTarget } = decomposable[i];
      const remaining = decomposable.slice(i).filter(x => CARRY_RECIPIENTS.has(x.meal.type)).length;
      const baseKcal = Number(schemeTarget?.calories) || 0;
      const share = CARRY_RECIPIENTS.has(meal.type) && remaining > 0 ? carry / remaining : 0;
      // Слотът поема част от разликата, но не се изкривява повече от 25% —
      // и никога извън това, което ястието в него може да носи. Иначе
      // преносът искаше от пилешката супа 1000 kcal, тя даваше 780, а
      // разликата се връщаше като грешка на слот, чийто ден е верен.
      const adjusted = baseKcal > 0
        ? carryTargetFor(
          meal,
          baseKcal + share,
          baseKcal * (1 - MEAL_CARRY_MAX_DISTORTION),
          baseKcal * (1 + MEAL_CARRY_MAX_DISTORTION),
        )
        : baseKcal;
      const solveTarget = baseKcal > 0 && Math.round(adjusted) !== baseKcal
        ? { ...schemeTarget, calories: Math.round(adjusted) }
        : schemeTarget;

      // Каква цел е получил слотът наистина. Без този запис валидацията сравнява
      // готовото хранене със замразената схема, а не с целта, по която е решено,
      // и обявява за грешка точно преноса, който сама е поискала.
      meal.targetCalories = Number(solveTarget.calories) || baseKcal;

      const result = applyMealNutritionFromDatabase(meal, solveTarget, extraDb);
      if (result.unknowns?.length) unknowns.push(...result.unknowns);
      carry += baseKcal - (Number(meal.calories) || 0);
      if (result.feasible === false) {
        infeasible.push({ type: meal.type, reason: result.reason || 'неосъществим слот' });
      }
    }
  };

  solveRound(0);
  const achieved = decomposable.reduce((sum, x) => sum + (Number(x.meal.calories) || 0), 0);
  const residual = dayTargetKcal - achieved;
  if (dayTargetKcal > 0 && Math.abs(residual) > dayTargetKcal * 0.05) {
    infeasible.length = 0;
    unknowns.length = 0;
    solveRound(residual);
  }

  return { unknowns: [...new Set(unknowns)], infeasible };
}

export function syncWeekPlanNutritionWithDayBudget(weekPlan, strategy, startDay, endDay, extraDb = {}) {
  const unknowns = [];
  const infeasible = [];
  if (!weekPlan || !strategy?.weeklyScheme) return { unknowns, infeasible };

  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (let d = startDay; d <= endDay; d++) {
    const day = weekPlan[`day${d}`];
    const dayScheme = strategy.weeklyScheme[dayKeys[d - 1]];
    const result = syncDayMealsNutrition(day, dayScheme, extraDb);
    unknowns.push(...result.unknowns);
    for (const slot of result.infeasible) {
      infeasible.push({ day: d, type: slot.type, reason: slot.reason });
    }
  }
  return { unknowns: [...new Set(unknowns)], infeasible };
}

export const syncWeekPlanNutritionFromDatabase = syncWeekPlanNutritionWithDayBudget;
