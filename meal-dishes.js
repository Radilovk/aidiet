/**
 * ЯСТИЯ — единственият списък, от който планът избира хранения.
 *
 * РЕДАКТИРАЙ: data/meal-dishes.json (директно в repo)
 * Този файл само зарежда JSON-а и подравнява грамажите към мрежата 5/50 g.
 *
 * Админ KV overlay (допълнителни/изключени ястия): admin-food-catalog.js
 */
import { snapGrams } from './gram-rounding.js';
import { inferDishTags } from './dish-tags.js';
import { catalogFoodOf, expandPlateFormulas, proteinKeyOf } from './plate-formulas.js';
import dishesDocument from './data/meal-dishes.json' with { type: 'json' };

/**
 * Веган/вегетарианско — от съставките, не от ръчен флаг: ястие е веган само
 * ако всеки продукт е. Ръчният флаг остава само при непознат продукт.
 */
function dietFlags(raw) {
  const foods = (raw.products || []).map(p => catalogFoodOf(p.name));
  if (!foods.length || foods.some(f => !f)) {
    return { vegan: !!raw.vegan, vegetarian: raw.vegetarian !== undefined ? !!raw.vegetarian : !!raw.vegan };
  }
  return {
    vegan: foods.every(f => f.vegan),
    vegetarian: foods.every(f => f.vegan || f.vegetarian),
  };
}

/**
 * @param {{ id: string, name: string, products: Array<{name: string, grams: number}>,
 *   timing: string[], vegan?: boolean, vegetarian?: boolean, universality?: number, tags?: string[],
 *   family?: string, source?: string }} raw
 */
function normalizeDish(raw) {
  const snapped = (raw.products || []).map(p => ({
    name: p.name,
    grams: snapGrams(Number(p.grams) || 0),
  }));
  const totalGrams = snapped.reduce((sum, p) => sum + p.grams, 0) || 1;
  return {
    id: raw.id,
    name: raw.name,
    products: snapped.map(p => ({
      name: p.name,
      grams: p.grams,
      share: p.grams / totalGrams,
    })),
    referenceGrams: totalGrams,
    timing: [...(raw.timing || [])],
    ...dietFlags(raw),
    universality: raw.universality ?? 4,
    tags: Array.isArray(raw.tags) ? [...raw.tags] : [],
    // Семейство: вариантите на една формула са едно ястие за разнообразието.
    family: raw.family || raw.id,
    proteinKey: proteinKeyOf(snapped),
    source: raw.source || 'curated',
  };
}

/**
 * Ръчно курираните ястия + разгънатите формули на чинии
 * (data/plate-formulas.json).
 */
export const MEAL_DISHES = [
  ...(dishesDocument.dishes || []),
  ...expandPlateFormulas(),
].map(normalizeDish);

/** Ястия по id — за бърза проверка. */
export const MEAL_DISHES_BY_ID = new Map(MEAL_DISHES.map(d => [d.id, d]));

/** Кои слотове приема едно ястие, изведено от timing. */
export const DISH_TIMINGS = ['breakfast', 'main', 'snack', 'late_snack'];

/**
 * Ястие → каталожен запис (group ready_meal).
 * @param {{ id: string, name: string, products: Array<{name: string, share: number, grams?: number}>,
 *   timing: string[], vegan: boolean, vegetarian: boolean, universality: number, tags?: string[],
 *   family?: string, proteinKey?: string|null }} d
 * @param {(name: string) => string|null} groupOfProduct
 */
export function dishToCatalogEntry(d, groupOfProduct) {
  const groups = d.products.map(p => groupOfProduct(p.name));
  const slots = new Set();
  if (groups.some(g => ['protein', 'dairy', 'legume'].includes(g))) slots.add('PRO');
  if (groups.some(g => ['carb', 'legume', 'fruit'].includes(g))) slots.add('ENG');
  if (groups.some(g => g === 'vegetable')) slots.add('VOL');
  if (groups.some(g => g === 'fat')) slots.add('FAT');
  if (!slots.size) slots.add('PRO');

  return {
    id: d.id,
    name: d.name,
    nutritionKey: d.id,
    group: 'ready_meal',
    slots: [...slots],
    timing: [...d.timing],
    universality: d.universality,
    vegan: d.vegan,
    vegetarian: d.vegetarian,
    family: d.family || d.id,
    proteinKey: d.proteinKey || null,
    tags: d.tags?.length ? [...d.tags] : [],
    dishTags: inferDishTags(d),
    genericOf: null,
    aliases: [],
    scalingMode: null,
    fixedNutrition: null,
    source: 'meal_dishes',
  };
}

/**
 * Ястие → декомпозиция за solver-а.
 * @param {{ products: Array<{name: string, share: number, grams: number}> }} d
 */
export function dishToParts(d) {
  return d.products.map(p => ({ name: p.name, share: p.share, grams: p.grams }));
}
