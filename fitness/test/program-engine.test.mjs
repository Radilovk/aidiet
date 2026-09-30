import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCompactIndex, allowedEquipmentSet } from '../worker.js';
import { preparePlanGeneration } from '../plan-generation.js';
import { buildProfileSummary } from '../profile-summary.js';
import { buildTrainingProgram, composeWeek, resolveClient, doseFor, estimateMinutes } from '../program-engine.js';

const lite = JSON.parse(readFileSync(new URL('../data/exercise-dataset.json', import.meta.url), 'utf8'));
const meta = JSON.parse(readFileSync(new URL('../data/exercise-metadata.json', import.meta.url), 'utf8'));
const index = buildCompactIndex(lite, {}, meta);
const byId = new Map(index.map((e) => [e.id, e]));

function answersFor(o = {}) {
  return {
    gender: o.g || 'Жена', age: o.age || 32, heightCm: 168, weightKg: 64,
    health: o.health || ['Няма установени заболявания'], healthFemale: o.hf || [],
    limitations: o.lim || ['Нямам ограничения'], sleep: 'Добро, събуждам се отпочинал/а', stress: 5,
    experience: o.exp || 'Никакъв / начинаещ (0–6 месеца системно)',
    goal: { main: o.goal || 'Отслабване', zones: o.zones || '' },
    equipment: o.eq || ['Пълно оборудване на зала'], equipmentPickedItems: [],
    preferences: { types: o.types || ['Силов тренинг'], avoid: o.avoid || '', freq: o.freq || '3–4', duration: o.dur || '45–60 мин', timeOfDay: 'Сутрин' },
    breastImplants: o.implants ? { implants: 'Да' } : null,
  };
}
function program(o) {
  const answers = answersFor(o);
  const prep = preparePlanGeneration({ answers }, null, { buildProfileSummary, allowedEquipmentSet });
  return buildTrainingProgram({ answers, index, ...prep });
}
const allWithAlts = (plan) => plan.days.flatMap((d) => d.exercises.flatMap((e) => [e, ...(e.alternativeIds || []).map((id) => byId.get(id))]))
  .map((e) => ({ ...e, canonicalName: String(e.canonicalName || e.name || '').toLowerCase(), name: String(e.name || e.canonicalName || '').toLowerCase() }));

test('engine: ниво — „Начинаещ–среден“ е ниво 2, не начинаещ', () => {
  assert.equal(resolveClient(answersFor({ exp: 'Начинаещ–среден (6 месеца – 2 години)' })).level, 2);
  assert.equal(resolveClient(answersFor({ exp: 'Никакъв / начинаещ (0–6 месеца системно)' })).level, 1);
  assert.equal(resolveClient(answersFor({ exp: 'Напреднал (5+ години системно)' })).level, 3);
});

test('engine: броят активни дни = заявената честота (1–2 → 2, не 7)', () => {
  for (const [freq, level, n] of [['1–2', 'Среден (2–5 години)', 2], ['3–4', 'Среден (2–5 години)', 4], ['5–6', 'Среден (2–5 години)', 5], ['3–4', 'Никакъв / начинаещ (0–6 месеца системно)', 3]]) {
    const { plan } = program({ freq, exp: level });
    assert.equal(plan.days.filter((d) => d.type !== 'rest').length, n, `${freq} ${level}`);
  }
  assert.equal(composeWeek(resolveClient(answersFor({ freq: '1–2' }))).total, 2);
});

test('engine: хипертрофия в зала — класически движения и балансиран обем', () => {
  const { plan, meta } = program({ g: 'Мъж', exp: 'Среден (2–5 години)', goal: 'Покачване на мускулна маса', freq: '3–4' });
  const names = plan.days.flatMap((d) => d.exercises.map((e) => e.canonicalName.toLowerCase()));
  assert.ok(names.some((n) => /squat|leg press/.test(n)));
  assert.ok(names.some((n) => /deadlift/.test(n)));
  assert.ok(names.some((n) => /bench press/.test(n)));
  assert.ok(names.some((n) => /pulldown|pull-up|chin-up|row/.test(n)));
  assert.ok(!names.some((n) => /handstand|muscle up|planche|archer/.test(n)), 'без гимнастическа екзотика');
  for (const g of ['крака', 'гърди', 'гръб', 'рамене']) assert.ok(meta.weeklySets[g] >= 8, `${g}: ${meta.weeklySets[g]}`);
});

