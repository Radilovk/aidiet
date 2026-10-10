#!/usr/bin/env node
/**
 * Матрица от профили: цел × тяло × активност × хранителен модел × здравословно
 * състояние × алергия × навици. Всеки профил минава през целия двигател и се
 * проверява за: разпознати състояния/ограничения (класификацията), забранени
 * храни за състоянието или алергията, точност спрямо целта и структура.
 * Покритието се печата — за да се види какво реално е тествано.
 *
 *   node scripts/test-profile-matrix.mjs [брой=220] [--verbose]
 */
import { calculateBMR, calculateUnifiedActivityScore, calculateTDEE, calculateSafeDeficit } from '../energy.js';
import { computeIntakeTarget } from '../step1-deterministic.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { buildNutritionPlan } from '../nutrition-engine/index.js';
import { foodByCatalogName, FOODS } from '../nutrition-engine/knowledge.js';
import { KITCHEN_GRID } from '../nutrition-engine/portions.js';
import { compileProfile, GOALS } from '../profile-code.js';

const N = Number(process.argv[2]) || 220;
const VERBOSE = process.argv.includes('--verbose');

const BODIES = [
  { gender: 'Жена', age: 30, height: 165, weight: 58 },
  { gender: 'Жена', age: 48, height: 168, weight: 82 },
  { gender: 'Жена', age: 66, height: 160, weight: 70 },
  { gender: 'Жена', age: 35, height: 170, weight: 125 },
  { gender: 'Мъж', age: 26, height: 182, weight: 78 },
  { gender: 'Мъж', age: 41, height: 178, weight: 105 },
  { gender: 'Мъж', age: 58, height: 172, weight: 88 },
  { gender: 'Мъж', age: 71, height: 170, weight: 72 },
];
const ACTIVITY = ['Ниска (0–1 ден седмично)', 'Средна (2–4 дни седмично)', 'Висока (5+ дни седмично)'];
const DIETS = [null, 'Вегетарианска', 'Веган', 'Пескетарианска', 'Кето', 'Нисковъглехидратна', 'Средиземноморска', 'DASH',
  'Високопротеинова', 'Без глутен', 'Без млечни', 'Low-FODMAP', 'Палео'];
const G = 'Храносмилателни проблеми';
const GD = 'medicalConditions_Храносмилателни_детайл';
const MD = 'medicalConditions_Метаболитни_детайл';
const CONDITIONS = [
  null,
  { code: 'T2D', group: 'Диабет' },
  { code: 'IR', group: 'Диабет / Инсулинова резистентност' },
  { code: 'HYPO', group: 'Щитовидна жлеза (Хашимото и др.)' },
  { code: 'CEL', group: 'Автоимунни заболявания', field: 'medicalConditions_Автоимунно', detail: 'Целиакия (глутенова ентеропатия)' },
  { code: 'HTN', group: 'Сърдечно-съдови заболявания', field: 'medicalConditions_Сърдечно-съдови_детайл', detail: 'Хипертония (високо кръвно налягане)' },
  { code: 'PCOS', group: 'Ендокринни заболявания', field: 'medicalConditions_Ендокринни_детайл', detail: 'Синдром на поликистозните яйчници', female: true },
  { code: 'IBS', group: G, field: GD, detail: 'Синдром на раздразненото черво' },
  { code: 'GERD', group: G, field: GD, detail: 'Гастроезофагеален рефлукс' },
  { code: 'GAST', group: G, field: GD, detail: 'Хроничен гастрит' },
  { code: 'GOUT', group: 'Метаболитни нарушения', field: MD, detail: 'Подагра' },
  { code: 'DYSL', group: 'Метаболитни нарушения', field: MD, detail: 'Дислипидемия (висок холестерол или триглицериди)' },
  { code: 'NAFLD', group: 'Метаболитни нарушения', field: MD, detail: 'Мастна чернодробна болест (стеатоза)' },
  { code: 'OSTEO', group: 'Мускулно-скелетни заболявания', field: 'medicalConditions_Мускулно-скелетни_детайл', detail: 'Остеопороза' },
  { code: 'ANEM', group: 'Анемия' },
  { code: 'MENO', group: 'Менопауза', female: true, minAge: 45 },
];
const ALLERGIES = [
  null,
  { text: 'алергия към фъстъци', excl: 'PNT', re: /Фъстъ/ },
  { text: 'не понасям морски дарове', excl: 'SHF', re: /Скарид/ },
  { text: 'алергия към ядки', excl: 'NUT', re: /Бадем|Орех|Кашу|Лешник|Шамфъстък|Ядки/ },
  { text: 'не ям яйца', excl: 'EGG', re: /Яйца|Омлет/ },
  { text: 'не ям риба', excl: 'FSH', re: /Риба|Сьомга|Скумрия|Пъстърва|Хек|Треска|Тилапия|Сардини|Лаврак/ },
  { text: 'не ям свинско', excl: 'PORK', re: /Свинско|Кайма/ },
  { text: 'алергия към соя', excl: 'SOY', re: /Тофу|Соев|Соево|Едамаме|Темпе/ },
];
const GOAL_NAMES = Object.values(GOALS);

