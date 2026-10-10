/**
 * Сглобяване на едно хранене: ястие + гарнитури, оразмерени по порциите,
 * които схемата дава на храненето.
 *
 * Редът е този на диетолога: зеленчуците, плодовете и млечните са по
 * схемата; зърнените (и бобовите) покриват въглехидратите, белтъчните —
 * белтъка, мазнините — остатъка. После всяка оразмеряема съставка се мести
 * с по една кухненска стъпка, докато храненето се доближава до целта си.
 * Ястието никога не излиза от диапазона на рецептата си: каквото не се
 * побира в него, отива в гарнитура (хляб, салата, плод) или в следващото
 * хранене.
 */

import { food, nutrientsOf, SIDES } from './knowledge.js';
import { portionSteps, snapPortion, neighbourPortion, portionLine } from './portions.js';
import { maxPortionGrams, isCookingFat, COOKING_FAT_MAX_PORTION_G } from '../portion-limits.js';

/** @typedef {import('./knowledge.js').Dish} Dish */
/** @typedef {{ protein: number, carbs: number, fats: number, kcal?: number }} Target */

/**
 * @typedef {object} PartInstance
 * @property {string} group
 * @property {string[]} foods
 * @property {number[]} grams
 * @property {number} lo   минимум за частта в грамове
 * @property {number} hi   максимум за частта в грамове
 * @property {boolean} with
 * @property {boolean} adjustable
 * @property {string|null} side
 * @property {string|null} sideName
 * @property {number} weight
 */

/** Групите, чиито количества се донастройват по целта. */
const ADJUSTABLE = new Set(['STA', 'LEG', 'PRO', 'FAT']);
/** Групите, чиито порции растат с апетита на клиент с голям разход. */
const APPETITE_GROUPS = new Set(['STA', 'LEG', 'PRO', 'VEG']);

function totalsOf(parts, fixed) {
  const t = { kcal: 0, protein: 0, carbs: 0, fats: 0 };
  const add = (id, g) => {
    if (!(g > 0)) return;
    const n = nutrientsOf(id, g);
    for (const k of Object.keys(t)) t[k] += n[k];
  };
  for (const p of parts) p.foods.forEach((id, i) => add(id, p.grams[i]));
  for (const [id, g] of fixed) add(id, g);
  return t;
}

/**
 * Колко далеч е храненето от целта — относителни отклонения с тегла.
 * При кето и нисковъглехидратно въглехидратите са таван, не цел: под тях
 * почти не се наказва, над тях — както обикновено.
 */
export function mealError(t, target, carbsCap = false) {
  const kcalT = target.protein * 4 + target.carbs * 4 + target.fats * 9;
  const kcal = t.protein * 4 + t.carbs * 4 + t.fats * 9;
  const rel = (a, b, floor) => (a - b) / Math.max(b, floor);
  const carbs = rel(t.carbs, target.carbs, carbsCap ? 20 : 12);
  return rel(kcal, kcalT, 80) ** 2 * 1.0
    + rel(t.protein, target.protein, 10) ** 2 * 2.2
    + carbs ** 2 * (carbsCap ? (carbs < 0 ? 0.15 : 1.6) : 0.8)
    + rel(t.fats, target.fats, 6) ** 2 * 0.8;
}

function servingOf(foods) {
  return foods.reduce((a, id) => a + food(id).serving, 0) / foods.length;
}

/** Задава общия грамаж на част — сместа се дели поравно, всяка храна на своята стъпка. */
function setPartGrams(part, total) {
  const n = part.foods.length;
  const clamped = Math.min(part.hi, Math.max(part.lo, total));
  part.grams = part.foods.map(id => {
    const lo = part.lo / n;
    const hi = part.hi / n;
    return clamped > 0 ? snapPortion(id, clamped / n, lo, hi) : 0;
  });
}

function partTotal(part) {
  return part.grams.reduce((a, b) => a + b, 0);
}

/**
 * Таван на една храна в едно хранене — реалистичната порция от
 * portion-limits.js. Мазнината за готвене е 10 г; при кето — до 20 г,
 * защото там тя носи енергията.
 */
function foodCap(id, fatScale) {
  const f = food(id);
  if (isCookingFat(f.name, f.nutritionKey)) return COOKING_FAT_MAX_PORTION_G * Math.min(2, fatScale);
  return maxPortionGrams({ name: f.name, nutritionKey: f.nutritionKey, group: CATALOG_GROUP[f.group] });
}

/** Обменна група → група на каталога (за таваните на порциите). */
const CATALOG_GROUP = {
  STA: 'carb', LEG: 'legume', FRU: 'fruit', VEG: 'vegetable', MLK: 'dairy',
  PRO: 'protein', FAT: 'fat', SWT: 'condiment', FREE: 'condiment',
};

