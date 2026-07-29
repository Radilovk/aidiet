/**
 * Pure plan-pipeline helpers — dietetic math, scheme sync, free meal/dessert,
 * blocked terms, meal validation. Shared by worker.entry.js and offline tests.
 */
import { calorieTolerance, parseMealDescription } from './food-nutrition.js';
import { validateProductNamesInCatalog, validateProductNamesAgainstProtocol } from './food-catalog.js';

export const MIN_RECOMMENDED_CALORIES_FEMALE = 1200;
export const MIN_RECOMMENDED_CALORIES_MALE = 1500;
export const MIN_FAT_GRAMS_PER_KG = 0.7;
export const MAX_LATE_SNACK_CALORIES = 200;
export const MAX_DEFICIT_RATIO = 0.25;
export const DAY_NUMBER_TO_KEY = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export const FIXED_DESSERT = {
  name: 'Пълномаслен шоколад с лешници',
  weight: '30г',
  description: 'Насладете се на 2 реда млечен или черен шоколад с цели лешници.',
  calories: 168,
  macros: { protein: 2, carbs: 14, fats: 12 },
};

export const FIXED_DESSERT_WEIGHT_GRAMS = (() => {
  const m = FIXED_DESSERT.weight.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
})();

export const MEAL_TYPE_ALIASES = {
  'Закуска': 'Хранене 1',
  'Обяд': 'Хранене 2',
  'Следобедна закуска': 'Хранене 3',
  'Вечеря': 'Хранене 4',
  'Късна закуска': 'Хранене 5',
  'Междинно': 'Хранене 3',
  'Междинна закуска': 'Хранене 3',
  'Снак': 'Хранене 3',
  'Снек': 'Хранене 3',
  'Лека закуска': 'Хранене 3',
  'Следобедна': 'Хранене 3',
  'Десерт': 'Хранене 3',
  'Предвечерна закуска': 'Хранене 5',
  'Нощна закуска': 'Хранене 5',
  'Вода с лимон/Зелен чай': 'Напитка',
  'Вода с лимон': 'Напитка',
  'Зелен чай': 'Напитка',
  'Чай': 'Напитка',
  'Кафе': 'Напитка',
  'Напитки': 'Напитка',
};

export const ALLOWED_MEAL_TYPES = [
  'Напитка', 'Хранене 1', 'Хранене 2', 'Свободно хранене', 'Хранене 3', 'Хранене 4', 'Хранене 5',
];

