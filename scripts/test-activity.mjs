#!/usr/bin/env node
/**
 * Крачкомерът и вечерният въпрос за тренировка (activity-tracker.js) и моделът
 * на тренировъчните дни на сървъра (health-essence.js). Без мрежа.
 */
import { createRequire } from 'node:module';
import { computeEssence, trainingPattern, essenceText } from '../health-essence.js';
import { normalizeFact, mergeFacts, applyEnrichment, recalcLevel } from '../enrichment.js';

const require = createRequire(import.meta.url);
const A = require('../activity-tracker.js');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── Профил и енергия ─────────────────────────────────────────────────────
const man = A.profileOf({ gender: 'Мъж', height: '180', weight: '80', sportActivity: 'Средна (2–4 дни седмично)',
  sportTypes: ['Силови (фитнес, тежести)'], sportSessionMinutes: '60–90 мин', dailyActivityLevel: 'Средно' });
ok(man.trainer && man.trainsPerWeek === 3, 'трениращ: 2–4 дни → 3 седмично');
ok(man.sessionMinutes === 75, 'продължителност 60–90 мин → 75');
ok(near(A.strideM(man), 0.747, 0.001), 'крачка ≈ 41,5% от ръста');
ok(near(A.kcalPerStep(man), 0.0299, 0.0005), 'разход на крачка ≈ 0,5 kcal/кг/км');
const none = A.profileOf({ gender: 'Жена', height: '165', weight: '60', sportActivity: 'Никаква (0 дни седмично)' });
ok(!none.trainer && none.types.length === 0, 'нетрениращ: без видове тренировки');
const blank = A.profileOf({});
ok(blank.heightCm === 170 && blank.weightKg === 75 && blank.typicalSteps === 7000, 'без данни: средни стойности, без грешка');

// Силова тренировка 75 мин при 80 кг: (5 − 1) × 80 × 1,25 = 400 kcal.
ok(A.trainingKcal(man, 75, null) === 400, 'силова тренировка: (MET − 1) × кг × ч');
// Кардио: крачките над обичайния ден вече са в крачкомера и се изваждат.
const runner = A.profileOf({ gender: 'Мъж', height: '180', weight: '80', sportActivity: 'Висока (5–7 дни седмично)',
  sportTypes: ['Кардио (бягане, колело, плуване)'], sportSessionMinutes: '45–60 мин' });
const runGross = A.trainingKcal(runner, 55, null);
const runNet = A.trainingKcal(runner, 55, 4000);
ok(runNet < runGross && near(runGross - runNet, 4000 * A.kcalPerStep(runner), 1), 'кардио: крачките от тренировката не се броят два пъти');
ok(A.trainingKcal(runner, 55, 100000) >= 0, 'разходът на тренировката не е отрицателен');

const rest = A.estimateDay(man, { steps: 4000, trained: 'no' });
const train = A.estimateDay(man, { steps: 4000, trained: 'pm' });
ok(rest.level === 1 && rest.source === 'steps', 'ден без тренировка с 4000 крачки → ниско');
ok(train.level === 3 && train.trainingKcal === 400 && train.source === 'training', 'същият ден с тренировка → високо');
const est = A.estimateDay(man, { trained: 'am' });
ok(!est.measured && est.steps === 7000, 'без крачкомер: обичайният ден от профила');
ok(A.levelOf(4999) === 1 && A.levelOf(5000) === 2 && A.levelOf(10000) === 3, 'граници 5000 / 10 000');

// ── Крачкомер: разпределяне по часове и дни ─────────────────────────────
const w = A.hourWeights([], 7000);
ok(near(w.reduce((s, x) => s + x, 0), 7000, 1), 'типичната крива дава обичайния ден');
ok(w[3] < w[12] / 20, 'нощем почти без крачки');
const t0 = new Date(2026, 9, 20, 21, 0).getTime();
const t1 = new Date(2026, 9, 21, 9, 0).getTime();
const split = A.spread(t0, t1, 1000, w);
ok(near(split['2026-10-20'] + split['2026-10-21'], 1000, 0.01), 'разпределението пази сбора');
ok(split['2026-10-21'] > split['2026-10-20'], 'нощен интервал: повечето крачки са сутринта');

