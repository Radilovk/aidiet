#!/usr/bin/env node
/**
 * Отпечатък на ястието, макро зони и реалистичност на чинията.
 *
 * Проверява договора: калориите се постигат с порцията, съотношението на
 * макросите — с избора на ястия, а чинията остава реална.
 */
import { MEAL_DISHES } from '../meal-dishes.js';
import { dishFingerprint, macroZoneFor, desiredSlotShares } from '../dish-fingerprint.js';
import { compileProfile } from '../profile-code.js';
import { macroTargetsFor } from '../macro-targets.js';
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { syncWeekPlanNutritionFromDatabase } from '../meal-day-sync.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

// ── Отпечатък ──
const omelet = MEAL_DISHES.find(d => d.id === 'meal_omelet');
const fp = dishFingerprint(omelet);
ok(fp && Math.abs(fp.p + fp.c + fp.f - 1) < 1e-9, 'дяловете на отпечатъка дават 1');
ok(fp.c < 0.15 && fp.f > 0.5, `омлетът е нисковъглехидратен и мазен (C ${fp.c.toFixed(2)}, F ${fp.f.toFixed(2)})`);
const rice = MEAL_DISHES.find(d => d.id === 'meal_chicken_rice') || MEAL_DISHES.find(d => /ориз/i.test(d.name));
ok(dishFingerprint(rice).c > 0.3, `${rice.name} носи въглехидрати`);

// ── Зони ──
const keto = compileProfile({ dietPreference: ['Кето'] });
ok(macroZoneFor(keto, 'Хранене 2').maxCarb === 0.12, 'кето зона: ≤12% въглехидрати');
const lowCarb = compileProfile({ dietPreference: ['Нисковъглехидратна'] });
ok(macroZoneFor(lowCarb, 'Хранене 2').maxCarb === 0.30, 'нисковъглехидратна зона: ≤30% на основно хранене');
const ir = compileProfile({ medicalConditions: ['Инсулинова резистентност'], dietPreference: ['Средиземноморска'] });
ok(macroZoneFor(ir, 'Хранене 2').maxCarb === 0.55, 'инсулинова резистентност ограничава въглехидратите и при друга диета');
ok(!macroZoneFor(compileProfile({}), 'Хранене 2').maxCarb, 'балансирана — без зона');

// ── Корекция с отклонението на деня ──
const slot = { calories: 500, protein: 30, carbs: 50, fats: 20 };
const neutral = desiredSlotShares(slot, { p: 0, c: 0, f: 0 }, 1000);
const afterCarbHeavyLunch = desiredSlotShares(slot, { p: -60, c: 150, f: -40 }, 1000);
ok(afterCarbHeavyLunch.c < neutral.c && afterCarbHeavyLunch.p > neutral.p,
  'след въглехидратен обяд вечерята се търси по-протеинова');

// ── Цяла седмица ──
async function buildWeek(userData) {
  const data = structuredClone(userData);
  enrichUserDataEngineContext(data);
  const profile = compileProfile(data);
  const kcal = 1800;
  const t = macroTargetsFor(profile, kcal);
  const analysis = {
    Final_Calories: kcal,
    macroGrams: { protein: t.protein, carbs: t.carbs, fats: t.fats },
    macroRatios: t.ratios,
  };
  const strategy = buildDeterministicStrategy({ userData: data, analysis });
  const weekPlan = await buildDeterministicWeekPlanChunk({
    strategy, userData: data, startDay: 1, endDay: 7, seed: 7,
    clinicalProtocolId: data.clinicalProtocol || null,
    blockedTerms: data._engineBlockedTerms || [],
  });
  syncWeekPlanNutritionFromDatabase(weekPlan, strategy, 1, 7, data);
  return { strategy, weekPlan, profile };
}

function dayDeviation({ strategy, weekPlan }) {
  const keys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const dev = { kcal: 0, p: 0, c: 0, f: 0, n: 0 };
  for (let d = 1; d <= 7; d++) {
    const meals = weekPlan[`day${d}`].meals.filter(m => m.type !== 'Свободно хранене');
    if (meals.length < weekPlan[`day${d}`].meals.length) continue;
    const s = strategy.weeklyScheme[keys[d - 1]];
    const sum = k => meals.reduce((a, m) => a + (k === 'kcal' ? m.calories : m.macros?.[k]) || 0, 0);
    dev.kcal += Math.abs(sum('kcal') - s.calories) / s.calories;
    dev.p += Math.abs(sum('protein') - s.protein) / s.protein;
    dev.c += Math.abs(sum('carbs') - s.carbs) / s.carbs;
    dev.f += Math.abs(sum('fats') - s.fats) / s.fats;
    dev.n++;
  }
  return { kcal: dev.kcal / dev.n, p: dev.p / dev.n, c: dev.c / dev.n, f: dev.f / dev.n };
}

