#!/usr/bin/env node
/**
 * Качество на плана — целият детерминистичен двигател върху всички профили от
 * fixtures: анализ → енергия → стратегия → седмица → грамажи → валидатори.
 *
 * Мери договора от архитектурата: калориите се постигат с порцията,
 * макросите — с избора на ястия, а чинията остава реална. Праговете са
 * долната граница на това, което двигателят вече постига; падане под тях е
 * регресия.
 */
import { HARD_PROFILES } from './plan-adequacy/fixtures/hard-profiles.mjs';
import { EXTENDED_PROFILES } from './plan-adequacy/fixtures/extended-profiles.mjs';
import { PROFILES, minCaloriesForGender } from './plan-adequacy/fixtures/profiles.mjs';
import {
  calculateBMR,
  calculateUnifiedActivityScore,
  calculateTDEE,
  calculateSafeDeficit,
  calculateMacronutrientRatios,
} from '../energy.js';
import {
  buildEnergyContract,
  applyDeterministicEnergyContract,
  applyBoundedMetabolicReview,
} from '../step1-deterministic.js';
import { buildDeterministicAnalysis } from '../analysis-deterministic.js';
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { syncWeekPlanNutritionFromDatabase } from '../meal-day-sync.js';
import { buildPlanSummary } from '../plan-summary.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { compileProfile } from '../profile-code.js';
import { validateDietetic } from './plan-adequacy/validators/dietetic.mjs';
import { validateProfileRules } from './plan-adequacy/validators/profile-rules.mjs';
import { validateWeekPlanNutrition } from './plan-adequacy/validators/nutrition.mjs';
import { validateWeekPlanFoods } from './plan-adequacy/validators/foods.mjs';
import { validateWeekPlanCombinations } from './plan-adequacy/validators/combinations.mjs';
import { validateWeekPlanDayCoherence, validateWeeklyDishVariety } from '../meal-combinations.js';
import { userSkipsBreakfast } from './plan-adequacy/validators/profile-rules.mjs';

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MIN_FAT_PER_KG = 0.7;
const MAX_DEFICIT_RATIO = 0.25;

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

/** Долният праг на приема, както го прилага worker-ът (enforceCalorieGuardrails). */
function applyCalorieFloor(analysis, data, tdee) {
  const losing = String(data.goal || '').includes('Отслабване');
  const lactation = data.clinicalProtocol === 'postpartum_lactation';
  const minCal = minCaloriesForGender(data.gender);
  let fc = Number(analysis.Final_Calories) || 0;
  if (losing && !lactation) fc = Math.max(fc, Math.round(tdee * (1 - MAX_DEFICIT_RATIO)));
  if (lactation) fc = Math.max(fc, minCal + 300, Math.round(tdee * 0.9));
  fc = Math.max(fc, minCal);
  analysis.Final_Calories = fc;
  analysis.recommendedCalories = fc;
}

async function buildPlan(profile) {
  const data = structuredClone(profile);
  enrichUserDataEngineContext(data);
  const activity = calculateUnifiedActivityScore(data);
  const bmr = calculateBMR(data);
  const tdee = calculateTDEE(bmr, activity.combinedScore);
  const minFatG = Math.round((parseFloat(data.weight) || 70) * MIN_FAT_PER_KG);
  const contract = buildEnergyContract({
    bmr,
    tdee,
    deficitData: calculateSafeDeficit(tdee, data.goal),
    macros: calculateMacronutrientRatios(data, activity.combinedScore, tdee),
    activityData: activity,
    goal: data.goal,
    minFatG,
  });
  const analysis = buildDeterministicAnalysis(data);
  applyDeterministicEnergyContract(analysis, contract);
  applyBoundedMetabolicReview(analysis, { userData: data, minFatG });
  applyCalorieFloor(analysis, data, tdee);

  const strategy = buildDeterministicStrategy({ userData: data, analysis });
  const weekPlan = await buildDeterministicWeekPlanChunk({
    strategy,
    userData: data,
    startDay: 1,
    endDay: 7,
    seed: String(profile.id).length,
    clinicalProtocolId: data.clinicalProtocol || null,
    blockedTerms: data._engineBlockedTerms || [],
  });
  syncWeekPlanNutritionFromDatabase(weekPlan, strategy, 1, 7, data);
  const summary = buildPlanSummary({ userData: data, strategy, weekPlan, bmr, dailyCalories: analysis.Final_Calories });
  return { data, analysis, strategy, weekPlan, summary };
}

