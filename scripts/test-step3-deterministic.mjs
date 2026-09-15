#!/usr/bin/env node
/** Step 3 deterministic builder — scheme → catalog → solver pipeline. */
import {
  buildDeterministicWeekPlanChunk,
  deterministicStep3Enabled,
} from '../step3-deterministic.js';
import { syncWeekPlanNutritionFromDatabase } from '../meal-day-sync.js';
import { validateProductNamesInCatalog } from '../food-catalog.js';
import { parseMealDescription } from '../food-nutrition.js';
import { userSkipsBreakfast, removeBreakfastSlotFromDay } from '../plan-normalize.js';
import { buildDeterministicStrategy } from '../step2-deterministic.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(deterministicStep3Enabled({}), 'deterministic enabled by default');
ok(!deterministicStep3Enabled({ DETERMINISTIC_STEP3: '0' }), 'opt-out via env');

function makeStrategy({ meals = 5, dailyKcal = 2200 } = {}) {
  const weights = meals === 5
    ? [0.2, 0.25, 0.15, 0.25, 0.15]
    : [0.25, 0.35, 0.15, 0.25];
  const types = meals === 5
    ? ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5']
    : ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4'];
  const mealBreakdown = types.map((type, i) => {
    const kcal = Math.round(dailyKcal * weights[i]);
    return {
      type,
      calories: kcal,
      protein: Math.round(kcal * 0.25 / 4),
      carbs: Math.round(kcal * 0.45 / 4),
      fats: Math.round(kcal * 0.30 / 9),
    };
  });
  const day = {
    meals: mealBreakdown.length,
    calories: dailyKcal,
    protein: mealBreakdown.reduce((s, m) => s + m.protein, 0),
    carbs: mealBreakdown.reduce((s, m) => s + m.carbs, 0),
    fats: mealBreakdown.reduce((s, m) => s + m.fats, 0),
    mealBreakdown,
  };
  return {
    dietaryModifier: 'Балансирано',
    weeklyScheme: {
      monday: { ...day },
      tuesday: { ...day, mealBreakdown: day.mealBreakdown.map(m => ({ ...m })) },
      wednesday: { ...day, mealBreakdown: day.mealBreakdown.map(m => ({ ...m })) },
      thursday: { ...day, mealBreakdown: day.mealBreakdown.map(m => ({ ...m })) },
      friday: { ...day, mealBreakdown: day.mealBreakdown.map(m => ({ ...m })) },
      saturday: { ...day, mealBreakdown: day.mealBreakdown.map(m => ({ ...m })) },
      sunday: { ...day, mealBreakdown: day.mealBreakdown.map(m => ({ ...m })) },
    },
  };
}

const strategy = makeStrategy({ meals: 5, dailyKcal: 2100 });
const userData = { dietPreference: ['Балансирано'], eatingHabits: [] };

const chunk = await buildDeterministicWeekPlanChunk({
  strategy,
  userData,
  startDay: 1,
  endDay: 7,
  seed: 42,
});

ok(Object.keys(chunk).length === 7, '7 days generated');
ok(chunk.day1?.meals?.length === 5, '5 meals on day1');

let catalogOk = true;
let hasDescriptions = true;
for (let d = 1; d <= 7; d++) {
  for (const meal of chunk[`day${d}`]?.meals || []) {
    if (meal.type === 'Свободно хранене') continue;
    if (!meal.description && meal.type !== 'Свободно хранене') {
      if (meal.type !== 'Напитка') hasDescriptions = false;
    }
    const names = parseMealDescription(meal.description).map(i => i.name);
    const bad = validateProductNamesInCatalog(names);
    if (bad.length) {
      catalogOk = false;
      console.error(`  catalog miss day${d} ${meal.type}:`, bad.join(', '));
    }
  }
}
ok(hasDescriptions, 'meals have descriptions (except free slot)');
ok(catalogOk, 'all products resolve in catalog');

const weekPlan = JSON.parse(JSON.stringify(chunk));
const sync = syncWeekPlanNutritionFromDatabase(weekPlan, strategy, 1, 7);
ok(sync.unknowns.filter(u => u !== 'no-parsed-items').length === 0, `no unknown products (${sync.unknowns.length} flags)`);
ok(sync.infeasible.length <= 4, `infeasible slots <= 4 (${sync.infeasible.length})`);

// Схемата е договорът: Step 3 строи слотовете, които тя съдържа. Закуската на
// клиент, който не закусва, се маха в схемата (`removeBreakfastSlotFromDay`),
// а не втори път тук — иначе се изтриваше и лекото първо хранене, върнато
// когато денят не се събира без него.
const skipUser = { eatingHabits: ['Не закусвам'] };
const skipStrategy = makeStrategy({ meals: 4, dailyKcal: 2000 });
for (const key of Object.keys(skipStrategy.weeklyScheme)) {
  removeBreakfastSlotFromDay(skipStrategy.weeklyScheme[key]);
}
const skipChunk = await buildDeterministicWeekPlanChunk({
  strategy: skipStrategy,
  userData: skipUser,
  startDay: 1,
  endDay: 1,
  seed: 7,
});
ok(userSkipsBreakfast(skipUser), 'skip breakfast fixture');
ok(!skipChunk.day1.meals.some(m => m.type === 'Хранене 1'), 'no H1 when skipping breakfast');

// Висок калораж без закуска: таваните на обяда, следобедната закуска, вечерята
// и вечерния снак събират 2432 kcal. Денят от 2900 не се събира в тях, затова
// схемата връща леко първо хранене — и то трябва да стигне до плана.
const bigSkipUser = { eatingHabits: ['Не закусвам'] };
const bigSkipStrategy = buildDeterministicStrategy({
  userData: bigSkipUser,
  analysis: { Final_Calories: 2900, recommendedCalories: 2900, macroGrams: { protein: 218, carbs: 325, fats: 81 } },
});
const bigDay = bigSkipStrategy.weeklyScheme.monday;
const firstMeal = bigDay.mealBreakdown.find(m => m.type === 'Хранене 1');
ok(!!firstMeal, 'high-kcal skip-breakfast day gets a light first meal');
ok(firstMeal ? firstMeal.calories < 600 : false,
  `restored first meal stays light (${firstMeal?.calories} kcal)`);
ok(bigDay.mealBreakdown.every(m => m.calories <= 950),
  `no slot above what a real dish carries (${bigDay.mealBreakdown.map(m => m.calories).join('/')})`);
const bigChunk = await buildDeterministicWeekPlanChunk({
  strategy: bigSkipStrategy, userData: bigSkipUser, startDay: 1, endDay: 1, seed: 7,
});
ok(bigChunk.day1.meals.some(m => m.type === 'Хранене 1'),
  'restored first meal reaches the plan');

const veganChunk = await buildDeterministicWeekPlanChunk({
  strategy: makeStrategy({ meals: 5, dailyKcal: 1900 }),
  userData: { dietPreference: ['Веган'] },
  startDay: 1,
  endDay: 1,
  seed: 3,
});
const veganText = JSON.stringify(veganChunk.day1).toLowerCase();
ok(!/пилешк|сьомга|кисело мляко|скир|извара/.test(veganText), 'vegan day avoids animal products');

console.log('\n=== sample day1 ===');
console.log(JSON.stringify(chunk.day1.meals.map(m => ({
  type: m.type, name: m.name, description: m.description?.split('\n').slice(0, 3),
})), null, 2));

console.log(`\n=== step3 deterministic: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
