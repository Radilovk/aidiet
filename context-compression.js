/**
 * NutriPlan Context Format (NPCF) — domain-specific token compression
 * for AI plan generation prompts. Lossless for medical/clinical fields.
 *
 * Tiers:
 *   full     — Step 1 analysis (all questionnaire fields, deduped vs notes sections)
 *   strategy — Step 2 (behavior + diet + medical summary)
 *   meal     — Step 3 chunks (minimal profile fields)
 *   summary  — Step 4 (identity + goal + health flags)
 */

/** @typedef {'full'|'strategy'|'meal'|'summary'} ProfileTier */

const NP_LEGEND = '#NP v1 | U=идентичност L=начин_на_живот B=история H=навици D=диета M=медицина CP=протокол';

const METADATA_KEYS = new Set([
  '_dq_text_map', 'files', 'plan', 'planStatus', 'planModifications',
  'userId', 'clientId', 'timestamp', 'id', 'email',
]);

const CONDITION_DETAIL_KEYS = new Set([
  'medicalConditions_Сърдечно-съдови_детайл',
  'medicalConditions_Ендокринни_детайл',
  'medicalConditions_Храносмилателни_детайл',
  'medicalConditions_Метаболитни_детайл',
  'medicalConditions_Мускулно-скелетни_детайл',
  'medicalConditions_Алергии',
  'medicalConditions_Автоимунно',
]);

const PROTOCOL_FIELD_IDS = new Set([
  'bloodSugarLevels', 'insulinResistanceSymptoms', 'familyDiabetes',
  'autoimmuneDiagnosis', 'autoimmuneFlares', 'foodSensitivities', 'triggerFoods',
  'giSymptoms', 'bowelFrequency', 'giTriggers',
  'menopauseStatus', 'menopauseSymptoms', 'strengthTraining',
  'celluliteAreas', 'waterRetention', 'sedentaryHours',
  'stressSources', 'stressSymptoms', 'relaxationPractices',
  'postpartumStatus', 'breastfeedingFrequency', 'postpartumGoal',
  'waistCircumference', 'fatDistribution', 'metabolicSyndrome',
  'smokingHistory', 'quitDuration', 'cravingsTriggers', 'weightGainConcern',
  'fastingExperience', 'longevityGoals', 'currentSupplements', 'longevitySupplDetails',
  'detoxReason', 'toxinExposure', 'liverSymptoms',
]);

const MEAL_TYPE_SHORT = {
  'Хранене 1': 'H1',
  'Хранене 2': 'H2',
  'Хранене 3': 'H3',
  'Хранене 4': 'H4',
  'Хранене 5': 'H5',
  'Свободно хранене': 'SF',
};

