/**
 * Step 1 deterministic energy contract — backend authority for kcal/macros.
 * AI keeps narrative (keyProblems, psychology); bounded clinical/metabolic
 * review adjusts intake on top of the backend baseline (never replaces TDEE).
 */

/** Default on — set DETERMINISTIC_STEP1=0 to let AI propose Final_Calories/macros. */
export function deterministicStep1Enabled(env = {}) {
  const v = env?.DETERMINISTIC_STEP1;
  if (v === '0' || v === 'false' || v === false) return false;
  return true;
}

/** Default on — set METABOLIC_REVIEW=0 to skip bounded AI/structured intake review. */
export function metabolicReviewEnabled(env = {}) {
  const v = env?.METABOLIC_REVIEW;
  if (v === '0' || v === 'false' || v === false) return false;
  return true;
}

/** Per-axis bounds (physiological guardrails for reviewer adjustments). */
export const METABOLIC_REVIEW_BOUNDS = {
  clinical: { min: -12, max: 5 },
  metabolic: { min: -8, max: 5 },
};

function goalIncludes(goal, keyword) {
  if (!goal || !keyword) return false;
  const kw = String(keyword).toLowerCase();
  if (Array.isArray(goal)) return goal.some(g => String(g).toLowerCase().includes(kw));
  return String(goal).toLowerCase().includes(kw);
}

/** Round to one decimal and clamp to inclusive [min, max]. */
export function clampPercent(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n * 10) / 10;
  return Math.max(min, Math.min(max, rounded));
}

/**
 * Combined intake adjustment cap — depends on goal/clinical context.
 * Backend already encodes goal deficit/surplus; review only fine-tunes.
 */
export function combinedReviewBounds(ctx = {}) {
  if (ctx.isLactation) return { min: -5, max: 8 };
  if (goalIncludes(ctx.goal, 'Мускулна маса')) return { min: -10, max: 5 };
  return { min: -15, max: 8 };
}

/**
 * Merge AI review % with structured clinical signals.
 * When structured suggests downward correction, take the more conservative value.
 */
export function mergeAdjustmentPercent(aiValue, structuredValue) {
  const ai = Number(aiValue) || 0;
  const st = Number(structuredValue) || 0;
  if (st < 0) return Math.min(ai, st);
  if (st > 0) return Math.max(ai, st);
  return ai;
}

/**
 * Deterministic clinical/metabolic hints from structured profile fields only.
 * Catches obvious physiology the regex pipeline cannot infer from free text alone.
 * @returns {{ clinical: number, metabolic: number }}
 */
export function deriveStructuredMetabolicHints(data = {}) {
  const blob = [
    ...(Array.isArray(data.medicalConditions) ? data.medicalConditions : []),
    data['medicalConditions_Ендокринни_детайл'] || '',
    data['medicalConditions_Метаболитни_детайл'] || '',
    ...(Array.isArray(data.medications) ? data.medications : []),
  ].join(' ').toLowerCase();

  let clinical = 0;
  let metabolic = 0;

  if (/хипотирео|hypothyroid|щитовидн.*(недост|ниска|hypo)/i.test(blob)) {
    clinical = Math.min(clinical, -5);
  }
  if (/хипертирео|hyperthyroid|щитовидн.*(висок|hyper)/i.test(blob)) {
    clinical = Math.max(clinical, 3);
  }

  const sleep = Number(data.sleepHours);
  if (sleep > 0 && sleep < 6) metabolic = Math.min(metabolic, sleep < 5 ? -5 : -3);

  const stress = String(data.stressLevel || '').toLowerCase();
  if (/много висок|висок|high|severe/i.test(stress)) {
    metabolic = Math.min(metabolic, -2);
  }

  return { clinical, metabolic };
}

/**
 * Compute bounded total intake review % from AI + structured signals.
 * goalAdjustmentPercent is ignored — backend already applied goal deficit/surplus.
 * @param {object} cm correctedMetabolism from Step 1 AI
 * @param {object} ctx { goal, isLactation }
 */
export function computeBoundedReviewPercent(cm = {}, ctx = {}, structured = {}) {
  const { clinical: cBounds, metabolic: mBounds } = METABOLIC_REVIEW_BOUNDS;
  const combined = combinedReviewBounds(ctx);

  const aiClinical = clampPercent(cm.clinicalAdjustmentPercent, cBounds.min, cBounds.max);
  const aiMetabolic = clampPercent(cm.metabolicAdjustmentPercent, mBounds.min, mBounds.max);

  const clinical = clampPercent(
    mergeAdjustmentPercent(aiClinical, structured.clinical),
    cBounds.min,
    cBounds.max,
  );
  const metabolic = clampPercent(
    mergeAdjustmentPercent(aiMetabolic, structured.metabolic),
    mBounds.min,
    mBounds.max,
  );

  let total = clinical + metabolic;
  if (ctx.isLactation && goalIncludes(ctx.goal, 'Отслабване') && total < -5) {
    total = -5;
  }
  return {
    clinical,
    metabolic,
    total: clampPercent(total, combined.min, combined.max),
    goalIgnored: true,
  };
}

/**
 * Apply bounded metabolic review on top of deterministic baseline intake.
 * TDEE/BMR stay at backend values; only Final_Calories + macroGrams shift.
 * @param {object} analysis
 * @param {{ userData?: object, minFatG?: number, enabled?: boolean }} [options]
 */
