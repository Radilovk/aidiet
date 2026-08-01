#!/usr/bin/env node
import {
  rebalanceMealBreakdownSlots,
  normalizeAnalysisOutput,
  enforceKetoMacroGuardrails,
  enforceKetoStrategyGuardrails,
  syncSchemeDayMetadata,
  isKetoCarbCompliant,
  maxKetoCarbGrams,
  severityLabelForValue,
  validateLightMealSlotContent,
  repairMeal3IfInvalid,
  repairMeal5IfInvalid,
  validateLateSnackSlotContent,
  removeBreakfastSlotFromDay,
  userSkipsBreakfast,
  isMealCaloriesAdequate,
  slotCalorieTolerance,
  enforceFixedSlotCaps,
  MAX_LATE_SNACK_CALORIES,
  MAX_AFTERNOON_SNACK_CALORIES,
} from '../plan-normalize.js';
import { applyMealNutritionFromDatabase } from '../food-nutrition.js';

const results = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

// Kamen-like: skip breakfast, high TDEE, bad AI distribution
{
  const day = {
    calories: 2774,
    mealBreakdown: [
      { type: 'Хранене 2', calories: 900, protein: 60, carbs: 80, fats: 30 },
      { type: 'Хранене 3', calories: 250, protein: 10, carbs: 20, fats: 10 },
      { type: 'Хранене 4', calories: 1424, protein: 90, carbs: 120, fats: 50 },
      { type: 'Хранене 5', calories: 200, protein: 15, carbs: 5, fats: 12 },
    ],
  };
  rebalanceMealBreakdownSlots(day, 2774);
  const sum = day.mealBreakdown.reduce((s, m) => s + m.calories, 0);
  const h3 = day.mealBreakdown.find(m => m.type === 'Хранене 3');
  check('Kamen-like: H3 ≤ snack cap', h3.calories <= MAX_AFTERNOON_SNACK_CALORIES, `${h3?.calories}`);
  check('Kamen-like: дневната сума запазена', Math.abs(sum - 2774) <= 30, `sum=${sum}`);
}

// Free day oversized budget
{
  const day = {
    calories: 2774,
    mealBreakdown: [
      { type: 'Свободно хранене', calories: 1200, protein: 40, carbs: 100, fats: 50 },
      { type: 'Хранене 4', calories: 1374, protein: 80, carbs: 100, fats: 45 },
      { type: 'Хранене 5', calories: 200, protein: 15, carbs: 5, fats: 12 },
    ],
  };
  rebalanceMealBreakdownSlots(day, 2774);
  const free = day.mealBreakdown.find(m => m.type === 'Свободно хранене');
  const maxFree = Math.round(2774 * 0.45);
  check('Free meal: cap на ~45% от дневните', free.calories <= maxFree, `${free.calories} ≤ ${maxFree}`);
}

// Analysis: severity label drift
{
  const analysis = {
    keyProblems: [
      { title: 'Компенсаторно поведение', severity: 'Borderline', severityValue: 60 },
      { title: 'Стрес', severity: 'Risky', severityValue: 70 },
    ],
    currentHealthStatus: {},
  };
  normalizeAnalysisOutput(analysis);
  check('Analysis: severity label от value', analysis.keyProblems[0].severity === 'Risky');
  check('Analysis: health score попълнен', typeof analysis.currentHealthStatus.score === 'number');
}

check('severityLabelForValue(60)=Risky', severityLabelForValue(60) === 'Risky');

{
  const day = {
    calories: 2774,
    mealBreakdown: [
      { type: 'Свободно хранене', calories: 1200, protein: 40, carbs: 100, fats: 50 },
      { type: 'Хранене 3', calories: 250, protein: 10, carbs: 20, fats: 10 },
      { type: 'Хранене 4', calories: 1063, protein: 70, carbs: 80, fats: 40 },
      { type: 'Хранене 5', calories: 200, protein: 15, carbs: 5, fats: 12 },
    ],
  };
  rebalanceMealBreakdownSlots(day, 2774);
  const h4 = day.mealBreakdown.find(m => m.type === 'Хранене 4');
  check('free day: H4 capped ≤600', h4.calories <= 600, `${h4.calories} kcal`);
}