const DAY_KEY_SHORT = {
  monday: 'пн', tuesday: 'вт', wednesday: 'ср', thursday: 'чт',
  friday: 'пт', saturday: 'сб', sunday: 'нд',
};

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasContent(value) {
  if (value == null || value === '') return false;
  if (typeof value === 'string' || Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function esc(value) {
  if (value == null || value === '') return '';
  const s = Array.isArray(value) ? value.filter(Boolean).join('+') : String(value).trim();
  return s.replace(/\|/g, '/').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
}

/**
 * @param {Record<string, unknown>} data
 * @param {{ excludeAggregatedNotes?: boolean, excludeClinicalProtocol?: boolean }} opts
 */
function getExcludedKeys(data, opts = {}) {
  const excluded = new Set(METADATA_KEYS);
  if (opts.excludeAggregatedNotes) {
    excluded.add('additionalNotes');
    for (const key of CONDITION_DETAIL_KEYS) excluded.add(key);
    for (const key of PROTOCOL_FIELD_IDS) excluded.add(key);
    for (const key of Object.keys(data)) {
      if (key.startsWith('dq_')) excluded.add(key);
    }
  }
  if (opts.excludeClinicalProtocol) {
    excluded.add('clinicalProtocol');
    excluded.add('clinicalProtocolName');
  }
  return excluded;
}

/**
 * Serialize user profile for plan generation prompts.
 * @param {Record<string, unknown>} data
 * @param {ProfileTier} tier
 * @param {{ hasNotesSection?: boolean, hasClinicalSection?: boolean }} [options]
 * @returns {string}
 */
export function serializeUserProfile(data, tier = 'full', options = {}) {
  if (!data || typeof data !== 'object') return '';

  const excludeOpts = {
    excludeAggregatedNotes: tier === 'full' && !!options.hasNotesSection,
    excludeClinicalProtocol: tier === 'full' && !!options.hasClinicalSection,
  };
  const excluded = getExcludedKeys(data, excludeOpts);

  if (tier === 'meal') {
    const lines = [
      `${NP_LEGEND} tier=meal`,
      `U|${esc(data.name)}|${esc(data.age)}|${esc(data.gender?.[0] || data.gender)}|${esc(data.goal)}`,
      `L|sleep=${esc(data.sleepHours)}|chr=${esc(data.chronotype)}|str=${esc(data.stressLevel)}`,
      `D|love=${esc(data.dietLove)}|avoid=${esc(data.dietDislike)}`,
      `M|${esc(data.medicalConditions)}|meds=${esc(data.medications === 'Да' ? data.medicationsDetails || 'Да' : 'Не')}`,
    ];
    return lines.filter(l => !l.endsWith('=') && !l.endsWith('|')).join('\n');
  }

  if (tier === 'summary') {
    return [
      `${NP_LEGEND} tier=summary`,
      `U|${esc(data.name)}|${esc(data.age)}|${esc(data.gender)}|${esc(data.goal)}`,
      `M|${esc(data.medicalConditions)}|meds=${esc(data.medications === 'Да' ? data.medicationsDetails || 'Да' : 'не')}`,
      `L|str=${esc(data.stressLevel)}|sleep=${esc(data.sleepHours || data.sleepDuration)}|act=${esc(data.sportActivity || data.dailyActivityLevel)}`,
    ].join('\n');
  }

  if (tier === 'strategy') {
    return [
      `${NP_LEGEND} tier=strategy`,
      `U|${esc(data.name)}|${esc(data.age)}|${esc(data.gender)}|${esc(data.weight)}|${esc(data.height)}|${esc(data.goal)}|${esc(data.lossKg)}kg`,
      `L|sleep=${esc(data.sleepHours)}|intr=${esc(data.sleepInterrupt)}|chr=${esc(data.chronotype)}|act=${esc(data.dailyActivityLevel)}|str=${esc(data.stressLevel)}|sport=${esc(data.sportActivity)}|water=${esc(data.waterIntake)}|sweet=${esc(data.drinksSweet)}|alc=${esc(data.drinksAlcohol)}`,
      `B|wgChg=${esc(data.weightChange)}|wgDet=${esc(data.weightChangeDetails)}|dHist=${esc(data.dietHistory)}|dType=${esc(data.dietType || data.dietHistoryType)}|dRes=${esc(data.dietResult || data.dietHistoryResult)}|ovr=${esc(data.overeatingFrequency)}`,
      `H|hab=${esc(data.eatingHabits)}|crv=${esc(data.foodCravings)}|trg=${esc(data.foodTriggers)}|cmp=${esc(data.compensationMethods)}|soc=${esc(data.socialComparison)}`,
      `D|pref=${esc(data.dietPreference)}|love=${esc(data.dietLove)}|avoid=${esc(data.dietDislike)}|prefO=${esc(data.dietPreference_other)}|goalO=${esc(data.goal_other)}`,
      `M|${esc(data.medicalConditions)}|meds=${esc(data.medications)}|medDet=${esc(data.medicationsDetails)}|medO=${esc(data.medicalConditions_other)}`,
      data.clinicalProtocol ? `CP|${esc(data.clinicalProtocol)}` : '',
    ].filter(Boolean).join('\n');
  }

  // tier === 'full' — lossless compact lines, skip fields rendered elsewhere
  const lines = [`${NP_LEGEND} tier=full`];

  lines.push(`U|${esc(data.name)}|${esc(data.age)}|${esc(data.gender)}|${esc(data.weight)}|${esc(data.height)}|${esc(data.goal)}|${esc(data.lossKg)}kg`);

  const lifestyle = [
    data.sleepHours != null ? `sleep=${esc(data.sleepHours)}` : '',
    data.sleepInterrupt ? `intr=${esc(data.sleepInterrupt)}` : '',
    data.chronotype ? `chr=${esc(data.chronotype)}` : '',
    data.dailyActivityLevel ? `act=${esc(data.dailyActivityLevel)}` : '',
    data.stressLevel ? `str=${esc(data.stressLevel)}` : '',
    data.sportActivity ? `sport=${esc(data.sportActivity)}` : '',
    data.waterIntake ? `water=${esc(data.waterIntake)}` : '',
    data.drinksSweet ? `sweet=${esc(data.drinksSweet)}` : '',
    data.drinksAlcohol ? `alc=${esc(data.drinksAlcohol)}` : '',
  ].filter(Boolean).join('|');
  if (lifestyle) lines.push(`L|${lifestyle}`);

  const history = [
    data.weightChange ? `wgChg=${esc(data.weightChange)}` : '',
    data.weightChangeDetails ? `wgDet=${esc(data.weightChangeDetails)}` : '',
    data.dietHistory ? `dHist=${esc(data.dietHistory)}` : '',
    data.dietType || data.dietHistoryType ? `dType=${esc(data.dietType || data.dietHistoryType)}` : '',
    data.dietResult || data.dietHistoryResult ? `dRes=${esc(data.dietResult || data.dietHistoryResult)}` : '',
    data.overeatingFrequency ? `ovr=${esc(data.overeatingFrequency)}` : '',
  ].filter(Boolean).join('|');
  if (history) lines.push(`B|${history}`);

  const habits = [
    hasContent(data.eatingHabits) ? `hab=${esc(data.eatingHabits)}` : '',
    hasContent(data.foodCravings) ? `crv=${esc(data.foodCravings)}` : '',
    data.foodCravings_other ? `crvO=${esc(data.foodCravings_other)}` : '',
    hasContent(data.foodTriggers) ? `trg=${esc(data.foodTriggers)}` : '',
    data.foodTriggers_other ? `trgO=${esc(data.foodTriggers_other)}` : '',
    hasContent(data.compensationMethods) ? `cmp=${esc(data.compensationMethods)}` : '',
    data.compensationMethods_other ? `cmpO=${esc(data.compensationMethods_other)}` : '',
    data.socialComparison ? `soc=${esc(data.socialComparison)}` : '',
  ].filter(Boolean).join('|');
  if (habits) lines.push(`H|${habits}`);

  const diet = [
    hasContent(data.dietPreference) ? `pref=${esc(data.dietPreference)}` : '',
    data.dietPreference_other ? `prefO=${esc(data.dietPreference_other)}` : '',
    data.dietLove ? `love=${esc(data.dietLove)}` : '',
    data.dietDislike ? `avoid=${esc(data.dietDislike)}` : '',
    data.goal_other ? `goalO=${esc(data.goal_other)}` : '',
  ].filter(Boolean).join('|');
  if (diet) lines.push(`D|${diet}`);

  const med = [
    hasContent(data.medicalConditions) ? esc(data.medicalConditions) : '',
    data.medications ? `meds=${esc(data.medications)}` : '',
    data.medicationsDetails ? `medDet=${esc(data.medicationsDetails)}` : '',
    data.medicalConditions_other ? `medO=${esc(data.medicalConditions_other)}` : '',
  ].filter(Boolean).join('|');
  if (med) lines.push(`M|${med}`);

  if (data.clinicalProtocol && !excludeOpts.excludeClinicalProtocol) {
    lines.push(`CP|${esc(data.clinicalProtocol)}`);
  }

  // Residual fields not covered above (lossless catch-all)
  const covered = new Set([
    'name', 'age', 'gender', 'weight', 'height', 'goal', 'lossKg',
    'sleepHours', 'sleepInterrupt', 'chronotype', 'dailyActivityLevel', 'stressLevel',
    'sportActivity', 'waterIntake', 'drinksSweet', 'drinksAlcohol',
    'weightChange', 'weightChangeDetails', 'dietHistory', 'dietType', 'dietHistoryType',
    'dietResult', 'dietHistoryResult', 'overeatingFrequency',
    'eatingHabits', 'foodCravings', 'foodCravings_other', 'foodTriggers', 'foodTriggers_other',
    'compensationMethods', 'compensationMethods_other', 'socialComparison',
    'dietPreference', 'dietPreference_other', 'dietLove', 'dietDislike', 'goal_other',
    'medicalConditions', 'medications', 'medicationsDetails', 'medicalConditions_other',
    'clinicalProtocol', 'clinicalProtocolName',
  ]);
  for (const key of excluded) covered.add(key);

  const extras = [];
  for (const [key, value] of Object.entries(data)) {
    if (covered.has(key) || excluded.has(key)) continue;
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
    extras.push(`${key}=${esc(value)}`);
  }
  if (extras.length) lines.push(`X|${extras.join('|')}`);

  return lines.join('\n');
}

/**
 * @param {{ activityScore?: object, bmr?: number, tdee?: number, safeDeficit_reference?: object, baselineMacros?: object }} calc
 * @returns {string}
 */
export function serializeBackendCalculations(calc) {
  if (!calc) return '';
  const lines = ['#BC v1'];
  const as = calc.activityScore;
  if (as) {
    lines.push(`AS|sc=${as.combinedScore ?? ''}|lv=${esc(as.activityLevel)}`);
  }
  if (calc.bmr != null || calc.tdee != null) {
    lines.push(`BM|bmr=${calc.bmr ?? ''}|tdee=${calc.tdee ?? ''}`);
  }
  const df = calc.safeDeficit_reference;
  if (df) {
    lines.push(`DF|tgt=${df.targetCalories ?? ''}|pct=${df.deficitPercent ?? ''}|max=${df.maxDeficitCalories ?? ''}`);
  }
  const mc = calc.baselineMacros;
  if (mc) {
    lines.push(`MC|p=${mc.protein ?? ''}%|c=${mc.carbs ?? ''}%|f=${mc.fats ?? ''}%|pkg=${mc.proteinGramsPerKg ?? ''}`);
  }
  return lines.join('\n');
}

/**
 * Compact analysis block for inter-step prompts.
 * @param {object} analysis
 * @param {2|3|4} step
 */
export function serializeAnalysisForStep(analysis, step) {
  if (!analysis) return '';
  if (step === 3) {
    const cals = analysis.Final_Calories || analysis.recommendedCalories || '';
    const mr = analysis.macroRatios;
    const mg = analysis.macroGrams;
    return [
      '#AN v1 step=3',
      `bmr=${analysis.bmr ?? ''}|cal=${cals}`,
      mr ? `pct|P${mr.protein ?? ''}/C${mr.carbs ?? ''}/F${mr.fats ?? ''}` : '',
      mg ? `g|P${mg.protein ?? ''}/C${mg.carbs ?? ''}/F${mg.fats ?? ''}` : '',
    ].filter(Boolean).join('\n');
  }
  if (step === 4) {
    const probs = (analysis.keyProblems || []).slice(0, 6).map(p =>
      `${esc(p.title)}:${p.severity || ''}`
    ).join('+');
    const needs = (analysis.nutritionalNeeds || analysis.nutritionalDeficiencies || []).slice(0, 5).join('+');
    return [
      '#AN v1 step=4',
      `bmr=${analysis.bmr ?? ''}|cal=${analysis.Final_Calories || analysis.recommendedCalories || ''}`,
      analysis.psychoProfile?.temperament ? `temp=${esc(analysis.psychoProfile.temperament)}@${analysis.psychoProfile.probability ?? 0}%` : '',
      analysis.psychologicalProfile ? `psy=${esc(String(analysis.psychologicalProfile).slice(0, 400))}` : '',
      probs ? `prob=${probs}` : '',
      needs ? `need=${esc(needs)}` : '',
    ].filter(Boolean).join('\n');
  }
  // step 2
  const cm = analysis.correctedMetabolism || {};
  const mg = analysis.macroGrams || {};
  const mr = analysis.macroRatios || {};
  return [
    '#AN v1 step=2',
    `bmi=${analysis.bmi ?? ''}|bmr=${cm.realBMR ?? analysis.bmr ?? ''}|tdee=${cm.realTDEE ?? ''}`,
    `temp=${esc(analysis.psychoProfile?.temperament)}@${analysis.psychoProfile?.probability ?? 0}%`,
    `pct|P${mr.protein ?? ''}/C${mr.carbs ?? ''}/F${mr.fats ?? ''}`,
    `g|P${mg.protein ?? ''}/C${mg.carbs ?? ''}/F${mg.fats ?? ''}`,
  ].join('\n');
}

/**
 * @param {object} strategy
 * @returns {string}
 */
export function serializeStrategyForMealPlan(strategy) {
  if (!strategy) return '';
  const inc = (strategy.preferredFoodCategories || strategy.foodsToInclude || []).join('+');
  const avoid = (strategy.avoidFoodCategories || strategy.foodsToAvoid || []).join('+');
  const principles = (strategy.keyPrinciples || []).join(';');
  return [
    '#ST v1',
    `type=${esc(strategy.dietType || strategy.dietaryModifier || 'Балансирана')}|pat=${esc(strategy.weeklyMealPattern)}`,
    `timing=${esc(strategy.mealTiming?.pattern || strategy.mealTiming)}|mod=${esc(strategy.dietaryModifier)}`,
    principles ? `pr=${esc(principles)}` : '',
    inc ? `in=${esc(inc)}` : '',
    avoid ? `out=${esc(avoid)}` : '',
    strategy.calorieDistribution ? `cd=${esc(String(strategy.calorieDistribution).slice(0, 200))}` : '',
    strategy.macroDistribution ? `md=${esc(String(strategy.macroDistribution).slice(0, 200))}` : '',
    strategy.freeDayNumber != null ? `free=D${strategy.freeDayNumber}` : '',
    strategy.includeDessert === false ? 'dessert=0' : '',
  ].filter(Boolean).join('\n');
}

/**
 * Compact weekly calorie/macro targets for meal plan chunks.
 * @param {object} strategy
 * @param {number} startDay
 * @param {number} endDay
 * @param {number} recommendedCalories
 * @param {Record<number, string>} dayNumberToKey
 * @param {string} toleranceLabel
 */
export function serializeWeeklySchemeTargets(strategy, startDay, endDay, recommendedCalories, dayNumberToKey, toleranceLabel = 'kcal±5%/макро±10%') {
  const freeDayNum = strategy?.freeDayNumber != null ? Number(strategy.freeDayNumber) : null;
  const lines = [`#WK v1 ${toleranceLabel} | H1-H5=Хранене1-5 SF=Свободно`];

  for (let d = startDay; d <= endDay; d++) {
    const key = dayNumberToKey[d - 1];
    const dayTarget = strategy?.weeklyScheme?.[key];
    const kcal = dayTarget?.calories || recommendedCalories;
    const macro = dayTarget?.protein != null
      ? `/B${dayTarget.protein}C${dayTarget.carbs}M${dayTarget.fats}`
      : '';
    const freeTag = (freeDayNum != null && d === freeDayNum) ? '*SF' : '';
    let line = `D${d}/${DAY_KEY_SHORT[key] || key}:${kcal}${macro}${freeTag}`;

    if (dayTarget?.mealBreakdown?.length) {
      const meals = dayTarget.mealBreakdown.map(m => {
        const t = MEAL_TYPE_SHORT[m.type] || m.type;
        if (m.type === 'Свободно хранене') {
          return `${t}:${m.calories ?? 0}/B${m.protein ?? 0}C${m.carbs ?? 0}M${m.fats ?? 0}`;
        }
        return `${t}:${m.calories}/B${m.protein}C${m.carbs}M${m.fats}`;
      }).join(',');
      line += `|${meals}`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * @param {Array<{day: number, meals: Array<{name: string}>}>} previousDays
 * @returns {string}
 */
export function serializePreviousDays(previousDays) {
  if (!previousDays?.length) return '';
  const parts = previousDays.map(d => {
    const names = (d.meals || []).map(m => esc(m.name)).join(',');
    return `D${d.day}:${names}`;
  });
  return `#PD v1 ${parts.join('|')}`;
}

/**
 * Compact week plan for summary step (names + calories only).
 * @param {object} weekPlan
 */
export function serializeWeekPlanSummary(weekPlan) {
  if (!weekPlan) return '';
  const lines = ['#PL v1'];
  for (const [dayKey, dayData] of Object.entries(weekPlan)) {
    if (!dayData?.meals) continue;
    const meals = dayData.meals.map(m => {
      const t = (m.type || '?')[0];
      return `${t}:${esc(m.name)}@${m.calories ?? 0}`;
    }).join(',');
    lines.push(`${dayKey}|${meals}`);
  }
  return lines.join('\n');
}

/** Compact 7-day meal names for weekly adaptation prompts (not admin patch paths). */
export function serializeWeekPlanWeeklyCompact(weekPlan) {
  if (!weekPlan || typeof weekPlan !== 'object') return '';
  const lines = ['#WP v1'];
  for (const dayKey of Object.keys(weekPlan).sort().slice(0, 7)) {
    const meals = weekPlan[dayKey]?.meals;
    if (!meals?.length) continue;
    const names = meals.map((m) => esc(m.name || '')).filter(Boolean).join('+');
    if (names) lines.push(`${dayKey}|${names}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

/**
 * Compact items line from meal.description (• product 150g).
 * @param {string} [description]
 * @returns {string}
 */
function compactMealItems(description) {
  if (!description) return '';
  return String(description)
    .split('\n')
    .map((line) => line.replace(/^[•\-*]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => esc(line.replace(/\s+/g, '')))
    .join('+');
}

/**
 * Week plan for client chat — grams, macros, and per-product amounts.
 * @param {object} weekPlan
 * @param {{ days?: string[] }} [options]
 */
export function serializeWeekPlanClient(weekPlan, options = {}) {
  if (!weekPlan) return '';
  const dayFilter = options.days?.length ? new Set(options.days) : null;
  const lines = ['#PL v2 chat|day|type|name|kcal|g|P|C|F|items'];
  for (const [dayKey, dayData] of Object.entries(weekPlan)) {
    if (dayFilter && !dayFilter.has(dayKey)) continue;
    if (!dayData?.meals?.length) continue;
    for (const m of dayData.meals) {
      const type = MEAL_TYPE_SHORT[m.type] || esc(String(m.type || '?').slice(0, 3));
      const kcal = Number(m.calories) || 0;
      const g = parseInt(String(m.weight || '0').replace(/[^\d]/g, ''), 10) || 0;
      const p = Number(m.macros?.protein) || 0;
      const c = Number(m.macros?.carbs) || 0;
      const f = Number(m.macros?.fats ?? m.macros?.fat) || 0;
      const items = compactMealItems(m.description);
      lines.push(`${dayKey}|${type}|${esc(m.name)}|${kcal}|${g}|${p}|${c}|${f}|${items}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

/**
 * Full week plan for admin AI — every meal with kcal, grams, macros, patch path.
 * @param {object} weekPlan
 */
export function serializeWeekPlanAdmin(weekPlan) {
  if (!weekPlan) return '';
  const lines = ['#PL v2 admin|day|idx|type|name|kcal|g|P|C|F|patch'];
  for (const [dayKey, dayData] of Object.entries(weekPlan)) {
    if (!dayData?.meals?.length) continue;
    const meals = dayData.meals;
    let dayKcal = 0;
    let dayP = 0;
    let dayC = 0;
    let dayF = 0;
    for (let i = 0; i < meals.length; i++) {
      const m = meals[i];
      const type = MEAL_TYPE_SHORT[m.type] || esc(String(m.type || '?').slice(0, 3));
      const kcal = Number(m.calories) || 0;
      const g = parseInt(String(m.weight || '0').replace(/[^\d]/g, ''), 10) || 0;
      const p = Number(m.macros?.protein) || 0;
      const c = Number(m.macros?.carbs) || 0;
      const f = Number(m.macros?.fats ?? m.macros?.fat) || 0;
      dayKcal += kcal;
      dayP += p;
      dayC += c;
      dayF += f;
      const patch = `/plan/weekPlan/${dayKey}/meals/${i}`;
      lines.push(`${dayKey}|${i}|${type}|${esc(m.name)}|${kcal}|${g}|${p}|${c}|${f}|${patch}`);
    }
    lines.push(`${dayKey}|T|—|ден_общо|${dayKcal}|—|${dayP}|${dayC}|${dayF}|`);
  }
  return lines.join('\n');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function formatPromptValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * @param {string} text
 * @returns {number}
 */
export function estimateTokenCount(text) {
  if (!text) return 0;
  const cyrillicChars = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const cyrillicRatio = cyrillicChars / text.length;
  const charsPerToken = 4 - cyrillicRatio;
  return Math.ceil(text.length / charsPerToken);
}
