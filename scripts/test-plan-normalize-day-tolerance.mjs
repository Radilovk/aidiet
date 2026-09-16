#!/usr/bin/env node
import {
  dayCalorieTolerance,
  isDayCaloriesAdequate,
  classifyInfeasibleSlots,
} from '../plan-normalize.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(dayCalorieTolerance(3088) === 247, `tolerance 3088 → ${dayCalorieTolerance(3088)}`);
ok(isDayCaloriesAdequate(3020, 3088), '3020 vs 3088 adequate');
ok(!isDayCaloriesAdequate(2383, 3088), '2383 vs 3088 not adequate');

const weekPlan = {
  day1: { dailyTotals: { calories: 3020 }, meals: [] },
};
const strategy = {
  weeklyScheme: {
    monday: { mealBreakdown: [{ type: 'Хранене 2', calories: 3020 }], calories: 3020 },
  },
};
const split = classifyInfeasibleSlots(weekPlan, strategy, [
  { day: 1, type: 'Хранене 3', reason: 'порцията не стига' },
]);
ok(split.blocking.length === 0, 'infeasible slot soft when day OK');
ok(split.warnings.length === 1, 'infeasible slot warning when day OK');

console.log(`\n=== day tolerance: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
