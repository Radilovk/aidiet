/**
 * Contract: all plan write paths use reconcilePlanStructure.
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const src = readFileSync('worker.entry.js', 'utf8');

assert(src.includes('async function reconcilePlanStructure'), 'reconcilePlanStructure exists');
assert(src.includes('await reconcilePlanStructure(plan, clientData.answers, env)'), 'update-client-plan reconciles');
assert(src.includes('await reconcilePlanStructure(clientData.plan, clientData.answers, env)'), 'activate-client-plan reconciles');
assert(src.includes('await reconcilePlanAfterAssistantPatches(clientData.plan, clientData.answers, env)'), 'assistant patches reconcile');
assert(src.includes('await reconcilePlanStructure(structuredPlan, data, env)'), 'generatePlanCore reconciles');
assert(src.includes('normalizeStrategyDessertFlag(plan.strategy, userData)'), 'reconcile normalizes dessert flag');
assert(src.includes('repairWeekPlanLightSlots'), 'worker repairs light slots on all write paths');
assert(src.includes('validateLateSnackSlotContent'), 'chunk validation uses shared H5 rules');
assert(src.includes("m.type !== 'Хранене 5'"), 'normalizeWeeklyScheme ratio excludes H5');

console.log(`\n=== plan-reconcile contract: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
