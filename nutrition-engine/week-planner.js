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
import { buildMeal, retuneMeal, mealError, describeMeal, portionLine } from './meal-builder.js';
import { slotCeilingKcal } from '../plan-normalize.js';
import { normalizeFoodKey } from '../food-utils.js';
import { FREE_MEAL, FIXED_DESSERT, FIXED_DESSERT_WEIGHT_GRAMS, morningDrinkFor } from './plan-shape.js';
import { mealBenefits } from './benefits.js';
import { renderRecipe } from './recipes.js';
import { LATE_SNACK_MAX_KCAL } from './prescription.js';

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
const SNACK_BAN = /пилеш|говежд|свинск|риба|сьомга|скумри|пъстърва|хек|треска|тилапи|ориз|паста|хляб|галети|бял|захар|мед\b|сироп|шоколад|кус-кус|булгур/;
/** Колко пъти седмично едно ястие може да се повтори в даден вид хранене. */
const MAX_USES_PER_WEEK = { main: 2, breakfast: 3, snack: 3, late: 3 };
/** Над тези калории порциите в ястията растат пропорционално. */
const APPETITE_BASE_KCAL = 1800;
/**
 * Колко носи обичайно едно хранене от вида — рецептите са оразмерени за него.
 * Хранене с по-голяма цел (без закуска денят е в две основни хранения по
 * 800–1000 kcal) получава по-голяма чиния, иначе месото спираше на 150 г и
 * денят падаше с 10–15%.
 */
const KIND_BASE_KCAL = { main: 550, breakfast: 450, snack: 250, late: 150 };

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
    if (foods.some(f => f.flags.has(flag)) && (state.flagUses[flag] || 0) >= max) penalty += 80;
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
  // Рецептата по стъпки с избраните продукти; без нея — краткото приготвяне от ястието.
  /** @type {Record<string, string[]>} */
  const labelsByRef = {};
  for (const p of built.parts) {
    if (p.ref && !p.side) (labelsByRef[p.ref] ||= []).push(...p.foods.map(id => food(id).label));
  }
  // Продуктите на частите, които ги няма в това хранене — съветът за тях отпада.
  const absent = dish.parts.flatMap(p => p.options.flat()).filter(id => !built.parts.some(p => p.foods.includes(id)));
  const steps = renderRecipe(dish.id, labelsByRef, built.flavour || [], absent.map(id => food(id).label));
  if (steps) {
    meal.recipeSteps = steps.steps;
    meal.prepTime = steps.time;
    if (steps.tip) meal.recipeTip = steps.tip;
    meal.recipe = steps.steps.join(' ');
  } else {
    const recipe = [dish.prep, built.flavour?.length ? `Овкусете с: ${built.flavour.join(', ')}.` : '']
      .filter(Boolean).join(' ');
    if (recipe) meal.recipe = recipe;
  }
  if (dessert) meal.dessert = dessert;
  return meal;
}

/**
 * Тежест на предпочитанието от изборите на клиента (±3 → ±9 точки). Колкото
 * отклонение от целта около 20% — изборите решават между равностойни ястия,
 * но не пробиват точността на калориите.
 */
const PREFERENCE_WEIGHT = 3;

/** Най-много толкова алтернативи на хранене. */
export const MAX_ALTERNATIVES = 5;

const kcalOf = t => t.protein * 4 + t.carbs * 4 + t.fats * 9;
/** Под този дял от белтъка на основното хранене се търси и в другите свободни категории. 0,5 — само явните случаи: при 0,7 бобовите и вегетарианските ястия в седмицата падаха с 40–75%. */
const PROTEIN_SHORT = 0.5;
/** Алтернатива е равностойна по калории: до 12% (най-малко 40 kcal) от храненето или целта му. */
const nearKcal = (v, ref) => Math.abs(v - ref) <= Math.max(ref * 0.12, 40);

/**
 * Алтернативите на храненето: следващите най-добри кандидати, които са
 * равностойни — близки калории и белтък, друго ястие (и друг основен белтък
 * при основно хранене), без храни със седмичен лимит (солено, яйца), които
 * при смяна биха го надхвърлили. Всичко друго (диета, алергии, клинични
 * правила, съчетания) вече е проверено при сглобяването.
 * @returns {Array<{ dish: any, built: any, score: number }>}
 */