function deviation({ strategy, weekPlan }) {
  const dev = { kcal: 0, p: 0, c: 0, f: 0, days: 0 };
  for (let d = 1; d <= 7; d++) {
    const meals = weekPlan[`day${d}`]?.meals || [];
    if (meals.some(m => m.type === 'Свободно хранене')) continue;
    const target = strategy.weeklyScheme[DAY_KEYS[d - 1]];
    const sum = key => meals.reduce((a, m) => a + (key === 'kcal' ? m.calories : m.macros?.[key]) || 0, 0);
    dev.kcal += Math.abs(sum('kcal') - target.calories) / target.calories;
    dev.p += Math.abs(sum('protein') - target.protein) / target.protein;
    dev.c += Math.abs(sum('carbs') - target.carbs) / Math.max(target.carbs, 1);
    dev.f += Math.abs(sum('fats') - target.fats) / target.fats;
    dev.days++;
  }
  return { kcal: dev.kcal / dev.days, p: dev.p / dev.days, c: dev.c / dev.days, f: dev.f / dev.days };
}

function issuesOf({ data, analysis, strategy, weekPlan }) {
  const wrapped = { analysis, strategy, weekPlan };
  return [
    ...validateDietetic(wrapped, data),
    ...validateProfileRules(wrapped, data),
    ...validateWeekPlanNutrition(weekPlan, strategy),
    ...validateWeekPlanFoods(weekPlan),
    ...validateWeekPlanCombinations(weekPlan),
    ...validateWeekPlanDayCoherence(weekPlan),
    ...(validateWeeklyDishVariety(weekPlan).issues || []),
  ].filter(i => !(userSkipsBreakfast(data) && /Хранене 1 при „Не закусвам“/.test(i))
    && !/ready_meal в description|различни основни ястия/.test(i));
}

const seen = new Set();
const profiles = [...HARD_PROFILES, ...EXTENDED_PROFILES, ...PROFILES].filter(p => !seen.has(p.id) && seen.add(p.id));
const total = { kcal: 0, p: 0, c: 0, f: 0, issues: 0, tiny: 0, n: 0 };
const plans = new Map();

console.log('profile'.padEnd(28), 'код'.padEnd(18), 'kcal', '  P ', '  C ', '  F ', 'iss');
for (const profile of profiles) {
  let plan;
  try {
    plan = await buildPlan(profile);
  } catch (e) {
    ok(false, `${profile.id}: планът се изгражда (${e.message})`);
    continue;
  }
  plans.set(profile.id, plan);
  const dev = deviation(plan);
  const issues = issuesOf(plan);
  const tiny = Object.values(plan.weekPlan).flatMap(d => d.meals)
    .flatMap(m => String(m.description || '').split('\n'))
    .filter(l => { const g = Number((l.match(/(\d+)\s*g/) || [])[1]); return g > 0 && g < 10; }).length;
  const pct = x => `${Math.round(x * 100)}%`.padStart(4);
  const code = compileProfile(plan.data).diet;
  console.log(profile.id.padEnd(28), `${code.style}/${code.pattern}`.padEnd(18),
    pct(dev.kcal), pct(dev.p), pct(dev.c), pct(dev.f), String(issues.length).padStart(3));
  ok(dev.kcal < 0.2, `${profile.id}: калориите на деня ±${Math.round(dev.kcal * 100)}%`);
  ok(plan.summary.summary.macros.protein > 0 && plan.summary.supplements.length > 0, `${profile.id}: обобщение без AI`);
  total.kcal += dev.kcal; total.p += dev.p; total.c += dev.c; total.f += dev.f;
  total.issues += issues.length; total.tiny += tiny; total.n++;
}

const avg = x => x / total.n;
console.log(`\nСредно дневно разминаване: kcal ${(avg(total.kcal) * 100).toFixed(1)}%  P ${(avg(total.p) * 100).toFixed(1)}%  C ${(avg(total.c) * 100).toFixed(1)}%  F ${(avg(total.f) * 100).toFixed(1)}%  | проблеми ${total.issues} | символични грамажи ${total.tiny}`);
ok(total.n === profiles.length, `всички ${profiles.length} профила дават план`);
// Прагове = постигнатото + малък запас. Най-голямото оставащо разминаване е
// при 3000+ kcal: таваните на порциите (250 г ориз) не растат с клиента, а
// при веган/AIP/кето каталогът още е тесен.
ok(avg(total.kcal) < 0.05, 'калории средно под 5%');
ok(avg(total.p) < 0.17, 'протеин средно под 17%');
ok(avg(total.c) < 0.17, 'въглехидрати средно под 17%');
ok(avg(total.f) < 0.14, 'мазнини средно под 14%');
ok(total.tiny === 0, 'няма символични грамажи под 10 г');
ok(total.issues <= 25, `проблеми от валидаторите ≤ 25 (${total.issues})`);

const kamen = plans.get('kamen_benchmark');
ok(kamen && kamen.analysis.Final_Calories >= 2800, `Камен: ${kamen?.analysis.Final_Calories} kcal — не на минимума`);
const hypo = plans.get('menopause_sarcopenia') && buildDeterministicAnalysis({ gender: 'Жена', age: '45', height: '168', weight: '78', medicalConditions: ['Хашимото'] });
ok(hypo && hypo.keyProblems.some(p => /щитовидната/.test(p.title)), 'Хашимото се вижда в анализа');

console.log(`\n=== plan quality: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
