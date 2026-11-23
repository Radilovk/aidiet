#!/usr/bin/env node
/**
 * Резултат (progress-index.js): мерими промени по водещите показатели за целта, без старанието.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../goal-model.js');
const GF = require('../goal-focus.js');
const P = require('../progress-index.js');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}
const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 23);
const ago = (d) => NOW - d * DAY;

// 1) Отслабване: тегло, талия, състав — част от пътя до целевото тегло.
const udLose = { gender: 'Жена', age: '40', height: '165', weight: '90', goal: 'Отслабване', waistCircumference: '100' };
const pLose = GF.profileOf(udLose);
ok(pLose.direction === 'lose' && pLose.lead[0] === 'weight', 'отслабване: водещото е теглото');
const lose = P.compute({ profile: pLose, userData: udLose, planStart: ago(42), now: NOW,
  weightLog: [{ at: ago(21), kg: 88 }, { at: ago(2), kg: 86 }],
  checkins: [{ at: ago(14), waistCm: 98 }, { at: ago(2), waistCm: 96, energy: 1 }] });
ok(lose.value > 0 && lose.value < 100, `отслабване: индекс между 0 и 100 (${lose.value})`);
ok(lose.parts.some((x) => x.key === 'weight' && /−4/.test(x.text)), 'отслабване: −4 кг от началото');
ok(lose.parts.some((x) => x.key === 'waist' && /−4/.test(x.text)), 'отслабване: −4 см талия');
ok(lose.parts.some((x) => x.key === 'energy'), 'енергията влиза като усещане');

// 2) Старанието не влиза: същите измервания, различна ангажираност → същият индекс.
const a = P.compute({ profile: pLose, userData: udLose, planStart: ago(42), now: NOW, weightLog: [{ at: ago(2), kg: 86 }], checks: { engagementPct: 95, mealAdherence: 95 } });
const b = P.compute({ profile: pLose, userData: udLose, planStart: ago(42), now: NOW, weightLog: [{ at: ago(2), kg: 86 }], checks: { engagementPct: 20, mealAdherence: 10 } });
ok(a.value === b.value, 'ангажираността не мени резултата');

// 3) Теглото нагоре при отслабване → 0 за теглото, не отрицателно.
const up = P.compute({ profile: pLose, userData: udLose, planStart: ago(30), now: NOW, weightLog: [{ at: ago(1), kg: 91 }] });
ok(up.parts.find((x) => x.key === 'weight').score === 0, 'отслабване: по-тежко → 0 за теглото');

// 4) Без измерване → няма индекс, казва се какво да се измери.
const none = P.compute({ profile: pLose, userData: udLose, planStart: ago(3), now: NOW, checks: { sleepPct: 80 } });
ok(none.value === null && none.needs && none.needs.key === 'weight', 'без измерване: няма индекс, иска тегло');

// 5) Стягане при нормално тегло: съставът/тренировките/талията, не килограмите.
const udTone = { gender: 'Жена', age: '30', height: '168', weight: '60', goal: 'Стягане и оформяне на тялото', waistCircumference: '74', sportActivity: 'Средна' };
const pTone = GF.profileOf(udTone);
ok(pTone.lead[0] !== 'weight', `стягане: водещото не е теглото (${pTone.lead.join(',')})`);
const tone = P.compute({ profile: pTone, userData: udTone, planStart: ago(30), now: NOW,
  metrics: { composition: { leanChangeKg: 0.6 } }, checks: { workouts7: 3 }, checkins: [{ at: ago(3), waistCm: 72 }] });
ok(tone.value != null && !tone.parts.some((x) => x.key === 'weight'), 'стягане: без тегло в индекса');

// 6) Здраве при нормално тегло: енергия, сън, храносмилане.
const udH = { gender: 'Мъж', age: '45', height: '180', weight: '78', goal: 'Подобряване на здравето' };
const pH = GF.profileOf(udH);
ok(pH.lead[0] === 'energy', `здраве: водещото е енергията (${pH.lead.join(',')})`);
const good = P.compute({ profile: pH, userData: udH, now: NOW, checkins: [{ at: ago(8), energy: 2, digestion: true }, { at: ago(1), energy: 1, digestion: false }], checks: { sleepPct: 85 } });
const bad = P.compute({ profile: pH, userData: udH, now: NOW, checkins: [{ at: ago(8), energy: 3, digestion: true }, { at: ago(1), energy: 3, digestion: true }], checks: { sleepPct: 30 } });
ok(good.value > bad.value + 30, `здраве: по-добро усещане → по-висок резултат (${good.value} > ${bad.value})`);

// 7) Задържане: стабилното тегло е резултат.
const udM = { gender: 'Жена', age: '35', height: '165', weight: '60', goal: 'Поддържане' };
const pM = GF.profileOf(udM);
const stable = P.compute({ profile: { ...pM, lead: ['weight', 'energy'] }, userData: udM, planStart: ago(30), now: NOW, weightLog: [{ at: ago(1), kg: 60.3 }] });
ok(stable.parts[0].score === 100, 'задържане: ±0,3 кг → пълен резултат');

// 8) Свободна цел → същият модел (lead) → индексът следва нея.
const udFree = { gender: 'Жена', age: '50', height: '165', weight: '82', goal: 'Друго', goal_other: 'да сваля корема', waistCircumference: '95' };
const pFree = GF.profileOf(udFree);
ok(pFree.lead.indexOf('waist') !== -1, `свободна цел „корем“ → талията е водеща (${pFree.lead.join(',')})`);

console.log(`=== progress index: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
