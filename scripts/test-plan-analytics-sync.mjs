#!/usr/bin/env node
/** Client analytics sync — plan slice + debounced ledger sync contract. */
import { readFileSync } from 'node:fs';

const plan = readFileSync('plan.html', 'utf8');
let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(plan.includes('function getPlanForAnalyticsSync'), 'plan slice helper');
ok(plan.includes('plan: planSlice') || plan.includes('{ plan: planSlice }'), 'sync sends plan slice');
ok(plan.includes('dietStartDate') && plan.includes('ensureWeeklyMeta'), 'dietStartDate in weekly meta');
ok(plan.includes('scheduleAnalyticsSync()'), 'saveGameData schedules debounced sync');
ok(plan.includes('45000'), 'debounce interval');
ok(plan.includes('catalogVersion'), 'signature includes catalog version');

console.log(`\n=== plan analytics sync contract: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
