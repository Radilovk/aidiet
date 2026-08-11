#!/usr/bin/env node
/** Stage 1 contracts — solver, frozen scheme, composition-only prompt. */
import { readFileSync } from 'node:fs';

const worker = readFileSync('worker.entry.js', 'utf8');
const prompt = readFileSync('KV/prompts/admin_meal_plan_prompt.txt', 'utf8');
const nutrition = readFileSync('food-nutrition.js', 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(nutrition.includes("from './meal-solver.js'"), 'food-nutrition imports solver');
ok(!nutrition.includes('scaleItemsToTargetCalories'), 'scaling chain removed');
ok(!worker.includes('reconcileAchievedSlotCalories'), 'reconcile removed from worker');
ok(worker.includes('DAY_MACRO_TOLERANCE_PERCENT'), 'daily macro validation');
ok(!worker.includes('липсват грамажи'), 'gram-required validation removed');
ok(prompt.includes('Do NOT write grams'), 'prompt: composition only');
ok(!prompt.includes('{N}g'), 'prompt: no gram template');
ok(readFileSync('meal-solver.js', 'utf8').includes('export function solveMealGrams'), 'meal-solver module');

console.log(`\n=== rebuild stage1 contracts: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
