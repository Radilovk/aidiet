/**
 * Политика на храните за един клиент: какво е позволено, какво се предпочита
 * и кои седмични граници важат. Събира на едно място хранителния модел,
 * етичния модел (веган/вегетарианско), изключванията, клиничните правила,
 * протокола и личните откази — по-надолу никой модул не преценява сам.
 */

import {
  FOODS, STYLES, PATTERNS, CONDITIONS, PROTOCOLS, EXCLUSION_RULES, SEASONS, food,
} from './knowledge.js';
import { normalizeFoodKey } from '../food-utils.js';
import { resolveFoodChoice, restrictedGroupsOf } from './food-choice.js';
import { regionOf, seasonFor, FOREIGN_CUISINE_PENALTY } from './region.js';

/** @typedef {ReturnType<typeof import('../profile-code.js').compileProfile>} Profile */

/** Рядки продукти (правилото за универсалност): не влизат в плана. */
const MIN_UNIVERSALITY = 3;
const NICHE = /лаврак|патеш|заеш|агнеш|дивеч|амарант|темпе/i;

/** Сезонът в северното полукълбо (за клиента — seasonFor от region.js). */
export function seasonOf(date = new Date()) {
  return seasonFor(date, 'north');
}

function words(text) {
  return String(text || '')
    .split(/[,;\n/]|\sи\s/)
    .map(s => normalizeFoodKey(s))
    .filter(s => s && s.length >= 3);
}

/**
 * Сложни имена, в които думата значи друго: овесените ядки не са ядки,
 * фъстъченото/кокосовото масло не е краве масло, растителното мляко не е мляко.
 * Думата се скрива, за да не съвпадне по подниз („ядки“ ↔ „овесени ядки“).
 */
const COMPOUND_WORDS = [
  /(овесени) ядки/gu,
  /(фъстъчено|бадемово|кокосово|слънчогледово|ленено|тиквено|сусамово|лешниково) масло/gu,
  /(растително|соево|кокосово|бадемово|овесено|оризово) мляко/gu,
];
function maskCompounds(key) {
  return COMPOUND_WORDS.reduce((k, re) => k.replace(re, '$1 §'), key);
}

/** Отказана храна: терминът съвпада с името, етикета или ключа на храната. */
export function matchesTerm(f, term) {
  const keys = [normalizeFoodKey(f.name), normalizeFoodKey(f.label)];
  if (keys.includes(term)) return true;
  const t = maskCompounds(term);
  return keys.some(raw => {
    const k = maskCompounds(raw);
    return k && (k === t || k.includes(t) || (t.includes(k) && k.length >= 4));
  });
}

/** Клиничните правила, които важат за профила — състояния и протокол. */
function activeRules(profile) {
  const rules = [];
  const seen = new Set();
  const add = (code) => {
    if (seen.has(code) || !CONDITIONS[code]) return;
    seen.add(code);
    rules.push({ code, ...CONDITIONS[code] });
  };
  for (const code of profile.clinical || []) add(code);
  const protocol = profile.protocol && PROTOCOLS[profile.protocol];
  if (protocol) {
    for (const code of protocol.use || []) add(code);
    if (!protocol.use) rules.push({ code: profile.protocol, ...protocol });
  }
  return rules;
}

/**
 * @param {Profile} profile
 * @param {{ blockedTerms?: string[], loves?: string, adherence?: Map<string, number>|null, date?: Date, sweetsCraving?: boolean, extraExcludeFlags?: string[], onlyFoods?: string[], excludeFoods?: string[], relaxGroups?: string[], region?: ReturnType<typeof regionOf> }} [options]
 */
