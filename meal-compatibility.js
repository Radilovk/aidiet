/**
 * Structural checks on a meal's product list.
 *
 * Deliberately NOT a cuisine rulebook. Pairing is a matter of taste and
 * tradition, and encoding it as a table gets it wrong: an earlier version of
 * this module rejected "Леща с ориз" (lentils and rice — a complete protein and
 * one of the oldest dishes there is) and "риба с бобови" (a tuna and bean
 * salad). Plated meals now come from the curated dish catalog, which is
 * coherent by construction, so the composer needs no such rules; and where an
 * AI composes the fallback, it already knows what goes together — one line in
 * the prompt does more than a table here would.
 *
 * What remains are defects no cuisine excuses in a nutrition plan: a second
 * starch, a sweetener or a table sauce listed as a component, and sweet fruit
 * served as part of a meat or fish plate.
 *
 * Bulgarian text note: JavaScript's `\b` is defined over `[A-Za-z0-9_]`, so it
 * never matches at a Cyrillic boundary — `/\bмед\b/` silently tests false for
 * every Bulgarian string.
 */

import { resolveCatalogEntry } from './food-catalog.js';

/** Catalog group of a product name — the authoritative classification. */
export function groupOfProduct(name) {
  return resolveCatalogEntry(name).entry?.group ?? null;
}

export function isVegetableProduct(name) {
  return groupOfProduct(name) === 'vegetable';
}

/** Sweet fruit — berries and citrus garnish are not what makes a plate wrong. */
const SWEET_FRUIT_STEMS = ['банан', 'ябълк', 'портокал', 'мандарин', 'грозде', 'круша',
  'праскова', 'диня', 'пъпеш', 'ананас', 'манго', 'смокин', 'кайси', 'слив'];

const FLESH_STEMS = ['риба', 'сьомга', 'тон', 'треска', 'скумри', 'тилапи', 'лаврак',
  'скариди', 'калмар', 'пилешк', 'пиле', 'пуешк', 'пуйка', 'говежд', 'свинск', 'телешк',
  'агнешк', 'кайма'];

const SWEETENER_STEMS = ['мед', 'захар', 'сироп', 'конфитюр', 'нектар'];

function matchesStem(name, stems) {
  const lower = String(name || '').toLowerCase();
  return stems.some(stem => lower.includes(stem));
}

/**
 * @param {string[]} productNames
 * @param {{ allowSweetener?: boolean }} [options]
 * @returns {string[]} human-readable issues
 */
export function checkProductCompatibility(productNames, options = {}) {
  const names = (productNames || []).map(n => String(n || '').trim()).filter(Boolean);
  if (!names.length) return [];
  const issues = [];

  const starches = [...new Set(names.filter(n => groupOfProduct(n) === 'carb'))];
  if (starches.length > 1) {
    issues.push(`повече от един въглехидратен източник (${starches.join(', ')})`);
  }

  const condiments = [...new Set(names.filter(n => groupOfProduct(n) === 'condiment'))];
  const sweeteners = condiments.filter(n => matchesStem(n, SWEETENER_STEMS));
  const sauces = condiments.filter(n => !matchesStem(n, SWEETENER_STEMS));
  if (sweeteners.length && !options.allowSweetener) {
    issues.push(`подсладител в основно хранене (${sweeteners.join(', ')})`);
  }
  if (sauces.length) {
    issues.push(`готов сос/подправка като съставка на хранене (${sauces.join(', ')})`);
  }

  const fruit = [...new Set(names.filter(n => matchesStem(n, SWEET_FRUIT_STEMS)))];
  const flesh = [...new Set(names.filter(n => matchesStem(n, FLESH_STEMS)))];
  if (fruit.length && flesh.length) {
    issues.push(`сладък плод с месо или риба (${[...flesh, ...fruit].join(' + ')})`);
  }

  return issues;
}
