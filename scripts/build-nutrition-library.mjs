#!/usr/bin/env node
/**
 * Build canonical nutrition-library-data.js from JSON sources.
 * Run generate-full-nutrition-library.mjs first for full catalog.
 *
 * npm run build:nutrition-library
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'nutrition-library', 'data');
const outFile = join(root, 'nutrition-library-data.js');

// Regenerate full library from catalog + expansion
const gen = spawnSync('node', ['scripts/generate-full-nutrition-library.mjs'], { cwd: root, encoding: 'utf8' });
if (gen.status !== 0) {
  console.error(gen.stderr || gen.stdout);
  process.exit(gen.status ?? 1);
}

function readJson(name) {
  return JSON.parse(readFileSync(join(dataDir, name), 'utf8'));
}

const foods = readJson('foods.json');

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
  filtered_placeholders: 0,
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
