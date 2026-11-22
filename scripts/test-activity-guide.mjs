#!/usr/bin/env node
/**
 * Движение и активност (activity-guide.js): целите следват goal-focus.js, съветите — профила и здравето.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AG = require('../activity-guide.js');
const GF = require('../goal-focus.js');

let pass = 0;
let fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error(`✗ ${msg}`); } }
const text = (g) => g.sections.map(s => s.items.join(' ')).join(' ');
const sec = (g, k) => g.sections.find(s => s.key === k);

const base = { gender: 'Жена', age: '38', height: '165', weight: '82', goal: ['Отслабване'], dailyActivityLevel: 'Ниско', sportActivity: 'Никаква (0 дни седмично)' };

const lose = AG.build(base);
ok(lose.group === 'lose', `отслабване → lose (${lose.group})`);
ok(lose.targets[0].value === String(GF.profileOf(base).stepTarget).replace(/\B(?=(\d{3})+(?!\d))/g, ' '), 'крачките са същите като в „Напредък“');
ok(lose.targets.some(t => /силови/.test(t.label) && t.value === '2–3'), 'отслабване: 2–3 силови');
ok(/Седмици 1–2/.test(sec(lose, 'week').items.join(' ')), 'без спорт: начален план по седмици');
ok(/30–45 мин седене/.test(sec(lose, 'daily').items.join(' ')), 'ниска активност: прекъсване на седенето');
ok(/болка в гърдите/.test(sec(lose, 'safety').items.join(' ')), 'общите сигнали за спиране — винаги');
ok(!/Кръвно/.test(text(lose)), 'без хипертония — без съвет за кръвно');

const gain = AG.build({ ...base, gender: 'Мъж', weight: '70', height: '180', goal: ['Мускулна маса'], sportActivity: 'Средна (2–4 дни седмично)', sportTypes: ['Силови (фитнес, тежести)'] });
ok(gain.group === 'gain' && gain.targets.some(t => t.value === '3–4'), 'мускулна маса: 3–4 силови');
ok(/6–12 повторения/.test(text(gain)), 'мускулна маса: серии до близо до отказ');

const yoga = AG.build({ ...base, sportActivity: 'Ниска (1–2 дни седмично)', sportTypes: ['Йога, пилатес, стречинг'] });
ok(/Добави 2 силови/.test(sec(yoga, 'week').items.join(' ')), 'само йога → добави силови');

const sick = AG.build({ ...base, age: '68', medicalConditions: ['Сърдечно-съдови'], 'medicalConditions_Сърдечно-съдови_детайл': ['Хипертония (високо кръвно налягане)', 'Аритмия'], 'medicalConditions_Мускулно-скелетни_детайл': ['Остеопороза'] });
const st = sec(sick, 'safety').items.join(' ');
ok(/кардиолога/.test(st) && /не задържай дъха/.test(st) && /сгъване напред/.test(st), 'сърце, кръвно и кости — съветите са там');
ok(sick.targets.some(t => /баланс/.test(t.label)), '65+: баланс');
ok(sick.clearance === true, 'сърдечно заболяване → съгласуване с лекар');
const htn = AG.build({ ...base, medicalConditions: ['Сърдечно-съдови'], 'medicalConditions_Сърдечно-съдови_детайл': ['Хипертония (високо кръвно налягане)'] });
ok(!htn.clearance && /не задържай дъха/.test(text(htn)) && !/кардиолога/.test(text(htn)), 'само хипертония: съвет за кръвното, без „кардиолог“');

const preg = AG.build({ ...base, clinicalProtocol: 'postpartum_lactation', postpartumStatus: 'Бременна' });
ok(!preg.targets.some(t => /силови/.test(t.label)), 'бременност: без цел за силови');
ok(/контракции/.test(text(preg)) && preg.clearance, 'бременност: сигналите за спиране и лекар');

const pp = AG.build({ ...base, clinicalProtocol: 'postpartum_lactation', postpartumStatus: 'Кърмя' });
ok(/тазовото дъно/.test(text(pp)) && /Кърми или изцеди/.test(text(pp)), 'след раждане и кърмене');

const voiced = AG.build(base, { personalActivity: ['Разходка с детето след вечеря.', 'Стълбите в офиса.'] });
ok(voiced.sections[0].key === 'personal' && voiced.sections[0].items.length === 2, 'личните съвети от AI са най-отгоре');

ok(GF.guideOrder(GF.profileOf(base)).includes('activity'), 'секцията е в подредбата по цел');

console.log(`activity-guide: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
