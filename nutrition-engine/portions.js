/**
 * Порции, каквито човек мери в кухнята: битова мярка, където храната има
 * такава (яйце, филия, плод, чаена лъжичка), иначе кръгли грамове — през 5 г
 * до 50 г, през 10 г до 100 г, през 20 г до 200 г и през 50 г нагоре.
 */

import { food } from './knowledge.js';
import { minPortionGrams } from '../portion-limits.js';

/** Обменна група → група на каталога (за минималните порции). */
const CATALOG_GROUP = {
  STA: 'carb', LEG: 'legume', FRU: 'fruit', VEG: 'vegetable', MLK: 'dairy',
  PRO: 'protein', FAT: 'fat', SWT: 'condiment', FREE: 'condiment',
};

const minCache = new Map();
/** Под тази порция храната е украса, не съставка (5 г ядки, 10 г месо). */
export function minPortion(foodId) {
  if (!minCache.has(foodId)) {
    const f = food(foodId);
    minCache.set(foodId, minPortionGrams({ name: f.name, nutritionKey: f.nutritionKey, group: CATALOG_GROUP[f.group] }));
  }
  return minCache.get(foodId);
}

export const KITCHEN_GRID = (() => {
  const grid = [];
  for (let g = 5; g < 50; g += 5) grid.push(g);
  for (let g = 50; g < 100; g += 10) grid.push(g);
  for (let g = 100; g < 200; g += 20) grid.push(g);
  for (let g = 200; g <= 800; g += 50) grid.push(g);
  return grid;
})();

/** Допустимите количества на храната в диапазона [lo, hi] грама. */
export function portionSteps(foodId, lo = 0, hi = 800) {
  const unit = food(foodId).unit;
  let steps = KITCHEN_GRID;
  let tolerance = 0;
  if (unit) {
    // Бройките не са на грам: яйце от 50 г е една порция, макар порцията да е 54 г.
    steps = [];
    for (let n = 1; n * unit.grams <= Math.max(hi * 1.2, unit.grams); n++) steps.push(n * unit.grams);
    tolerance = 0.15;
  }
  const floor = Math.max(lo * (1 - tolerance), minPortion(foodId));
  const inRange = steps.filter(g => g >= floor - 1e-9 && g <= hi * (1 + tolerance) + 1e-9);
  if (inRange.length) return inRange;
  // Диапазонът е по-тесен от стъпката — най-близката стъпка до него.
  const mid = (lo + hi) / 2;
  return [steps.reduce((best, g) => (Math.abs(g - mid) < Math.abs(best - mid) ? g : best), steps[0])];
}

/** Най-близкото допустимо количество. */
export function snapPortion(foodId, grams, lo = 0, hi = 800) {
  const steps = portionSteps(foodId, lo, hi);
  if (!(grams > 0)) return steps[0];
  return steps.reduce((best, g) => (Math.abs(g - grams) < Math.abs(best - grams) ? g : best), steps[0]);
}

/** Съседната стъпка нагоре/надолу в диапазона, или null. */
export function neighbourPortion(foodId, grams, direction, lo = 0, hi = 800) {
  const steps = portionSteps(foodId, lo, hi);
  const i = steps.indexOf(grams);
  if (i < 0) return null;
  const j = i + direction;
  return j >= 0 && j < steps.length ? steps[j] : null;
}

function unitText(unit, grams) {
  const n = grams / unit.grams;
  const count = Number.isInteger(n) ? n : Math.round(n * 2) / 2;
  if (count === 0.5) return `половин ${unit.one}`;
  return `${String(count).replace('.', ',')} ${count === 1 ? unit.one : unit.many}`;
}

/** Ред от описанието: „• Яйца 100g — 2 яйца“. Латинското g го чете и приложението. */
export function portionLine(foodId, grams) {
  const f = food(foodId);
  const g = Math.round(grams);
  const unit = f.unit;
  const note = unit && g >= unit.grams / 2 ? ` — ${unitText(unit, g)}` : '';
  return `• ${f.name} ${g}g${note}`;
}
