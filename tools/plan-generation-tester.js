#!/usr/bin/env node
/**
 * plan-generation-tester.js — Затворен цикъл за тестване на генерирането на диетичен план
 *
 * Зарежда реалните промпт шаблони от KV/prompts/, попълва ги с тестови потребителски данни,
 * изпраща ги към Gemini API и записва отговорите в tools/test-results/.
 *
 * Използване:
 *   node tools/plan-generation-tester.js [опции]
 *
 * Опции:
 *   --step <1|2|3|4|all>     Коя стъпка да се тества (по подразбиране: all)
 *   --model <model-name>      Gemini модел (по подразбиране: gemini-2.5-flash)
 *   --user <файл.json>        JSON файл с потребителски данни (по подразбиране: вградените тестови данни)
 *   --no-chain                Не предава изхода на предишна стъпка като вход за следваща
 *   --verbose                 Отпечатва пълните промптове преди изпращане
 *   --dry-run                 Само изгражда промптовете, без да ги изпраща
 *
 * Изисква:
 *   GEMINI_API_KEY=<ключ>  — задайте като environment variable
 *
 * Пример:
 *   GEMINI_API_KEY=xxx node tools/plan-generation-tester.js --step 1 --model gemini-2.5-flash --verbose
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Конфигурация по подразбиране
// ─────────────────────────────────────────────────────────────────────────────
const ROOT_DIR    = path.resolve(__dirname, '..');
const PROMPTS_DIR = path.join(ROOT_DIR, 'KV', 'prompts');
const RESULTS_DIR = path.join(__dirname, 'test-results');

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// Константи, съответстващи на worker.js
const MIN_RECOMMENDED_CALORIES_FEMALE    = 1200;
const MIN_RECOMMENDED_CALORIES_MALE      = 1500;
const MIN_FAT_GRAMS_PER_KG               = 0.7;
const WATER_PER_KG_MULTIPLIER            = 0.035;
const BASE_WATER_NEED_LITERS             = 0.5;
const TEMPERAMENT_CONFIDENCE_THRESHOLD   = 80;
const HEALTH_STATUS_UNDERESTIMATE_PERCENT = 10;
const DAILY_CALORIE_TOLERANCE            = 50;
const MAX_LATE_SNACK_CALORIES            = 200;

const DAY_NUMBER_TO_KEY = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_NAMES_BG = {
  monday: 'Понеделник', tuesday: 'Вторник', wednesday: 'Сряда',
  thursday: 'Четвъртък', friday: 'Петък', saturday: 'Събота', sunday: 'Неделя'
};

// ─────────────────────────────────────────────────────────────────────────────
// Тестови потребителски данни (реалистичен профил)
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_USER_DATA = {
  name: 'Мария',
  age: '34',
  gender: 'Жена',
  weight: '72',
  height: '165',
  goal: 'Отслабване',
  lossKg: '8',
  dailyActivityLevel: 'Средно',
  sportActivity: '2–4 дни в седмицата',
  sleepHours: '6.5',
  sleepInterrupt: 'Понякога',
  chronotype: 'Средно утринен тип',
  stressLevel: 'Средно',
  waterIntake: '1.5',
  medicalConditions: ['Инсулинова резистентност'],
  medications: 'Не',
  medicationsDetails: '',
  eatingHabits: ['Закусвам', 'Ям бързо'],
  foodCravings: ['Сладко'],
  foodTriggers: ['Стрес', 'Скука'],
  compensationMethods: ['Пропускам хранения'],
  overeatingFrequency: 'Понякога',
  drinksSweet: 'Рядко',
  drinksAlcohol: 'Понякога (уикенд)',
  dietHistory: 'Да',
  dietType: 'Ниско въглехидратна',
  dietResult: 'Временен успех, после връщане на теглото',
  dietPreference: ['Средиземноморска'],
  dietDislike: 'Карфиол, черен дроб',
  dietLove: 'Пиле, риба, зеленчуци, кисело мляко',
  weightChange: 'Увеличение',
  weightChangeDetails: '+5 кг за последната година',
  socialComparison: 'Понякога',
  additionalNotes: 'Работя от вкъщи, имам деца',
  clinicalProtocol: null
};

// ─────────────────────────────────────────────────────────────────────────────
// Помощни функции (идентични с тези в worker.js)
// ─────────────────────────────────────────────────────────────────────────────

function calculateBMR(data) {
  const weight = parseFloat(data.weight);
  const height = parseFloat(data.height);
  const age    = parseFloat(data.age);
  let bmr = 10 * weight + 6.25 * height - 5 * age;
  if (data.gender === 'Мъж') bmr += 5;
  else bmr -= 161;
  return Math.round(bmr);
}

function calculateUnifiedActivityScore(data) {
  const dailyActivityMap = { 'Ниско': 1, 'Средно': 2, 'Високо': 3 };
  const dailyScore = dailyActivityMap[data.dailyActivityLevel] || 2;
  let sportDays = 0;
  if (data.sportActivity) {
    const s = data.sportActivity;
    if (s.includes('0 дни'))    sportDays = 0;
    else if (s.includes('1–2')) sportDays = 1.5;
    else if (s.includes('2–4')) sportDays = 3;
    else if (s.includes('5–7')) sportDays = 6;
  }
  const combinedScore = Math.min(10, Math.max(1, dailyScore + sportDays));
  return {
    dailyScore, sportDays,
    combinedScore: Math.round(combinedScore * 10) / 10,
    activityLevel: combinedScore <= 3 ? 'Ниска' : combinedScore <= 6 ? 'Средна' : combinedScore <= 8 ? 'Висока' : 'Много висока'
  };
}

function calculateTDEE(bmr, activityLevel) {
  if (typeof activityLevel === 'string') {
    const m = { 'Никаква (0 дни седмично)': 1.2, 'Ниска (1–2 дни седмично)': 1.375,
      'Средна (2–4 дни седмично)': 1.55, 'Висока (5–7 дни седмично)': 1.725, default: 1.4 };
    return Math.round(bmr * (m[activityLevel] || m.default));
  }
  const scoreMultipliers = { 1:1.2, 2:1.3, 3:1.375, 4:1.45, 5:1.525, 6:1.6, 7:1.675, 8:1.75, 9:1.85, 10:1.95 };
  const score = Math.min(10, Math.max(1, Math.round(activityLevel)));
  return Math.round(bmr * (scoreMultipliers[score] || 1.4));
}

function calculateMacronutrientRatios(data, activityScore, tdee) {
  const weight = parseFloat(data.weight) || 70;
  const goal   = data.goal || '';
  let proteinPerKg = data.gender === 'Мъж'
    ? (activityScore >= 7 ? 2.0 : activityScore >= 5 ? 1.6 : 1.2)
    : (activityScore >= 7 ? 1.8 : activityScore >= 5 ? 1.4 : 1.0);
  if (goal.includes('Мускулна маса'))  proteinPerKg *= 1.2;
  else if (goal.includes('Отслабване')) proteinPerKg *= 1.1;
  const estimatedCalories = tdee || (data.gender === 'Мъж' ? weight * 30 : weight * 28);
  let proteinPercent = Math.round((weight * proteinPerKg * 4 / estimatedCalories) * 100);
  const remaining = 100 - proteinPercent;
  let carbsPercent = activityScore >= 7 ? Math.round(remaining * 0.6) : activityScore >= 4 ? Math.round(remaining * 0.5) : Math.round(remaining * 0.4);
  let fatsPercent  = remaining - carbsPercent;
  const total = proteinPercent + carbsPercent + fatsPercent;
  if (total !== 100) fatsPercent += (100 - total);
  return { protein: proteinPercent, carbs: carbsPercent, fats: fatsPercent, proteinGramsPerKg: Math.round(proteinPerKg * 10) / 10 };
}

function calculateSafeDeficit(tdee, goal) {
  if (!goal || !goal.includes('Отслабване')) return { targetCalories: tdee, deficitPercent: 0, maxDeficitCalories: tdee };
  const standardDeficit = 0.18;
  return {
    targetCalories: Math.round(tdee * (1 - standardDeficit)),
    deficitPercent: standardDeficit * 100,
    maxDeficitCalories: Math.round(tdee * 0.75),
    note: 'AI може да коригира при специални стратегии'
  };
}

function buildCombinedAdditionalNotes(data) {
  const sections = [];
  if (data.additionalNotes) sections.push(data.additionalNotes);
  return sections.join('\n\n');
}

function buildCompactAnalysis(analysis) {
  return {
    bmi:         analysis.bmi || null,
    realBMR:     analysis.correctedMetabolism?.realBMR || null,
    realTDEE:    analysis.correctedMetabolism?.realTDEE || null,
    psychoProfile: analysis.psychoProfile || null,
    temperament: analysis.psychoProfile?.temperament || '',
    macroGrams:  analysis.macroGrams || null,
    macroRatios: analysis.macroRatios || null,
    add1: ''
  };
}

function buildCompactAnalysisForStep3(analysis) {
  return {
    bmr:            analysis.bmr || null,
    Final_Calories: analysis.Final_Calories || analysis.recommendedCalories || null,
    macroRatios:    analysis.macroRatios || null,
    macroGrams:     analysis.macroGrams || null
  };
}

function estimateTokenCount(text) {
  if (!text) return 0;
  const cyrillicChars = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const cyrillicRatio = cyrillicChars / text.length;
  const charsPerToken = 4 - cyrillicRatio;
  return Math.ceil(text.length / charsPerToken);
}

/** Замества {variable} и {obj.field} в шаблона (идентично с worker.js) */
function replacePromptVariables(template, variables) {
  return template.replace(/\{([\w.]+)\}/g, (match, key) => {
    const keys = key.split('.');
    let value = variables;
    for (const k of keys) {
      if (value == null || typeof value !== 'object' || !(k in value)) return match;
      value = value[k];
    }
    if (value == null) return '';
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  });
}

