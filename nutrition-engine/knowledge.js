/**
 * Знанието на двигателя: храни по обменни групи, хранителни модели, клинични
 * правила и ястия. Всичко е данни в data/engine/ — тук само се зарежда,
 * проверява и индексира. Грешка в данните спира зареждането, за да не стигне
 * до клиент план от несъществуваща храна.
 */

import foodsJson from '../data/engine/foods.json' with { type: 'json' };
import patternsJson from '../data/engine/diet-patterns.json' with { type: 'json' };
import clinicalJson from '../data/engine/clinical.json' with { type: 'json' };
import dishesJson from '../data/engine/dishes.json' with { type: 'json' };
import { FOOD_CATALOG } from '../food-catalog-data.js';
import { FOOD_NUTRITION_PER_100G } from '../food-nutrition-data.js';

/** @typedef {'STA'|'LEG'|'FRU'|'VEG'|'MLK'|'PRO'|'FAT'|'SWT'|'FREE'} ExchangeGroup */
/** @typedef {{ kcal: number, protein: number, carbs: number, fats: number }} Nutrients */

/**
 * @typedef {object} Food
 * @property {string} id
 * @property {string} name        каталожното име — то влиза в описанието на храненето
 * @property {string} nutritionKey
 * @property {string} label       името в названието на ястието
 * @property {ExchangeGroup} group
 * @property {string|null} kind
 * @property {Set<string>} flags
 * @property {{ one: string, many: string, grams: number }|null} unit
 * @property {boolean} vegan
 * @property {boolean} vegetarian
 * @property {Nutrients} per100
 * @property {number} serving     грамове за една обменна порция
 */

// Данните се проверяват при зареждане по-долу; за типовете са свободни обекти.
/** @type {any} */ const foodsDoc = foodsJson;
/** @type {any} */ const patternsDoc = patternsJson;
/** @type {any} */ const clinicalDoc = clinicalJson;
/** @type {any} */ const dishesDoc = dishesJson;

export const GROUPS = foodsDoc.groups;
export const STYLES = patternsDoc.styles;
export const PATTERNS = patternsDoc.patterns;
export const KCAL_LEVELS = patternsDoc.kcalLevels;
export const DISTRIBUTIONS = patternsDoc.distributions;
export const MEAL_BOUNDS = patternsDoc.mealBounds;
export const VEGAN_BREAKFASTS = patternsDoc.veganBreakfasts;
export const CONDITIONS = clinicalDoc.conditions;
export const PROTOCOLS = clinicalDoc.protocols;
export const EXCLUSION_RULES = clinicalDoc.exclusions;
export const SEASONS = dishesDoc.seasons;
export const SIDES = dishesDoc.sides;

const catalogById = new Map(FOOD_CATALOG.map(e => [e.id, e]));

function per100Of(entry) {
  const row = FOOD_NUTRITION_PER_100G[entry.nutritionKey];
  if (!row) throw new Error(`Храната ${entry.id} няма хранителни стойности (${entry.nutritionKey})`);
  return { kcal: row[0], protein: row[1], carbs: row[2], fats: row[3] };
}

/** Грамове за една обменна порция — от котвата на групата и реалната храна. */
function servingGrams(def, per100) {
  if (def.serving) return def.serving;
  const anchor = GROUPS[def.group].anchor;
  if (anchor.grams) return anchor.grams;
  const [nutrient, amount] = Object.entries(anchor)[0];
  const perGram = per100[nutrient] / 100;
  return perGram > 0 ? Math.round(amount / perGram) : 100;
}

