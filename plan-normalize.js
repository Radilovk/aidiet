/**
 * Universal plan normalization — deterministic fixes for common AI output drift.
 * Used by worker (write path) and adequacy validators (read path).
 *
 * Principles:
 *  1. mealBreakdown slots must be achievable (fair kcal share, absolute ceilings).
 *  2. Budget slots (Свободно хранене) are calorie allowances, not plated meals.
 *  3. Light slots (H3/H5) have lower minimum weight than main meals.
 *  4. Analysis severity labels must match severityValue bands.
 */

export const MAX_PLATED_SLOT_KCAL_ABSOLUTE = 900;
export const MAX_PLATED_SLOT_KCAL_BASE = 800;
export const FREE_MEAL_MAX_DAILY_RATIO = 0.45;
/** After free meal — dinner stays light (strategy rule). */
export const FREE_DAY_DINNER_MAX_RATIO = 0.28;
export const FREE_DAY_DINNER_MAX_KCAL = 600;
export const MIN_MAIN_MEAL_WEIGHT_GRAMS = 50;
export const MIN_LIGHT_MEAL_WEIGHT_GRAMS = 20;
/** Late snack (H5) kcal ceiling — single source for worker + validators. */
export const MAX_LATE_SNACK_CALORIES = 200;

/**
 * Adequacy contract: per-slot kcal deviation after nutrition sync.
 * 10% is standard for meal plans; floor keeps small snacks (H3) practical.
 */
export const SLOT_CALORIE_TOLERANCE_PERCENT = 0.10;
export const SLOT_CALORIE_TOLERANCE_MIN_KCAL = 30;

export function slotCalorieTolerance(targetKcal) {
  return Math.max(
    SLOT_CALORIE_TOLERANCE_MIN_KCAL,
    Math.round((Number(targetKcal) || 0) * SLOT_CALORIE_TOLERANCE_PERCENT),
  );
}

export function isMealCaloriesAdequate(achievedKcal, targetKcal) {
  const achieved = Number(achievedKcal) || 0;
  const target = Number(targetKcal) || 0;
  if (target <= 0 || achieved <= 0) return true;
  return Math.abs(achieved - target) <= slotCalorieTolerance(target);
}

const NEGATIVE_HEALTH_TONE = /влошен|критичн|много лош/i;

export const KEY_PROBLEM_SEVERITY_RANGES = {
  Borderline: [45, 59],
  Risky: [60, 79],
  Critical: [80, 95],
};

const BUDGET_SLOT_TYPES = new Set(['Свободно хранене', 'Напитка']);
const LIGHT_MEAL_TYPES = new Set(['Хранене 3', 'Хранене 5']);
const FIXED_KCAL_SLOT_TYPES = new Set(['Хранене 5']);

/** Хранене 3 — snack slot only (shared with worker + validators). */
export const MEAL3_SNACK_ALLOWED = [
  'плод', 'ябълка', 'круша', 'портокал', 'банан', 'ягод', 'боровинк', 'малин',
  'ядки', 'бадем', 'орех', 'кашу', 'лешник', 'шамфъстък',
  'скир', 'кисело мляко', 'кефир', 'извара',
];
export const MEAL3_SNACK_FORBIDDEN = [
  'пилешк', 'говежд', 'свинск', 'риба', 'треска', 'сьомга', 'скумри', 'тон',
  'ориз', 'хляб', 'паста', 'картоф', 'макарон', 'омлет', 'яхни', 'хумус',
  'месо', 'филе', 'бутче', 'кайма',
];

export function isBudgetMealSlot(type) {
  return BUDGET_SLOT_TYPES.has(type);
}

export function isLightMealSlot(type) {
  return LIGHT_MEAL_TYPES.has(type);
}

export function minMealWeightGrams(mealType) {
  return isLightMealSlot(mealType) ? MIN_LIGHT_MEAL_WEIGHT_GRAMS : MIN_MAIN_MEAL_WEIGHT_GRAMS;
}

export function severityLabelForValue(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (v >= KEY_PROBLEM_SEVERITY_RANGES.Critical[0]) return 'Critical';
  if (v >= KEY_PROBLEM_SEVERITY_RANGES.Risky[0]) return 'Risky';
  if (v >= KEY_PROBLEM_SEVERITY_RANGES.Borderline[0]) return 'Borderline';
  return 'Borderline';
}

function sumField(breakdown, field) {
  return breakdown.reduce((s, m) => s + (Number(m[field]) || 0), 0);
}

