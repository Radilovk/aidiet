#!/usr/bin/env node
/**
 * Фокус по цел (goal-focus.js): ред на показателите и оценка спрямо целта.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GF = require('../goal-focus.js');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const M = {
  weight: { last: 84.2, avg7: 84.5, trendKgWeek: 0.05, days: 10 },
  composition: { days: 14, weightChangeKg: -1.2, leanChangeKg: -0.7 },
  steps: { avg7: 5200, days: 7 },
  sleep: { avg7: 6.4, nights: 7 },
  workouts: { perWeek: 1, minutesWeek: 40 },
  restingHr: { avg7: 66, base: 60 },
  hrv: { avg7: 40, base: 42 },
  intake: { avg7: 2300, days: 6 },
  bp: { sys: 128, dia: 82, days: 5 },
};
const lose = { goal: 'Отслабване' };
const gain = { goal: 'Мускулна маса' };
const health = { goal: 'Подобряване на здравето', medicalConditions: ['Високо кръвно налягане'] };

ok(GF.profileOf(lose).group === 'lose' && GF.profileOf(gain).group === 'gain' && GF.profileOf({}).group === 'health', 'групи по цел');
ok(GF.deviceOrder(GF.profileOf(lose))[0] === 'weight', 'отслабване: теглото води');
ok(GF.deviceOrder(GF.profileOf(health))[0] === 'bp', 'високо кръвно: кръвното води пред целта');
ok(GF.checkOrder(GF.profileOf(lose))[0] === 'calories' && GF.checkOrder(GF.profileOf(health))[1] === 'sleep', 'самооценките по цел');
ok(GF.checkOrder(GF.profileOf({ goal: 'Отслабване', stressLevel: 'Високо' }))[1] === 'stress', 'висок стрес — емоционалният баланс нагоре');
ok(GF.guideOrder(GF.profileOf(lose))[0] === 'limit' && GF.guideOrder(GF.profileOf(gain))[0] === 'foods', 'насоките по цел');

const vLose = GF.deviceView(M, lose, { planKcal: 1900 });
ok(vLose.cards[0].key === 'weight' && vLose.cards[0].tone === 'bad', 'отслабване: тегло без спад = проблем');
ok(vLose.cards.find(c => c.key === 'intake').tone === 'bad', 'отслабване: 21% над плана = проблем');
ok(vLose.conclusions.length >= 2 && vLose.conclusions[0].tone === 'bad', 'изводите — първо проблемите');
ok(vLose.cards.length === 4 && vLose.more.length > 0, 'първите 4 + още');

const vGain = GF.deviceView({ ...M, weight: { ...M.weight, trendKgWeek: 0.3 }, intake: { avg7: 2300 } }, gain, { planKcal: 2800 });
ok(vGain.cards[0].tone === 'good', 'мускулна маса: +0,3 кг/седм. = в целта');
ok(vGain.cards.find(c => c.key === 'composition').tone === 'bad', 'загуба на мускули = проблем при всяка цел');
ok(vGain.cards.find(c => c.key === 'intake').tone === 'bad', 'мускулна маса: под плана = проблем');
ok(GF.evaluate('workouts', M, GF.profileOf(gain)).tone === 'bad' && GF.evaluate('workouts', M, GF.profileOf(lose)).tone === 'warn', 'тренировки: по-строго за мускулна маса');

const fast = GF.evaluate('weight', { weight: { last: 80, trendKgWeek: -0.7, days: 10 } }, GF.profileOf({ goal: 'Възстановяване на тялото след бременност' }));
ok(fast.tone === 'warn', 'след бременност: −0,7 кг/седм. е твърде бързо');
ok(GF.evaluate('weight', { weight: { last: 80, trendKgWeek: -0.5, days: 2 } }, GF.profileOf(lose)).tone === 'neutral', 'малко измервания — без оценка');
ok(GF.deviceView({}, lose).cards.length === 0, 'без данни — без карти');
ok(GF.evaluate('restingHr', M, GF.profileOf(lose)).tone === 'warn', 'пулс +6 над обичайния = внимание');

console.log(`\n=== goal focus: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
