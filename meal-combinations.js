/**
 * Meal combination rules — production + plan-adequacy tests.
 *
 * The culinary knowledge lives in meal-compatibility.js, keyed by food kind.
 * This module applies it to a meal object and adds the slot-level checks that
 * need the meal's own shape (a salad plus loose fresh vegetables, a dessert).
 */

import { checkProductCompatibility, hasWord, kindsOf } from './meal-compatibility.js';
import { parseMealDescription } from './food-nutrition.js';

/** Slots where a sweet component is part of the contract. */
const SWEET_ALLOWED_SLOTS = new Set(['Хранене 3', 'Хранене 5']);

function productNamesOf(meal) {
  const parsed = parseMealDescription(meal.description || '');
  if (parsed.length) return parsed.map(item => item.name);
  // Fall back to raw bullet lines when the description has no grams yet.
  return String(meal.description || '')
    .split('\n')
    .map(line => line.replace(/^[•\-*]\s*/, '').replace(/\s*\d+\s*(g|г|гр)\b.*$/i, '').trim())
    .filter(Boolean);
}

export function validateMealCombinations(meal) {
  const issues = [];
  if (!meal || meal.type === 'Свободно хранене' || meal.type === 'Напитка') return issues;

  const names = productNamesOf(meal);
  const label = meal.name || meal.type || 'хранене';

  const compat = checkProductCompatibility(names, {
    allowSweetener: SWEET_ALLOWED_SLOTS.has(meal.type) || meal.dessert === true,
    slotType: meal.type,
  });
  for (const issue of compat) issues.push(`"${label}": ${issue}`);

  // A named salad plus separately listed fresh vegetables is the same thing twice.
  const text = `${meal.name || ''} ${meal.description || ''}`;
  const hasSalad = hasWord(text, 'салата') || hasWord(text, 'салатка');
  const looseFresh = names.some(n => /домат|краставиц|чушк/i.test(n));
  if (hasSalad && looseFresh && /пресн|нарязан/i.test(text)) {
    issues.push(`"${label}": салата И пресни зеленчуци едновременно`);
  }

  return issues;
}

export function validateWeekPlanCombinations(weekPlan) {
  const issues = [];
  for (let d = 1; d <= 7; d++) {
    const day = weekPlan?.[`day${d}`];
    if (!day?.meals) continue;
    for (const meal of day.meals) {
      issues.push(...validateMealCombinations(meal));
    }
  }
  return issues;
}

/**
 * Day-level checks the per-meal pass cannot see: the same dish served twice,
 * and main meals arriving without any vegetable.
 */
export function validateDayCoherence(dayPlan, dayNum = null) {
  const issues = [];
  const meals = dayPlan?.meals || [];
  const prefix = dayNum ? `Ден ${dayNum}: ` : '';
  // Lunch and dinner are plated meals and need a vegetable; breakfast may be a
  // sweet bowl (yoghurt, oats, fruit), where a vegetable would be the defect.
  const PLATED_SLOTS = new Set(['Хранене 2', 'Хранене 4']);

  const seen = new Map();
  for (const meal of meals) {
    if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
    const key = String(meal.name || '').trim().toLowerCase();
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) issues.push(`${prefix}"${name}" се повтаря ${count} пъти в един ден`);
  }

  for (const meal of meals) {
    if (!PLATED_SLOTS.has(meal.type)) continue;
    const names = productNamesOf(meal);
    if (!names.length) continue;
    if (!names.some(n => kindsOf(n).has('vegetable'))) {
      issues.push(`${prefix}"${meal.name || meal.type}": основно хранене без зеленчук`);
    }
  }

  return issues;
}

export function validateWeekPlanDayCoherence(weekPlan) {
  const issues = [];
  for (let d = 1; d <= 7; d++) {
    const day = weekPlan?.[`day${d}`];
    if (!day?.meals) continue;
    issues.push(...validateDayCoherence(day, d));
  }
  return issues;
}

/**
 * Weekly variety: how many distinct main dishes the week actually contains.
 * @returns {{ unique: number, total: number, issues: string[] }}
 */
export function validateWeeklyDishVariety(weekPlan, minUniqueRatio = 0.5) {
  const MAIN_SLOTS = new Set(['Хранене 1', 'Хранене 2', 'Хранене 4']);
  const dishes = [];
  for (let d = 1; d <= 7; d++) {
    for (const meal of weekPlan?.[`day${d}`]?.meals || []) {
      if (MAIN_SLOTS.has(meal.type) && meal.name) dishes.push(meal.name.trim().toLowerCase());
    }
  }
  const unique = new Set(dishes).size;
  const issues = [];
  if (dishes.length && unique < Math.ceil(dishes.length * minUniqueRatio)) {
    issues.push(
      `седмицата има само ${unique} различни основни ястия за ${dishes.length} хранения`,
    );
  }
  return { unique, total: dishes.length, issues };
}
