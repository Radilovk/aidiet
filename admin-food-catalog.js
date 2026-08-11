/**
 * Admin CRUD for food catalog KV overlay (restaurant/menu items, admin additions).
 */

import { FOOD_CATALOG } from './food-catalog-data.js';
import { invalidateRegistryIndex } from './food-registry.js';
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
  if (!raw) return { label: '', entries: [] };
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (Array.isArray(parsed)) return { label: '', entries: parsed.filter(Boolean) };
  return {
    label: String(parsed?.label || parsed?.version || ''),
    entries: Array.isArray(parsed?.entries) ? parsed.entries.filter(Boolean) : [],
    updatedAt: parsed?.updatedAt || null,
  };
}

export function serializeOverlayDocument(entries, label = '') {
  return {
    label: label || new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString(),
    entries: entries.filter(Boolean),
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
  if (!env?.page_content) return { label: '', entries: [], baseCount: FOOD_CATALOG.length };
  const raw = await env.page_content.get(FOOD_CATALOG_OVERLAY_KV_KEY);
  const doc = parseOverlayDocument(raw);
  return { ...doc, baseCount: FOOD_CATALOG.length };
}

export async function writeOverlayToKv(env, entries, label = '') {
  if (!env?.page_content) throw new Error('KV not configured');
  const normalized = entries.map(normalizeOverlayEntry);
  for (const e of normalized) {
    const errs = validateOverlayEntry(e);
    if (errs.length) throw new Error(`${e.id || e.name}: ${errs.join('; ')}`);
  }
  const doc = serializeOverlayDocument(normalized, label);
  await env.page_content.put(FOOD_CATALOG_OVERLAY_KV_KEY, JSON.stringify(doc));
  invalidateRegistryIndex();
  return doc;
}

export async function upsertOverlayEntry(env, entry) {
  const doc = await readOverlayFromKv(env);
  const normalized = normalizeOverlayEntry(entry);
  const errs = validateOverlayEntry(normalized);
  if (errs.length) throw new Error(errs.join('; '));
  const idx = doc.entries.findIndex(e => e.id === normalized.id);
  if (idx >= 0) doc.entries[idx] = normalized;
  else doc.entries.push(normalized);
  return writeOverlayToKv(env, doc.entries, doc.label);
}

export async function deleteOverlayEntry(env, id) {
  if (isBaseCatalogId(id)) throw new Error('Cannot delete base catalog entry');
  const doc = await readOverlayFromKv(env);
  const next = doc.entries.filter(e => e.id !== id);
  if (next.length === doc.entries.length) throw new Error('Overlay entry not found');
  return writeOverlayToKv(env, next, doc.label);
}
