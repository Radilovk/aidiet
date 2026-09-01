/**
 * Rank catalog candidates before prompt limit — role fit × universality × macro fit
 * × preferences × adherence, then spread across food groups.
 *
 * Role fit matters as much as macro fit: yoghurt scores well on every macro
 * target, so a purely numeric ranking filled the PRO, FAT and even ENG pools
 * with dairy and left plans that were milk products three times a day.
 */

import { FOOD_NUTRITION_PER_100G } from './food-nutrition-data.js';
import { normalizeFoodKey } from './food-utils.js';
import { READY_MEAL_PARTS } from './ready-meal-parts.js';

/** Groups that genuinely carry each role, and groups that merely can. */
const ROLE_GROUP_AFFINITY = {
  PRO: { protein: 0.55, legume: 0.35, dairy: -0.10, fat: -0.25, carb: -0.35, vegetable: -0.45, fruit: -0.6 },
  ENG: { carb: 0.6, legume: 0.3, fruit: -0.05, dairy: -0.4, protein: -0.5, fat: -0.5, vegetable: -0.3 },
  FAT: { fat: 0.6, dairy: -0.2, protein: -0.15, legume: -0.2, carb: -0.45, vegetable: -0.5, fruit: -0.5 },
  VOL: { vegetable: 0.5, fruit: 0.1, legume: -0.1, carb: -0.4, protein: -0.4, dairy: -0.5, fat: -0.5 },
};

/** Max entries of one food group allowed in a single role pool. */
const MAX_PER_GROUP_IN_POOL = 4;

function fatShareOfKcal(nutritionKey) {
  const a = macrosPer100g(nutritionKey);
  if (!a) return 0;
  const kcal = a[1] * 4 + a[2] * 4 + a[3] * 9;
  return kcal > 0 ? (a[3] * 9) / kcal : 0;
}

/**
 * Хранителни стойности на 100 г — за продукт от таблицата или за ястие,
 * сглобени от продуктите му.
 *
 * Ястията нямат ред в таблицата, затова подборът смяташе дела на мазнините им
 * за нула: и претеглянето по мазнини, и бонусът за калорийна плътност мълчаха
 * точно за пула, от който идват всички хранения. Така големите слотове
 * систематично взимаха най-мазните ястия.
 */
function macrosPer100g(nutritionKey) {
  const direct = FOOD_NUTRITION_PER_100G[nutritionKey];
  if (direct) return direct;
  const parts = READY_MEAL_PARTS[nutritionKey];
  if (!parts?.length) return null;

  let grams = 0;
  const sum = [0, 0, 0, 0];
  for (const part of parts) {
    const a = FOOD_NUTRITION_PER_100G[normalizeFoodKey(part.name)];
    const g = Number(part.grams) || 0;
    if (!a || g <= 0) continue;
    grams += g;
    for (let i = 0; i < 4; i++) sum[i] += (a[i] * g) / 100;
  }
  if (grams <= 0) return null;
  return sum.map(v => (v * 100) / grams);
}

function slotFatShare(target = {}) {
  const kcal = Number(target.calories) || 0;
  const f = Number(target.fats) || 0;
  return kcal > 0 ? (f * 9) / kcal : 0.3;
}

/**
 * Разстояние между макро-профила на храната и този на слота, 0–1.
 *
 * Сравняват се дяловете на протеин, въглехидрати и мазнини в калориите — не
 * грамовете, за да не зависи от размера на порцията.
 */
function macroProfileDistance(nutritionKey, target) {
  const a = macrosPer100g(nutritionKey);
  if (!a) return 0;
  const kcal = a[1] * 4 + a[2] * 4 + a[3] * 9;
  const targetKcal = (Number(target.protein) || 0) * 4
    + (Number(target.carbs) || 0) * 4 + (Number(target.fats) || 0) * 9;
  if (kcal <= 0 || targetKcal <= 0) return 0;
  const diff = Math.abs(a[1] * 4 / kcal - (Number(target.protein) || 0) * 4 / targetKcal)
    + Math.abs(a[2] * 4 / kcal - (Number(target.carbs) || 0) * 4 / targetKcal)
    + Math.abs(a[3] * 9 / kcal - (Number(target.fats) || 0) * 9 / targetKcal);
  return diff / 2;
}

