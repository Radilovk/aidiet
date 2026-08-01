/**
 * Dietetic / clinical adequacy — physiologically justified diet logic.
 * Priority #2 after nutrition math (calories, grams, macros).
 */
import { parseMealDescription } from '../../../food-nutrition.js';
import { validateProductNamesAgainstProtocol } from '../../../food-catalog.js';
import { minCaloriesForGender, minFatGrams } from '../fixtures/profiles.mjs';
import { userSkipsBreakfast, hasSweetCraving } from './profile-rules.mjs';
import { isKetoCarbCompliant } from '../../../plan-normalize.js';

const ANIMAL_PATTERNS = [
  /пилеш|говежд|свинск|телеш|агнеш|пуеш|риба|сьомга|скумри|треска|тон|скарид|миди/,
  /мляко|млечн|сирен|кашкавал|извара|скир|йогурт|кефир|суроватка|яйц|омлет/,
];
const HIGH_GI_SNACK_PATTERNS = [/бял хляб|бял ориз|захар|мед|сироп|бисквит|кроасан|торта|шоколад/];
const AIP_FORBIDDEN_IN_TEXT = [/домат|чушка|патладжан|картоф|яйц|овес|ориз|хляб|боб|леща|нахут|тофу|бадем|орех|кашу|мляко|сирен/];

function goalText(profile) {
  const g = profile?.goal;
  if (Array.isArray(g)) return g.join(' ').toLowerCase();
  return String(g || '').toLowerCase();
}

function isVeganProfile(profile) {
  const prefs = profile?.dietPreference;
  if (Array.isArray(prefs)) return prefs.some(p => /веган/i.test(p));
  return /веган/i.test(String(prefs || ''));
}

function isKetoProfile(profile) {
  const prefs = profile?.dietPreference;
  if (Array.isArray(prefs)) return prefs.some(p => /кето|нисковъглехидрат/i.test(p));
  return /кето|нисковъглехидрат/i.test(String(prefs || ''));
}

function num(v) {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const m = v.match(/\d+/);
    return m ? parseInt(m[0], 10) : NaN;
  }
  return NaN;
}

/** Analysis-level dietetic rules (calorie philosophy, macro ratios). */
export function validateAnalysisDietetic(analysis, profile = {}) {
  const issues = [];
  if (!analysis) return issues;

  const fc = num(analysis.Final_Calories);
  const mg = analysis.macroGrams;
  const weight = parseFloat(profile.weight) || 70;
  const minCal = minCaloriesForGender(profile.gender || 'Жена');

  if (profile.clinicalProtocol === 'postpartum_lactation' && fc > 0) {
    const lactationFloor = minCal + 300;
    if (fc < lactationFloor) {
      issues.push(`лактация: Final_Calories ${fc} < ${lactationFloor} (минимум + енергия за кърмене)`);
    }
    const tdee = num(analysis.tdee) || num(analysis.correctedMetabolism?.realTDEE);
    if (tdee > 0 && fc < tdee * 0.9) {
      issues.push(`лактация: агресивен дефицит ${fc} при TDEE ~${tdee}`);
    }
  }

  if (goalText(profile).includes('мускул') && mg?.protein) {
    const minProtein = Math.round(weight * 1.4);
    if (mg.protein < minProtein) {
      issues.push(`мускулна маса: протеин ${mg.protein}g < ${minProtein}g (1.4g/kg)`);
    }
  }

  if (isKetoProfile(profile) && fc > 0 && mg) {
    if (!isKetoCarbCompliant(fc, mg.carbs)) {
      const carbPct = Math.round(((mg.carbs || 0) * 4 / fc) * 100);
      issues.push(`кето: въглехидрати ${carbPct}% > 15% от калориите`);
    }
  }

  const conditions = (profile.medicalConditions || []).join(' ').toLowerCase();
  const hasDiabetes = /диабет|инсулинова резистентност/i.test(conditions)
    || profile.clinicalProtocol === 'insulin_resistance';
  if (hasDiabetes && fc > 0 && mg) {
    const carbKcal = (mg.carbs || 0) * 4;
    const carbPct = (carbKcal / fc) * 100;
    if (carbPct > 45) {
      issues.push(`диабет/IR: въглехидрати ${Math.round(carbPct)}% > 45%`);
    }
  }

  if (mg?.fats && mg.fats < minFatGrams(weight)) {
    issues.push(`мазнини ${mg.fats}g под физиологичен минимум ${minFatGrams(weight)}g`);
  }

  return issues;
}

