/**
 * Стратегията на плана с думите на диетолога — изведена от числата на
 * предписанието и от седмичното меню, не написана от модел. Полетата са
 * тези, които приложението показва (plan.html, guidelines, plan-book).
 */

import { dietLabelOf, encodeProfileCode, libraryDietProfileOf, GOALS } from '../profile-code.js';
import { waterNeedLiters } from '../analysis-deterministic.js';
import { GROUPS, CONDITIONS, PROTOCOLS } from './knowledge.js';
import { buildFoodGuide } from './food-guide.js';
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
  if (policy.style === 'keto' || policy.style === 'low_carb') list.push('Ненишестени зеленчуци и мазнини от зехтин, авокадо, ядки и риба');
  return list.slice(0, 7);
}

/**
 * Клиничните изключвания по флаг. Отделни думи, а не една фраза: по този списък
 * се проверяват и AI текстовете на плана (ai-voice.js търси подниз), за да не
 * препоръчат картофи или бял ориз при инсулинова резистентност или затлъстяване.
 */
const FLAG_AVOID = {
  high_gi: ['бял ориз', 'бял хляб', 'картофи'],
};

function clinicalAvoid(profile) {
  const codes = [...(profile.clinical || [])];
  const protocol = profile.protocol && PROTOCOLS[profile.protocol];
  if (protocol?.use) codes.push(...protocol.use);
  const flags = new Set();
  for (const code of codes) for (const f of CONDITIONS[code]?.excludeFlags || []) flags.add(f);
  if (protocol && !protocol.use) for (const f of protocol.excludeFlags || []) flags.add(f);
  return [...flags].flatMap(f => FLAG_AVOID[f] || []);
}

function avoidOf(profile, policy, blockedTerms) {
  const list = [...(STYLE_AVOID[policy.style] || STYLE_AVOID.balanced)];
  if (policy.style !== 'keto') list.push(...clinicalAvoid(profile));
  for (const code of profile.exclusions || []) if (EXCLUSION_AVOID[code]) list.push(EXCLUSION_AVOID[code]);
  if (policy.noSweets && !list.some(x => /захар/.test(x))) list.push('добавена захар и мед');
  for (const term of blockedTerms || []) {
    const t = String(term || '').trim();
    if (t && t.length <= 40) list.push(t.toLowerCase());
  }
  return [...new Set(list)].slice(0, 10);
}

/**
 * Психологическите насоки — от отговорите за навици, тригери, стрес и сън.
 * Всяка е конкретно действие за клиента, не бележка за плана: вътрешните
 * изводи (защо е добавено хранене, бележки за модела) не стигат до него.
 */
const BEHAVIOR_TIPS = {
  EMO: 'Преди да посегнеш към храна извън плана, спри за 2 минути и си задай въпроса: това глад ли е, или умора, напрежение, скука? Ако не е глад — чаша вода, кратка разходка или разговор помагат повече от храната.',
  OVR: 'Сервирай порцията в чиния и прибери тенджерата, преди да седнеш. Храни се бавно — около 20 минути; толкова време е нужно на сигнала за ситост да стигне до мозъка.',
  EVE: 'Вечерният глад обикновено е последица от твърде малко храна през деня. Редовните обяд и следобедна закуска са най-сигурният начин вечерта да мине без силен глад.',
  SWS: 'Сладкото между храненията се появява най-често при дълги паузи. Дръж плод под ръка и го изяждай като част от следобедната закуска, а не отделно.',
  SWT: 'Желанието за сладко отслабва, когато в храненията има достатъчно белтък и фибри. Ако все пак се появи — избери плод или парче черен шоколад веднага след хранене, не на гладно.',
  DOUGH: 'Тестените храни не са забранени завинаги — просто не ги дръж вкъщи като резерва. Когато ти се приискат, вземи една порция навън, без да купуваш „за после“.',
  FASTF: 'Желанието за бургер или дюнер е по-силно, когато храната вкъщи е скучна. Подправките, сосовете на основа кисело мляко и хрупкавите зеленчуци правят домашната чиния също толкова привлекателна.',
  SALT: 'Хрупкавото и соленото често са навик пред екрана. Замени чипса с печен нахут, ядки (отмерена шепа) или моркови с хумус.',
  TV: 'Храни се на масата, без телефон и телевизор. Когато вниманието е другаде, изяждаме повече и усещаме по-малко ситост.',
  RUSH: 'Дори в забързан ден отдели 10 минути само за храненето. Подготвените предварително ястия (вечерта или в неделя) премахват най-честата причина да се яде на крак.',
  OUT: 'Когато се храниш навън, избери ястие с ясен източник на белтък и зеленчуци и поискай сосовете отделно. Една свободна вечеря не проваля седмицата.',
  IRR: 'Редовността е по-важна от съвършенството. Ако пропуснеш хранене, просто продължи със следващото по плана — без компенсиране и без „от понеделник“.',
  CMP: 'Гладуването след преяждане засилва следващия пристъп. Върни се към обичайното хранене по плана още на следващото хранене — това е най-бързият път обратно.',
  SDR: 'Сладките напитки носят калории без ситост. Вода с лимон, газирана вода или студен билков чай са добър заместител в първите седмици.',
  ALC: 'Алкохолът отслабва контрола върху храната. Ако пиеш, реши предварително колко, и пий чаша вода след всяка напитка.',
};

