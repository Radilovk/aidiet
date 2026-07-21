import { CANONICAL_MEAL_TYPES, MEAL3_ALLOWED, MEAL3_FORBIDDEN, MAX_LATE_SNACK_CALORIES } from '../constants.mjs';

const DISPLAY_NAMES = ['Закуска', 'Обяд', 'Следобедна закуска', 'Вечеря', 'Късна закуска'];

export function validateStrategy(strategy) {
  const issues = [];
  if (!strategy) return ['strategy липсва'];

  if (!strategy.weeklyScheme) issues.push('weeklyScheme липсва');
  if (!strategy.dietaryModifier && !strategy.dietType) issues.push('dietType/dietaryModifier липсва');

  if (strategy.mealCountJustification && strategy.mealCountJustification.length < 20) {
    issues.push('mealCountJustification < 20 символа');
  }

  const scheme = strategy.weeklyScheme || {};
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const day of days) {
    const d = scheme[day];
    if (!d) { issues.push(`weeklyScheme.${day} липсва`); continue; }
    if (!d.mealBreakdown?.length) { issues.push(`${day}: празен mealBreakdown`); continue; }
    if (d.meals !== d.mealBreakdown.length) {
      issues.push(`${day}: meals (${d.meals}) != mealBreakdown.length (${d.mealBreakdown.length})`);
    }
    for (const entry of d.mealBreakdown) {
      if (!CANONICAL_MEAL_TYPES.includes(entry.type)) {
        issues.push(`${day}: невалиден тип "${entry.type}"`);
      }
      if (DISPLAY_NAMES.includes(entry.type)) {
        issues.push(`${day}: display име "${entry.type}" вместо канонично`);
      }
      if (entry.calories > 800) {
        issues.push(`${day}: ${entry.type} ${entry.calories} kcal > 800`);
      }
    }
  }

  return issues;
}

export function validateMealPlan(weekPlan, strategy = {}) {
  const issues = [];
  if (!weekPlan) return ['weekPlan липсва'];

  for (let d = 1; d <= 7; d++) {
    const day = weekPlan[`day${d}`];
    if (!day?.meals?.length) {
      issues.push(`day${d}: няма хранения`);
      continue;
    }
    for (const meal of day.meals) {
      const text = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();
      if (meal.type === 'Хранене 3') {
        const ok = MEAL3_ALLOWED.some(f => text.includes(f));
        const bad = MEAL3_FORBIDDEN.some(f => text.includes(f));
        if (!ok || bad) {
          issues.push(`day${d} Хранене 3 не е лека закуска: "${meal.name}"`);
        }
      }
      if (meal.type === 'Хранене 5') {
        const cals = parseInt(meal.calories, 10) || 0;
        if (cals > MAX_LATE_SNACK_CALORIES) {
          issues.push(`day${d} Хранене 5: ${cals} kcal > ${MAX_LATE_SNACK_CALORIES}`);
        }
      }
      if (!meal.description || !/\d+\s*(g|г)\b/i.test(meal.description)) {
        issues.push(`day${d} "${meal.name}": липсват грамажи в description`);
      }
    }
  }

  return issues;
}

export function buildMinimalWeekPlan(strategy) {
  const weekPlan = {};
  const mon = strategy?.weeklyScheme?.monday?.mealBreakdown || [
    { type: 'Хранене 1', calories: 400, protein: 25, carbs: 35, fats: 12 },
    { type: 'Хранене 2', calories: 550, protein: 40, carbs: 50, fats: 18 },
    { type: 'Хранене 3', calories: 180, protein: 8, carbs: 20, fats: 8 },
    { type: 'Хранене 4', calories: 450, protein: 35, carbs: 30, fats: 15 },
  ];
  for (let d = 1; d <= 7; d++) {
    weekPlan[`day${d}`] = {
      meals: mon.map((slot, i) => ({
        type: slot.type,
        name: slot.type === 'Хранене 3' ? 'Ябълка с бадеми' : `Ястие ${i + 1}`,
        description: slot.type === 'Хранене 3'
          ? '• ябълка 150g\n• бадеми 20g'
          : '• пилешки гърди 150g\n• броколи 120g\n• зехтир екстра върджин 10g',
        calories: slot.calories,
        macros: { protein: slot.protein, carbs: slot.carbs, fats: slot.fats },
      })),
    };
  }
  return weekPlan;
}