function enforceJSONOnlyPrompt(prompt) {
  return `CRITICAL INSTRUCTION: You MUST respond with ONLY a valid JSON object. 
Do not include any explanatory text, markdown formatting, or anything outside the JSON structure.
Your response must start with { or [ and end with } or ].
NO text before the JSON. NO text after the JSON. ONLY JSON.

` + prompt;
}

function parseAIResponse(text) {
  if (!text) return { error: 'Празен отговор' };
  // Strip markdown fences
  let cleaned = text.trim();
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fence) cleaned = fence[1].trim();
  // Find first { or [
  const start = cleaned.search(/[\[{]/);
  if (start > 0) cleaned = cleaned.slice(start);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    return { error: `JSON parse error: ${e.message}`, raw: cleaned.slice(0, 500) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Изграждане на промптове
// ─────────────────────────────────────────────────────────────────────────────

function loadPrompt(name) {
  const filePath = path.join(PROMPTS_DIR, `${name}.txt`);
  if (!fs.existsSync(filePath)) throw new Error(`Промптът не е намерен: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function buildAnalysisPrompt(data) {
  const activityData = calculateUnifiedActivityScore(data);
  const bmr          = calculateBMR(data);
  const tdee         = calculateTDEE(bmr, activityData.combinedScore);
  const deficitData  = calculateSafeDeficit(tdee, data.goal);
  const macros       = calculateMacronutrientRatios(data, activityData.combinedScore, tdee);
  const waterMin     = (parseFloat(data.weight) * WATER_PER_KG_MULTIPLIER + BASE_WATER_NEED_LITERS).toFixed(2);
  const waterMax     = (parseFloat(data.weight) * WATER_PER_KG_MULTIPLIER + BASE_WATER_NEED_LITERS + 0.3).toFixed(2);

  const combinedNotes = buildCombinedAdditionalNotes(data);
  const additionalNotesSection = combinedNotes
    ? `═══ 🔥 ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ (КРИТИЧЕН ПРИОРИТЕТ) 🔥 ═══\n${combinedNotes}\n═══════════════════════════════════════════════════════════════`
    : '';

  const template = loadPrompt('admin_analysis_prompt');
  const prompt = replacePromptVariables(template, {
    userData: JSON.stringify(data, null, 2),
    backendCalculations: JSON.stringify({ activityScore: activityData, bmr, tdee, safeDeficit_reference: deficitData, baselineMacros: macros }, null, 2),
    bmr, tdee,
    activityScore: JSON.stringify(activityData),
    safeDeficit: JSON.stringify(deficitData),
    baselineMacros: JSON.stringify(macros),
    combinedScore: activityData.combinedScore,
    activityLevel: activityData.activityLevel,
    waterMin, waterMax,
    name: data.name, age: data.age, gender: data.gender, weight: data.weight, height: data.height,
    goal: data.goal, lossKg: data.lossKg || '',
    sleepHours: data.sleepHours, sleepInterrupt: data.sleepInterrupt || '',
    chronotype: data.chronotype, sportActivity: data.sportActivity,
    dailyActivityLevel: data.dailyActivityLevel, stressLevel: data.stressLevel,
    waterIntake: data.waterIntake || 'неизвестен',
    medicalConditions: JSON.stringify(data.medicalConditions || []),
    medicalConditions_other: data.medicalConditions_other || '',
    medicalConditions_allergy_details: data['medicalConditions_Алергии'] || '',
    medicalConditions_autoimmune_details: data['medicalConditions_Автоимунно'] || '',
    medicalConditions_cardiovascular_details: data['medicalConditions_Сърдечно-съдови_детайл'] || '',
    medicalConditions_endocrine_details: data['medicalConditions_Ендокринни_детайл'] || '',
    medicalConditions_digestive_details: data['medicalConditions_Храносмилателни_детайл'] || '',
    medicalConditions_metabolic_details: data['medicalConditions_Метаболитни_детайл'] || '',
    medicalConditions_musculoskeletal_details: data['medicalConditions_Мускулно-скелетни_детайл'] || '',
    medications: data.medications, medicationsDetails: data.medicationsDetails || '',
    medicationsText: data.medications === 'Да' ? (data.medicationsDetails || 'Да') : 'Не приема',
    eatingHabits: JSON.stringify(data.eatingHabits || []),
    foodCravings: JSON.stringify(data.foodCravings || []),
    foodCravings_other: data.foodCravings_other || '',
    foodTriggers: JSON.stringify(data.foodTriggers || []),
    foodTriggers_other: data.foodTriggers_other || '',
    compensationMethods: JSON.stringify(data.compensationMethods || []),
    compensationMethods_other: data.compensationMethods_other || '',
    socialComparison: data.socialComparison || '',
    dietHistory: data.dietHistory || '', dietPreference_other: data.dietPreference_other || '',
    goal_other: data.goal_other || '',
    additionalNotes: combinedNotes,
    protocolSpecificAnswers: '',
    additionalNotesSection,
    TEMPERAMENT_CONFIDENCE_THRESHOLD,
    HEALTH_STATUS_UNDERESTIMATE_PERCENT,
    MIN_RECOMMENDED_CALORIES: data.gender === 'Мъж' ? MIN_RECOMMENDED_CALORIES_MALE : MIN_RECOMMENDED_CALORIES_FEMALE,
    MIN_FAT_GRAMS: Math.round((parseFloat(data.weight) || 70) * MIN_FAT_GRAMS_PER_KG),
    clinicalProtocolSection: '',
    clinicalProtocolName: ''
  });
  return enforceJSONOnlyPrompt(prompt);
}

function buildStrategyPrompt(data, analysis) {
  const analysisCompact = buildCompactAnalysis(analysis);
  const combinedNotes   = buildCombinedAdditionalNotes(data);
  const additionalNotesSection = combinedNotes
    ? `═══ ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ (КРИТИЧЕН ПРИОРИТЕТ) ═══\n${combinedNotes}\n═══════════════════════════════════════════════════════════════`
    : '';

  const template = loadPrompt('admin_strategy_prompt');
  const prompt = replacePromptVariables(template, {
    userData: JSON.stringify(data, null, 2),
    analysisData: JSON.stringify(analysisCompact, null, 2),
    name: data.name, age: data.age, goal: data.goal,
    bmi: analysisCompact.bmi,
    realBMR: analysisCompact.realBMR,
    realTDEE: analysisCompact.realTDEE,
    macroProteinG: analysisCompact.macroGrams?.protein ?? '',
    macroCarbsG:   analysisCompact.macroGrams?.carbs   ?? '',
    macroFatsG:    analysisCompact.macroGrams?.fats    ?? '',
    macroProteinPct: analysisCompact.macroRatios?.protein ?? '',
    macroCarbsPct:   analysisCompact.macroRatios?.carbs   ?? '',
    macroFatsPct:    analysisCompact.macroRatios?.fats    ?? '',
    psychoProfile: JSON.stringify(analysisCompact.psychoProfile),
    temperament: analysisCompact.temperament,
    temperamentProbability: analysisCompact.psychoProfile?.probability || 0,
    add1: analysisCompact.add1 || '',
    dietPreference: JSON.stringify(data.dietPreference || []),
    dietPreference_other: data.dietPreference_other || '',
    dietDislike: data.dietDislike || '', dietLove: data.dietLove || '',
    goal_other: data.goal_other || '',
    medicalConditions: JSON.stringify(data.medicalConditions || []),
    medicalConditions_other: data.medicalConditions_other || '',
    medicalConditions_allergy_details: data['medicalConditions_Алергии'] || '',
    medicalConditions_autoimmune_details: data['medicalConditions_Автоимунно'] || '',
    medicalConditions_cardiovascular_details: data['medicalConditions_Сърдечно-съдови_детайл'] || '',
    medicalConditions_endocrine_details: data['medicalConditions_Ендокринни_детайл'] || '',
    medicalConditions_digestive_details: data['medicalConditions_Храносмилателни_детайл'] || '',
    medicalConditions_metabolic_details: data['medicalConditions_Метаболитни_детайл'] || '',
    medicalConditions_musculoskeletal_details: data['medicalConditions_Мускулно-скелетни_детайл'] || '',
    additionalNotes: combinedNotes, protocolSpecificAnswers: '',
    additionalNotesSection,
    eatingHabits: JSON.stringify(data.eatingHabits || []),
    chronotype: data.chronotype || 'Среден тип',
    overeatingFrequency: data.overeatingFrequency || '',
    foodCravings: JSON.stringify(data.foodCravings || []),
    foodCravings_other: data.foodCravings_other || '',
    foodTriggers: JSON.stringify(data.foodTriggers || []),
    foodTriggers_other: data.foodTriggers_other || '',
    compensationMethods: JSON.stringify(data.compensationMethods || []),
    compensationMethods_other: data.compensationMethods_other || '',
    drinksSweet: data.drinksSweet || '', drinksAlcohol: data.drinksAlcohol || '',
    dietHistory: data.dietHistory || '', dietHistoryType: data.dietType || '',
    dietHistoryResult: data.dietResult || '',
    medications: data.medications || 'Не', medicationsDetails: data.medicationsDetails || '',
    medicationsText: data.medications === 'Да' ? (data.medicationsDetails || 'Да') : 'Не приема',
    weightChange: data.weightChange || '', weightChangeDetails: data.weightChangeDetails || '',
    medicalConditionsText: (data.medicalConditions || []).join(', ') || 'Няма',
    allGoals: Array.isArray(data.goal) ? data.goal.join(', ') : (data.goal || ''),
    stressLevel: data.stressLevel || '', sleepHours: data.sleepHours || '',
    TEMPERAMENT_CONFIDENCE_THRESHOLD,
    clinicalProtocolSection: '', clinicalProtocolName: ''
  });
  return enforceJSONOnlyPrompt(prompt);
}

function buildMealPlanPrompt(data, analysis, strategy, startDay = 1, endDay = 7) {
  const analysisCompact = buildCompactAnalysisForStep3(analysis);
  const bmr = analysis.bmr || calculateBMR(data);
  let recommendedCalories = analysis.Final_Calories || analysis.recommendedCalories;
  if (!recommendedCalories) {
    const ad  = calculateUnifiedActivityScore(data);
    const tdee = calculateTDEE(bmr, ad.combinedScore);
    recommendedCalories = data.goal === 'Отслабване' ? Math.round(tdee * 0.85) : tdee;
  }
  const calorieFloor = data.gender === 'Мъж' ? MIN_RECOMMENDED_CALORIES_MALE : MIN_RECOMMENDED_CALORIES_FEMALE;
  if (recommendedCalories < calorieFloor) recommendedCalories = calorieFloor;

  const dietaryModifier = strategy.dietaryModifier || 'Балансирано';
  const freeDayNumber   = strategy.freeDayNumber || null;

  const strategyCompact = {
    dietType: strategy.dietType || 'Балансирана',
    weeklyMealPattern: strategy.weeklyMealPattern || 'Традиционна',
    mealTiming: strategy.mealTiming?.pattern || '3 хранения дневно',
    keyPrinciples: (strategy.keyPrinciples || []).slice(0, 3).join('; '),
    foodsToInclude: (strategy.preferredFoodCategories || []).slice(0, 5).join(', '),
    foodsToAvoid: (strategy.avoidFoodCategories || []).slice(0, 5).join(', '),
    calorieDistribution: strategy.calorieDistribution || '',
    macroDistribution: strategy.macroDistribution || ''
  };

  // Build weekly targets text
  const weeklySchemeByDayText = (() => {
    const lines = [];
    for (let d = startDay; d <= endDay; d++) {
      const key = DAY_NUMBER_TO_KEY[d - 1];
      const dayTarget = strategy.weeklyScheme && strategy.weeklyScheme[key];
      const kcal = dayTarget?.calories || recommendedCalories;
      const macroStr = (dayTarget?.protein && dayTarget?.carbs && dayTarget?.fats)
        ? ` | Б:${dayTarget.protein}г В:${dayTarget.carbs}г М:${dayTarget.fats}г` : '';
      const freeDayNote = (freeDayNumber !== null && d === freeDayNumber) ? ' ← ДЕН С СВОБОДНО ХРАНЕНЕ' : '';
      lines.push(`   Ден ${d} (${DAY_NAMES_BG[key] || key}): ~${kcal} kcal${macroStr} (±${DAILY_CALORIE_TOLERANCE} kcal OK)${freeDayNote}`);
      if (dayTarget?.mealBreakdown && Array.isArray(dayTarget.mealBreakdown)) {
        dayTarget.mealBreakdown.forEach(m => {
          if (m.type === 'Свободно хранене') {
            lines.push(`     → ${m.type}: без фиксирана калорийна цел`);
          } else {
            lines.push(`     → ${m.type}: ~${m.calories} kcal | Б:${m.protein}г В:${m.carbs}г М:${m.fats}г`);
          }
        });
      }
    }
    return lines.join('\n');
  })();

  const hasSweetsCraving = (data.foodCravings || []).some(c => typeof c === 'string' && c.includes('Сладко'));
  const freeMealInstruction = freeDayNumber !== null
    ? `\nСВОБОДЕН ДЕН (Ден ${freeDayNumber}): Добави "Свободно хранене" вместо Хранене 2.`
    : '\nНяма свободен ден тази седмица.';
  const sweetsCravingRule = hasSweetsCraving && strategy?.includeDessert !== false
    ? '\nНУЖДА ОТ СЛАДКО: Добави десерт ("dessert": true) към Хранене 2 в един ден от седмицата.'
    : '';

  const mealNameFormatInstructions = `ФОРМАТ НА ИМЕ: "name" трябва да е конкретно ястие на български (напр. "Пилешко с броколи и ориз").`;

  const combinedNotes = buildCombinedAdditionalNotes(data);
  const additionalNotes = combinedNotes || 'Няма';

  const template = loadPrompt('admin_meal_plan_prompt');
  const prompt = replacePromptVariables(template, {
    startDay, endDay,
    'userData.name': data.name,
    'userData.goal': data.goal,
    'userData.stressLevel': data.stressLevel || '',
    'userData.sleepHours': data.sleepHours || '',
    'userData.chronotype': data.chronotype || '',
    'userData.eatingHabits': JSON.stringify(data.eatingHabits || []),
    bmr, recommendedCalories,
    dietaryModifier,
    modificationsSection: '',
    previousDaysContext: '',
    'analysisCompact.macroRatios': JSON.stringify(analysisCompact.macroRatios || {}),
    'analysisCompact.macroGrams': JSON.stringify(analysisCompact.macroGrams || {}),
    'strategyCompact.dietType': strategyCompact.dietType,
    'strategyCompact.mealTiming': strategyCompact.mealTiming,
    'strategyCompact.keyPrinciples': strategyCompact.keyPrinciples,
    'strategyCompact.foodsToInclude': strategyCompact.foodsToInclude,
    'strategyCompact.foodsToAvoid': strategyCompact.foodsToAvoid,
    'strategyCompact.calorieDistribution': strategyCompact.calorieDistribution,
    'strategyCompact.macroDistribution': strategyCompact.macroDistribution,
    dietLove: data.dietLove || 'няма',
    dietDislike: data.dietDislike || 'няма',
    weeklySchemeByDayText,
    additionalNotes,
    clinicalProtocolSection: '',
    dynamicMainlistSection: '',
    dynamicWhitelistSection: '',
    dynamicBlacklistSection: '',
    DAILY_CALORIE_TOLERANCE,
    MAX_LATE_SNACK_CALORIES,
    'strategyData.mealCountJustification': strategy.mealCountJustification || '3-4 хранения дневно',
    sweetsCravingRule,
    freeMealInstruction,
    MEAL_NAME_FORMAT_INSTRUCTIONS: mealNameFormatInstructions
  });
  return enforceJSONOnlyPrompt(prompt);
}

function buildSummaryPrompt(data, analysis, strategy, mealPlan) {
  const template = loadPrompt('admin_summary_prompt');

  const bmr = analysis.bmr || calculateBMR(data);
  const recommendedCalories = analysis.Final_Calories || analysis.recommendedCalories || 1600;

  // Compute averages from meal plan if available
  let avgCalories = recommendedCalories, avgProtein = 0, avgCarbs = 0, avgFats = 0;
  if (mealPlan) {
    const days = [];
    for (let d = 1; d <= 7; d++) {
      const key = `day${d}`;
      if (mealPlan[key]?.dailyTotals) days.push(mealPlan[key].dailyTotals);
    }
    if (days.length > 0) {
      avgCalories = Math.round(days.reduce((s, d) => s + (d.calories || 0), 0) / days.length);
      avgProtein  = Math.round(days.reduce((s, d) => s + (d.protein || 0),  0) / days.length);
      avgCarbs    = Math.round(days.reduce((s, d) => s + (d.carbs || 0),    0) / days.length);
      avgFats     = Math.round(days.reduce((s, d) => s + (d.fats || 0),     0) / days.length);
    }
  }

  const temperament = analysis.psychoProfile?.temperament || '';
  const temperamentProbability = analysis.psychoProfile?.probability || 0;
  const psychologicalProfile = analysis.psychologicalProfile || '';
  const dietType = strategy.dietType || 'Балансирана';
  const keyProblems = JSON.stringify((analysis.keyProblems || []).map(p => p.title || p));
  const hydrationStrategy = strategy.hydrationStrategy || '2 л вода дневно';
  const combinedNotes = buildCombinedAdditionalNotes(data);
  const additionalNotesSection = combinedNotes
    ? `═══ ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ═══\n${combinedNotes}\n═══════════════════════════════════════════`
    : '';

  const prompt = replacePromptVariables(template, {
    name: data.name, goal: data.goal, bmr, recommendedCalories, avgCalories,
    avgProtein, avgCarbs, avgFats,
    temperament, temperamentProbability, psychologicalProfile, dietType,
    keyProblems, medications: data.medications || 'Не',
    additionalNotesSection, clinicalProtocolSection: '',
    clinicalProtocolSupplementSection: '',
    dynamicWhitelistSection: '', dynamicBlacklistSection: '',
    hydrationStrategy
  });
  return enforceJSONOnlyPrompt(prompt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Извикване на Gemini API
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini(apiKey, prompt, modelName = 'gemini-2.5-flash', maxTokens = 8192) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 }  // Disable thinking for plan steps (same as worker.js)
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API грешка ${response.status}: ${errText.slice(0, 500)}`);
  }

  const data = await response.json();

  if (data.candidates?.[0]) {
    const candidate = data.candidates[0];
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      if (candidate.finishReason === 'MAX_TOKENS' && candidate.content?.parts?.[0]) {
        console.warn(`  ⚠️  MAX_TOKENS — частичен отговор`);
        return candidate.content.parts[0].text;
      }
      throw new Error(`Gemini спря: ${candidate.finishReason}`);
    }
    if (!candidate.content?.parts?.[0]) throw new Error('Gemini върна празен отговор');
    return candidate.content.parts[0].text;
  }

  throw new Error('Невалиден формат на отговор от Gemini');
}

// ─────────────────────────────────────────────────────────────────────────────
// Форматиране на изхода
// ─────────────────────────────────────────────────────────────────────────────

function formatAnalysisSummary(parsed) {
  if (parsed.error) return `  ❌ Грешка при парсване: ${parsed.error}`;
  const lines = [
    `  BMI: ${parsed.bmi} (${parsed.bmiCategory})`,
    `  BMR: ${parsed.bmr} kcal | TDEE: ${parsed.tdee} kcal | Финални калории: ${parsed.Final_Calories} kcal`,
    `  Макроси: Б${parsed.macroGrams?.protein}г / В${parsed.macroGrams?.carbs}г / М${parsed.macroGrams?.fats}г`,
    `  Темперамент: ${parsed.psychoProfile?.temperament || '—'} (${parsed.psychoProfile?.probability || 0}%)`,
    `  Здравен статус: ${parsed.currentHealthStatus?.score}/100`,
    `  Ключови проблеми: ${(parsed.keyProblems || []).map(p => p.title || p).join(', ') || '—'}`
  ];
  return lines.join('\n');
}

function formatStrategySummary(parsed) {
  if (parsed.error) return `  ❌ Грешка при парсване: ${parsed.error}`;
  const scheme = parsed.weeklyScheme || {};
  const lines = [
    `  Тип диета: ${parsed.dietType}`,
    `  Модификатор: ${parsed.dietaryModifier}`,
    `  Свободен ден: ${parsed.freeDayNumber != null ? `Ден ${parsed.freeDayNumber}` : 'Не'}`,
    `  Десерт: ${parsed.includeDessert ? 'Да' : 'Не'}`,
    `  Седмична схема (калории):`,
    ...Object.entries(scheme).map(([day, v]) =>
      `    ${DAY_NAMES_BG[day] || day}: ${v?.calories || '?'} kcal (${v?.meals || '?'} хранения)`)
  ];
  return lines.join('\n');
}

function formatMealPlanSummary(parsed) {
  if (parsed.error) return `  ❌ Грешка при парсване: ${parsed.error}`;
  const lines = ['  Дни:'];
  for (let d = 1; d <= 7; d++) {
    const key = `day${d}`;
    const dayData = parsed[key];
    if (!dayData) { lines.push(`    Ден ${d}: ЛИПСВА`); continue; }
    const totals = dayData.dailyTotals || {};
    const meals  = (dayData.meals || []).map(m => m.name || m.type).join(' / ');
    lines.push(`    Ден ${d}: ${totals.calories || '?'} kcal — ${meals}`);
  }
  return lines.join('\n');
}

function formatSummarySummary(parsed) {
  if (parsed.error) return `  ❌ Грешка при парсване: ${parsed.error}`;
  return [
    `  Препоръки: ${(parsed.recommendations || []).slice(0, 3).join(', ')}...`,
    `  Забранени: ${(parsed.forbidden || []).slice(0, 3).join(', ')}...`,
    `  Добавки: ${(parsed.supplements || []).slice(0, 2).join(', ')}...`
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Главна логика
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args   = process.argv.slice(2);
  const result = { step: 'all', model: 'gemini-2.5-flash', userFile: null, chain: true, verbose: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--step'    && args[i+1]) { result.step = args[++i]; }
    if (args[i] === '--model'   && args[i+1]) { result.model = args[++i]; }
    if (args[i] === '--user'    && args[i+1]) { result.userFile = args[++i]; }
    if (args[i] === '--no-chain')              { result.chain = false; }
    if (args[i] === '--verbose')               { result.verbose = true; }
    if (args[i] === '--dry-run')               { result.dryRun = true; }
  }
  return result;
}

function saveResult(stepName, timestamp, prompt, rawResponse, parsedResponse) {
  const fileName = path.join(RESULTS_DIR, `${timestamp}_${stepName}.json`);
  const data = {
    step: stepName,
    timestamp: new Date().toISOString(),
    promptTokens: estimateTokenCount(prompt),
    responseTokens: estimateTokenCount(rawResponse),
    prompt: prompt,
    rawResponse: rawResponse,
    parsedResponse: parsedResponse
  };
  fs.writeFileSync(fileName, JSON.stringify(data, null, 2), 'utf8');
  return fileName;
}

async function runStep(stepNum, opts, userData, prevResults, timestamp, apiKey) {
  const stepNames = { 1: 'step1_analysis', 2: 'step2_strategy', 3: 'step3_meal_plan', 4: 'step4_summary' };
  const stepName  = stepNames[stepNum];

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  СТЪПКА ${stepNum}: ${stepName.toUpperCase()}`);
  console.log(`${'═'.repeat(70)}`);

  // Build prompt
  let prompt;
  try {
    if (stepNum === 1) {
      prompt = buildAnalysisPrompt(userData);
    } else if (stepNum === 2) {
      const analysis = opts.chain && prevResults[1]?.parsed || {};
      prompt = buildStrategyPrompt(userData, analysis);
    } else if (stepNum === 3) {
      const analysis = opts.chain && prevResults[1]?.parsed || {};
      const strategy = opts.chain && prevResults[2]?.parsed || {};
      prompt = buildMealPlanPrompt(userData, analysis, strategy);
    } else if (stepNum === 4) {
      const analysis = opts.chain && prevResults[1]?.parsed || {};
      const strategy = opts.chain && prevResults[2]?.parsed || {};
      const mealPlan = opts.chain && prevResults[3]?.parsed || null;
      prompt = buildSummaryPrompt(userData, analysis, strategy, mealPlan);
    }
  } catch (err) {
    console.error(`  ❌ Грешка при изграждане на промпт: ${err.message}`);
    return null;
  }

  const tokens = estimateTokenCount(prompt);
  console.log(`  📝 Промпт: ~${tokens} токена`);

  if (opts.verbose) {
    console.log('\n  ── ПРОМПТ (начало) ──');
    console.log(prompt.slice(0, 1500));
    if (prompt.length > 1500) console.log(`  ... (${prompt.length - 1500} символа още) ...`);
    console.log('  ── КРАЙ НА ПРОМПТА ──\n');
  }

  if (opts.dryRun) {
    console.log('  ⏭️  Dry-run режим — пропускам изпращането');
    return null;
  }

  console.log(`  🚀 Изпращам към Gemini (${opts.model})...`);
  const startTime = Date.now();

  let rawResponse, parsed;
  try {
    rawResponse = await callGemini(apiKey, prompt, opts.model, 8192);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ✅ Отговор получен за ${elapsed}с (~${estimateTokenCount(rawResponse)} токена)`);
  } catch (err) {
    console.error(`  ❌ API грешка: ${err.message}`);
    return null;
  }

  parsed = parseAIResponse(rawResponse);

  // Show summary
  if (stepNum === 1) console.log(formatAnalysisSummary(parsed));
  else if (stepNum === 2) console.log(formatStrategySummary(parsed));
  else if (stepNum === 3) console.log(formatMealPlanSummary(parsed));
  else if (stepNum === 4) console.log(formatSummarySummary(parsed));

  // Save to file
  const savedFile = saveResult(stepName, timestamp, prompt, rawResponse, parsed);
  console.log(`  💾 Запазено: ${path.relative(ROOT_DIR, savedFile)}`);

  return { raw: rawResponse, parsed };
}

