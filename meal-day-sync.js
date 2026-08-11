/**
 * Day-level nutrition sync — atomic-first, budget redistribution, then solver.
 * Frozen scheme slot targets in strategy are never rewritten.
 */

import {
  applyMealNutritionFromDatabase,
  macrosToNutritionProfile,
} from './food-nutrition.js';
import {
  resolveAtomicEntryFromDescription,
  SCALING_ATOMIC,
} from './food-registry.js';
import { isMealCaloriesAdequate } from './plan-normalize.js';

const SKIP_TYPES = new Set(['Свободно хранене', 'Напитка']);

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

  // Each decomposable slot solves to its own frozen schemeTarget — no cross-slot target shift.

  for (const { meal, schemeTarget } of decomposable) {
    const result = applyMealNutritionFromDatabase(meal, schemeTarget, extraDb);
    if (result.unknowns?.length) unknowns.push(...result.unknowns);
    if (result.feasible === false) {
      infeasible.push({ type: meal.type, reason: result.reason || 'неосъществим слот' });
    }
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
