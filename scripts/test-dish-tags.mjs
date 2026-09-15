#!/usr/bin/env node
import { MEAL_DISHES, dishToCatalogEntry } from '../meal-dishes.js';
import {
  inferDishTags,
  dishTagList,
  dishMatchesTagFilter,
  resolveDishTagFilter,
  preferTagScore,
} from '../dish-tags.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const ketoDish = MEAL_DISHES.find(d => d.id === 'meal_salmon_avocado');
ok(ketoDish?.tags?.includes('low_carb'), 'keto dish has explicit low_carb tag');

const ketoTags = inferDishTags(ketoDish);
ok(ketoTags.includes('low_carb'), 'infer keeps explicit low_carb');
ok(ketoTags.includes('gluten_free'), 'salmon avocado inferred gluten_free');

const oatmeal = MEAL_DISHES.find(d => d.id === 'meal_oatmeal');
const oatTags = inferDishTags(oatmeal);
ok(!oatTags.includes('gluten_free'), 'oatmeal is not gluten_free');
ok(oatTags.includes('liquid_breakfast'), 'oatmeal is liquid_breakfast');

const entry = dishToCatalogEntry(oatmeal, () => 'carb');
ok(entry.dishTags?.includes('liquid_breakfast'), 'catalog entry carries dishTags');

ok(
  dishMatchesTagFilter(entry, { requireAll: ['vegetarian'] }),
  'oatmeal matches vegetarian filter',
);
ok(
  !dishMatchesTagFilter(entry, { requireAll: ['vegan'] }),
  'oatmeal fails vegan filter',
);

const glutenUser = { dietPreference: ['Без глутен'], _engineDietHints: 'без глутен gluten' };
const glutenFilter = resolveDishTagFilter(glutenUser, { dietaryModifier: 'Балансирано' }, 'Хранене 2');
ok(glutenFilter?.requireAll?.includes('gluten_free'), 'gluten user requires gluten_free');

const ketoStrategy = { dietaryModifier: 'Кетогенна' };
const ketoFilter = resolveDishTagFilter({}, ketoStrategy, 'Хранене 2');
ok(ketoFilter?.requireAll?.includes('low_carb'), 'keto modifier requires low_carb on lunch');

const lowCarbHint = resolveDishTagFilter(
  { clinicalProtocol: 'insulin_resistance' },
  { dietaryModifier: 'Балансирано' },
  'Хранене 4',
);
ok(lowCarbHint?.prefer?.includes('low_carb'), 'insulin resistance prefers low_carb');

const salmonEntry = dishToCatalogEntry(ketoDish, () => 'protein');
const oatEntry = dishToCatalogEntry(oatmeal, () => 'carb');
ok(
  preferTagScore(salmonEntry, ['low_carb']) > preferTagScore(oatEntry, ['low_carb']),
  'low_carb dish scores higher on low_carb preference',
);
ok(!dishTagList(oatEntry).includes('low_carb'), 'oatmeal is not inferred low_carb');
ok(dishTagList(salmonEntry).includes('low_carb'), 'dishTagList reads catalog dishTags');

console.log(`\n=== dish-tags: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
