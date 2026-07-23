#!/usr/bin/env node
import {
  enforceWeekendFreeDay,
  normalizeStrategyDessertFlag,
  normalizeWeeklyScheme,
  injectFixedDesserts,
  recalculateDayCalories,
  FIXED_DESSERT,
  FIXED_DESSERT_WEIGHT_GRAMS,
  MEAL_TYPE_ALIASES,
  normalizeMealTypesInWeekPlan,
} from '../../../plan-pipeline-pure.js';

const results = [];
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

console.log('-- Scheme sync / free meal / dessert --');

{
  const strategy = { freeDayNumber: 3 };
  enforceWeekendFreeDay(strategy);
  check('weekday freeDay → 7 (неделя)', strategy.freeDayNumber === 7);
  strategy.freeDayNumber = 6;
  enforceWeekendFreeDay(strategy);
  check('събота остава 6', strategy.freeDayNumber === 6);
  strategy.freeDayNumber = null;
  enforceWeekendFreeDay(strategy);
  check('null freeDay непроменен', strategy.freeDayNumber === null);
}

{
  const s1 = {};
  normalizeStrategyDessertFlag(s1, { foodCravings: ['Сладко'] });
  check('dessert default true при Сладко', s1.includeDessert === true);
  const s2 = {};
  normalizeStrategyDessertFlag(s2, { foodCravings: ['Сладко'], medicalConditions: ['Диабет'] });
  check('dessert false при диабет', s2.includeDessert === false);
  const s3 = { includeDessert: false };
  normalizeStrategyDessertFlag(s3, { foodCravings: ['Сладко'] });
  check('explicit includeDessert се запазва', s3.includeDessert === false);
  const s4 = {};
  normalizeStrategyDessertFlag(s4, { foodCravings: ['Солено'] });
  check('без Сладко → includeDessert false', s4.includeDessert === false);
}

{
  const strategy = {
    weeklyScheme: {
      monday: {
        calories: 1800,
        mealBreakdown: [
          { type: 'Закуска', calories: 400, protein: 30, carbs: 40, fats: 12 },
          { type: 'Обяд', calories: 600, protein: 40, carbs: 50, fats: 20 },
          { type: 'Вечеря', calories: 500, protein: 35, carbs: 40, fats: 15 },
        ],
      },
      tuesday: { mealBreakdown: [] },
      wednesday: { mealBreakdown: [] },
      thursday: { mealBreakdown: [] },
      friday: { mealBreakdown: [] },
      saturday: { mealBreakdown: [] },
      sunday: { mealBreakdown: [] },
    },
  };
  normalizeWeeklyScheme(strategy, 1800);
  const mon = strategy.weeklyScheme.monday;
  check('alias Закуска→Хранене 1', mon.mealBreakdown[0].type === 'Хранене 1');
  check('alias Обяд→Хранене 2', mon.mealBreakdown[1].type === 'Хранене 2');
  check('meals = breakdown.length', mon.meals === 3);
  const sum = mon.mealBreakdown.reduce((s, m) => s + m.calories, 0);
  check('схема сума ≈ дневни калории', Math.abs(sum - 1800) <= 50, `sum=${sum}`);
}

{
  const weekPlan = {
    day1: {
      meals: [
        { type: 'Хранене 2', name: 'Обяд', weight: '350г', dessert: true, macros: { protein: 40, carbs: 45, fats: 18 } },
      ],
    },
  };
  injectFixedDesserts(weekPlan);
  const meal = weekPlan.day1.meals[0];
  check('dessert boolean → FIXED_DESSERT object', meal.dessert?.name === FIXED_DESSERT.name);
  check('dessert calories 168', meal.dessert.calories === 168);
  const w = parseFloat(String(meal.weight).match(/(\d+)/)?.[1] || '0');
  check('weight += dessert grams', w === 350 + FIXED_DESSERT_WEIGHT_GRAMS, `weight=${meal.weight}`);
}

{
  const strategy = {
    weeklyScheme: {
      saturday: {
        calories: 2000,
        mealBreakdown: [
          { type: 'Хранене 1', calories: 400, protein: 30, carbs: 35, fats: 12 },
          { type: 'Свободно хранене', calories: 700, protein: 0, carbs: 0, fats: 0 },
          { type: 'Хранене 4', calories: 450, protein: 35, carbs: 20, fats: 18 },
        ],
      },
      monday: {}, tuesday: {}, wednesday: {}, thursday: {}, friday: {}, sunday: {},
    },
    freeDayNumber: 6,
  };
  const weekPlan = {
    day6: {
      meals: [
        { type: 'Хранене 1', macros: { protein: 30, carbs: 35, fats: 12 } },
        { type: 'Свободно хранене', name: 'Свободно хранене' },
        { type: 'Хранене 4', macros: { protein: 35, carbs: 20, fats: 18 } },
      ],
    },
  };
  recalculateDayCalories(weekPlan, strategy);
  const totals = weekPlan.day6.dailyTotals;
  const meal1 = 30 * 4 + 35 * 4 + 12 * 9;
  const meal4 = 35 * 4 + 20 * 4 + 18 * 9;
  check('free meal slot включен в dailyTotals', totals.calories === meal1 + 700 + meal4, `totals=${totals.calories}`);
  check('_plannedCalories на свободното', weekPlan.day6.meals[1]._plannedCalories === 700);
}

{
  check('MEAL_TYPE_ALIASES Вечеря', MEAL_TYPE_ALIASES['Вечеря'] === 'Хранене 4');
  const wp = { day1: { meals: [{ type: 'Обяд', name: 'x' }, { type: 'Хранене 2', name: 'Свободно хранене' }] } };
  normalizeMealTypesInWeekPlan(wp);
  check('normalize: Обяд→Хранене 2', wp.day1.meals[0].type === 'Хранене 2');
  check('normalize: name свободно→type', wp.day1.meals[1].type === 'Свободно хранене');
}

const passed = results.filter(Boolean).length;
console.log(`\nscheme-sync: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