/** Week-plan dietetic rules — slot logic, clinical protocol, diet preference. */
export function validateWeekPlanDietetic(weekPlan, strategy, profile = {}) {
  const issues = [];
  if (!weekPlan) return issues;

  const protocolId = profile.clinicalProtocol || null;

  for (let d = 1; d <= 7; d++) {
    const day = weekPlan[`day${d}`];
    if (!day?.meals) continue;

    if (userSkipsBreakfast(profile)) {
      if (day.meals.some(m => m.type === 'Хранене 1')) {
        issues.push(`day${d}: Хранене 1 при „Не закусвам“ — нарушава хранителния ритъм`);
      }
    }

    for (const meal of day.meals) {
      const text = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();

      if (isVeganProfile(profile)) {
        if (ANIMAL_PATTERNS.some(p => p.test(text))) {
          issues.push(`day${d} ${meal.type}: животински продукт при веган профил`);
        }
      }

      if (protocolId === 'autoimmune_aip') {
        const names = parseMealDescription(meal.description || '').map(i => i.name);
        const forbidden = validateProductNamesAgainstProtocol(names, protocolId);
        if (forbidden.length) {
          issues.push(`day${d} ${meal.type}: AIP забранени — ${forbidden.slice(0, 3).join(', ')}`);
        }
      }

      if (meal.type === 'Хранене 3') {
        if (HIGH_GI_SNACK_PATTERNS.some(p => p.test(text))) {
          issues.push(`day${d} H3: висок ГИ snack (${meal.name})`);
        }
        if (/пилеш|говежд|риба|ориз|паста|хляб/.test(text)) {
          issues.push(`day${d} H3: основно ястие в snack slot`);
        }
      }

      if (meal.type === 'Хранене 5') {
        if (/ориз|хляб|паста|картоф|банан|ябълка|мед|захар/.test(text)) {
          issues.push(`day${d} H5: въглехидрат/плод в късна закуска`);
        }
      }

      const hasCraving = hasSweetCraving(profile);
      if (meal.dessert && !hasCraving && strategy?.includeDessert !== true) {
        issues.push(`day${d} ${meal.type}: dessert без медицинска/профилна индикация`);
      }

      if (/диабет|инсулинова резистентност/i.test((profile.medicalConditions || []).join(' '))) {
        if (meal.type === 'Хранене 2' && meal.dessert && hasCraving) {
          if (/ориз|картоф|хляб|паста/.test(text)) {
            issues.push(`day${d} обяд: десерт + нишестени — лош ГИ профил при диабет`);
          }
        }
      }
    }
  }

  if (isKetoProfile(profile) && strategy?.weeklyScheme) {
    for (const [dayKey, dayScheme] of Object.entries(strategy.weeklyScheme)) {
      const daily = num(dayScheme.calories) || 0;
      const carbs = num(dayScheme.carbs) || 0;
      if (daily > 0 && !isKetoCarbCompliant(daily, carbs)) {
        issues.push(`${dayKey}: схема въглехидрати ${Math.round(carbs * 4 / daily * 100)}% > 15% при кето`);
      }
    }
  }

  return issues;
}

/** Full-plan dietetic validation (analysis + week plan). */
export function validateDietetic(plan, profile = {}) {
  return [
    ...validateAnalysisDietetic(plan?.analysis, profile),
    ...validateWeekPlanDietetic(plan?.weekPlan, plan?.strategy, profile),
  ];
}
