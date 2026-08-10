/**
 * Full plan adequacy analysis — all validator dimensions + review metrics.
 */
import { validateAnalysis } from './validators/analysis.mjs';
import { validateStrategy, validateMealPlan } from './validators/plan.mjs';
import { validateFrontendProjection } from './validators/frontend.mjs';
import {
  validateWeekPlanNutrition,
  validateMealMacroArithmetic,
  validateMealGramsAndWeight,
  validateMealMacrosFromGrams,
} from './validators/nutrition.mjs';
import { validateWeekPlanFoods } from './validators/foods.mjs';
import { validateWeekPlanCombinations } from './validators/combinations.mjs';
import { validateProfileRules } from './validators/profile-rules.mjs';
import { validateDietetic } from './validators/dietetic.mjs';
import { parseMealDescription } from '../../food-nutrition.js';
import { calorieTolerance } from '../../food-nutrition.js';

const CATALOG_GROUPS = new Set(['зеленчук', 'плод', 'риба', 'ядки', 'червено месо']);

function num(v) {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const m = v.match(/\d+/);
    return m ? parseInt(m[0], 10) : NaN;
  }
  return NaN;
}

function normalizeMealName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Worker-aligned monotony check (warning tier). */
export function analyzeMealDiversity(weekPlan) {
  const counts = new Map();
  for (let d = 1; d <= 7; d++) {
    for (const meal of weekPlan?.[`day${d}`]?.meals || []) {
      if (!meal.name || meal.type === 'Свободно хранене') continue;
      const key = normalizeMealName(meal.name);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const repeated = [...counts.entries()].filter(([, n]) => n > 1);
  const overLimit = [...counts.entries()].filter(([, n]) => n > 5);
  return {
    uniqueDishes: counts.size,
    repeatedCount: repeated.length,
    overLimitCount: overLimit.length,
    topRepeats: repeated.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${n}×${c}`),
    issues: overLimit.length
      ? [`>${5} повторения: ${overLimit.map(([n, c]) => `${n}×${c}`).join(', ')}`]
      : [],
  };
}

/** Catalog generic usage — review metric for prompt change. */
export function analyzeCatalogGenerics(weekPlan) {
  let totalItems = 0;
  let genericItems = 0;
  const specifics = [];
  for (let d = 1; d <= 7; d++) {
    for (const meal of weekPlan?.[`day${d}`]?.meals || []) {
      if (meal.type === 'Свободно хранене') continue;
      for (const item of parseMealDescription(meal.description || '')) {
        totalItems++;
        const n = item.name.toLowerCase();
        if (CATALOG_GROUPS.has(n)) genericItems++;
        else if (/броколи|домат|пилешки|говежди|сьомга|ябълка|банан|бадем/.test(n)) {
          specifics.push(item.name);
        }
      }
    }
  }
  return {
    totalItems,
    genericItems,
    genericPct: totalItems ? Math.round((genericItems / totalItems) * 100) : 0,
    sampleSpecifics: [...new Set(specifics)].slice(0, 8),
  };
}

/** Daily achieved kcal vs analysis target. */
export function analyzeDailyIntake(plan) {
  const issues = [];
  const metrics = [];
  const target = num(plan.analysis?.Final_Calories);
  if (!target) return { issues: ['Final_Calories липсва'], metrics: [] };

  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (let d = 1; d <= 7; d++) {
    const day = plan.weekPlan?.[`day${d}`];
    const scheme = plan.strategy?.weeklyScheme?.[dayKeys[d - 1]];
    let dayKcal = num(day?.dailyTotals?.calories);
    if (!dayKcal && day?.meals) {
      dayKcal = day.meals.reduce((s, m) => {
        if (m.type === 'Свободно хранене') {
          const free = scheme?.mealBreakdown?.find(x => x.type === 'Свободно хранене' || x.type === 'Хранене 2');
          return s + (num(free?.calories) || 0);
        }
        return s + (num(m.calories) || 0);
      }, 0);
    }
    const tol = calorieTolerance(target);
    const diff = Math.abs(dayKcal - target);
    metrics.push({ day: d, kcal: dayKcal, target, diff });
    if (dayKcal > 0 && diff > tol * 2) {
      issues.push(`day${d}: дневни ${dayKcal} kcal vs цел ${target} (±${tol})`);
    }
  }
  return { issues, metrics };
}

function validateSummary(plan) {
  const issues = [];
  const rec = plan.recommendations?.length ? plan.recommendations : plan.summary?.recommendations;
  const sup = plan.supplements?.length ? plan.supplements : plan.summary?.supplements;
  const psych = plan.summary?.psychology || plan.psychology;
  if (!rec?.length) issues.push('recommendations липсва');
  if (!sup?.length) issues.push('supplements липсва');
  if (!psych?.length && !plan.summary?.psychology?.length) {
    issues.push('psychology/summary psychology липсва');
  }
  return issues;
}

/** Slot type alignment: weekPlan meals vs strategy mealBreakdown. */
export function analyzeSlotAlignment(plan) {
  const issues = [];
  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (let d = 1; d <= 7; d++) {
    const expected = (plan.strategy?.weeklyScheme?.[dayKeys[d - 1]]?.mealBreakdown || []).map(m => m.type);
    const actual = (plan.weekPlan?.[`day${d}`]?.meals || []).map(m => m.type);
    if (!expected.length || !actual.length) continue;
    if (expected.join('|') !== actual.join('|')) {
      issues.push(`day${d}: slots [${actual.join(',')}] ≠ scheme [${expected.join(',')}]`);
    }
  }
  return issues;
}

/**
 * @returns {{ issues: string[], byCategory: Record<string, string[]>, metrics: object, pass: boolean }}
 */
export function analyzePlanFull(plan, profile) {
  const byCategory = {
    analysis: validateAnalysis(plan.analysis, profile),
    strategy: validateStrategy(plan.strategy),
    structure: validateMealPlan(plan.weekPlan, plan.strategy),
    slotAlignment: analyzeSlotAlignment(plan),
    nutrition: validateWeekPlanNutrition(plan.weekPlan, plan.strategy),
    foods: validateWeekPlanFoods(plan.weekPlan),
    combinations: validateWeekPlanCombinations(plan.weekPlan),
    frontend: validateFrontendProjection(plan),
    profile: validateProfileRules(plan, profile),
    dietetic: validateDietetic(plan, profile),
    summary: validateSummary(plan),
  };

  const diversity = analyzeMealDiversity(plan.weekPlan);
  byCategory.diversity = diversity.issues;

  const intake = analyzeDailyIntake(plan);
  byCategory.intake = intake.issues;

  const generics = analyzeCatalogGenerics(plan.weekPlan);

  const all = [...new Set(Object.values(byCategory).flat())];
  return {
    issues: all,
    byCategory,
    metrics: {
      diversity,
      generics,
      intake: intake.metrics,
      generationWarnings: plan.generationWarnings?.length || 0,
      includeDessert: plan.strategy?.includeDessert,
      freeDayNumber: plan.strategy?.freeDayNumber,
      finalCalories: plan.analysis?.Final_Calories,
      mealsPerDay: plan.strategy?.weeklyScheme?.monday?.mealBreakdown?.length,
    },
    pass: all.length === 0,
  };
}

export const ADEQUACY_CATEGORIES = [
  'analysis', 'strategy', 'structure', 'slotAlignment', 'nutrition',
  'foods', 'combinations', 'frontend', 'profile', 'dietetic',
  'summary', 'diversity', 'intake',
];
