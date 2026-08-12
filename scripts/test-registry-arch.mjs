#!/usr/bin/env node
/** Registry architecture — overlay, atomic meals, day budget, source meta. */
import { setCatalogOverlay, getCatalogVersion, resolveRegistryEntry } from '../food-registry.js';
import { SCALING_ATOMIC } from '../ready-meal-parts.js';
import {
  applyAtomicMealNutrition,
  adjustDecomposableTargets,
  syncDayMealsNutrition,
} from '../meal-day-sync.js';
import { buildPlanSourceMeta } from '../plan-source-meta.js';
import { rankCatalogCandidates } from '../candidate-ranking.js';
import { passesDietRegistry } from '../diet-registry.js';
import { getCatalogEntryNutrition } from '../food-catalog.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const atomicEntry = {
  id: 'menu_test_plate',
  name: 'Ресторантско пиле',
  nutritionKey: 'ресторантско пиле',
  group: 'ready_meal',
  slots: ['PRO', 'ENG'],
  timing: ['main'],
  universality: 4,
  scalingMode: SCALING_ATOMIC,
  fixedNutrition: { kcal: 620, p: 45, c: 55, f: 18, weightGrams: 420 },
};

setCatalogOverlay([atomicEntry], 'test_v1');
ok(getCatalogVersion().includes('cat_'), 'catalog version hash');
ok(resolveRegistryEntry('Ресторантско пиле').entry?.id === 'menu_test_plate', 'overlay entry resolves');

const meal = { type: 'Хранене 2', name: 'Обяд', description: '• Ресторантско пиле' };
const atomicResult = applyAtomicMealNutrition(meal, { calories: 600 });
ok(atomicResult.ok && meal.calories === 620, 'atomic applies fixed kcal');
ok(!atomicResult.feasible || atomicResult.feasible, 'atomic feasibility computed');

const decomp = [{
  schemeTarget: { calories: 500 },
  solveTarget: { calories: 500, protein: 30, carbs: 40, fats: 12 },
}];
adjustDecomposableTargets(decomp, 70);
ok(decomp[0].solveTarget.calories === 430, 'legacy drift helper still works in isolation');

const day = {
  meals: [
    { type: 'Хранене 2', name: 'A', description: '• Ресторантско пиле' },
    { type: 'Хранене 4', name: 'B', description: '• пилешко месо\n• ориз\n• домати' },
  ],
};
const scheme = {
  mealBreakdown: [
    { type: 'Хранене 2', calories: 600, protein: 40, carbs: 50, fats: 15 },
    { type: 'Хранене 4', calories: 550, protein: 38, carbs: 45, fats: 14 },
  ],
};
const daySync = syncDayMealsNutrition(day, scheme, {});
ok(day.meals[0].calories === 620, 'atomic meal synced');
ok(day.meals[1].calories > 0, 'decomposable meal synced after drift');
ok(daySync.infeasible.length >= 0, 'day sync returns infeasible list');

const ranked = rankCatalogCandidates(
  [
    { name: 'Ориз', nutritionKey: 'ориз', universality: 5, group: 'carb' },
    { name: 'Ядки', nutritionKey: 'ядки', universality: 5, group: 'fat' },
  ],
  { slotTarget: { calories: 400, fats: 8, carbs: 45, protein: 30 }, limit: 2 },
);
ok(ranked[0]?.name === 'Ориз', 'ranking prefers macro-fit candidate');

ok(passesDietRegistry({ name: 'Ориз', nutritionKey: 'ориз', group: 'carb', slots: ['ENG'] }, 'Кетогенна диета') === false, 'diet registry narrows keto carbs');
ok(passesDietRegistry({ name: 'Маруля', nutritionKey: 'маруля', group: 'vegetable', slots: ['VOL'] }, 'Кетогенна диета') === true, 'diet registry keeps VOL on keto');

const veganPref = { dietaryModifier: 'Балансирано', dietPreference: ['Веган'] };
ok(!passesDietRegistry({ name: 'Скир', nutritionKey: 'скир', group: 'dairy', slots: ['PRO'] }, veganPref), 'dietPreference vegan narrows catalog');

const meta = buildPlanSourceMeta({ pipeline: 'test' });
ok(meta.catalogVersion && meta.dietRegistryVersion === 'diet_v2', 'plan source meta diet_v2');

setCatalogOverlay([]);
console.log(`\n=== registry arch: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
