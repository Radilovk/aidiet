#!/usr/bin/env node
/**
 * „Избери храни“ (food-picker.html) → двигателя на плана, при всякакви сценарии.
 * Офлайн, без AI: същият път като /api/generate-plan-async → buildNutritionPlan.
 *
 * 1. Всеки продукт на страницата е точно храна от двигателя (без подниз).
 * 2. Режим „изключване“: махнатият продукт не отнася избран.
 * 3. Свободният текст (алергии, откази): „ядки“ не са овесените ядки и обратно.
 * 4. Сценарии: менюто е от избраното, допълва се само липсващата група,
 *    калориите са в целта, диетата и защитите стоят над избора.
 */
import { readFileSync } from 'node:fs';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';
import { calculateBMR, calculateSafeDeficit, calculateActivityTDEE } from '../energy.js';
import { computeIntakeTarget } from '../step1-deterministic.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { buildNutritionPlan } from '../nutrition-engine/index.js';
import { buildFoodPolicy, matchesTerm } from '../nutrition-engine/policy.js';
import { resolveChoiceName, resolveFoodChoice, restrictedGroupsOf, normalizeChoiceNames, withChoiceNames, unresolvedChoiceNames } from '../nutrition-engine/food-choice.js';
import { FOODS, food, foodByCatalogName } from '../nutrition-engine/knowledge.js';
import { compileProfile } from '../profile-code.js';
import { normalizeFoodKey } from '../food-utils.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const html = readFileSync('food-picker.html', 'utf8');
const CATALOG = Function(`return ${html.match(/const CATALOG = (\[[\s\S]*?\n\]);/)[1]}`)();
const ITEMS = CATALOG.flatMap(c => c.items);
const names = ids => [...ids].map(id => food(id).name);

// ── 1. Разпознаване ──
for (const item of ITEMS) ok(resolveChoiceName(item).length > 0, `„${item}“ е храна от двигателя`);
const expect = {
  'Мляко (2%)': ['Мляко (2%)', 'Мляко'],
  'Кисело мляко (2%)': ['Кисело мляко (2%)', 'Кисело мляко'],
  'Растително мляко': ['Растително мляко'],
  'Ориз (бял)': ['Ориз (бял)', 'Ориз'],
  'Ориз (кафяв)': ['Ориз (кафяв)'],
  'Овесени ядки': ['Овесени ядки'],
  'Пълнозърнест хляб': ['Пълнозърнест хляб'],
  'Домат': ['Домати'],
  'Краставица': ['Краставици'],
  'Чушка': ['Чушки'],
  'Тиквичка': ['Тиквички'],
  'Мандарина': ['Мандарина'],
  'Зеле': ['Зеле'],
  'Картофи (обикновени)': ['Картофи'],
  'Сладки картофи (батат)': ['Сладки картофи'],
  'Риба тон (консерва)': ['Риба тон'],
  'Протеин (суроватка)': ['Протеин (суроватка)'],
  'Фъстъчено масло': ['Фъстъчено масло'],
  'Паста (пълнозърнеста)': ['Паста'],
  'Телешко': ['Говеждо месо'],
};
for (const [item, want] of Object.entries(expect)) {
  const got = names(resolveChoiceName(item)).sort();
  ok(JSON.stringify(got) === JSON.stringify([...want].sort()), `„${item}“ → ${want.join(', ')} (а е ${got.join(', ') || 'нищо'})`);
}
const foreign = resolveFoodChoice(['Chicken breast', 'Hähnchen', 'Броколи']);
ok(foreign.unresolved.length === 2 && foreign.ids.size === 1, 'непознатите имена се отчитат, не се губят без следа');

// ── 2. Режим „изключване“: точно махане ──
const omni = compileProfile(structuredClone(PROFILES[0]));
const basePolicy = buildFoodPolicy(omni, {});
let collateral = 0;
for (const dropped of ITEMS) {
  const policy = buildFoodPolicy(omni, { excludeFoods: [dropped] });
  const droppedIds = new Set(resolveChoiceName(dropped));
  for (const kept of ITEMS) {
    if (kept === dropped) continue;
    for (const id of resolveChoiceName(kept)) {
      if (droppedIds.has(id) || !basePolicy.allowed(id)) continue;
      if (!policy.allowed(id)) { collateral++; console.error(`  махнат „${dropped}“ отнася „${kept}“ (${food(id).name})`); }
    }
  }
  for (const id of droppedIds) {
    if (FOODS.get(id).group !== 'FREE') ok(!policy.allowed(id), `махнатият „${dropped}“ (${food(id).name}) не е в менюто`);
  }
}
ok(collateral === 0, `изключването е точно (колатерални: ${collateral})`);

