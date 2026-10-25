#!/usr/bin/env node
/**
 * Обогатяване на профила (enrichment*.js): факти → профил → ниво на
 * преизчисляване → двигател. Без мрежа и без AI.
 */
import { normalizeFact, mergeFacts, deriveEnrichment, applyEnrichment, recalcLevel, isUrgent } from '../enrichment.js';
import { deriveEmoEat } from '../enrichment-emoeat.js';
import { deriveLabs } from '../enrichment-labs.js';
import { compileProfile } from '../profile-code.js';
import { buildNutritionPlan } from '../nutrition-engine/index.js';
import { buildPlanSummary } from '../plan-summary.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';
import { supplementsFor } from '../supplement-rules.js';
import { reanalyze } from '../analysis-reanalysis.js';
import { calculateBMR, calculateTDEE, calculateUnifiedActivityScore, calculateActivityTDEE, kcalPerStep } from '../energy.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const NOW = new Date('2026-10-20T10:00:00Z');
const daysAgo = n => new Date(NOW.getTime() - n * 86400000).toISOString();

// ── Факти ────────────────────────────────────────────────────────────────
ok(normalizeFact({ kind: 'weight', value: '72,4', at: daysAgo(1) })?.value === 72.4, 'тегло със запетая');
ok(normalizeFact({ kind: 'weight', value: 900, at: daysAgo(1) }) === null, 'невъзможно тегло отпада');
ok(normalizeFact({ kind: 'steps', value: -5, at: daysAgo(1) }) === null, 'отрицателни крачки отпадат');
ok(normalizeFact({ kind: 'weight', value: 70 }) === null, 'без дата — няма факт');
ok(normalizeFact({ kind: 'biomarker', key: 'hba1c', value: '5,9', unit: '%', at: daysAgo(3) })?.value === 5.9, 'показател');

const merged = mergeFacts(
  [{ kind: 'weight', value: 80, at: daysAgo(2), source: 'scale' }],
  [{ kind: 'weight', value: 79.5, at: daysAgo(2), source: 'scale' }, { kind: 'weight', value: 79, at: daysAgo(1), source: 'scale' }],
  NOW,
);
ok(merged.length === 2 && merged[0].value === 79 && merged[1].value === 79.5, 'сливане: един запис на ден/източник, най-новият първи');
ok(mergeFacts([{ kind: 'weight', value: 80, at: daysAgo(500) }], [], NOW).length === 0, 'стари факти отпадат');

const base0 = () => enrichUserDataEngineContext(JSON.parse(JSON.stringify(PROFILES.find(p => p.id === 'female_moderate'))));

// ── Енергия от измерените крачки ─────────────────────────────────────────
{
  const person = { gender: 'Мъж', age: '40', height: '180', weight: '80', sportActivity: 'Никаква (0 дни седмично)', dailyActivityLevel: 'Високо' };
  const bmr = calculateBMR(person);
  const q = calculateActivityTDEE(bmr, person);
  ok(q.tdee === calculateTDEE(bmr, calculateUnifiedActivityScore(person).combinedScore) && !q.activityData.measuredSteps, 'без измерване — по въпросника');
  const at = (steps) => calculateActivityTDEE(bmr, { ...person, _enrichment: { activity: { steps } } });
  const k10 = at(10000);
  const k25 = at(25000);
  ok(k25.tdee - k10.tdee === Math.round(22000 * kcalPerStep(person)) - Math.round(7000 * kcalPerStep(person)), `25 000 крачки не са „Високо“ като 10 000 (+${k25.tdee - k10.tdee} kcal)`);
  ok(at(2000).tdee === calculateTDEE(bmr, 1), 'под заседналия минимум — само 1,2 × BMR');
  ok(Math.abs(at(7000).tdee - calculateTDEE(bmr, 2)) < 120, 'около 7000 крачки — близо до досегашното „Средно“');
  const sporty = calculateActivityTDEE(bmr, { ...person, sportActivity: 'Средна (2–4 дни седмично)', _enrichment: { activity: { steps: 7000 } } });
  ok(sporty.tdee > at(7000).tdee, 'тренировките остават в множителя');
}

