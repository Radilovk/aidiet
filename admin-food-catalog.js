/**
 * Admin CRUD for food catalog KV overlay (restaurant/menu items, admin additions).
 */

import { FOOD_CATALOG } from './food-catalog-data.js';
import { invalidateRegistryIndex, setDishOverlay } from './food-registry.js';
import { MEAL_DISHES, MEAL_DISHES_BY_ID } from './meal-dishes.js';
import { normalizeFoodKey } from './food-utils.js';

export const FOOD_CATALOG_OVERLAY_KV_KEY = 'food_catalog_overlay';

const BASE_IDS = new Set(FOOD_CATALOG.map(e => e.id));
const GROUPS = new Set(['protein', 'dairy', 'vegetable', 'carb', 'fat', 'fruit', 'legume', 'condiment', 'beverage', 'ready_meal']);
const SLOTS = new Set(['PRO', 'ENG', 'VOL', 'FAT']);
const TIMINGS = new Set(['breakfast', 'snack', 'main', 'late_snack']);

export function isBaseCatalogId(id) {
  return BASE_IDS.has(String(id || ''));
}

export function parseOverlayDocument(raw) {
  if (!raw) return { label: '', entries: [], dishes: [], disabledDishes: [] };
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (Array.isArray(parsed)) {
    return { label: '', entries: parsed.filter(Boolean), dishes: [], disabledDishes: [] };
  }
  return {
    label: String(parsed?.label || parsed?.version || ''),
    entries: Array.isArray(parsed?.entries) ? parsed.entries.filter(Boolean) : [],
    dishes: Array.isArray(parsed?.dishes) ? parsed.dishes.filter(Boolean) : [],
    disabledDishes: Array.isArray(parsed?.disabledDishes)
      ? parsed.disabledDishes.map(String).filter(Boolean) : [],
    updatedAt: parsed?.updatedAt || null,
  };
}

/**
 * Validate one admin dish: a name and 2–4 products whose shares sum to ~1.
 * @returns {string[]} errors
 */
export function validateDishEntry(dish) {
  const errors = [];
  if (!dish || typeof dish !== 'object') return ['invalid dish'];
  if (!String(dish.id || '').trim()) errors.push('id required');
  if (!String(dish.name || '').trim()) errors.push('name required');
  const products = Array.isArray(dish.products) ? dish.products : [];
  if (products.length < 2 || products.length > 4) errors.push('2–4 продукта');
  for (const p of products) {
    if (!String(p?.name || '').trim()) errors.push('всеки продукт иска име');
    const share = Number(p?.share);
    if (!Number.isFinite(share) || share <= 0 || share > 1) errors.push(`дял 0–1 за ${p?.name}`);
  }
  const sum = products.reduce((acc, p) => acc + (Number(p?.share) || 0), 0);
  if (products.length && Math.abs(sum - 1) > 0.05) {
    errors.push(`дяловете трябва да сумират ~1 (сега ${sum.toFixed(2)})`);
  }
  const timing = Array.isArray(dish.timing) ? dish.timing : [];
  if (!timing.length || timing.some(t => !TIMINGS.has(t))) {
    errors.push(`timing must include ${[...TIMINGS].join('|')}`);
  }
  return errors;
}

export function normalizeDishEntry(dish) {
  return {
    id: String(dish.id || '').trim(),
    name: String(dish.name || '').trim(),
    products: (dish.products || []).map(p => ({
      name: String(p.name || '').trim(),
      share: Number(p.share) || 0,
    })),
    timing: [...new Set((dish.timing || ['main']).map(String))],
    vegan: !!dish.vegan,
    vegetarian: dish.vegetarian !== undefined ? !!dish.vegetarian : !!dish.vegan,
    universality: Math.max(1, Math.min(5, Number(dish.universality) || 4)),
    tags: Array.isArray(dish.tags) ? [...dish.tags] : [],
  };
}

export function serializeOverlayDocument(entries, label = '', dishes = [], disabledDishes = []) {
  return {
    label: label || new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString(),
    entries: entries.filter(Boolean),
    dishes: dishes.filter(Boolean),
    disabledDishes: [...new Set(disabledDishes.map(String).filter(Boolean))],
  };
}

export function validateOverlayEntry(entry) {
  const errors = [];
  if (!entry || typeof entry !== 'object') return ['invalid entry'];
  const id = String(entry.id || '').trim();
  if (!id) errors.push('id required');
  if (!entry.name?.trim()) errors.push('name required');
  if (!entry.nutritionKey?.trim()) errors.push('nutritionKey required');
  if (!GROUPS.has(entry.group)) errors.push(`group must be one of ${[...GROUPS].join(', ')}`);
  if (!Array.isArray(entry.slots) || !entry.slots.length || entry.slots.some(s => !SLOTS.has(s))) {
    errors.push('slots must include PRO|ENG|VOL|FAT');
  }
  if (!Array.isArray(entry.timing) || !entry.timing.length || entry.timing.some(t => !TIMINGS.has(t))) {
    errors.push('timing must include breakfast|snack|main|late_snack');
  }
  const u = Number(entry.universality);
  if (!Number.isFinite(u) || u < 1 || u > 5) errors.push('universality 1–5');
  if (entry.scalingMode === 'atomic_fixed' && !entry.fixedNutrition?.kcal) {
    errors.push('atomic_fixed requires fixedNutrition.kcal');
  }
  return errors;
}

