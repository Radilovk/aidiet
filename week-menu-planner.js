/**
 * Dietitian-style weekly menu planning — assign dishes before portion scaling.
 * Plans protein rotation, day variety, and energy-fit dishes per slot.
 */

import { passesDietRegistry } from './diet-registry.js';
import { achievableKcal, dishFitsSlotInNormalRange } from './food-nutrition.js';
import { isMealCaloriesAdequate } from './plan-normalize.js';
import { READY_MEAL_PARTS } from './ready-meal-parts.js';
import {
  dishHasFruit,
  dishHasMajorStarch,
  inferDishProteinFamily,
} from './dish-protein-family.js';
import { dishMatchesTagFilter } from './dish-tags.js';

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const PLATED_SLOTS = new Set(['Хранене 2', 'Хранене 4']);
const MAIN_SLOTS = new Set(['Хранене 1', 'Хранене 2', 'Хранене 4']);

function readyMealFitsSlot(entry, slotType) {
  if (slotType === 'Хранене 2' || slotType === 'Хранене 4') {
    return entry.timing?.includes('main') && (entry.slots?.includes('PRO') || entry.slots?.includes('ENG'));
  }
  if (slotType === 'Хранене 1') return !!entry.timing?.includes('breakfast');
  if (slotType === 'Хранене 3') return !!entry.timing?.includes('snack');
  if (slotType === 'Хранене 5') return !!entry.timing?.includes('late_snack');
  return true;
}

function dishAchievableKcal(entry, targetKcal) {
  const parts = READY_MEAL_PARTS[entry.id];
  if (!parts?.length) return 0;
  return achievableKcal(parts.map(p => ({ name: p.name, grams: p.grams })), targetKcal);
}

function scoreDishForSlot(entry, slotTarget, ctx) {
  const targetKcal = Number(slotTarget?.calories) || 0;
  const dishKey = entry.id;
  const weekUses = ctx.weekDishUses.get(dishKey) || 0;
  const dayUses = ctx.dayDishUses.has(dishKey) ? 1 : 0;
  const family = inferDishProteinFamily(entry);
  const familyPenalty = PLATED_SLOTS.has(ctx.slotType) && ctx.dayProteinFamilies.has(family) ? 8 : 0;
  const fruitPenalty = dishHasFruit(entry) && ctx.dayHasFruit ? 6 : 0;
  const starchPenalty = dishHasMajorStarch(entry) && ctx.dayStarchCount >= 2 ? 4 : 0;

  const kcal = dishAchievableKcal(entry, targetKcal);
  const energyCost = targetKcal > 0
    ? Math.abs(kcal - targetKcal) / targetKcal
    : 0;
  const inRange = dishFitsSlotInNormalRange(entry, targetKcal);
  const fitsBonus = inRange && isMealCaloriesAdequate(kcal, targetKcal) ? -2 : 0;

  const seedBias = ((ctx.seed + ctx.dayNum * 17 + ctx.slotIndex * 11 + dishKey.length) % 100) / 500;

  return weekUses * 3 + dayUses * 10 + familyPenalty + fruitPenalty + starchPenalty
    + energyCost * 2 + fitsBonus + seedBias;
}

function filterPool(pool, slotType, slotTarget, ctx) {
  let filtered = pool.filter(e => readyMealFitsSlot(e, slotType));
  filtered = filtered.filter(e => passesDietRegistry(e, ctx.dietCtx));
  if (ctx.tagFilter) {
    const tagged = filtered.filter(e => dishMatchesTagFilter(e, ctx.tagFilter));
    if (tagged.length) filtered = tagged;
  }
  filtered = filtered.filter(e => !ctx.dayDishUses.has(e.id));
  if (PLATED_SLOTS.has(slotType) && ctx.dayProteinFamilies.size) {
    const alt = filtered.filter(e => !ctx.dayProteinFamilies.has(inferDishProteinFamily(e)));
    if (alt.length) filtered = alt;
  }
  if (ctx.dayHasFruit) {
    const noFruit = filtered.filter(e => !dishHasFruit(e));
    if (noFruit.length) filtered = noFruit;
  }
  return filtered;
}

function pickBestDish(pool, slotType, slotTarget, ctx) {
  if (!pool.length) return null;
  const scored = pool
    .map(entry => ({ entry, score: scoreDishForSlot(entry, slotTarget, { ...ctx, slotType }) }))
    .sort((a, b) => a.score - b.score);
  return scored[0]?.entry || null;
}

function recordPick(entry, slotType, ctx) {
  const id = entry.id;
  ctx.weekDishUses.set(id, (ctx.weekDishUses.get(id) || 0) + 1);
  ctx.dayDishUses.add(id);
  if (PLATED_SLOTS.has(slotType)) {
    ctx.dayProteinFamilies.add(inferDishProteinFamily(entry));
  }
  if (dishHasFruit(entry)) ctx.dayHasFruit = true;
  if (dishHasMajorStarch(entry)) ctx.dayStarchCount += 1;
}

/**
 * Build a week menu plan: dish id per day+slot.
 * @returns {Map<string, string>} key `${dayNum}:${slotType}` → dishId
 */
export function buildWeeklyMenuPlan({
  strategy,
  candidatesBySlot,
  userData = null,
  startDay = 1,
  endDay = 7,
  seed = 0,
  tagFilterForSlot = () => null,
  dietCtx = {},
}) {
  const plan = new Map();
  const ready = candidatesBySlot.get('READY') || [];
  const weekDishUses = new Map();

  for (let dayNum = startDay; dayNum <= endDay; dayNum++) {
    const schemeKey = DAY_KEYS[dayNum - 1];
    const dayScheme = strategy?.weeklyScheme?.[schemeKey];
    if (!dayScheme?.mealBreakdown?.length) continue;

    const dayDishUses = new Set();
    const dayProteinFamilies = new Set();
    let dayHasFruit = false;
    let dayStarchCount = 0;

    let slotIndex = 0;
    for (const slot of dayScheme.mealBreakdown) {
      if (slot.type === 'Хранене 2' && dayScheme.mealBreakdown.some(m => m.type === 'Свободно хранене')) {
        continue;
      }
      const ctx = {
        seed: Number(seed) || 0,
        dayNum,
        slotIndex,
        weekDishUses,
        dayDishUses,
        dayProteinFamilies,
        dayHasFruit,
        dayStarchCount,
        dietCtx,
        tagFilter: tagFilterForSlot(slot.type, userData, strategy),
      };

      const pool = filterPool(ready, slot.type, slot, ctx);
      const dish = pickBestDish(pool, slot.type, slot, ctx);
      if (dish) {
        plan.set(`${dayNum}:${slot.type}`, dish.id);
        recordPick(dish, slot.type, ctx);
        dayHasFruit = ctx.dayHasFruit;
        dayStarchCount = ctx.dayStarchCount;
      }
      slotIndex++;
    }
  }

  return plan;
}
