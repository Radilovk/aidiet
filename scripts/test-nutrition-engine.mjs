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
import { buildNutritionPlan, reconcileEnginePlan } from '../nutrition-engine/index.js';
import { buildFoodPolicy } from '../nutrition-engine/policy.js';
import { prescribe } from '../nutrition-engine/prescription.js';
import { foodByCatalogName, DISHES_BY_ID } from '../nutrition-engine/knowledge.js';
import { KITCHEN_GRID } from '../nutrition-engine/portions.js';
import { buildEngineStrategy } from '../nutrition-engine/strategy.js';
import { buildDeterministicAnalysis } from '../analysis-deterministic.js';
import { validateDietetic } from './plan-adequacy/validators/dietetic.mjs';
import { validateProfileRules, userSkipsBreakfast } from './plan-adequacy/validators/profile-rules.mjs';
import { validateWeekPlanNutrition } from './plan-adequacy/validators/nutrition.mjs';
import { validateWeekPlanFoods } from './plan-adequacy/validators/foods.mjs';
import { validateWeekPlanCombinations } from './plan-adequacy/validators/combinations.mjs';
import { validateWeekPlanDayCoherence, validateWeeklyDishVariety } from '../meal-combinations.js';
import { profileBrief, normalizeIntakeHints, normalizeFeedbackHints, normalizeSwaps, collectFreeText } from '../nutrition-engine/ai-assist.js';
import { compileProfile } from '../profile-code.js';
import { WEEKLY_CHECKIN_QUESTIONS, readCheckin, decideWeeklyAdjustment } from '../nutrition-engine/monitoring.js';

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
  return Math.max(min, computeIntakeTarget(tdee, data.goal, calculateSafeDeficit(tdee, data.goal)) || tdee);
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
    dev.k += Math.abs(t.calories - kcal) / kcal;
    dev.p += Math.abs(t.protein - macros.protein) / macros.protein;
    dev.c += Math.abs(t.carbs - macros.carbs) / Math.max(macros.carbs, 20);
    dev.f += Math.abs(t.fats - macros.fats) / macros.fats;
    dev.n++;
  }
  // AIP има малко ястия — там повторението е неизбежно.
  if (profile.protocol !== 'autoimmune_aip') ok([...mainUses.values()].every(n => n <= 2), `${prof.id}: основно ястие повече от 2 пъти седмично`);
  if (profile.diet.pattern === 'omnivore' && profile.diet.style === 'balanced' && !profile.exclusions.includes('FSH')) {
    ok(cats.fish >= 2 && cats.red <= 3, `${prof.id}: риба ${cats.fish}, червено месо ${cats.red} седмично`);
  }
  // Без закуска — предложение за хидратация; свободно хранене в неделя, освен при категорични правила.
  const day1 = weekPlan.day1.meals;
  ok(profile.skipsBreakfast === day1.some(m => m.type === 'Напитка'), `${prof.id}: сутрешна напитка точно при „не закусвам“`);
  ok(Object.values(weekPlan).some(d => d.meals.some(m => m.type === 'Свободно хранене')) === policy.allowsFreeMeal, `${prof.id}: свободно хранене според правилата`);
  // Правилата на валидаторите (един въглехидратен източник, лека закуска, универсални продукти…).
  const analysis = { ...buildDeterministicAnalysis(data), Final_Calories: kcal, macroGrams: { ...macros } };
  const strategy = buildEngineStrategy(res, data, { kcal, freeDayNumber: res.freeDayNumber });
  const wrapped = { analysis, strategy, weekPlan };
  validatorIssues += [
    ...validateDietetic(wrapped, data), ...validateProfileRules(wrapped, data),
    ...validateWeekPlanNutrition(weekPlan, strategy), ...validateWeekPlanFoods(weekPlan),
    ...validateWeekPlanCombinations(weekPlan), ...validateWeekPlanDayCoherence(weekPlan),
    ...(validateWeeklyDishVariety(weekPlan).issues || []),
  ].filter(i => !(userSkipsBreakfast(data) && /Хранене 1 при „Не закусвам“/.test(i)) && !/ready_meal в description|различни основни ястия|≠ схема/.test(i)).length;
  const kDev = dev.k / dev.n;
  ok(kDev < (profile.diet.style === 'keto' ? 0.12 : 0.12), `${prof.id}: калории ±${(kDev * 100).toFixed(1)}%`);
  total.k += kDev; total.p += dev.p / dev.n; total.c += dev.c / dev.n; total.f += dev.f / dev.n; total.n++;

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
  const fast = decideWeeklyAdjustment({ ...base, checkin: readCheckin(ans('Отслабнах повече от 1 кг'), null) });
  ok(fast.calorieAdjust === 150, 'твърде бързо — +150 kcal');
  const low = decideWeeklyAdjustment({ ...base, checkin: readCheckin(ans('Без промяна', 'Малко'), null), history: [{ weight: 'flat' }] });
  ok(low.calorieAdjust === 0 && low.modifications.includes('simplify_meals'), 'ниско придържане — по-прост план, не по-малко калории');
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

console.log(`\n=== nutrition engine: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
