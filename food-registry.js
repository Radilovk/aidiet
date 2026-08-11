/**
 * Catalog registry — data plane for products and menu items.
 * Pipeline layers read from here; overlays support admin-added entries without forking logic.
 */

import { FOOD_CATALOG } from './food-catalog-data.js';
import { normalizeFoodKey } from './food-utils.js';
import { getEntryScalingMode, SCALING_ATOMIC } from './ready-meal-parts.js';

/** @type {object[]} */
let overlayEntries = [];
let overlayLabel = '';

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

/** Merged catalog: base + overlay (overlay ids win on collision). */
export function getCatalogEntries() {
  if (!overlayEntries.length) return FOOD_CATALOG;
  const byId = new Map(FOOD_CATALOG.map(e => [e.id, e]));
  for (const e of overlayEntries) {
    if (e?.id) byId.set(e.id, e);
    else byId.set(`overlay_${normalizeFoodKey(e.name)}`, e);
  }
  return [...byId.values()];
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
