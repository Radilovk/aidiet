import { parseMealDescription } from '../food-nutrition.js';

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const items = parseMealDescription('• Пиле с ориз и зеленчуци 490g\n• Зеленчук 100g');
const names = items.map(i => i.name.toLowerCase());
assert(!names.some(n => n.includes('пиле с ориз')), 'ready meal decomposed — no composite name');
assert(names.some(n => n.includes('ориз')), 'contains rice');
assert(names.some(n => n.includes('пилешко')), 'contains chicken');

const omelet = parseMealDescription('• Омлет 200g');
assert(omelet.length >= 1 && omelet.some(i => i.name.toLowerCase().includes('яйца')), 'omelet → eggs + its sides');

console.log(`\n=== ready-meal-expand: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
