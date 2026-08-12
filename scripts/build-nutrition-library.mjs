#!/usr/bin/env node
/**
 * Build canonical nutrition-library-data.js from JSON sources.
 * Filters placeholder rows, merges enrichment, maps ready-meals.
 *
 * npm run build:nutrition-library
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'nutrition-library', 'data');
const outFile = join(root, 'nutrition-library-data.js');

function readJson(name) {
  return JSON.parse(readFileSync(join(dataDir, name), 'utf8'));
}

function isPlaceholder(name = '') {
  return /експандирана храна/i.test(name);
}

function dedupeById(items) {
  const byId = new Map();
  for (const item of items) {
    if (!item?.id || isPlaceholder(item.name_bg || item.name)) continue;
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

const sourceFoods = readJson('foods-source.json');
const enrichment = readJson('enrichment.json');
const foods = dedupeById([...sourceFoods, ...enrichment]);

writeFileSync(join(dataDir, 'foods.json'), `${JSON.stringify(foods, null, 2)}\n`, 'utf8');

const readyMeals = readJson('ready-meals.json');
const mealTemplates = readJson('meal-templates.json');
const protocolRules = readJson('protocol-rules.json');
const foodGroups = readJson('food-groups.json');
const orchestrator = readJson('orchestrator.json');
const hierarchy = readJson('hierarchy.json');

const summary = {
  food_groups: foodGroups.length,
  foods: foods.length,
  ready_meals: readyMeals.length,
  templates: mealTemplates.length,
  rulesets: Object.keys(protocolRules.diet_profiles || {}).length,
  orchestrator_steps: orchestrator.pipeline?.length || 0,
  filtered_placeholders: sourceFoods.length - foods.length + enrichment.length,
};

writeFileSync(join(dataDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

const js = `/**
 * AUTO-GENERATED — do not edit by hand.
 * Source: nutrition-library/data/* → npm run build:nutrition-library
 */
export const NUTRITION_LIBRARY_VERSION = 'lib_v1_${foods.length}_${readyMeals.length}';

export const LIBRARY_FOOD_GROUPS = ${JSON.stringify(foodGroups, null, 2)};

export const LIBRARY_FOODS = ${JSON.stringify(foods, null, 2)};

export const LIBRARY_READY_MEALS = ${JSON.stringify(readyMeals, null, 2)};

export const LIBRARY_MEAL_TEMPLATES = ${JSON.stringify(mealTemplates, null, 2)};

export const LIBRARY_PROTOCOL_RULES = ${JSON.stringify(protocolRules, null, 2)};

export const LIBRARY_ORCHESTRATOR = ${JSON.stringify(orchestrator, null, 2)};

export const LIBRARY_HIERARCHY = ${JSON.stringify(hierarchy, null, 2)};

export const LIBRARY_SUMMARY = ${JSON.stringify(summary, null, 2)};
`;

writeFileSync(outFile, js, 'utf8');
console.log(`✅ ${outFile}`);
console.log(JSON.stringify(summary, null, 2));
