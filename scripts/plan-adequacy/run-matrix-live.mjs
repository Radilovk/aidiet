#!/usr/bin/env node
/**
 * Economical live matrix — минимален брой AI генерации с пълен adequacy coverage.
 *
 *   npm run test:plan-adequacy:matrix -- --confirm
 *   npm run test:plan-adequacy:matrix -- --confirm --base=https://aidiet.radilov-k.workers.dev
 *   npm run test:plan-adequacy:matrix -- --confirm --only=kamen_benchmark,lactation
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATRIX_ENTRIES } from './fixtures/matrix-profiles.mjs';
import { validateAnalysis } from './validators/analysis.mjs';
import { validateStrategy, validateMealPlan } from './validators/plan.mjs';
import { validateFrontendProjection } from './validators/frontend.mjs';
import { validateWeekPlanNutrition } from './validators/nutrition.mjs';
import { validateWeekPlanFoods } from './validators/foods.mjs';
import { validateWeekPlanCombinations } from './validators/combinations.mjs';
import { validateProfileRules } from './validators/profile-rules.mjs';
import { validateDietetic } from './validators/dietetic.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const CONFIRMED = args.includes('--confirm') || process.env.AIDIET_LIVE_TESTS === '1';
const BASE = args.find(a => a.startsWith('--base='))?.split('=')[1]
  || 'https://aidiet.radilov-k.workers.dev';
const ONLY_IDS = args.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',').map(s => s.trim()).filter(Boolean);
const POLL_MS = 8000;
const MAX_WAIT_MS = 28 * 60 * 1000;

const SELECTED = ONLY_IDS?.length
  ? MATRIX_ENTRIES.filter(e => ONLY_IDS.includes(e.id))
  : MATRIX_ENTRIES;

if (!CONFIRMED) {
  console.error(`Live matrix изисква --confirm (${SELECTED.length} AI плана, ~${SELECTED.length * 3}–${SELECTED.length * 5} min).

  npm run test:plan-adequacy:matrix -- --confirm
  npm run test:plan-adequacy:matrix -- --confirm --only=kamen_benchmark,lactation

Покритие: docs/ADEQUACY_MATRIX.md`);
  process.exit(2);
}

if (ONLY_IDS?.length && !SELECTED.length) {
  console.error(`Няма matrix профили за --only=${ONLY_IDS.join(',')}`);
  process.exit(2);
}

async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function analyzePlan(plan, profile) {
  const issues = [
    ...validateAnalysis(plan.analysis, profile),
    ...validateStrategy(plan.strategy),
    ...validateMealPlan(plan.weekPlan, plan.strategy),
    ...validateWeekPlanNutrition(plan.weekPlan, plan.strategy),
    ...validateWeekPlanFoods(plan.weekPlan),
    ...validateWeekPlanCombinations(plan.weekPlan),
    ...validateFrontendProjection(plan),
    ...validateProfileRules(plan, profile),
    ...validateDietetic(plan, profile),
  ];

  const recommendations = plan.recommendations?.length
    ? plan.recommendations
    : plan.summary?.recommendations;
  const supplements = plan.supplements?.length
    ? plan.supplements
    : plan.summary?.supplements;
  if (!recommendations?.length) issues.push('recommendations липсва');
  if (!supplements?.length) issues.push('supplements липсва');

  return [...new Set(issues)];
}

async function generateForProfile(profile) {
  const data = {
    ...profile,
    email: `matrix-${profile.id}-${Date.now()}@aidiet-test.local`,
    name: profile.name || profile.id,
  };
  const start = await api('/api/generate-plan-async', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (start.status !== 200 || !start.json.jobId) {
    throw new Error(`generate failed: ${start.status} ${JSON.stringify(start.json).slice(0, 200)}`);
  }
  const jobId = start.json.jobId;
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const st = await api(`/api/plan-job-status?jobId=${jobId}`);
    const status = st.json.status;
    if (status !== last) {
      process.stdout.write(`  [${Math.round((Date.now() - t0) / 1000)}s] ${status}\n`);
      last = status;
    }
    if (status === 'completed') {
      return { plan: st.json.plan, jobId, elapsed: Math.round((Date.now() - t0) / 1000) };
    }
    if (status === 'failed') throw new Error(st.json.error || JSON.stringify(st.json).slice(0, 400));
  }
  throw new Error('timeout');
}

async function main() {
  console.log(`\n=== AIDiet Live Adequacy Matrix ===`);
  console.log(`Base: ${BASE}`);
  console.log(`Profiles: ${SELECTED.length} (economical full coverage)\n`);

  for (const e of SELECTED) {
    console.log(`  • ${e.id}: ${e.covers.join('; ')}`);
  }
  console.log('');

  const cfg = await api('/api/admin/get-config');
  if (cfg.status !== 200) throw new Error('get-config failed');
  console.log(`Provider: ${cfg.json.provider} | Model: ${cfg.json.modelName}\n`);

  const results = [];
  let pass = 0;

  for (const entry of SELECTED) {
    const { profile, id, covers } = entry;
    console.log(`\n━━━ ${id} ━━━`);
    console.log(`  Covers: ${covers.join(' | ')}`);
    try {
      const { plan, jobId, elapsed } = await generateForProfile(profile);
      const issues = analyzePlan(plan, profile);
      const genWarnings = plan.generationWarnings || [];
      const ok = issues.length === 0;
      if (ok) pass++;

      const row = {
        id,
        ok,
        elapsed,
        jobId,
        covers,
        calories: plan.analysis?.Final_Calories,
        includeDessert: plan.strategy?.includeDessert,
        mealsPerDay: plan.strategy?.weeklyScheme?.monday?.mealBreakdown?.length,
        sourceMeta: plan.sourceMeta || plan.strategy?.sourceMeta || null,
        generationWarnings: genWarnings,
        issueCount: issues.length,
        issues: issues.slice(0, 25),
      };
      results.push(row);

      console.log(ok ? `  ✓ PASS (${elapsed}s)` : `  ✗ FAIL (${elapsed}s) — ${issues.length} issues`);
      if (genWarnings.length) {
        console.log(`  ⚠ generationWarnings (${genWarnings.length}): ${genWarnings.slice(0, 2).join('; ')}${genWarnings.length > 2 ? '…' : ''}`);
      }
      for (const i of issues.slice(0, 6)) console.log(`    • ${i}`);
      if (issues.length > 6) console.log(`    ... +${issues.length - 6} more`);
    } catch (e) {
      results.push({ id, ok: false, covers, error: e.message, issueCount: 1, issues: [e.message] });
      console.log(`  ✗ ERROR: ${e.message}`);
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    base: BASE,
    mode: 'matrix',
    provider: cfg.json.provider,
    model: cfg.json.modelName,
    pass,
    total: SELECTED.length,
    coverageClaims: SELECTED.flatMap(e => e.covers),
    results,
  };

  const outDir = join(__dirname, '../../benchmark-results');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `matrix-live-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n=== Matrix: ${pass}/${SELECTED.length} PASS ===`);
  console.log(`Report: ${outPath}\n`);
  console.table(results.map(r => ({
    profile: r.id,
    status: r.ok ? 'PASS' : (r.error ? 'ERROR' : 'FAIL'),
    sec: r.elapsed,
    issues: r.issueCount ?? 1,
    warnings: r.generationWarnings?.length ?? 0,
    kcal: r.calories,
  })));

  process.exit(pass === SELECTED.length ? 0 : 1);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
