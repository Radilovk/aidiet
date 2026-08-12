/**
 * Step 1 deterministic energy contract — backend authority for kcal/macros.
 * AI keeps narrative (keyProblems, psychology); numbers come from BMR/TDEE pipeline.
 */

/** Default on — set DETERMINISTIC_STEP1=0 to let AI propose Final_Calories/macros. */
export function deterministicStep1Enabled(env = {}) {
  const v = env?.DETERMINISTIC_STEP1;
  if (v === '0' || v === 'false' || v === false) return false;
  return true;
}

function goalIncludes(goal, keyword) {
  if (!goal || !keyword) return false;
  const kw = String(keyword).toLowerCase();
  if (Array.isArray(goal)) return goal.some(g => String(g).toLowerCase().includes(kw));
  return String(goal).toLowerCase().includes(kw);
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