export function buildFoodPolicy(profile, options = {}) {
  const style = STYLES[profile.diet?.style] ? profile.diet.style : 'balanced';
  const styleDef = STYLES[style];
  const pattern = PATTERNS[profile.diet?.pattern] ? profile.diet.pattern : 'omnivore';
  const rules = activeRules(profile);
  // Къде е клиентът: сезонът по полукълбото (в тропиците — без сезон) и кухнята.
  const region = options.region || regionOf({});
  const season = seasonFor(options.date || new Date(), region.climate);

  const excludeFlags = new Set([...(styleDef.excludeFlags || []), ...(options.extraExcludeFlags || [])]);
  const excludeKinds = new Set();
  const excludeFoods = new Set();
  for (const code of profile.exclusions || []) {
    const rule = EXCLUSION_RULES[code];
    for (const f of rule?.flags || []) excludeFlags.add(f);
    for (const k of rule?.kinds || []) excludeKinds.add(k);
  }
  for (const rule of rules) {
    for (const f of rule.excludeFlags || []) excludeFlags.add(f);
    for (const k of rule.excludeKinds || []) excludeKinds.add(k);
    for (const id of rule.excludeFoods || []) excludeFoods.add(id);
  }

  const blocked = (options.blockedTerms || []).flatMap(words);
  const loves = words(options.loves);

  // Изборът от „Избери храни“ — по точните храни (food-choice.js), не по подниз.
  // userFoodList: в групите, от чиято основна категория клиентът е избрал нещо,
  // остават само избраните; останалите групи са свободни. Избраното се предпочита
  // навсякъде и минава правилото за редки продукти (клиентът го е поискал).
  // userFoodExclude: неизбраните при голям избор — махат се точно те.
  const choice = resolveFoodChoice(options.onlyFoods || []);
  const picked = choice.ids;
  const relaxGroups = new Set(options.relaxGroups || []);
  const restrictedGroups = [...restrictedGroupsOf(picked)].filter(g => !relaxGroups.has(g));
  const restricted = new Set(restrictedGroups);
  const notChosen = resolveFoodChoice(options.excludeFoods || []);
  for (const id of notChosen.ids) if (!picked.has(id)) excludeFoods.add(id);

  const allowedCache = new Map();
  /** Позволена ли е храната за този клиент. */
  function allowed(id) {
    if (allowedCache.has(id)) return allowedCache.get(id);
    const f = food(id);
    let ok = picked.has(id) || (f.universality >= MIN_UNIVERSALITY && !NICHE.test(f.name));
    if (ok && pattern === 'vegan') ok = f.vegan;
    if (ok && pattern === 'vegetarian') ok = f.vegetarian;
    if (ok && pattern === 'pescatarian') ok = f.vegetarian || f.kind === 'fish' || f.kind === 'shellfish';
    if (ok && styleDef.ketoOnly) ok = f.group === 'FREE' || f.flags.has('keto');
    if (ok && excludeFoods.has(id)) ok = false;
    if (ok && f.kind && excludeKinds.has(f.kind)) ok = false;
    if (ok) for (const flag of f.flags) if (excludeFlags.has(flag)) { ok = false; break; }
    // Безлактозните млечни са заместител там, където обикновените са изключени (low-FODMAP).
    if (ok && f.flags.has('lactose_free') && !excludeFlags.has('high_fodmap')) ok = false;
    // Соевото мляко е само за вегани (решение на собственика).
    if (ok && f.flags.has('vegan_only') && pattern !== 'vegan') ok = false;
    if (ok && blocked.some(term => matchesTerm(f, term))) ok = false;
    if (ok && restricted.has(f.group) && !picked.has(id)) ok = false;
    allowedCache.set(id, ok);
    return ok;
  }

  const preferFlags = new Set([...(styleDef.prefer || []), ...rules.flatMap(r => r.prefer || [])]);
  const preferFoods = new Set(styleDef.preferFoods || []);
  const adherence = options.adherence instanceof Map ? options.adherence : null;

  /** Бонус за храна: предпочитания на модела, любими храни, сезон, придържане. */
  function preference(id) {
    const f = food(id);
    let score = 0;
    for (const flag of f.flags) if (preferFlags.has(flag)) score += 1;
    if (preferFoods.has(id)) score += 1.5;
    if (loves.some(term => matchesTerm(f, term)) || picked.has(id)) score += 2;
    const seasons = SEASONS[id];
    if (seasons && season) score += seasons.includes(season) ? 0.5 : -0.5;
    if (adherence) {
      const ratio = adherence.get(normalizeFoodKey(f.nutritionKey));
      if (ratio != null && ratio < 0.6) score -= 2 * (0.6 - ratio) / 0.6;
    }
    return score;
  }

  const mainsMin = {};
  const mainsMax = {};
  const weeklyMax = {};
  const limitFlags = { ...(styleDef.limitFlags || {}) };
  const mealFatMax = {};
  const extraServings = {};
  let distribution = styleDef.distribution;
  let noSweets = false;
  let noLateMeal = false;
  let fruitWithProtein = false;
  for (const rule of rules) {
    for (const [k, v] of Object.entries(rule.mainsMin || {})) mainsMin[k] = Math.max(mainsMin[k] || 0, v);
    for (const [k, v] of Object.entries(rule.mainsMax || {})) mainsMax[k] = Math.min(mainsMax[k] ?? Infinity, v);
    for (const [k, v] of Object.entries(rule.weeklyMax || {})) weeklyMax[k] = Math.min(weeklyMax[k] ?? Infinity, v);
    for (const [k, v] of Object.entries(rule.limitFlags || {})) limitFlags[k] = Math.min(limitFlags[k] ?? Infinity, v);
    for (const [k, v] of Object.entries(rule.mealFatMax || {})) mealFatMax[k] = Math.min(mealFatMax[k] ?? Infinity, v);
    for (const [k, v] of Object.entries(rule.extraServings || {})) extraServings[k] = Math.max(extraServings[k] || 0, v);
    if (rule.distribution && style !== 'keto') distribution = rule.distribution;
    if (rule.noSweets) noSweets = true;
    if (rule.noLateMeal) noLateMeal = true;
    if (rule.fruitWithProtein) fruitWithProtein = true;
  }
  // Кето вече държи въглехидратите под 30 г; равномерното им разпределение е без значение.
  if (style === 'keto') noSweets = true;

  const sport = (profile.activity?.sportBand || 0) >= 2 || profile.goal === 'GAIN' || style === 'high_protein' || pattern === 'vegan';
  // Растителен модел: белтъкът на храните е по-рядък (и с по-ниска усвояемост) —
  // една мерителна лъжица протеин дневно в каша/кисело мляко/шейк допълва целта.
  const proteinBoost = pattern === 'vegan' || pattern === 'vegetarian';

  // Свободно хранене в събота/неделя за всички — освен при категорични правила.
  const noFree = new Set(['T2D', 'IR', 'CEL', 'GOUT', 'IBD']);
  const allergic = ['NUT', 'PNT', 'SHF', 'FSH', 'EGG', 'SOY'];
  const allowsFreeMeal = style !== 'keto'
    && profile.protocol !== 'autoimmune_aip'
    && !(profile.clinical || []).some(c => noFree.has(c))
    && !(profile.exclusions || []).some(c => allergic.includes(c));

  return {
    allowsFreeMeal,
    // Изборът от „Избери храни“: кои храни, кои групи ограничава, какво не е разпознато.
    // relaxGroup — същата политика с една свободна група: когато храненето не се
    // сглобява от избраното, се допълва само липсващата група, не целият каталог.
    choice: {
      picked,
      restrictedGroups,
      unresolved: [...choice.unresolved, ...notChosen.unresolved],
      byName: choice.byName,
    },
    relaxGroup: restrictedGroups.length
      ? (...groups) => buildFoodPolicy(profile, { ...options, relaxGroups: [...relaxGroups, ...groups] })
      : null,
    style,
    styleDef,
    pattern,
    patternDef: PATTERNS[pattern],
    season,
    region,
    /** Ястие от българската кухня за клиент извън дома ѝ — по-рядко, не забранено. */
    dishPenalty: (dish, kind) => (!region.localCuisine && dish.cuisine === 'bg' ? FOREIGN_CUISINE_PENALTY[kind] || 0 : 0),
    rules: rules.map(r => ({ code: r.code, label: r.label, basis: r.basis })),
    allowed,
    preference,
    hasAllowed: (group) => [...FOODS.values()].some(f => f.group === group && allowed(f.id)),
    mainsMin,
    mainsMax,
    weeklyMax,
    limitFlags,
    mealFatMax,
    extraServings,
    distribution,
    noSweets,
    noLateMeal,
    fruitWithProtein,
    sweets: !!options.sweetsCraving && !noSweets,
    sport,
    proteinBoost,
  };
}