function platedSlots(breakdown) {
  return breakdown.filter(m => !BUDGET_SLOT_TYPES.has(m.type) && !FIXED_KCAL_SLOT_TYPES.has(m.type));
}

function redistributeMacros(slot, ratio) {
  slot.calories = Math.round((Number(slot.calories) || 0) * ratio);
  slot.protein = Math.round((Number(slot.protein) || 0) * ratio);
  slot.carbs = Math.round((Number(slot.carbs) || 0) * ratio);
  slot.fats = Math.round((Number(slot.fats) || 0) * ratio);
}

/**
 * Per-slot kcal ceiling from daily budget and plated meal count.
 * High-TDEE clients with few meals need a higher ceiling than 800 — but never above 900.
 */
export function maxPlatedSlotKcal(mealBreakdown, dailyKcal) {
  const breakdown = mealBreakdown || [];
  const daily = Math.max(0, Number(dailyKcal) || 0);
  const freeKcal = breakdown.find(m => m.type === 'Свободно хранене')?.calories || 0;
  const h5Kcal = breakdown.find(m => m.type === 'Хранене 5')?.calories || 0;
  const plated = platedSlots(breakdown);
  const platedBudget = Math.max(0, daily - Number(freeKcal) - Number(h5Kcal));
  const n = plated.length || 1;
  const fairShare = platedBudget / n;
  const dynamic = Math.ceil(fairShare * 1.1);
  return Math.min(
    MAX_PLATED_SLOT_KCAL_ABSOLUTE,
    Math.max(MAX_PLATED_SLOT_KCAL_BASE, dynamic),
  );
}

function capSlotMacros(slot, maxKcal) {
  const current = Number(slot.calories) || 0;
  if (current <= maxKcal) return 0;
  const ratio = maxKcal / current;
  redistributeMacros(slot, ratio);
  return current - maxKcal;
}

function addMacrosToSlot(slot, deltaKcal, deltaP, deltaC, deltaF) {
  slot.calories = Math.round((Number(slot.calories) || 0) + deltaKcal);
  slot.protein = Math.round((Number(slot.protein) || 0) + deltaP);
  slot.carbs = Math.round((Number(slot.carbs) || 0) + deltaC);
  slot.fats = Math.round((Number(slot.fats) || 0) + deltaF);
}

/**
 * Rebalance plated slots: cap oversized entries, redistribute surplus fairly.
 */
export function rebalanceMealBreakdownSlots(day, dailyKcal) {
  if (!day?.mealBreakdown?.length) return;

  const daily = Number(dailyKcal) || Number(day.calories) || sumField(day.mealBreakdown, 'calories');
  const free = day.mealBreakdown.find(m => m.type === 'Свободно хранене');
  if (free) {
    const maxFree = Math.max(350, Math.round(daily * FREE_MEAL_MAX_DAILY_RATIO));
    const excess = capSlotMacros(free, maxFree);
    if (excess > 0) {
      // surplus from an oversized free-meal budget goes to plated slots below
      const recipients = platedSlots(day.mealBreakdown).filter(m => (Number(m.calories) || 0) < maxPlatedSlotKcal(day.mealBreakdown, daily));
      const sum = recipients.reduce((s, m) => s + (Number(m.calories) || 0), 0) || recipients.length || 1;
      for (const r of recipients) {
        const share = (Number(r.calories) || 0) / sum || 1 / recipients.length;
        addMacrosToSlot(r, Math.round(excess * share), 0, 0, 0);
      }
    }
  }

  const maxKcal = maxPlatedSlotKcal(day.mealBreakdown, daily);

  for (let pass = 0; pass < 8; pass++) {
    let poolKcal = 0;
    let poolP = 0;
    let poolC = 0;
    let poolF = 0;

    for (const slot of platedSlots(day.mealBreakdown)) {
      const current = Number(slot.calories) || 0;
      if (current > maxKcal) {
        const ratio = maxKcal / current;
        poolKcal += current - maxKcal;
        poolP += (Number(slot.protein) || 0) * (1 - ratio);
        poolC += (Number(slot.carbs) || 0) * (1 - ratio);
        poolF += (Number(slot.fats) || 0) * (1 - ratio);
        redistributeMacros(slot, ratio);
      }
    }

    if (poolKcal <= 0) break;

    const recipients = platedSlots(day.mealBreakdown)
      .filter(m => (Number(m.calories) || 0) < maxKcal - 5);
    if (!recipients.length) break;

    const headroom = recipients.map(m => maxKcal - (Number(m.calories) || 0));
    const totalHeadroom = headroom.reduce((a, b) => a + b, 0) || 1;

    for (let i = 0; i < recipients.length; i++) {
      const share = headroom[i] / totalHeadroom;
      addMacrosToSlot(
        recipients[i],
        Math.round(poolKcal * share),
        Math.round(poolP * share),
        Math.round(poolC * share),
        Math.round(poolF * share),
      );
    }
  }

  enforceFreeDayDinnerCap(day, daily);
}