const base = {
  gender: 'Жена', age: '40', height: '166', weight: '74', goal: 'Отслабване', lossKg: '6',
  dailyActivityLevel: 'Средно', sportActivity: 'Ниска (1–2 дни седмично)',
  eatingHabits: ['Нито една'], medicalConditions: ['Нямам'], dietPreference: ['Балансирана'],
};

const balanced = await buildWeek(base);
const bDev = dayDeviation(balanced);
ok(bDev.kcal < 0.06, `балансирана: калории ±${(bDev.kcal * 100).toFixed(1)}%`);
ok(bDev.p < 0.15 && bDev.c < 0.15 && bDev.f < 0.15,
  `балансирана: макроси P ${(bDev.p * 100).toFixed(0)}% C ${(bDev.c * 100).toFixed(0)}% F ${(bDev.f * 100).toFixed(0)}%`);

const diabetic = await buildWeek({ ...base, dietPreference: ['Нямам предпочитания'], medicalConditions: ['Инсулинова резистентност', 'Диабет'] });
ok(diabetic.profile.diet.style === 'low_carb', 'диабет без избран стил → нисковъглехидратна');
// Каталогът има малко ястия с умерени въглехидрати (12–30%), затова към
// края на седмицата дните слизат под целта — безопасната посока при диабет.
// Над целта не бива да излизат.
const dDev = dayDeviation(diabetic);
ok(dDev.c < 0.35, `нисковъглехидратна: въглехидрати ±${(dDev.c * 100).toFixed(0)}% от целта`);
const lcKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const overCarb = [1, 2, 3, 4, 5, 6, 7].filter((d) => {
  const meals = diabetic.weekPlan[`day${d}`].meals;
  if (meals.some(m => m.type === 'Свободно хранене')) return false;
  const carbs = meals.reduce((a, m) => a + (m.macros?.carbs || 0), 0);
  return carbs > diabetic.strategy.weeklyScheme[lcKeys[d - 1]].carbs * 1.15;
});
ok(!overCarb.length, `нисковъглехидратна: никой ден над целта за въглехидрати +15% (${overCarb.join(', ')})`);
const sugar = Object.values(diabetic.weekPlan).flatMap(d => d.meals)
  .filter(m => /мед|захар|сироп/i.test(`${m.name} ${m.description}`));
ok(!sugar.length, `без добавена захар при диабет (${sugar.map(m => m.name).join(', ')})`);

const allMeals = Object.values(balanced.weekPlan).flatMap(d => d.meals);
const snackMains = allMeals.filter(m => m.type === 'Хранене 3' && /пилеш|говежд|риба|ориз|паста|хляб/i.test(m.description || ''));
ok(!snackMains.length, `следобедната закуска не е основно ястие (${snackMains.map(m => m.name).join(', ')})`);
const lateCarbs = allMeals.filter(m => m.type === 'Хранене 5' && /ориз|хляб|паста|картоф|банан|ябълка|мед|захар/i.test(m.description || ''));
ok(!lateCarbs.length, `късната закуска не е хляб/плод (${lateCarbs.map(m => m.name).join(', ')})`);
const tiny = allMeals.flatMap(m => String(m.description || '').split('\n'))
  .filter(l => { const g = Number((l.match(/(\d+)\s*g/) || [])[1]); return g > 0 && g < 10; });
ok(!tiny.length, `няма символични грамажи под 10 г (${tiny.join('; ')})`);

const aip = await buildWeek({ ...base, clinicalProtocol: 'autoimmune_aip', dietPreference: [] });
ok(Object.values(aip.weekPlan).every(d => d.meals.some(m => m.type === 'Хранене 5')),
  'AIP: всеки ден има късна закуска (каталогът вече я покрива)');
const aipText = Object.values(aip.weekPlan).flatMap(d => d.meals).map(m => m.description).join('\n');
ok(/Сладки картофи/.test(aipText) || !/Картофи/.test(aipText), 'AIP: сладките картофи не са изключени като „картофи“');
ok(!/^• (Картофи|Домати|Яйца|Ориз)\b/m.test(aipText), 'AIP: без картофи, домати, яйца и ориз');

const ketoWeek = await buildWeek({ ...base, dietPreference: ['Кето'] });
const ketoMains = Object.values(ketoWeek.weekPlan).flatMap(d => d.meals)
  .filter(m => ['Хранене 1', 'Хранене 2', 'Хранене 4'].includes(m.type) && m.dishId);
const ketoOut = ketoMains.filter((m) => {
  const dish = MEAL_DISHES.find(d => d.id === m.dishId);
  return dish && dishFingerprint(dish).c > 0.12;
});
ok(ketoOut.length <= Math.ceil(ketoMains.length * 0.1),
  `кето: основните ястия са в зоната (${ketoOut.length}/${ketoMains.length} извън)`);

console.log(`\n=== dish fingerprint: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
