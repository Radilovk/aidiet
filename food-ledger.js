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

const SOFIA_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' });

function shiftDateKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Ден от плана по деня от седмицата: понеделник = 1 … неделя = 7. */
export function weekdayPlanDay(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function buildFoodLedger(weekPlan, gameData = {}, gameWeeklyAI = {}, options = {}) {
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

  // Приложението показва деня от плана по деня от седмицата (понеделник = day1),
  // затова и изяденото се чете така — за последните 7 дни, не само за първата
  // седмица от началото на диетата.
  const today = SOFIA_DATE.format(options.now || new Date());
  const from = shiftDateKey(today, -6);
  for (const [dateKey, rec] of Object.entries(gameData || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey < from || dateKey > today) continue;
    const dayNum = weekdayPlanDay(dateKey);
    const dayPlan = weekPlan[`day${dayNum}`];
    if (!dayPlan?.meals?.length) continue;
    const seenTypes = {};
    for (const meal of dayPlan.meals) {
      // Втора карта от същия вид е „<вид>_2“ в отметките (както в plan.html).
      seenTypes[meal.type] = (seenTypes[meal.type] || 0) + 1;
      const tickKey = seenTypes[meal.type] === 1 ? meal.type : `${meal.type}_${seenTypes[meal.type]}`;
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
      if (rec?.meals?.[tickKey] !== true) continue;
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

/** Minimal plan payload for analytics/ledger sync (avoids shipping full plan blob). */
export function planSliceForLedgerSync(plan) {
  if (!plan?.weekPlan || typeof plan.weekPlan !== 'object') return null;
  return {
    weekPlan: plan.weekPlan,
    sourceMeta: plan.sourceMeta ?? null,
  };
}

/** Idempotency signature for client analytics sync. */
export function analyticsSyncSignature(uid, gameData, planSlice = null) {
  const keys = Object.keys(gameData || {});
  const latestKey = keys.sort().pop() || '';
  const dayScore = latestKey ? (gameData[latestKey]?.dailyScore ?? '') : '';
  const catalogV = planSlice?.sourceMeta?.catalogVersion || '';
  const dayCount = planSlice?.weekPlan ? Object.keys(planSlice.weekPlan).length : 0;
  return `${uid}:${keys.length}:${latestKey}:${dayScore}:${catalogV}:${dayCount}`;
}
