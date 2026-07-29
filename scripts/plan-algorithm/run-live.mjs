#!/usr/bin/env node
/**
 * Live full algorithm test — real AI plans + scenario coverage.
 *
 * РЪЧНО САМО:
 *   npm run test:plan-algorithm:live -- --confirm
 *   npm run test:plan-algorithm:live -- --confirm --scenario=full
 *   npm run test:plan-algorithm:live -- --confirm --scenario=sweets
 *   npm run test:plan-algorithm:live -- --confirm --scenario=profile-delta
 *
 * Scenarios:
 *   quick         — 1 profile full generate (default)
 *   full          — 3 diverse profiles
 *   sweets        — sweets craving → dessert markers
 *   free-day      — emotional eating profile → free meal day
 *   profile-delta — generate, then regen with changed weight/goal (async, no auth approval)
 */
import { PROFILES } from '../plan-adequacy/fixtures/profiles.mjs';
import { validateAnalysis } from '../plan-adequacy/validators/analysis.mjs';
import { validateStrategy, validateMealPlan } from '../plan-adequacy/validators/plan.mjs';
import { validateFrontendProjection } from '../plan-adequacy/validators/frontend.mjs';
import { validateWeekPlanNutrition } from '../plan-adequacy/validators/nutrition.mjs';
import { validateWeekPlanFoods } from '../plan-adequacy/validators/foods.mjs';
import { validateWeekPlanCombinations } from '../plan-adequacy/validators/combinations.mjs';
import {
  userHasSweetsCraving,
  FIXED_DESSERT,
} from '../../plan-pipeline-pure.js';
import {
  classifyProfileChanges,
  buildProfileRegenRequest,
  buildFoodPickerListPayload,
} from '../../plan-regen-contracts.js';

const args = process.argv.slice(2);
const CONFIRMED = args.includes('--confirm') || process.env.AIDIET_LIVE_TESTS === '1';
const BASE = args.find(a => a.startsWith('--base='))?.split('=')[1]
  || 'https://aidiet.radilov-k.workers.dev';
const SCENARIO = args.find(a => a.startsWith('--scenario='))?.split('=')[1] || 'quick';
const POLL_MS = 8000;
const MAX_WAIT_MS = 25 * 60 * 1000;

if (!CONFIRMED) {
  console.error(`Live algorithm тестовете ползват реални AI заявки.

  npm run test:plan-algorithm:live -- --confirm
  npm run test:plan-algorithm:live -- --confirm --scenario=full|sweets|free-day|profile-delta

Offline: npm run test:plan-algorithm`);
  process.exit(2);
}

async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function analyzePlan(plan, profile, { expectDessert = false, expectFreeDay = false } = {}) {
  const issues = [
    ...validateAnalysis(plan.analysis, profile),
    ...validateStrategy(plan.strategy),
    ...validateMealPlan(plan.weekPlan, plan.strategy),
    ...validateWeekPlanNutrition(plan.weekPlan, plan.strategy),
    ...validateWeekPlanFoods(plan.weekPlan),
    ...validateWeekPlanCombinations(plan.weekPlan),
    ...validateFrontendProjection(plan),
  ];

  if (!plan.summary?.recommendations?.length) issues.push('summary.recommendations липсва');
  if (!plan.summary?.supplements?.length) issues.push('summary.supplements липсва');

  if (expectDessert) {
    if (plan.strategy?.includeDessert === false) {
      issues.push('очакван includeDessert=true, но е false');
    }
    let dessertCount = 0;
    for (let d = 1; d <= 7; d++) {
      for (const meal of plan.weekPlan?.[`day${d}`]?.meals || []) {
        if (meal.dessert) dessertCount++;
      }
    }
    if (dessertCount === 0) issues.push('очакван dessert на Хранене 2, но няма');
  }

  if (expectFreeDay) {
    const fd = plan.strategy?.freeDayNumber;
    if (fd != null && (fd < 6 || fd > 7)) issues.push(`freeDayNumber ${fd} не е уикенд`);
    if (fd != null) {
      const day = plan.weekPlan?.[`day${fd}`];
      const hasFree = day?.meals?.some(m => m.type === 'Свободно хранене');
      if (!hasFree) issues.push(`ден ${fd}: липсва Свободно хранене`);
    }
  }

  const fc = plan.analysis?.Final_Calories;
  const mg = plan.analysis?.macroGrams;
  if (fc && mg) {
    const calc = (mg.protein || 0) * 4 + (mg.carbs || 0) * 4 + (mg.fats || 0) * 9;
    if (Math.abs(calc - fc) > 40) issues.push(`analysis macros ${calc} ≠ Final_Calories ${fc}`);
  }

  return [...new Set(issues)];
}

async function generateForProfile(profile, extra = {}) {
  const data = {
    ...profile,
    ...extra,
    email: `algo-${profile.id}-${Date.now()}@aidiet-test.local`,
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
    if (st.json.status === 'completed') {
      return { plan: st.json.plan, jobId, elapsed: Math.round((Date.now() - t0) / 1000), data };
    }
    if (st.json.status === 'failed') throw new Error(st.json.error || 'job failed');
  }
  throw new Error('timeout');
}

