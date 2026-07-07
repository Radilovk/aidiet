/**
 * Targeted E2E test: client with the AIP (autoimmune) clinical protocol.
 * Verifies the safety-critical fix — no forbidden foods (eggs, dairy, nuts/seeds,
 * grains, nightshades) should appear anywhere in the generated 7-day plan.
 */
import { validateProductNamesAgainstProtocol } from './food-catalog.js';
import { parseMealDescription } from './food-nutrition.js';

const BASE = 'https://aidiet.radilov-k.workers.dev';
const POLL_MS = 8000;
const MAX_WAIT_MS = 15 * 60 * 1000;

async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function main() {
  const data = {
    name: 'Тест АИП',
    gender: 'Жена',
    age: '38',
    height: '168',
    weight: '65',
    email: `e2e-aip-test-${Date.now()}@aidiet-test.local`,
    goal: 'Подобряване на здравето',
    clinicalProtocol: 'autoimmune_aip',
    autoimmuneDiagnosis: 'Хашимото',
    autoimmuneFlares: 'Понякога',
    sleepHours: '7–8',
    sleepInterrupt: 'Не',
    chronotype: 'Сутрешен',
    dailyActivityLevel: 'Средно',
    stressLevel: 'Средно',
    sportActivity: 'Ниска (1–2 дни седмично)',
    waterIntake: '1.5–2 л',
    overeatingFrequency: 'Рядко',
    foodCravings: ['Не изпитвам такава'],
    foodTriggers: ['Нито едно'],
    eatingHabits: ['Нито една'],
    compensationMethods: ['Не'],
    socialComparison: 'Рядко',
    dietPreference: ['Балансирана'],
    dietDislike: '',
    dietLove: '',
    medicalConditions: ['Автоимунно'],
    medications: 'Не',
  };

  console.log(`=== AIP протокол E2E тест ===\n`);
  console.log(`Клиент: ${data.name}, протокол: ${data.clinicalProtocol}\n`);

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
      console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] status: ${status}`);
      lastStatus = status;
    }
    if (status === 'completed') { result = st.json; break; }
    if (status === 'failed') throw new Error(`Job failed: ${st.json.error}`);
  }
  if (!result) throw new Error('Timeout');

  const plan = result.plan;
  console.log(`\nСтратегия: ${plan.strategy?.dietaryModifier}`);
  console.log(`generationWarnings: ${plan.generationWarnings?.length || 0}`);

  let totalMeals = 0;
  let forbiddenFound = [];
  for (let d = 1; d <= 7; d++) {
    const day = plan.weekPlan?.[`day${d}`];
    if (!day?.meals) continue;
    for (const meal of day.meals) {
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
      totalMeals++;
      const names = parseMealDescription(meal.description || '').map(i => i.name);
      const forbidden = validateProductNamesAgainstProtocol(names, 'autoimmune_aip');
      if (forbidden.length) {
        forbiddenFound.push({ day: d, meal: meal.type, forbidden, description: meal.description });
      }
    }
  }

  console.log(`\nПроверени хранения: ${totalMeals}`);
  if (forbiddenFound.length) {
    console.log(`\n✗ ЗАБРАНЕНИ ХРАНИ НАМЕРЕНИ:`);
    for (const f of forbiddenFound) {
      console.log(`  Ден ${f.day} ${f.meal}: ${f.forbidden.join(', ')}`);
      console.log(`    (${f.description.replace(/\n/g, ' | ')})`);
    }
  } else {
    console.log(`\n✓ НУЛА забранени храни в целия план (проверени всички ${totalMeals} хранения срещу AIP restrictions)`);
  }

  console.log(`\nJobId: ${jobId}`);
  process.exit(forbiddenFound.length ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
