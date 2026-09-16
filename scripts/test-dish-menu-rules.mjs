#!/usr/bin/env node
import {
  classifyDish,
  createDayMenuState,
  dishAllowedOnDay,
  filterPoolByDayMenu,
  recordDishOnDay,
  validateDayMenuRules,
} from '../dish-menu-rules.js';
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { syncWeekPlanNutritionFromDatabase } from '../meal-day-sync.js';
import { validateWeekPlanDayCoherence } from '../meal-combinations.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(classifyDish({ id: 'meal_beef_potato' }).protein === 'beef', 'beef dish classified');
ok(classifyDish({ id: 'meal_rice_chicken' }).protein === 'poultry', 'chicken classified');
ok(classifyDish({ id: 'snack_banana_walnuts' }).fruit, 'banana snack has fruit');

{
  const state = createDayMenuState();
  recordDishOnDay(state, { id: 'meal_beef_potato' });
  ok(!dishAllowedOnDay(state, { id: 'meal_beef_rice_carrots' }, 'Хранене 4'), 'blocks second beef main');
  ok(dishAllowedOnDay(state, { id: 'meal_rice_chicken' }, 'Хранене 4'), 'allows poultry dinner after beef lunch');
}

{
  const state = createDayMenuState();
  recordDishOnDay(state, { id: 'bf_liquid_oats_banana' });
  const pool = [
    { id: 'snack_banana_walnuts', name: 'banana' },
    { id: 'snack_yogurt_almonds', name: 'yogurt' },
  ];
  const filtered = filterPoolByDayMenu(pool, state, 'Хранене 3');
  ok(filtered.length === 1 && filtered[0].id === 'snack_yogurt_almonds', 'blocks second fruit snack');
}

const user = { eatingHabits: ['Не закусвам'], dietPreference: ['Сезонна'], weight: 120 };
const analysis = { Final_Calories: 3088, macroGrams: { protein: 207, carbs: 342, fats: 99 } };
const strategy = buildDeterministicStrategy({ userData: user, analysis });
const wp = {};
for (const [s, e] of [[1, 7]]) {
  Object.assign(wp, await buildDeterministicWeekPlanChunk({
    strategy, userData: user, startDay: s, endDay: e, seed: 42,
  }));
}
syncWeekPlanNutritionFromDatabase(wp, strategy, 1, 7, {});
const menuIssues = [];
for (let d = 1; d <= 7; d++) menuIssues.push(...validateDayMenuRules(wp[`day${d}`], d));
const coherence = validateWeekPlanDayCoherence(wp);
ok(menuIssues.length === 0, `week menu rules: ${menuIssues.length} issues`);
ok(coherence.filter(i => /протеин|нишесте|плод/.test(i)).length === 0, 'coherence menu rules clean');

console.log(fail ? `\nFAILED ${fail}` : `\nPASSED ${pass}`);
process.exit(fail ? 1 : 0);
