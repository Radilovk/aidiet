/**
 * Седмично меню (цикълът на диетолога).
 *
 * 1. Рамка на основните хранения: колко пъти седмично идва риба, бобови,
 *    птиче, червено месо, яйчено-млечно или растително ястие — по модела,
 *    етичния избор и клиничните правила — и в кой ден.
 * 2. Всяко хранене: от ястията за тази категория се избира това, което
 *    най-добре пасва на порциите на храненето, разнообразява седмицата и
 *    уважава предпочитанията; гарнитурите допълват липсващите порции.
 * 3. Остатъкът на храненето (недостиг или излишък на макроси) се пренася
 *    към следващото хранене на деня, както диетологът балансира деня.
 */

import { DISHES, SIDES, food, nutrientsOf, PATTERNS, VEGAN_BREAKFASTS } from './knowledge.js';
import { buildMeal, describeMeal, portionLine } from './meal-builder.js';
import { normalizeFoodKey } from '../food-utils.js';
import { FREE_MEAL, FIXED_DESSERT, FIXED_DESSERT_WEIGHT_GRAMS, MORNING_DRINK } from './plan-shape.js';
import { mealBenefits } from './benefits.js';

export const MEAL_KIND = {
  'Хранене 1': 'breakfast',
  'Хранене 2': 'main',
  'Хранене 3': 'snack',
  'Хранене 4': 'main',
  'Хранене 5': 'late',
};
export { FREE_MEAL };
const CANDIDATES_PER_MEAL = 12;
/** Колко тежи липсата на капацитет по група при предварителното подреждане. */
const FIT_WEIGHTS = { PRO: 2, STA: 1.2, FRU: 0.8, MLK: 0.8, VEG: 0.4, FAT: 0.6 };
const CARRY_LIMIT = 0.4;
const LATE_SNACK_MAX_KCAL = 175;
const SNACK_BAN = /пилеш|говежд|свинск|риба|сьомга|скумри|пъстърва|хек|треска|тилапи|ориз|паста|хляб|галети|бял|захар|мед\b|сироп|шоколад|кус-кус|булгур/;
/** Колко пъти седмично едно ястие може да се повтори в даден вид хранене. */
const MAX_USES_PER_WEEK = { main: 2, breakfast: 3, snack: 3, late: 3 };
/** Над тези калории порциите в ястията растат пропорционално. */
const APPETITE_BASE_KCAL = 1800;

/* ─── Детерминистичен случаен ред ─────────────────────────────────────── */