// Показания: начало, нормален ход, рестарт.
const H = 3600000;
const boot1 = new Date(2026, 9, 18, 6, 0).getTime();
const base = new Date(2026, 9, 19, 8, 0).getTime();
let st = A.ingest({}, [{ t: base, c: 10000, boot: boot1 }], 7000);
ok(st.days['2026-10-19'].part === true, 'първото показание: денят е непълен');
st = A.ingest(st, [
  { t: base + 1 * H, c: 10800, boot: boot1 },
  { t: base + 13 * H, c: 18800, boot: boot1 }, // 21:00
  { t: base + 25 * H, c: 21000, boot: boot1 }, // 09:00 на следващия ден
], 7000);
ok(near(st.days['2026-10-19'].s, 8800 + (2200 - st.days['2026-10-20'].s), 1), 'дните сумират разликите на брояча');
ok(st.hours[8] && st.hours[8].n === 1 && near(st.hours[8].s, 800, 1), 'кратък интервал учи личната крива (8 ч → 800/ч)');
const boot2 = base + 30 * H;
st = A.ingest(st, [{ t: base + 32 * H, c: 1500, boot: boot2 }], 7000);
ok(st.days['2026-10-20'].part === true, 'рестарт: денят с празнина е непълен');
ok(st.last.c === 1500 && st.last.boot === boot2, 'след рестарт броячът тръгва от новото включване');
const before = JSON.stringify(st.days);
st = A.ingest(st, [{ t: base + 1 * H, c: 99999, boot: boot1 }], 7000);
ok(JSON.stringify(st.days) === before, 'старо показание (вече обработено) не променя нищо');

// Прогноза за днес: до 13:00 е минала около половината от деня.
const share = A.dayShareUntil(new Date(2026, 9, 21, 13, 0).getTime(), w);
ok(share > 0.35 && share < 0.6, 'до обяд — около половината от обичайния ден');

// ── Сървър: факти и модел на тренировките ────────────────────────────────
const NOW = new Date('2026-10-25T10:00:00Z');
const dayAt = n => new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10) + 'T12:00:00.000Z';
const dow = n => new Date(dayAt(n)).getUTCDay();
ok(normalizeFact({ kind: 'train_check', value: 1, slot: 'pm', minutes: 75, kcal: 400, at: dayAt(1), source: 'checkin' }).slot === 'pm', 'train_check: частта от деня се пази');
ok(normalizeFact({ kind: 'train_check', value: 0, slot: 'pm', at: dayAt(1), source: 'checkin' }).slot === undefined, 'train_check „не“: без част от деня');
const merged = mergeFacts([], [
  { kind: 'train_check', value: 1, slot: 'am', at: dayAt(1), source: 'checkin' },
  { kind: 'train_check', value: 0, at: dayAt(1), source: 'checkin' },
], NOW);
ok(merged.length === 1 && merged[0].value === 0, 'поправен отговор за същия ден заменя стария');

// 4 седмици: тренира пн, ср, пт следобед.
const facts = [];
for (let n = 1; n <= 28; n++) {
  const d = dow(n);
  const yes = d === 1 || d === 3 || d === 5;
  facts.push(normalizeFact({ kind: 'train_check', value: yes ? 1 : 0, slot: yes ? 'pm' : null, minutes: 75, kcal: yes ? 400 : 0, at: dayAt(n), source: 'checkin' }));
}
const tp = trainingPattern(facts, NOW);
ok(tp && near(tp.perWeek, 3, 0.1), 'честота ~3 седмично');
ok(tp && JSON.stringify(tp.usual) === '[1,3,5]', 'обичайните дни: пн, ср, пт');
ok(tp && tp.rest.includes(0) && tp.rest.includes(6), 'почивни: събота и неделя');
ok(tp && tp.slot === 'pm' && tp.regularity >= 0.8 && tp.kcal === 400, 'следобед, по график, ~400 kcal');
ok(trainingPattern(facts.slice(0, 6), NOW) === null, 'под 10 отговорени дни — без модел');

