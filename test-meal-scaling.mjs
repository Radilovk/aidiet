/**
 * Offline, deterministic test of the simplified meal nutrition pipeline — no AI, no network.
 *
 * Contract under test (food-nutrition.js):
 *   1. The AI's composition is preserved: same products, same ratios — the backend
 *      never adds, removes, or substitutes products.
 *   2. Calories are backend arithmetic: one shared scale factor + 10g rounding nudges
 *      land the meal on its calorie target (within calorieTolerance).
 *   3. The single bounded protein lever moves protein drivers at most ±20%.
 *   4. Written macros/kcal are always consistent with the written grams.
 *   5. Pathological compositions are capped (×0.5–×3), not blown into absurd plates.
 */
import {
  parseMealDescription,
  lookupFoodProfile,
  applyMealNutritionFromDatabase,
  adjustProteinItemsTowardTarget,
  scaleItemsToTargetCalories,
  sumItemNutrition,
  calorieTolerance,
  nutritionFromGrams,
  SCALE_FACTOR_MAX,
} from './food-nutrition.js';

const results = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

const TYPICAL_MEALS = [
  { type: 'Хранене 1', description: '• Овесени ядки 60g\n• Кисело мляко 200g\n• Банан 100g', target: { calories: 450, protein: 25, carbs: 60, fats: 12 } },
  { type: 'Хранене 2', description: '• Пилешки гърди 150g\n• Ориз 150g\n• Домат 100g\n• Зехтин 10g', target: { calories: 650, protein: 45, carbs: 70, fats: 18 } },
  { type: 'Хранене 3', description: '• Ябълка 150g\n• Ядки 20g', target: { calories: 250, protein: 8, carbs: 30, fats: 10 } },
  { type: 'Хранене 4', description: '• Риба 200g\n• Броколи 200g\n• Зехтин 10g', target: { calories: 500, protein: 40, carbs: 30, fats: 20 } },
  { type: 'Хранене 4', description: '• Сьомга 150g\n• Киноа 150g\n• Спанак 100g', target: { calories: 600, protein: 40, carbs: 45, fats: 25 } },
  { type: 'Хранене 5', description: '• Извара 150g', target: { calories: 200, protein: 20, carbs: 8, fats: 8 } },
];

console.log('=== 1+2. Типични хранения: съставът се запазва, калориите се уцелват ===');
for (const m of TYPICAL_MEALS) {
  const originalNames = parseMealDescription(m.description).map(i => i.name);
  const meal = { type: m.type, description: m.description };
  const res = applyMealNutritionFromDatabase(meal, m.target);
  const finalItems = parseMealDescription(meal.description);
  const finalNames = finalItems.map(i => i.name);

  const sameComposition = originalNames.length === finalNames.length
    && originalNames.every((n, i) => n === finalNames[i]);
  const kcalDiff = Math.abs(meal.calories - m.target.calories);
  const kcalOk = kcalDiff <= calorieTolerance(m.target.calories);

  console.log(`  ${meal.description.replaceAll('\n', ' | ')}`);
  console.log(`  → ${meal.calories}kcal (цел ${m.target.calories}) P${meal.macros.protein}/C${meal.macros.carbs}/F${meal.macros.fats} (цел P${m.target.protein}/C${m.target.carbs}/F${m.target.fats})`);
  check(`състав непокътнат (${m.type})`, res.ok && sameComposition,
    sameComposition ? '' : `${originalNames.join(',')} → ${finalNames.join(',')}`);
  check(`калории в толеранс (${m.type})`, kcalOk, `diff=${kcalDiff} tol=±${calorieTolerance(m.target.calories)}`);
}

console.log('\n=== 3. Протеинов лост: ограничен до ±20% и само върху протеинови продукти ===');
{
  const items = parseMealDescription('• Пилешки гърди 100g\n• Ориз 150g\n• Домат 100g')
    .map(i => ({ ...i, ...lookupFoodProfile(i.name) }));
  // Deficit far beyond the lever's range: chicken must stop at exactly +20%.
  const adjusted = adjustProteinItemsTowardTarget(items, 80);
  const chicken = adjusted.find(i => i.name === 'Пилешки гърди');
  const rice = adjusted.find(i => i.name === 'Ориз');
  const tomato = adjusted.find(i => i.name === 'Домат');
  check('протеиновият продукт е увеличен точно с 20%', chicken.grams === 120, `100g → ${chicken.grams}g`);
  check('непротеиновите продукти не са пипнати', rice.grams === 150 && tomato.grams === 100);

  const down = adjustProteinItemsTowardTarget(items, 10);
  const chickenDown = down.find(i => i.name === 'Пилешки гърди');
  check('надолу също е ограничен до −20%', chickenDown.grams === 80, `100g → ${chickenDown.grams}g`);
}

