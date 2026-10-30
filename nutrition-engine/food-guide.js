/**
 * Ръководство за храните на клиента — нивата, които стоят между
 * „препоръчително“ и „не“: свободно, умерено (с порция), по избор рядко
 * (позволените непрепоръчителни храни с порция, честота и момент), строго
 * „не“ с причина, замени и поведение в типични ситуации.
 *
 * Всичко се извежда от същата политика, по която е сглобено менюто
 * (policy.js), затова нивата не противоречат на плана: храна, която
 * политиката изключва, никога не попада в „по избор“ или в замените.
 * Текстовете са безлични (без „ти“/„Вие“), за да пасват на тона, който
 * гласът на плана избере.
 */

import { FOODS, CONDITIONS, PROTOCOLS } from './knowledge.js';
import { interactionsFor, treatDeniedByMeds } from '../drug-interactions.js';

const ruleDef = code => CONDITIONS[code] || PROTOCOLS[code] || {};

const fmt = n => String(Math.round(n * 2) / 2).replace('.', ',');

/** Колко е една обменна порция — с примери според модела и изключенията. */
export function portionExample(group, ctx) {
  const { pattern, ex, style } = ctx;
  switch (group) {
    case 'STA':
      if (style === 'keto') return null;
      return ex.has('GLU')
        ? '1 порция = 3–4 с.л. сварен ориз или елда, 1 малък картоф или 1 филийка безглутенов хляб'
        : '1 порция = 1 филия пълнозърнест хляб (30 г), 3–4 с.л. сварен ориз, булгур или паста, или 1 малък картоф';
    case 'FRU':
      return '1 порция = 1 средна ябълка или портокал, 1 чаша горски плодове или 1 малък банан';
    case 'MLK':
      if (pattern === 'vegan' || ex.has('LAC')) return '1 порция = 200 мл обогатено растително мляко или 150 г растителен йогурт';
      return '1 порция = 200 г кисело мляко или кефир, или 200 мл прясно мляко';
    case 'FAT':
      if (ex.has('NUT') && ex.has('PNT')) return '1 порция = 1 ч.л. зехтин или ⅓ авокадо';
      return '1 порция = 1 ч.л. зехтин, 10–12 бадема или 1 с.л. семена';
    case 'PRO':
      if (pattern === 'vegan') return '1 порция = 50 г тофу, ½ чаша сварени бобови или 1 мерителна лъжица растителен протеин';
      if (pattern === 'vegetarian') return '1 порция = 1 яйце, 30 г сирене или ½ чаша сварени бобови';
      return '1 порция = 30 г сготвено месо или риба, 1 яйце или 30 г сирене';
    default:
      return null;
  }
}

// Белтъкът е основата на всяко хранене, а мазнините включват и олиото в
// ястията — като брой порции и двете подвеждат, затова не са тук.
const MODERATE_GROUPS = [
  ['STA', 'Зърнени и картофи'],
  ['FRU', 'Плодове'],
  ['MLK', 'Мляко и кисело мляко'],
];

/** Умерено: дневните порции от схемата с пример какво е една порция. */
function moderateOf(prescription, ctx, policy) {
  const out = [];
  for (const [g, label] of MODERATE_GROUPS) {
    const n = prescription.daily?.[g] || 0;
    if (n <= 0) continue;
    const example = portionExample(g, ctx);
    out.push({
      food: g === 'MLK' && (ctx.pattern === 'vegan' || ctx.ex.has('LAC')) ? 'Растително мляко и йогурт' : label,
      amount: `${fmt(n)} ${n === 1 ? 'порция' : 'порции'} дневно`,
      example,
    });
  }
  if ((prescription.daily?.FAT || 0) > 0) {
    out.push({ food: 'Мазнини и ядки', amount: 'отмерено, не на око', example: portionExample('FAT', ctx) });
  }
  if (policy.weeklyMax?.egg != null && ctx.pattern !== 'vegan' && !ctx.ex.has('EGG')) {
    out.push({ food: 'Яйца', amount: `до ${policy.weeklyMax.egg} седмично`, example: null });
  }
  return out;
}

/** Свободно: подправки, лимон и ненишестени зеленчуци, които политиката позволява. */
/** @type {Array<[string, RegExp]>} */
const FREE_VEG = [
  ['краставици', /краставиц/i], ['маруля и зелени салати', /марул|айсберг|рукол|спанак/i],
  ['домати', /домат(?!ено)/i], ['чушки', /чушк/i], ['тиквички', /тиквичк/i], ['броколи и карфиол', /броколи|карфиол/i],
  ['гъби', /гъб/i], ['зеле', /зеле/i],
];

