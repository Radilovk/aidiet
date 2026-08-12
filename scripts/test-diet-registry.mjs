#!/usr/bin/env node
/** Universal diet registry — dietPreference + dietaryModifier, no profile ids. */
import {
  resolveCatalogDietProfile,
  resolveDietConstraintText,
  passesDietRegistry,
  getDietRegistryVersion,
} from '../diet-registry.js';
import { getCatalogCandidatesForChunk, validateProductNamesAgainstDiet } from '../food-catalog.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const strategy = {
  weeklyScheme: {
    monday: {
      mealBreakdown: [{ type: 'Хранене 2', calories: 600, protein: 40, carbs: 50, fats: 15 }],
    },
  },
};

ok(getDietRegistryVersion() === 'diet_v2', 'registry version diet_v2');

const veganCtx = { dietaryModifier: 'Балансирано', dietPreference: ['Веган'] };
ok(resolveCatalogDietProfile(veganCtx).vegan, 'dietPreference Веган → vegan flag');
ok(!resolveCatalogDietProfile({ dietaryModifier: 'Балансирано' }).vegan, 'balanced modifier alone not vegan');

ok(!passesDietRegistry({ name: 'Скир', nutritionKey: 'скир', group: 'dairy', slots: ['PRO'] }, veganCtx), 'vegan blocks skyr');
ok(!passesDietRegistry({ name: 'Пилешко месо', nutritionKey: 'пилешко месо', group: 'protein', slots: ['PRO'] }, veganCtx), 'vegan blocks chicken');
ok(passesDietRegistry({ name: 'Тофу', nutritionKey: 'тофу', group: 'protein', slots: ['PRO'], vegan: true, vegetarian: true }, veganCtx), 'vegan allows tofu');

const bySlot = getCatalogCandidatesForChunk({
  strategy,
  startDay: 1,
  endDay: 1,
  dietaryModifier: 'Балансирано',
  dietPreference: ['Веган'],
});
const allNames = [...bySlot.values()].flat().map(e => e.name.toLowerCase());
ok(!allNames.some(n => /скир|пилешко|яйц|кисело мляко/.test(n)), 'vegan catalog pool excludes animal products');

ok(
  validateProductNamesAgainstDiet(['Скир', 'Ориз'], veganCtx).includes('Скир'),
  'validateProductNamesAgainstDiet catches skyr',
);

const vegCtx = { dietaryModifier: 'Балансирано', dietPreference: ['Вегетарианска'] };
ok(resolveCatalogDietProfile(vegCtx).vegetarian, 'vegetarian flag from preference');
ok(passesDietRegistry({ name: 'Скир', nutritionKey: 'скир', group: 'dairy', slots: ['PRO'], vegetarian: true }, vegCtx), 'vegetarian allows dairy');

ok(
  resolveDietConstraintText({ dietaryModifier: 'Кето', dietPreference: ['Нисковъглехидратна'] }).includes('Кето'),
  'constraint text merges modifier + preference',
);

console.log(`\n=== diet registry universal: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
