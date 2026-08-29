/**
 * Culinary compatibility layer — what belongs on a plate together.
 *
 * The pipeline optimises kcal and macros; nothing in that arithmetic knows that
 * fish and yoghurt do not go together, or that a plate needs one starch rather
 * than three. This module holds that knowledge as data: a food is classified
 * into a culinary kind, and rules are written over kinds, not over ad-hoc
 * regexes per rule.
 *
 * Bulgarian text note: JavaScript's `\b` is defined over `[A-Za-z0-9_]`, so it
 * never matches at a Cyrillic boundary — `/\bмед\b/` silently tests false for
 * every Bulgarian string. Use `hasWord()` here instead of a `\b` pattern.
 */

/** Unicode-aware word boundary: no letter or digit either side of the term. */
const BOUNDARY = '(?:^|[^\\p{L}\\p{N}])';
const BOUNDARY_END = '(?:$|[^\\p{L}\\p{N}])';

const wordCache = new Map();

/** True when `term` appears in `text` as a whole word (Cyrillic-safe). */
export function hasWord(text, term) {
  const t = String(term || '').trim();
  if (!t) return false;
  let re = wordCache.get(t);
  if (!re) {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`${BOUNDARY}${escaped}${BOUNDARY_END}`, 'iu');
    wordCache.set(t, re);
  }
  return re.test(String(text || ''));
}

/** True when any term appears as a whole word. */
export function hasAnyWord(text, terms) {
  return terms.some(term => hasWord(text, term));
}

/** Terms matched anywhere (stems, so inflections are covered). */
function hasStem(text, stems) {
  const lower = String(text || '').toLowerCase();
  return stems.some(stem => lower.includes(stem));
}

/**
 * Culinary kinds. A food may belong to several (chickpeas are legume + starch).
 * Stems, not full words — Bulgarian inflects heavily.
 */
export const FOOD_KIND_STEMS = {
  starch: ['ориз', 'картоф', 'паста', 'макарон', 'спагет', 'овес', 'булгур', 'хляб',
    'киноа', 'елда', 'кус-кус', 'просо', 'тортила', 'царевиц', 'батат', 'каша'],
  legume: ['боб', 'леща', 'нахут', 'грах', 'едамаме', 'фасул'],
  redMeat: ['говежд', 'свинск', 'телешк', 'агнешк', 'кайма'],
  poultry: ['пилешк', 'пиле', 'пуешк', 'пуйка'],
  fish: ['риба', 'сьомга', 'тон', 'треска', 'скумри', 'тилапи', 'лаврак', 'скариди', 'калмар'],
  egg: ['яйц', 'белтъц', 'омлет'],
  freshDairy: ['кисело мляко', 'кефир', 'скир', 'айран', 'гръцко кисело', 'извара', 'пробиотично'],
  cheese: ['сирене', 'кашкавал', 'моцарел', 'пармезан', 'фета'],
  sweetFruit: ['банан', 'ябълк', 'портокал', 'мандарин', 'грозде', 'круша', 'праскова',
    'диня', 'пъпеш', 'ананас', 'манго', 'киви', 'смокин'],
  berry: ['ягод', 'боровинк', 'малин', 'къпин'],
  vegetable: ['зеленчук', 'домат', 'краставиц', 'чушк', 'морков', 'броколи', 'спанак',
    'маруля', 'тиквич', 'карфиол', 'зеле', 'гъб', 'патладжан', 'целина', 'рукола',
    'салат', 'праз', 'репичк', 'аспержи', 'кресон', 'айсберг', 'портобело', 'еринги'],
  nut: ['бадем', 'орех', 'кашу', 'лешниц', 'шамфъстък', 'пекан', 'макадами', 'фъстъц'],
  seed: ['семк', 'семе', 'чиа'],
  oil: ['зехтин', 'олио', 'гхи', 'кокосово масло', 'слънчогледово масло'],
  nutButter: ['фъстъчено масло', 'бадемово масло', 'тахан'],
  butter: ['масло'],
  sweetener: ['мед', 'захар', 'сироп', 'конфитюр', 'нектар'],
  sauce: ['кетчуп', 'майонез', 'горчиц', 'синап', 'лютениц', 'песто', 'салса', 'соев сос'],
};

/** @param {string} name @returns {Set<string>} */
export function kindsOf(name) {
  const out = new Set();
  for (const [kind, stems] of Object.entries(FOOD_KIND_STEMS)) {
    if (hasStem(name, stems)) out.add(kind);
  }
  return out;
}

/** Kinds present across a list of product names. */
export function kindsIn(names) {
  const out = new Map();
  for (const name of names) {
    for (const kind of kindsOf(name)) {
      if (!out.has(kind)) out.set(kind, []);
      out.get(kind).push(name);
    }
  }
  return out;
}

/**
 * Pairs of kinds that do not belong in the same dish.
 * `reason` is written for the client-facing retry comment.
 */