// Забранени храни по състояние/модел — независими от политиката на двигателя (по текст).
const GLUTEN = /(^|\n)• (Хляб|Пълнозърнест хляб|Ръжен хляб|Тортила|Паста|Булгур|Кус-кус|Овесени ядки)\b/;
const DAIRY = /(^|\n)• (Мляко|Кисело|Гръцко|Извара|Сирене|Кашкавал|Кефир|Скир|Моцарела|Пармезан|Рикота|Масло)\b/;
const MEAT = /(Пилеш|Говежд|Свинск|Кайма|Агнеш|Пуеш)/;
const FISH = /(Риба|Сьомга|Скумрия|Пъстърва|Хек|Треска|Тилапия|Сардини|Скарид|Лаврак)/;
const EGGS = /(^|\n)• Яйца/;
const PURINE = /(Сардини|Скумрия|Скарид|Агнеш|Мидa|Пъстърва|Риба тон)/;
const FODMAP_FOODS = [...FOODS.values()].filter(f => f.flags.has('high_fodmap')).map(f => f.name);

const issues = [];
const cover = {};
const bump = (k) => { cover[k] = (cover[k] || 0) + 1; };

function intakeOf(data) {
  const bmr = calculateBMR(data);
  const tdee = calculateTDEE(bmr, calculateUnifiedActivityScore(data).combinedScore);
  const min = data.gender === 'Мъж' ? 1500 : 1200;
  return Math.max(min, computeIntakeTarget(tdee, data.goal, calculateSafeDeficit(tdee, data.goal)) || tdee);
}

function makeProfile(i) {
  const body = BODIES[(i * 3) % BODIES.length];
  const goal = GOAL_NAMES[(i * 7 + 1) % GOAL_NAMES.length];
  const diet = DIETS[(i * 5 + 2) % DIETS.length];
  let cond = CONDITIONS[(i * 11) % CONDITIONS.length];
  const allergy = ALLERGIES[(i * 13 + 3) % ALLERGIES.length];
  const activity = ACTIVITY[(i * 2) % ACTIVITY.length];
  const skip = i % 7 === 0;
  const sweets = i % 5 === 0;
  let { gender, age } = body;
  if (cond?.female && gender !== 'Жена') gender = 'Жена';
  if (cond?.minAge && age < cond.minAge) age = cond.minAge + 2;
  if (goal === GOALS.PP) gender = 'Жена';
  const p = {
    id: `m${String(i).padStart(3, '0')}`,
    name: 'Тест Тестов', gender, age: String(age), height: String(body.height), weight: String(body.weight),
    goal, lossKg: ['LOSS', 'VISC'].some(k => GOALS[k] === goal) ? String(Math.round(body.weight * 0.1)) : undefined,
    sleepHours: '7–8', stressLevel: 'Умерено', sportActivity: activity,
    eatingHabits: skip ? ['Не закусвам'] : ['Храня се редовно'],
    foodCravings: sweets ? ['Сладко'] : [],
    medicalConditions: cond ? [cond.group] : ['Нямам'], medications: 'Не',
    dietPreference: diet ? [diet] : [],
  };
  if (cond?.field) p[cond.field] = [cond.detail];
  if (allergy) p.dietDislike = allergy.text;
  return { p, meta: { cond, allergy, diet, skip, sweets, goal, gender, age, weight: body.weight } };
}