export function applyBoundedMetabolicReview(analysis, options = {}) {
  if (!analysis?._deterministicEnergy || options.enabled === false) return analysis;

  const userData = options.userData || {};
  const cm = analysis.correctedMetabolism || (analysis.correctedMetabolism = {});
  const baseline = Math.round(Number(analysis.Final_Calories) || 0);
  if (baseline <= 0) return analysis;

  const structured = deriveStructuredMetabolicHints(userData);
  const review = computeBoundedReviewPercent(cm, {
    goal: userData.goal,
    isLactation: userData.clinicalProtocol === 'postpartum_lactation',
  }, structured);

  cm.clinicalAdjustmentPercent = review.clinical;
  cm.metabolicAdjustmentPercent = review.metabolic;
  if (review.goalIgnored) {
    cm._goalAdjustmentIgnored = true;
    if (Number(cm.goalAdjustmentPercent)) {
      cm._aiGoalAdjustmentPercent = cm.goalAdjustmentPercent;
    }
    cm.goalAdjustmentPercent = 0;
  }

  if (review.total === 0) {
    cm.appliedReviewPercent = 0;
    cm.baselineIntake = baseline;
    cm.reviewSource = structured.clinical || structured.metabolic
      ? 'structured_only_zero_net'
      : 'deterministic_baseline';
    return analysis;
  }

  const adjusted = Math.round(baseline * (1 + review.total / 100));
  analysis.Final_Calories = adjusted;
  analysis.recommendedCalories = adjusted;

  if (analysis.macroRatios) {
    analysis.macroGrams = macroGramsFromIntake(
      adjusted,
      analysis.macroRatios,
      options.minFatG || 0,
    );
  }

  cm.appliedReviewPercent = review.total;
  cm.baselineIntake = baseline;
  cm.reviewSource = 'bounded_metabolic_review';
  cm.correctionPercent = `${review.total >= 0 ? '+' : ''}${review.total}%`;
  const parts = [];
  if (review.clinical) parts.push(`клинично ${review.clinical}%`);
  if (review.metabolic) parts.push(`метаболично ${review.metabolic}%`);
  cm.correction = `Корекция върху backend baseline (${baseline} kcal): ${parts.join(', ')}.`;

  return analysis;
}

/** Intake target from maintenance TDEE + goal (loss / gain / maintain). */
export function computeIntakeTarget(tdee, goal, deficitData = {}) {
  const maintenance = Math.round(Number(tdee) || 0);
  if (!maintenance) return 0;

  if (goalIncludes(goal, 'Мускулна маса')) {
    return Math.round(maintenance * 1.1);
  }
  if (goalIncludes(goal, 'Отслабване')) {
    const target = Number(deficitData.targetCalories);
    return target > 0 ? Math.round(target) : Math.round(maintenance * 0.82);
  }
  return maintenance;
}

export function macroGramsFromIntake(intake, ratios, minFatG = 0) {
  const fc = Math.round(Number(intake) || 0);
  const r = ratios || {};
  if (fc <= 0) return { protein: 0, carbs: 0, fats: 0 };

  let proteinG = Math.round(fc * (Number(r.protein) || 0) / 100 / 4);
  let fatsG = Math.round(fc * (Number(r.fats) || 0) / 100 / 9);
  let carbsG = Math.max(0, Math.round((fc - proteinG * 4 - fatsG * 9) / 4));

  if (minFatG > 0 && fatsG < minFatG) {
    fatsG = minFatG;
    carbsG = Math.max(0, Math.round((fc - proteinG * 4 - fatsG * 9) / 4));
  }

  return { protein: proteinG, carbs: carbsG, fats: fatsG };
}

/**
 * Build backend energy contract from worker pre-calculations.
 * @param {{ bmr?: number, tdee?: number, deficitData?: object, macros?: object, activityData?: object, goal?: string|string[], minFatG?: number }} [inputs]
 */
export function buildEnergyContract(inputs = {}) {
  const bmr = Math.round(Number(inputs.bmr) || 0);
  const tdee = Math.round(Number(inputs.tdee) || 0);
  const macros = inputs.macros || {};
  const intake = computeIntakeTarget(tdee, inputs.goal, inputs.deficitData);
  const macroRatios = {
    protein: Number(macros.protein) || 0,
    carbs: Number(macros.carbs) || 0,
    fats: Number(macros.fats) || 0,
  };
  const macroGrams = macroGramsFromIntake(intake, macroRatios, inputs.minFatG || 0);

  return {
    bmr,
    tdee,
    Final_Calories: intake,
    recommendedCalories: intake,
    macroRatios,
    macroGrams,
    activityLevel: inputs.activityData?.activityLevel || '',
    correctedMetabolism: {
      realBMR: bmr,
      realTDEE: tdee,
    },
  };
}

/** Overlay deterministic numbers onto AI analysis — preserves narrative fields. */
export function applyDeterministicEnergyContract(analysis, contract) {
  if (!analysis || !contract) return analysis;

  analysis.bmr = contract.bmr;
  analysis.tdee = contract.tdee;
  analysis.Final_Calories = contract.Final_Calories;
  analysis.recommendedCalories = contract.recommendedCalories;
  analysis.macroRatios = { ...contract.macroRatios };
  analysis.macroGrams = { ...contract.macroGrams };

  if (contract.activityLevel) {
    analysis.activityLevel = contract.activityLevel;
  }

  const cm = analysis.correctedMetabolism || (analysis.correctedMetabolism = {});
  if (contract.correctedMetabolism?.realBMR) cm.realBMR = contract.correctedMetabolism.realBMR;
  if (contract.correctedMetabolism?.realTDEE) cm.realTDEE = contract.correctedMetabolism.realTDEE;

  analysis._deterministicEnergy = true;
  return analysis;
}