/** Free-day dinner (H4) must stay light — surplus goes to other plated slots. */
function enforceFreeDayDinnerCap(day, dailyKcal) {
  const hasFree = day.mealBreakdown?.some(m => m.type === 'Свободно хранене');
  if (!hasFree) return;
  const h4 = day.mealBreakdown.find(m => m.type === 'Хранене 4');
  if (!h4) return;

  const maxDinner = Math.min(
    FREE_DAY_DINNER_MAX_KCAL,
    Math.max(350, Math.round(dailyKcal * FREE_DAY_DINNER_MAX_RATIO)),
  );
  const excessKcal = capSlotMacros(h4, maxDinner);
  if (excessKcal <= 0) return;

  const recipients = platedSlots(day.mealBreakdown)
    .filter(m => m.type !== 'Хранене 4' && (Number(m.calories) || 0) < maxPlatedSlotKcal(day.mealBreakdown, dailyKcal));
  if (!recipients.length) return;

  const sum = recipients.reduce((s, m) => s + (Number(m.calories) || 0), 0) || recipients.length;
  for (const r of recipients) {
    const share = (Number(r.calories) || 0) / sum || 1 / recipients.length;
    addMacrosToSlot(r, Math.round(excessKcal * share), 0, 0, 0);
  }
}

function dietPreferences(userData) {
  const raw = userData?.dietPreference;
  if (Array.isArray(raw)) return raw.map(String);
  return raw ? [String(raw)] : [];
}

export function isVeganUser(userData) {
  return dietPreferences(userData).some(p => p.includes('Веган'));
}

export function userSkipsBreakfast(userData) {
  const habits = userData?.eatingHabits;
  return Array.isArray(habits) && habits.some(h => String(h).includes('Не закусвам'));
}

/** Strip Хранене 1 from scheme when client skips breakfast; redistribute kcal to mains. */
export function removeBreakfastSlotFromDay(day) {
  if (!day?.mealBreakdown?.length) return;
  const idx = day.mealBreakdown.findIndex(m => m.type === 'Хранене 1');
  if (idx < 0) return;

  const h1 = day.mealBreakdown.splice(idx, 1)[0];
  const surplus = Number(h1.calories) || 0;
  if (surplus > 0) {
    const mains = day.mealBreakdown.filter(m => m.type === 'Хранене 2' || m.type === 'Хранене 4');
    const sum = mains.reduce((s, m) => s + (Number(m.calories) || 0), 0) || mains.length || 1;
    for (const m of mains) {
      const share = (Number(m.calories) || 0) / sum || 1 / mains.length;
      m.calories = Math.round((Number(m.calories) || 0) + surplus * share);
    }
  }
  day.meals = day.mealBreakdown.length;
}

/** Step 3 prompt — one rule derived from dietary context, not per-profile branches. */
export function buildMeal3PromptRule(userData) {
  if (isVeganUser(userData)) {
    return 'лека закуска: плод + ядки (банан/ябълка + бадеми/орехи). БЕЗ хумус, хляб, млечни, готвени ястия, месо, боб';
  }
  return 'лека закуска: плод и/или ядки и/или скир/кисело мляко. НЕ е мини-обяд — без месо, риба, боб, ориз, хляб, салата';
}

const MEAL3_REPAIR_VEGAN = {
  name: 'Банан с бадеми',
  description: '• Банан 120g\n• Бадеми 25g',
};
const MEAL3_REPAIR_DEFAULT = {
  name: 'Кисело мляко с бадеми',
  description: '• Кисело мляко 150g\n• Бадеми 20g',
};

/**
 * Deterministic H3 repair when AI picks a non-snack — no retry dependency.
 * Returns true if the meal was replaced (caller should re-sync nutrition).
 */
