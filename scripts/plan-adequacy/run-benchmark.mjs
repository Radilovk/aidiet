#!/usr/bin/env node
/**
 * Live benchmark — трудни профили срещу production worker + KV prompts.
 *
 *   node scripts/plan-adequacy/run-benchmark.mjs --confirm
 *   node scripts/plan-adequacy/run-benchmark.mjs --confirm --profiles=quick
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES } from './fixtures/profiles.mjs';
import { HARD_PROFILES } from './fixtures/hard-profiles.mjs';
import { EXTENDED_PROFILES } from './fixtures/extended-profiles.mjs';
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
const MODE = args.find(a => a.startsWith('--profiles='))?.split('=')[1] || 'hard';
const ONLY_IDS = args.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',').map(s => s.trim()).filter(Boolean);
const POLL_MS = 8000;
const MAX_WAIT_MS = 28 * 60 * 1000;

const BENCHMARK_SETS = {
  quick: HARD_PROFILES.slice(0, 2),
  hard: HARD_PROFILES,
  extended: EXTENDED_PROFILES,
  clinical: EXTENDED_PROFILES.filter(p => p.clinicalProtocol),
  all: [...HARD_PROFILES, ...EXTENDED_PROFILES, ...PROFILES.filter(p =>
    !HARD_PROFILES.some(h => h.id === p.id) && !EXTENDED_PROFILES.some(e => e.id === p.id)
  )],
};

const SELECTED = ONLY_IDS?.length
  ? [...HARD_PROFILES, ...EXTENDED_PROFILES, ...PROFILES.filter(p =>
      !HARD_PROFILES.some(h => h.id === p.id) && !EXTENDED_PROFILES.some(e => e.id === p.id)
    )]
      .filter(p => ONLY_IDS.includes(p.id))
  : (BENCHMARK_SETS[MODE] || HARD_PROFILES);

if (ONLY_IDS?.length && !SELECTED.length) {
  console.error(`Няма профили за --only=${ONLY_IDS.join(',')}`);
  process.exit(2);
}

if (!CONFIRMED) {
  console.error(`Live benchmark изисква --confirm (реални AI заявки).

  node scripts/plan-adequacy/run-benchmark.mjs --confirm
  node scripts/plan-adequacy/run-benchmark.mjs --confirm --profiles=quick|hard|extended|clinical|all
  node scripts/plan-adequacy/run-benchmark.mjs --confirm --only=vegan_active`);
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
  return [
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
}

function scorecard(issues) {
  const cats = {
    structure: 0, strategy: 0, nutrition: 0, foods: 0, profile: 0, other: 0,
  };
  for (const i of issues) {
    if (/weeklyScheme|mealBreakdown|meals \(|strategy/.test(i)) cats.strategy++;
    else if (/kcal|protein|carbs|fats|грамаж|weight/.test(i)) cats.nutrition++;
    else if (/каталог|продукт|универсал/.test(i)) cats.foods++;
    else if (/Хранене 1|dessert|H5 slot|ready_meal|Не закусвам|лактация|кето|AIP|веган|диабет|H3:|H5:/i.test(i)) cats.profile++;
    else if (/day\d|липсва|weekPlan/.test(i)) cats.structure++;
    else cats.other++;
  }
  return cats;
}

async function generateForProfile(profile) {
  const data = {
    ...profile,
    email: `bench-${profile.id}-${Date.now()}@aidiet-test.local`,
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
    if (status === 'failed') throw new Error(st.json.error || JSON.stringify(st.json).slice(0, 300));
  }
  throw new Error('timeout');
}

async function main() {
  console.log(`\n=== AIDiet Live Benchmark ===`);
  console.log(`Base: ${BASE}`);
  console.log(`Profiles: ${MODE} (${SELECTED.length})\n`);

  const cfg = await api('/api/admin/get-config');
  if (cfg.status !== 200) throw new Error('get-config failed');
  console.log(`Provider: ${cfg.json.provider} | Model: ${cfg.json.modelName}`);
  console.log(`KV prompts loaded: analysis=${!!cfg.json.analysisPrompt} strategy=${!!cfg.json.strategyPrompt} mealPlan=${!!cfg.json.mealPlanPrompt}\n`);

  const results = [];
  const passedPlans = [];
  let pass = 0;

  for (const profile of SELECTED) {
    console.log(`\n━━━ ${profile.id} ━━━`);
    console.log(`  ${profile.gender}, ${profile.age}г, ${profile.weight}кг | ${JSON.stringify(profile.goal)}`);
    try {
      const { plan, jobId, elapsed } = await generateForProfile(profile);
      const issues = [...new Set(analyzePlan(plan, profile))];
      const ok = issues.length === 0;
      if (ok) pass++;

      const h5Slots = [];
      for (const [dk, ds] of Object.entries(plan.strategy?.weeklyScheme || {})) {
        const h5 = ds.mealBreakdown?.find(m => m.type === 'Хранене 5');
        if (h5) h5Slots.push(`${dk}:${h5.calories}`);
      }

      const summary = {
        id: profile.id,
        ok,
        elapsed,
        jobId,
        calories: plan.analysis?.Final_Calories,
        includeDessert: plan.strategy?.includeDessert,
        mealsPerDay: plan.strategy?.weeklyScheme?.monday?.mealBreakdown?.length,
        h5Slots: h5Slots.join(', ') || 'none',
        issueCount: issues.length,
        issues: issues.slice(0, 20),
        scorecard: scorecard(issues),
        warnings: plan.generationWarnings?.length || 0,
      };
      results.push(summary);
      if (ok) {
        passedPlans.push({
          profile,
          plan,
          jobId,
          elapsed,
          reviewUrl: `${BASE}/api/plan-job-status?jobId=${jobId}`,
        });
      }

      console.log(ok ? `  ✓ PASS (${elapsed}s)` : `  ✗ FAIL (${elapsed}s) — ${issues.length} issues`);
      console.log(`  kcal=${summary.calories} meals=${summary.mealsPerDay} dessert=${summary.includeDessert} H5=[${summary.h5Slots}]`);
      for (const i of issues.slice(0, 8)) console.log(`    • ${i}`);
      if (issues.length > 8) console.log(`    ... +${issues.length - 8} more`);
    } catch (e) {
      results.push({ id: profile.id, ok: false, error: e.message, issueCount: 1, issues: [e.message] });
      console.log(`  ✗ ERROR: ${e.message}`);
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    base: BASE,
    mode: MODE,
    provider: cfg.json.provider,
    model: cfg.json.modelName,
    pass,
    total: SELECTED.length,
    results,
  };

  const outDir = join(__dirname, '../../benchmark-results');
  mkdirSync(outDir, { recursive: true });
  const ts = Date.now();
  const outPath = join(outDir, `benchmark-${MODE}-${ts}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  if (passedPlans.length) {
    const reviewDir = join(outDir, `pass-review-${MODE}-${ts}`);
    mkdirSync(reviewDir, { recursive: true });
    for (const entry of passedPlans) {
      const reviewPath = join(reviewDir, `${entry.profile.id}.json`);
      writeFileSync(reviewPath, JSON.stringify({
        profile: entry.profile,
        jobId: entry.jobId,
        elapsed: entry.elapsed,
        analysis: entry.plan.analysis,
        strategy: entry.plan.strategy,
        weekPlan: entry.plan.weekPlan,
        summary: entry.plan.summary,
        recommendations: entry.plan.recommendations,
        supplements: entry.plan.supplements,
      }, null, 2));
    }
    const reviewMd = passedPlans.map(e => {
      const p = e.plan;
      const mon = p.strategy?.weeklyScheme?.monday;
      const day1 = p.weekPlan?.day1;
      const meals = (day1?.meals || []).map(m =>
        `  - ${m.type}: ${m.name} (${m.calories || '?'} kcal, ${m.weight || '?'})`
      ).join('\n');
      return `## ${e.profile.id} — ${e.profile.name}\n- kcal: ${p.analysis?.Final_Calories} | meals/day: ${mon?.mealBreakdown?.length} | dessert: ${p.strategy?.includeDessert}\n- jobId: \`${e.jobId}\`\n- Day 1:\n${meals}\n`;
    }).join('\n');
    writeFileSync(join(reviewDir, 'REVIEW.md'), `# Passed plans for manual review\n\n${reviewMd}`);
    console.log(`\nReview bundle: ${reviewDir}/`);
    for (const e of passedPlans) console.log(`  → ${e.profile.id}.json`);
  }

  console.log(`\n=== Benchmark: ${pass}/${SELECTED.length} PASS ===`);
  console.log(`Report: ${outPath}\n`);

  const table = results.map(r => ({
    profile: r.id,
    status: r.ok ? 'PASS' : (r.error ? 'ERROR' : 'FAIL'),
    sec: r.elapsed,
    issues: r.issueCount ?? 1,
    kcal: r.calories,
    h5: r.h5Slots,
  }));
  console.table(table);

  process.exit(pass === SELECTED.length ? 0 : 1);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
