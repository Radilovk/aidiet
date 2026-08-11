#!/usr/bin/env node
/** Stage 0.2 — combinations in production; dessert must not false-positive. */
import { validateMealCombinations } from '../meal-combinations.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(
  validateMealCombinations({
    type: 'Хранене 2',
    name: 'Риба с грах',
    description: '• риба 150g\n• грах 80g',
  }).length > 0,
  'fish+peas flagged'
);

ok(
  validateMealCombinations({
    type: 'Хранене 2',
    name: 'Пилешко със салата',
    description: '• пилешки гърди 150g\n• зеленчук 120g',
    dessert: { name: 'Пълномаслен шоколад с лешници', calories: 168 },
  }).length === 0,
  'dessert object does not trigger combo retry alone'
);

console.log(`\n=== meal-combinations prod: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