function pickAlternatives(best, candidates, { kind, todayDishes, state, policy, target }) {
  const bestK = kcalOf(best.built.totals);
  const targetK = kcalOf(target);
  const bestP = best.built.totals.protein;
  // Храна със седмичен лимит — само ако има място поне за още едно хранене с нея,
  // за да не се надхвърли лимитът, когато клиентът смени няколко хранения.
  const limited = id => {
    const f = food(id);
    const eggMax = policy.weeklyMax?.egg;
    if (eggMax != null && f.kind === 'egg' && !mealFoods(best.built).has(id) && (state.kindUses.egg || 0) >= eggMax - 1) return true;
    return Object.entries(policy.limitFlags || {}).some(([flag, max]) => f.flags.has(flag) && (state.flagUses[flag] || 0) >= max - 1);
  };
  const proteinOf = b => new Set((b.parts.find(p => p.group === 'PRO' || p.group === 'LEG')?.foods) || []);
  const bestProtein = proteinOf(best.built);
  const out = [];
  const names = new Set([best.built.name]);
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    if (out.length >= MAX_ALTERNATIVES * 2) break;
    if (c.dish.id === best.dish.id || todayDishes.has(c.dish.id) || names.has(c.built.name)) continue;
    // Равностойна на целта на храненето (както и самият избор), и не далеч от избраното.
    const k = kcalOf(c.built.totals);
    const near = nearKcal;
    if (!near(k, bestK) && !near(k, targetK)) continue;
    if (c.built.totals.protein < Math.min(bestP, target.protein) * 0.85 || c.built.totals.protein > Math.max(bestP, target.protein) * 1.3 + 5) continue;
    if (policy.style === 'keto' && c.built.totals.carbs > best.built.totals.carbs * 1.2 + 3) continue;
    if (limitPenalty(c.built, state, policy) > 0) continue;
    const foods = [...mealFoods(c.built)];
    if (foods.some(limited)) continue;
    if (kind === 'main') {
      const prot = proteinOf(c.built);
      // Истинска алтернатива: друг основен белтък, и не този, който вече е днес.
      if ([...prot].some(id => bestProtein.has(id) || state.mainFoodsToday.has(id))) continue;
      if (out.some(o => [...proteinOf(o.built)].some(id => prot.has(id)))) continue;
    }
    names.add(c.built.name);
    out.push(c);
  }
  return out;
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

/** Дневната цел — сборът от целите на храненията. */
function dayTargetOf(prescription, slots) {
  const t = { protein: 0, carbs: 0, fats: 0 };
  for (const type of slots) {
    const m = prescription.meals[type]?.target;
    if (!m) continue;
    for (const k of Object.keys(t)) t[k] += m[k] || 0;
  }
  return t;
}

const DAY_BALANCE_PASSES = 4;
/** Таванът на храненето при изравняването: междинните остават в своя таван (H3, H5). */
function balanceCeiling(type, kind, dailyKcal) {
  const ceiling = slotCeilingKcal(type, dailyKcal);
  return kind === 'late' ? Math.min(ceiling, LATE_SNACK_MAX_KCAL) : ceiling;
}

/**
 * Изравняване на деня. Всяко хранене се сглобява към своята цел, остатъкът се
 * пренася към следващото, но последното е с таван и остатъкът се губи —
 * денят оставаше под целта (средно ~3%, до −14%). Тук остатъкът до дневната
 * цел — поотделно по белтък, въглехидрати и мазнини — се връща към храненията
 * на деня: същите ястия и съставки, само грамажите в границите на рецептата,
 * а междинните хранения — в своя таван.
 * Промяна се приема, само ако дневната грешка по всички макроси пада, така
 * калориите не се оправят за сметка на белтъка.
 */
