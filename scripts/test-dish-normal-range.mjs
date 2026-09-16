#!/usr/bin/env node
import {
  dishNormalKcalRange,
  dishFitsSlotInNormalRange,
  DISH_SCALE_MIN,
  DISH_SCALE_MAX,
  achievableKcal,
} from '../food-nutrition.js';
import { READY_MEAL_PARTS } from '../ready-meal-parts.js';
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { syncWeekPlanNutritionFromDatabase } from '../meal-day-sync.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(DISH_SCALE_MIN === 0.65 && DISH_SCALE_MAX === 1.45, 'dish scale bounds exported');

const beef = READY_MEAL_PARTS.meal_beef_potato;
const range = dishNormalKcalRange(beef);
ok(range.reference > 0 && range.min < range.reference && range.max > range.reference,
  `beef range ${range.min}–${range.max} (ref ${range.reference})`);

ok(dishFitsSlotInNormalRange({ id: 'meal_beef_potato' }, range.reference), 'reference kcal fits');
ok(!dishFitsSlotInNormalRange({ id: 'meal_beef_potato' }, range.max * 2), '2× max range rejected');

const achieved = achievableKcal(beef.map(p => ({ name: p.name, grams: p.grams })), range.reference);
ok(Math.abs(achieved - range.reference) < 80, `achievable near reference (${achieved})`);

const user = { eatingHabits: ['Не закусвам'], dietPreference: ['Сезонна'], weight: 120 };
const analysis = { Final_Calories: 3088, macroGrams: { protein: 207, carbs: 342, fats: 99 } };
const strategy = buildDeterministicStrategy({ userData: user, analysis });
const wp = await buildDeterministicWeekPlanChunk({
  strategy, userData: user, startDay: 1, endDay: 3, seed: 7,
});
syncWeekPlanNutritionFromDatabase(wp, strategy, 1, 3, {});
for (let d = 1; d <= 3; d++) {
  for (const m of wp[`day${d}`]?.meals || []) {
    if (!m.dishId) continue;
    const parts = READY_MEAL_PARTS[m.dishId];
    const r = dishNormalKcalRange(parts);
    const w = m.description?.match(/(\d+)g/g)?.reduce((s, g) => s + parseInt(g, 10), 0) || 0;
    ok(w <= 900, `day${d} ${m.dishId} plate ${w}g ≤ 900`);
    if (m.calories > 0 && r.max > 0) {
      ok(m.calories <= r.max * 1.25, `day${d} ${m.dishId} ${m.calories}kcal within scale band`);
    }
  }
}

console.log(fail ? `\nFAILED ${fail}` : `\nPASSED ${pass}`);
process.exit(fail ? 1 : 0);
