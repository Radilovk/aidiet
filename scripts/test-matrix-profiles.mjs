#!/usr/bin/env node
/** Matrix fixtures — offline integrity, no AI. */
import { MATRIX_ENTRIES, MATRIX_COVERAGE_CLAIMS } from './plan-adequacy/fixtures/matrix-profiles.mjs';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(MATRIX_ENTRIES.length >= 6, `matrix has ${MATRIX_ENTRIES.length} profiles`);
ok(MATRIX_COVERAGE_CLAIMS.length >= 15, `coverage claims: ${MATRIX_COVERAGE_CLAIMS.length}`);

const ids = new Set();
for (const e of MATRIX_ENTRIES) {
  ok(e.profile?.id === e.id, `${e.id} profile resolved`);
  ok(e.covers?.length >= 2, `${e.id} has coverage tags`);
  ok(!ids.has(e.id), `${e.id} unique`);
  ids.add(e.id);
}

const mustCover = [
  'skip breakfast',
  'lactation',
  'keto',
  '1112',
  'vegan',
  'AIP',
  'diabetes',
];
for (const needle of mustCover) {
  ok(
    MATRIX_COVERAGE_CLAIMS.some(c => c.toLowerCase().includes(needle.toLowerCase())),
    `coverage includes: ${needle}`,
  );
}

console.log(`\n=== matrix fixtures: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
