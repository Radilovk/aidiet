import { parseMealDescription } from '../food-nutrition.js';

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const items = parseMealDescription('• Ориз с пиле 490g\n• Зеленчук 100g');
const names = items.map(i => i.name.toLowerCase());
assert(!names.some(n => n.includes('ориз с пиле')), 'ready meal decomposed — no composite name');
assert(names.some(n => n.includes('ориз')), 'contains rice');
assert(names.some(n => n.includes('пилешко')), 'contains chicken');

const omelet = parseMealDescription('• Омлет 200g');
const omeletNames = omelet.map(i => i.name.toLowerCase());
assert(omeletNames.some(n => n.includes('яйца')), 'omelet → eggs');
assert(omeletNames.some(n => n.includes('зеленчук')), 'omelet → vegetables');

console.log(`\n=== ready-meal-expand: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