function freeOf(policy, ctx) {
  const items = [];
  const vegNames = [...FOODS.values()].filter(f => f.group === 'VEG' && policy.allowed(f.id)).map(f => f.name);
  for (const [label, re] of FREE_VEG) {
    if (vegNames.some(n => re.test(n))) items.push(label);
  }
  const herbs = [...FOODS.values()]
    .filter(f => f.group === 'FREE' && policy.allowed(f.id))
    .map(f => f.name.toLowerCase());
  if (herbs.length) items.push(`подправки и овкусители (${herbs.slice(0, 5).join(', ')})`);
  items.push(ctx.style === 'keto' ? 'вода, неподсладен чай и кафе' : 'вода, неподсладен чай и кафе (без захар)');
  return items;
}

/* ── Строго „не“ ──────────────────────────────────────────────────────── */

const EXCLUSION_TEXT = {
  GLU: ['глутен (пшеница, ръж, ечемик, булгур, кус-кус)', 'непоносимост към глутен'],
  LAC: ['прясно мляко и млечни продукти с лактоза', 'непоносимост към лактоза'],
  EGG: ['яйца и храни с яйца', 'алергия или непоносимост'],
  NUT: ['ядки', 'алергия или непоносимост'],
  PNT: ['фъстъци и фъстъчено масло', 'алергия или непоносимост'],
  FSH: ['риба', 'алергия или непоносимост'],
  SHF: ['морски дарове', 'алергия или непоносимост'],
  SOY: ['соя и соеви продукти', 'алергия или непоносимост'],
  PORK: ['свинско', 'по твой избор'],
};

const FLAG_TEXT = {
  high_gi: 'бял хляб, бял ориз, картофено пюре и други храни с висок гликемичен индекс',
  fatty_meat: 'тлъсти меса, колбаси и сланина',
  high_purine: 'карантии, сардини, аншоа и месни бульони',
  high_fodmap: 'храни с високо FODMAP (лук, чесън, пшеница, повечето бобови)',
  high_mercury: 'риба меч, акула и голяма риба тон',
  gluten: 'глутен',
  oats: 'овес (може да е замърсен с глутен)',
};

const PATTERN_IMPLIES = {
  vegan: new Set(['LAC', 'EGG', 'FSH', 'SHF']),
  vegetarian: new Set(['FSH', 'SHF']),
};
/** Отказите, които моделът вече покрива — да не се повтарят като „не ги приемате“. */
const PATTERN_TERMS = {
  vegan: /мес|млеч|мляк|сирен|риб|яйц|^мед/i,
  vegetarian: /мес|риб/i,
  pescatarian: /мес/i,
};

const PATTERN_TEXT = {
  vegan: ['месо, риба, яйца, мляко и мед', 'веганско хранене'],
  vegetarian: ['месо и риба', 'вегетарианско хранене'],
  pescatarian: ['месо (рибата е позволена)', 'пескетарианско хранене'],
};

