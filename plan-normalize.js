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
/** Afternoon snack (H3) kcal ceiling — fruit/nuts/yogurt cannot reach main-meal targets. */
export const MAX_AFTERNOON_SNACK_CALORIES = 350;

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
  'мед', 'захар', 'сироп', 'конфитюр', 'мелас',
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

function keyProblemTitleOverlaps(existingTitle, candidate) {
  const a = String(existingTitle || '').toLowerCase();
  const b = String(candidate || '').toLowerCase();
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const words = b.split(/\s+/).filter(w => w.length > 5);
  return words.some(w => a.includes(w));
}

function pushDerivedKeyProblem(analysis, title, description, severity = 'Borderline', severityValue = 55) {
  if (!title || analysis.keyProblems.some(p => keyProblemTitleOverlaps(p.title, title))) return false;
  analysis.keyProblems.push({
    title,
    description: description || title,
    severity,
    severityValue,
    category: 'Health',
    impact: description || title,
  });
  return true;
}

function sumField(breakdown, field) {
  return breakdown.reduce((s, m) => s + (Number(m[field]) || 0), 0);
}

function platedSlots(breakdown) {
  return breakdown.filter(m => !BUDGET_SLOT_TYPES.has(m.type) && !FIXED_KCAL_SLOT_TYPES.has(m.type));
}

/** Main meals that can absorb surplus kcal — never light snacks; on free days dinner is capped separately. */
function mainMealRecipients(day) {
  const hasFree = day?.mealBreakdown?.some(m => m.type === 'Свободно хранене');
  const mains = (day?.mealBreakdown || []).filter(m =>
    m.type === 'Хранене 2' || (m.type === 'Хранене 4' && !hasFree),
  );
  if (mains.length) return mains;
  const free = day?.mealBreakdown?.find(m => m.type === 'Свободно хранене');
  return free ? [free] : [];
}

