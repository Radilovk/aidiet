#!/usr/bin/env node
/**
 * Покритие на каталога: колко ястия има за всяка диета × хранене в макро
 * зоната на диетата. Клетка под 7 значи, че седмицата не може да мине без
 * повторения или без изход извън зоната — там трябва да се добавят ястия.
 *
 *   node scripts/catalog-coverage-report.mjs           — отчет
 *   node scripts/catalog-coverage-report.mjs --check   — пада при дупка
 *
 * Веган кето не се проверява: профилът го превръща във веган
 * нисковъглехидратна (profile-code.js → resolveConflicts).
 */
import { MEAL_DISHES } from '../meal-dishes.js';
import { dishFingerprint, macroZoneFor, zoneDistance } from '../dish-fingerprint.js';

const SLOTS = [
  ['Хранене 1', 'breakfast'],
  ['Хранене 2', 'main'],
  ['Хранене 3', 'snack'],
  ['Хранене 4', 'main'],
  ['Хранене 5', 'late_snack'],
];
const STYLES = ['balanced', 'mediterranean', 'keto', 'low_carb', 'high_protein'];
const PATTERNS = ['omnivore', 'vegetarian', 'vegan'];
const WEEK = 7;

function fitsPattern(dish, pattern) {
  if (pattern === 'vegan') return Boolean(dish.vegan);
  if (pattern === 'vegetarian') return Boolean(dish.vegetarian || dish.vegan);
  return true;
}

const fingerprints = new Map(MEAL_DISHES.map(d => [d.id, dishFingerprint(d)]));
const gaps = [];
console.log('диета'.padEnd(24), SLOTS.map(([s]) => s.replace('Хранене ', 'H').padStart(4)).join(' '));
for (const pattern of PATTERNS) {
  for (const style of STYLES) {
    const profile = { diet: { style, pattern }, clinical: [] };
    const cells = SLOTS.map(([slot, timing]) => {
      const zone = macroZoneFor(profile, slot);
      const n = MEAL_DISHES.filter(d => d.timing.includes(timing)
        && fitsPattern(d, pattern)
        && zoneDistance(fingerprints.get(d.id), zone) === 0).length;
      if (n < WEEK && !(style === 'keto' && pattern === 'vegan')) gaps.push(`${style}/${pattern} ${slot}: ${n}`);
      return n;
    });
    console.log(`${style}/${pattern}`.padEnd(24), cells.map(n => `${n < WEEK ? '!' : ' '}${n}`.padStart(4)).join(' '));
  }
}
console.log(`\nВсичко ястия: ${MEAL_DISHES.length}. Клетки под ${WEEK} (!): ${gaps.length}`);
for (const g of gaps) console.log(`  - ${g}`);
if (process.argv.includes('--check') && gaps.length) process.exit(1);