function makePart(group, foods, range, extra = {}, fatScale = 1) {
  const serving = servingOf(foods);
  const cap = foods.reduce((a, id) => a + foodCap(id, fatScale), 0);
  return {
    group,
    foods,
    grams: foods.map(() => 0),
    lo: Math.min(range[0] * serving, cap),
    hi: Math.min(range[1] * serving, cap),
    with: false,
    adjustable: ADJUSTABLE.has(group),
    side: null,
    sideName: null,
    weight: 1,
    ...extra,
  };
}

/** Капацитет на ястието по група — в порции. */
export function capacity(parts, group) {
  let cap = 0;
  for (const p of parts) {
    const servings = p.hi / servingOf(p.foods);
    if (p.group === group) cap += servings;
    if (p.group === 'LEG' && (group === 'STA' || group === 'PRO')) cap += servings;
  }
  return cap;
}

/** Най-добрият позволен вариант на гарнитура по реда на предпочитанията. */
function pickSideFood(options, ctx) {
  const allowed = options.filter(id => ctx.policy.allowed(id));
  if (!allowed.length) return null;
  return allowed
    .map((id, i) => ({ id, score: ctx.preferenceOf(id) - ctx.usageOf(id) * 0.8 - i * 0.05 }))
    .sort((a, b) => b.score - a.score)[0].id;
}

function pickSalad(ctx) {
  const salads = SIDES.salad.salads.filter(s => s.foods.every(id => ctx.policy.allowed(id)));
  if (!salads.length) return null;
  return salads
    .map((s, i) => ({
      s,
      score: s.foods.reduce((a, id) => a + ctx.preferenceOf(id), 0) / s.foods.length
        - (ctx.usageOf(`salad:${s.name.toLowerCase()}`) * 1.5) - i * 0.02,
    }))
    .sort((a, b) => b.score - a.score)[0].s;
}

/**
 * Гарнитурите, които храненето има нужда — по разликата между порциите на
 * схемата и капацитета на ястието.
 */
function sideParts(dish, parts, quota, mealKind, ctx) {
  const allowedSides = new Set(dish.sides);
  const out = [];
  const short = (g) => (quota[g] || 0) - capacity(parts, g);
  const sideAllowed = (key) => allowedSides.has(key) && SIDES[key].meals.includes(mealKind);

  if (sideAllowed('bread') && short('STA') >= 0.75) {
    const id = pickSideFood(SIDES.bread.options, ctx);
    if (id) out.push(makePart('STA', [id], [0.5, Math.min(3 * (ctx.appetite || 1), short('STA') + 0.5)], { side: 'bread', sideName: food(id).label }));
  }
  const vegShort = ((quota.VEG || 0) * 100 - capacity(parts, 'VEG') * 100);
  if (sideAllowed('salad') && vegShort >= 60) {
    const salad = pickSalad(ctx);
    if (salad) {
      const servings = Math.min(3, vegShort / 100 + 0.5);
      out.push(makePart('VEG', salad.foods, [0.5, servings], { side: 'salad', sideName: salad.name.toLowerCase() }));
      if (ctx.policy.allowed(SIDES.salad.dressing)) {
        const [lo, hi] = SIDES.salad.dressingRange;
        const scale = ctx.policy.styleDef.fatPartScale || 1;
        out.push(makePart('FAT', [SIDES.salad.dressing], [lo, hi * scale], { side: 'dressing' }, scale));
      }
    }
  }
  // Плодът е цял плод или купичка — не половин шепа грозде.
  if (sideAllowed('fruit') && short('FRU') >= 0.75) {
    const id = pickSideFood(SIDES.fruit.options, ctx);
    if (id) out.push(makePart('FRU', [id], [0.9, Math.max(1, Math.min(1.5, short('FRU') + 0.25))], { side: 'fruit', sideName: food(id).label }));
  }
  if (sideAllowed('yogurt') && short('MLK') >= 0.5) {
    const id = pickSideFood(SIDES.yogurt.options, ctx);
    if (id) out.push(makePart('MLK', [id], [0.5, Math.min(1.5, short('MLK') + 0.25)], { side: 'yogurt', sideName: food(id).label }));
  }
  if (sideAllowed('cheese') && short('PRO') >= 1.5) {
    const id = pickSideFood(SIDES.cheese.options, ctx);
    if (id) out.push(makePart('PRO', [id], SIDES.cheese.range, { side: 'cheese', sideName: food(id).label }));
  }
  if (sideAllowed('nuts') && short('FAT') >= 1) {
    const id = pickSideFood(SIDES.nuts.options, ctx);
    if (id) out.push(makePart('FAT', [id], [0.5, Math.min(2, short('FAT'))], { side: 'nuts', sideName: food(id).label }));
  }
  // При много мазнини в схемата (кето) чинията получава авокадо или маслини,
  // вместо зехтинът в тигана да стане неправдоподобен.
  const fatShort = short('FAT') - out.filter(p => p.group === 'FAT').reduce((a, p) => a + p.hi / servingOf(p.foods), 0);
  if (fatShort >= 1.5 && SIDES.fats.meals.includes(mealKind)) {
    const id = pickSideFood(SIDES.fats.options, ctx);
    if (id) out.push(makePart('FAT', [id], [1, Math.min(SIDES.fats.range[1], fatShort)], { side: 'fats', sideName: food(id).label }));
  }
  if ((quota.SWT || 0) >= 1 && SIDES.dessert.meals.includes(mealKind)) {
    const id = pickSideFood(SIDES.dessert.options, ctx);
    if (id) out.push(makePart('SWT', [id], SIDES.dessert.range, { side: 'dessert', sideName: food(id).label, adjustable: false }));
  }
  return out;
}

