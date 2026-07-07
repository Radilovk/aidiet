/**
 * Offline, deterministic test of the backend macro-repair engine — no AI, no network.
 * Reproduces the exact failing case observed in production: AI picks a protein-only
 * breakfast (Омлет + zeleнчуци) against a target that needs a real carb source, and
 * verifies the matching-pursuit repair (food-nutrition.js) auto-fixes it, plus that
 * the new percentage tolerances (±5% kcal / ±10% macro) behave as intended.
 */
import {
  parseMealDescription,
  lookupFoodProfile,
  balanceItemsToMacroTargets,
  repairItemsToTolerance,
  sumItemNutrition,
  calorieTolerance,
  macroTolerance,
} from './food-nutrition.js';
import { getRepairCandidatesForMeal } from './food-catalog.js';

function runCase(name, { description, target, mealType, dietaryModifier = 'Балансирано' }) {
  console.log(`\n=== ${name} ===`);
  console.log(`Target: ${target.calories}kcal P${target.protein}/C${target.carbs}/F${target.fats}`);
  console.log(`AI избор: ${description.replace(/\n/g, ' | ')}`);

  let items = parseMealDescription(description).map(item => {
    const { profile, key, unknown } = lookupFoodProfile(item.name);
    return { ...item, profile, key, unknown };
  });

  const balancedOnly = balanceItemsToMacroTargets(items, target);
  const beforeTotals = sumItemNutrition(balancedOnly);
  const beforeKcal = Math.round(beforeTotals.p * 4 + beforeTotals.c * 4 + beforeTotals.f * 9);
  console.log(`Само balance (без repair): ${beforeKcal}kcal P${Math.round(beforeTotals.p)}/C${Math.round(beforeTotals.c)}/F${Math.round(beforeTotals.f)}`);

  const pool = getRepairCandidatesForMeal(mealType, dietaryModifier, []);
  const repair = repairItemsToTolerance(balancedOnly, target, null, pool);
  const afterTotals = sumItemNutrition(repair.items);
  const afterKcal = Math.round(afterTotals.p * 4 + afterTotals.c * 4 + afterTotals.f * 9);
  console.log(`След repair (added=${repair.addedCount}): ${afterKcal}kcal P${Math.round(afterTotals.p)}/C${Math.round(afterTotals.c)}/F${Math.round(afterTotals.f)}`);
  console.log('Финален избор:', repair.items.map(i => `${i.name} ${i.grams}g`).join(', '));

  const kcalTol = calorieTolerance(target.calories);
  const pTol = macroTolerance(target.protein);
  const cTol = macroTolerance(target.carbs);
  const fTol = macroTolerance(target.fats);

  const checks = [
    ['kcal', Math.abs(afterKcal - target.calories), kcalTol],
    ['protein', Math.abs(afterTotals.p - target.protein), pTol],
    ['carbs', Math.abs(afterTotals.c - target.carbs), cTol],
    ['fats', Math.abs(afterTotals.f - target.fats), fTol],
  ];

  let allPass = true;
  for (const [label, diff, tol] of checks) {
    const pass = diff <= tol;
    if (!pass) allPass = false;
    console.log(`  ${pass ? '✓' : '✗'} ${label}: diff=${diff.toFixed(1)} tolerance=±${tol}`);
  }
  console.log(allPass ? '✓ РЕЗУЛТАТ: В толеранс' : '✗ РЕЗУЛТАТ: Извън толеранс');
  return allPass;
}

console.log('=== Тест на repair engine (офлайн, детерминистичен) ===');

const results = [];

// Exact production failure: protein-heavy breakfast, zero carb source, target needs C40.
results.push(runCase('Закуска без въглехидратен източник (реален production случай)', {
  mealType: 'Хранене 1',
  description: '• Омлет 200g\n• Домат 100g\n• Краставица 100g',
  target: { calories: 450, protein: 35, carbs: 40, fats: 18 },
}));

// Vegan case: legume-only meal missing a fat source.
results.push(runCase('Веган обяд без достатъчно мазнини', {
  mealType: 'Хранене 2',
  dietaryModifier: 'Веган',
  description: '• Леща 150g\n• Домат 100g',
  target: { calories: 550, protein: 28, carbs: 70, fats: 20 },
}));

// Late snack: only fat+protein allowed, AI picks a single small item that undershoots everything.
results.push(runCase('Хранене 5 недостатъчно количество', {
  mealType: 'Хранене 5',
  description: '• Ядки 10g',
  target: { calories: 180, protein: 10, carbs: 5, fats: 15 },
}));

// Control: already-adequate item set should NOT be modified by repair (repaired=false).
console.log('\n=== Контролен случай: адекватен избор не се пипа ===');
{
  const target = { calories: 600, protein: 40, carbs: 55, fats: 25 };
  let items = parseMealDescription('• Пилешки гърди 150g\n• Ориз 150g\n• Броколи 150g\n• Зехтин 10g').map(item => {
    const { profile, key, unknown } = lookupFoodProfile(item.name);
    return { ...item, profile, key, unknown };
  });
  const balanced = balanceItemsToMacroTargets(items, target);
  const pool = getRepairCandidatesForMeal('Хранене 2', 'Балансирано', []);
  const repair = repairItemsToTolerance(balanced, target, null, pool);
  console.log(`addedCount=${repair.addedCount} (очаквано 0, вече е адекватно)`);
  results.push(repair.addedCount === 0);
}

const passed = results.filter(Boolean).length;
console.log(`\n=== Обобщение: ${passed}/${results.length} PASS ===`);
process.exit(passed === results.length ? 0 : 1);
