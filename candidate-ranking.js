/**
 * Rank catalog candidates before prompt limit — universality × macro fit × preferences × adherence.
 */

import { FOOD_NUTRITION_PER_100G } from './food-nutrition-data.js';
import { normalizeFoodKey } from './food-utils.js';

function fatShareOfKcal(nutritionKey) {
  const a = FOOD_NUTRITION_PER_100G[nutritionKey];
  if (!a) return 0;
  const kcal = a[1] * 4 + a[2] * 4 + a[3] * 9;
  return kcal > 0 ? (a[3] * 9) / kcal : 0;
}

function slotFatShare(target = {}) {
  const kcal = Number(target.calories) || 0;
  const f = Number(target.fats) || 0;
  return kcal > 0 ? (f * 9) / kcal : 0.3;
}

/**
 * @param {object[]} list
 * @param {object} ctx
 * @param {Set<string>} [ctx.loveSet]
 * @param {Map<string, number>} [ctx.adherenceRatio] nutritionKey → eaten/prescribed
 * @param {object} [ctx.slotTarget] representative slot target for macro fit
 * @param {number} [ctx.limit]
 */
export function rankCatalogCandidates(list, ctx = {}) {
  const loveSet = ctx.loveSet || new Set();
  const adherence = ctx.adherenceRatio || new Map();
  const targetFat = slotFatShare(ctx.slotTarget);
  const limit = ctx.limit ?? list.length;

  const scored = list.map(entry => {
    let score = (entry.universality || 3) / 5;
    const nKey = entry.nutritionKey || entry.name;

    if (loveSet.has(normalizeFoodKey(entry.name))) score += 0.45;

    const ratio = adherence.get(nKey);
    if (typeof ratio === 'number') {
      if (ratio >= 0.65) score += 0.15;
      if (ratio <= 0.35) score -= 0.25;
    }

    if (ctx.slotTarget) {
      score -= Math.abs(fatShareOfKcal(nKey) - targetFat) * 0.35;
    }

    if (entry.group === 'condiment') score -= 0.2;

    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score || b.entry.universality - a.entry.universality
    || a.entry.name.localeCompare(b.entry.name, 'bg'));

  const seen = new Set();
  const out = [];
  for (const { entry } of scored) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}