{
  const day = {
    calories: 2774,
    mealBreakdown: [
      { type: 'Свободно хранене', calories: 1248, protein: 40, carbs: 100, fats: 50 },
      { type: 'Хранене 3', calories: 250, protein: 10, carbs: 20, fats: 10 },
      { type: 'Хранене 4', calories: 1074, protein: 70, carbs: 80, fats: 40 },
      { type: 'Хранене 5', calories: 200, protein: 15, carbs: 5, fats: 12 },
    ],
  };
  rebalanceMealBreakdownSlots(day, 2774);
  const h3 = day.mealBreakdown.find(m => m.type === 'Хранене 3');
  check('free day: H3 capped ≤350', h3.calories <= MAX_AFTERNOON_SNACK_CALORIES, `${h3?.calories} kcal`);
}

{
  const day = {
    calories: 2774,
    mealBreakdown: [
      { type: 'Хранене 2', calories: 900, protein: 60, carbs: 80, fats: 30 },
      { type: 'Хранене 3', calories: 437, protein: 20, carbs: 40, fats: 15 },
      { type: 'Хранене 4', calories: 600, protein: 50, carbs: 50, fats: 20 },
      { type: 'Хранене 5', calories: 204, protein: 15, carbs: 8, fats: 10 },
    ],
  };
  enforceFixedSlotCaps(day, 2774);
  const h3 = day.mealBreakdown.find(m => m.type === 'Хранене 3');
  const h5 = day.mealBreakdown.find(m => m.type === 'Хранене 5');
  check('enforceFixedSlotCaps: H3 ≤350', h3.calories <= 350, `${h3.calories}`);
  check('enforceFixedSlotCaps: H5 ≤200', h5.calories <= 200, `${h5.calories}`);
}

{
  const errs = validateLightMealSlotContent({ type: 'Хранене 3', name: 'Говеждо с броколи', description: '• говеждо 150g' }, 6);
  check('H3 rejects cooked meat', errs.length > 0);
}

{
  const meal = { type: 'Хранене 3', name: 'Говеждо с боб и салата', description: '• говеждо 100g' };
  const repaired = repairMeal3IfInvalid(meal, { dietPreference: ['Веган'] });
  check('H3 repair: vegan replaces invalid meal', repaired);
  check('H3 repair: vegan template valid', validateLightMealSlotContent(meal).length === 0);
}

{
  const analysis = {
    keyProblems: [
      { title: 'A', severity: 'Risky', severityValue: 70 },
      { title: 'B', severity: 'Borderline', severityValue: 50 },
      { title: 'C', severity: 'Normal', severityValue: 30 },
    ],
    hinderingFactors: [{ factor: 'D', severity: 3, description: 'factor D' }],
  };
  analysis.keyProblems = analysis.keyProblems.filter(p => p.severity !== 'Normal');
  normalizeAnalysisOutput(analysis);
  check('Analysis: after Normal filter pads to ≥3', analysis.keyProblems.length >= 3, `${analysis.keyProblems.length}`);
}

{
  const analysis = {
    keyProblems: [
      { title: 'Недостатъчен протеин', severity: 'Risky', severityValue: 68 },
      { title: 'Ниска хидратация', severity: 'Borderline', severityValue: 52 },
    ],
    hinderingFactors: [{ factor: 'Висока тренировъчна натовареност', severity: 3, description: 'риск от дефицит' }],
  };
  normalizeAnalysisOutput(analysis);
  check('Analysis: 2 problems + hinderingFactor → ≥3', analysis.keyProblems.length >= 3, `${analysis.keyProblems.length}`);
}

{
  const analysis = {
    keyProblems: [
      { title: 'Потенциален дефицит на микронутриенти', severity: 'Risky', severityValue: 68, description: 'x', category: 'Health', impact: 'x' },
      { title: 'Риск от недостатъчен протеинов прием', severity: 'Borderline', severityValue: 52, description: 'x', category: 'Health', impact: 'x' },
    ],
    healthRisks: ['Потенциален дефицит на витамин B12 поради веганска диета.'],
    nutritionalNeeds: ['Осигуряване на адекватен прием на витамин B12 чрез обогатени храни или добавки.'],
  };
  normalizeAnalysisOutput(analysis);
  check('Analysis: vegan-like 2 problems + risks → ≥3', analysis.keyProblems.length >= 3, `${analysis.keyProblems.length}`);
}