/** @type {Array<[RegExp, string]>} */
const TRIGGER_TIPS = [
  [/напрежени|стрес/i, 'При напрежение тялото търси бърза енергия. Пет бавни вдишвания или 10 минути ходене намаляват желанието за храна по-ефективно от силата на волята.'],
  [/скук/i, 'Скуката лесно се бърка с глад. Ако последното хранене е било преди по-малко от 3 часа, смени заниманието за 15 минути и провери дали желанието остава.'],
  [/тъг|самот/i, 'Храната носи кратко облекчение при тъга. Помага да имаш списък с 3 неща, които ти успокояват без храна — обаждане, музика, разходка.'],
  [/социал|празн|гост/i, 'На празници и срещи хапни нормално преди това и започни с белтък и салата. Така изборът на масата е спокоен, а не от глад.'],
];

function psychologyTipsOf(profile, userData) {
  const tips = [];
  const behaviors = new Set(profile.behaviors || []);
  const triggers = (Array.isArray(userData?.foodTriggers) ? userData.foodTriggers : [userData?.foodTriggers])
    .map(x => String(x || '')).filter(x => x && !/^нито/i.test(x));
  for (const [re, tip] of TRIGGER_TIPS) {
    if (triggers.some(x => re.test(x))) tips.push(tip);
  }
  for (const code of ['EMO', 'OVR', 'CMP', 'EVE', 'SWT', 'SWS', 'FASTF', 'DOUGH', 'SALT', 'TV', 'RUSH', 'OUT', 'IRR', 'SDR', 'ALC']) {
    if (code === 'EMO' && triggers.length) continue; // вече покрито от конкретния тригер
    if (behaviors.has(code)) tips.push(BEHAVIOR_TIPS[code]);
  }
  if (profile.stress === 3) {
    tips.push('Високият стрес повишава апетита и желанието за сладко. 7–8 часа сън и кратка разходка след вечеря са част от плана толкова, колкото и храната.');
  }
  if ((profile.sleepHours && profile.sleepHours < 7) || profile.sleepInterrupted) {
    tips.push('При недоспиване гладът на следващия ден е по-силен — това е физиология, не липса на воля. Лягай по едно и също време и остави последното хранене поне 2 часа преди сън.');
  }
  if (tips.length < 3) {
    tips.push('Очаквай колебания в теглото от ден на ден — водата и солта ги причиняват. Сравнявай седмица със седмица, не ден с ден.');
    tips.push('Един пропуснат ден не проваля плана. Важи това, което правите през повечето дни.');
  }
  return [...new Set(tips)].slice(0, 5);
}

/**
 * @param {ReturnType<typeof import('./index.js').buildNutritionPlan>} engine
 * @param {object} userData
 * @param {{ freeDayNumber?: number|null, kcal: number }} options
 */
const DAY_NAMES = ['понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота', 'неделя'];

