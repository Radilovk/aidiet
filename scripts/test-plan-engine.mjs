#!/usr/bin/env node
import {
  resolvePlanEngine,
  isPlanEngineV2,
  step3AllowsFullChunkAiFallback,
  buildPlanEngineMeta,
  DEFAULT_PLAN_ENGINE,
  PLAN_ENGINE_VERSION,
} from '../plan-engine.js';
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { MEAL_DISHES } from '../meal-dishes.js';
import { inferDishTags } from '../dish-tags.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(DEFAULT_PLAN_ENGINE === 'v2', 'DEFAULT_PLAN_ENGINE is v2');
ok(resolvePlanEngine({}) === 'v2', 'default engine is v2');
ok(resolvePlanEngine({ PLAN_ENGINE: 'v1' }) === 'v1', 'PLAN_ENGINE=v1 legacy opt-out');
ok(resolvePlanEngine({ PLAN_ENGINE: 'v2' }) === 'v2', 'PLAN_ENGINE=v2');
ok(resolvePlanEngine({ PLAN_ENGINE: 'dish' }) === 'v2', 'PLAN_ENGINE=dish alias');
ok(isPlanEngineV2({}), 'isPlanEngineV2 on default');
ok(!step3AllowsFullChunkAiFallback({}), 'default v2 blocks full-chunk AI fallback');
ok(step3AllowsFullChunkAiFallback({ PLAN_ENGINE: 'v1' }), 'v1 allows full-chunk AI fallback');

const meta = buildPlanEngineMeta(
  { _deterministicEnergy: true },
  { _deterministicCore: true },
  { step3Engine: 'deterministic_relaxed', planEngine: 'v2', slotRepairCalls: 1, generationWarnings: ['a'] },
);
ok(meta.planEngine === 'v2', 'meta.planEngine');
ok(meta.step3Engine === 'deterministic_relaxed', 'meta.step3Engine');
ok(meta.slotRepairCalls === 1, 'meta.slotRepairCalls');
ok(meta.dishCatalogCount === MEAL_DISHES.length, 'meta.dishCatalogCount');
ok(meta.planEngineVersion === PLAN_ENGINE_VERSION, 'meta.planEngineVersion');
ok(meta.generationWarningsCount === 1, 'meta.generationWarningsCount');

function makeStrategy() {
  const dailyKcal = 2000;
  const types = ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4'];
  const weights = [0.25, 0.35, 0.15, 0.25];
  const mealBreakdown = types.map((type, i) => {
    const kcal = Math.round(dailyKcal * weights[i]);
    return { type, calories: kcal, protein: 30, carbs: 40, fats: 15 };
  });
  const day = { meals: 4, calories: dailyKcal, protein: 120, carbs: 160, fats: 60, mealBreakdown };
  return {
    dietaryModifier: 'Балансирано',
    weeklyScheme: Object.fromEntries(
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(k => [k, { ...day }]),
    ),
  };
}

const relaxed = await buildDeterministicWeekPlanChunk({
  strategy: makeStrategy(),
  userData: { eatingHabits: ['Не закусвам'] },
  startDay: 1,
  endDay: 1,
  seed: 99,
  relaxed: true,
});
ok(relaxed.day1?.meals?.length >= 3, 'relaxed mode builds skip-breakfast day');

const fullWeek = await buildDeterministicWeekPlanChunk({
  strategy: makeStrategy(),
  userData: { dietPreference: ['Балансирано'] },
  startDay: 1,
  endDay: 7,
  seed: 11,
});
const mainDishes = new Set();
const repeatedSameDay = [];
for (let d = 1; d <= 7; d++) {
  const names = new Set();
  for (const meal of fullWeek[`day${d}`]?.meals || []) {
    if (!['Хранене 1', 'Хранене 2', 'Хранене 4'].includes(meal.type)) continue;
    const n = (meal.name || '').toLowerCase().trim();
    if (!n) continue;
    mainDishes.add(n);
    if (names.has(n)) repeatedSameDay.push(`day${d}:${n}`);
    names.add(n);
  }
}
ok(repeatedSameDay.length === 0, 'no duplicate main dish within a day');
ok(mainDishes.size >= 4, `at least 4 unique main dishes/week (${mainDishes.size})`);

const ketoWeek = await buildDeterministicWeekPlanChunk({
  strategy: { ...makeStrategy(), dietaryModifier: 'Кетогенна' },
  userData: { dietPreference: ['Кетогенна'] },
  startDay: 1,
  endDay: 3,
  seed: 22,
});
let ketoOk = true;
for (let d = 1; d <= 3; d++) {
  for (const meal of ketoWeek[`day${d}`]?.meals || []) {
    if (meal.type !== 'Хранене 2' && meal.type !== 'Хранене 4') continue;
    const entry = MEAL_DISHES.find(x => x.id === meal.dishId);
    const tags = entry ? inferDishTags(entry) : [];
    if (!tags.includes('low_carb')) ketoOk = false;
  }
}
ok(ketoOk, 'keto plan uses low_carb main dishes');

console.log(`\n=== plan-engine: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