function maxSlotKcal(slotType, mealBreakdown, dailyKcal) {
  if (slotType === 'Хранене 5') return MAX_LATE_SNACK_CALORIES;
  if (slotType === 'Хранене 3') return MAX_AFTERNOON_SNACK_CALORIES;
  return maxPlatedSlotKcal(mealBreakdown, dailyKcal);
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

function maxFreeMealKcal(dailyKcal) {
  return Math.max(350, Math.round((Number(dailyKcal) || 0) * FREE_MEAL_MAX_DAILY_RATIO));
}

/** Distribute surplus kcal to recipients; free-meal budget respects daily cap. */
function distributeSurplusToRecipients(recipients, excessKcal, excessP, excessC, excessF, dailyKcal) {
  if (!recipients.length || excessKcal <= 0) return excessKcal;

  let remaining = excessKcal;
  let remP = excessP;
  let remC = excessC;
  let remF = excessF;
  const sum = recipients.reduce((s, m) => s + (Number(m.calories) || 0), 0) || recipients.length;

  for (const m of recipients) {
    const share = (Number(m.calories) || 0) / sum || 1 / recipients.length;
    let addK = Math.round(remaining * share);
    if (m.type === 'Свободно хранене') {
      const headroom = Math.max(0, maxFreeMealKcal(dailyKcal) - (Number(m.calories) || 0));
      addK = Math.min(addK, headroom);
    }
    if (addK <= 0) continue;
    const ratio = addK / remaining;
    addMacrosToSlot(m, addK, Math.round(remP * ratio), Math.round(remC * ratio), Math.round(remF * ratio));
    remaining -= addK;
    remP -= Math.round(remP * ratio);
    remC -= Math.round(remC * ratio);
    remF -= Math.round(remF * ratio);
  }

  if (remaining > 0) {
    const fallback = recipients.find(m => m.type === 'Хранене 2' || m.type === 'Хранене 4') || recipients[0];
    if (fallback && fallback.type !== 'Свободно хранене') {
      addMacrosToSlot(fallback, remaining, remP, remC, remF);
    }
  }
  return 0;
}

/**
 * Rebalance plated slots: cap oversized entries, redistribute surplus fairly.
 */
export function rebalanceMealBreakdownSlots(day, dailyKcal) {
  if (!day?.mealBreakdown?.length) return;

  const daily = Number(dailyKcal) || Number(day.calories) || sumField(day.mealBreakdown, 'calories');
  const free = day.mealBreakdown.find(m => m.type === 'Свободно хранене');
  if (free) {
    const maxFree = maxFreeMealKcal(daily);
    const excess = capSlotMacros(free, maxFree);
    if (excess > 0) {
      const recipients = platedSlots(day.mealBreakdown).filter(m =>
        !isLightMealSlot(m.type) && (Number(m.calories) || 0) < maxSlotKcal(m.type, day.mealBreakdown, daily),
      );
      distributeSurplusToRecipients(recipients, excess, 0, 0, 0, daily);
    }
  }

  for (let pass = 0; pass < 8; pass++) {
    let poolKcal = 0;
    let poolP = 0;
    let poolC = 0;
    let poolF = 0;

    for (const slot of platedSlots(day.mealBreakdown)) {
      const slotMax = maxSlotKcal(slot.type, day.mealBreakdown, daily);
      const current = Number(slot.calories) || 0;
      if (current > slotMax) {
        const ratio = slotMax / current;
        poolKcal += current - slotMax;
        poolP += (Number(slot.protein) || 0) * (1 - ratio);
        poolC += (Number(slot.carbs) || 0) * (1 - ratio);
        poolF += (Number(slot.fats) || 0) * (1 - ratio);
        redistributeMacros(slot, ratio);
      }
    }

    if (poolKcal <= 0) break;

    const recipients = platedSlots(day.mealBreakdown)
      .filter(m => !isLightMealSlot(m.type) && (Number(m.calories) || 0) < maxSlotKcal(m.type, day.mealBreakdown, daily) - 5);
    if (!recipients.length) break;

    const headroom = recipients.map(m => maxSlotKcal(m.type, day.mealBreakdown, daily) - (Number(m.calories) || 0));
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
  reconcileDailyCalories(day, daily);
  enforceFixedSlotCaps(day, daily);
}

/** Hard cap H3/H5 scheme slots — reconcile must not drift above fixed ceilings. */
export function enforceFixedSlotCaps(day, dailyKcal) {
  if (!day?.mealBreakdown?.length) return;
  const daily = Number(dailyKcal) || Number(day.calories) || sumField(day.mealBreakdown, 'calories');
  for (const slot of day.mealBreakdown) {
    if (slot.type !== 'Хранене 3' && slot.type !== 'Хранене 5') continue;
    const cap = maxSlotKcal(slot.type, day.mealBreakdown, daily);
    if ((Number(slot.calories) || 0) > cap) capSlotMacros(slot, cap);
  }
}

/** After slot caps, restore daily kcal total — surplus goes to main meals or free-meal budget. */
function reconcileDailyCalories(day, dailyKcal) {
  const daily = Number(dailyKcal) || 0;
  if (!daily || !day?.mealBreakdown?.length) return;
  const diff = daily - sumField(day.mealBreakdown, 'calories');
  if (diff <= 5) return;
  const recipients = mainMealRecipients(day);
  if (!recipients.length) return;
  distributeSurplusToRecipients(recipients, diff, 0, 0, 0, daily);
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

  const recipients = mainMealRecipients(day).filter(m =>
    m.type !== 'Хранене 4' && (Number(m.calories) || 0) < maxSlotKcal(m.type, day.mealBreakdown, dailyKcal),
  );
  if (!recipients.length) return;

  distributeSurplusToRecipients(recipients, excessKcal, 0, 0, 0, dailyKcal);
}

function dietPreferences(userData) {
  const raw = userData?.dietPreference;
  if (Array.isArray(raw)) return raw.map(String);
  return raw ? [String(raw)] : [];
}

export function isVeganUser(userData) {
  return dietPreferences(userData).some(p => p.includes('Веган'));
}

export function isKetoUser(userData) {
  return dietPreferences(userData).some(p => /кето|нисковъглехидрат/i.test(p));
}

const MIN_FAT_GRAMS_PER_KG = 0.7;
export const KETO_MAX_CARB_RATIO = 0.15;

/** Strict keto carb ceiling — floor grams so ratio stays below 15% after rounding. */
export function maxKetoCarbGrams(dailyKcal) {
  const kcal = Number(dailyKcal) || 0;
  if (kcal <= 0) return 0;
  return Math.floor(kcal * KETO_MAX_CARB_RATIO / 4);
}

export function isKetoCarbCompliant(dailyKcal, carbGrams) {
  const kcal = Number(dailyKcal) || 0;
  const carbs = Number(carbGrams) || 0;
  return kcal <= 0 || carbs * 4 <= kcal * KETO_MAX_CARB_RATIO;
}

function clampKetoMacros(dailyKcal, proteinG, carbsG, fatsG, minFatG) {
  const kcal = Number(dailyKcal) || 0;
  if (kcal <= 0) {
    return {
      protein: Math.round(Number(proteinG) || 0),
      carbs: Math.round(Number(carbsG) || 0),
      fats: Math.round(Number(fatsG) || 0),
    };
  }

  let protein = Math.round(Number(proteinG) || 0);
  let carbs = Math.round(Number(carbsG) || 0);
  let fats = Math.round(Number(fatsG) || 0);
  const maxCarbs = maxKetoCarbGrams(kcal);

  if (isKetoCarbCompliant(kcal, carbs) && fats >= minFatG) {
    const macroKcal = protein * 4 + carbs * 4 + fats * 9;
    if (Math.abs(macroKcal - kcal) <= 25) return { protein, carbs, fats };
  }

  if (carbs > maxCarbs) carbs = maxCarbs;
  fats = Math.max(minFatG, Math.round((kcal - protein * 4 - carbs * 4) / 9));
  if (protein * 4 + carbs * 4 + fats * 9 > kcal + 5) {
    carbs = Math.max(0, Math.floor((kcal - protein * 4 - fats * 9) / 4));
  }
  return { protein, carbs: Math.max(0, carbs), fats };
}

function syncMacroRatiosFromGrams(analysis, fc, mg) {
  const ratios = analysis.macroRatios || (analysis.macroRatios = {});
  ratios.protein = Math.round(mg.protein * 4 / fc * 100);
  ratios.carbs = Math.round(mg.carbs * 4 / fc * 100);
  ratios.fats = Math.round(mg.fats * 9 / fc * 100);
  const ratioSum = ratios.protein + ratios.carbs + ratios.fats;
  if (ratioSum !== 100 && ratioSum > 0) {
    ratios.fats = Math.max(0, ratios.fats + (100 - ratioSum));
  }
}

function applyKetoClampToDayScheme(day, minFatG) {
  const breakdown = day?.mealBreakdown;
  if (!breakdown?.length) return false;

  const daily = breakdown.reduce((s, m) => s + (Number(m.calories) || 0), 0) || Number(day.calories) || 0;
  if (daily <= 0) return false;

  const sumProtein = breakdown.reduce((s, m) => s + (Number(m.protein) || 0), 0);
  const sumCarbs = breakdown.reduce((s, m) => s + (Number(m.carbs) || 0), 0);
  const sumFats = breakdown.reduce((s, m) => s + (Number(m.fats) || 0), 0);
  const target = clampKetoMacros(daily, sumProtein, sumCarbs, sumFats, minFatG);

  if (target.carbs === sumCarbs && target.fats === sumFats && isKetoCarbCompliant(daily, sumCarbs)) {
    return false;
  }

  const carbScale = sumCarbs > 0 ? target.carbs / sumCarbs : 0;
  let allocatedCarbs = 0;
  for (let i = 0; i < breakdown.length; i++) {
    const slot = breakdown[i];
    if (i === breakdown.length - 1) {
      slot.carbs = Math.max(0, target.carbs - allocatedCarbs);
    } else {
      slot.carbs = Math.round((Number(slot.carbs) || 0) * carbScale);
      allocatedCarbs += slot.carbs;
    }
  }

  const fatDelta = target.fats - sumFats;
  if (fatDelta !== 0) {
    const recipients = breakdown.filter(m =>
      m.type === 'Хранене 2' || m.type === 'Хранене 4'
      || ((Number(m.fats) || 0) > 0 && m.type !== 'Хранене 5'),
    );
    const pool = recipients.length ? recipients : breakdown.filter(m => m.type !== 'Хранене 5');
    const fatBase = pool.reduce((s, m) => s + (Number(m.fats) || 0), 0) || pool.length || 1;
    let allocatedFat = 0;
    for (let i = 0; i < pool.length; i++) {
      const slot = pool[i];
      if (i === pool.length - 1) {
        slot.fats = Math.max(0, (Number(slot.fats) || 0) + fatDelta - allocatedFat);
      } else {
        const add = Math.round(fatDelta * ((Number(slot.fats) || 0) / fatBase || 1 / pool.length));
        slot.fats = Math.round((Number(slot.fats) || 0) + add);
        allocatedFat += add;
      }
    }
  }

  for (const slot of breakdown) {
    slot.calories = Math.round(
      (Number(slot.protein) || 0) * 4 + (Number(slot.carbs) || 0) * 4 + (Number(slot.fats) || 0) * 9,
    );
  }

  day.calories = breakdown.reduce((s, m) => s + (Number(m.calories) || 0), 0);
  day.protein = breakdown.reduce((s, m) => s + (Number(m.protein) || 0), 0);
  day.carbs = breakdown.reduce((s, m) => s + (Number(m.carbs) || 0), 0);
  day.fats = breakdown.reduce((s, m) => s + (Number(m.fats) || 0), 0);
  return true;
}

/** Clamp analysis macros to keto ceiling (≤15% kcal from carbs); keeps protein, raises fats. */
export function enforceKetoMacroGuardrails(analysis, userData) {
  if (!analysis || !isKetoUser(userData)) return;

  const fc = Number(analysis.Final_Calories) || Number(analysis.correctedMetabolism?.realTDEE) || 0;
  if (fc <= 0) return;

  const mg = analysis.macroGrams || (analysis.macroGrams = {});
  const weight = parseFloat(userData?.weight) || 70;
  const minFatG = Math.round(weight * MIN_FAT_GRAMS_PER_KG);
  const clamped = clampKetoMacros(fc, mg.protein, mg.carbs, mg.fats, minFatG);

  mg.protein = clamped.protein;
  mg.carbs = clamped.carbs;
  mg.fats = clamped.fats;
  syncMacroRatiosFromGrams(analysis, fc, mg);
}

/** Align strategy weeklyScheme day macros with keto carb ceiling. */
export function enforceKetoStrategyGuardrails(strategy, userData) {
  if (!strategy?.weeklyScheme || !isKetoUser(userData)) return;
  const weight = parseFloat(userData?.weight) || 70;
  const minFatG = Math.round(weight * MIN_FAT_GRAMS_PER_KG);
  for (const day of Object.values(strategy.weeklyScheme)) {
    applyKetoClampToDayScheme(day, minFatG);
  }
}

function profileGoalText(userData) {
  const g = userData?.goal;
  if (Array.isArray(g)) return g.join(' ').toLowerCase();
  return String(g || '').toLowerCase();
}

function profileActivityText(userData) {
  return [userData?.sportActivity, userData?.dailyActivityLevel].filter(Boolean).join(' ').toLowerCase();
}

/** Derive keyProblems from health keyIssues and profile context when AI returns too few. */
function collectContextKeyProblemCandidates(analysis, userData) {
  const out = [];
  const keyIssues = analysis?.currentHealthStatus?.keyIssues;
  if (Array.isArray(keyIssues)) {
    for (const issue of keyIssues) {
      if (typeof issue === 'string' && issue.trim().length > 4) {
        out.push({ title: issue.trim(), desc: issue.trim() });
      }
    }
  }
  if (!userData) return out;

  const goal = profileGoalText(userData);
  const activity = profileActivityText(userData);

  if (goal.includes('мускул')) {
    out.push({
      title: 'Недостатъчен протеинов прием за мускулна хипертрофия',
      desc: 'При цел мускулна маса е необходим адекватен дневен протеин и разпределение около тренировките.',
      severity: 'Risky',
      sv: 68,
    });
    out.push({
      title: 'Неравномерно разпределение на калориите',
      desc: 'Концентрирането на калории в малко хранения ограничава възстановяването и синтеза на протеин.',
      severity: 'Borderline',
      sv: 52,
    });
  }
  if (/много висок|ежедневно|интензив/i.test(activity)) {
    out.push({
      title: 'Риск от енергиен дефицит при висока натовареност',
      desc: 'Интензивната физическа активност повишава нуждите от калории и въглехидрати за възстановяване.',
      severity: 'Risky',
      sv: 65,
    });
    out.push({
      title: 'Повишена нужда от хидратация и електролити',
      desc: 'При ежедневни тренировки загубата на течности и минерали може да повлияе на представянето.',
      severity: 'Borderline',
      sv: 50,
    });
  }
  if (goal.includes('отслаб')) {
    out.push({
      title: 'Риск от загуба на мускулна маса при дефицит',
      desc: 'Агресивният калориен дефицит без достатъчен протеин може да намали мускулната маса.',
      severity: 'Borderline',
      sv: 55,
    });
  }
  return out;
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
  } else {
    const cal = Number(meal.calories) || 0;
    if (cal > MAX_LATE_SNACK_CALORIES && !isMealCaloriesAdequate(cal, MAX_LATE_SNACK_CALORIES)) {
      errors.push(`${prefix}Хранене 5: ${cal} kcal > ${MAX_LATE_SNACK_CALORIES} (±${slotCalorieTolerance(MAX_LATE_SNACK_CALORIES)})`);
    }
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
export function normalizeAnalysisOutput(analysis, userData = null) {
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
      pushDerivedKeyProblem(
        analysis,
        title,
        src.description || title,
        src.severity >= 4 ? 'Critical' : src.severity >= 3 ? 'Risky' : 'Borderline',
        typeof src.severity === 'number' ? Math.min(90, src.severity * 18) : 55,
      );
    }
  }
  if (analysis.keyProblems.length < 3) {
    const riskLines = []
      .concat(analysis.healthRisks || [])
      .concat(analysis.nutritionalNeeds || [])
      .filter(s => typeof s === 'string' && s.trim().length > 12);
    for (const text of riskLines) {
      if (analysis.keyProblems.length >= 3) break;
      const title = text.length > 72 ? `${text.slice(0, 69)}…` : text;
      pushDerivedKeyProblem(analysis, title, text);
    }
  }
  if (analysis.keyProblems.length < 3) {
    for (const candidate of collectContextKeyProblemCandidates(analysis, userData)) {
      if (analysis.keyProblems.length >= 3) break;
      pushDerivedKeyProblem(
        analysis,
        candidate.title,
        candidate.desc,
        candidate.severity || 'Borderline',
        candidate.sv || 55,
      );
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

      const ceiling = maxSlotKcal(meal.type, dayScheme.mealBreakdown, dayScheme.calories);
      const isFixed = meal.type === 'Хранене 3' || meal.type === 'Хранене 5';
      let aligned = target;
      if (!isFixed && isMealCaloriesAdequate(achieved, target)) {
        aligned = achieved;
      } else if (!isFixed && achieved < target) {
        aligned = achieved;
      } else if (isFixed && achieved > 0) {
        aligned = Math.min(achieved, ceiling);
      }
      slot.calories = Math.min(aligned, ceiling);
    }

    dayScheme.calories = dayScheme.mealBreakdown.reduce((s, m) => s + (Number(m.calories) || 0), 0);
  }
}

/** Strategy validator helper — budget slots exempt from plated kcal cap. */
export function validateSlotCalories(entry, dayScheme) {
  if (!entry || isBudgetMealSlot(entry.type)) return null;
  if (entry.type === 'Хранене 5') return null;

  const cal = Number(entry.calories) || 0;
  const daily = Number(dayScheme?.calories) || sumField(dayScheme?.mealBreakdown || [], 'calories');
  const breakdown = dayScheme?.mealBreakdown || [];

  if (entry.type === 'Хранене 3') {
    if (cal > MAX_AFTERNOON_SNACK_CALORIES + slotCalorieTolerance(MAX_AFTERNOON_SNACK_CALORIES)) {
      return `${entry.type} ${cal} kcal > ${MAX_AFTERNOON_SNACK_CALORIES}`;
    }
    return null;
  }

  const softCap = maxPlatedSlotKcal(breakdown, daily);
  if (entry.type === 'Хранене 2' || entry.type === 'Хранене 4') {
    const mains = breakdown.filter(m => m.type === 'Хранене 2' || m.type === 'Хранене 4');
    const fixed = breakdown
      .filter(m => BUDGET_SLOT_TYPES.has(m.type) || m.type === 'Хранене 5' || m.type === 'Хранене 3')
      .reduce((s, m) => s + (Number(m.calories) || 0), 0);
    const fair = mains.length ? Math.ceil(Math.max(0, daily - fixed) / mains.length) : softCap;
    const target = Math.max(softCap, fair);
    if (cal <= target + slotCalorieTolerance(target) + 10) return null;
    return `${entry.type} ${cal} kcal > ${target}`;
  }

  if (cal <= softCap) return null;
  return `${entry.type} ${cal} kcal > ${softCap}`;
}
