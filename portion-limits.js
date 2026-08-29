/**
 * Realistic single-serving gram limits — one source for the whole pipeline.
 *
 * The solver optimises kcal and macros; without an upper bound tied to what a
 * portion of a food actually is, it happily prescribes 240 g of mustard or
 * 300 g of egg. Group ceilings give every food a sane default; the item table
 * overrides the foods whose group ceiling is far too generous (oils, eggs).
 *
 * Weights are as-served (cooked / ready to eat), matching food-nutrition-data.
 */

import { normalizeFoodKey } from './food-utils.js';

/** Catalog group → max grams in one meal. */
export const GROUP_MAX_PORTION_G = {
  condiment: 15,
  beverage: 300,
  fat: 60,
  dairy: 300,
  protein: 250,
  vegetable: 300,
  fruit: 250,
  carb: 350,
  legume: 300,
  ready_meal: 500,
};

/** Catalog group → min grams worth putting on a plate. */
export const GROUP_MIN_PORTION_G = {
  condiment: 5,
  beverage: 100,
  fat: 5,
  dairy: 30,
  protein: 30,
  vegetable: 50,
  fruit: 50,
  carb: 30,
  legume: 30,
  ready_meal: 100,
};

export const DEFAULT_MAX_PORTION_G = 300;
export const DEFAULT_MIN_PORTION_G = 20;

/**
 * Per-food overrides, by normalised nutrition key or name.
 * Pure fats and eggs are the cases where the group ceiling is unrealistic.
 */
export const ITEM_MAX_PORTION_G = {
  // Pure fats — a serving is a spoon, not a bowl.
  'зехтин': 30,
  'олио': 30,
  'масло': 30,
  'кокосово масло': 30,
  'слънчогледово масло': 30,
  'гхи': 20,
  'фъстъчено масло': 40,
  'бадемово масло': 40,
  'тахан': 40,
  // Nuts and seeds — energy dense.
  'ядки': 50,
  'бадеми': 50,
  'орехи': 50,
  'кашу': 50,
  'лешници': 50,
  'шамфъстък': 50,
  'пекани': 50,
  'макадамия': 50,
  'бразилски орех': 40,
  'семена чиа': 30,
  'ленено семе': 30,
  'тиквени семки': 40,
  'слънчогледови семки': 40,
  'кокосови стърготини': 30,
  // Eggs — 150 g is three eggs.
  'яйца': 150,
  'варено яйце': 150,
  'бъркани яйца': 200,
  'яйчни белтъци': 200,
  'омлет': 250,
  // Concentrated dairy.
  'кашкавал': 60,
  'сирене': 80,
  'моцарела': 80,
  'пармезан': 40,
  'козе сирене': 60,
  // Dry weights (uncooked grains keep small servings).
  'овесени ядки': 100,
  'овес': 100,
  'протеин суроватка': 50,
  'протеин растителен': 50,
  // Sweeteners and spreads.
  'мед': 20,
  // Berries are a garnish portion, not a bowl of fruit.
  'боровинки': 150,
  'малини': 150,
  'ягоди': 200,
  'къпини': 150,
  'хумус': 100,
  'песто': 30,
  'маслини': 60,
  'авокадо': 150,
};

/** Per-food minimums where the group default would be nonsensically small. */
export const ITEM_MIN_PORTION_G = {
  'зехтин': 5,
  'олио': 5,
  'масло': 5,
  'семена чиа': 5,
  'ленено семе': 5,
  'мед': 5,
};

function lookup(table, name, nutritionKey) {
  const byKey = nutritionKey ? table[normalizeFoodKey(nutritionKey)] : undefined;
  if (byKey !== undefined) return byKey;
  const byName = name ? table[normalizeFoodKey(name)] : undefined;
  return byName;
}

/**
 * Max grams of one food in a single meal.
 * @param {{ name?: string, nutritionKey?: string, group?: string, maxPortionG?: number }} entry
 */
export function maxPortionGrams(entry = {}) {
  const item = lookup(ITEM_MAX_PORTION_G, entry.name, entry.nutritionKey);
  const group = GROUP_MAX_PORTION_G[entry.group] ?? DEFAULT_MAX_PORTION_G;
  const fromCatalog = Number(entry.maxPortionG) > 0 ? Number(entry.maxPortionG) : Infinity;
  return Math.min(item ?? group, group, fromCatalog);
}

/**
 * Min grams worth listing for one food.
 * @param {{ name?: string, nutritionKey?: string, group?: string }} entry
 */
export function minPortionGrams(entry = {}) {
  const item = lookup(ITEM_MIN_PORTION_G, entry.name, entry.nutritionKey);
  if (item !== undefined) return item;
  return GROUP_MIN_PORTION_G[entry.group] ?? DEFAULT_MIN_PORTION_G;
}
