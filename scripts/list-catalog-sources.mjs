#!/usr/bin/env node
/**
 * Inventory of catalog source files — run before/after manual edits.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MEAL_DISHES } from '../meal-dishes.js';
import { FOOD_CATALOG } from '../food-catalog-data.js';
import { inferDishTags } from '../dish-tags.js';
import { DEFAULT_PLAN_ENGINE, PLAN_ENGINE_VERSION } from '../plan-engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE_FILES = [
  { path: 'data/meal-dishes.json', role: 'Ястия — РЕДАКТИРАЙ ТУК' },
  { path: 'meal-dishes.js', role: 'Зарежда JSON + нормализация' },
  { path: 'food-catalog-data.js', role: 'Продукти / сурови храни' },
  { path: 'food-nutrition-data.js', role: 'kcal и макроси на 100 g' },
  { path: 'dish-tags.js', role: 'Логика за тагове (не списък)' },
  { path: 'diet-registry.js', role: 'Диетични филтри' },
  { path: 'questionnaire-engine-map.js', role: 'Анкета → engine hints' },
  { path: 'meal-compatibility.js', role: 'Правила за съчетаване' },
  { path: 'portion-limits.js', role: 'Тавани на порции' },
  { path: 'admin-food-catalog.js', role: 'Admin KV overlay API' },
  { path: 'food-registry.js', role: 'Runtime merge на каталога' },
  { path: 'docs/CATALOG_EDITING.md', role: 'Този справочник' },
];

function lineCount(rel) {
  try {
    return readFileSync(join(root, rel), 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

const liquid = MEAL_DISHES.filter(d => inferDishTags(d).includes('liquid_breakfast')).length;
const lowCarb = MEAL_DISHES.filter(d => inferDishTags(d).includes('low_carb')).length;
const sweet = MEAL_DISHES.filter(d => inferDishTags(d).includes('sweet_slot')).length;

console.log('=== NutriPlan catalog sources ===\n');
console.log(`Plan engine: ${PLAN_ENGINE_VERSION} (default ${DEFAULT_PLAN_ENGINE})\n`);

console.log('Counts:');
console.log(`  dishes (meal-dishes):   ${MEAL_DISHES.length}`);
console.log(`  products (food-catalog):  ${FOOD_CATALOG.length}`);
console.log(`  liquid_breakfast tags:    ${liquid}`);
console.log(`  low_carb tags:            ${lowCarb}`);
console.log(`  sweet_slot tags:          ${sweet}\n`);

console.log('Source files:');
for (const f of SOURCE_FILES) {
  const lines = lineCount(f.path);
  console.log(`  ${f.path.padEnd(28)} ${String(lines).padStart(5)} lines  — ${f.role}`);
}

console.log('\nAfter editing data/meal-dishes.json run:');
console.log('  node scripts/test-meal-dishes.mjs');
console.log('  node scripts/test-catalog-coverage.mjs');
console.log('  npm run build:worker');
