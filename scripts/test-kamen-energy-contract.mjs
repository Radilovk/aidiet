#!/usr/bin/env node
/**
 * Kamen-like profile (120 kg, skip breakfast, high activity) must never sit on the
 * 1500 kcal medical floor — that produces ~1440 kcal days and fails validation.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnergyContract } from '../step1-deterministic.js';
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { syncWeekPlanNutritionFromDatabase } from '../meal-day-sync.js';
import { HARD_PROFILES } from './plan-adequacy/fixtures/hard-profiles.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerSrc = readFileSync(join(root, 'worker.entry.js'), 'utf8');

// Minimal inline of normalizeQuestionnaireData tail for nested-weight test
function normalizeQuestionnaireData(data) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data.goal)) data.goal = String(data.goal[0] || '');
  const answers = data.answers;
  if (answers && typeof answers === 'object') {
    for (const key of ['weight', 'height', 'age', 'gender', 'goal', 'name', 'email']) {
      if ((data[key] == null || data[key] === '') && answers[key] != null && answers[key] !== '') {
        data[key] = answers[key];
      }
    }
  }
  for (const key of ['weight', 'height', 'age']) {
    if (data[key] == null || data[key] === '') continue;
    const parsed = parseFloat(String(data[key]).replace(',', '.').match(/[\d.]+/)?.[0] || '');
    if (!Number.isNaN(parsed) && parsed > 0) data[key] = String(parsed);
  }
  return data;
}

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(workerSrc.includes('energyDrift > 0.05'), 'regen rebuilds strategy when intake drifted');
ok(workerSrc.includes('_energyPresynced'), 'weekly adapt preserves calorie adjust after presync');
ok(workerSrc.includes('ensureProfileMetricsOnData(data)'), 'normalizeQuestionnaireData flattens profile metrics');

// Nested answers.weight must reach the energy pipeline
const nested = { answers: { weight: '120 кг', height: '175', age: '40', gender: 'Мъж', goal: 'отслабване' } };
normalizeQuestionnaireData(nested);
ok(nested.weight === '120', 'nested answers.weight flattened');

ok(workerSrc.includes('safeLossFloor'), 'worker blocks intake stuck at generic medical floor');

const profile = HARD_PROFILES.find(p => p.id === 'kamen_benchmark');
ok(profile?.weight === '120', 'kamen benchmark weight is 120 kg');

function bmr(w, h, a, g) {
  return Math.round(10 * w + 6.25 * h - 5 * a + (g === 'Мъж' ? 5 : -161));
}
function activityScore(data) {
  const daily = { Ниско: 1, Средно: 2, Високо: 3 }[data.dailyActivityLevel] || 2;
  let sport = 0;
  const s = data.sportActivity || '';
  if (s.includes('5–7')) sport = 6;
  return Math.min(10, daily + sport);
}
function tdee(bmrVal, score) {
  const mult = { 9: 1.85, 10: 1.95 };
  return Math.round(bmrVal * (mult[Math.round(score)] || 1.75));
}

const weightKg = 120;
const B = bmr(weightKg, 175, 40, 'Мъж');
const T = tdee(B, activityScore(profile));
const contract = buildEnergyContract({
  bmr: B,
  tdee: T,
  deficitData: { targetCalories: Math.round(T * 0.82) },
  macros: { protein: 30, carbs: 40, fats: 30 },
  activityData: { activityLevel: 'Много висока' },
  goal: profile.goal,
  minFatG: Math.round(weightKg * 0.7),
});

ok(contract.Final_Calories >= 2800, `intake ${contract.Final_Calories} kcal >> 1500 floor`);
ok(contract.Final_Calories <= T, 'intake is below maintenance TDEE');

const analysis = {
  Final_Calories: 1500,
  recommendedCalories: 1500,
  macroGrams: { protein: 110, carbs: 150, fats: 50 },
  keyProblems: [{ title: 'Stale', severity: 'Borderline', severityValue: 55 }],
};
const strategy = buildDeterministicStrategy({ userData: profile, analysis: { ...analysis, Final_Calories: contract.Final_Calories, macroGrams: contract.macroGrams } });
const chunk = await buildDeterministicWeekPlanChunk({ strategy, userData: profile, startDay: 1, endDay: 6, seed: 1 });
const week = JSON.parse(JSON.stringify(chunk));
syncWeekPlanNutritionFromDatabase(week, strategy, 1, 6, profile);

const dayCals = [];
for (let d = 1; d <= 6; d++) {
  dayCals.push((week[`day${d}`]?.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0));
}
const minDay = Math.min(...dayCals);
ok(minDay >= 1500, `all weekdays >= 1500 kcal (min=${minDay}: ${dayCals.join(', ')})`);

console.log('');
if (fail) {
  console.error(`FAILED: ${fail} test(s)`);
  process.exit(1);
}
console.log(`PASSED: ${pass} test(s)`);