// ── Устройства ───────────────────────────────────────────────────────────
const steps = n => Array.from({ length: n }, (_, i) => ({ kind: 'steps', value: 4200, at: daysAgo(i + 1), source: 'health_connect' }));
let d = deriveEnrichment({ facts: steps(8) }, NOW);
ok(d.overrides.dailyActivityLevel === 'Ниско', `крачки 4200 → Ниско (${d.overrides.dailyActivityLevel})`);
d = deriveEnrichment({ facts: steps(5) }, NOW);
ok(!d.overrides.dailyActivityLevel, 'под 7 дни крачки — без замяна');
// Крачки: един източник (без смесване), без дните с тренировка, сверка телефон/гривна.
{
  const at = (n) => daysAgo(n).slice(0, 10) + 'T12:00:00.000Z';
  const series = (n, value, source, from = 1) => Array.from({ length: n }, (_, i) => ({ kind: 'steps', value, at: at(i + from), source }));
  let a = deriveEnrichment({ facts: [...series(8, 4000, 'phone'), ...series(8, 9000, 'health_connect')] }, NOW).activity;
  ok(a.source === 'device' && a.steps === 9000 && a.disputed && a.ratio === 2.25, `телефон 4000 / гривна 9000 → гривната, разминаване (${JSON.stringify(a)})`);
  const disputedData = applyEnrichment(base0(), { facts: [...series(8, 4000, 'phone'), ...series(8, 9000, 'health_connect')] }, NOW);
  const q = disputedData._enrichment.crossCheck.questions.find(x => x.id === 'steps_source');
  ok(q && q.options.map(o => o.value).join() === 'device,phone' && /125% повече/.test(q.text), 'разминаване → въпрос кое се носи по-постоянно');
  ok(reanalyze(base0(), disputedData, {}, 'F').questions.some(x => x.id === 'steps_source'), 'въпросът стига до анализа');
  const answered = [...series(8, 4000, 'phone'), ...series(8, 9000, 'health_connect'), normalizeFact({ kind: 'resolution', key: 'steps_source', value: 'phone', at: daysAgo(0) })];
  a = deriveEnrichment({ facts: answered }, NOW).activity;
  ok(a.source === 'phone' && a.steps === 4000, 'отговор „телефона“ → поредицата е от телефона');
  ok(!applyEnrichment(base0(), { facts: answered }, NOW)._enrichment.crossCheck.questions.some(x => x.id === 'steps_source'), 'след отговор — без въпрос');
  a = deriveEnrichment({ facts: [...series(4, 9000, 'health_connect'), ...series(8, 5000, 'phone', 5)] }, NOW).activity;
  ok(a.source === 'phone' && a.steps === 5000 && !a.disputed, 'гривната има под 7 дни → само телефонът, без смесване');
  const trained = [...series(7, 6000, 'phone'), ...series(3, 16000, 'phone', 8),
    ...[8, 9, 10].map(n => ({ kind: 'train_check', value: 1, at: at(n), source: 'checkin' }))];
  a = deriveEnrichment({ facts: trained }, NOW).activity;
  ok(a.steps === 6000 && a.days === 10 && a.restDays === 7, `дните с тренировка не влизат в обичайните крачки (${a.steps})`);
}
d = deriveEnrichment({ facts: Array.from({ length: 6 }, (_, i) => ({ kind: 'sleep', value: 5.8, at: daysAgo(i + 1) })) }, NOW);
ok(d.overrides.sleepHours === '5.8', 'сън от устройство');
d = deriveEnrichment({ facts: [{ kind: 'weight', value: 81, at: daysAgo(1) }, { kind: 'weight', value: 80, at: daysAgo(2) }] }, NOW);
ok(d.checkin.weightKg === 80.5 && !('weight' in d.overrides), 'теглото — в претеглянето, не в профила');

// ── EmoEat ───────────────────────────────────────────────────────────────
const emo = (extra = {}) => ({
  kind: 'emoeat', at: daysAgo(1), source: 'emoeat', status: 'confirmed',
  value: {
    intensity: 'Силно', archetype: { name: 'Утехата', description: 'топлина вечер' },
    drivers: ['Нужда от близост'], behaviors: [{ name: 'Трудно спиране', level: 'Осезаемо' }],
    patterns: [], bodySignals: '', realNeed: 'спокойствие', reliability: { level: 'висока' }, ...extra,
  },
});
let e = deriveEmoEat([emo()]);
ok(['EMO', 'EVE', 'OVR'].every(c => e.hints.behaviors.includes(c)), `EmoEat → кодове (${e.hints.behaviors})`);
ok(e.voice.archetype === 'Утехата' && e.voice.realNeed === 'спокойствие', 'EmoEat → глас');
e = deriveEmoEat([emo({ reliability: { level: 'ниска' } })]);
ok(e.hints.behaviors.length === 0 && e.voice, 'ниска надеждност — само глас');
e = deriveEmoEat([emo({ intensity: 'Слабо' })]);
ok(e.hints.behaviors.length === 0, 'слаб интензитет — без кодове');
e = deriveEmoEat([emo({ patterns: ['Правила → срив → нови правила'], behaviors: [{ name: 'Строги правила', level: 'Силно' }] })]);
ok(e.hints.cautions.some(c => /ограничаващ/.test(c)) && e.hints.behaviors.includes('CMP'), 'ограничаващ модел → бележка + CMP');