/** Първоначално оразмеряване в реда на диетолога. */
function initialSizing(parts, fixed, quota, target) {
  const byGroup = g => parts.filter(p => p.group === g);
  for (const g of ['VEG', 'FRU', 'MLK', 'SWT']) {
    const list = byGroup(g);
    if (!list.length) continue;
    let need = g === 'VEG'
      ? Math.max(0, (quota.VEG || 0) * 100 - fixed.filter(([id]) => food(id).group === 'VEG').reduce((a, [, gr]) => a + gr, 0))
      : (quota[g] || 0) * servingOf(list[0].foods);
    for (const p of list) {
      setPartGrams(p, Math.min(p.hi, Math.max(p.lo, need)));
      need -= partTotal(p);
    }
  }

  const residual = (key) => target[key] - totalsOf(parts, fixed)[key];
  const sizeBy = (group, key) => {
    const list = byGroup(group);
    if (!list.length) return;
    list.forEach(p => setPartGrams(p, 0));
    let need = Math.max(0, residual(key));
    const wsum = list.reduce((a, p) => a + p.weight, 0);
    for (const p of list) {
      const perGram = p.foods.reduce((a, id) => a + food(id).per100[key], 0) / p.foods.length / 100;
      const share = need * (p.weight / wsum);
      setPartGrams(p, perGram > 0 ? share / perGram : p.lo);
    }
  };
  sizeBy('LEG', 'carbs');
  sizeBy('STA', 'carbs');
  sizeBy('PRO', 'protein');
  sizeBy('FAT', 'fats');
}

