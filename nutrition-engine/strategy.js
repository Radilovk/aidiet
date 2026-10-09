/**
 * Стратегията на плана с думите на диетолога — изведена от числата на
 * предписанието и от седмичното меню, не написана от модел. Полетата са
 * тези, които приложението показва (plan.html, guidelines, plan-book).
 */

import { dietLabelOf, encodeProfileCode, libraryDietProfileOf } from '../profile-code.js';
import { waterNeedLiters } from '../analysis-deterministic.js';
import { GROUPS } from './knowledge.js';
import { weeklySchemeFromPlan, ENGINE_ID } from './plan-shape.js';

export const MEAL_LABELS = {
  'Хранене 1': 'Закуска',
  'Хранене 2': 'Обяд',
  'Хранене 3': 'Следобедна закуска',
  'Хранене 4': 'Вечеря',
  'Хранене 5': 'Късна закуска',
};

const CATEGORY_LABELS = {
  fish: 'риба',
  legume: 'бобови',
  poultry: 'птиче месо',
  red: 'червено месо',
  veggie: 'яйца, млечни и зеленчуци',
  plant: 'тофу и растителен белтък',
};

const STYLE_AVOID = {
  balanced: ['добавена захар и сладки напитки', 'колбаси и преработено месо', 'пържени храни'],
  mediterranean: ['преработено месо', 'сладкиши', 'рафинирани масла'],
  dash: ['солени храни и колбаси', 'готови сосове и чипс', 'добавена захар'],
  high_protein: ['сладкиши и газирани напитки', 'пържени храни', 'колбаси'],
  low_carb: ['захар и сладкиши', 'бял хляб и тестени изделия', 'сокове и газирани напитки'],
  keto: ['захар и мед', 'хляб, тестени и зърнени', 'ориз и картофи', 'сладки плодове'],
  low_fodmap: ['лук и чесън', 'пшеница', 'прясно мляко', 'ябълки и круши'],
  paleo: ['зърнени храни', 'млечни продукти', 'бобови', 'преработени храни'],
  anti_inflammatory: ['захар', 'преработено месо', 'пържени храни', 'рафинирани масла'],
};

const EXCLUSION_AVOID = {
  GLU: 'глутен (пшеница, ръж, ечемик, булгур, кус-кус)',
  LAC: 'млечни продукти',
  EGG: 'яйца',
  NUT: 'ядки',
  PNT: 'фъстъци',
  FSH: 'риба',
  SHF: 'морски дарове',
  SOY: 'соя',
  PORK: 'свинско',
};

const fmt = n => String(n).replace('.', ',');

function round(n) {
  return Math.round(Number(n) || 0);
}

/** Препоръките — конкретни числа от схемата и рамката на седмицата. */
function recommendationsOf(prescription, stats, policy) {
  const d = prescription.daily;
  const mains = stats.mains || {};
  const list = [];
  list.push(`Зеленчуци на всяко основно хранене — около ${round(d.VEG * 100)} г дневно`);
  if (d.FRU > 0) list.push(`Плодове: ${fmt(d.FRU)} порции дневно, цели плодове вместо сок`);
  if (d.MLK > 0) list.push(`Кисело мляко или кефир: ${fmt(d.MLK)} порции дневно`);
  if (mains.fish) list.push(`Риба ${mains.fish} пъти седмично${policy.styleDef.prefer?.includes('oily_fish') ? ', предимно мазна (сьомга, скумрия, пъстърва)' : ''}`);
  if (mains.legume) list.push(`Бобови (леща, боб, нахут) ${mains.legume} пъти седмично`);
  if (d.STA > 0 && policy.style !== 'keto') list.push('Пълнозърнест хляб, булгур, елда и кафяв ориз вместо бели храни');
  if (policy.style === 'mediterranean' || policy.style === 'anti_inflammatory') list.push('Зехтин като основна мазнина и шепа ядки дневно');
  if (policy.style === 'keto' || policy.style === 'low_carb') list.push('Нескорбялни зеленчуци и мазнини от зехтин, авокадо, ядки и риба');
  return list.slice(0, 7);
}

function avoidOf(profile, policy, blockedTerms) {
  const list = [...(STYLE_AVOID[policy.style] || STYLE_AVOID.balanced)];
  for (const code of profile.exclusions || []) if (EXCLUSION_AVOID[code]) list.push(EXCLUSION_AVOID[code]);
  if (policy.noSweets && !list.some(x => /захар/.test(x))) list.push('добавена захар и мед');
  for (const term of blockedTerms || []) {
    const t = String(term || '').trim();
    if (t && t.length <= 40) list.push(t.toLowerCase());
  }
  return [...new Set(list)].slice(0, 10);
}

/**
 * @param {ReturnType<typeof import('./index.js').buildNutritionPlan>} engine
 * @param {object} userData
 * @param {{ freeDayNumber?: number|null, kcal: number }} options
 */
