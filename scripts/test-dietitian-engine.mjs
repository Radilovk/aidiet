#!/usr/bin/env node
/**
 * Dietitian-engine checks: realistic slot caps, protein rotation, Kamen-class intake.
 */
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { syncWeekPlanNutritionFromDatabase } from '../meal-day-sync.js';
import { inferDishProteinFamily } from '../dish-protein-family.js';
import { MAX_PLATED_SLOT_KCAL_ABSOLUTE } from '../plan-normalize.js';
import { validateWeekPlanDayCoherence } from '../meal-combinations.js';

let pass = 0;
let fail = 0;
function ok(cond, msg, detail = '') {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}${detail ? ` — ${detail}` : ''}`); }
}

const user = { eatingHabits: ['Не закусвам'], weight: 120, dietPreference: ['Сезонна'] };
const analysis = { Final_Calories: 3088, macroGrams: { protein: 204, carbs: 334, fats: 97 } };
const strategy = buildDeterministicStrategy({ userData: user, analysis });
const mon = strategy.weeklyScheme.monday.mealBreakdown;
const maxMain = Math.max(
  ...mon.filter(m => m.type === 'Хранене 2' || m.type === 'Хранене 4').map(m => m.calories),
);
ok(maxMain <= MAX_PLATED_SLOT_KCAL_ABSOLUTE + 5, `main slots capped ≤${MAX_PLATED_SLOT_KCAL_ABSOLUTE}`, String(maxMain));
const schemeSum = mon.reduce((s, m) => s + m.calories, 0);
ok(Math.abs(schemeSum - 3088) <= 10, 'scheme sums to daily kcal', String(schemeSum));

const chunk = await buildDeterministicWeekPlanChunk({
  strategy, userData: user, startDay: 1, endDay: 6, seed: 11,
});
syncWeekPlanNutritionFromDatabase(chunk, strategy, 1, 6, user);

let dupProteinDays = 0;
let underDays = 0;
for (let d = 1; d <= 6; d++) {
  const meals = chunk[`day${d}`]?.meals || [];
  const kcal = meals.reduce((s, m) => s + (m.calories || 0), 0);
  if (kcal < 3088 * 0.92) underDays++;
  const families = meals
    .filter(m => m.type === 'Хранене 2' || m.type === 'Хранене 4')
    .map(m => inferDishProteinFamily({ id: m.dishId }));
  if (families.length === 2 && families[0] === families[1] && families[0] !== 'other') dupProteinDays++;
}
ok(dupProteinDays === 0, 'no duplicate protein family at lunch+dinner', String(dupProteinDays));
ok(underDays <= 1, 'days within 8% of 3088 kcal', `${underDays}/6 under 92%`);
ok(validateWeekPlanDayCoherence(chunk).length === 0, 'day coherence');

console.log(`\n=== dietitian engine: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
