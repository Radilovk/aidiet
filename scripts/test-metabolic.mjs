#!/usr/bin/env node
/**
 * Метаболитната седмица (nutrition-engine/metabolic.js): енергия и въглехидрати
 * по тренировъчни/почивни дни според целта, часовият прозорец с границите му,
 * качеството на менюто. Без мрежа.
 */
import { compileProfile } from '../profile-code.js';
import { macroTargetsFor } from '../macro-targets.js';
import { trainingWeek, fastingPlan, weekTargets, metabolicWeek, menuQuality, postWorkoutLow, describeMetabolicWeek } from '../nutrition-engine/metabolic.js';
import { buildNutritionPlan, applyModifications } from '../nutrition-engine/index.js';
import { buildEngineStrategy } from '../nutrition-engine/strategy.js';
import { fiberPer100, microPer100 } from '../nutrition-engine/fiber.js';
import { microNeeds, microReport } from '../nutrition-engine/micronutrients.js';
import { food } from '../nutrition-engine/knowledge.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const BASE = {
  gender: 'Мъж', age: '34', height: '180', weight: '88', goal: 'Отслабване', lossKg: '8',
  dailyActivityLevel: 'Средно', sportActivity: 'Средна (2–4 дни седмично)',
  sportTypes: ['Силови (фитнес, тежести)'], sportSessionMinutes: '60–90 мин', dietPreference: ['Балансирана'], chronotype: 'Вечерен',
};
const KCAL = 2100;
// Научени тренировъчни дни (вечерния въпрос): пн, ср, пт следобед. Без тях дните са еднакви.
const LEARNED = { _enrichment: { essence: { metrics: { training: { perWeek: 3, usual: [1, 3, 5], slot: 'pm', regularity: 1, kcal: 400 } } } } };
const setup = (over = {}) => {
  const data = { ...BASE, ...LEARNED, ...over };
  const profile = compileProfile(data);
  const m = macroTargetsFor(profile, KCAL);
  const base = { kcal: KCAL, macros: { protein: m.protein, carbs: m.carbs, fats: m.fats } };
  return { data, profile, base, mw: metabolicWeek(profile, data, base, profile.slots) };
};
const sum = (days, f) => days.reduce((s, d) => s + f(d), 0);
const avg = (days, f) => (days.length ? sum(days, f) / days.length : 0);

// ── Тренировъчната седмица ───────────────────────────────────────────────
{
  const { mw, profile } = setup({ _enrichment: undefined });
  ok(mw.week.source === 'assumed' && JSON.stringify(mw.week.days) === '[1,3,5]' && mw.week.confidence === 0.5, 'без научени дни: пн, ср, пт с половин амплитуда');
  ok(mw.week.fuel === 'glycolytic' && mw.week.sessionKcal === Math.round(4 * 88 * 75 / 60), 'силова: гликолитична, (MET − 1) × кг × ч');
  const learned = trainingWeek(profile, { ...BASE, _enrichment: { essence: { metrics: { training: { perWeek: 3, usual: [2, 4, 0], slot: 'pm', regularity: 1, kcal: 350 } } } } });
  ok(JSON.stringify(learned.days) === '[2,4,7]' && learned.source === 'pattern' && learned.confidence === 1, 'научените дни: неделя → ден 7, пълна увереност при редовност 1');
  ok(learned.sessionKcal === 350 && learned.slot === 'pm', 'разходът и часът — от отговорите вечер');
  ok(trainingWeek(compileProfile({ ...BASE, sportActivity: 'Никаква (0 дни седмично)' }), BASE).days.length === 0, 'без спорт: без тренировъчни дни');
}

