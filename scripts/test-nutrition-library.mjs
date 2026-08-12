#!/usr/bin/env node
/** Nutrition library merge — overlay, ready meals, templates, diet filter. */
import { getCatalogEntries, getNutritionLibraryVersion } from '../food-registry.js';
import { READY_MEAL_PARTS } from '../ready-meal-parts.js';
import {
  getLibraryMergeStats,
  filterLibraryFoodsByDiet,
  LIBRARY_FOODS,
} from '../nutrition-library-bridge.js';
import {
  slotTargetsFromTemplate,
  pickReadyMealsForSlot,
  foodsForSlotAssembly,
  getAllSlotTemplates,
} from '../meal-template-engine.js';
import { FOOD_CATALOG } from '../food-catalog-data.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const stats = getLibraryMergeStats();
ok(stats.libraryFoods >= 240, `library foods >= 240 (${stats.libraryFoods})`);
ok(stats.catalogOverlay >= 200, `catalog overlay >= 200 (${stats.catalogOverlay})`);
ok(stats.mergedTotal > 350, `merged > 350 (${stats.mergedTotal})`);
ok(stats.readyMeals >= 30, `ready meals >= 30 (${stats.readyMeals})`);
ok(stats.mealTemplates >= 5, `meal templates >= 5 (${stats.mealTemplates})`);
ok(stats.dietProfiles >= 12, `diet profiles >= 12 (${stats.dietProfiles})`);
ok(getNutritionLibraryVersion().startsWith('lib_v1'), 'library version tag');

const merged = getCatalogEntries();
ok(merged.length >= stats.mergedTotal - 1, `getCatalogEntries ~ stats (${merged.length} ~ ${stats.mergedTotal})`);

ok(READY_MEAL_PARTS.meal_salmon_quinoa?.length === 4, 'library meal_salmon_quinoa decompose');
ok(READY_MEAL_PARTS.meal_rice_chicken?.length === 2, 'base meal_rice_chicken preserved');

const veganFoods = filterLibraryFoodsByDiet('vegan');
ok(veganFoods.every(f => !(f.excluded_in || []).includes('vegan')), 'vegan filter excludes animal');
ok(!veganFoods.some(f => f.group_id === 'meat'), 'vegan filter no meat group');

const h1 = slotTargetsFromTemplate('Хранене 1');
ok(h1?.kcal === 350, 'Хранене 1 template kcal 350');
const h5 = slotTargetsFromTemplate('Хранене 5');
ok(h5?.kcal === 200, 'Хранене 5 maps to snack template 200 kcal');

const lunches = pickReadyMealsForSlot('Хранене 2', 'mediterranean', 10);
ok(lunches.length >= 3, `lunch ready meals >= 3 (${lunches.length})`);

const assembly = foodsForSlotAssembly('Хранене 3', 'balanced');
ok(assembly.foods.length >= 5, `snack assembly foods >= 5 (${assembly.foods.length})`);

const slots = getAllSlotTemplates();
ok(slots.length === 5, 'all 5 NutriPlan slots have templates');

ok(!LIBRARY_FOODS.some(f => /експандирана храна/i.test(f.name_bg)), 'no placeholder foods');

console.log('\n=== nutrition library: stats ===');
console.log(JSON.stringify(stats, null, 2));
console.log(`\n=== nutrition library: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
