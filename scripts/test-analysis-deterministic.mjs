#!/usr/bin/env node
/** Анализ без AI — пълен, валиден и съгласуван с кода на профила. */
import { buildDeterministicAnalysis, mergeAnalysisNarrative } from '../analysis-deterministic.js';
import { KEY_PROBLEM_SEVERITY_RANGES, normalizeAnalysisOutput } from '../plan-normalize.js';
import { HARD_PROFILES } from './plan-adequacy/fixtures/hard-profiles.mjs';
import { EXTENDED_PROFILES } from './plan-adequacy/fixtures/extended-profiles.mjs';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const energy = { bmr: 1500, tdee: 2100, Final_Calories: 1700, macroGrams: { protein: 120, carbs: 170, fats: 60 }, macroRatios: { protein: 28, carbs: 40, fats: 32 } };
const CATEGORIES = new Set(['Sleep', 'Nutrition', 'Hydration', 'Stress', 'Activity', 'Medical']);

const seen = new Set();
const all = [...HARD_PROFILES, ...EXTENDED_PROFILES, ...PROFILES].filter(p => !seen.has(p.id) && seen.add(p.id));
let problemsTotal = 0;
for (const profile of all) {
  const a = buildDeterministicAnalysis(profile, energy);
  const bad = a.keyProblems.filter((p) => {
    const band = KEY_PROBLEM_SEVERITY_RANGES[p.severity];
    return !band || p.severityValue < band[0] || p.severityValue > band[1] || !CATEGORIES.has(p.category)
      || !p.title || !p.description || !p.impact;
  });
  problemsTotal += a.keyProblems.length;
  ok(!bad.length && a.keyProblems.length <= 6, `${profile.id}: ${a.keyProblems.length} валидни проблема`);
  ok(a.currentHealthStatus.score >= 25 && a.currentHealthStatus.score <= 92 && a.currentHealthStatus.description,
    `${profile.id}: здравна оценка ${a.currentHealthStatus.score}`);
  ok(a.forecastPessimistic.risks.length >= 3 && a.forecastOptimistic.improvements.length >= 3,
    `${profile.id}: прогнози с поне 3 точки`);
  ok(a.Final_Calories === 1700 && a.macroGrams.protein === 120, `${profile.id}: енергията е от договора`);
  normalizeAnalysisOutput(a, profile);
  ok(a.keyProblems.length >= 3, `${profile.id}: след нормализация поне 3 проблема`);
}
ok(problemsTotal > all.length * 2, `проблемите не са празни (${problemsTotal} общо)`);

const titles = p => buildDeterministicAnalysis(p, energy).keyProblems.map(x => x.title).join(' | ');
ok(/Инсулинова|Диабет/.test(titles(HARD_PROFILES.find(p => p.id === 'diabetes_sweets_craving'))), 'диабет → медицински проблем');
ok(/щитовидната/.test(titles({ gender: 'Жена', age: '45', height: '168', weight: '78', medicalConditions: ['Хашимото'] })),
  'Хашимото → проблем със щитовидната жлеза');
ok(/сън/i.test(titles({ gender: 'Мъж', age: '30', height: '180', weight: '80', sleepHours: 'Под 5' })), 'под 5 часа сън → проблем');
ok(/вода/i.test(titles({ gender: 'Мъж', age: '30', height: '180', weight: '90', waterIntake: 'под 1 л' })), 'под 1 л вода → проблем');

const healthy = buildDeterministicAnalysis({
  gender: 'Жена', age: '30', height: '168', weight: '60', sleepHours: '7–8', stressLevel: 'Ниско',
  sportActivity: 'Средна (2–4 дни седмично)', waterIntake: 'над 2 л', goal: 'Подобряване на здравето',
}, energy);
ok(healthy.currentHealthStatus.score >= 85, `здрав профил → висока оценка (${healthy.currentHealthStatus.score})`);

// AI добавя само текст — числата и проблемите остават от правилата.
const base = buildDeterministicAnalysis(HARD_PROFILES[0], energy);
const problemsBefore = JSON.stringify(base.keyProblems);
mergeAnalysisNarrative(base, {
  Final_Calories: 900,
  keyProblems: [{ title: 'x', description: 'y', severity: 'Critical', severityValue: 90, category: 'Medical', impact: 'z' }],
  psychologicalProfile: 'AI текст',
  currentHealthStatus: { score: 10, description: 'AI описание' },
});
ok(base.Final_Calories === 1700, 'AI не може да смени калориите');
ok(JSON.stringify(base.keyProblems) === problemsBefore, 'AI не може да смени проблемите');
ok(base.currentHealthStatus.score !== 10 && base.currentHealthStatus.description === 'AI описание', 'AI сменя само описанието');
ok(base.psychologicalProfile === 'AI текст', 'AI текстът се приема');

console.log(`\n=== deterministic analysis: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