// ── 3. Свободен текст: сложните имена ──
const f = name => [...FOODS.values()].find(x => x.name === name);
const term = t => normalizeFoodKey(t);
ok(!matchesTerm(f('Овесени ядки'), term('ядки')), 'алергия „ядки“ не спира овесените ядки');
ok(matchesTerm(f('Бадеми'), term('бадеми')) && matchesTerm(f('Ядки'), term('ядки')), 'алергия „ядки“ спира ядките');
ok(!matchesTerm(f('Ядки'), term('овесени ядки')), 'отказ от овесени ядки не спира ядките');
ok(matchesTerm(f('Овесени ядки'), term('овес')), '„овес“ спира овесените ядки');
ok(!matchesTerm(f('Фъстъчено масло'), term('масло')) && matchesTerm(f('Масло'), term('масло')), '„масло“ е краве масло, не фъстъчено');
ok(!matchesTerm(f('Растително мляко'), term('мляко')) && matchesTerm(f('Кисело мляко'), term('мляко')), '„мляко“ не спира растителното мляко');

// ── 4. Сценарии през целия двигател ──
const LINE = /^• (.+?) (\d+)g/;
function intakeOf(data) {
  const { tdee } = calculateActivityTDEE(calculateBMR(data), data);
  const min = data.gender === 'Мъж' ? 1500 : 1200;
  return Math.max(min, computeIntakeTarget(tdee, data.goal, calculateSafeDeficit(tdee, data)) || tdee);
}
const byId = id => PROFILES.find(p => p.id === id);

function run(name, { profile = PROFILES[0], select = [], exclude = null, extra = {}, minShare = 0.75, check }) {
  const data = structuredClone({ ...profile, ...extra });
  if (exclude) data.userFoodExclude = exclude;
  else data.userFoodList = select;
  enrichUserDataEngineContext(data);
  const kcal = intakeOf(data);
  let res;
  try { res = buildNutritionPlan(data, { kcal, seed: name }); }
  catch (e) { ok(false, `${name}: планът се сглобява (${e.message})`); return null; }
  const foods = Object.values(res.weekPlan).flatMap(d => d.meals)
    .flatMap(m => String(m.description || '').split('\n'))
    .map(l => foodByCatalogName(l.match(LINE)?.[1] || ''))
    .filter(x => x && x.group !== 'FREE');
  const choice = res.policy.choice;
  const restricted = new Set(choice.restrictedGroups);
  const inGroups = foods.filter(x => restricted.has(x.group));
  const share = inGroups.length ? inGroups.filter(x => choice.picked.has(x.id)).length / inGroups.length : 1;
  // Целта на деня — от метаболитната седмица (тренировъчен/почивен ден); денят със свободно хранене не се мери.
  const days = Object.values(res.weekPlan).filter(d => d.meals.every(m => m.type !== 'Свободно хранене'));
  const offDays = days.filter(d => { const t = d.energy?.kcal || kcal; return Math.abs((d.dailyTotals?.calories || 0) - t) > t * 0.1; });
  console.log(`• ${name}: ${Math.round(share * 100)}% от избраното в ${[...restricted].join('+') || '—'}; допълнени хранения ${res.stats.choice?.relaxedMeals ?? 0}`);
  ok(share >= minShare, `${name}: менюто в ограничените групи е от избраното (${Math.round(share * 100)}% < ${minShare * 100}%)`);
  ok(offDays.length === 0, `${name}: дневните калории са в целта на деня ±10% (${kcal} kcal; извън: ${offDays.length})`);
  if (check) check({ res, foods, names: new Set(foods.map(x => x.name)), choice });
  return res;
}

const typical = ['Пилешки гърди', 'Яйца', 'Сьомга', 'Кисело мляко (2%)', 'Сирене', 'Броколи', 'Домат', 'Краставица',
  'Овесени ядки', 'Ориз (бял)', 'Пълнозърнест хляб', 'Зехтин', 'Орехи', 'Ябълка', 'Банан'];
const ANIMAL_KINDS = new Set(['poultry', 'red', 'fish', 'shellfish', 'egg', 'dairy']);
const animal = x => ANIMAL_KINDS.has(x.kind) || x.flags.has('lactose') || (x.catalogGroup === 'dairy' && !x.vegan);

