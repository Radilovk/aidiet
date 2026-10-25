/**
 * Енергия — BMR, активност, TDEE, дефицит и макро цели. Един източник за
 * worker-а и за тестовете (досега тестовете държаха собствено копие).
 */

import { compileProfile } from './profile-code.js';
import { macroTargetsFor } from './macro-targets.js';
import { computeIntakeTarget } from './step1-deterministic.js';

function goalIncludes(goal, keyword) {
  if (!goal || !keyword) return false;
  const kw = String(keyword).toLowerCase();
  if (Array.isArray(goal)) return goal.some(g => String(g).toLowerCase().includes(kw));
  return String(goal).toLowerCase().includes(kw);
}

/**
 * Calculate BMR using Mifflin-St Jeor Equation
 * Men: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) + 5
 * Women: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) - 161
 * 
 * NOTE (2026-02-03): This function is DEPRECATED for primary calorie calculation.
 * AI model now calculates BMR/TDEE/calories holistically considering ALL correlates.
 * This function is kept ONLY for:
 * - Safety validation (ensure AI values are reasonable)
 * - Fallback if AI calculation fails
 * - Testing and comparison purposes
 * 
 * IMPORTANT: Never returns default values - all calculations are individualized
 * If required data is missing, throws an error to ensure proper data collection
 */
export function calculateBMR(data) {
  if (!data.weight || !data.height || !data.age || !data.gender) {
    throw new Error('Cannot calculate BMR: Missing required data (weight, height, age, or gender). All calculations must be individualized.');
  }
  
  const weight = parseFloat(data.weight);
  const height = parseFloat(data.height);
  const age = parseFloat(data.age);
  
  if (isNaN(weight) || isNaN(height) || isNaN(age) || weight <= 0 || height <= 0 || age <= 0) {
    throw new Error('Cannot calculate BMR: Invalid numerical values for weight, height, or age.');
  }
  
  let bmr = 10 * weight + 6.25 * height - 5 * age;
  
  if (data.gender === 'Мъж') {
    bmr += 5;
  } else if (data.gender === 'Жена') {
    bmr -= 161;
  } else {
    throw new Error('Cannot calculate BMR: Gender must be specified as "Мъж" or "Жена".');
  }
  
  return Math.round(bmr);
}

/**
 * Calculate unified activity score (1-10 scale) - Issue #7 Resolution
 * Combines daily activity level (1-3) with sport/exercise frequency (0-7 days/week)
 * 
 * Scale interpretation:
 * - dailyActivityLevel: "Ниско"=1, "Средно"=2, "Високо"=3
 * - sportActivity: Extract days per week from string (0-7)
 * - Combined score = dailyActivityLevel + min(sportDays, 7)
 * 
 * Examples:
 * - Високо (3) + Ниска 1-2 дни (1.5avg) → ~4.5 → 5
 * - Ниско (1) + Средна 2-4 дни (3avg) → ~4
 * - Средно (2) + Висока 5-7 дни (6avg) → ~8
 */
export function calculateUnifiedActivityScore(data) {
  // Map daily activity level to 1-3 scale
  const dailyActivityMap = {
    'Ниско': 1,
    'Средно': 2,
    'Високо': 3
  };
  
  const dailyScore = dailyActivityMap[data.dailyActivityLevel] || 2;
  
  // Extract sport days from sportActivity string
  // Using midpoint values for ranges: 1-2 days → 1.5, 2-4 days → 3, 5-7 days → 6
  const SPORT_DAYS_LOW = 1.5;    // Average of 1-2 days range
  const SPORT_DAYS_MEDIUM = 3;   // Average of 2-4 days range  
  const SPORT_DAYS_HIGH = 6;     // Average of 5-7 days range
  
  let sportDays = 0;
  if (data.sportActivity) {
    const sportStr = data.sportActivity;
    if (sportStr.includes('0 дни')) sportDays = 0;
    else if (sportStr.includes('1–2 дни')) sportDays = SPORT_DAYS_LOW;
    else if (sportStr.includes('2–4 дни')) sportDays = SPORT_DAYS_MEDIUM;
    else if (sportStr.includes('5–7 дни')) sportDays = SPORT_DAYS_HIGH;
  }
  
  // Combined score: 1-10 scale
  const combinedScore = Math.min(10, Math.max(1, dailyScore + sportDays));
  
  return {
    dailyScore,
    sportDays,
    combinedScore: Math.round(combinedScore * 10) / 10, // Round to 1 decimal
    activityLevel: combinedScore <= 3 ? 'Ниска' : 
                   combinedScore <= 6 ? 'Средна' : 
                   combinedScore <= 8 ? 'Висока' : 'Много висока'
  };
}