function strictOf(profile, policy, ctx, blockedTerms) {
  const out = [];
  const seen = new Set();
  const add = (food, reason) => {
    const key = food.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ food, reason });
  };
  const celiac = (profile.clinical || []).includes('CEL');
  // Изключенията, които следват от модела (веган → без мляко, яйца, риба),
  // са избор, не алергия — описва ги редът за модела по-долу.
  const implied = PATTERN_IMPLIES[policy.pattern] || new Set();
  for (const code of profile.exclusions || []) {
    const t = EXCLUSION_TEXT[code];
    if (!t || implied.has(code)) continue;
    add(t[0], code === 'GLU' && celiac ? 'цьолиакия' : t[1]);
  }
  if (PATTERN_TEXT[policy.pattern]) add(...PATTERN_TEXT[policy.pattern]);
  if (policy.style === 'keto') add('захар, зърнени храни, картофи и сладки плодове', 'кето хранене');

  for (const rule of policy.rules || []) {
    const full = ruleDef(rule.code);
    for (const flag of full.excludeFlags || []) {
      if (FLAG_TEXT[flag]) add(FLAG_TEXT[flag], rule.label);
    }
    const names = (full.excludeFoods || [])
      .map(id => FOODS.get(id)?.name)
      .filter(Boolean)
      .map(n => n.toLowerCase());
    if (names.length) add(names.join(', '), rule.label);
  }
  if (policy.noSweets && policy.style !== 'keto') {
    const why = (policy.rules || []).filter(r => ruleDef(r.code).noSweets).map(r => r.label);
    add('сладкиши и добавена захар', why.length ? why.join(', ') : (policy.style === 'keto' ? 'кето хранене' : 'здравословното състояние'));
  }
  // Лекарствата — с името на лекарството като причина, преди свободния списък.
  for (const rule of ctx.meds.rules) {
    if (rule.blockFoods?.length) add(rule.blockFoods.join(', '), `взаимодейства с ${rule.label}`);
  }
  for (const term of blockedTerms || []) {
    const t = String(term || '').trim().toLowerCase();
    if (PATTERN_TERMS[policy.pattern]?.test(t)) continue;
    // Вече изброено (изключение или клинично правило) — сравнение по корен на думата.
    const stem = t.slice(0, 4);
    if (stem.length >= 4 && out.some(x => x.food.toLowerCase().includes(stem))) continue;
    if (t && t.length <= 40) add(t, 'не ги приемаш');
  }
  return out;
}

/* ── По избор, рядко: позволените непрепоръчителни храни ─────────────── */

/**
 * Каталог на „удоволствията“. Всеки запис казва кога НЕ е позволен; иначе
 * влиза с порция, честота и най-добър момент. Свободното хранене се
 * споменава само когато планът го има.
 */
const TREATS = [
  {
    food: 'Черен шоколад (70%+)',
    portion: '20 г (2–3 блокчета)',
    frequency: 'до 3 пъти седмично',
    when: 'след хранене, не на гладно',
    deny: c => c.policy.noSweets || c.excluded('sw_dark_chocolate'),
  },
  {
    food: 'Десерт или сладкиш',
    portion: '1 малко парче',
    frequency: '1 път седмично',
    when: c => (c.free ? 'в свободното хранене' : 'след основно хранене'),
    deny: c => c.policy.noSweets || c.style === 'keto' || c.style === 'low_carb',
  },
  {
    food: 'Сладолед',
    portion: '1 топка',
    frequency: '1 път седмично',
    when: 'след обяд, не вечер',
    deny: c => c.policy.noSweets || c.style === 'keto' || c.ex.has('LAC') || c.pattern === 'vegan',
  },
  {
    food: 'Пица, бургер или дюнер',
    portion: '1 нормална порция със салата',
    frequency: '1 път седмично',
    when: 'в свободното хранене',
    deny: c => !c.free || c.ex.has('GLU') || c.style === 'keto',
  },
  {
    food: 'Бял хляб, баница или кифла',
    portion: '1 филия или 1 парче',
    frequency: 'до 2 пъти седмично',
    when: 'заедно с белтък и зеленчуци',
    deny: c => c.ex.has('GLU') || c.flagExcluded('high_gi') || c.style === 'keto' || c.style === 'low_carb',
  },
  {
    food: 'Чипс или солени снаксове',
    portion: 'малка купичка (30 г)',
    frequency: '1 път седмично',
    when: 'на масата, не пред екрана',
    deny: c => c.limit('salty') != null || c.style === 'dash' || c.flagExcluded('high_gi') || c.inflammatory || c.lowCarb,
  },
  {
    food: 'Колбаси и деликатеси',
    portion: '2–3 резена',
    frequency: '1 път седмично',
    when: 'със салата, не всеки ден',
    deny: c => c.flagExcluded('fatty_meat') || c.pattern !== 'omnivore' || c.ex.has('PORK') || c.inflammatory,
  },
  {
    food: 'Пържени храни',
    portion: '1 порция',
    frequency: '1 път седмично',
    when: c => (c.free ? 'в свободното хранене' : 'на обяд'),
    deny: c => c.has('GERD') || c.has('GAST') || c.has('NAFLD') || c.has('IBD') || c.inflammatory,
  },
  {
    food: 'Сладка газирана напитка или сок',
    portion: '1 малка чаша (250 мл)',
    frequency: 'рядко — по-добре вариантът без захар',
    when: 'с храна',
    deny: c => c.policy.noSweets || c.style === 'keto',
  },
  {
    food: 'Алкохол',
    portion: '1 питие (чаша вино 150 мл или бира 330 мл)',
    frequency: 'до 2 пъти седмично, не в поредни дни',
    when: 'с храна, с чаша вода след него',
    deny: c => c.noAlcohol || ['GOUT', 'NAFLD', 'PP', 'DEP', 'ANX', 'GERD', 'IBD'].some(code => c.has(code)),
  },
];

