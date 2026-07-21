#!/usr/bin/env node
/**
 * Live plan adequacy — multiple profiles against production/staging worker.
 * npm run test:plan-adequacy:live [--base=URL] [--profiles=quick|all]
 */
import { PROFILES } from './fixtures/profiles.mjs';
import { validateAnalysis } from './validators/analysis.mjs';
import { validateStrategy, validateMealPlan } from './validators/plan.mjs';
import { validateFrontendProjection } from './validators/frontend.mjs';
import { validateProductNamesInCatalog } from '../../food-catalog.js';
import { parseMealDescription } from '../../food-nutrition.js';

const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1]
  || 'https://aidiet.radilov-k.workers.dev';
const MODE = process.argv.find(a => a.startsWith('--profiles='))?.split('=')[1] || 'quick';
const POLL_MS = 8000;
const MAX_WAIT_MS = 25 * 60 * 1000;

const LIVE_PROFILES = MODE === 'all' ? PROFILES : PROFILES.slice(0, 3);

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
    ...validateFrontendProjection(plan),
  ];

  if (!plan.summary?.recommendations?.length) issues.push('summary.recommendations липсва');
  if (!plan.summary?.supplements?.length) issues.push('summary.supplements липсва');

  const weekPlan = plan.weekPlan || {};
  for (let d = 1; d <= 7; d++) {
    const day = weekPlan[`day${d}`];
    if (!day?.meals) continue;
    for (const meal of day.meals) {
      const unknown = validateProductNamesInCatalog(
        parseMealDescription(meal.description || '').map(i => i.name)
      );
      if (unknown.length) issues.push(`day${d} "${meal.name}": продукти извън каталога: ${unknown.join(', ')}`);
    }
  }

  return [...new Set(issues)];
}

async function generateForProfile(profile) {
  const data = {
    ...profile,
    email: `adequacy-${profile.id}-${Date.now()}@aidiet-test.local`,
    name: profile.name || `Тест ${profile.id}`,
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
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const st = await api(`/api/plan-job-status?jobId=${jobId}`);
    if (st.json.status === 'completed') return { plan: st.json.plan, jobId, elapsed: Math.round((Date.now() - t0) / 1000) };
    if (st.json.status === 'failed') throw new Error(st.json.error || 'job failed');
  }
  throw new Error('timeout');
}

async function main() {
  console.log(`=== Live plan adequacy: ${BASE} (${MODE}: ${LIVE_PROFILES.length} профила) ===\n`);

  const cfg = await api('/api/admin/get-config');
  if (cfg.status !== 200) throw new Error('get-config failed');
  console.log(`Provider: ${cfg.json.provider}, model: ${cfg.json.modelName}`);
  console.log(`KV prompts: analysis=${!!cfg.json.analysisPrompt}, strategy=${!!cfg.json.strategyPrompt}\n`);

  let pass = 0;
  const results = [];

  for (const profile of LIVE_PROFILES) {
    console.log(`\n--- ${profile.id} (${profile.goal}, ${profile.gender}) ---`);
    try {
      const { plan, jobId, elapsed } = await generateForProfile(profile);
      const issues = analyzePlan(plan, profile);
      const ok = issues.length === 0;
      if (ok) pass++;
      results.push({ id: profile.id, ok, issues, jobId, elapsed });
      console.log(ok ? `✓ PASS (${elapsed}s)` : `✗ FAIL (${elapsed}s): ${issues.length} проблема`);
      for (const i of issues.slice(0, 8)) console.log(`    • ${i}`);
      if (issues.length > 8) console.log(`    ... +${issues.length - 8} още`);
    } catch (e) {
      results.push({ id: profile.id, ok: false, issues: [e.message] });
      console.log(`✗ ERROR: ${e.message}`);
    }
  }

  console.log(`\n=== Live: ${pass}/${LIVE_PROFILES.length} профила PASS ===`);
  process.exit(pass === LIVE_PROFILES.length ? 0 : 1);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