/**
 * Calculate TDEE (Total Daily Energy Expenditure) based on unified activity score
 * Updated multipliers based on 1-10 activity scale - Issue #7 & #10 Resolution
 * 
 * NOTE (2026-02-06): Updated to use unified activity score (1-10)
 * Maximum caloric deficit capped at 25% per Issue #9
 * AI model now calculates TDEE holistically. Kept for validation/fallback only.
 */
export function calculateTDEE(bmr, activityLevel) {
  // Legacy support: if activityLevel is string, use old multipliers
  if (typeof activityLevel === 'string') {
    const activityMultipliers = {
      'Никаква (0 дни седмично)': 1.2,
      'Ниска (1–2 дни седмично)': 1.375,
      'Средна (2–4 дни седмично)': 1.55,
      'Висока (5–7 дни седмично)': 1.725,
      'Много висока (атлети)': 1.9,
      'default': 1.4
    };
    const multiplier = activityMultipliers[activityLevel] || activityMultipliers['default'];
    return Math.round(bmr * multiplier);
  }
  
  // New unified score-based multipliers (1-10 scale)
  // Smoother progression for more accurate TDEE calculation
  const scoreMultipliers = {
    1: 1.2,    // Sedentary
    2: 1.3,
    3: 1.375,  // Light
    4: 1.45,
    5: 1.525,
    6: 1.6,    // Moderate
    7: 1.675,
    8: 1.75,   // Very active
    9: 1.85,
    10: 1.95   // Extremely active
  };
  
  const score = Math.round(activityLevel);
  const multiplier = scoreMultipliers[score] || scoreMultipliers[5];
  return Math.round(bmr * multiplier);
}

/**
 * Крачките, които заседналият множител (1,2 × BMR) вече съдържа — около 3000
 * дневно при заседнал начин на живот (Tudor-Locke 2011). Измерените над тях
 * се добавят като разход на ходене.
 */
const SEDENTARY_STEPS = 3000;

/** Нетен разход на крачка: ~0,5 kcal на кг на км (ACSM), крачка ~41,5% (мъже) / 41,3% (жени) от ръста. */
export function kcalPerStep(data) {
  const kg = parseFloat(String(data?.weight ?? '').replace(',', '.'));
  const cm = parseFloat(String(data?.height ?? '').replace(',', '.'));
  if (!(kg > 0) || !(cm > 0)) return 0;
  const stride = cm * (data.gender === 'Жена' ? 0.413 : 0.415) / 100;
  return 0.5 * kg * stride / 1000;
}

/**
 * Разходът за деня. С измерени крачки (enrichment.js → stepsActivity: средно в
 * ден без тренировка, от един източник) ежедневната активност не е стъпало
 * Ниско/Средно/Високо, а самите крачки: множителят е само за тренировките
 * (заседнало ниво + дни спорт), а ходенето над заседналия минимум се добавя в
 * kcal. Така 25 000 крачки не са „Високо“ като 10 000, а 2000 — „Ниско“ като 4900.
 * Без измерване — по въпросника, както досега.
 * @returns {{ tdee: number, activityData: object }}
 */
