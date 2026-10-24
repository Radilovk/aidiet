/**
 * Модел на целта (goal-model.js): посоката идва от целта В КОНТЕКСТА на
 * профила, а калориите, профилът, седмичното решение и екранът четат едно и също.
 */
import { createRequire } from 'module';
import { compileProfile } from '../profile-code.js';
import { calculateSafeDeficit } from '../energy.js';
import { decideWeeklyAdjustment, weeklyQuestionsFor } from '../nutrition-engine/monitoring.js';

const require = createRequire(import.meta.url);
const GM = require('../goal-model.js');
const GF = require('../goal-focus.js');

let pass = 0;
let fail = 0;
const ok = (cond, name) => {
  if (cond) pass++;
  else { fail++; console.log('✗', name); }
};

const woman = { gender: 'Жена', age: 40, height: 165 };
const man = { gender: 'Мъж', age: 35, height: 180 };
const dir = (d) => compileProfile(d).direction;
const pct = (d) => compileProfile(d).goalModel.intakePct;

// 1. Един етикет — различна посока по профила.
ok(dir({ ...woman, goal: ['Антиейджинг'], weight: 87 }) === 'lose', 'антиейджинг при ИТМ 32 — сваляне');
ok(dir({ ...woman, goal: ['Антиейджинг'], weight: 60 }) === 'maintain', 'антиейджинг при ИТМ 22 — задържане');
ok(dir({ ...woman, age: 68, goal: ['Антиейджинг'], weight: 52 }) === 'gain', 'антиейджинг след 60 г. и слабо тяло — мускулен резерв');
ok(dir({ ...woman, goal: ['Антицелулитна програма'], weight: 60 }) === 'recomp', 'антицелулит при нормално тегло — без дефицит');
ok(pct({ ...woman, goal: ['Антицелулитна програма'], weight: 60 }) === 0, 'антицелулит при нормално тегло — 0%');
ok(dir({ ...woman, goal: ['Антицелулитна програма'], weight: 79 }) === 'lose', 'антицелулит при ИТМ 29 — сваляне');
ok(dir({ ...man, goal: ['Мускулна маса'], weight: 100, sportActivity: 'Средна (2–4 дни седмично)' }) === 'recomp', 'мускулна маса при наднормено — смяна на състава, не покачване');
ok(pct({ ...man, goal: ['Мускулна маса'], weight: 100, sportActivity: 'Средна (2–4 дни седмично)' }) < 0, 'мускулна маса при излишък — лек дефицит');
ok(dir({ ...man, goal: ['Мускулна маса'], weight: 68, sportActivity: 'Средна (2–4 дни седмично)' }) === 'gain', 'мускулна маса при слабо тяло и тренировки — покачване');
ok(dir({ ...man, goal: ['Мускулна маса'], weight: 75 }) === 'recomp', 'мускулна маса без тренировки — без излишък');
ok(dir({ ...woman, goal: ['Отслабване'], weight: 49 }) === 'recomp', 'отслабване при ИТМ 18 — без дефицит');
ok(dir({ ...woman, goal: ['Подобряване на здравето'], weight: 77, medicalConditions: ['Инсулинова резистентност'] }) === 'lose', 'здраве при ИТМ 28 и инсулинова резистентност — сваляне');
ok(dir({ ...woman, goal: ['Подобряване на здравето'], weight: 60 }) === 'maintain', 'здраве при нормално тегло — задържане');

// 2. Мазнините и талията бият ИТМ.
ok(dir({ ...man, goal: ['Отслабване'], weight: 92, _enrichment: { essence: { metrics: { bodyFat: { last: 14 } } } } }) === 'recomp', 'ИТМ 28 при 14% мазнини — няма излишък');
ok(dir({ ...woman, goal: ['Изчистване на коремните мазнини'], weight: 63, waistCircumference: 90 }) === 'lose', 'висока талия при нормален ИТМ — сваляне');
ok(pct({ ...woman, goal: ['Изчистване на коремните мазнини'], weight: 63, waistCircumference: 90 }) === -10, 'висока талия при нормален ИТМ — мек дефицит');

// 3. Няколко цели и свободен текст.
const multi = compileProfile({ ...woman, goal: ['Антиейджинг', 'Отслабване'], weight: 79 });
ok(multi.goal === 'LOSS' && multi.direction === 'lose', 'реда на отметките не решава — води посоката');
ok(multi.goals.includes('AGE') && multi.goals.includes('LOSS'), 'всички цели остават в профила');
ok(dir({ ...woman, goal: ['Друго'], goal_other: 'искам да сваля 10 кг', weight: 80 }) === 'lose', 'свободен текст се чете');
ok(compileProfile({ ...woman, goal: 'Достатъчно мляко за бебето + Постепенно отслабване', weight: 75, clinicalProtocol: 'postpartum_lactation', postpartumStatus: 'Кърмя (до 6 месеца след раждане)' }).goalModel.intakePct >= -10, 'кърмене — най-много мек дефицит');
ok(compileProfile({ ...woman, weight: 75, clinicalProtocol: 'postpartum_lactation', postpartumStatus: 'Бременна' }).goalModel.intakePct >= 0, 'бременност — без дефицит');
ok(compileProfile({ ...woman, weight: 70, clinicalProtocol: 'visceral_fat' }).goals.includes('VISC'), 'клиничната карта носи своята цел');

