/**
 * Фибри на 100 г за храните на двигателя (data/engine/fiber.json, USDA FDC).
 * Храните от животински произход нямат фибри. Продукт без стойност (зависи
 * от марката) е null — не се измисля; качеството на менюто отчита колко от
 * грамовете са покрити.
 */

import fiberJson from '../data/engine/fiber.json' with { type: 'json' };
import { FOODS } from './knowledge.js';

const ANIMAL_KINDS = new Set(['poultry', 'red', 'fish', 'shellfish', 'egg', 'dairy']);
const TABLE = fiberJson.per100g || {};

/** @returns {number|null} г фибри на 100 г */
export function fiberPer100(id) {
  if (Object.prototype.hasOwnProperty.call(TABLE, id)) return TABLE[id];
  const f = FOODS.get(id);
  return f && ANIMAL_KINDS.has(f.kind) ? 0 : null;
}
