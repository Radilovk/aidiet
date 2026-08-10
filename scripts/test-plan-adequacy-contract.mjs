#!/usr/bin/env node
/**
 * Adequacy contract tests — регресии на tolerance, caps, profile rules, analysis normalize.
 * npm run test:plan-adequacy:contract
 */
import {
  isMealCaloriesAdequate,
  slotCalorieTolerance,
  validateLateSnackSlotContent,
  validateLightMealSlotContent,
  validateSlotCalories,
  enforceFixedSlotCaps,
  normalizeAnalysisOutput,
  reconcileAchievedSlotCalories,
  MAX_LATE_SNACK_CALORIES,
  MAX_AFTERNOON_SNACK_CALORIES,
} from '../plan-normalize.js';
import { mealWeightGramsFromDescription } from '../food-nutrition.js';
import { validateAnalysis } from './plan-adequacy/validators/analysis.mjs';
import {
  validateProfileRules,
  validateH5SchemeSlot,
  userSkipsBreakfast,
  hasSweetCraving,
} from './plan-adequacy/validators/profile-rules.mjs';
import {
  H5_SCHEME_CASES,
  SKIP_BREAKFAST_OK_PLAN,
  SKIP_BREAKFAST_FAIL_PLAN,
  DESSERT_RULE_PLAN,
  READY_MEAL_PLAN,
  VEGAN_ANALYSIS_RAW,
} from './plan-adequacy/fixtures/contract-cases.mjs';
import { HARD_PROFILES } from './plan-adequacy/fixtures/hard-profiles.mjs';
import { buildGoldenAnalysis } from './plan-adequacy/fixtures/golden-analysis.mjs';

const results = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

console.log('=== Adequacy contract tests ===\n');

console.log('-- 1. Calorie adequacy tolerance (±10%) --');
{
  check('836 vs 900 adequate', isMealCaloriesAdequate(836, 900));
  check('562 vs 611 adequate', isMealCaloriesAdequate(562, 611));
  check('700 vs 900 NOT adequate', !isMealCaloriesAdequate(700, 900));
  check('162 vs 200 under-cap NOT equal to target', !isMealCaloriesAdequate(162, 200));
  check('H5 scheme allows under-cap 162', !validateH5SchemeSlot(162));
  check('tolerance(900)=90', slotCalorieTolerance(900) === 90);
}

console.log('\n-- 2. H5 scheme slot (over-cap only) --');
for (const c of H5_SCHEME_CASES) {
  const err = validateH5SchemeSlot(c.cal);
  check(`H5 ${c.label}`, c.ok ? !err : !!err, err || 'OK');
}

console.log('\n-- 3. H5 meal content --');
{
  const okSnack = { type: 'Хранене 5', name: 'Скир с бадеми', description: '• скир 100g\n• бадеми 10g', calories: 165 };
  const overSnack = { type: 'Хранене 5', name: 'Скир', description: '• скир 200g', calories: 235 };
  check('H5 under-cap meal valid', validateLateSnackSlotContent(okSnack).length === 0);
  check('H5 over-cap meal invalid', validateLateSnackSlotContent(overSnack).length > 0);
  check('H5 fruit rejected', validateLateSnackSlotContent({ type: 'Хранене 5', name: 'Банан', description: '• банан 150g', calories: 120 }).length > 0);
}

console.log('\n-- 4. H3 snack slot --');
{
  const okH3 = { type: 'Хранене 3', name: 'Ябълка с бадеми', description: '• ябълка 150g\n• бадеми 15g' };
  const badH3 = { type: 'Хранене 3', name: 'Говеждо', description: '• говеждо 150g' };
  check('H3 fruit+nuts OK', validateLightMealSlotContent(okH3).length === 0);
  check('H3 cooked meat rejected', validateLightMealSlotContent(badH3).length > 0);
}

