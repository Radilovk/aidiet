#!/usr/bin/env node
/**
 * Двигателят на плана (nutrition-engine/) върху всички профили от fixtures:
 * точност спрямо целта, реалистични порции, разнообразие, препоръките за
 * седмицата и спазване на диетата. Праговете са постигнатото + запас.
 */
import { HARD_PROFILES } from './plan-adequacy/fixtures/hard-profiles.mjs';
import { EXTENDED_PROFILES } from './plan-adequacy/fixtures/extended-profiles.mjs';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';
import { calculateBMR, calculateUnifiedActivityScore, calculateTDEE, calculateSafeDeficit } from '../energy.js';
import { computeIntakeTarget } from '../step1-deterministic.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { buildNutritionPlan, reconcileEnginePlan, mergePlanModifications } from '../nutrition-engine/index.js';
import { serializeWeekPlanClient, serializeStrategyForMealPlan } from '../context-compression.js';
import { buildFoodPolicy } from '../nutrition-engine/policy.js';
import { prescribe } from '../nutrition-engine/prescription.js';
import { foodByCatalogName, DISHES_BY_ID, DISHES, food, AVOID_PAIRS, hasAvoidedPair } from '../nutrition-engine/knowledge.js';
import { renderRecipe, RECIPES } from '../nutrition-engine/recipes.js';
import { mealSwapsOf, learnDishPreference } from '../nutrition-engine/dish-learning.js';
import { validateRecipes } from './culinary/validate.mjs';
import { KITCHEN_GRID } from '../nutrition-engine/portions.js';
import { buildEngineStrategy } from '../nutrition-engine/strategy.js';
import { buildDeterministicAnalysis } from '../analysis-deterministic.js';
import { validateDietetic } from './plan-adequacy/validators/dietetic.mjs';
import { validateProfileRules, userSkipsBreakfast } from './plan-adequacy/validators/profile-rules.mjs';
import { validateWeekPlanNutrition } from './plan-adequacy/validators/nutrition.mjs';
import { validateWeekPlanFoods } from './plan-adequacy/validators/foods.mjs';
import { validateWeekPlanCombinations } from './plan-adequacy/validators/combinations.mjs';
import { validateWeekPlanDayCoherence, validateWeeklyDishVariety } from '../meal-combinations.js';
import { profileBrief, normalizeIntakeHints, normalizeFeedbackHints, normalizeSwaps, collectFreeText, collectQuestionAnswers, describeCodes } from '../nutrition-engine/ai-assist.js';
import { compileProfile, reproductiveStatus } from '../profile-code.js';
import { textIssues, isCleanClientText, guardClientText } from '../nutrition-engine/text-guard.js';
import { WEEKLY_CHECKIN_QUESTIONS, readCheckin, decideWeeklyAdjustment, weeklyQuestionsFor } from '../nutrition-engine/monitoring.js';

let validatorIssues = 0;
let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const LINE = /^• (.+?) (\d+)g(?: — .+)?$/;

function intakeOf(data) {
  const bmr = calculateBMR(data);
  const tdee = calculateTDEE(bmr, calculateUnifiedActivityScore(data).combinedScore);
  const min = data.gender === 'Мъж' ? 1500 : 1200;
  return Math.max(min, computeIntakeTarget(tdee, data.goal, calculateSafeDeficit(tdee, data)) || tdee);
}

