/**
 * Export / import / validate editable catalog lists (JSON ↔ JS source files).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEAL_DISHES } from '../meal-dishes.js';
import { FOOD_CATALOG } from '../food-catalog-data.js';
import { FOOD_NUTRITION_PER_100G } from '../food-nutrition-data.js';
import {
  GROUP_MAX_PORTION_G,
  GROUP_MIN_PORTION_G,
  ITEM_MAX_PORTION_G,
  ITEM_MIN_PORTION_G,
  COOKING_FAT_KEYS,
  COOKING_FAT_MAX_PORTION_G,
  DEFAULT_MAX_PORTION_G,
  DEFAULT_MIN_PORTION_G,
} from '../portion-limits.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LISTS_DIR = join(root, 'data', 'lists');

export const LIST_IDS = [
  'meal-dishes',
  'food-catalog',
  'food-nutrition',
  'portion-limits',
];

function jsString(s) {
  return JSON.stringify(String(s ?? ''));
}

function jsArray(arr, indent = '  ') {
  const inner = arr.map(v => jsString(v)).join(', ');
  return `[${inner}]`;
}

function readText(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function writeText(rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function replaceBetweenMarkers(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Markers not found: ${startMarker} … ${endMarker}`);
  }
  return source.slice(0, start + startMarker.length) + replacement + source.slice(end);
}

// ── Export shapes ───────────────────────────────────────────────────────────

export function exportMealDishes() {
  return {
    schema: 'meal-dishes/v1',
    updatedAt: new Date().toISOString(),
    count: MEAL_DISHES.length,
    dishes: MEAL_DISHES.map(d => ({
      id: d.id,
      name: d.name,
      products: d.products.map(p => ({ name: p.name, grams: p.grams })),
      timing: [...d.timing],
      vegan: !!d.vegan,
      vegetarian: d.vegetarian !== undefined ? !!d.vegetarian : !!d.vegan,
      universality: d.universality ?? 4,
      tags: Array.isArray(d.tags) ? [...d.tags] : [],
    })),
  };
}

export function exportFoodCatalog() {
  return {
    schema: 'food-catalog/v1',
    updatedAt: new Date().toISOString(),
    count: FOOD_CATALOG.length,
    items: FOOD_CATALOG.map(e => ({
      id: e.id,
      name: e.name,
      nutritionKey: e.nutritionKey,
      group: e.group,
      slots: [...e.slots],
      timing: [...e.timing],
      universality: e.universality,
      vegan: !!e.vegan,
      vegetarian: e.vegetarian !== undefined ? !!e.vegetarian : true,
      genericOf: e.genericOf || null,
      aliases: Array.isArray(e.aliases) ? [...e.aliases] : [],
      scalingMode: e.scalingMode || null,
      fixedNutrition: e.fixedNutrition || null,
      meat: e.meat,
    })),
  };
}

export function exportFoodNutrition() {
  const entries = Object.entries(FOOD_NUTRITION_PER_100G)
    .sort(([a], [b]) => a.localeCompare(b, 'bg'));
  return {
    schema: 'food-nutrition/v1',
    updatedAt: new Date().toISOString(),
    count: entries.length,
    entries: Object.fromEntries(entries),
  };
}

export function exportPortionLimits() {
  return {
    schema: 'portion-limits/v1',
    updatedAt: new Date().toISOString(),
    count: Object.keys(ITEM_MAX_PORTION_G).length,
    defaults: {
      maxPortionG: DEFAULT_MAX_PORTION_G,
      minPortionG: DEFAULT_MIN_PORTION_G,
      cookingFatMaxPortionG: COOKING_FAT_MAX_PORTION_G,
    },
    cookingFatKeys: [...COOKING_FAT_KEYS].sort(),
    groupMax: { ...GROUP_MAX_PORTION_G },
    groupMin: { ...GROUP_MIN_PORTION_G },
    itemMax: { ...ITEM_MAX_PORTION_G },
    itemMin: { ...ITEM_MIN_PORTION_G },
  };
}

export function exportList(id) {
  switch (id) {
    case 'meal-dishes': return exportMealDishes();
    case 'food-catalog': return exportFoodCatalog();
    case 'food-nutrition': return exportFoodNutrition();
    case 'portion-limits': return exportPortionLimits();
    default: throw new Error(`Unknown list: ${id}`);
  }
}

// ── Codegen ─────────────────────────────────────────────────────────────────

function formatDishOpts(d) {
  const opts = {};
  if (d.vegan) opts.vegan = true;
  if (d.vegetarian !== undefined && d.vegetarian !== !!d.vegan) opts.vegetarian = !!d.vegetarian;
  if (d.universality !== undefined && d.universality !== 4) opts.universality = d.universality;
  if (Array.isArray(d.tags) && d.tags.length) opts.tags = d.tags;
  const keys = Object.keys(opts);
  if (!keys.length) return '';
  const inner = keys.map(k => {
    if (k === 'tags') return `tags: ${jsArray(opts.tags)}`;
    return `${k}: ${opts[k]}`;
  }).join(', ');
  return `, { ${inner} }`;
}

function formatDishLine(d) {
  const products = d.products.map(p => `[${jsString(p.name)}, ${Number(p.grams)}]`).join(', ');
  const timing = jsArray(d.timing);
  return `  dish(${jsString(d.id)}, ${jsString(d.name)}, [${products}],\n    ${timing}${formatDishOpts(d)}),`;
}

function formatCatalogOpts(e) {
  const opts = {};
  if (e.vegan) opts.vegan = true;
  if (e.vegetarian === false) opts.vegetarian = false;
  if (e.meat) opts.meat = true;
  if (e.genericOf) opts.genericOf = e.genericOf;
  if (e.aliases?.length) opts.aliases = e.aliases;
  if (e.scalingMode) opts.scalingMode = e.scalingMode;
  if (e.fixedNutrition) opts.fixedNutrition = e.fixedNutrition;
  const keys = Object.keys(opts);
  if (!keys.length) return '';
  const parts = keys.map(k => {
    if (k === 'aliases') return `aliases: ${jsArray(opts.aliases)}`;
    if (k === 'fixedNutrition') return `fixedNutrition: ${JSON.stringify(opts.fixedNutrition)}`;
    if (typeof opts[k] === 'string') return `${k}: ${jsString(opts[k])}`;
    return `${k}: ${opts[k]}`;
  });
  return `, { ${parts.join(', ')} }`;
}

function formatCatalogLine(e) {
  const slots = jsArray(e.slots);
  const timing = jsArray(e.timing);
  return `  item(${jsString(e.id)}, ${jsString(e.name)}, ${jsString(e.nutritionKey)}, ${jsString(e.group)}, ${slots}, ${timing}, ${Number(e.universality)}${formatCatalogOpts(e)}),`;
}

function formatNutritionBlock(entries) {
  const lines = Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b, 'bg'))
    .map(([key, vals]) => {
      const [kcal, p, c, f] = vals;
      return `  ${jsString(key)}: [${kcal}, ${p}, ${c}, ${f}],`;
    });
  return `\n${lines.join('\n')}\n`;
}

function formatPortionObject(obj, indent = '  ') {
  return Object.entries(obj)
    .sort(([a], [b]) => a.localeCompare(b, 'bg'))
    .map(([k, v]) => `${indent}${jsString(k)}: ${v},`)
    .join('\n');
}

// ── Validation ──────────────────────────────────────────────────────────────

export function validateMealDishes(doc) {
  const errors = [];
  const ids = new Set();
  for (const d of doc.dishes || []) {
    if (!d.id) errors.push('dish without id');
    if (ids.has(d.id)) errors.push(`duplicate id ${d.id}`);
    ids.add(d.id);
    if (!d.name?.trim()) errors.push(`name required for ${d.id}`);
    const products = d.products || [];
    if (products.length < 2 || products.length > 4) {
      errors.push(`${d.id}: 2–4 products required`);
    }
    for (const p of products) {
      if (!p.name?.trim()) errors.push(`${d.id}: product name required`);
      if (!Number.isFinite(Number(p.grams)) || Number(p.grams) <= 0) {
        errors.push(`${d.id}: invalid grams for ${p.name}`);
      }
    }
    if (!Array.isArray(d.timing) || !d.timing.length) {
      errors.push(`${d.id}: timing required`);
    }
  }
  return errors;
}

export function validateFoodCatalog(doc) {
  const errors = [];
  const ids = new Set();
  const groups = new Set(['protein', 'dairy', 'vegetable', 'carb', 'fat', 'fruit', 'legume', 'condiment', 'beverage', 'ready_meal']);
  for (const e of doc.items || []) {
    if (!e.id) errors.push('item without id');
    if (ids.has(e.id)) errors.push(`duplicate id ${e.id}`);
    ids.add(e.id);
    if (!e.name?.trim()) errors.push(`name required for ${e.id}`);
    if (!e.nutritionKey?.trim()) errors.push(`nutritionKey required for ${e.id}`);
    if (!groups.has(e.group)) errors.push(`${e.id}: invalid group ${e.group}`);
    if (!e.slots?.length) errors.push(`${e.id}: slots required`);
    if (!e.timing?.length) errors.push(`${e.id}: timing required`);
  }
  return errors;
}

export function validateFoodNutrition(doc) {
  const errors = [];
  for (const [key, vals] of Object.entries(doc.entries || {})) {
    if (!Array.isArray(vals) || vals.length !== 4) {
      errors.push(`${key}: must be [kcal, P, C, F]`);
      continue;
    }
    if (vals.some(v => !Number.isFinite(Number(v)))) {
      errors.push(`${key}: non-numeric macro`);
    }
  }
  return errors;
}

export function validatePortionLimits(doc) {
  const errors = [];
  for (const table of ['groupMax', 'groupMin', 'itemMax', 'itemMin']) {
    for (const [k, v] of Object.entries(doc[table] || {})) {
      if (!Number.isFinite(Number(v)) || Number(v) < 0) {
        errors.push(`${table}.${k}: invalid number`);
      }
    }
  }
  return errors;
}

export function validateList(id, doc) {
  switch (id) {
    case 'meal-dishes': return validateMealDishes(doc);
    case 'food-catalog': return validateFoodCatalog(doc);
    case 'food-nutrition': return validateFoodNutrition(doc);
    case 'portion-limits': return validatePortionLimits(doc);
    default: throw new Error(`Unknown list: ${id}`);
  }
}

// ── Import ──────────────────────────────────────────────────────────────────

export function importMealDishes(doc) {
  const errors = validateMealDishes(doc);
  if (errors.length) throw new Error(errors.join('; '));
  const body = '\n' + doc.dishes.map(formatDishLine).join('\n') + '\n';
  const source = readText('meal-dishes.js');
  const updated = replaceBetweenMarkers(source, 'export const MEAL_DISHES = [', '];', body);
  writeText('meal-dishes.js', updated);
  return doc.dishes.length;
}

export function importFoodCatalog(doc) {
  const errors = validateFoodCatalog(doc);
  if (errors.length) throw new Error(errors.join('; '));
  const body = '\n' + doc.items.map(formatCatalogLine).join('\n') + '\n';
  const source = readText('food-catalog-data.js');
  const updated = replaceBetweenMarkers(source, 'export const FOOD_CATALOG = [', '];', body);
  writeText('food-catalog-data.js', updated);
  return doc.items.length;
}

export function importFoodNutrition(doc) {
  const errors = validateFoodNutrition(doc);
  if (errors.length) throw new Error(errors.join('; '));
  const body = formatNutritionBlock(doc.entries);
  const source = readText('food-nutrition-data.js');
  const updated = replaceBetweenMarkers(source, 'export const FOOD_NUTRITION_PER_100G = {', '};', body);
  writeText('food-nutrition-data.js', updated);
  return Object.keys(doc.entries).length;
}

export function importPortionLimits(doc) {
  const errors = validatePortionLimits(doc);
  if (errors.length) throw new Error(errors.join('; '));
  let source = readText('portion-limits.js');

  source = replaceBetweenMarkers(
    source,
    'export const GROUP_MAX_PORTION_G = {',
    '};',
    `\n${formatPortionObject(doc.groupMax)}\n`,
  );
  source = replaceBetweenMarkers(
    source,
    'export const GROUP_MIN_PORTION_G = {',
    '};',
    `\n${formatPortionObject(doc.groupMin)}\n`,
  );
  source = replaceBetweenMarkers(
    source,
    'export const DEFAULT_MAX_PORTION_G = ',
    ';',
    String(Number(doc.defaults?.maxPortionG ?? DEFAULT_MAX_PORTION_G)),
  );
  source = replaceBetweenMarkers(
    source,
    'export const DEFAULT_MIN_PORTION_G = ',
    ';',
    String(Number(doc.defaults?.minPortionG ?? DEFAULT_MIN_PORTION_G)),
  );
  source = replaceBetweenMarkers(
    source,
    'export const COOKING_FAT_MAX_PORTION_G = ',
    ';',
    String(Number(doc.defaults?.cookingFatMaxPortionG ?? COOKING_FAT_MAX_PORTION_G)),
  );
  source = replaceBetweenMarkers(
    source,
    'export const ITEM_MAX_PORTION_G = {',
    '};',
    `\n${formatPortionObject(doc.itemMax)}\n`,
  );
  source = replaceBetweenMarkers(
    source,
    'export const ITEM_MIN_PORTION_G = {',
    '};',
    `\n${formatPortionObject(doc.itemMin)}\n`,
  );

  const fatKeys = (doc.cookingFatKeys || []).map(k => jsString(k)).join(',\n  ');
  source = replaceBetweenMarkers(
    source,
    'export const COOKING_FAT_KEYS = new Set([',
    ']);',
    `\n  ${fatKeys}\n`,
  );

  writeText('portion-limits.js', source);
  return Object.keys(doc.itemMax || {}).length;
}

export function importList(id, doc) {
  switch (id) {
    case 'meal-dishes': return importMealDishes(doc);
    case 'food-catalog': return importFoodCatalog(doc);
    case 'food-nutrition': return importFoodNutrition(doc);
    case 'portion-limits': return importPortionLimits(doc);
    default: throw new Error(`Unknown list: ${id}`);
  }
}

// ── File I/O ────────────────────────────────────────────────────────────────

export function listJsonPath(id) {
  return join(LISTS_DIR, `${id}.json`);
}

export function writeListJson(id, doc) {
  mkdirSync(LISTS_DIR, { recursive: true });
  const path = listJsonPath(id);
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return path;
}

export function readListJson(id) {
  const path = listJsonPath(id);
  if (!existsSync(path)) throw new Error(`Missing ${path} — run: npm run lists:export`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function exportAllLists() {
  const written = [];
  for (const id of LIST_IDS) {
    const doc = exportList(id);
    written.push(writeListJson(id, doc));
  }
  return written;
}

export function importAllLists() {
  const counts = {};
  for (const id of LIST_IDS) {
    const doc = readListJson(id);
    const errors = validateList(id, doc);
    if (errors.length) throw new Error(`${id}: ${errors.join('; ')}`);
    counts[id] = importList(id, doc);
  }
  return counts;
}