for (let i = 0; i < N; i++) {
  const { p, meta } = makeProfile(i);
  if (process.env.ONLY && process.env.ONLY !== p.id) continue;
  const data = structuredClone(p);
  enrichUserDataEngineContext(data);
  const prof = compileProfile(data);
  const fail = (rule, detail = '') => issues.push({ id: p.id, rule, detail });
  bump(`цел:${prof.goal}`); bump(`модел:${prof.diet.pattern}`); bump(`стил:${prof.diet.style}`);
  if (meta.cond) bump(`състояние:${meta.cond.code}`);
  if (meta.allergy) bump(`алергия:${meta.allergy.excl}`);
  bump(`възраст:${meta.age < 35 ? '<35' : meta.age < 55 ? '35-54' : '55+'}`);
  bump(`тегло:${meta.weight >= 100 ? '100+' : meta.weight < 65 ? '<65' : '65-99'}`);

  // 1. Класификация: разпознати ли са състоянието, алергията и диетата?
  if (meta.cond && !prof.clinical.includes(meta.cond.code)) fail('класификация: състоянието не е разпознато', meta.cond.code);
  if (meta.allergy && !prof.exclusions.includes(meta.allergy.excl)) fail('класификация: алергията не е разпозната', meta.allergy.excl);
  const wantPattern = { Вегетарианска: 'vegetarian', Веган: 'vegan', Пескетарианска: 'pescatarian' }[meta.diet];
  if (wantPattern && prof.diet.pattern !== wantPattern) fail('класификация: моделът на хранене', `${meta.diet} → ${prof.diet.pattern}`);
  if (meta.diet === 'Без глутен' && !prof.exclusions.includes('GLU')) fail('класификация: без глутен');
  if (meta.diet === 'Без млечни' && !prof.exclusions.includes('LAC')) fail('класификация: без млечни');
  if (meta.skip !== prof.skipsBreakfast) fail('класификация: не закусва');

  // 2. Планът се изгражда.
  const kcal = intakeOf(data);
  let res;
  try {
    res = buildNutritionPlan(data, { kcal, seed: p.id });
  } catch (e) {
    fail('планът не се изгражда', `${e.message} [${prof.diet.style}/${prof.diet.pattern} X:${prof.exclusions.join('+')} C:${prof.clinical.join('+')}]`);
    continue;
  }
  const { weekPlan, macros, policy } = res;
  if (process.env.ONLY) { console.log('цел', kcal, JSON.stringify(macros)); for (const m of (process.env.WEEK ? Object.values(weekPlan).flatMap(d => d.meals) : weekPlan.day1.meals)) console.log(m.type, m.calories, m.targetCalories, '|', m.name, '|', (m.description || '').replace(/\n/g, ' ')); console.log(JSON.stringify(res.prescription.daily)); }
  const meals = Object.values(weekPlan).flatMap(d => d.meals);
  const plated = meals.filter(m => m.macros && m.description);
  const text = plated.map(m => `${m.name}\n${m.description}`).join('\n');
  const desc = plated.map(m => m.description).join('\n');

  // 3. Забранени храни.
  const pattern = prof.diet.pattern;
  if (pattern === 'vegan' && (MEAT.test(text) || FISH.test(text) || DAIRY.test(desc) || EGGS.test(desc))) fail('забранено: животински продукт при веган');
  if (pattern === 'vegetarian' && (MEAT.test(text) || FISH.test(text))) fail('забранено: месо/риба при вегетарианец');
  if (pattern === 'pescatarian' && MEAT.test(text)) fail('забранено: месо при пескетарианец');
  if (prof.clinical.includes('CEL') || prof.exclusions.includes('GLU')) {
    if (GLUTEN.test(desc)) fail('забранено: глутен (целиакия / без глутен)', (desc.match(GLUTEN) || [])[2]);
  }
  if (prof.exclusions.includes('LAC') && DAIRY.test(desc)) fail('забранено: млечно при „без млечни“');
  if (meta.allergy && meta.allergy.re.test(desc)) fail(`забранено: ${meta.allergy.excl}`, (desc.match(meta.allergy.re) || [])[0]);
  if (prof.clinical.includes('GOUT') && PURINE.test(desc)) fail('забранено: много пурини при подагра', (desc.match(PURINE) || [])[0]);
  if ((prof.clinical.includes('IBS') || prof.diet.style === 'low_fodmap') && FODMAP_FOODS.some(n => new RegExp(`• ${n} \\d`).test(desc))) {
    fail('забранено: висок FODMAP', FODMAP_FOODS.find(n => new RegExp(`• ${n} \\d`).test(desc)));
  }
  if (prof.clinical.includes('GERD') && meals.some(m => m.type === 'Хранене 5')) fail('рефлукс: късно хранене преди лягане');
  if (prof.clinical.some(c => ['T2D', 'IR'].includes(c)) && /(^|\n)• (Бял хляб|Хляб|Оризови галети|Ориз|Ориз \(бял\)|Картофи|Мед) \d/.test(desc)) fail('висок ГИ при диабет/ИР', (desc.match(/(^|\n)• (Бял хляб|Хляб|Оризови галети|Ориз|Ориз \(бял\)|Картофи|Мед) \d/) || [])[2]);
  if (prof.clinical.includes('HTN')) {
    const salty = plated.filter(m => /(Сирене|Кашкавал|Маслини|Сардини|Пармезан)/.test(m.description)).length;
    if (salty > 6) fail('солено при хипертония: твърде често', String(salty));
  }
  if (prof.clinical.some(c => ['T2D', 'IR', 'PCOS'].includes(c)) && /(^|\n)• (Мед|Черен шоколад)/.test(desc)) fail('захар при инсулинова резистентност/диабет');
  if (prof.diet.style === 'keto') {
    const dayCarbs = Object.values(weekPlan).filter(d => !d.meals.some(m => m.type === 'Свободно хранене')).map(d => d.dailyTotals.carbs);
    if (dayCarbs.some(c => c > 70)) fail('кето: над 70 г въглехидрати', String(Math.max(...dayCarbs)));
  }

  // 4. Точност и структура.
  let devSum = 0, protSum = 0, nd = 0;
  for (const [key, day] of Object.entries(weekPlan)) {
    const hasFree = day.meals.some(m => m.type === 'Свободно хранене');
    const real = day.meals.filter(m => m.macros);
    if (real.length < 3 && prof.mealsPerDay >= 3) fail('структура: по-малко от 3 хранения', key);
    if (hasFree) continue;
    devSum += Math.abs(day.dailyTotals.calories - kcal) / kcal;
    protSum += day.dailyTotals.protein / macros.protein;
    nd++;
  }
  const dev = devSum / nd;
  if (dev > (prof.diet.style === 'keto' ? 0.16 : 0.11)) fail('точност: калории', `${(dev * 100).toFixed(1)}% ${kcal} kcal ${prof.diet.style}/${pattern}${prof.clinical.length ? ' ' + prof.clinical.join('+') : ''}${prof.exclusions.length ? ' X:' + prof.exclusions.join('+') : ''}`);
  if (protSum / nd < 0.85) fail('точност: белтък под 85% от целта', `${((protSum / nd) * 100).toFixed(0)}% ${kcal} kcal ${prof.diet.style}/${pattern}${prof.exclusions.length ? ' X:' + prof.exclusions.join('+') : ''}`);
  for (const m of plated) for (const line of m.description.split('\n')) {
    const g = Number((line.match(/ (\d+)g/) || [])[1]);
    if (g && !KITCHEN_GRID.includes(g)) fail('мрежа: грамаж извън кухненската мрежа', line);
    if (g && foodByCatalogName(line.replace(/^• /, '').replace(/ \d+g.*$/, '')) == null) fail('продукт извън двигателя', line);
  }
  const hasDrink = meals.some(m => m.type === 'Напитка');
  if (prof.skipsBreakfast !== hasDrink) fail('структура: сутрешна напитка при „не закусвам“');
  const hasFreeMeal = meals.some(m => m.type === 'Свободно хранене');
  if (hasFreeMeal !== policy.allowsFreeMeal) fail('структура: свободно хранене срещу правилата');
  if (meta.sweets && policy.sweets && !plated.some(m => m.dessert)) fail('структура: липсва десерт при сладкоежец');
  if (!policy.sweets && plated.some(m => m.dessert)) fail('структура: десерт там, където е забранен');
}

