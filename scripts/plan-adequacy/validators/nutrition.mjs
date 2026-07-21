import {
  parseMealDescription,
  lookupFoodProfile,
  sumItemNutrition,
  applyMealNutritionFromDatabase,
  calorieTolerance,
  macroTolerance,
} from '../../../food-nutrition.js';

function macrosToCalories(macros) {
  const p = Number(macros?.protein) || 0;
  const c = Number(macros?.carbs) || 0;
  const f = Number(macros?.fats) || 0;
  return Math.round(p * 4 + c * 4 + f * 9);
}

export function validateMealMacroArithmetic(meal) {
  const issues = [];
  if (!meal?.macros || meal.type === 'Свободно хранене' || meal.type === 'Напитка') return issues;

  const computed = macrosToCalories(meal.macros);
  const declared = Number(meal.calories) || 0;
  if (declared && Math.abs(computed - declared) > 2) {
    issues.push(`"${meal.name}": калории ${declared} ≠ P×4+C×4+F×9 (${computed})`);
  }
  return issues;
}

export function validateMealGramsAndWeight(meal) {
  const issues = [];
  if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') return issues;

  const items = parseMealDescription(meal.description);
  if (!items.length) {
    issues.push(`"${meal.name}": липсват парсируеми грамажи в description`);
    return issues;
  }

  for (const item of items) {
    if (item.grams < 10) issues.push(`"${meal.name}": ${item.name} ${item.grams}g — твърде малко`);
    if (item.grams > 600 && !/овес|ориз|боб|леща|нахут|картоф|броколи|спанак/.test(item.name.toLowerCase())) {
      issues.push(`"${meal.name}": ${item.name} ${item.grams}g — нереалистична порция`);
    }
  }

  const totalGrams = items.reduce((s, i) => s + i.grams, 0);
  if (totalGrams < 50) issues.push(`"${meal.name}": общо ${totalGrams}g — твърде малко`);
  if (totalGrams > 1200) issues.push(`"${meal.name}": общо ${totalGrams}g — абсурдна порция`);

  if (meal.weight) {
    const m = String(meal.weight).match(/(\d+(?:\.\d+)?)\s*(?:g|г)/i);
    if (m) {
      const wg = parseFloat(m[1]);
      if (wg < 50) issues.push(`"${meal.name}": weight ${wg}g < 50g`);
      if (wg > 800) issues.push(`"${meal.name}": weight ${wg}g > 800g`);
    }
  }

  return issues;
}

/** Recompute macros from written grams — catches AI/backend drift */
export function validateMealMacrosFromGrams(meal) {
  const issues = [];
  if (meal.type === 'Свободно хранене' || meal.type === 'Напитка' || !meal.macros) return issues;

  const items = parseMealDescription(meal.description).map(i => {
    const { profile } = lookupFoodProfile(i.name);
    return { ...i, profile };
  });
  if (!items.length) return issues;

  const totals = sumItemNutrition(items);
  const tolP = macroTolerance(meal.macros.protein);
  const tolC = macroTolerance(meal.macros.carbs);
  const tolF = macroTolerance(meal.macros.fats);

  if (Math.abs(Math.round(totals.p) - meal.macros.protein) > tolP) {
    issues.push(`"${meal.name}": protein ${meal.macros.protein}g ≠ от грамажи ${Math.round(totals.p)}g`);
  }
  if (Math.abs(Math.round(totals.c) - meal.macros.carbs) > tolC) {
    issues.push(`"${meal.name}": carbs ${meal.macros.carbs}g ≠ от грамажи ${Math.round(totals.c)}g`);
  }
  if (Math.abs(Math.round(totals.f) - meal.macros.fats) > tolF) {
    issues.push(`"${meal.name}": fats ${meal.macros.fats}g ≠ от грамажи ${Math.round(totals.f)}g`);
  }

  return issues;
}

export function validateMealNutritionPipeline(meal, target) {
  const clone = structuredClone(meal);
  const result = applyMealNutritionFromDatabase(clone, target);
  const issues = [];

  if (result.unknowns?.filter(u => u !== 'no-parsed-items').length) {
    issues.push(`"${meal.name}": непознати продукти: ${result.unknowns.join(', ')}`);
  }
  if (target?.calories) {
    const diff = Math.abs(clone.calories - target.calories);
    if (diff > calorieTolerance(target.calories)) {
      issues.push(
        `"${meal.name}": калории ${clone.calories} далеч от цел ${target.calories} (±${calorieTolerance(target.calories)})`
      );
    }
  }
  issues.push(...validateMealMacroArithmetic(clone));
  return issues;
}

export function validateWeekPlanNutrition(weekPlan, strategy) {
  const issues = [];
  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  for (let d = 1; d <= 7; d++) {
    const day = weekPlan[`day${d}`];
    const dayTarget = strategy?.weeklyScheme?.[dayKeys[d - 1]];
    if (!day?.meals) continue;

    let dayKcal = 0;
    for (const meal of day.meals) {
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;

      const target = dayTarget?.mealBreakdown?.find(m => m.type === meal.type);
      issues.push(
        ...validateMealMacroArithmetic(meal),
        ...validateMealGramsAndWeight(meal),
        ...validateMealMacrosFromGrams(meal),
      );

      const mealCal = Number(meal.calories) || macrosToCalories(meal.macros);
      dayKcal += mealCal;
      if (target?.calories && mealCal > 0) {
        const tol = calorieTolerance(target.calories);
        if (Math.abs(mealCal - target.calories) > tol) {
          issues.push(`day${d} ${meal.type}: ${mealCal} kcal ≠ схема ${target.calories} (±${tol})`);
        }
      }
    }

    if (dayTarget?.calories && dayKcal > 0) {
      const tol = calorieTolerance(dayTarget.calories);
      if (Math.abs(dayKcal - dayTarget.calories) > tol * 2) {
        issues.push(`day${d}: дневни ${dayKcal} kcal ≠ схема ${dayTarget.calories}`);
      }
    }
  }

  return issues;
}
