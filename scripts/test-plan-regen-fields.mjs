import {
  classifyDietRelatedProfileChanges,
  hasDietRelatedProfileChanges,
  DIET_RELATED_PROFILE_FIELDS,
} from '../plan-regen-fields.js';

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

assert(DIET_RELATED_PROFILE_FIELDS.includes('weight'), 'weight is diet-related');
assert(!DIET_RELATED_PROFILE_FIELDS.includes('name'), 'name is not diet-related');

assert(
  !hasDietRelatedProfileChanges({ name: 'A', weight: 70 }, { name: 'B', weight: 70 }),
  'name-only change does not trigger regen'
);
assert(
  hasDietRelatedProfileChanges({ weight: 70 }, { weight: 75 }),
  'weight change triggers regen'
);
assert(
  classifyDietRelatedProfileChanges(
    { foodCravings: ['Сладко'] },
    { foodCravings: ['Солено'] }
  ).includes('foodCravings'),
  'array field change detected'
);

console.log(`\n=== plan-regen-fields: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