run('Типичен избор (15)', { select: typical, check: ({ names: n }) => {
  ok(n.has('Краставици'), 'избраната краставица влиза в менюто');
} });
run('Минимум: 10 продукта, 3 групи', { select: ['Пилешки гърди', 'Пуешко филе', 'Яйца', 'Броколи', 'Спанак', 'Морков', 'Домат', 'Ориз (бял)', 'Овесени ядки', 'Картофи (обикновени)'],
  check: ({ choice }) => ok(![...choice.picked].some(id => food(id).name === 'Ядки') && !choice.restrictedGroups.includes('FAT'), 'избраните овесени ядки не са ядки и не ограничават мазнините') });
run('Без нито един белтък', { select: ['Броколи', 'Спанак', 'Домат', 'Краставица', 'Ориз (бял)', 'Овесени ядки', 'Ябълка', 'Банан', 'Портокал', 'Ягоди'],
  check: ({ choice }) => ok(!choice.restrictedGroups.includes('PRO'), 'без избран белтък белтъкът е свободен') });
run('Само риба', { select: ['Сьомга', 'Скумрия', 'Треска', 'Броколи', 'Спанак', 'Тиквичка', 'Ориз (кафяв)', 'Киноа', 'Зехтин', 'Лимон', 'Ябълка'],
  check: ({ foods }) => ok(!foods.some(x => x.group === 'PRO' && x.kind !== 'fish' && x.catalogGroup === 'protein'), 'белтъкът е само риба') });
run('Само сирене от млечните, без белтъци', { select: ['Сирене', 'Броколи', 'Домат', 'Краставица', 'Чушка', 'Ориз (бял)', 'Пълнозърнест хляб', 'Ябълка', 'Банан', 'Зехтин'],
  check: ({ choice, foods }) => {
    ok(!choice.restrictedGroups.includes('PRO'), 'сиренето само не ограничава белтъка');
    ok(foods.filter(x => x.group === 'PRO' && x.name !== 'Сирене').length > 0, 'белтъкът не е само сирене');
  } });
run('Само лимон от плодовете', { select: [...typical.filter(i => !['Ябълка', 'Банан'].includes(i)), 'Лимон'],
  check: ({ choice }) => ok(!choice.restrictedGroups.includes('FRU'), 'лимонът (подправка) не ограничава плодовете') });
run('Редки продукти по избор', { select: ['Скариди', 'Темпе', 'Аспержи', 'Манго', 'Просо', 'Гръцко кисело мляко', 'Пилешки гърди', 'Броколи', 'Ориз (бял)', 'Зехтин'], minShare: 0.6,
  check: ({ names: n }) => {
    const rare = ['Скариди', 'Аспержи', 'Манго', 'Гръцко кисело мляко'].filter(x => n.has(x));
    ok(rare.length >= 3, `избраните редки продукти влизат в менюто (${rare.join(', ')})`);
  } });
run('Веган профил + месо и млечни', { profile: byId('vegan'), select: typical, minShare: 0,
  check: ({ foods, res }) => {
    ok(!foods.some(animal), 'веганът не получава животински храни');
    ok(['Пилешки гърди', 'Яйца', 'Сьомга', 'Сирене'].every(n => res.foodChoice?.notAllowed.includes(n)), 'отчетът казва кое не влиза заради режима');
  } });
run('Веган профил, веган избор', { profile: byId('vegan'), select: ['Тофу', 'Темпе', 'Леща', 'Нахут', 'Броколи', 'Спанак', 'Домат', 'Киноа', 'Овесени ядки', 'Авокадо', 'Бадеми', 'Банан', 'Растително мляко'], minShare: 0.6,
  check: ({ foods }) => ok(!foods.some(animal), 'веганският избор остава вегански') });
run('Кето + ориз, хляб, банан', { profile: byId('keto_pref'), select: typical, minShare: 0,
  check: ({ names: n }) => ok(!['Ориз (бял)', 'Ориз', 'Пълнозърнест хляб', 'Банан'].some(x => n.has(x)), 'кето не получава ориз, хляб, банан') });
run('Диабет + мед, грозде, банан', { profile: byId('diabetes_ir'), select: [...typical, 'Мед', 'Грозде'], minShare: 0.5,
  check: ({ names: n }) => ok(!n.has('Мед') && !n.has('Грозде'), 'при диабет без мед и грозде') });
run('Алергия към ядки + избрани ядки', { select: [...typical, 'Бадеми', 'Фъстъци'], extra: { dietDislike: 'ядки, фъстъци' },
  check: ({ foods, names: n }) => {
    ok(!foods.some(x => x.flags.has('nut') || x.flags.has('peanut')), 'при отказ от ядки — без ядки');
    ok(n.has('Овесени ядки'), 'овесените ядки остават');
  } });
