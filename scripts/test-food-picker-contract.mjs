/**
 * Offline contract: food-picker preferences reach worker blocked/mainlist logic.
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const workerSrc = readFileSync('worker.entry.js', 'utf8');
const foodPickerSrc = readFileSync('food-picker.html', 'utf8');

assert(workerSrc.includes('userFoodList'), 'worker handles userFoodList');
assert(workerSrc.includes('userFoodExclude'), 'worker handles userFoodExclude');
assert(workerSrc.includes('buildUserFoodPickerSection'), 'worker builds per-user mainlist section');
assert(!foodPickerSrc.includes('/api/admin/set-mainlist'), 'food-picker does not mutate global mainlist');
assert(!foodPickerSrc.includes('/api/admin/set-blacklist'), 'food-picker does not mutate global blacklist');
assert(foodPickerSrc.includes('generate-plan-async'), 'food-picker uses async generation');
assert(foodPickerSrc.includes('userFoodList'), 'food-picker sets userFoodList on userData');
assert(foodPickerSrc.includes('userFoodExclude'), 'food-picker sets userFoodExclude on userData');

console.log(`\n=== food-picker contract: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
