/**
 * Mirrors frontend projection logic from guidelines.html and analysis.html
 */
import { MIN_HEALTH_SCORE, MAX_HEALTH_SCORE } from '../constants.mjs';

function parseNumericValue(value) {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const m = value.match(/[\d.]+/);
    return m ? parseFloat(m[0]) : 0;
  }
  return 0;
}

/** Same logic as guidelines.html loadMacrosVisualization */
export function projectMacrosViz(plan) {
  const analysis = plan?.analysis;
  const summary = plan?.summary || {};
  let dailyCalories = 0;
  let protein = 0, carbs = 0, fats = 0;

  if (analysis) {
    if (analysis.Final_Calories) dailyCalories = parseNumericValue(analysis.Final_Calories);
    if (!dailyCalories && analysis.correctedMetabolism?.realTDEE) {
      dailyCalories = parseNumericValue(analysis.correctedMetabolism.realTDEE);
    }
    if (analysis.macroGrams) {
      protein = parseNumericValue(analysis.macroGrams.protein);
      carbs = parseNumericValue(analysis.macroGrams.carbs);
      fats = parseNumericValue(analysis.macroGrams.fats);
    }
  }

  if (!dailyCalories && summary.dailyCalories) dailyCalories = parseNumericValue(summary.dailyCalories);
  if (protein === 0 && carbs === 0 && fats === 0 && summary.macros) {
    protein = parseNumericValue(summary.macros.protein);
    carbs = parseNumericValue(summary.macros.carbs);
    fats = parseNumericValue(summary.macros.fats);
  }

  const usedFallback = protein === 0 && carbs === 0 && fats === 0 && dailyCalories > 0;
  if (usedFallback) {
    protein = Math.round((dailyCalories * 0.25) / 4);
    carbs = Math.round((dailyCalories * 0.50) / 4);
    fats = Math.round((dailyCalories * 0.25) / 9);
  }

  const totalMacroCalories = protein * 4 + carbs * 4 + fats * 9;
  const proteinPercent = totalMacroCalories > 0 ? Math.round((protein * 4 / totalMacroCalories) * 100) : 0;
  const carbsPercent = totalMacroCalories > 0 ? Math.round((carbs * 4 / totalMacroCalories) * 100) : 0;
  const fatsPercent = totalMacroCalories > 0 ? Math.round((fats * 9 / totalMacroCalories) * 100) : 0;

  return {
    dailyCalories, protein, carbs, fats,
    proteinPercent, carbsPercent, fatsPercent,
    usedFallback,
    totalMacroCalories,
  };
}

/** Same logic as analysis.html calculateOverallScores (health branch) */
export function projectHealthScore(plan) {
  const analysis = plan?.analysis;
  const problems = analysis?.keyProblems || [];

  let healthScore;
  let source;
  if (analysis?.currentHealthStatus && typeof analysis.currentHealthStatus.score === 'number') {
    healthScore = Math.max(MIN_HEALTH_SCORE, Math.min(MAX_HEALTH_SCORE, Math.round(analysis.currentHealthStatus.score)));
    source = 'currentHealthStatus';
  } else {
    let totalSeverity = 0;
    let maxSeverity = 0;
    for (const p of problems) {
      const sv = p.severityValue || 50;
      totalSeverity += sv;
      if (sv > maxSeverity) maxSeverity = sv;
    }
    const avgSeverity = problems.length ? totalSeverity / problems.length : 50;
    const combined = maxSeverity * 0.6 + avgSeverity * 0.4;
    const raw = MAX_HEALTH_SCORE - Math.min(combined, MAX_HEALTH_SCORE);
    healthScore = Math.max(MIN_HEALTH_SCORE, Math.round(raw));
    healthScore = Math.max(MIN_HEALTH_SCORE, healthScore - Math.floor(healthScore * 0.10));
    source = 'fallback';
  }

  let label;
  if (healthScore < 25) label = 'Влошено';
  else if (healthScore < 50) label = 'Нуждае се от внимание';
  else if (healthScore < 75) label = 'Умерено';
  else label = 'Добро';

  return {
    healthScore,
    label,
    source,
    description: analysis?.currentHealthStatus?.description || '',
  };
}

export function validateFrontendProjection(plan) {
  const issues = [];
  const macros = projectMacrosViz(plan);
  const health = projectHealthScore(plan);

  if (macros.dailyCalories < 1200 || macros.dailyCalories > 4500) {
    issues.push(`macrosViz: нереалистични калории ${macros.dailyCalories}`);
  }
  if (macros.protein < 50 || macros.protein > 300) {
    issues.push(`macrosViz: нереалистичен протеин ${macros.protein}g`);
  }
  if (macros.usedFallback) {
    issues.push('macrosViz: използва fallback 25/50/25 — macroGrams липсват или са 0');
  }
  if (macros.dailyCalories > 0) {
    const diff = Math.abs(macros.totalMacroCalories - macros.dailyCalories);
    if (diff > 30) {
      issues.push(`macrosViz: макро калории ${macros.totalMacroCalories} != дневни ${macros.dailyCalories}`);
    }
  }
  const pctSum = macros.proteinPercent + macros.carbsPercent + macros.fatsPercent;
  if (pctSum < 95 || pctSum > 105) {
    issues.push(`macrosViz: проценти ${pctSum}% (очаквано ~100)`);
  }

  if (health.healthScore < 25 && health.source === 'currentHealthStatus') {
    if (!health.description || health.description.length < 30) {
      issues.push('single-score: нисък score без смислено description');
    }
  }
  if (health.healthScore >= 50 && /влошен|критичн|много лош/i.test(health.description)) {
    issues.push('single-score: description противоречи на score');
  }

  return issues;
}