async function main() {
  const opts = parseArgs();

  // Load API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !opts.dryRun) {
    console.error('❌ Липсва GEMINI_API_KEY. Задайте: export GEMINI_API_KEY=вашия_ключ');
    process.exit(1);
  }

  // Load user data
  let userData = DEFAULT_USER_DATA;
  if (opts.userFile) {
    try {
      userData = JSON.parse(fs.readFileSync(opts.userFile, 'utf8'));
      console.log(`👤 Зареден потребителски профил от: ${opts.userFile}`);
    } catch (err) {
      console.error(`❌ Грешка при четене на ${opts.userFile}: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log(`👤 Тестови профил: ${userData.name}, ${userData.age} год., ${userData.gender}, ${userData.weight} кг, цел: ${userData.goal}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  console.log(`\n🧪 Тест: ${timestamp} | Модел: ${opts.model} | Стъпка(и): ${opts.step}`);
  console.log(`📁 Резултати: ${path.relative(ROOT_DIR, RESULTS_DIR)}/`);

  // Determine which steps to run
  const stepsToRun = opts.step === 'all' ? [1, 2, 3, 4] : opts.step.split(',').map(Number).filter(n => n >= 1 && n <= 4);

  const prevResults = {};
  let totalStart = Date.now();

  for (const stepNum of stepsToRun) {
    const result = await runStep(stepNum, opts, userData, prevResults, timestamp, apiKey);
    if (result) prevResults[stepNum] = result;
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ✅ Завършено за ${totalElapsed}с`);
  if (!opts.dryRun) {
    console.log(`  📂 Всички файлове в: ${path.relative(ROOT_DIR, RESULTS_DIR)}/`);
    const files = fs.readdirSync(RESULTS_DIR).filter(f => f.startsWith(timestamp));
    files.forEach(f => console.log(`     • ${f}`));
  }
  console.log(`${'═'.repeat(70)}\n`);
}

main().catch(err => {
  console.error('\n❌ Неочаквана грешка:', err.message);
  process.exit(1);
});
