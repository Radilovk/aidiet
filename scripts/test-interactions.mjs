#!/usr/bin/env node
/**
 * Лекарства ↔ храни и добавки (drug-interactions.js) — от разпознаването на
 * лекарството до менюто, насоките и добавките. Без мрежа и без AI.
 */
import { interactionsFor, applySupplementInteractions } from '../drug-interactions.js';
import { compileProfile } from '../profile-code.js';
import { buildNutritionPlan } from '../nutrition-engine/index.js';
import { buildFoodGuide } from '../nutrition-engine/food-guide.js';
import { buildPlanSummary } from '../plan-summary.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const base = (meds, extra = {}) => enrichUserDataEngineContext({
  ...JSON.parse(JSON.stringify(PROFILES.find(p => p.id === 'female_moderate'))),
  medications: 'Да', medicationsDetails: meds, ...extra,
});

// ── Разпознаване ─────────────────────────────────────────────────────────
ok(interactionsFor({ medicationsDetails: 'Синтром 4 мг' }).ids.includes('vka'), 'търговско име → варфарин');
ok(interactionsFor({ medicationsDetails: 'Atorvastatin 20mg' }).ids.includes('statin'), 'латиница → статин');
ok(!interactionsFor({ medicationsDetails: 'метформин за инсулинова резистентност' }).ids.includes('hypoglycemic'), '„инсулинова резистентност“ не е инсулин');
ok(interactionsFor({ medicationsDetails: 'инсулин Лантус' }).ids.includes('hypoglycemic'), 'инсулин');
ok(interactionsFor({ medicationsDetails: '' }).ids.length === 0 && interactionsFor({}).ids.length === 0, 'без лекарства — без правила');

// ── Добавки ──────────────────────────────────────────────────────────────
const vka = interactionsFor({ medicationsDetails: 'варфарин' });
const sup = applySupplementInteractions([
  { name: 'Витамин K2', dosage: '100 mcg' }, { name: 'Витамин D3 + К2' }, { name: 'Витамин Е' },
  { name: 'Витамин D3', dosage: '2000 IU' }, { name: 'Витамин B12' }, { name: 'Кетогенна смес' },
], vka);
ok(sup.dropped.length === 3, `варфарин: K, K2 в комбинация и E отпадат (${sup.dropped.map(d => d.name)})`);
ok(sup.kept.some(s => s.name === 'Витамин D3') && sup.kept.some(s => s.name === 'Кетогенна смес'), 'варфарин: D3 и думи с „к“ остават');
const levo = applySupplementInteractions([{ name: 'Магнезий', timing: 'вечер' }, { name: 'Омега-3' }], interactionsFor({ medicationsDetails: 'Еутирокс 50' }));
ok(/4 часа след левотироксина/.test(levo.kept[0].timing) && levo.kept[0].timing.startsWith('вечер'), 'левотироксин: магнезий — с отделяне във времето');
ok(!levo.kept[1].timing, 'левотироксин: омега-3 без бележка');
const raas = applySupplementInteractions([{ name: 'Калий цитрат' }], interactionsFor({ medicationsDetails: 'Лориста 50' }));
ok(raas.dropped.length === 1, 'сартан: калий отпада');

// ── Профил ───────────────────────────────────────────────────────────────
const keto = compileProfile(base('Джардианс 10 мг', { dietPreference: ['Кето'] }));
ok(keto.diet.style === 'low_carb' && keto.adjustments.some(a => /MEDS_KETO/.test(a)), `SGLT2 + кето → нисковъглехидратна (${keto.diet.style})`);
const ketoFree = compileProfile(base('', { medications: 'Не', dietPreference: ['Кето'] }));
ok(ketoFree.diet.style === 'keto', 'без SGLT2 кето остава');
const su = compileProfile(base('Диабетон', { eatingHabits: ['Пропускам закуска'] }));
ok(!su.skipsBreakfast && !su.behaviors.includes('NBF'), 'сулфанилурейно → закуската не се пропуска');
ok(compileProfile(base('варфарин')).aiNotes.some(n => /витамин K/.test(n)), 'бележка за специалиста');

// ── Меню и насоки ────────────────────────────────────────────────────────
const statin = base('Симвастатин 20');
const eng = buildNutritionPlan(statin, { kcal: 1800, seed: 1 });
ok(!eng.policy.allowed('fruit_grapefruit'), 'статин → грейпфрут извън менюто');
ok(!JSON.stringify(eng.weekPlan).toLowerCase().includes('грейпфрут'), 'статин → грейпфрут няма в седмицата');
ok(buildNutritionPlan(base(''), { kcal: 1800, seed: 1 }).policy.allowed('fruit_grapefruit'), 'без статин грейпфрутът е позволен');
const g = buildFoodGuide(eng, statin);
ok(g.strict.some(s => /грейпфрут/.test(s.food) && /статин/.test(s.reason)), 'насоки: грейпфрут — с причината');

const maoiData = base('Моклобемид', { drinksAlcohol: 'Понякога' });
const engM = buildNutritionPlan(maoiData, { kcal: 1800, seed: 1 });
ok(['dairy_kashkaval', 'dairy_parmesan', 'cond_soy', 'pro_tempeh'].every(id => !engM.policy.allowed(id)), 'МАО инхибитор → без кашкавал, пармезан, соев сос, темпе');
const gM = buildFoodGuide(engM, maoiData);
ok(!gM.occasional.some(o => /Колбаси|Алкохол/.test(o.food)), 'МАО инхибитор → колбаси и алкохол не са „рядко позволени“');
ok(!gM.swaps.some(s => /Бира/.test(s.from)), 'МАО инхибитор → без безалкохолна бира като замяна');

// ── Добавки в резюмето ───────────────────────────────────────────────────
const warf = base('варфарин', { dietPreference: ['Веган'] });
const engW = buildNutritionPlan(warf, { kcal: 1800, seed: 1 });
const sum = buildPlanSummary({ userData: warf, strategy: {}, weekPlan: engW.weekPlan, bmr: 1400, dailyCalories: 1800, protocolSupplements: [{ name: 'Витамин K2', dosage: '100 mcg', timing: 'с храна' }] });
ok(!sum.supplements.some(s => /K2/.test(s.name)) && sum.supplements.some(s => /B12/.test(s.name)), `резюме: K2 отпада, B12 остава (${sum.supplements.map(s => s.name)})`);

console.log(`\n=== interactions: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