function balanceDay(meals, dayBuilt, dayTarget, policy) {
  const carbsCap = policy.style === 'keto' || policy.style === 'low_carb';
  const dailyKcal = kcalOf(dayTarget);
  const sum = () => meals.reduce((t, m) => {
    t.protein += m.macros?.protein || 0; t.carbs += m.macros?.carbs || 0; t.fats += m.macros?.fats || 0;
    return t;
  }, { protein: 0, carbs: 0, fats: 0 });
  for (let pass = 0; pass < DAY_BALANCE_PASSES; pass++) {
    const total = sum();
    const curErr = mealError(total, dayTarget, carbsCap);
    const left = { protein: dayTarget.protein - total.protein, carbs: dayTarget.carbs - total.carbs, fats: dayTarget.fats - total.fats };
    let move = null;
    for (const e of dayBuilt) {
      const target = carryTarget(e.target, left);
      const built = retuneMeal({ dish: e.dish, built: e.built, target, mealKind: e.kind, ctx: e.ctx });
      if (!built) continue;
      const meal = toPlanMeal(e.type, e.dish, built, e.dessertToday);
      if (meal.calories > Math.max(balanceCeiling(e.type, e.kind, dailyKcal), meals[e.i].calories)) continue;
      const old = meals[e.i].macros;
      const next = {
        protein: total.protein - old.protein + meal.macros.protein,
        carbs: total.carbs - old.carbs + meal.macros.carbs,
        fats: total.fats - old.fats + meal.macros.fats,
      };
      const err = mealError(next, dayTarget, carbsCap);
      if (err < curErr - 1e-4 && (!move || err < move.err)) move = { e, built, meal, target, err };
    }
    if (!move) break;
    const e = move.e;
    const meal = move.meal;
    meal.targetCalories = round(kcalOf(move.target) + (e.dessertToday ? FIXED_DESSERT.calories : 0));
    // Алтернативите следват храненето: същата нова цел, иначе смяната връща стария дефицит.
    const altMeals = (e.alts || [])
      .map(a => {
        const built = retuneMeal({ dish: a.dish, built: a.built, target: move.target, mealKind: e.kind, ctx: e.ctx }) || a.built;
        return { ...toPlanMeal(e.type, a.dish, built, e.dessertToday), targetCalories: meal.targetCalories };
      })
      .filter(a => nearKcal(a.calories, meal.calories) || nearKcal(a.calories, meal.targetCalories))
      .slice(0, MAX_ALTERNATIVES);
    if (altMeals.length) meal.alternatives = altMeals;
    meals[move.e.i] = meal;
    move.e.built = move.built;
    move.e.target = move.target;
  }
}

const SHAKE_DISH = DISHES.find(d => d.id === 's_protein_shake');
/** Под този дял от дневния белтък (и поне толкова грама недостиг) междинната закуска става шейк. */
const SHAKE_PROTEIN_SHARE = 0.92;
const SHAKE_MIN_GAP_G = 12;
/** Протеин на прах за деня — най-много две мерителни лъжици. */
const POWDER_MAX_G_DAY = 60;

const powderGrams = built => built.parts.reduce((a, p) => a + p.foods.reduce((b, id, i) => b + (food(id).flags.has('supplement') ? p.grams[i] : 0), 0), 0);

/**
 * Белтъкът на деня не стига и след изравняването (растителен модел, low-FODMAP,
 * много белтък при отслабване), а междинните закуски са плод, ядки или соев
 * йогурт: една от тях става протеинов шейк. Само ако протеинът на прах е
 * позволен (не при AIP или отказ), до две мерителни лъжици на ден, и само ако
 * дневната грешка по всички макроси пада.
 */
function shakeForProteinGap(meals, dayBuilt, dayTarget, policy) {
  if (!SHAKE_DISH) return;
  const carbsCap = policy.style === 'keto' || policy.style === 'low_carb';
  const total = meals.reduce((t, m) => {
    t.protein += m.macros?.protein || 0; t.carbs += m.macros?.carbs || 0; t.fats += m.macros?.fats || 0;
    return t;
  }, { protein: 0, carbs: 0, fats: 0 });
  const gap = dayTarget.protein - total.protein;
  if (total.protein >= dayTarget.protein * SHAKE_PROTEIN_SHARE || gap < SHAKE_MIN_GAP_G) return;
  const powderToday = dayBuilt.reduce((a, e) => a + powderGrams(e.built), 0);
  if (powderToday >= POWDER_MAX_G_DAY) return;
  const curErr = mealError(total, dayTarget, carbsCap);
  let move = null;
  for (const e of dayBuilt) {
    if (e.kind !== 'snack' && e.kind !== 'late') continue;
    if (e.dish.id === SHAKE_DISH.id) return;
    const ctx = e.baseCtx;
    const choice = SHAKE_DISH.parts.map(part => Math.max(0, part.options.findIndex(o => o.every(id => ctx.policy.allowed(id)))));
    const powder = SHAKE_DISH.parts[0].options[choice[0]];
    if (!powder || !powder.every(id => ctx.policy.allowed(id))) return;
    const left = { protein: gap, carbs: dayTarget.carbs - total.carbs, fats: dayTarget.fats - total.fats };
    const target = addLeft(e.target, left);
    const built = buildMeal({ dish: SHAKE_DISH, choice, quota: e.quota, target, mealKind: 'snack', ctx });
    if (!built || powderToday + powderGrams(built) > POWDER_MAX_G_DAY) continue;
    const meal = toPlanMeal(e.type, SHAKE_DISH, built, false);
    if (meal.calories > Math.max(balanceCeiling(e.type, e.kind, kcalOf(dayTarget)), meals[e.i].calories)) continue;
    const old = meals[e.i].macros;
    const next = {
      protein: total.protein - old.protein + meal.macros.protein,
      carbs: total.carbs - old.carbs + meal.macros.carbs,
      fats: total.fats - old.fats + meal.macros.fats,
    };
    const err = mealError(next, dayTarget, carbsCap);
    if (err < curErr - 1e-4 && (!move || err < move.err)) move = { e, built, meal, target, err };
  }
  if (!move) return;
  move.meal.targetCalories = meals[move.e.i].targetCalories;
  meals[move.e.i] = move.meal;
  Object.assign(move.e, { dish: SHAKE_DISH, built: move.built, target: move.target, alts: [] });
}