export function calculateActivityTDEE(bmr, data) {
  const activityData = calculateUnifiedActivityScore(data);
  const measured = Number(data?._enrichment?.activity?.steps);
  const perStep = kcalPerStep(data);
  if (!(measured > 0) || !(perStep > 0)) return { tdee: calculateTDEE(bmr, activityData.combinedScore), activityData };
  const walkKcal = Math.round(Math.max(0, measured - SEDENTARY_STEPS) * perStep);
  return {
    tdee: calculateTDEE(bmr, 1 + activityData.sportDays) + walkKcal,
    activityData: { ...activityData, measuredSteps: measured, walkKcal },
  };
}

/**
 * Macro ratios from the client profile code — diet-native targets.
 *
 * Протеинът е котва в г/кг (коригирано тегло при наднормено), стилът на
 * диетата задава въглехидратите или мазнините, останалото е третият макрос.
 * Процентите са спрямо приема (след дефицита), не спрямо TDEE: иначе
 * протеинът падаше с процента на дефицита.
 *
 * @param {Object} data - User data
 * @param {number} _activityScore - kept for call-site compatibility (activity comes from the profile)
 * @param {number} tdee - maintenance TDEE
 * @returns {{protein: number, carbs: number, fats: number, proteinGramsPerKg: number}}
 */
export function calculateMacronutrientRatios(data, _activityScore, tdee = null) {
  const profile = compileProfile(data);
  const maintenance = Number(tdee) || (data.gender === 'Мъж' ? 30 : 28) * (parseFloat(data.weight) || 70);
  const intake = computeIntakeTarget(maintenance, data.goal, calculateSafeDeficit(maintenance, data))
    || maintenance;
  // Изместването от клиничния протокол е в macroTargetsFor — един източник.
  const targets = macroTargetsFor(profile, intake);
  const { protein: proteinPercent, carbs: carbsPercent, fats: fatsPercent } = targets.ratios;

  return {
    protein: proteinPercent,
    carbs: carbsPercent,
    fats: fatsPercent,
    proteinGramsPerKg: targets.proteinPerKg,
  };
}

/**
 * Calculate safe caloric deficit - Issue #9 Resolution
 * Maximum 25% deficit, but AI can adjust for specific strategies
 * 
 * @returns {{targetCalories: number, deficitPercent: number, maxDeficitCalories: number, note?: string,
 *   direction?: string, intakePct?: number, goalCodes?: string[]}}  direction — само при подаден профил (модел на целта)
 */
export function calculateSafeDeficit(tdee, goal) {
  const MAX_DEFICIT_PERCENT = 0.25; // 25% maximum

  // Целият профил: посоката и силата идват от модела на целта (цел + тяло + клинична рамка).
  if (goal && typeof goal === 'object' && !Array.isArray(goal)) {
    const model = compileProfile(goal).goalModel;
    const pct = Math.max(-MAX_DEFICIT_PERCENT * 100, model.intakePct);
    return {
      targetCalories: Math.round(tdee * (1 + pct / 100)),
      deficitPercent: Math.max(0, -pct),
      maxDeficitCalories: Math.round(tdee * (1 - MAX_DEFICIT_PERCENT)),
      direction: model.direction,
      intakePct: pct,
      goalCodes: model.codes,
      note: model.reasons[0] || '',
    };
  }
  
  if (!goalIncludes(goal, 'Отслабване')) {
    return {
      targetCalories: tdee,
      deficitPercent: 0,
      maxDeficitCalories: tdee
    };
  }
  
  // Conservative deficit: 15-20% for most people
  const standardDeficit = 0.18;
  const targetCalories = Math.round(tdee * (1 - standardDeficit));
  const maxDeficitCalories = Math.round(tdee * (1 - MAX_DEFICIT_PERCENT));
  
  return {
    targetCalories,
    deficitPercent: standardDeficit * 100,
    maxDeficitCalories,
    note: 'AI може да коригира при специални стратегии (напр. интермитентно гладуване)'
  };
}