export const INCOMPATIBLE_KIND_PAIRS = [
  { a: 'fish', b: 'freshDairy', reason: 'риба с кисело-млечен продукт' },
  { a: 'fish', b: 'sweetFruit', reason: 'риба със сладък плод' },
  { a: 'fish', b: 'cheese', reason: 'риба със сирене/кашкавал' },
  { a: 'redMeat', b: 'freshDairy', reason: 'червено месо с кисело-млечен продукт' },
  { a: 'redMeat', b: 'sweetFruit', reason: 'червено месо със сладък плод' },
  { a: 'poultry', b: 'sweetFruit', reason: 'птиче месо със сладък плод' },
  { a: 'fish', b: 'legume', reason: 'риба с бобови' },
  { a: 'egg', b: 'sweetFruit', reason: 'яйца със сладък плод' },
  { a: 'sweetener', b: 'fish', reason: 'подсладител с риба' },
  { a: 'sweetener', b: 'redMeat', reason: 'подсладител с червено месо' },
  { a: 'sweetener', b: 'poultry', reason: 'подсладител с птиче месо' },
  // A sweet bowl is not a place for vegetables, and a nut butter is not a
  // topping for a savoury plate — both crept in when the composer filled an
  // energy gap with whatever was densest.
  { a: 'sweetFruit', b: 'vegetable', reason: 'сладък плод със зеленчук в едно ястие' },
  { a: 'berry', b: 'vegetable', reason: 'горски плод със зеленчук в едно ястие' },
  { a: 'nutButter', b: 'vegetable', reason: 'ядково масло със зеленчук' },
  { a: 'nutButter', b: 'fish', reason: 'ядково масло с риба' },
  { a: 'nutButter', b: 'redMeat', reason: 'ядково масло с червено месо' },
  { a: 'nutButter', b: 'poultry', reason: 'ядково масло с птиче месо' },
  { a: 'nutButter', b: 'freshDairy', reason: 'ядково масло с кисело-млечен продукт' },
];

/** At most this many products of a kind in one dish. */
export const KIND_COUNT_LIMITS = [
  { kind: 'starch', max: 1, reason: 'повече от един въглехидратен източник' },
  { kind: 'redMeat', max: 1, reason: 'повече от един вид червено месо' },
  { kind: 'fish', max: 1, reason: 'повече от един вид риба' },
  { kind: 'freshDairy', max: 1, reason: 'повече от един кисело-млечен продукт' },
  { kind: 'oil', max: 1, reason: 'повече от една добавена мазнина' },
  { kind: 'nutButter', max: 1, reason: 'повече от едно ядково масло' },
];

/** Kinds that must not appear in a plated meal at all. */
export const FORBIDDEN_KINDS_IN_MEAL = [
  { kind: 'sweetener', reason: 'подсладител в основно хранене' },
  { kind: 'sauce', reason: 'готов сос/подправка като съставка на хранене' },
];

/**
 * Check one meal's product list.
 * @param {string[]} productNames
 * @param {{ allowSweetener?: boolean, slotType?: string }} [options]
 * @returns {string[]} human-readable issues
 */
export function checkProductCompatibility(productNames, options = {}) {
  const names = (productNames || []).map(n => String(n || '').toLowerCase()).filter(Boolean);
  if (!names.length) return [];
  const issues = [];
  const kinds = kindsIn(names);

  for (const { kind, reason } of FORBIDDEN_KINDS_IN_MEAL) {
    if (kind === 'sweetener' && options.allowSweetener) continue;
    const hits = kinds.get(kind);
    if (hits?.length) issues.push(`${reason} (${[...new Set(hits)].join(', ')})`);
  }

  for (const { kind, max, reason } of KIND_COUNT_LIMITS) {
    const hits = kinds.get(kind);
    if (hits && new Set(hits).size > max) {
      issues.push(`${reason} (${[...new Set(hits)].join(', ')})`);
    }
  }

  // Starch + legume is one starch too many; two starches are already reported
  // by the count limit above, so only flag the cross-kind case here.
  const starches = new Set(kinds.get('starch') || []);
  const legumes = new Set(kinds.get('legume') || []);
  const crossOnly = [...legumes].filter(n => !starches.has(n));
  if (starches.size >= 1 && crossOnly.length) {
    issues.push(`нишесте и бобови заедно (${[...starches, ...crossOnly].join(', ')})`);
  }

  for (const { a, b, reason } of INCOMPATIBLE_KIND_PAIRS) {
    const hitsA = kinds.get(a);
    const hitsB = kinds.get(b);
    if (!hitsA?.length || !hitsB?.length) continue;
    // One product carrying both kinds (a fish salad) is not a clash.
    const distinct = new Set([...hitsA, ...hitsB]);
    if (distinct.size < 2) continue;
    issues.push(`${reason} (${[...distinct].join(' + ')})`);
  }

  return issues;
}