export function normalizeOverlayEntry(entry) {
  const id = String(entry.id || '').trim();
  return {
    id,
    name: String(entry.name || '').trim(),
    nutritionKey: String(entry.nutritionKey || entry.name || '').trim(),
    group: entry.group || 'ready_meal',
    slots: [...new Set((entry.slots || ['PRO', 'ENG']).map(String))],
    timing: [...new Set((entry.timing || ['main']).map(String))],
    universality: Math.max(1, Math.min(5, Number(entry.universality) || 3)),
    vegan: !!entry.vegan,
    vegetarian: entry.vegetarian !== undefined ? !!entry.vegetarian : true,
    genericOf: entry.genericOf || null,
    aliases: Array.isArray(entry.aliases) ? entry.aliases.map(String) : [],
    scalingMode: entry.scalingMode || null,
    fixedNutrition: entry.fixedNutrition || null,
  };
}

export function filterOverlayEntries(entries, q = '') {
  const needle = normalizeFoodKey(q);
  if (!needle) return entries;
  return entries.filter(e => {
    const hay = normalizeFoodKey(`${e.id} ${e.name} ${e.nutritionKey} ${(e.aliases || []).join(' ')}`);
    return hay.includes(needle);
  });
}

export async function readOverlayFromKv(env) {
  const empty = { label: '', entries: [], dishes: [], disabledDishes: [], updatedAt: null };
  if (!env?.page_content) {
    return { ...empty, baseCount: FOOD_CATALOG.length, baseDishes: MEAL_DISHES };
  }
  const raw = await env.page_content.get(FOOD_CATALOG_OVERLAY_KV_KEY);
  const doc = parseOverlayDocument(raw);
  // The admin edits dishes against the base list, so ship it with the document.
  return { ...doc, baseCount: FOOD_CATALOG.length, baseDishes: MEAL_DISHES };
}

export async function writeOverlayToKv(env, entries, label = '', dishes = [], disabledDishes = []) {
  if (!env?.page_content) throw new Error('KV not configured');
  const normalized = entries.map(normalizeOverlayEntry);
  for (const e of normalized) {
    const errs = validateOverlayEntry(e);
    if (errs.length) throw new Error(`${e.id || e.name}: ${errs.join('; ')}`);
  }
  const normalizedDishes = dishes.map(normalizeDishEntry);
  for (const d of normalizedDishes) {
    const errs = validateDishEntry(d);
    if (errs.length) throw new Error(`${d.id || d.name}: ${errs.join('; ')}`);
  }
  const doc = serializeOverlayDocument(normalized, label, normalizedDishes, disabledDishes);
  await env.page_content.put(FOOD_CATALOG_OVERLAY_KV_KEY, JSON.stringify(doc));
  setDishOverlay(normalizedDishes, doc.disabledDishes);
  invalidateRegistryIndex();
  return doc;
}

/** Add or replace one dish in the admin list. */
export async function upsertDish(env, dish) {
  const doc = await readOverlayFromKv(env);
  const normalized = normalizeDishEntry(dish);
  const errs = validateDishEntry(normalized);
  if (errs.length) throw new Error(errs.join('; '));
  const dishes = [...doc.dishes];
  const idx = dishes.findIndex(d => d.id === normalized.id);
  if (idx >= 0) dishes[idx] = normalized;
  else dishes.push(normalized);
  return writeOverlayToKv(env, doc.entries, doc.label, dishes, doc.disabledDishes);
}

/**
 * Remove a dish. An admin-added dish is deleted; a base dish is switched off,
 * because the base list lives in code and must stay editable there.
 */
export async function removeDish(env, id) {
  const doc = await readOverlayFromKv(env);
  const dishId = String(id || '');
  const dishes = doc.dishes.filter(d => d.id !== dishId);
  const disabled = MEAL_DISHES_BY_ID.has(dishId)
    ? [...doc.disabledDishes, dishId]
    : doc.disabledDishes;
  if (dishes.length === doc.dishes.length && disabled.length === doc.disabledDishes.length) {
    throw new Error('Dish not found');
  }
  return writeOverlayToKv(env, doc.entries, doc.label, dishes, disabled);
}

/** Switch a previously disabled base dish back on. */
export async function restoreDish(env, id) {
  const doc = await readOverlayFromKv(env);
  const dishId = String(id || '');
  const disabled = doc.disabledDishes.filter(d => d !== dishId);
  if (disabled.length === doc.disabledDishes.length) throw new Error('Dish is not disabled');
  return writeOverlayToKv(env, doc.entries, doc.label, doc.dishes, disabled);
}

export async function upsertOverlayEntry(env, entry) {
  const doc = await readOverlayFromKv(env);
  const normalized = normalizeOverlayEntry(entry);
  const errs = validateOverlayEntry(normalized);
  if (errs.length) throw new Error(errs.join('; '));
  const idx = doc.entries.findIndex(e => e.id === normalized.id);
  if (idx >= 0) doc.entries[idx] = normalized;
  else doc.entries.push(normalized);
  return writeOverlayToKv(env, doc.entries, doc.label, doc.dishes, doc.disabledDishes);
}

export async function deleteOverlayEntry(env, id) {
  if (isBaseCatalogId(id)) throw new Error('Cannot delete base catalog entry');
  const doc = await readOverlayFromKv(env);
  const next = doc.entries.filter(e => e.id !== id);
  if (next.length === doc.entries.length) throw new Error('Overlay entry not found');
  return writeOverlayToKv(env, next, doc.label, doc.dishes, doc.disabledDishes);
}