/** Целта на храненето + целият остатък на деня (порциите остават в границите на рецептата). */
function addLeft(target, left) {
  const out = { protein: 0, carbs: 0, fats: 0 };
  for (const k of Object.keys(out)) out[k] = Math.max(0, target[k] + left[k]);
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
 * @param {Record<string, number>} [args.dishPreference]  предпочитание по ястие от изборите на клиента (−3…+3)
 * @param {Array<{ day: number, type: string, avoid: string[] }>} [args.slotAvoid]  храни, които да се избегнат в конкретно хранене (от AI прегледа)
 * @param {Array<ReturnType<typeof import('./prescription.js').prescribe>>} [args.dayPrescriptions]  своя схема за всеки ден (тренировъчен/почивен, metabolic.js); основните хранения са едни и същи
 */
export function planWeek({ prescription, policy, seed, freeDayNumber = null, previousWeek = new Set(), simplify = false, variety = false, morningDrink = false, slotAvoid = [], dishPreference = {}, dayPrescriptions = null }) {
  const rng = rngFrom(seed);
  const altRng = rngFrom((seed ^ 0x5bd1e995) >>> 0);
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
    // Седмичният лимит на флаг (солено при хипертония) е изчерпан — незадължителна добавка с него отпада.
    limitReached: flag => policy.limitFlags[flag] != null && (state.flagUses[flag] || 0) >= policy.limitFlags[flag],
  };
  const snackCtx = { ...ctx, policy: snackPolicy, preferenceOf: id => policy.preference(id) };

  const slots = prescription.slots;
  const drink = morningDrinkFor({
    dairy: policy.allowed('dairy_kefir') || policy.allowed('dairy_yogurt'),
    plantMilk: policy.allowed('dairy_soy_milk'),
    shake: policy.allowed('pro_whey') || policy.allowed('pro_plant_protein'),
  });
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
  // Категории основни, между които клиентът може да сменя свободно: тези от
  // седмицата без клинично правило за брой. Червеното месо и рибата остават
  // в своята категория — смяната не бива да надхвърли червеното или да изгуби рибата.
  const swappable = new Set(frame.filter(c => c !== 'red' && c !== 'fish' && !(c in policy.mainsMin) && !(c in policy.mainsMax)));

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
    supplementToday: false,
    previousWeek,
  };

  const days = [];
  let relaxed = null;
  for (let day = 1; day <= 7; day++) {
    const dayRx = dayPrescriptions?.[day - 1] || prescription;
    // Порциите на ястията растат с енергията на деня и с по-малкия брой хранения (часов прозорец).
    ctx.appetite = Math.max(1, (dayRx.kcal || 0) / APPETITE_BASE_KCAL) * (dayRx.mealScale || 1);
    snackCtx.appetite = ctx.appetite;
    const meals = [];
    // Без закуска не се натиска за закуска — предлага се напитка за хидратация.
    if (morningDrink) meals.push({ ...drink });
    const todayDishes = new Set();
    state.mainFoodsToday = new Set();
    state.supplementToday = false;
    let carry = { protein: 0, carbs: 0, fats: 0 };
    /** Сглобените хранения на деня — за изравняването накрая. */
    const dayBuilt = [];

    for (const type of dayRx.slots) {
      const plan = dayRx.meals[type];
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
        // Основното хранене има белтъчен източник — „спанак с ориз“ сам не е обяд.
        const withProtein = pool.filter(d => proteinCapacity(d) >= 3);
        if (withProtein.length) pool = withProtein;
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

      /** Всички сглобени кандидати — от тях са и алтернативите на храненето. */
      let candidatesBuilt = [];
      const pick = (candidates, mealCtx) => {
        let found = null;
        candidatesBuilt = [];
        for (const d of candidates) {
          const choice = chooseOptions(d, state, mealCtx, rng, target);
          const built = buildMeal({ dish: d, choice, quota: plan.quota, target, mealKind: kind, ctx: mealCtx });
          if (!built || !built.parts.length) continue;
          let score = scoreMeal(d, built, state, mealCtx, kind === 'breakfast' ? category : null, kind);
          // Опростено: ястия с малко съставки, повторенията не се наказват.
          if (simplify) score += (state.dishUses.get(d.id) || 0) * 3 - built.parts.length * 0.6 - d.fixed.length * 0.4;
          // Какво клиентът е избирал или сменял в предишни седмици.
          score += (dishPreference[d.id] || 0) * PREFERENCE_WEIGHT;
          candidatesBuilt.push({ dish: d, built, score });
          if (!found || score > found.score) found = { dish: d, built, score };
        }
        return found;
      };
      const avoid = slotAvoid.filter(a => a.day === day && a.type === type).flatMap(a => a.avoid);
      let slotCtx = kind === 'snack' ? snackCtx : ctx;
      const slotAppetite = Math.max(slotCtx.appetite || 1, kcalOf(target) / (KIND_BASE_KCAL[kind] || 550));
      if (slotAppetite > (slotCtx.appetite || 1)) slotCtx = { ...slotCtx, appetite: slotAppetite };
      // Протеин на прах — най-много веднъж на ден.
      if (state.supplementToday) {
        const basePolicy = slotCtx.policy;
        slotCtx = { ...slotCtx, policy: { ...basePolicy, allowed: id => basePolicy.allowed(id) && !food(id).flags.has('supplement') } };
      }
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
      let usedCtx = slotCtx;
      // Основно хранене от свободна категория, което не стига белтъка (бобов боул
      // при висок белтък): търси се и в другите свободни категории, както при
      // алтернативите. Категориите с клинично правило за брой не се пипат.
      if (best && kind === 'main' && !avoid.length && swappable.has(category)
        && best.built.totals.protein < target.protein * PROTEIN_SHORT) {
        const keep = candidatesBuilt;
        const wider = (eligible.main || []).filter(d => d.category !== category && swappable.has(d.category) && proteinCapacity(d) >= 3
          && !todayDishes.has(d.id) && (state.dishUses.get(d.id) || 0) < maxUses && !state.yesterdayDishes.has(d.id)
          && !(state.mainFoodsToday.size && d.parts.some(p => p.group === 'PRO' && p.options.some(o => o.some(id => state.mainFoodsToday.has(id))))))
          .slice(0, CANDIDATES_PER_MEAL);
        const other = wider.length ? pick(wider, slotCtx) : null;
        if (other && other.score > best.score) best = other;
        else candidatesBuilt = keep;
      }
      if (!best && policy.withoutOnly) {
        // Избраните храни не стигат за това хранене — то се сглобява от целия каталог.
        relaxed = relaxed || (() => {
          const p = policy.withoutOnly();
          return { ctx: { ...ctx, policy: p, preferenceOf: id => p.preference(id) }, eligible: eligibleDishes(p) };
        })();
        best = pick((relaxed.eligible[kind] || []).filter(d => !todayDishes.has(d.id)), relaxed.ctx);
        usedCtx = relaxed.ctx;
      }
      if (!best) throw new Error(`Няма подходящо ястие за ${type} (ден ${day}) при тази диета`);

      let alternatives = pickAlternatives(best, candidatesBuilt, { kind, todayDishes, state, policy: slotCtx.policy, target });
      if (alternatives.length < MAX_ALTERNATIVES && !avoid.length) {
        // Още кандидати само за алтернативите — с отделен генератор, за да не се
        // промени самият план; основният избор вече е направен. Основното хранене
        // от свободна категория търси и в другите свободни категории (пиле ↔ бобово ↔ …).
        const tried = new Set(candidatesBuilt.map(c => c.dish.id));
        const wider = kind === 'main' && swappable.has(category)
          ? (eligible.main || []).filter(d => d.category !== category && swappable.has(d.category) && proteinCapacity(d) >= 3
            && !todayDishes.has(d.id) && (state.dishUses.get(d.id) || 0) < maxUses && !state.yesterdayDishes.has(d.id))
          : [];
        const more = [];
        for (const d of [...pool, ...wider]) {
          if (tried.has(d.id) || more.length >= CANDIDATES_PER_MEAL * 2) continue;
          const built = buildMeal({ dish: d, choice: chooseOptions(d, state, slotCtx, altRng, target), quota: plan.quota, target, mealKind: kind, ctx: slotCtx });
          if (built?.parts.length) more.push({ dish: d, built, score: scoreMeal(d, built, state, slotCtx, kind === 'breakfast' ? category : null, kind) + (dishPreference[d.id] || 0) * PREFERENCE_WEIGHT });
        }
        alternatives = pickAlternatives(best, [...candidatesBuilt, ...more], { kind, todayDishes, state, policy: slotCtx.policy, target });
      }
      recordUse(best.dish, best.built, state);
      if ([...mealFoods(best.built)].some(id => food(id).flags.has('supplement'))) state.supplementToday = true;
      todayDishes.add(best.dish.id);
      if (kind === 'main') {
        const proteinPart = best.built.parts.find(p => p.group === 'PRO' || p.group === 'LEG');
        for (const id of proteinPart?.foods || []) state.mainFoodsToday.add(id);
      }
      for (const k of ['protein', 'carbs', 'fats']) carry[k] = target[k] - best.built.totals[k];
      const meal = toPlanMeal(type, best.dish, best.built, dessertToday);
      // Целта на храненето е тази след пренесения остатък и десерта.
      meal.targetCalories = round(target.protein * 4 + target.carbs * 4 + target.fats * 9 + (dessertToday ? FIXED_DESSERT.calories : 0));
      // Проверката е върху крайните калории (след кухненските грамажи), както ги вижда клиентът.
      const altMeals = alternatives
        .map(a => ({ ...toPlanMeal(type, a.dish, a.built, dessertToday), targetCalories: meal.targetCalories }))
        .filter(a => nearKcal(a.calories, meal.calories) || nearKcal(a.calories, meal.targetCalories))
        .slice(0, MAX_ALTERNATIVES);
      if (altMeals.length) meal.alternatives = altMeals;
      meals.push(meal);
      dayBuilt.push({ i: meals.length - 1, type, kind, dish: best.dish, built: best.built, target, dessertToday, ctx: usedCtx, alts: alternatives, quota: plan.quota, baseCtx: kind === 'snack' || kind === 'late' ? snackCtx : ctx });
    }
    if (!meals.some(m => m.type === FREE_MEAL)) {
      const dayTarget = dayTargetOf(dayRx, dayRx.slots);
      balanceDay(meals, dayBuilt, dayTarget, policy);
      shakeForProteinGap(meals, dayBuilt, dayTarget, policy);
    }
    // Ястие се среща веднъж в деня — и сред алтернативите: нито повторение на
    // друго хранене от деня, нито една и съща алтернатива на две хранения.
    const dayMeals = /** @type {any[]} */ (meals);
    const offered = new Set(dayMeals.map(m => m.dishId).filter(Boolean));
    for (const m of dayMeals) {
      if (!m.alternatives) continue;
      m.alternatives = m.alternatives.filter(a => !offered.has(a.dishId));
      m.alternatives.forEach(a => offered.add(a.dishId));
      if (!m.alternatives.length) delete m.alternatives;
    }
    state.yesterdayDishes = todayDishes;
    // Храните и грамовете на деня — за качеството на менюто (фибри, разнообразие).
    const foods = dayBuilt.map(e => ({
      main: e.kind === 'main',
      protein: e.built.totals.protein,
      foods: describeMeal(e.built).map(l => ({ id: l.id, grams: l.grams })),
    }));
    days.push({ meals, foods });
  }

  const stats = {
    mains: frame.reduce((acc, k) => ({ ...acc, [k]: (acc[k] || 0) + 1 }), {}),
    eggsMeals: state.kindUses.egg || 0,
    distinctDishes: state.dishUses.size,
  };
  return { days, stats };
}

