#!/usr/bin/env node
/**
 * Персона (persona.js) и обединените индекси (goal-focus.js): как профилът
 * от въпросника, EmoEat и поведението насочва тона, въпросите, рисковия час,
 * плътността и кой индекс води.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../persona.js');
const GF = require('../goal-focus.js');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const NOW = new Date('2026-10-21T12:00:00');
const day = k => new Date(NOW.getTime() - k * 864e5).toISOString().slice(0, 10);

// Без EmoEat: тон по въпросника, без рисков час.
let p = P.build({ userData: { goal: 'Отслабване' }, now: NOW });
ok(p.tone === 'direct' && !p.riskWindow && p.mealChecks === 'all' && p.density === 'detailed', 'без EmoEat — стандартно');
ok(P.build({ userData: { stressLevel: 'Високо' }, now: NOW }).tone === 'warm', 'висок стрес — топъл тон');
ok(P.build({ userData: { stressLevel: 'Високо' }, now: NOW }).indexFocus === 'emotional', 'висок стрес — емоционалният индекс напред');

// Утехата, осезаемо: топъл тон, вечерен рисков час, напомняне, SOS.
p = P.build({ userData: { goal: 'Отслабване' }, emoeat: { archetype: 'Утехата', intensity: 'Осезаемо' }, now: NOW });
ok(p.tone === 'warm' && p.riskWindow.from === 19 * 60 && p.nudge.minute === 19 * 60 + 30 && p.sos.length === 3, 'Утехата — вечер, напомняне, SOS');
ok(P.inRiskWindow(p, new Date('2026-10-21T20:15:00')) && !P.inRiskWindow(p, new Date('2026-10-21T12:00:00')), 'рисков час — вечер да, обед не');

// Слаб интензитет — без рисков час и напомняне (несигурен сигнал не натрапва нищо).
p = P.build({ emoeat: { archetype: 'Утехата', intensity: 'Слабо' }, now: NOW });
ok(!p.riskWindow && !p.nudge, 'слаб интензитет — без напомняне');

// Строгият глас: без оценки, мек тон, кратък анализ.
p = P.build({ emoeat: { archetype: 'Строгият глас', intensity: 'Силно' }, now: NOW });
ok(p.noScores && p.tone === 'gentle' && p.density === 'minimal' && p.flexible, 'Строгият глас — без оценки, мек, кратък');
ok(P.mealQuestion(p, 'обяда').title === 'Как мина обяда?' && P.mealQuestion(p, 'обяда').no === 'Не този път', 'мек тон — меки думи във въпроса');
ok(P.mealQuestion({ tone: 'direct' }, 'обяда').title === 'Изяде ли обяда?', 'прям тон — прям въпрос');

// Редът: само основните хранения (честото отмятане храни контрола).
ok(P.build({ emoeat: { archetype: 'Редът', intensity: 'Осезаемо' }, now: NOW }).mealChecks === 'main', 'Редът — само основните');

// Паузата, но храненията извън плана са вечер — рисковият час се мести към вечерта.
const g = {};
for (let k = 1; k <= 6; k++) g[day(k)] = { meals: { 'Хранене 1': true, 'Хранене 2': true }, extraMeals: [{ ts: `${day(k)}T20:30:00` }] };
p = P.build({ emoeat: { archetype: 'Паузата', intensity: 'Осезаемо' }, gameData: g, now: NOW });
ok(p.riskWindow.from === 19 * 60, 'поведението мести рисковия час към вечерта');

// Рядко отмятане — по-малко въпроси и кратък анализ.
const lazy = {};
for (let k = 1; k <= 7; k++) lazy[day(k)] = { meals: { a: false, b: false, c: k === 1, d: false } };
p = P.build({ gameData: lazy, now: NOW });
ok(p.mealChecks === 'main' && p.density === 'minimal', 'рядко отмятане — основните, кратко');

// Индекси: поне 2 съставки; фокусът от персоната се вдига на второ място.
const M = { weight: { trendKgWeek: 0.05, days: 10 }, sleep: { avg7: 6.4 }, hrv: { avg7: 40, base: 42 }, restingHr: { avg7: 66, base: 60 }, steps: { avg7: 5200 }, workouts: { perWeek: 1 } };
const checks = { mealAdherence: 79, engagementPct: 89, balancePct: 50, junkCount: 3 };
let idx = GF.indices(M, checks, { goal: 'Отслабване' }, { planKcal: 1900 });
ok(idx[0].id === 'pace' && idx.every(i => i.parts.length >= 2), 'отслабване — темпът води; всеки индекс има ≥2 съставки');
ok(!idx.some(i => i.id === 'metabolic'), 'без кръвно/захар — няма „метаболитно здраве“');
idx = GF.indices(M, checks, { goal: 'Мускулна маса' }, { persona: { indexFocus: 'emotional' } });
ok(idx[0].id === 'pace' || idx[0].id === 'muscle', 'мускулна маса — мускулният индекс или темпът води');
ok(idx[1].id === 'emotional', 'персона с емоционален фокус — емоционалният индекс на второ място');
const rec = GF.indices(M, {}, { goal: 'Подобряване на здравето' }).find(i => i.id === 'recovery');
ok(rec && rec.value < 75 && /Слабото звено/.test(rec.note), 'възстановяване — слабото звено е посочено');
ok(GF.indices({}, { mealAdherence: 80 }, {}).length === 0, 'една съставка — без индекс');

console.log(`\n=== persona: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
