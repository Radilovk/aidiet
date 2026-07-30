/**
 * Offline contract: mealBreakdown-driven Step 3 prompt + alignment.
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const workerSrc = readFileSync('worker.entry.js', 'utf8');
const mealPrompt = readFileSync('KV/prompts/admin_meal_plan_prompt.txt', 'utf8');
const strategyPrompt = readFileSync('KV/prompts/admin_strategy_prompt.txt', 'utf8');

assert(mealPrompt.includes('meals[].type MUST match'), 'Step 3 slot contract in English');
assert(!mealPrompt.includes('"type": "Хранене 1"'), 'no H1 anchoring example');
assert(mealPrompt.includes('name — dish title'), 'name vs description split');
assert(!mealPrompt.includes('skipBreakfastRule'), 'no redundant skip-breakfast inject in KV');
assert(strategyPrompt.includes('"Не закусвам" → no Хранене 1'), 'strategy rule 2 preserved');
assert(workerSrc.includes('function alignDaysToMealBreakdown'), 'thin backend align kept');
assert(workerSrc.includes('SWEETS:'), 'sweets inject shortened English');
assert(workerSrc.includes('FREE MEAL (Day'), 'free meal inject shortened English');
assert(!workerSrc.includes('buildSkipBreakfastRule'), 'removed redundant skip-breakfast inject');

console.log(`\n=== meal-breakdown contract: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
