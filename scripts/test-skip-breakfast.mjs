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
assert(strategyPrompt.includes('{finalCalories} ≥2400'), 'skip breakfast high intake → H5 split rule');
assert(mealPrompt.includes('catalog group names'), 'prefer catalog generics when precision not required');
assert(!mealPrompt.includes('fish ≥2'), 'no deterministic fish rotation in prompt');
assert(!mealPrompt.includes('one of rice/potato/bread per meal'), 'no mandatory starch per main');
assert(workerSrc.includes('function alignDaysToMealBreakdown'), 'thin backend align kept');
assert(mealPrompt.includes('SLOT CONTRACTS'), 'slot contracts section');
assert(!mealPrompt.includes('Energy density'), 'no dietetic energy-density heuristics in prompt');
assert(!mealPrompt.includes('Variety vs previous'), 'no obvious variety instruction');
assert(workerSrc.includes('Backend injects fixed dessert'), 'sweets inject is system contract only');
assert(workerSrc.includes('FREE MEAL (Day'), 'free meal inject is system contract only');
assert(!workerSrc.includes('buildSkipBreakfastRule'), 'removed redundant skip-breakfast inject');

console.log(`\n=== meal-breakdown contract: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
