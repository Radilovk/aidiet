#!/usr/bin/env node
/** Stage 0.1 — validatePlan blocking vs soft split. */
import { readFileSync } from 'node:fs';

const src = readFileSync('worker.entry.js', 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(src.includes('PLAN_VALIDATION_BLOCKING'), 'blocking patterns defined');
ok(src.includes('blockingErrors'), 'validatePlan returns blockingErrors');
ok(src.includes('COMPOSITION_REPAIR_MAX_PER_CHUNK = 0'), 'composition repair disabled — precision-first');
ok(src.includes('step3-creation-hints.js'), 'creation hints wired');
ok(!src.includes('bestSnapshot && !hasBlockingNutritionErrors'), 'no partial chunk fallback accept');
ok(src.includes('медицински прагове'), 'generatePlanCore blocks on safety');
ok(src.includes("validateMealCombinations({ ...meal, dessert: undefined })"), 'combo check ignores dessert field');
ok(!src.includes("return keyMap[type] || 'admin_plan_prompt'"), 'legacy plan prompt fallback removed');

console.log(`\n=== rebuild stage0 contracts: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
