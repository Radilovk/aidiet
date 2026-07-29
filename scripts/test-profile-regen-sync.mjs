/**
 * Verify plan-regen-fields.js matches profile.html data-diet-related fields.
 */
import { readFileSync } from 'node:fs';
import { DIET_RELATED_PROFILE_FIELDS } from '../plan-regen-fields.js';

const html = readFileSync('profile.html', 'utf8');
const dietRelatedInHtml = [...html.matchAll(/data-field="([^"]+)"[^>]*data-diet-related="true"/g)]
  .map(m => m[1]);
const dietFalseInHtml = [...html.matchAll(/data-field="([^"]+)"[^>]*data-diet-related="false"/g)]
  .map(m => m[1]);

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

for (const field of dietRelatedInHtml) {
  assert(DIET_RELATED_PROFILE_FIELDS.includes(field), `HTML diet field "${field}" in plan-regen-fields.js`);
}
for (const field of dietFalseInHtml) {
  assert(!DIET_RELATED_PROFILE_FIELDS.includes(field), `non-diet field "${field}" not in regen list`);
}
assert(dietRelatedInHtml.length === DIET_RELATED_PROFILE_FIELDS.length,
  `field count sync (${dietRelatedInHtml.length} html vs ${DIET_RELATED_PROFILE_FIELDS.length} js)`);

console.log(`\n=== profile-regen sync: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
