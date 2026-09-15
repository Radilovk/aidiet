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
import dishesDocument from './data/meal-dishes.json' with { type: 'json' };

/**
 * @param {{ id: string, name: string, products: Array<{name: string, grams: number}>,
 *   timing: string[], vegan?: boolean, vegetarian?: boolean, universality?: number, tags?: string[] }} raw
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
    vegan: !!raw.vegan,
    vegetarian: raw.vegetarian !== undefined ? !!raw.vegetarian : !!raw.vegan,
    universality: raw.universality ?? 4,
    tags: Array.isArray(raw.tags) ? [...raw.tags] : [],
  };
}

export const MEAL_DISHES = (dishesDocument.dishes || []).map(normalizeDish);

/** Ястия по id — за бърза проверка. */
export const MEAL_DISHES_BY_ID = new Map(MEAL_DISHES.map(d => [d.id, d]));

/** Кои слотове приема едно ястие, изведено от timing. */
export const DISH_TIMINGS = ['breakfast', 'main', 'snack', 'late_snack'];

/**
 * Ястие → каталожен запис (group ready_meal).
 * @param {{ id: string, name: string, products: Array<{name: string, share: number, grams?: number}>,
 *   timing: string[], vegan: boolean, vegetarian: boolean, universality: number, tags?: string[] }} d
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
