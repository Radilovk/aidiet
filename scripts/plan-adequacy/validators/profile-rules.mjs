import { MAX_LATE_SNACK_CALORIES } from '../constants.mjs';
import { isWithinSlotCap } from '../../../plan-normalize.js';
import { parseMealDescription } from '../../../food-nutrition.js';

export function userSkipsBreakfast(profile) {
  const habits = profile.eatingHabits;
  return Array.isArray(habits) && habits.some(h => String(h).includes('Не закусвам'));
}

export function hasSweetCraving(profile) {
  const c = profile.foodCravings;
  if (Array.isArray(c)) return c.some(x => String(x).includes('Сладко'));
  return String(c || '').includes('Сладко');
}

/** H5 scheme slot: fail only when over cap (under-cap is OK within adequacy contract). */
export function validateH5SchemeSlot(slotCalories) {
  const cal = Number(slotCalories) || 0;
  if (!isWithinSlotCap(cal, MAX_LATE_SNACK_CALORIES)) {
    return `H5 slot: ${cal} kcal > ${MAX_LATE_SNACK_CALORIES}`;
  }
  return null;
}

export function validateProfileRules(plan, profile) {
  const issues = [];
  const wp = plan.weekPlan;
  const strategy = plan.strategy || {};

  if (userSkipsBreakfast(profile)) {
    for (let d = 1; d <= 7; d++) {
      const types = (wp[`day${d}`]?.meals || []).map(m => m.type);
      if (types.includes('Хранене 1')) issues.push(`day${d}: Хранене 1 при „Не закусвам“`);
    }
  }

  if (!hasSweetCraving(profile) || strategy.includeDessert === false) {
    for (let d = 1; d <= 7; d++) {
      for (const meal of wp[`day${d}`]?.meals || []) {
        if (meal.dessert) issues.push(`day${d} ${meal.type}: dessert без sweet craving / includeDessert false`);
      }
    }
  }

  const scheme = strategy.weeklyScheme || {};
  for (const [dayKey, dayScheme] of Object.entries(scheme)) {
    for (const slot of dayScheme.mealBreakdown || []) {
      if (slot.type === 'Хранене 5') {
        const err = validateH5SchemeSlot(slot.calories);
        if (err) issues.push(`${dayKey} ${err}`);
      }
    }
  }

  for (let d = 1; d <= 7; d++) {
    for (const meal of wp[`day${d}`]?.meals || []) {
      const names = parseMealDescription(meal.description || '').map(i => i.name.toLowerCase());
      if (names.some(n => /ориз с пиле|омлет|пилешка салата|риба с картофи/.test(n))) {
        issues.push(`day${d} ${meal.type}: ready_meal в description (${meal.name})`);
      }
    }
  }

  return issues;
}
