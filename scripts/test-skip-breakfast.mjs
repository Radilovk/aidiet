/**
 * Offline contract: skip-breakfast rule enforced in worker + meal plan prompt.
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

assert(workerSrc.includes('function userSkipsBreakfast'), 'userSkipsBreakfast helper exists');
assert(workerSrc.includes('function buildSkipBreakfastRule'), 'buildSkipBreakfastRule exists');
assert(workerSrc.includes('function enforceSkipBreakfastInWeekPlan'), 'enforceSkipBreakfastInWeekPlan exists');
assert(workerSrc.includes('function validateMealTypesAgainstBreakdown'), 'validateMealTypesAgainstBreakdown exists');
assert(workerSrc.includes('skipBreakfastRule'), 'skipBreakfastRule injected in chunk prompt');
assert(workerSrc.includes('Клиентът НЕ ЗАКУСВА'), 'skip-breakfast rule text present');
assert(workerSrc.includes('enforceSkipBreakfastInWeekPlan(weekPlan, userData'), 'finalize calls enforce');
assert(promptSrc.includes('{skipBreakfastRule}'), 'meal plan prompt has skipBreakfastRule placeholder');
assert(promptSrc.includes('САМО сурови съставки'), 'meal plan prompt requires raw ingredients');
assert(!promptSrc.includes('Хранене 1 и Хранене 4 за ден'), 'free meal prompt does not force Хранене 1 in KV');

console.log(`\n=== skip-breakfast contract: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