// 4. Без данни за тялото — заявеното.
ok(GM.resolve({ goal: 'Отслабване' }).direction === 'lose' && GM.resolve({ goal: 'Мускулна маса' }).direction === 'gain', 'без ръст/тегло — по заявената цел');

// 5. Калориите следват модела.
const t = 2500;
ok(calculateSafeDeficit(t, { ...woman, goal: ['Антиейджинг'], weight: 87 }).targetCalories < t, 'антиейджинг при затлъстяване — дефицит в калориите');
ok(calculateSafeDeficit(t, { ...woman, goal: ['Антицелулитна програма'], weight: 60 }).targetCalories === t, 'антицелулит при нормално тегло — без дефицит');
ok(calculateSafeDeficit(t, { ...woman, goal: ['Антиейджинг', 'Отслабване'], weight: 79 }).targetCalories === calculateSafeDeficit(t, { ...woman, goal: ['Отслабване', 'Антиейджинг'], weight: 79 }).targetCalories, 'редът на отметките не мени калориите');
ok(calculateSafeDeficit(t, 'Отслабване').targetCalories === 2050, 'старият вход (само етикет) работи както преди');

// 6. Пътната карта.
const road = compileProfile({ ...man, goal: ['Мускулна маса'], weight: 100, sportActivity: 'Средна (2–4 дни седмично)' }).goalModel.phases;
ok(road[0].dir === 'recomp' && road[1].dir === 'gain', 'мускулна маса при излишък: състав → покачване');
const loseRoad = compileProfile({ ...woman, goal: ['Отслабване'], weight: 85, lossKg: 15 }).goalModel.phases;
ok(loseRoad[0].until?.value === 70, 'фазата „сваляне“ свършва при желаното тегло');
ok(compileProfile({ ...woman, goal: ['Отслабване'], weight: 60, lossKg: 20 }).targetWeightKg >= 54, 'желаното тегло не пада под ИТМ 20');

// 7. Седмичното решение по посоката.
const base = { kcal: 2200, tdee: 2200, floorKcal: 1400, weightKg: 90, history: [] };
const followedFlat = { weight: 'flat', weeklyChangeKg: 0, weightKg: 90, adherence: 90 };
const lossDecision = decideWeeklyAdjustment({ ...base, checkin: { ...followedFlat, weeklyChangeKg: -1 }, goal: 'AGE', direction: 'recomp', history: [{ weight: 'loss', followed: true }] });
ok(lossDecision.calorieAdjust > 0, 'смяна на състава: втора седмица бърз спад — повече калории');
const waistDecision = decideWeeklyAdjustment({ ...base, checkin: { ...followedFlat, waistChangeCm: -1.5 }, goal: 'GAIN', direction: 'recomp' });
ok(waistDecision.calorieAdjust === 0 && waistDecision.weight === 'recomp', 'смяна на състава: по-малка талия — успех, приемът остава');
const noTrain = decideWeeklyAdjustment({ ...base, checkin: { ...followedFlat, workouts: 0 }, goal: 'GAIN', direction: 'gain', history: [{ weight: 'flat', followed: true }] });
ok(noTrain.calorieAdjust === 0, 'мускулна маса без тренировки — без повече калории');
const ageLose = decideWeeklyAdjustment({ ...base, kcal: 1900, checkin: { ...followedFlat, weeklyChangeKg: -0.6 }, goal: 'AGE', direction: 'lose', history: [{ weight: 'loss', followed: true }] });
ok(ageLose.calorieAdjust === 0, 'антиейджинг при сваляне: спад по план — без +100 kcal (старият бъг)');

// 8. Въпросите по водещите показатели.
const qRecomp = weeklyQuestionsFor({ goal: 'GAIN', direction: 'recomp', lead: ['composition', 'workouts', 'waist'] });
ok(qRecomp.some(q => q.id === 'workouts'), 'смяна на състава — въпрос за тренировките');
ok(!/по желание/.test(qRecomp.find(q => q.id === 'waistCm').text), 'талията е водеща — не „по желание“');
ok(!weeklyQuestionsFor({ goal: 'HLTH', direction: 'maintain', lead: ['energy', 'sleep', 'digestion'] }).some(q => q.id === 'workouts'), 'здраве — без въпрос за тренировките');
ok(weeklyQuestionsFor({ goal: 'GAIN', direction: 'recomp', lead: [] }).find(q => q.id === 'weight').options[0] !== 'Качих повече от 0,5 кг', 'мускулна маса при смяна на състава — въпросът за теглото не е „качих“');

// 9. Екранът е съгласен с изчисленията.
ok(GF.profileOf({ ...woman, goal: ['Отслабване', 'Антиейджинг'], weight: 79 }).group === 'lose', 'две отметки — вече не „здраве“');
ok(GF.profileOf({ ...man, goal: ['Мускулна маса'], weight: 100, sportActivity: 'Средна (2–4 дни седмично)' }).group === 'tone', 'мускулна маса при излишък — екран „стягане“');
ok(GF.profileOf({ ...woman, goal: ['Подобряване на здравето'], weight: 90 }).group === 'lose', 'здраве при затлъстяване — екран „отслабване“');

console.log(`\n=== goal model: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
