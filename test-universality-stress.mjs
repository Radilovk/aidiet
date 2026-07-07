/**
 * Universality stress test — offline, deterministic, no AI/network.
 * Probes the catalog + repair engine against diverse diets, calorie ranges,
 * allergy combinations, and clinical protocols to find where the architecture
 * breaks (empty candidate pools, impossible targets, forbidden-food leakage).
 */
import { getRepairCandidatesForMeal, getCatalogCandidatesForChunk, validateProductNamesInCatalog } from './food-catalog.js';
import {
  parseMealDescription,
  lookupFoodProfile,
  balanceItemsToMacroTargets,
  repairItemsToTolerance,
  sumItemNutrition,
  calorieTolerance,
  macroTolerance,
} from './food-nutrition.js';

function checkTolerance(totals, target) {
  const kcal = Math.round(totals.p * 4 + totals.c * 4 + totals.f * 9);
  const checks = [
    ['kcal', Math.abs(kcal - target.calories), calorieTolerance(target.calories)],
    ['protein', Math.abs(totals.p - target.protein), macroTolerance(target.protein)],
    ['carbs', Math.abs(totals.c - target.carbs), macroTolerance(target.carbs)],
    ['fats', Math.abs(totals.f - target.fats), macroTolerance(target.fats)],
  ];
  return checks.every(([, diff, tol]) => diff <= tol);
}

function runScenario(name, { mealType, dietaryModifier, description, target, blockedTerms = [], clinicalProtocolId = null }) {
  const pool = getRepairCandidatesForMeal(mealType, dietaryModifier, blockedTerms, clinicalProtocolId);
  let items = parseMealDescription(description).map(item => {
    const { profile, key, unknown } = lookupFoodProfile(item.name);
    return { ...item, profile, key, unknown };
  });
  const unknownItems = items.filter(i => i.unknown).map(i => i.name);

  const balanced = balanceItemsToMacroTargets(items, target);
  const repair = repairItemsToTolerance(balanced, target, null, pool);
  const totals = sumItemNutrition(repair.items);
  const pass = checkTolerance(totals, target);

  const finalNames = repair.items.map(i => i.name);
  const forbidden = finalNames.filter(n => blockedTerms.some(t => n.toLowerCase().includes(t.toLowerCase())));

  console.log(`\n${pass && !forbidden.length && !unknownItems.length ? '✓' : '✗'} ${name}`);
  console.log(`  pool size: ${pool.length} candidates | target: ${target.calories}kcal P${target.protein}/C${target.carbs}/F${target.fats}`);
  console.log(`  final: ${finalNames.join(', ')}`);
  const kcal = Math.round(totals.p * 4 + totals.c * 4 + totals.f * 9);
  console.log(`  result: ${kcal}kcal P${totals.p.toFixed(1)}/C${totals.c.toFixed(1)}/F${totals.f.toFixed(1)}`);
  if (unknownItems.length) console.log(`  ⚠ unknown items: ${unknownItems.join(', ')}`);
  if (forbidden.length) console.log(`  ⚠ FORBIDDEN LEAKAGE: ${forbidden.join(', ')}`);
  if (!pool.length) console.log(`  ⚠ EMPTY CANDIDATE POOL — repair engine has nothing to work with!`);

  return pass && !forbidden.length && !unknownItems.length;
}

console.log('=== Universality stress test ===');
const results = [];

// 1. Keto: high-fat main meal — stresses GROUP_CAPS.fat=40g bottleneck
results.push(runScenario('Кето — обяд с висок процент мазнини', {
  mealType: 'Хранене 2',
  dietaryModifier: 'Кетогенна диета',
  description: '• Пилешко месо 100g',
  target: { calories: 700, protein: 40, carbs: 12, fats: 58 },
}));

// 2. Vegan + gluten-free combined — double restriction candidate shrinkage
results.push(runScenario('Веган + без глутен — вечеря', {
  mealType: 'Хранене 4',
  dietaryModifier: 'Веган без глутен',
  description: '• Тофу 100g',
  target: { calories: 550, protein: 30, carbs: 60, fats: 18 },
}));

