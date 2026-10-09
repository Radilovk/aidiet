/**
 * Формули на чинии → ястия.
 *
 * Едно ястие в data/plate-formulas.json е основа плюс изрично разрешени
 * варианти (гарнитура, зеленчук, мазнина...). Тук формулите се разгъват в
 * конкретни ястия: име, продукти, флагове. Нищо не се съчетава свободно —
 * всяка комбинация е изброена във формулата, затова всяка е реална чиния.
 *
 * Флаговете (веган, вегетарианско) и универсалността се извеждат от
 * съставките, не се пишат на ръка: ястие е веган само ако всичко в него е.
 */

import formulasDocument from './data/plate-formulas.json' with { type: 'json' };
import { FOOD_CATALOG } from './food-catalog-data.js';
import { normalizeFoodKey } from './food-utils.js';

const MAX_PRODUCTS = 4;
/** Групите, които носят „основния протеин“ на ястието. */
const PROTEIN_GROUPS = ['protein', 'legume', 'dairy'];

let foodIndexCache = null;

/** Каталожен запис по име — пълно име, нормализирано име, ключ или синоним. */
function foodIndex() {
  if (foodIndexCache) return foodIndexCache;
  const full = new Map();
  const loose = new Map();
  for (const entry of FOOD_CATALOG) {
    const fullKey = String(entry.name).toLowerCase().trim();
    if (!full.has(fullKey)) full.set(fullKey, entry);
    for (const key of [entry.name, entry.nutritionKey, ...(entry.aliases || [])].map(normalizeFoodKey)) {
      if (key && !loose.has(key)) loose.set(key, entry);
    }
  }
  foodIndexCache = { full, loose };
  return foodIndexCache;
}

export function catalogFoodOf(name) {
  const { full, loose } = foodIndex();
  return full.get(String(name || '').toLowerCase().trim()) || loose.get(normalizeFoodKey(name)) || null;
}

/**
 * Основният протеин на ястието — за правилото „не две пилешки чинии в един
 * ден“. Конкретните разновидности се свеждат до общото (пилешки гърди → пиле).
 */
export function proteinKeyOf(products = []) {
  for (const p of products) {
    const entry = catalogFoodOf(p.name);
    if (entry && PROTEIN_GROUPS.includes(entry.group)) return entry.genericOf || entry.id;
  }
  return null;
}

function optionsOf(choice, sets) {
  if (choice.set) {
    const set = sets[choice.set];
    if (!set) throw new Error(`Непознат набор „${choice.set}“`);
    return set;
  }
  return choice.options || [];
}

function cartesian(lists) {
  return lists.reduce(
    (acc, list) => acc.flatMap(prefix => list.map(item => [...prefix, item])),
    [[]],
  );
}

/** „с“ или „със“ — пред „с“ и „з“ българският иска „със“. */
function withPreposition(word) {
  return /^[сз]/i.test(word) ? 'със' : 'с';
}

function joinList(labels) {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} и ${labels[labels.length - 1]}`;
}

function dishName(base, labels) {
  if (!labels.length) return base;
  // Основата вече може да носи „с …“ („Салата с риба тон“) — тогава
  // вариантите се добавят към същия списък, не с второ „с“.
  if (/(^|\s)(с|със)\s/i.test(base)) {
    return labels.length === 1 ? `${base} и ${labels[0]}` : `${base}, ${joinList(labels)}`;
  }
  return `${base} ${withPreposition(labels[0])} ${joinList(labels)}`;
}

function mergeProducts(list) {
  const out = [];
  for (const [name, grams] of list) {
    const existing = out.find(p => p.name === name);
    if (existing) existing.grams += grams;
    else out.push({ name, grams });
  }
  return out;
}

/**
 * @param {object} [doc] съдържанието на plate-formulas.json
 * @returns {Array<{ id: string, name: string, products: Array<{name: string, grams: number}>,
 *   timing: string[], vegan: boolean, vegetarian: boolean, universality: number,
 *   tags: string[], family: string, source: string }>}
 */
export function expandPlateFormulas(doc = formulasDocument) {
  const sets = doc.sets || {};
  const dishes = [];
  const seen = new Set();

  for (const formula of doc.formulas || []) {
    const choices = formula.choices || [];
    const combos = cartesian(choices.map(c => optionsOf(c, sets).map(option => ({ choice: c, option }))));

    for (const combo of combos) {
      let base = formula.base;
      const labels = [];
      const keys = [];
      for (const { choice, option } of combo) {
        keys.push(option.key);
        if (choice.key && base.includes(`{${choice.key}}`)) {
          base = base.replace(`{${choice.key}}`, option.title);
        } else if (option.label) {
          labels.push(option.label);
        }
      }

      const products = mergeProducts([
        ...(formula.core || []),
        ...combo.flatMap(({ option }) => option.products || []),
        ...(formula.extra || []),
      ]);
      const id = `f_${formula.id}_${keys.join('_')}`;
      if (seen.has(id)) throw new Error(`Повтарящо се ястие ${id}`);
      seen.add(id);
      if (products.length > MAX_PRODUCTS) {
        throw new Error(`${id}: ${products.length} продукта — най-много ${MAX_PRODUCTS}`);
      }

      const foods = products.map(p => catalogFoodOf(p.name));
      if (foods.some(f => !f)) {
        const unknown = products.filter((_, i) => !foods[i]).map(p => p.name);
        throw new Error(`${id}: непознати продукти ${unknown.join(', ')}`);
      }

      dishes.push({
        id,
        name: dishName(base, labels),
        products,
        timing: [...formula.timing],
        vegan: foods.every(f => f.vegan),
        vegetarian: foods.every(f => f.vegetarian || f.vegan),
        universality: Math.min(4, ...foods.map(f => f.universality ?? 4)),
        tags: [...(formula.tags || [])],
        family: formula.id,
        source: 'formula',
      });
    }
  }
  return dishes;
}