// ── Изследвания ──────────────────────────────────────────────────────────
const lab = (key, value, unit, extra = {}) => ({ kind: 'biomarker', key, value, unit, at: daysAgo(10), source: 'lab', status: 'confirmed', ...extra });
let L = deriveLabs([lab('hba1c', 6.0, '%')], NOW);
ok(L.hints.clinical.includes('IR'), 'HbA1c 6,0% → IR');
L = deriveLabs([lab('glucose', 110, 'mg/dL')], NOW);
ok(L.hints.clinical.includes('IR') && Math.abs(L.findings[0].value - 6.11) < 0.05, 'глюкоза mg/dL → mmol/L → IR');
L = deriveLabs([lab('glucose', 5.0, 'mmol/L')], NOW);
ok(L.hints.clinical.length === 0 && L.findings[0].status === 'normal', 'нормална глюкоза — без правило');
L = deriveLabs([lab('vitd', 20, 'ng/mL')], NOW);
ok(L.supplements[0]?.name === 'Витамин D3' && /по изследване/.test(L.supplements[0].timing) && L.supplements[0].reason, 'витамин D нисък → D3 с обосновка');
L = deriveLabs([lab('egfr', 50, '')], NOW);
ok(L.safety.proteinCapPerKg === 0.8 && L.safety.urgent, 'eGFR 50 → таван на белтъка, неотложно');
L = deriveLabs([lab('tsh', 6, 'mIU/L')], NOW);
ok(L.hints.clinical.length === 0 && L.hints.cautions.length === 1, 'TSH — само бележка, без автоматична промяна');
L = deriveLabs([lab('hba1c', 6.0, '%', { status: 'pending' })], NOW);
ok(L === null, 'непотвърдена стойност не влиза');
L = deriveLabs([lab('hba1c', 6.0, '%', { at: daysAgo(400) })], NOW);
ok(L === null, 'изследване над 12 месеца не влиза');
L = deriveLabs([lab('hgb', 125, 'g/L')], NOW, 'M');
ok(L.hints.clinical.includes('ANEM'), 'хемоглобин 125 при мъж → ANEM');
L = deriveLabs([lab('hgb', 125, 'g/L')], NOW, 'F');
ok(!L.hints.clinical.includes('ANEM'), 'хемоглобин 125 при жена — норма');

// ── Нива на преизчисляване ───────────────────────────────────────────────
const base = () => enrichUserDataEngineContext(JSON.parse(JSON.stringify(PROFILES.find(p => p.id === 'female_moderate'))));
const userA = base();
const lvl = (store) => recalcLevel(applyEnrichment(base(), { facts: [] }, NOW), applyEnrichment(base(), store, NOW));
ok(lvl({ facts: [emo()] }).level === 0, 'EmoEat → ниво 0 (глас)');
const activityLevel = lvl({ facts: steps(8) });
ok(compileProfile(userA).activity.daily === 1 ? activityLevel.level === 0 : activityLevel.level === 2, `крачки → ниво ${activityLevel.level}`);
ok(lvl({ facts: [lab('hba1c', 6.0, '%')] }).level === 3, 'клиничен код от изследване → ниво 3');
const egfrLevel = lvl({ facts: [lab('egfr', 50, '')] });
ok(egfrLevel.level >= 2, 'граница за безопасност → поне ниво 2');
ok(isUrgent(applyEnrichment(base(), { facts: [lab('egfr', 50, '')] }, NOW)._enrichment), 'eGFR → неотложно');
ok(!isUrgent(applyEnrichment(base(), { facts: [lab('hba1c', 6.0, '%')] }, NOW)._enrichment), 'HbA1c → не е неотложно');

