#!/usr/bin/env node
/** Light meal (H3/H5) portion caps + mandatory gram steps + strategy sanitize. */
import { applyMealNutritionFromDatabase } from '../food-nutrition.js';
import { sanitizePlainTextField } from '../text-sanitize.js';
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function ok(cond, msg, detail = '') {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}${detail ? ` — ${detail}` : ''}`); }
}

const h3 = { type: 'Хранене 3', description: '• Кисело мляко\n• Ядки' };
applyMealNutritionFromDatabase(h3, { calories: 350, protein: 15, carbs: 40, fats: 12 });
ok(!/400g|300g/.test(h3.description), 'H3 kiselo not 300–400g', h3.description.replace(/\n/g, ' '));
ok(/Кисело мляко \d+g/.test(h3.description), 'H3 has dairy grams');
const h3Lines = h3.description.match(/\d+g/g) || [];
ok(h3Lines.every(g => {
  const n = parseInt(g, 10);
  return n <= 50 ? n % 10 === 0 : n % 50 === 0;
}), 'H3 grams on 10/50 steps', h3Lines.join(', '));

const h5 = { type: 'Хранене 5', description: '• Кашкавал\n• Бадеми' };
applyMealNutritionFromDatabase(h5, { calories: 200, protein: 15, carbs: 10, fats: 12 });
ok(h5.calories <= 210, 'H5 kcal capped', `${h5.calories}`);
ok(parseInt(h5.weight, 10) <= 120, 'H5 plate weight reasonable', h5.weight);

ok(
  sanitizePlainTextField('Липсва **initiated** план') === 'Липсва initiated план',
  'strip markdown from strategy text',
);

const worker = readFileSync('worker.entry.js', 'utf8');
ok(worker.includes('sanitizeStrategyFields'), 'worker sanitizes strategy');
ok(worker.includes('longTermStrategy, минимум 80'), 'worker requires longTermStrategy');

console.log(`\n=== light meal grams + strategy: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
