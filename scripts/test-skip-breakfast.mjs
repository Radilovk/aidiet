/**
 * Offline contract: mealBreakdown drives plan structure (skip-breakfast + slot alignment).
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const workerSrc = readFileSync('worker.entry.js', 'utf8');
const promptSrc = readFileSync('KV/prompts/admin_meal_plan_prompt.txt', 'utf8');

assert(workerSrc.includes('function alignDaysToMealBreakdown'), 'alignDaysToMealBreakdown exists');
assert(workerSrc.includes('function buildExpectedMealsInstruction'), 'buildExpectedMealsInstruction exists');
assert(workerSrc.includes('function validateRequiredMealSlots'), 'validateRequiredMealSlots exists');
assert(workerSrc.includes('alignDaysToMealBreakdown(weekPlan, strategy'), 'finalize aligns to mealBreakdown');
assert(workerSrc.includes('expectedMealsInstruction'), 'expectedMealsInstruction injected in chunk prompt');
assert(workerSrc.includes('finalizeWeekPlanDays(plan.weekPlan, plan.strategy, 1, 7, clientData.answers)'), 'admin save reconciles plan');
assert(promptSrc.includes('{expectedMealsInstruction}'), 'meal plan prompt uses dynamic slot list');
assert(!promptSrc.includes('"type": "Хранене 1"'), 'static H1 example removed from prompt');
assert(promptSrc.includes('САМО сурови съставки'), 'meal plan prompt requires raw ingredients');

console.log(`\n=== meal-breakdown contract: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