/**
 * Приветствието, когато AI не е написал лично писмо. Говори от името на
 * специалиста, който води клиента — без сравнения „като диетолог“ и без жаргон.
 * Етикетите на храненето са в различен род („Балансирано“, „Веган“), затова
 * стоят след двоеточие.
 */
function welcomeText({ name, goal, label, kcal, meals, freeDay, weekPlan }) {
  const hasAlternatives = Object.values(weekPlan || {}).some(d => (d?.meals || []).some(m => m?.alternatives?.length));
  const free = freeDay ? ` В ${DAY_NAMES[freeDay - 1]} имаш едно свободно хранене.` : '';
  // Заглавието вече казва „…, Вашият план е готов“ — тук само малкото име и кратки абзаци (екранът пази новите редове).
  const first = String(name || '').trim().split(/\s+/)[0];
  return [
    `${first ? `Здравей, ${first}!` : 'Здравей!'} Планът е изграден ${goal ? `по целта ти — ${goal.toLowerCase()} — и ` : ''}по навиците, ограниченията и вкусовете, които сподели.`,
    `Тип хранене: ${label}. Около ${kcal} kcal на ден в ${meals} хранения.${free}`,
    `Всяко ястие е с точни количества и рецепта стъпка по стъпка.${hasAlternatives ? ' Не ти харесва? Избери равностойна алтернатива от картата на храненето.' : ''}`,
    'Отбелязвай храненията си. В края на седмицата отговаряш на няколко въпроса и планът се настройва по резултата.',
  ].map(p => p.replace(/[ \t]+/g, ' ').trim()).join('\n\n');
}