// ── Енергия и въглехидрати по дни ────────────────────────────────────────
{
  const { mw, base } = setup();
  const days = mw.days;
  const train = days.filter(d => d.kind === 'train');
  const rest = days.filter(d => d.kind === 'rest');
  ok(Math.abs(sum(days, d => d.kcal) - 7 * KCAL) <= 35, `седмичният баланс се пази (${sum(days, d => d.kcal)} от ${7 * KCAL})`);
  ok(days.every(d => d.macros.protein === base.macros.protein), 'белтъкът е еднакъв всеки ден');
  ok(avg(train, d => d.kcal) > avg(rest, d => d.kcal), 'тренировъчният ден е с повече енергия');
  ok(avg(train, d => d.macros.carbs) > avg(rest, d => d.macros.carbs) * 1.15, 'въглехидратите следват тренировката');
  ok(days.every(d => d.macros.fats >= Math.round(88 * 0.7)), 'мазнините не падат под 0,7 г/кг');
  ok(train.every(d => d.bias.STA[d.timing.post] > 1) || train.every(d => !d.timing.post), 'въглехидратите отиват в храненето след тренировката');
}
{
  // Дните само от въпросника (без вечерни отговори) не делят седмицата.
  const { mw } = setup({ _enrichment: undefined });
  ok(mw.week.source === 'assumed' && mw.days.every(d => d.kind !== 'train'), 'предположени дни: без „тренировъчен ден“');
  ok(new Set(mw.days.map(d => d.kcal)).size === 1, 'предположени дни: еднакви калории');
}
{
  // Отслабване при ИТМ ≥ 30: въглехидратите преди тренировката, след нея белтък и зеленчуци.
  const { mw, profile } = setup({ weight: '105' });
  const train = mw.days.filter(d => d.kind === 'train');
  ok(postWorkoutLow(profile, mw.week), 'ИТМ 32 и отслабване: въглехидрати преди тренировката');
  ok(train.length && train.every(d => d.carbsBefore && d.bias.STA[d.timing.pre] > 1 && d.bias.STA[d.timing.post] < 1), 'тренировъчен ден: преди — повече, след — по-малко нишестени');
  const text = describeMetabolicWeek(mw, profile).join(' ');
  ok(/преди тренировката/.test(text) && !/възстановяване на гликогена/.test(text), 'текстът обяснява „преди“, без гликогена');
  const plan = buildNutritionPlan({ ...BASE, ...LEARNED, weight: '105' }, { kcal: KCAL, seed: 1 });
  ok(Object.values(plan.weekPlan).some(d => d.energy.carbsBefore && d.energy.preWorkoutMeal), 'денят в плана носи „въглехидрати преди“');
  ok(!postWorkoutLow(compileProfile({ ...BASE, weight: '105', goal: 'Мускулна маса' }), mw.week), 'покачване: зареждане след тренировката остава');
  ok(!postWorkoutLow(profile, { ...mw.week, fuel: 'endurance', minutes: 100 }), 'над 90 мин издръжливост: зареждане след тренировката остава');
  ok(!postWorkoutLow(compileProfile(BASE), mw.week), 'без наднормено тегло и риск: по старому');
}
{
  // Таванът на въглехидратите в базата при отслабване.
  const share = (over, kcal = KCAL) => { const m = macroTargetsFor(compileProfile({ ...BASE, ...over }), kcal); return m.carbs * 4 / kcal; };
  ok(share({ weight: '105' }) <= 0.351, `ИТМ ≥ 30: до 35% въглехидрати (${Math.round(share({ weight: '105' }) * 100)}%)`);
  ok(share({ weight: '105', medicalConditions: ['Инсулинова резистентност'] }) <= 0.301, 'метаболитен риск: до 30%');
  ok(share({}) > 0.4, 'без наднормено тегло и риск: без таван');
  ok(share({ weight: '105', goal: 'Мускулна маса' }) > 0.36, 'покачване: без таван');
  const m = macroTargetsFor(compileProfile({ ...BASE, weight: '105' }), KCAL);
  ok(Math.abs(m.protein * 4 + m.carbs * 4 + m.fats * 9 - KCAL) <= 10, 'макросите дават калориите на деня');
}
{
  // При цел мускулна маса денят следва тренировката по-силно, отколкото при отслабване.
  const gap = (goal) => {
    const { mw } = setup({ goal });
    const t = mw.days.filter(d => d.kind === 'train');
    const r = mw.days.filter(d => d.kind === 'rest');
    return avg(t, d => d.kcal) - avg(r, d => d.kcal);
  };
  ok(gap('Мускулна маса') > gap('Отслабване'), 'маса: по-голяма разлика тренировка/почивка от отслабване');
}
{
  const { mw } = setup({ dietPreference: ['Кето'] });
  ok(mw.days.every(d => d.macros.carbs <= 30), 'кето: въглехидратите остават в кетогенната граница всеки ден');
}
{
  // Метаболитен риск без тренировки: макросите не се пипат (клиничните са в macro-targets).
  const { mw, base } = setup({ sportActivity: 'Никаква (0 дни седмично)', medicalConditions: ['Инсулинова резистентност'], _enrichment: undefined });
  ok(mw.days.every(d => Math.abs(d.macros.carbs - base.macros.carbs) <= 1), 'без тренировки: въглехидратите на деня са средните');
  ok(mw.days.every(d => d.bias.STA['Хранене 4'] < 1), 'почивен ден при метаболитен риск: вечерята е по-лека на въглехидрати');
}
{
  // Ниско средно: денят не пада под безопасния минимум.
  const data = { ...BASE, gender: 'Жена', weight: '62', height: '165' };
  const profile = compileProfile(data);
  const m = macroTargetsFor(profile, 1350);
  const days = weekTargets(profile, { kcal: 1350, macros: m }, trainingWeek(profile, data), fastingPlan(profile, data, trainingWeek(profile, data)), profile.slots);
  ok(days.every(d => d.kcal >= 1200), `под минимума за жени няма ден (${Math.min(...days.map(d => d.kcal))})`);
}