// 3. Nut allergy on late snack (Хранене 5 catalog is nut-heavy by design)
results.push(runScenario('Алергия към ядки — Хранене 5 (обичайно ядки-базирано)', {
  mealType: 'Хранене 5',
  dietaryModifier: 'Балансирано',
  description: '• Кисело мляко 100g',
  target: { calories: 180, protein: 12, carbs: 8, fats: 12 },
  blockedTerms: ['ядки', 'бадеми', 'орехи', 'кашу', 'лешници', 'фъстъци', 'шамфъстък', 'тиквени семки', 'слънчогледови семки'],
}));

// 4a. AIP WITHOUT clinicalProtocolId — demonstrates the gap that existed before the fix
results.push(runScenario('AIP — БЕЗ protocolId (демонстрира стария пропуск)', {
  mealType: 'Хранене 1',
  dietaryModifier: 'Автоимунен протокол',
  description: '• Пилешко месо 100g',
  target: { calories: 450, protein: 30, carbs: 35, fats: 20 },
}));

// 4b. AIP WITH clinicalProtocolId — verifies the fix: no forbidden foods leak through
{
  const forbiddenAIP = ['яйца', 'мляко', 'сирене', 'кашкавал', 'извара', 'скир', 'кефир',
    'ядки', 'бадеми', 'орехи', 'кашу', 'лешници', 'фъстъци', 'домат', 'чушка', 'патладжан',
    'картофи', 'хляб', 'овес', 'паста', 'киноа', 'булгур', 'ориз', 'тофу', 'темпе', 'нахут', 'леща', 'боб'];
  const pool = getRepairCandidatesForMeal('Хранене 1', 'Автоимунен протокол', [], 'autoimmune_aip');
  const poolNames = pool.map(c => c.entry.name.toLowerCase());
  const leaked = poolNames.filter(n => forbiddenAIP.some(f => n.includes(f)));
  console.log(`\n${leaked.length ? '✗' : '✓'} AIP — С protocolId (проверка на fix-а)`);
  console.log(`  pool size: ${pool.length} candidates (изключени: dairy, legume, яйца, ядки/семена, нощни зеленчуци, зърнени)`);
  console.log(`  pool: ${pool.map(c => c.entry.name).join(', ')}`);
  if (leaked.length) console.log(`  ⚠ FORBIDDEN LEAKAGE IN POOL: ${leaked.join(', ')}`);
  results.push(!leaked.length && pool.length > 0);
}

// 5. Very low calorie meal (aggressive deficit)
results.push(runScenario('Много ниска калорийна цел — закуска', {
  mealType: 'Хранене 1',
  dietaryModifier: 'Балансирано',
  description: '• Кисело мляко 50g',
  target: { calories: 220, protein: 18, carbs: 20, fats: 7 },
}));

// 6. Very high calorie meal (bulking, near the 800kcal/meal ceiling)
results.push(runScenario('Много висока калорийна цел — вечеря (bulking)', {
  mealType: 'Хранене 4',
  dietaryModifier: 'Балансирано',
  description: '• Говеждо месо 100g',
  target: { calories: 780, protein: 65, carbs: 75, fats: 24 },
}));

// 7. High protein bodybuilding lunch
results.push(runScenario('Висок протеин — обяд за мускулна маса', {
  mealType: 'Хранене 2',
  dietaryModifier: 'Високопротеинова диета',
  description: '• Пилешки гърди 100g',
  target: { calories: 650, protein: 70, carbs: 55, fats: 15 },
}));

// 8. Pescatarian + dairy-free (lactose intolerance) combined
results.push(runScenario('Пескетарианец + без млечни — обяд', {
  mealType: 'Хранене 2',
  dietaryModifier: 'Пескетарианска диета',
  description: '• Риба 100g',
  target: { calories: 600, protein: 45, carbs: 50, fats: 22 },
  blockedTerms: ['мляко', 'кисело мляко', 'сирене', 'кашкавал', 'извара', 'скир', 'кефир', 'рикота'],
}));

console.log(`\n=== Обобщение: ${results.filter(Boolean).length}/${results.length} PASS (без теч на забранени храни / празен пул / неразпознати продукти) ===`);
process.exit(results.every(Boolean) ? 0 : 1);