// ── До двигателя ─────────────────────────────────────────────────────────
const withIr = applyEnrichment(base(), { facts: [lab('hba1c', 6.0, '%')] }, NOW);
ok(compileProfile(withIr).clinical.includes('IR'), 'IR в компилирания профил');
const planIr = buildNutritionPlan(withIr, { kcal: 1900, seed: 1 });
ok(planIr.policy.noSweets, 'IR от изследване → без сладко в менюто');
const withKidney = applyEnrichment(base(), { facts: [lab('egfr', 50, '')] }, NOW);
const planKidney = buildNutritionPlan(withKidney, { kcal: 1900, seed: 1 });
const cap = Math.round(compileProfile(withKidney).weightKg * 0.8);
ok(planKidney.macros.protein <= cap, `таван на белтъка ${planKidney.macros.protein} ≤ ${cap} г`);
const withEmo = applyEnrichment(base(), { facts: [emo()] }, NOW);
ok(compileProfile(withEmo).behaviors.includes('EMO'), 'EMO в профила');
const withD = applyEnrichment(base(), { facts: [lab('vitd', 20, 'ng/mL')] }, NOW);
const engD = buildNutritionPlan(withD, { kcal: 1900, seed: 1 });
const sum = buildPlanSummary({ userData: withD, strategy: {}, weekPlan: engD.weekPlan, bmr: 1500, dailyCalories: 1900, protocolSupplements: [] });
const d3 = sum.supplements.filter(s => /D3/.test(s.name));
ok(d3.length === 1 && d3[0].reason, `D3 веднъж, с обосновка (${JSON.stringify(d3)})`);
ok(withD._enrichment.original && typeof withD._enrichment.original === 'object', 'оригиналните отговори се пазят');

ok(normalizeFact({ kind: 'water', value: 2000, unit: 'мл', at: '2026-10-20T08:00:00Z' })?.value === 2, 'вода в „мл“ (кирилица) → литри');

// ── Други документи ──────────────────────────────────────────────────────
const doc = (value, key = 'doc_test01') => ({ kind: 'document', key, value, at: daysAgo(2), status: 'confirmed' });
ok(normalizeFact(doc({ summary: 'x', clinical: ['GERD', 'XXX'], exclusions: ['NUT'] }))?.value.clinical.join() === 'GERD', 'документ: непознат код отпада');
ok(normalizeFact(doc({ summary: 'x' }, 'bad key!')) === null, 'документ: невалиден id отпада');
ok(normalizeFact(doc({ title: 'празен' })) === null, 'документ без съдържание отпада');
const withDoc = applyEnrichment(base(), { facts: [doc({ title: 'Епикриза', summary: 'Рефлукс, алергия към ядки.', clinical: ['GERD'], exclusions: ['NUT'], medications: ['омепразол 20 mg'], impact: 'menu' })] }, NOW);
const pDoc = compileProfile(withDoc);
ok(pDoc.clinical.includes('GERD') && pDoc.exclusions.includes('NUT'), 'документ → състояние и изключване в профила');
ok(/омепразол/.test(withDoc.medicationsDetails || ''), 'документ → лекарството влиза в проверката за взаимодействия');
ok(withDoc._enrichment.documents.length === 1 && withDoc._enrichment.documents[0].title === 'Епикриза', 'документът е в списъка');
ok(recalcLevel(base(), withDoc).level === 3, 'ново състояние от документ → ниво 3');
const ctxOnly = applyEnrichment(base(), { facts: [doc({ summary: 'Бележка: работя нощни смени.', impact: 'context' })] }, NOW);
ok(recalcLevel(base(), ctxOnly).level === 0, 'документ само за контекст → ниво 0');

// ── Добавки по профила ───────────────────────────────────────────────────
const supNames = (ud) => supplementsFor(compileProfile(ud), ud, { now: new Date('2026-06-01') }).map(x => x.name);
const allHaveReason = (ud) => supplementsFor(compileProfile(ud), ud, { now: NOW }).every(x => x.reason);
const veg = { ...base(), dietPreference: ['Веган'] };
ok(supNames(veg).some(n => /B12/.test(n)) && supNames(veg).some(n => /водорасли/.test(n)), 'веган → B12 и омега-3 от водорасли');
const gym = { ...base(), goal: 'Мускулна маса', sportActivity: 'Средна (2–4 дни седмично)' };
ok(supNames(gym).some(n => /Креатин/.test(n)), 'мускулна маса + тренировки → креатин');
const stress = { ...base(), stressLevel: 'Високо' };
ok(supNames(stress).some(n => /Магнезий/.test(n)), 'висок стрес → магнезий');
ok(supNames({ ...base(), medications: 'Да', medicationsDetails: 'Метформин 1000' }).some(n => /B12/.test(n)), 'метформин → B12');
ok([veg, gym, stress, base()].every(allHaveReason), 'всяка добавка е с причина');
ok(supNames(base()).length === 0 || supNames(base()).length <= 5, 'без причина — без добавки извън сезона');
ok(supplementsFor(compileProfile(base()), base(), { now: NOW }).some(x => /D3/.test(x.name) && /октомври/.test(x.reason)), 'октомври–март → D3 със сезонна причина');
const lowFe = applyEnrichment(base(), { facts: [lab('ferritin', 12, 'ng/mL')] }, NOW);
ok(lowFe._enrichment.supplements.some(x => /Желязо/.test(x.name) && /Феритин/.test(x.reason)), 'нисък феритин → желязо по изследване');