function pickProfiles(scenario) {
  if (scenario === 'full') return PROFILES.slice(0, 3);
  if (scenario === 'sweets') {
    const p = { ...PROFILES[0], id: 'sweets_craving', foodCravings: ['Сладко'], medicalConditions: [] };
    return [p];
  }
  if (scenario === 'free-day') {
    const p = PROFILES.find(x => x.id === 'emotional_eating') || {
      ...PROFILES[0],
      id: 'emotional_free',
      foodTriggers: ['емоции', 'стрес'],
      overeatingFrequency: 'Често',
    };
    return [p];
  }
  if (scenario === 'profile-delta') return [PROFILES[0]];
  return [PROFILES[0]];
}

async function runProfileDelta(profile) {
  console.log('\n--- profile-delta: initial generate ---');
  const first = await generateForProfile(profile);
  let issues = analyzePlan(first.plan, profile);
  console.log(issues.length ? `✗ initial FAIL: ${issues.length}` : `✓ initial PASS (${first.elapsed}s)`);

  const updated = {
    ...first.data,
    weight: String(Number(first.data.weight) - 2),
    goal: first.data.goal === 'Отслабване' ? 'Мускулна маса' : 'Отслабване',
  };
  const classification = classifyProfileChanges({
    weight: { old: first.data.weight, new: updated.weight, dietRelated: true },
    goal: { old: first.data.goal, new: updated.goal, dietRelated: true },
  });
  if (!classification.requiresRegen) issues.push('classifyProfileChanges трябва requiresRegen');

  const payload = buildProfileRegenRequest({
    userData: updated,
    jobId: crypto.randomUUID(),
    requireApproval: false,
  });
  console.log('--- profile-delta: regen after weight/goal change ---');
  const start = await api('/api/generate-plan-async', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (start.status !== 200 || !start.json.jobId) {
    throw new Error(`regen failed: ${start.status}`);
  }
  const jobId = start.json.jobId;
  const t0 = Date.now();
  let plan;
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const st = await api(`/api/plan-job-status?jobId=${jobId}`);
    if (st.json.status === 'completed') { plan = st.json.plan; break; }
    if (st.json.status === 'failed') throw new Error(st.json.error || 'regen job failed');
  }
  if (!plan) throw new Error('regen timeout');
  const regenIssues = analyzePlan(plan, updated);
  if (plan.analysis?.Final_Calories === first.plan.analysis?.Final_Calories) {
    // not always different but weight/goal change usually shifts — soft warning
    console.log('  • note: Final_Calories непроменени след delta (възможно при guardrails)');
  }
  issues = [...issues, ...regenIssues];
  console.log(regenIssues.length ? `✗ regen FAIL: ${regenIssues.length}` : '✓ regen PASS');

  // Food-picker contract smoke (offline shape — live KV write is admin-scoped)
  const picker = buildFoodPickerListPayload({
    selected: ['Пилешки гърди', 'Ориз', 'Броколи', 'Ябълка', 'Яйца', 'Кисело мляко', 'Зехтин', 'Домат'],
    catalogVisible: Array.from({ length: 40 }, (_, i) => `Item${i}`).concat([
      'Пилешки гърди', 'Ориз', 'Броколи', 'Ябълка', 'Яйца', 'Кисело мляко', 'Зехтин', 'Домат',
    ]),
  });
  if (picker.mode !== 'inclusion') issues.push('food-picker smoke: очакван inclusion');
  else console.log('✓ food-picker inclusion payload shape');

  return issues;
}

async function main() {
  console.log(`=== Live plan algorithm: ${BASE} scenario=${SCENARIO} ===\n`);
  const cfg = await api('/api/admin/get-config');
  if (cfg.status !== 200) throw new Error('get-config failed');
  console.log(`Provider: ${cfg.json.provider}, model: ${cfg.json.modelName}`);

  if (SCENARIO === 'profile-delta') {
    const issues = await runProfileDelta(pickProfiles(SCENARIO)[0]);
    console.log(issues.length ? `\n=== FAIL ${issues.length} ===` : '\n=== PASS ===');
    for (const i of issues.slice(0, 12)) console.log(`  • ${i}`);
    process.exit(issues.length ? 1 : 0);
  }

  const profiles = pickProfiles(SCENARIO);
  let pass = 0;
  for (const profile of profiles) {
    const expectDessert = SCENARIO === 'sweets' || userHasSweetsCraving(profile.foodCravings);
    const expectFreeDay = SCENARIO === 'free-day' || /emotional/i.test(profile.id || '');
    console.log(`\n--- ${profile.id} ---`);
    try {
      const { plan, elapsed } = await generateForProfile(profile);
      const issues = analyzePlan(plan, profile, { expectDessert, expectFreeDay });
      if (issues.length === 0) {
        pass++;
        console.log(`✓ PASS (${elapsed}s)`);
      } else {
        console.log(`✗ FAIL (${elapsed}s): ${issues.length}`);
        for (const i of issues.slice(0, 10)) console.log(`  • ${i}`);
      }
      if (expectDessert) {
        console.log(`  dessert fixed kcal=${FIXED_DESSERT.calories}`);
      }
    } catch (e) {
      console.log(`✗ ERROR: ${e.message}`);
    }
  }
  console.log(`\n=== Live: ${pass}/${profiles.length} PASS ===`);
  process.exit(pass === profiles.length ? 0 : 1);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
