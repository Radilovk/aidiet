#!/usr/bin/env node
import {
  validateMealsAgainstScheme,
  applyFoodSubstitutions,
  macrosToCalories,
} from '../../../plan-pipeline-pure.js';
import { applyMealNutritionFromDatabase, calorieTolerance } from '../../../food-nutrition.js';

const results = [];
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

console.log('-- Meal validation / substitutions --');

const dayTarget = {
  mealBreakdown: [
    { type: 'Хранене 2', calories: 600, protein: 40, carbs: 50, fats: 20 },
  ],
};

{
  const errors = validateMealsAgainstScheme(
    { meals: [{ type: 'Хранене 2', name: 'x', description: 'пилешко без грамажи' }] },
    dayTarget,
    1
  );
  check('липсващи грамажи → error', errors.some(e => e.includes('грамажи')));
}

{
  const meal = {
    type: 'Хранене 2',
    name: 'Пилешко с ориз',
    description: '• Пилешки гърди 150g\n• Ориз 150g\n• Домат 100g\n• Зехтин 10g',
  };
  applyMealNutritionFromDatabase(meal, dayTarget.mealBreakdown[0]);
  const errors = validateMealsAgainstScheme({ meals: [meal] }, dayTarget, 1);
  check('типично хранене минава валидация', errors.length === 0, errors.join('; '));
  check('kcal в толеранс след scaling', Math.abs(meal.calories - 600) <= calorieTolerance(600), `kcal=${meal.calories}`);
}

{
  const meal = {
    type: 'Хранене 2',
    name: 'Митология',
    description: '• Драконово месо 200g\n• Ориз 100g',
    calories: 500,
    macros: { protein: 40, carbs: 30, fats: 15 },
  };
  const errors = validateMealsAgainstScheme({ meals: [meal] }, dayTarget, 1);
  check('непознат продукт → catalog error', errors.some(e => e.includes('каталога')));
}

{
  const meal = {
    type: 'Хранене 2',
    name: 'Яйца AIP',
    description: '• Яйца 120g\n• Домат 100g',
    calories: 300,
    macros: { protein: 20, carbs: 10, fats: 15 },
  };
  const errors = validateMealsAgainstScheme({ meals: [meal] }, dayTarget, 1, 'autoimmune_aip');
  check('AIP + яйца/домат → protocol error', errors.some(e => e.includes('протокол') || e.includes('забранени')));
}

{
  const meal = {
    type: 'Свободно хранене',
    name: 'Свободно хранене',
  };
  const errors = validateMealsAgainstScheme({ meals: [meal] }, {
    mealBreakdown: [{ type: 'Свободно хранене', calories: 700, protein: 0, carbs: 0, fats: 0 }],
  }, 6);
  check('свободно хранене skip валидация', errors.length === 0);
}

{
  const meal = {
    type: 'Хранене 2',
    name: 'Грешни макроси',
    description: '• Пилешки гърди 150g\n• Ориз 80g',
    calories: 900,
    macros: { protein: 10, carbs: 10, fats: 10 },
  };
  const errors = validateMealsAgainstScheme({ meals: [meal] }, dayTarget, 1);
  check('калории далеч от схема → error', errors.some(e => e.includes('калории')));
}

{
  const meal = { name: 'Грах с риба', description: '• грах 100g\n• риба 150g' };
  const applied = applyFoodSubstitutions(meal, [
    { detect: 'грах', replace: 'броколи' },
  ]);
  check('substitution грах→броколи', applied.length === 1 && meal.description.includes('броколи'));
}

{
  check('macrosToCalories P10 C10 F10 = 170', macrosToCalories({ protein: 10, carbs: 10, fats: 10 }) === 170);
}

const passed = results.filter(Boolean).length;
console.log(`\nmeal-validation: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