export function hashSeed(value) {
  const s = String(value ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ─── Годни ястия ─────────────────────────────────────────────────────── */

function dishBuildable(dish, policy) {
  if (dish.requires === 'sport' && !policy.sport) return false;
  if (dish.fruitAlone && policy.fruitWithProtein) return false;
  if (dish.seasonsOnly && !dish.seasonsOnly.includes(policy.season)) return false;
  return dish.parts.every(p => p.range[0] === 0 || p.options.some(o => o.every(id => policy.allowed(id))));
}

function eligibleDishes(policy) {
  const byKind = { main: [], breakfast: [], snack: [], late: [] };
  for (const dish of DISHES) {
    if (!dishBuildable(dish, policy)) continue;
    for (const kind of dish.meals) byKind[kind]?.push(dish);
  }
  return byKind;
}

/* ─── Рамка на основните хранения ─────────────────────────────────────── */

function largestRemainder(weights, total) {
  const keys = Object.keys(weights).filter(k => weights[k] > 0);
  const sum = keys.reduce((a, k) => a + weights[k], 0);
  const out = Object.fromEntries(keys.map(k => [k, 0]));
  if (!sum || total <= 0) return out;
  const raw = keys.map(k => ({ k, v: (weights[k] / sum) * total }));
  for (const r of raw) out[r.k] = Math.floor(r.v);
  let left = total - Object.values(out).reduce((a, b) => a + b, 0);
  raw.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
  for (const r of raw) {
    if (left <= 0) break;
    out[r.k]++;
    left--;
  }
  return out;
}

/** Колко пъти седмично идва всяка категория основно ястие. */
export function mainsCounts(policy, totalMains, available) {
  const counts = { ...(policy.styleDef.mains || {}) };
  const pattern = policy.patternDef || PATTERNS.omnivore;
  for (const drop of pattern.dropMains || []) {
    const moved = counts[drop] || 0;
    delete counts[drop];
    const targets = pattern.toMains || [];
    targets.forEach((t, i) => {
      counts[t] = (counts[t] || 0) + Math.floor(moved / targets.length) + (i < moved % targets.length ? 1 : 0);
    });
  }
  if (pattern.toMains?.includes('plant') && !counts.plant) counts.plant = 2;
  for (const [k, v] of Object.entries(policy.mainsMin)) counts[k] = Math.max(counts[k] || 0, v);
  for (const [k, v] of Object.entries(policy.mainsMax)) if (counts[k] != null) counts[k] = Math.min(counts[k], v);
  for (const k of Object.keys(counts)) if (!available.has(k) || !(counts[k] > 0)) delete counts[k];
  if (!Object.keys(counts).length) {
    for (const k of available) counts[k] = 1;
  }

  // Към реалния брой основни хранения — минимумите на клиничните правила се пазят.
  const scaled = largestRemainder(counts, totalMains);
  for (const [k, v] of Object.entries(policy.mainsMin)) {
    if (!(k in scaled)) continue;
    const need = Math.min(v, totalMains) - scaled[k];
    for (let i = 0; i < need; i++) {
      const donor = Object.keys(scaled)
        .filter(d => d !== k && scaled[d] > (policy.mainsMin[d] || 0))
        .sort((a, b) => scaled[b] - scaled[a])[0];
      if (!donor) break;
      scaled[donor]--;
      scaled[k]++;
    }
  }
  return scaled;
}

/** Подрежда категориите по слотовете: обяд ≠ вечеря, без еднакви поред. */
function sequenceMains(counts, slots, rng) {
  const left = { ...counts };
  const out = [];
  for (let i = 0; i < slots.length; i++) {
    const { day, type } = slots[i];
    const prev = out[i - 1];
    const sameDay = slots.findIndex((s, j) => j < i && s.day === day);
    const otherToday = sameDay >= 0 ? out[sameDay] : null;
    const yesterday = out.filter((_, j) => slots[j].day === day - 1);
    const options = Object.keys(left).filter(k => left[k] > 0);
    const pool = options.length ? options : Object.keys(counts);
    let best = pool[0];
    let bestScore = -Infinity;
    for (const k of pool) {
      let score = (left[k] || 0) * 2 + rng() * 0.8;
      if (k === prev) score -= 6;
      if (k === otherToday) score -= 12;
      if ((k === 'fish' || k === 'red') && yesterday.includes(k)) score -= 3;
      if (k === 'legume' && type === 'Хранене 2') score += 1.5;
      if ((k === 'veggie' || k === 'fish') && type === 'Хранене 4') score += 0.8;
      if (score > bestScore) { bestScore = score; best = k; }
    }
    out.push(best);
    if (left[best] > 0) left[best]--;
  }
  return out;
}

function breakfastCounts(policy) {
  if (policy.pattern === 'vegan') return { ...VEGAN_BREAKFASTS };
  return { ...(policy.styleDef.breakfasts || { eggs: 2, dairy: 2, bread: 2, porridge: 1 }) };
}

/**
 * Доколко ястието (с гарнитурите си) може да поеме порциите на храненето —
 * преди да се сглобява. Липсващ капацитет и задължителни излишни порции
 * се наказват.
 */
function dishFit(dish, quota, policy, mealKind) {
  const cap = {};
  const floor = {};
  const add = (map, g, n) => { map[g] = (map[g] || 0) + n; };
  for (const part of dish.parts) {
    if (!part.options.some(o => o.every(id => policy.allowed(id)))) continue;
    const scale = part.group === 'FAT' ? (policy.styleDef.fatPartScale || 1) : 1;
    for (const g of part.group === 'LEG' ? ['STA', 'PRO'] : [part.group]) {
      add(cap, g, part.range[1] * scale);
      add(floor, g, part.range[0]);
    }
  }
  if (mealKind === 'main' || mealKind === 'breakfast') add(cap, 'FAT', 3);
  let penalty = 0;
  for (const [g, w] of Object.entries(FIT_WEIGHTS)) {
    const q = quota[g] || 0;
    penalty += w * Math.max(0, q - (cap[g] || 0));
    penalty += w * 0.5 * Math.max(0, (floor[g] || 0) - q - 0.5);
  }
  return penalty;
}

/* ─── Избор на варианти ───────────────────────────────────────────────── */

function chooseOptions(dish, state, ctx, rng, target) {
  // Съотношението мазнини/белтък на целта избира между постно и тлъсто:
  // кето получава сьомга и бутче, ниско масленото — пилешко филе.
  const targetRatio = target.protein > 0 ? target.fats / target.protein : 0.3;
  return dish.parts.map((part, idx) => {
    let best = 0;
    let bestScore = -Infinity;
    part.options.forEach((option, i) => {
      if (!option.every(id => ctx.policy.allowed(id))) return;
      let score = 0;
      for (const id of option) {
        score += ctx.preferenceOf(id);
        const uses = state.foodUses.get(id) || 0;
        score -= uses * (part.group === 'PRO' && idx === 0 ? 1.4 : 0.7);
        if (state.lastMealFoods.has(id)) score -= 1.5;
        if (part.group === 'PRO' && state.mainFoodsToday.has(id)) score -= 6;
      }
      score = score / option.length + rng() * 0.4;
      if (part.group === 'PRO' && idx === dish.parts.findIndex(p => p.group === 'PRO')) {
        const p = food(option[0]).per100;
        const ratio = p.protein > 0 ? p.fats / p.protein : 1;
        score -= Math.abs(Math.log((ratio + 0.05) / (targetRatio + 0.05))) * 0.8;
      }
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  });
}

function mealFoods(built) {
  return new Set(built.parts.flatMap(p => p.foods.filter((_, i) => p.grams[i] > 0)));
}

/** Седмичните граници: яйца, солени храни. */
function limitPenalty(built, state, policy) {
  let penalty = 0;
  const foods = [...mealFoods(built)].map(food);
  const eggMax = policy.weeklyMax.egg;
  if (eggMax != null && foods.some(f => f.kind === 'egg') && state.kindUses.egg >= eggMax) penalty += 40;
  for (const [flag, max] of Object.entries(policy.limitFlags)) {
    if (foods.some(f => f.flags.has(flag)) && (state.flagUses[flag] || 0) >= max) penalty += 25;
  }
  return penalty;
}

function scoreMeal(dish, built, state, ctx, plannedCategory, mealKind) {
  let score = -built.error * 40;
  score -= (state.dishUses.get(dish.id) || 0) * (mealKind === 'main' ? 5 : 2.5);
  if (state.yesterdayDishes.has(dish.id)) score -= 4;
  if (state.previousWeek.has(dish.id)) score -= 1.5;
  if (mealKind === 'breakfast' && plannedCategory) {
    const cat = dish.breakfastCategory || dish.category;
    if (cat === plannedCategory) score += 3;
  }
  const foods = [...mealFoods(built)];
  score += foods.reduce((a, id) => a + ctx.preferenceOf(id), 0) / Math.max(1, foods.length);
  score -= limitPenalty(built, state, ctx.policy);
  return score;
}

function recordUse(dish, built, state) {
  state.dishUses.set(dish.id, (state.dishUses.get(dish.id) || 0) + 1);
  const foods = mealFoods(built);
  for (const id of foods) state.foodUses.set(id, (state.foodUses.get(id) || 0) + 1);
  for (const p of built.parts) {
    if (p.side === 'salad' && p.sideName) {
      const key = `salad:${p.sideName}`;
      state.foodUses.set(key, (state.foodUses.get(key) || 0) + 1);
    }
  }
  const kinds = new Set([...foods].map(id => food(id).kind).filter(Boolean));
  for (const k of kinds) state.kindUses[k] = (state.kindUses[k] || 0) + 1;
  const flags = new Set([...foods].flatMap(id => [...food(id).flags]));
  for (const f of flags) state.flagUses[f] = (state.flagUses[f] || 0) + 1;
  state.lastMealFoods = foods;
}

/* ─── Хранене в изхода ────────────────────────────────────────────────── */

function round(n) {
  return Math.round(n);
}

/**
 * @param {string} type
 * @param {import('./knowledge.js').Dish} dish
 * @param {ReturnType<typeof buildMeal>} built
 * @param {boolean} withDessert  фиксираният десерт към обяда (за сладкоежки)
 */
function toPlanMeal(type, dish, built, withDessert = false) {
  const lines = describeMeal(built);
  const description = lines.map(l => portionLine(l.id, l.grams)).join('\n');
  const dessert = withDessert ? { ...FIXED_DESSERT, macros: { ...FIXED_DESSERT.macros }, _weightAddedToMeal: true } : null;
  const dessertGrams = dessert ? FIXED_DESSERT_WEIGHT_GRAMS : 0;
  const totalGrams = lines.reduce((a, l) => a + l.grams, 0) + dessertGrams;
  // Стойностите са от описанието — каквото е написано, това е сметнато.
  const sum = { protein: 0, carbs: 0, fats: 0 };
  for (const l of lines) {
    const n = nutrientsOf(l.id, l.grams);
    sum.protein += n.protein; sum.carbs += n.carbs; sum.fats += n.fats;
  }
  const macros = {
    protein: round(sum.protein + (dessert?.macros.protein || 0)),
    carbs: round(sum.carbs + (dessert?.macros.carbs || 0)),
    fats: round(sum.fats + (dessert?.macros.fats || 0)),
  };
  const meal = {
    type,
    name: built.name,
    dishId: dish.id,
    description,
    weight: `${round(totalGrams)}г`,
    macros,
    calories: round(macros.protein * 4 + macros.carbs * 4 + macros.fats * 9),
    benefits: mealBenefits(built),
  };
  if (built.flavour?.length) meal.recipe = `Овкусете с: ${built.flavour.join(', ')}.`;
  if (dessert) meal.dessert = dessert;
  return meal;
}

/** @returns {{ protein: number, carbs: number, fats: number }} */
function carryTarget(target, carry) {
  const out = { protein: 0, carbs: 0, fats: 0 };
  for (const k of ['protein', 'carbs', 'fats']) {
    const base = target[k];
    const lim = Math.max(base * CARRY_LIMIT, k === 'fats' ? 4 : 8);
    out[k] = Math.max(0, base + Math.max(-lim, Math.min(lim, carry[k])));
  }
  return out;
}

/**
 * @param {object} args
 * @param {ReturnType<typeof import('./prescription.js').prescribe>} args.prescription
 * @param {ReturnType<typeof import('./policy.js').buildFoodPolicy>} args.policy
 * @param {number} args.seed
 * @param {number|null} [args.freeDayNumber]
 * @param {Set<string>} [args.previousWeek]  ястия от миналата седмица
 * @param {boolean} [args.simplify]  по-малко различни и по-прости ястия
 * @param {boolean} [args.variety]   всяко основно ястие най-много веднъж
 * @param {boolean} [args.morningDrink]  сутрешна напитка вместо закуска
 * @param {Array<{ day: number, type: string, avoid: string[] }>} [args.slotAvoid]  храни, които да се избегнат в конкретно хранене (от AI прегледа)
 */
export function planWeek({ prescription, policy, seed, freeDayNumber = null, previousWeek = new Set(), simplify = false, variety = false, morningDrink = false, slotAvoid = [] }) {
  const rng = rngFrom(seed);
  const eligible = eligibleDishes(policy);
  // Следобедната закуска е лека: без месо, риба, ориз, паста, хляб и висок ГИ.
  const snackPolicy = {
    ...policy,
    allowed: id => policy.allowed(id) && !SNACK_BAN.test(food(id).name.toLowerCase()),
  };
  eligible.snack = eligibleDishes(snackPolicy).snack;
  const ctx = {
    policy,
    appetite: Math.max(1, (prescription.kcal || 0) / APPETITE_BASE_KCAL),
    preferenceOf: id => policy.preference(id),
    usageOf: key => state.foodUses.get(key) || 0,
  };
  const snackCtx = { ...ctx, policy: snackPolicy, preferenceOf: id => policy.preference(id) };

  const slots = prescription.slots;
  const mainSlots = [];
  for (let day = 1; day <= 7; day++) {
    for (const type of slots) {
      if (MEAL_KIND[type] !== 'main') continue;
      if (type === 'Хранене 2' && day === freeDayNumber) continue;
      mainSlots.push({ day, type });
    }
  }
  // Категория е налична, само ако има ястие, което носи белтъка на основно
  // хранене — зеленчукова яхния без сирене не е „вегетарианско основно“.
  const proteinCapacity = (d) => {
    let cap = 0;
    for (const part of d.parts) {
      if ((part.group === 'PRO' || part.group === 'LEG') && part.options.some(o => o.every(id => policy.allowed(id)))) {
        cap += part.range[1];
      }
    }
    if (d.sides.includes('cheese') && SIDES.cheese.options.some(id => policy.allowed(id))) cap += SIDES.cheese.range[1];
    return cap;
  };
  const available = new Set(eligible.main.filter(d => proteinCapacity(d) >= 3).map(d => d.category));
  const frame = sequenceMains(mainsCounts(policy, mainSlots.length, available), mainSlots, rng);
  const frameOf = new Map(mainSlots.map((s, i) => [`${s.day}:${s.type}`, frame[i]]));

  const bCounts = breakfastCounts(policy);
  const bFrame = sequenceMains(bCounts, [1, 2, 3, 4, 5, 6, 7].map(day => ({ day, type: 'Хранене 1' })), rng);

  const state = {
    dishUses: new Map(),
    foodUses: new Map(),
    kindUses: {},
    flagUses: {},
    lastMealFoods: new Set(),
    mainFoodsToday: new Set(),
    yesterdayDishes: new Set(),
    previousWeek,
  };

  const days = [];
  let relaxed = null;
  for (let day = 1; day <= 7; day++) {
    const meals = [];
    // Без закуска не се натиска за закуска — предлага се напитка за хидратация.
    if (morningDrink) meals.push({ ...MORNING_DRINK });
    const todayDishes = new Set();
    state.mainFoodsToday = new Set();
    let carry = { protein: 0, carbs: 0, fats: 0 };

    for (const type of slots) {
      const plan = prescription.meals[type];
      if (type === 'Хранене 2' && day === freeDayNumber) {
        meals.push({ type: FREE_MEAL, name: FREE_MEAL, _plannedCalories: round(plan.target.kcal) });
        continue;
      }
      const kind = MEAL_KIND[type];
      const category = kind === 'main' ? frameOf.get(`${day}:${type}`) : kind === 'breakfast' ? bFrame[day - 1] : null;
      let pool = eligible[kind] || [];
      if (kind === 'main') {
        const inCategory = pool.filter(d => d.category === category);
        if (inCategory.length) pool = inCategory;
      }
      // Едно ястие — най-много два пъти седмично и не в два поредни дни.
      // По-просто меню: същите ястия по-често; повече разнообразие: всяко основно веднъж.
      const maxUses = (MAX_USES_PER_WEEK[kind] ?? 3) + (simplify ? 1 : 0) - (variety && kind === 'main' ? 1 : 0);
      pool = pool.filter(d => !todayDishes.has(d.id)
        && (state.dishUses.get(d.id) || 0) < maxUses
        && !(kind === 'main' && state.yesterdayDishes.has(d.id)));
      if (!pool.length) pool = (eligible[kind] || []).filter(d => !todayDishes.has(d.id));
      // Десертът към обяда влиза в калориите на обяда.
      const dessertToday = policy.sweets && type === 'Хранене 2';
      const base = dessertToday
        ? Object.fromEntries(['protein', 'carbs', 'fats'].map(k => [k, Math.max(0, plan.target[k] - FIXED_DESSERT.macros[k])]))
        : plan.target;
      let target = carryTarget(base, carry);
      // Късната закуска е най-много 200 kcal.
      if (kind === 'late') {
        const k = target.protein * 4 + target.carbs * 4 + target.fats * 9;
        if (k > LATE_SNACK_MAX_KCAL) {
          const f = LATE_SNACK_MAX_KCAL / k;
          target = { protein: target.protein * f, carbs: target.carbs * f, fats: target.fats * f };
        }
      }

      // Предварителен ред: неизползвани и предпочитани напред, после се
      // сглобяват най-добрите кандидати и печели най-точният и разнообразен.
      const ranked = pool
        .map(d => ({
          d,
          pre: -dishFit(d, plan.quota, policy, kind) * 2
            - (state.dishUses.get(d.id) || 0) * 2
            - (state.yesterdayDishes.has(d.id) ? 2 : 0)
            + rng() * 1.5,
        }))
        .sort((a, b) => b.pre - a.pre)
        .slice(0, CANDIDATES_PER_MEAL);

      const pick = (candidates, mealCtx) => {
        let found = null;
        for (const d of candidates) {
          const choice = chooseOptions(d, state, mealCtx, rng, target);
          const built = buildMeal({ dish: d, choice, quota: plan.quota, target, mealKind: kind, ctx: mealCtx });
          if (!built || !built.parts.length) continue;
          let score = scoreMeal(d, built, state, mealCtx, kind === 'breakfast' ? category : null, kind);
          // Опростено: ястия с малко съставки, повторенията не се наказват.
          if (simplify) score += (state.dishUses.get(d.id) || 0) * 3 - built.parts.length * 0.6 - d.fixed.length * 0.4;
          if (!found || score > found.score) found = { dish: d, built, score };
        }
        return found;
      };
      const avoid = slotAvoid.filter(a => a.day === day && a.type === type).flatMap(a => a.avoid);
      let slotCtx = kind === 'snack' ? snackCtx : ctx;
      let slotPool = ranked.map(r => r.d);
      if (avoid.length) {
        // Замяна по искане на AI прегледа: храните се избягват само в това хранене.
        const terms = avoid.map(t => normalizeFoodKey(t));
        const basePolicy = slotCtx.policy;
        const avoidPolicy = {
          ...basePolicy,
          allowed: id => basePolicy.allowed(id) && !terms.some(t => t && (normalizeFoodKey(food(id).name).includes(t) || normalizeFoodKey(food(id).label).includes(t))),
        };
        slotCtx = { ...slotCtx, policy: avoidPolicy };
        slotPool = (eligibleDishes(avoidPolicy)[kind] || []).filter(d => !todayDishes.has(d.id)).slice(0, CANDIDATES_PER_MEAL * 2);
      }
      let best = pick(slotPool, slotCtx);
      if (!best && policy.withoutOnly) {
        // Избраните храни не стигат за това хранене — то се сглобява от целия каталог.
        relaxed = relaxed || (() => {
          const p = policy.withoutOnly();
          return { ctx: { ...ctx, policy: p, preferenceOf: id => p.preference(id) }, eligible: eligibleDishes(p) };
        })();
        best = pick((relaxed.eligible[kind] || []).filter(d => !todayDishes.has(d.id)), relaxed.ctx);
      }
      if (!best) throw new Error(`Няма подходящо ястие за ${type} (ден ${day}) при тази диета`);

      recordUse(best.dish, best.built, state);
      todayDishes.add(best.dish.id);
      if (kind === 'main') {
        const proteinPart = best.built.parts.find(p => p.group === 'PRO' || p.group === 'LEG');
        for (const id of proteinPart?.foods || []) state.mainFoodsToday.add(id);
      }
      for (const k of ['protein', 'carbs', 'fats']) carry[k] = target[k] - best.built.totals[k];
      const meal = toPlanMeal(type, best.dish, best.built, dessertToday);
      // Целта на храненето е тази след пренесения остатък и десерта.
      meal.targetCalories = round(target.protein * 4 + target.carbs * 4 + target.fats * 9 + (dessertToday ? FIXED_DESSERT.calories : 0));
      meals.push(meal);
    }
    state.yesterdayDishes = todayDishes;
    days.push({ meals });
  }

  const stats = {
    mains: frame.reduce((acc, k) => ({ ...acc, [k]: (acc[k] || 0) + 1 }), {}),
    eggsMeals: state.kindUses.egg || 0,
    distinctDishes: state.dishUses.size,
  };
  return { days, stats };
}