function kcalPerGram(nutritionKey) {
  const a = macrosPer100g(nutritionKey);
  if (!a) return 0;
  const kcal = a[1] * 4 + a[2] * 4 + a[3] * 9;
  return kcal > 0 ? kcal / 100 : 0;
}

/**
 * Keep the ranking order but stop any single group from owning the pool.
 * Overflow entries are appended after the diversified head, so nothing is lost
 * when a diet leaves only one viable group.
 */
function spreadAcrossGroups(scored, limit) {
  const perGroup = new Map();
  const head = [];
  const tail = [];
  for (const item of scored) {
    const g = item.entry.group || 'other';
    const used = perGroup.get(g) || 0;
    if (used < MAX_PER_GROUP_IN_POOL) {
      perGroup.set(g, used + 1);
      head.push(item);
    } else {
      tail.push(item);
    }
  }
  return [...head, ...tail].slice(0, limit);
}

/**
 * @param {object[]} list
 * @param {object} ctx
 * @param {'PRO'|'ENG'|'VOL'|'FAT'|'READY'} [ctx.role] role this pool must fill
 * @param {Set<string>} [ctx.loveSet]
 * @param {Map<string, number>} [ctx.adherenceRatio] nutritionKey → eaten/prescribed
 * @param {object} [ctx.slotTarget] representative slot target for macro fit
 * @param {number} [ctx.maxSlotKcal] highest slot kcal in chunk — boosts calorie-dense catalog picks
 * @param {number} [ctx.limit]
 */
export function rankCatalogCandidates(list, ctx = {}) {
  const loveSet = ctx.loveSet || new Set();
  const adherence = ctx.adherenceRatio || new Map();
  const targetFat = slotFatShare(ctx.slotTarget);
  const maxSlotKcal = Number(ctx.maxSlotKcal) || Number(ctx.slotTarget?.calories) || 0;
  const limit = ctx.limit ?? list.length;
  const affinity = ROLE_GROUP_AFFINITY[ctx.role] || null;

  const scored = list.map(entry => {
    let score = (entry.universality || 3) / 5;
    const nKey = entry.nutritionKey || entry.name;
    const density = kcalPerGram(nKey);

    if (affinity) score += affinity[entry.group] ?? 0;

    if (loveSet.has(normalizeFoodKey(entry.name))) score += 0.45;

    const ratio = adherence.get(nKey);
    if (typeof ratio === 'number') {
      if (ratio >= 0.65) score += 0.15;
      if (ratio <= 0.35) score -= 0.25;
    }

    // Колко близо е макро-профилът на ястието до този на слота. За цяло
    // ястие това е истинският критерий: калориите вече са проверени от
    // подбора, а профилът решава дали денят ще улучи протеин и въглехидрати.
    const isDish = !!READY_MEAL_PARTS[nKey];
    if (ctx.slotTarget) {
      score -= isDish
        ? macroProfileDistance(nKey, ctx.slotTarget) * 1.2
        : Math.abs(fatShareOfKcal(nKey) - targetFat) * 0.35;
    }

    // Precision-first: high-kcal slots need calorie-dense PRO/ENG in the first pick.
    // За ястия бонусът не важи: че ястието стига слота, вече е проверено, а
    // премия за калорийна плътност отгоре просто избираше най-мазното — обядът
    // ставаше „Говеждо с броколи“ с 54 г мазнини при цел 19.
    if (isDish) {
      // без премия за плътност
    } else if (maxSlotKcal >= 900 && (entry.slots?.includes('PRO') || entry.slots?.includes('ENG'))) {
      score += Math.min(0.55, density * 0.35);
    } else if (maxSlotKcal >= 600 && (entry.slots?.includes('PRO') || entry.slots?.includes('ENG'))) {
      score += Math.min(0.35, density * 0.25);
    }
    if (maxSlotKcal >= 600 && entry.group === 'vegetable' && !entry.slots?.includes('PRO')) {
      score -= 0.15;
    }

    if (entry.group === 'condiment') score -= 0.2;

    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score || b.entry.universality - a.entry.universality
    || a.entry.name.localeCompare(b.entry.name, 'bg'));

  const seen = new Set();
  const unique = [];
  for (const item of scored) {
    if (seen.has(item.entry.name)) continue;
    seen.add(item.entry.name);
    unique.push(item);
  }

  return spreadAcrossGroups(unique, limit).map(item => item.entry);
}
