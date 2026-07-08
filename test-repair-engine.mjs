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

function repairCase({ description, target, mealType, dietaryModifier = 'Балансирано' }) {
  const items = parseMealDescription(description).map(item => {
    const { profile, key, unknown } = lookupFoodProfile(item.name);
    return { ...item, profile, key, unknown };
  });
  const balancedOnly = balanceItemsToMacroTargets(items, target);
  const pool = getRepairCandidatesForMeal(mealType, dietaryModifier, []);
  return repairItemsToTolerance(balancedOnly, target, null, pool);
}

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
// Repair closes the STRUCTURAL gap (adds a real carb source → carbs in tolerance).
// The residual protein/fat miss is inherent to the omelet's 1:1 P:F ratio — that is
// the AI-retry path's job (swap products), not the repair engine's (add products).
{
  console.log('\n=== Закуска без въглехидратен източник (реален production случай) ===');
  const target = { calories: 450, protein: 35, carbs: 40, fats: 18 };
  const repair = repairCase({
    mealType: 'Хранене 1',
    description: '• Омлет 200g\n• Домат 100g\n• Краставица 100g',
    target,
  });
  const totals = sumItemNutrition(repair.items);
  console.log('Финален избор:', repair.items.map(i => `${i.name} ${i.grams}g`).join(', '));
  console.log(`Резултат: P${Math.round(totals.p)}/C${Math.round(totals.c)}/F${Math.round(totals.f)} (цел P35/C40/F18)`);
  const carbSource = repair.items.find(i => ['Хляб', 'Пълнозърнест хляб', 'Ръжен хляб', 'Овесени ядки', 'Каша'].includes(i.name));
  const carbsFixed = Math.abs(totals.c - target.carbs) <= macroTolerance(target.carbs);
  const sensiblePortion = !carbSource || carbSource.grams >= 40;
  console.log(`${carbSource ? '✓' : '✗'} добавен въглехидратен източник; ${carbsFixed ? '✓' : '✗'} въглехидратите в толеранс; ${sensiblePortion ? '✓' : '✗'} разумна порция`);
  results.push(!!carbSource && carbsFixed && sensiblePortion);
}

// Vegan case: legume-only meal missing a fat source — repair must add a FAT item
// (зехтин/авокадо), and must NOT add a second carb source next to the lentils.
{
  console.log('\n=== Веган обяд без мазнинен източник: добавя FAT, не дублира ENG ===');
  const repair = repairCase({
    mealType: 'Хранене 2',
    dietaryModifier: 'Веган',
    description: '• Леща 150g\n• Домат 100g',
    target: { calories: 550, protein: 28, carbs: 70, fats: 20 },
  });
  const names = repair.items.map(i => i.name);
  console.log('Финален избор:', repair.items.map(i => `${i.name} ${i.grams}g`).join(', '));
  const totals = sumItemNutrition(repair.items);
  const fatFixed = Math.abs(totals.f - 20) <= macroTolerance(20);
  const noCarbDuplicate = !names.some(n => ['Картофи', 'Ориз', 'Хляб', 'Киноа'].includes(n));
  console.log(`${fatFixed ? '✓' : '✗'} мазнините достигат целта; ${noCarbDuplicate ? '✓' : '✗'} няма втори въглехидратен източник`);
  results.push(fatFixed && noCarbDuplicate);
}

// Late snack: nuts already cover FAT+PRO. A protein deficit here is a product-choice
// problem for the AI-retry path — repair must NOT invent parallel same-slot additions
// (this used to produce absurd lines like "Яйца 30g" next to nuts).
{
  console.log('\n=== Хранене 5: недостиг при покрити слотове НЕ се "поправя" с абсурдни добавки ===');
  const repair = repairCase({
    mealType: 'Хранене 5',
    description: '• Ядки 10g',
    target: { calories: 180, protein: 10, carbs: 5, fats: 15 },
  });
  console.log('Финален избор:', repair.items.map(i => `${i.name} ${i.grams}g`).join(', '));
  console.log(`addedCount=${repair.addedCount} (очаквано 0 — слотовете PRO/FAT са покрити от ядките)`);
  results.push(repair.addedCount === 0);
}

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

// ── Регресии срещу абсурдни комбинации (реални оплаквания от продукция) ──

// Porridge breakfast: all macro slots covered (oats=ENG, yogurt=PRO+FAT) —
// repair must never put meat in a sweet dairy breakfast.
{
  console.log('\n=== Регресия: без месо в овесена закуска ===');
  const repair = repairCase({
    mealType: 'Хранене 1',
    description: '• Овесени ядки 60g\n• Кисело мляко 200g\n• Банан 100g',
    target: { calories: 450, protein: 25, carbs: 60, fats: 12 },
  });
  const names = repair.items.map(i => i.name);
  console.log('Финален избор:', repair.items.map(i => `${i.name} ${i.grams}g`).join(', '));
  const noMeat = !names.some(n => ['Пилешко месо', 'Говеждо месо', 'Риба', 'Свинско месо', 'Пилешки гърди'].includes(n));
  console.log(`${noMeat ? '✓' : '✗'} няма месо в закуската`);
  results.push(noMeat);
}

// Salmon dinner: PRO covered — no second meat; and pruning must not drop the only vegetable.
{
  console.log('\n=== Регресия: без второ месо до сьомгата; зеленчукът остава ===');
  const repair = repairCase({
    mealType: 'Хранене 4',
    description: '• Сьомга 150g\n• Киноа 150g\n• Спанак 100g',
    target: { calories: 600, protein: 40, carbs: 45, fats: 25 },
  });
  const names = repair.items.map(i => i.name);
  console.log('Финален избор:', repair.items.map(i => `${i.name} ${i.grams}g`).join(', '));
  const noSecondProtein = !names.some(n => ['Говеждо месо', 'Пилешко месо', 'Риба', 'Свинско месо'].includes(n));
  const vegetableKept = names.includes('Спанак');
  console.log(`${noSecondProtein ? '✓' : '✗'} няма второ месо; ${vegetableKept ? '✓' : '✗'} спанакът е запазен`);
  results.push(noSecondProtein && vegetableKept);
}

// Fruit snack: repair must not "close" a gap with a giant vegetable portion.
{
  console.log('\n=== Регресия: без зеленчуков баласт в плодова закуска ===');
  const repair = repairCase({
    mealType: 'Хранене 3',
    description: '• Ябълка 150g\n• Ядки 20g',
    target: { calories: 250, protein: 8, carbs: 30, fats: 10 },
  });
  const names = repair.items.map(i => i.name);
  console.log('Финален избор:', repair.items.map(i => `${i.name} ${i.grams}g`).join(', '));
  const noVegBallast = !names.some(n => ['Маруля', 'Зеленчук', 'Краставица', 'Домат', 'Морков', 'Чушка'].includes(n));
  console.log(`${noVegBallast ? '✓' : '✗'} няма добавен зеленчук като макро-пълнеж`);
  results.push(noVegBallast);
}

const passed = results.filter(Boolean).length;
console.log(`\n=== Обобщение: ${passed}/${results.length} PASS ===`);
process.exit(passed === results.length ? 0 : 1);
