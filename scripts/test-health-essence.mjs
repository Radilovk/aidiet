#!/usr/bin/env node
/**
 * Есенцията от устройствата (health-essence.js): прагове, минимум данни и
 * пътят до профила и седмичния преглед. Без мрежа и без AI.
 */
import { computeEssence, dailySeries, essenceText, normalizeDigest, digestDue } from '../health-essence.js';
import { buildClientCard, buildChatContext } from '../client-card.js';
import { normalizeFact, applyEnrichment } from '../enrichment.js';
import { compileProfile } from '../profile-code.js';
import { readCheckin, decideWeeklyAdjustment } from '../nutrition-engine/monitoring.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const NOW = new Date('2026-10-20T10:00:00Z');
const ago = n => new Date(NOW.getTime() - n * 86400000 + 2 * 3600000).toISOString();
const f = (kind, value, n, extra = {}) => normalizeFact({ kind, value, at: ago(n), source: 'health_connect', ...extra });
const range = (from, to) => Array.from({ length: from - to + 1 }, (_, i) => from - i);
const code = (e, c) => e.signals.some(s => s.code === c);

// ── Факти ────────────────────────────────────────────────────────────────
ok(normalizeFact({ kind: 'glucose', value: 108, unit: 'mg/dL', key: 'morning', at: ago(1) }).value === 6, 'глюкоза mg/dL → mmol/L');
ok(normalizeFact({ kind: 'bp', value: 80, value2: 120, at: ago(1) }) === null, 'кръвно: диастолното над систолното отпада');
ok(normalizeFact({ kind: 'weight', value: 176, unit: 'lb', at: ago(1) }).value === 79.83, 'тегло в паундове');
ok(normalizeFact({ kind: 'hrv', value: 900, at: ago(1) }) === null, 'невъзможен HRV отпада');

// ── Тегло ────────────────────────────────────────────────────────────────
let e = computeEssence(range(13, 0).map(n => f('weight', 80 - (13 - n) * 0.1, n)), NOW);
ok(Math.abs(e.metrics.weight.trendKgWeek + 0.7) < 0.05 && e.checkin.weightTrendKgWeek, `тенденция ${e.metrics.weight?.trendKgWeek} кг/седм.`);
e = computeEssence([5, 3, 1].map(n => f('weight', 80, n)), NOW);
ok(!e.metrics.weight && e.checkin.weightTrendKgWeek == null, 'под 5 претегляния — без тенденция');

// ── Състав на тялото ─────────────────────────────────────────────────────
const comp = (bfFrom, bfTo) => range(30, 0).filter(n => n % 3 === 0).flatMap(n => {
  const k = (30 - n) / 30;
  return [f('weight', 80 - 3 * k, n), f('body_fat', bfFrom + (bfTo - bfFrom) * k, n)];
});
e = computeEssence(comp(30, 30), NOW);
ok(code(e, 'lean_loss') && e.hints.approach.includes('increase_protein') && e.checkin.leanLoss, 'загуба на чиста маса → сигнал и повече белтък');
e = computeEssence(comp(30, 27), NOW);
ok(!code(e, 'lean_loss') && e.metrics.composition.leanChangeKg >= 0, 'загуба на мазнини — без сигнал');

// ── Възстановяване ───────────────────────────────────────────────────────
const recovery = (rRecent, hRecent) => [
  ...range(30, 8).flatMap(n => [f('resting_hr', 58, n), f('hrv', 50, n)]),
  ...range(6, 1).flatMap(n => [f('resting_hr', rRecent, n), f('hrv', hRecent, n)]),
];
e = computeEssence(recovery(65, 40), NOW);
ok(code(e, 'recovery_low') && e.checkin.recoveryLow, 'пулс +7 и HRV −20% → ниско възстановяване');
e = computeEssence(recovery(59, 49), NOW);
ok(!code(e, 'recovery_low'), 'нормални колебания — без сигнал');
e = computeEssence(range(6, 1).map(n => f('resting_hr', 70, n)), NOW);
ok(!code(e, 'recovery_low'), 'без база — без сигнал');

// ── Кръвно и глюкоза ─────────────────────────────────────────────────────
e = computeEssence([1, 2, 3, 4].map(n => f('bp', 142, n, { value2: 88 })), NOW);
ok(code(e, 'bp_high') && e.hints.clinical.includes('HTN') && e.hints.cautions.length === 1, 'домашно кръвно 142/88 → HTN и бележка');
e = computeEssence([1, 2, 3, 4].map(n => f('bp', 121, n, { value2: 78 })), NOW);
ok(!code(e, 'bp_high') && !e.hints.clinical.length, 'нормално кръвно — без правило');
e = computeEssence(range(6, 1).map(n => f('glucose', 6.1, n, { key: 'morning' })), NOW);
ok(code(e, 'glucose_high') && e.hints.clinical.includes('IR'), 'захар сутрин 6,1 → IR');
e = computeEssence(range(6, 1).map(n => f('glucose', 6.1, n, { key: 'peak' })), NOW);
ok(!e.hints.clinical.length, 'пикове след хранене не са захар на гладно');