export function buildEngineStrategy(engine, userData, options) {
  const { profile, policy, prescription, weekPlan, stats, macros } = engine;
  const label = dietLabelOf(profile);
  const slots = prescription.slots;
  const name = userData?.name || 'Вашият план';
  const perKg = profile.weightKg ? (macros.protein / profile.weightKg).toFixed(1).replace('.', ',') : null;

  const dailyText = ['STA', 'PRO', 'VEG', 'FRU', 'MLK', 'FAT', 'SWT']
    .filter(g => prescription.daily[g] > 0)
    .map(g => `${GROUPS[g].label.toLowerCase()} ${fmt(prescription.daily[g])}`)
    .join(', ');
  const mealsText = slots.map(s => `${MEAL_LABELS[s] || s} ~${round(prescription.meals[s].target.kcal)} kcal`).join(' · ');
  const mainsText = Object.entries(stats.mains || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${CATEGORY_LABELS[k] || k} ×${n}`)
    .join(', ');
  const added = prescription.addedSlots || [];
  const addedNote = added.length
    ? `Добавено е ${added.map(s => (MEAL_LABELS[s] || s).toLowerCase()).join(' и ')}: при ${options.kcal} kcal порциите не се побират реалистично в по-малко хранения.`
    : '';
  const rules = policy.rules || [];

  const lateKcal = prescription.meals['Хранене 5']?.target?.kcal;
  const blocked = userData?._engineBlockedTerms || [];

  return {
    dietaryModifier: label,
    dietType: label,
    modifierReasoning: [
      `${policy.styleDef.label}: ${policy.styleDef.basis}.`,
      ...rules.map(r => `${r.label}: ${r.basis}.`),
      ...(profile.adjustments || []).map(a => a.split(': ').slice(1).join(': ') || a),
    ].join(' '),
    welcomeMessage: `${name}, планът е ${label.toLowerCase()} — ${options.kcal} kcal дневно в ${slots.length} хранения, изградени по хранителна схема в порции, както я съставя диетолог.`,
    planJustification: `Дневната схема е: ${dailyText} порции. Всяко хранене получава своя дял от порциите и ястията се оразмеряват по него — затова калориите и макросите съвпадат с целта с реални, кухненски количества.`,
    longTermStrategy: 'Всяка седмица — кратък контролен преглед: тегло, придържане, глад и енергия. Калориите се коригират с до 150 kcal само когато планът е спазван и резултатът се разминава с очаквания две поредни седмици; иначе се сменя само менюто.',
    mealCountJustification: `${slots.length} хранения: ${slots.map(s => MEAL_LABELS[s] || s).join(', ')}. ${addedNote}`.trim(),
    afterDinnerMealJustification: slots.includes('Хранене 5')
      ? `Късната закуска е лека — около ${round(lateKcal)} kcal, предимно млечна или белтъчна.`
      : 'Не са необходими',
    weeklyMealPattern: `Основни хранения през седмицата: ${mainsText}. Едно ястие се повтаря най-много два пъти седмично.`,
    calorieDistribution: mealsText,
    macroDistribution: `Белтък ${round(macros.protein)} г${perKg ? ` (${perKg} г/кг)` : ''}, въглехидрати ${round(macros.carbs)} г, мазнини ${round(macros.fats)} г — по ${policy.styleDef.label.toLowerCase()}.`,
    breakfastStrategy: !slots.includes('Хранене 1')
      ? 'Без закуска — дневните порции са разпределени в останалите хранения.'
      : (added.includes('Хранене 1')
        ? 'Леко първо хранене — при този калораж основните хранения иначе излизат прекалено големи.'
        : 'Закуската съчетава белтък, зърнени и плод или зеленчук.'),
    mealTiming: {
      pattern: `${slots.length} хранения`,
      fastingWindows: 'Последното хранене — 2–3 часа преди сън.',
      flexibility: '±30–45 мин около обичайните часове.',
      chronotypeGuidance: userData?.chronotype
        ? `Съобразено с хронотип: ${userData.chronotype}.`
        : 'Съобразено със стандартен дневен ритъм.',
    },
    keyPrinciples: [
      policy.styleDef.label,
      'Хранителна схема в обменни порции',
      ...rules.map(r => r.label),
    ],
    preferredFoodCategories: recommendationsOf(prescription, stats, policy),
    avoidFoodCategories: avoidOf(profile, policy, blocked),
    foodsToInclude: recommendationsOf(prescription, stats, policy),
    foodsToAvoid: avoidOf(profile, policy, blocked),
    psychologicalSupport: addedNote ? [addedNote] : [],
    hydrationStrategy: `${waterNeedLiters(profile)} л вода дневно, разпределена през деня.`,
    profileCode: encodeProfileCode(profile, { kcal: options.kcal, ...macros }),
    weeklyScheme: weeklySchemeFromPlan(weekPlan, prescription.meals['Хранене 2']?.target || null),
    freeDayNumber: options.freeDayNumber ?? null,
    includeDessert: policy.sweets,
    libraryDietProfile: libraryDietProfileOf(profile),
    exchangePlan: {
      daily: prescription.daily,
      meals: Object.fromEntries(slots.map(s => [s, prescription.meals[s].quota])),
    },
    engine: ENGINE_ID,
    _deterministicCore: true,
  };
}
