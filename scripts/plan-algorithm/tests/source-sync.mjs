#!/usr/bin/env node
/**
 * Guarantees worker.entry.js stays in sync with plan-pipeline-pure.js
 * and profile/food-picker HTML still encodes the contracts we test.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const results = [];
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

console.log('-- Source synchronization --');

const worker = readFileSync(join(root, 'worker.entry.js'), 'utf8');
const pure = readFileSync(join(root, 'plan-pipeline-pure.js'), 'utf8');
const profile = readFileSync(join(root, 'profile.html'), 'utf8');
const foodPicker = readFileSync(join(root, 'food-picker.html'), 'utf8');
const contracts = readFileSync(join(root, 'plan-regen-contracts.js'), 'utf8');

check('worker импортира plan-pipeline-pure', worker.includes("from './plan-pipeline-pure.js'"));
check('pure: MIN_FAT 0.7', pure.includes('MIN_FAT_GRAMS_PER_KG = 0.7'));
check('pure: MAX_DEFICIT 0.25', pure.includes('MAX_DEFICIT_RATIO = 0.25'));
check('pure: FIXED_DESSERT 168', pure.includes('calories: 168'));

const workerNeedles = [
  'enforceCalorieGuardrails',
  'enforceWeekendFreeDay',
  'normalizeStrategyDessertFlag',
  'injectFixedDesserts',
  'recalculateDayCalories',
  'collectUserBlockedFoodTerms',
  'validateMealsAgainstScheme',
  'buildFreeMealInstruction',
  'buildSweetsCravingRule',
  'generatePlanMultiStep',
  'generateMealPlanProgressive',
  '_requireApproval',
];
for (const n of workerNeedles) {
  check(`worker съдържа ${n}`, worker.includes(n));
}

check('profile: saveAndRegeneratePlan', profile.includes('function saveAndRegeneratePlan'));
check('profile: _requireApproval', profile.includes('_requireApproval'));
check('profile: planJobSource profile-regen', profile.includes("planJobSource") && profile.includes('profile-regen'));
check('profile: data-diet-related', profile.includes('data-diet-related="true"'));
check('profile: generate-plan-async', profile.includes('generate-plan-async'));

check('food-picker: EXCLUSION_THRESHOLD 0.6', foodPicker.includes('EXCLUSION_THRESHOLD = 0.6'));
check('food-picker: set-blacklist', foodPicker.includes('set-blacklist'));
check('food-picker: set-mainlist', foodPicker.includes('set-mainlist'));
check('food-picker: generate-plan', foodPicker.includes('/api/generate-plan'));

check('contracts: DIET_RELATED_PROFILE_FIELDS', contracts.includes('DIET_RELATED_PROFILE_FIELDS'));
check('contracts: FOOD_PICKER_EXCLUSION_THRESHOLD', contracts.includes('FOOD_PICKER_EXCLUSION_THRESHOLD = 0.6'));

const passed = results.filter(Boolean).length;
console.log(`\nsource-sync: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