/** Донастройка: по една кухненска стъпка, докато грешката пада. */
function refine(parts, fixed, target, carbsCap) {
  let best = mealError(totalsOf(parts, fixed), target, carbsCap);
  for (let iter = 0; iter < 40; iter++) {
    let move = null;
    for (const p of parts) {
      if (!p.adjustable) continue;
      for (let i = 0; i < p.foods.length; i++) {
        for (const dir of [1, -1]) {
          const current = p.grams[i];
          const loEach = p.lo / p.foods.length;
          const hiEach = p.hi / p.foods.length;
          let next;
          if (current <= 0) {
            next = dir > 0 && loEach <= 0 ? portionSteps(p.foods[i], 0, hiEach)[0] : null;
          } else {
            next = neighbourPortion(p.foods[i], current, dir, loEach, hiEach);
            if (next == null && dir < 0 && loEach <= 0) next = 0;
          }
          if (next == null || next === current) continue;
          p.grams[i] = next;
          const err = mealError(totalsOf(parts, fixed), target, carbsCap);
          p.grams[i] = current;
          if (err < best - 1e-6 && (!move || err < move.err)) move = { p, i, next, err };
        }
      }
    }
    if (!move) break;
    move.p.grams[move.i] = move.next;
    best = move.err;
  }
  return best;
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function withPreposition(word) {
  return /^[сз]/i.test(word) ? 'със' : 'с';
}

function joinList(labels) {
  if (labels.length <= 1) return labels[0] || '';
  return `${labels.slice(0, -1).join(', ')} и ${labels[labels.length - 1]}`;
}

function dishName(dish, parts) {
  const present = parts.filter(p => !p.side && partTotal(p) > 0);
  // Празен вариант („кисело мляко с {FAT}“ без ядки) маха и предлога пред себе си.
  let name = dish.name.replace(/\s+(с|със|и)\s+\{(\w+)\}/g, (match, _prep, group) =>
    (present.some(p => p.group === group) ? match : ''));
  name = name.replace(/\{(\w+)\}/g, (_, group) => {
    const part = present.find(p => p.group === group) || parts.find(p => p.group === group);
    return part ? part.foods.map(id => food(id).label).join(' и ') : '';
  });
  // „с соево“ → „със соево“: пред с и з българският иска „със“.
  name = name.replace(/\sс\s(?=[сзСЗ])/g, ' със ');
  if (/^\{|^[а-я]/.test(name)) name = capitalize(name);
  const labels = present.filter(p => p.with).flatMap(p => p.foods.map(id => food(id).label));
  const unique = [...new Set(labels)].filter(l => !name.toLowerCase().includes(l));
  if (unique.length) {
    if (/(^|\s)(с|със)\s/i.test(name)) {
      name = unique.length === 1 ? `${name} и ${unique[0]}` : `${name}, ${joinList(unique)}`;
    } else {
      name = `${name} ${withPreposition(unique[0])} ${joinList(unique)}`;
    }
  }
  return capitalize(name.trim());
}

/**
 * Сглобява хранене от ястие и избор на варианти.
 *
 * @param {object} args
 * @param {Dish} args.dish
 * @param {number[]} args.choice       индекс на варианта за всяка част на ястието
 * @param {Record<string, number>} args.quota   порциите на храненето
 * @param {Target} args.target         целта (с пренесения остатък)
 * @param {'main'|'breakfast'|'snack'|'late'} args.mealKind
 * @param {object} args.ctx            policy, preferenceOf(id), usageOf(key)
 * @returns {null | { parts: PartInstance[], fixed: Array<[string, number]>, flavour: string[], totals: object, error: number, name: string }}
 */
export function buildMeal({ dish, choice, quota, target, mealKind, ctx }) {
  /** @type {PartInstance[]} */
  const parts = [];
  for (let i = 0; i < dish.parts.length; i++) {
    const spec = dish.parts[i];
    const option = spec.options[choice[i] ?? 0];
    const optional = spec.range[0] === 0;
    if (!option || !option.every(id => ctx.policy.allowed(id))) {
      if (optional) continue;
      return null;
    }
    if (optional && !(quota[spec.group] > 0) && spec.group !== 'LEG') continue;
    const fatScale = spec.group === 'FAT' ? (ctx.policy.styleDef.fatPartScale || 1) : 1;
    // Голям енергиен разход — по-голяма чиния от същото ястие (в таваните на порциите).
    const sizeScale = APPETITE_GROUPS.has(spec.group) ? (ctx.appetite || 1) : fatScale;
    parts.push(makePart(spec.group, option, [spec.range[0], spec.range[1] * sizeScale], {
      with: spec.with,
      weight: parts.some(p => p.group === spec.group) ? 0.5 : 1,
    }, fatScale));
  }
  // Подправките и сосовете (чесън, лимон, канела) овкусяват ястието — не са
  // съставка с грамаж и не влизат в описанието, а в рецептата.
  const fixedAll = dish.fixed.filter(([id]) => ctx.policy.allowed(id));
  const flavour = fixedAll.filter(([id]) => food(id).group === 'FREE').map(([id]) => food(id).label);
  const fixed = fixedAll.filter(([id]) => food(id).group !== 'FREE');

  parts.push(...sideParts(dish, parts, quota, mealKind, ctx));
  initialSizing(parts, fixed, quota, target);
  const carbsCap = ctx.policy.style === 'keto' || ctx.policy.style === 'low_carb';
  const error = refine(parts, fixed, target, carbsCap);

  for (const p of parts) if (p.side && partTotal(p) <= 0) p.grams = p.grams.map(() => 0);
  const kept = parts.filter(p => partTotal(p) > 0);
  return {
    parts: kept,
    fixed,
    flavour,
    totals: totalsOf(kept, fixed),
    error,
    name: dishName(dish, kept),
  };
}

/** Описанието на храненето — ред по съставка, по реда на ястието (десертът е отделен обект). */
export function describeMeal(built) {
  const lines = [];
  const seen = new Map();
  const push = (id, grams) => {
    if (!(grams > 0)) return;
    if (seen.has(id)) {
      const idx = seen.get(id);
      lines[idx].grams += grams;
    } else {
      seen.set(id, lines.length);
      lines.push({ id, grams });
    }
  };
  for (const p of built.parts) {
    if (p.side === 'dessert') continue;
    p.foods.forEach((id, i) => push(id, p.grams[i]));
  }
  for (const [id, g] of built.fixed) push(id, g);
  return lines;
}

export { portionLine };
