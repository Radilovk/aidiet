#!/usr/bin/env node
/**
 * Real local plan generation via wrangler dev (gemini-3.6-flash).
 *
 * Prerequisites:
 *   1. .dev.vars with GEMINI_API_KEY (+ credits in Google AI Studio)
 *   2. Local KV prompts: for f in KV/prompts/*.txt; do wrangler kv key put ...
 *   3. wrangler dev --env production --port 8787
 *
 * Usage:
 *   node scripts/run-gemini-plan-live.mjs
 *   node scripts/run-gemini-plan-live.mjs --base=http://127.0.0.1:8787 --profile=kamen_benchmark
 */
import { HARD_PROFILES } from './plan-adequacy/fixtures/hard-profiles.mjs';
import { validateDietetic } from './plan-adequacy/validators/dietetic.mjs';
import { validateProfileRules } from './plan-adequacy/validators/profile-rules.mjs';
import { validateWeekPlanNutrition } from './plan-adequacy/validators/nutrition.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const BASE = args.find(a => a.startsWith('--base='))?.split('=')[1] || 'http://127.0.0.1:8787';
const profileId = args.find(a => a.startsWith('--profile='))?.split('=')[1] || 'kamen_benchmark';
const POLL_MS = 10000;
const MAX_WAIT_MS = 30 * 60 * 1000;

const profile = HARD_PROFILES.find(p => p.id === profileId);
if (!profile) {
  console.error(`Unknown profile: ${profileId}`);
  process.exit(2);
}

async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function analyzePlan(plan) {
  const wrapped = { analysis: plan.analysis, strategy: plan.strategy, weekPlan: plan.weekPlan };
  return [
    ...validateDietetic(wrapped, profile),
    ...validateProfileRules(wrapped, profile),
    ...validateWeekPlanNutrition(plan.weekPlan, plan.strategy),
  ];
}

const data = {
  ...profile,
  email: `live-${profileId}-${Date.now()}@aidiet-test.local`,
  name: profile.name || profileId,
};

console.log(`=== Live plan: ${profileId} ===`);
console.log(`Base: ${BASE}`);
console.log(`Profile: ${profile.gender}, ${profile.age}г, ${profile.weight}кг\n`);

const start = await api('/api/generate-plan-async', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
if (start.status !== 200 || !start.json.jobId) {
  console.error('Start failed:', start.status, JSON.stringify(start.json).slice(0, 300));
  process.exit(1);
}

const jobId = start.json.jobId;
console.log(`Job: ${jobId}`);
const t0 = Date.now();
let last = '';

while (Date.now() - t0 < MAX_WAIT_MS) {
  await new Promise(r => setTimeout(r, POLL_MS));
  const st = await api(`/api/plan-job-status?jobId=${jobId}`);
  const status = st.json.status;
  if (status !== last) {
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${status}`);
    last = status;
  }
  if (status === 'completed') {
    const plan = st.json.plan;
    const issues = analyzePlan(plan);
    const dayCals = Array.from({ length: 7 }, (_, i) =>
      (plan.weekPlan?.[`day${i + 1}`]?.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0));

    console.log('\n=== RESULT ===');
    console.log(`Intake: ${plan.analysis?.Final_Calories} kcal | TDEE: ${plan.analysis?.tdee}`);
    console.log(`Review: ${plan.analysis?.correctedMetabolism?.appliedReviewPercent ?? 0}%`);
    console.log(`Diet: ${plan.strategy?.libraryDietProfile} (${plan.strategy?.dietaryModifier})`);
    console.log(`Strategy review: ${plan.strategy?._strategyReview?.verdict || '—'}`);
    console.log(`Day kcal: ${dayCals.join(', ')} (min ${Math.min(...dayCals)})`);
    console.log(`Issues: ${issues.length}`);
    for (const i of issues.slice(0, 10)) console.log(`  • ${i}`);

    try {
      mkdirSync('/opt/cursor/artifacts', { recursive: true });
      const out = `/opt/cursor/artifacts/live-plan-${profileId}.json`;
      writeFileSync(out, JSON.stringify({ profileId, jobId, plan, issues }, null, 2));
      console.log(`\nSaved: ${out}`);
    } catch (_) { /* optional */ }

    process.exit(issues.length ? 1 : 0);
  }
  if (status === 'failed') {
    console.error('\nFAILED:', st.json.error || JSON.stringify(st.json).slice(0, 400));
    process.exit(1);
  }
}

console.error('Timeout');
process.exit(1);
