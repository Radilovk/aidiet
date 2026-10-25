/**
 * Фибри и микронутриенти на 100 г за храните на двигателя
 * (data/engine/micronutrients.json — USDA FDC SR Legacy, по fdc_id).
 * Продукт без стойност (зависи от марката) е null — не се измисля;
 * отчетът казва колко от грамовете са покрити.
 */

import microJson from '../data/engine/micronutrients.json' with { type: 'json' };

const TABLE = microJson.per100g || {};

/** @returns {{ fiber: number|null, fe: number, ca: number, mg: number, k: number, b12: number|null, o3: number|null }|null} */
export function microPer100(id) {
  return TABLE[id] || null;
}

/** @returns {number|null} г фибри на 100 г */
export function fiberPer100(id) {
  const m = TABLE[id];
  return m && m.fiber != null ? m.fiber : null;
}
