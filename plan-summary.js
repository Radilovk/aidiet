/**
 * Обобщение на плана без AI.
 *
 * AI обобщението (Стъпка 4) връщаше препоръки, забрани, психология и вода,
 * които детерминистичната стратегия веднага презаписваше — оставаха само
 * макросите и добавките. Макросите са средните от реалната седмица, а
 * добавките — от изследванията, протокола и кода на профила (supplement-rules.js).
 */

import { compileProfile } from './profile-code.js';
import { interactionsFor, applySupplementInteractions } from './drug-interactions.js';
import { supplementsFor } from './supplement-rules.js';
import { waterNeedLiters } from './analysis-deterministic.js';

const STYLE_RECOMMENDATIONS = {
  balanced: ['Зеленчуци на всяко основно хранене', 'Постни меса и риба', 'Пълнозърнести храни', 'Кисело мляко и извара', 'Плодове като междинно хранене'],
  mediterranean: ['Зехтин като основна мазнина', 'Риба 2–3 пъти седмично', 'Бобови храни', 'Зеленчуци и салати', 'Ядки в малки порции'],
  keto: ['Яйца', 'Мазна риба', 'Авокадо и зехтин', 'Листни и некористени зеленчуци', 'Сирена в умерени количества'],
  low_carb: ['Протеин на всяко хранене', 'Некористени зеленчуци', 'Бобови в малки порции', 'Ядки и семена', 'Плодове с ниско съдържание на захар'],
  high_protein: ['Пилешко и пуешко месо', 'Риба', 'Извара и скир', 'Яйца', 'Бобови храни'],
  low_fodmap: ['Ориз и картофи', 'Моркови, тиквички, краставици', 'Яйца и риба', 'Безлактозни млечни', 'Ягоди и боровинки'],
  dash: ['Зеленчуци и плодове', 'Нискомаслени млечни', 'Пълнозърнести', 'Риба и птиче месо', 'Бобови и ядки без сол'],
  paleo: ['Месо и риба', 'Зеленчуци', 'Плодове', 'Ядки и семена', 'Сладки картофи'],
  anti_inflammatory: ['Мазна риба', 'Листни зеленчуци', 'Зехтин', 'Горски плодове', 'Куркума и джинджифил'],
};

const STYLE_FORBIDDEN = {
  balanced: ['Сладкиши и захар', 'Газирани напитки', 'Пържени храни', 'Преработени меса'],
  mediterranean: ['Преработени меса', 'Сладкиши', 'Рафинирани масла', 'Газирани напитки'],
  keto: ['Захар и мед', 'Хляб и тестени', 'Ориз и картофи', 'Сладки плодове', 'Газирани напитки'],
  low_carb: ['Захар и сладкиши', 'Бял хляб и тестени', 'Сокове и газирани напитки', 'Бял ориз в големи порции'],
  high_protein: ['Сладкиши', 'Газирани напитки', 'Пържени храни', 'Алкохол'],
  low_fodmap: ['Лук и чесън', 'Боб и леща в големи порции', 'Ябълки и круши', 'Прясно мляко', 'Пшеница'],
  dash: ['Солени храни и колбаси', 'Готови сосове', 'Чипс и солети', 'Алкохол'],
  paleo: ['Зърнени храни', 'Млечни продукти', 'Бобови', 'Захар', 'Преработени храни'],
  anti_inflammatory: ['Захар', 'Преработени меса', 'Пържени храни', 'Рафинирани масла', 'Алкохол'],
};

const BEHAVIOR_PSYCHOLOGY = {
  EMO: 'Преди хранене извън плана — 10 минути пауза и вода: гладът ли е, или емоцията?',
  OVR: 'Сервирай порцията в чиния и прибирай тенджерата — първата порция е цялата порция.',
  SWT: 'Сладкото е планирано в менюто — не е забранено, а е на определено място.',
  SWS: 'Сладкото между храненията замени с плод или кисело мляко от плана.',
  CMP: 'След преяждане продължи със следващото хранене по план — без гладуване за компенсация.',
  TV: 'Храни се без екран — ситостта се усеща след 15–20 минути.',
  RUSH: 'Седни за храненето, дори да е за 10 минути.',
  IRR: 'Едни и същи часове за храненията стабилизират апетита в рамките на 1–2 седмици.',
  OUT: 'Когато ядеш навън: протеин + зеленчуци, а сосът отделно.',
  EVE: 'Първото хранене до 2 часа след събуждане намалява глада вечер.',
};

