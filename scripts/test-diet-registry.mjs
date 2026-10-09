#!/usr/bin/env node
/** Universal diet registry — dietPreference + dietaryModifier, no profile ids. */
import {
  resolveCatalogDietProfile,
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

const lowCarb = resolveCatalogDietProfile({ dietaryModifier: 'Балансирано', dietPreference: ['Нисковъглехидратна'] });
ok(lowCarb.lowCarb && !lowCarb.keto, 'Нисковъглехидратна е low-carb, не кето');
ok(resolveCatalogDietProfile({ dietaryModifier: 'Кетогенна диета' }).keto, 'кетогенна диета → keto');
const dislike = resolveCatalogDietProfile({ dietaryModifier: 'Балансирано', dietDislike: 'веган колбаси, кето десерти' });
ok(!dislike.vegan && !dislike.keto, 'нелюбимите храни не определят диетата');
ok(resolveCatalogDietProfile({ dietaryModifier: 'Балансирано', dietDislike: 'непоносимост към глутен' }).glutenFree,
  'непоносимост към глутен в нелюбими → без глутен');
const combo = resolveCatalogDietProfile({ dietaryModifier: 'Веган · Без глутен' });
ok(combo.vegan && combo.glutenFree, 'съставен етикет носи и модела, и изключването');

console.log(`\n=== diet registry universal: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