{
  const analysis = {
    keyProblems: [{ title: 'Стрес', severity: 'Risky', severityValue: 70 }],
    currentHealthStatus: { score: 62, description: 'Много лошо здравословно състояние с критични проблеми.' },
  };
  normalizeAnalysisOutput(analysis);
  check('Analysis: neutralize negative tone when score ≥50', !/критичн|много лош/i.test(analysis.currentHealthStatus.description));
}

{
  const analysis = {
    keyProblems: [{ title: 'Висок енергиен разход', severity: 'Borderline', severityValue: 52, description: 'd', category: 'Health', impact: 'i' }],
    currentHealthStatus: { score: 68, description: 'Добро общо здравословно състояние с фокус върху спортното представяне и възстановяването.' },
  };
  const profile = {
    goal: 'Мускулна маса',
    sportActivity: 'Много висока (ежедневно)',
    dailyActivityLevel: 'Много високо',
  };
  normalizeAnalysisOutput(analysis, profile);
  check('Analysis: ultra-active pads to ≥3 keyProblems', analysis.keyProblems.length >= 3, `${analysis.keyProblems.length}`);
}

{
  const analysis = {
    Final_Calories: 1800,
    macroGrams: { protein: 100, carbs: 180, fats: 80 },
    macroRatios: { protein: 22, carbs: 40, fats: 38 },
  };
  enforceKetoMacroGuardrails(analysis, { dietPreference: ['Кето'], weight: '70' });
  const carbPct = Math.round((analysis.macroGrams.carbs * 4 / analysis.Final_Calories) * 100);
  check('Keto guardrails: carbs ≤15%', carbPct <= 15, `${carbPct}%`);
  check('Keto guardrails: strict ratio', isKetoCarbCompliant(analysis.Final_Calories, analysis.macroGrams.carbs));
  check('Keto guardrails: macro kcal match', Math.abs(
    analysis.macroGrams.protein * 4 + analysis.macroGrams.carbs * 4 + analysis.macroGrams.fats * 9 - 1800,
  ) <= 25);
}

{
  const fc = 2096;
  check('Keto max carbs 2096kcal uses floor', maxKetoCarbGrams(fc) === 78, `${maxKetoCarbGrams(fc)}g`);
  const analysis = {
    Final_Calories: fc,
    macroGrams: { protein: 125, carbs: 79, fats: 134 },
    macroRatios: { protein: 24, carbs: 15, fats: 61 },
  };
  enforceKetoMacroGuardrails(analysis, { dietPreference: ['Кето'], weight: '92' });
  check('Keto boundary 2096: compliant', isKetoCarbCompliant(fc, analysis.macroGrams.carbs));
}

{
  const strategy = {
    weeklyScheme: {
      tuesday: {
        calories: 2096,
        protein: 130,
        carbs: 82,
        fats: 140,
        mealBreakdown: [
          { type: 'Хранене 2', calories: 700, protein: 45, carbs: 30, fats: 45 },
          { type: 'Хранене 3', calories: 250, protein: 10, carbs: 12, fats: 15 },
          { type: 'Хранене 4', calories: 800, protein: 55, carbs: 28, fats: 50 },
          { type: 'Хранене 5', calories: 346, protein: 20, carbs: 12, fats: 30 },
        ],
      },
    },
  };
  enforceKetoStrategyGuardrails(strategy, { dietPreference: ['Кето'], weight: '92' });
  const day = strategy.weeklyScheme.tuesday;
  check('Keto strategy: day carbs compliant', isKetoCarbCompliant(day.calories, day.carbs), `${day.carbs}g`);
}

{
  const day = {
    meals: 4,
    calories: 1650,
    protein: 100,
    carbs: 120,
    fats: 80,
    mealBreakdown: [
      { type: 'Свободно хранене', calories: 800, protein: 30, carbs: 60, fats: 40 },
      { type: 'Хранене 3', calories: 250, protein: 10, carbs: 20, fats: 10 },
      { type: 'Хранене 4', calories: 600, protein: 60, carbs: 40, fats: 30 },
    ],
  };
  syncSchemeDayMetadata(day);
  check('syncSchemeDayMetadata: meals matches breakdown', day.meals === 3, `${day.meals}`);
  check('syncSchemeDayMetadata: totals from slots', day.calories === 1650);
}

