#!/usr/bin/env node
/**
 * Weekly adaptation benchmark — existing hard profiles + synthetic game scenarios.
 *
 * Offline: analytics compression + expectations (no AI).
 * Live (--confirm): plan gen → questions → adaptation decision (+ regen if --full).
 *
 *   node scripts/plan-adequacy/run-weekly-adapt-benchmark.mjs
 *   node scripts/plan-adequacy/run-weekly-adapt-benchmark.mjs --confirm
 *   node scripts/plan-adequacy/run-weekly-adapt-benchmark.mjs --confirm --full
 *   node scripts/plan-adequacy/run-weekly-adapt-benchmark.mjs --confirm --only=kamen_benchmark
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAnalyticsSummary } from '../../analytics-compression.js';
import { HARD_PROFILES } from './fixtures/hard-profiles.mjs';
import {
  SCENARIO_IDS,
  buildGameData,
  autoAnswers,
  mealKeysFromPlan,
  dateKeyOffset,
} from './fixtures/game-scenarios.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const CONFIRMED = args.includes('--confirm') || process.env.AIDIET_LIVE_TESTS === '1';
const FULL = args.includes('--full');
const BASE = args.find((a) => a.startsWith('--base='))?.split('=')[1]
  || 'https://aidiet.radilov-k.workers.dev';
const ONLY_IDS = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',').map((s) => s.trim()).filter(Boolean);
const POLL_MS = 8000;
const MAX_WAIT_MS = 20 * 60 * 1000;

const BENCHMARK_PROFILES = ONLY_IDS?.length
  ? HARD_PROFILES.filter((p) => ONLY_IDS.includes(p.id))
  : [
    HARD_PROFILES.find((p) => p.id === 'kamen_benchmark'),
    HARD_PROFILES.find((p) => p.id === 'diabetes_sweets_craving'),
    HARD_PROFILES.find((p) => p.id === 'emotional_burger_stress'),
  ].filter(Boolean);

if (!BENCHMARK_PROFILES.length) {
  console.error('Няма профили за benchmark');
  process.exit(2);
}

async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function generatePlan(profile) {
  const data = {
    ...profile,
    email: `weekly-bench-${profile.id}-${Date.now()}@aidiet-test.local`,
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
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const st = await api(`/api/plan-job-status?jobId=${jobId}`);
    if (st.json.status === 'completed') {
      return { plan: st.json.plan, jobId, elapsed: Math.round((Date.now() - t0) / 1000) };
    }
    if (st.json.status === 'failed') throw new Error(st.json.error || 'plan failed');
  }
  throw new Error('plan generation timeout');
}

async function pollAdaptJob(jobId) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const st = await api(`/api/plan-job-status?jobId=${jobId}`);
    const status = st.json.status || 'not_found';
    if (status !== last) {
      process.stdout.write(`    [adapt ${Math.round((Date.now() - t0) / 1000)}s] ${status}\n`);
      last = status;
    }
    if (status === 'completed' || status === 'failed') return st.json;
    if (status === 'not_found' && Date.now() - t0 > 120000) {
      return { status: 'not_found', hint: 'Worker may need deploy for weekly_adapt job status KV' };
    }
  }
  return { status: 'timeout' };
}

function evaluateOffline(analytics, expect) {
  const issues = [];
  if (expect.minDays && (analytics.daysRecorded || 0) < expect.minDays) {
    issues.push(`daysRecorded ${analytics.daysRecorded} < ${expect.minDays}`);
  }
  if (expect.maxDays && (analytics.daysRecorded || 0) > expect.maxDays) {
    issues.push(`daysRecorded ${analytics.daysRecorded} > ${expect.maxDays}`);
  }
  if (analytics.status !== 'active' && expect.minDays) {
    issues.push(`analytics.status=${analytics.status}`);
  }
  return issues;
}

function evaluateAdapt(result, expect) {
  const issues = [];
  if (result.status !== 'completed') {
    issues.push(`job status: ${result.status}${result.hint ? ` (${result.hint})` : ''}`);
    return issues;
  }
  const level = result.adaptationLevel ?? 99;
  if (expect.maxLevel != null && level > expect.maxLevel) {
    issues.push(`adaptationLevel ${level} > expected max ${expect.maxLevel}`);
  }
  if (expect.minLevel != null && level < expect.minLevel) {
    issues.push(`adaptationLevel ${level} < expected min ${expect.minLevel}`);
  }
  return issues;
}

function testFreezeParity(plan) {
  const mealKeys = mealKeysFromPlan(plan);
  const planned = 2000;
  const key = dateKeyOffset(3);
  const rec = {
    date: key,
    meals: {},
    mealCalories: {},
    plannedCalories: planned,
    mealSlots: [...mealKeys],
    lockedPlannedCalories: planned,
    extraMeals: [],
  };
  mealKeys.forEach((k) => { rec.meals[k] = true; rec.mealCalories[k] = 400; });
  // Ghost key from an old plan layout
  rec.meals['Свободно хранене'] = false;
  const analytics = buildAnalyticsSummary({ [key]: rec }, {});
  if (!analytics.daysRecorded) return ['freeze parity: no days recorded'];
  return [];
}

async function main() {
  console.log('\n=== Weekly Adaptation Benchmark ===');
  console.log(`Base: ${BASE}`);
  console.log(`Profiles: ${BENCHMARK_PROFILES.map((p) => p.id).join(', ')}`);
  console.log(`Mode: ${CONFIRMED ? (FULL ? 'live+full' : 'live+questions') : 'offline-only'}\n`);

  const freezeIssues = testFreezeParity({ weekPlan: { day1: { meals: [{ type: 'Закуска' }, { type: 'Обяд' }, { type: 'Вечеря' }] } } });
  if (freezeIssues.length) console.warn('Freeze parity warnings:', freezeIssues);

  const results = [];
  let pass = 0;
  let total = 0;

  for (const profile of BENCHMARK_PROFILES) {
    console.log(`\n━━━ ${profile.id} ━━━`);
    let plan = null;
    let planElapsed = 0;

    if (CONFIRMED) {
      try {
        const gen = await generatePlan(profile);
        plan = gen.plan;
        planElapsed = gen.elapsed;
        console.log(`  Plan generated (${planElapsed}s) kcal=${plan.analysis?.Final_Calories}`);
      } catch (e) {
        console.log(`  ✗ Plan gen: ${e.message}`);
        results.push({ profile: profile.id, error: e.message });
        continue;
      }
    } else {
      plan = {
        analysis: { Final_Calories: '1800 kcal/ден' },
        strategy: { weeklyScheme: { monday: { mealBreakdown: [{ type: 'Хранене 1' }, { type: 'Хранене 2' }, { type: 'Хранене 4' }] } } },
        weekPlan: {
          day1: {
            meals: [
              { type: 'Закуска', calories: 400 },
              { type: 'Обяд', calories: 550 },
              { type: 'Вечеря', calories: 500 },
            ],
          },
        },
      };
    }

    for (const scenarioId of SCENARIO_IDS) {
      total++;
      const { gameData, meta } = buildGameData(plan, scenarioId);
      const analytics = buildAnalyticsSummary(gameData, { cycleNumber: 1 });
      const offlineIssues = evaluateOffline(analytics, meta.expect);

      console.log(`  [${scenarioId}] offline adh=${analytics.adherence}% days=${analytics.daysRecorded}/7 junk7=${analytics.junk7} avg=${analytics.avgScore}`);

      let liveIssues = [];
      let adaptResult = null;

      if (CONFIRMED) {
        const userId = `bench-weekly-${profile.id}-${Date.now()}`;
        const qRes = await api('/api/weekly/generate-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            userData: profile,
            plan,
            gameData,
            gameWeeklyAI: { cycleNumber: 0 },
          }),
        });
        if (qRes.status !== 200 || !qRes.json.questions?.length) {
          liveIssues.push(`questions: ${qRes.status} ${JSON.stringify(qRes.json).slice(0, 120)}`);
        } else {
          const questions = qRes.json.questions;
          const answers = autoAnswers(questions, meta.answerBias);
          console.log(`    questions OK (${questions.length}) cycle=${qRes.json.cycleNumber}`);

          if (FULL) {
            const saveRes = await api('/api/user/save-profile', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, plan, userData: profile }),
            });
            if (saveRes.status !== 200) {
              liveIssues.push(`save-profile: ${saveRes.status}`);
            }
            const aRes = await api('/api/weekly/adapt-plan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId,
                userData: profile,
                plan,
                gameData,
                questions,
                answers,
                gameWeeklyAI: { cycleNumber: qRes.json.cycleNumber },
              }),
            });
            if (aRes.status !== 200 || !aRes.json.jobId) {
              liveIssues.push(`adapt submit: ${aRes.status} ${JSON.stringify(aRes.json).slice(0, 120)}`);
            } else {
              adaptResult = await pollAdaptJob(aRes.json.jobId);
              if (adaptResult.status === 'completed') {
                console.log(`    adapt level=${adaptResult.adaptationLevel} changed=${adaptResult.changed} regen=${adaptResult.regenStep || '—'}`);
                if (adaptResult.caloriesBefore || adaptResult.caloriesAfter) {
                  console.log(`    kcal ${adaptResult.caloriesBefore} → ${adaptResult.caloriesAfter}`);
                }
                liveIssues.push(...evaluateAdapt(adaptResult, meta.expect));
              } else if (adaptResult.status === 'not_found') {
                console.log(`    adapt submitted (jobId ${aRes.json.jobId}) — job status not in KV (deploy PR #1335?)`);
                liveIssues.push('adapt job status not_found — cannot verify adaptation on production without deploy');
              } else {
                liveIssues.push(...evaluateAdapt(adaptResult, meta.expect));
              }
            }
          }
        }
      }

      const issues = [...offlineIssues, ...liveIssues];
      const ok = issues.length === 0;
      if (ok) pass++;
      console.log(ok ? '    ✓ PASS' : `    ✗ FAIL — ${issues.join('; ')}`);

      results.push({
        profile: profile.id,
        scenario: scenarioId,
        ok,
        planElapsed,
        analytics: {
          adherence: analytics.adherence,
          daysRecorded: analytics.daysRecorded,
          junk7: analytics.junk7,
          avgScore: analytics.avgScore,
          trend: analytics.trend,
        },
        adapt: adaptResult ? {
          status: adaptResult.status,
          adaptationLevel: adaptResult.adaptationLevel,
          changed: adaptResult.changed,
          regenStep: adaptResult.regenStep,
          changeSummary: adaptResult.changeSummary,
        } : null,
        issues,
      });
    }
  }

  const outDir = join(__dirname, '../../benchmark-results');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `weekly-adapt-bench-${Date.now()}.json`);
  const report = {
    timestamp: new Date().toISOString(),
    base: BASE,
    mode: CONFIRMED ? (FULL ? 'live-full' : 'live') : 'offline',
    pass,
    total,
    results,
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n=== Weekly Adapt: ${pass}/${total} PASS ===`);
  console.log(`Report: ${outPath}\n`);
  console.table(results.map((r) => ({
    profile: r.profile,
    scenario: r.scenario,
    status: r.ok ? 'PASS' : 'FAIL',
    adh: r.analytics?.adherence,
    days: r.analytics?.daysRecorded,
    level: r.adapt?.adaptationLevel ?? '—',
  })));

  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