// 1. Предписанието по учебника: млечни/зеленчуци/плодове → зърнени → белтък → мазнини.
{
  const policy = buildFoodPolicy({ diet: { style: 'balanced', pattern: 'omnivore' }, exclusions: [], clinical: [], behaviors: [], activity: {} });
  const p = prescribe({ kcal: 1800, macros: { protein: 120, carbs: 180, fats: 62 } }, ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5'], policy);
  ok(p.daily.VEG === 4 && p.daily.FRU === 2 && p.daily.STA === 7.5 && p.daily.PRO === 11, `обменни порции 1800 kcal: ${JSON.stringify(p.daily)}`);
  const sum = k => p.slots.reduce((a, s) => a + p.meals[s].target[k], 0);
  ok(Math.abs(sum('protein') - 120) < 0.5 && Math.abs(sum('carbs') - 180) < 0.5, 'целите по хранене събират деня');
}

const seen = new Set();
const profiles = [...HARD_PROFILES, ...EXTENDED_PROFILES, ...PROFILES].filter(p => !seen.has(p.id) && seen.add(p.id));
const total = { k: 0, p: 0, c: 0, f: 0, n: 0 };
let alternativeIssues = 0;
const started = Date.now();
for (const prof of profiles) {
  const data = structuredClone(prof);
  enrichUserDataEngineContext(data);
  const kcal = intakeOf(data);
  let res;
  try {
    res = buildNutritionPlan(data, { kcal, seed: prof.id });
  } catch (e) {
    ok(false, `${prof.id}: планът се изгражда (${e.message})`);
    continue;
  }
  const { weekPlan, macros, policy, profile } = res;
  const dev = { k: 0, p: 0, c: 0, f: 0, n: 0 };
  const mainUses = new Map();
  const cats = { fish: 0, legume: 0, red: 0 };
  for (let d = 1; d <= 7; d++) {
    const meals = weekPlan[`day${d}`].meals;
    const mainsToday = [];
    for (const m of meals) {
      if (m.type === 'Свободно хранене' || m.type === 'Напитка') continue;
      ok(m.macros && m.calories > 0 && /^\d+г$/.test(m.weight), `${prof.id} д${d} ${m.type}: формат`);
      for (const line of m.description.split('\n')) {
        const hit = line.match(LINE);
        ok(hit, `${prof.id}: ред „${line}“ се чете`);
        if (!hit) continue;
        ok(KITCHEN_GRID.includes(Number(hit[2])), `${prof.id}: ${hit[2]} g извън кухненската мрежа (50 г нагоре на 50, под 50 — 10/15)`);
        const f = foodByCatalogName(hit[1]);
        ok(f, `${prof.id}: „${hit[1]}“ е храна от двигателя`);
        if (f && f.group !== 'FREE') ok(policy.allowed(f.id), `${prof.id}: ${hit[1]} е позволено за ${profile.diet.style}/${profile.diet.pattern}`);
        if (f && /^fat_(oil|sunflower_oil|butter|coconut_oil)$/.test(f.id)) ok(Number(hit[2]) <= 40, `${prof.id}: ${hit[2]} г ${hit[1]} в едно хранене`);
      }
      const dish = DISHES_BY_ID.get(m.dishId);
      if (dish?.meals.includes('main') && (m.type === 'Хранене 2' || m.type === 'Хранене 4')) {
        mainUses.set(dish.id, (mainUses.get(dish.id) || 0) + 1);
        mainsToday.push(dish.category);
        if (cats[dish.category] != null) cats[dish.category]++;
      }
    }
    if (mainsToday.length === 2 && profile.diet.pattern !== 'vegan' && profile.protocol !== 'autoimmune_aip') ok(mainsToday[0] !== mainsToday[1] || mainsToday[0] === 'poultry', `${prof.id} д${d}: обяд и вечеря от една категория`);
    if (meals.some(m => m.type === 'Свободно хранене')) continue;
    const t = weekPlan[`day${d}`].dailyTotals;
    // Целта на деня (тренировъчен/почивен, metabolic.js); без нея — средната.
    const e = weekPlan[`day${d}`].energy;
    const goal = e ? { k: e.kcal, p: e.protein, c: e.carbs, f: e.fats } : { k: kcal, p: macros.protein, c: macros.carbs, f: macros.fats };
    dev.k += Math.abs(t.calories - goal.k) / goal.k;
    dev.p += Math.abs(t.protein - goal.p) / goal.p;
    dev.c += Math.abs(t.carbs - goal.c) / Math.max(goal.c, 20);
    dev.f += Math.abs(t.fats - goal.f) / goal.f;
    dev.n++;
  }
  // AIP има малко ястия — там повторението е неизбежно.
  if (profile.protocol !== 'autoimmune_aip') ok([...mainUses.values()].every(n => n <= 2), `${prof.id}: основно ястие повече от 2 пъти седмично`);
  if (profile.diet.pattern === 'omnivore' && profile.diet.style === 'balanced' && !profile.exclusions.includes('FSH')) {
    ok(cats.fish >= 2 && cats.red <= 3, `${prof.id}: риба ${cats.fish}, червено месо ${cats.red} седмично`);
  }
  // Без закуска — предложение за хидратация; свободно хранене в неделя, освен при категорични правила.
  const day1 = weekPlan.day1.meals;
  // Напитката е вместо закуска — не и когато закуската е върната заради размера на порциите.
  const noBreakfast = profile.skipsBreakfast && !day1.some(m => m.type === 'Хранене 1');
  // Без отделна карта „Напитка“ (решение на собственика): без закуска денят започва с първото хранене.
  ok(!Object.values(weekPlan).some(d => d.meals.some(m => m.type === 'Напитка')), `${prof.id}: без карта „Напитка“`);
  if (noBreakfast) ok(day1.length >= 2, `${prof.id}: без закуска — останалите хранения са в плана`);
  ok(Object.values(weekPlan).some(d => d.meals.some(m => m.type === 'Свободно хранене')) === policy.allowsFreeMeal, `${prof.id}: свободно хранене според правилата`);
  // Правилата на валидаторите (един въглехидратен източник, лека закуска, универсални продукти…).
  const analysis = { ...buildDeterministicAnalysis(data), Final_Calories: kcal, macroGrams: { ...macros } };
  const strategy = buildEngineStrategy(res, data, { kcal, freeDayNumber: res.freeDayNumber });
  const wrapped = { analysis, strategy, weekPlan };
  // Ръководството за храните не противоречи на политиката: забраненото не е „по избор“.
  {
    const g = strategy.foodGuide;
    ok(g && g.v === 1, `${prof.id}: foodGuide`);
    if (g) {
      const occ = g.occasional.map(o => o.food).join(' | ');
      const sw = g.swaps.map(x => x.to).join(' | ');
      const sit = g.situations.map(x => x.text).join(' ');
      const ex = new Set(profile.exclusions);
      ok(g.free.length >= 2 && g.moderate.length >= 1 && g.swaps.length >= 5 && g.situations.length >= 4, `${prof.id}: нивата не са празни`);
      if (policy.noSweets) ok(!/шоколад|десерт|сладкиш|сладолед|газирана|сок/i.test(occ), `${prof.id}: сладко като „по избор“ при noSweets — ${occ}`);
      if (ex.has('GLU')) ok(!/хляб, баница|пица/i.test(occ) && !/пълнозърнест или ръжен/.test(sw), `${prof.id}: глутен в „по избор“ или в замените`);
      if (ex.has('LAC') || policy.pattern === 'vegan') ok(!/сладолед/i.test(occ) && !/кисело мляко/i.test(sw), `${prof.id}: млечно при LAC/веган`);
      if (policy.pattern !== 'omnivore') ok(!/колбас/i.test(occ) && !/пилешко/i.test(sw), `${prof.id}: месо при ${policy.pattern}`);
      if (['GOUT', 'NAFLD', 'PP'].some(c => profile.clinical.includes(c))) ok(!/алкохол/i.test(occ), `${prof.id}: алкохол при ${profile.clinical}`);
      if (policy.style === 'keto') ok(!/плод|нахут|хляб/i.test(sw) && !/чипс|хляб|десерт/i.test(occ), `${prof.id}: въглехидрати в кето — ${sw}`);
      if (!policy.allowsFreeMeal) ok(!/свободното хранене/.test(occ + ' ' + g.occasional.map(o => o.when).join(' ') + ' ' + sit), `${prof.id}: свободно хранене без такова в плана`);
      for (const code of profile.exclusions) ok(g.strict.length > 0, `${prof.id}: изключение ${code} без строго „не“`);
      const all = [...g.free, ...g.moderate.flatMap(m => [m.food, m.amount, m.example || '']), ...g.occasional.flatMap(o => [o.food, o.portion, o.frequency, o.when]),
        ...g.strict.flatMap(x => [x.food, x.reason]), ...g.swaps.flatMap(x => [x.from, x.to]), ...g.situations.flatMap(x => [x.title, x.text])];
      const bad = all.filter(t => textIssues(String(t)).length);
      ok(!bad.length, `${prof.id}: текст в ръководството — ${bad.slice(0, 2).join(' / ')}`);
    }
  }
  const issues = [
    ...validateDietetic(wrapped, data), ...validateProfileRules(wrapped, data),
    ...validateWeekPlanNutrition(weekPlan, strategy), ...validateWeekPlanFoods(weekPlan),
    ...validateWeekPlanCombinations(weekPlan), ...validateWeekPlanDayCoherence(weekPlan),
    ...(validateWeeklyDishVariety(weekPlan).issues || []),
  ].filter(i => !(userSkipsBreakfast(data) && /Хранене 1 при „Не закусвам“/.test(i)) && !/ready_meal в description|различни основни ястия|≠ схема/.test(i));
  if (process.env.SHOW_ISSUES) for (const i of issues) console.log(`  ${prof.id}: ${i}`);
  validatorIssues += issues.length;
  // Клиентът може да смени всяко хранене с алтернатива: планът с първите (и с последните)
  // алтернативи минава същите правила — диета, клинични, съчетания, денят като цяло.
  for (const pickAlt of [alts => alts[0], alts => alts[alts.length - 1]]) {
    const swapped = Object.fromEntries(Object.entries(weekPlan).map(([k, d]) => [k, { ...d, meals: d.meals.map(m => (m.alternatives?.length ? pickAlt(m.alternatives) : m)) }]));
    const sw = { analysis, strategy, weekPlan: swapped };
    const swIssues = [
      ...validateDietetic(sw, data), ...validateProfileRules(sw, data),
      ...validateWeekPlanFoods(swapped), ...validateWeekPlanCombinations(swapped), ...validateWeekPlanDayCoherence(swapped),
    ].filter(i => !(userSkipsBreakfast(data) && /Хранене 1 при „Не закусвам“/.test(i)) && !/ready_meal в description|различни основни ястия|≠ схема/.test(i))
      .filter(i => !issues.includes(i));
    if (process.env.SHOW_ISSUES) for (const i of swIssues) console.log(`  ${prof.id} (алтернативи): ${i}`);
    alternativeIssues += swIssues.length;
  }
  const kDev = dev.k / dev.n;
  ok(kDev < (profile.diet.style === 'keto' ? 0.12 : 0.12), `${prof.id}: калории ±${(kDev * 100).toFixed(1)}%`);
  total.k += kDev; total.p += dev.p / dev.n; total.c += dev.c / dev.n; total.f += dev.f / dev.n; total.n++;
  if (process.env.DEV) console.log(prof.id, (kDev * 100).toFixed(1), ((dev.p / dev.n) * 100).toFixed(1));

  // Описанието е източникът: преизчисляването не мести стойностите.
  const before = JSON.stringify(Object.values(weekPlan).map(d => d.dailyTotals));
  reconcileEnginePlan({ weekPlan, strategy: { weeklyScheme: {} } });
  const after = Object.values(weekPlan).map(d => d.dailyTotals);
  ok(after.every((t, i) => Math.abs(t.calories - JSON.parse(before)[i].calories) <= 15), `${prof.id}: преизчисляването пази деня`);
}
const avg = k => total[k] / total.n;
console.log(`Средно: kcal ${(avg('k') * 100).toFixed(1)}%  P ${(avg('p') * 100).toFixed(1)}%  C ${(avg('c') * 100).toFixed(1)}%  F ${(avg('f') * 100).toFixed(1)}%  (${profiles.length} профила, ${Date.now() - started} ms)`);
ok(total.n === profiles.length, 'всички профили дават план');
ok(validatorIssues <= 10, `забележки от валидаторите (без отклонение на малки хранения): ${validatorIssues}`);
ok(alternativeIssues === 0, `алтернативите минават същите правила (нови забележки: ${alternativeIssues})`);
ok(avg('k') < 0.06 && avg('p') < 0.05 && avg('c') < 0.12 && avg('f') < 0.06, 'средното отклонение е в праговете');

// 2. Изменения от чата/прегледа и избор на храни.
{
  const base = structuredClone(PROFILES[0]);
  const veg = buildNutritionPlan({ ...base, planModifications: ['vegetarian', '3_meals_per_day'] }, { kcal: 1800, seed: 1 });
  ok(veg.profile.diet.pattern === 'vegetarian' && veg.prescription.slots.length >= 3, 'изменение: вегетарианско, 3 хранения');
  const meat = Object.values(veg.weekPlan).flatMap(d => d.meals).some(m => /Пилешк|Свинск|Говежд|Кайма|Риба|Сьомга/.test(m.description || ''));
  ok(!meat, 'вегетарианският план е без месо и риба');
  const picked = buildNutritionPlan({ ...base, userFoodList: ['Пилешки гърди', 'Ориз', 'Броколи', 'Ябълка'] }, { kcal: 1800, seed: 1 });
  // Където списъкът стига, зърнените са само ориз; храненията, които не се
  // сглобяват от него (закуска без хляб), минават на целия каталог.
  const starches = Object.values(picked.weekPlan).flatMap(d => d.meals)
    .filter(m => m.type === 'Хранене 2' || m.type === 'Хранене 4')
    .flatMap(m => (m.description || '').split('\n'))
    .map(l => l.match(LINE)?.[1]).filter(n => n && foodByCatalogName(n)?.group === 'STA');
  const rice = starches.filter(n => /^Ориз/.test(n)).length;
  ok(rice >= starches.length * 0.5, `избраните храни водят основните хранения: ${rice}/${starches.length} ориз`);
  const a = JSON.stringify(buildNutritionPlan(base, { kcal: 1800, seed: 'x' }).weekPlan);
  const b = JSON.stringify(buildNutritionPlan(base, { kcal: 1800, seed: 'x' }).weekPlan);
  ok(a === b, 'детерминизъм: едни и същи данни — един и същ план');
}

// 3. Седмичният преглед.
{
  const base = { goal: 'LOSS', kcal: 1800, tdee: 2300, floorKcal: 1725, weightKg: 80, baseKcal: 1800 };
  const ans = (w, a = 'Почти всички') => [{ questionId: 'weight', value: w }, { questionId: 'adherence', value: a }];
  const flat1 = decideWeeklyAdjustment({ ...base, checkin: readCheckin(ans('Без промяна'), null), history: [] });
  ok(flat1.calorieAdjust === 0, 'една седмица без промяна — калориите остават');
  const flat2 = decideWeeklyAdjustment({ ...base, checkin: readCheckin(ans('Без промяна'), null), history: [{ weight: 'flat' }] });
  ok(flat2.calorieAdjust === -75, `две поредни — към безопасния минимум (${flat2.calorieAdjust})`);
  const over = decideWeeklyAdjustment({ ...base, checkin: readCheckin([...ans('Без промяна'), { questionId: 'intakeKcal', value: '2150' }], null), history: [{ weight: 'flat' }] });
  ok(over.calorieAdjust === 0 && /тракера/.test(over.reasoning), 'застой при прием над плана по тракер — калориите не се режат');
  const near = decideWeeklyAdjustment({ ...base, checkin: readCheckin([...ans('Без промяна'), { questionId: 'intakeKcal', value: '1850' }], null), history: [{ weight: 'flat' }] });
  ok(near.calorieAdjust === flat2.calorieAdjust, 'прием близо до плана — обичайното правило');
  const fast = decideWeeklyAdjustment({ ...base, checkin: readCheckin(ans('Отслабнах повече от 1 кг'), null), history: [{ weight: 'loss', followed: true }] });
  ok(fast.calorieAdjust === 150, 'твърде бързо (от втората седмица) — +150 kcal');
  const fastFirst = decideWeeklyAdjustment({ ...base, checkin: readCheckin(ans('Отслабнах повече от 1 кг'), null), history: [] });
  ok(fastFirst.calorieAdjust === 0 && /вода и гликоген/.test(fastFirst.reasoning), 'първата седмица бързото сваляне е вода — калориите остават');
  const low = decideWeeklyAdjustment({ ...base, checkin: readCheckin(ans('Без промяна', 'Малко'), null), history: [{ weight: 'flat' }] });
  ok(low.calorieAdjust === 0 && low.modifications.includes('simplify_meals'), 'ниско придържане — по-прост план, не по-малко калории');

  // Измерено тегло: темпото спрямо очакваното и теглото, не субективен отговор.
  const kgAns = (kg, adh = 'Почти всички', extra = []) => [{ questionId: 'weightKg', value: String(kg) }, { questionId: 'adherence', value: adh }, ...extra];
  const m1 = readCheckin(kgAns(89.0), null, { prevWeightKg: 90, daysSincePrev: 7 });
  ok(m1.weeklyChangeKg === -1 && m1.weightKg === 89, 'измерване: промяна за седмица от двете претегляния');
  const lossBase = { goal: 'LOSS', kcal: 1800, tdee: 2300, floorKcal: 1500, weightKg: 90, baseKcal: 1800 };
  const fast90 = decideWeeklyAdjustment({ ...lossBase, checkin: readCheckin(kgAns(88.8), null, { prevWeightKg: 90, daysSincePrev: 7 }), history: [{ weight: 'loss', followed: true }] });
  ok(fast90.calorieAdjust === 150 && fast90.weight === 'fast_loss', 'измерване: над 1% седмично — забавяне (+150)');
  const veryFastFirst = decideWeeklyAdjustment({ ...lossBase, checkin: readCheckin(kgAns(87.0), null, { prevWeightKg: 90, daysSincePrev: 7 }), history: [] });
  ok(veryFastFirst.calorieAdjust === 150, 'първата седмица над 3% от теглото — забавяне и тогава');
  const waterFirst = decideWeeklyAdjustment({ ...lossBase, checkin: readCheckin(kgAns(88.2), null, { prevWeightKg: 90, daysSincePrev: 7 }), history: [] });
  ok(waterFirst.calorieAdjust === 0, 'първата седмица −1,8 кг при 90 кг (вода) — без промяна');
  // Талията: застой на кантара с по-малка талия не е застой.
  const waistAns = (kg, cm) => [...kgAns(kg), { questionId: 'waistCm', value: String(cm) }];
  const recomp = decideWeeklyAdjustment({ ...lossBase, checkin: readCheckin(waistAns(90, 86.5), null, { prevWeightKg: 90, daysSincePrev: 7, prevWaistCm: 88 }), history: [{ weight: 'flat', followed: true }] });
  ok(recomp.calorieAdjust === 0 && recomp.weight === 'recomp' && /талията/.test(recomp.reasoning), 'кантарът стои, талията −1,5 см — без рязане');
  const noWaist = decideWeeklyAdjustment({ ...lossBase, checkin: readCheckin(waistAns(90, 88), null, { prevWeightKg: 90, daysSincePrev: 7, prevWaistCm: 88 }), history: [{ weight: 'flat', followed: true }] });
  ok(noWaist.calorieAdjust < 0, 'кантарът и талията стоят две седмици — леко намаление');
  // Въпросите според клиента.
  const qGain = weeklyQuestionsFor({ goal: 'GAIN' }).find(q => q.id === 'weight');
  ok(qGain.options[0].startsWith('Качих'), 'мускулна маса — въпросът за теглото е в посоката на целта');
  ok(readCheckin([{ questionId: 'weight', value: 'Качих повече от 0,5 кг' }], null).weight === 'fast_gain', 'отговорът „качих над 0,5 кг“ се разбира');
  const qDev = weeklyQuestionsFor({ deviceWeightKg: 71.84, mealAdherence: 86, mealDays: 5 });
  ok(qDev.find(q => q.id === 'weightKg').prefill === '71.8' && /везната/.test(qDev.find(q => q.id === 'weightKg').hint), 'теглото от везната е попълнено');
  ok(/86%/.test(qDev.find(q => q.id === 'adherence').hint), 'спазването по отметките е подсказка');
  ok(!weeklyQuestionsFor({ mealAdherence: 86, mealDays: 2 }).find(q => q.id === 'adherence').hint, 'под 3 дни отметки — без подсказка');
  const longGap = readCheckin(kgAns(85), null, { prevWeightKg: 88, daysSincePrev: 35 });
  ok(longGap.weeklyChangeKg === -0.6, `5 седмици без претегляне — темпо по реалните дни (${longGap.weeklyChangeKg})`);
  ok(readCheckin(kgAns(89.3), null, { prevWeightKg: 90, daysSincePrev: 2 }).weeklyChangeKg === null, 'претегляне след 2 дни — без темпо');
  const big = decideWeeklyAdjustment({ ...lossBase, weightKg: 130, checkin: readCheckin(kgAns(128.9), null, { prevWeightKg: 130, daysSincePrev: 7 }) });
  ok(big.calorieAdjust === 0 && big.weight === 'loss', 'измерване: 1.1 кг при 130 кг е под 1% — нормален темп');
  const slowW = readCheckin(kgAns(89.9), null, { prevWeightKg: 90, daysSincePrev: 7 });
  const slow1 = decideWeeklyAdjustment({ ...lossBase, checkin: slowW, history: [] });
  const slow2 = decideWeeklyAdjustment({ ...lossBase, checkin: slowW, history: [{ weight: 'flat', followed: true }] });
  ok(slow1.calorieAdjust === 0 && slow2.calorieAdjust === -100, 'измерване: застой — корекция едва на втората седмица');
  const notFollowed = decideWeeklyAdjustment({ ...lossBase, checkin: slowW, history: [{ weight: 'flat', followed: false }] });
  ok(notFollowed.calorieAdjust === 0, 'история: неспазена седмица не се брои за застой');
  const partial = decideWeeklyAdjustment({ ...lossBase, checkin: readCheckin(kgAns(90, 'Повечето'), { status: 'active', mealDays: 5, mealAdherence: 50 }, { prevWeightKg: 90 }) });
  ok(partial.calorieAdjust === 0 && /Спазване на плана: около 65%/.test(partial.reasoning), 'частично спазване — без корекция, с обяснение');
  const zeroApp = readCheckin([{ questionId: 'adherence', value: 'Почти всички' }], { status: 'active', mealDays: 4, mealAdherence: 0 });
  ok(zeroApp.adherence === 48, 'спазване: 0% от приложението се отчита (не се губи като null)');
  const gainBase = { goal: 'GAIN', kcal: 2800, tdee: 2550, floorKcal: 1500, weightKg: 75, baseKcal: 2800 };
  const fastGain = decideWeeklyAdjustment({ ...gainBase, checkin: readCheckin(kgAns(75.8), null, { prevWeightKg: 75, daysSincePrev: 7 }) });
  ok(fastGain.calorieAdjust === -100, 'мускулна маса: над 0.5% седмично — излишъкът се намалява');
  const gainFlat1 = decideWeeklyAdjustment({ ...gainBase, checkin: readCheckin(kgAns(75.1), null, { prevWeightKg: 75, daysSincePrev: 7 }) });
  ok(gainFlat1.calorieAdjust === 0, 'мускулна маса: една седмица без покачване — без промяна');
  const lact = decideWeeklyAdjustment({ ...lossBase, goal: 'PP', lactating: true, weightKg: 72, checkin: readCheckin(kgAns(71.3), null, { prevWeightKg: 72, daysSincePrev: 7 }) });
  ok(lact.calorieAdjust === 150, 'кърмене: над 0.5 кг седмично — приемът се увеличава');
  const hungry = decideWeeklyAdjustment({ ...lossBase, checkin: readCheckin(kgAns(90, 'Почти всички', [{ questionId: 'hunger', value: 'Често' }, { questionId: 'energy', value: 'Ниска' }]), null, { prevWeightKg: 90 }), history: [{ weight: 'flat', followed: true }] });
  ok(hungry.calorieAdjust === 0, 'глад и умора — калориите не се режат дори при застой');
  ok(WEEKLY_CHECKIN_QUESTIONS[0].type === 'number' && WEEKLY_CHECKIN_QUESTIONS.find(q => q.id === 'weight').skipIfAnswered === 'weightKg', 'седмичен преглед: първо реално тегло, субективният въпрос — само без него');
}

// 4. AI помощникът: затворен речник, само добавя ограничения, замените ги изпълнява алгоритъмът.
{
  const hints = normalizeIntakeHints({ exclusions: ['GLU', 'ХИМИЯ'], clinical: ['IBS', 'RAK'], behaviors: ['EMO', 'XXX'], style: 'keto', pattern: 'vegan',
    blockedFoods: ['Гъби', 'a'], approach: ['simplify_meals', 'hack'], cautions: ['алергия към лешници'] });
  ok(hints.exclusions.join() === 'GLU' && hints.clinical.join() === 'IBS' && hints.behaviors.join() === 'EMO', 'AI: непознати кодове се отхвърлят');
  ok(hints.approach.join() === 'simplify_meals' && hints.blockedTerms.join() === 'гъби', 'AI: подходът и храните са проверени');
  ok(normalizeIntakeHints('глупост') === null && normalizeFeedbackHints(null) === null, 'AI: невалиден отговор -> нищо');
  const withHints = compileProfile({ ...PROFILES[0], _aiHints: hints });
  ok(withHints.exclusions.includes('GLU') && withHints.clinical.includes('IBS') && withHints.diet.pattern === 'vegan', 'AI: подсказките добавят ограничения в профила');
  const base = compileProfile({ ...PROFILES[0] });
  ok(base.exclusions.every(c => withHints.exclusions.includes(c)) && base.clinical.every(c => withHints.clinical.includes(c)), 'AI: не маха съществуващи ограничения');
  ok(collectFreeText({ name: 'Иван Иванов', dietLove: 'обичам риба и зеленчуци много', note: 'кратко' }).length === 1, 'AI: само свободният текст се подава');
  const plan = buildNutritionPlan({ ...structuredClone(PROFILES[0]), _aiHints: { ...hints, pattern: null, style: null, exclusions: [], clinical: [] } }, { kcal: 1800, seed: 'ai' });
  ok(!Object.values(plan.weekPlan).flatMap(d => d.meals).some(m => /Гъби/.test(m.description || '')), 'AI: избягваната храна не е в плана');
  const swaps = normalizeSwaps({ swaps: [{ day: 1, slot: 2, avoid: ['пиле'] }, { day: 9, slot: 2, avoid: ['риба'] }, { day: 1, slot: 4, avoid: [] }] }, plan.weekPlan);
  ok(swaps.length === 1 && swaps[0].type === 'Хранене 2', 'AI: замените са само за съществуващи хранения');
  const target = swaps[0];
  const avoided = buildNutritionPlan(structuredClone(PROFILES[0]), { kcal: 1800, seed: 'ai', slotAvoid: [{ day: target.day, type: target.type, avoid: ['пилешк', 'пиле'] }] });
  const meal = avoided.weekPlan[`day${target.day}`].meals.find(m => m.type === target.type);
  ok(meal && !/Пилешк/.test(meal.description), `AI: замяната е изпълнена от алгоритъма (${meal?.name})`);
  const brief = profileBrief(compileProfile({ ...PROFILES[0], medicalConditions: ['Диабет'] }));
  ok(/цел:/.test(brief) && /T2D/.test(brief) && /изключвания/.test(brief), 'AI: получава разбрания профил като контекст');
  ok(WEEKLY_CHECKIN_QUESTIONS.some(q => q.type === 'text'), 'седмичен преглед: свободен коментар');
}

// ── Чат и промени по плана: само кодове на двигателя; бройката хранения се заменя ──
{
  const m = mergePlanModifications(['3_meals_per_day', 'стар свободен текст'], ['4_meals_per_day', 'махни сладкото', 'exclude_food:овесени ядки']);
  ok(m.merged.includes('4_meals_per_day') && !m.merged.includes('3_meals_per_day'), 'промени: новият брой хранения заменя стария');
  ok(!m.merged.some(x => /текст|сладкото/.test(x)) && m.rejected.includes('махни сладкото'), 'промени: свободният текст се отхвърля');
  ok(m.merged.includes('exclude_food:овесени ядки'), 'промени: exclude_food се приема');
  const data = structuredClone(PROFILES[0]);
  enrichUserDataEngineContext(data);
  const res = buildNutritionPlan({ ...data, foodCravings: ['Сладко'], eatingHabits: ['Не закусвам'] }, { kcal: 2000, seed: 'chat' });
  const strategy = buildEngineStrategy(res, data, { kcal: 2000, freeDayNumber: res.freeDayNumber });
  const text = serializeWeekPlanClient(res.weekPlan);
  ok(!/\|DR\|/.test(text) && /\|H2\|/.test(text), 'чат: без карта „Напитка“, храненията се виждат');
  ok(!res.policy.sweets || /десерт:/.test(text), 'чат: десертът е в състава на храненето');
  ok(!res.freeDayNumber || /свободно\(бюджет~[1-9]/.test(text), 'чат: свободното хранене е с бюджет');
  const st = serializeStrategyForMealPlan(strategy);
  ok(/sch=/.test(st) && /dessert=[01]/.test(st), 'чат: стратегията носи схемата в порции и десерта');
  ok(!/айран/i.test(strategy.breakfastStrategy) || res.policy.allowed('dairy_kefir'), 'стратегия: напитката е според клиента');
}

// Протоколните отговори с еднозначно клинично значение и статусът при бременност/кърмене.
{
  const pp = (extra) => ({ gender: 'Жена', age: 31, height: 165, weight: 72, goal: 'Отслабване', clinicalProtocol: 'postpartum_lactation', ...extra });
  ok(reproductiveStatus(pp({ postpartumStatus: 'Бременна' })).pregnant, 'бременност: разпозната от протокола след раждане');
  ok(!reproductiveStatus(pp({ postpartumStatus: 'Не кърмя, но наскоро родих (до 1 година)' })).lactating, 'не кърми: без добавка за кърма');
  ok(!reproductiveStatus(pp({ postpartumStatus: 'Кърмя (до 6 месеца след раждане)', breastfeedingFrequency: 'Не кърмя' })).lactating, 'честота „Не кърмя“ печели');
  const excl = reproductiveStatus(pp({ postpartumStatus: 'Кърмя (до 6 месеца след раждане)', breastfeedingFrequency: 'Изцяло на гърда (6+ пъти дневно)' }));
  const mixed = reproductiveStatus(pp({ postpartumStatus: 'Кърмя (до 6 месеца след раждане)', breastfeedingFrequency: 'Смесено хранене' }));
  const late = reproductiveStatus(pp({ postpartumStatus: 'Кърмя (6-12 месеца след раждане)', breastfeedingFrequency: 'Изцяло на гърда (6+ пъти дневно)' }));
  ok(excl.lactationKcal === 330 && mixed.lactationKcal < excl.lactationKcal && late.lactationKcal === 400, 'кърмене: добавката е по IOM и пада при смесено хранене');
  ok(reproductiveStatus(pp({})).lactationKcal === 330, 'кърмене без отговор: по-безопасната страна (0–6 месеца)');
  ok(!reproductiveStatus({ gender: 'Жена', postpartumStatus: 'Бременна' }).pregnant, 'бременност: само в протокола след раждане');

  const ms = compileProfile({ gender: 'Мъж', age: 50, height: 178, weight: 98, goal: 'Отслабване', waistCircumference: '104',
    metabolicSyndrome: ['Повишено кръвно налягане', 'Повишени триглицериди'] });
  ok(ms.clinical.includes('HTN') && ms.clinical.includes('DYSL') && ms.clinical.includes('METS'), 'метаболитен синдром: 3 от 5 критерия (талия + кръвно + триглицериди)');
  const ms2 = compileProfile({ gender: 'Жена', age: 40, height: 165, weight: 70, goal: 'Отслабване', metabolicSyndrome: ['Повишена кръвна захар'] });
  ok(ms2.clinical.includes('IR') && !ms2.clinical.includes('METS'), 'един критерий: само съответното състояние, без синдром');
  const gerd = compileProfile({ gender: 'Жена', age: 40, height: 165, weight: 70, goal: 'Отслабване', clinicalProtocol: 'gi_issues', giSymptoms: ['Подуване', 'Киселини/рефлукс'] });
  ok(gerd.clinical.includes('GERD'), 'рефлукс от въпросника за храносмилането → GERD');

  const qa = collectQuestionAnswers({
    dq_slim_diab_1: 'Като внезапен силен глад', dq_slim_diab_2: 'Не', dq_x: 'Да',
    _dq_text_map: { dq_slim_diab_1: 'Как описвате настъпването на глада?', dq_slim_diab_2: 'Сънливост след хранене?' },
    waterRetention: 'Да, често', postpartumGoal: ['Нито едно'],
  }, { waterRetention: 'Задържане на течности', postpartumGoal: 'Цел след раждане' });
  ok(qa.some(a => a.text === 'Как описвате настъпването на глада? → Като внезапен силен глад'), 'динамичен въпрос: стига до AI с текста на въпроса');
  ok(!qa.some(a => a.field === 'dq_slim_diab_2') && !qa.some(a => a.field === 'postpartumGoal'), 'отрицателните отговори не се пращат');
  ok(!qa.some(a => a.field === 'dq_x'), 'отговор без текст на въпроса не се праща');
  ok(qa.some(a => a.text.startsWith('Задържане на течности → Да, често')), 'протоколен въпрос: стига до AI с етикета');
  ok(/EVE \(храни се предимно вечер\)/.test(describeCodes(['EVE'])), 'кодовете за AI са с описание');
}

// Пазачът на AI текстовете към клиента.
{
  const bad = {
    ai_self: 'Като езиков модел не мога да преценя това.',
    placeholder: 'Здравейте, {name}! Ето вашия план.',
    cure_claim: 'Тази диета ще излекува диабета ви напълно.',
    stop_meds: 'Спрете метформина, щом започнете плана.',
    shaming: 'Не бъдете мързелива, а следвайте плана.',
    markup: '```json {"a":1}```',
    imitation: 'Планът е съставен така, както го съставя диетолог.',
    jargon: 'Калоражът е разпределен равномерно през деня.',
  };
  ok(!textIssues('Вашият диетолог ще прегледа седмицата с Вас.').length, 'пазач: „диетолог“ без сравнение е позволено');
  for (const [code, text] of Object.entries(bad)) ok(textIssues(text).includes(code), `пазач: разпознава ${code}`);
  ok(textIssues('This plan is designed to help you lose weight safely and fast.').includes('english'), 'пазач: английски текст');
  const good = 'Започнете деня с белтъчна закуска. Пийте вода между храненията — така гладът е по-малък.';
  ok(isCleanClientText(good), 'пазач: нормален текст минава');
  ok(isCleanClientText('Овесени ядки с кисело мляко и боровинки (kcal се смятат от плана).'), 'пазач: отделна латинска дума не е проблем');
  const mixed = guardClientText('Добър въпрос! Като AI нямам тяло. Опитайте печена риба с броколи.');
  ok(mixed.text === 'Добър въпрос! Опитайте печена риба с броколи.' && mixed.removed.includes('ai_self'), 'пазач: маха само лошото изречение');
  ok(guardClientText('Като езиков модел не мога.').text.length > 10, 'пазач: празен отговор → резервен текст');
}

// Соевото мляко е само за вегани (решение на собственика).
{
  const base = { gender: 'Жена', age: 35, height: 165, weight: 65, goal: 'Поддържане' };
  const veganPolicy = buildFoodPolicy(compileProfile({ ...base, dietPreference: ['Веган'] }), {});
  const omniPolicy = buildFoodPolicy(compileProfile(base), {});
  const vegetarianPolicy = buildFoodPolicy(compileProfile({ ...base, dietPreference: ['Вегетарианска'] }), {});
  const lactoseFreePolicy = buildFoodPolicy(compileProfile({ ...base, dietPreference: ['Без млечни'] }), {});
  ok(veganPolicy.allowed('dairy_soy_milk'), 'соево мляко: позволено при веганско хранене');
  ok(!omniPolicy.allowed('dairy_soy_milk') && !vegetarianPolicy.allowed('dairy_soy_milk') && !lactoseFreePolicy.allowed('dairy_soy_milk'),
    'соево мляко: не се предлага на невегани');
  ok(foodByCatalogName('Соево мляко')?.id === 'dairy_soy_milk' && foodByCatalogName('Соева напитка')?.id === 'dairy_soy_milk',
    'соево мляко: старото име в съществуващи планове се разпознава');
}

// Несъществуващи съчетания: изварата върви с горски плодове, не с праскова или ябълка.
{
  for (const id of ['b_cottage_bowl', 's_cottage_fruit']) {
    const fruits = DISHES_BY_ID.get(id)?.parts.find(p => p.group === 'FRU')?.options.flat() || [];
    ok(fruits.length && fruits.every(f => ['fruit_strawberry', 'fruit_raspberry', 'fruit_blueberry'].includes(f)),
      `${id}: изварата е само с горски плодове (${fruits.join(', ')})`);
  }
  ok(!DISHES_BY_ID.get('b_chickpea_breakfast')?.meals.includes('breakfast'), 'нахут с домати не е закуска');
}

// Рецептите: всяко ястие има рецепта, която минава проверката (без грамове,
// без продукти извън ястието, без незапълнени места).
{
  const bad = validateRecipes(RECIPES);
  ok(!Object.keys(bad).length, `рецепти: всички минават проверката (${Object.entries(bad).slice(0, 3).map(([id, i]) => `${id}: ${i[0]}`).join('; ')})`);
  ok(DISHES.every(d => RECIPES[d.id]), 'рецепти: всяко ястие има рецепта');
  // Незадължителна част липсва → стъпката ѝ отпада; няколко продукта → без „… и … и …“.
  const r = renderRecipe('m_chicken_skewers', { PRO: ['пилешко филе'], VEG: ['чушки', 'тиквички'], STA: ['киноа'], FAT: ['зехтин'] });
  ok(r && !r.steps.some(s => /\{|\}/.test(s)), 'рецепта: всички места са попълнени');
  ok(r && r.steps[0].includes('пилешко филе, чушки и тиквички'), `рецепта: няколко продукта със запетая, без „… и … и …“ (${r?.steps[0]})`);
  ok(r && !r.steps.some(s => /изпечете киноа/i.test(s)), 'рецепта: киноата се вари, не се пече');
  ok(renderRecipe('няма_такова', {}) === null, 'рецепта: непознато ястие → без рецепта (остава краткото приготвяне)');
}

// Съчетания: правилата от pairings.json се спазват; същата храна не влиза два пъти като добавка.
{
  ok(!hasAvoidedPair(['dairy_cottage', 'fruit_strawberry']), 'съчетания: извара с ягоди е позволена');
  for (const [a, set] of AVOID_PAIRS) for (const b of set) ok(hasAvoidedPair([a, b]), `съчетания: ${a} + ${b} се отхвърля`);
}

// Сглобените планове: рецепта по стъпки, без остатъци и без забранени двойки.
{
  const base = { gender: 'Жена', age: 35, height: 165, weight: 70, goal: 'Отслабване' };
  const variants = [{}, { dietPreference: ['Кетогенна'] }, { dietPreference: ['Веган'] }, { dietPreference: ['Вегетарианска'] }];
  let meals = 0; let withSteps = 0; const problems = [];
  for (const [i, extra] of variants.entries()) {
    const data = { ...base, ...extra };
    enrichUserDataEngineContext(data);
    const { weekPlan } = buildNutritionPlan(data, { kcal: 1700, seed: 7 + i });
    for (const day of Object.values(weekPlan)) for (const m of day.meals || []) {
      if (!m.dishId) continue;
      meals++;
      if (m.recipeSteps?.length) withSteps++;
      const text = (m.recipeSteps || []).join(' ') + ' ' + (m.recipeTip || '');
      if (/\{|\}|undefined|null|NaN/.test(text)) problems.push(`${m.name}: остатък в рецептата`);
      if (/(^|\s)с\s[сзСЗ]/.test(text)) problems.push(`${m.name}: „с“ вместо „със“`);
      if (/(^|\s)(и|с)\s+\2\s/.test(`${m.name} ${text}`)) problems.push(`${m.name}: повторен предлог`);
    }
  }
  ok(meals > 0 && withSteps === meals, `планове: всяко ястие е с рецепта по стъпки (${withSteps}/${meals})`);
  ok(!problems.length, `планове: рецептите са чисти (${problems.slice(0, 3).join('; ')})`);
}

// Алтернативи и учене от изборите.
{
  const data = { gender: 'Жена', age: 35, height: 165, weight: 70, goal: 'Отслабване' };
  enrichUserDataEngineContext(data);
  const res = buildNutritionPlan(data, { kcal: 1700, seed: 11 });
  const meals = Object.values(res.weekPlan).flatMap(d => d.meals).filter(m => m.dishId);
  const withAlt = meals.filter(m => m.alternatives?.length);
  ok(withAlt.length >= meals.length * 0.6, `алтернативи: поне 60% от храненията имат избор (${withAlt.length}/${meals.length})`);
  ok(withAlt.every(m => m.alternatives.length <= 5 && m.alternatives.every(a => a.dishId !== m.dishId && !a.alternatives && a.recipeSteps?.length)),
    'алтернативи: до 5, друго ястие, с рецепта, без вложени');
  for (const [k, d] of Object.entries(res.weekPlan)) {
    const ids = d.meals.flatMap(m => [m.dishId, ...(m.alternatives || []).map(a => a.dishId)]).filter(Boolean);
    ok(new Set(ids).size === ids.length, `алтернативи: ястие веднъж в деня, и сред вариантите (${k})`);
  }
  // Алтернативите не променят самия план.
  const again = buildNutritionPlan(data, { kcal: 1700, seed: 11 });
  const names = r => JSON.stringify(Object.values(r.weekPlan).flatMap(d => d.meals.map(m => m.name)));
  ok(names(again) === names(res), 'алтернативи: планът е същият при същото семе');

  // Учене: избраното — плюс, смененото — минус; старото избледнява; таван ±3.
  const swaps = [{ from: 'b_cottage_sandwich', to: 'b_kefir_oats' }, { from: 'b_cottage_sandwich', to: 'b_kefir_oats' }];
  const p1 = learnDishPreference({}, swaps);
  ok(p1.b_kefir_oats === 2 && p1.b_cottage_sandwich === -2, `учене: избор и отказ (${JSON.stringify(p1)})`);
  ok(learnDishPreference(p1, []).b_kefir_oats === 1.4, 'учене: без нови избори предпочитанието избледнява');
  ok(learnDishPreference(p1, [], () => true, 1).b_kefir_oats === 2, 'учене: промяна от чата в същата седмица не избледнява');
  ok(learnDishPreference({ x: 10 }, []).x === 3, 'учене: таван ±3');
  ok(!('ghost' in learnDishPreference({}, [{ from: 'ghost', to: 'ghost2' }], id => !id.startsWith('ghost'))), 'учене: само познати ястия');
  const swapped = structuredClone(res.weekPlan);
  const m0 = swapped.day1.meals.find(m => m.alternatives?.length);
  m0._originalDishId = m0.dishId; m0.dishId = m0.alternatives[0].dishId;
  ok(mealSwapsOf(swapped).length === 1, 'учене: смените се четат от плана');
  // Силно нежелано ястие се среща по-рядко (сбор от няколко седмици), без да се нарушат правилата.
  const usesOf = (id, pref) => [11, 12, 13, 14, 15].reduce((n, seed) => n + Object.values(buildNutritionPlan(data, { kcal: 1700, seed, dishPreference: pref }).weekPlan)
    .flatMap(d => d.meals).filter(m => m.dishId === id).length, 0);
  const mains = meals.filter(m => m.type === 'Хранене 2' || m.type === 'Хранене 4').map(m => m.dishId);
  // Ястие от категория с избор — иначе седмичната рамка по категории законно го запазва.
  const roomy = id => DISHES.filter(d => d.category === DISHES_BY_ID.get(id)?.category && d.meals.includes('main')).length >= 4;
  const top = mains.filter(roomy).sort((a, b) => mains.filter(x => x === b).length - mains.filter(x => x === a).length)[0];
  const before = usesOf(top, {});
  const after = usesOf(top, { [top]: -3 });
  ok(after < before, `учене: отказаното ястие (${top}) се среща по-рядко (${before} → ${after})`);
}

// Смяната в приложението (meal-swaps.js): размяна, памет, връщане.
{
  const store = new Map();
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  await import('../meal-swaps.js');
  const S = globalThis.NutriMealSwaps;
  const data = { gender: 'Мъж', age: 40, height: 180, weight: 85, goal: 'Отслабване' };
  enrichUserDataEngineContext(data);
  const build = seed => ({ weekPlan: buildNutritionPlan(data, { kcal: 2100, seed }).weekPlan });
  const plan = build(4);
  const idx = plan.weekPlan.day2.meals.findIndex(m => m.alternatives?.length);
  const orig = plan.weekPlan.day2.meals[idx];
  const target = orig.alternatives[0].dishId;
  const kcalBefore = plan.weekPlan.day2.dailyTotals.calories;
  ok(S.choose(plan, 'day2', idx, target), 'смяна: изборът минава');
  const now = plan.weekPlan.day2.meals[idx];
  ok(now.dishId === target && now._originalDishId === orig.dishId && now.alternatives.some(a => a.dishId === orig.dishId), 'смяна: първоначалното остава сред вариантите');
  ok(plan.weekPlan.day2.dailyTotals.calories === Math.round(kcalBefore + now.calories - orig.calories), 'смяна: дневният сбор следва избора');
  // Схемата на деня следва смяната — сървърната проверка „калории ≠ цел“ не я отчита като грешка.
  {
    const data2 = { gender: 'Мъж', age: 40, height: 180, weight: 85, goal: 'Отслабване' };
    enrichUserDataEngineContext(data2);
    const eng = buildNutritionPlan(data2, { kcal: 2100, seed: 4 });
    const full = { weekPlan: eng.weekPlan, strategy: buildEngineStrategy(eng, data2, { kcal: 2100, freeDayNumber: eng.freeDayNumber }) };
    const i2 = full.weekPlan.day2.meals.findIndex(m => m.alternatives?.length);
    const m2 = full.weekPlan.day2.meals[i2];
    S.choose(full, 'day2', i2, m2.alternatives[0].dishId);
    const chosen = full.weekPlan.day2.meals[i2];
    const slot = full.strategy.weeklyScheme.tuesday.mealBreakdown.find(b => b.type === chosen.type);
    ok(slot.calories === chosen.calories && full.strategy.weeklyScheme.tuesday.calories === full.weekPlan.day2.dailyTotals.calories, 'смяна: схемата на деня следва избраното хранене');
  }
  const fresh = build(4);
  S.apply(fresh);
  ok(fresh.weekPlan.day2.meals[idx].dishId === target, 'смяна: изборът се прилага върху нов екземпляр на плана');
  ok(S.choose(fresh, 'day2', idx, orig.dishId) && !fresh.weekPlan.day2.meals[idx]._originalDishId && !JSON.parse(store.get('mealSwaps'))[`day2:${idx}`], 'смяна: връщане към плана изтрива избора');
  S.choose(fresh, 'day2', idx, target);
  const other = build(99);
  const otherMeal = other.weekPlan.day2.meals[idx];
  S.apply(other);
  ok(otherMeal.dishId === orig.dishId ? other.weekPlan.day2.meals[idx].dishId === target : !other.weekPlan.day2.meals[idx]._originalDishId, 'смяна: изборът не се прилага към друг план');
}

// Универсални храни за България: без гръцко кисело мляко и едамаме; соев йогурт само за вегани; без карта „Напитка“.
{
  const texts = [];
  for (const prof of [...HARD_PROFILES, ...PROFILES]) {
    const data = structuredClone(prof);
    enrichUserDataEngineContext(data);
    let res; try { res = buildNutritionPlan(data, { kcal: 1900, seed: prof.id }); } catch { continue; }
    for (const m of Object.values(res.weekPlan).flatMap(d => d.meals)) {
      texts.push(`${m.type}|${m.name}|${m.description || ''}`);
      for (const a of m.alternatives || []) texts.push(`${a.name}|${a.description || ''}`);
    }
    const strategy = buildEngineStrategy(res, data, { kcal: 1900, freeDayNumber: res.freeDayNumber });
    texts.push(strategy.welcomeMessage, strategy.planJustification, strategy.breakfastStrategy);
  }
  const all = texts.join('\n');
  ok(!/гръцко/i.test(all), 'храни: без гръцко кисело мляко');
  ok(!/едамаме/i.test(all), 'храни: без едамаме');
  ok(!/соево кисело/i.test(all), 'храни: „соев йогурт“, не „соево кисело“');
  ok(!/^Напитка\|/m.test(all), 'план: без карта „Напитка“');
  ok(!/калораж|както (го|я) съставя|диетолог/i.test(texts.filter(t => !t.includes('|')).join(' ')), 'стратегия: без „калораж“ и без сравнения с диетолог');
  ok(!foodByCatalogName('Соево кисело') || foodByCatalogName('Соево кисело').id === 'dairy_soy_yogurt', 'храни: старото име „Соево кисело“ се разпознава в стари планове');
}

console.log(`\n=== nutrition engine: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