function occasionalOf(policy, ctx) {
  const out = [];
  // Автоимунният протокол е елиминационен — „по избор“ няма, докато трае.
  if (ctx.profile.protocol === 'autoimmune_aip') return out;
  for (const t of TREATS) {
    if (t.deny(ctx) || treatDeniedByMeds(t.food, ctx.meds)) continue;
    out.push({
      food: t.food,
      portion: t.portion,
      frequency: t.frequency,
      when: typeof t.when === 'function' ? t.when(ctx) : t.when,
    });
  }
  // Ограниченията от клиничните правила — като „рядко“, с точната честота.
  const lim = policy.limitFlags || {};
  if (lim.high_gi_fruit != null) {
    out.push({ food: 'Банан, грозде, диня, сушени плодове', portion: '1 порция (1 малък банан, 1 чаша грозде, 1 резен диня или 2–3 сушени плода)', frequency: `до ${lim.high_gi_fruit} пъти седмично`, when: 'с белтък или кисело мляко' });
  }
  if (lim.high_gi != null && !ctx.flagExcluded('high_gi')) {
    out.push({ food: 'Бял ориз, бял хляб, картофи', portion: '1 порция (3–4 с.л. сварен ориз, 1 филия или 1 малък картоф)', frequency: `до ${lim.high_gi} пъти седмично`, when: 'със зеленчуци и белтък' });
  }
  if (lim.salty != null) {
    out.push({ food: 'Солени храни (сирене, маслини, туршии)', portion: '1 малка порция (30 г сирене или 5–6 маслини)', frequency: `до ${lim.salty} пъти седмично`, when: 'без допълнително солене' });
  }
  return out.slice(0, 10);
}

/* ── Замени ────────────────────────────────────────────────────────────── */

const SWAPS = [
  { from: 'Сладка газирана напитка', to: 'газирана вода с лимон и мента' },
  { from: 'Плодов сок', to: 'цял плод — има фибри и засища', deny: c => c.style === 'keto' },
  { from: 'Бял хляб', to: c => (c.ex.has('GLU') ? 'безглутенов хляб с пълнозърнесто брашно' : 'пълнозърнест или ръжен хляб'), deny: c => c.style === 'keto' },
  { from: 'Чипс', to: c => (c.style === 'keto'
    ? (c.ex.has('NUT') ? 'краставици и чушки с гуакамоле' : 'шепа ядки или семена (20 г)')
    : (c.ex.has('NUT') ? 'печен нахут с подправки' : 'печен нахут или шепа ядки (20 г)')) },
  { from: 'Майонеза', to: c => (c.ex.has('LAC') || c.pattern === 'vegan' ? 'хумус или горчица' : 'кисело мляко с чесън и копър') },
  { from: 'Пържено', to: 'печено във фурна или на въздушен фритюрник' },
  { from: 'Колбас в сандвича', to: c => (c.pattern === 'vegan' ? 'хумус и печени зеленчуци' : c.pattern === 'vegetarian' ? 'яйце или сирене' : 'печено пилешко филе'), deny: c => c.ex.has('EGG') && c.pattern === 'vegetarian' },
  { from: 'Млечен шоколад', to: c => (c.style === 'keto' ? 'черен шоколад 85%+ (10 г)'
    : c.excluded('sw_dark_chocolate') || c.policy.noSweets ? 'плод с канела' : 'черен шоколад 70%+') },
  { from: 'Десерт вечер', to: c => (c.style === 'keto'
    ? (c.ex.has('LAC') || c.pattern === 'vegan' ? 'кокосов йогурт с канела' : 'гъсто кисело мляко с канела и ядки')
    : c.ex.has('LAC') || c.pattern === 'vegan' ? 'печена ябълка с канела' : 'кисело мляко с канела и малко плод') },
  { from: 'Подсладено кафе', to: c => (c.ex.has('LAC') || c.pattern === 'vegan' ? 'кафе с канела или растително мляко, без захар' : 'кафе с канела или малко мляко, без захар') },
  { from: 'Бира', to: 'безалкохолна бира или газирана вода с лайм', deny: c => c.noAlcohol || !!treatDeniedByMeds('алкохол', c.meds) },
];