/** @type {Map<string, Food>} */
export const FOODS = new Map();
for (const [id, def] of Object.entries(foodsDoc.foods)) {
  const entry = catalogById.get(id);
  if (!entry) throw new Error(`data/engine/foods.json: ${id} липсва в каталога`);
  if (!GROUPS[def.group]) throw new Error(`data/engine/foods.json: ${id} има непозната група ${def.group}`);
  const per100 = per100Of(entry);
  FOODS.set(id, {
    id,
    name: entry.name,
    nutritionKey: entry.nutritionKey,
    label: def.label,
    group: def.group,
    kind: def.kind || null,
    flags: new Set(def.flags || []),
    unit: def.unit || null,
    vegan: !!entry.vegan,
    vegetarian: !!(entry.vegetarian || entry.vegan),
    per100,
    serving: servingGrams(def, per100),
  });
}

export function food(id) {
  const f = FOODS.get(id);
  if (!f) throw new Error(`Непозната храна ${id}`);
  return f;
}

/** Хранителни стойности на грамаж от храна. */
export function nutrientsOf(id, grams) {
  const p = food(id).per100;
  const k = (Number(grams) || 0) / 100;
  return { kcal: p.kcal * k, protein: p.protein * k, carbs: p.carbs * k, fats: p.fats * k };
}

/** Храна по каталожно име — за преизчисляване на план от описанието му. */
const foodByName = new Map([...FOODS.values()].map(f => [f.name.toLowerCase(), f]));
export function foodByCatalogName(name) {
  return foodByName.get(String(name || '').trim().toLowerCase()) || null;
}

/* ─── Ястия ─────────────────────────────────────────────────────────── */

/**
 * @typedef {object} DishPart
 * @property {ExchangeGroup} group
 * @property {string[][]} options   всеки вариант е една храна или смес от храни
 * @property {[number, number]} range  порции
 * @property {boolean} with          вариантът влиза в името („с булгур“)
 */

/**
 * @typedef {object} Dish
 * @property {string} id
 * @property {string[]} meals        main | breakfast | snack | late
 * @property {string} category
 * @property {string|null} breakfastCategory
 * @property {string} name
 * @property {DishPart[]} parts
 * @property {Array<[string, number]>} fixed
 * @property {string[]} sides
 * @property {string[]|null} seasonsOnly
 * @property {string|null} requires
 * @property {boolean} fruitPaired
 * @property {boolean} fruitAlone    плод без белтък/мазнина — не и при инсулинова резистентност
 */

function normalizePart(dishId, part) {
  const options = part.options.map(o => (Array.isArray(o) ? o : [o]));
  for (const option of options) {
    for (const id of option) {
      const f = food(id);
      if (f.group !== part.group) {
        throw new Error(`Ястие ${dishId}: ${id} е ${f.group}, а частта е ${part.group}`);
      }
    }
  }
  const [min, max] = part.range;
  if (!(min >= 0 && max >= min)) throw new Error(`Ястие ${dishId}: невалиден диапазон ${part.range}`);
  return { group: part.group, options, range: [min, max], with: !!part.with };
}

/** @type {Dish[]} */
export const DISHES = dishesDoc.dishes.map(d => {
  for (const [id] of d.fixed || []) food(id);
  return {
    id: d.id,
    meals: d.meals,
    category: d.category,
    breakfastCategory: d.breakfastCategory || null,
    name: d.name,
    parts: d.parts.map(p => normalizePart(d.id, p)),
    fixed: d.fixed || [],
    sides: d.sides || [],
    seasonsOnly: d.seasonsOnly || null,
    requires: d.requires || null,
    fruitPaired: !!d.fruitPaired,
    fruitAlone: !!d.fruitAlone,
  };
});

const seenIds = new Set();
for (const d of DISHES) {
  if (seenIds.has(d.id)) throw new Error(`Повтарящо се ястие ${d.id}`);
  seenIds.add(d.id);
}

for (const [key, side] of Object.entries(SIDES)) {
  for (const id of side.options || []) {
    if (food(id).group !== side.group) throw new Error(`Гарнитура ${key}: ${id} не е ${side.group}`);
  }
  for (const salad of side.salads || []) for (const id of salad.foods) food(id);
}

export const DISHES_BY_ID = new Map(DISHES.map(d => [d.id, d]));