export function parseFinalCalories(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Math.round(value);
  const m = String(value).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

export function goalIncludes(goal, keyword) {
  if (!goal || !keyword) return false;
  if (Array.isArray(goal)) return goal.some(g => String(g).includes(keyword));
  return String(goal).includes(keyword);
}

export function getMinRecommendedCalories(gender) {
  return gender === 'Мъж' ? MIN_RECOMMENDED_CALORIES_MALE : MIN_RECOMMENDED_CALORIES_FEMALE;
}

export function macrosToCalories(macros) {
  if (!macros) return 0;
  const p = Number(macros.protein) || 0;
  const c = Number(macros.carbs) || 0;
  const f = Number(macros.fats) || 0;
  return Math.round(p * 4 + c * 4 + f * 9);
}

export function userHasSweetsCraving(foodCravings) {
  if (Array.isArray(foodCravings)) return foodCravings.includes('Сладко');
  return typeof foodCravings === 'string' && foodCravings.includes('Сладко');
}

export function calculateBMR(data) {
  if (!data.weight || !data.height || !data.age || !data.gender) {
    throw new Error('Cannot calculate BMR: Missing required data (weight, height, age, or gender).');
  }
  const weight = parseFloat(data.weight);
  const height = parseFloat(data.height);
  const age = parseFloat(data.age);
  if (isNaN(weight) || isNaN(height) || isNaN(age) || weight <= 0 || height <= 0 || age <= 0) {
    throw new Error('Cannot calculate BMR: Invalid numerical values.');
  }
  let bmr = 10 * weight + 6.25 * height - 5 * age;
  if (data.gender === 'Мъж') bmr += 5;
  else if (data.gender === 'Жена') bmr -= 161;
  else throw new Error('Cannot calculate BMR: Gender must be "Мъж" or "Жена".');
  return Math.round(bmr);
}

export function calculateUnifiedActivityScore(data) {
  const dailyActivityMap = { 'Ниско': 1, 'Средно': 2, 'Високо': 3 };
  const dailyScore = dailyActivityMap[data.dailyActivityLevel] || 2;
  let sportDays = 0;
  if (data.sportActivity) {
    const sportStr = data.sportActivity;
    if (sportStr.includes('0 дни')) sportDays = 0;
    else if (sportStr.includes('1–2 дни')) sportDays = 1.5;
    else if (sportStr.includes('2–4 дни')) sportDays = 3;
    else if (sportStr.includes('5–7 дни')) sportDays = 6;
  }
  const combinedScore = Math.min(10, Math.max(1, dailyScore + sportDays));
  return {
    dailyScore,
    sportDays,
    combinedScore: Math.round(combinedScore * 10) / 10,
    activityLevel: combinedScore <= 3 ? 'Ниска'
      : combinedScore <= 6 ? 'Средна'
        : combinedScore <= 8 ? 'Висока' : 'Много висока',
  };
}

export function calculateTDEE(bmr, activityLevel) {
  if (typeof activityLevel === 'string') {
    const activityMultipliers = {
      'Никаква (0 дни седмично)': 1.2,
      'Ниска (1–2 дни седмично)': 1.375,
      'Средна (2–4 дни седмично)': 1.55,
      'Висока (5–7 дни седмично)': 1.725,
      'Много висока (атлети)': 1.9,
      default: 1.4,
    };
    return Math.round(bmr * (activityMultipliers[activityLevel] || activityMultipliers.default));
  }
  const scoreMultipliers = {
    1: 1.2, 2: 1.3, 3: 1.375, 4: 1.45, 5: 1.525,
    6: 1.6, 7: 1.675, 8: 1.75, 9: 1.85, 10: 1.95,
  };
  const score = Math.round(activityLevel);
  return Math.round(bmr * (scoreMultipliers[score] || scoreMultipliers[5]));
}

export function calculateSafeDeficit(tdee, goal) {
  if (!goal || !String(goal).includes('Отслабване')) {
    return { targetCalories: tdee, deficitPercent: 0, maxDeficitCalories: tdee };
  }
  const standardDeficit = 0.18;
  return {
    targetCalories: Math.round(tdee * (1 - standardDeficit)),
    deficitPercent: standardDeficit * 100,
    maxDeficitCalories: Math.round(tdee * (1 - MAX_DEFICIT_RATIO)),
  };
}

/** Base macro ratios without clinical protocol modifiers (testable core). */
export function calculateMacronutrientRatios(data, activityScore, tdee = null) {
  const weight = parseFloat(data.weight) || 70;
  const gender = data.gender;
  const goal = data.goal || '';
  let proteinPerKg;
  if (gender === 'Мъж') {
    proteinPerKg = activityScore >= 7 ? 2.0 : activityScore >= 5 ? 1.6 : 1.2;
  } else {
    proteinPerKg = activityScore >= 7 ? 1.8 : activityScore >= 5 ? 1.4 : 1.0;
  }
  if (String(goal).includes('Мускулна маса')) proteinPerKg *= 1.2;
  else if (String(goal).includes('Отслабване')) proteinPerKg *= 1.1;

  const proteinGrams = weight * proteinPerKg;
  const estimatedCalories = tdee || (gender === 'Мъж' ? weight * 30 : weight * 28);
  let proteinPercent = Math.round((proteinGrams * 4 / estimatedCalories) * 100);
  const remainingPercent = 100 - proteinPercent;
  let carbsPercent;
  let fatsPercent;
  if (activityScore >= 7) {
    carbsPercent = Math.round(remainingPercent * 0.6);
    fatsPercent = remainingPercent - carbsPercent;
  } else if (activityScore >= 4) {
    carbsPercent = Math.round(remainingPercent * 0.5);
    fatsPercent = remainingPercent - carbsPercent;
  } else {
    carbsPercent = Math.round(remainingPercent * 0.4);
    fatsPercent = remainingPercent - carbsPercent;
  }
  const total = proteinPercent + carbsPercent + fatsPercent;
  if (total !== 100) fatsPercent += (100 - total);
  return {
    protein: proteinPercent,
    carbs: carbsPercent,
    fats: fatsPercent,
    proteinGramsPerKg: Math.round(proteinPerKg * 10) / 10,
  };
}

export function syncAnalysisCalories(analysis) {
  if (!analysis) return;
  const fc = parseFinalCalories(analysis.Final_Calories);
  if (fc > 0 && analysis.correctedMetabolism) {
    analysis.correctedMetabolism.realTDEE = fc;
  }
}

export function enforceCalorieGuardrails(analysis, data, referenceTdee) {
  if (!analysis) return;
  syncAnalysisCalories(analysis);
  const tdee = referenceTdee || parseFinalCalories(analysis.tdee) || 0;
  let fc = parseFinalCalories(analysis.Final_Calories);
  if (fc <= 0 && tdee > 0) fc = tdee;

  const cm = analysis.correctedMetabolism || (analysis.correctedMetabolism = {});
  const minCal = getMinRecommendedCalories(data.gender);
  const isLactation = data.clinicalProtocol === 'postpartum_lactation';
  const corrections = [];

  if (tdee > 0 && fc > 0 && goalIncludes(data.goal, 'Отслабване') && !isLactation) {
    const minAllowed = Math.round(tdee * (1 - MAX_DEFICIT_RATIO));
    if (fc < minAllowed) {
      fc = minAllowed;
      corrections.push('Дефицитът е ограничен до безопасни 25%.');
    }
  }
  if (fc > 0 && fc < minCal) {
    fc = minCal;
    corrections.push('Повдигнато до минималния безопасен праг.');
  }
  if (fc > 0) {
    analysis.Final_Calories = fc;
    cm.realTDEE = fc;
  }

  const weight = parseFloat(data.weight) || 70;
  const minFatG = Math.round(weight * MIN_FAT_GRAMS_PER_KG);
  const mg = analysis.macroGrams || (analysis.macroGrams = {});
  const ratios = analysis.macroRatios;

  if (fc > 0 && ratios && ratios.protein != null && ratios.fats != null) {
    let proteinG = Math.round(fc * ratios.protein / 100 / 4);
    let fatsG = Math.round(fc * ratios.fats / 100 / 9);
    let carbsG = Math.round((fc - proteinG * 4 - fatsG * 9) / 4);
    if (fatsG < minFatG) {
      fatsG = minFatG;
      carbsG = Math.max(0, Math.round((fc - proteinG * 4 - fatsG * 9) / 4));
      corrections.push(`Мазнините са повдигнати до минимум ${minFatG}г.`);
    }
    mg.protein = proteinG;
    mg.fats = fatsG;
    mg.carbs = carbsG;
  } else if (mg.fats > 0 && mg.fats < minFatG) {
    mg.fats = minFatG;
    corrections.push(`Мазнините са повдигнати до минимум ${minFatG}г.`);
  }
  if (corrections.length) cm.correction = corrections.join(' ');
  return corrections;
}

export function enforceWeekendFreeDay(strategy) {
  if (!strategy || strategy.freeDayNumber == null) return;
  const d = Number(strategy.freeDayNumber);
  if (!isNaN(d) && (d < 6 || d > 7)) strategy.freeDayNumber = 7;
}

export function normalizeStrategyDessertFlag(strategy, userData) {
  if (!strategy || strategy.includeDessert !== undefined) return;
  if (!userHasSweetsCraving(userData?.foodCravings)) {
    strategy.includeDessert = false;
    return;
  }
  const conditions = userData?.medicalConditions;
  const blocked = Array.isArray(conditions) && conditions.some(c => {
    const s = String(c);
    return s.includes('Диабет') || s.includes('Инсулинова резистентност');
  });
  strategy.includeDessert = !blocked;
}

export function normalizeMealBreakdownTypes(strategy) {
  if (!strategy?.weeklyScheme) return;
  for (const day of Object.values(strategy.weeklyScheme)) {
    if (!day?.mealBreakdown?.length) continue;
    for (const entry of day.mealBreakdown) {
      if (!entry?.type) continue;
      if (MEAL_TYPE_ALIASES[entry.type]) entry.type = MEAL_TYPE_ALIASES[entry.type];
    }
  }
}

export function normalizeWeeklyScheme(strategy, defaultDailyCalories) {
  if (!strategy?.weeklyScheme) return;
  normalizeMealBreakdownTypes(strategy);
  for (const key of DAY_NUMBER_TO_KEY) {
    const day = strategy.weeklyScheme[key];
    if (!day || !Array.isArray(day.mealBreakdown) || day.mealBreakdown.length === 0) continue;
    const sumField = (field) => day.mealBreakdown.reduce((s, m) => s + (Number(m[field]) || 0), 0);
    const sumCals = sumField('calories');
    const sumP = sumField('protein');
    const sumC = sumField('carbs');
    const sumF = sumField('fats');
    const targetCals = Number(day.calories) || defaultDailyCalories || sumCals;
    if (!day.calories && (sumCals > 0 || defaultDailyCalories)) day.calories = sumCals || defaultDailyCalories;
    if (!day.protein && sumP > 0) day.protein = sumP;
    if (!day.carbs && sumC > 0) day.carbs = sumC;
    if (!day.fats && sumF > 0) day.fats = sumF;
    if (!day.meals) day.meals = day.mealBreakdown.length;
    if (sumCals > 0 && targetCals > 0 && Math.abs(sumCals - targetCals) > calorieTolerance(targetCals)) {
      const ratio = targetCals / sumCals;
      for (const m of day.mealBreakdown) {
        m.calories = Math.round((Number(m.calories) || 0) * ratio);
        m.protein = Math.round((Number(m.protein) || 0) * ratio);
        m.carbs = Math.round((Number(m.carbs) || 0) * ratio);
        m.fats = Math.round((Number(m.fats) || 0) * ratio);
      }
    } else if (sumCals > 0 && Math.abs(sumCals - (Number(day.calories) || 0)) > calorieTolerance(day.calories)) {
      day.calories = sumCals;
      day.protein = sumP;
      day.carbs = sumC;
      day.fats = sumF;
    }
  }
}

export function getFreeMealSlotCalories(dayTarget) {
  if (!dayTarget?.mealBreakdown) return 0;
  const free = dayTarget.mealBreakdown.find(m =>
    m.type === 'Свободно хранене' || m.type === 'Хранене 2'
  );
  return free ? (Number(free.calories) || 0) : 0;
}

export function injectFixedDesserts(weekPlan) {
  if (!weekPlan) return;
  for (const dayKey of Object.keys(weekPlan)) {
    const day = weekPlan[dayKey];
    if (!day?.meals) continue;
    for (const meal of day.meals) {
      if (meal.dessert && typeof meal.dessert !== 'object') {
        meal.dessert = { ...FIXED_DESSERT, macros: { ...FIXED_DESSERT.macros }, _weightAddedToMeal: true };
        if (meal.weight && FIXED_DESSERT_WEIGHT_GRAMS > 0) {
          const mainMatch = String(meal.weight).match(/(\d+(?:\.\d+)?)/);
          if (mainMatch) {
            meal.weight = `${Math.round(parseFloat(mainMatch[1]) + FIXED_DESSERT_WEIGHT_GRAMS)}г`;
          }
        }
      }
    }
  }
}

export function recalculateDayCalories(weekPlan, strategy) {
  for (const dayKey of Object.keys(weekPlan || {})) {
    const day = weekPlan[dayKey];
    if (!day || !Array.isArray(day.meals)) continue;
    const dayNum = parseInt(String(dayKey).replace('day', ''), 10);
    const schemeKey = dayNum >= 1 && dayNum <= 7 ? DAY_NUMBER_TO_KEY[dayNum - 1] : null;
    const dayTarget = schemeKey && strategy?.weeklyScheme ? strategy.weeklyScheme[schemeKey] : null;
    let totalCals = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFats = 0;
    for (const meal of day.meals) {
      if (meal.type === 'Свободно хранене') {
        const freeTarget = dayTarget?.mealBreakdown?.find(m =>
          m.type === 'Свободно хранене' || m.type === 'Хранене 2'
        );
        const freeCal = freeTarget ? (Number(freeTarget.calories) || 0) : getFreeMealSlotCalories(dayTarget);
        if (freeCal > 0) meal._plannedCalories = freeCal;
        totalCals += freeCal;
        if (freeTarget) {
          totalProtein += Number(freeTarget.protein) || 0;
          totalCarbs += Number(freeTarget.carbs) || 0;
          totalFats += Number(freeTarget.fats) || 0;
        }
        continue;
      }
      if (meal.type === 'Напитка' || !meal.macros) continue;
      const p = Number(meal.macros.protein) || 0;
      const c = Number(meal.macros.carbs) || 0;
      const f = Number(meal.macros.fats) || 0;
      meal.calories = macrosToCalories(meal.macros);
      totalCals += meal.calories;
      totalProtein += p;
      totalCarbs += c;
      totalFats += f;
    }
    if (!day.dailyTotals) day.dailyTotals = {};
    day.dailyTotals.calories = totalCals;
    day.dailyTotals.protein = Math.round(totalProtein);
    day.dailyTotals.carbs = Math.round(totalCarbs);
    day.dailyTotals.fats = Math.round(totalFats);
  }
}

export function collectUserBlockedFoodTerms(data) {
  const terms = [];
  const pushSplit = (val) => {
    if (!val) return;
    String(val).split(/[,;|\n]/).forEach(s => {
      const t = s.trim();
      if (t.length >= 2) terms.push(t);
    });
  };
  pushSplit(data?.dietDislike);
  pushSplit(data?.['medicalConditions_Алергии']);
  if (Array.isArray(data?.planModifications)) {
    for (const mod of data.planModifications) {
      if (typeof mod === 'string' && mod.startsWith('exclude_food:')) {
        terms.push(mod.slice('exclude_food:'.length).trim());
      }
    }
  }
  if (Array.isArray(data?.forbidden)) data.forbidden.forEach(f => pushSplit(f));
  return terms;
}

export function applyFoodSubstitutions(meal, fixes) {
  const applied = [];
  for (const { detect, replace } of fixes || []) {
    const re = new RegExp(detect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let changed = false;
    if (meal.name && re.test(meal.name)) {
      meal.name = meal.name.replace(re, String(replace));
      changed = true;
    }
    if (meal.description && new RegExp(detect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi').test(meal.description)) {
      meal.description = meal.description.replace(
        new RegExp(detect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        replace
      );
      changed = true;
    }
    if (changed) applied.push(`${detect}→${replace}`);
  }
  return applied;
}

export function validateMealsAgainstScheme(dayPlan, dayTarget, dayNum, clinicalProtocolId = null, { strictCatalog = true } = {}) {
  const errors = [];
  if (!dayPlan?.meals?.length || !dayTarget?.mealBreakdown?.length) return errors;
  for (const meal of dayPlan.meals) {
    if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
    const target = dayTarget.mealBreakdown.find(m => m.type === meal.type);
    if (!target) continue;
    if (!meal.description || !/\d+\s*(g|г)\b/i.test(meal.description)) {
      errors.push(`Ден ${dayNum} ${meal.type}: липсват грамажи (числоg) в description`);
    }
    const targetCal = Number(target.calories) || 0;
    const mealCal = Number(meal.calories) || macrosToCalories(meal.macros);
    if (targetCal > 0 && mealCal > 0 && Math.abs(mealCal - targetCal) > calorieTolerance(targetCal)) {
      errors.push(`Ден ${dayNum} ${meal.type}: калории ${mealCal} ≠ цел ${targetCal}`);
    }
    if (meal.description && strictCatalog) {
      const productNames = parseMealDescription(meal.description).map(i => i.name);
      const notInCatalog = validateProductNamesInCatalog(productNames);
      if (notInCatalog.length) {
        errors.push(`Ден ${dayNum} ${meal.type}: продукти извън каталога: ${notInCatalog.join(', ')}`);
      }
      if (clinicalProtocolId) {
        const forbidden = validateProductNamesAgainstProtocol(productNames, clinicalProtocolId);
        if (forbidden.length) {
          errors.push(`Ден ${dayNum} ${meal.type}: забранени при клиничния протокол: ${forbidden.join(', ')}`);
        }
      }
    }
  }
  return errors;
}

export function normalizeMealTypesInWeekPlan(weekPlan) {
  if (!weekPlan || typeof weekPlan !== 'object') return;
  for (const day of Object.values(weekPlan)) {
    if (!day?.meals?.length) continue;
    for (const meal of day.meals) {
      if (!meal?.type) continue;
      const name = (meal.name || '').toLowerCase().trim();
      if (name === 'свободно хранене' && meal.type !== 'Свободно хранене') {
        meal.type = 'Свободно хранене';
      } else if (MEAL_TYPE_ALIASES[meal.type]) {
        meal.type = MEAL_TYPE_ALIASES[meal.type];
      }
    }
  }
}
