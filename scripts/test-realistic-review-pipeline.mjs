#!/usr/bin/env node
/**
 * Realistic offline simulation — measures reviewer impact on plan coherence.
 * Full week generation + adequacy validators; compares legacy vs reviewer pipeline.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { HARD_PROFILES } from './plan-adequacy/fixtures/hard-profiles.mjs';
import {
  buildEnergyContract,
  applyDeterministicEnergyContract,
  applyBoundedMetabolicReview,
} from '../step1-deterministic.js';
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { syncWeekPlanNutritionFromDatabase } from '../meal-day-sync.js';
import { applyStrategyReviewAdjustments } from '../step2-strategy-reviewer.js';
import { validateProtocolStrategy } from '../protocol-validate.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { validateDietetic } from './plan-adequacy/validators/dietetic.mjs';
import { validateProfileRules } from './plan-adequacy/validators/profile-rules.mjs';
import { validateWeekPlanNutrition } from './plan-adequacy/validators/nutrition.mjs';
import { validateWeekPlanFoods } from './plan-adequacy/validators/foods.mjs';
import { validateWeekPlanCombinations } from './plan-adequacy/validators/combinations.mjs';
import {
  validateWeekPlanDayCoherence,
  validateWeeklyDishVariety,
} from '../meal-combinations.js';
import { minCaloriesForGender } from './plan-adequacy/fixtures/profiles.mjs';
import { userSkipsBreakfast } from './plan-adequacy/validators/profile-rules.mjs';

const MIN_FAT_PER_KG = 0.7;
const MAX_DEFICIT_RATIO = 0.25;
const ARTIFACT_DIR = '/opt/cursor/artifacts';

const REVIEW_SCENARIOS = [
  {
    id: 'ibs_free_text',
    profile: {
      id: 'ibs_free_text',
      name: 'Гергана',
      gender: 'Жена',
      age: '38',
      height: '165',
      weight: '72',
      goal: 'Отслабване',
      lossKg: '8',
      sleepHours: '6–7',
      stressLevel: 'Средно',
      sportActivity: 'Средна (2–4 дни седмично)',
      eatingHabits: ['3 хранения'],
      medicalConditions: ['Храносмилателни проблеми'],
      medications: 'Не',
      additionalNotes:
        'IBS с подуване. Категорично избягвам лук, чесън, боб, зеле, пшеница. Предпочитам ориз, картофи, яйца, риба.',
      dq_gi_triggers: 'лук, чесън, боб, зеле',
      _dq_text_map: { dq_gi_triggers: 'Храносмилателни тригери' },
    },
    ai: { clinical: -2, metabolic: -3 },
    strategyReview: {
      verdict: 'ADJUST',
      libraryDietProfile: 'low_fodmap',
      dietaryModifier: 'Low-FODMAP',
      modifierReasoning: 'IBS и FODMAP тригери в свободния текст и dq отговори.',
      foodsToInclude: ['ориз', 'картофи', 'яйца', 'риба', 'моркови'],
      foodsToAvoid: ['лук', 'чесън', 'боб', 'зеле', 'пшеница'],
      includeDessert: false,
    },
  },
  {
    id: 'hypothyroid_structured',
    profile: {
      id: 'hypothyroid_structured',
      name: 'Елена',
      gender: 'Жена',
      age: '45',
      height: '168',
      weight: '78',
      goal: 'Отслабване',
      lossKg: '10',
      sleepHours: '7–8',
      stressLevel: 'Средно',
      sportActivity: 'Ниска (0–1 ден седмично)',
      medicalConditions: ['Хипотиреоидизъм'],
      medications: 'L-тироксин',
      eatingHabits: ['3 хранения'],
    },
    ai: { clinical: 0, metabolic: 0 },
    strategyReview: null,
  },
];

function goalIncludes(goal, keyword) {
  const kw = String(keyword).toLowerCase();
  const g = Array.isArray(goal) ? goal.join(' ') : String(goal || '');
  return g.toLowerCase().includes(kw);
}

function activityScore(data) {
  const daily = { Ниско: 1, Средно: 2, Високо: 3 }[data.dailyActivityLevel] || 2;
  let sport = 0;
  const s = data.sportActivity || '';
  if (s.includes('0 дни')) sport = 0;
  else if (s.includes('1–2')) sport = 1.5;
  else if (s.includes('2–4')) sport = 3;
  else if (s.includes('5–7')) sport = 6;
  return Math.min(10, Math.max(1, daily + sport));
}

function bmr(data) {
  const w = parseFloat(data.weight);
  const h = parseFloat(data.height);
  const a = parseFloat(data.age);
  return Math.round(10 * w + 6.25 * h - 5 * a + (data.gender === 'Мъж' ? 5 : -161));
}

function tdeeFromScore(bmrVal, score) {
  const mult = { 1: 1.2, 2: 1.3, 3: 1.375, 4: 1.45, 5: 1.525, 6: 1.6, 7: 1.675, 8: 1.75, 9: 1.85, 10: 1.95 };
  return Math.round(bmrVal * (mult[Math.round(score)] || mult[5]));
}

function macroRatios(data, score, tdeeVal) {
  const weight = parseFloat(data.weight) || 70;
  const gender = data.gender;
  let proteinPerKg = gender === 'Мъж'
    ? (score >= 7 ? 2.0 : score >= 5 ? 1.6 : 1.2)
    : (score >= 7 ? 1.8 : score >= 5 ? 1.4 : 1.0);
  if (goalIncludes(data.goal, 'Мускулна')) proteinPerKg *= 1.2;
  else if (goalIncludes(data.goal, 'Отслабване')) proteinPerKg *= 1.1;
  const proteinGrams = weight * proteinPerKg;
  const est = tdeeVal || weight * 30;
  let protein = Math.round((proteinGrams * 4 / est) * 100);
  const rem = 100 - protein;
  let carbs; let fats;
  if (score >= 7) { carbs = Math.round(rem * 0.6); fats = rem - carbs; }
  else if (score >= 4) { carbs = Math.round(rem * 0.5); fats = rem - carbs; }
  else { carbs = Math.round(rem * 0.4); fats = rem - carbs; }
  fats += 100 - (protein + carbs + fats);
  return { protein, carbs, fats };
}

function safeDeficit(tdeeVal, goal) {
  if (!goalIncludes(goal, 'Отслабване')) {
    return { targetCalories: tdeeVal };
  }
  return { targetCalories: Math.round(tdeeVal * 0.82) };
}

function enforceGuardrails(analysis, data, tdeeVal) {
  let fc = Number(analysis.Final_Calories) || 0;
  const minCal = minCaloriesForGender(data.gender);
  const isLactation = data.clinicalProtocol === 'postpartum_lactation';
  if (tdeeVal > 0 && fc > 0 && goalIncludes(data.goal, 'Отслабване') && !isLactation) {
    fc = Math.max(fc, Math.round(tdeeVal * (1 - MAX_DEFICIT_RATIO)));
  }
  if (isLactation && tdeeVal > 0 && fc > 0) {
    fc = Math.max(fc, Math.max(minCal + 300, Math.round(tdeeVal * 0.9)));
  }
  if (fc > 0 && fc < minCal) fc = minCal;
  if (fc > 0 && tdeeVal > 0 && goalIncludes(data.goal, 'Отслабване') && !isLactation && fc <= minCal + 75) {
    const safeFloor = Math.round(tdeeVal * (1 - MAX_DEFICIT_RATIO));
    if (safeFloor > minCal + 200) fc = safeFloor;
  }
  if (fc > 0) {
    analysis.Final_Calories = fc;
    analysis.recommendedCalories = fc;
    analysis.tdee = tdeeVal;
    (analysis.correctedMetabolism || (analysis.correctedMetabolism = {})).realTDEE = tdeeVal;
  }
}

function realisticAiMock(profile) {
  const map = {
    kamen_benchmark: { clinical: 0, metabolic: -4 },
    diabetes_sweets_craving: { clinical: -3, metabolic: -2 },
    emotional_burger_stress: { clinical: 0, metabolic: -6 },
    lactation_deficit: { clinical: 4, metabolic: -2 },
    vegan_active: { clinical: 0, metabolic: 2 },
    skip_breakfast_athlete: { clinical: 0, metabolic: -2 },
  };
  return map[profile.id] || { clinical: 0, metabolic: -3 };
}

function realisticStrategyReview(profile) {
  if (profile.id === 'diabetes_sweets_craving') {
    return {
      verdict: 'ADJUST',
      dietaryModifier: 'Балансирано с контрол на ГИ',
      modifierReasoning: 'Диабет тип 2 — ограничаваме бързи въглехидрати и десерти, без радикална смяна на макро рамката.',
      foodsToAvoid: ['захар', 'бял хляб', 'сладкиши', 'газирани напитки', 'мед'],
      foodsToInclude: ['зеленчуци', 'бобови', 'риба', 'ядки', 'пълнозърнести'],
      includeDessert: false,
    };
  }
  if (profile.id === 'ibs_free_text') {
    return REVIEW_SCENARIOS.find(s => s.id === 'ibs_free_text').strategyReview;
  }
  return null;
}

async function buildPlan(profile, { metabolicReview, strategyReview }) {
  const data = structuredClone(profile);
  enrichUserDataEngineContext(data);
  const score = activityScore(data);
  const B = bmr(data);
  const T = tdeeFromScore(B, score);
  const deficitData = safeDeficit(T, data.goal);
  const macros = macroRatios(data, score, T);
  const weight = parseFloat(data.weight) || 70;
  const minFatG = Math.round(weight * MIN_FAT_PER_KG);
  const contract = buildEnergyContract({
    bmr: B, tdee: T, deficitData, macros,
    activityData: { activityLevel: 'Висока' },
    goal: data.goal, minFatG,
  });
  const ai = profile._ai || realisticAiMock(profile);
  const analysis = {
    correctedMetabolism: {
      realBMR: B, realTDEE: T,
      clinicalAdjustmentPercent: ai.clinical,
      metabolicAdjustmentPercent: ai.metabolic,
      goalAdjustmentPercent: -15,
    },
    macroRatios: { ...contract.macroRatios },
    keyProblems: [],
  };
  applyDeterministicEnergyContract(analysis, contract);
  if (metabolicReview) applyBoundedMetabolicReview(analysis, { userData: data, minFatG });
  enforceGuardrails(analysis, data, T);

  let strategy = buildDeterministicStrategy({ userData: data, analysis });
  const review = strategyReview ? (profile._strategyReview || realisticStrategyReview(profile)) : null;
  if (review) {
    if (review.libraryDietProfile && review.libraryDietProfile !== strategy.libraryDietProfile) {
      const rebuilt = buildDeterministicStrategy({
        userData: data, analysis,
        options: {
          libraryDietProfile: review.libraryDietProfile,
          dietaryModifier: review.dietaryModifier,
          freeDayNumber: strategy.freeDayNumber,
        },
      });
      strategy.weeklyScheme = rebuilt.weeklyScheme;
      strategy.libraryDietProfile = rebuilt.libraryDietProfile;
    }
    applyStrategyReviewAdjustments(strategy, review, { mandatoryBlocked: data._engineBlockedTerms || [] });
    strategy._deterministicCore = true;
  }

  const weekPlan = {};
  for (const [start, end] of [[1, 3], [4, 6], [7, 7]]) {
    Object.assign(weekPlan, await buildDeterministicWeekPlanChunk({
      strategy, userData: data, startDay: start, endDay: end, seed: String(profile.id).length,
    }));
  }
  syncWeekPlanNutritionFromDatabase(weekPlan, strategy, 1, 7, data);
  return { analysis, strategy, weekPlan, profile: data, tdee: T };
}

function filterNoise(issues, profile) {
  return issues.filter((i) => {
    if (userSkipsBreakfast(profile) && /Хранене 1 при „Не закусвам“/.test(i)) return false;
    if (/ready_meal в description/.test(i)) return false;
    if (/различни основни ястия/.test(i)) return false;
    return true;
  });
}

function auditPlan(plan) {
  const { analysis, strategy, weekPlan, profile } = plan;
  const wrapped = { analysis, strategy, weekPlan };
  const raw = [
    ...validateDietetic(wrapped, profile),
    ...validateProfileRules(wrapped, profile),
    ...validateWeekPlanNutrition(weekPlan, strategy),
    ...validateWeekPlanFoods(weekPlan),
    ...validateWeekPlanCombinations(weekPlan),
    ...validateWeekPlanDayCoherence(weekPlan),
    ...(validateWeeklyDishVariety(weekPlan).issues || []),
  ];
  const issues = filterNoise(raw, profile);
  const dayCals = Array.from({ length: 7 }, (_, i) =>
    (weekPlan[`day${i + 1}`]?.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0));
  const target = Number(analysis.Final_Calories) || 0;
  const protocol = validateProtocolStrategy(strategy, analysis, profile);
  const dessertMeals = [];
  for (let d = 1; d <= 7; d++) {
    for (const m of weekPlan[`day${d}`]?.meals || []) {
      if (m.dessert) dessertMeals.push(`d${d}`);
    }
  }
  return {
    issues,
    issueCount: issues.length,
    intake: target,
    tdee: plan.tdee,
    dietProfile: strategy.libraryDietProfile,
    includeDessert: strategy.includeDessert,
    minDayKcal: Math.min(...dayCals),
    avgDayKcal: Math.round(dayCals.reduce((a, b) => a + b, 0) / 7),
    daysUnder90pct: dayCals.filter(c => target > 0 && c < target * 0.9).length,
    dessertCount: dessertMeals.length,
    reviewPct: analysis.correctedMetabolism?.appliedReviewPercent ?? 0,
    protocolStatus: protocol.status,
  };
}

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const ALL_PROFILES = [
  ...HARD_PROFILES,
  ...REVIEW_SCENARIOS.map(s => ({ ...s.profile, _ai: s.ai, _strategyReview: s.strategyReview })),
];

const rows = [];
console.log('=== Realistic pipeline benchmark ===\n');

for (const profile of ALL_PROFILES) {
  const legacy = auditPlan(await buildPlan(profile, { metabolicReview: false, strategyReview: false }));
  const improved = auditPlan(await buildPlan(profile, { metabolicReview: true, strategyReview: true }));
  rows.push({ id: profile.id, legacy, improved });
}

console.log(
  'profile'.padEnd(26),
  'L iss'.padStart(6),
  'N iss'.padStart(6),
  'Δ'.padStart(4),
  'intake'.padStart(7),
  'review%'.padStart(8),
  'diet'.padEnd(12),
  'dessert'.padStart(7),
  'minDay'.padStart(7),
);
for (const { id, legacy, improved } of rows) {
  const delta = legacy.issueCount - improved.issueCount;
  console.log(
    id.padEnd(26),
    String(legacy.issueCount).padStart(6),
    String(improved.issueCount).padStart(6),
    String(delta >= 0 ? `+${delta}` : delta).padStart(4),
    String(improved.intake).padStart(7),
    String(improved.reviewPct).padStart(8),
    String(improved.dietProfile).padEnd(12),
    String(improved.dessertCount).padStart(7),
    String(improved.minDayKcal).padStart(7),
  );
}

console.log('\n-- Targeted coherence checks --');

const kamen = rows.find(r => r.id === 'kamen_benchmark');
ok(kamen.improved.intake >= 2800, `Kamen ${kamen.improved.intake} kcal — не на 1500 floor`);
ok(kamen.improved.minDayKcal >= 1500, `Kamen min day ${kamen.improved.minDayKcal} kcal`);
ok(kamen.improved.daysUnder90pct <= 1, `Kamen days under 90% target: ${kamen.improved.daysUnder90pct}`);

const stress = rows.find(r => r.id === 'emotional_burger_stress');
ok(stress.improved.intake < stress.legacy.intake, `stress intake more conservative ${stress.legacy.intake}→${stress.improved.intake}`);
ok(stress.improved.issueCount <= stress.legacy.issueCount, `stress issues ${stress.legacy.issueCount}→${stress.improved.issueCount}`);

const lact = rows.find(r => r.id === 'lactation_deficit');
ok(lact.improved.intake >= minCaloriesForGender('Жена') + 200, `lactation intake ${lact.improved.intake} kcal`);
ok(lact.improved.issueCount <= lact.legacy.issueCount, `lactation issues improved`);

const ibs = rows.find(r => r.id === 'ibs_free_text');
ok(ibs.improved.dietProfile === 'low_fodmap', 'IBS → low_fodmap');
ok(ibs.improved.includeDessert === false, 'IBS dessert off');

const diabetes = rows.find(r => r.id === 'diabetes_sweets_craving');
ok(diabetes.improved.includeDessert === false, 'diabetes dessert policy off');
ok(diabetes.improved.dessertCount <= diabetes.legacy.dessertCount, `diabetes desserts ${diabetes.legacy.dessertCount}→${diabetes.improved.dessertCount}`);
ok(diabetes.improved.issueCount <= diabetes.legacy.issueCount, `diabetes issues ${diabetes.legacy.issueCount}→${diabetes.improved.issueCount}`);

const hypo = rows.find(r => r.id === 'hypothyroid_structured');
ok(hypo.improved.intake <= hypo.legacy.intake, `hypothyroid ${hypo.legacy.intake}→${hypo.improved.intake} (structured -5%)`);
ok(hypo.improved.reviewPct === -5, `hypothyroid review ${hypo.improved.reviewPct}%`);

const vegan = rows.find(r => r.id === 'vegan_active');
ok(vegan.improved.dietProfile === 'vegan', 'vegan profile kept');
ok(vegan.improved.intake > vegan.legacy.intake, `vegan muscle surplus ${vegan.legacy.intake}→${vegan.improved.intake}`);

const coreNoise = rows.reduce((s, r) => s + r.improved.issueCount, 0);
const coreLegacy = rows.reduce((s, r) => s + r.legacy.issueCount, 0);
ok(coreNoise <= coreLegacy, `core issues (noise-filtered) ${coreLegacy}→${coreNoise}`);

try {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    summary: { coreLegacy, coreNoise, pass, fail },
    rows: rows.map(({ id, legacy, improved }) => ({
      id,
      legacy: { issueCount: legacy.issueCount, intake: legacy.intake, dietProfile: legacy.dietProfile },
      improved: { ...improved },
      deltaIssues: legacy.issueCount - improved.issueCount,
      intakeDelta: improved.intake - legacy.intake,
    })),
  };
  writeFileSync(`${ARTIFACT_DIR}/realistic-pipeline-benchmark.json`, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${ARTIFACT_DIR}/realistic-pipeline-benchmark.json`);
} catch (_) { /* optional */ }

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
