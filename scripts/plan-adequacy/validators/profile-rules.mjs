import { MAX_LATE_SNACK_CALORIES } from '../constants.mjs';
import {
  breakfastRequiredForIntake,
  effectiveSkipsBreakfast,
  isWithinSlotCap,
  resolveMealsPerDayFromHabits,
} from '../../../plan-normalize.js';

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

function resolvePlanDailyKcal(plan, profile) {
  const raw = plan.analysis?.Final_Calories
    ?? plan.strategy?.weeklyScheme?.monday?.calories
    ?? profile?.targetKcal;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function validateProfileRules(plan, profile) {
  const issues = [];
  const wp = plan.weekPlan;
  const strategy = plan.strategy || {};
  const dailyKcal = resolvePlanDailyKcal(plan, profile);
  const mealsPerDay = resolveMealsPerDayFromHabits(profile);

  if (userSkipsBreakfast(profile)) {
    const breakfastRequired = breakfastRequiredForIntake(dailyKcal, mealsPerDay, profile);
    for (let d = 1; d <= 7; d++) {
      const types = (wp[`day${d}`]?.meals || []).map(m => m.type);
      if (types.includes('Хранене 1')) {
        if (!breakfastRequired && effectiveSkipsBreakfast(profile, dailyKcal, mealsPerDay)) {
          issues.push(`day${d}: Хранене 1 при „Не закусвам“`);
        }
      } else if (breakfastRequired) {
        issues.push(`day${d}: липсва задължителна закуска при ${dailyKcal} kcal`);
      }
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
      const raw = `${meal.description || ''} ${meal.name || ''}`.toLowerCase();
      if (/ориз с пиле|омлет|пилешка салата|риба с картофи/.test(raw)) {
        issues.push(`day${d} ${meal.type}: ready_meal в description (${meal.name})`);
      }
    }
  }

  return issues;
}
