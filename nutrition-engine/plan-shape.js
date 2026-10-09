/**
 * Формата на плана, която приложението чете: дневни суми, седмичната схема
 * в стратегията и преизчисляване на хранене от описанието му.
 *
 * Описанието („• Пилешки гърди 140g“) е източникът на истината: всяка
 * промяна по плана (админ, корекция) минава през него, а калориите и
 * макросите се смятат наново от грамовете — никога не се мащабират.
 */

import { foodByCatalogName, nutrientsOf } from './knowledge.js';
import { lookupFoodProfile } from '../food-nutrition.js';

export const ENGINE_ID = 'exchange-v4';
export const ENGINE_VERSION = '4.0';
export const FREE_MEAL = 'Свободно хранене';

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const LINE_RE = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:g|гр|г)(?![\p{L}\p{N}])(?:\s*[—-]\s*(.+))?$/iu;

/** Планът е от този двигател (и не бива да минава през стария решател). */
export function isEnginePlan(plan) {
  return plan?.planEngine === ENGINE_ID || plan?.strategy?.engine === ENGINE_ID;
}

/** Сбор на деня; свободното хранене влиза с бюджета си. */
export function dayTotals(meals) {
  const t = { calories: 0, protein: 0, carbs: 0, fats: 0 };
  for (const m of meals || []) {
    if (m.type === FREE_MEAL) {
      t.calories += Number(m._plannedCalories) || 0;
      continue;
    }
    if (!m.macros) continue;
    t.protein += Number(m.macros.protein) || 0;
    t.carbs += Number(m.macros.carbs) || 0;
    t.fats += Number(m.macros.fats) || 0;
    t.calories += Number(m.calories) || 0;
  }
  return t;
}

/**
 * Седмичната схема в стратегията описва реалните хранения — приложението
 * показва числата от нея.
 * @param {object} weekPlan
 * @param {{ kcal: number, protein: number, carbs: number, fats: number }|null} freeMealTarget
 */
export function weeklySchemeFromPlan(weekPlan, freeMealTarget = null) {
  const scheme = {};
  DAY_KEYS.forEach((key, i) => {
    const meals = weekPlan?.[`day${i + 1}`]?.meals || [];
    const totals = dayTotals(meals);
    const hasFree = meals.some(m => m.type === FREE_MEAL);
    scheme[key] = {
      meals: meals.length,
      calories: totals.calories,
      protein: totals.protein,
      carbs: totals.carbs,
      fats: totals.fats,
      description: hasFree ? 'Ден със свободно хранене' : 'Ден по хранителната схема',
      mealBreakdown: meals.map(m => {
        if (m.type === FREE_MEAL) {
          const t = freeMealTarget || { kcal: Number(m._plannedCalories) || 0, protein: 0, carbs: 0, fats: 0 };
          return {
            type: FREE_MEAL,
            calories: Math.round(t.kcal),
            protein: Math.round(t.protein),
            carbs: Math.round(t.carbs),
            fats: Math.round(t.fats),
          };
        }
        return {
          type: m.type,
          calories: m.calories,
          protein: m.macros?.protein ?? 0,
          carbs: m.macros?.carbs ?? 0,
          fats: m.macros?.fats ?? 0,
        };
      }),
    };
  });
  return scheme;
}

/** Хранителни стойности на ред от описанието — първо храната от двигателя. */
function lineNutrients(name, grams) {
  const f = foodByCatalogName(name);
  if (f) return nutrientsOf(f.id, grams);
  const { profile } = lookupFoodProfile(name);
  const k = grams / 100;
  return { kcal: profile.kcal * k, protein: profile.p * k, carbs: profile.c * k, fats: profile.f * k };
}

/** Преизчислява макросите, калориите и теглото на хранене от описанието му. */
export function recomputeMealFromDescription(meal) {
  if (!meal || meal.type === FREE_MEAL || !meal.description) return meal;
  const t = { protein: 0, carbs: 0, fats: 0 };
  let grams = 0;
  for (const raw of String(meal.description).split('\n')) {
    const line = raw.replace(/^[•\-*]\s*/, '').trim();
    const m = line.match(LINE_RE);
    if (!m) continue;
    const g = parseFloat(m[2].replace(',', '.'));
    if (!(g > 0)) continue;
    const n = lineNutrients(m[1].trim(), g);
    t.protein += n.protein;
    t.carbs += n.carbs;
    t.fats += n.fats;
    grams += g;
  }
  meal.macros = { ...(meal.macros || {}), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fats: Math.round(t.fats) };
  meal.calories = Math.round(meal.macros.protein * 4 + meal.macros.carbs * 4 + meal.macros.fats * 9);
  if (grams > 0) meal.weight = `${Math.round(grams)}г`;
  return meal;
}

/** Целият план — след ръчна промяна: хранения, дневни суми, схема. */
export function reconcileEnginePlan(plan) {
  if (!plan?.weekPlan) return plan;
  for (const day of Object.values(plan.weekPlan)) {
    if (!day?.meals) continue;
    for (const meal of day.meals) recomputeMealFromDescription(meal);
    day.dailyTotals = dayTotals(day.meals);
  }
  if (plan.strategy) {
    const free = Object.values(plan.strategy.weeklyScheme || {})
      .flatMap(d => d?.mealBreakdown || [])
      .find(m => m.type === FREE_MEAL);
    plan.strategy.weeklyScheme = weeklySchemeFromPlan(
      plan.weekPlan,
      free ? { kcal: free.calories, protein: free.protein, carbs: free.carbs, fats: free.fats } : null,
    );
  }
  return plan;
}