// ── Часов прозорец (фастинг) ─────────────────────────────────────────────
{
  const { mw } = setup();
  ok(!mw.fasting.active && mw.fasting.offered && mw.fasting.protocol === 'tre16', 'без избор: предложение, 16:8 при мъж');
  ok(mw.days.every(d => d.slots.length === 5), 'без избор: храненията не се пипат');
}
{
  const { mw } = setup({ dietPreference: ['Фастинг'] });
  ok(mw.fasting.active && !mw.fasting.early && /12:00–20:00/.test(mw.fasting.windowText), 'избран фастинг, вечерен хронотип: прозорец 12–20');
  const rest = mw.days.filter(d => d.kind !== 'train');
  ok(rest.every(d => !d.slots.includes('Хранене 1') && !d.slots.includes('Хранене 5')), 'почивен ден: без закуска и късна закуска');
  ok(mw.days.filter(d => d.kind === 'train').every(d => d.slots.length === 5), 'тренировъчен ден: храненето обгражда тренировката');
  const low = mw.days.find(d => d.kind === 'low');
  ok(low && low.day !== 7 && !mw.week.days.includes(low.day + 1), 'по-лекият ден не е неделя и не е преди тренировка');
  ok(low && low.macros.protein === mw.days[0].macros.protein && low.kcal < KCAL * 0.8, 'по-лекият ден: ~75% с пълния белтък');
}
{
  const early = setup({ dietPreference: ['Фастинг'], chronotype: 'Сутрешен', gender: 'Жена', weight: '70', height: '168' });
  ok(early.mw.fasting.early && early.mw.fasting.protocol === 'tre14' && /08:00–18:00/.test(early.mw.fasting.windowText), 'сутрешен хронотип, жена: ранен прозорец 14:10');
  ok(early.mw.days.filter(d => d.kind !== 'train').every(d => d.slots.includes('Хранене 1') && !d.slots.includes('Хранене 5')), 'ранен прозорец: със закуска, без късна закуска');
}
{
  const block = (over, why) => {
    const { mw } = setup({ dietPreference: ['Фастинг'], ...over });
    ok(!mw.fasting.active && mw.fasting.blocked.length, `фастинг спира: ${why}`);
  };
  block({ compensationMethods: ['Гладуване'] }, 'компенсиране с гладуване');
  block({ age: '72' }, 'възраст над 70');
  block({ weight: '55', height: '180' }, 'ИТМ под 18,5');
  // Мускулна маса при слабо тяло и тренировки е покачване (излишък) — прозорецът спира.
  block({ goal: 'Мускулна маса', weight: '72' }, 'покачване на мускулна маса');
  // При ИТМ 27 същата цел е смяна на състава — без излишък, прозорецът е съвместим.
  ok(setup({ goal: 'Мускулна маса', dietPreference: ['Фастинг'] }).mw.fasting.active, 'мускулна маса при ИТМ 27 (смяна на състава): прозорецът е позволен');
  // Антицелулит при нормално тегло не е сваляне — без по-лекия ден.
  ok(!setup({ goal: 'Антицелулитна програма', weight: '72', dietPreference: ['Фастинг'] }).mw.fasting.lowDay, 'антицелулит при нормално тегло: без по-лек ден');
  const t2d = setup({ dietPreference: ['Фастинг'], medicalConditions: ['Диабет'] });
  ok(t2d.mw.fasting.protocol === 'tre12' && !t2d.mw.fasting.lowDay, 'диабет без лекарства: най-много 12:12, без лек ден');
}
{
  const profile = compileProfile(BASE);
  ok(applyModifications(profile, ['time_restricted_eating']).behaviors.includes('IF'), 'промяна „хранене в прозорец“ от чата включва фастинга');
}

