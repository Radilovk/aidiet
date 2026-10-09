/**
 * Отпечатък на ястието — какво съотношение протеин/въглехидрати/мазнини носи.
 *
 * Ястието се мащабира с един общ коефициент, за да остане същото ястие.
 * Значи порцията решава калориите, а съотношението на макросите е свойство
 * на ястието — то се постига с избора, не с разтягане на грамажите.
 *
 * Тук са три неща:
 *   1. отпечатъкът (дялове от калориите при референтната порция);
 *   2. макро зоната на диетата по хранене — твърдо условие за избора;
 *   3. желаното съотношение за следващото хранене, коригирано с това, с колко
 *      вече избраните ястия от деня са се отклонили от дневната цел.
 */

import { READY_MEAL_PARTS } from './ready-meal-parts.js';
import { lookupFoodProfile } from './food-nutrition.js';

const MAIN_SLOTS = new Set(['Хранене 1', 'Хранене 2', 'Хранене 4']);

/**
 * @param {{ id?: string, name?: string }} entry ястие от каталога
 * @returns {{ kcal: number, p: number, c: number, f: number } | null} дялове от калориите
 */
export function dishFingerprint(entry) {
  const parts = READY_MEAL_PARTS[entry?.id] || [];
  let p = 0;
  let c = 0;
  let f = 0;
  for (const part of parts) {
    const grams = Number(part.grams) || 0;
    if (grams <= 0) continue;
    const { profile, unknown } = lookupFoodProfile(part.name);
    if (unknown || !profile) continue;
    p += profile.p * grams / 100;
    c += profile.c * grams / 100;
    f += profile.f * grams / 100;
  }
  const kcal = p * 4 + c * 4 + f * 9;
  if (kcal <= 0) return null;
  return { kcal, p: (p * 4) / kcal, c: (c * 4) / kcal, f: (f * 9) / kcal };
}

/** Отпечатък с кеш за една седмица (админът може да смени грамажите през KV). */
export function cachedFingerprint(entry, cache) {
  const key = entry?.id || entry?.name;
  if (!cache) return dishFingerprint(entry);
  if (!cache.has(key)) cache.set(key, dishFingerprint(entry));
  return cache.get(key);
}

/**
 * Макро зона на диетата за един вид хранене (дялове от калориите на ястието).
 * Това е определението на диетата на ниво чиния: кето ястие не носи над 12%
 * въглехидрати, колкото и добре да пасват калориите му.
 *
 * @param {{ diet: { style: string }, clinical?: string[] }} profile
 * @returns {{ maxCarb?: number, minProtein?: number }}
 */
export function macroZoneFor(profile, slotType) {
  const style = profile?.diet?.style || 'balanced';
  const main = MAIN_SLOTS.has(slotType);
  if (style === 'keto') return { maxCarb: 0.12 };
  if (style === 'low_carb') {
    if (slotType === 'Хранене 5') return { maxCarb: 0.25 };
    return { maxCarb: main ? 0.30 : 0.35 };
  }
  const zone = {};
  if (style === 'high_protein' && main) zone.minProtein = 0.25;
  const clinical = profile?.clinical || [];
  if (main && ['IR', 'T2D', 'PCOS'].some(c => clinical.includes(c))) zone.maxCarb = 0.55;
  return zone;
}

/** 0 вътре в зоната; иначе колко е извън нея (в дялове). */
export function zoneDistance(fp, zone) {
  if (!fp || !zone) return 0;
  let d = 0;
  if (zone.maxCarb != null && fp.c > zone.maxCarb) d += fp.c - zone.maxCarb;
  if (zone.minProtein != null && fp.p < zone.minProtein) d += zone.minProtein - fp.p;
  return d;
}

const MACRO_KCAL = { p: 4, c: 4, f: 9 };
const TARGET_KEY = { p: 'protein', c: 'carbs', f: 'fats' };

/** Дневен отчет: колко е планирано досега срещу целите на същите хранения. */
export function emptyDayLedger() {
  return { p: 0, c: 0, f: 0 };
}

/**
 * Желаните дялове за хранене: собствената цел на слота, коригирана с
 * отклонението на вече избраните хранения в деня. Ако обядът е по-
 * въглехидратен от целта си, вечерята се търси по-протеинова.
 *
 * @param {{ calories: number, protein: number, carbs: number, fats: number }} slotTarget
 * @param {{ p: number, c: number, f: number }} drift в kcal: планирано − цел за предишните хранения
 * @param {number} remainingKcal калориите на това и следващите хранения в деня
 */
export function desiredSlotShares(slotTarget, drift, remainingKcal) {
  const kcal = Number(slotTarget?.calories) || 0;
  const weight = remainingKcal > 0 ? Math.min(1, kcal / remainingKcal) : 1;
  const out = {};
  let sum = 0;
  for (const m of ['p', 'c', 'f']) {
    const own = (Number(slotTarget?.[TARGET_KEY[m]]) || 0) * MACRO_KCAL[m];
    out[m] = Math.max(0, own - (drift?.[m] || 0) * weight);
    sum += out[m];
  }
  if (sum <= 0) return null;
  for (const m of ['p', 'c', 'f']) out[m] /= sum;
  return out;
}

/** Разстояние между съотношенията (L1, 0…2). */
export function shareFit(fp, desired) {
  if (!fp || !desired) return 0;
  return Math.abs(fp.p - desired.p) + Math.abs(fp.c - desired.c) + Math.abs(fp.f - desired.f);
}

/**
 * Записва избраното ястие в дневния отчет — оценка при калориите на слота,
 * защото порцията ще бъде мащабирана точно към тях.
 */
export function recordDishInLedger(ledger, fp, slotTarget) {
  if (!fp || !ledger) return;
  const kcal = Number(slotTarget?.calories) || 0;
  for (const m of ['p', 'c', 'f']) {
    const target = (Number(slotTarget?.[TARGET_KEY[m]]) || 0) * MACRO_KCAL[m];
    ledger[m] += fp[m] * kcal - target;
  }
}