const ess = computeEssence(facts, NOW);
ok(ess.overrides.sportActivity === 'Средна (2–4 дни седмично)', 'реалната честота заменя спорта от въпросника');
ok(ess.signals.some(s => s.code === 'training_schedule' && /пн, ср, пт/.test(s.text)), 'сигнал с тренировъчните дни');
ok(/тренировки ~3\/седм\. \(обикновено пн, ср, пт, следобед\)/.test(essenceText(ess)), 'есенцията за чата носи дните и часа');

// Обявил 5–7 дни, а реално тренира ~1 път: енергията пада с реалната честота.
const rare = [];
for (let n = 1; n <= 21; n++) rare.push(normalizeFact({ kind: 'train_check', value: n % 7 === 2 ? 1 : 0, slot: 'am', at: dayAt(n), source: 'checkin' }));
const user = { gender: 'Мъж', age: 35, height: 180, weight: 85, goal: 'Отслабване', sportActivity: 'Висока (5–7 дни седмично)', dailyActivityLevel: 'Средно' };
const enriched = applyEnrichment(JSON.parse(JSON.stringify(user)), { facts: rare }, NOW);
ok(enriched.sportActivity === 'Ниска (1–2 дни седмично)', 'обявени 5–7, реално ~1 → ниска');
ok(enriched._enrichment.original.sportActivity === 'Висока (5–7 дни седмично)', 'отговорът от въпросника се пази');
ok(recalcLevel(user, enriched).level >= 2, 'промяната в тренировките преизчислява калориите');

// Тренировка от часовник не се отменя от „не“ на въпроса за същия ден.
const mixed = [...facts, normalizeFact({ kind: 'workout', value: 50, at: dayAt(2), source: 'health_connect' })];
const mixedTp = trainingPattern(mixed.filter(f => !(f.kind === 'train_check' && f.at === dayAt(2))).concat(
  normalizeFact({ kind: 'train_check', value: 0, at: dayAt(2), source: 'checkin' })), NOW);
ok(mixedTp && mixedTp.perWeek > tp.perWeek - 0.01, 'тренировката от устройство печели пред „не“');

// Крачки от телефона: по-нисък приоритет от гривната за същия ден.
const phone = normalizeFact({ kind: 'steps', value: 4000, at: dayAt(1), source: 'phone' });
const band = normalizeFact({ kind: 'steps', value: 9000, at: dayAt(1), source: 'health_connect' });
const stepsEss = computeEssence([phone, band,
  ...[2, 3, 4, 5].map(n => normalizeFact({ kind: 'steps', value: 6000, at: dayAt(n), source: 'phone' }))], NOW);
ok(stepsEss.metrics.steps && stepsEss.metrics.steps.avg7 === Math.round((9000 + 4 * 6000) / 5 / 100) * 100, 'гривната печели пред телефона за същия ден');

