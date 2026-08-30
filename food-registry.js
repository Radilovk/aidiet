/**
 * Catalog registry — data plane for products and menu items.
 * Pipeline layers read from here; overlays support admin-added entries without forking logic.
 */

import { FOOD_CATALOG } from './food-catalog-data.js';
import { normalizeFoodKey } from './food-utils.js';
import { getEntryScalingMode, SCALING_ATOMIC } from './ready-meal-parts.js';
import {
  getLibraryCatalogOverlay,
  mergeCatalogEntries,
  NUTRITION_LIBRARY_VERSION,
} from './nutrition-library-bridge.js';
import { MEAL_DISHES, dishToCatalogEntry } from './meal-dishes.js';
import { applyDishOverlayParts } from './ready-meal-parts.js';

/** @type {object[]} */
let overlayEntries = [];
let overlayLabel = '';
/** Admin dish additions and the base dishes the admin switched off. */
let dishOverlay = [];
let disabledDishIds = new Set();

/**
 * Admin overlay for the dish list: extra dishes, and base dishes turned off.
 * @param {Array<{id: string, name: string, products: Array<{name: string, share: number}>}>} dishes
 * @param {string[]} disabledIds
 */
export function setDishOverlay(dishes = [], disabledIds = []) {
  dishOverlay = Array.isArray(dishes) ? dishes.filter(d => d?.id && d?.products?.length) : [];
  disabledDishIds = new Set((disabledIds || []).map(String));
  applyDishOverlayParts(dishOverlay, [...disabledDishIds]);
  indexCache = null;
  versionCache = null;
}

export function getDishOverlay() {
  return { dishes: [...dishOverlay], disabled: [...disabledDishIds] };
}

let indexCache = null;
let versionCache = null;

/** Admin / KV sync can append entries at runtime (Worker: call before generation). */
export function setCatalogOverlay(entries = [], label = '') {
  overlayEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  overlayLabel = String(label || '');
  indexCache = null;
  versionCache = null;
}

export function getCatalogOverlay() {
  return { entries: [...overlayEntries], label: overlayLabel };
}

/** Static library overlay — raw foods only; dishes come from meal-dishes.js. */
const LIBRARY_CATALOG_OVERLAY = getLibraryCatalogOverlay();

/**
 * Dishes, from the hand-maintained list. Their slots are derived from the
 * groups of their own products, so a dish never has to declare them twice.
 */
function dishCatalogEntries() {
  const groupByName = new Map();
  for (const entry of FOOD_CATALOG) {
    groupByName.set(normalizeFoodKey(entry.name), entry.group);
    groupByName.set(normalizeFoodKey(entry.nutritionKey), entry.group);
  }
  for (const entry of LIBRARY_CATALOG_OVERLAY) {
    const key = normalizeFoodKey(entry.name);
    if (!groupByName.has(key)) groupByName.set(key, entry.group);
  }
  const groupOf = name => groupByName.get(normalizeFoodKey(name)) || null;
  const dishes = [
    ...MEAL_DISHES.filter(d => !disabledDishIds.has(d.id)),
    ...dishOverlay.filter(d => !disabledDishIds.has(d.id)),
  ];
  return dishes.map(d => dishToCatalogEntry(normalizeDish(d), groupOf));
}

/** Overlay dishes arrive as plain JSON — fill in what the base list declares. */
function normalizeDish(d) {
  return {
    id: d.id,
    name: d.name,
    products: d.products,
    timing: Array.isArray(d.timing) && d.timing.length ? d.timing : ['main'],
    vegan: !!d.vegan,
    vegetarian: d.vegetarian !== undefined ? !!d.vegetarian : !!d.vegan,
    universality: Number(d.universality) || 4,
  };
}

/**
 * Merged catalog: base + library + runtime overlay.
 * Collision rule lives in nutrition-library-bridge.mergeCatalogEntries so the
 * registry and the merge stats always describe the same set.
 */
export function getCatalogEntries() {
  // Dishes are curated and rank with the base catalog: a library row that
  // collides with either (an imported food literally named "Пилешка салата")
  // is dropped, or the composer picks the food while the sync expands the dish.
  const dishes = dishCatalogEntries();
  const merged = mergeCatalogEntries([...FOOD_CATALOG, ...dishes], LIBRARY_CATALOG_OVERLAY);
  const byId = new Map(merged.map(e => [e.id, e]));
  for (const e of overlayEntries) {
    if (e?.id) byId.set(e.id, e);
    else byId.set(`overlay_${normalizeFoodKey(e.name)}`, e);
  }
  return [...byId.values()];
}

export function getNutritionLibraryVersion() {
  return NUTRITION_LIBRARY_VERSION;
}

export function buildRegistryIndex() {
  if (indexCache) return indexCache;

  const byId = new Map();
  const byKey = new Map();
  const all = getCatalogEntries();

  for (const entry of all) {
    byId.set(entry.id, entry);
    const keys = new Set([
      normalizeFoodKey(entry.name),
      normalizeFoodKey(entry.nutritionKey),
      ...((entry.aliases || []).map(normalizeFoodKey)),
    ]);
    for (const key of keys) {
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, entry);
    }
  }

  indexCache = { byId, byKey, all };
  return indexCache;
}

export function invalidateRegistryIndex() {
  indexCache = null;
  versionCache = null;
}

/** @returns {{ entry: object|null, unknown: boolean }} */
export function resolveRegistryEntry(name) {
  const index = buildRegistryIndex();
  const normalized = normalizeFoodKey(name);
  if (!normalized) return { entry: null, unknown: true };

  if (index.byKey.has(normalized)) {
    return { entry: index.byKey.get(normalized), unknown: false };
  }

  let best = null;
  let bestLen = 0;
  for (const [key, entry] of index.byKey) {
    if (key.length < 4) continue;
    if (normalized.includes(key) || key.includes(normalized)) {
      if (key.length > bestLen) {
        bestLen = key.length;
        best = entry;
      }
    }
  }
  if (best) return { entry: best, unknown: false };
  return { entry: null, unknown: true };
}

/** Stable version string for plan reproducibility. */
export function getCatalogVersion() {
  if (versionCache) return versionCache;
  const all = getCatalogEntries();
  let h = 2166136261;
  const fold = (s) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  fold(`base:${FOOD_CATALOG.length}`);
  fold(`library:${NUTRITION_LIBRARY_VERSION}:${LIBRARY_CATALOG_OVERLAY.length}`);
  fold(`overlay:${overlayLabel}:${overlayEntries.length}`);
  for (const e of all) {
    fold(`${e.id}|${e.name}|${e.nutritionKey}|${e.scalingMode || ''}|${e.fixedNutrition?.kcal || ''}`);
  }
  versionCache = `cat_${(h >>> 0).toString(16)}_${all.length}`;
  return versionCache;
}

export { getEntryScalingMode, SCALING_ATOMIC };

/** Parse description → single atomic entry, if any. */
export function resolveAtomicEntryFromDescription(description) {
  const lines = String(description || '')
    .split(/\n/)
    .map(l => l.replace(/^[•\-\*]\s*/, '').trim())
    .filter(Boolean);
  if (lines.length !== 1) return null;
  const name = lines[0].replace(/\s+\d+(?:[.,]\d+)?\s*(g|г)\b/i, '').trim();
  const { entry } = resolveRegistryEntry(name);
  if (!entry || getEntryScalingMode(entry) !== SCALING_ATOMIC) return null;
  return entry;
}