// ── План от двигателя ────────────────────────────────────────────────────
{
  const plan = buildNutritionPlan({ ...BASE, ...LEARNED, dietPreference: ['Фастинг'] }, { kcal: KCAL, seed: 1 });
  const days = Object.values(plan.weekPlan);
  ok(days.every(d => d.energy && d.energy.kcal > 0), 'всеки ден носи целта си (energy)');
  const real = days.filter(d => !d.meals.some(m => m.type === 'Свободно хранене'));
  ok(real.every(d => Math.abs(d.dailyTotals.calories - d.energy.kcal) / d.energy.kcal < 0.08), 'менюто на деня уцелва целта на деня (±8%)');
  ok(days.some(d => d.energy.kind === 'rest' && d.energy.window && d.meals.length <= 4), 'почивен ден с прозорец: по-малко хранения');
  const strategy = buildEngineStrategy(plan, BASE, { kcal: KCAL, freeDayNumber: plan.freeDayNumber });
  ok(strategy.metabolicPlan?.principles?.length >= 2 && /16:8|14:10/.test(strategy.keyPrinciples.join(' ')), 'стратегията обяснява седмицата и прозореца');
  ok(/тренировъчните дни ~\d+ г въглехидрати/.test(strategy.macroDistribution), 'макросите — с разликата тренировка/почивка');
  const q = plan.metabolicPlan.quality;
  ok(q.items.some(i => i.code === 'fiber') && q.fiberCoverage >= 90, `фибрите се мерят (покритие ${q.fiberCoverage}%)`);
  ok(q.items.some(i => i.code === 'plants') && q.items.some(i => i.code === 'protein_meal'), 'разнообразие и белтък на хранене');
}

// ── Качество: формулите ──────────────────────────────────────────────────
{
  const profile = compileProfile(BASE);
  const lib = { food, fiberPer100 };
  const q = menuQuality([{ meals: [
    { main: true, protein: 40, foods: [{ id: 'leg_lentils', grams: 200 }, { id: 'veg_broccoli', grams: 200 }, { id: 'pro_salmon', grams: 150 }] },
    { main: true, protein: 10, foods: [{ id: 'eng_rice_white', grams: 200 }] },
  ] }], lib, profile, 2000);
  const fiber = q.items.find(i => i.code === 'fiber');
  ok(fiber && Math.abs(fiber.value - Math.round(7.9 * 2 + 2.6 * 2 + 0.4 * 2)) <= 1, `фибри по USDA (${fiber?.value} г)`);
  ok(q.items.find(i => i.code === 'oily_fish').value === 1, 'мазна риба: сьомгата се брои');
  ok(q.items.find(i => i.code === 'protein_meal').value === 50, 'белтък над прага в 1 от 2 основни хранения');
  ok(fiberPer100('pro_chicken_breast') === 0 && fiberPer100('pro_tempeh') === null, 'месо — 0 фибри; продукт според марката — без стойност');
}

