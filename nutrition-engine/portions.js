/**
 * Порции, каквито човек мери в кухнята — виж KITCHEN_GRID.
 */

import { food } from './knowledge.js';
import { minPortionGrams, isCookingFat, COOKING_FAT_MAX_PORTION_G } from '../portion-limits.js';

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
    // Мазнината за готвене е лъжица (10 г) — 5 г олио в тигана не е порция.
    if (isCookingFat(f.name, f.nutritionKey)) { minCache.set(foodId, COOKING_FAT_MAX_PORTION_G); return COOKING_FAT_MAX_PORTION_G; }
    minCache.set(foodId, minPortionGrams({ name: f.name, nutritionKey: f.nutritionKey, group: CATALOG_GROUP[f.group] }));
  }
  return minCache.get(foodId);
}

/**
 * Кухненската мрежа: от 50 г нагоре — на 50 г (основни, гарнитури, салати);
 * под 50 г — на 10 г, а мазнините и подправките и на 15 г
 * (олио 15–20 г, ядки 10–30 г).
 */
export const KITCHEN_GRID = [10, 15, 20, 30, 40, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800];

/** Допустимите количества на храната в диапазона [lo, hi] грама. */
export function portionSteps(foodId, lo = 0, hi = 800) {
  const steps = KITCHEN_GRID;
  const floor = Math.max(lo, minPortion(foodId));
  const inRange = steps.filter(g => g >= floor - 1e-9 && g <= hi + 1e-9);
  if (inRange.length) return inRange;
  // Диапазонът е по-тесен от стъпката — най-близката стъпка, но не под минимума.
  const pool = steps.filter(g => g >= floor - 1e-9);
  const from = pool.length ? pool : steps;
  const mid = (lo + hi) / 2;
  return [from.reduce((best, g) => (Math.abs(g - mid) < Math.abs(best - mid) ? g : best), from[0])];
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

/** Ред от описанието: „• Яйца 100g — 2 яйца“. Латинското g го чете и приложението. */
export function portionLine(foodId, grams) {
  const f = food(foodId);
  const g = Math.round(grams);
  const note = f.id === 'pro_eggs' && g >= 50 ? ` — ${Math.round(g / 50)} ${g === 50 ? 'яйце' : 'яйца'}` : '';
  return `• ${f.name} ${g}g${note}`;
}
