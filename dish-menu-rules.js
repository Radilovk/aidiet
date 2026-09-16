/**
 * Universal day-menu rules — how a dietitian structures one day.
 *
 * Dishes come only from the curated catalog (coherent meals). This module
 * ensures the *day* is coherent: protein rotation, one staple carb across
 * mains, fruit at most once. No cuisine table, no profile hacks.
 */

import { READY_MEAL_PARTS } from './ready-meal-parts.js';
import { normalizeFoodKey } from './food-utils.js';

const MAIN_SLOTS = new Set(['Хранене 2', 'Хранене 4']);

const PROTEIN_PATTERNS = [
  ['beef', ['говежд', 'телешк', 'теле']],
  ['pork', ['свинск', 'свинско']],
  ['poultry', ['пилешк', 'пиле', 'пуешк', 'пуйка']],
  ['fish', ['риба', 'сьомга', 'тон', 'треска', 'скумри', 'тилапи', 'лаврак', 'скарид']],
  ['lamb', ['агнешк']],
  ['legume', ['леща', 'боб', 'нахут', 'соев', 'темпе', 'тофу', 'фасул']],
  ['eggs', ['яйц', 'омлет']],
];

const STAPLE_PATTERNS = [
  ['rice', ['ориз']],
  ['pasta', ['паста', 'макарон', 'спагети', 'фиде']],
  ['potato', ['картоф']],
  ['bread', ['хляб']],
  ['oats', ['овес']],
  ['bulgur', ['елда', 'булгур', 'киноа']],
];

const FRUIT_PATTERNS = [
  'банан', 'ябълк', 'портокал', 'мандарин', 'круша', 'грозде', 'праскова',
  'диня', 'пъпеш', 'ананас', 'манго', 'кайси', 'слив', 'малин', 'боровинк', 'ягод',
];

function namesForDish(entry) {
  const parts = READY_MEAL_PARTS[entry?.id] || entry?.products || [];
  return parts.map(p => String(p.name || '').toLowerCase()).filter(Boolean);
}

function matchFamily(names, patterns) {
  for (const [family, stems] of patterns) {
    if (names.some(n => stems.some(s => n.includes(s)))) return family;
  }
  return null;
}

function hasFruit(names) {
  return names.some(n => FRUIT_PATTERNS.some(f => n.includes(f)));
}

/** Classify a catalog dish for day-level menu rules. */
export function classifyDish(entry) {
  const names = namesForDish(entry);
  return {
    protein: matchFamily(names, PROTEIN_PATTERNS),
    staple: matchFamily(names, STAPLE_PATTERNS),
    fruit: hasFruit(names),
  };
}

export function createDayMenuState() {
  return {
    proteins: new Set(),
    staples: new Set(),
    fruitUsed: false,
  };
}

export function recordDishOnDay(state, entry) {
  if (!state || !entry) return;
  const c = classifyDish(entry);
  if (c.protein) state.proteins.add(c.protein);
  if (c.staple) state.staples.add(c.staple);
  if (c.fruit) state.fruitUsed = true;
}

/**
 * @param {'strict'|'protein_only'} mode — protein rotation is never relaxed
 */
export function dishAllowedOnDay(state, entry, slotType, mode = 'strict') {
  if (!state || !entry) return true;
  const c = classifyDish(entry);
  const main = MAIN_SLOTS.has(slotType);

  if (main && c.protein && state.proteins.has(c.protein)) return false;
  if (mode === 'strict') {
    if (main && c.staple && state.staples.has(c.staple)) return false;
    if (c.fruit && state.fruitUsed) return false;
  }
  return true;
}

export function filterPoolByDayMenu(pool, state, slotType, mode = 'strict') {
  if (!pool?.length || !state) return pool || [];
  const filtered = pool.filter(e => dishAllowedOnDay(state, e, slotType, mode));
  if (filtered.length) return filtered;
  if (mode === 'strict') {
    return pool.filter(e => dishAllowedOnDay(state, e, slotType, 'protein_only'));
  }
  return pool;
}

/** Day-level audit (validators + tests). */
export function validateDayMenuRules(dayPlan, dayNum = null) {
  const issues = [];
  const prefix = dayNum ? `Ден ${dayNum}: ` : '';
  const state = createDayMenuState();

  for (const meal of dayPlan?.meals || []) {
    if (!meal?.dishId) continue;
    const real = classifyDish({ id: meal.dishId });

    if (MAIN_SLOTS.has(meal.type) && real.protein) {
      if (state.proteins.has(real.protein)) {
        issues.push(`${prefix}${meal.type}: повторен протеин „${real.protein}“ в един ден (${meal.name})`);
      }
      state.proteins.add(real.protein);
    }
    if (MAIN_SLOTS.has(meal.type) && real.staple) {
      if (state.staples.has(real.staple)) {
        issues.push(`${prefix}${meal.type}: повторно нишесте „${real.staple}“ на обяд и вечеря (${meal.name})`);
      }
      state.staples.add(real.staple);
    }
    if (real.fruit) {
      if (state.fruitUsed) {
        issues.push(`${prefix}${meal.type}: плод повторен в същия ден (${meal.name})`);
      }
      state.fruitUsed = true;
    }
  }
  return issues;
}