run('Собствени продукти на английски', { select: ['Броколи', 'Домат', 'Ябълка', 'Chicken breast', 'Greek yogurt', 'Brown rice'], minShare: 0.5,
  check: ({ choice, res }) => {
    ok(choice.unresolved.length === 3 && res.foodChoice?.unresolved.length === 3, 'непознатите имена са в отчета');
  } });
// Преводът от AI (worker: applyFoodChoiceNames) — приема се само име от речника.
{
  const unknown = unresolvedChoiceNames({ userFoodList: ['Броколи', 'Chicken breast', 'Greek yogurt', 'Brown rice', 'Pizza'] });
  ok(unknown.length === 4, `непознатите за AI: ${unknown.join(', ')}`);
  const map = normalizeChoiceNames({ foods: { 'Chicken breast': 'Пилешки гърди', 'Greek yogurt': 'Гръцко кисело мляко', 'Brown rice': 'Ориз (кафяв)', Pizza: 'Пица' } }, unknown);
  ok(Object.keys(map).length === 3 && !map.Pizza, 'име извън речника не се приема');
  run('Собствени продукти на английски, преведени', { select: ['Броколи', 'Домат', 'Ябълка', 'Chicken breast', 'Greek yogurt', 'Brown rice'],
    extra: { _foodChoiceNames: { names: map } },
    check: ({ choice, names: n }) => {
      ok(!choice.unresolved.length, 'след превода всичко е разпознато');
      ok(n.has('Пилешки гърди') && n.has('Ориз (кафяв)'), 'преведените продукти влизат в менюто');
    } });
  ok(JSON.stringify(withChoiceNames(['A', 'Б'], { A: 'Ябълка' })) === '["Ябълка","Б"]', 'withChoiceNames');
}
run('Собствени продукти извън списъка', { select: [...typical.slice(0, 8), 'Пъстърва', 'Булгур', 'Кус-кус', 'Телешко'],
  check: ({ choice }) => ok(['Пъстърва', 'Булгур', 'Кус-кус', 'Говеждо месо'].every(x => [...choice.picked].some(id => food(id).name === x)), 'собствените български продукти се разпознават') });

// Режим „изключване“ — както го праща страницата (неизбраните видими продукти).
const allBut = drop => ITEMS.filter(i => !drop.includes(i));
run('Изключване: без „Мляко (2%)“', { exclude: ['Мляко (2%)'], minShare: 0,
  check: ({ res }) => {
    const p = res.policy;
    ok(p.allowed(f('Кисело мляко (2%)').id) && p.allowed(f('Растително мляко').id), 'без прясно мляко — киселото и растителното остават');
    ok(!p.allowed(f('Мляко (2%)').id), 'прясното мляко 2% е махнато');
  } });
run('Изключване: без кафяв ориз и ръжен хляб', { exclude: ['Ориз (кафяв)', 'Ръжен хляб'], minShare: 0,
  check: ({ res }) => ok(res.policy.allowed(f('Ориз (бял)').id) && res.policy.allowed(f('Пълнозърнест хляб').id), 'белият ориз и пълнозърнестият хляб остават') });
run('Изключване: голям избор', { exclude: ITEMS.filter((_, i) => i % 5 === 0), minShare: 0,
  check: ({ foods, res }) => {
    const dropped = new Set(ITEMS.filter((_, i) => i % 5 === 0).flatMap(resolveChoiceName));
    const kept = new Set(allBut(ITEMS.filter((_, i) => i % 5 === 0)).flatMap(resolveChoiceName));
    ok(!foods.some(x => dropped.has(x.id) && !kept.has(x.id)), 'махнатите продукти не са в менюто');
    ok(res.stats.choice === undefined, 'изключването не ограничава групите');
  } });

// Отчетът за допълнените групи пътува с менюто.
{
  const res = run('Тесен избор — отчет', { select: ['Пилешки гърди', 'Броколи', 'Ориз (бял)', 'Ябълка'], minShare: 0.5 });
  ok(res && res.stats.choice && typeof res.stats.choice.relaxedMeals === 'number', 'отчетът за допълнените хранения е в stats.choice');
  ok(res && Array.isArray(res.foodChoice?.added) && res.foodChoice.added.every(n => !['Пилешки гърди', 'Броколи', 'Ориз (бял)', 'Ябълка'].includes(n)), 'отчетът изброява допълнените храни');
  ok(restrictedGroupsOf(resolveFoodChoice(['Пилешки гърди', 'Броколи']).ids).size === 2, 'групите на избора: белтък и зеленчуци');
}

console.log(`\n=== food-picker: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
