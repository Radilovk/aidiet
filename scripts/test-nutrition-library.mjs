#!/usr/bin/env node
/** Nutrition library merge — overlay, ready meals, templates, diet filter. */
import { getCatalogEntries, getNutritionLibraryVersion } from '../food-registry.js';
import { normalizeFoodKey } from '../food-utils.js';
import { READY_MEAL_PARTS } from '../ready-meal-parts.js';
import { MEAL_DISHES_BY_ID } from '../meal-dishes.js';
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
// Merged total is deduplicated: a library row whose name already exists in the
// curated base catalog is dropped, so it no longer equals base + overlay.
// Dishes now live in meal-dishes.js, not in the library import, so the merged
// total is the raw-food catalog plus the curated dish list.
ok(stats.mergedTotal > 250, `merged > 250 (${stats.mergedTotal})`);
// Dishes come from the hand-maintained list, not from the library import.
ok(stats.dishes >= 40, `dishes >= 40 (${stats.dishes})`);
ok(stats.mealTemplates >= 5, `meal templates >= 5 (${stats.mealTemplates})`);
ok(stats.dietProfiles >= 12, `diet profiles >= 12 (${stats.dietProfiles})`);
ok(getNutritionLibraryVersion().startsWith('lib_v1'), 'library version tag');

const merged = getCatalogEntries();
ok(merged.length >= stats.mergedTotal - 1, `getCatalogEntries ~ stats (${merged.length} ~ ${stats.mergedTotal})`);

// Two entries may share a name key only if they are the same kind of thing
// (yoghurt and its 2% variant). A *food* sharing a name with a *dish* meant the
// composer picked the food while the nutrition sync expanded the dish.
{
  const seen = new Map();
  const clashes = [];
  for (const entry of merged) {
    const key = normalizeFoodKey(entry.name);
    const prev = seen.get(key);
    if (prev && prev.group !== entry.group) {
      clashes.push(`${entry.name}: ${prev.id}[${prev.group}] vs ${entry.id}[${entry.group}]`);
    } else if (!prev) {
      seen.set(key, entry);
    }
  }
  ok(clashes.length === 0, `no food/dish name clashes (${clashes.slice(0, 3).join(', ') || 'ok'})`);
}

// Броят продукти се чете от списъка, а не се преписва тук: ястието се
// редактира на ръка и добавена готварска мазнина не е повод тестът да падне.
for (const id of ['meal_baked_fish', 'meal_rice_chicken']) {
  const declared = MEAL_DISHES_BY_ID.get(id)?.products || [];
  const parts = READY_MEAL_PARTS[id] || [];
  ok(parts.length === declared.length && parts.length >= 3,
    `dish ${id} decomposes into its declared products (${parts.length}/${declared.length})`);
}

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