console.log('\n-- 5. Fixed slot caps (H3≤350, H5≤200) --');
{
  const day = {
    calories: 2774,
    mealBreakdown: [
      { type: 'Хранене 2', calories: 900 },
      { type: 'Хранене 3', calories: 437 },
      { type: 'Хранене 4', calories: 600 },
      { type: 'Хранене 5', calories: 204 },
    ],
  };
  enforceFixedSlotCaps(day, 2774);
  const h3 = day.mealBreakdown.find(m => m.type === 'Хранене 3');
  const h5 = day.mealBreakdown.find(m => m.type === 'Хранене 5');
  check('enforceFixedSlotCaps H3 ≤350', h3.calories <= MAX_AFTERNOON_SNACK_CALORIES, `${h3.calories}`);
  check('enforceFixedSlotCaps H5 ≤200', h5.calories <= MAX_LATE_SNACK_CALORIES, `${h5.calories}`);
}

console.log('\n-- 6. Strategy slot validator --');
{
  const dayScheme = {
    calories: 2700,
    mealBreakdown: [
      { type: 'Хранене 2', calories: 900 },
      { type: 'Хранене 3', calories: 390 },
      { type: 'Хранене 5', calories: 210 },
    ],
  };
  const h3Err = validateSlotCalories(dayScheme.mealBreakdown[1], dayScheme);
  const h5Err = validateSlotCalories(dayScheme.mealBreakdown[2], dayScheme);
  check('H3 390 over cap flagged', !!h3Err);
  check('H5 skipped by validateSlotCalories', h5Err === null);
}

console.log('\n-- 7. Weight from description (not stale meal.weight) --');
{
  const meal = {
    type: 'Хранене 2',
    description: '• пилешки гърди 300g\n• ориз 300g',
    weight: '820г',
    dessert: { weight: '30г' },
  };
  const wg = mealWeightGramsFromDescription(meal);
  check('sums description grams', wg === 630, `${wg}g`);
  check('ignores stale weight field', wg < 800);
}

console.log('\n-- 8. Analysis normalize (filter Normal → pad) --');
{
  const analysis = {
    keyProblems: [
      { title: 'A', severity: 'Risky', severityValue: 70, description: 'd', category: 'Health', impact: 'i' },
      { title: 'B', severity: 'Borderline', severityValue: 50, description: 'd', category: 'Health', impact: 'i' },
      { title: 'C', severity: 'Normal', severityValue: 30, description: 'd', category: 'Health', impact: 'i' },
    ],
    hinderingFactors: [{ factor: 'D', severity: 3, description: 'factor D' }],
    currentHealthStatus: { score: 62, description: 'Здравословно състояние с области за подобрение в храненето и съня.', keyIssues: ['A'] },
  };
  analysis.keyProblems = analysis.keyProblems.filter(p => p.severity !== 'Normal');
  normalizeAnalysisOutput(analysis);
  check('after Normal filter → ≥3 keyProblems', analysis.keyProblems.length >= 3, `${analysis.keyProblems.length}`);
  check('no Normal severity remains', !analysis.keyProblems.some(p => p.severity === 'Normal'));
}

console.log('\n-- 9. Vegan-like analysis padding from healthRisks --');
{
  const analysis = structuredClone(VEGAN_ANALYSIS_RAW);
  normalizeAnalysisOutput(analysis);
  const issues = validateAnalysis(analysis, HARD_PROFILES.find(p => p.id === 'vegan_active'));
  check('vegan-like → ≥3 keyProblems', analysis.keyProblems.length >= 3, `${analysis.keyProblems.length}`);
  check('validateAnalysis passes', issues.length === 0, issues.join('; '));
}

console.log('\n-- 10. Profile rules (benchmark contract) --');
{
  const skipProfile = { eatingHabits: ['Не закусвам'] };
  check('skip breakfast detected', userSkipsBreakfast(skipProfile));
  check('skip breakfast day1 OK', validateProfileRules(SKIP_BREAKFAST_OK_PLAN, skipProfile).length === 0);
  check('skip breakfast day2 fails', validateProfileRules(SKIP_BREAKFAST_FAIL_PLAN, skipProfile).some(i => i.includes('Хранене 1')));

  const noSweet = { foodCravings: ['Бургери / дюнери'] };
  check('no sweet craving', !hasSweetCraving(noSweet));
  check('dessert without craving fails', validateProfileRules(DESSERT_RULE_PLAN, noSweet).length > 0);

  check('ready_meal in description fails', validateProfileRules(READY_MEAL_PLAN, {}).some(i => i.includes('ready_meal')));
}

