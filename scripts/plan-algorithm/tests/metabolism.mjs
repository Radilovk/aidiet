#!/usr/bin/env node
import {
  calculateBMR,
  calculateUnifiedActivityScore,
  calculateTDEE,
  calculateSafeDeficit,
  calculateMacronutrientRatios,
  enforceCalorieGuardrails,
  getMinRecommendedCalories,
  MIN_FAT_GRAMS_PER_KG,
  MAX_DEFICIT_RATIO,
  macrosToCalories,
} from '../../../plan-pipeline-pure.js';

const results = [];
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

const woman = {
  gender: 'Жена', weight: 70, height: 165, age: 35,
  dailyActivityLevel: 'Средно', sportActivity: '2–4 дни седмично',
  goal: 'Отслабване',
};

console.log('-- Metabolism / dietetic math --');

const bmr = calculateBMR(woman);
check('BMR Mifflin-St Jeor (жена)', bmr === Math.round(10 * 70 + 6.25 * 165 - 5 * 35 - 161), `bmr=${bmr}`);

const activity = calculateUnifiedActivityScore(woman);
check('activity score в 1–10', activity.combinedScore >= 1 && activity.combinedScore <= 10, `score=${activity.combinedScore}`);

const tdee = calculateTDEE(bmr, activity.combinedScore);
check('TDEE > BMR', tdee > bmr, `tdee=${tdee}`);

const deficit = calculateSafeDeficit(tdee, 'Отслабване');
check('safe deficit ≤ 25%', deficit.maxDeficitCalories === Math.round(tdee * (1 - MAX_DEFICIT_RATIO)));
check('standard target ~18% дефицит', deficit.targetCalories === Math.round(tdee * 0.82));

const ratios = calculateMacronutrientRatios(woman, activity.combinedScore, tdee);
check('макроси сумират 100%', ratios.protein + ratios.carbs + ratios.fats === 100, JSON.stringify(ratios));
check('protein g/kg разумен', ratios.proteinGramsPerKg >= 1.0 && ratios.proteinGramsPerKg <= 2.5);

const minCal = getMinRecommendedCalories('Жена');
check('женски калориен под = 1200', minCal === 1200);
check('мъжки калориен под = 1500', getMinRecommendedCalories('Мъж') === 1500);

{
  const analysis = {
    Final_Calories: Math.round(tdee * 0.5),
    tdee,
    macroRatios: { protein: 30, carbs: 40, fats: 30 },
    macroGrams: {},
    correctedMetabolism: {},
  };
  enforceCalorieGuardrails(analysis, woman, tdee);
  const minAllowed = Math.round(tdee * (1 - MAX_DEFICIT_RATIO));
  check('guardrail: дефицит ≤25%', analysis.Final_Calories >= minAllowed, `fc=${analysis.Final_Calories}`);
  check('guardrail: ≥ gender floor', analysis.Final_Calories >= minCal);
  check('guardrail: realTDEE sync', analysis.correctedMetabolism.realTDEE === analysis.Final_Calories);
  check('guardrail: fats ≥ 0.7g/kg', analysis.macroGrams.fats >= Math.round(70 * MIN_FAT_GRAMS_PER_KG));
  const macroKcal = macrosToCalories(analysis.macroGrams);
  check('guardrail: macroGrams ≈ Final_Calories', Math.abs(macroKcal - analysis.Final_Calories) <= 20, `macroKcal=${macroKcal}`);
}

{
  const analysis = {
    Final_Calories: 900,
    tdee: 2000,
    macroRatios: { protein: 30, carbs: 40, fats: 30 },
    macroGrams: {},
    correctedMetabolism: {},
  };
  enforceCalorieGuardrails(analysis, { ...woman, clinicalProtocol: 'postpartum_lactation', goal: 'Отслабване' }, 2000);
  check('лактация: без 25% deficit clamp (само gender floor)', analysis.Final_Calories === 1200, `fc=${analysis.Final_Calories}`);
}

{
  let threw = false;
  try { calculateBMR({ gender: 'Жена', weight: 0, height: 165, age: 30 }); } catch { threw = true; }
  check('BMR отказва невалидни данни', threw);
}

const passed = results.filter(Boolean).length;
console.log(`\nmetabolism: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
