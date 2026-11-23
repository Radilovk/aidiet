#!/usr/bin/env node
/**
 * Спазване на плана за деня (game-scoring.js → dayAdherence): целият план, всяко отклонение — по тежестта си.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../day-adherence.js');
require('../game-scoring.js');
const GS = globalThis.GameScoring;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('✗ ' + m); } };

const M = ['Закуска', 'Обяд', 'Следобедна закуска', 'Вечеря'];
const C = { 'Закуска': 400, 'Обяд': 600, 'Следобедна закуска': 150, 'Вечеря': 550 };
const all = () => Object.fromEntries(M.map((m) => [m, true]));
const day = (o = {}) => ({ meals: all(), mealCalories: C, mealSlots: M, plannedCalories: 1700, extraMeals: [],
  morningCheck: { sleptWell: true, level: 'good' },
  eveningCheck: { waterIntake: true, emotionalBalance: 3, activityLevel: 3, equivSteps: 8400, steps: 8400, stepTarget: 8000, ts: 'x' }, ...o });
const T = '2026-11-23', K = '2026-11-20';
const pct = (r, o = {}) => GS.dayAdherence(r, { todayKey: T, key: K, ...o }).pct;

ok(pct(day()) === 100, 'изряден ден — 100%');
ok(pct(day({ extraMeals: [{ isJunk: true, calories: 250 }, { calories: 170 }] })) === 80, '„спазих всичко, но хапнах и още“ — 80%');
const noDinner = pct(day({ meals: { ...all(), 'Вечеря': false } }));
const noSnack = pct(day({ meals: { ...all(), 'Следобедна закуска': false } }));
ok(noDinner < noSnack - 15, `пропусната вечеря (${noDinner}) сваля много повече от междинна закуска (${noSnack})`);
ok(pct(day({ morningCheck: null, eveningCheck: null })) === 60, 'само храненията, без въпросите — 60%');
const mid = GS.dayAdherence(day({ morningCheck: { sleptWell: true, level: 'mid' }, eveningCheck: { waterIntake: false, emotionalBalance: 2, equivSteps: 3100, steps: 3100, stepTarget: 8000, ts: 'x' } }), { todayKey: T, key: K });
ok(mid.parts.some((p) => p.k === 'act' && /3 100 от 8 000/.test(p.note)), 'движението — с крачките');
ok(mid.parts.some((p) => p.k === 'sleep' && p.got === 5), 'среден сън — половината');
// днес: неотговореното „предстои“, „под калориите“ още не важи
const today = GS.dayAdherence(day({ meals: { 'Закуска': true }, eveningCheck: null }), { todayKey: T, key: T });
ok(today.parts.filter((p) => p.pending).length >= 3 && !today.closed, 'днес — предстоящото не е грешка');
// кърмене: движение над прага — 0
const nurse = GS.dayAdherence(day({ eveningCheck: { waterIntake: true, emotionalBalance: 3, equivSteps: 13000, steps: 13000, stepTarget: 8000, ts: 'x' } }), { todayKey: T, key: K, group: 'lose_soft', policy: { maxPct: 140 } });
ok(nurse.parts.some((p) => p.k === 'act' && p.got === 0 && /над препоръчаното/.test(p.text)), 'кърмене: над прага — 0 и предупреждение');
// тежестите по целта — сборът е 100
Object.entries(globalThis.NutriPlanDayAdherence.WEIGHTS).forEach(([g, w]) => ok(Object.values(w).reduce((a, b) => a + b, 0) === 100, `тежести „${g}“ — сбор 100`));
// Личните тежести (goal-focus.js → adherenceWeights): по целта и профила, сбор 100
require('../goal-model.js');
const GF = require('../goal-focus.js');
const W = (ud) => GF.adherenceWeights(ud).weights;
const sum = (w) => Object.values(w).reduce((a, b) => a + b, 0);
const stressed = W({ gender: 'Жена', age: '40', height: '165', weight: '90', goal: 'Отслабване', sleepHours: '5–6', stressLevel: 'Високо', foodTriggers: ['Напрежение'] });
const calm = W({ gender: 'Жена', age: '40', height: '165', weight: '90', goal: 'Отслабване', sleepHours: '7–8', stressLevel: 'Ниско' });
ok(sum(stressed) === 100 && sum(calm) === 100, 'личните тежести — сбор 100');
ok(stressed.sleep > calm.sleep && stressed.mood > calm.mood, `стрес и малко сън → сънят и емоциите тежат повече (${stressed.sleep}/${calm.sleep}, ${stressed.mood}/${calm.mood})`);
const diab = W({ gender: 'Жена', age: '55', height: '160', weight: '82', goal: 'Подобряване на здравето', medicalConditions: ['Диабет тип 2'] });
ok(diab.junk > calm.junk, 'диабет → храненията извън плана тежат повече');
const nurseW = W({ gender: 'Жена', age: '30', height: '165', weight: '68', goal: 'Възстановяване на тялото след бременност', clinicalProtocol: 'postpartum_lactation', postpartumStatus: 'Кърмя' });
ok(nurseW.water > calm.water && nurseW.act < calm.act, 'кърмене → водата нагоре, движението надолу');
// същият ден — различен процент при различни тежести
const sleepyDay = day({ morningCheck: { sleptWell: false, level: 'bad' } });
ok(pct(sleepyDay, { weights: stressed }) < pct(sleepyDay, { weights: calm }), 'лош сън сваля повече, когато сънят е важен за човека');
// Реалните данни (последните 14 дни): често слаб сън и напрегнати дни → тези части тежат повече
const udBase = { gender: 'Жена', age: '40', height: '165', weight: '90', goal: 'Отслабване', sleepHours: '7–8', stressLevel: 'Ниско' };
const hist = {};
for (let i = 1; i <= 10; i++) {
  const d = new Date(Date.UTC(2026, 10, 23) - i * 86400000);
  hist[d.toISOString().slice(0, 10)] = { morningCheck: { sleptWell: false, level: 'bad', hours: 5.5 }, eveningCheck: { emotionalBalance: 1, waterIntake: true, activityLevel: 3 } };
}
const real = GF.adherenceWeights(udBase, hist, '2026-11-23');
ok(sum(real.weights) === 100 && real.weights.sleep > calm.sleep && real.weights.mood > calm.mood, `реалните данни: сънят ${calm.sleep}→${real.weights.sleep}, емоциите ${calm.mood}→${real.weights.mood}`);
ok(real.reasons.some((r) => /напоследък/.test(r.text)), 'причината казва „напоследък“');
const few = {}; Object.keys(hist).slice(0, 3).forEach((k) => { few[k] = hist[k]; });
ok(JSON.stringify(GF.adherenceWeights(udBase, few, '2026-11-23').weights) === JSON.stringify(calm), 'под 5 отговора — без промяна');
const pol = GF.dayPolicy(udBase, hist, '2026-11-23');
ok(pol.reward === true && pol.group === 'lose' && JSON.stringify(pol.weights) === JSON.stringify(real.weights), 'dayPolicy = движение + личните тежести + група');
console.log(`=== day adherence: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