console.log('\n-- 11. Reconcile slot calories (achieved within tolerance) --');
{
  const weekPlan = {
    day1: {
      meals: [
        { type: 'Хранене 2', calories: 836, macros: { protein: 55, carbs: 80, fats: 25 } },
        { type: 'Хранене 4', calories: 562, macros: { protein: 45, carbs: 50, fats: 18 } },
      ],
    },
  };
  const strategy = {
    weeklyScheme: {
      monday: {
        calories: 2000,
        mealBreakdown: [
          { type: 'Хранене 2', calories: 900 },
          { type: 'Хранене 4', calories: 611 },
        ],
      },
    },
  };
  reconcileAchievedSlotCalories(weekPlan, strategy, 1, 1);
  const h2 = strategy.weeklyScheme.monday.mealBreakdown.find(m => m.type === 'Хранене 2');
  const h4 = strategy.weeklyScheme.monday.mealBreakdown.find(m => m.type === 'Хранене 4');
  check('reconcile H2 aligned to achieved', h2.calories === 836, `${h2.calories}`);
  check('reconcile H4 aligned to achieved', h4.calories === 562, `${h4.calories}`);
}

console.log('\n-- 11b. Reconcile slot calories (under-target stays at contract) --');
{
  const weekPlan = {
    day1: {
      meals: [
        { type: 'Хранене 2', calories: 600, macros: { protein: 40, carbs: 60, fats: 18 } },
        { type: 'Хранене 4', calories: 450, macros: { protein: 35, carbs: 40, fats: 15 } },
      ],
    },
  };
  const strategy = {
    weeklyScheme: {
      monday: {
        calories: 1700,
        mealBreakdown: [
          { type: 'Хранене 2', calories: 900 },
          { type: 'Хранене 4', calories: 800 },
        ],
      },
    },
  };
  reconcileAchievedSlotCalories(weekPlan, strategy, 1, 1);
  const h2b = strategy.weeklyScheme.monday.mealBreakdown.find(m => m.type === 'Хранене 2');
  const h4b = strategy.weeklyScheme.monday.mealBreakdown.find(m => m.type === 'Хранене 4');
  check('reconcile under-target H2 keeps contract', h2b.calories === 900, `${h2b.calories}`);
  check('reconcile under-target H4 keeps contract', h4b.calories === 800, `${h4b.calories}`);
}

console.log('\n-- 11c. Reconcile adequate achieved above soft cap (high intake) --');
{
  const weekPlan = {
    day1: {
      meals: [
        { type: 'Хранене 2', calories: 1128, macros: { protein: 75, carbs: 90, fats: 35 } },
        { type: 'Хранене 4', calories: 1119, macros: { protein: 72, carbs: 88, fats: 34 } },
      ],
    },
  };
  const strategy = {
    weeklyScheme: {
      monday: {
        calories: 2774,
        mealBreakdown: [
          { type: 'Хранене 2', calories: 1113 },
          { type: 'Хранене 3', calories: 348 },
          { type: 'Хранене 4', calories: 1113 },
          { type: 'Хранене 5', calories: 200 },
        ],
      },
    },
  };
  reconcileAchievedSlotCalories(weekPlan, strategy, 1, 1);
  const h2c = strategy.weeklyScheme.monday.mealBreakdown.find(m => m.type === 'Хранене 2');
  const h4c = strategy.weeklyScheme.monday.mealBreakdown.find(m => m.type === 'Хранене 4');
  check('reconcile adequate H2 not clamped to 900', h2c.calories === 1128, `${h2c.calories}`);
  check('reconcile adequate H4 not clamped to 900', h4c.calories === 1119, `${h4c.calories}`);
}

console.log('\n-- 12. Hard profiles golden analysis (offline) --');
for (const profile of HARD_PROFILES) {
  const analysis = buildGoldenAnalysis(profile);
  normalizeAnalysisOutput(analysis);
  const issues = validateAnalysis(analysis, profile);
  check(`hard:${profile.id}`, issues.length === 0, issues.slice(0, 2).join('; '));
}

const passed = results.filter(Boolean).length;
console.log(`\n=== Contract: ${passed}/${results.length} PASS ===`);
process.exit(passed === results.length ? 0 : 1);
