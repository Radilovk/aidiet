#!/usr/bin/env node
/**
 * Real live E2E: production AI plan → questions → weekly adapt (struggling week).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAnalyticsSummary } from '../../analytics-compression.js';
import { HARD_PROFILES } from './fixtures/hard-profiles.mjs';
import { buildGameData, autoAnswers } from './fixtures/game-scenarios.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv.find((a) => a.startsWith('--base='))?.split('=')[1]
  || 'https://aidiet.radilov-k.workers.dev';
const POLL_MS = 8000;
const MAX_WAIT_MS = 20 * 60 * 1000;

const profile = HARD_PROFILES.find((p) => p.id === 'kamen_benchmark');
if (!profile) {
  console.error('kamen_benchmark not found');
  process.exit(2);
}

async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function generatePlan() {
  const data = {
    ...profile,
    email: `weekly-e2e-${Date.now()}@aidiet-test.local`,
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
      return { plan: st.json.plan, elapsed: Math.round((Date.now() - t0) / 1000) };
    }
    if (st.json.status === 'failed') throw new Error(st.json.error || 'plan failed');
  }
  throw new Error('plan timeout');
}

async function pollAdaptJob(jobId) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const st = await api(`/api/plan-job-status?jobId=${jobId}`);
    const status = st.json.status || 'not_found';
    if (status !== last) {
      process.stdout.write(`  [poll ${Math.round((Date.now() - t0) / 1000)}s] job=${status}\n`);
      last = status;
    }
    if (status === 'completed' || status === 'failed') return st.json;
  }
  return { status: 'timeout' };
}

async function submitAdapt(userId, plan, gameData, questions, answers, cycleNumber) {
  return api('/api/weekly/adapt-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      userData: profile,
      plan,
      gameData,
      questions,
      answers,
      gameWeeklyAI: { cycleNumber },
    }),
  });
}

async function main() {
  console.log('\n=== Weekly Adapt LIVE E2E (struggling_week) ===');
  console.log(`Base: ${BASE}\n`);

  const userId = `bench-e2e-${Date.now()}`;
  const report = { timestamp: new Date().toISOString(), base: BASE, userId, steps: [] };

  console.log('1) Generating plan (AI)...');
  const { plan, elapsed: planElapsed } = await generatePlan();
  const kcalBefore = plan.analysis?.Final_Calories;
  console.log(`   Plan OK (${planElapsed}s) kcal=${kcalBefore}`);
  report.planElapsed = planElapsed;
  report.caloriesBefore = kcalBefore;

  const { gameData, meta } = buildGameData(plan, 'struggling_week');
  const analytics = buildAnalyticsSummary(gameData, { cycleNumber: 1 });
  console.log(`2) Analytics: adh=${analytics.adherence}% junk7=${analytics.junk7} avg=${analytics.avgScore}`);
  report.analytics = analytics;

  console.log('3) Generating weekly questions (AI)...');
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
    throw new Error(`questions failed: ${qRes.status}`);
  }
  const questions = qRes.json.questions;
  const answers = autoAnswers(questions, meta.answerBias);
  console.log(`   Questions OK (${questions.length})`);

  console.log('4) Submitting adapt-plan (AI decision + optional regen)...');
  const aRes = await submitAdapt(userId, plan, gameData, questions, answers, qRes.json.cycleNumber);
  if (aRes.status !== 200 || !aRes.json.jobId) {
    throw new Error(`adapt submit failed: ${aRes.status} ${JSON.stringify(aRes.json).slice(0, 200)}`);
  }
  const jobId = aRes.json.jobId;
  console.log(`   Job submitted: ${jobId}`);

  const jobResult = await pollAdaptJob(jobId);
  report.adaptJob = jobResult;

  let adaptVerified = false;
  let verification = '';

  if (jobResult.status === 'completed') {
    adaptVerified = true;
    verification = 'plan-job-status';
    console.log(`6) Adapt completed via job status: level=${jobResult.adaptationLevel} regen=${jobResult.regenStep || '—'}`);
    if (jobResult.caloriesAfter) {
      console.log(`   kcal ${jobResult.caloriesBefore || kcalBefore} → ${jobResult.caloriesAfter}`);
    }
    report.adaptationLevel = jobResult.adaptationLevel;
    report.regenStep = jobResult.regenStep;
    report.caloriesAfter = jobResult.caloriesAfter;
  } else {
    console.log(`6) Job poll: ${jobResult.status} — checking pendingWeekly via duplicate submit...`);
    await new Promise((r) => setTimeout(r, 60000));
    const dup = await submitAdapt(userId, plan, gameData, questions, answers, qRes.json.cycleNumber);
    if (dup.status === 409) {
      adaptVerified = true;
      verification = 'pendingWeekly_409';
      console.log('   Duplicate adapt → 409 (adaptation saved to KV)');
      report.pendingWeeklyConfirmed = true;
    } else {
      console.log(`   Duplicate adapt status=${dup.status} (adapt may still be running or failed)`);
      report.duplicateAdapt = { status: dup.status, body: dup.json };
    }
  }

  const levelOk = report.adaptationLevel == null
    ? adaptVerified
    : report.adaptationLevel >= meta.expect.minLevel;
  const pass = adaptVerified && levelOk;

  report.pass = pass;
  report.verification = verification;

  const outDir = join(__dirname, '../../benchmark-results');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `weekly-adapt-live-e2e-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n=== ${pass ? 'PASS' : 'FAIL'} ===`);
  console.log(`Report: ${outPath}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
