/**
 * End-to-end plan generation test against production worker.
 * Usage: node test-full-plan-e2e.mjs [--base=https://aidiet.radilov-k.workers.dev]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProductNamesInCatalog } from './food-catalog.js';
import { parseMealDescription } from './food-nutrition.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1]
  || 'https://aidiet.radilov-k.workers.dev';
const POLL_MS = 8000;
const MAX_WAIT_MS = 20 * 60 * 1000;

const STEP_PATTERNS = [
  { key: 'step1', re: /step1_analysis/ },
  { key: 'step2', re: /step2_strategy/ },
  { key: 'step3', re: /step3_meal_plan_chunk/ },
  { key: 'step4', re: /step4_summary/ },
  { key: 'step5', re: /step5_meal_enrichment/ },
];

function loadSampleData() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'clients/EXAMPLE_client_data.json'), 'utf8'));
  const data = { ...raw.answers };
  data.email = `e2e-test-${Date.now()}@aidiet-test.local`;
  data.name = 'Тест Клиент';
  delete data.files;
  return data;
}

async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function summarizeStepLogs(logs) {
  const byStep = {};
  for (const log of logs) {
    const step = log.stepName || 'unknown';
    if (!byStep[step]) byStep[step] = [];
    byStep[step].push(log);
  }
  return byStep;
}

function analyzePlan(plan) {
  const issues = [];
  const notes = [];

  if (!plan?.analysis) issues.push('Липсва analysis');
  else {
    const a = plan.analysis;
    if (!a.Final_Calories && !a.recommendedCalories) issues.push('Analysis: няма Final_Calories');
    if (!a.macroGrams) issues.push('Analysis: няма macroGrams');
    else notes.push(`Калории: ${a.Final_Calories || a.recommendedCalories}, макроси P${a.macroGrams.protein}/C${a.macroGrams.carbs}/F${a.macroGrams.fats}`);
  }

  if (!plan?.strategy?.weeklyScheme) issues.push('Strategy: липсва weeklyScheme');
  else {
    const days = Object.keys(plan.strategy.weeklyScheme);
    if (days.length < 7) issues.push(`Strategy: само ${days.length} дни в weeklyScheme`);
    const mon = plan.strategy.weeklyScheme.monday;
    if (!mon?.mealBreakdown?.length) issues.push('Strategy: липсва mealBreakdown');
    else notes.push(`Стратегия: ${plan.strategy.dietaryModifier || plan.strategy.dietType}, ${mon.mealBreakdown.length} хранения/ден`);
  }

  const weekPlan = plan?.weekPlan || plan;
  let mealCount = 0;
  let catalogErrors = 0;
  let missingMacros = 0;
  let missingDesc = 0;
  let enriched = 0;

  for (let d = 1; d <= 7; d++) {
    const day = weekPlan[`day${d}`];
    if (!day?.meals?.length) {
      issues.push(`Ден ${d}: липсва`);
      continue;
    }
    for (const meal of day.meals) {
      mealCount++;
      if (!meal.description || !/\d+\s*(g|г)\b/i.test(meal.description)) missingDesc++;
      if (!meal.macros && meal.type !== 'Свободно хранене' && meal.type !== 'Напитка') missingMacros++;
      const unknown = validateProductNamesInCatalog(parseMealDescription(meal.description || '').map(i => i.name));
      if (unknown.length) catalogErrors++;
      if (meal.benefits || meal.recipe) enriched++;
    }
  }

  notes.push(`План: ${mealCount} хранения за 7 дни`);
  if (missingDesc) issues.push(`${missingDesc} хранения без грамажи в description`);
  if (missingMacros) issues.push(`${missingMacros} хранения без macros`);
  if (catalogErrors) issues.push(`${catalogErrors} хранения с продукти извън каталога`);

  if (plan?.generationWarnings?.length) {
    notes.push(`generationWarnings: ${plan.generationWarnings.length}`);
    for (const w of plan.generationWarnings.slice(0, 3)) notes.push(`  ⚠ ${w.slice(0, 120)}`);
  }

  if (plan?.summary) notes.push('Summary: OK');
  else issues.push('Липсва summary');

  const enrichPct = mealCount ? Math.round((enriched / mealCount) * 100) : 0;
  notes.push(`Step 5 enrichment: ${enrichPct}% ястия с benefits/recipe`);

  return { issues, notes };
}

function printStepReport(byStep) {
  console.log('\n=== AI стъпки (от логове) ===\n');
  const groups = [
    ['Стъпка 1 — Анализ', /step1_analysis/],
    ['Стъпка 2 — Стратегия', /step2_strategy/],
    ['Стъпка 3 — План (chunks)', /step3_meal_plan_chunk/],
    ['Стъпка 4 — Обобщение', /step4_summary/],
    ['Стъпка 5 — Обогатяване', /step5_meal_enrichment/],
    ['Други', /./],
  ];

  const allSteps = Object.entries(byStep);
  const used = new Set();

  for (const [label, re] of groups) {
    const matches = allSteps.filter(([name]) => re.test(name) && !used.has(name));
    if (!matches.length && label === 'Други') continue;
    if (label === 'Други') {
      const rest = allSteps.filter(([name]) => !used.has(name));
      if (!rest.length) continue;
      console.log(`${label}:`);
      for (const [name, entries] of rest) {
        used.add(name);
        const last = entries[entries.length - 1];
        console.log(`  • ${name}: ${entries.length}× | success=${last.success !== false} | ${last.duration || '?'}ms`);
      }
      continue;
    }
    console.log(`${label}:`);
    for (const [name, entries] of matches) {
      used.add(name);
      const last = entries[entries.length - 1];
      const outTok = last.estimatedOutputTokens || last.response?.estimatedOutputTokens || '?';
      const ok = last.success !== false && !last.hasError && !last.error;
      console.log(`  • ${name}: ${entries.length} опит(а) | ${ok ? '✓' : '✗'} | ~${outTok} out tokens | ${last.duration || '?'}ms`);
      if (!ok && last.error) console.log(`    грешка: ${String(last.error).slice(0, 100)}`);
    }
  }
}

async function main() {
  console.log(`=== E2E тест: ${BASE} ===\n`);

  const config = await api('/api/admin/get-config');
  if (config.status !== 200) throw new Error(`get-config failed: ${config.status}`);
  const cfg = config.json;
  console.log(`Конфиг: provider=${cfg.provider}, model=${cfg.modelName}`);
  console.log(`Промпти KV: analysis=${!!cfg.analysisPrompt}, strategy=${!!cfg.strategyPrompt}, mealPlan=${!!cfg.mealPlanPrompt}, enrichment=${!!cfg.mealEnrichmentPrompt}, summary=${!!cfg.summaryPrompt}`);

  const data = loadSampleData();
  console.log(`\nКлиент: ${data.name}, ${data.age}г, ${data.weight}кг, цел: ${data.goal}`);
  console.log(`Email: ${data.email}\n`);

  const startRes = await api('/api/generate-plan-async', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (startRes.status !== 200 || !startRes.json.jobId) {
    throw new Error(`generate-plan-async failed: ${startRes.status} ${JSON.stringify(startRes.json).slice(0, 300)}`);
  }
  const jobId = startRes.json.jobId;
  console.log(`Job стартиран: ${jobId}`);

  const t0 = Date.now();
  let lastStatus = '';
  let result = null;

  while (Date.now() - t0 < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const st = await api(`/api/plan-job-status?jobId=${jobId}`);
    const status = st.json.status;
    if (status !== lastStatus) {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      console.log(`  [${elapsed}s] status: ${status}`);
      lastStatus = status;
    }
    if (status === 'completed') {
      result = st.json;
      break;
    }
    if (status === 'failed') {
      throw new Error(`Job failed: ${st.json.error || JSON.stringify(st.json)}`);
    }
    if (status === 'not_found') {
      throw new Error('Job not found');
    }
  }

  if (!result) throw new Error('Timeout waiting for plan generation');

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\nГотово за ${elapsed}s`);

  const plan = result.plan;
  const { issues, notes } = analyzePlan(plan);

  console.log('\n=== Резултат от плана ===\n');
  for (const n of notes) console.log(`  ${n}`);
  if (issues.length) {
    console.log('\nПроблеми:');
    for (const i of issues) console.log(`  ✗ ${i}`);
  } else {
    console.log('\n  ✓ Структурни проверки: PASS');
  }

  const logsRes = await api('/api/admin/get-ai-logs?limit=200&offset=0');
  const logs = logsRes.json.logs || [];
  const sessionLogs = logs.filter(l => {
    const prompt = l.prompt || '';
    const step = l.stepName || '';
    return step.includes('step') && (prompt.includes(data.name) || prompt.includes('Тест') || prompt.includes('Отслабване'));
  });
  const recentLogs = sessionLogs.length ? sessionLogs : logs.slice(0, 50);
  const byStep = summarizeStepLogs(recentLogs);
  printStepReport(byStep);

  const stepCounts = {
    step1: Object.keys(byStep).filter(k => /step1_analysis/.test(k)).length,
    step2: Object.keys(byStep).filter(k => /step2_strategy/.test(k)).length,
    step3: Object.keys(byStep).filter(k => /step3_meal_plan_chunk/.test(k)).length,
    step4: Object.keys(byStep).filter(k => /step4_summary/.test(k)).length,
    step5: Object.keys(byStep).filter(k => /step5_meal_enrichment/.test(k)).length,
  };

  console.log('\n=== Оценка на конфигурацията ===\n');
  const checks = [
    ['AI provider = google + gemini-2.5-flash', cfg.provider === 'google' && cfg.modelName?.includes('gemini')],
    ['KV промпти заредени', !!(cfg.mealPlanPrompt && cfg.analysisPrompt && cfg.strategyPrompt)],
    ['Step 1 изпълнен', stepCounts.step1 >= 1],
    ['Step 2 изпълнен', stepCounts.step2 >= 1],
    ['Step 3 — 7 дневни chunks', stepCounts.step3 >= 7],
    ['Step 4 summary', stepCounts.step4 >= 1],
    ['Step 5 enrichment', stepCounts.step5 >= 1],
    ['План с 7 дни', !issues.some(i => i.startsWith('Ден'))],
    ['Продукти от каталога', !issues.some(i => i.includes('каталог'))],
    ['Summary в плана', !issues.includes('Липсва summary')],
  ];

  let pass = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (ok) pass++;
  }

  const adequate = pass >= checks.length - 2 && issues.length <= 2;
  console.log(`\nОбщо: ${pass}/${checks.length} проверки | ${adequate ? 'АДЕКВАТНО конфигурирано' : 'ИМА НЕДОСТАТЪЦИ'}`);
  console.log(`JobId: ${jobId} (валиден 24ч в KV)`);

  process.exit(adequate ? 0 : 1);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