function swapsOf(ctx) {
  const out = [];
  for (const s of SWAPS) {
    if (s.deny && s.deny(ctx)) continue;
    const to = typeof s.to === 'function' ? s.to(ctx) : s.to;
    if (to) out.push({ from: s.from, to });
  }
  return out.slice(0, 10);
}

/* ── Ситуации ──────────────────────────────────────────────────────────── */

function situationsOf(profile, ctx) {
  const b = new Set(profile.behaviors || []);
  const out = [];
  out.push({
    title: 'Хранене навън',
    text: 'Ястие с ясен източник на белтък и зеленчуци; сосовете — отделно; хлябът — една филия или без него. Едно хранене навън не проваля седмицата.',
  });
  out.push({
    title: 'Празник или гости',
    text: `Нормално хранене преди събитието, на масата — първо салата и белтък, после останалото. ${ctx.free ? 'Ако денят съвпадне със свободното хранене — то е тогава.' : 'Сладкото — малка порция или плод.'}`,
  });
  out.push({
    title: 'Път или натоварен ден',
    text: 'Предварително подготвена храна (кутия с белтък, зеленчуци и зърнени), плод и вода в чантата. На бензиностанция — сандвич с пълнозърнест хляб или кисело мляко вместо тестено.',
  });
  if (b.has('EVE') || b.has('OVR')) {
    out.push({
      title: 'Силен глад вечер',
      text: 'Обикновено е следствие от твърде малко храна през деня — редовните обяд и следобедна закуска са най-сигурната защита. Ако гладът дойде: голяма чаша вода, после зеленчуци или кисело мляко.',
    });
  }
  if (b.has('EMO') || b.has('SWS') || b.has('SWT')) {
    out.push({
      title: 'Внезапно желание за храна',
      text: 'Пауза от 10 минути и въпросът „глад ли е, или умора, напрежение, скука?“. При истински глад — следващото хранене от плана или плод; иначе вода, разходка или разговор.',
    });
  }
  out.push({
    title: 'След преяждане',
    text: 'Следващото хранене е по плана — без пропускане и без „компенсиране“. Гладуването след преяждане засилва следващия пристъп.',
  });
  out.push({
    title: 'Когато теглото стои',
    text: 'Колебанията от ден на ден са вода и сол. Сравнява се седмица със седмица; при две поредни седмици без промяна и спазен план планът се коригира в седмичния преглед.',
  });
  return out.slice(0, 6);
}

/**
 * @param {object} engine — резултатът на buildNutritionPlan (profile, policy, prescription)
 * @param {object} userData
 * @param {{ blockedTerms?: string[] }} [options]
 */
export function buildFoodGuide(engine, userData, options = {}) {
  const { profile, policy, prescription } = engine;
  const ex = new Set(profile.exclusions || []);
  const clinical = new Set(profile.clinical || []);
  const excludeFlags = new Set();
  for (const rule of policy.rules || []) for (const f of ruleDef(rule.code).excludeFlags || []) excludeFlags.add(f);
  const drinks = String(userData?.drinksAlcohol || '').trim().toLowerCase();
  const ctx = {
    profile,
    policy,
    ex,
    pattern: policy.pattern,
    style: policy.style,
    free: !!policy.allowsFreeMeal,
    has: code => clinical.has(code),
    excluded: id => FOODS.has(id) && !policy.allowed(id),
    flagExcluded: flag => excludeFlags.has(flag),
    limit: flag => (policy.limitFlags || {})[flag] ?? null,
    // Противовъзпалителен модел или автоимунно състояние: без преработено и пържено.
    inflammatory: policy.style === 'anti_inflammatory' || clinical.has('AI') || clinical.has('INFL'),
    lowCarb: policy.style === 'keto' || policy.style === 'low_carb',
    // Не пие — алкохол не се предлага дори като „по избор“.
    noAlcohol: !drinks || /^не|никога|не пия/.test(drinks),
    meds: interactionsFor(userData || {}),
  };
  return {
    v: 1,
    free: freeOf(policy, ctx),
    moderate: moderateOf(prescription, ctx, policy),
    occasional: occasionalOf(policy, ctx),
    strict: strictOf(profile, policy, ctx, options.blockedTerms),
    swaps: swapsOf(ctx),
    situations: situationsOf(profile, ctx),
  };
}