{
  const breakdown = [
    { type: 'Хранене 2', calories: 700, protein: 45, carbs: 30, fats: 45 },
    { type: 'Хранене 3', calories: 250, protein: 10, carbs: 12, fats: 15 },
    { type: 'Хранене 4', calories: 800, protein: 55, carbs: 28, fats: 50 },
    { type: 'Хранене 5', calories: 346, protein: 20, carbs: 9, fats: 30 },
  ];
  const day = { calories: 2096, mealBreakdown: breakdown };
  enforceKetoStrategyGuardrails(
    { weeklyScheme: { monday: day } },
    { dietPreference: ['Кето'], weight: '92' },
  );
  check('Keto reconcile: 79g drift fixed', isKetoCarbCompliant(2096, day.carbs), `${day.carbs}g`);
}

{
  const meal = { type: 'Хранене 3', name: 'Гръцки йогурт с бадеми и мед', description: '• йогурт 150g\n• бадеми 15g\n• мед 10g' };
  check('H3 rejects honey', validateLightMealSlotContent(meal).length > 0);
  const repaired = repairMeal3IfInvalid(meal, { dietPreference: [] });
  check('H3 repair: honey meal replaced', repaired);
  check('H3 repair: no honey in template', !/мед/.test(meal.description));
}

check('MAX_LATE_SNACK_CALORIES=200', MAX_LATE_SNACK_CALORIES === 200);

{
  check('adequacy: 836 vs 900 within 10%', isMealCaloriesAdequate(836, 900));
  check('adequacy: 562 vs 611 within 10%', isMealCaloriesAdequate(562, 611));
  check('adequacy: 700 vs 900 outside 10%', !isMealCaloriesAdequate(700, 900));
  check('adequacy tolerance 900→90', slotCalorieTolerance(900) === 90);
  check('H5 206 vs 200 within tolerance', isMealCaloriesAdequate(206, 200));
  check('H5 under-cap passes validation', validateLateSnackSlotContent({
    type: 'Хранене 5', name: 'Скир с бадеми', description: '• скир 100g\n• бадеми 10g', calories: 165,
  }).length === 0);
}

{
  const meal = { type: 'Хранене 5', name: 'Банан', description: '• Банан 150g', calories: 120 };
  check('H5 rejects fruit', validateLateSnackSlotContent(meal).length > 0);
  const h5 = { type: 'Хранене 5', name: 'Ориз', description: '• Ориз 100g' };
  const repaired5 = repairMeal5IfInvalid(h5, { dietPreference: [] });
  check('H5 repair: replaces invalid meal', repaired5);
  check('H5 repair: template valid', validateLateSnackSlotContent(h5).length === 0);
}

{
  const day = {
    meals: 4,
    mealBreakdown: [
      { type: 'Хранене 1', calories: 400, protein: 25, carbs: 40, fats: 12 },
      { type: 'Хранене 2', calories: 700, protein: 50, carbs: 60, fats: 20 },
      { type: 'Хранене 4', calories: 600, protein: 45, carbs: 50, fats: 18 },
    ],
  };
  removeBreakfastSlotFromDay(day);
  check('skip breakfast: H1 removed', !day.mealBreakdown.some(m => m.type === 'Хранене 1'));
  check('skip breakfast: kcal preserved', day.mealBreakdown.reduce((s, m) => s + m.calories, 0) === 1700);
}

{
  const meal = { type: 'Хранене 5', name: 'Скир с бадеми', description: '• Скир 120g\n• Бадеми 15g' };
  applyMealNutritionFromDatabase(meal, { calories: 200, protein: 20, carbs: 8, fats: 10 });
  check('H5 meal sync clamped ≤200', meal.calories <= MAX_LATE_SNACK_CALORIES, `${meal.calories} kcal`);
}

const passed = results.filter(Boolean).length;
console.log(`\n=== ${passed}/${results.length} PASS ===`);
process.exit(passed === results.length ? 0 : 1);
