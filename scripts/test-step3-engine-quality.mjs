#!/usr/bin/env node
/**
 * Integration quality checks for deterministic Step 3 engine output.
 * Guards catalog pools, solver gram caps, and preserved product features:
 * dessert on lunch, free meal on weekend, skip breakfast.
 */
import { getCatalogCandidatesForChunk } from '../food-catalog.js';
import { getCatalogEntries } from '../food-registry.js';
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { syncWeekPlanNutritionFromDatabase } from '../meal-day-sync.js';
import { computeMealItemBounds, parseMealDescription, lookupFoodProfile } from '../food-nutrition.js';
import { userSkipsBreakfast } from '../plan-normalize.js';

let pass = 0;
let fail = 0;
const CONDIMENT_MAX = 15;

function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const analysis = {
  Final_Calories: 1760,
  macroGrams: { protein: 120, carbs: 180, fats: 55 },
};

const baseUser = {
  eatingHabits: [],
  dietPreference: ['Балансирано'],
};

const strategy = buildDeterministicStrategy({ userData: baseUser, analysis });
const veganUser = { ...baseUser, dietPreference: ['Веган'] };
const veganStrategy = buildDeterministicStrategy({ userData: veganUser, analysis });
const candidates = getCatalogCandidatesForChunk({
  strategy,
  startDay: 1,
  endDay: 7,
  dietaryModifier: strategy.dietaryModifier,
});

ok(strategy.weeklyScheme.monday?.calories === 1760, `strategy uses fixture kcal (${strategy.weeklyScheme.monday?.calories})`);

const eggBounds = computeMealItemBounds(
  [{ name: 'яйца', profile: lookupFoodProfile('яйца').profile }],
  { kcal: 500 },
);
ok(eggBounds[0].max <= 300, `protein bounds capped at 300g (${eggBounds[0].max})`);

const yogurtBounds = computeMealItemBounds(
  [{ name: 'кисело мляко', profile: lookupFoodProfile('кисело мляко').profile }],
  { kcal: 600 },
);
ok(yogurtBounds[0].max <= 300, `dairy bounds capped at 300g (${yogurtBounds[0].max})`);

// Vegan flags from library + week output (chunk PRO pool includes late-snack inject bypass)
const moz = getCatalogEntries().find(e => /моцарела/i.test(e.name));
const avocado = getCatalogEntries().find(e => e.nutritionKey === 'авокадо');
ok(moz && !moz.vegan, 'mozzarella flagged non-vegan in catalog');
ok(avocado?.vegan, 'avocado flagged vegan in catalog');
const veganChunk = buildDeterministicWeekPlanChunk({
  strategy: veganStrategy,
  userData: veganUser,
  startDay: 1,
  endDay: 3,
  seed: 9,
});
const veganText = JSON.stringify(veganChunk).toLowerCase();
ok(!/моцарела|кисело мляко|скир|айран|кашкавал|пилешк|сьомга/.test(veganText), 'vegan plan excludes animal products');

const engPool = candidates.get('ENG') || [];
const fatPool = candidates.get('FAT') || [];
const engNames = engPool.map(e => (e.nutritionKey || e.name).toLowerCase()).join(' ');
const fatNames = fatPool.map(e => (e.nutritionKey || e.name).toLowerCase()).join(' ');

ok(engPool.length > 0, 'ENG pool present with default 5-meal scheme');
ok(/овес|хляб|ориз|картоф/.test(engNames), 'ENG pool includes starches/grains');
ok(/орех|бадем|зехтин|авокадо/.test(fatNames), 'FAT pool includes nuts/oil (not dairy-only)');

const chunk = buildDeterministicWeekPlanChunk({
  strategy,
  userData: baseUser,
  startDay: 1,
  endDay: 7,
  seed: 1,
});

const weekPlan = JSON.parse(JSON.stringify(chunk));
syncWeekPlanNutritionFromDatabase(weekPlan, strategy, 1, 7);

const h3Names = new Set();
let condimentOverCap = [];
for (let d = 1; d <= 7; d++) {
  const h3 = weekPlan[`day${d}`]?.meals?.find(m => m.type === 'Хранене 3');
  if (h3?.name) h3Names.add(h3.name);
  for (const meal of weekPlan[`day${d}`]?.meals || []) {
    for (const item of parseMealDescription(meal.description || '')) {
      const g = item.grams || 0;
      if (/синап|горчица|босилек|риган|чили|пипер|стевия|оцет/i.test(item.name) && g > CONDIMENT_MAX) {
        condimentOverCap.push(`day${d} ${meal.type}: ${item.name} ${g}g`);
      }
    }
  }
}

ok(h3Names.size >= 2, `H3 snacks rotate across week (${h3Names.size} unique)`);
ok(condimentOverCap.length === 0, `no condiment >${CONDIMENT_MAX}g after solver`);

