#!/usr/bin/env node
/**
 * Nutrition math adequacy — priority #1: calories, grams, macros.
 * npm run test:plan-adequacy:nutrition
 */
import {
  applyMealNutritionFromDatabase,
  parseMealDescription,
  mealWeightGramsFromDescription,
  sumItemNutrition,
  lookupFoodProfile,
  calorieTolerance,
  syncWeekPlanNutritionFromDatabase,
} from '../food-nutrition.js';
import { isMealCaloriesAdequate, slotCalorieTolerance } from '../plan-normalize.js';
import { NUTRITION_MATH_MEALS, DAY_MACRO_TARGET } from './plan-adequacy/fixtures/nutrition-cases.mjs';
import {
  validateMealMacroArithmetic,
  validateMealGramsAndWeight,
  validateMealMacrosFromGrams,
  validateMealNutritionPipeline,
} from './plan-adequacy/validators/nutrition.mjs';
import { buildMinimalWeekPlan } from './plan-adequacy/validators/plan.mjs';

const results = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

function macrosToCalories(macros) {
  return Math.round((macros.protein || 0) * 4 + (macros.carbs || 0) * 4 + (macros.fats || 0) * 9);
}

console.log('=== Nutrition math adequacy ===\n');

console.log('-- 1. Pipeline: calories + grams + macros per meal type --');
for (const { label, meal, target, maxWeight } of NUTRITION_MATH_MEALS) {
  const clone = structuredClone(meal);
  applyMealNutritionFromDatabase(clone, target);
  const wg = mealWeightGramsFromDescription(clone);
  const kcalOk = isMealCaloriesAdequate(clone.calories, target.calories);
  const macroOk = validateMealMacroArithmetic(clone).length === 0;
  const gramsOk = validateMealMacrosFromGrams(clone).length === 0;
  const weightOk = wg > 0 && wg <= maxWeight;
  check(`${label}: kcal`, kcalOk, `${clone.calories}/${target.calories} ±${slotCalorieTolerance(target.calories)}`);
  check(`${label}: macro arithmetic`, macroOk);
  check(`${label}: macros from grams`, gramsOk);
  check(`${label}: weight ≤${maxWeight}g`, weightOk, `${wg}g`);
}

console.log('\n-- 2. Written grams ↔ computed nutrition --');
{
  const items = parseMealDescription('• Пилешки гърди 150g\n• Ориз 150g\n• Зехтин 10g')
    .map(i => ({ ...i, profile: lookupFoodProfile(i.name).profile }));
  const totals = sumItemNutrition(items);
  const kcal = Math.round(totals.p * 4 + totals.c * 4 + totals.f * 9);
  check('sumItemNutrition kcal > 0', kcal > 300, `${kcal}`);
  check('gram sum = 310g', items.reduce((s, i) => s + i.grams, 0) === 310);
}

console.log('\n-- 3. Full day macro budget (4 meals) --');
{
  const strategy = {
    weeklyScheme: {
      monday: {
        calories: DAY_MACRO_TARGET.dailyKcal,
        protein: DAY_MACRO_TARGET.slots.reduce((s, m) => s + m.protein, 0),
        carbs: DAY_MACRO_TARGET.slots.reduce((s, m) => s + m.carbs, 0),
        fats: DAY_MACRO_TARGET.slots.reduce((s, m) => s + m.fats, 0),
        mealBreakdown: DAY_MACRO_TARGET.slots,
      },
    },
  };
  for (const k of ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    strategy.weeklyScheme[k] = { ...strategy.weeklyScheme.monday };
  }
  const weekPlan = buildMinimalWeekPlan(strategy);
  syncWeekPlanNutritionFromDatabase(weekPlan, strategy, 1, 1);

  const day = weekPlan.day1;
  let dayKcal = 0;
  let dayP = 0;
  let dayC = 0;
  let dayF = 0;
  for (const meal of day.meals) {
    dayKcal += meal.calories || 0;
    dayP += meal.macros?.protein || 0;
    dayC += meal.macros?.carbs || 0;
    dayF += meal.macros?.fats || 0;
    check(`${meal.type}: pipeline clean`, validateMealNutritionPipeline(meal, DAY_MACRO_TARGET.slots.find(s => s.type === meal.type)).length === 0);
  }
  const tol = calorieTolerance(DAY_MACRO_TARGET.dailyKcal);
  check('day kcal within tolerance', Math.abs(dayKcal - DAY_MACRO_TARGET.dailyKcal) <= tol * 2, `${dayKcal}/${DAY_MACRO_TARGET.dailyKcal}`);
  check('day macros sum to kcal', Math.abs(macrosToCalories({ protein: dayP, carbs: dayC, fats: dayF }) - dayKcal) <= 8);
}

console.log('\n-- 4. Bad nutrition must fail validators --');
{
  const bad = {
    type: 'Хранене 2',
    name: 'Bad',
    description: '• Пилешки гърди 150g\n• Ориз 150g',
    calories: 999,
    macros: { protein: 10, carbs: 10, fats: 5 },
  };
  check('wrong macro arithmetic caught', validateMealMacroArithmetic(bad).length > 0);
  check('absurd grams caught', validateMealGramsAndWeight({
    type: 'Хранене 2', name: 'X', description: '• Пилешки гърди 5g\n• Ориз 900g', calories: 400,
    macros: { protein: 30, carbs: 50, fats: 10 },
  }).length > 0);
}

const passed = results.filter(Boolean).length;
console.log(`\n=== Nutrition math: ${passed}/${results.length} PASS ===`);
process.exit(passed === results.length ? 0 : 1);