export function buildEngineStrategy(engine, userData, options) {
  const { profile, policy, prescription, weekPlan, stats, macros, metabolicPlan } = engine;
  const fasting = metabolicPlan?.fasting || null;
  const dayEnergy = Object.values(weekPlan || {}).map(d => d?.energy).filter(Boolean);
  const trainDays = dayEnergy.filter(e => e.kind === 'train');
  const restDays = dayEnergy.filter(e => e.kind !== 'train');
  const avgOf = (list, k) => Math.round(list.reduce((a, e) => a + e[k], 0) / (list.length || 1));
  const label = dietLabelOf(profile);
  const slots = prescription.slots;
  const name = String(userData?.name || '').trim();
  const perKg = profile.weightKg ? (macros.protein / profile.weightKg).toFixed(1).replace('.', ',') : null;

  const dailyText = ['STA', 'PRO', 'VEG', 'FRU', 'MLK', 'FAT', 'SWT']
    .filter(g => prescription.daily[g] > 0)
    .map(g => `${GROUPS[g].label.toLowerCase()} ${fmt(prescription.daily[g])}`)
    .join('; ');
  const mealsText = slots.map(s => `${MEAL_LABELS[s] || s} ~${round(prescription.meals[s].target.kcal)} kcal`).join(' · ');
  const mainsText = Object.entries(stats.mains || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${CATEGORY_LABELS[k] || k} ×${n}`)
    .join(', ');
  const added = prescription.addedSlots || [];
  const addedNote = added.length
    ? `${added.length > 1 ? 'Добавени са' : 'Добавена е'} ${added.map(s => (MEAL_LABELS[s] || s).toLowerCase()).join(' и ')}, за да са порциите в останалите хранения нормални по размер.`
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
    welcomeMessage: welcomeText({ name, goal: GOALS[profile.goal] || '', label, kcal: options.kcal, meals: slots.length, freeDay: options.freeDayNumber, weekPlan }),
    planJustification: `Дневната схема (в порции): ${dailyText}. Всяко хранене получава своя дял от порциите и ястията се оразмеряват по него — затова калориите и макронутриентите съвпадат с целта при реални, кухненски количества.`,
    longTermStrategy: 'Всяка седмица — кратък контролен преглед: тегло, спазване на плана, глад и енергия. Калориите се коригират с до 150 kcal само когато планът е спазван и резултатът се разминава с очакваното две поредни седмици; иначе се сменя само менюто.',
    mealCountJustification: `${slots.length} хранения: ${slots.map(s => MEAL_LABELS[s] || s).join(', ')}. ${addedNote}`.trim(),
    afterDinnerMealJustification: slots.includes('Хранене 5')
      ? `Късната закуска е лека — около ${round(lateKcal)} kcal, предимно млечна или белтъчна.`
      : 'Не са необходими',
    weeklyMealPattern: `Основни хранения през седмицата: ${mainsText}. Едно ястие се повтаря най-много два пъти седмично.`,
    calorieDistribution: mealsText,
    macroDistribution: `Белтък ${round(macros.protein)} г${perKg ? ` (${perKg} г/кг)` : ''}, въглехидрати ${round(macros.carbs)} г, мазнини ${round(macros.fats)} г средно за деня — според модела „${policy.styleDef.label}“.`
      + (trainDays.length && restDays.length
        ? ` В тренировъчните дни ~${avgOf(trainDays, 'carbs')} г въглехидрати и ~${avgOf(trainDays, 'kcal')} kcal, в почивните ~${avgOf(restDays, 'carbs')} г и ~${avgOf(restDays, 'kcal')} kcal; белтъкът е еднакъв.`
        : ''),
    breakfastStrategy: !slots.includes('Хранене 1')
      ? 'Без закуска — денят започва с първото хранене, а порциите са разпределени в останалите хранения. Сутрин пий вода.'
      : (added.includes('Хранене 1')
        ? 'Лека закуска — разпределя храната равномерно през деня, така че обядът и вечерята да са нормални порции.'
        : 'Закуската съчетава белтък, зърнени и плод или зеленчук.'),
    mealTiming: {
      pattern: `${slots.length} хранения`,
      fastingWindows: fasting?.active
        ? `Нощна пауза около 12 часа всеки ден. В почивните дни храненето е в прозорец ${fasting.windowText}; в тренировъчните — около тренировката. Последното хранене — 2–3 часа преди сън.`
        : 'Нощна пауза около 12 часа (напр. 20:00–08:00); последното хранене — 2–3 часа преди сън.',
      flexibility: '±30–45 мин около обичайните часове.',
      chronotypeGuidance: userData?.chronotype
        ? `Съобразено с хронотип: ${userData.chronotype}.`
        : 'Съобразено със стандартен дневен ритъм.',
    },
    keyPrinciples: [
      policy.styleDef.label,
      'Хранителна схема в обменни порции',
      ...(trainDays.length ? [trainDays.some(e => e.carbsBefore) ? 'Въглехидратите — преди тренировката, след нея белтък и зеленчуци; белтъкът е постоянен' : 'Въглехидратите следват тренировката, белтъкът е постоянен'] : []),
      ...(fasting?.active ? [`Хранене в часови прозорец (${fasting.protocol === 'tre16' ? '16:8' : fasting.protocol === 'tre14' ? '14:10' : '12:12'}) в почивните дни`] : []),
      ...rules.map(r => r.label),
    ],
    // Метаболитната седмица: тренировъчни/почивни дни, горивото, часовият прозорец, качеството на менюто.
    metabolicPlan: metabolicPlan ? {
      principles: metabolicPlan.text || [],
      training: metabolicPlan.training || null,
      fasting: fasting ? { active: fasting.active, offered: fasting.offered, protocol: fasting.protocol, window: fasting.windowText, note: fasting.note, blocked: fasting.blocked } : null,
      days: Object.fromEntries(Object.entries(weekPlan || {}).filter(([, d]) => d?.energy).map(([k, d]) => [k, d.energy])),
      quality: metabolicPlan.quality,
      micro: metabolicPlan.micro || null,
    } : null,
    preferredFoodCategories: recommendationsOf(prescription, stats, policy),
    avoidFoodCategories: avoidOf(profile, policy, blocked),
    foodsToInclude: recommendationsOf(prescription, stats, policy),
    foodsToAvoid: avoidOf(profile, policy, blocked),
    psychologicalSupport: psychologyTipsOf(profile, userData),
    foodGuide: buildFoodGuide(engine, userData, { blockedTerms: blocked }),
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
