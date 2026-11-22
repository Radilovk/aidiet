#!/usr/bin/env node
/**
 * Движение и активност (activity-guide.js): кратко като другите насоки; целите следват goal-focus.js.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AG = require('../activity-guide.js');
const GF = require('../goal-focus.js');

let pass = 0;
let fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error(`✗ ${msg}`); } }
const all = (g) => g.items.concat(g.cautions).join(' ');

const base = { gender: 'Жена', age: '38', height: '165', weight: '82', goal: ['Отслабване'], dailyActivityLevel: 'Ниско', sportActivity: 'Никаква (0 дни седмично)' };

const lose = AG.build(base);
ok(lose.group === 'lose', `отслабване → lose (${lose.group})`);
ok(lose.targets[0].startsWith(String(GF.profileOf(base).stepTarget).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')), 'крачките са същите като в „Напредък“');
ok(lose.targets.includes('2–3 силови седмично'), 'отслабване: 2–3 силови');
ok(/20–30 минути ходене в 5 дни/.test(all(lose)), 'без спорт: откъде да започне');
ok(/веднъж на час/.test(all(lose)) && /стълбите/.test(all(lose)), 'ниска активност: ставане от стола и стълби');
ok(lose.items.length + lose.cautions.length <= 8, 'кратко — колкото другите секции');
ok(/болка в гърдите/.test(lose.cautions.join(' ')) && lose.cautions.length === 1, 'без състояния — само сигналите за спиране');

const gain = AG.build({ ...base, gender: 'Мъж', weight: '70', height: '180', goal: ['Мускулна маса'], sportActivity: 'Средна (2–4 дни седмично)', sportTypes: ['Силови (фитнес, тежести)'] });
ok(gain.group === 'gain' && gain.targets.includes('3–4 силови седмично'), 'мускулна маса: 3–4 силови');

const yoga = AG.build({ ...base, sportActivity: 'Ниска (1–2 дни седмично)', sportTypes: ['Йога, пилатес, стречинг'] });
ok(/Йогата е добра основа/.test(all(yoga)), 'само йога → добави силови');

const htn = AG.build({ ...base, medicalConditions: ['Сърдечно-съдови'], 'medicalConditions_Сърдечно-съдови_детайл': ['Хипертония (високо кръвно налягане)'] });
ok(!htn.clearance && /издишвай/.test(all(htn)) && !/кардиолога/.test(all(htn)), 'само хипертония: съвет за кръвното, без кардиолог');

const sick = AG.build({ ...base, age: '68', medicalConditions: ['Сърдечно-съдови'], 'medicalConditions_Сърдечно-съдови_детайл': ['Хипертония (високо кръвно налягане)', 'Аритмия'], 'medicalConditions_Мускулно-скелетни_детайл': ['Остеопороза'] });
ok(/кардиолога/.test(all(sick)) && sick.clearance, 'сърце: кардиолог и бележка за лекаря');
ok(sick.cautions.length === 3, 'най-много 2 предупреждения по здравето + сигналите за спиране');
ok(sick.targets.some(t => /баланс/.test(t)), '65+: баланс');

const preg = AG.build({ ...base, clinicalProtocol: 'postpartum_lactation', postpartumStatus: 'Бременна' });
ok(!preg.targets.some(t => /силови/.test(t)) && /контракции/.test(all(preg)) && preg.clearance, 'бременност');

const voiced = AG.build(base, { personalActivity: ['Слизай спирка по-рано.', 'Разходка с кучето вечер.', 'Трети.'] });
ok(voiced.items[0] === 'Слизай спирка по-рано.' && voiced.items.length === 6, 'до 2 лични съвета от AI — най-отгоре');

ok(GF.guideOrder(GF.profileOf(base)).includes('activity'), 'секцията е в подредбата по цел');

console.log(`activity-guide: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
