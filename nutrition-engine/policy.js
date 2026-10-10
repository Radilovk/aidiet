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

/** @typedef {ReturnType<typeof import('../profile-code.js').compileProfile>} Profile */

/** Рядки продукти (правилото за универсалност): не влизат в плана. */
const MIN_UNIVERSALITY = 3;
const NICHE = /лаврак|патеш|заеш|агнеш|дивеч|амарант|темпе/i;

const MONTH_SEASON = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

export function seasonOf(date = new Date()) {
  return MONTH_SEASON[date.getMonth()];
}

function words(text) {
  return String(text || '')
    .split(/[,;\n/]|\sи\s/)
    .map(s => normalizeFoodKey(s))
    .filter(s => s && s.length >= 3);
}

/** Отказана храна: терминът съвпада с името, етикета или ключа на храната. */
function matchesTerm(f, term) {
  const keys = [normalizeFoodKey(f.name), normalizeFoodKey(f.label)];
  return keys.some(k => k && (k === term || k.includes(term) || (term.includes(k) && k.length >= 4)));
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
 * @param {{ blockedTerms?: string[], loves?: string, adherence?: Map<string, number>|null, date?: Date, sweetsCraving?: boolean, extraExcludeFlags?: string[], onlyFoods?: string[] }} [options]
 */
export function buildFoodPolicy(profile, options = {}) {
  const style = STYLES[profile.diet?.style] ? profile.diet.style : 'balanced';
  const styleDef = STYLES[style];
  const pattern = PATTERNS[profile.diet?.pattern] ? profile.diet.pattern : 'omnivore';
  const rules = activeRules(profile);
  const season = seasonOf(options.date || new Date());

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

  // Списъкът от „Избери храни“: в групите, от които клиентът е избрал нещо,
  // остават само избраните; групите без избор остават свободни.
  const only = (options.onlyFoods || []).flatMap(words);
  const onlyByGroup = new Map();
  if (only.length) {
    for (const f of FOODS.values()) {
      if (f.group === 'FREE' || !only.some(term => matchesTerm(f, term))) continue;
      if (!onlyByGroup.has(f.group)) onlyByGroup.set(f.group, new Set());
      onlyByGroup.get(f.group).add(f.id);
    }
  }

  const allowedCache = new Map();
  /** Позволена ли е храната за този клиент. */
  function allowed(id) {
    if (allowedCache.has(id)) return allowedCache.get(id);
    const f = food(id);
    let ok = f.universality >= MIN_UNIVERSALITY && !NICHE.test(f.name);
    if (ok && pattern === 'vegan') ok = f.vegan;
    if (ok && pattern === 'vegetarian') ok = f.vegetarian;
    if (ok && pattern === 'pescatarian') ok = f.vegetarian || f.kind === 'fish' || f.kind === 'shellfish';
    if (ok && styleDef.ketoOnly) ok = f.group === 'FREE' || f.flags.has('keto');
    if (ok && excludeFoods.has(id)) ok = false;
    if (ok && f.kind && excludeKinds.has(f.kind)) ok = false;
    if (ok) for (const flag of f.flags) if (excludeFlags.has(flag)) { ok = false; break; }
    if (ok && blocked.some(term => matchesTerm(f, term))) ok = false;
    if (ok && onlyByGroup.has(f.group) && !onlyByGroup.get(f.group).has(id)) ok = false;
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
    if (loves.some(term => matchesTerm(f, term))) score += 2;
    const seasons = SEASONS[id];
    if (seasons) score += seasons.includes(season) ? 0.5 : -0.5;
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
    if (rule.fruitWithProtein) fruitWithProtein = true;
  }
  // Кето вече държи въглехидратите под 30 г; равномерното им разпределение е без значение.
  if (style === 'keto') noSweets = true;

  const sport = (profile.activity?.sportBand || 0) >= 2 || profile.goal === 'GAIN' || style === 'high_protein' || pattern === 'vegan';

  // Свободно хранене в събота/неделя за всички — освен при категорични правила.
  const noFree = new Set(['T2D', 'IR', 'CEL', 'GOUT', 'IBD']);
  const allergic = ['NUT', 'PNT', 'SHF', 'FSH', 'EGG', 'SOY'];
  const allowsFreeMeal = style !== 'keto'
    && profile.protocol !== 'autoimmune_aip'
    && !(profile.clinical || []).some(c => noFree.has(c))
    && !(profile.exclusions || []).some(c => allergic.includes(c));

  return {
    allowsFreeMeal,
    // Без списъка „Избери храни“ — когато с него храненето не може да се сглоби.
    withoutOnly: only.length ? () => buildFoodPolicy(profile, { ...options, onlyFoods: [] }) : null,
    style,
    styleDef,
    pattern,
    patternDef: PATTERNS[pattern],
    season,
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
    fruitWithProtein,
    sweets: !!options.sweetsCraving && !noSweets,
    sport,
  };
}