console.log('\n=== 4. Записаните macros/kcal винаги отговарят на записаните грамажи ===');
{
  let allConsistent = true;
  for (const m of TYPICAL_MEALS) {
    const meal = { type: m.type, description: m.description };
    applyMealNutritionFromDatabase(meal, m.target);
    const recomputed = sumItemNutrition(
      parseMealDescription(meal.description).map(i => ({ ...i, ...lookupFoodProfile(i.name) }))
    );
    const macroCal = meal.macros.protein * 4 + meal.macros.carbs * 4 + meal.macros.fats * 9;
    if (Math.abs(meal.calories - macroCal) > 1) allConsistent = false;
    if (Math.abs(Math.round(recomputed.p) - meal.macros.protein) > 1) allConsistent = false;
  }
  check('kcal = P×4+C×4+F×9 и макросите се възпроизвеждат от description', allConsistent);
}

console.log('\n=== 5. Патологичен вход: ограничен коефициент, без абсурдни чинии ===');
{
  // 100g cucumber (15kcal) against a 500kcal target: unbounded scaling would demand
  // 3300g. The clamp caps at ×3 and validation reports the residual gap for AI retry.
  const items = parseMealDescription('• Краставица 100g').map(i => ({ ...i, ...lookupFoodProfile(i.name) }));
  const scaled = scaleItemsToTargetCalories(items, 500);
  const maxAllowed = 100 * SCALE_FACTOR_MAX + 30; // clamp + max rounding nudges
  check('порцията е ограничена (×3), не 3кг краставици', scaled[0].grams <= maxAllowed, `${scaled[0].grams}g`);

  const meal = { type: 'Хранене 2', description: '• Краставица 100g' };
  applyMealNutritionFromDatabase(meal, { calories: 500, protein: 30, carbs: 40, fats: 15 });
  check('калорийният дефицит остава видим за валидацията (AI retry)',
    Math.abs(meal.calories - 500) > calorieTolerance(500), `${meal.calories}kcal`);
}

console.log('\n=== 6. Подправки: остават подправки, не макро-източник ===');
{
  const meal = { type: 'Хранене 2', description: '• Пилешки гърди 150g\n• Ориз 150g\n• Соев сос 50g' };
  applyMealNutritionFromDatabase(meal, { calories: 600, protein: 45, carbs: 60, fats: 12 });
  const soy = parseMealDescription(meal.description).find(i => i.name === 'Соев сос');
  check('соевият сос е ограничен до 15g', soy && soy.grams <= 15, `${soy?.grams}g`);
}

console.log('\n=== 7. Десерт: включен в целта, продуктите се мащабират около него ===');
{
  const meal = {
    type: 'Хранене 4',
    description: '• Пилешки гърди 150g\n• Ориз 150g',
    dessert: { weight: '50g', macros: { protein: 3, carbs: 20, fats: 8 } },
  };
  applyMealNutritionFromDatabase(meal, { calories: 650, protein: 45, carbs: 70, fats: 18 });
  const kcalOk = Math.abs(meal.calories - 650) <= calorieTolerance(650) + 30;
  check('калориите с десерта се доближават до целта', kcalOk, `${meal.calories}kcal (цел 650)`);
  check('десертът е в макросите', meal.macros.carbs > 50);
}

console.log('\n=== 8. Непознат продукт се докладва (за строгата каталожна валидация) ===');
{
  const meal = { type: 'Хранене 2', description: '• Мистериозен специалитет 100g\n• Ориз 150g' };
  const res = applyMealNutritionFromDatabase(meal, { calories: 400 });
  check('unknown продуктът е върнат нагоре', res.unknowns.includes('Мистериозен специалитет'));
}

const passed = results.filter(Boolean).length;
console.log(`\n=== Обобщение: ${passed}/${results.length} PASS ===`);
process.exit(passed === results.length ? 0 : 1);