export function repairMeal3IfInvalid(meal, userData) {
  if (!meal || meal.type !== 'Хранене 3') return false;
  if (!validateLightMealSlotContent(meal).length) return false;

  const tmpl = isVeganUser(userData) ? MEAL3_REPAIR_VEGAN : MEAL3_REPAIR_DEFAULT;
  meal.name = tmpl.name;
  meal.description = tmpl.description;
  delete meal.calories;
  delete meal.macros;
  delete meal.weight;
  return true;
}

/** Хранене 5 — fats+protein only (shared with worker + validators). */
export const MEAL5_SNACK_ALLOWED = [
  'кисело мляко', 'скир', 'кефир', 'извара', 'кашкавал',
  'ядки', 'бадем', 'орех', 'кашу', 'лешник', 'шамфъстък',
];
export const MEAL5_SNACK_FORBIDDEN = [
  'ориз', 'хляб', 'паста', 'картоф', 'макарон', 'банан', 'ябълка', 'плод',
  'пилешк', 'говежд', 'риба', 'боб', 'мед', 'захар',
];

const MEAL5_REPAIR_VEGAN = {
  name: 'Бадеми и орехи',
  description: '• Бадеми 20g\n• Орехи 15g',
};
const MEAL5_REPAIR_DEFAULT = {
  name: 'Скир с бадеми',
  description: '• Скир 120g\n• Бадеми 15g',
};

export function validateLateSnackSlotContent(meal, dayNum = null) {
  const errors = [];
  if (!meal || meal.type !== 'Хранене 5') return errors;

  const text = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();
  const prefix = dayNum != null ? `Ден ${dayNum}: ` : '';

  if (MEAL5_SNACK_FORBIDDEN.some(f => text.includes(f))) {
    errors.push(`${prefix}Хранене 5 не е късна закуска — "${meal.name}"`);
  } else if (!MEAL5_SNACK_ALLOWED.some(f => text.includes(f))) {
    errors.push(`${prefix}Хранене 5 не е късна закуска — "${meal.name}"`);
  } else if ((Number(meal.calories) || 0) > MAX_LATE_SNACK_CALORIES) {
    errors.push(`${prefix}Хранене 5: ${meal.calories} kcal > ${MAX_LATE_SNACK_CALORIES}`);
  }
  return errors;
}

export function repairMeal5IfInvalid(meal, userData) {
  if (!meal || meal.type !== 'Хранене 5') return false;
  if (!validateLateSnackSlotContent(meal).length) return false;

  const tmpl = isVeganUser(userData) ? MEAL5_REPAIR_VEGAN : MEAL5_REPAIR_DEFAULT;
  meal.name = tmpl.name;
  meal.description = tmpl.description;
  delete meal.calories;
  delete meal.macros;
  delete meal.weight;
  return true;
}

/** Repair H3 or H5 when AI drifts — single entry for all write paths. */
export function repairLightMealSlotIfInvalid(meal, userData) {
  if (repairMeal3IfInvalid(meal, userData)) return true;
  return repairMeal5IfInvalid(meal, userData);
}

export function repairWeekPlanLightSlots(weekPlan, startDay, endDay, userData) {
  let repaired = false;
  for (let d = startDay; d <= endDay; d++) {
    for (const meal of weekPlan[`day${d}`]?.meals || []) {
      if (repairLightMealSlotIfInvalid(meal, userData)) repaired = true;
    }
  }
  return repaired;
}

/** Validate Хранене 3 is a true snack (used during chunk generation, not only final validate). */
export function validateLightMealSlotContent(meal, dayNum = null) {
  const errors = [];
  if (!meal || meal.type !== 'Хранене 3') return errors;

  const text = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();
  const prefix = dayNum != null ? `Ден ${dayNum}: ` : '';

  if (MEAL3_SNACK_FORBIDDEN.some(f => text.includes(f))) {
    errors.push(`${prefix}Хранене 3 не е лека закуска — "${meal.name}"`);
  } else if (!MEAL3_SNACK_ALLOWED.some(f => text.includes(f))) {
    errors.push(`${prefix}Хранене 3 не е лека закуска — "${meal.name}"`);
  }
  return errors;
}