console.log(`Профили: ${N}`);
console.log('Покритие:', Object.entries(cover).sort().map(([k, v]) => `${k}=${v}`).join('  '));
const byRule = new Map();
for (const i of issues) {
  const r = byRule.get(i.rule) || { n: 0, ex: [] };
  r.n++;
  if (r.ex.length < (VERBOSE ? 40 : 3)) r.ex.push(`${i.id}${i.detail ? ` (${i.detail})` : ''}`);
  byRule.set(i.rule, r);
}
if (!issues.length) console.log('\n✓ няма нарушения');
for (const [rule, r] of [...byRule].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(r.n).padStart(4)}  ${rule}  — напр. ${r.ex.join('; ')}`);
// Безопасността е без компромис; точността в много тесни комбинации има бюджет.
const SOFT = /^точност:/;
const hard = issues.filter(i => !SOFT.test(i.rule));
const soft = new Set(issues.filter(i => SOFT.test(i.rule)).map(i => i.id));
console.log(`\nТвърди правила (класификация, забранени храни, структура): ${hard.length} нарушения. Точност извън границите: ${soft.size} от ${N} профила (${((soft.size / N) * 100).toFixed(1)}%, бюджет 8%).`);
console.log(`\n=== profile matrix: ${N - new Set(issues.map(i => i.id)).size} от ${N} профила без нарушения, ${issues.length} нарушения ===`);
process.exit(hard.length || soft.size > N * 0.08 ? 1 : 0);