// ── Реанализ ─────────────────────────────────────────────────────────────
const sleepFacts = Array.from({ length: 10 }, (_, i) => ({ kind: 'sleep', value: 5.4, at: daysAgo(i + 1), source: 'health_connect' }));
const reFacts = [lab('vitd', 18, 'ng/mL'), lab('hba1c', 6.0, '%'), ...sleepFacts];
const reData = applyEnrichment(base(), { facts: reFacts }, NOW);
const re = reanalyze(base(), reData, {}, 'F');
const reTitles = re.analysis.keyProblems.map(p => p.title);
ok(reTitles.includes('Нисък витамин D') && re.analysis.keyProblems.find(p => p.title === 'Нисък витамин D').sources.includes('labs'), 'реанализ: витамин D от изследване, с източник');
ok(re.analysis.keyProblems.some(p => p.code === 'IR' && p.sources.includes('labs') && p.change === 'new'), 'реанализ: IR от изследване е ново');
ok(re.analysis.keyProblems.some(p => p.category === 'Sleep' && p.sources.includes('device')), 'реанализ: сънят идва от устройството');
ok(re.analysis.currentHealthStatus.score < re.baseline.score, 'реанализ: оценката пада при нови находки');
ok(re.dimensions.find(x => x.key === 'Sleep').score < re.dimensions.find(x => x.key === 'Sleep').baseline, 'реанализ: измерение „сън“ спрямо въпросника');
ok(re.replaced.some(r => r.field === 'sleepHours'), 'реанализ: заменен отговор за сън');
ok(re.labs.find(l => l.key === 'vitd')?.range?.[0] === 50, 'реанализ: граница на нормата за графиката');
const irisFact = { kind: 'iris', value: { analysis: { systems: [{ key: 'metabolic', label: 'Обмяна', priority: true }] } }, at: daysAgo(3), source: 'airis' };
const withIris = reanalyze(base(), applyEnrichment(base(), { facts: [...reFacts, irisFact] }, NOW), {}, 'F');
const irP = withIris.analysis.keyProblems.find(p => p.code === 'IR');
ok(irP.sources.includes('iris') && irP.irisNote, 'AIRIS: потвърдената система засилва свързания проблем');
ok(withIris.analysis.currentHealthStatus.score < re.analysis.currentHealthStatus.score, 'AIRIS: потвърдената находка влиза в оценката');
const irisOnly = reanalyze(base(), applyEnrichment(base(), { facts: [irisFact] }, NOW), {}, 'F');
ok(irisOnly.analysis.currentHealthStatus.score === irisOnly.baseline.score, 'AIRIS без потвърждение не мени оценката');
const plain = reanalyze(base(), base(), {}, 'F');
ok(plain.analysis.currentHealthStatus.score === plain.baseline.score && !plain.replaced.length, 'без нови данни — анализът е същият');

// ── Протеин на прах от менюто → добавка ──────────────────────────────────
{
  const veg = { ...base(), dietPreference: ['Веган'] };
  const engV = buildNutritionPlan(veg, { kcal: 1300, seed: 'a' });
  const usesPowder = Object.values(engV.weekPlan).some(d => d.meals.some(m => /Протеин \(растителен\)/.test(m.description || '')));
  const sumV = buildPlanSummary({ userData: veg, strategy: {}, weekPlan: engV.weekPlan, bmr: 1300, dailyCalories: 1300, protocolSupplements: [] });
  ok(!usesPowder || sumV.supplements.some(x => /протеин на прах/i.test(x.name) && /белтък/.test(x.reason)), 'протеинът на прах в менюто е и в добавките, с причина');
  const sumNo = buildPlanSummary({ userData: base(), strategy: {}, weekPlan: {}, protocolSupplements: [] });
  ok(!sumNo.supplements.some(x => /протеин/i.test(x.name)), 'без прах в менюто — без протеин в добавките');
}
console.log(`\n=== enrichment: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