// ── Микронутриенти: само измерване ───────────────────────────────────────
{
  const woman = compileProfile({ ...BASE, gender: 'Жена', age: '30' });
  const older = compileProfile({ ...BASE, gender: 'Жена', age: '60' });
  const vegan = compileProfile({ ...BASE, dietPreference: ['Веган'] });
  ok(microNeeds(woman).fe === 18 && microNeeds(older).fe === 8 && microNeeds(older).ca === 1200, 'желязо и калций по пол и възраст (NASEM)');
  ok(Math.abs(microNeeds(vegan).fe - 8 * 1.8) < 0.01, 'растително хранене: нуждата от желязо ×1,8');
  ok(microPer100('pro_salmon').o3 > 1500 && microPer100('veg_spinach').fe > 2 && microPer100('eng_rice').fe < 0.5, 'стойностите от USDA (сьомга, спанак, необогатен ориз)');
  const rep = microReport([{ meals: [{ foods: [{ id: 'veg_spinach', grams: 200 }, { id: 'dairy_yogurt', grams: 400 }] }] }], microPer100, woman);
  const fe = rep.items.find(i => i.code === 'fe');
  const ca = rep.items.find(i => i.code === 'ca');
  ok(Math.abs(fe.value - Math.round((2.71 * 2 + 0.05 * 4) * 10) / 10) < 0.05 && ca.value === Math.round(99 * 2 + 121 * 4), 'сумата е грамове × стойност на 100 г');
  ok(rep.coverage === 100, 'покритие 100% за храни с данни');

  const vplan = buildNutritionPlan({ ...BASE, dietPreference: ['Веган'] }, { kcal: KCAL, seed: 2 });
  const b12 = vplan.metabolicPlan.micro.items.find(i => i.code === 'b12');
  ok(b12.status === 'low' && /добавка/.test(b12.advice), 'веган: B12 — ниско, съвет за добавка');
  const kplan = buildNutritionPlan({ ...BASE, dietPreference: ['Кето'] }, { kcal: KCAL, seed: 2 });
  ok(kplan.metabolicPlan.micro.items.every(i => !/бобови|картофи|банан|пълнозърнести/.test(i.advice)), 'кето: съветите не предлагат забранени за диетата храни');
  // Измерването не пипа менюто: същият план със и без него.
  const a = buildNutritionPlan(BASE, { kcal: KCAL, seed: 'm' });
  const b = buildNutritionPlan(BASE, { kcal: KCAL, seed: 'm' });
  ok(JSON.stringify(a.weekPlan) === JSON.stringify(b.weekPlan) && a.metabolicPlan.micro.items.length === 6, 'шест показателя, менюто е детерминистично');
}

// ── Микронутриенти: нуждите и безопасността ─────────────────────────────
{
  const woman = compileProfile({ gender: 'Жена', age: '30', height: '165', weight: '62', goal: 'Подобряване на здравето' });
  ok(microNeeds(woman).fe === 18 && microNeeds(woman, { pregnant: true }).fe === 27, 'бременност: желязо 27 мг');
  ok(microNeeds(woman, { lactating: true }).fe === 9 && microNeeds(woman, { lactating: true }).b12 === 2.8, 'кърмене: желязо 9 мг, B12 2,8');
  ok(microNeeds(woman, { pregnant: true }).o3 === 450, 'бременност: омега-3 450 мг (DHA)');
  const days = [{ meals: [{ foods: [{ id: 'x', grams: 100 }] }] }];
  const low = microReport(days, () => ({ fe: 1, ca: 10, mg: 10, k: 100, b12: 0.1, o3: 0 }), woman);
  const k = low.items.find(i => i.code === 'k');
  ok(k.status === 'low' && /Източници/.test(k.advice), 'нисък калий — съвет за източници');
  const kidney = microReport(days, () => ({ fe: 1, ca: 10, mg: 10, k: 100, b12: 0.1, o3: 0 }), woman, { restrictK: true }).items.find(i => i.code === 'k');
  ok(kidney.status === 'limited' && !/банан|картоф/.test(kidney.advice), 'бъбречна граница/висок калий — калият не се съветва нагоре');
  const kidneyPlan = buildNutritionPlan({ gender: 'Жена', age: '60', height: '165', weight: '70', goal: 'Подобряване на здравето', _enrichment: { safety: { proteinCapPerKg: 0.8 } } }, { kcal: 1800, seed: 1 });
  ok(kidneyPlan.metabolicPlan.micro.items.find(i => i.code === 'k').status === 'limited', 'планът: бъбречна граница стига до отчета');
  const pregPlan = buildNutritionPlan({ gender: 'Жена', age: '30', height: '165', weight: '62', clinicalProtocol: 'postpartum_lactation', postpartumStatus: 'Бременна' }, { kcal: 2300, seed: 1 });
  ok(pregPlan.metabolicPlan.micro.items.find(i => i.code === 'fe').target === 27, 'планът: бременност стига до нуждите');
}

console.log(`metabolic: ${pass} ok, ${fail} грешки`);
process.exit(fail ? 1 : 0);