// ── Тренировки и източници ───────────────────────────────────────────────
const tracked = range(20, 1).map(n => f('steps', 7000, n));
e = computeEssence([...tracked, ...[13, 11, 8, 6, 3, 1].map(n => f('workout', 45, n, { count: 1 }))], NOW);
ok(e.overrides.sportActivity === 'Средна (2–4 дни седмично)' && e.metrics.workouts.perWeek === 3, `6 тренировки за 2 седмици → ${e.overrides.sportActivity}`);
e = computeEssence([...range(5, 1).map(n => f('steps', 7000, n)), f('workout', 45, 2)], NOW);
ok(!e.overrides.sportActivity, 'устройство от 5 дни — без извод за тренировките');
const mixed = dailySeries([f('steps', 8000, 1), normalizeFact({ kind: 'steps', value: 3000, at: ago(1), source: 'file' })], 'steps');
ok(mixed.length === 1 && mixed[0].value === 8000, 'един ден от два източника — печели автоматичното измерване');

// ── До профила и прегледа ────────────────────────────────────────────────
const base = () => enrichUserDataEngineContext(JSON.parse(JSON.stringify(PROFILES.find(p => p.id === 'female_moderate'))));
const withBp = applyEnrichment(base(), { facts: [1, 2, 3, 4].map(n => f('bp', 145, n, { value2: 92 })) }, NOW);
ok(compileProfile(withBp).clinical.includes('HTN'), 'кръвното стига до профила');
ok(/кръвно ~145\/92/.test(essenceText(withBp._enrichment.essence)), 'текст за картона и чата');

const decide = (extra) => decideWeeklyAdjustment({
  goal: 'LOSS', kcal: 1800, tdee: 2300, floorKcal: 1500, weightKg: 80, baseKcal: 1800,
  checkin: readCheckin([{ questionId: 'weight', value: 'Без промяна' }, { questionId: 'adherence', value: 'Почти всички' }, ...extra], null),
  history: [{ weight: 'flat' }],
});
ok(decide([]).calorieAdjust < 0, 'обичайно: втора седмица застой → по-малко калории');
ok(decide([{ questionId: 'recoveryLow', value: 'true' }]).calorieAdjust === 0, 'ниско възстановяване → без намаляване');
const lean = decide([{ questionId: 'leanLoss', value: 'true' }]);
ok(lean.calorieAdjust === 0 && lean.modifications.includes('increase_protein'), 'загуба на мускули → повече белтък, без намаляване');
const ck = readCheckin([{ questionId: 'weightKg', value: '79' }, { questionId: 'weightTrendKgWeek', value: '-0.6' }], null, { prevWeightKg: 80, daysSincePrev: 7 });
ok(ck.weeklyChangeKg === -0.6, 'тенденцията замества разликата от две претегляния');

// ── AI обобщение: само текст и кодове от тесния речник ──────────────────
const dg = normalizeDigest({
  insights: ['Сънят ти е 5,8 ч — лягай 30 минути по-рано.', 'Spread your carbs evenly.', 'Повече вода сутрин. '.repeat(30)],
  coachNote: 'Ниско възстановяване две седмици; да се следи пулсът.',
  approach: ['increase_protein', 'low_carb', '3_meals_per_day'],
}, NOW);
ok(dg.insights.length === 2 && dg.insights[1].length <= 220, `текст на латиница отпада, дългият се реже (${dg.insights.length})`);
ok(dg.approach.join() === 'increase_protein', 'кодове само от речника — без калории и брой хранения');
ok(normalizeDigest({ insights: [], coachNote: '' }) === null && normalizeDigest('x') === null, 'празен отговор — без обобщение');
ok(digestDue({ metrics: { sleep: {} } }, null, NOW) && !digestDue({ metrics: { sleep: {} } }, { at: ago(2) }, NOW) && !digestDue({ metrics: {} }, null, NOW), 'обобщение веднъж седмично и само с данни');
const withDigest = applyEnrichment(base(), { facts: [1, 2, 3, 4].map(n => f('bp', 145, n, { value2: 92 })), digest: dg }, NOW);
ok(compileProfile(withDigest).behaviors !== undefined && withDigest._enrichment.hints.approach.includes('increase_protein'), 'кодът от обобщението стига до плана');

// ── Картон и чат ─────────────────────────────────────────────────────────
const txt = essenceText(withDigest._enrichment.essence, withDigest._enrichment.digest);
ok(/обобщение: Ниско възстановяване/.test(txt), 'бележката на AI е в есенцията');
const card = buildClientCard({ id: 'c1', answers: {}, healthEssence: { text: txt, at: NOW.toISOString() } }).card;
ok(/#HD v1 upd=2026-10-20 .*кръвно ~145\/92/.test(card), 'картонът на специалиста има блок с данните');
const chat = buildChatContext({ name: 'А', _healthEssence: txt }, { summary: {} }, 'какво да ям днес', 'consultation');
ok(chat.selectedIds.includes('health') && /#HD v1/.test(chat.contextText), 'чатът винаги вижда данните от устройствата');
ok(!buildChatContext({ name: 'А' }, { summary: {} }, 'здравей').contextText.includes('#HD'), 'без данни — без блок');

console.log(`\n=== health essence: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
