/**
 * Stage 3 — food ledger: prescribed vs eaten → adherence ratio for candidate ranking.
 */

import { parseMealDescription } from './food-nutrition.js';
import { resolveRegistryEntry } from './food-registry.js';
import { normalizeFoodKey } from './food-utils.js';

export const LEDGER_VERSION = 'ledger_v1';

function addProductCount(map, name, delta = 1) {
  const { entry } = resolveRegistryEntry(name);
  const key = entry?.nutritionKey || entry?.name || name;
  const nKey = normalizeFoodKey(key);
  if (!nKey) return;
  map.set(nKey, (map.get(nKey) || 0) + delta);
}

export function productsFromMeal(meal) {
  const keys = [];
  for (const item of parseMealDescription(meal?.description)) {
    const { entry } = resolveRegistryEntry(item.name);
    const key = normalizeFoodKey(entry?.nutritionKey || entry?.name || item.name);
    if (key) keys.push(key);
  }
  return keys;
}

/** Map YYYY-MM-DD → day1–7 using dietStartDate (inclusive week window). */
export function planDayIndex(dateKey, dietStartDate) {
  if (!dateKey || !dietStartDate) return null;
  const start = new Date(`${dietStartDate}T00:00:00Z`);
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(d.getTime())) return null;
  const diff = Math.floor((d.getTime() - start.getTime()) / 86400000);
  if (diff < 0 || diff > 6) return null;
  return diff + 1;
}

export function buildFoodLedger(weekPlan, gameData = {}, gameWeeklyAI = {}) {
  const prescribed = new Map();
  const eaten = new Map();
  if (!weekPlan || typeof weekPlan !== 'object') {
    return { prescribed, eaten, version: LEDGER_VERSION };
  }

  for (const day of Object.values(weekPlan)) {
    if (!day?.meals?.length) continue;
    for (const meal of day.meals) {
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
      for (const key of productsFromMeal(meal)) {
        prescribed.set(key, (prescribed.get(key) || 0) + 1);
      }
    }
  }

  const dietStart = gameWeeklyAI?.dietStartDate || gameWeeklyAI?.startDate || '';
  for (const [dateKey, rec] of Object.entries(gameData || {})) {
    const dayNum = planDayIndex(dateKey, dietStart);
    if (!dayNum) continue;
    const dayPlan = weekPlan[`day${dayNum}`];
    if (!dayPlan?.meals?.length) continue;
    for (const meal of dayPlan.meals) {
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
      if (rec?.meals?.[meal.type] !== true) continue;
      for (const key of productsFromMeal(meal)) {
        eaten.set(key, (eaten.get(key) || 0) + 1);
      }
    }
  }

  return { prescribed, eaten, version: LEDGER_VERSION };
}

export function serializeFoodLedger(ledger) {
  const toObj = (m) => Object.fromEntries(m instanceof Map ? m.entries() : []);
  return {
    version: ledger?.version || LEDGER_VERSION,
    prescribed: toObj(ledger?.prescribed),
    eaten: toObj(ledger?.eaten),
    updatedAt: new Date().toISOString(),
  };
}

export function deserializeFoodLedger(raw) {
  if (!raw) return null;
  const prescribed = new Map(Object.entries(raw.prescribed || {}));
  const eaten = new Map(Object.entries(raw.eaten || {}));
  return { prescribed, eaten, version: raw.version || LEDGER_VERSION };
}

/** nutritionKey → eaten/prescribed ratio (0–1+). */
export function buildAdherenceRatio(ledger) {
  const ratio = new Map();
  if (!ledger?.prescribed) return ratio;
  const prescribed = ledger.prescribed instanceof Map
    ? ledger.prescribed
    : new Map(Object.entries(ledger.prescribed || {}));
  const eaten = ledger.eaten instanceof Map
    ? ledger.eaten
    : new Map(Object.entries(ledger.eaten || {}));

  for (const [key, pres] of prescribed) {
    const p = Number(pres) || 0;
    if (p <= 0) continue;
    const eat = Number(eaten.get(key)) || 0;
    ratio.set(key, eat / p);
  }
  return ratio;
}

export function getLedgerVersion(ledger) {
  if (!ledger) return `${LEDGER_VERSION}_empty`;
  const p = ledger.prescribed instanceof Map ? ledger.prescribed.size : Object.keys(ledger.prescribed || {}).length;
  const e = ledger.eaten instanceof Map ? ledger.eaten.size : Object.keys(ledger.eaten || {}).length;
  return `${ledger.version || LEDGER_VERSION}_${p}_${e}`;
}
