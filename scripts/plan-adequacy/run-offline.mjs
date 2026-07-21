#!/usr/bin/env node
/**
 * Offline plan adequacy tests — prompts, fixtures, frontend projection.
 * npm run test:plan-adequacy
 */
import { PROFILES } from './fixtures/profiles.mjs';
import { buildGoldenAnalysis, BAD_ANALYSIS } from './fixtures/golden-analysis.mjs';
import { validatePromptContracts, validateKvUploadCoverage } from './validators/prompts.mjs';
import { validateAnalysis } from './validators/analysis.mjs';
import { validateStrategy, validateMealPlan, buildMinimalWeekPlan } from './validators/plan.mjs';
import { validateFrontendProjection } from './validators/frontend.mjs';
import { PLAN_SYSTEM_INSTRUCTIONS } from '../../plan-response-schemas.js';

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    const issues = fn();
    if (issues.length) {
      failed++;
      console.log(`\n✗ ${name}`);
      for (const i of issues) console.log(`    • ${i}`);
    } else {
      passed++;
      console.log(`✓ ${name}`);
    }
  } catch (e) {
    failed++;
    console.log(`\n✗ ${name}: ${e.message}`);
  }
}

console.log('=== Plan adequacy (offline) ===\n');

console.log('-- Prompt contracts --');
run('KV prompt contracts', () => validatePromptContracts());
run('KV upload script coverage', () => validateKvUploadCoverage());

console.log('\n-- System instructions --');
run('PLAN_SYSTEM_INSTRUCTIONS step1-4', () => {
  const issues = [];
  for (const k of ['step1', 'step2', 'step3', 'step4']) {
    if (!PLAN_SYSTEM_INSTRUCTIONS[k]?.includes('JSON')) issues.push(`${k}: липсва JSON изискване`);
  }
  if (!PLAN_SYSTEM_INSTRUCTIONS.step1.includes('bmr')) issues.push('step1: липсва bmr граница');
  if (!PLAN_SYSTEM_INSTRUCTIONS.step2.includes('Хранене')) issues.push('step2: липсва meal type граница');
  return issues;
});

console.log('\n-- Golden analysis (всеки профил) --');
for (const profile of PROFILES) {
  run(`analysis:${profile.id}`, () => {
    const analysis = buildGoldenAnalysis(profile);
    const plan = { analysis, summary: { dailyCalories: analysis.Final_Calories, macros: analysis.macroGrams } };
    return [
      ...validateAnalysis(analysis, profile),
      ...validateFrontendProjection(plan),
    ];
  });
}

console.log('\n-- Bad analysis (трябва да fail-нат) --');
for (const [key, bad] of Object.entries(BAD_ANALYSIS)) {
  const issues = validateAnalysis(bad, PROFILES[0]);
  const frontendIssues = validateFrontendProjection({ analysis: bad, summary: {} });
  const all = [...issues, ...frontendIssues];
  if (all.length === 0) {
    failed++;
    console.log(`✗ bad:${key} — очаквани грешки, но мина`);
  } else {
    passed++;
    console.log(`✓ bad:${key} — хванати ${all.length} проблема`);
  }
}

console.log('\n-- Synthetic full plan --');
run('full plan structure', () => {
  const profile = PROFILES[0];
  const analysis = buildGoldenAnalysis(profile);
  const strategy = {
    dietaryModifier: 'Балансирано',
    dietType: 'Средиземноморска',
    mealCountJustification: 'Четири хранения осигуряват стабилна енергия през деня.',
    weeklyScheme: {
      monday: {
        meals: 4,
        calories: analysis.Final_Calories,
        protein: analysis.macroGrams.protein,
        carbs: analysis.macroGrams.carbs,
        fats: analysis.macroGrams.fats,
        mealBreakdown: [
          { type: 'Хранене 1', calories: 400, protein: 30, carbs: 35, fats: 12 },
          { type: 'Хранене 2', calories: 500, protein: 40, carbs: 45, fats: 15 },
          { type: 'Хранене 3', calories: 180, protein: 8, carbs: 22, fats: 8 },
          { type: 'Хранене 4', calories: 420, protein: 35, carbs: 30, fats: 14 },
        ],
      },
      tuesday: {}, wednesday: {}, thursday: {}, friday: {}, saturday: {}, sunday: {},
    },
  };
  for (const day of ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    strategy.weeklyScheme[day] = { ...strategy.weeklyScheme.monday };
  }
  const weekPlan = buildMinimalWeekPlan(strategy);
  const plan = {
    analysis,
    strategy,
    weekPlan,
    summary: {
      recommendations: Array(10).fill('зеленчуци'),
      forbidden: Array(10).fill('захар'),
      supplements: ['Магнезий 300mg', 'Омега-3 1000mg', 'Витамин D 2000IU'],
      psychology: ['a', 'b', 'c'],
      waterIntake: '2.5 литра',
    },
  };
  return [
    ...validateStrategy(strategy),
    ...validateMealPlan(weekPlan, strategy),
    ...validateFrontendProjection(plan),
  ];
});

console.log(`\n=== Обобщение: ${passed} pass, ${failed} fail ===`);
process.exit(failed > 0 ? 1 : 0);