// Free meal on Sunday (default freeDayNumber=7)
ok(
  strategy.weeklyScheme.sunday?.mealBreakdown?.some(m => m.type === 'Свободно хранене'),
  'Sunday scheme has Свободно хранене slot',
);
const sundayMeals = chunk.day7?.meals || [];
ok(
  sundayMeals.some(m => m.type === 'Свободно хранене'),
  'Sunday plan includes Свободно хранене meal',
);
ok(
  !sundayMeals.some(m => m.type === 'Хранене 2'),
  'Sunday has no duplicate H2 when free meal replaces lunch',
);

// Skip breakfast
const skipUser = { ...baseUser, eatingHabits: ['Не закусвам'] };
const skipStrategy = buildDeterministicStrategy({ userData: skipUser, analysis });
const skipChunk = buildDeterministicWeekPlanChunk({
  strategy: skipStrategy,
  userData: skipUser,
  startDay: 1,
  endDay: 1,
  seed: 3,
});
ok(userSkipsBreakfast(skipUser), 'skip-breakfast user detected');
ok(!skipChunk.day1.meals.some(m => m.type === 'Хранене 1'), 'no H1 when skipping breakfast');

// Fixed dessert on lunch (H2) when sweets craving
const sweetUser = { ...baseUser, foodCravings: ['Сладко'] };
ok(buildDeterministicStrategy({ userData: sweetUser, analysis }).includeDessert === true, 'includeDessert when sweets craving');
const sweetChunk = buildDeterministicWeekPlanChunk({
  strategy: buildDeterministicStrategy({ userData: sweetUser, analysis }),
  userData: sweetUser,
  startDay: 1,
  endDay: 3,
  seed: 5,
  includeDessert: true,
});
let dessertDays = 0;
for (let d = 1; d <= 3; d++) {
  const h2 = sweetChunk[`day${d}`]?.meals?.find(m => m.type === 'Хранене 2');
  if (h2?.dessert === true) dessertDays++;
  if (sweetChunk[`day${d}`]?.meals?.some(m => m.type === 'Свободно хранене')) {
    ok(!h2, `free day ${d} has no H2 (replaced by free meal)`);
  }
}
ok(dessertDays >= 1, 'H2 dessert flag set when includeDessert=true');

// Main meals must be coherent dishes, not random macro piles
const READY_DISH = /ориз с пиле|риба с картофи|пилешка салата|пилешка супа|яхния|омлет|овесена каша|сандвич|на скара|на фурна|купа|извара|скир/i;
let incoherent = [];
for (let d = 1; d <= 7; d++) {
  for (const slotType of ['Хранене 1', 'Хранене 2', 'Хранене 4']) {
    const meal = weekPlan[`day${d}`]?.meals?.find(m => m.type === slotType);
    if (!meal) continue;
    const text = `${meal.name} ${meal.description || ''}`.toLowerCase();
    if (/пилешк.*боб|боб.*пилешк|ябълка.*пилешк|пилешк.*ябълка|мляко.*дomat|дomat.*мляко.*кефир.*мляко/i.test(text)) {
      incoherent.push(`day${d} ${slotType}: ${meal.name}`);
    }
    if (!READY_DISH.test(meal.name) && parseMealDescription(meal.description).length > 4) {
      incoherent.push(`day${d} ${slotType}: too many items (${meal.name})`);
    }
  }
}
ok(incoherent.length === 0, `main meals are coherent dishes (${incoherent.slice(0, 3).join('; ') || 'ok'})`);

const readyNamesByDay = [];
for (let d = 1; d <= 7; d++) {
  const dayNames = [];
  for (const slotType of ['Хранене 1', 'Хранене 2', 'Хранене 4']) {
    const meal = weekPlan[`day${d}`]?.meals?.find(m => m.type === slotType);
    if (meal?.name) dayNames.push(meal.name);
  }
  readyNamesByDay.push(dayNames);
  const uniqueDay = new Set(dayNames);
  ok(uniqueDay.size === dayNames.length, `day${d} main meals all unique (${dayNames.join(', ')})`);
}
const uniqueWeek = new Set(readyNamesByDay.flat());
ok(uniqueWeek.size >= 6, `main meal variety across week (${uniqueWeek.size} unique, pool-limited)`);

let badGramSteps = [];
for (let d = 1; d <= 7; d++) {
  for (const meal of weekPlan[`day${d}`]?.meals || []) {
    for (const item of parseMealDescription(meal.description || '')) {
      const g = item.grams || 0;
      if (g <= 0) continue;
      const okStep = g >= 50 ? g % 50 === 0 : g % 5 === 0;
      if (!okStep) badGramSteps.push(`${item.name} ${g}g`);
    }
  }
}
ok(badGramSteps.length === 0, `grams on 5g/50g grid (${badGramSteps.slice(0, 3).join(', ') || 'ok'})`);

// Saturday free day option
const satStrategy = buildDeterministicStrategy({
  userData: baseUser,
  analysis,
  options: { freeDayNumber: 6 },
});
ok(
  satStrategy.weeklyScheme.saturday?.mealBreakdown?.some(m => m.type === 'Свободно хранене'),
  'Saturday freeDayNumber=6 supported in scheme',
);

console.log(`\n=== step3 engine quality: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
