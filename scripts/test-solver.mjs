#!/usr/bin/env node
/**
 * Deterministic tests for meal-solver.js and composition-only nutrition sync.
 */
import {
  parseMealDescription,
  applyMealNutritionFromDatabase,
  calorieTolerance,
  mealWeightGramsFromDescription,
} from '../food-nutrition.js';
import { solveMealGrams, totalsFor } from '../meal-solver.js';
import { lookupFoodProfile } from '../food-nutrition.js';
import { fatShareOfKcal } from '../food-catalog.js';

let pass = 0;
let fail = 0;
function ok(cond, msg, detail = '') {
  if (cond) { pass++; console.log(`✓ ${msg}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.error(`✗ ${msg}${detail ? ` — ${detail}` : ''}`); }
}

console.log('=== meal-solver tests ===\n');

// Known fat shares from spec
ok(Math.abs(fatShareOfKcal('ядки') - 0.79) < 0.02, 'ядки fat share ~79%');
ok(Math.abs(fatShareOfKcal('скир') - 0.03) < 0.02, 'скир fat share ~3%');

// Solver hits kcal target for a simple meal
{
  const items = [
    { name: 'пилешко месо', grams: 100, profile: lookupFoodProfile('пилешко месо').profile },
    { name: 'ориз', grams: 100, profile: lookupFoodProfile('ориз').profile },
    { name: 'домати', grams: 80, profile: lookupFoodProfile('домати').profile },
  ];
  const target = { kcal: 600, p: 45, c: 60, f: 12 };
  const bounds = items.map(() => ({ min: 30, max: 300 }));
  const solved = solveMealGrams(items, target, bounds, 900);
  ok(solved.feasible, 'chicken+rice feasible', `kcal=${Math.round(solved.totals.kcal)}`);
  ok(Math.abs(solved.totals.kcal - target.kcal) <= Math.max(30, target.kcal * 0.10), 'kcal within tolerance');
}

// Composition-only parse + apply
{
  const meal = {
    type: 'Хранене 2',
    name: 'Пиле с ориз',
    description: '• пилешко месо\n• ориз\n• домати',
  };
  const target = { calories: 600, protein: 45, carbs: 60, fats: 12 };
  const result = applyMealNutritionFromDatabase(meal, target);
  ok(result.ok, 'applyMealNutrition ok');
  ok(result.feasible, 'applyMealNutrition feasible', `cal=${meal.calories}`);
  ok(parseMealDescription(meal.description).every(i => i.grams > 0), 'backend wrote grams');
  ok(mealWeightGramsFromDescription(meal) <= 900, 'weight under cap');
  const tol = calorieTolerance(target.calories);
  ok(Math.abs(meal.calories - target.calories) <= tol, 'meal kcal adequate', `${meal.calories} vs ${target.calories}`);
}

// Veg-only composition may be infeasible at high kcal
{
  const meal = {
    type: 'Хранене 2',
    name: 'Салата',
    description: '• зеленчук\n• домати\n• краставици',
  };
  const target = { calories: 800, protein: 20, carbs: 30, fats: 10 };
  const result = applyMealNutritionFromDatabase(meal, target);
  ok(!result.feasible, 'veg-only high-kcal infeasible', result.reason);
}

// Live failure pattern: low-density composition cannot reach slot (→ composition repair)
{
  const meal = {
    type: 'Хранене 4',
    description: '• риба\n• картофи\n• зелена салата',
  };
  const target = { calories: 1112, protein: 80, carbs: 100, fats: 35 };
  const result = applyMealNutritionFromDatabase(meal, target);
  ok(!result.feasible, 'fish+potato+salad infeasible at 1112 — triggers repair', result.reason);
}

// High-kcal feasible composition
{
  const meal = {
    type: 'Хранене 4',
    description: '• пилешко месо\n• ориз\n• броколи\n• зехтин',
  };
  const target = { calories: 1112, protein: 80, carbs: 100, fats: 35 };
  const result = applyMealNutritionFromDatabase(meal, target);
  ok(result.feasible, 'chicken+rice+oil feasible at 1112', `cal=${meal.calories}`);
  ok(Math.abs(meal.calories - target.calories) <= calorieTolerance(target.calories),
    'chicken+rice+oil hits slot', `${meal.calories} vs ${target.calories}`);
}

// H3 snack slot
{
  const meal = { type: 'Хранене 3', description: '• ябълка\n• ядки' };
  const target = { calories: 350, protein: 15, carbs: 40, fats: 12 };
  const result = applyMealNutritionFromDatabase(meal, target);
  ok(result.feasible, 'H3 snack feasible', `cal=${meal.calories}`);
  ok(Math.abs(meal.calories - target.calories) <= calorieTolerance(target.calories),
    'H3 snack within tolerance', `${meal.calories} vs ${target.calories}`);
}

console.log(`\n=== meal-solver: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