const GENERAL_PSYCHOLOGY = [
  'Следи тенденцията на теглото за седмица, не дневните колебания.',
  'Една пропусната порция не проваля плана — продължи със следващото хранене.',
  'Сънят и водата влияят на апетита толкова, колкото и храната.',
];

/** Средни дневни макроси от реално генерираната седмица (без свободните хранения). */
export function averageMacrosFromWeek(weekPlan = {}) {
  let p = 0;
  let c = 0;
  let f = 0;
  let days = 0;
  for (const day of Object.values(weekPlan || {})) {
    const meals = day?.meals || [];
    if (!meals.length || meals.some(m => m.type === 'Свободно хранене')) continue;
    for (const m of meals) {
      p += Number(m.macros?.protein) || 0;
      c += Number(m.macros?.carbs) || 0;
      f += Number(m.macros?.fats) || 0;
    }
    days++;
  }
  if (!days) return { protein: 0, carbs: 0, fats: 0 };
  return { protein: Math.round(p / days), carbs: Math.round(c / days), fats: Math.round(f / days) };
}

/**
 * Протеинът на прах, който менюто вече ползва (в закуска или шейк при недостиг
 * на белтък) — става и добавка в списъка: какво да се купи и защо.
 */
function powderInMenu(weekPlan = {}) {
  const meals = Object.values(weekPlan || {}).flatMap(d => d?.meals || []);
  const lines = meals.map(m => String(m.description || '')).filter(d => /протеин \((растителен|суроватъчен)\)|протеин на прах/i.test(d));
  if (!lines.length) return [];
  const plant = lines.some(d => /растителен/i.test(d));
  const days = Object.values(weekPlan || {}).filter(d => (d?.meals || []).some(m => /протеин \((растителен|суроватъчен)\)|протеин на прах/i.test(String(m.description || '')))).length;
  return [{
    name: plant ? 'Растителен протеин на прах (грахов/соев)' : 'Суроватъчен протеин (whey)',
    dosage: '1 мерителна лъжица (около 25–30 g)',
    timing: 'в дните, в които е в менюто',
    reason: `менюто го ползва ${days} ${days === 1 ? 'ден' : 'дни'} седмично — без него белтъкът на деня не стига целта`,
  }];
}

/**
 * Противопоказаните от лекарствата отпадат преди подбора (да не заемат място
 * на други), а след него на всички се добавя отделянето във времето.
 */
function supplementsWithMeds(profile, userData, protocolSupplements, protocolName, weekPlan) {
  const ix = interactionsFor(userData || {});
  const picked = supplementsFor(profile, userData, {
    labs: applySupplementInteractions(userData?._enrichment?.supplements || [], ix).kept,
    protocol: applySupplementInteractions(protocolSupplements || [], ix).kept,
    protocolName,
    menu: powderInMenu(weekPlan),
  });
  return applySupplementInteractions(picked, ix).kept;
}

/**
 * @param {{ userData?: object, strategy?: object, weekPlan?: object, bmr?: number, dailyCalories?: number, protocolSupplements?: object[], protocolName?: string }} ctx
 */
export function buildPlanSummary({
  userData = {},
  strategy = {},
  weekPlan = {},
  bmr = 0,
  dailyCalories = 0,
  protocolSupplements = [],
  protocolName = '',
} = {}) {
  const profile = compileProfile(userData || {}, { dietaryModifier: strategy?.dietaryModifier });
  const style = profile.diet.style;

  const recommendations = strategy?.foodsToInclude?.length
    ? [...strategy.foodsToInclude]
    : [...(STYLE_RECOMMENDATIONS[style] || STYLE_RECOMMENDATIONS.balanced)];
  const forbidden = [...new Set([
    ...(strategy?.foodsToAvoid || []),
    ...(STYLE_FORBIDDEN[style] || STYLE_FORBIDDEN.balanced),
  ])].slice(0, 10);

  const psychology = [
    ...(strategy?.psychologicalSupport || []),
    ...profile.behaviors.map(b => BEHAVIOR_PSYCHOLOGY[b]).filter(Boolean),
  ];
  for (const tip of GENERAL_PSYCHOLOGY) {
    if (psychology.length >= 3) break;
    psychology.push(tip);
  }

  return {
    summary: {
      bmr,
      dailyCalories,
      macros: averageMacrosFromWeek(weekPlan),
    },
    recommendations,
    forbidden,
    psychology: [...new Set(psychology)].slice(0, 6),
    waterIntake: `${waterNeedLiters(profile)} л вода дневно, разпределена през деня`,
    supplements: supplementsWithMeds(profile, userData, protocolSupplements, protocolName, weekPlan),
  };
}