/** Clamp severityValue ↔ severity label; fill missing health score. */
export function normalizeAnalysisOutput(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;

  if (Array.isArray(analysis.keyProblems)) {
    for (const problem of analysis.keyProblems) {
      if (!problem || problem.severity === 'Normal') continue;
      const sv = Number(problem.severityValue);
      if (!Number.isFinite(sv)) continue;

      const band = KEY_PROBLEM_SEVERITY_RANGES[problem.severity];
      if (!band || sv < band[0] || sv > band[1]) {
        const label = severityLabelForValue(sv);
        if (label) problem.severity = label;
        else if (band) {
          problem.severityValue = Math.round((band[0] + band[1]) / 2);
        }
      }
    }
  }

  if (!Array.isArray(analysis.keyProblems)) analysis.keyProblems = [];
  if (analysis.keyProblems.length < 3) {
    const extras = []
      .concat(analysis.hinderingFactors || [])
      .concat(analysis.negativeHealthFactors || [])
      .filter(f => f && (f.factor || f.title));
    for (const src of extras) {
      if (analysis.keyProblems.length >= 3) break;
      const title = src.factor || src.title;
      if (analysis.keyProblems.some(p => p.title === title)) continue;
      analysis.keyProblems.push({
        title,
        description: src.description || title,
        severity: src.severity >= 4 ? 'Critical' : src.severity >= 3 ? 'Risky' : 'Borderline',
        severityValue: typeof src.severity === 'number' ? Math.min(90, src.severity * 18) : 55,
        category: 'Health',
        impact: src.description || title,
      });
    }
  }

  if (!analysis.currentHealthStatus || typeof analysis.currentHealthStatus !== 'object') {
    analysis.currentHealthStatus = {};
  }
  const hs = analysis.currentHealthStatus;

  if (typeof hs.score !== 'number' || Number.isNaN(hs.score)) {
    const values = (analysis.keyProblems || [])
      .map(p => Number(p.severityValue))
      .filter(v => Number.isFinite(v));
    if (values.length) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      hs.score = Math.round(Math.max(15, Math.min(95, 100 - avg * 0.75)));
    }
  }

  const titles = (analysis.keyProblems || []).slice(0, 3).map(p => p.title).filter(Boolean);
  const neutralDescription = titles.length
    ? `Здравословното състояние е повлияно от: ${titles.join(', ')}.`
    : 'Общата здравна оценка отразява комбинацията от хранителни, метаболитни и поведенчески фактори.';

  if (!hs.description || String(hs.description).length < 20) {
    hs.description = neutralDescription;
  } else if (typeof hs.score === 'number' && hs.score >= 50 && NEGATIVE_HEALTH_TONE.test(hs.description)) {
    hs.description = neutralDescription;
  }

  if (!Array.isArray(hs.keyIssues) || !hs.keyIssues.length) {
    hs.keyIssues = (analysis.keyProblems || []).slice(0, 4).map(p => p.title).filter(Boolean);
  }

  return analysis;
}

const SCHEME_DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * After nutrition sync: align scheme slot targets with achieved kcal when within
 * adequacy tolerance (portion caps make exact targets unreachable).
 */
export function reconcileAchievedSlotCalories(weekPlan, strategy, startDay, endDay) {
  if (!weekPlan || !strategy?.weeklyScheme) return;

  for (let d = startDay; d <= endDay; d++) {
    const dayPlan = weekPlan[`day${d}`];
    const dayScheme = strategy.weeklyScheme[SCHEME_DAY_KEYS[d - 1]];
    if (!dayPlan?.meals?.length || !dayScheme?.mealBreakdown?.length) continue;

    for (const meal of dayPlan.meals) {
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
      const slot = dayScheme.mealBreakdown.find(m => m.type === meal.type);
      if (!slot) continue;

      const target = Number(slot.calories) || 0;
      const achieved = Number(meal.calories) || 0;
      if (target <= 0 || achieved <= 0) continue;

      if (isMealCaloriesAdequate(achieved, target)) {
        slot.calories = achieved;
      }
    }

    dayScheme.calories = dayScheme.mealBreakdown.reduce((s, m) => s + (Number(m.calories) || 0), 0);
  }
}

/** Strategy validator helper — budget slots exempt from plated kcal cap. */
export function validateSlotCalories(entry, dayScheme) {
  if (!entry || isBudgetMealSlot(entry.type)) return null;
  if (entry.type === 'Хранене 5') return null; // capped separately
  const daily = Number(dayScheme?.calories) || sumField(dayScheme?.mealBreakdown || [], 'calories');
  const maxKcal = maxPlatedSlotKcal(dayScheme?.mealBreakdown, daily);
  if ((Number(entry.calories) || 0) > maxKcal) {
    return `${entry.type} ${entry.calories} kcal > ${maxKcal}`;
  }
  return null;
}
