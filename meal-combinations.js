/**
 * Meal- and day-level validation.
 *
 * Product-level checks live in meal-compatibility.js; this module applies them
 * to a meal and adds what only the day and the week can see: the same dish
 * twice, a plated meal without a vegetable, a week with too few distinct dishes.
 */

import { checkProductCompatibility, isVegetableProduct } from './meal-compatibility.js';
import { parseMealDescription } from './food-nutrition.js';

/**
 * Lunch and dinner are the plated meals: they need a vegetable and no sweetener.
 * Breakfast and the snacks may be sweet — honey on a bowl of cottage cheese is a
 * breakfast, not a defect. Clinical restrictions on sugar are a protocol matter,
 * enforced by the protocol exclusions, not by a blanket rule here.
 */
const PLATED_SLOTS = new Set(['Хранене 2', 'Хранене 4']);
const SKIP_SLOTS = new Set(['Свободно хранене', 'Напитка']);
const MAIN_SLOTS = new Set(['Хранене 1', 'Хранене 2', 'Хранене 4']);

function productNamesOf(meal) {
  return parseMealDescription(meal?.description || '').map(item => item.name);
}

export function validateMealCombinations(meal) {
  if (!meal || SKIP_SLOTS.has(meal.type)) return [];
  const label = meal.name || meal.type || 'хранене';
  return checkProductCompatibility(productNamesOf(meal), {
    allowSweetener: !PLATED_SLOTS.has(meal.type) || meal.dessert === true,
  }).map(issue => `"${label}": ${issue}`);
}

export function validateWeekPlanCombinations(weekPlan) {
  const issues = [];
  for (let d = 1; d <= 7; d++) {
    for (const meal of weekPlan?.[`day${d}`]?.meals || []) {
      issues.push(...validateMealCombinations(meal));
    }
  }
  return issues;
}

/** Day-level: a dish served twice, or a plated meal without a vegetable. */
export function validateDayCoherence(dayPlan, dayNum = null) {
  const issues = [];
  const meals = dayPlan?.meals || [];
  const prefix = dayNum ? `Ден ${dayNum}: ` : '';

  const seen = new Map();
  for (const meal of meals) {
    if (SKIP_SLOTS.has(meal.type)) continue;
    const key = String(meal.dishId || meal.name || '').trim().toLowerCase();
    if (key) seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) issues.push(`${prefix}"${name}" се повтаря ${count} пъти в един ден`);
  }

  for (const meal of meals) {
    if (!PLATED_SLOTS.has(meal.type)) continue;
    const names = productNamesOf(meal);
    if (names.length && !names.some(isVegetableProduct)) {
      issues.push(`${prefix}"${meal.name || meal.type}": основно хранене без зеленчук`);
    }
  }

  return issues;
}

export function validateWeekPlanDayCoherence(weekPlan) {
  const issues = [];
  for (let d = 1; d <= 7; d++) {
    if (!weekPlan?.[`day${d}`]?.meals) continue;
    issues.push(...validateDayCoherence(weekPlan[`day${d}`], d));
  }
  return issues;
}

/**
 * Weekly variety: how many distinct main dishes the week actually contains.
 * @returns {{ unique: number, total: number, issues: string[] }}
 */
export function validateWeeklyDishVariety(weekPlan, minUniqueRatio = 0.5) {
  const dishes = [];
  for (let d = 1; d <= 7; d++) {
    for (const meal of weekPlan?.[`day${d}`]?.meals || []) {
      if (MAIN_SLOTS.has(meal.type) && meal.name) dishes.push(meal.name.trim().toLowerCase());
    }
  }
  const unique = new Set(dishes).size;
  const issues = [];
  if (dishes.length && unique < Math.ceil(dishes.length * minUniqueRatio)) {
    issues.push(`седмицата има само ${unique} различни основни ястия за ${dishes.length} хранения`);
  }
  return { unique, total: dishes.length, issues };
}