// ── Въпрос в ден с много крачки (не тренира по въпросника) ─────────────────
{
  const store = {};
  globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const key = (n) => { const d = new Date(Date.now() - n * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const today = key(0);
  const ext = (todaySteps) => Object.assign(Object.fromEntries([6000, 6200, 5800, 6100, 5900, 6300, 6000, 6100].map((v, i) => [key(i + 1), v])), todaySteps != null ? { [today]: todaySteps } : {});
  store.userData = JSON.stringify({ gender: 'Жена', height: '165', weight: '62', sportActivity: 'Никаква (0 дни седмично)' });
  store.np_health_state = JSON.stringify({ connected: true });
  store.np_activity_state = JSON.stringify({ ext: ext(14500) });
  ok(A.mode() === 'steps', 'графикът на известията остава без въпрос (без известие)');
  ok(A.mode(today) === 'training', 'днес крачките са много над обичайните → въпрос в приложението');
  ok(A.mode(key(1)) === 'steps', 'само днешният ден, не минали дни');
  store.np_activity_state = JSON.stringify({ ext: ext(7000) });
  ok(A.mode(today) === 'steps', 'обичаен ден → без въпрос');
  store.np_activity_state = JSON.stringify({ ext: ext(14500) });
  store.gameData = JSON.stringify({ [key(3)]: { eveningCheck: { trained: 'no' } }, [key(9)]: { eveningCheck: { trained: 'no' } } });
  ok(A.mode(today) === 'steps', '2 пъти „не“ без „да“ за 28 дни → въпросът спира');
  store.gameData = JSON.stringify({ [key(3)]: { eveningCheck: { trained: 'no' } }, [key(9)]: { eveningCheck: { trained: 'no' } }, [key(20)]: { eveningCheck: { trained: 'pm' } } });
  ok(A.mode(today) === 'training', 'има „да“ → въпросът остава за дните с много крачки');
  store.gameData = JSON.stringify({ [key(3)]: { eveningCheck: { trained: 'no' } } });
  ok(A.mode(today) === 'training', 'едно „не“ не спира въпроса');
  const est = A.estimateDay(A.profileOf(JSON.parse(store.userData)), { steps: 14500, trained: 'pm' });
  ok(est.trainingKcal > 0, 'нетрениращ по въпросника, но тренирал → тренировката има разход');
  store.gameData = '{}';
  A.fillFromSteps({ [key(1)]: 9000 });
  ok(JSON.parse(store.np_activity_state).ext[key(1)] === 9000, 'крачките от Health Connect се пазят');
  // Индексът спрямо целта: еквивалентните крачки и целта се записват в деня.
  globalThis.NutriPlanGoalFocus = { stepTarget: () => 7000 };
  store.gameData = JSON.stringify({ [key(2)]: {} });
  store.np_activity_state = JSON.stringify({ ext: { [key(2)]: 9100 } });
  A.fillFromSteps();
  const ec2 = JSON.parse(store.gameData)[key(2)].eveningCheck;
  ok(ec2.steps === 9100 && ec2.equivSteps === 9100 && ec2.stepTarget === 7000, `денят носи крачките и целта (${JSON.stringify(ec2)})`);
  ok(ec2.extraKcal > 0 && ec2.extraKcal < 150, `крачките над целта носят разход над обичайното (${ec2.extraKcal} kcal)`);
  // Трениращ с гривна (без крачкомер): отговорът „да“ ползва крачките от Health Connect.
  store.userData = JSON.stringify({ gender: 'Мъж', height: '180', weight: '80', sportActivity: 'Средна (2–4 дни седмично)', sportTypes: ['Силови (фитнес, тежести)'] });
  const ec3 = A.applyAnswer({}, 'pm', key(2));
  ok(ec3.steps === 9100 && ec3.equivSteps > 9100 && ec3.stepTarget === 7000, 'трениращ с гривна: крачките от Health Connect + тренировката');
  store.userData = JSON.stringify({ gender: 'Жена', height: '165', weight: '65' });
  store.gameData = JSON.stringify({ [key(4)]: {} });
  store.np_activity_state = JSON.stringify({ ext: { [key(4)]: 6000 } });
  A.fillFromSteps();
  ok(JSON.parse(store.gameData)[key(4)].eveningCheck.extraKcal === 0, 'под целта — без разход над обичайното');
  delete globalThis.NutriPlanGoalFocus;
  delete globalThis.localStorage;
}

console.log(`activity: ${pass} ok, ${fail} грешки`);
process.exit(fail ? 1 : 0);
