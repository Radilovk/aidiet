#!/usr/bin/env node
/**
 * Dietetic / clinical adequacy — priority #2: physiologically justified diet logic.
 * npm run test:plan-adequacy:dietetic
 */
import {
  validateAnalysisDietetic,
  validateWeekPlanDietetic,
  validateDietetic,
} from './plan-adequacy/validators/dietetic.mjs';
import { BAD_DIETETIC, GOOD_DIETETIC } from './plan-adequacy/fixtures/dietetic-cases.mjs';
import { EXTENDED_PROFILES } from './plan-adequacy/fixtures/extended-profiles.mjs';
import { HARD_PROFILES } from './plan-adequacy/fixtures/hard-profiles.mjs';
import { buildGoldenAnalysis } from './plan-adequacy/fixtures/golden-analysis.mjs';
import { normalizeAnalysisOutput } from '../plan-normalize.js';

const results = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

function expectBad(label, issues) {
  check(`bad:${label}`, issues.length > 0, `${issues.length} issues`);
}

function expectGood(label, issues) {
  check(`good:${label}`, issues.length === 0, issues.slice(0, 2).join('; '));
}

console.log('=== Dietetic adequacy ===\n');

console.log('-- 1. Bad dietetic cases (must fail) --');
for (const [key, case_] of Object.entries(BAD_DIETETIC)) {
  const profile = case_.profile;
  let issues = [];
  if (case_.analysis) issues.push(...validateAnalysisDietetic(case_.analysis, profile));
  if (case_.weekPlan) issues.push(...validateWeekPlanDietetic(case_.weekPlan, case_.strategy, profile));
  expectBad(key, issues);
}

console.log('\n-- 2. Good dietetic cases (must pass) --');
for (const [key, case_] of Object.entries(GOOD_DIETETIC)) {
  const issues = validateDietetic(case_, case_.profile);
  expectGood(key, issues);
}

console.log('\n-- 3. Hard profiles golden analysis (dietetic) --');
for (const profile of HARD_PROFILES) {
  const analysis = buildGoldenAnalysis(profile);
  normalizeAnalysisOutput(analysis);
  const issues = validateAnalysisDietetic(analysis, profile);
  check(`hard:${profile.id}`, issues.length === 0, issues.slice(0, 2).join('; '));
}

console.log('\n-- 4. Extended profiles golden analysis (dietetic) --');
for (const profile of EXTENDED_PROFILES) {
  const analysis = buildGoldenAnalysis(profile);
  normalizeAnalysisOutput(analysis);
  const issues = validateAnalysisDietetic(analysis, profile);
  // Golden fixtures are generic — only strict rules (lactation, keto, muscle) may warn
  const strictOnly = issues.filter(i =>
    /лактация|кето|мускулна|диабет/i.test(i)
  );
  check(`extended:${profile.id}`, strictOnly.length === 0, strictOnly.slice(0, 2).join('; ') || 'OK');
}

console.log('\n-- 5. Slot physiology rules --');
{
  const h5carb = validateWeekPlanDietetic({
    day1: { meals: [{ type: 'Хранене 5', name: 'Банан', description: '• банан 120g', calories: 100 }] },
  }, {}, {});
  check('H5 rejects banana', h5carb.length > 0);

  const h3main = validateWeekPlanDietetic({
    day1: { meals: [{ type: 'Хранене 3', name: 'Ориз', description: '• ориз 150g', calories: 200 }] },
  }, {}, {});
  check('H3 rejects rice-only', h3main.length > 0);
}

const passed = results.filter(Boolean).length;
console.log(`\n=== Dietetic: ${passed}/${results.length} PASS ===`);
process.exit(passed === results.length ? 0 : 1);
