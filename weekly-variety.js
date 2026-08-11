/**
 * Stage 2 — weekly variety validation and product-based #PD context.
 */

import { parseMealDescription } from './food-nutrition.js';
import { normalizeFoodKey } from './food-utils.js';

export const MAX_REPEATED_DISH_NAMES = 5;
export const MAX_PRODUCT_USES_PER_WEEK = 9;

function esc(s) {
  return String(s || '').replace(/\|/g, '/').trim();
}

/**
 * Product-based previous days context (#PD v2) — rotation at ingredient level.
 * @param {Array<{day: number, meals: object[]}>} previousDays
 */
export function serializePreviousDaysProducts(previousDays) {
  if (!previousDays?.length) return '';
  const parts = previousDays.map(d => {
    const keys = new Set();
    for (const meal of d.meals || []) {
      for (const item of parseMealDescription(meal.description)) {
        const k = normalizeFoodKey(item.name);
        if (k) keys.add(k);
      }
    }
    const list = [...keys].slice(0, 14).map(esc).join('+');
    return `D${d.day}:${list || '-'}`;
  });
  return `#PD v2 ${parts.join('|')}`;
}

/**
 * Validate weekly dish + product variety (soft warnings by default).
 * @param {object} weekPlan
 * @param {{ blocking?: boolean }} [options]
 */
export function validateWeeklyVariety(weekPlan, options = {}) {
  const warnings = [];
  const errors = [];
  if (!weekPlan || typeof weekPlan !== 'object') {
    return { warnings, errors, stats: {} };
  }

  const seenDishes = new Set();
  const repeatedDishes = new Set();
  const productCounts = new Map();

  for (const day of Object.values(weekPlan)) {
    if (!day?.meals?.length) continue;
    for (const meal of day.meals) {
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
      if (meal.name) {
        const n = meal.name.toLowerCase().trim().replace(/\s+/g, ' ');
        if (n && seenDishes.has(n)) repeatedDishes.add(n);
        if (n) seenDishes.add(n);
      }
      for (const item of parseMealDescription(meal.description)) {
        const key = normalizeFoodKey(item.name);
        if (!key) continue;
        productCounts.set(key, (productCounts.get(key) || 0) + 1);
      }
    }
  }

  if (repeatedDishes.size > MAX_REPEATED_DISH_NAMES) {
    const msg = `Повтарящи се ястия (${repeatedDishes.size} > ${MAX_REPEATED_DISH_NAMES}): ${[...repeatedDishes].slice(0, 5).join(', ')}`;
    if (options.blocking) errors.push(msg);
    else warnings.push(msg);
  }

  const overused = [...productCounts.entries()]
    .filter(([, count]) => count > MAX_PRODUCT_USES_PER_WEEK)
    .sort((a, b) => b[1] - a[1]);

  if (overused.length) {
    const msg = `Често повтарящи се продукти: ${overused.slice(0, 4).map(([k, c]) => `${k}×${c}`).join(', ')}`;
    warnings.push(msg);
  }

  return {
    warnings,
    errors,
    stats: {
      repeatedDishCount: repeatedDishes.size,
      uniqueProducts: productCounts.size,
      topProducts: [...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    },
  };
}