test('engine: у дома само собствено тегло → нищо с уреди', () => {
  const { plan } = program({ eq: ['Собствено тегло'] });
  for (const e of allWithAlts(plan)) {
    const eq = e.equipmentHint || e.equipment;
    assert.ok(['body weight'].includes(eq), `${e.canonicalName || e.name} (${eq})`);
  }
});

test('engine: коляно — без напади/скокове, и в алтернативите', () => {
  const { plan } = program({ g: 'Мъж', exp: 'Среден (2–5 години)', goal: 'Покачване на мускулна маса', lim: ['Болка при конкретно движение без официална диагноза: коляно'] });
  for (const e of allWithAlts(plan)) assert.ok(!/lunge|jump|pistol|split squat/.test(e.canonicalName || e.name), e.canonicalName || e.name);
});

test('engine: бременност — без коремни преси, легнали по гръб и скокове; RPE ≤ 6', () => {
  const { plan } = program({ hf: ['Бременна — триместър: 2'], eq: ['Собствено тегло', 'Ластици'] });
  for (const e of allWithAlts(plan)) assert.ok(!/crunch|sit-up|lying|jump|dead bug|bridge|run\b/.test(e.canonicalName || e.name), e.canonicalName || e.name);
  for (const d of plan.days) for (const e of d.exercises) assert.ok(Number(String(e.rpe).split('-')[1] || 0) <= 6, `${e.canonicalName} ${e.rpe}`);
});

test('engine: „не желая клек“ маха всички клекове', () => {
  const { plan } = program({ avoid: 'клек' });
  for (const e of allWithAlts(plan)) assert.notEqual(e.pattern, 'squat', e.canonicalName || e.name);
});

test('engine: „не желая бърпи, скачане, клек с щанга“ се спазва', () => {
  const { plan } = program({ g: 'Мъж', exp: 'Среден (2–5 години)', avoid: 'бърпи, скачане, клек с щанга', goal: 'Отслабване' });
  for (const e of allWithAlts(plan)) assert.ok(!/burpee|jump|barbell.*squat|smith.*squat/.test(e.canonicalName || e.name), e.canonicalName || e.name);
});

test('engine: силовата сесия се събира в избраното време', () => {
  for (const dur of ['До 30 мин', '30–45 мин', '45–60 мин', 'Над 60 мин']) {
    const { plan, meta } = program({ g: 'Мъж', exp: 'Напреднал (5+ години системно)', goal: 'Силови показатели', dur });
    for (const d of plan.days.filter((x) => x.type === 'strength')) {
      assert.ok(estimateMinutes(d.exercises) <= meta.client.minutes + 5, `${dur}: ${estimateMinutes(d.exercises)}`);
    }
  }
});

test('engine: доза по цел — сила 4-6 повт., издръжливост 12+ повт.', () => {
  assert.equal(doseFor('strength', 'main', 2).reps, '4-6');
  assert.equal(doseFor('endurance', 'main', 2).reps, '12-15');
  assert.ok(doseFor('strength', 'main', 2).restSeconds >= 150);
  assert.match(doseFor('general', 'core', 1, { name: 'weighted front plank' }).reps, /сек/);
});

test('engine: всяка силова сесия има долна част + бутане + дърпане (full-body)', () => {
  const { plan } = program({ freq: '3–4', exp: 'Никакъв / начинаещ (0–6 месеца системно)' });
  for (const d of plan.days.filter((x) => x.type === 'strength')) {
    const p = d.exercises.map((e) => e.pattern);
    assert.ok(p.some((x) => ['squat', 'lunge', 'hinge', 'glute'].includes(x)), d.day);
    assert.ok(p.some((x) => ['push_h', 'push_v', 'dip'].includes(x)), d.day);
    assert.ok(p.some((x) => ['pull_h', 'pull_v'].includes(x)), d.day);
  }
});
