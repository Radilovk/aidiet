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
import { profileBrief, normalizeIntakeHints, normalizeFeedbackHints, normalizeSwaps, collectFreeText, collectQuestionAnswers, describeCodes } from '../nutrition-engine/ai-assist.js';
import { compileProfile, reproductiveStatus } from '../profile-code.js';
import { textIssues, isCleanClientText, guardClientText } from '../nutrition-engine/text-guard.js';
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
  // Напитката е вместо закуска — не и когато закуската е върната заради размера на порциите.
  const noBreakfast = profile.skipsBreakfast && !day1.some(m => m.type === 'Хранене 1');
  ok(noBreakfast === day1.some(m => m.type === 'Напитка'), `${prof.id}: сутрешна напитка точно когато няма закуска`);
  ok(!(day1.some(m => m.type === 'Напитка') && day1.some(m => m.type === 'Хранене 1')), `${prof.id}: напитка и закуска едновременно`);
  ok(Object.values(weekPlan).some(d => d.meals.some(m => m.type === 'Свободно хранене')) === policy.allowsFreeMeal, `${prof.id}: свободно хранене според правилата`);
  // Правилата на валидаторите (един въглехидратен източник, лека закуска, универсални продукти…).
  const analysis = { ...buildDeterministicAnalysis(data), Final_Calories: kcal, macroGrams: { ...macros } };
  const strategy = buildEngineStrategy(res, data, { kcal, freeDayNumber: res.freeDayNumber });
  const wrapped = { analysis, strategy, weekPlan };
  const issues = [
    ...validateDietetic(wrapped, data), ...validateProfileRules(wrapped, data),
    ...validateWeekPlanNutrition(weekPlan, strategy), ...validateWeekPlanFoods(weekPlan),
    ...validateWeekPlanCombinations(weekPlan), ...validateWeekPlanDayCoherence(weekPlan),
    ...(validateWeeklyDishVariety(weekPlan).issues || []),
  ].filter(i => !(userSkipsBreakfast(data) && /Хранене 1 при „Не закусвам“/.test(i)) && !/ready_meal в description|различни основни ястия|≠ схема/.test(i));
  if (process.env.SHOW_ISSUES) for (const i of issues) console.log(`  ${prof.id}: ${i}`);
  validatorIssues += issues.length;
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

  // Измерено тегло: темпото спрямо очакваното и теглото, не субективен отговор.
  const kgAns = (kg, adh = 'Почти всички', extra = []) => [{ questionId: 'weightKg', value: String(kg) }, { questionId: 'adherence', value: adh }, ...extra];
  const m1 = readCheckin(kgAns(89.0), null, { prevWeightKg: 90, daysSincePrev: 7 });
  ok(m1.weeklyChangeKg === -1 && m1.weightKg === 89, 'измерване: промяна за седмица от двете претегляния');
  const lossBase = { goal: 'LOSS', kcal: 1800, tdee: 2300, floorKcal: 1500, weightKg: 90, baseKcal: 1800 };
  const fast90 = decideWeeklyAdjustment({ ...lossBase, checkin: readCheckin(kgAns(88.8), null, { prevWeightKg: 90, daysSincePrev: 7 }) });
  ok(fast90.calorieAdjust === 150 && fast90.weight === 'fast_loss', 'измерване: над 1% седмично — забавяне (+150)');
  const big = decideWeeklyAdjustment({ ...lossBase, weightKg: 130, checkin: readCheckin(kgAns(128.9), null, { prevWeightKg: 130, daysSincePrev: 7 }) });
  ok(big.calorieAdjust === 0 && big.weight === 'loss', 'измерване: 1.1 кг при 130 кг е под 1% — нормален темп');
  const slowW = readCheckin(kgAns(89.9), null, { prevWeightKg: 90, daysSincePrev: 7 });
  const slow1 = decideWeeklyAdjustment({ ...lossBase, checkin: slowW, history: [] });
  const slow2 = decideWeeklyAdjustment({ ...lossBase, checkin: slowW, history: [{ weight: 'flat', followed: true }] });
  ok(slow1.calorieAdjust === 0 && slow2.calorieAdjust === -100, 'измерване: застой — корекция едва на втората седмица');
  const notFollowed = decideWeeklyAdjustment({ ...lossBase, checkin: slowW, history: [{ weight: 'flat', followed: false }] });
  ok(notFollowed.calorieAdjust === 0, 'история: неспазена седмица не се брои за застой');
  const partial = decideWeeklyAdjustment({ ...lossBase, checkin: readCheckin(kgAns(90, 'Повечето'), { status: 'active', mealDays: 5, mealAdherence: 50 }, { prevWeightKg: 90 }) });
  ok(partial.calorieAdjust === 0 && /Придържане около 65%/.test(partial.reasoning), 'частично спазване — без корекция, с обяснение');
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
  ok(WEEKLY_CHECKIN_QUESTIONS[0].type === 'number' && WEEKLY_CHECKIN_QUESTIONS[1].skipIfAnswered === 'weightKg', 'седмичен преглед: първо реално тегло, субективният въпрос — само без него');
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
  ok(/\|DR\|/.test(text), 'чат: сутрешната напитка се вижда като DR');
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
  };
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

console.log(`\n=== nutrition engine: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
