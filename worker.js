// ═══ NPCF context-compression (inlined) ═══
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
function serializeUserProfile(data, tier = 'full', options = {}) {
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
function serializeBackendCalculations(calc) {
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
function serializeAnalysisForStep(analysis, step) {
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
function serializeStrategyForMealPlan(strategy) {
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
 * @param {number} calorieTolerance
 */
function serializeWeeklySchemeTargets(strategy, startDay, endDay, recommendedCalories, dayNumberToKey, calorieTolerance = 50) {
  const freeDayNum = strategy?.freeDayNumber != null ? Number(strategy.freeDayNumber) : null;
  const lines = [`#WK v1 ±${calorieTolerance}kcal | H1-H5=Хранене1-5 SF=Свободно`];

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
function serializePreviousDays(previousDays) {
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
function serializeWeekPlanSummary(weekPlan) {
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

/**
 * Full week plan for admin AI — every meal with kcal, grams, macros, patch path.
 * @param {object} weekPlan
 */
function serializeWeekPlanAdmin(weekPlan) {
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
function formatPromptValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * @param {string} text
 * @returns {number}
 */
function estimateTokenCount(text) {
  if (!text) return 0;
  const cyrillicChars = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const cyrillicRatio = cyrillicChars / text.length;
  const charsPerToken = 4 - cyrillicRatio;
  return Math.ceil(text.length / charsPerToken);
}

// ═══ End NPCF ═══

/**
 * Cloudflare Worker for AI Diet Application
 * Backend endpoint: https://aidiet.radilov-k.workers.dev/
 * 
 * AI LOAD DISTRIBUTION STRATEGY:
 * 
 * Problem: Sending all data in a single large request can overload AI model and reduce quality
 * Solution: Multi-step architecture that distributes work across focused requests
 * 
 * KEY PRINCIPLE: NO compromise on data completeness, precision, or individualization
 * 
 * TOKEN OPTIMIZATION (Jun 2026 — NPCF v1):
 * - NutriPlan Context Format (context-compression.js) for plan generation steps
 * - Step 1: lossless pipe-serialized profile + backend calcs (deduped vs notes sections)
 * - Steps 2–4: tiered profile + compact analysis/strategy/weekly-scheme blocks
 * - Step 3 ×4 chunks: compressed weekly targets + previous-day meal names
 * - replacePromptVariables uses compact JSON (no pretty-print)
 * 
 * ARCHITECTURE - Plan Generation (Reorganized for efficiency):
 * Структура: 4 основни стъпки, стъпка 3 с 4 подстъпки = 7 заявки
 * 
 *   1. Analysis Request (4k token limit)
 *      - Input: Full user data (profile, habits, medical, preferences)
 *      - Output: Holistic health analysis with correlations
 *   
 *   2. Strategy Request (4k token limit)
 *      - Input: User data + COMPACT analysis results
 *      - Output: Personalized dietary strategy and approach
 *   
 *   3. Meal Plan Requests (4 sub-requests, 8k token limit each - SIMPLIFIED)
 *      - Progressive generation: 2 days per chunk
 *      - Input: MINIMAL context - only essential rules, no duplication
 *      - Output: Detailed meals with macros and descriptions
 *      - REORGANIZATION: Removed 150+ lines of repeated ADLE rules
 *      - Sub-steps: Day 1-2, Day 3-4, Day 5-6, Day 7
 *      - OPTIMIZATION: Food whitelist/blacklist cached once and reused
 *   
 *   4. Summary Request (2k token limit - LIGHTWEIGHT)
 *      - Input: Essential data only - health context, food lists
 *      - Output: Summary, recommendations, supplements
 *      - SIMPLIFICATION: Removed verbose guidelines, kept AI flexibility
 * 
 * Total: 1 (analysis) + 1 (strategy) + 4 (meal plan sub-steps) + 1 (summary) = 7 steps
 * 
 * OPTIMIZATION STRATEGY (Reorganization, NOT just adding tokens):
 *   - Step 3: Removed ~200 lines of duplicate ADLE rules (70% prompt reduction)
 *   - Step 4: Removed ~50 lines of supplement guidelines (60% prompt reduction)
 *   - Kept token limits at 8k/2k - improvements through SIMPLIFICATION
 *   - Result: Same quality, dramatically less prompt bloat
 * 
 * ARCHITECTURE - Chat (1 request per message):
 *   - Input: Full user data + Full plan + Conversation history (2k tokens max)
 *   - Output: Response (2k token limit)
 *   - Uses full context for precise consultation
 * 
 * BENEFITS:
 *   ✓ Each request focused and lean - no unnecessary duplication
 *   ✓ Prompts simplified by 60-70% while maintaining quality
 *   ✓ Better error handling (chunk failures don't fail entire generation)
 *   ✓ Progressive refinement (later days build on earlier days)
 *   ✓ Full analysis quality maintained
 *   ✓ Cached food lists prevent redundant KV reads (4x → 1x per generation)
 *   ✓ AI has flexibility without over-prescription
 * 
 * AI PROMPTS ORGANIZATION (Feb 2026):
 *   All AI prompts are extracted to separate files for easier management:
 *   - Location: KV/prompts/ directory
 *   - Files: admin_analysis_prompt.txt, admin_strategy_prompt.txt, 
 *            admin_meal_plan_prompt.txt, admin_summary_prompt.txt,
 *            admin_consultation_prompt.txt, admin_modification_prompt.txt,
 *            admin_correction_prompt.txt
 *   - Upload: ./KV/upload-kv-keys.sh script uploads to Cloudflare KV
 *   - Runtime: requireKvPrompt() loads step prompts from KV (uploaded from KV/prompts/)
 *   - Small injected snippets (meal name format, sweets rule) live in worker.js — not separate KV keys
 *   - Admin panel shows prompts from KV via handleGetDefaultPrompt()
 */

// No default values - all calculations must be individualized based on user data

// Data Validation Configuration (hardcoded fallback defaults — overridable via admin panel KV)
const MIN_AGE = 13; // Minimum age for diet planning (GDPR/COPPA: under-13 users not permitted)
const MAX_AGE = 100;
const MIN_WEIGHT_KG = 20;
const MAX_WEIGHT_KG = 300;
const MIN_HEIGHT_CM = 100;
const MAX_HEIGHT_CM = 250;
const MIN_BMI = 10; // Medically possible minimum
const MAX_BMI = 80; // Medically possible maximum
const MAX_WEIGHT_LOSS_KG = 50; // Maximum weight loss per plan
const MAX_WEIGHT_LOSS_PERCENT = 0.5; // Maximum 50% of body weight

/**
 * Default validation configuration.
 * All values match the hardcoded constants above and can be overridden via admin panel.
 * Stored in KV under 'admin_validation_config' as a JSON string.
 */
const DEFAULT_VALIDATION_CONFIG = {
  dataValidation: {
    minAge: MIN_AGE,
    maxAge: MAX_AGE,
    minWeightKg: MIN_WEIGHT_KG,
    maxWeightKg: MAX_WEIGHT_KG,
    minHeightCm: MIN_HEIGHT_CM,
    maxHeightCm: MAX_HEIGHT_CM,
    minBmi: MIN_BMI,
    maxBmi: MAX_BMI,
    maxWeightLossKg: MAX_WEIGHT_LOSS_KG,
    maxWeightLossPercent: MAX_WEIGHT_LOSS_PERCENT
  },
  contradictionRules: {
    // Underweight person wanting to lose weight
    underweightLoss: {
      enabled: true,
      bmiThreshold: 18.5,   // BMI below this triggers the rule
      canProceed: true        // true = advisory warning; false = hard block
    },
    // Thyroid condition + user-requested calories below safe floor
    thyroidAggressiveDeficit: {
      enabled: true,
      tdeeFloor: 0.75,        // minimum safe ratio of TDEE (1.0 = 100% TDEE)
      canProceed: true
    },
    // Anemia + vegetarian/vegan diet
    anemiaPlanBased: {
      enabled: true,
      canProceed: true
    }
  }
};
const MIN_RECOMMENDED_CALORIES_FEMALE = 1200; // Hard floor - minimum safe calories for women
const MIN_RECOMMENDED_CALORIES_MALE = 1500;   // Hard floor - minimum safe calories for men
const MIN_FAT_GRAMS_PER_KG = 0.7; // Minimum dietary fat for hormonal function (g/kg body weight)

// Analysis Configuration
const WATER_PER_KG_MULTIPLIER = 0.035; // Liters per kg body weight
const BASE_WATER_NEED_LITERS = 0.5; // Base water need in liters
const ACTIVITY_WATER_BONUS_LITERS = 0.45; // Additional water for active individuals
const TEMPERAMENT_CONFIDENCE_THRESHOLD = 80; // Minimum confidence % to report temperament
const HEALTH_STATUS_UNDERESTIMATE_PERCENT = 10; // Underestimate health status by this %


// Offensive Content Patterns (for data validation)
const OFFENSIVE_PATTERNS = [
  // Vulgar words (Cyrillic - no word boundaries, no 'g' flag)
  /(педал|курв|мръсн|идиот|глупа[кц]|дебил|тъп[аи])/i,
  // Spam patterns
  /(viagra|casino|xxx|porn)/i,
  // Test/spam data
  /^(test|тест|asdf|qwerty|12345|aaa|zzz)$/i
];

// AI Communication Logging Configuration
// HYBRID APPROACH: Cache API for fast local reads + KV for global persistence
// Cache API is free and doesn't count against KV READ/WRITE quotas
// Logs are stored temporarily in Cache with 24-hour TTL
// KV keeps the combined session index and log entries so admin can read logs
// created inside queue-consumer invocations from any region/colo.
// MAX_LOG_ENTRIES controls how many sessions to keep (1 = only the most recent session)
// Increased to 10 to preserve error logs for debugging failed plan generations
const MAX_LOG_ENTRIES = 10; // Keep last 10 sessions to ensure error logs are preserved for debugging
const AI_LOG_CACHE_TTL = 24 * 60 * 60; // 24 hours - logs expire after 1 day
const AI_LOG_KV_TTL = 14 * 24 * 60 * 60; // 14 days - enough history for admin debugging
const AI_ERROR_LOG_KV_ENABLED = true; // Enable KV storage for errors (debugging capability)
const AI_LOG_COMBINED_INDEX_KEY = 'ai_log_combined_index';

// Built-in default validation prompt (used when no custom prompt is stored in KV).
// Also returned by handleGetDefaultPrompt so the admin "Виж Текущ Промпт" button works.
// Use {userData} as a placeholder — replaced at runtime with the formatted user data.
const DEFAULT_VALIDATION_PROMPT_TEMPLATE = `Ти си медицински AI валидатор за хранително-диетично приложение. Анализирай следните данни от въпросник и провери за проблеми.

{userData}

ПРОВЕРИ ЗА СЛЕДНИТЕ КАТЕГОРИИ ПРОБЛЕМИ:

1. НЕРЕАЛИСТИЧНИ ЦЕЛИ - напр. желание за загуба на 20+ кг за седмица, достигане на опасно ниско тегло, цел за BMI под 16
2. ОПАСНИ/НЕЗДРАВОСЛОВНИ ЦЕЛИ - напр. екстремен калориен дефицит при медицински състояния, отслабване при вече поднормено тегло (BMI < 18.5), комбинация от медикаменти и екстремни диети
3. РИСКОВИ КОМБИНАЦИИ - напр. некомпенсиран диабет + кетогенна диета, бременност + агресивно отслабване, тежко сърдечносъдово заболяване + интензивна спортна програма
4. НЕЛОГИЧНА ИНФОРМАЦИЯ - напр. физически невъзможни комбинации от тегло/ръст, очевидно невалидни данни
5. ПРОТИВОРЕЧИВА ИНФОРМАЦИЯ - напр. алергия към млечни продукти, но любимата храна е сирене; веган диета, но яде месо
6. РАЗМИНАВАНЕ В ДИЕТИЧНА ИСТОРИЯ - само ако потребителят е следвал конкретна диета с ясно негативен резултат И текущата цел предполага точно същия неуспешен подход

ВАЖНО:
- Бъди ЛИБЕРАЛЕН. Флагвай само ОЧЕВИДНИ и СЕРИОЗНИ опасности за здравето.
- Нормалните цели (отслабване, качване на тегло, поддържане, мускулна маса, тонизиране) НЕ са проблем.
- Цел за качване на мускулна маса при наднормено тегло НЕ е проблем — рекомпозицията е валидна цел.
- Недостатъчен сън НЕ е причина за блокиране — планът ще включва препоръки за сън.
- Щитовидни заболявания + отслабване НЕ е автоматичен проблем — само при изрично поискан екстремен дефицит.
- 1–2 кг отслабване на седмица е нормално и НЕ е нереалистично.
- Леки несъответствия и минорни противоречия НЕ са проблем.
- Докладвай само категории 1–6 при ЯСНИ и НЕДВУСМИСЛЕНИ рискове.

Отговори САМО в JSON формат:
{
  "hasIssues": true/false,
  "issues": [
    {
      "category": "НЕРЕАЛИСТИЧНА ЦЕЛ" | "ОПАСНА ЦЕЛ" | "РИСКОВА КОМБИНАЦИЯ" | "НЕЛОГИЧНА ИНФОРМАЦИЯ" | "ПРОТИВОРЕЧИВА ИНФОРМАЦИЯ" | "РАЗМИНАВАНЕ В ДИЕТИЧНА ИСТОРИЯ",
      "description": "Описание на проблема на български",
      "severity": "high" | "medium"
    }
  ]
}

Ако НЯМА проблеми, отговори: {"hasIssues": false, "issues": []}`;

// Error messages (Bulgarian)
const ERROR_MESSAGES = {
  PARSE_FAILURE: 'Имаше проблем с обработката на отговора. Моля опитайте отново.',
  MISSING_FIELDS: 'Липсват задължителни полета',
  KV_NOT_CONFIGURED: 'KV хранилището не е конфигурирано',
  PEP_STORAGE_NOT_CONFIGURED: 'PEP бекендът не е конфигуриран',
  INVALID_PROVIDER: 'Невалиден AI доставчик',
  MISSING_CONTEXT: 'Липсват потребителски данни или план',
  MISSING_MESSAGE: 'Липсва съобщение',
  MISSING_TYPE_PROMPT: 'Липсва тип или промпт',
  MISSING_PROVIDER_MODEL: 'Липсва доставчик или модел',
  MISSING_SUBSCRIPTION: 'Липсва потребителски ID или subscription',
  NOT_FOUND: 'Не е намерено',
  PLAN_GENERATION_FAILED: 'Неуспешно генериране на план',
  CHAT_FAILED: 'Грешка в чата',
  PROMPT_SAVE_FAILED: 'Неуспешно запазване на промпт',
  PROMPT_GET_FAILED: 'Неуспешно получаване на промпт',
  MODEL_SAVE_FAILED: 'Неуспешно запазване на модел',
  CONFIG_GET_FAILED: 'Неуспешно получаване на конфигурация',
  PUSH_SUBSCRIBE_FAILED: 'Неуспешно абониране за известия',
  PUSH_SEND_FAILED: 'Неуспешно изпращане на известие',
  VAPID_KEY_FAILED: 'Неуспешно получаване на VAPID ключ'
};

const PEP_DEFAULT_PRODUCTS = [
  { baseName: 'CJC-1295 + IPA', dosage: '5 mg', purchasePrice: 8.50 },
  { baseName: 'IGF-1LR3', dosage: '1 mg', purchasePrice: 17.50 },
  { baseName: 'IGF-DES', dosage: '1 mg', purchasePrice: 5.00 },
  { baseName: 'Glow (CU+TB+BC+KPV)', dosage: 'комбо', purchasePrice: 23.00 },
  { baseName: 'Tesamorelin', dosage: '10 mg', purchasePrice: 18.00 },
  { baseName: 'SLU-PP-322', dosage: '5 mg', purchasePrice: 12.00 },
  { baseName: 'LC216', dosage: 'комбо', purchasePrice: 7.50 },
  { baseName: 'LC120', dosage: 'комбо', purchasePrice: 7.50 },
  { baseName: 'Retatrutide', dosage: '5 mg', purchasePrice: 15.34 },
  { baseName: 'Retatrutide', dosage: '10 mg', purchasePrice: 25.56 },
  { baseName: 'Mots-C', dosage: '10 mg', purchasePrice: 12.78 },
  { baseName: 'Ipamorelin + CJC', dosage: '5+5 mg', purchasePrice: 8.50 },
  { baseName: 'Тирзепатид', dosage: '5 mg', purchasePrice: 12.78 },
  { baseName: 'Тирзепатид', dosage: '10 mg', purchasePrice: 20.45 },
  { baseName: 'Тирзепатид', dosage: '30 mg', purchasePrice: 51.13 },
  { baseName: 'Глутатион', dosage: '1500 mg', purchasePrice: 6.50 },
  { baseName: 'Тимозин Алфа', dosage: '5 mg', purchasePrice: 15.34 },
  { baseName: 'Тимозин Алфа', dosage: '10 mg', purchasePrice: 25.56 },
  { baseName: 'Глутатион', dosage: '600 mg', purchasePrice: 3.886 },
  { baseName: 'NAD+', dosage: '500 mg', purchasePrice: 25.56 },
  { baseName: 'GHK-Cu', dosage: '100 mg', purchasePrice: 12.78 },
  { baseName: 'Меланотан 2', dosage: '10 mg', purchasePrice: 15.34 }
];

const PEP_DEFAULT_SALES = [
  { prodBase: 'Retatrutide', dosage: '5 mg', qty: 45, mult: 2, comment: 'Групова клиентска поръчка', date: '2025-05-10' },
  { prodBase: 'Glow (CU+TB+BC+KPV)', dosage: 'комбо', qty: 20, mult: 2, comment: 'Промо пакет за лоялен клиент', date: '2025-05-12' },
  { prodBase: 'Ipamorelin + CJC', dosage: '5+5 mg', qty: 9, mult: 2, comment: 'Стандартна препоръка', date: '2025-05-14' },
  { prodBase: 'Retatrutide', dosage: '5 mg', qty: 2, mult: 2.5, comment: 'Малка поръчка на дребно', date: '2025-05-15' },
  { prodBase: 'Глутатион', dosage: '600 mg', qty: 10, mult: 2, comment: 'Поръчка над 10 броя', date: '2025-05-16' },
  { prodBase: 'NAD+', dosage: '500 mg', qty: 3, mult: 1, comment: 'Лична употреба', date: '2025-05-17' }
];

// Day name translations for weekly scheme display
const DAY_NAMES_BG = {
  monday: 'Понеделник',
  tuesday: 'Вторник',
  wednesday: 'Сряда',
  thursday: 'Четвъртък',
  friday: 'Петък',
  saturday: 'Събота',
  sunday: 'Неделя'
};

// Map day numbers (1-7) to weekday keys used in strategy.weeklyScheme
const DAY_NUMBER_TO_KEY = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Bulgarian error message shown when REGENERATE_PLAN parsing fails and no clean response text remains
const ERROR_MESSAGE_PARSE_FAILURE = ERROR_MESSAGES.PARSE_FAILURE;

// Plan modification descriptions for AI prompts
const PLAN_MODIFICATIONS = {
  NO_INTERMEDIATE_MEALS: 'no_intermediate_meals',
  THREE_MEALS_PER_DAY: '3_meals_per_day',
  FOUR_MEALS_PER_DAY: '4_meals_per_day',
  VEGETARIAN: 'vegetarian',
  NO_DAIRY: 'no_dairy',
  LOW_CARB: 'low_carb',
  INCREASE_PROTEIN: 'increase_protein'
};

const PLAN_MODIFICATION_DESCRIPTIONS = {
  [PLAN_MODIFICATIONS.NO_INTERMEDIATE_MEALS]: '- БЕЗ междинни хранения - само основни хранения (Хранене 1, Хранене 2, Хранене 4)',
  [PLAN_MODIFICATIONS.THREE_MEALS_PER_DAY]: '- Точно 3 хранения на ден (Хранене 1, Хранене 2, Хранене 4)',
  [PLAN_MODIFICATIONS.FOUR_MEALS_PER_DAY]: '- 4 хранения на ден (Хранене 1, Хранене 2, Хранене 3, Хранене 4)',
  [PLAN_MODIFICATIONS.VEGETARIAN]: '- ВЕГЕТАРИАНСКО хранене - без месо и риба',
  [PLAN_MODIFICATIONS.NO_DAIRY]: '- БЕЗ млечни продукти',
  [PLAN_MODIFICATIONS.LOW_CARB]: '- Нисковъглехидратна диета',
  [PLAN_MODIFICATIONS.INCREASE_PROTEIN]: '- Повишен прием на протеини'
};

// Default goal-based hacks (hardcoded tips per goal, managed via admin panel)
const DEFAULT_GOAL_HACKS = {
  'Отслабване': [
    '💧 Пийте чаша вода 20 мин. преди всяко хранене - намалява апетита с до 25%',
    '🥗 Започвайте всяко хранене със зеленчуци - увеличава ситостта',
    '🚶 10-минутна разходка след вечеря подобрява храносмилането и съня',
    '⏰ Не яжте 3 часа преди сън - подобрява метаболизма нощем',
    '🍽️ Използвайте по-малки чинии - визуално намалява порцията'
  ],
  'Покачване на мускулна маса': [
    '💪 Консумирайте протеин в рамките на 30 мин. след тренировка',
    '🍳 Разпределете протеина равномерно през деня (минимум 4 порции)',
    '🛌 Спете минимум 7-8 часа - мускулите растат по време на сън',
    '🥛 Казеинов протеин преди сън за бавно освобождаване през нощта',
    '🍌 Въглехидрати след тренировка попълват гликогеновите запаси'
  ],
  'Подобряване на здравето': [
    '🌈 Яжте минимум 5 различни цвята плодове/зеленчуци дневно',
    '🐟 Консумирайте риба минимум 2 пъти седмично за омега-3',
    '🧘 5 минути дихателни упражнения преди хранене подобрява храносмилането',
    '☀️ 15 мин. сутрешна слънчева светлина регулира циркадния ритъм',
    '🍵 Зелен чай между храненията подобрява метаболизма'
  ],
  'Антиейджинг': [
    '🫐 Консумирайте тъмни плодове дневно - богати на антиоксиданти',
    '🥑 Здравословните мазнини подобряват еластичността на кожата',
    '🍷 Ограничете захарта - ускорява стареенето чрез гликация',
    '💤 Качествен сън 7-9 часа - ключов за клетъчна регенерация',
    '🏃 Редовна физическа активност стимулира митохондриите'
  ],
  'Друго': [
    '📱 Планирайте храненията предварително - намалява нездравословните избори',
    '🍴 Яжте бавно - минимум 20 мин. на хранене за по-добро усвояване',
    '📝 Водете хранителен дневник за по-добра осъзнатост',
    '🥤 Ограничете течните калории - сокове, газирани напитки',
    '🛒 Пазарувайте с пълен стомах - избягвате импулсивни покупки'
  ]
};

// Clinical protocols for specialized health conditions (from allprot.txt)
// Each protocol defines dietary guidelines, supplements, and macro modifiers
// that get injected into AI prompts when a clinicalProtocol is selected
const CLINICAL_PROTOCOLS = {
  'insulin_resistance': {
    id: 'insulin_resistance',
    name: 'Инсулинова резистентност и Превенция на Диабет Т2',
    goalMapping: 'Подобряване на здравето',
    dietaryGuidelines: 'Нисък ГИ (<55); фибри 25–34g/ден; „Метод на чинията" (50% ненишестени зеленчуци, 25% чист протеин, 25% сложни въглехидрати).',
    restrictions: ['Рафинирани въглехидрати', 'Захар', 'Бял хляб', 'Бял ориз', 'Сладки напитки'],
    emphasis: ['Ненишестени зеленчуци', 'Бобови', 'Пълнозърнести', 'Чист протеин', 'Храни с нисък гликемичен индекс'],
    supplements: [
      { name: 'Мио-инозитол/D-хиро-инозитол (40:1)', dosage: '2000–4000mg', timing: 'сутрин' },
      { name: 'Берберин', dosage: '3 x 500mg', timing: 'преди хранене' },
      { name: 'Алфа-липоева киселина (ALA)', dosage: '600mg', timing: 'на гладно' },
      { name: 'Хром пиколинат', dosage: '200–1000mcg', timing: 'с хранене — подобрява инсулиновата чувствителност' }
    ],
    macroModifiers: { carbReduction: 10, proteinIncrease: 5, fatIncrease: 5 },
    dietTypeHint: 'Нисковъглехидратна / Нисък ГИ',
    hacks: [
      '🥦 Метод на чинията: 50% зеленчуци, 25% протеин, 25% сложни въглехидрати',
      '📊 Избирайте храни с ГИ под 55 — овесени ядки, бобови, зеленчуци',
      '🚶 10 мин. разходка след хранене — понижава кръвната захар с до 30%',
      '⏰ Не пропускайте хранения — стабилизира инсулина през деня',
      '🫘 Добавете бобови към поне 1 хранене дневно — бавни въглехидрати + фибри'
    ]
  },
  'autoimmune_aip': {
    id: 'autoimmune_aip',
    name: 'Автоимунни заболявания и Чревна бариера (AIP)',
    goalMapping: 'Подобряване на здравето',
    dietaryGuidelines: 'Елиминация на зърнени, бобови, млечни, яйца, ядки, семена и нощни зеленчуци. Фокус върху костни бульони, омега-3 храни и ферментирали зеленчуци.',
    restrictions: ['Зърнени храни', 'Бобови', 'Млечни продукти', 'Яйца', 'Ядки', 'Семена', 'Нощни зеленчуци (домати, пиперки, патладжани, картофи)', 'Глутен'],
    emphasis: ['Костни бульони', 'Омега-3 риби (сьомга, скумрия)', 'Ферментирали зеленчуци', 'Зеленолистни зеленчуци', 'Органични меса'],
    supplements: [
      { name: 'L-Глутамин', dosage: '5–10g', timing: 'на гладно' },
      { name: 'Цинк карнозин', dosage: '2 x 75mg', timing: 'с хранене' },
      { name: 'Витамин D3 + K2', dosage: '5000IU / 100mcg', timing: 'с мазна храна' },
      { name: 'Колострум или Бутират', dosage: '500–1000mg', timing: 'на гладно — подкрепа на чревната бариера' }
    ],
    macroModifiers: { carbReduction: 5, proteinIncrease: 5, fatIncrease: 0 },
    dietTypeHint: 'Автоимунен Палео Протокол (AIP)',
    hacks: [
      '🍖 Костните бульони са лечебни за чревната лигавица — пийте 1-2 чаши дневно',
      '🥬 Ферментирали зеленчуци подобряват чревната флора — добавете към всяко хранене',
      '🐟 Омега-3 мастни риби 3-4 пъти седмично за контрол на възпалението',
      '❌ Избягвайте нощни зеленчуци (домати, пиперки) — те влошават автоимунните процеси',
      '📝 Водете дневник на симптомите при реинтродукция на храни'
    ]
  },
  'gi_issues': {
    id: 'gi_issues',
    name: 'Стомашно-чревни проблеми (Запек и Подуване)',
    goalMapping: 'Подобряване на здравето',
    dietaryGuidelines: 'Стратегия SMART; разтворими фибри (псилиум, овес); 2 кивита/ден; горчиви храни (артишок, рукола); магнезиева вода (0.5–1L).',
    restrictions: ['Газирани напитки', 'Дъвки без захар (сорбитол)', 'Прекомерни FODMAP храни', 'Пържени храни'],
    emphasis: ['Разтворими фибри (псилиум, овес)', 'Киви (2 бр./ден)', 'Горчиви храни (артишок, рукола)', 'Магнезиева вода', 'Ферментирали храни'],
    supplements: [
      { name: 'Магнезиев цитрат', dosage: '400–600mg', timing: 'вечер' },
      { name: 'Прокинетици (Джинджифил/Артишок)', dosage: '1–2 капсули', timing: 'на гладно' },
      { name: 'Псилиум хуск', dosage: '5–10g', timing: 'с много вода' }
    ],
    macroModifiers: { carbReduction: 0, proteinIncrease: 0, fatIncrease: 0 },
    dietTypeHint: 'Щадящ стомах / Нисък FODMAP',
    hacks: [
      '🥝 2 кивита дневно — доказано подобряват перисталтиката',
      '💧 Пийте магнезиева вода (0.5-1L дневно) за нормална чревна функция',
      '🥗 Горчиви храни (артишок, рукола) стимулират жлъчката и храносмилането',
      '🚶 Разходка след хранене подобрява чревния транзит',
      '⏰ Яжте на редовни часове — подобрява чревния ритъм'
    ]
  },
  'menopause_sarcopenia': {
    id: 'menopause_sarcopenia',
    name: 'Менопауза и Саркопения',
    goalMapping: 'Подобряване на здравето',
    dietaryGuidelines: 'Протеин 1.0–1.2g/kg (равномерно разпределен); фитоестрогени (соя, ленено семе); калций и Вит. D от храна. Ограничаване на захар и алкохол.',
    restrictions: ['Захар', 'Алкохол', 'Високо преработени храни', 'Прекомерен кофеин'],
    emphasis: ['Високо протеинови храни', 'Фитоестрогени (соя, ленено семе)', 'Калций-богати храни', 'Витамин D от храна', 'Костни бульони'],
    supplements: [
      { name: 'Креатин монохидрат', dosage: '3–5g', timing: 'след тренировка или с хранене' },
      { name: 'Магнезиев бисглицинат', dosage: '300–400mg', timing: 'вечер' },
      { name: 'Омега-3 (високо EPA)', dosage: '2000mg', timing: 'с хранене' },
      { name: 'Витамин D3', dosage: '2000–4000IU', timing: 'с мазна храна — критичен за костното здраве' },
      { name: 'Колаген тип II', dosage: '40mg (нативен)', timing: 'на гладно — подкрепа на ставите' }
    ],
    macroModifiers: { carbReduction: 5, proteinIncrease: 10, fatIncrease: 0 },
    dietTypeHint: 'Високопротеинова / Средиземноморска',
    hacks: [
      '💪 Разпределете протеина равномерно — мин. 25-30г на хранене за мускулна синтеза',
      '🫘 Включете фитоестрогени ежедневно — соя, ленено семе, нахут',
      '🦴 Калций от храна: броколи, бадеми, сардини, сусам',
      '🏋️ Силови тренировки 2-3 пъти седмично — критично за запазване на мускулна маса',
      '🌙 Магнезий вечер подобрява съня и намалява мускулните крампи'
    ]
  },
  'cellulite_reduction': {
    id: 'cellulite_reduction',
    name: 'Редукция на целулит',
    goalMapping: 'Отслабване',
    dietaryGuidelines: 'Хипокалоричен високопротеинов режим; лимфен дренаж чрез фитотерапия; нисък натрий; полифеноли (горски плодове, зелен чай).',
    restrictions: ['Високо натриеви храни', 'Преработени храни', 'Рафинирани въглехидрати', 'Алкохол', 'Захар'],
    emphasis: ['Високопротеинови храни', 'Горски плодове', 'Зелен чай', 'Цитрусови плодове', 'Зеленолистни зеленчуци', 'Храни богати на витамин C'],
    supplements: [
      { name: 'Колагенови пептиди (тип I и III)', dosage: '10–15g', timing: 'сутрин на гладно' },
      { name: 'Екстракт от Готу Кола (Centella Asiatica)', dosage: '60–120mg', timing: 'с хранене' },
      { name: 'Витамин C', dosage: '1000mg', timing: 'сутрин' },
      { name: 'Ортосилициева киселина (Силиций)', dosage: '5–10mg', timing: 'с хранене — укрепва съединителната тъкан' }
    ],
    macroModifiers: { carbReduction: 10, proteinIncrease: 10, fatIncrease: 0 },
    dietTypeHint: 'Хипокалорична високопротеинова',
    hacks: [
      '🫐 Горски плодове ежедневно — полифеноли за здрава съединителна тъкан',
      '💧 Мин. 2.5л вода дневно + билкови чайове за лимфен дренаж',
      '🧂 Ограничете натрия под 2000mg дневно — намалява задържането на течности',
      '🍵 2-3 чаши зелен чай дневно — подобрява микроциркулацията',
      '🚶 Ежедневна разходка 30 мин. стимулира лимфния дренаж'
    ]
  },
  'chronic_stress': {
    id: 'chronic_stress',
    name: 'Хроничен стрес (Кортизолова регулация)',
    goalMapping: 'Подобряване на здравето',
    dietaryGuidelines: 'Противовъзпалителна диета; балансирани хранения (протеин + мазнини + фибри); избягване на кофеин на гладно.',
    restrictions: ['Кофеин на гладно', 'Рафинирани въглехидрати', 'Захар', 'Алкохол', 'Енергийни напитки'],
    emphasis: ['Противовъзпалителни храни', 'Омега-3 мастни киселини', 'Магнезий-богати храни', 'Адаптогени', 'Сложни въглехидрати'],
    supplements: [
      { name: 'Ашваганда (KSM-66)', dosage: '300–600mg', timing: 'сутрин и/или вечер' },
      { name: 'Магнезиев L-треонат', dosage: '150–200mg елементен Mg', timing: 'вечер' },
      { name: 'L-Теанин', dosage: '200mg', timing: 'при стрес или вечер' },
      { name: 'Фосфатидилсерин (PS)', dosage: '100–300mg', timing: 'вечер — доказан кортизолов модулатор' }
    ],
    macroModifiers: { carbReduction: 0, proteinIncrease: 5, fatIncrease: 5 },
    dietTypeHint: 'Противовъзпалителна / Балансирана',
    hacks: [
      '☕ Никога не пийте кафе на гладно — повишава кортизола допълнително',
      '🍽️ Всяко хранене трябва да съдържа протеин + мазнини + фибри за стабилна захар',
      '🧘 5 мин. дихателни упражнения преди хранене подобрява усвояването',
      '🌙 Магнезий вечер — намалява кортизола и подобрява съня',
      '🐟 Омега-3 мастни киселини ежедневно за контрол на възпалението'
    ]
  },
  'postpartum_lactation': {
    id: 'postpartum_lactation',
    name: 'Възстановяване след бременност и Лактация',
    goalMapping: 'Подобряване на здравето',
    dietaryGuidelines: 'Допълнителни 330–400 kcal/ден; холин, йод, желязо. Отслабване до 0.5kg/седмица.',
    restrictions: ['Алкохол', 'Прекомерен кофеин (макс. 200mg/ден)', 'Сурови морски продукти', 'Високо живачни риби'],
    emphasis: ['Холин-богати храни (яйца, черен дроб)', 'Йод (морски продукти)', 'Желязо (месо, спанак)', 'Калций', 'Омега-3 (DHA)'],
    supplements: [
      { name: 'Холин (Alpha-GPC)', dosage: 'до 550mg общо', timing: 'с хранене' },
      { name: 'Железен бисглицинат', dosage: '18–25mg (при дефицит)', timing: 'на гладно с Вит.C' },
      { name: 'DHA (Омега-3)', dosage: 'мин. 1000mg', timing: 'с хранене' },
      { name: 'Калиев йодид (Йод)', dosage: '150–290mcg', timing: 'с хранене — критичен за лактация и развитие на бебето' }
    ],
    macroModifiers: { carbReduction: 0, proteinIncrease: 5, fatIncrease: 5 },
    dietTypeHint: 'Балансирана / Нутриент-плътна',
    hacks: [
      '🥚 Яйцата са отличен източник на холин — 2 на ден при кърмене',
      '🐟 DHA от риба подобрява развитието на бебето — 2-3 порции седмично',
      '🍊 Приемайте желязо с витамин C за по-добро усвояване',
      '💧 Допълнителни 500мл вода при кърмене — критично за млекопроизводството',
      '⚖️ Безопасен темп на отслабване: макс. 0.5кг/седмица при лактация'
    ]
  },
  'visceral_fat': {
    id: 'visceral_fat',
    name: 'Висцерални мазнини (Коремно отслабване)',
    goalMapping: 'Отслабване',
    dietaryGuidelines: 'Полифеноли за „потъмняване" на мазнините (зелен чай, куркума, къпини); зехтин екстра върджин (EVOO) като основна мазнина.',
    restrictions: ['Транс мазнини', 'Рафинирани въглехидрати', 'Захар', 'Алкохол (особено бира)', 'Преработени храни'],
    emphasis: ['Зелен чай', 'Куркума', 'Къпини и горски плодове', 'Зехтин екстра върджин', 'Високо фиброви храни', 'Омега-3 риби'],
    supplements: [
      { name: 'EGCG (Зелен чай екстракт)', dosage: '400–500mg', timing: 'сутрин с хранене — не на празен стомах' },
      { name: 'Куркумин (+пиперин)', dosage: '500–1000mg', timing: 'с хранене' },
      { name: 'Транс-ресвератрол', dosage: '500mg', timing: 'сутрин' },
      { name: 'CLA (Конюгирана линолова киселина)', dosage: '3000–4000mg', timing: 'с хранене — специфична за висцерални мазнини' }
    ],
    macroModifiers: { carbReduction: 10, proteinIncrease: 5, fatIncrease: 5 },
    dietTypeHint: 'Противовъзпалителна / Средиземноморска',
    hacks: [
      '🍵 3-4 чаши зелен чай дневно — EGCG стимулира горенето на висцерални мазнини',
      '🫒 Зехтин екстра върджин като основна мазнина — мононенаситени за метаболизма',
      '🫐 Полифеноли от горски плодове и куркума „потъмняват" мастните клетки',
      '🚶 HIIT или бързо ходене — най-ефективни за висцерални мазнини',
      '🍺 Елиминирайте алкохола — директно увеличава коремните мазнини'
    ]
  },
  'post_smoking': {
    id: 'post_smoking',
    name: 'След спиране на тютюнопушенето',
    goalMapping: 'Подобряване на здравето',
    dietaryGuidelines: 'Обемни нискокалорични зеленчуци (моркови, целина); храни с тирозин (протеини); стабилизиране на кръвната захар.',
    restrictions: ['Захарни храни', 'Рафинирани въглехидрати', 'Алкохол', 'Прекомерен кофеин'],
    emphasis: ['Обемни нискокалорични зеленчуци (моркови, целина)', 'Тирозин-богати храни (пиле, риба, яйца)', 'Храни за стабилизиране на кръвната захар', 'Антиоксидантни храни'],
    supplements: [
      { name: 'N-Ацетил Цистеин (NAC)', dosage: '600–1200mg', timing: 'сутрин и вечер — контрол на желанието' },
      { name: 'L-Тирозин', dosage: '500–1000mg', timing: 'сутрин на гладно' },
      { name: 'B-комплекс (метилиран)', dosage: '1 капсула', timing: 'сутрин с хранене' },
      { name: 'Витамин C', dosage: '1000–2000mg', timing: 'сутрин — пушенето изчерпва запасите' },
      { name: 'Магнезиев бисглицинат', dosage: '300–400mg', timing: 'вечер — честа дефицитност при пушачи' }
    ],
    macroModifiers: { carbReduction: 5, proteinIncrease: 5, fatIncrease: 0 },
    dietTypeHint: 'Стабилизираща / Балансирана',
    hacks: [
      '🥕 Дръжте нарязани моркови и целина наготово — заместват оралния рефлекс',
      '🍗 Тирозин от протеини подкрепя допаминовата система след никотина',
      '🩸 Стабилни хранения на 3-4 часа — предотвратяват „сривове" и желание за цигара',
      '💊 NAC намалява желанието за тютюнопушене — доказано в клинични проучвания',
      '💧 Повече вода — помага за детоксикация от никотиновите метаболити'
    ]
  },
  'longevity': {
    id: 'longevity',
    name: 'Дълголетие (Longevity)',
    goalMapping: 'Антиейджинг',
    dietaryGuidelines: 'Времево-ограничено хранене (TRF 16:8); Protein Pacing (пулсиращ mTOR); кетогенни цикли.',
    restrictions: ['Ултрапреработени храни', 'Рафинирани захари', 'Прекомерен протеин (>1.6g/кг)', 'Обгорели/опушени храни'],
    emphasis: ['Кръстоцветни зеленчуци', 'Полифеноли', 'Омега-3 мастни киселини', 'Ферментирали храни', 'Храни стимулиращи автофагия'],
    supplements: [
      { name: 'NMN или NR', dosage: '500–1000mg', timing: 'сутрин на гладно' },
      { name: 'Спермидин', dosage: '1–2mg', timing: 'сутрин — стимулира автофагия' },
      { name: 'Фисетин', dosage: '20mg/kg', timing: 'сенолитик: 2-3 дни месечно' }
    ],
    macroModifiers: { carbReduction: 10, proteinIncrease: 0, fatIncrease: 10 },
    dietTypeHint: 'Периодично гладуване (TRF 16:8) / Кетогенни цикли',
    hacks: [
      '⏰ TRF 16:8 — ядете в 8-часов прозорец за стимулиране на автофагия',
      '🥦 Кръстоцветни зеленчуци ежедневно — сулфорафан за клетъчна защита',
      '🐟 Protein Pacing: разпределете протеина на пулсове за оптимален mTOR баланс',
      '🍇 Полифеноли от тъмни плодове, зелен чай и зехтин за клетъчна младост',
      '🧬 Фисетин 2-3 дни месечно — сенолитик за изчистване на стареещи клетки'
    ]
  },
  'detox': {
    id: 'detox',
    name: 'Детоксикация (Черен дроб и клетки)',
    goalMapping: 'Подобряване на здравето',
    dietaryGuidelines: 'Индуктори на Nrf2 (кръстоцветни зеленчуци); серни съединения (чесън, лук, яйца); фибри >35g/ден.',
    restrictions: ['Алкохол', 'Преработени храни', 'Изкуствени оцветители и консерванти', 'Пържени храни', 'Захар'],
    emphasis: ['Кръстоцветни зеленчуци (броколи, зеле, карфиол)', 'Чесън и лук', 'Яйца', 'Високо фиброви храни (>35g/ден)', 'Цитрусови плодове'],
    supplements: [
      { name: 'NAC (N-Ацетил Цистеин)', dosage: '2 x 600mg', timing: 'сутрин и вечер' },
      { name: 'TUDCA', dosage: '250–500mg', timing: 'с хранене — подобрява жлъчния поток' },
      { name: 'Калциев D-Глюкарат', dosage: '500–1000mg', timing: 'сутрин — естрогенен детокс' },
      { name: 'Силимарин (Бял трън)', dosage: '300–600mg', timing: 'с хранене' },
      { name: 'Глутатион (липозомален)', dosage: '250–500mg', timing: 'на гладно — директен антиоксидант за черния дроб' }
    ],
    macroModifiers: { carbReduction: 0, proteinIncrease: 5, fatIncrease: 0 },
    dietTypeHint: 'Детоксикационна / Високо фиброва',
    hacks: [
      '🥦 Кръстоцветни зеленчуци ежедневно — активират Nrf2 детоксикационния път',
      '🧄 Чесън и лук с всяко хранене — серните съединения поддържат глутатиона',
      '🥚 Яйцата са източник на холин и сяра — ключови за чернодробната детоксикация',
      '💧 Мин. 3 литра вода дневно — критично за бъбречна филтрация',
      '🫘 Фибри над 35г/ден — свързват и извеждат токсините през червата'
    ]
  }
};

/**
 * Get clinical protocol by ID
 * @param {string} protocolId - Protocol identifier
 * @returns {object|null} Protocol object or null
 */
function getClinicalProtocol(protocolId) {
  if (!protocolId) return null;
  return CLINICAL_PROTOCOLS[protocolId] || null;
}

/**
 * Build clinical protocol context section for AI prompts
 * @param {object} protocol - Protocol object from CLINICAL_PROTOCOLS
 * @returns {string} Formatted context string for injection into prompts
 */
function buildClinicalProtocolPromptSection(protocol) {
  if (!protocol) return '';
  
  let section = `
═══ 🏥 КЛИНИЧЕН ПРОТОКОЛ: ${protocol.name} ═══
⚠️ КРИТИЧНО: Този план е за специализирано клинично състояние. Следните насоки са ЗАДЪЛЖИТЕЛНИ и имат ПРИОРИТЕТ над общите препоръки.

📋 ХРАНИТЕЛНИ НАСОКИ (ЗАДЪЛЖИТЕЛНИ):
${protocol.dietaryGuidelines}

✅ АКЦЕНТ ВЪРХУ СЛЕДНИТЕ ХРАНИ/ГРУПИ:
${protocol.emphasis.map(e => `  - ${e}`).join('\n')}

❌ ОГРАНИЧАВАНЕ/ИЗБЯГВАНЕ:
${protocol.restrictions.map(r => `  - ${r}`).join('\n')}

💊 ПРОТОКОЛНА СУПЛЕМЕНТАЦИЯ (ЗАДЪЛЖИТЕЛНА БАЗА):
${protocol.supplements.map(s => `  - ${s.name}: ${s.dosage} | Кога: ${s.timing}`).join('\n')}

🍽️ ПРЕПОРЪЧАН ТИП ДИЕТА: ${protocol.dietTypeHint}
═══════════════════════════════════════════════════════════════
`;
  return section;
}

/**
 * Build clinical protocol supplement section for Step 4 summary prompt
 * @param {object} protocol - Protocol object from CLINICAL_PROTOCOLS
 * @returns {string} Supplement instructions for the summary prompt
 */
function buildClinicalProtocolSupplementSection(protocol) {
  if (!protocol) return '';
  
  let section = `
═══ 💊 ЗАДЪЛЖИТЕЛНИ СУПЛЕМЕНТИ ОТ КЛИНИЧЕН ПРОТОКОЛ ═══
Следните добавки са ЗАДЪЛЖИТЕЛНИ за състоянието "${protocol.name}".
Включи ги в "supplements" масива. Можеш да адаптираш дозировките според възраст, тегло и медикаменти на клиента, но НЕ ги пропускай.

${protocol.supplements.map(s => `ЗАДЪЛЖИТЕЛНА: ${s.name} — Дозировка: ${s.dosage} | Кога: ${s.timing}`).join('\n')}

Можеш да добавиш и допълнителни суплементи базирани на индивидуалния профил, но горните са ЗАДЪЛЖИТЕЛНА БАЗА.
═══════════════════════════════════════════════════════════════
`;
  return section;
}

/**
 * Protocol-specific question field IDs and labels for each clinical protocol.
 * Used to include protocol-specific answers in AI prompts.
 */
const PROTOCOL_SPECIFIC_FIELDS = {
  insulin_resistance: [
    { id: 'bloodSugarLevels', label: 'Измервания на кръвна захар на гладно' },
    { id: 'insulinResistanceSymptoms', label: 'Симптоми на инсулинова резистентност' },
    { id: 'familyDiabetes', label: 'Диабет тип 2 в семейството' }
  ],
  autoimmune_aip: [
    { id: 'autoimmuneDiagnosis', label: 'Автоимунна диагноза' },
    { id: 'autoimmuneFlares', label: 'Честота на обостряния' },
    { id: 'foodSensitivities', label: 'Влошаване при определени храни' },
    { id: 'triggerFoods', label: 'Храни, влошаващи симптомите' }
  ],
  gi_issues: [
    { id: 'giSymptoms', label: 'Стомашно-чревни симптоми' },
    { id: 'bowelFrequency', label: 'Честота на изхождане' },
    { id: 'giTriggers', label: 'Храни, влошаващи симптомите' }
  ],
  menopause_sarcopenia: [
    { id: 'menopauseStatus', label: 'Фаза на менопаузата' },
    { id: 'menopauseSymptoms', label: 'Симптоми на менопаузата' },
    { id: 'strengthTraining', label: 'Силови тренировки' }
  ],
  cellulite_reduction: [
    { id: 'celluliteAreas', label: 'Области с целулит' },
    { id: 'waterRetention', label: 'Задържане на течности' },
    { id: 'sedentaryHours', label: 'Часове в седнало положение дневно' }
  ],
  chronic_stress: [
    { id: 'stressSources', label: 'Източници на стрес' },
    { id: 'stressSymptoms', label: 'Симптоми на хроничен стрес' },
    { id: 'relaxationPractices', label: 'Техники за релаксация' }
  ],
  postpartum_lactation: [
    { id: 'postpartumStatus', label: 'Фаза след раждане' },
    { id: 'breastfeedingFrequency', label: 'Честота на кърмене' },
    { id: 'postpartumGoal', label: 'Цел след раждане' }
  ],
  visceral_fat: [
    { id: 'waistCircumference', label: 'Обиколка на талията (см)' },
    { id: 'fatDistribution', label: 'Разпределение на мазнините' },
    { id: 'metabolicSyndrome', label: 'Компоненти на метаболитния синдром' }
  ],
  post_smoking: [
    { id: 'smokingHistory', label: 'Продължителност на тютюнопушене' },
    { id: 'quitDuration', label: 'Период без цигари' },
    { id: 'cravingsTriggers', label: 'Тригери за желание за цигара' },
    { id: 'weightGainConcern', label: 'Притеснение от наддаване на тегло' }
  ],
  longevity: [
    { id: 'fastingExperience', label: 'Опит с периодично гладуване' },
    { id: 'longevityGoals', label: 'Приоритетни аспекти на дълголетието' },
    { id: 'currentSupplements', label: 'Добавки за дълголетие' },
    { id: 'longevitySupplDetails', label: 'Детайли за добавките за дълголетие' }
  ],
  detox: [
    { id: 'detoxReason', label: 'Причина за детокс програма' },
    { id: 'toxinExposure', label: 'Излагане на токсини' },
    { id: 'liverSymptoms', label: 'Симптоми свързани с черния дроб' }
  ]
};

/**
 * Build a formatted text of protocol-specific answers from user data.
 * @param {object} data - User data containing protocol-specific field answers
 * @returns {string} Formatted text or empty string if no answers found
 */
function buildProtocolSpecificAnswersText(data) {
  if (!data.clinicalProtocol) return '';
  const fields = PROTOCOL_SPECIFIC_FIELDS[data.clinicalProtocol];
  if (!fields) return '';
  const lines = [];
  for (const field of fields) {
    const value = data[field.id];
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
    lines.push(`${field.label}: ${displayValue}`);
  }
  return lines.join('\n');
}

/**
 * Build combined additional notes: merges user's free-text additionalNotes with
 * any protocol-specific answers. If both exist, they are concatenated.
 * If only one exists, that one is returned. If neither, returns empty string.
 * @param {object} data - User data
 * @returns {string} Combined notes text
 */
function buildCombinedAdditionalNotes(data) {
  const specificAnswers = buildProtocolSpecificAnswersText(data);
  const dynamicSubAnswers = buildDynamicSubQuestionsText(data);
  const conditionDetails = buildConditionDetailsText(data);
  const baseNotes = data.additionalNotes || '';
  
  const sections = [];
  if (baseNotes) sections.push(baseNotes);
  if (conditionDetails) sections.push(`[Детайли за здравословни състояния]\n${conditionDetails}`);
  if (specificAnswers) sections.push(`[Специфични данни за клиничен протокол]\n${specificAnswers}`);
  if (dynamicSubAnswers) sections.push(`[Допълнителни клинични отговори]\n${dynamicSubAnswers}`);
  
  return sections.join('\n\n');
}

/**
 * Build formatted text from condition group detail fields (from questionnaire2 CONDITION_GROUPS dropdowns).
 * These are the specific sub-condition selections for cardiovascular, endocrine, digestive,
 * metabolic, and musculoskeletal groups — collected by questionnaire2 but not included in the
 * main medicalConditions array, so they need to be surfaced separately to the AI.
 * @param {object} data - User data
 * @returns {string} Formatted text or empty string
 */
function buildConditionDetailsText(data) {
  const CONDITION_DETAIL_LABELS = {
    'medicalConditions_Сърдечно-съдови_детайл': 'Сърдечно-съдово заболяване',
    'medicalConditions_Ендокринни_детайл': 'Ендокринно заболяване',
    'medicalConditions_Храносмилателни_детайл': 'Храносмилателен проблем',
    'medicalConditions_Метаболитни_детайл': 'Метаболитно нарушение',
    'medicalConditions_Мускулно-скелетни_детайл': 'Мускулно-скелетно заболяване',
  };
  const lines = [];
  for (const [key, label] of Object.entries(CONDITION_DETAIL_LABELS)) {
    const val = data[key];
    if (val && String(val).trim()) {
      lines.push(`${label}: ${String(val).trim()}`);
    }
  }
  return lines.join('\n');
}

/**
 * Build formatted text from dynamic sub-question answers (dq_* fields).
 * These are condition×goal specific questions from questionnaire2.
 * @param {object} data - User data
 * @returns {string} Formatted text or empty string
 */
function buildDynamicSubQuestionsText(data) {
  const textMap = data._dq_text_map || {};
  const lines = [];
  for (const key of Object.keys(data)) {
    if (!key.startsWith('dq_')) continue;
    const value = data[key];
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
    const questionText = textMap[key];
    if (questionText) {
      lines.push(`Въпрос: ${questionText}\nОтговор: ${displayValue}`);
    } else {
      lines.push(`${key}: ${displayValue}`);
    }
  }
  return lines.join('\n\n');
}

/**
 * Calculate BMR using Mifflin-St Jeor Equation
 * Men: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) + 5
 * Women: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) - 161
 * 
 * NOTE (2026-02-03): This function is DEPRECATED for primary calorie calculation.
 * AI model now calculates BMR/TDEE/calories holistically considering ALL correlates.
 * This function is kept ONLY for:
 * - Safety validation (ensure AI values are reasonable)
 * - Fallback if AI calculation fails
 * - Testing and comparison purposes
 * 
 * IMPORTANT: Never returns default values - all calculations are individualized
 * If required data is missing, throws an error to ensure proper data collection
 */
function calculateBMR(data) {
  if (!data.weight || !data.height || !data.age || !data.gender) {
    throw new Error('Cannot calculate BMR: Missing required data (weight, height, age, or gender). All calculations must be individualized.');
  }
  
  const weight = parseFloat(data.weight);
  const height = parseFloat(data.height);
  const age = parseFloat(data.age);
  
  if (isNaN(weight) || isNaN(height) || isNaN(age) || weight <= 0 || height <= 0 || age <= 0) {
    throw new Error('Cannot calculate BMR: Invalid numerical values for weight, height, or age.');
  }
  
  let bmr = 10 * weight + 6.25 * height - 5 * age;
  
  if (data.gender === 'Мъж') {
    bmr += 5;
  } else if (data.gender === 'Жена') {
    bmr -= 161;
  } else {
    throw new Error('Cannot calculate BMR: Gender must be specified as "Мъж" or "Жена".');
  }
  
  return Math.round(bmr);
}

/**
 * Calculate unified activity score (1-10 scale) - Issue #7 Resolution
 * Combines daily activity level (1-3) with sport/exercise frequency (0-7 days/week)
 * 
 * Scale interpretation:
 * - dailyActivityLevel: "Ниско"=1, "Средно"=2, "Високо"=3
 * - sportActivity: Extract days per week from string (0-7)
 * - Combined score = dailyActivityLevel + min(sportDays, 7)
 * 
 * Examples:
 * - Високо (3) + Ниска 1-2 дни (1.5avg) → ~4.5 → 5
 * - Ниско (1) + Средна 2-4 дни (3avg) → ~4
 * - Средно (2) + Висока 5-7 дни (6avg) → ~8
 */
function calculateUnifiedActivityScore(data) {
  // Map daily activity level to 1-3 scale
  const dailyActivityMap = {
    'Ниско': 1,
    'Средно': 2,
    'Високо': 3
  };
  
  const dailyScore = dailyActivityMap[data.dailyActivityLevel] || 2;
  
  // Extract sport days from sportActivity string
  // Using midpoint values for ranges: 1-2 days → 1.5, 2-4 days → 3, 5-7 days → 6
  const SPORT_DAYS_LOW = 1.5;    // Average of 1-2 days range
  const SPORT_DAYS_MEDIUM = 3;   // Average of 2-4 days range  
  const SPORT_DAYS_HIGH = 6;     // Average of 5-7 days range
  
  let sportDays = 0;
  if (data.sportActivity) {
    const sportStr = data.sportActivity;
    if (sportStr.includes('0 дни')) sportDays = 0;
    else if (sportStr.includes('1–2 дни')) sportDays = SPORT_DAYS_LOW;
    else if (sportStr.includes('2–4 дни')) sportDays = SPORT_DAYS_MEDIUM;
    else if (sportStr.includes('5–7 дни')) sportDays = SPORT_DAYS_HIGH;
  }
  
  // Combined score: 1-10 scale
  const combinedScore = Math.min(10, Math.max(1, dailyScore + sportDays));
  
  return {
    dailyScore,
    sportDays,
    combinedScore: Math.round(combinedScore * 10) / 10, // Round to 1 decimal
    activityLevel: combinedScore <= 3 ? 'Ниска' : 
                   combinedScore <= 6 ? 'Средна' : 
                   combinedScore <= 8 ? 'Висока' : 'Много висока'
  };
}

/**
 * Calculate TDEE (Total Daily Energy Expenditure) based on unified activity score
 * Updated multipliers based on 1-10 activity scale - Issue #7 & #10 Resolution
 * 
 * NOTE (2026-02-06): Updated to use unified activity score (1-10)
 * Maximum caloric deficit capped at 25% per Issue #9
 * AI model now calculates TDEE holistically. Kept for validation/fallback only.
 */
function calculateTDEE(bmr, activityLevel) {
  // Legacy support: if activityLevel is string, use old multipliers
  if (typeof activityLevel === 'string') {
    const activityMultipliers = {
      'Никаква (0 дни седмично)': 1.2,
      'Ниска (1–2 дни седмично)': 1.375,
      'Средна (2–4 дни седмично)': 1.55,
      'Висока (5–7 дни седмично)': 1.725,
      'Много висока (атлети)': 1.9,
      'default': 1.4
    };
    const multiplier = activityMultipliers[activityLevel] || activityMultipliers['default'];
    return Math.round(bmr * multiplier);
  }
  
  // New unified score-based multipliers (1-10 scale)
  // Smoother progression for more accurate TDEE calculation
  const scoreMultipliers = {
    1: 1.2,    // Sedentary
    2: 1.3,
    3: 1.375,  // Light
    4: 1.45,
    5: 1.525,
    6: 1.6,    // Moderate
    7: 1.675,
    8: 1.75,   // Very active
    9: 1.85,
    10: 1.95   // Extremely active
  };
  
  const score = Math.round(activityLevel);
  const multiplier = scoreMultipliers[score] || scoreMultipliers[5];
  return Math.round(bmr * multiplier);
}

/**
 * Calculate BMI (Body Mass Index)
 * BMI = weight(kg) / (height(m))^2
 */
function calculateBMI(data) {
  if (!data.weight || !data.height) {
    return null;
  }
  
  const weight = parseFloat(data.weight);
  const heightInMeters = parseFloat(data.height) / 100; // Convert cm to meters
  
  return weight / (heightInMeters * heightInMeters);
}

/**
 * Calculate macronutrient ratios - Issue #2 & #28 Resolution
 * Non-circular formula based on percentage distribution
 * Gender-specific protein requirements
 * 
 * NOTE (2026-02-06): This provides baseline ratios for reference.
 * AI model should see and validate/adjust these based on individual factors.
 * 
 * @param {Object} data - User data with weight, gender, goal
 * @param {number} activityScore - Unified activity score (1-10)
 * @param {number} tdee - Total Daily Energy Expenditure (optional, for accurate %)
 * @returns {{protein: number, carbs: number, fats: number, proteinGramsPerKg: number}} - protein/carbs/fats are percentages that sum to 100, proteinGramsPerKg is g/kg
 */
function calculateMacronutrientRatios(data, activityScore, tdee = null) {
  const weight = parseFloat(data.weight) || 70;
  const gender = data.gender;
  const goal = data.goal || '';
  
  // Base protein needs (g/kg body weight)
  // Women generally need slightly less due to lower muscle mass
  // Men need more for muscle maintenance/growth
  let proteinPerKg;
  if (gender === 'Мъж') {
    proteinPerKg = activityScore >= 7 ? 2.0 : activityScore >= 5 ? 1.6 : 1.2;
  } else { // Жена
    proteinPerKg = activityScore >= 7 ? 1.8 : activityScore >= 5 ? 1.4 : 1.0;
  }
  
  // Adjust for goal
  if (goal.includes('Мускулна маса')) {
    proteinPerKg *= 1.2;
  } else if (goal.includes('Отслабване')) {
    proteinPerKg *= 1.1; // Slightly more protein to preserve muscle
  }
  
  // Calculate protein grams needed
  const proteinGrams = weight * proteinPerKg;
  
  // Protein has 4 cal/g
  // Use provided TDEE if available, otherwise estimate based on weight/gender
  const estimatedCalories = tdee || (gender === 'Мъж' ? weight * 30 : weight * 28);
  const proteinCalories = proteinGrams * 4;
  let proteinPercent = Math.round((proteinCalories / estimatedCalories) * 100);
  
  // Distribute remaining calories between carbs and fats
  // Higher activity = more carbs for energy
  // Lower activity = more fats for satiety
  const remainingPercent = 100 - proteinPercent;
  let carbsPercent, fatsPercent;
  
  if (activityScore >= 7) {
    // Very active: prioritize carbs for energy
    carbsPercent = Math.round(remainingPercent * 0.6);
    fatsPercent = remainingPercent - carbsPercent;
  } else if (activityScore >= 4) {
    // Moderate: balanced
    carbsPercent = Math.round(remainingPercent * 0.5);
    fatsPercent = remainingPercent - carbsPercent;
  } else {
    // Low activity: prioritize fats for satiety
    carbsPercent = Math.round(remainingPercent * 0.4);
    fatsPercent = remainingPercent - carbsPercent;
  }
  
  // Apply clinical protocol macro modifiers if present
  const protocol = getClinicalProtocol(data.clinicalProtocol);
  if (protocol && protocol.macroModifiers) {
    const mod = protocol.macroModifiers;
    carbsPercent = Math.max(15, carbsPercent - (mod.carbReduction || 0));
    proteinPercent = proteinPercent + (mod.proteinIncrease || 0);
    fatsPercent = fatsPercent + (mod.fatIncrease || 0);
  }
  
  // Ensure ratios sum to exactly 100%
  const total = proteinPercent + carbsPercent + fatsPercent;
  if (total !== 100) {
    fatsPercent += (100 - total); // Adjust fats to make it exactly 100
  }
  
  return {
    protein: proteinPercent,
    carbs: carbsPercent,
    fats: fatsPercent,
    proteinGramsPerKg: Math.round(proteinPerKg * 10) / 10
  };
}

/**
 * Calculate safe caloric deficit - Issue #9 Resolution
 * Maximum 25% deficit, but AI can adjust for specific strategies
 * 
 * @returns {{targetCalories: number, deficitPercent: number, maxDeficitCalories: number, note?: string}}
 */
function calculateSafeDeficit(tdee, goal) {
  const MAX_DEFICIT_PERCENT = 0.25; // 25% maximum
  
  if (!goal || !goal.includes('Отслабване')) {
    return {
      targetCalories: tdee,
      deficitPercent: 0,
      maxDeficitCalories: tdee
    };
  }
  
  // Conservative deficit: 15-20% for most people
  const standardDeficit = 0.18;
  const targetCalories = Math.round(tdee * (1 - standardDeficit));
  const maxDeficitCalories = Math.round(tdee * (1 - MAX_DEFICIT_PERCENT));
  
  return {
    targetCalories,
    deficitPercent: standardDeficit * 100,
    maxDeficitCalories,
    note: 'AI може да коригира при специални стратегии (напр. интермитентно гладуване)'
  };
}

/**
 * Validate data adequacy - check for unrealistic, inappropriate, or invalid data
 * Returns an object with { isValid: boolean, errorMessage: string }
 */
function validateDataAdequacy(data, config) {
  const errors = [];
  // Use admin-configurable thresholds, fall back to hardcoded defaults
  const dv = (config && config.dataValidation) ? config.dataValidation : DEFAULT_VALIDATION_CONFIG.dataValidation;
  const minAge = dv.minAge ?? MIN_AGE;
  const maxAge = dv.maxAge ?? MAX_AGE;
  const minWeightKg = dv.minWeightKg ?? MIN_WEIGHT_KG;
  const maxWeightKg = dv.maxWeightKg ?? MAX_WEIGHT_KG;
  const minHeightCm = dv.minHeightCm ?? MIN_HEIGHT_CM;
  const maxHeightCm = dv.maxHeightCm ?? MAX_HEIGHT_CM;
  const minBmi = dv.minBmi ?? MIN_BMI;
  const maxBmi = dv.maxBmi ?? MAX_BMI;
  const maxWeightLossKg = dv.maxWeightLossKg ?? MAX_WEIGHT_LOSS_KG;
  const maxWeightLossPercent = dv.maxWeightLossPercent ?? MAX_WEIGHT_LOSS_PERCENT;

  // Check weight (realistic range)
  const weight = parseFloat(data.weight);
  if (isNaN(weight) || weight < minWeightKg || weight > maxWeightKg) {
    errors.push(`Теглото трябва да бъде между ${minWeightKg} и ${maxWeightKg} кг. Моля, въведете реалистична стойност.`);
  }
  
  // Check height (realistic range)
  const height = parseFloat(data.height);
  if (isNaN(height) || height < minHeightCm || height > maxHeightCm) {
    errors.push(`Височината трябва да бъде между ${minHeightCm} и ${maxHeightCm} см. Моля, въведете реалистична стойност.`);
  }
  
  // Check age (realistic range)
  const age = parseInt(data.age);
  if (isNaN(age) || age < minAge || age > maxAge) {
    errors.push(`Възрастта трябва да бъде между ${minAge} и ${maxAge} години. Моля, въведете реалистична стойност.`);
  }

  // Block users under 13 (GDPR Article 8 / COPPA compliance)
  if (!isNaN(age) && age < 13) {
    errors.push('Услугата е достъпна само за лица на 13 или повече години. Потребители под 13 г. не могат да ползват приложението.');
  }

  // Note for minors between 13-18
  if (!isNaN(age) && age >= 13 && age < 18) {
    console.warn(`Minor user (age ${age}) - parental consent required per Terms of Service`);
  }
  
  // Check BMI extremes (medically unrealistic BMI values)
  if (!isNaN(weight) && !isNaN(height) && weight >= minWeightKg && weight <= maxWeightKg && height >= minHeightCm && height <= maxHeightCm) {
    const heightM = height / 100;
    const bmi = weight / (heightM * heightM);
    if (bmi < minBmi) {
      errors.push('Въведените данни водят до медицински невъзможно ниско BMI. Моля, проверете теглото и височината.');
    } else if (bmi > maxBmi) {
      errors.push('Въведените данни водят до медицински невъзможно високо BMI. Моля, проверете теглото и височината.');
    }
  }
  
  // Check weight loss goal reasonableness
  if (data.goal && data.goal.includes('Отслабване') && data.lossKg) {
    const lossKg = parseFloat(data.lossKg);
    if (!isNaN(lossKg) && !isNaN(weight)) {
      if (lossKg > weight * maxWeightLossPercent) {
        errors.push(`Целевото отслабване е твърде голямо (повече от ${maxWeightLossPercent * 100}% от телесното тегло). Моля, задайте по-реалистична цел.`);
      }
      if (lossKg > maxWeightLossKg) {
        errors.push(`Целевото отслабване не може да надвишава ${maxWeightLossKg} кг в рамките на един план. Моля, задайте по-умерена начална цел.`);
      }
    }
  }
  
  // Check for offensive or vulgar content in text fields
  const textFields = [
    { field: 'name', value: data.name },
    { field: 'dietDislike', value: data.dietDislike },
    { field: 'dietLove', value: data.dietLove },
    { field: 'additionalNotes', value: data.additionalNotes },
    { field: 'medicationsDetails', value: data.medicationsDetails },
    { field: 'weightChangeDetails', value: data.weightChangeDetails }
  ];
  
  for (const { field, value } of textFields) {
    if (value && typeof value === 'string') {
      for (const pattern of OFFENSIVE_PATTERNS) {
        if (pattern.test(value)) {
          // Generic error message for security (don't reveal which field)
          errors.push('Въведената информация съдържа неподходящо съдържание. Моля, проверете всички полета и въведете коректна информация.');
          // Log specific field server-side for monitoring
          console.warn(`Offensive content detected in field: ${field}`);
          break; // Only report once per validation
        }
      }
      // If we found offensive content, stop checking other fields
      if (errors.some(e => e.includes('неподходящо съдържание'))) {
        break;
      }
    }
  }
  
  if (errors.length > 0) {
    return {
      isValid: false,
      errorMessage: 'Моля, проверете въведените данни:\n\n' + errors.join('\n\n')
    };
  }
  
  return { isValid: true };
}

/**
 * Detect goal contradictions (e.g., underweight person wanting to lose weight)
 * Returns an object with { hasContradiction: boolean, canProceed: boolean, warningData: object }
 * canProceed reflects admin-configured severity: true = advisory warning, false = hard block
 */
function detectGoalContradiction(data, config) {
  const bmi = calculateBMI(data);
  
  if (!bmi || !data.goal) {
    return { hasContradiction: false, canProceed: true };
  }
  
  // BMI categories:
  // < 16: Severely underweight
  // 16-18.5: Underweight
  // 18.5-25: Normal weight
  // 25-30: Overweight
  // > 30: Obese
  
  let hasContradiction = false;
  let warningData = {};
  
  // Use admin-configurable rules, fall back to defaults
  const rules = (config && config.contradictionRules) ? config.contradictionRules : DEFAULT_VALIDATION_CONFIG.contradictionRules;
  const uwRule = rules.underweightLoss ?? DEFAULT_VALIDATION_CONFIG.contradictionRules.underweightLoss;
  const thyRule = rules.thyroidAggressiveDeficit ?? DEFAULT_VALIDATION_CONFIG.contradictionRules.thyroidAggressiveDeficit;
  const anemiaRule = rules.anemiaPlanBased ?? DEFAULT_VALIDATION_CONFIG.contradictionRules.anemiaPlanBased;

  // Normalize goal for comparison (case-insensitive, trimmed)
  const normalizedGoal = (data.goal || '').toLowerCase().trim();
  
  // Check for severe underweight with weight loss goal
  // Use includes() for more flexible matching
  const bmiThreshold = uwRule.bmiThreshold ?? 18.5;
  if (uwRule.enabled !== false && bmi < bmiThreshold && normalizedGoal.includes('отслабване')) {
    hasContradiction = true;
    warningData = {
      type: 'underweight_loss',
      canProceed: uwRule.canProceed !== false,
      bmi: bmi.toFixed(1),
      currentCategory: bmi < 16 ? 'Значително поднормено тегло' : 'Поднормено тегло',
      goalCategory: data.goal, // Use original goal text from user
      risks: [
        'Недохранване и дефицит на важни хранителни вещества',
        'Отслабване на имунната система',
        'Загуба на мускулна маса и костна плътност',
        'Хормонален дисбаланс',
        'Повишен риск от здравословни усложнения'
      ],
      recommendation: 'При вашето текущо тегло целта за отслабване е медицински неподходяща и опасна. Препоръчваме да консултирате лекар и да работите за постигане на здравословно тегло чрез балансирано хранене.'
    };
  }
  
  // Note: Overweight + muscle gain goal is NOT blocked.
  // Body recomposition (gaining muscle while losing fat) is a valid and common fitness goal
  // regardless of current BMI. The AI plan will naturally guide the user appropriately.
  
  // Check for dangerous combinations with medical conditions
  if (!hasContradiction && data.medicalConditions && Array.isArray(data.medicalConditions)) {
    // Check for thyroid conditions + aggressive caloric deficit
    // Also check the autoimmune detail field — a user who selected "Автоимунни заболявания"
    // and picked "Хашимото (тиреоидит)" from the dropdown has medicalConditions = ['Автоимунно']
    // (no 'Хашимото' in the array itself), so we must inspect the detail field too.
    const hasThyroidCondition = data.medicalConditions.some(c =>
        c.includes('Щитовидна жлеза') || c.includes('Хипотиреоидизъм') || c.includes('Хашимото')
      ) || (data['medicalConditions_Автоимунно'] && data['medicalConditions_Автоимунно'].toLowerCase().includes('хашимото'));
    // Weight loss with thyroid conditions: only flag if user requests an extreme deficit
    // (more than the configured floor below TDEE).
    // A standard 15% deficit is safe and should NOT be blocked.
    if (thyRule.enabled !== false && hasThyroidCondition && normalizedGoal.includes('отслабване')) {
      const tdee = calculateTDEE(calculateBMR(data), data.sportActivity);
      const requestedCalories = data.targetCalories ? parseFloat(data.targetCalories) : null;
      const tdeeFloor = thyRule.tdeeFloor ?? 0.75;
      const minimumSafeCalories = tdee * tdeeFloor;
      
      // Only block if the user has explicitly requested a caloric intake below the safe floor
      if (requestedCalories !== null && !isNaN(requestedCalories) && requestedCalories < minimumSafeCalories) {
        hasContradiction = true;
        warningData = {
          type: 'thyroid_aggressive_deficit',
          canProceed: thyRule.canProceed !== false,
          bmi: bmi.toFixed(1),
          currentCategory: 'Щитовидна дисфункция',
          goalCategory: data.goal,
          risks: [
            'Влошаване на метаболизма и хормоналния баланс',
            'Повишена умора и изтощение',
            'Допълнително забавяне на щитовидната функция'
          ],
          recommendation: 'При щитовидни проблеми е необходим много внимателен подход към отслабването. Препоръчваме медицинска консултация преди стартиране на диета с калориен дефицит.'
        };
      }
    }
    
    // Check for PCOS + high carb approach - validation handled in analysis
    if (data.medicalConditions.includes('PCOS') || data.medicalConditions.includes('СПКЯ') ||
        data.medicalConditions.includes('Ендокринни') ||
        (data.medicalConditions_Ендокринни_детайл && data.medicalConditions_Ендокринни_детайл.includes('поликистозни'))) {
      // PCOS patients typically need lower carb approach - this will be flagged in analysis
      // No contradiction here, but AI should be aware via analysis prompt
    }
    
    // Check for anemia + vegetarian/vegan diet without iron awareness
    if (anemiaRule.enabled !== false &&
        data.medicalConditions.includes('Анемия') && 
        data.dietPreference && 
        (data.dietPreference.includes('Вегетарианска') || data.dietPreference.includes('Веган'))) {
      hasContradiction = true;
      warningData = {
        type: 'anemia_plant_based',
        canProceed: anemiaRule.canProceed !== false,
        bmi: bmi.toFixed(1),
        currentCategory: 'Анемия',
        goalCategory: data.goal,
        risks: [
          'Влошаване на анемията поради ниско усвояване на растително желязо',
          'Хронична умора и отслабване',
          'Имунна дисфункция'
        ],
        recommendation: 'При анемия и вегетарианска/веган диета е критично важно да се осигури достатъчно желязо чрез добавки и оптимизирано хранене. Задължителна е медицинска консултация и наблюдение на нивата на желязо.'
      };
    }
  }
  
  // Note: Sleep deprivation + muscle gain is NOT blocked.
  // Poor sleep does hinder muscle growth, but blocking plan generation is too restrictive.
  // The AI plan will include sleep-improvement recommendations as part of the advice.
  
  return { hasContradiction, canProceed: warningData.canProceed ?? true, warningData };
}

/**
 * AI-powered validation of questionnaire data.
 * Checks for unrealistic, dangerous, unhealthy, risky, illogical goals,
 * as well as contradictory or mismatching information.
 * Returns { hasIssues: boolean, issues: Array<{category, description, severity}> }
 */
async function performAIValidation(env, data) {
  const weight = parseFloat(data.weight) || 0;
  const height = parseFloat(data.height) || 0;
  const age = parseInt(data.age) || 0;
  const heightM = height / 100;
  const bmi = (heightM > 0) ? (weight / (heightM * heightM)).toFixed(1) : 'N/A';
  
  const medicalConditions = Array.isArray(data.medicalConditions) 
    ? data.medicalConditions.join(', ') 
    : (data.medicalConditions || 'Няма посочени');

  const dietHistorySection = data.dietHistory === 'Да' && (data.dietType || data.dietResult)
    ? `- Минала диета: ${data.dietType || 'Не е посочен тип'} | Резултат: ${data.dietResult || 'Не е посочен'}`
    : `- Минала диета: Не е спазвал/а диета`;

  const userData = `ДАННИ НА ПОТРЕБИТЕЛЯ:
- Име: ${data.name || 'Не е посочено'}
- Възраст: ${age} години
- Пол: ${data.gender || 'Не е посочен'}
- Тегло: ${weight} кг
- Височина: ${height} см
- BMI: ${bmi}
- Цел: ${data.goal || 'Не е посочена'}
- Целево отслабване: ${data.lossKg ? data.lossKg + ' кг' : 'Не е посочено'}
- Медицински състояния: ${medicalConditions}
- Медикаменти: ${data.medicationsDetails || 'Няма'}
- Спортна активност: ${data.sportActivity || 'Не е посочена'}
- Часове сън: ${data.sleepHours || 'Не е посочено'}
- Диетични предпочитания: ${Array.isArray(data.dietPreference) ? data.dietPreference.join(', ') : (data.dietPreference || 'Няма')}
- Храни, които обича: ${data.dietLove || 'Не е посочено'}
- Храни, които не харесва: ${data.dietDislike || 'Не е посочено'}
- Допълнителни бележки: ${data.additionalNotes || 'Няма'}
- История на тегло: ${data.weightChangeDetails || 'Не е посочена'}
${dietHistorySection}`;

  // Load custom prompt from KV (admin-configurable), fall back to built-in default
  const customPromptTemplate = await getCustomPrompt(env, 'admin_validation_prompt');

  let prompt;
  if (customPromptTemplate && customPromptTemplate.trim()) {
    // Replace {userData} placeholder if present; otherwise append user data after the template
    if (customPromptTemplate.includes('{userData}')) {
      prompt = customPromptTemplate.replace('{userData}', userData);
    } else {
      prompt = customPromptTemplate + '\n\n' + userData;
    }
  } else {
    prompt = DEFAULT_VALIDATION_PROMPT_TEMPLATE.replace('{userData}', userData);
  }

  try {
    const aiResponse = await callAIModel(env, prompt, 2000, 'ai_validation', null, null, null, false);
    const parsed = parseAIResponse(aiResponse);
    
    if (parsed && typeof parsed.hasIssues === 'boolean') {
      // Filter only high and medium severity issues
      const validIssues = (parsed.issues || []).filter(
        issue => issue && issue.category && issue.description && 
                 (issue.severity === 'high' || issue.severity === 'medium')
      );
      return {
        hasIssues: validIssues.length > 0,
        issues: validIssues
      };
    }
    
    // If AI response couldn't be parsed, skip validation (don't block user)
    console.warn('AI validation response could not be parsed, skipping validation');
    return { hasIssues: false, issues: [] };
  } catch (error) {
    // If AI validation fails, don't block the user - just skip validation
    console.error('AI validation failed, skipping:', error.message);
    return { hasIssues: false, issues: [] };
  }
}

/**
 * Normalize questionnaire data from any client (web, APK, etc.).
 *
 * The web frontend already serializes checkbox fields correctly before sending,
 * but the APK (and any future client) may send them in a different shape:
 *   - `goal`                : must be a string  (first selected option)
 *   - array checkbox fields : must each be an array
 *
 * Mutates `data` in-place and returns it for convenience.
 *
 * @param {Object} data - Raw request body parsed from JSON
 * @returns {Object} The same object, normalized
 */
function normalizeQuestionnaireData(data) {
  // goal must be a plain string – take the first element when sent as array
  if (Array.isArray(data.goal)) {
    data.goal = String(data.goal[0] || '');
  }

  // All other checkbox fields must be arrays
  const arrayFields = [
    'medicalConditions',
    'dietPreference',
    'eatingHabits',
    'foodCravings',
    'foodTriggers',
    'compensationMethods',
  ];
  for (const field of arrayFields) {
    if (data[field] != null && !Array.isArray(data[field])) {
      // Wrap a bare string in an array; ignore any other unexpected type
      data[field] = typeof data[field] === 'string' ? [data[field]] : [];
    }
  }

  return data;
}

/**
 * Handle questionnaire AI validation endpoint.
 * Called before plan generation to check for issues in user data.
 */
async function handleValidateQuestionnaire(request, env) {
  try {
    const data = normalizeQuestionnaireData(await request.json());
    
    // Validate minimum required fields
    if (!data.name || !data.age || !data.weight || !data.height) {
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_FIELDS }, 400);
    }

    // Load admin-configurable validation thresholds/rules
    const valConfig = await getValidationConfig(env);
    
    // Step 1: Run existing deterministic validations
    const dataValidation = validateDataAdequacy(data, valConfig);
    if (!dataValidation.isValid) {
      return jsonResponse({
        valid: false,
        hasIssues: true,
        canProceed: false,
        issues: [{
          category: 'НЕВАЛИДНИ ДАННИ',
          description: dataValidation.errorMessage,
          severity: 'high'
        }]
      });
    }
    
    // Step 2: Run existing goal contradiction detection
    const { hasContradiction, canProceed: contradictionCanProceed, warningData } = detectGoalContradiction(data, valConfig);
    if (hasContradiction) {
      const issues = [{
        category: 'РИСКОВА КОМБИНАЦИЯ',
        description: warningData.recommendation,
        severity: contradictionCanProceed ? 'medium' : 'high'
      }];
      if (warningData.risks) {
        warningData.risks.forEach(risk => {
          issues.push({
            category: 'ЗДРАВОСЛОВЕН РИСК',
            description: risk,
            severity: 'medium'
          });
        });
      }
      return jsonResponse({
        valid: false,
        hasIssues: true,
        canProceed: contradictionCanProceed,
        issues: issues
      });
    }
    const aiValidation = await performAIValidation(env, data);
    
    if (aiValidation.hasIssues) {
      const canProceed = aiValidation.issues.length > 0 && aiValidation.issues.every(i => i.severity !== 'high');
      return jsonResponse({
        valid: false,
        hasIssues: true,
        canProceed,
        issues: aiValidation.issues
      });
    }
    
    // All checks passed
    return jsonResponse({ valid: true, hasIssues: false, issues: [] });
    
  } catch (error) {
    console.error('Error in questionnaire validation:', error);
    // On error, allow user to proceed (don't block)
    return jsonResponse({ valid: true, hasIssues: false, issues: [] });
  }
}

// Rate limiting configuration for expensive AI endpoints
const RATE_LIMIT = {
  GENERATE_PLAN: { maxRequests: 3, windowSec: 60 },  // 3 plans/min per IP
  CHAT:          { maxRequests: 20, windowSec: 60 },  // 20 messages/min per IP
  FOOD_ANALYSIS: { maxRequests: 10, windowSec: 60 },  // 10 food analyses/min per IP
  VALIDATE_QUESTIONNAIRE: { maxRequests: 8, windowSec: 60 },  // 8 validations/min per IP
  SOCIAL_AUTH:    { maxRequests: 10, windowSec: 60 },   // 10 auth attempts/min per IP
  FORGOT_PASSWORD:{ maxRequests: 5,  windowSec: 900 },  // 5 reset requests per 15 min per IP
};

/**
 * KV-based rate limiter.
 * Returns a 429 Response if the IP exceeds the allowed rate, or null if OK.
 * Uses keys of the form `rl:{endpoint}:{ip}:{windowMinute}` with a 2-minute TTL.
 */
async function checkRateLimit(env, request, endpoint) {
  if (!env.page_content) return null; // KV not available – skip limiting

  const ip = request.headers.get('CF-Connecting-IP')
           || request.headers.get('X-Forwarded-For')
           || 'unknown';

  const config = RATE_LIMIT[endpoint];
  if (!config) return null;

  const window = Math.floor(Date.now() / (config.windowSec * 1000));
  const key = `rl:${endpoint}:${ip}:${window}`;

  try {
    const raw = await env.page_content.get(key);
    const count = raw ? parseInt(raw, 10) : 0;

    if (count >= config.maxRequests) {
      console.warn(`Rate limit exceeded for ${endpoint} by IP ${ip}`);
      return new Response(
        JSON.stringify({ error: 'Твърде много заявки. Моля, изчакайте малко и опитайте отново.', rateLimited: true }),
        { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': String(config.windowSec) } }
      );
    }

    // Increment counter; expire after 2 windows so the key cleans itself up
    await env.page_content.put(key, String(count + 1), { expirationTtl: config.windowSec * 2 });
  } catch (e) {
    // If KV fails for any reason, let the request through rather than blocking users
    console.error('Rate limit KV error (non-blocking):', e.message);
  }

  return null; // OK – proceed
}

// CORS headers for client-side requests
// NOTE: For production, replace '*' with specific allowed domains
// Example: 'https://yourdomain.com, https://www.yourdomain.com'
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // TODO: Restrict to specific domains in production
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
  'Content-Type': 'application/json',
  // Required so that Firebase Authentication popup can post back to the opener
  // window without being blocked by the browser's cross-origin opener policy.
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
};

// Cache for admin configuration to reduce KV reads
let adminConfigCache = null;
let adminConfigCacheTime = 0;
const ADMIN_CONFIG_CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache

// Cache for validation config (thresholds + contradiction rules)
let validationConfigCache = null;
let validationConfigCacheTime = 0;
const VALIDATION_CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// Cache for chat prompts to reduce KV reads
let chatPromptsCache = null;
let chatPromptsCacheTime = 0;
const CHAT_PROMPTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// Cache for food lists (whitelist/blacklist) to reduce KV reads
// These are read 9 times per plan generation (analysis + strategy + 7 meal plan chunks)
// Caching reduces KV operations from 18 to 2 per plan (89% reduction)
let foodListsCache = null;
let foodListsCacheTime = 0;
const FOOD_LISTS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache

// Cache for custom prompts to reduce KV reads
// Custom prompts are read 10 times per plan generation
// Caching reduces KV operations from 10 to 3-4 per plan (70% reduction)
let customPromptsCache = {};
let customPromptsCacheTime = {};
const CUSTOM_PROMPTS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache (prompts rarely change)

// REVOLUTIONARY OPTIMIZATION: Chat context caching
// Cache user context (userData + userPlan) to dramatically reduce payload sizes
// Instead of sending 10-20KB per chat message, send only message + sessionId (~100 bytes)
// Expected reduction: 85-95% in chat request payload size
// Chat context is provided by the client on every request (stateless workers)

// Cache for AI logging enabled/disabled status
// Default is true (logging enabled). Admin can toggle via /api/admin/set-logging-status.
let loggingStatusCache = null; // null = not yet loaded from KV
let loggingStatusCacheTime = 0;
const LOGGING_STATUS_CACHE_TTL = 60 * 1000; // 1 minute cache

// Track logIds per session for deferred combined-index updates.
// logAIRequest() appends each new logId here; finalizeAISessionLogs() reads
// the list once and writes the combined index with a single cacheGet + cacheSet,
// instead of one cacheGet + cacheSet per AI call. Together with the merged
// request+response log entry in logAIResponse(), this reduces Cache API
// subrequests from 4 per callAIModel call to 1.
const pendingSessionLogs = new Map(); // sessionId → [logId, ...]

// Validation constants (moved here to be available early in code)
const DAILY_CALORIE_TOLERANCE = 50; // ±50 kcal tolerance for daily calorie target
const MAX_LATE_SNACK_CALORIES = 200; // Maximum calories allowed for late-night snacks

/**
 * Cache API helper functions for AI logging
 * Cache API is free and doesn't count against KV quotas - perfect for temporary data like logs
 * Cache is automatically distributed across Cloudflare's global network
 * 
 * Note: Cache API in Cloudflare Workers uses the Request/Response pattern
 * We use a consistent domain pattern for cache namespacing
 */

/**
 * Store data in Cache API with specified TTL
 * @param {string} key - Cache key
 * @param {any} data - Data to store (will be JSON stringified)
 * @param {number} ttl - Time to live in seconds (default: 24 hours)
 * @returns {Promise<boolean>} - True if stored successfully, false on error
 * Note: cache.put() may fail silently in edge cases, so this returns true if no error is thrown
 */
async function cacheSet(key, data, ttl = AI_LOG_CACHE_TTL) {
  try {
    const cache = caches.default;
    // Use a consistent cache domain for all AI logs
    // In Cloudflare Workers, cache keys are based on URL patterns
    const url = `https://ai-logs-cache.internal/${key}`;
    const response = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${ttl}`
      }
    });
    await cache.put(url, response);
    return true;
  } catch (error) {
    console.error(`[Cache API] Failed to set key ${key}:`, error);
    return false;
  }
}

/**
 * Retrieve data from Cache API
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} - Parsed data or null if not found/expired
 */
async function cacheGet(key) {
  try {
    const cache = caches.default;
    const url = `https://ai-logs-cache.internal/${key}`;
    const response = await cache.match(url);
    if (!response) {
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`[Cache API] Failed to get key ${key}:`, error);
    return null;
  }
}

/**
 * Delete data from Cache API
 * @param {string} key - Cache key
 * @returns {Promise<boolean>} - True if entry was found and deleted, false if not found (not an error)
 */
async function cacheDelete(key) {
  try {
    const cache = caches.default;
    const url = `https://ai-logs-cache.internal/${key}`;
    const deleted = await cache.delete(url);
    return deleted;
  } catch (error) {
    console.error(`[Cache API] Failed to delete key ${key}:`, error);
    return false;
  }
}

async function kvGetJSON(env, key) {
  if (!env?.page_content) return null;
  try {
    const raw = await env.page_content.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error(`[KV] Failed to get key ${key}:`, error);
    return null;
  }
}

async function kvPutJSON(env, key, data, ttl = AI_LOG_KV_TTL) {
  if (!env?.page_content) return false;
  try {
    const options = ttl ? { expirationTtl: ttl } : undefined;
    await env.page_content.put(key, JSON.stringify(data), options);
    return true;
  } catch (error) {
    console.error(`[KV] Failed to set key ${key}:`, error);
    return false;
  }
}

const PEP_PRODUCTS_KEY = 'pep:products';
const PEP_SALES_KEY = 'pep:sales';
const PEP_UPDATED_AT_KEY = 'pep:updated-at';
let pepD1Initialized = false;

function getPepStorageType(env) {
  if (env?.PEP_DB && typeof env.PEP_DB.prepare === 'function') {
    return 'd1';
  }
  if (env?.page_content) {
    return 'kv';
  }
  return '';
}

function pepNowISO() {
  return new Date().toISOString();
}

function formatPepProductName(baseName, dosage) {
  return `${String(baseName || '').trim()} ${String(dosage || '').trim()}`.trim();
}

function normalizePepProductRow(row) {
  return {
    id: Number(row.id),
    baseName: String(row.baseName ?? row.base_name ?? '').trim(),
    dosage: String(row.dosage ?? '').trim(),
    purchasePrice: Number(row.purchasePrice ?? row.purchase_price ?? 0)
  };
}

function normalizePepSaleRow(row) {
  return {
    id: Number(row.id),
    productId: Number(row.productId ?? row.product_id),
    productName: String(row.productName ?? row.product_name ?? '').trim(),
    quantity: Number(row.quantity ?? 0),
    multiplier: Number(row.multiplier ?? 0),
    comment: String(row.comment ?? ''),
    date: String(row.date ?? row.sale_date ?? ''),
    revenue: Number(row.revenue ?? 0),
    cost: Number(row.cost ?? 0)
  };
}

function buildPepSaleRecord(product, data, forcedId = null) {
  const quantity = Number.parseInt(data.quantity, 10);
  const multiplier = Number(data.multiplier);
  if (!product || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error('Невалидни данни за продажбата');
  }

  const unitPrice = Number(product.purchasePrice);
  const cost = Number((unitPrice * quantity).toFixed(2));
  const revenue = multiplier === 1 ? 0 : Number((unitPrice * multiplier * quantity).toFixed(2));

  return {
    ...(forcedId == null ? {} : { id: Number(forcedId) }),
    productId: Number(product.id),
    productName: formatPepProductName(product.baseName, product.dosage),
    quantity,
    multiplier,
    comment: String(data.comment || '').trim(),
    date: String(data.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    revenue,
    cost
  };
}

async function ensurePepD1Schema(env) {
  if (pepD1Initialized || getPepStorageType(env) !== 'd1') {
    return;
  }

  await env.PEP_DB.exec(`
    CREATE TABLE IF NOT EXISTS pep_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_name TEXT NOT NULL,
      dosage TEXT NOT NULL,
      purchase_price REAL NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(base_name, dosage)
    );
    CREATE TABLE IF NOT EXISTS pep_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      multiplier REAL NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      sale_date TEXT NOT NULL,
      revenue REAL NOT NULL,
      cost REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES pep_products(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS pep_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  pepD1Initialized = true;
}

async function pepD1SetUpdatedAt(env, updatedAt = pepNowISO()) {
  await ensurePepD1Schema(env);
  await env.PEP_DB.prepare(`
    INSERT INTO pep_meta (key, value) VALUES ('updated_at', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(updatedAt).run();
  return updatedAt;
}

async function pepD1GetUpdatedAt(env) {
  await ensurePepD1Schema(env);
  const row = await env.PEP_DB.prepare(`SELECT value FROM pep_meta WHERE key = 'updated_at'`).first();
  return row?.value || null;
}

async function pepD1ListProducts(env) {
  await ensurePepD1Schema(env);
  const result = await env.PEP_DB.prepare(`
    SELECT id, base_name AS baseName, dosage, purchase_price AS purchasePrice
    FROM pep_products
    ORDER BY LOWER(base_name), LOWER(dosage), id
  `).all();
  return (result.results || []).map(normalizePepProductRow);
}

async function pepD1ListSales(env) {
  await ensurePepD1Schema(env);
  const result = await env.PEP_DB.prepare(`
    SELECT id, product_id AS productId, product_name AS productName, quantity, multiplier,
           comment, sale_date AS date, revenue, cost
    FROM pep_sales
    ORDER BY sale_date DESC, id DESC
  `).all();
  return (result.results || []).map(normalizePepSaleRow);
}

async function pepD1InsertProduct(env, product) {
  await ensurePepD1Schema(env);
  const normalized = normalizePepProductRow(product);
  const createdAt = pepNowISO();
  const inserted = await env.PEP_DB.prepare(`
    INSERT INTO pep_products (base_name, dosage, purchase_price, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(normalized.baseName, normalized.dosage, normalized.purchasePrice, createdAt).run();

  return {
    id: Number(inserted.meta?.last_row_id),
    baseName: normalized.baseName,
    dosage: normalized.dosage,
    purchasePrice: normalized.purchasePrice
  };
}

async function pepD1UpdateProduct(env, productId, updates) {
  await ensurePepD1Schema(env);
  const existing = await env.PEP_DB.prepare(`
    SELECT id, base_name AS baseName, dosage, purchase_price AS purchasePrice
    FROM pep_products
    WHERE id = ?
  `).bind(Number(productId)).first();

  if (!existing) {
    throw new Error(ERROR_MESSAGES.NOT_FOUND);
  }

  const duplicate = await env.PEP_DB.prepare(`
    SELECT id FROM pep_products
    WHERE lower(base_name) = lower(?) AND lower(dosage) = lower(?) AND id != ?
  `).bind(updates.baseName, updates.dosage, Number(productId)).first();

  if (duplicate) {
    throw new Error('Този продукт вече съществува в каталога');
  }

  await env.PEP_DB.prepare(`
    UPDATE pep_products
    SET base_name = ?, dosage = ?, purchase_price = ?
    WHERE id = ?
  `).bind(updates.baseName, updates.dosage, updates.purchasePrice, Number(productId)).run();

  const product = normalizePepProductRow({
    id: productId,
    baseName: updates.baseName,
    dosage: updates.dosage,
    purchasePrice: updates.purchasePrice
  });

  return product;
}

async function pepD1DeleteProduct(env, productId) {
  await ensurePepD1Schema(env);
  const existing = await env.PEP_DB.prepare(`SELECT id FROM pep_products WHERE id = ?`).bind(Number(productId)).first();
  if (!existing) {
    throw new Error(ERROR_MESSAGES.NOT_FOUND);
  }

  // Keep historical sales unchanged; only remove the product from the catalog.
  await env.PEP_DB.exec('PRAGMA foreign_keys = OFF');
  await env.PEP_DB.prepare(`DELETE FROM pep_products WHERE id = ?`).bind(Number(productId)).run();
  await env.PEP_DB.exec('PRAGMA foreign_keys = ON');
}

async function pepD1InsertSale(env, saleInput) {
  await ensurePepD1Schema(env);
  const productRow = await env.PEP_DB.prepare(`
    SELECT id, base_name AS baseName, dosage, purchase_price AS purchasePrice
    FROM pep_products
    WHERE id = ?
  `).bind(Number(saleInput.productId)).first();

  if (!productRow) {
    throw new Error('Продуктът не е намерен');
  }

  const product = normalizePepProductRow(productRow);
  const sale = buildPepSaleRecord(product, saleInput);
  const createdAt = pepNowISO();
  const inserted = await env.PEP_DB.prepare(`
    INSERT INTO pep_sales (
      product_id, product_name, quantity, multiplier, comment, sale_date, revenue, cost, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sale.productId,
    sale.productName,
    sale.quantity,
    sale.multiplier,
    sale.comment,
    sale.date,
    sale.revenue,
    sale.cost,
    createdAt
  ).run();

  return { ...sale, id: Number(inserted.meta?.last_row_id) };
}

async function pepD1Seed(env) {
  await ensurePepD1Schema(env);
  let didSeed = false;
  const productCountRow = await env.PEP_DB.prepare(`SELECT COUNT(*) AS count FROM pep_products`).first();
  if (Number(productCountRow?.count || 0) === 0) {
    for (const product of PEP_DEFAULT_PRODUCTS) {
      await pepD1InsertProduct(env, product);
    }
    didSeed = true;
  }

  const salesCountRow = await env.PEP_DB.prepare(`SELECT COUNT(*) AS count FROM pep_sales`).first();
  if (Number(salesCountRow?.count || 0) === 0) {
    const products = await pepD1ListProducts(env);
    for (const demoSale of PEP_DEFAULT_SALES) {
      const product = products.find((entry) => entry.baseName === demoSale.prodBase && entry.dosage === demoSale.dosage);
      if (product) {
        await pepD1InsertSale(env, {
          productId: product.id,
          quantity: demoSale.qty,
          multiplier: demoSale.mult,
          comment: demoSale.comment,
          date: demoSale.date
        });
      }
    }
    didSeed = true;
  }

  const existingUpdatedAt = await pepD1GetUpdatedAt(env);
  if (didSeed || !existingUpdatedAt) {
    return pepD1SetUpdatedAt(env, pepNowISO());
  }
  return existingUpdatedAt;
}

async function pepD1Bootstrap(env) {
  const updatedAt = await pepD1Seed(env);
  return {
    products: await pepD1ListProducts(env),
    sales: await pepD1ListSales(env),
    updatedAt: updatedAt || await pepD1GetUpdatedAt(env) || pepNowISO(),
    storage: 'd1'
  };
}

function buildPepDefaultKVProducts() {
  return PEP_DEFAULT_PRODUCTS.map((product, index) => ({
    id: index + 1,
    baseName: product.baseName,
    dosage: product.dosage,
    purchasePrice: Number(product.purchasePrice)
  }));
}

function buildPepDefaultKVSales(products) {
  let saleId = 1000;
  return PEP_DEFAULT_SALES.map((sale) => {
    const product = products.find((entry) => entry.baseName === sale.prodBase && entry.dosage === sale.dosage);
    return product ? buildPepSaleRecord(product, {
      quantity: sale.qty,
      multiplier: sale.mult,
      comment: sale.comment,
      date: sale.date
    }, saleId++) : null;
  }).filter(Boolean);
}

async function pepKVWriteAll(env, products, sales, updatedAt = pepNowISO()) {
  await kvPutJSON(env, PEP_PRODUCTS_KEY, products, null);
  await kvPutJSON(env, PEP_SALES_KEY, sales, null);
  await kvPutJSON(env, PEP_UPDATED_AT_KEY, { updatedAt }, null);
  return updatedAt;
}

async function pepKVBootstrap(env, forceReset = false) {
  let products = forceReset ? null : await kvGetJSON(env, PEP_PRODUCTS_KEY);
  let sales = forceReset ? null : await kvGetJSON(env, PEP_SALES_KEY);
  let updatedAt = forceReset ? null : (await kvGetJSON(env, PEP_UPDATED_AT_KEY))?.updatedAt;

  const shouldSeedProducts = !Array.isArray(products) || products.length === 0;
  const shouldSeedSales = !Array.isArray(sales) || sales.length === 0;
  if (shouldSeedProducts) {
    products = buildPepDefaultKVProducts();
  }
  if (shouldSeedSales) {
    sales = buildPepDefaultKVSales(products);
  }
  if (forceReset || shouldSeedProducts || shouldSeedSales || !updatedAt) {
    updatedAt = await pepKVWriteAll(env, products, sales, pepNowISO());
  }

  return { products, sales, updatedAt, storage: 'kv' };
}

async function getPepBootstrap(env) {
  const storageType = getPepStorageType(env);
  if (!storageType) {
    throw new Error(ERROR_MESSAGES.PEP_STORAGE_NOT_CONFIGURED);
  }
  return storageType === 'd1' ? pepD1Bootstrap(env) : pepKVBootstrap(env);
}

async function handlePepBootstrap(request, env) {
  try {
    return jsonResponse(await getPepBootstrap(env));
  } catch (error) {
    console.error('PEP bootstrap error:', error);
    return jsonResponse({ error: error.message || ERROR_MESSAGES.PEP_STORAGE_NOT_CONFIGURED }, 500);
  }
}

async function handlePepCreateProduct(request, env) {
  try {
    const { baseName, dosage, purchasePrice } = await request.json();
    if (!String(baseName || '').trim() || !String(dosage || '').trim() || !Number.isFinite(Number(purchasePrice))) {
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_FIELDS }, 400);
    }

    const storageType = getPepStorageType(env);
    if (!storageType) {
      return jsonResponse({ error: ERROR_MESSAGES.PEP_STORAGE_NOT_CONFIGURED }, 500);
    }

    let product;
    let updatedAt;
    if (storageType === 'd1') {
      await pepD1Seed(env);
      const existing = await env.PEP_DB.prepare(`
        SELECT id FROM pep_products WHERE lower(base_name) = lower(?) AND lower(dosage) = lower(?)
      `).bind(String(baseName).trim(), String(dosage).trim()).first();
      if (existing) {
        return jsonResponse({ error: 'Този продукт вече съществува в каталога' }, 409);
      }
      product = await pepD1InsertProduct(env, { baseName, dosage, purchasePrice });
      updatedAt = await pepD1SetUpdatedAt(env);
    } else {
      const bootstrap = await pepKVBootstrap(env);
      const duplicate = bootstrap.products.some((entry) =>
        entry.baseName.toLowerCase() === String(baseName).trim().toLowerCase() &&
        entry.dosage.toLowerCase() === String(dosage).trim().toLowerCase()
      );
      if (duplicate) {
        return jsonResponse({ error: 'Този продукт вече съществува в каталога' }, 409);
      }
      const nextId = bootstrap.products.length ? Math.max(...bootstrap.products.map((entry) => Number(entry.id))) + 1 : 1;
      product = normalizePepProductRow({ id: nextId, baseName, dosage, purchasePrice });
      bootstrap.products.push(product);
      updatedAt = await pepKVWriteAll(env, bootstrap.products, bootstrap.sales, pepNowISO());
    }

    return jsonResponse({ success: true, product, updatedAt, storage: storageType });
  } catch (error) {
    console.error('PEP create product error:', error);
    return jsonResponse({ error: error.message || 'Неуспешно добавяне на продукт' }, 500);
  }
}

async function handlePepCreateSale(request, env) {
  try {
    const saleInput = await request.json();
    if (!saleInput?.productId || !saleInput?.quantity || !saleInput?.multiplier) {
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_FIELDS }, 400);
    }

    const storageType = getPepStorageType(env);
    if (!storageType) {
      return jsonResponse({ error: ERROR_MESSAGES.PEP_STORAGE_NOT_CONFIGURED }, 500);
    }

    let sale;
    let updatedAt;
    if (storageType === 'd1') {
      await pepD1Seed(env);
      sale = await pepD1InsertSale(env, saleInput);
      updatedAt = await pepD1SetUpdatedAt(env);
    } else {
      const bootstrap = await pepKVBootstrap(env);
      const product = bootstrap.products.find((entry) => Number(entry.id) === Number(saleInput.productId));
      if (!product) {
        return jsonResponse({ error: 'Продуктът не е намерен' }, 404);
      }
      const nextId = bootstrap.sales.length ? Math.max(...bootstrap.sales.map((entry) => Number(entry.id))) + 1 : 1000;
      sale = buildPepSaleRecord(product, saleInput, nextId);
      bootstrap.sales.push(sale);
      updatedAt = await pepKVWriteAll(env, bootstrap.products, bootstrap.sales, pepNowISO());
    }

    return jsonResponse({ success: true, sale, updatedAt, storage: storageType });
  } catch (error) {
    console.error('PEP create sale error:', error);
    return jsonResponse({ error: error.message || 'Неуспешно добавяне на запис' }, 500);
  }
}

async function handlePepUpdateProduct(request, env) {
  try {
    const { productId, baseName, dosage, purchasePrice } = await request.json();
    if (!productId || !baseName || !dosage || purchasePrice === undefined || purchasePrice === null) {
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_FIELDS }, 400);
    }

    const cleanBase = String(baseName).trim();
    const cleanDosage = String(dosage).trim();
    const cleanPrice = Number(purchasePrice);
    if (!cleanBase || !cleanDosage || !Number.isFinite(cleanPrice) || cleanPrice < 0) {
      return jsonResponse({ error: 'Попълни коректно името, дозировката и доставната цена.' }, 400);
    }

    const storageType = getPepStorageType(env);
    if (!storageType) {
      return jsonResponse({ error: ERROR_MESSAGES.PEP_STORAGE_NOT_CONFIGURED }, 500);
    }

    let product;
    let updatedAt;
    if (storageType === 'd1') {
      await pepD1Seed(env);
      product = await pepD1UpdateProduct(env, productId, {
        baseName: cleanBase,
        dosage: cleanDosage,
        purchasePrice: cleanPrice
      });
      updatedAt = await pepD1SetUpdatedAt(env);
    } else {
      const bootstrap = await pepKVBootstrap(env);
      const productIndex = bootstrap.products.findIndex((entry) => Number(entry.id) === Number(productId));
      if (productIndex === -1) {
        return jsonResponse({ error: ERROR_MESSAGES.NOT_FOUND }, 404);
      }

      const duplicate = bootstrap.products.some((entry, index) =>
        index !== productIndex &&
        entry.baseName.toLowerCase() === cleanBase.toLowerCase() &&
        entry.dosage.toLowerCase() === cleanDosage.toLowerCase()
      );
      if (duplicate) {
        return jsonResponse({ error: 'Този продукт вече съществува в каталога' }, 409);
      }

      product = normalizePepProductRow({
        id: productId,
        baseName: cleanBase,
        dosage: cleanDosage,
        purchasePrice: cleanPrice
      });
      bootstrap.products[productIndex] = product;
      updatedAt = await pepKVWriteAll(env, bootstrap.products, bootstrap.sales, pepNowISO());
    }

    return jsonResponse({ success: true, product, updatedAt, storage: storageType });
  } catch (error) {
    console.error('PEP update product error:', error);
    if (error.message === ERROR_MESSAGES.NOT_FOUND) {
      return jsonResponse({ error: ERROR_MESSAGES.NOT_FOUND }, 404);
    }
    if (error.message === 'Този продукт вече съществува в каталога') {
      return jsonResponse({ error: error.message }, 409);
    }
    return jsonResponse({ error: error.message || 'Неуспешна редакция на продукт' }, 500);
  }
}

async function handlePepDeleteProduct(request, env) {
  try {
    const { productId } = await request.json();
    if (!productId) {
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_FIELDS }, 400);
    }

    const storageType = getPepStorageType(env);
    if (!storageType) {
      return jsonResponse({ error: ERROR_MESSAGES.PEP_STORAGE_NOT_CONFIGURED }, 500);
    }

    let updatedAt;
    if (storageType === 'd1') {
      await pepD1Seed(env);
      await pepD1DeleteProduct(env, productId);
      updatedAt = await pepD1SetUpdatedAt(env);
    } else {
      const bootstrap = await pepKVBootstrap(env);
      const nextProducts = bootstrap.products.filter((entry) => Number(entry.id) !== Number(productId));
      if (nextProducts.length === bootstrap.products.length) {
        return jsonResponse({ error: ERROR_MESSAGES.NOT_FOUND }, 404);
      }
      updatedAt = await pepKVWriteAll(env, nextProducts, bootstrap.sales, pepNowISO());
    }

    return jsonResponse({ success: true, updatedAt, storage: storageType });
  } catch (error) {
    console.error('PEP delete product error:', error);
    if (error.message === ERROR_MESSAGES.NOT_FOUND) {
      return jsonResponse({ error: ERROR_MESSAGES.NOT_FOUND }, 404);
    }
    return jsonResponse({ error: error.message || 'Неуспешно изтриване на продукт' }, 500);
  }
}

async function handlePepDeleteSale(request, env) {
  try {
    const { saleId } = await request.json();
    if (!saleId) {
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_FIELDS }, 400);
    }

    const storageType = getPepStorageType(env);
    if (!storageType) {
      return jsonResponse({ error: ERROR_MESSAGES.PEP_STORAGE_NOT_CONFIGURED }, 500);
    }

    let updatedAt;
    if (storageType === 'd1') {
      await pepD1Seed(env);
      const existing = await env.PEP_DB.prepare(`SELECT id FROM pep_sales WHERE id = ?`).bind(Number(saleId)).first();
      if (!existing) {
        return jsonResponse({ error: ERROR_MESSAGES.NOT_FOUND }, 404);
      }
      await env.PEP_DB.prepare(`DELETE FROM pep_sales WHERE id = ?`).bind(Number(saleId)).run();
      updatedAt = await pepD1SetUpdatedAt(env);
    } else {
      const bootstrap = await pepKVBootstrap(env);
      const nextSales = bootstrap.sales.filter((entry) => Number(entry.id) !== Number(saleId));
      if (nextSales.length === bootstrap.sales.length) {
        return jsonResponse({ error: ERROR_MESSAGES.NOT_FOUND }, 404);
      }
      updatedAt = await pepKVWriteAll(env, bootstrap.products, nextSales, pepNowISO());
    }

    return jsonResponse({ success: true, updatedAt, storage: storageType });
  } catch (error) {
    console.error('PEP delete sale error:', error);
    return jsonResponse({ error: error.message || 'Неуспешно изтриване на запис' }, 500);
  }
}

async function handlePepResetDemo(request, env) {
  try {
    const storageType = getPepStorageType(env);
    if (!storageType) {
      return jsonResponse({ error: ERROR_MESSAGES.PEP_STORAGE_NOT_CONFIGURED }, 500);
    }

    if (storageType === 'd1') {
      await ensurePepD1Schema(env);
      await env.PEP_DB.exec(`
        DELETE FROM pep_sales;
        DELETE FROM pep_products;
      `);
      pepD1Initialized = false;
      await ensurePepD1Schema(env);
      return jsonResponse(await pepD1Bootstrap(env));
    }

    return jsonResponse(await pepKVBootstrap(env, true));
  } catch (error) {
    console.error('PEP reset demo error:', error);
    return jsonResponse({ error: error.message || 'Неуспешно възстановяване на демо данните' }, 500);
  }
}

/**
 * Remove internal justification fields from plan before returning to client
 * These fields are only for the validator and should not be visible to the end user
 */
function removeInternalJustifications(plan) {
  if (!plan) {
    return plan;
  }
  
  // Create a deep copy to avoid modifying the original
  // Using JSON methods is acceptable here as the plan is already JSON-serializable
  const cleanPlan = JSON.parse(JSON.stringify(plan));
  
  // Remove internal justification fields that are only for validation
  if (cleanPlan.strategy) {
    delete cleanPlan.strategy.mealCountJustification;
    delete cleanPlan.strategy.afterDinnerMealJustification;
  }
  return cleanPlan;
}

/**
 * JSON response helper with CORS headers
 */
function jsonResponse(data, status = 200, options = {}) {
  const headers = { ...CORS_HEADERS };
  
  // Add cache-control header if specified
  // Examples:
  //   - 'no-cache' - don't cache (default for dynamic data)
  //   - 'public, max-age=300' - cache for 5 minutes
  //   - 'public, max-age=1800' - cache for 30 minutes
  if (options.cacheControl) {
    headers['Cache-Control'] = options.cacheControl;
  } else {
    // Default: no-cache for dynamic API responses
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
  }
  
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

/**
 * Sanitize JSON string to fix common AI formatting issues
 * - Remove trailing commas before } or ]
 * - Fix missing commas between array/object elements
 * - Remove duplicate commas
 */
function sanitizeJSON(jsonStr) {
  let result = jsonStr;
  
  // 1. Remove trailing commas before } or ]
  result = result.replace(/,(\s*[}\]])/g, '$1');
  
  // 2. Remove duplicate commas (,,)
  result = result.replace(/,\s*,+/g, ',');
  
  // 3. Fix missing comma between consecutive objects in arrays
  // Pattern: }\s*{ -> },{
  result = result.replace(/}(\s*){/g, '},$1{');
  
  // 4. Fix missing comma between consecutive arrays
  // Pattern: ]\s*[ -> ],[
  result = result.replace(/](\s*)\[/g, '],$1[');
  
  // 5. Fix missing comma between object and array
  // Pattern: }\s*[ -> },[
  result = result.replace(/}(\s*)\[/g, '},$1[');
  
  // 6. Fix missing comma between array and object
  // Pattern: ]\s*{ -> ],{
  result = result.replace(/](\s*){/g, '],$1{');
  
  return result;
}

/**
 * Extract JSON object or array from response using balanced brace/bracket matching
 * This prevents greedy regex from capturing non-JSON text after the object/array
 */
function extractBalancedJSON(text) {
  // Look for either { or [ as the start of JSON
  let firstBrace = text.indexOf('{');
  let firstBracket = text.indexOf('[');
  
  // Determine which comes first (or if only one exists)
  let startIndex = -1;
  let startChar = null;
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    startChar = '{';
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    startChar = '[';
  } else {
    return null; // No JSON structure found
  }
  
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    
    // Handle escape sequences
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    // Track string boundaries to ignore braces/brackets in strings
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    // Only count braces/brackets outside of strings
    if (!inString) {
      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
      } else if (char === '[') {
        bracketCount++;
      } else if (char === ']') {
        bracketCount--;
      }
      
      // When we close all braces/brackets, we have a complete JSON structure
      if (startChar === '{' && braceCount === 0) {
        return text.substring(startIndex, i + 1);
      } else if (startChar === '[' && bracketCount === 0) {
        return text.substring(startIndex, i + 1);
      }
    }
  }
  
  return null; // No balanced JSON found
}

/**
 * Parse AI response and extract JSON
 */
function parseAIResponse(response) {
  try {
    // Step 1: Try to extract JSON from markdown code blocks first
    const markdownFenceMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (markdownFenceMatch) {
      const jsonInBlock = extractBalancedJSON(markdownFenceMatch[1]);
      if (jsonInBlock) {
        try {
          const cleaned = sanitizeJSON(jsonInBlock);
          return JSON.parse(cleaned);
        } catch (e) {
          console.warn('Failed to parse JSON from markdown block, trying other methods:', e.message);
        }
      }
    }
    
    // Step 2: Try to find JSON using balanced brace matching (non-greedy)
    const jsonObject = extractBalancedJSON(response);
    if (jsonObject) {
      try {
        const cleaned = sanitizeJSON(jsonObject);
        return JSON.parse(cleaned);
      } catch (e) {
        console.warn('Failed to parse extracted JSON object, trying fallback:', e.message);
      }
    }
    
    // Step 3: Fallback to greedy match but with sanitization
    const jsonMatch = response.match(/[\[{][\s\S]*[}\]]/);
    if (jsonMatch) {
      try {
        const cleaned = sanitizeJSON(jsonMatch[0]);
        return JSON.parse(cleaned);
      } catch (e) {
        console.error('All JSON parsing attempts failed:', e.message);
        
        // Extract position from error message if available
        const posMatch = e.message.match(/position (\d+)/);
        if (posMatch) {
          const errorPos = parseInt(posMatch[1]);
          const contextStart = Math.max(0, errorPos - 100);
          const contextEnd = Math.min(jsonMatch[0].length, errorPos + 100);
          console.error('Context around error position:', jsonMatch[0].substring(contextStart, contextEnd));
        }
        
        console.error('Response excerpt (first 500 chars):', response.substring(0, 500));
        console.error('Response excerpt (last 500 chars):', response.substring(Math.max(0, response.length - 500)));
        
        // Return a user-friendly error without exposing the raw response
        return { error: `All JSON parsing attempts failed: ${e.message}` };
      }
    }
    
    // If no JSON found, return the response as-is wrapped in a structure
    console.error('No JSON structure found in AI response');
    console.error('Response excerpt (first 1000 chars):', response.substring(0, 1000));
    return { error: 'Could not parse AI response - no JSON found' };
  } catch (error) {
    console.error('Error parsing AI response:', error);
    console.error('Response length:', response?.length || 0);
    return { error: `Failed to parse response: ${error.message}` };
  }
}

// Enhancement #3: Estimate tokens for a message
// Note: This is a rough approximation (~4 chars per token for mixed content).
// Actual GPT tokenization varies by language and content. This is sufficient
// for conversation history management where approximate limits are acceptable.
/**
 * Wrap prompt with strict JSON-only enforcement prefix
 * This reduces unnecessary AI explanation text and output tokens
 */
function enforceJSONOnlyPrompt(prompt) {
  const jsonPrefix = `CRITICAL INSTRUCTION: You MUST respond with ONLY a valid JSON object. 
Do not include any explanatory text, markdown formatting, or anything outside the JSON structure.
Your response must start with { or [ and end with } or ].
NO text before the JSON. NO text after the JSON. ONLY JSON.

`;
  return jsonPrefix + prompt;
}

/**
 * Generate a unique session or log ID
 * @param {string} prefix - Prefix for the ID (e.g., 'session', 'regen', 'ai_log')
 * @returns {string} Unique ID with timestamp and random component
 */
function generateUniqueId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Generate user ID from user data
 */
function generateUserId(data) {
  const str = `${data.name}_${data.age}_${data.email || Date.now()}`;
  return btoa(str).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
}

/**
 * Build the free-eating meal instruction for step 3 prompts.
 * Returns a non-empty string when the strategy includes a free day and the
 * given day range covers that day; otherwise returns an empty string.
 */
function buildFreeMealInstruction(strategy, startDay, endDay) {
  const freeDayNumber = strategy && strategy.freeDayNumber;
  if (freeDayNumber == null) return '';
  const dayNum = Number(freeDayNumber);
  if (isNaN(dayNum) || dayNum < startDay || dayNum > endDay) return '';
  return `\n\n=== СВОБОДНО ХРАНЕНЕ (Ден ${dayNum}) ===\nЗАДЪЛЖИТЕЛНО за ден ${dayNum}: ЗАМЕНИ Хранене 2 (Хранене 2 НЕ се генерира!) с хранене точно така: {"type": "Свободно хранене", "name": "Свободно хранене", "weight": "-"} — БЕЗ поле "calories" и БЕЗ поле "macros" за това хранене!\nХранене 1 и Хранене 4 за ден ${dayNum} генерирай НОРМАЛНО с калории и макроси.\ndailyTotals за ден ${dayNum}: включвай планираните калории за Хранене 2 слот (от strategy mealBreakdown) за свободното хранене, плюс калориите от всички останали хранения.`;
}

/**
 * Enforce that freeDayNumber is always 6 (Saturday) or 7 (Sunday).
 * If the AI returned a weekday number (1-5), clamp it to 7 (Sunday).
 */
function enforceWeekendFreeDay(strategy) {
  if (!strategy || strategy.freeDayNumber == null) return;
  const d = Number(strategy.freeDayNumber);
  if (!isNaN(d) && (d < 6 || d > 7)) {
    strategy.freeDayNumber = 7;
  }
}


/**
 * Check whether AI logging is currently enabled.
 * Reads the 'ai_logging_enabled' KV key (default: true when not set).
 * Result is cached in module scope for LOGGING_STATUS_CACHE_TTL ms to avoid
 * a KV read on every single AI call.
 */
async function isAILoggingEnabled(env) {
  const now = Date.now();
  if (loggingStatusCache !== null && (now - loggingStatusCacheTime) < LOGGING_STATUS_CACHE_TTL) {
    return loggingStatusCache;
  }

  let enabled = true; // default: logging is enabled
  if (env && env.page_content) {
    try {
      const val = await env.page_content.get('ai_logging_enabled');
      if (val !== null) {
        enabled = val !== 'false' && val !== '0';
      }
    } catch (e) {
      // Fail open: if KV read fails, keep logging enabled; log warning for troubleshooting
      console.warn('[isAILoggingEnabled] KV read failed, defaulting to enabled:', e && e.message);
    }
  }

  loggingStatusCache = enabled;
  loggingStatusCacheTime = now;
  return enabled;
}

/**
 * Call AI model with load monitoring
 * Goal: Monitor request sizes to ensure no single request is overloaded
 * Architecture: System already uses multi-step approach (Analysis → Strategy → Meal Plan Chunks)
 */
async function callAIModel(env, prompt, maxTokens = null, stepName = 'unknown', sessionId = null, userData = null, calculatedData = null, skipJSONEnforcement = false) {
  // Apply strict JSON-only enforcement to reduce unnecessary output
  // Skip enforcement for chat requests where plain text responses are expected
  const enforcedPrompt = skipJSONEnforcement ? prompt : enforceJSONOnlyPrompt(prompt);
  
  // Improved token estimation for Cyrillic text
  const estimatedInputTokens = estimateTokenCount(enforcedPrompt);
  
  // Alert if prompt is very large - may indicate issue
  if (estimatedInputTokens > 12000) {
    console.error(`🚨 Very large input prompt: ~${estimatedInputTokens} tokens. Review the calling function to ensure this is intentional.`);
  }
  
  // Get admin config with caching (reduces KV reads from 2 to 0 when cached)
  const config = await getAdminConfig(env);

  // Apply per-step token limit override if configured by admin
  const stepKey = getStepKey(stepName);
  if (stepKey && config.stepTokenLimits && config.stepTokenLimits[stepKey]) {
    maxTokens = config.stepTokenLimits[stepKey];
  }

  // Chat steps use chat-specific model settings when configured; otherwise fall back to plan settings.
  const isChatStep = stepKey === 'chat';
  const preferredProvider = (isChatStep && config.chatProvider) ? config.chatProvider : config.provider;
  const modelName = (isChatStep && config.chatModelName) ? config.chatModelName : config.modelName;

  // Plan generation steps (step1–4 and their fallbacks) must always run on the same
  // configured model without thinking to ensure consistency and prevent MAX_TOKENS
  // errors caused by internal reasoning consuming the token budget.
  const isPlanStep = stepKey && ['step1', 'step2', 'step3', 'step4'].includes(stepKey);
  // For chat steps, use chat-specific thinking budget if set.
  // For plan steps, always disable thinking. For other steps, use plan config.
  const effectiveThinkingBudget = isPlanStep ? 0
    : isChatStep ? (config.chatThinkingBudget !== undefined ? config.chatThinkingBudget : config.thinkingBudget)
    : config.thinkingBudget;

  // Sampling parameters: chat steps prefer chat-specific values, falling back to plan config
  const cfgTemp = isChatStep
    ? (config.chatTemperature !== undefined ? config.chatTemperature : config.temperature)
    : config.temperature;
  const cfgTopP = isChatStep
    ? (config.chatTopP !== undefined ? config.chatTopP : config.topP)
    : config.topP;
  const cfgTopK = isChatStep
    ? (config.chatTopK !== undefined ? config.chatTopK : config.topK)
    : config.topK;

  // Build request data object in memory (not written to cache here; combined with
  // the response in logAIResponse to reduce Cache API subrequests per call from 4 to 1).
  const requestData = {
    prompt: enforcedPrompt,
    estimatedInputTokens: estimatedInputTokens,
    maxTokens: maxTokens,
    provider: preferredProvider,
    modelName: modelName,
    sessionId: sessionId,
    userData: userData,
    calculatedData: calculatedData,
    timestamp: new Date().toISOString()
  };

  // Log AI request only when logging is enabled (saves Cache API subrequests when disabled)
  const loggingEnabled = await isAILoggingEnabled(env);
  const logId = loggingEnabled ? await logAIRequest(env, stepName, requestData) : null;

  const startTime = Date.now();
  let response;
  let success = false;
  let error = null;

  try {
    // If mock is selected, return mock response
    if (preferredProvider === 'mock') {
      console.warn('Mock mode selected. Returning mock response.');
      response = generateMockResponse(enforcedPrompt);
      success = true;
    } else if (preferredProvider === 'openai' && env.OPENAI_API_KEY) {
      // Try preferred provider first
      response = await callOpenAI(env, enforcedPrompt, modelName, maxTokens, !skipJSONEnforcement, cfgTemp, cfgTopP);
      success = true;
    } else if (preferredProvider === 'anthropic' && env.ANTHROPIC_API_KEY) {
      response = await callClaude(env, enforcedPrompt, modelName, maxTokens, !skipJSONEnforcement, cfgTemp, cfgTopP, cfgTopK);
      success = true;
    } else if (preferredProvider === 'google' && env.GEMINI_API_KEY) {
      response = await callGemini(env, enforcedPrompt, modelName, maxTokens, !skipJSONEnforcement, effectiveThinkingBudget, cfgTemp, cfgTopP, cfgTopK);
      success = true;
    } else {
      // Fallback hierarchy if preferred not available
      if (env.OPENAI_API_KEY) {
        console.warn('Preferred provider not available. Falling back to OpenAI.');
        response = await callOpenAI(env, enforcedPrompt, modelName, maxTokens, !skipJSONEnforcement, cfgTemp, cfgTopP);
        success = true;
      } else if (env.ANTHROPIC_API_KEY) {
        console.warn('Preferred provider not available. Falling back to Anthropic.');
        response = await callClaude(env, enforcedPrompt, modelName, maxTokens, !skipJSONEnforcement, cfgTemp, cfgTopP, cfgTopK);
        success = true;
      } else if (env.GEMINI_API_KEY) {
        console.warn('Preferred provider not available. Falling back to Google Gemini.');
        response = await callGemini(env, enforcedPrompt, modelName, maxTokens, !skipJSONEnforcement, effectiveThinkingBudget, cfgTemp, cfgTopP, cfgTopK);
        success = true;
      } else {
        throw new Error('No AI provider configured. Please configure at least one provider.');
      }
    }
  } catch (err) {
    console.error('Error calling AI model:', err);
    error = err.message || 'Unknown error';
    throw err;
  } finally {
    if (loggingEnabled) {
      // Log AI response combined with request data (single cache.put instead of two)
      await logAIResponse(env, logId, stepName, {
        response: response,
        success: success,
        error: error,
        duration: Date.now() - startTime
      }, requestData);

      // For auto-sessions (no explicit sessionId provided), finalize the combined
      // index immediately after this single call. Named sessions (plan generation)
      // are finalized in bulk by generatePlanMultiStep / regenerateFromStep to
      // keep Cache API subrequests to 2 per session rather than 2 per call.
      if (!sessionId && requestData._effectiveSessionId) {
        await finalizeAISessionLogs(env, requestData._effectiveSessionId);
      }
    }
  }

  return response;
}

/**
 * Generate chat prompt with full context for precise analysis
 * NOTE: Uses full data in both modes to ensure comprehensive understanding of user context
 */
async function generateChatPrompt(env, userMessage, userData, userPlan, conversationHistory, mode = 'consultation') {
  // Use FULL data for both modes to ensure precise, comprehensive analysis
  // No compromise on data completeness for individualization and quality

  // Base context with complete data
  const baseContext = `Ти си личен диетолог, психолог и здравен асистент за ${userData.name}.

КЛИЕНТСКИ ПРОФИЛ:
${JSON.stringify(userData)}

ПЪЛЕН ХРАНИТЕЛЕН ПЛАН:
${JSON.stringify(userPlan)}

${conversationHistory.length > 0 ? `ИСТОРИЯ НА РАЗГОВОРА:\n${conversationHistory.map(h => `${h.role}: ${h.content}`).join('\n')}` : ''}
`;

  // Get mode-specific instructions from KV (with caching)
  const chatPrompts = await getChatPrompts(env);

  // Extract chatGuidelines from the plan's communicationStyle (top-level or under strategy)
  const commStyle = userPlan?.communicationStyle || userPlan?.strategy?.communicationStyle;
  const commGuidelines = commStyle?.chatGuidelines || '';

  let modeInstructions = '';
  if (mode === 'consultation') {
    // Replace {communicationStyle} placeholder with client-specific guidelines from the plan
    modeInstructions = (chatPrompts.consultation || '').replace(/{communicationStyle}/g, commGuidelines);
  } else if (mode === 'modification') {
    // Replace {goal} and {communicationStyle} placeholders
    modeInstructions = (chatPrompts.modification || '')
      .replace(/{goal}/g, userData.goal || 'твоята цел')
      .replace(/{communicationStyle}/g, commGuidelines);
  }

  const fullPrompt = `${baseContext}
${modeInstructions}

ВЪПРОС: ${userMessage}

АСИСТЕНТ (отговори КРАТКО):`;

  return fullPrompt;
}

/**
 * Generate simplified fallback plan when main generation fails
 * Uses conservative approach with basic meals and minimal complexity
 * Last resort to provide user with something useful rather than complete failure
 * 
 * SIMPLIFIED: Reuses existing generateMealPlanSummaryPrompt() with KV support
 */
async function generateSimplifiedFallbackPlan(env, data) {
  console.log('Generating simplified fallback plan');
  
  const bmr = calculateBMR(data);
  const fallbackActivityData = calculateUnifiedActivityScore(data);
  const tdee = calculateTDEE(bmr, fallbackActivityData.combinedScore);
  let recommendedCalories = tdee;
  
  // Adjust for goal
  if (data.goal && data.goal.toLowerCase().includes('отслабване')) {
    recommendedCalories = Math.round(tdee * 0.85);
  } else if (data.goal && data.goal.toLowerCase().includes('мускулна маса')) {
    recommendedCalories = Math.round(tdee * 1.1);
  }
  
  // Generate simplified week plan with 1 AI call
  const mealPlanPrompt = `Създай ОПРОСТЕН 7-дневен хранителен план за ${data.name}.

ОСНОВНИ ДАННИ:
- BMR: ${bmr} kcal, TDEE: ${tdee} kcal
- Целеви калории: ${recommendedCalories} kcal/ден
- Цел: ${data.goal}
- Възраст: ${data.age}, Пол: ${data.gender}
- Медицински състояния: ${JSON.stringify(data.medicalConditions || [])}
- Алергии/Непоносимости: ${data.dietDislike || 'няма'}
- Предпочитания: ${data.dietLove || 'няма'}

ИЗИСКВАНИЯ (ОПРОСТЕНИ):
- 3 хранения на ден: Хранене 1, Хранене 2, Хранене 4
- Всяко ястие с calories и macros (protein, carbs, fats)
- Общо около ${recommendedCalories} kcal/ден
- Балансирани макроси: 30% протеини, 40% въглехидрати, 30% мазнини

ФОРМАТ (JSON):
{
  "day1": {"meals": [{"name": "...", "time": "...", "type": "Хранене 1", "calories": число, "macros": {"protein": число, "carbs": число, "fats": число}}]},
  "day2": {"meals": [...]},
  ...
  "day7": {"meals": [...]}
}

Създай прост, практичен план.`;

  const calculatedData = { bmr, tdee, recommendedCalories };
  const mealPlanResponse = await callAIModel(env, mealPlanPrompt, 3000, 'fallback_plan', null, data, calculatedData);
  const weekPlan = parseAIResponse(mealPlanResponse);
  
  // Create minimal analysis and strategy for generateMealPlanSummaryPrompt()
  const analysis = {
    bmr,
    recommendedCalories,
    keyProblems: [{
      problem: 'Използван опростен план поради технически ограничения',
      severity: 'Info'
    }]
  };
  
  const strategy = {
    dietaryModifier: 'Балансиран',
    planJustification: 'Опростен план с базови хранителни принципи, създаден като резервна опция.',
    welcomeMessage: `Здравейте ${data.name}! Този план е създаден да ви помогне да постигнете целта си чрез балансирано хранене.`,
    mealCountJustification: '3 основни хранения за лесно следване',
    afterDinnerMealJustification: 'Не са необходими',
    psychologicalSupport: ['Бъдете последователни', 'Планирайте предварително', 'Не се отказвайте при грешка'],
    supplementRecommendations: [],
    hydrationStrategy: '2-2.5л вода дневно'
  };
  
  // REUSE existing generateMealPlanSummaryPrompt() - it uses KV key 'admin_summary_prompt'
  // This generates recommendations, forbidden, psychology, supplements via AI
  const summaryPrompt = await generateMealPlanSummaryPrompt(data, analysis, strategy, bmr, recommendedCalories, weekPlan, env);
  const summaryResponse = await callAIModel(env, summaryPrompt, 2000, 'fallback_summary', null, data, buildCompactAnalysisForStep4(analysis));
  const summaryData = parseAIResponse(summaryResponse);
  
  // Use AI-generated data or fallback to strategy values
  const recommendations = summaryData.recommendations || strategy.foodsToInclude || ['Варено пилешко месо', 'Киноа', 'Авокадо'];
  const forbidden = summaryData.forbidden || strategy.foodsToAvoid || ['Бързи храни', 'Газирани напитки', 'Сладкиши'];
  const psychology = summaryData.psychology || strategy.psychologicalSupport;
  const waterIntake = summaryData.waterIntake || strategy.hydrationStrategy;
  const supplements = summaryData.supplements || strategy.supplementRecommendations;
  
  // Update strategy with AI-generated values
  strategy.foodsToInclude = recommendations;
  strategy.foodsToAvoid = forbidden;
  strategy.psychologicalSupport = psychology;
  strategy.supplementRecommendations = supplements;
  strategy.hydrationStrategy = waterIntake;
  
  const plan = {
    analysis,
    strategy,
    weekPlan,
    summary: summaryData.summary || {
      bmr,
      dailyCalories: recommendedCalories,
      macros: { protein: 150, carbs: 200, fats: 65 }
    },
    recommendations,
    forbidden,
    psychology,
    waterIntake,
    supplements
  };
  
  return plan;
}

/**
 * Normalize a blacklist entry to object format.
 * Handles backward-compat with old string[] KV data.
 */
function normalizeBlacklistEntry(entry) {
  return typeof entry === 'string' ? { item: entry, mode: 'ban' } : entry;
}

/**
 * Helper function to fetch and build dynamic whitelist/blacklist sections for prompts
 */
async function getDynamicFoodListsSections(env) {
  // Check cache first
  const now = Date.now();
  if (foodListsCache && (now - foodListsCacheTime) < FOOD_LISTS_CACHE_TTL) {
    return foodListsCache;
  }
  let dynamicWhitelist = [];
  let dynamicBlacklist = [];
  let dynamicMainlist = [];
  let mainlistEnabled = true; // default: enabled
  
  try {
    if (env && env.page_content) {
      const whitelistData = await env.page_content.get('food_whitelist');
      if (whitelistData) {
        dynamicWhitelist = JSON.parse(whitelistData);
      }
      
      const blacklistData = await env.page_content.get('food_blacklist');
      if (blacklistData) {
        dynamicBlacklist = JSON.parse(blacklistData);
      }

      const mainlistData = await env.page_content.get('food_mainlist');
      if (mainlistData) {
        dynamicMainlist = JSON.parse(mainlistData);
      }

      const mainlistEnabledData = await env.page_content.get('food_mainlist_enabled');
      if (mainlistEnabledData !== null) {
        mainlistEnabled = mainlistEnabledData !== 'false';
      }
    }
  } catch (error) {
    console.error('Error loading whitelist/blacklist/mainlist from KV:', error);
  }

  // Deactivate mainlist if explicitly disabled
  if (!mainlistEnabled) {
    dynamicMainlist = [];
  }
  
  // Normalize blacklist entries: backward-compat with old string[] format
  const normalizedBlacklist = dynamicBlacklist.map(normalizeBlacklistEntry);

  // Build substitutions array for validatePlan auto-corrector.
  // Sort by detect length descending so longer/more-specific phrases match first
  // (e.g. "гръцко кисело мляко" before "кисело мляко").
  const dynamicSubstitutions = normalizedBlacklist
    .filter(e => e.mode === 'substitute' && e.substitute)
    .map(e => ({ detect: e.item, replace: e.substitute }))
    .sort((a, b) => b.detect.length - a.detect.length);

  // Build mainlist section — strict enforcement: AI MUST use only these foods
  let dynamicMainlistSection = '';
  if (dynamicMainlist.length > 0) {
    // Keep the joined list compact; truncate if it would be excessively long
    const joined = dynamicMainlist.join(', ');
    const MAX_MAINLIST_CHARS = 1500;
    const displayList = joined.length > MAX_MAINLIST_CHARS
      ? joined.slice(0, MAX_MAINLIST_CHARS) + '… [списъкът е съкратен]'
      : joined;
    dynamicMainlistSection = `\nОСНОВЕН СПИСЪК ХРАНИ (ЗАДЪЛЖИТЕЛНО): Използвай САМО тези продукти: ${displayList}. Изключение: единствено при категорична медицинска противопоказност (алергия, заболяване) на конкретния потребител.`;
  }

  // Build dynamic whitelist section — suppressed when mainlist is active (mainlist takes exclusive priority).
  // Note: checking dynamicMainlist.length === 0 is sufficient because a disabled mainlist is already
  // cleared to [] at the 'Deactivate mainlist if explicitly disabled' block above.
  let dynamicWhitelistSection = '';
  if (dynamicWhitelist.length > 0 && dynamicMainlist.length === 0) {
    dynamicWhitelistSection = `\n\nАДМИН WHITELIST (ПРИОРИТЕТНИ ХРАНИ ОТ АДМИН ПАНЕЛ):\n- ${dynamicWhitelist.join('\n- ')}\nТези храни са допълнително одобрени и трябва да се предпочитат при възможност.`;
  }
  
  // Build dynamic blacklist section - differentiate bans from substitutes
  let dynamicBlacklistSection = '';
  if (normalizedBlacklist.length > 0) {
    const banLines = normalizedBlacklist
      .filter(e => e.mode !== 'substitute')
      .map(e => `${e.item} (ЗАБРАНЕНО)`);
    const subLines = normalizedBlacklist
      .filter(e => e.mode === 'substitute' && e.substitute)
      .map(e => `${e.item} → замести с „${e.substitute}"`);
    const allLines = [...banLines, ...subLines];
    if (allLines.length > 0) {
      dynamicBlacklistSection = `\n\nАДМИН BLACKLIST (ОТ АДМИН ПАНЕЛ):\n- ${allLines.join('\n- ')}\nЗабранените храни НЕ трябва да се използват. Храните за заместване ТРЯБВА да се заменят с посочения алтернативен вариант.`;
    }
  }
  
  // Cache the result
  const result = { dynamicWhitelistSection, dynamicBlacklistSection, dynamicMainlistSection, dynamicSubstitutions };
  foodListsCache = result;
  foodListsCacheTime = now;
  
  return result;
}

/**
 * Invalidate food lists cache
 * Should be called after updating whitelist or blacklist
 */
function invalidateFoodListsCache() {
  foodListsCache = null;
  foodListsCacheTime = 0;
}

/**
 * Get goal-based hacks from KV storage or use defaults
 * @param {object} env - Worker environment with KV binding
 * @param {string} goal - User's goal (e.g., 'Отслабване', 'Покачване на мускулна маса')
 * @returns {Promise<string[]>} Array of hack tips for the goal
 */
async function getGoalHacks(env, goal) {
  try {
    if (env && env.page_content) {
      const hacksData = await env.page_content.get('goal_hacks');
      if (hacksData) {
        const allHacks = JSON.parse(hacksData);
        if (allHacks[goal] && Array.isArray(allHacks[goal]) && allHacks[goal].length > 0) {
          return allHacks[goal];
        }
      }
    }
  } catch (error) {
    console.error('Error fetching goal hacks from KV:', error);
  }
  
  // Return default hacks for the goal, or generic hacks if goal not found
  return DEFAULT_GOAL_HACKS[goal] || DEFAULT_GOAL_HACKS['Друго'] || [];
}

/**
 * Get all goal hacks from KV storage (for admin panel)
 * @param {object} env - Worker environment with KV binding
 * @returns {Promise<object>} Object with all goal hacks
 */
async function getAllGoalHacks(env) {
  try {
    if (env && env.page_content) {
      const hacksData = await env.page_content.get('goal_hacks');
      if (hacksData) {
        return JSON.parse(hacksData);
      }
    }
  } catch (error) {
    console.error('Error fetching all goal hacks from KV:', error);
  }
  
  // Return default hacks
  return DEFAULT_GOAL_HACKS;
}

/**
 * Save goal hacks to KV storage (from admin panel)
 * @param {object} env - Worker environment with KV binding
 * @param {object} hacks - Object with all goal hacks
 */
async function saveGoalHacks(env, hacks) {
  if (!env || !env.page_content) {
    throw new Error('KV storage not available');
  }
  await env.page_content.put('goal_hacks', JSON.stringify(hacks));
}

/**
 * Invalidate custom prompts cache
 * @param {string|null} key - Specific prompt key to invalidate, or null to clear all
 */
function invalidateCustomPromptsCache(key = null) {
  if (key) {
    delete customPromptsCache[key];
    delete customPromptsCacheTime[key];
  } else {
    customPromptsCache = {};
    customPromptsCacheTime = {};
  }
}

/**
 * Generate prompt for a chunk of days (progressive generation)
 */
async function generateMealPlanChunkPrompt(data, analysis, strategy, bmr, recommendedCalories, startDay, endDay, previousDays, env, errorPreventionComment = null, cachedFoodLists = null) {
  const dietaryModifier = strategy.dietaryModifier || 'Балансирано';
  const daysInChunk = endDay - startDay + 1;
  
  // Build modifications section
  let modificationsSection = '';
  if (data.planModifications && data.planModifications.length > 0) {
    const modLines = data.planModifications
      .map(mod => PLAN_MODIFICATION_DESCRIPTIONS[mod])
      .filter(desc => desc !== undefined);
    if (modLines.length > 0) {
      modificationsSection = `\nМОДИФИКАЦИИ: ${modLines.join('; ')}`;
    }
  }

  const sweetsCravingRule = buildSweetsCravingRule(data.foodCravings, strategy);

  // Build previous days context for variety (NPCF compact — meal names only)
  let previousDaysContext = '';
  if (previousDays.length > 0) {
    previousDaysContext = `\n\n${serializePreviousDays(previousDays)}\nПОВТОРЕНИЕ: max 5 ястия/седмица — избягвай горните, освен ако е необходимо.`;
  }
  
  const analysisBlock = serializeAnalysisForStep(analysis, 3);
  const strategyBlock = serializeStrategyForMealPlan(strategy);
  
  // Legacy compact fields kept for KV prompt backward compatibility
  const strategyCompact = {
    dietType: strategy.dietType || 'Балансирана',
    weeklyMealPattern: strategy.weeklyMealPattern || 'Традиционна',
    mealTiming: strategy.mealTiming?.pattern || '3 хранения дневно',
    keyPrinciples: (strategy.keyPrinciples || []).join('; '),
    foodsToInclude: (strategy.preferredFoodCategories || strategy.foodsToInclude || []).join(', '),
    foodsToAvoid: (strategy.avoidFoodCategories || strategy.foodsToAvoid || []).join(', '),
    calorieDistribution: strategy.calorieDistribution || 'не е определено',
    macroDistribution: strategy.macroDistribution || 'не е определено',
  };
  
  const analysisCompact = {
    macroRatios: analysis.macroRatios ?
      `P${analysis.macroRatios.protein ?? '?'}/C${analysis.macroRatios.carbs ?? '?'}/F${analysis.macroRatios.fats ?? '?'}%` :
      'не изчислени',
    macroGrams: analysis.macroGrams ?
      `P${analysis.macroGrams.protein ?? '?'}g/C${analysis.macroGrams.carbs ?? '?'}g/F${analysis.macroGrams.fats ?? '?'}g` :
      'не изчислени'
  };
  
  // Use cached food lists if provided, otherwise fetch (optimization)
  let dynamicWhitelistSection, dynamicBlacklistSection, dynamicMainlistSection;
  if (cachedFoodLists) {
    dynamicWhitelistSection = cachedFoodLists.dynamicWhitelistSection;
    dynamicBlacklistSection = cachedFoodLists.dynamicBlacklistSection;
    dynamicMainlistSection = cachedFoodLists.dynamicMainlistSection || '';
  } else {
    const foodLists = await getDynamicFoodListsSections(env);
    dynamicWhitelistSection = foodLists.dynamicWhitelistSection;
    dynamicBlacklistSection = foodLists.dynamicBlacklistSection;
    dynamicMainlistSection = foodLists.dynamicMainlistSection || '';
  }
  
  // Build medical details section for meal plan prompt
  const medicalDetailsSection = [
    data['medicalConditions_Алергии'] ? `Алергии (ВАЖНО - избягвай): ${data['medicalConditions_Алергии']}` : '',
    data['medicalConditions_Автоимунно'] ? `Автоимунно: ${data['medicalConditions_Автоимунно']}` : '',
    data.medicalConditions_other ? `Друго медицинско: ${data.medicalConditions_other}` : ''
  ].filter(Boolean).join('\n');

  // Compact per-day calorie/macro targets (NPCF #WK v1)
  const weeklySchemeByDayText = serializeWeeklySchemeTargets(
    strategy, startDay, endDay, recommendedCalories, DAY_NUMBER_TO_KEY, DAILY_CALORIE_TOLERANCE
  );

  const customPrompt = await requireKvPrompt(env, 'admin_meal_plan_prompt');

  // All necessary values are already computed above (analysisCompact, strategyCompact,
    // dietaryModifier, modificationsSection, previousDaysContext, food lists).
    // Dot-notation support in replacePromptVariables allows {analysisCompact.macroRatios} etc.
    let prompt = replacePromptVariables(customPrompt, {
      userData: data,
      analysisData: analysis,
      strategyData: strategy,
      analysisBlock,
      strategyBlock,
      analysisCompact,
      strategyCompact,
      weeklySchemeByDayText,
      bmr,
      recommendedCalories,
      startDay,
      endDay,
      previousDays,
      dietaryModifier,
      modificationsSection,
      previousDaysContext,
      dynamicWhitelistSection,
      dynamicBlacklistSection,
      dynamicMainlistSection,
      dietLove: data.dietLove || 'няма',
      dietDislike: data.dietDislike || 'няма',
      goal_other: data.goal_other || '',
      medicalConditions_other: data.medicalConditions_other || '',
      medicalConditions_allergy_details: data['medicalConditions_Алергии'] || '',
      medicalConditions_autoimmune_details: data['medicalConditions_Автоимунно'] || '',
      medicalConditions_cardiovascular_details: data['medicalConditions_Сърдечно-съдови_детайл'] || '',
      medicalConditions_endocrine_details: data['medicalConditions_Ендокринни_детайл'] || '',
      medicalConditions_digestive_details: data['medicalConditions_Храносмилателни_детайл'] || '',
      medicalConditions_metabolic_details: data['medicalConditions_Метаболитни_детайл'] || '',
      medicalConditions_musculoskeletal_details: data['medicalConditions_Мускулно-скелетни_детайл'] || '',
      DAILY_CALORIE_TOLERANCE,
      MAX_LATE_SNACK_CALORIES,
      MEAL_NAME_FORMAT_INSTRUCTIONS,
      freeMealInstruction: buildFreeMealInstruction(strategy, startDay, endDay),
      sweetsCravingRule,
      additionalNotes: buildCombinedAdditionalNotes(data),
      clinicalProtocolSection: (() => { const p = getClinicalProtocol(data.clinicalProtocol); return p ? buildClinicalProtocolPromptSection(p) : ''; })()
    });
    
    // CRITICAL: Ensure JSON format instructions are included even with custom prompts
    if (!hasJsonFormatInstructions(prompt)) {
      prompt += `

═══ КРИТИЧНО ВАЖНО - ФОРМАТ НА ОТГОВОР ═══
Отговори САМО с валиден JSON обект БЕЗ допълнителни обяснения или текст преди или след JSON.

Структурата ТРЯБВА да е:
{
  "dayN": {
    "meals": [
      {"type": "Хранене 1|Хранене 2|Свободно хранене|Хранене 3|Хранене 4|Хранене 5", "name": "име", "weight": "Xg", "description": "текст", "benefits": "текст", "calories": число, "macros": {"protein": число, "carbs": число, "fats": число}}
    ],
    "dailyTotals": {"calories": число, "protein": число, "carbs": число, "fats": число}
  }
}

ВАЖНО: Върни САМО JSON обект {} без други текст или обяснения! НЕ връщай JSON масив []!`;
    }
    if (analysisBlock && !prompt.includes('#AN v1')) {
      prompt = prompt.replace(
        '=== ПРОФИЛ ===',
        `${analysisBlock}\n${strategyBlock}\n\n=== ПРОФИЛ ===`
      );
    }
  return prompt;
}

/**
 * Generate prompt for summary and recommendations (final step of progressive generation)
 */
async function generateMealPlanSummaryPrompt(data, analysis, strategy, bmr, recommendedCalories, weekPlan, env) {
  // Calculate total calories and macros across the week for validation
  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFats = 0;
  let dayCount = 0;
  
  Object.keys(weekPlan).forEach(dayKey => {
    if (weekPlan[dayKey] && weekPlan[dayKey].meals) {
      weekPlan[dayKey].meals.forEach(meal => {
        totalCalories += (parseInt(meal.calories) || 0);
        if (meal.macros) {
          totalProtein += (parseInt(meal.macros.protein) || 0);
          totalCarbs += (parseInt(meal.macros.carbs) || 0);
          totalFats += (parseInt(meal.macros.fats) || 0);
        }
      });
      dayCount++;
    }
  });
  
  const avgCalories = dayCount > 0 ? Math.round(totalCalories / dayCount) : recommendedCalories;
  const avgProtein = dayCount > 0 ? Math.round(totalProtein / dayCount) : 0;
  const avgCarbs = dayCount > 0 ? Math.round(totalCarbs / dayCount) : 0;
  const avgFats = dayCount > 0 ? Math.round(totalFats / dayCount) : 0;
  
  // Extract compact strategy info (no full JSON)
  const psychologicalSupport = strategy.psychologicalSupport || ['Бъди мотивиран', 'Следвай плана', 'Постоянство е ключово'];
  const supplementRecommendations = strategy.supplementRecommendations || ['Според нуждите'];
  const hydrationStrategy = strategy.hydrationStrategy || 'Минимум 2-2.5л вода дневно';
  const foodsToInclude = strategy.foodsToInclude || [];
  const foodsToAvoid = strategy.foodsToAvoid || [];
  
  // Fetch dynamic whitelist, blacklist and mainlist from KV storage (FIX: was missing from summary step)
  const { dynamicWhitelistSection, dynamicBlacklistSection, dynamicMainlistSection } = await getDynamicFoodListsSections(env);
  
  // Extract health analysis context for supplement recommendations
  const healthContext = {
    keyProblems: (analysis.keyProblems || []).map(p => `${p.title} (${p.severity})`).join('; '),
    allergies: (data.medicalConditions || []).includes('Алергии')
      ? (data['medicalConditions_Алергии'] || 'Да (без детайли)')
      : 'няма',
    medications: data.medications === 'Да' ? (data.medicationsDetails || 'Да') : 'не приема',
    medicalConditions: (data.medicalConditions || []).join('+') || 'няма',
    medicalConditions_other: data.medicalConditions_other || '',
    deficiencies: (analysis.nutritionalNeeds || analysis.nutritionalDeficiencies || []).join(', ') || 'няма установени'
  };
  
  // Build extra health context lines for summary prompt
  const extraHealthContext = [
    healthContext.allergies !== 'няма' ? `Алергии: ${healthContext.allergies}` : '',
    healthContext.medicalConditions_other ? `Друго медицинско: ${healthContext.medicalConditions_other}` : ''
  ].filter(Boolean).join(' | ');

  // Extract additional user data for enhanced personalization
  const genderDisplay = data.gender === 'male' ? 'Мъж' : (data.gender === 'female' ? 'Жена' : 'неизвестен');
  const stressLevel = data.stressLevel || 'средно';
  // sleepQuality / sleepDuration come from questionnaire1; questionnaire2 uses sleepHours /
  // sleepInterrupt instead — fall back to those so protocol users get accurate sleep context.
  const sleepQuality = data.sleepQuality ||
    (data.sleepInterrupt === 'Да' ? 'с прекъсвания' : 'добро');
  const sleepDuration = data.sleepDuration || data.sleepHours || '7-8';
  const sportActivity = data.sportActivity || 'няма';
  const dailyActivity = data.dailyActivity || data.dailyActivityLevel || 'средна';
  
  const customPrompt = await requireKvPrompt(env, 'admin_summary_prompt');
  const _proto = getClinicalProtocol(data.clinicalProtocol);
  const analysisBlock = serializeAnalysisForStep(analysis, 4);
  const weekPlanBlock = serializeWeekPlanSummary(weekPlan);
  let prompt = replacePromptVariables(customPrompt, {
      userData: data,
      userProfileBlock: serializeUserProfile(data, 'summary'),
      analysisBlock,
      weekPlan: weekPlanBlock,
      strategyData: strategy,
      bmr: bmr,
      recommendedCalories: recommendedCalories,
      avgCalories: avgCalories,
      avgProtein: avgProtein,
      avgCarbs: avgCarbs,
      avgFats: avgFats,
      dynamicWhitelistSection: dynamicWhitelistSection,
      dynamicBlacklistSection: dynamicBlacklistSection,
      dynamicMainlistSection: dynamicMainlistSection || '',
      name: data.name,
      age: data.age || 'неизвестно',
      gender: data.gender === 'male' ? 'Мъж' : (data.gender === 'female' ? 'Жена' : 'неизвестен'),
      goal: data.goal,
      keyProblems: healthContext.keyProblems || 'няма',
      allergies: healthContext.allergies,
      medications: healthContext.medications,
      medicalConditions: healthContext.medicalConditions,
      medicalConditions_other: healthContext.medicalConditions_other,
      deficiencies: healthContext.deficiencies || 'няма установени',
      psychologicalSupport: psychologicalSupport.slice(0, 3).join('; '),
      hydrationStrategy: hydrationStrategy,
      temperament: analysis.psychoProfile?.temperament || 'не е определен',
      temperamentProbability: analysis.psychoProfile?.probability || 0,
      psychologicalProfile: (analysis.psychologicalProfile || '').substring(0, 500),
      dietType: strategy.dietType || strategy.dietaryModifier || 'балансирана',
      supplementRecommendations: (strategy.supplementRecommendations || []).slice(0, 5).join('; '),
      // New variables for enhanced psychology and supplements
      stressLevel: data.stressLevel || 'средно',
      // sleepQuality / sleepDuration come from questionnaire1; use questionnaire2 fields as fallback
      sleepQuality: data.sleepQuality ||
        (data.sleepInterrupt === 'Да' ? 'с прекъсвания' : 'добро'),
      sleepDuration: data.sleepDuration || data.sleepHours || '7-8',
      sportActivity: data.sportActivity || 'няма',
      dailyActivity: data.dailyActivity || data.dailyActivityLevel || 'средна',
      dailyActivityLevel: data.dailyActivityLevel || data.dailyActivity || 'средна',
      clinicalProtocolSection: _proto ? buildClinicalProtocolPromptSection(_proto) : '',
      clinicalProtocolSupplementSection: _proto ? buildClinicalProtocolSupplementSection(_proto) : '',
      clinicalProtocolName: _proto ? _proto.name : ''
    });
    
    if (analysisBlock && !prompt.includes('#AN v1')) {
      prompt = `${analysisBlock}\n\n${prompt}`;
    }
    
    // CRITICAL: Ensure JSON format instructions are included even with custom prompts
    if (!hasJsonFormatInstructions(prompt)) {
      prompt += `

═══ КРИТИЧНО ВАЖНО - ФОРМАТ НА ОТГОВОР ═══
Отговори САМО с валиден JSON обект БЕЗ допълнителни обяснения или текст преди или след JSON.

Структурата ТРЯБВА да е:
{
  "summary": {
    "bmr": число,
    "dailyCalories": число,
    "macros": {"protein": число, "carbs": число, "fats": число}
  },
  "recommendations": ["текст"],
  "forbidden": ["текст"],
  "psychology": ["текст"],
  "waterIntake": "текст",
  "supplements": ["текст"]
}

ВАЖНО: Върни САМО JSON без други текст или обяснения!`;
  }
  return prompt;
}

/**
 * Generate nutrition plan from questionnaire data using multi-step approach
 */
async function handleGeneratePlan(request, env, ctx) {
  try {
    const data = normalizeQuestionnaireData(await request.json());
    if (!data.name || !data.age || !data.weight || !data.height) {
      console.error('handleGeneratePlan: Missing required fields');
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_FIELDS }, 400);
    }

    let result;
    try {
      result = await generatePlanCore(env, data);
    } catch (coreError) {
      console.error('handleGeneratePlan: generatePlanCore failed:', coreError);
      if (coreError.validationFailed) {
        return jsonResponse({ error: coreError.message, validationFailed: true }, 400);
      }
      if (coreError.validationErrors) {
        return jsonResponse({
          error: coreError.message,
          validationErrors: coreError.validationErrors,
          suggestion: "Моля, опитайте отново или свържете се с поддръжката"
        }, 400);
      }
      return jsonResponse({ error: `${ERROR_MESSAGES.PLAN_GENERATION_FAILED}: ${coreError.message}` }, 500);
    }

    // Save AI logs in the background when enabled
    if (result.plan && ctx?.waitUntil && await isAILoggingEnabled(env)) {
      ctx.waitUntil(saveLogsToGitHub(env, result.plan));
    }

    return jsonResponse(result);
  } catch (error) {
    console.error('Error generating plan:', error);
    return jsonResponse({ error: `${ERROR_MESSAGES.PLAN_GENERATION_FAILED}: ${error.message}` }, 500);
  }
}

/**
 * Helper function to clean a response by removing REGENERATE_PLAN from a given index
 * Returns a fallback error message if the cleaned response is empty
 */
function cleanResponseFromRegenerate(aiResponse, regenerateIndex) {
  const cleanedResponse = aiResponse.substring(0, regenerateIndex).trim();
  return cleanedResponse || ERROR_MESSAGE_PARSE_FAILURE;
}

// KV key prefix and TTL for async plan generation jobs
const PLAN_JOB_PREFIX = 'plan_job:';
const PLAN_JOB_TTL_SEC = 86400; // 24 hours
// Regex for validating client-provided jobIds (UUID v4 format)
const JOB_ID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Core plan-generation logic shared by both the synchronous and async endpoints.
 * Returns the ready-to-send result object (same shape as the synchronous endpoint)
 * or throws on unrecoverable error.
 */
async function generatePlanCore(env, data, onAnalysisReady = null) {
  // Resolve clinical protocol
  const clinicalProtocol = getClinicalProtocol(data.clinicalProtocol);
  if (clinicalProtocol) {
    if (data.clinicalProtocol === 'postpartum_lactation' && data.postpartumGoal) {
      data.goal = Array.isArray(data.postpartumGoal)
        ? data.postpartumGoal.join(' + ')
        : data.postpartumGoal;
    }
    if (!data.goal) data.goal = clinicalProtocol.goalMapping;
    if (!data.medicalConditions || data.medicalConditions.length === 0) {
      data.medicalConditions = [clinicalProtocol.name];
    }
  }

  // Validate data adequacy
  const valConfig = await getValidationConfig(env);
  const dataValidation = validateDataAdequacy(data, valConfig);
  if (!dataValidation.isValid) {
    const err = /** @type {any} */ (new Error(dataValidation.errorMessage));
    err.validationFailed = true;
    throw err;
  }

  const userId = data.email || generateUserId(data);

  // Check for goal contradictions
  const { hasContradiction, canProceed: contradictionCanProceed, warningData } = detectGoalContradiction(data, valConfig);
  if (hasContradiction && !contradictionCanProceed) {
    return { success: true, hasContradiction: true, warningData, userId };
  }

  // Generate plan (multi-step AI)
  let structuredPlan = await generatePlanMultiStep(env, data, onAnalysisReady);

  // In-place structural fixes: food substitutions + warnings (no AI regen — stable path)
  try {
    const foodLists = await getDynamicFoodListsSections(env);
    const validation = validatePlan(structuredPlan, data, foodLists.dynamicSubstitutions || []);
    if (validation.warnings?.length) {
      console.log(`Plan post-validation: ${validation.warnings.length} warning(s)`);
    }
    if (!validation.isValid) {
      console.warn('Plan post-validation issues (non-blocking):', validation.errors.slice(0, 8).join('; '));
    }
  } catch (validationErr) {
    console.warn('Plan post-validation skipped:', validationErr.message);
  }

  const correctionAttempts = 0;

  const cleanPlan = removeInternalJustifications(structuredPlan);
  if (clinicalProtocol && clinicalProtocol.hacks) {
    cleanPlan.hacks = clinicalProtocol.hacks;
  } else {
    cleanPlan.hacks = await getGoalHacks(env, data.goal);
  }
  if (clinicalProtocol) cleanPlan.clinicalProtocol = { id: clinicalProtocol.id, name: clinicalProtocol.name };

  return { success: true, plan: cleanPlan, userId, correctionAttempts };
}

/**
 * Generates a diet plan, stores the result (or failure) in KV under jobId.
 * Runs as a ctx.waitUntil() background task so the Worker stays alive even
 * after the HTTP client disconnects (e.g. Android app backgrounded/killed).
 */
async function generatePlanAndSave(env, data, jobId, clientId, options = {}) {
  const { requireApproval = false, userId: preferredUserId = '' } = options;
  console.log(`generatePlanAndSave: starting job ${jobId}${clientId ? ` (clientId: ${clientId})` : ''}`);
  try {
    const userId = preferredUserId || data.email || generateUserId(data);
    const result = await generatePlanCore(env, data, async (analysis) => {
      await env.page_content.put(
        PLAN_JOB_PREFIX + jobId,
        JSON.stringify({
          status: 'analysis_completed',
          analysisCompletedAt: Date.now(),
          success: true,
          userId,
          plan: { analysis }
        }),
        { expirationTtl: PLAN_JOB_TTL_SEC }
      );
      console.log(`generatePlanAndSave: job ${jobId} analysis saved to KV`);
    });
    await env.page_content.put(
      PLAN_JOB_PREFIX + jobId,
      JSON.stringify({ status: 'completed', completedAt: Date.now(), ...result, userId }),
      { expirationTtl: PLAN_JOB_TTL_SEC }
    );
    console.log(`generatePlanAndSave: job ${jobId} completed and saved to KV`);

    if (result.success && result.plan && normalizeEmail(data.email)) {
      try {
        const syncResult = await syncPlanToEmailCanonicalStore(env, {
          email: data.email,
          plan: result.plan,
          userData: data,
          userId,
          clientId: clientId || '',
          requireApproval,
        });
        console.log(`generatePlanAndSave: job ${jobId} synced to email store`, syncResult);
      } catch (e) {
        console.warn(`generatePlanAndSave: failed to sync plan by email for job ${jobId}:`, e.message);
      }
    } else if (clientId && result.success && result.plan) {
      try {
        const raw = await env.page_content.get(`client:${clientId}`);
        if (raw) {
          const clientData = JSON.parse(raw);
          const wasPreviouslyActivated = Boolean(clientData.planActivatedAt);
          clientData.plan = result.plan;
          if (userId) clientData.userId = userId;
          clientData.planUpdatedAt = new Date().toISOString();
          clientData.planStatus = requireApproval
            ? 'pending'
            : (wasPreviouslyActivated ? 'activated' : 'pending');
          if (requireApproval) {
            clientData.planActivatedAt = null;
          } else if (wasPreviouslyActivated) {
            clientData.planActivatedAt = new Date().toISOString();
          } else {
            clientData.planActivatedAt = null;
          }
          await env.page_content.put(`client:${clientId}`, JSON.stringify(clientData));
          console.log(`generatePlanAndSave: job ${jobId} plan saved to client record ${clientId}`);
        }
      } catch (e) {
        console.warn(`generatePlanAndSave: failed to update client record ${clientId}:`, e.message);
      }
    }
  } catch (error) {
    console.error(`generatePlanAndSave: job ${jobId} failed:`, error);
    // Use try/catch instead of .catch() so a synchronous throw (e.g. env.page_content
    // undefined) does not propagate and cause the queue message to be retried
    // unnecessarily, leaving the KV entry permanently stuck as 'pending'.
    try {
      await env.page_content.put(
        PLAN_JOB_PREFIX + jobId,
        JSON.stringify({
          status: 'failed',
          failedAt: Date.now(),
          error: error.message,
          validationFailed: error.validationFailed || false
        }),
        { expirationTtl: PLAN_JOB_TTL_SEC }
      );
      console.log(`generatePlanAndSave: job ${jobId} failure status written to KV`);
    } catch (e) {
      console.error(`generatePlanAndSave: job ${jobId} – failed to write failure status to KV:`, e);
    }
    // Record the failure reason in the admin-visible client record so the admin can
    // see why no plan is ready without having to inspect Worker logs.
    if (clientId) {
      try {
        const raw = await env.page_content.get(`client:${clientId}`);
        if (raw) {
          const clientData = JSON.parse(raw);
          clientData.planStatus = 'failed';
          clientData.planGenerationError = error.message || 'Неизвестна грешка';
          clientData.planUpdatedAt = new Date().toISOString();
          await env.page_content.put(`client:${clientId}`, JSON.stringify(clientData));
        }
      } catch (e) {
        console.warn(`generatePlanAndSave: could not write failure to client record ${clientId}:`, e.message);
      }
    }
  }
}

/**
 * POST /api/generate-plan-async
 * Starts a background diet-plan generation job and returns immediately with a jobId.
 *
 * The generation is dispatched to a Cloudflare Queue (env.PLAN_QUEUE) so it runs
 * inside a dedicated queue-consumer Worker invocation that has up to 15 minutes of
 * execution time.  This avoids the ~30-second ctx.waitUntil() grace-period limit of
 * the Bundled/Standard execution model which was causing jobs to be cancelled before
 * completion.
 *
 * When env.PLAN_QUEUE is not bound (local dev or queue not yet created) the code
 * falls back to ctx.waitUntil() so the app still works without queue infrastructure.
 *
 * Queue setup (run once in the Cloudflare dashboard or with wrangler CLI):
 *   wrangler queues create plan-generation
 *
 * The client polls /api/plan-job-status?jobId=<id> for the result.
 */
async function handleGeneratePlanAsync(request, env, ctx) {
  try {
    const rawBody = await request.json();
    // Accept a client-generated jobId (UUID format) so the client can persist it
    // in localStorage BEFORE the request starts, enabling resume-on-reopen even
    // if the app is closed while the Worker is generating the plan.
    const jobId = (rawBody._jobId && JOB_ID_UUID_RE.test(String(rawBody._jobId)))
      ? String(rawBody._jobId)
      : crypto.randomUUID();
    const clientId = (typeof rawBody._clientId === 'string' && rawBody._clientId.startsWith('client_'))
      ? rawBody._clientId : null;
    const requireApproval = rawBody._requireApproval === true;
    const explicitUserId = typeof rawBody._userId === 'string' ? rawBody._userId.trim() : '';
    const idToken = typeof rawBody._idToken === 'string' ? rawBody._idToken : null;
    delete rawBody._jobId;
    delete rawBody._clientId;
    delete rawBody._requireApproval;
    delete rawBody._userId;
    delete rawBody._idToken;

    const data = normalizeQuestionnaireData(rawBody);
    if (!data.name || !data.age || !data.weight || !data.height) {
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_FIELDS }, 400);
    }

    if (requireApproval) {
      if (!normalizeEmail(data.email)) {
        return jsonResponse({ error: 'Email is required for plan regeneration' }, 400);
      }
      if (!explicitUserId.startsWith('fb_') || !idToken) {
        return jsonResponse({ error: 'Authentication required to replace an existing plan' }, 401);
      }
      if (env.FIREBASE_PROJECT_ID) {
        try {
          const firebaseUser = await verifyFirebaseIdToken(idToken, env);
          if (`fb_${firebaseUser.uid}` !== explicitUserId) {
            return jsonResponse({ error: 'Token does not match userId' }, 403);
          }
          const tokenEmail = normalizeEmail(firebaseUser.email);
          const dataEmail = normalizeEmail(data.email);
          if (tokenEmail && dataEmail && tokenEmail !== dataEmail) {
            return jsonResponse({ error: 'Email mismatch' }, 403);
          }
        } catch (_) {
          return jsonResponse({ error: 'Invalid Firebase ID token' }, 401);
        }
      }
    }

    let resolvedClientId = clientId;
    if (!resolvedClientId && data.email) {
      const existingClient = await findClientByEmail(env, data.email);
      if (existingClient) resolvedClientId = existingClient.clientId;
    }

    const generationOptions = {
      requireApproval,
      userId: explicitUserId || '',
    };

    // Write initial 'pending' marker so polling can detect the job even if the
    // client disconnects and reconnects before the plan is ready.
    // If this KV write fails the response will still contain the jobId but polling
    // will immediately return 'not_found'; the user will then see a "session expired"
    // error message and be prompted to retry.
    await env.page_content.put(
      PLAN_JOB_PREFIX + jobId,
      JSON.stringify({ status: 'pending', startedAt: Date.now() }),
      { expirationTtl: PLAN_JOB_TTL_SEC }
    );

    if (env.PLAN_QUEUE) {
      // Preferred path: enqueue the job so it runs in a fresh Worker invocation
      // with up to 15 minutes of execution time (see the queue handler below).
      // The queue binding is configured in wrangler.toml; see the comment at the
      // top of this function for the one-time setup command.
      await env.PLAN_QUEUE.send({
        jobId,
        data,
        clientId: resolvedClientId,
        generationOptions,
      }, { contentType: 'json' });
    } else {
      // Fallback: ctx.waitUntil() for local dev / environments without the queue.
      // WARNING: This path may be cancelled by Cloudflare after ~30 seconds on the
      // Bundled/Standard execution model.
      console.warn('handleGeneratePlanAsync: PLAN_QUEUE not bound – falling back to ctx.waitUntil(). Run "wrangler queues create plan-generation" to fix this.');
      ctx.waitUntil(generatePlanAndSave(env, data, jobId, resolvedClientId, generationOptions));
    }

    return jsonResponse({ success: true, jobId });
  } catch (error) {
    console.error('handleGeneratePlanAsync error:', error);
    return jsonResponse({ error: ERROR_MESSAGES.PLAN_GENERATION_FAILED }, 500);
  }
}

/**
 * GET /api/plan-job-status?jobId=<id>
 * Returns the current status of an async plan generation job.
 * Possible status values: 'pending' | 'completed' | 'failed' | 'not_found'
 */
async function handleGetPlanJobStatus(request, env) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return jsonResponse({ error: 'Missing jobId' }, 400);

  const raw = await env.page_content.get(PLAN_JOB_PREFIX + jobId);
  if (!raw) return jsonResponse({ status: 'not_found' });

  return jsonResponse(JSON.parse(raw));
}

/**
 * Handle chat assistant requests
 * REVOLUTIONARY OPTIMIZATION: Supports both full-context (legacy) and cached-context modes
 * Cached-context mode reduces payload from 10-20KB to ~100 bytes (85-95% reduction)
 */
async function handleChat(request, env) {
  try {
    const { message, userId, conversationId, mode, userData, userPlan, conversationHistory } = await request.json();
    
    if (!message) {
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_MESSAGE }, 400);
    }

    if (!userData || !userPlan) {
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_CONTEXT }, 400);
    }

    const effectiveUserData = userData;
    const effectiveUserPlan = userPlan;

    // Use conversation history from client (defaults to empty array)
    const chatHistory = conversationHistory || [];
    
    // Determine chat mode (default: consultation), enforcing admin mode configuration
    const requestedMode = mode || 'consultation';
    const chatPromptsConfig = await getChatPrompts(env);
    const modificationModeEnabled = chatPromptsConfig.modificationEnabled === true;
    const chatMode = (requestedMode === 'modification' && !modificationModeEnabled)
      ? 'consultation'
      : requestedMode;
    
    // Build chat prompt with context and mode
    const chatPrompt = await generateChatPrompt(env, message, effectiveUserData, effectiveUserPlan, chatHistory, chatMode);
    
    // Call AI model with standard token limit (no need for large JSONs with new regeneration approach)
    // Skip JSON enforcement for chat to get plain text conversational responses
    const aiResponse = await callAIModel(env, chatPrompt, 2000, 'chat_consultation', null, effectiveUserData, null, true);
    
    // Check if the response contains a plan regeneration instruction
    const regenerateIndex = aiResponse.indexOf('[REGENERATE_PLAN:');
    let finalResponse = aiResponse;
    let planWasUpdated = false;
    let updatedPlan = null;
    let updatedUserData = null;
    
    if (regenerateIndex !== -1) {
      // Always parse and remove REGENERATE_PLAN from the response, regardless of mode
      try {
        // Find the JSON content between [REGENERATE_PLAN: and the matching closing ]
        const jsonStart = regenerateIndex + '[REGENERATE_PLAN:'.length;
        let jsonEnd = -1;
        let bracketCount = 0;
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        
        // Parse character by character to find where the JSON ends
        for (let i = jsonStart; i < aiResponse.length; i++) {
          const char = aiResponse[i];
          
          // Handle escape sequences in strings (e.g., \", \\)
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          // Track whether we're inside a string (to ignore brackets in string values)
          if (char === '"') {
            inString = !inString;
            continue;
          }
          
          // Only count brackets/braces outside of strings
          if (!inString) {
            if (char === '{') {
              braceCount++;
            } else if (char === '}') {
              braceCount--;
            } else if (char === '[') {
              bracketCount++;
            } else if (char === ']') {
              // If both counts are 0 before decrementing, this ] closes REGENERATE_PLAN
              if (braceCount === 0 && bracketCount === 0) {
                jsonEnd = i;
                break;
              }
              bracketCount--;
            }
          }
        }
        
        if (jsonEnd > jsonStart) {
          const jsonContent = aiResponse.substring(jsonStart, jsonEnd);
          
          // Remove the REGENERATE_PLAN instruction from the response
          const beforeRegenerate = aiResponse.substring(0, regenerateIndex);
          const afterRegenerate = aiResponse.substring(jsonEnd + 1);
          finalResponse = (beforeRegenerate + afterRegenerate).trim();
          
          // Only actually regenerate if we're in modification mode
          if (chatMode === 'modification') {
            const regenerateData = JSON.parse(jsonContent);
            const modifications = regenerateData.modifications || [];
            
            // Apply modifications to user data and regenerate plan
            // Use Set to avoid duplicates when accumulating modifications
            const existingMods = new Set(userData.planModifications || []);
            const excludedFoods = new Set((userData.dietDislike || '').split(',').map(f => f.trim()).filter(f => f));
            
            // Enhancement #4: Validate food exclusions against current plan
            const validatedModifications = [];
            
            modifications.forEach(mod => {
              if (mod.startsWith('exclude_food:')) {
                // Extract food name from "exclude_food:име_на_храна"
                const foodName = mod.substring('exclude_food:'.length).trim();
                if (foodName) {
                  // Add to excluded foods regardless (as preference for future plan generations)
                  excludedFoods.add(foodName);
                  validatedModifications.push(mod);
                }
              } else {
                existingMods.add(mod);
                validatedModifications.push(mod);
              }
            });
            
            const modifiedUserData = {
              ...userData,
              planModifications: Array.from(existingMods),
              dietDislike: Array.from(excludedFoods).join(', ')
            };
            
            // Regenerate the plan using multi-step approach with new criteria
            // Return updated data to client - no server storage
            const newPlan = await generatePlanMultiStep(env, modifiedUserData);
            
            planWasUpdated = true;
            updatedPlan = newPlan;
            updatedUserData = modifiedUserData;
          } else {
          }
        } else {
          console.error('Could not find closing bracket for REGENERATE_PLAN');
          console.error('AI Response excerpt (last 500 chars):', aiResponse.substring(Math.max(0, aiResponse.length - 500)));
          finalResponse = cleanResponseFromRegenerate(aiResponse, regenerateIndex);
        }
      } catch (error) {
        console.error('Error processing plan regeneration:', error);
        console.error('Error details:', error.message);
        console.error('AI Response excerpt (last 500 chars):', aiResponse.substring(Math.max(0, aiResponse.length - 500)));
        finalResponse = cleanResponseFromRegenerate(aiResponse, regenerateIndex);
      }
    }
    
    // Build updated conversation history for client to store
    const updatedHistory = [...chatHistory];
    updatedHistory.push(
      { role: 'user', content: message },
      { role: 'assistant', content: finalResponse }
    );
    
    // Trim history to keep within token budget - keeping more history for better context
    const MAX_HISTORY_TOKENS = 2000;
    let totalTokens = 0;
    const trimmedHistory = [];
    
    // Process history in reverse to keep most recent messages
    for (let i = updatedHistory.length - 1; i >= 0; i--) {
      const msg = updatedHistory[i];
      const messageTokens = estimateTokenCount(msg.content);
      
      if (totalTokens + messageTokens <= MAX_HISTORY_TOKENS) {
        trimmedHistory.unshift(msg);
        totalTokens += messageTokens;
      } else {
        // Stop adding older messages
        break;
      }
    }
    
    console.log(`Conversation history trimmed to ${trimmedHistory.length} messages (~${totalTokens} tokens)`);
    
    const responseData = { 
      success: true, 
      response: finalResponse,
      conversationHistory: trimmedHistory,
      planUpdated: planWasUpdated
    };
    
    // Include updated plan and userData if plan was regenerated
    if (planWasUpdated) {
      responseData.updatedPlan = updatedPlan;
      responseData.updatedUserData = updatedUserData;
    }
    
    return jsonResponse(responseData);
  } catch (error) {
    console.error('Error in chat:', error);
    return jsonResponse({ error: `${ERROR_MESSAGES.CHAT_FAILED}: ${error.message}` }, 500);
  }
}

/**
 * Format an ISO timestamp into a human-readable Bulgarian date/time string.
 * Example: "2026-04-22T22:54:13.133Z" → "22.04.2026 в 22:54"
 * @param {string} isoString
 * @returns {string}
 */
function formatDateBG(isoString) {
  try {
    const d = new Date(isoString);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} в ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  } catch {
    return isoString;
  }
}

/**
 * Fire-and-forget notification to Make webhook → Telegram bot.
 * @param {object} ctx     - Cloudflare execution context
 * @param {string} telegramMessage - Pre-formatted text to send via Telegram
 */
function notifyMake(ctx, telegramMessage) {
  const p = fetch('https://hook.eu2.make.com/lexmz9kes4d3epra9btsqeqwdla06iqq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramMessage })
  }).catch(e => console.warn('Make webhook notification failed:', e));
  if (ctx?.waitUntil) ctx.waitUntil(p);
}

// ─── Email notification via Resend API ───

/**
 * Build the HTML body for the "plan ready" email notification.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Default email template fields for the "plan ready" notification.
 * All fields can be overridden via admin panel (stored in KV under 'email_template_plan_ready').
 */
const DEFAULT_EMAIL_TEMPLATE = {
  subject: 'Вашият персонален хранителен план е готов! 🥗',
  headerTitle: '🍽️ Nutri Plan',
  headerSubtitle: 'Персонален хранителен план',
  greeting: 'Здравейте, {name}! 👋',
  paragraph1: 'Радваме се да ви съобщим, че вашият <strong>персонален 7-дневен хранителен план</strong> е готов и вече е достъпен!',
  paragraph2: 'Нашият специалист внимателно е разгледал вашите данни и е изготвил индивидуален план, съобразен с вашите цели и нужди.',
  buttonText: 'Виж моя план →',
  contactEmail: 'info@biocode.online'
};

/**
 * Build the HTML body for the "plan ready" email notification.
 * Uses template fields (merged from KV or defaults).
 */
function buildPlanReadyEmailHtml(clientName, tpl) {
  const t = Object.assign({}, DEFAULT_EMAIL_TEMPLATE, tpl || {});
  const safeName = escapeHtml(clientName);
  const safeGreeting = escapeHtml(t.greeting.replace('{name}', clientName));
  const safeHeaderTitle = escapeHtml(t.headerTitle);
  const safeHeaderSubtitle = escapeHtml(t.headerSubtitle);
  const safeButtonText = escapeHtml(t.buttonText);
  const safeContactEmail = escapeHtml(t.contactEmail);
  // paragraph1 and paragraph2 may contain intentional HTML (<strong> etc.), so used as-is
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Вашият план е готов</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:30px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:600px;">
          <tr>
            <td style="background:linear-gradient(135deg,#4CAF50,#2196F3);padding:40px 40px 30px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:28px;font-weight:700;">${safeHeaderTitle}</h1>
              <p style="color:rgba(255,255,255,0.9);margin:10px 0 0;font-size:16px;">${safeHeaderSubtitle}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="color:#333333;margin:0 0 20px;font-size:22px;">${safeGreeting}</h2>
              <p style="color:#555555;font-size:16px;line-height:1.6;margin:0 0 20px;">
                ${t.paragraph1}
              </p>
              <p style="color:#555555;font-size:16px;line-height:1.6;margin:0 0 30px;">
                ${t.paragraph2}
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 30px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#4CAF50,#2196F3);border-radius:8px;">
                    <a href="https://biocode.website/plan.html" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">${safeButtonText}</a>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fffe;border:1px solid #e0f2e9;border-radius:8px;margin-bottom:30px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="color:#333;font-size:15px;margin:0 0 10px;font-weight:600;">Какво включва вашият план:</p>
                    <ul style="color:#555;font-size:15px;line-height:1.8;margin:0;padding-left:20px;">
                      <li>7-дневна програма с подробни рецепти</li>
                      <li>Изчислени калории и макронутриенти</li>
                      <li>Персонализирани препоръки и добавки</li>
                      <li>Чат консултация с AI диетолог</li>
                    </ul>
                  </td>
                </tr>
              </table>
              <p style="color:#777777;font-size:14px;line-height:1.6;margin:0;">
                Ако имате въпроси, пишете ни на <a href="mailto:${safeContactEmail}" style="color:#4CAF50;text-decoration:none;">${safeContactEmail}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #eeeeee;text-align:center;">
              <p style="color:#999999;font-size:13px;margin:0;">&copy; ${year} Nutri Plan &mdash; Персонален хранителен план</p>
              <p style="color:#999999;font-size:12px;margin:5px 0 0;">biocode.online</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Build the HTML body for the password-reset email.
 * @param {string} oobLink     - Firebase password-reset OOB link
 * @param {string} contactEmail
 */
function buildPasswordResetEmailHtml(oobLink, contactEmail = 'info@biocode.online') {
  const safeContactEmail = escapeHtml(contactEmail);
  const safeOobLink = oobLink; // URL – must not be HTML-escaped (breaks href)
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Нулиране на парола</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:30px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:600px;">
          <tr>
            <td style="background:linear-gradient(135deg,#4CAF50,#2196F3);padding:40px 40px 30px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:28px;font-weight:700;">🍽️ Nutri Plan</h1>
              <p style="color:rgba(255,255,255,0.9);margin:10px 0 0;font-size:16px;">Нулиране на парола</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="color:#333333;margin:0 0 20px;font-size:22px;">Заявка за нулиране на парола 🔒</h2>
              <p style="color:#555555;font-size:16px;line-height:1.6;margin:0 0 20px;">
                Получихме заявка за нулиране на паролата за вашия акаунт в Nutri Plan.
              </p>
              <p style="color:#555555;font-size:16px;line-height:1.6;margin:0 0 30px;">
                Натиснете бутона по-долу, за да зададете нова парола. Линкът е валиден за <strong>1 час</strong>.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 30px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#4CAF50,#2196F3);border-radius:8px;">
                    <a href="${safeOobLink}" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">Нулирай паролата →</a>
                  </td>
                </tr>
              </table>
              <p style="color:#777777;font-size:14px;line-height:1.6;margin:0 0 16px;">
                Ако не сте поискали нулиране на парола, можете да игнорирате този имейл. Акаунтът ви е в безопасност.
              </p>
              <p style="color:#777777;font-size:14px;line-height:1.6;margin:0;">
                Ако имате въпроси, пишете ни на <a href="mailto:${safeContactEmail}" style="color:#4CAF50;text-decoration:none;">${safeContactEmail}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #eeeeee;text-align:center;">
              <p style="color:#999999;font-size:13px;margin:0;">&copy; ${year} Nutri Plan &mdash; Персонален хранителен план</p>
              <p style="color:#999999;font-size:12px;margin:5px 0 0;">biocode.online</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Obtain a short-lived Google OAuth2 access token using a Firebase service account.
 *
 * Requires env.FIREBASE_SERVICE_ACCOUNT to be set to the service account JSON
 * (stored as a Cloudflare Worker secret).
 * The token grants the `identitytoolkit` scope needed to call the Firebase
 * Identity Toolkit admin endpoints (e.g. returnOobLink).
 *
 * @param {object} env
 * @returns {Promise<string>} access token
 */
async function getFirebaseAdminToken(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT не е конфигуриран.');

  let sa;
  try {
    sa = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT е невалиден JSON.');
  }

  if (!sa.private_key || !sa.client_email) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT: липсват private_key или client_email.');
  }

  // Convert PEM PKCS#8 private key → DER → CryptoKey
  const pemContents = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Build a JWT for the token exchange
  const b64url = obj =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const now = Math.floor(Date.now() / 1000);
  const header  = b64url({ alg: 'RS256', typ: 'JWT' });
  const payload = b64url({
    iss:   sa.client_email,
    sub:   sa.client_email,
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
  });

  const sigInput = new TextEncoder().encode(`${header}.${payload}`);
  const sigBuf   = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, sigInput);
  const sig      = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${header}.${payload}.${sig}`;

  // Exchange JWT for an OAuth access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text().catch(() => '');
    throw new Error(`Google OAuth token exchange failed (${tokenRes.status}): ${err}`);
  }

  const { access_token } = await tokenRes.json();
  if (!access_token) throw new Error('Не е получен access_token от Google OAuth.');
  return access_token;
}

async function deleteFirebaseAuthUser(uid, env, adminToken) {
  if (!uid) throw new Error('Missing Firebase uid');
  if (!env.FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID не е конфигуриран.');
  }

  const token = adminToken || await getFirebaseAdminToken(env);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/accounts:delete`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localId: uid }),
    }
  );

  if (response.ok) {
    return { deleted: true, alreadyMissing: false };
  }

  const errorText = await response.text().catch(() => '');
  if (errorText.includes('USER_NOT_FOUND')) {
    return { deleted: false, alreadyMissing: true };
  }

  throw new Error(`Firebase delete failed (${response.status}): ${errorText || 'unknown error'}`);
}

/**
 * POST /api/auth/forgot-password
 *
 * Generates a Firebase password-reset link and delivers it to the user via
 * the same Resend-based email infrastructure used for admin-activated plans.
 *
 * Priority:
 *  1. Firebase Admin REST API (returnOobLink:true) → Resend branded email
 *  2. Fallback: Firebase client REST API (server-side, bypasses domain restriction)
 *     → Firebase sends its own email
 *
 * Requires Worker secrets:
 *   FIREBASE_SERVICE_ACCOUNT  (JSON of a Firebase service account key – for option 1)
 *   FIREBASE_WEB_API_KEY      (Firebase web API key – for option 2 fallback)
 *   RESEND_API_KEY            (for option 1)
 *
 * Always returns HTTP 200 { success: true } to prevent email-enumeration attacks.
 */
async function handleForgotPassword(request, env) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRe.test(email)) {
      return jsonResponse({ error: 'Невалиден имейл адрес.' }, 400);
    }

    // ── Try to get OOB link via Firebase Admin REST API ──────────────────────
    let oobLink = null;
    try {
      const adminToken = await getFirebaseAdminToken(env);

      const fbRes = await fetch(
        'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requestType: 'PASSWORD_RESET', email, returnOobLink: true }),
        }
      );

      if (fbRes.ok) {
        const data = await fbRes.json();
        oobLink = data.oobLink || null;
      } else {
        const errText = await fbRes.text().catch(() => '');
        if (errText.includes('EMAIL_NOT_FOUND')) {
          // Do not reveal whether the email exists
          return jsonResponse({ success: true });
        }
        console.warn(`[ForgotPassword] Firebase Admin API ${fbRes.status}: ${errText}`);
      }
    } catch (adminErr) {
      console.warn('[ForgotPassword] Admin token error (will use fallback):', adminErr.message);
    }

    if (oobLink) {
      // ── Send branded Resend email with the reset link ─────────────────────
      const tpl = await getEmailTemplate(env);
      const contactEmail = tpl.contactEmail || DEFAULT_EMAIL_TEMPLATE.contactEmail;
      await sendEmailViaSMTP(
        env,
        email,
        'Нулиране на парола — Nutri Plan 🔒',
        buildPasswordResetEmailHtml(oobLink, contactEmail)
      );
      console.log(`[ForgotPassword] Resend email sent to ${email}`);
    } else {
      // ── Fallback: trigger Firebase's own email server-side ────────────────
      // Server-side calls bypass Firebase's authorized-domain restriction.
      const apiKey = env.FIREBASE_WEB_API_KEY;
      if (!apiKey) {
        console.error('[ForgotPassword] No FIREBASE_WEB_API_KEY configured for fallback.');
        return jsonResponse({ error: 'Имейл услугата не е конфигурирана. Свържете се с администратора.' }, 500);
      }

      const fallbackRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
        }
      );

      if (!fallbackRes.ok) {
        const errText = await fallbackRes.text().catch(() => '');
        if (errText.includes('EMAIL_NOT_FOUND')) {
          return jsonResponse({ success: true });
        }
        console.warn(`[ForgotPassword] Firebase fallback ${fallbackRes.status}: ${errText}`);
      } else {
        console.log(`[ForgotPassword] Firebase fallback email triggered for ${email}`);
      }
    }

    // Always return success – never reveal whether an account exists
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[ForgotPassword] Unhandled error:', error.message);
    return jsonResponse({ error: 'Грешка при изпращане на имейл. Моля опитайте отново.' }, 500);
  }
}

/**
 * Send an email via the Resend API (https://resend.com).
 * Requires the Worker secret RESEND_API_KEY.
 */
async function sendEmailViaSMTP(env, to, subject, htmlBody) {
  const apiKey = env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY не е конфигуриран. Добавете го като Worker secret.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Nutri Plan <info@biocode.online>',
      to: [to],
      subject,
      html: htmlBody,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`[Email] Resend API error ${response.status}: ${err}`);
  }

  console.log(`[Email] Sent successfully to ${to}`);
}

/**
 * Handle problem report submission
 */
async function handleReportProblem(request, env, ctx) {
  try {
    const { userId, userName, message, timestamp, userAgent } = await request.json();
    
    if (!message) {
      return jsonResponse({ error: 'Message is required' }, 400);
    }
    
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Generate a unique report ID
    const reportId = `report_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Create report object
    const report = {
      id: reportId,
      userId: userId || 'anonymous',
      userName: userName || 'Anonymous',
      message: message,
      timestamp: timestamp || new Date().toISOString(),
      userAgent: userAgent || 'unknown',
      status: 'unread'
    };
    
    // Store report in KV with reportId as key
    await env.page_content.put(`problem_report:${reportId}`, JSON.stringify(report));
    
    // Also maintain a list of all report IDs for easy retrieval
    let reportsList = await env.page_content.get('problem_reports_list');
    reportsList = reportsList ? JSON.parse(reportsList) : [];
    reportsList.unshift(reportId); // Add to beginning (most recent first)
    
    // Keep only last 100 reports in the list
    if (reportsList.length > 100) {
      reportsList = reportsList.slice(0, 100);
    }
    
    await env.page_content.put('problem_reports_list', JSON.stringify(reportsList));
    
    console.log('Problem report saved:', reportId);
    notifyMake(ctx,
      `🐛 Доклад за проблем\n\n` +
      `👤 Потребител: ${report.userName}\n` +
      `🆔 ID: ${report.userId}\n` +
      `💬 Съобщение: ${report.message}\n` +
      `📅 Дата: ${formatDateBG(report.timestamp)}`
    );

    return jsonResponse({ 
      success: true, 
      reportId: reportId,
      message: 'Report submitted successfully'
    });
  } catch (error) {
    console.error('Error saving problem report:', error);
    return jsonResponse({ error: `Failed to save report: ${error.message}` }, 500);
  }
}

/**
 * Get all problem reports for admin panel
 */
async function handleGetReports(request, env) {
  try {
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get list of report IDs
    const reportsList = await env.page_content.get('problem_reports_list');
    if (!reportsList) {
      return jsonResponse({ success: true, reports: [] });
    }
    
    const reportIds = JSON.parse(reportsList);
    
    // Fetch all reports in parallel for better performance
    const reportPromises = reportIds.map(reportId => 
      env.page_content.get(`problem_report:${reportId}`)
    );
    
    const reportDataList = await Promise.all(reportPromises);
    const reports = reportDataList
      .filter(data => data !== null)
      .map(data => JSON.parse(data));
    
    return jsonResponse({ success: true, reports: reports }, 200, {
      cacheControl: 'public, max-age=120' // Cache for 2 minutes - reports can be somewhat dynamic
    });
  } catch (error) {
    console.error('Error getting problem reports:', error);
    return jsonResponse({ error: `Failed to get reports: ${error.message}` }, 500);
  }
}

/**
 * Handle contact form submission from index.html / profile.html
 */
async function handleContactMessage(request, env, ctx) {
  try {
    const { name, email, subject, message, userId, timestamp, userAgent } = await request.json();

    if (!message || !name) {
      return jsonResponse({ error: 'Name and message are required' }, 400);
    }

    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }

    const msgId = `contact_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const contactMsg = {
      id: msgId,
      name: name,
      email: email || '',
      subject: subject || '',
      message: message,
      userId: userId || 'anonymous',
      timestamp: timestamp || new Date().toISOString(),
      userAgent: userAgent || 'unknown',
      status: 'unread'
    };

    await env.page_content.put(`contact_message:${msgId}`, JSON.stringify(contactMsg));

    let msgList = await env.page_content.get('contact_messages_list');
    msgList = msgList ? JSON.parse(msgList) : [];
    msgList.unshift(msgId);
    if (msgList.length > 200) msgList = msgList.slice(0, 200);
    await env.page_content.put('contact_messages_list', JSON.stringify(msgList));

    console.log('Contact message saved:', msgId);
    notifyMake(ctx,
      `📩 Ново Контакт Съобщение\n\n` +
      `👤 Име: ${contactMsg.name}\n` +
      `📧 Имейл: ${contactMsg.email || '—'}\n` +
      `📋 Тема: ${contactMsg.subject || '—'}\n` +
      `💬 Съобщение: ${contactMsg.message}\n` +
      `📅 Дата: ${formatDateBG(contactMsg.timestamp)}`
    );

    return jsonResponse({ success: true, messageId: msgId, message: 'Message sent successfully' });
  } catch (error) {
    console.error('Error saving contact message:', error);
    return jsonResponse({ error: `Failed to save contact message: ${error.message}` }, 500);
  }
}

/**
 * Get all contact messages for admin panel
 */
async function handleGetContactMessages(request, env) {
  try {
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }

    const msgList = await env.page_content.get('contact_messages_list');
    if (!msgList) {
      return jsonResponse({ success: true, messages: [] });
    }

    const msgIds = JSON.parse(msgList);
    const fetchPromises = msgIds.map(id => env.page_content.get(`contact_message:${id}`));
    const dataList = await Promise.all(fetchPromises);
    const messages = dataList
      .filter(data => data !== null)
      .map(data => JSON.parse(data));

    return jsonResponse({ success: true, messages }, 200, {
      cacheControl: 'public, max-age=60'
    });
  } catch (error) {
    console.error('Error getting contact messages:', error);
    return jsonResponse({ error: `Failed to get contact messages: ${error.message}` }, 500);
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function findClientByEmail(env, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !env.page_content) return null;

  const emailIndex = await kvGetJSON(env, `email_index:${normalizedEmail}`);
  if (emailIndex?.clientId) {
    const clientData = await kvGetJSON(env, `client:${emailIndex.clientId}`);
    if (clientData) {
      return { clientId: emailIndex.clientId, clientData };
    }
  }

  const clientIds = await kvGetJSON(env, 'clients_list') || [];
  for (const clientId of clientIds.slice(0, 500)) {
    const clientData = await kvGetJSON(env, `client:${clientId}`);
    if (!clientData) continue;
    const clientEmail = normalizeEmail(clientData.answers?.email);
    if (clientEmail === normalizedEmail) {
      await setEmailIndex(env, normalizedEmail, {
        userId: clientData.userId || emailIndex?.userId || '',
        clientId,
      });
      return { clientId, clientData };
    }
  }

  return null;
}

async function getEmailIndex(env, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !env.page_content) return null;
  return kvGetJSON(env, `email_index:${normalizedEmail}`);
}

async function setEmailIndex(env, email, { userId, clientId }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !env.page_content) return;
  const existing = (await getEmailIndex(env, normalizedEmail)) || {};
  let resolvedUserId = userId || existing.userId || '';
  if (userId?.startsWith('fb_')) {
    resolvedUserId = userId;
  } else if (existing.userId?.startsWith('fb_')) {
    resolvedUserId = existing.userId;
  }
  const next = {
    userId: resolvedUserId,
    clientId: clientId || existing.clientId || '',
    updatedAt: new Date().toISOString(),
  };
  await kvPutJSON(env, `email_index:${normalizedEmail}`, next, null);
}

/**
 * Canonical plan store keyed by email: one client record + one user profile per email.
 * Replaces any previous plan for the same email in admin and cross-device restore.
 */
async function syncPlanToEmailCanonicalStore(env, {
  email,
  plan = null,
  userData = null,
  userId = '',
  clientId = '',
  requireApproval = false,
}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !env.page_content) {
    return { clientId: clientId || null, userId: userId || null, planStatus: 'none' };
  }

  let resolvedClientId = clientId || '';
  let clientData = null;

  if (resolvedClientId) {
    clientData = await kvGetJSON(env, `client:${resolvedClientId}`);
  }
  if (!clientData) {
    const existing = await findClientByEmail(env, normalizedEmail);
    if (existing) {
      resolvedClientId = existing.clientId;
      clientData = existing.clientData;
    }
  }

  const now = new Date().toISOString();
  if (!clientData) {
    resolvedClientId = resolvedClientId || `client_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    clientData = {
      id: resolvedClientId,
      timestamp: now,
      submittedAt: now,
      answers: userData || {},
      files: [],
      plan: null,
      planStatus: 'none',
      planUpdatedAt: null,
      planActivatedAt: null,
      userId: '',
    };
  }

  if (userData) {
    clientData.answers = { ...(clientData.answers || {}), ...userData };
  }
  if (plan) {
    clientData.plan = plan;
    clientData.planUpdatedAt = now;
    if (requireApproval) {
      clientData.planStatus = 'pending';
      clientData.planActivatedAt = null;
    } else {
      const wasPreviouslyActivated = Boolean(clientData.planActivatedAt);
      clientData.planStatus = wasPreviouslyActivated ? 'activated' : 'pending';
      clientData.planActivatedAt = wasPreviouslyActivated ? now : null;
    }
  }

  const emailIndex = await getEmailIndex(env, normalizedEmail);
  const preferredUserId = (userId && userId.startsWith('fb_'))
    ? userId
    : (clientData.userId?.startsWith('fb_')
      ? clientData.userId
      : (emailIndex?.userId?.startsWith('fb_')
        ? emailIndex.userId
        : (userId || clientData.userId || normalizedEmail)));

  clientData.userId = preferredUserId;
  clientData.id = resolvedClientId;

  await kvPutJSON(env, `client:${resolvedClientId}`, clientData, null);

  let clientsList = await kvGetJSON(env, 'clients_list') || [];
  clientsList = clientsList.filter(id => id !== resolvedClientId);
  clientsList.unshift(resolvedClientId);
  if (clientsList.length > 500) clientsList = clientsList.slice(0, 500);
  await kvPutJSON(env, 'clients_list', clientsList, null);

  await setEmailIndex(env, normalizedEmail, {
    userId: preferredUserId,
    clientId: resolvedClientId,
  });

  if (plan && preferredUserId) {
    await upsertUserProfilePlan(env, preferredUserId, {
      plan,
      userData: clientData.answers || {},
      planSource: requireApproval ? 'questionnaire2' : '',
      clientId: resolvedClientId,
      planUpdatedAt: now,
    });
  }

  if (plan && requireApproval && clientData.planStatus === 'pending') {
    sendPushNotificationToUser('admin', {
      title: 'Нов план чака преглед',
      body: `Клиент ${clientData.answers?.name || resolvedClientId} — регенериран план от профила.`,
      url: '/admin.html',
      icon: '/icon-192x192.png',
      notificationType: 'admin_plan_pending',
    }, env).catch(e => console.warn('Admin push notification failed:', e.message));
  }

  return {
    clientId: resolvedClientId,
    userId: preferredUserId,
    planStatus: clientData.planStatus,
  };
}

/**
 * Handle client data submission from questionnaire 2
 * Saves client data to KV storage for team processing
 * 
 * @example
 * // Request
 * POST /api/save-client-data
 * {
 *   "id": "client_1234567890_abc123",
 *   "timestamp": "2026-02-14T12:00:00.000Z",
 *   "answers": { ... },
 *   "files": [ ... ]
 * }
 * 
 * // Response
 * {
 *   "success": true,
 *   "clientId": "client_1234567890_abc123",
 *   "message": "Client data saved successfully"
 * }
 */
async function handleSaveClientData(request, env, ctx) {
  try {
    const data = await request.json();
    
    // Validate required fields
    if (!data.id || !data.timestamp || !data.answers) {
      return jsonResponse({ error: 'Missing required fields: id, timestamp, or answers' }, 400);
    }
    
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    const normalizedEmail = normalizeEmail(data.answers?.email);
    const existingClient = normalizedEmail ? await findClientByEmail(env, normalizedEmail) : null;
    const clientId = existingClient?.clientId || data.id;
    const existingClientData = existingClient?.clientData || null;
    
    // Create or update the canonical client data object for this email.
    const clientData = {
      ...(existingClientData || {}),
      id: clientId,
      timestamp: data.timestamp,
      answers: data.answers,
      files: data.files || [],
      plan: Object.prototype.hasOwnProperty.call(data, 'plan')
        ? (data.plan || null)
        : (existingClientData?.plan || null),
      planStatus: data.plan ? 'pending' : (existingClientData ? 'generating' : 'none'),
      planUpdatedAt: data.plan ? new Date().toISOString() : (existingClientData?.planUpdatedAt || null),
      submittedAt: new Date().toISOString()
    };

    if (!clientData.userId && existingClientData?.userId) {
      clientData.userId = existingClientData.userId;
    }
    
    // Store client data in KV with client: prefix
    await kvPutJSON(env, `client:${clientId}`, clientData, null);
    
    if (normalizedEmail) {
      await setEmailIndex(env, normalizedEmail, {
        userId: clientData.userId || '',
        clientId,
      });
    }
    
    // Maintain a list of all client IDs for easy retrieval
    let clientsList = await kvGetJSON(env, 'clients_list') || [];
    clientsList = clientsList.filter(id => id !== clientId);
    clientsList.unshift(clientId); // Add to beginning (most recent first)
    
    // Keep only last 500 clients in the list
    if (clientsList.length > 500) {
      clientsList = clientsList.slice(0, 500);
    }
    
    await kvPutJSON(env, 'clients_list', clientsList, null);
    
    console.log('Client data saved:', clientId);
    notifyMake(ctx,
      `📩 Ново запитване\n\n` +
      `👤 Клиент: ${clientData.answers?.name || clientId}\n` +
      `🆔 ID: ${clientId}\n` +
      `📧 Имейл: ${clientData.answers?.email || '—'}\n` +
      `🎯 Цел: ${clientData.answers?.goal || '—'}\n` +
      `📅 Дата: ${formatDateBG(clientData.submittedAt)}`
    );

    return jsonResponse({ 
      success: true, 
      clientId: clientId,
      message: 'Client data saved successfully'
    });
  } catch (error) {
    console.error('Error saving client data:', error);
    return jsonResponse({ error: `Failed to save client data: ${error.message}` }, 500);
  }
}

/**
 * Get list of all client IDs with basic info (for admin panel)
 * Returns: Array of { id, timestamp, name, email }
 */
async function handleGetClientsList(request, env) {
  try {
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get the list of all client IDs
    let clientsList = await env.page_content.get('clients_list');
    clientsList = clientsList ? JSON.parse(clientsList) : [];
    
    // The client directory in admin is fully client-side sortable/filterable,
    // so return the whole tracked list (already capped on write to the latest 500).
    const clientsToFetch = clientsList.slice(0, 500);
    
    // Fetch all clients in parallel for better performance
    const fetchPromises = clientsToFetch.map(async (clientId) => {
      try {
        const clientDataStr = await env.page_content.get(`client:${clientId}`);
        if (clientDataStr) {
          const clientData = JSON.parse(clientDataStr);
          return {
            id: clientData.id,
            timestamp: clientData.timestamp,
            submittedAt: clientData.submittedAt,
            name: clientData.answers?.name || 'N/A',
            email: clientData.answers?.email || 'N/A',
            goal: clientData.answers?.goal || 'N/A',
            age: clientData.answers?.age || null,
            gender: clientData.answers?.gender || '',
            userId: clientData.userId || '',
            hasPlan: Boolean(clientData.plan),
            planStatus: clientData.planStatus || 'none',
            planUpdatedAt: clientData.planUpdatedAt || null,
            planActivatedAt: clientData.planActivatedAt || null,
            planGenerationError: clientData.planGenerationError || ''
          };
        }
        return null;
      } catch (err) {
        console.error(`Error fetching client ${clientId}:`, err);
        return null;
      }
    });
    
    const results = await Promise.all(fetchPromises);
    const clientsData = results.filter(client => client !== null);
    const failedCount = results.length - clientsData.length;
    
    return jsonResponse({ 
      success: true, 
      clients: clientsData,
      total: clientsList.length,
      showing: clientsData.length,
      failedCount: failedCount
    });
  } catch (error) {
    console.error('Error getting clients list:', error);
    return jsonResponse({ error: `Failed to get clients list: ${error.message}` }, 500);
  }
}

/**
 * Delete questionnaire clients and their linked plan/profile data.
 * Body: { clientIds: string[] }
 */
async function handleDeleteClients(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }

    const { clientIds } = await request.json();
    const normalizedClientIds = Array.isArray(clientIds)
      ? [...new Set(clientIds.map(id => String(id || '').trim()).filter(Boolean))]
      : [];

    if (normalizedClientIds.length === 0) {
      return jsonResponse({ error: 'Missing clientIds array' }, 400);
    }

    let clientsList = await env.page_content.get('clients_list');
    clientsList = clientsList ? JSON.parse(clientsList) : [];

    const userIdsToDelete = new Set();
    const authKeysToDelete = new Set();
    const firebaseUidsToDelete = new Set();
    const pushSubscriptionKeysToDelete = new Set();
    const notificationPreferenceKeysToDelete = new Set();
    const missingClientIds = [];
    const deletedClientIds = [];

    for (const clientId of normalizedClientIds) {
      const clientRaw = await env.page_content.get(`client:${clientId}`);
      if (!clientRaw) {
        missingClientIds.push(clientId);
        continue;
      }

      const clientData = JSON.parse(clientRaw);
      deletedClientIds.push(clientId);

      if (clientData.userId) {
        const userId = String(clientData.userId).trim();
        if (userId) {
          userIdsToDelete.add(userId);
          pushSubscriptionKeysToDelete.add(`push_subscription_${userId}`);
          notificationPreferenceKeysToDelete.add(`notification_preferences_${userId}`);
          if (userId.startsWith(FIREBASE_USER_ID_PREFIX)) {
            const firebaseUid = userId.slice(FIREBASE_USER_ID_PREFIX.length);
            authKeysToDelete.add(`auth:${firebaseUid}`);
            firebaseUidsToDelete.add(firebaseUid);
          }
        }
      }
    }

    let deletedFirebaseAuthCount = 0;
    let alreadyMissingFirebaseAuthCount = 0;
    if (firebaseUidsToDelete.size > 0) {
      const adminToken = await getFirebaseAdminToken(env);
      for (const firebaseUid of firebaseUidsToDelete) {
        const deletionResult = await deleteFirebaseAuthUser(firebaseUid, env, adminToken);
        if (deletionResult.deleted) {
          deletedFirebaseAuthCount += 1;
        } else if (deletionResult.alreadyMissing) {
          alreadyMissingFirebaseAuthCount += 1;
        }
      }
    }

    let pushSubscriptionsList = await kvGetJSON(env, 'push_subscriptions_list');
    if (!Array.isArray(pushSubscriptionsList)) {
      pushSubscriptionsList = [];
    }
    const updatedPushSubscriptionsList = pushSubscriptionsList.filter(userId => !userIdsToDelete.has(userId));

    await Promise.all([
      ...deletedClientIds.map(clientId => env.page_content.delete(`client:${clientId}`)),
      ...Array.from(userIdsToDelete).map(userId => env.page_content.delete(`user_profile:${userId}`)),
      ...Array.from(authKeysToDelete).map(authKey => env.page_content.delete(authKey)),
      ...Array.from(pushSubscriptionKeysToDelete).map(key => env.page_content.delete(key)),
      ...Array.from(notificationPreferenceKeysToDelete).map(key => env.page_content.delete(key))
    ]);

    if (deletedClientIds.length > 0) {
      const deletedIdsSet = new Set(deletedClientIds);
      clientsList = clientsList.filter(clientId => !deletedIdsSet.has(clientId));
      await env.page_content.put('clients_list', JSON.stringify(clientsList));
    }

    if (updatedPushSubscriptionsList.length !== pushSubscriptionsList.length) {
      await env.page_content.put('push_subscriptions_list', JSON.stringify(updatedPushSubscriptionsList));
    }

    return jsonResponse({
      success: true,
      deletedClientIds,
      deletedClientCount: deletedClientIds.length,
      deletedProfileCount: userIdsToDelete.size,
      deletedAuthCount: authKeysToDelete.size,
      deletedFirebaseAuthCount,
      alreadyMissingFirebaseAuthCount,
      deletedPushSubscriptionCount: pushSubscriptionKeysToDelete.size,
      deletedNotificationPreferenceCount: notificationPreferenceKeysToDelete.size,
      missingClientIds,
      remainingClients: clientsList.length
    });
  } catch (error) {
    console.error('Error deleting clients:', error);
    return jsonResponse({ error: `Failed to delete clients: ${error.message}` }, 500);
  }
}

// ═══ Admin Assistant inlined modules (single worker deploy) ═══
/**
 * Server-side gamification analytics compression for admin client card (#AX v1).
 * Mirrors game-scoring.js logic (plan.html / game-analytics.html).
 */

const HEALTH_WEIGHTS = {
  engagement: 0.30,
  sleep: 0.22,
  balance: 0.18,
  activity: 0.18,
  water: 0.10,
  extraCals: 0.05,
};

const JUNK_MAX_POINTS = 20;
const JUNK_PENALTY_PER_MEAL = 7;

function zp(n) { return n < 10 ? `0${n}` : `${n}`; }

function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${zp(d.getMonth() + 1)}-${zp(d.getDate())}`;
}

function emptyDayScore() {
  return { score: null, engPct: 0, junkCount: 0, calorieDelta: 0, calorieBalance: 'balanced' };
}

/**
 * @param {object|null} rec
 * @param {string} todayKey
 */
function calcDayScore(rec, todayKey) {
  if (!rec) return emptyDayScore();
  const meals = Object.keys(rec.meals || {});
  let mealPts = 0;
  const mealMax = meals.length * 10;

  meals.forEach((m) => {
    if (rec.meals[m] === true) mealPts += 10;
  });

  let junkCount = 0;
  let extraCalSum = 0;
  let freeMealCalSum = 0;
  (rec.extraMeals || []).forEach((em) => {
    const isConsumed = !em.isAddedToPlan || em.countCalories !== false;
    if (em.isJunk && isConsumed && !em.isFreeMealReplacement) junkCount++;
    if (em.isFreeMealReplacement) freeMealCalSum += (em.calories || 0);
    else if (!(em.isAddedToPlan && !em.countCalories)) extraCalSum += (em.calories || 0);
  });

  const mealCalMap = rec.mealCalories || {};
  let completedPlanCals = 0;
  meals.forEach((mt) => {
    if (rec.meals[mt] === true && mealCalMap[mt]) completedPlanCals += mealCalMap[mt];
  });
  const totalConsumed = completedPlanCals + extraCalSum + freeMealCalSum;
  const planned = rec.plannedCalories ? (rec.plannedCalories + freeMealCalSum) : null;
  let excessCalories = false;
  let calorieBalance = 'balanced';
  let calorieDelta = 0;

  if (totalConsumed > 0 && planned && planned > 0) {
    const excessPct = (totalConsumed - planned) / planned;
    calorieDelta = Math.round(totalConsumed - planned);
    if (excessPct > 0.10) { excessCalories = true; calorieBalance = 'surplus'; }
    else if (excessPct > 0) { calorieBalance = 'surplus'; }
    else if (excessPct < -0.10 && completedPlanCals > 0 && (rec.morningCheck || rec.eveningCheck)) {
      const recDate = rec.date || todayKey;
      const dayIsDone = recDate < todayKey || new Date().getHours() >= 20;
      if (dayIsDone) calorieBalance = 'deficit';
    }
  } else if (extraCalSum > 0 && (!planned || planned === 0)) {
    calorieDelta = extraCalSum;
    if (extraCalSum > 200) { excessCalories = true; calorieBalance = 'surplus'; }
    else if (extraCalSum > 50) { calorieBalance = 'surplus'; }
  }

  const sleepPts = rec.morningCheck ? (rec.morningCheck.sleptWell ? 10 : 0) : null;
  const waterPts = rec.eveningCheck?.waterIntake != null ? (rec.eveningCheck.waterIntake ? 10 : 0) : null;
  const activityPts = rec.eveningCheck?.activityLevel != null ? ([0, 0, 5, 10][rec.eveningCheck.activityLevel] || 0) : null;
  const balancePts = rec.eveningCheck?.emotionalBalance != null ? ([0, 0, 5, 10][rec.eveningCheck.emotionalBalance] || 0) : null;
  const wellnessEarned = (sleepPts || 0) + (waterPts || 0) + (activityPts || 0) + (balancePts || 0);
  const wellnessMax = 40;

  const allMealsOk = meals.length > 0 && meals.every((m) => rec.meals[m] === true);
  const has5StarBlocker = !allMealsOk || excessCalories ||
    (rec.morningCheck?.sleptWell === false) ||
    (rec.eveningCheck?.waterIntake === false) ||
    (rec.eveningCheck?.activityLevel === 1) ||
    (rec.eveningCheck?.emotionalBalance === 1) ||
    junkCount > 0;

  const done = meals.filter((m) => rec.meals[m] === true).length;
  const mealEngPct = meals.length > 0 ? (done / meals.length) * 50 : 0;
  const mornEngPct = rec.morningCheck ? 15 : 0;
  const eveEngPct = (rec.eveningCheck && (
    rec.eveningCheck.activityLevel != null ||
    rec.eveningCheck.emotionalBalance != null ||
    rec.eveningCheck.waterIntake != null
  )) ? 15 : 0;
  const hasAnyEngagement = mealEngPct > 0 || mornEngPct > 0 || eveEngPct > 0 || junkCount > 0;
  const junkPct = hasAnyEngagement ? Math.max(0, JUNK_MAX_POINTS - junkCount * JUNK_PENALTY_PER_MEAL) : 0;
  const engPct = Math.round(mealEngPct + mornEngPct + eveEngPct + junkPct);

  const totalMax = mealMax + wellnessMax;
  const totalEarned = mealPts + wellnessEarned;
  const hasAnyActivity = totalEarned > 0 || meals.length > 0;
  let score = null;

  if (totalMax > 0 && hasAnyActivity) {
    const pct = totalEarned / totalMax;
    if (pct >= 1.00 && !has5StarBlocker) score = 5;
    else if (pct >= 0.80) score = 4;
    else if (pct >= 0.55) score = 3;
    else if (pct >= 0.30) score = 2;
    else if (pct > 0) score = 1;
    if (score === 5 && has5StarBlocker) score = 4;
    if (score != null && score > 3 && (junkCount > 0 || excessCalories)) score = 3;
    if (score != null && score > 2 && junkCount > 0 && excessCalories) score = 2;
  }

  return { score, engPct, junkCount, calorieDelta, calorieBalance, excessCalories };
}

function computeHealthIndex(m) {
  let healthScore = 0;
  let totalWeight = HEALTH_WEIGHTS.engagement;
  healthScore += (m.engagementPct || 0) * HEALTH_WEIGHTS.engagement;

  if (m.sleepPct != null) { healthScore += m.sleepPct * HEALTH_WEIGHTS.sleep; totalWeight += HEALTH_WEIGHTS.sleep; }
  if (m.balancePct != null) { healthScore += m.balancePct * HEALTH_WEIGHTS.balance; totalWeight += HEALTH_WEIGHTS.balance; }
  if (m.actPct != null) { healthScore += m.actPct * HEALTH_WEIGHTS.activity; totalWeight += HEALTH_WEIGHTS.activity; }
  if (m.waterPct != null) { healthScore += m.waterPct * HEALTH_WEIGHTS.water; totalWeight += HEALTH_WEIGHTS.water; }

  const extraCalsWeight = Math.max(0, 100 - Math.round((m.totalExtraCals || 0) / 700 * 100));
  healthScore += extraCalsWeight * HEALTH_WEIGHTS.extraCals;
  totalWeight += HEALTH_WEIGHTS.extraCals;

  return Math.round(Math.max(0, Math.min(100, healthScore / totalWeight)));
}

function buildLast7Days(allData, todayKey) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dd = new Date();
    dd.setDate(dd.getDate() - i);
    const key = dateKey(dd);
    if (key <= todayKey) days.push({ key, rec: allData?.[key] || null });
  }
  return days;
}

function pctAvg(values) {
  const valid = values.filter((v) => v != null);
  return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
}

function calcStreak(days, todayKey) {
  let streak = 0;
  let streakStart = days.length - 1;
  if (streakStart >= 0 && days[streakStart].key === todayKey &&
      (!days[streakStart].rec || calcDayScore(days[streakStart].rec, todayKey).score == null)) {
    streakStart--;
  }
  for (let si = streakStart; si >= 0; si--) {
    const sc = days[si].rec ? calcDayScore(days[si].rec, todayKey).score : null;
    if (sc != null && sc >= 4) streak++;
    else break;
  }
  return streak;
}

function compactDayLine(d, todayKey) {
  if (!d.rec) return `${d.key.slice(5)}:—`;
  const s = calcDayScore(d.rec, todayKey);
  const bal = s.calorieBalance === 'surplus' ? '+' : s.calorieBalance === 'deficit' ? '-' : '=';
  return `${d.key.slice(5)}:${s.score ?? '—'}/${s.engPct}/${s.junkCount}/${bal}${Math.abs(s.calorieDelta)}`;
}

/**
 * Build compact analytics summary from raw gameData.
 * @param {Record<string, object>} gameData
 * @param {object} [gameWeeklyAI]
 */
function buildAnalyticsSummary(gameData = {}, gameWeeklyAI = {}) {
  const todayKey = dateKey();
  const days = buildLast7Days(gameData, todayKey);
  const weekScores = days.map((d) => (d.rec ? calcDayScore(d.rec, todayKey) : null));
  const validScores = weekScores.filter((s) => s?.score != null);
  const avgScore = validScores.length
    ? Math.round(validScores.reduce((a, s) => a + s.score, 0) / validScores.length * 10) / 10
    : null;

  const engForAvg = days.map((d) => (d.rec ? calcDayScore(d.rec, todayKey).engPct : 0));
  const engagementPct = Math.round(engForAvg.reduce((a, b) => a + b, 0) / days.length);

  const extraCalsByDay = days.map((d) => {
    if (!d.rec?.extraMeals) return 0;
    return d.rec.extraMeals.reduce((s, em) => {
      if (em.isFreeMealReplacement) return s;
      if (em.isAddedToPlan && !em.countCalories) return s;
      return s + (em.calories || 0);
    }, 0);
  });
  const totalExtraCals = extraCalsByDay.reduce((s, v) => s + v, 0);

  const calBalanceByDay = days.map((d) => (d.rec ? calcDayScore(d.rec, todayKey).calorieDelta : 0));
  const netCalBalance = calBalanceByDay.reduce((s, v) => s + v, 0);

  const sleepByDay = days.map((d) => (
    d.rec?.morningCheck?.sleptWell != null ? (d.rec.morningCheck.sleptWell ? 100 : 0) : null
  ));
  const balanceByDay = days.map((d) => (
    d.rec?.eveningCheck?.emotionalBalance != null
      ? Math.round((d.rec.eveningCheck.emotionalBalance - 1) / 2 * 100) : null
  ));
  const actByDay = days.map((d) => (
    d.rec?.eveningCheck?.activityLevel != null
      ? Math.round((d.rec.eveningCheck.activityLevel - 1) / 2 * 100) : null
  ));
  const waterByDay = days.map((d) => (
    d.rec?.eveningCheck?.waterIntake != null ? (d.rec.eveningCheck.waterIntake ? 100 : 0) : null
  ));

  const calAdherencePct = (() => {
    const vals = [];
    days.forEach((d) => {
      if (!d.rec) return;
      const mealCalMap = d.rec.mealCalories || {};
      const consumed = Object.keys(d.rec.meals || {}).reduce((sum, mt) =>
        sum + (d.rec.meals[mt] && mealCalMap[mt] ? mealCalMap[mt] : 0), 0);
      const extra = (d.rec.extraMeals || []).reduce((sum, em) => {
        if (em.isFreeMealReplacement || (em.isAddedToPlan && !em.countCalories)) return sum;
        return sum + (em.calories || 0);
      }, 0);
      const total = consumed + extra;
      const plan = d.rec.plannedCalories;
      if (total > 0 && plan) vals.push(Math.min(100, Math.round(total / plan * 100)));
    });
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  })();

  let junk7 = 0;
  days.forEach((d) => {
    (d.rec?.extraMeals || []).forEach((em) => {
      const isConsumed = !em.isAddedToPlan || em.countCalories !== false;
      if (em.isJunk && isConsumed) junk7++;
    });
  });

  const pastScores = weekScores.slice(0, -1);
  const firstHalf = pastScores.slice(0, Math.floor(pastScores.length / 2)).filter((s) => s?.score != null);
  const lastHalf = pastScores.slice(Math.ceil(pastScores.length / 2)).filter((s) => s?.score != null);
  let trend = 'flat';
  if (lastHalf.length && firstHalf.length) {
    const lh = lastHalf.reduce((a, s) => a + s.score, 0) / lastHalf.length;
    const fh = firstHalf.reduce((a, s) => a + s.score, 0) / firstHalf.length;
    if (lh > fh + 0.3) trend = 'up';
    else if (fh > lh + 0.3) trend = 'down';
  }

  const healthIndex = computeHealthIndex({
    engagementPct,
    sleepPct: pctAvg(sleepByDay),
    balancePct: pctAvg(balanceByDay),
    actPct: pctAvg(actByDay),
    waterPct: pctAvg(waterByDay),
    totalExtraCals,
  });

  const daysWithData = days.filter((d) => d.rec).length;
  if (daysWithData === 0) {
    return {
      status: 'empty',
      daysRecorded: 0,
      syncedAt: new Date().toISOString(),
    };
  }

  return {
    status: 'active',
    healthIndex,
    avgScore,
    streak: calcStreak(days, todayKey),
    adherence: engagementPct,
    calAdherence: calAdherencePct,
    junk7,
    netCalBalance,
    trend,
    daysRecorded: daysWithData,
    dimensions: {
      eng: engagementPct,
      slp: pctAvg(sleepByDay),
      bal: pctAvg(balanceByDay),
      act: pctAvg(actByDay),
      wtr: pctAvg(waterByDay),
    },
    last7: days.map((d) => compactDayLine(d, todayKey)).join('|'),
    weeklyAI: {
      lastRun: gameWeeklyAI.lastRun || null,
      nextDue: gameWeeklyAI.nextDue || null,
      lastSummary: gameWeeklyAI.lastSummary || gameWeeklyAI.summary || null,
    },
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Serialize analytics object to #AX v1 card line block.
 * @param {object|null} analytics
 */
function serializeAnalyticsBlock(analytics) {
  if (!analytics || analytics.status === 'empty') {
    return '#AX v1 status=empty|note=няма_записани_дни';
  }
  if (analytics.status !== 'active') {
    return '#AX v1 status=pending|note=аналитичен_модул_не_синхронизиран';
  }
  const dim = analytics.dimensions || {};
  const lines = [
    '#AX v1 status=active',
    `hi=${analytics.healthIndex}|avg=${analytics.avgScore ?? '—'}|str=${analytics.streak}|adh=${analytics.adherence}`,
    `cal=${analytics.calAdherence ?? '—'}|junk7=${analytics.junk7}|net=${analytics.netCalBalance}|tr=${analytics.trend}`,
    `dim|eng=${dim.eng ?? '—'}|slp=${dim.slp ?? '—'}|bal=${dim.bal ?? '—'}|act=${dim.act ?? '—'}|wtr=${dim.wtr ?? '—'}`,
    `d7|${analytics.last7}`,
    analytics.syncedAt ? `sync=${analytics.syncedAt.slice(0, 10)}` : '',
  ];
  const wai = analytics.weeklyAI;
  if (wai?.nextDue) lines.push(`revDue=${wai.nextDue.slice(0, 10)}`);
  if (wai?.lastSummary) lines.push(`rev=${String(wai.lastSummary).replace(/\|/g, '/').slice(0, 280)}`);
  return lines.filter(Boolean).join('\n');
}

/**
 * Minimal RFC 6902 JSON Patch (replace, add, remove) with path allowlist.
 */

const ALLOWED_PREFIXES = ['/answers', '/plan', '/adminNotes'];
const MAX_PATCHES = 25;

/** @typedef {{ op: 'replace'|'add'|'remove', path: string, value?: unknown }} JsonPatchOperation */

/**
 * @param {string} pointer
 */
function parsePointer(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new Error(`Невалиден path: ${pointer}`);
  }
  if (pointer === '/') return [''];
  return pointer.slice(1).split('/').map(seg => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * @param {string} path
 */
function assertAllowedPath(path) {
  if (!ALLOWED_PREFIXES.some(p => path === p || path.startsWith(`${p}/`))) {
    throw new Error(`Забранен path: ${path}`);
  }
}

/**
 * @param {JsonPatchOperation[]} patches
 * @returns {JsonPatchOperation[]}
 */
function validateJsonPatches(patches) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error('Липсва масив patches');
  }
  if (patches.length > MAX_PATCHES) {
    throw new Error(`Максимум ${MAX_PATCHES} patch операции`);
  }
  for (const p of patches) {
    if (!p || typeof p !== 'object') throw new Error('Невалидна patch операция');
    const op = /** @type {JsonPatchOperation} */ (p).op;
    if (!['replace', 'add', 'remove'].includes(op)) {
      throw new Error(`Неподдържана операция: ${op}`);
    }
    assertAllowedPath(/** @type {JsonPatchOperation} */ (p).path);
    if (op !== 'remove' && !Object.prototype.hasOwnProperty.call(p, 'value')) {
      throw new Error(`Липсва value за ${op} ${/** @type {JsonPatchOperation} */ (p).path}`);
    }
  }
  return patches;
}

/**
 * @param {unknown} doc
 * @param {string[]} path
 */
function getAtPath(doc, path) {
  let cur = doc;
  for (const key of path) {
    if (cur == null) throw new Error(`Path not found: /${path.join('/')}`);
    cur = cur[key];
  }
  return cur;
}

/**
 * @param {Record<string, unknown>} doc
 * @param {JsonPatchOperation[]} patches
 * @returns {{ document: Record<string, unknown>, touchedPlan: boolean, touchedAnswers: boolean }}
 */
function applyJsonPatches(doc, patches) {
  validateJsonPatches(patches);
  const document = JSON.parse(JSON.stringify(doc));
  let touchedPlan = false;
  let touchedAnswers = false;

  for (const patch of patches) {
    if (patch.path.startsWith('/plan')) touchedPlan = true;
    if (patch.path.startsWith('/answers')) touchedAnswers = true;

    const segments = parsePointer(patch.path);
    if (segments.length === 0) throw new Error('Празен path');

    if (patch.op === 'remove') {
      const parentPath = segments.slice(0, -1);
      const key = segments[segments.length - 1];
      const parent = parentPath.length ? getAtPath(document, parentPath) : document;
      if (Array.isArray(parent) && key === '-') throw new Error('remove не поддържа -');
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
      continue;
    }

    const parentPath = segments.slice(0, -1);
    const key = segments[segments.length - 1];
    const parent = parentPath.length ? getAtPath(document, parentPath) : document;

    if (patch.op === 'add') {
      if (Array.isArray(parent)) {
        if (key === '-') parent.push(patch.value);
        else parent.splice(Number(key), 0, patch.value);
      } else {
        parent[key] = patch.value;
      }
      continue;
    }

    // replace
    if (Array.isArray(parent) && key !== '-') {
      parent[Number(key)] = patch.value;
    } else {
      parent[key] = patch.value;
    }
  }

  return { document, touchedPlan, touchedAnswers };
}

/**
 * @param {object} clientData
 */
function buildPatchDocument(clientData) {
  return {
    answers: clientData.answers || {},
    plan: clientData.plan || null,
    adminNotes: clientData.adminNotes || '',
  };
}

/**
 * @param {object} clientData
 * @param {Record<string, unknown>} patched
 */
function mergePatchDocument(clientData, patched) {
  clientData.answers = patched.answers || {};
  clientData.plan = patched.plan ?? null;
  if (patched.adminNotes !== undefined) clientData.adminNotes = patched.adminNotes;
  return clientData;
}

/**
 * NutriPlan Client Card (CC v1) — compressed, structured dossier for admin AI assistant.
 * Extends NPCF (context-compression.js) with plan metadata, outputs, and analytics slot.
 */


const cardEsc = (value) => {
  if (value == null || value === '') return '';
  const s = Array.isArray(value) ? value.filter(Boolean).join('+') : String(value).trim();
  return s.replace(/\|/g, '/').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
};

/**
 * @param {object} analysis
 * @returns {string}
 */
function serializeAnalysisAdmin(analysis) {
  if (!analysis) return '';
  const probs = (analysis.keyProblems || []).slice(0, 8).map(p =>
    `${cardEsc(p.title || p.name)}:${p.severity || ''}`
  ).join('+');
  const needs = (analysis.nutritionalNeeds || analysis.nutritionalDeficiencies || []).slice(0, 6).join('+');
  const cm = analysis.correctedMetabolism || {};
  const mr = analysis.macroRatios || {};
  const mg = analysis.macroGrams || {};
  return [
    '#AN v1 admin',
    `bmi=${analysis.bmi ?? ''}|bmr=${cm.realBMR ?? analysis.bmr ?? ''}|tdee=${cm.realTDEE ?? analysis.tdee ?? ''}|cal=${analysis.Final_Calories || analysis.recommendedCalories || ''}`,
    analysis.psychoProfile?.temperament ? `temp=${cardEsc(analysis.psychoProfile.temperament)}@${analysis.psychoProfile.probability ?? 0}%` : '',
    analysis.psychologicalProfile ? `psy=${cardEsc(String(analysis.psychologicalProfile).slice(0, 500))}` : '',
    analysis.holisticSummary ? `hol=${cardEsc(String(analysis.holisticSummary).slice(0, 400))}` : '',
    probs ? `prob=${probs}` : '',
    needs ? `need=${cardEsc(needs)}` : '',
    mr.protein != null ? `pct|P${mr.protein}/C${mr.carbs}/F${mr.fats}` : '',
    mg.protein != null ? `g|P${mg.protein}/C${mg.carbs}/F${mg.fats}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * @param {object} summary
 * @returns {string}
 */
function serializePlanSummary(summary) {
  if (!summary) return '';
  const m = summary.macros || {};
  return [
    '#SM v1',
    `bmr=${summary.bmr ?? ''}|cal=${summary.dailyCalories ?? ''}`,
    m.protein != null ? `mac|P${m.protein}/C${m.carbs}/F${m.fats}` : '',
    summary.overview ? `ov=${cardEsc(String(summary.overview).slice(0, 300))}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * @param {unknown} items
 * @param {number} max
 * @returns {string}
 */
function serializeList(items, max = 12) {
  if (!items) return '';
  if (Array.isArray(items)) return items.slice(0, max).map(i => cardEsc(typeof i === 'string' ? i : i?.text || i?.name || JSON.stringify(i))).join('+');
  if (typeof items === 'object') return cardEsc(JSON.stringify(items).slice(0, 400));
  return cardEsc(String(items).slice(0, 400));
}

/**
 * @param {object} psychology
 * @returns {string}
 */
function serializePsychology(psychology) {
  if (!psychology) return '';
  const parts = [];
  if (psychology.profile) parts.push(`prof=${cardEsc(String(psychology.profile).slice(0, 300))}`);
  if (psychology.tips?.length) parts.push(`tips=${serializeList(psychology.tips, 6)}`);
  if (psychology.challenges?.length) parts.push(`ch=${serializeList(psychology.challenges, 5)}`);
  if (psychology.motivation) parts.push(`mot=${cardEsc(String(psychology.motivation).slice(0, 200))}`);
  return parts.length ? `#PS v1 ${parts.join('|')}` : '';
}

/**
 * @param {object|null} analytics
 * @returns {string}
 */
function serializeAnalytics(analytics) {
  return serializeAnalyticsBlock(analytics);
}

/**
 * Build compressed client card text from full client record.
 * @param {object} clientData
 * @param {{ analytics?: object|null }} [options]
 * @returns {{ card: string, tokenEstimate: number, sections: Record<string, boolean> }}
 */
function buildClientCard(clientData, options = {}) {
  const answers = clientData?.answers || {};
  const plan = clientData?.plan || null;
  const analytics = options.analytics ?? clientData?.analytics ?? null;

  const hasNotes = Boolean(answers.additionalNotes);
  const hasClinical = Boolean(answers.clinicalProtocol);
  const profile = serializeUserProfile(answers, 'full', { hasNotesSection: hasNotes, hasClinicalSection: hasClinical });

  const meta = [
    '#CC v1 — Клиентски картон',
    `META|id=${cardEsc(clientData?.id)}|st=${cardEsc(clientData?.planStatus || 'none')}|sub=${cardEsc((clientData?.submittedAt || clientData?.timestamp || '').slice(0, 10))}|act=${cardEsc((clientData?.planActivatedAt || '').slice(0, 10) || '—')}|uid=${cardEsc(clientData?.userId || '—')}|upd=${cardEsc((clientData?.planUpdatedAt || '').slice(0, 10) || '—')}`,
    clientData?.planGenerationError ? `ERR|${cardEsc(clientData.planGenerationError)}` : '',
    answers.email ? `EM|${cardEsc(answers.email)}` : '',
    answers.additionalNotes ? `NT|${cardEsc(String(answers.additionalNotes).slice(0, 500))}` : '',
    (clientData?.files?.length) ? `FL|count=${clientData.files.length}|names=${clientData.files.slice(0, 5).map(f => cardEsc(f.name)).join('+')}` : '',
  ].filter(Boolean);

  const planBlocks = [];
  if (plan) {
    const analysis = plan.analysis || plan.step0 || null;
    if (analysis) planBlocks.push(serializeAnalysisAdmin(analysis));
    if (plan.strategy) planBlocks.push(serializeStrategyForMealPlan(plan.strategy));
    if (plan.summary) planBlocks.push(serializePlanSummary(plan.summary));
    if (plan.weekPlan) planBlocks.push(serializeWeekPlanAdmin(plan.weekPlan));
    if (plan.recommendations) planBlocks.push(`#RC v1 ${serializeList(plan.recommendations, 15)}`);
    if (plan.forbidden) planBlocks.push(`#FB v1 ${serializeList(plan.forbidden, 15)}`);
    if (plan.psychology) planBlocks.push(serializePsychology(plan.psychology));
    if (plan.supplements) planBlocks.push(`#SP v1 ${serializeList(plan.supplements, 10)}`);
    if (plan.waterIntake) planBlocks.push(`#WT v1 ${cardEsc(typeof plan.waterIntake === 'string' ? plan.waterIntake : JSON.stringify(plan.waterIntake).slice(0, 200))}`);
    if (clientData?.adminNotes) planBlocks.push(`#AD v1 ${cardEsc(String(clientData.adminNotes).slice(0, 400))}`);
  } else {
    planBlocks.push('#PL v2 status=none');
  }

  planBlocks.push(serializeAnalytics(analytics));

  const card = [...meta, '', profile, '', ...planBlocks.filter(Boolean)].join('\n');
  const tokenEstimate = estimateTokenCount(card);

  return {
    card,
    tokenEstimate,
    sections: {
      meta: true,
      profile: Boolean(profile),
      analysis: Boolean(plan?.analysis || plan?.step0),
      strategy: Boolean(plan?.strategy),
      weekPlan: Boolean(plan?.weekPlan),
      recommendations: Boolean(plan?.recommendations),
      analytics: analytics?.status === 'active',
    },
  };
}


// ═══ End inlined modules ═══

// ─── Admin AI Assistant (Gemini Context Caching) ───────────────────────────

const ADMIN_ASSISTANT_CACHE_MIN_TOKENS = 1024;
const ADMIN_ASSISTANT_CACHE_TTL = '300s';
const ADMIN_ASSISTANT_SESSION_TTL = 3600;
const ADMIN_ASSISTANT_SESSION_PREFIX = 'admin_assistant_session:';

const ADMIN_ASSISTANT_SYSTEM_INSTRUCTION = `Ти си NutriPlan AI асистент за администратор-нутриционист.
Четеш кеширан клиентски картон (CC/NPCF). Промените се правят чрез RFC 6902 JSON Patch върху каноничния JSON.

Patch root: { answers, plan, adminNotes }
Разрешени path префикси: /answers, /plan, /adminNotes

Примери:
- /plan/summary/dailyCalories
- /plan/weekPlan/day1/meals/0/name
- /plan/weekPlan/day1/meals/0/calories
- /plan/weekPlan/day1/meals/0/weight  (стринг, напр. "250g")
- /plan/weekPlan/day1/meals/0/macros/protein
- /plan/weekPlan/day1/meals/0/macros/carbs
- /plan/weekPlan/day1/meals/0/macros/fats
- /plan/supplements/-  (add в края на масив)
- /answers/lossKg
- /adminNotes

Седмица: day1..day7 (не monday). Хранения: meals[] с type, name, calories, weight, macros (protein, carbs, fats).

#PL v2 admin — пълен седмичен план (всеки ред = едно хранене):
  колони: day|idx|type|name|kcal|g|P|C|F|patch
  idx = индекс в meals[] (0..n), type = H1-H5 или SF, g = грамаж, P/C/F = макроси в грамове
  patch = JSON Patch път до хранението; суфикси: /calories, /weight ("250g"), /name, /macros/protein и т.н.
  ред T = дневен тотал (сумарни kcal и макроси за деня)

Секция #AX (аналитика от gamification модула) — READ-ONLY, но ЗАДЪЛЖИТЕЛНО я вземай предвид:
- hi=health index (0–100), avg=средна дневна оценка (1–5), str=серия отлични дни, adh=ангажираност %
- cal=калориен adherence, junk7=вредни хранения за 7 дни, net=нетен калориен баланс, tr=тренд (up/down/flat)
- dim=eng/slp/bal/act/wtr — измерения (сън, баланс, активност, вода)
- d7=последни 7 дни: MM-DD:stars/eng%/junk/calΔ

При обсъждане на плана:
- Свързвай #AX с #PL (седмичен план), #SM (калории), #ST (стратегия) и профила (#NP).
- Ако adherence е ниска → предложи по-реалистичен/по-лесен план или по-малки стъпки.
- Ако junk7 е висок или tr=down → обсъди поведенчески корекции и адаптирай хранения/свободни дни.
- Ако cal deficit/surplus е систематичен → прегледай калориите и разпределението по дни.
- Ако str е висока → запази успешните елементи на плана при промени.

При редакция по молба на админа:
- Адаптирай плана (#plan patches) на база аналитиката + профила — не само изолирани промени.
- Обясни в reply защо промяната следва от данните в #AX.

Правила:
- Отговаряй на български.
- При обсъждане: hasMutations=false, patches=[].
- При редакция: hasMutations=true + patches[] (replace/add/remove). Минимален брой операции.
- НЕ измисляй медицински данни. Променяй само по изрична заявка.
- Секция #AX (аналитика) е read-only — не я patch-вай.
- Винаги валиден JSON по schema.`;

const ADMIN_ASSISTANT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Отговор за админа на български' },
    hasMutations: { type: 'boolean', description: 'Дали има промени за прилагане' },
    patches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', description: 'replace | add | remove' },
          path: { type: 'string', description: 'RFC 6901 pointer' },
          value: { description: 'Нова стойност (replace/add)' },
        },
        required: ['op', 'path'],
      },
      description: 'RFC 6902 JSON Patch операции',
    },
    mutationsSummary: { type: 'string', description: 'Кратко описание на промените' },
  },
  required: ['reply', 'hasMutations'],
};

/**
 * @param {string} card
 * @param {string} updatedAt
 * @param {string} [analyticsSyncedAt]
 */
function buildClientCardFingerprint(card, updatedAt, analyticsSyncedAt) {
  return `${card.length}:${updatedAt || ''}:${analyticsSyncedAt || ''}`;
}

/**
 * @param {object} env
 * @param {string} sessionId
 */
async function getAssistantSession(env, sessionId) {
  const raw = await env.page_content.get(`${ADMIN_ASSISTANT_SESSION_PREFIX}${sessionId}`);
  return raw ? JSON.parse(raw) : null;
}

/**
 * @param {object} env
 * @param {object} session
 */
async function saveAssistantSession(env, session) {
  await env.page_content.put(
    `${ADMIN_ASSISTANT_SESSION_PREFIX}${session.sessionId}`,
    JSON.stringify(session),
    { expirationTtl: ADMIN_ASSISTANT_SESSION_TTL }
  );
}

/**
 * @param {object} env
 * @param {string} modelName
 * @param {string} cardText
 * @param {string} systemInstruction
 */
async function createGeminiCachedContent(env, modelName, cardText, systemInstruction) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${modelName}`,
        ttl: ADMIN_ASSISTANT_CACHE_TTL,
        contents: [{ role: 'user', parts: [{ text: cardText }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
      }),
    }
  );
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini cache create failed: ${response.status} ${errText.slice(0, 200)}`);
  }
  const data = await response.json();
  return data.name || null;
}

/**
 * @param {object} env
 * @param {string|null} cacheName
 */
async function deleteGeminiCachedContent(env, cacheName) {
  if (!cacheName) return;
  try {
    const id = cacheName.replace('cachedContents/', '');
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/cachedContents/${id}?key=${env.GEMINI_API_KEY}`,
      { method: 'DELETE' }
    );
  } catch (e) {
    console.warn('[AdminAssistant] Cache delete failed:', e.message);
  }
}

/**
 * Lazy cache rebuild — само при cacheStale или промяна на fingerprint.
 */
async function ensureAssistantCacheFresh(env, session, card, planUpdatedAt, analyticsSyncedAt) {
  const fingerprint = buildClientCardFingerprint(card, planUpdatedAt, analyticsSyncedAt);
  const needsRebuild = session.cacheStale || (session.cardFingerprint && session.cardFingerprint !== fingerprint);

  if (!needsRebuild) return { session, rebuilt: false };

  if (session.cacheId) {
    await deleteGeminiCachedContent(env, session.cacheId);
    session.cacheId = null;
    session.cacheEnabled = false;
  }

  if (estimateTokenCount(card) >= ADMIN_ASSISTANT_CACHE_MIN_TOKENS) {
    try {
      session.cacheId = await createGeminiCachedContent(env, session.modelName, card, ADMIN_ASSISTANT_SYSTEM_INSTRUCTION);
      session.cacheEnabled = Boolean(session.cacheId);
    } catch (e) {
      console.warn('[AdminAssistant] Cache rebuild failed:', e.message);
    }
  }

  session.cacheStale = false;
  session.cardFingerprint = fingerprint;
  return { session, rebuilt: true };
}

/**
 * Прилага JSON Patch върху клиент и записва в KV.
 */
async function applyAssistantPatches(env, session, clientData, patches, ctx) {
  const patchDoc = buildPatchDocument(clientData);
  const { document, touchedPlan } = applyJsonPatches(patchDoc, patches);
  mergePatchDocument(clientData, document);

  const wasPreviouslyActivated = Boolean(clientData.planActivatedAt);
  if (touchedPlan) {
    clientData.planUpdatedAt = new Date().toISOString();
    if (wasPreviouslyActivated) {
      clientData.planStatus = 'activated';
      clientData.planActivatedAt = new Date().toISOString();
    } else {
      clientData.planStatus = 'pending';
    }
  }

  await env.page_content.put(`client:${session.clientId}`, JSON.stringify(clientData));

  if (wasPreviouslyActivated && clientData.userId && touchedPlan) {
    try {
      await upsertUserProfilePlan(env, clientData.userId, {
        plan: clientData.plan,
        userData: clientData.answers || {},
        planSource: '',
        clientId: session.clientId,
        planUpdatedAt: clientData.planUpdatedAt,
      });
    } catch (e) {
      console.warn('[AdminAssistant] Profile sync failed:', e.message);
    }
  }

  return clientData;
}

/**
 * @param {object} env
 * @param {object} opts
 */
async function callGeminiAssistant(env, opts) {
  const {
    modelName = 'gemini-2.5-flash',
    cachedContent = null,
    systemInstruction = null,
    cardText = null,
    messages = [],
    userMessage,
  } = opts;

  const contents = [];
  if (!cachedContent && cardText) {
    contents.push({ role: 'user', parts: [{ text: `Клиентски картон:\n${cardText}` }] });
    contents.push({ role: 'model', parts: [{ text: 'Разбрах. Готов съм да обсъждам и редактирам клиентския картон.' }] });
  }
  for (const msg of messages.slice(-12)) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  const requestBody = {
    contents,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: ADMIN_ASSISTANT_RESPONSE_SCHEMA,
      temperature: 0.4,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  if (cachedContent) {
    requestBody.cachedContent = cachedContent;
  } else if (systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }
  );
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini assistant error: ${response.status} ${errText.slice(0, 200)}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini върна празен отговор');
  return JSON.parse(text);
}

/**
 * Load analytics summary for client card (from client record or linked profile).
 */
async function loadClientAnalytics(env, clientData) {
  if (clientData?.analytics?.status === 'active' || clientData?.analytics?.status === 'empty') {
    return clientData.analytics;
  }
  if (!clientData?.userId || !env.page_content) return null;
  try {
    const profile = await kvGetJSON(env, `user_profile:${clientData.userId}`);
    if (profile?.analytics?.status === 'active' || profile?.analytics?.status === 'empty') {
      return profile.analytics;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Persist analytics summary to user profile and linked client record.
 */
async function persistAnalyticsSummary(env, userId, summary, clientIdHint = '') {
  const ttl = userId.startsWith('fb_') ? 365 * 24 * 60 * 60 : 90 * 24 * 60 * 60;
  const existing = (await kvGetJSON(env, `user_profile:${userId}`)) || {};
  const profile = {
    ...existing,
    userId,
    analytics: summary,
    analyticsSyncedAt: summary.syncedAt,
    savedAt: existing.savedAt || summary.syncedAt,
  };
  await kvPutJSON(env, `user_profile:${userId}`, profile, ttl);

  let clientId = clientIdHint || existing.clientId || '';
  if (!clientId) {
    const email = normalizeEmail(existing.userData?.email);
    if (email) clientId = (await findClientByEmail(env, email))?.clientId || '';
  }
  if (clientId) {
    try {
      const clientData = await kvGetJSON(env, `client:${clientId}`);
      if (clientData) {
        clientData.analytics = summary;
        clientData.analyticsSyncedAt = summary.syncedAt;
        if (!clientData.userId) clientData.userId = userId;
        await kvPutJSON(env, `client:${clientId}`, clientData, null);
      }
    } catch (e) {
      console.warn(`[Analytics] Failed to sync to client ${clientId}:`, e.message);
    }
  }
  return { profile, clientId };
}

/**
 * POST /api/user/sync-analytics { userId, gameData, gameWeeklyAI?, clientId?, idToken? }
 */
async function handleSyncAnalytics(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }

    const { userId, gameData, gameWeeklyAI, clientId, idToken } = await request.json();
    if (!userId) return jsonResponse({ error: 'Missing userId' }, 400);

    if (userId.startsWith('fb_') && idToken && env.FIREBASE_PROJECT_ID) {
      try {
        const firebaseUser = await verifyFirebaseIdToken(idToken, env);
        if (`fb_${firebaseUser.uid}` !== userId) {
          return jsonResponse({ error: 'Token does not match userId' }, 403);
        }
      } catch {
        return jsonResponse({ error: 'Invalid Firebase ID token' }, 401);
      }
    }

    const summary = buildAnalyticsSummary(gameData || {}, gameWeeklyAI || {});
    await persistAnalyticsSummary(env, userId, summary, clientId || '');

    return jsonResponse({
      success: true,
      analytics: summary,
      status: summary.status,
    });
  } catch (error) {
    console.error('[Analytics] sync error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * GET /api/admin/client-card?clientId=...
 */
async function handleAdminClientCard(request, env) {
  try {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId');
    if (!clientId) return jsonResponse({ error: 'Missing clientId' }, 400);
    if (!env.page_content) return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);

    const raw = await env.page_content.get(`client:${clientId}`);
    if (!raw) return jsonResponse({ error: 'Client not found' }, 404);

    const clientData = JSON.parse(raw);
    const analytics = await loadClientAnalytics(env, clientData);
    const { card, tokenEstimate, sections } = buildClientCard(clientData, { analytics });

    return jsonResponse({
      success: true,
      clientId,
      card,
      tokenEstimate,
      sections,
      cacheRecommended: tokenEstimate >= ADMIN_ASSISTANT_CACHE_MIN_TOKENS,
    });
  } catch (error) {
    console.error('[AdminAssistant] client-card error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * POST /api/admin/client-assistant/session { clientId }
 */
async function handleAdminAssistantSession(request, env) {
  try {
    const { clientId } = await request.json();
    if (!clientId) return jsonResponse({ error: 'Missing clientId' }, 400);
    if (!env.GEMINI_API_KEY) return jsonResponse({ error: 'Gemini API key not configured' }, 500);
    if (!env.page_content) return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);

    const raw = await env.page_content.get(`client:${clientId}`);
    if (!raw) return jsonResponse({ error: 'Client not found' }, 404);

    const clientData = JSON.parse(raw);
    const analytics = await loadClientAnalytics(env, clientData);
    const { card, tokenEstimate } = buildClientCard(clientData, { analytics });
    const config = await getAdminConfig(env);
    const modelName = config.modelName || 'gemini-2.5-flash';

    const sessionId = `asst_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    let cacheId = null;
    let cacheEnabled = false;

    if (tokenEstimate >= ADMIN_ASSISTANT_CACHE_MIN_TOKENS) {
      try {
        cacheId = await createGeminiCachedContent(env, modelName, card, ADMIN_ASSISTANT_SYSTEM_INSTRUCTION);
        cacheEnabled = Boolean(cacheId);
      } catch (e) {
        console.warn('[AdminAssistant] Cache creation failed, falling back to inline context:', e.message);
      }
    }

    const session = {
      sessionId,
      clientId,
      cacheId,
      cacheEnabled,
      cacheStale: false,
      modelName,
      cardFingerprint: buildClientCardFingerprint(card, clientData.planUpdatedAt, clientData.analyticsSyncedAt),
      messages: [],
      createdAt: new Date().toISOString(),
    };
    await saveAssistantSession(env, session);

    return jsonResponse({
      success: true,
      sessionId,
      cacheEnabled,
      tokenEstimate,
      cacheMinTokens: ADMIN_ASSISTANT_CACHE_MIN_TOKENS,
      card,
      cardPreview: card.slice(0, 1200) + (card.length > 1200 ? '\n…' : ''),
      cardLength: card.length,
      analytics: analytics?.status === 'active' ? {
        healthIndex: analytics.healthIndex,
        avgScore: analytics.avgScore,
        streak: analytics.streak,
        syncedAt: analytics.syncedAt,
      } : { status: analytics?.status || 'pending' },
    });
  } catch (error) {
    console.error('[AdminAssistant] session error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * POST /api/admin/client-assistant/chat { sessionId, message }
 */
async function handleAdminAssistantChat(request, env, ctx) {
  try {
    const { sessionId, message } = await request.json();
    if (!sessionId || !message?.trim()) {
      return jsonResponse({ error: 'Missing sessionId or message' }, 400);
    }
    if (!env.GEMINI_API_KEY) return jsonResponse({ error: 'Gemini API key not configured' }, 500);

    const session = await getAssistantSession(env, sessionId);
    if (!session) return jsonResponse({ error: 'Session expired or not found' }, 404);

    const raw = await env.page_content.get(`client:${session.clientId}`);
    if (!raw) return jsonResponse({ error: 'Client not found' }, 404);
    let clientData = JSON.parse(raw);
    const analytics = await loadClientAnalytics(env, clientData);
    const { card } = buildClientCard(clientData, { analytics });

    const { rebuilt: cacheRefreshed } = await ensureAssistantCacheFresh(
      env, session, card, clientData.planUpdatedAt, clientData.analyticsSyncedAt
    );

    const aiResult = await callGeminiAssistant(env, {
      modelName: session.modelName,
      cachedContent: session.cacheEnabled ? session.cacheId : null,
      systemInstruction: session.cacheEnabled ? null : ADMIN_ASSISTANT_SYSTEM_INSTRUCTION,
      cardText: session.cacheEnabled ? null : card,
      messages: session.messages,
      userMessage: message.trim(),
    });

    let applied = false;
    let applyError = null;
    const patches = Array.isArray(aiResult.patches) ? aiResult.patches : [];

    if (aiResult.hasMutations && patches.length > 0) {
      try {
        clientData = await applyAssistantPatches(env, session, clientData, patches, ctx);
        session.cacheStale = true;
        applied = true;
      } catch (e) {
        applyError = e.message;
        console.warn('[AdminAssistant] Auto-apply failed:', e.message);
      }
    }

    session.messages.push({ role: 'user', content: message.trim() });
    session.messages.push({ role: 'assistant', content: aiResult.reply });
    if (session.messages.length > 24) session.messages = session.messages.slice(-24);
    await saveAssistantSession(env, session);

    const cardAfter = applied
      ? buildClientCard(clientData, { analytics: await loadClientAnalytics(env, clientData) }).card
      : null;

    return jsonResponse({
      success: true,
      reply: aiResult.reply,
      hasMutations: Boolean(aiResult.hasMutations),
      patches: applied ? patches : (aiResult.hasMutations ? patches : null),
      mutationsSummary: aiResult.mutationsSummary || '',
      applied,
      applyError,
      cacheEnabled: session.cacheEnabled,
      cacheStale: session.cacheStale,
      cacheRefreshed,
      client: applied ? clientData : null,
      cardPreview: cardAfter ? cardAfter.slice(0, 800) : null,
    });
  } catch (error) {
    console.error('[AdminAssistant] chat error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * POST /api/admin/client-assistant/apply { sessionId, patches? }
 */
async function handleAdminAssistantApply(request, env, ctx) {
  try {
    const { sessionId, patches: explicitPatches } = await request.json();
    if (!sessionId) return jsonResponse({ error: 'Missing sessionId' }, 400);
    if (!env.page_content) return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);

    const session = await getAssistantSession(env, sessionId);
    if (!session) return jsonResponse({ error: 'Session expired or not found' }, 404);

    const patches = explicitPatches;
    if (!Array.isArray(patches) || patches.length === 0) {
      return jsonResponse({ error: 'Missing patches array' }, 400);
    }

    const raw = await env.page_content.get(`client:${session.clientId}`);
    if (!raw) return jsonResponse({ error: 'Client not found' }, 404);
    const clientData = await applyAssistantPatches(env, session, JSON.parse(raw), patches, ctx);

    session.cacheStale = true;
    await saveAssistantSession(env, session);

    const analytics = await loadClientAnalytics(env, clientData);
    const { card, tokenEstimate } = buildClientCard(clientData, { analytics });

    return jsonResponse({
      success: true,
      message: 'Промените са приложени',
      client: clientData,
      cardPreview: card.slice(0, 800),
      tokenEstimate,
      cacheStale: true,
    });
  } catch (error) {
    console.error('[AdminAssistant] apply error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * Get full data for a specific client (for admin panel)
 * Returns: Complete client data object
 */
async function handleGetClientData(request, env) {
  try {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId');
    
    if (!clientId) {
      return jsonResponse({ error: 'Missing clientId parameter' }, 400);
    }
    
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    const clientDataStr = await env.page_content.get(`client:${clientId}`);
    
    if (!clientDataStr) {
      return jsonResponse({ error: 'Client not found' }, 404);
    }
    
    const clientData = JSON.parse(clientDataStr);
    
    return jsonResponse({ 
      success: true, 
      client: clientData
    });
  } catch (error) {
    console.error('Error getting client data:', error);
    return jsonResponse({ error: `Failed to get client data: ${error.message}` }, 500);
  }
}

// ─── Admin: Update client plan ───
async function handleUpdateClientPlan(request, env, ctx) {
  try {
    const { clientId, plan, userId, forcePending } = await request.json();
    if (!clientId || !plan) {
      return jsonResponse({ error: 'Missing clientId or plan' }, 400);
    }
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const raw = await env.page_content.get(`client:${clientId}`);
    if (!raw) {
      return jsonResponse({ error: 'Client not found' }, 404);
    }
    const clientData = JSON.parse(raw);
    const wasPreviouslyActivated = Boolean(clientData.planActivatedAt);
    clientData.plan = plan;
    if (userId) clientData.userId = userId;
    clientData.planUpdatedAt = new Date().toISOString();
    
    // Plan replacement from profile/questionnaire requires admin approval even when
    // the client had a previously activated plan (forcePending).
    if (forcePending) {
      clientData.planStatus = 'pending';
      clientData.planActivatedAt = null;
    } else if (wasPreviouslyActivated) {
      clientData.planStatus = 'activated';
      clientData.planActivatedAt = new Date().toISOString();
    } else {
      clientData.planStatus = 'pending';
      clientData.planActivatedAt = null;
    }
    await env.page_content.put(`client:${clientId}`, JSON.stringify(clientData));

    // Notify admin only if this is a first-time plan requiring review
    if (clientData.planStatus === 'pending') {
      sendPushNotificationToUser('admin', {
        title: 'Нов план чака преглед',
        body: `Клиент ${clientId} попълни въпросник 2 — планът очаква активиране.`,
        url: '/admin.html',
        icon: '/icon-192x192.png',
        notificationType: 'admin_plan_pending'
      }, env).catch(e => console.warn('Admin push notification failed:', e));

      notifyMake(ctx,
        `📋 Нов план чака преглед\n\n` +
        `👤 Клиент: ${clientData.answers?.name || clientId}\n` +
        `🆔 ID: ${clientId}\n` +
        `📧 Имейл: ${clientData.answers?.email || '—'}\n` +
        `🎯 Цел: ${clientData.answers?.goal || '—'}\n` +
        `📅 Дата: ${formatDateBG(clientData.planUpdatedAt)}`
      );
    } else if (clientData.planStatus === 'activated' && clientData.userId) {
      // For auto-activated updates, sync to user profile so the next app open picks up edits.
      try {
        await upsertUserProfilePlan(env, clientData.userId, {
          plan: clientData.plan,
          userData: clientData.answers || {},
          planSource: '',
          clientId,
          planUpdatedAt: clientData.planUpdatedAt
        });
        sendPushNotificationToUser(clientData.userId, {
          title: 'Планът ви е актуализиран',
          body: 'Специалистът направи промени в хранителния ви план.',
          url: '/index.html?app=1&tab=plan',
          icon: '/icon-192x192.png',
          notificationType: 'plan_updated',
          planUpdatedAt: clientData.planUpdatedAt
        }, env).catch(e => console.warn('Plan update push failed:', e.message));
      } catch (e) {
        console.warn(`Failed to sync auto-activated plan to profile ${clientData.userId}:`, e.message);
      }
      console.log(`[Client] Plan auto-activated for existing client ${clientId}`);
    }

    return jsonResponse({ success: true, message: 'Plan updated' });
  } catch (error) {
    console.error('Error updating client plan:', error);
    return jsonResponse({ error: `Failed to update plan: ${error.message}` }, 500);
  }
}

// ─── Admin: Activate client plan ───
async function handleActivateClientPlan(request, env, ctx) {
  try {
    const { clientId } = await request.json();
    if (!clientId) {
      return jsonResponse({ error: 'Missing clientId' }, 400);
    }
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const raw = await env.page_content.get(`client:${clientId}`);
    if (!raw) {
      return jsonResponse({ error: 'Client not found' }, 404);
    }
    const clientData = JSON.parse(raw);
    if (!clientData.plan) {
      return jsonResponse({ error: 'No plan to activate' }, 400);
    }
    clientData.planStatus = 'activated';
    clientData.planActivatedAt = new Date().toISOString();
    await env.page_content.put(`client:${clientId}`, JSON.stringify(clientData));

    // If this questionnaire submission is linked to a user profile, immediately
    // clear its pending marker so the next APK/PWA login opens plan.html.
    if (clientData.userId) {
      try {
        await upsertUserProfilePlan(env, clientData.userId, {
          plan: clientData.plan,
          userData: clientData.answers || {},
          planSource: '',
          clientId,
          planUpdatedAt: clientData.planUpdatedAt || clientData.planActivatedAt
        });
        sendPushNotificationToUser(clientData.userId, {
          title: 'Вашият план е готов!',
          body: 'Специалистът одобри персонализирания ви хранителен план.',
          url: '/index.html?app=1&tab=plan',
          icon: '/icon-192x192.png',
          notificationType: 'plan_updated',
          planUpdatedAt: clientData.planUpdatedAt || clientData.planActivatedAt
        }, env).catch(e => console.warn('Plan activation push failed:', e.message));
      } catch (e) {
        console.warn(`Failed to update activated profile ${clientData.userId}:`, e.message);
      }
    }

    // Send email notification to client — try synchronously so we can report status
    const clientEmail = clientData.answers?.email;
    const clientName = clientData.answers?.name || 'Клиент';
    let emailSent = false;
    let emailError = null;
    if (clientEmail) {
      try {
        const tpl = await getEmailTemplate(env);
        const subject = tpl.subject || DEFAULT_EMAIL_TEMPLATE.subject;
        await sendEmailViaSMTP(env, clientEmail, subject, buildPlanReadyEmailHtml(clientName, tpl));
        emailSent = true;
        console.log(`[Email] Activation email sent to ${clientEmail}`);
      } catch (e) {
        emailError = e.message;
        console.warn('[Email] Plan activation email failed:', e.message);
      }
    } else {
      emailError = 'Няма имейл адрес за клиента';
    }

    return jsonResponse({
      success: true,
      message: 'Plan activated',
      activatedAt: clientData.planActivatedAt,
      emailSent,
      emailError: emailSent ? null : (emailError || 'Неизвестна грешка')
    });
  } catch (error) {
    console.error('Error activating client plan:', error);
    return jsonResponse({ error: `Failed to activate plan: ${error.message}` }, 500);
  }
}

// ─── Public: Check client plan status ───
async function handleGetClientPlanStatus(request, env) {
  try {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId');
    if (!clientId) {
      return jsonResponse({ error: 'Missing clientId' }, 400);
    }
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const raw = await env.page_content.get(`client:${clientId}`);
    if (!raw) {
      return jsonResponse({ error: 'Client not found' }, 404);
    }
    const clientData = JSON.parse(raw);
    const response = {
      success: true,
      planStatus: clientData.planStatus || 'none',
      activatedAt: clientData.planActivatedAt || null,
      hasPlan: Boolean(clientData.plan),
      planUpdatedAt: clientData.planUpdatedAt || null
    };
    // If activated, include the plan so client can load it
    if (clientData.planStatus === 'activated' && clientData.plan) {
      response.plan = clientData.plan;
    }
    return jsonResponse(response);
  } catch (error) {
    console.error('Error checking plan status:', error);
    return jsonResponse({ error: `Failed to check plan status: ${error.message}` }, 500);
  }
}


/**
 * Multi-step plan generation for better individualization
 * 
 * This approach uses MULTIPLE AI requests for maximum precision and personalization:
 * Step 1: Analyze user profile and health status (holistic health analysis)
 * Step 2: Determine dietary strategy and restrictions (personalized strategy)
 * Step 3: Generate detailed meal plan (specific meals based on analysis + strategy)
 * 
 * Benefits of multi-step approach:
 * ✅ Better individualization - Each step builds on previous insights
 * ✅ More precise analysis - Dedicated AI focus per step
 * ✅ Higher quality output - Strategy informs meal generation
 * ✅ Deeper understanding - Correlations between health parameters
 * ✅ Can be extended - Additional steps can be added for more data/precision
 * 
 * Each step receives progressively more refined context:
 * - Step 1: Raw user data → Health analysis
 * - Step 2: User data + Analysis → Dietary strategy
 * - Step 3: User data + Analysis + Strategy → Complete meal plan
 */

// Token limits optimized through prompt simplification (not artificial limits)
const MEAL_PLAN_TOKEN_LIMIT = 8000; // Sufficient for detailed meal generation
const SUMMARY_TOKEN_LIMIT = 3500; // Summary generation: must fit up to 10 recommendations, 10 forbidden foods, 3 psychology tips, 3 supplements + summary object

// Validation constants
const MIN_MEALS_PER_DAY = 1; // Minimum number of meals per day (1 for intermittent fasting strategies)
const MAX_MEALS_PER_DAY = 5; // Maximum number of meals per day (when there's clear reasoning and strategy)
// Deprecated fixed floor — use getMinRecommendedCalories(gender) for per-user minimums.
const MIN_DAILY_CALORIES = MIN_RECOMMENDED_CALORIES_FEMALE;
// Note: DAILY_CALORIE_TOLERANCE and MAX_LATE_SNACK_CALORIES moved earlier in file (line ~580) to be available in template strings
const MAX_CORRECTION_ATTEMPTS = 1; // Maximum number of AI correction attempts before failing.
// Reduced from 4 to 1: each correction attempt generates up to 7 AI calls (fetch subrequests).
// With 4 corrections the baseline alone was ~94 subrequests — well above Cloudflare's 50-subrequest
// limit per Worker invocation. With 1 correction the baseline is 46 (safe), and even with a
// handful of transient Gemini retries we stay comfortably under the limit.
const CORRECTION_TOKEN_LIMIT = 8000; // Token limit for AI correction requests - must be high for detailed corrections
const MEAL_ORDER_MAP = { 'Напитка': 0, 'Хранене 1': 0, 'Хранене 2': 1, 'Свободно хранене': 1, 'Хранене 3': 2, 'Хранене 4': 3, 'Хранене 5': 4 }; // Chronological meal order
const ALLOWED_MEAL_TYPES = ['Напитка', 'Хранене 1', 'Хранене 2', 'Свободно хранене', 'Хранене 3', 'Хранене 4', 'Хранене 5']; // Valid meal types
// Fixed dessert object injected by the backend for users who crave sweets.
// The AI includes the dessert's calories and macros directly in meal.calories/meal.macros,
// and marks the meal with "dessert": true so the client can render the dessert detail card.
// injectFixedDesserts() replaces the boolean marker with the full object and also adds the
// dessert weight to meal.weight (the AI prompt does not instruct the AI to include it).
const FIXED_DESSERT = {
  name: 'Пълномаслен шоколад с лешници',
  weight: '30г',
  description: 'Насладете се на 2 реда млечен или черен шоколад с цели лешници.',
  calories: 168,
  macros: { protein: 2, carbs: 14, fats: 12 }
};

// Numeric grams value extracted from FIXED_DESSERT.weight (e.g. '30г' → 30).
const FIXED_DESSERT_WEIGHT_GRAMS = (() => {
  const m = FIXED_DESSERT.weight.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
})();

// Injected into KV meal-plan/correction prompts via {MEAL_NAME_FORMAT_INSTRUCTIONS} — stays in worker.
const MEAL_NAME_FORMAT_INSTRUCTIONS = `=== ФОРМАТ НА MEAL NAME И DESCRIPTION ===
КРИТИЧНО ВАЖНО: Спазвай СТРОГО следния формат за структуриране на name и description:

ФОРМАТ НА "name" (структуриран със СИМВОЛИ):
- Използвай символи (•, -, *) за структура, НЕ пиши изречения
- Разделяй компонентите на отделни редове със символи
- Формат: компонент след компонент (без смесване)
- НЕ използвай етикети като "Салата:", "Основно:" - пиши директно названията на ястията

Структура (по ред, само ако е налично):
• [Вид салата в естествена форма] (ако има - напр. "Шопска салата", "салата Цезар", "салата от пресни зеленчуци")
• [Основно ястие] (ако има гарнитура: "с гарнитура / гарнитура от [име на гарнитура]")
• [Хляб: количество и вид] (ако има, напр. "1 филия пълнозърнест")

Примери за ПРАВИЛЕН формат на name:
✓ "• Шопска салата\\n• Пилешки гърди на скара с картофено пюре"
✓ "• Бяла риба печена с киноа"
✓ "• Зелена салата\\n• Леща яхния\\n• Хляб: 1 филия пълнозърнест"
✓ "• Салата от пресни зеленчуци\\n• Пилешко филе с киноа"
✓ "• Овесена каша с боровинки" (за закуска без салата/хляб)

ЗАБРАНЕНИ формати за name (НЕ пиши така):
✗ "• Салата: Шопска" (твърдо кодирани етикети)
✗ "• Основно: Пилешки гърди" (твърдо кодирани етикети)
✗ "Пилешки гърди на скара с картофено пюре и салата Шопска" (смесено описание)
✗ "Печена бяла риба, приготвена с киноа и подправки" (изречение)

ФОРМАТ НА "description":
- Структурирай description с булет пойнти (•) за разделяне на компонентите
- Всеки компонент на хранене (салата, основно ястие, гарнитура, хляб) започва на нов ред с •
- В description пиши ВСИЧКИ уточнения за:
  * Начин на приготвяне (печено, задушено, на скара, пресно и т.н.)
  * Препоръки за приготвяне
  * Конкретни подправки (сол, черен пипер, риган, магданоз и т.н.)
  * Допълнителни продукти (зехтин, лимон, чесън и т.н.)
  * Количества и пропорции

Пример за ПРАВИЛНА комбинация name + description:
name: "• Зелена салата\\n• Пилешки гърди с киноа\\n• Хляб: 1 филия пълнозърнест"
description: "• Зелена салата от листа, краставици и чери домати с лимонов дресинг.\\n• Пилешките гърди се приготвят на скара или печени в тава с малко зехтин, подправени със сол, черен пипер и риган.\\n• Киноата се готви според инструкциите.\\n• 1 филия пълнозърнест хляб."`;

function buildSweetsCravingRule(foodCravings, strategy) {
  if (!userHasSweetsCraving(foodCravings) || strategy?.includeDessert === false) return '';
  const d = FIXED_DESSERT.macros;
  return `\nВАЖНО - НУЖДА ОТ СЛАДКО: Клиентът изпитва нужда от сладки изделия. ЗАДЪЛЖИТЕЛНО добавяй към всеки "Хранене 2" (САМО Хранене 2, НЕ друго хранене) поле "dessert": true — десертът е финален компонент на Хранене 2, не отделно хранене. НЕ включвай наименованието на десерта в полето "name" на Хранене 2. meal.calories и meal.macros на Хранене 2 ТРЯБВА да включват стойностите на ЦЯЛОТО хранене заедно с десерта (${FIXED_DESSERT.calories} ккал, ${d.protein}г белтъчини, ${d.carbs}г въглехидрати, ${d.fats}г мазнини) — взимай тези стойности предвид при изграждане на дневния калориен баланс. ПРИ ХРАНЕНЕ 2 С ДЕСЕРТ — НЕ включвай картофи, ориз или хляб. ЗА ХРАНЕНЕ 3 в дни с десерт: задължително БЕЗ плодове — само кисело мляко, ядки, скир или протеинов шейк.`;
}

/** Calories from macro grams: protein×4 + carbs×4 + fats×9 */
function macrosToCalories(macros) {
  if (!macros) return 0;
  const p = Number(macros.protein) || 0;
  const c = Number(macros.carbs) || 0;
  const f = Number(macros.fats) || 0;
  return Math.round(p * 4 + c * 4 + f * 9);
}

// Replaces "dessert": true markers with the fixed dessert object and adds dessert
// grams to meal.weight. Macro/calorie totals are set from strategy mealBreakdown
// by alignMealsToBreakdown() immediately after injection.
function injectFixedDesserts(weekPlan) {
  for (const dayKey of Object.keys(weekPlan)) {
    const day = weekPlan[dayKey];
    if (day && day.meals) {
      for (const meal of day.meals) {
        if (meal.dessert && typeof meal.dessert !== 'object') {
          meal.dessert = { ...FIXED_DESSERT, macros: { ...FIXED_DESSERT.macros }, _weightAddedToMeal: true };
          if (meal.weight && FIXED_DESSERT_WEIGHT_GRAMS > 0) {
            const mainMatch = String(meal.weight).match(/(\d+(?:\.\d+)?)/);
            if (mainMatch) {
              const totalGrams = Math.round(parseFloat(mainMatch[1]) + FIXED_DESSERT_WEIGHT_GRAMS);
              meal.weight = `${totalGrams}г`;
            }
          }
        }
      }
    }
  }
}

/**
 * Sync meal.calories from macros and rebuild dailyTotals.
 * Free-meal slot calories/macros come from strategy mealBreakdown when available.
 */
function recalculateDayCalories(weekPlan, strategy) {
  for (const dayKey of Object.keys(weekPlan)) {
    const day = weekPlan[dayKey];
    if (!day || !Array.isArray(day.meals)) continue;

    const dayNum = parseInt(String(dayKey).replace('day', ''), 10);
    const schemeKey = dayNum >= 1 && dayNum <= 7 ? DAY_NUMBER_TO_KEY[dayNum - 1] : null;
    const dayTarget = schemeKey && strategy?.weeklyScheme ? strategy.weeklyScheme[schemeKey] : null;

    let totalCals = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFats = 0;

    for (const meal of day.meals) {
      if (meal.type === 'Свободно хранене') {
        const freeTarget = dayTarget?.mealBreakdown?.find(m =>
          m.type === 'Свободно хранене' || m.type === 'Хранене 2'
        );
        const freeCal = freeTarget ? (Number(freeTarget.calories) || 0) : getFreeMealSlotCalories(dayTarget);
        if (freeCal > 0) meal._plannedCalories = freeCal;
        totalCals += freeCal;
        if (freeTarget) {
          totalProtein += Number(freeTarget.protein) || 0;
          totalCarbs += Number(freeTarget.carbs) || 0;
          totalFats += Number(freeTarget.fats) || 0;
        }
        continue;
      }
      if (meal.type === 'Напитка' || !meal.macros) continue;

      const p = Number(meal.macros.protein) || 0;
      const c = Number(meal.macros.carbs) || 0;
      const f = Number(meal.macros.fats) || 0;
      meal.calories = macrosToCalories(meal.macros);
      totalCals += meal.calories;
      totalProtein += p;
      totalCarbs += c;
      totalFats += f;
    }

    if (!day.dailyTotals) day.dailyTotals = {};
    day.dailyTotals.calories = totalCals;
    day.dailyTotals.protein = Math.round(totalProtein);
    day.dailyTotals.carbs = Math.round(totalCarbs);
    day.dailyTotals.fats = Math.round(totalFats);
  }
}

/**
 * Parse a Final_Calories value (number or string) into an integer.
 * Returns 0 if the value is missing or non-numeric.
 */
function parseFinalCalories(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Math.round(value);
  const m = String(value).match(/\d+/);
  return m ? parseInt(m[0]) : 0;
}

/**
 * Sync analysis.correctedMetabolism.realTDEE to Final_Calories.
 * The prompt instructs the AI to set both to the same value, but models
 * occasionally place different numbers in each field. Using Final_Calories
 * as the single source of truth prevents Steps 2 and 3 from working with
 * diverging calorie targets.
 */
function syncAnalysisCalories(analysis) {
  if (!analysis) return;
  const fc = parseFinalCalories(analysis.Final_Calories);
  if (fc > 0 && analysis.correctedMetabolism) {
    analysis.correctedMetabolism.realTDEE = fc;
  }
}

/**
 * Check if goal string/array contains a keyword (handles clinical protocol composite goals).
 */
function goalIncludes(goal, keyword) {
  if (!goal || !keyword) return false;
  if (Array.isArray(goal)) return goal.some(g => String(g).includes(keyword));
  return String(goal).includes(keyword);
}

function getMinRecommendedCalories(gender) {
  return gender === 'Мъж' ? MIN_RECOMMENDED_CALORIES_MALE : MIN_RECOMMENDED_CALORIES_FEMALE;
}

/**
 * Apply safety guardrails to AI calorie/macro output without replacing clinical judgment.
 * Clamps only dangerous extremes; AI retains authority on diet-specific targets.
 */
function enforceCalorieGuardrails(analysis, data, referenceTdee) {
  if (!analysis) return;

  syncAnalysisCalories(analysis);

  const tdee = referenceTdee || parseFinalCalories(analysis.tdee) || 0;
  let fc = parseFinalCalories(analysis.Final_Calories);
  if (fc <= 0 && tdee > 0) fc = tdee;

  const cm = analysis.correctedMetabolism || (analysis.correctedMetabolism = {});
  const minCal = getMinRecommendedCalories(data.gender);
  const isLactation = data.clinicalProtocol === 'postpartum_lactation';
  const maxDeficitRatio = 0.25;
  const corrections = [];

  if (tdee > 0 && fc > 0 && goalIncludes(data.goal, 'Отслабване') && !isLactation) {
    const minAllowed = Math.round(tdee * (1 - maxDeficitRatio));
    if (fc < minAllowed) {
      fc = minAllowed;
      corrections.push('Дефицитът е ограничен до безопасни 25%.');
    }
  }

  if (fc > 0 && fc < minCal) {
    fc = minCal;
    corrections.push('Повдигнато до минималния безопасен праг.');
  }

  if (fc > 0) {
    analysis.Final_Calories = fc;
    cm.realTDEE = fc;
  }

  const weight = parseFloat(data.weight) || 70;
  const minFatG = Math.round(weight * MIN_FAT_GRAMS_PER_KG);
  const mg = analysis.macroGrams || (analysis.macroGrams = {});
  const ratios = analysis.macroRatios;

  if (fc > 0 && ratios && ratios.protein != null && ratios.fats != null) {
    let proteinG = Math.round(fc * ratios.protein / 100 / 4);
    let fatsG = Math.round(fc * ratios.fats / 100 / 9);
    let carbsG = Math.round((fc - proteinG * 4 - fatsG * 9) / 4);

    if (fatsG < minFatG) {
      fatsG = minFatG;
      carbsG = Math.max(0, Math.round((fc - proteinG * 4 - fatsG * 9) / 4));
      corrections.push(`Мазнините са повдигнати до минимум ${minFatG}г.`);
    }

    mg.protein = proteinG;
    mg.fats = fatsG;
    mg.carbs = carbsG;
  } else if (mg.fats > 0 && mg.fats < minFatG) {
    mg.fats = minFatG;
    corrections.push(`Мазнините са повдигнати до минимум ${minFatG}г.`);
  }

  if (corrections.length > 0) {
    cm.correction = corrections.join(' ');
    console.log('Calorie guardrails applied:', corrections.join(' '));
  }
}

/**
 * Ensure weeklyScheme mealBreakdown sums match per-day calorie/macro targets.
 */
function normalizeWeeklyScheme(strategy, defaultDailyCalories) {
  if (!strategy?.weeklyScheme) return;

  for (const key of DAY_NUMBER_TO_KEY) {
    const day = strategy.weeklyScheme[key];
    if (!day || !Array.isArray(day.mealBreakdown) || day.mealBreakdown.length === 0) continue;

    const sumField = (field) => day.mealBreakdown.reduce((s, m) => s + (Number(m[field]) || 0), 0);
    const sumCals = sumField('calories');
    const sumP = sumField('protein');
    const sumC = sumField('carbs');
    const sumF = sumField('fats');

    const targetCals = Number(day.calories) || defaultDailyCalories || sumCals;
    if (!day.calories && (sumCals > 0 || defaultDailyCalories)) day.calories = sumCals || defaultDailyCalories;
    if (!day.protein && sumP > 0) day.protein = sumP;
    if (!day.carbs && sumC > 0) day.carbs = sumC;
    if (!day.fats && sumF > 0) day.fats = sumF;
    if (!day.meals) day.meals = day.mealBreakdown.length;

    if (sumCals > 0 && targetCals > 0 && Math.abs(sumCals - targetCals) > DAILY_CALORIE_TOLERANCE) {
      const ratio = targetCals / sumCals;
      for (const m of day.mealBreakdown) {
        m.calories = Math.round((Number(m.calories) || 0) * ratio);
        m.protein = Math.round((Number(m.protein) || 0) * ratio);
        m.carbs = Math.round((Number(m.carbs) || 0) * ratio);
        m.fats = Math.round((Number(m.fats) || 0) * ratio);
      }
    } else if (sumCals > 0 && Math.abs(sumCals - (Number(day.calories) || 0)) > DAILY_CALORIE_TOLERANCE) {
      day.calories = sumCals;
      day.protein = sumP;
      day.carbs = sumC;
      day.fats = sumF;
    }
  }
}

function getFreeMealSlotCalories(dayTarget) {
  if (!dayTarget?.mealBreakdown) return 0;
  const free = dayTarget.mealBreakdown.find(m =>
    m.type === 'Свободно хранене' || m.type === 'Хранене 2'
  );
  return free ? (Number(free.calories) || 0) : 0;
}

/**
 * Set each meal's macros/calories from strategy mealBreakdown (Step 2 targets).
 * Deterministic link between Step 2 architecture and Step 3 meals.
 */
function alignMealsToBreakdown(dayPlan, dayTarget) {
  if (!dayPlan?.meals?.length || !dayTarget?.mealBreakdown) return false;

  let changed = false;
  for (const meal of dayPlan.meals) {
    if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
    const target = dayTarget.mealBreakdown.find(m => m.type === meal.type);
    if (!target) continue;
    meal.macros = {
      protein: Math.round(Number(target.protein) || 0),
      carbs: Math.round(Number(target.carbs) || 0),
      fats: Math.round(Number(target.fats) || 0)
    };
    meal.calories = macrosToCalories(meal.macros);
    changed = true;
  }
  return changed;
}

function alignWeekPlanDaysToScheme(weekPlan, strategy, startDay, endDay) {
  if (!weekPlan || !strategy?.weeklyScheme) return;
  for (let d = startDay; d <= endDay; d++) {
    const dayKey = `day${d}`;
    const schemeKey = DAY_NUMBER_TO_KEY[d - 1];
    if (weekPlan[dayKey] && strategy.weeklyScheme[schemeKey]) {
      alignMealsToBreakdown(weekPlan[dayKey], strategy.weeklyScheme[schemeKey]);
    }
  }
  recalculateDayCalories(weekPlan, strategy);
}

/**
 * Summary display targets = Step 1 analysis (same as macrosVizContainer / diet recommendations).
 */
function syncPlanTargets(plan, analysis) {
  if (!plan || !analysis) return;
  const fc = parseFinalCalories(analysis.Final_Calories);
  const mg = analysis.macroGrams;
  if (!plan.summary) plan.summary = {};
  if (fc > 0) plan.summary.dailyCalories = fc;
  if (analysis.bmr != null) {
    plan.summary.bmr = typeof analysis.bmr === 'number'
      ? Math.round(analysis.bmr)
      : parseInt(String(analysis.bmr).match(/\d+/)?.[0] || '0', 10) || analysis.bmr;
  }
  if (mg) {
    plan.summary.macros = {
      protein: Math.round(Number(mg.protein) || 0),
      carbs: Math.round(Number(mg.carbs) || 0),
      fats: Math.round(Number(mg.fats) || 0)
    };
  }
}


// The AI sets "dessert": true on the lunch meal AND includes the dessert's full nutritional
// values directly in meal.calories/meal.macros, so the daily calorie budget is correct
// from the start without any backend adjustment.
// Nutritional values are taken from FIXED_DESSERT to keep them in sync.
// Maps AI-generated meal type variants to canonical allowed types
const MEAL_TYPE_ALIASES = {
  // Old canonical names → new canonical names (backward compat for stored plans)
  'Закуска': 'Хранене 1',
  'Обяд':    'Хранене 2',
  'Следобедна закуска': 'Хранене 3',
  'Вечеря':  'Хранене 4',
  'Късна закуска': 'Хранене 5',
  // AI-generated variants → canonical
  'Междинно': 'Хранене 3',
  'Междинна закуска': 'Хранене 3',
  'Снак': 'Хранене 3',
  'Снек': 'Хранене 3',
  'Лека закуска': 'Хранене 3',
  'Следобедна': 'Хранене 3',
  'Десерт': 'Хранене 3',
  'Предвечерна закуска': 'Хранене 5',
  'Нощна закуска': 'Хранене 5',
  // Beverage variants → Напитка
  'Вода с лимон/Зелен чай': 'Напитка',
  'Вода с лимон': 'Напитка',
  'Зелен чай': 'Напитка',
  'Чай': 'Напитка',
  'Кафе': 'Напитка',
  'Напитки': 'Напитка',
};

/**
 * Returns true when the user's foodCravings include 'Сладко' (sweets).
 * Handles both array (multi-select) and plain string values.
 */
function userHasSweetsCraving(foodCravings) {
  if (Array.isArray(foodCravings)) return foodCravings.includes('Сладко');
  return typeof foodCravings === 'string' && foodCravings.includes('Сладко');
}

// Foods allowed in late-night snacks (Хранене 5): fats + proteins only
const LOW_GI_FOODS = [
  'кисело мляко', 'скир', 'кефир',
  'ядки', 'бадеми', 'орехи', 'кашу', 'лешници', 'шамфъстък', 'пекани', 'макадамия'
];

// ADLE v8 Universal Meal Constructor - Hard Rules and Constraints
// Based on meallogic.txt - slot-based constructor with strict validation
// This will be merged with dynamic blacklist from KV storage
const ADLE_V8_HARD_BANS = [
  'лук', 'onion', 'пуешко месо', 'turkey meat',
  'изкуствени подсладители', 'artificial sweeteners',
  'мед', 'захар', 'конфитюр', 'сиропи', 'honey', 'sugar', 'jam', 'syrups',
  'кетчуп', 'майонеза', 'BBQ сос', 'ketchup', 'mayonnaise', 'BBQ sauce',
  'гръцко кисело мляко', 'greek yogurt'
];

// Default whitelist - approved foods for admin panel
const DEFAULT_FOOD_WHITELIST = [
  'яйца', 'eggs',
  'пилешко', 'chicken',
  'говеждо', 'beef',
  'свинско', 'свинска', 'pork',
  'риба', 'fish', 'скумрия', 'тон', 'сьомга',
  'кисело мляко', 'yogurt',
  'извара', 'cottage cheese',
  'сирене', 'cheese',
  'боб', 'beans',
  'леща', 'lentils',
  'нахут', 'chickpeas',
  'грах', 'peas'
];

// Default blacklist - hard banned foods for admin panel.
// Each entry is { item, mode: 'ban'|'substitute', substitute? }.
// 'ban'       – food is forbidden outright; AI is instructed not to use it.
// 'substitute'– food is replaced with the nearest acceptable alternative
//               both in the AI prompt and by the in-plan auto-corrector.
const DEFAULT_FOOD_BLACKLIST = [
  { item: 'лук',                   mode: 'substitute', substitute: 'чесън'             },
  { item: 'onion',                  mode: 'substitute', substitute: 'garlic'            },
  { item: 'пуешко месо',            mode: 'substitute', substitute: 'пилешко месо'      },
  { item: 'turkey meat',            mode: 'substitute', substitute: 'chicken'           },
  { item: 'пуешко',                 mode: 'substitute', substitute: 'пилешко'           },
  { item: 'изкуствени подсладители',mode: 'ban'                                         },
  { item: 'artificial sweeteners',  mode: 'ban'                                         },
  { item: 'мед',                    mode: 'ban'                                         },
  { item: 'захар',                  mode: 'ban'                                         },
  { item: 'конфитюр',               mode: 'ban'                                         },
  { item: 'сиропи',                 mode: 'ban'                                         },
  { item: 'honey',                  mode: 'ban'                                         },
  { item: 'sugar',                  mode: 'ban'                                         },
  { item: 'jam',                    mode: 'ban'                                         },
  { item: 'syrups',                 mode: 'ban'                                         },
  { item: 'кетчуп',                 mode: 'substitute', substitute: 'доматен сос'       },
  { item: 'ketchup',                mode: 'substitute', substitute: 'tomato sauce'      },
  { item: 'майонеза',               mode: 'substitute', substitute: 'натурален дресинг' },
  { item: 'mayonnaise',             mode: 'substitute', substitute: 'natural dressing'  },
  { item: 'BBQ сос',                mode: 'ban'                                         },
  { item: 'BBQ sauce',              mode: 'ban'                                         },
  { item: 'гръцко кисело мляко',    mode: 'substitute', substitute: 'кисело мляко'      },
  { item: 'greek yogurt',           mode: 'substitute', substitute: 'yogurt'            },
  { item: 'агнешко',                mode: 'substitute', substitute: 'говеждо'           },
  { item: 'заешко',                 mode: 'substitute', substitute: 'пилешко'           },
  { item: 'патешко',                mode: 'substitute', substitute: 'пилешко'           },
  { item: 'гъшко',                  mode: 'substitute', substitute: 'пилешко'           },
  { item: 'дивеч',                  mode: 'substitute', substitute: 'говеждо'           },
  { item: 'lamb',                   mode: 'substitute', substitute: 'beef'              },
  { item: 'rabbit',                 mode: 'substitute', substitute: 'chicken'           },
  { item: 'duck',                   mode: 'substitute', substitute: 'chicken'           },
  { item: 'goose',                  mode: 'substitute', substitute: 'chicken'           },
  { item: 'venison',                mode: 'substitute', substitute: 'beef'              },
];

const ADLE_V8_HARD_RULES = {
  R1: 'Protein main = exactly 1. Secondary protein only if (breakfast AND eggs), 0-1.',
  R2: 'Vegetables = 1-2. Choose exactly ONE form: Salad OR Fresh side (not both). Potatoes ≠ vegetables.',
  R3: 'Energy = 0-1 (never 2).',
  R4: 'Dairy max = 1 per meal (yogurt OR cottage cheese OR cheese), including as sauce/dressing.',
  R5: 'Fat = 0-1. If nuts/seeds present → no olive oil/butter.',
  R6: 'Cheese rule: If cheese present → no olive oil/butter. Olives allowed with cheese.',
  R7: 'Bacon rule: If bacon present → Fat=0.',
  R8: 'Legumes-as-main (beans/lentils/chickpeas/peas stew): Energy=0 (no rice/potatoes/pasta/bulgur/oats). Bread may be optional: +1 slice wholegrain.',
  R9: 'Bread optional rule (outside Template C): Allowed only if Energy=0. Exception: with legumes-as-main (R8), bread may still be optional (1 slice). If any Energy item present → Bread=0.',
  R10: 'Peas as meat-side add-on: Peas are NOT energy, but they BLOCK the Energy slot → Energy=0. Bread may be optional (+1 slice) if carbs needed.',
  R11: 'Template C (sandwich): Only snack; legumes forbidden; no banned sauces/sweeteners.',
  R12: 'Outside-whitelist additions: Default=use whitelists only. Outside-whitelist ONLY if objectively required (MODE/medical/availability), mainstream/universal, available in Bulgaria. Add line: Reason: ...'
};

const ADLE_V8_SPECIAL_RULES = {
  PEAS_FISH_BAN: 'Peas + fish combination is strictly forbidden.',
  VEGETABLE_FORM_RULE: 'Choose exactly ONE vegetable form per meal: Salad (with dressing) OR Fresh side (sliced, no dressing). Never both.',
  DAIRY_INCLUDES_SAUCE: 'Dairy count includes yogurt/cheese used in sauces, dressings, or cooking.',
  OLIVES_NOT_FAT: 'Olives are salad add-on (NOT Fat slot). If olives present → do NOT add olive oil/butter.',
  CORN_NOT_ENERGY: 'Corn is NOT an energy source. Small corn only in salads as add-on.',
  TEMPLATE_C_RESTRICTION: 'Template C (sandwich) allowed ONLY for snacks, NOT for main meals.'
};

/**
 * Helper: Escape regex special characters in a string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply food substitutions to a single meal object in-place.
 * `fixes` is an array of {detect, replace} from the KV blacklist.
 * Returns an array of human-readable substitution descriptions that were applied.
 * Longer phrases should appear before shorter sub-phrases in the fixes array.
 */
function applyFoodSubstitutions(meal, fixes) {
  const applied = [];
  for (const { detect, replace } of fixes) {
    const re = new RegExp(escapeRegex(detect), 'gi');
    let changed = false;
    if (meal.name && re.test(meal.name)) {
      meal.name = meal.name.replace(re, replace);
      changed = true;
    }
    if (meal.description && new RegExp(escapeRegex(detect), 'gi').test(meal.description)) {
      meal.description = meal.description.replace(new RegExp(escapeRegex(detect), 'gi'), replace);
      changed = true;
    }
    if (changed) applied.push(`${detect}→${replace}`);
  }
  return applied;
}

const DAYS_PER_CHUNK = 2; // Generate 2 days at a time (4 chunks: days 1-2, 3-4, 5-6, 7)

/**
 * REQUIREMENT 4: Validate plan against all parameters and check for contradictions
 * Returns { isValid: boolean, errors: string[] }
 */
function validatePlan(plan, userData, substitutions = []) {
  const errors = [];
  const warnings = [];
  const stepErrors = {
    step1_analysis: [],
    step2_strategy: [],
    step3_mealplan: [],
    step4_final: []
  };
  
  // 1. Check for basic plan structure
  if (!plan || typeof plan !== 'object') {
    errors.push('План липсва или е в невалиден формат');
    stepErrors.step4_final.push('План липсва или е в невалиден формат');
    return { isValid: false, errors, stepErrors };
  }
  
  // 2. Check for required analysis (Step 1)
  if (!plan.analysis || !plan.analysis.keyProblems) {
    const error = 'Липсва задълбочен анализ';
    errors.push(error);
    stepErrors.step1_analysis.push(error);
  }
  
  // 3. Check for strategy (Step 2)
  if (!plan.strategy || !plan.strategy.dietaryModifier) {
    const error = 'Липсва диетична стратегия';
    errors.push(error);
    stepErrors.step2_strategy.push(error);
  }
  
  // 4. Check for week plan (Step 3)
  if (!plan.weekPlan) {
    const error = 'Липсва седмичен план';
    errors.push(error);
    stepErrors.step3_mealplan.push(error);
  } else {
    // Verify all 7 days exist
    const daysCount = Object.keys(plan.weekPlan).filter(key => key.startsWith('day')).length;
    if (daysCount < 7) {
      const error = `Липсват дни от седмицата (генерирани само ${daysCount} от 7)`;
      errors.push(error);
      stepErrors.step3_mealplan.push(error);
    }
    
    // Verify each day has meals
    for (let i = 1; i <= 7; i++) {
      const dayKey = `day${i}`;
      const day = plan.weekPlan[dayKey];
      if (!day || !day.meals || !Array.isArray(day.meals) || day.meals.length === 0) {
        const error = `Ден ${i} няма хранения`;
        errors.push(error);
        stepErrors.step3_mealplan.push(error);
      } else {
        // Check that each day has meals within acceptable range (1-5)
        if (day.meals.length < MIN_MEALS_PER_DAY || day.meals.length > MAX_MEALS_PER_DAY) {
          const error = `Ден ${i} има ${day.meals.length} хранения - трябва да е между ${MIN_MEALS_PER_DAY} и ${MAX_MEALS_PER_DAY}`;
          errors.push(error);
          stepErrors.step3_mealplan.push(error);
        }

        // Auto-normalize meal types BEFORE any type-dependent checks so that the macro
        // and calorie checks below always see the canonical type values.
        // Priority 1: if meal name is "Свободно хранене" but type is wrong, fix the type.
        // Priority 2: apply standard MEAL_TYPE_ALIASES for old/AI-generated alias names.
        day.meals.forEach((meal, idx) => {
          const normalizedMealName = (meal.name || '').toLowerCase().trim();
          if (normalizedMealName === 'свободно хранене' && meal.type !== 'Свободно хранене') {
            const original = meal.type;
            meal.type = 'Свободно хранене';
            warnings.push(`Ден ${i}, хранене ${idx + 1}: автокорекция на тип за свободно хранене "${original}" → "Свободно хранене"`);
          } else if (!ALLOWED_MEAL_TYPES.includes(meal.type) && MEAL_TYPE_ALIASES[meal.type]) {
            const original = meal.type;
            meal.type = MEAL_TYPE_ALIASES[original];
            warnings.push(`Ден ${i}, хранене ${idx + 1}: автокорекция на тип хранене "${original}" → "${meal.type}"`);
          }
        });

        // Validate that meals have macros
        let mealsWithoutMacros = 0;
        day.meals.forEach((meal, mealIndex) => {
          if (!meal.macros || meal.macros.protein == null || meal.macros.carbs == null || meal.macros.fats == null) {
            // Beverages ("Напитка") and free meals ("Свободно хранене") don't require macronutrients - skip them
            // Note: use == null (not falsy check) so that explicitly-zero values (e.g. carbs=0 on a keto day) are treated as valid
            if (meal.type !== 'Напитка' && meal.type !== 'Свободно хранене') {
              mealsWithoutMacros++;
            }
          } else {
            // Validate that macros are present but skip calorie-accuracy checks —
            // the AI model's declared calories are accepted as authoritative.
            
            // Validate portion sizes (weight field)
            if (meal.weight) {
              // Extract weight in grams, handling decimals and multiple servings
              const weightMatch = meal.weight.match(/(\d+(?:\.\d+)?)\s*g/);
              if (weightMatch) {
                const weightGrams = parseFloat(weightMatch[1]);
                if (weightGrams < 50) {
                  warnings.push(`Ден ${i}, хранене ${mealIndex + 1} (${meal.type}): Много малка порция (${weightGrams}g) - проверете дали е реалистична`);
                } else if (weightGrams > 800) {
                  warnings.push(`Ден ${i}, хранене ${mealIndex + 1} (${meal.type}): Много голяма порция (${weightGrams}g) - проверете дали е реалистична`);
                }
              }
            }
          }
        });
        if (mealsWithoutMacros > 0) {
          const error = `Ден ${i} има ${mealsWithoutMacros} хранения без макронутриенти`;
          errors.push(error);
          stepErrors.step3_mealplan.push(error);
        }
        
        // Validate daily calorie totals
        // Free eating meals ("Свободно хранене") don't have calories - skip the minimum check for days with free eating
        const hasFreeEatingMeal = day.meals.some(meal => meal.type === 'Свободно хранене');
        const dayCalories = day.meals.reduce((sum, meal) => {
          const mealCal = parseInt(meal.calories) || 0;
          return sum + mealCal;
        }, 0);
        const minDayCalories = getMinRecommendedCalories(userData.gender);
        if (!hasFreeEatingMeal && dayCalories < minDayCalories) {
          const error = `Ден ${i} има само ${dayCalories} калории - твърде малко (минимум ${minDayCalories})`;
          errors.push(error);
          stepErrors.step3_mealplan.push(error);
        }
        
        // Validate meal ordering (UPDATED: allow meals after dinner when justified by strategy)
        const mealTypes = day.meals.map(meal => meal.type);
        const dinnerIndex = mealTypes.findIndex(type => type === 'Хранене 4');
        
        if (dinnerIndex !== -1 && dinnerIndex !== mealTypes.length - 1) {
          // Dinner exists but is not the last meal - check if there's justification
          const mealsAfterDinner = day.meals.slice(dinnerIndex + 1);
          const mealsAfterDinnerTypes = mealsAfterDinner.map(m => m.type);
          
          // Check if strategy provides specific justification for meals after dinner
          const hasAfterDinnerJustification = plan.strategy && 
                                               plan.strategy.afterDinnerMealJustification && 
                                               plan.strategy.afterDinnerMealJustification !== 'Не са необходими';
          
          // Allow meals after dinner if there's clear justification in strategy
          // Otherwise, require it to be a late-night snack with appropriate properties
          if (!hasAfterDinnerJustification) {
            // No justification - apply strict rules for late-night snack only
            if (mealsAfterDinner.length > 1 || 
                (mealsAfterDinner.length === 1 && mealsAfterDinnerTypes[0] !== 'Хранене 5')) {
              const error = `Ден ${i}: Има хранения след Хранене 4 (${mealsAfterDinnerTypes.join(', ')}) без обосновка в strategy.afterDinnerMealJustification. Моля, добави обосновка или премахни храненията след Хранене 4.`;
              errors.push(error);
              stepErrors.step2_strategy.push(error); // This is a strategy issue
            } else if (mealsAfterDinner.length === 1 && mealsAfterDinnerTypes[0] === 'Хранене 5') {
              // Validate that late-night snack contains only fats+proteins (skyr, raw nuts, yogurt)
              const lateSnack = mealsAfterDinner[0];
              const snackDescription = (lateSnack.description || '').toLowerCase();
              const snackName = (lateSnack.name || '').toLowerCase();
              const snackText = snackDescription + ' ' + snackName;
              
              const hasAllowedFood = LOW_GI_FOODS.some(food => snackText.includes(food));
              
              if (!hasAllowedFood) {
                const error = `Ден ${i}: Хранене 5 трябва да съдържа само мазнини и белтъчини (скир, сурови ядки, кисело мляко) или да има ясна обосновка в strategy.afterDinnerMealJustification`;
                errors.push(error);
                stepErrors.step3_mealplan.push(error);
              }
              
              // Validate that late-night snack is not too high in calories (warning only if no justification)
              const snackCalories = parseInt(lateSnack.calories) || 0;
              if (snackCalories > MAX_LATE_SNACK_CALORIES) {
                console.log(`Warning Ден ${i}: Хранене 5 има ${snackCalories} калории - препоръчват се максимум ${MAX_LATE_SNACK_CALORIES} калории при липса на обосновка`);
              }
            }
          }
          // If there IS afterDinnerMealJustification, we allow meals after dinner without strict validation
        }
        
        // Check for invalid meal types
        day.meals.forEach((meal, idx) => {
          if (!ALLOWED_MEAL_TYPES.includes(meal.type)) {
            const error = `Ден ${i}, хранене ${idx + 1}: Невалиден тип "${meal.type}" - разрешени са само: ${ALLOWED_MEAL_TYPES.join(', ')}`;
            errors.push(error);
            stepErrors.step3_mealplan.push(error);
          }
        });
        
        // Check chronological order
        let lastValidIndex = -1;
        day.meals.forEach((meal, idx) => {
          const currentIndex = MEAL_ORDER_MAP[meal.type];
          if (currentIndex !== undefined) {
            if (currentIndex < lastValidIndex) {
              const error = `Ден ${i}: Неправилен хронологичен ред - "${meal.type}" след по-късно хранене`;
              errors.push(error);
              stepErrors.step3_mealplan.push(error);
            }
            lastValidIndex = currentIndex;
          }
        });
        
        // Check for multiple afternoon snacks
        const afternoonSnackCount = mealTypes.filter(type => type === 'Хранене 3').length;
        if (afternoonSnackCount > 1) {
          const error = `Ден ${i}: Повече от 1 следобедно хранене (Хранене 3) (${afternoonSnackCount}) - разрешено е максимум 1`;
          errors.push(error);
          stepErrors.step3_mealplan.push(error);
        }

        // Validate Хранене 3 content: must be a simple snack (fruits, raw nuts, skyr, yogurt)
        const MEAL3_ALLOWED_FOODS = [
          'плод', 'ябълка', 'круша', 'портокал', 'мандарина', 'банан', 'ягод', 'боровинк', 'малин', 'праскова', 'кайсия', 'грозде', 'пъпеш', 'диня', 'слив', 'киви', 'нектарин', 'манго',
          'ядки', 'бадем', 'орех', 'кашу', 'лешник', 'шамфъстък', 'пекан', 'макадамия',
          'скир', 'кисело мляко', 'кефир'
        ];
        const meal3 = day.meals.find(m => m.type === 'Хранене 3');
        if (meal3) {
          const meal3Text = ((meal3.name || '') + ' ' + (meal3.description || '')).toLowerCase();
          const hasMeal3AllowedFood = MEAL3_ALLOWED_FOODS.some(food => meal3Text.includes(food));
          if (!hasMeal3AllowedFood) {
            const error = `Ден ${i}: Хранене 3 трябва да е лека закуска — само плодове, сурови ядки, скир или кисело мляко. Намерено: "${meal3.name}"`;
            errors.push(error);
            stepErrors.step3_mealplan.push(error);
          }
        }

        // Check for multiple late-night snacks
        const lateNightSnackCount = mealTypes.filter(type => type === 'Хранене 5').length;
        if (lateNightSnackCount > 1) {
          const error = `Ден ${i}: Повече от 1 Хранене 5 (${lateNightSnackCount}) - разрешено е максимум 1`;
          errors.push(error);
          stepErrors.step3_mealplan.push(error);
        }
      }
    }
  }
  
  // 5. Check for required recommendations (Step 4 - Final validation)
  if (!plan.recommendations || !Array.isArray(plan.recommendations) || plan.recommendations.length < 3) {
    const error = 'Липсват препоръчителни храни';
    errors.push(error);
    stepErrors.step4_final.push(error);
  }
  
  // 6. Check for forbidden foods (Step 4 - Final validation)
  if (!plan.forbidden || !Array.isArray(plan.forbidden) || plan.forbidden.length < 3) {
    const error = 'Липсват забранени храни';
    errors.push(error);
    stepErrors.step4_final.push(error);
  }
  
  // 7. Check for goal-plan alignment (Step 2 - Strategy issue)
  // 7a. Minimum calorie safety floor (medical requirement)
  if (plan.analysis && (plan.analysis.Final_Calories || plan.analysis.recommendedCalories)) {
    const recCal = parseInt(plan.analysis.Final_Calories || plan.analysis.recommendedCalories) || 0;
    const calFloor = userData.gender === 'Мъж' ? MIN_RECOMMENDED_CALORIES_MALE : MIN_RECOMMENDED_CALORIES_FEMALE;
    if (recCal > 0 && recCal < calFloor) {
      const error = `Препоръчителните калории (${recCal} kcal) са под безопасния минимум (${calFloor} kcal за ${userData.gender})`;
      errors.push(error);
      stepErrors.step1_analysis.push(error);
    }
  }

  // 7b. Minimum fat grams (hormonal function requires ≥0.7g/kg)
  if (plan.analysis && plan.analysis.macroGrams && userData.weight) {
    const fatGrams = parseInt(plan.analysis.macroGrams.fats) || 0;
    const weight = parseFloat(userData.weight) || 70;
    const minFatGrams = Math.round(weight * MIN_FAT_GRAMS_PER_KG);
    if (fatGrams > 0 && fatGrams < minFatGrams) {
      const error = `Мазнините (${fatGrams}г) са под минималната нужда от ${minFatGrams}г (${MIN_FAT_GRAMS_PER_KG}г/кг) за хормонална функция`;
      errors.push(error);
      stepErrors.step1_analysis.push(error);
    }
  }

  if (goalIncludes(userData.goal, 'Отслабване') && plan.summary && plan.summary.dailyCalories) {
    // Extract numeric calories
    const caloriesMatch = String(plan.summary.dailyCalories).match(/\d+/);
    if (caloriesMatch) {
      const calories = parseInt(caloriesMatch[0]);
      // For weight loss, calories should be reasonable (not too high)
      if (calories > 3000) {
        const error = 'Калориите са твърде високи за цел отслабване';
        errors.push(error);
        stepErrors.step2_strategy.push(error);
      }
    }
  }
  
  // 8. Check for medical conditions alignment (Step 2 - Strategy issue)
  if (userData.medicalConditions && Array.isArray(userData.medicalConditions)) {
    // Check for diabetes / insulin resistance + high carb plan.
    // Covers: questionnaire2 user who picked "Диабет / Инсулинова резистентност" (→ 'Диабет' and
    // 'Инсулинова резистентност' in the array) AND protocol users whose medicalConditions was
    // auto-populated to the clinicalProtocol.name string e.g. 'Инсулинова резистентност и Метаболитен синдром'.
    if (userData.medicalConditions.some(c =>
        c.includes('Диабет') || c.includes('Инсулинова резистентност')
      )) {
      const modifier = plan.strategy?.dietaryModifier || '';
      if (modifier.toLowerCase().includes('високовъглехидратно')) {
        const error = 'Планът съдържа високовъглехидратна диета, неподходяща при диабет';
        errors.push(error);
        stepErrors.step2_strategy.push(error);
      }
    }
    
    // Check for IBS/IBD + raw fiber heavy plan.
    // Covers: questionnaire2 user (→ 'IBS', 'IBD', 'Рефлукс') AND gi_issues protocol users
    // whose medicalConditions is auto-populated to 'Стомашно-чревни проблеми (...)'.
    if (userData.medicalConditions.some(c =>
        c.includes('IBS') || c.includes('IBD') || c.includes('Стомашно-чревни')
      )) {
      const modifier = plan.strategy?.dietaryModifier || '';
      if (!modifier.toLowerCase().includes('щадящ')) {
        // Warning, but not fatal error
        console.log('Warning: IBS/IBD detected but plan may not be gentle enough');
      }
    }
    
    // Check for PCOS + high carb plan
    if (userData.medicalConditions.includes('PCOS') || userData.medicalConditions.includes('СПКЯ') ||
        userData.medicalConditions.includes('Ендокринни') ||
        (userData.medicalConditions_Ендокринни_детайл && userData.medicalConditions_Ендокринни_детайл.includes('поликистозни'))) {
      const modifier = plan.strategy?.dietaryModifier || '';
      if (modifier.toLowerCase().includes('високовъглехидратно') || modifier.toLowerCase().includes('балансирано')) {
        console.log('Warning: PCOS detected - should prefer lower carb approach');
      }
    }
    
    // Check for anemia + vegetarian diet without iron supplementation (Step 4 - Final validation)
    if (userData.medicalConditions.includes('Анемия') && 
        userData.dietPreference && 
        (userData.dietPreference.includes('Вегетарианска') || userData.dietPreference.includes('Веган'))) {
      const supplements = plan.supplements || [];
      const hasIronSupplement = supplements.some(s => /желязо|iron/i.test(s));
      if (!hasIronSupplement) {
        const error = 'При анемия и вегетарианска/веган диета е задължителна добавка с желязо';
        errors.push(error);
        stepErrors.step4_final.push(error);
      }
    }
  }
  
  // 8a. Check for medication-supplement interactions (Step 4 - Final validation)
  if (userData.medications === 'Да' && userData.medicationsDetails && plan.supplements) {
    const medications = userData.medicationsDetails.toLowerCase();
    const supplements = plan.supplements.join(' ').toLowerCase();
    
    // Check for dangerous interactions
    if (medications.includes('варфарин') && supplements.includes('витамин к')) {
      const error = 'ОПАСНО: Витамин K взаимодейства с варфарин (антикоагулант) - може да намали ефективността';
      errors.push(error);
      stepErrors.step4_final.push(error);
    }
    
    if ((medications.includes('антибиотик') || medications.includes('антибиотици')) && 
        (supplements.includes('калций') || supplements.includes('магнезий'))) {
      console.log('Warning: Калций/Магнезий може да намали усвояването на антибиотици - трябва да се вземат на различно време');
    }
    
    if (medications.includes('антацид') && supplements.includes('желязо')) {
      console.log('Warning: Антацидите блокират усвояването на желязо - трябва да се вземат на различно време');
    }
  }
  
  // 9. Check for dietary preferences alignment (Step 4 - Final validation)
  if (userData.dietPreference && Array.isArray(userData.dietPreference)) {
    if (userData.dietPreference.includes('Вегетарианска') || userData.dietPreference.includes('Веган')) {
      // Check if plan contains meat (would be in forbidden)
      if (plan.recommendations && Array.isArray(plan.recommendations)) {
        const containsMeat = plan.recommendations.some(item => 
          /месо|пиле|риба|говеждо|свинско/i.test(item)
        );
        if (containsMeat && userData.dietPreference.includes('Веган')) {
          const error = 'Планът съдържа животински продукти, неподходящи за веган диета';
          errors.push(error);
          stepErrors.step4_final.push(error);
        }
      }
    }
  }
  
  // 10. Check for food repetition across days (Step 3 - Meal plan issue)
  // SIMPLIFIED REPETITION METRIC: Максимум 5 повтарящи се ястия в седмичния план
  if (plan.weekPlan) {
    const mealNames = new Set();
    const repeatedMeals = new Set();
    
    Object.keys(plan.weekPlan).forEach(dayKey => {
      const day = plan.weekPlan[dayKey];
      if (day && day.meals && Array.isArray(day.meals)) {
        day.meals.forEach(meal => {
          if (meal.name) {
            // Normalize meal name (lowercase, remove extra spaces)
            const normalizedName = meal.name.toLowerCase().trim().replace(/\s+/g, ' ');
            if (mealNames.has(normalizedName)) {
              repeatedMeals.add(normalizedName);
            }
            mealNames.add(normalizedName);
          }
        });
      }
    });
    
    // SIMPLIFIED RULE (Issue #11): Максимум 5 повтарящи се ястия
    if (repeatedMeals.size > 5) {
      warnings.push(`Планът съдържа твърде много повтарящи се ястия (${repeatedMeals.size} > 5). За разнообразие, ограничи повторенията до 5 ястия максимум. Повтарящи се: ${Array.from(repeatedMeals).slice(0, 5).join(', ')}`);
    }
  }
  
  // 11. Check for plan justification (Step 2 - Strategy issue)
  if (!plan.strategy || !plan.strategy.planJustification || plan.strategy.planJustification.length < 100) {
    const error = 'Липсва детайлна обосновка защо планът е индивидуален (минимум 100 символа)';
    errors.push(error);
    stepErrors.step2_strategy.push(error);
  }
  
  // 11a. Check for welcome message (Step 2 - Strategy issue)
  if (!plan.strategy || !plan.strategy.welcomeMessage || plan.strategy.welcomeMessage.length < 100) {
    const error = 'Липсва персонализирано приветствие за клиента (strategy.welcomeMessage, минимум 100 символа)';
    errors.push(error);
    stepErrors.step2_strategy.push(error);
  }
  
  // 10a. Check for meal count justification (Step 2 - Strategy issue)
  if (!plan.strategy || !plan.strategy.mealCountJustification || plan.strategy.mealCountJustification.length < 20) {
    const error = 'Липсва обосновка за избора на брой хранения (strategy.mealCountJustification)';
    errors.push(error);
    stepErrors.step2_strategy.push(error);
  }
  
  // 11. Check that analysis doesn't contain "Normal" severity problems (Step 1 - Analysis issue)
  if (plan.analysis && plan.analysis.keyProblems && Array.isArray(plan.analysis.keyProblems)) {
    const normalProblems = plan.analysis.keyProblems.filter(p => p.severity === 'Normal');
    if (normalProblems.length > 0) {
      const error = `Анализът съдържа ${normalProblems.length} "Normal" проблеми, които не трябва да се показват`;
      errors.push(error);
      stepErrors.step1_analysis.push(error);
    }
  }
  
  // 12. Auto-correct ADLE v8 hard bans in meal descriptions.
  // Instead of returning errors that trigger a correction loop, banned foods are
  // replaced in-place with the nearest acceptable alternative. Fixes are logged
  // as warnings so they remain visible without blocking the plan.
  if (plan.weekPlan) {
    Object.keys(plan.weekPlan).forEach(dayKey => {
      const day = plan.weekPlan[dayKey];
      if (day && day.meals && Array.isArray(day.meals)) {
        day.meals.forEach((meal, mealIndex) => {
          // Apply substitutions from KV blacklist in one pass
          const fixes = applyFoodSubstitutions(meal, substitutions);
          if (fixes.length > 0) {
            warnings.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: автокорекция: ${fixes.join(', ')}`);
          }

          // Auto-fix peas + fish combination: replace грах with броколи
          const mealText = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();
          if (/грах|peas/.test(mealText) && /риба|fish/.test(mealText)) {
            const pFixes = applyFoodSubstitutions(meal, [
              { detect: 'грах', replace: 'броколи' },
              { detect: 'peas', replace: 'broccoli' }
            ]);
            if (pFixes.length > 0) {
              warnings.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: автокорекция грах+риба: ${pFixes.join(', ')}`);
            }
          }

          // Honey/sugar/syrup: warning only (context-dependent, not auto-replaced)
          const correctedMealText = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();
          if (/\b(мед|захар|сироп)\b(?=\s|,|\.|\))/.test(correctedMealText) && !/медицин|междин|сиропен/.test(correctedMealText)) {
            warnings.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: Може да съдържа МЕД/ЗАХАР/СИРОП (hard ban от ADLE v8) - проверете`);
          }
        });
      }
    });
  }
  
  // Determine which step to restart from (earliest step with errors)
  let earliestErrorStep = null;
  if (stepErrors.step1_analysis.length > 0) {
    earliestErrorStep = 'step1_analysis';
  } else if (stepErrors.step2_strategy.length > 0) {
    earliestErrorStep = 'step2_strategy';
  } else if (stepErrors.step3_mealplan.length > 0) {
    earliestErrorStep = 'step3_mealplan';
  } else if (stepErrors.step4_final.length > 0) {
    earliestErrorStep = 'step4_final';
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stepErrors,
    earliestErrorStep
  };
}

/**
 * Helper: Validate ADLE v8 specific rules for a single meal
 * This provides hints about rule violations but doesn't fail validation
 * (AI instructions are primary enforcement mechanism)
 */
function checkADLEv8Rules(meal) {
  const warnings = [];
  const mealText = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();
  
  // R2: Check for both salad AND fresh side (should be ONE form)
  const hasSalad = /\b(салата|салатка|salad)\b/.test(mealText);
  const hasFresh = /\b(пресн|fresh|нарязан)\b/.test(mealText) && /\b(домати|краставици|чушки)\b/.test(mealText);
  if (hasSalad && hasFresh) {
    warnings.push('Възможно нарушение на R2: Салата И Пресни зеленчуци (трябва ЕДНА форма)');
  }
  
  // R8: Legumes as main should not have energy sources
  const hasLegumes = /\b(боб|леща|нахут|грах|beans|lentils|chickpeas)\b/.test(mealText);
  const hasEnergy = /\b(ориз|картофи|паста|овес|булгур|rice|potatoes|pasta|oats|bulgur)\b/.test(mealText);
  if (hasLegumes && hasEnergy) {
    warnings.push('Възможно нарушение на R8: Бобови + Енергия (бобовите като основно трябва Energy=0)');
  }
  
  return warnings;
}

/**
 * Generate correction prompt for AI when plan validation fails
 * This allows the AI to fix specific issues instead of regenerating from scratch
 * 
 * @param {Object} plan - The generated plan that failed validation
 * @param {string[]} validationErrors - Array of specific validation error messages
 * @param {Object} userData - User profile data for context
 * @returns {Promise<string>} Prompt instructing AI to correct specific errors in the plan
 */
async function generateCorrectionPrompt(plan, validationErrors, userData, env) {
  const customPrompt = await requireKvPrompt(env, 'admin_correction_prompt');
  const _combinedNotes = buildCombinedAdditionalNotes(userData);
    const additionalNotesSection = _combinedNotes
      ? `═══ 🔥 КРИТИЧНО ВАЖНА ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ 🔥 ═══\n⚠️ МАКСИМАЛЕН ПРИОРИТЕТ при корекциите!\n${_combinedNotes}\n⚠️ ЗАДЪЛЖИТЕЛНО: Всички корекции трябва да уважават тази информация!\n═══════════════════════════════════════════════════════════════`
      : '';
    let prompt = replacePromptVariables(customPrompt, {
      validationErrors: validationErrors,
      plan: plan,
      userData: userData,
      errorsFormatted: validationErrors.map((error, idx) => `${idx + 1}. ${error}`).join('\n'),
      planJSON: JSON.stringify(plan, null, 2),
      userDataJSON: JSON.stringify({
        name: userData.name,
        age: userData.age,
        gender: userData.gender,
        goal: userData.goal,
        medicalConditions: userData.medicalConditions,
        dietPreference: userData.dietPreference,
        dietDislike: userData.dietDislike,
        dietLove: userData.dietLove,
        additionalNotes: _combinedNotes || undefined
      }, null, 2),
      additionalNotes: _combinedNotes,
      additionalNotesSection,
      MEAL_NAME_FORMAT_INSTRUCTIONS,
      MIN_DAILY_CALORIES: MIN_DAILY_CALORIES
    });

  if (!hasJsonFormatInstructions(prompt)) {
    prompt += `

═══ КРИТИЧНО ВАЖНО - ФОРМАТ НА ОТГОВОР ═══
Отговори САМО с валиден JSON обект - ПЪЛНИЯ КОРИГИРАН план БЕЗ допълнителни обяснения или текст преди или след JSON.

ВАЖНО: Върни САМО JSON без други текст или обяснения!`;
  }
  return prompt;
}

/**
 * Regenerate from a specific step with targeted error prevention
 * This allows the system to restart from the earliest error step instead of full regeneration
 */
async function regenerateFromStep(env, data, existingPlan, earliestErrorStep, stepErrors, correctionAttempt) {
  console.log(`Regenerating from ${earliestErrorStep}, attempt ${correctionAttempt}`);
  
  // Generate a unique session ID for this regeneration
  const sessionId = generateUniqueId('regen');
  console.log(`Regeneration session ID: ${sessionId}`);
  
  // Create high-priority error prevention comment for the step
  const errorPreventionComment = generateErrorPreventionComment(stepErrors[earliestErrorStep], earliestErrorStep, correctionAttempt);
  
  // Token tracking
  let cumulativeTokens = {
    input: 0,
    output: 0,
    total: 0
  };
  
  let analysis, strategy, mealPlan;
  
  try {
    // Step 1: Analysis (regenerate if this step has errors, otherwise reuse)
    if (earliestErrorStep === 'step1_analysis') {
      console.log('Regenerating Step 1 (Analysis) with error prevention');
      const analysisPrompt = await generateAnalysisPrompt(data, env, errorPreventionComment);
      const analysisInputTokens = estimateTokenCount(analysisPrompt);
      cumulativeTokens.input += analysisInputTokens;
      
      const analysisResponse = await callAIModel(env, analysisPrompt, 4000, 'step1_analysis_regen', sessionId, data, null);
      const analysisOutputTokens = estimateTokenCount(analysisResponse);
      cumulativeTokens.output += analysisOutputTokens;
      cumulativeTokens.total = cumulativeTokens.input + cumulativeTokens.output;
      
      analysis = parseAIResponse(analysisResponse);
      
      if (!analysis || analysis.error) {
        throw new Error(`Регенерацията на анализа се провали: ${analysis?.error || 'Невалиден формат'}`);
      }
      
      // Filter out "Normal" severity problems
      if (analysis.keyProblems && Array.isArray(analysis.keyProblems)) {
        analysis.keyProblems = analysis.keyProblems.filter(problem => problem.severity !== 'Normal');
      }
      const refActivity = calculateUnifiedActivityScore(data);
      const refBmr = calculateBMR(data);
      const refTdee = calculateTDEE(refBmr, refActivity.combinedScore);
      enforceCalorieGuardrails(analysis, data, refTdee);
    } else {
      // Reuse existing analysis
      analysis = existingPlan.analysis;
      console.log('Reusing existing analysis');
    }
    
    // Step 2: Strategy (regenerate if this or earlier step has errors)
    if (earliestErrorStep === 'step1_analysis' || earliestErrorStep === 'step2_strategy') {
      const stepErrorComment = earliestErrorStep === 'step2_strategy' ? errorPreventionComment : null;
      console.log(`Regenerating Step 2 (Strategy)${stepErrorComment ? ' with error prevention' : ''}`);
      
      const strategyPrompt = await generateStrategyPrompt(data, analysis, env, stepErrorComment);
      const strategyInputTokens = estimateTokenCount(strategyPrompt);
      cumulativeTokens.input += strategyInputTokens;
      
      const strategyResponse = await callAIModel(env, strategyPrompt, 4000, 'step2_strategy_regen', sessionId, data, buildCompactAnalysis(analysis));
      const strategyOutputTokens = estimateTokenCount(strategyResponse);
      cumulativeTokens.output += strategyOutputTokens;
      cumulativeTokens.total = cumulativeTokens.input + cumulativeTokens.output;
      
      strategy = parseAIResponse(strategyResponse);
      enforceWeekendFreeDay(strategy);
      normalizeWeeklyScheme(strategy, parseFinalCalories(analysis.Final_Calories));
      
      if (!strategy || strategy.error) {
        throw new Error(`Регенерацията на стратегията се провали: ${strategy?.error || 'Невалиден формат'}`);
      }
    } else {
      // Reuse existing strategy
      strategy = existingPlan.strategy;
      console.log('Reusing existing strategy');
    }
    
    // Step 3: Meal Plan (regenerate if any earlier step has errors or this step has errors)
    if (earliestErrorStep === 'step1_analysis' || earliestErrorStep === 'step2_strategy' || earliestErrorStep === 'step3_mealplan') {
      const stepErrorComment = earliestErrorStep === 'step3_mealplan' ? errorPreventionComment : null;
      console.log(`Regenerating Step 3 (Meal Plan)${stepErrorComment ? ' with error prevention' : ''}`);
      mealPlan = await generateMealPlanProgressive(env, data, analysis, strategy, stepErrorComment, sessionId);
    } else if (earliestErrorStep === 'step4_final') {
      // Step 4: Final validation errors (summary, recommendations, forbidden, supplements, etc.)
      // Reuse weekPlan but regenerate the summary and final fields
      console.log('Regenerating Step 4 (Summary and Recommendations) with error prevention');
      
      // Parse BMR and calories from existing analysis
      let bmr;
      if (analysis.bmr) {
        if (typeof analysis.bmr === 'number') {
          bmr = Math.round(analysis.bmr);
        } else {
          const bmrMatch = String(analysis.bmr).match(/\d+/);
          bmr = bmrMatch ? parseInt(bmrMatch[0]) : null;
        }
      }
      if (!bmr) {
        bmr = calculateBMR(data);
      }
      
      let recommendedCalories;
      const finalCaloriesSource = analysis.Final_Calories || analysis.recommendedCalories;
      if (finalCaloriesSource) {
        if (typeof finalCaloriesSource === 'number') {
          recommendedCalories = Math.round(finalCaloriesSource);
        } else {
          const caloriesMatch = String(finalCaloriesSource).match(/\d+/);
          recommendedCalories = caloriesMatch ? parseInt(caloriesMatch[0]) : null;
        }
      }
      if (!recommendedCalories) {
        const fallbackActivityData = calculateUnifiedActivityScore(data);
        const tdee = calculateTDEE(bmr, fallbackActivityData.combinedScore);
        if (goalIncludes(data.goal, 'Отслабване')) {
          recommendedCalories = Math.round(tdee * 0.85);
        } else if (goalIncludes(data.goal, 'Мускулна маса')) {
          recommendedCalories = Math.round(tdee * 1.1);
        } else {
          recommendedCalories = tdee;
        }
      }
      
      // Regenerate summary with error prevention
      const summaryPrompt = await generateMealPlanSummaryPrompt(data, analysis, strategy, bmr, recommendedCalories, existingPlan.weekPlan, env);
      
      // Add error prevention comment to the prompt
      const summaryPromptWithErrors = errorPreventionComment + '\n\n' + summaryPrompt;
      
      const summaryInputTokens = estimateTokenCount(summaryPromptWithErrors);
      cumulativeTokens.input += summaryInputTokens;
      
      const summaryResponse = await callAIModel(env, summaryPromptWithErrors, SUMMARY_TOKEN_LIMIT, 'step4_summary_regen', sessionId, data, buildCompactAnalysisForStep4(analysis));
      const summaryOutputTokens = estimateTokenCount(summaryResponse);
      cumulativeTokens.output += summaryOutputTokens;
      cumulativeTokens.total = cumulativeTokens.input + cumulativeTokens.output;
      
      const summaryData = parseAIResponse(summaryResponse);
      
      if (!summaryData || summaryData.error) {
        console.warn('Step 4 regeneration failed, using fallback values from strategy');
        // Use strategy fallback values
        const calculatedMacros = calculateAverageMacrosFromPlan(existingPlan.weekPlan);
        
        // Validate calculated macros and log warnings
        if (!calculatedMacros.protein || !calculatedMacros.carbs || !calculatedMacros.fats) {
          console.warn('Step 4 regeneration: calculateAverageMacrosFromPlan returned incomplete data:', calculatedMacros);
          console.warn('Step 4 regeneration: Using generic fallback macros instead');
        }
        
        mealPlan = {
          weekPlan: existingPlan.weekPlan,
          summary: {
            bmr: bmr,
            dailyCalories: recommendedCalories,
            macros: {
              protein: calculatedMacros.protein || 150,
              carbs: calculatedMacros.carbs || 200,
              fats: calculatedMacros.fats || 65
            }
          },
          recommendations: strategy.foodsToInclude || ['Варено пилешко месо', 'Киноа', 'Авокадо'],
          forbidden: strategy.foodsToAvoid || ['Бързи храни', 'Газирани напитки', 'Сладкиши'],
          psychology: strategy.psychologicalSupport || ['Бъдете последователни'],
          waterIntake: strategy.hydrationStrategy || "2-2.5л дневно",
          supplements: strategy.supplementRecommendations || []
        };
      } else {
        // Use regenerated summary data
        mealPlan = {
          weekPlan: existingPlan.weekPlan,
          summary: summaryData.summary || {
            bmr: bmr,
            dailyCalories: recommendedCalories,
            macros: summaryData.macros || {}
          },
          recommendations: summaryData.recommendations || strategy.foodsToInclude || ['Варено пилешко месо', 'Киноа', 'Авокадо'],
          forbidden: summaryData.forbidden || strategy.foodsToAvoid || ['Бързи храни', 'Газирани напитки', 'Сладкиши'],
          psychology: summaryData.psychology || strategy.psychologicalSupport || ['Бъдете последователни'],
          waterIntake: summaryData.waterIntake || strategy.hydrationStrategy || "2-2.5л дневно",
          supplements: summaryData.supplements || strategy.supplementRecommendations || []
        };
      }
      
      console.log('Step 4 regeneration complete');
    } else {
      // Reuse existing meal plan parts
      mealPlan = {
        weekPlan: existingPlan.weekPlan,
        summary: existingPlan.summary,
        recommendations: existingPlan.recommendations,
        forbidden: existingPlan.forbidden,
        psychology: existingPlan.psychology,
        waterIntake: existingPlan.waterIntake,
        supplements: existingPlan.supplements
      };
      console.log('Reusing existing meal plan');
    }
    
    // Combine all parts into final plan
    const result = {
      ...mealPlan,
      analysis: analysis,
      strategy: strategy,
      _meta: {
        tokenUsage: cumulativeTokens,
        regeneratedFrom: earliestErrorStep,
        correctionAttempt: correctionAttempt,
        generatedAt: new Date().toISOString()
      }
    };
    
    // Update combined index once for this regeneration session
    await finalizeAISessionLogs(env, sessionId);
    
    return result;
  } catch (error) {
    console.error(`Regeneration from ${earliestErrorStep} failed:`, error);
    // Finalize session logs even on failure
    await finalizeAISessionLogs(env, sessionId).catch(() => {});
    throw new Error(`Регенерацията от ${earliestErrorStep} се провали: ${error.message}`);
  }
}

/**
 * Generate high-priority error prevention comment for a specific step
 */
function generateErrorPreventionComment(errors, stepName, attemptNumber) {
  if (!errors || errors.length === 0) {
    return null;
  }
  
  const stepNames = {
    'step1_analysis': 'АНАЛИЗ',
    'step2_strategy': 'СТРАТЕГИЯ',
    'step3_mealplan': 'ХРАНИТЕЛЕН ПЛАН',
    'step4_final': 'ФИНАЛНА ВАЛИДАЦИЯ'
  };
  
  const displayName = stepNames[stepName] || stepName;
  
  return `
═══ 🚨 КРИТИЧНО: ПРЕДОТВРАТЯВАНЕ НА ГРЕШКИ - ОПИТ ${attemptNumber} 🚨 ═══
⚠️ МАКСИМАЛЕН ПРИОРИТЕТ: При предишния опит бяха открити следните грешки в стъпка "${displayName}":

${errors.map((error, idx) => `${idx + 1}. ${error}`).join('\n')}

🔴 ЗАДЪЛЖИТЕЛНО: Избягвай горните грешки! Обърни специално внимание на:
- Всички задължителни полета трябва да присъстват
- Спазване на ADLE v8 правила (hard bans, whitelist, meal types, chronological order)
- Правилни изчисления на калории и макроси
- Детайлни обосновки (минимум 100 символа където е поискано)
- Точно 7 дни в седмичния план
- 1-5 хранения на ден според стратегията

НЕ ПОВТАРЯЙ тези грешки в този опит!
═══════════════════════════════════════════════════════════════
`;
}

async function generatePlanMultiStep(env, data, onAnalysisReady = null) {
  console.log('Multi-step generation: Starting (3+ AI requests for precision)');
  
  // Generate a unique session ID for this plan generation
  const sessionId = generateUniqueId('session');
  console.log(`Plan generation session ID: ${sessionId}`);
  
  // Token tracking for multi-step generation
  let cumulativeTokens = {
    input: 0,
    output: 0,
    total: 0
  };
  
  try {
    // Step 1: Analyze user profile (1st AI request)
    // Focus: Deep health analysis, metabolic profile, correlations
    const analysisPrompt = await generateAnalysisPrompt(data, env);
    const analysisInputTokens = estimateTokenCount(analysisPrompt);
    cumulativeTokens.input += analysisInputTokens;
    
    let analysisResponse, analysis;
    
    try {
      analysisResponse = await callAIModel(env, analysisPrompt, 4000, 'step1_analysis', sessionId, data, null);
      const analysisOutputTokens = estimateTokenCount(analysisResponse);
      cumulativeTokens.output += analysisOutputTokens;
      cumulativeTokens.total = cumulativeTokens.input + cumulativeTokens.output;
      
      console.log(`Step 1 tokens: input=${analysisInputTokens}, output=${analysisOutputTokens}, cumulative=${cumulativeTokens.total}`);
      
      analysis = parseAIResponse(analysisResponse);
      
      if (!analysis || analysis.error) {
        const errorMsg = analysis.error || 'Невалиден формат на отговор';
        console.error('Analysis parsing failed:', errorMsg);
        console.error('AI Response preview (first 1000 chars):', analysisResponse?.substring(0, 1000));
        throw new Error(`Анализът не можа да бъде създаден: ${errorMsg}`);
      }
      
      // REQUIREMENT 2: Filter out "Normal" severity problems from analysis
      if (analysis.keyProblems && Array.isArray(analysis.keyProblems)) {
        const originalCount = analysis.keyProblems.length;
        analysis.keyProblems = analysis.keyProblems.filter(problem => 
          problem.severity !== 'Normal'
        );
        const filteredCount = analysis.keyProblems.length;
        if (filteredCount < originalCount) {
          console.log(`Filtered out ${originalCount - filteredCount} Normal severity problems from analysis`);
        }
      }

      // Sync + safety guardrails (AI keeps diet-specific judgment; code clamps extremes only)
      const refActivity = calculateUnifiedActivityScore(data);
      const refBmr = calculateBMR(data);
      const refTdee = calculateTDEE(refBmr, refActivity.combinedScore);
      enforceCalorieGuardrails(analysis, data, refTdee);
    } catch (error) {
      console.error('Analysis step failed:', error);
      throw new Error(`Стъпка 1 (Анализ): ${error.message}`);
    }
    
    console.log('Multi-step generation: Analysis complete (1/3)');
    if (typeof onAnalysisReady === 'function') {
      try {
        await onAnalysisReady(analysis);
      } catch (progressError) {
        console.warn('Could not persist partial analysis status:', progressError);
      }
    }
    
    // Step 2: Generate dietary strategy based on analysis (2nd AI request)
    // Focus: Personalized approach, timing, principles, restrictions
    const strategyPrompt = await generateStrategyPrompt(data, analysis, env);
    const strategyInputTokens = estimateTokenCount(strategyPrompt);
    cumulativeTokens.input += strategyInputTokens;
    
    let strategyResponse, strategy;
    
    try {
      strategyResponse = await callAIModel(env, strategyPrompt, 4000, 'step2_strategy', sessionId, data, buildCompactAnalysis(analysis));
      const strategyOutputTokens = estimateTokenCount(strategyResponse);
      cumulativeTokens.output += strategyOutputTokens;
      cumulativeTokens.total = cumulativeTokens.input + cumulativeTokens.output;
      
      console.log(`Step 2 tokens: input=${strategyInputTokens}, output=${strategyOutputTokens}, cumulative=${cumulativeTokens.total}`);
      
      strategy = parseAIResponse(strategyResponse);
      enforceWeekendFreeDay(strategy);
      normalizeWeeklyScheme(strategy, parseFinalCalories(analysis.Final_Calories));
      
      if (!strategy || strategy.error) {
        const errorMsg = strategy.error || 'Невалиден формат на отговор';
        console.error('Strategy parsing failed:', errorMsg);
        console.error('AI Response preview (first 1000 chars):', strategyResponse?.substring(0, 1000));
        throw new Error(`Стратегията не можа да бъде създадена: ${errorMsg}`);
      }
    } catch (error) {
      console.error('Strategy step failed:', error);
      throw new Error(`Стъпка 2 (Стратегия): ${error.message}`);
    }
    
    console.log('Multi-step generation: Strategy complete (2/3)');
    
    // Step 3: Generate detailed meal plan using progressive generation
    let mealPlan;
    
    console.log('Multi-step generation: Using progressive meal plan generation');
    try {
      mealPlan = await generateMealPlanProgressive(env, data, analysis, strategy, null, sessionId);
    } catch (error) {
      console.error('Progressive meal plan generation failed:', error);
      throw new Error(`Стъпка 3 (Хранителен план - прогресивно): ${error.message}`);
    }
    
    console.log('Multi-step generation: Meal plan complete (3/3)');
    
    // Final token usage summary
    console.log(`=== CUMULATIVE TOKEN USAGE ===`);
    console.log(`Total Input Tokens: ${cumulativeTokens.input}`);
    console.log(`Total Output Tokens: ${cumulativeTokens.output}`);
    console.log(`Total Tokens: ${cumulativeTokens.total}`);
    
    // Warn if approaching limits (most models have 30k-100k context windows)
    if (cumulativeTokens.total > 25000) {
      console.warn(`⚠️ High token usage (${cumulativeTokens.total} tokens) - approaching model limits`);
    }
    
    // Combine all parts into final plan (meal plan takes precedence)
    // Returns comprehensive plan with analysis and strategy included
    const result = {
      ...mealPlan,
      analysis: analysis,
      strategy: strategy,
      _meta: {
        tokenUsage: cumulativeTokens,
        generatedAt: new Date().toISOString()
      }
    };
    syncPlanTargets(result, analysis);

    // Update combined index once for the whole session (2 subrequests total instead of 2×N)
    await finalizeAISessionLogs(env, sessionId);
    
    return result;
  } catch (error) {
    console.error('Multi-step generation failed:', error);
    // Finalize session logs even on failure so errors appear in admin logs
    await finalizeAISessionLogs(env, sessionId).catch(() => {});
    // Return error with details instead of falling back silently
    throw new Error(`Генерирането на план се провали: ${error.message}`);
  }
}

/**
 * Helper function to get custom prompt from KV storage
 */
async function getCustomPrompt(env, promptKey) {
  if (!env || !env.page_content) {
    return null;
  }
  
  // Check cache first
  const now = Date.now();
  if (customPromptsCache[promptKey] && 
      customPromptsCacheTime[promptKey] && 
      (now - customPromptsCacheTime[promptKey]) < CUSTOM_PROMPTS_CACHE_TTL) {
    console.log(`[Cache HIT] Custom prompt '${promptKey}' from cache`);
    return customPromptsCache[promptKey];
  }
  
  console.log(`[Cache MISS] Loading custom prompt '${promptKey}' from KV`);
  try {
    const prompt = await env.page_content.get(promptKey);
    
    // Cache the result (even if null, to avoid repeated KV reads for non-existent keys)
    customPromptsCache[promptKey] = prompt;
    customPromptsCacheTime[promptKey] = now;
    
    return prompt;
  } catch (error) {
    console.error(`Error fetching custom prompt ${promptKey}:`, error);
    return null;
  }
}

/** Prompts live in KV/prompts/ — uploaded via ./KV/upload-kv-keys.sh */
async function requireKvPrompt(env, promptKey) {
  const prompt = await getCustomPrompt(env, promptKey);
  if (!prompt || !String(prompt).trim()) {
    throw new Error(`Липсва промпт "${promptKey}" в KV. Качете от KV/prompts/: ./KV/upload-kv-keys.sh`);
  }
  return prompt;
}

/**
 * Check if a prompt already includes JSON format instructions
 * Used to avoid adding duplicate JSON format instructions to custom prompts
 * 
 * @param {string} prompt - The prompt text to check
 * @returns {boolean} - True if JSON instructions are detected, false otherwise
 */
function hasJsonFormatInstructions(prompt) {
  // Check for common JSON format instruction markers in Bulgarian
  // Note: Includes both generic markers and prompt-specific ones for comprehensive detection
  const jsonMarkers = [
    'JSON формат',           // "JSON format" - generic
    'ФОРМАТ НА ОТГОВОР',     // "RESPONSE FORMAT" - generic
    'Върни САМО JSON',       // "Return ONLY JSON" - generic
    'Върни JSON',            // "Return JSON" - generic
    'Върни ПЪЛНИЯ КОРИГИРАН план' // "Return FULL CORRECTED plan" - correction prompt specific
  ];
  
  return jsonMarkers.some(marker => prompt.includes(marker));
}

/**
 * Replace variables in prompt template
 * Supports simple {variableName} and nested dot-notation {obj.field.nested} syntax
 */
function replacePromptVariables(template, variables) {
  return template.replace(/\{([\w.]+)\}/g, (match, key) => {
    const keys = key.split('.');
    let value = variables;
    for (const k of keys) {
      if (value == null || typeof value !== 'object' || !(k in value)) return match;
      value = value[k];
    }
    if (value == null) return '';
    return formatPromptValue(value);
  });
}

/**
 * Step 1: Generate prompt for user profile analysis
 * Simplified - focuses on AI's strengths: correlations, psychology, individualization
 * Backend handles: BMR, TDEE, safety checks
 */
async function generateAnalysisPrompt(data, env, errorPreventionComment = null) {
  // Pre-calculate backend values for both custom and default prompts
  const activityData = calculateUnifiedActivityScore(data);
  const bmr = calculateBMR(data);
  const tdee = calculateTDEE(bmr, activityData.combinedScore);
  const deficitData = calculateSafeDeficit(tdee, data.goal);
  const macros = calculateMacronutrientRatios(data, activityData.combinedScore, tdee);
  const waterMin = (parseFloat(data.weight) * WATER_PER_KG_MULTIPLIER + BASE_WATER_NEED_LITERS).toFixed(2);
  const waterMax = (parseFloat(data.weight) * WATER_PER_KG_MULTIPLIER + BASE_WATER_NEED_LITERS + ACTIVITY_WATER_BONUS_LITERS).toFixed(2);

  const customPrompt = await requireKvPrompt(env, 'admin_analysis_prompt');
  const _combinedNotes = buildCombinedAdditionalNotes(data);
    const additionalNotesSection = _combinedNotes
      ? `═══ 🔥 ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ (КРИТИЧЕН ПРИОРИТЕТ) 🔥 ═══\n${_combinedNotes}\n═══════════════════════════════════════════════════════════════`
      : '';
    const _clinicalProtocol = getClinicalProtocol(data.clinicalProtocol);
    const clinicalProtocolSection = _clinicalProtocol ? buildClinicalProtocolPromptSection(_clinicalProtocol) : '';
    const backendCalcObj = {
      activityScore: activityData, bmr, tdee,
      safeDeficit_reference: deficitData, baselineMacros: macros
    };
    let prompt = replacePromptVariables(customPrompt, {
      userData: serializeUserProfile(data, 'full', {
        hasNotesSection: !!_combinedNotes,
        hasClinicalSection: !!clinicalProtocolSection,
      }),
      backendCalculations: serializeBackendCalculations(backendCalcObj),
      bmr,
      tdee,
      activityScore: activityData,
      safeDeficit: deficitData,
      baselineMacros: macros,
      combinedScore: activityData.combinedScore,
      activityLevel: activityData.activityLevel,
      waterMin,
      waterMax,
      // Individual client fields for instructions
      name: data.name,
      age: data.age,
      gender: data.gender,
      weight: data.weight,
      height: data.height,
      goal: data.goal,
      lossKg: data.lossKg || '',
      sleepHours: data.sleepHours,
      sleepInterrupt: data.sleepInterrupt,
      chronotype: data.chronotype,
      sportActivity: data.sportActivity,
      dailyActivityLevel: data.dailyActivityLevel,
      stressLevel: data.stressLevel,
      waterIntake: data.waterIntake || 'неизвестен',
      medicalConditions: JSON.stringify(data.medicalConditions || []),
      medicalConditions_other: data.medicalConditions_other || '',
      medicalConditions_allergy_details: data['medicalConditions_Алергии'] || '',
      medicalConditions_autoimmune_details: data['medicalConditions_Автоимунно'] || '',
      medicalConditions_cardiovascular_details: data['medicalConditions_Сърдечно-съдови_детайл'] || '',
      medicalConditions_endocrine_details: data['medicalConditions_Ендокринни_детайл'] || '',
      medicalConditions_digestive_details: data['medicalConditions_Храносмилателни_детайл'] || '',
      medicalConditions_metabolic_details: data['medicalConditions_Метаболитни_детайл'] || '',
      medicalConditions_musculoskeletal_details: data['medicalConditions_Мускулно-скелетни_детайл'] || '',
      medications: data.medications,
      medicationsDetails: data.medicationsDetails || '',
      medicationsText: data.medications === 'Да' ? (data.medicationsDetails || 'Да') : 'Не приема',
      eatingHabits: JSON.stringify(data.eatingHabits || []),
      foodCravings: JSON.stringify(data.foodCravings || []),
      foodCravings_other: data.foodCravings_other || '',
      foodTriggers: JSON.stringify(data.foodTriggers || []),
      foodTriggers_other: data.foodTriggers_other || '',
      compensationMethods: JSON.stringify(data.compensationMethods || []),
      compensationMethods_other: data.compensationMethods_other || '',
      socialComparison: data.socialComparison || '',
      dietHistory: data.dietHistory || '',
      dietPreference_other: data.dietPreference_other || '',
      goal_other: data.goal_other || '',
      additionalNotes: _combinedNotes,
      protocolSpecificAnswers: buildProtocolSpecificAnswersText(data),
      additionalNotesSection,
      TEMPERAMENT_CONFIDENCE_THRESHOLD,
      HEALTH_STATUS_UNDERESTIMATE_PERCENT,
      MIN_RECOMMENDED_CALORIES: data.gender === 'Мъж' ? MIN_RECOMMENDED_CALORIES_MALE : MIN_RECOMMENDED_CALORIES_FEMALE,
      MIN_FAT_GRAMS: Math.round((parseFloat(data.weight) || 70) * MIN_FAT_GRAMS_PER_KG),
      clinicalProtocolSection,
      clinicalProtocolName: _clinicalProtocol ? _clinicalProtocol.name : ''
    });
    
    // Inject error prevention comment if provided
    if (errorPreventionComment) {
      prompt = errorPreventionComment + '\n\n' + prompt;
    }
    
    // CRITICAL: Ensure JSON format instructions are included even with custom prompts
    // This prevents AI from responding with natural language instead of structured JSON
    if (!hasJsonFormatInstructions(prompt)) {
      prompt += `

═══ КРИТИЧНО ВАЖНО - ФОРМАТ НА ОТГОВОР ═══
Отговори САМО с валиден JSON обект БЕЗ допълнителни обяснения или текст преди или след JSON.

Структурата ТРЯБВА да включва:
{
  "bmi": число,
  "bmiCategory": "текст",
  "bmr": число,
  "tdee": число,
  "Final_Calories": число,
  "macroRatios": {
    "protein": число,
    "carbs": число,
    "fats": число
  },
  "macroGrams": {
    "protein": число,
    "carbs": число,
    "fats": число
  },
  "activityLevel": "текст",
  "physiologicalPhase": "текст",
  "waterDeficit": {
    "dailyNeed": "текст",
    "currentIntake": "текст",
    "deficit": "текст",
    "impactOnLipolysis": "текст"
  },
  "negativeHealthFactors": [{"factor": "текст", "severity": число, "description": "текст"}],
  "hinderingFactors": [{"factor": "текст", "severity": число, "description": "текст"}],
  "cumulativeRiskScore": "текст",
  "psychoProfile": {
    "temperament": "текст",
    "probability": число,
    "reasoning": "текст"
  },
  "metabolicReactivity": {
    "speed": "текст",
    "adaptability": "текст"
  },
  "correctedMetabolism": {
    "realBMR": число,
    "realTDEE": число,
    "clinicalAdjustmentPercent": число,
    "metabolicAdjustmentPercent": число,
    "goalAdjustmentPercent": число,
    "correction": "текст",
    "correctionPercent": "текст"
  },
  "metabolicProfile": "текст",
  "healthRisks": ["текст"],
  "nutritionalNeeds": ["текст"],
  "psychologicalProfile": "текст",
  "successChance": число,
  "currentHealthStatus": {
    "score": число,
    "description": "текст",
    "keyIssues": ["текст"]
  },
  "forecastPessimistic": {
    "timeframe": "текст",
    "weight": "текст",
    "health": "текст",
    "risks": ["текст", "текст", "текст", "текст", "текст"]
  },
  "forecastOptimistic": {
    "timeframe": "текст",
    "weight": "текст",
    "health": "текст",
    "improvements": ["текст", "текст", "текст", "текст", "текст"]
  },
  "keyProblems": [
    {
      "title": "текст",
      "description": "текст",
      "severity": "Borderline/Risky/Critical",
      "severityValue": число,
      "category": "текст",
      "impact": "текст"
    }
  ]
}

ВАЖНО: Върни САМО JSON без други текст или обяснения!`;
  }
  return prompt;
}

/**
 * Build compact analysis object with only the required fields for step 3 (meal plan chunks).
 * Only these fields from step 1 AI response are passed to step 3: bmr, Final_Calories, macroRatios, macroGrams.
 */
function buildCompactAnalysisForStep3(analysis) {
  return {
    bmr: analysis.bmr || null,
    Final_Calories: analysis.Final_Calories || analysis.recommendedCalories || null,
    macroRatios: analysis.macroRatios || null,
    macroGrams: analysis.macroGrams || null
  };
}

/**
 * Build compact analysis object with only the required fields for step 4 (summary).
 * Only these fields from step 1 AI response are passed to step 4: bmr, Final_Calories, psychoProfile, psychologicalProfile, keyProblems, nutritionalNeeds.
 */
function buildCompactAnalysisForStep4(analysis) {
  return {
    bmr: analysis.bmr || null,
    Final_Calories: analysis.Final_Calories || analysis.recommendedCalories || null,
    psychoProfile: analysis.psychoProfile || null,
    psychologicalProfile: analysis.psychologicalProfile || null,
    keyProblems: analysis.keyProblems || [],
    nutritionalNeeds: analysis.nutritionalNeeds || analysis.nutritionalDeficiencies || []
  };
}

/**
 * Build compact analysis object with only the required fields for step 2.
 * Only these fields from step 1 AI response are passed to step 2: bmi, realBMR, realTDEE, psychoProfile, temperament, macroGrams, macroRatios.
 */
function buildCompactAnalysis(analysis) {
  return {
    bmi: analysis.bmi || null,
    realBMR: analysis.correctedMetabolism?.realBMR || null,
    realTDEE: analysis.correctedMetabolism?.realTDEE || null,
    psychoProfile: analysis.psychoProfile || null,
    temperament: analysis.psychoProfile?.temperament || '',
    macroGrams: analysis.macroGrams || null,
    macroRatios: analysis.macroRatios || null,
    // add1: допълнителна специфична информация по преценка на администратора.
    // Пример как трябва да изглежда попълненото поле:
    // add1: 'Клиентът е преминал медицинска консултация на 20.02.2026 – препоръчан е нисък прием на натрий. Алергия към ядки потвърдена от лекар.'
    add1: ''
  };
}

async function generateStrategyPrompt(data, analysis, env, errorPreventionComment = null) {
  const customPrompt = await requireKvPrompt(env, 'admin_strategy_prompt');
  const analysisCompact = buildCompactAnalysis(analysis);
  const analysisBlock = serializeAnalysisForStep(analysis, 2);
  const userProfileBlock = serializeUserProfile(data, 'strategy');
  const _combinedNotes = buildCombinedAdditionalNotes(data);
    const additionalNotesSection = _combinedNotes
      ? `═══ ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ (КРИТИЧЕН ПРИОРИТЕТ) ═══\n${_combinedNotes}\n═══════════════════════════════════════════════════════════════`
      : '';
    // Replace variables in custom prompt
    let prompt = replacePromptVariables(customPrompt, {
      userData: data,
      userProfileBlock,
      analysisBlock,
      analysisData: analysisCompact,
      name: data.name,
      age: data.age,
      goal: data.goal,
      bmi: analysisCompact.bmi,
      realBMR: analysisCompact.realBMR,
      realTDEE: analysisCompact.realTDEE,
      macroProteinG: analysisCompact.macroGrams?.protein ?? null,
      macroCarbsG: analysisCompact.macroGrams?.carbs ?? null,
      macroFatsG: analysisCompact.macroGrams?.fats ?? null,
      macroProteinPct: analysisCompact.macroRatios?.protein ?? null,
      macroCarbsPct: analysisCompact.macroRatios?.carbs ?? null,
      macroFatsPct: analysisCompact.macroRatios?.fats ?? null,
      psychoProfile: analysisCompact.psychoProfile?.temperament
        ? `${analysisCompact.psychoProfile.temperament}@${analysisCompact.psychoProfile.probability || 0}%`
        : '',
      temperament: analysisCompact.temperament,
      temperamentProbability: analysisCompact.psychoProfile?.probability || 0,
      add1: analysisCompact.add1,
      dietPreference: JSON.stringify(data.dietPreference || []),
      dietPreference_other: data.dietPreference_other || '',
      dietDislike: data.dietDislike || '',
      dietLove: data.dietLove || '',
      goal_other: data.goal_other || '',
      medicalConditions: JSON.stringify(data.medicalConditions || []),
      medicalConditions_other: data.medicalConditions_other || '',
      medicalConditions_allergy_details: data['medicalConditions_Алергии'] || '',
      medicalConditions_autoimmune_details: data['medicalConditions_Автоимунно'] || '',
      medicalConditions_cardiovascular_details: data['medicalConditions_Сърдечно-съдови_детайл'] || '',
      medicalConditions_endocrine_details: data['medicalConditions_Ендокринни_детайл'] || '',
      medicalConditions_digestive_details: data['medicalConditions_Храносмилателни_детайл'] || '',
      medicalConditions_metabolic_details: data['medicalConditions_Метаболитни_детайл'] || '',
      medicalConditions_musculoskeletal_details: data['medicalConditions_Мускулно-скелетни_детайл'] || '',
      additionalNotes: _combinedNotes,
      protocolSpecificAnswers: buildProtocolSpecificAnswersText(data),
      additionalNotesSection,
      eatingHabits: JSON.stringify(data.eatingHabits || []),
      chronotype: data.chronotype || 'Среден тип',
      overeatingFrequency: data.overeatingFrequency || '',
      foodCravings: JSON.stringify(data.foodCravings || []),
      foodCravings_other: data.foodCravings_other || '',
      foodTriggers: JSON.stringify(data.foodTriggers || []),
      foodTriggers_other: data.foodTriggers_other || '',
      compensationMethods: JSON.stringify(data.compensationMethods || []),
      compensationMethods_other: data.compensationMethods_other || '',
      drinksSweet: data.drinksSweet || '',
      drinksAlcohol: data.drinksAlcohol || '',
      dietHistory: data.dietHistory || '',
      dietHistoryType: data.dietType || '',
      dietHistoryResult: data.dietResult || '',
      medications: data.medications || 'Не',
      medicationsDetails: data.medicationsDetails || '',
      medicationsText: data.medications === 'Да' ? (data.medicationsDetails || 'Да') : 'Не приема',
      weightChange: data.weightChange || '',
      weightChangeDetails: data.weightChangeDetails || '',
      medicalConditionsText: (data.medicalConditions || []).join(', ') || 'Няма',
      allGoals: Array.isArray(data.goal) ? data.goal.join(', ') : (data.goal || ''),
      stressLevel: data.stressLevel || '',
      sleepHours: data.sleepHours || '',
      TEMPERAMENT_CONFIDENCE_THRESHOLD,
      clinicalProtocolSection: (() => { const p = getClinicalProtocol(data.clinicalProtocol); return p ? buildClinicalProtocolPromptSection(p) : ''; })(),
      clinicalProtocolName: (() => { const p = getClinicalProtocol(data.clinicalProtocol); return p ? p.name : ''; })()
    });
    
    // Inject error prevention comment if provided
    if (errorPreventionComment) {
      prompt = errorPreventionComment + '\n\n' + prompt;
    }
    
    // CRITICAL: Ensure JSON format instructions are included even with custom prompts
    if (!hasJsonFormatInstructions(prompt)) {
      prompt += `

═══ КРИТИЧНО ВАЖНО - ФОРМАТ НА ОТГОВОР ═══
Отговори САМО с валиден JSON обект БЕЗ допълнителни обяснения или текст преди или след JSON.

Структурата ТРЯБВА да включва:
{
  "dietaryModifier": "текст",
  "modifierReasoning": "текст",
  "welcomeMessage": "текст",
  "planJustification": "текст",
  "longTermStrategy": "текст",
  "mealCountJustification": "текст",
  "afterDinnerMealJustification": "текст",
  "dietType": "текст",
  "weeklyMealPattern": "текст",
  "weeklyScheme": {
    "monday": {"meals": число, "calories": число, "protein": число, "carbs": число, "fats": число, "description": "текст", "mealBreakdown": [{"type": "тип", "calories": число, "protein": число, "carbs": число, "fats": число}]},
    "tuesday": {"meals": число, "calories": число, "protein": число, "carbs": число, "fats": число, "description": "текст", "mealBreakdown": [{"type": "тип", "calories": число, "protein": число, "carbs": число, "fats": число}]},
    "wednesday": {"meals": число, "calories": число, "protein": число, "carbs": число, "fats": число, "description": "текст", "mealBreakdown": [{"type": "тип", "calories": число, "protein": число, "carbs": число, "fats": число}]},
    "thursday": {"meals": число, "calories": число, "protein": число, "carbs": число, "fats": число, "description": "текст", "mealBreakdown": [{"type": "тип", "calories": число, "protein": число, "carbs": число, "fats": число}]},
    "friday": {"meals": число, "calories": число, "protein": число, "carbs": число, "fats": число, "description": "текст", "mealBreakdown": [{"type": "тип", "calories": число, "protein": число, "carbs": число, "fats": число}]},
    "saturday": {"meals": число, "calories": число, "protein": число, "carbs": число, "fats": число, "description": "текст", "mealBreakdown": [{"type": "тип", "calories": число, "protein": число, "carbs": число, "fats": число}]},
    "sunday": {"meals": число, "calories": число, "protein": число, "carbs": число, "fats": число, "description": "текст", "mealBreakdown": [{"type": "тип", "calories": число, "protein": число, "carbs": число, "fats": число}]}
  },
  "breakfastStrategy": "текст",
  "calorieDistribution": "текст",
  "macroDistribution": "текст",
  "mealTiming": {
    "pattern": "текст",
    "fastingWindows": "текст",
    "flexibility": "текст",
    "chronotypeGuidance": "текст"
  },
  "keyPrinciples": ["текст"],
  "preferredFoodCategories": ["хранителна категория (НЕ конкретна храна)"],
  "avoidFoodCategories": ["хранителна категория за избягване (НЕ конкретна храна)"],
  "hydrationStrategy": "текст",
  "communicationStyle": {
    "temperament": "текст",
    "tone": "текст",
    "approach": "текст",
    "chatGuidelines": "текст"
  }
}

ВАЖНО: Върни САМО JSON без други текст или обяснения!`;
  }
  return prompt;
}

/**
 * Calculate average macros from a week plan
 * Used as fallback when AI summary generation fails
 */
function calculateAverageMacrosFromPlan(weekPlan) {
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFats = 0;
  let dayCount = 0;
  
  try {
    Object.keys(weekPlan).forEach(dayKey => {
      const day = weekPlan[dayKey];
      if (day && day.meals && Array.isArray(day.meals)) {
        dayCount++;
        day.meals.forEach(meal => {
          if (meal.macros) {
            totalProtein += parseInt(meal.macros.protein) || 0;
            totalCarbs += parseInt(meal.macros.carbs) || 0;
            totalFats += parseInt(meal.macros.fats) || 0;
          }
        });
      }
    });
    
    if (dayCount > 0) {
      return {
        protein: Math.round(totalProtein / dayCount),
        carbs: Math.round(totalCarbs / dayCount),
        fats: Math.round(totalFats / dayCount)
      };
    }
  } catch (error) {
    console.error('Error calculating macros from plan:', error);
  }
  
  return { protein: null, carbs: null, fats: null };
}

/**
 * Progressive meal plan generation - generates meal plan in smaller chunks
 * Each chunk builds on previous days for variety and consistency
 * This approach reduces token usage per request and provides better error handling
 */
async function generateMealPlanProgressive(env, data, analysis, strategy, errorPreventionComment = null, sessionId = null) {
  const totalDays = 7;
  const chunks = Math.ceil(totalDays / DAYS_PER_CHUNK);
  const weekPlan = {};
  const previousDays = []; // Track previous days for variety
  
  // Cache dynamic food lists once (prevents 4 redundant calls per generation)
  const cachedFoodLists = await getDynamicFoodListsSections(env);
  
  // Parse BMR and calories - handle both numeric and string values
  let bmr;
  if (analysis.bmr) {
    // If bmr is already a number, use it directly
    if (typeof analysis.bmr === 'number') {
      bmr = Math.round(analysis.bmr);
    } else {
      // Otherwise, extract from string
      const bmrMatch = String(analysis.bmr).match(/\d+/);
      bmr = bmrMatch ? parseInt(bmrMatch[0]) : null;
    }
  }
  if (!bmr) {
    bmr = calculateBMR(data);
  }
  
  let recommendedCalories;
  const finalCaloriesSource = analysis.Final_Calories || analysis.recommendedCalories;
  if (finalCaloriesSource) {
    // If Final_Calories is already a number, use it directly
    if (typeof finalCaloriesSource === 'number') {
      recommendedCalories = Math.round(finalCaloriesSource);
    } else {
      // Otherwise, extract from string
      const caloriesMatch = String(finalCaloriesSource).match(/\d+/);
      recommendedCalories = caloriesMatch ? parseInt(caloriesMatch[0]) : null;
    }
  }
  if (!recommendedCalories) {
    const fallbackActivityData = calculateUnifiedActivityScore(data);
    const tdee = calculateTDEE(bmr, fallbackActivityData.combinedScore);
    if (goalIncludes(data.goal, 'Отслабване')) {
      recommendedCalories = Math.round(tdee * 0.85);
    } else if (goalIncludes(data.goal, 'Мускулна маса')) {
      recommendedCalories = Math.round(tdee * 1.1);
    } else {
      recommendedCalories = tdee;
    }
  }
  
  // Generate meal plan in chunks
  for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
    const startDay = chunkIndex * DAYS_PER_CHUNK + 1;
    const endDay = Math.min(startDay + DAYS_PER_CHUNK - 1, totalDays);
    const daysInChunk = endDay - startDay + 1;
    
    try {
      const chunkPrompt = await generateMealPlanChunkPrompt(
        data, analysis, strategy, bmr, recommendedCalories,
        startDay, endDay, previousDays, env, errorPreventionComment, cachedFoodLists
      );
      
      const chunkResponse = await callAIModel(env, chunkPrompt, MEAL_PLAN_TOKEN_LIMIT, `step3_meal_plan_chunk_${chunkIndex + 1}`, sessionId, data, buildCompactAnalysisForStep3(analysis));
      let chunkData = parseAIResponse(chunkResponse);
      
      if (!chunkData || chunkData.error) {
        const errorMsg = chunkData.error || 'Invalid response';
        throw new Error(`Chunk ${chunkIndex + 1} failed: ${errorMsg}`);
      }
      
      // If AI returns an array instead of {dayN:{...}}, remap by position.
      if (Array.isArray(chunkData)) {
        chunkData = Object.fromEntries(chunkData.map((item, i) => [`day${startDay + i}`, item]));
      }
      
      // Log the structure of chunkData for debugging
      console.log(`Chunk ${chunkIndex + 1} data keys:`, Object.keys(chunkData));
      
      // Merge chunk data into weekPlan
      for (let day = startDay; day <= endDay; day++) {
        const dayKey = `day${day}`;
        if (chunkData[dayKey]) {
          weekPlan[dayKey] = chunkData[dayKey];
          previousDays.push({
            day: day,
            meals: chunkData[dayKey].meals || []
          });
        } else {
          // Log what keys are actually present
          console.error(`Missing ${dayKey} in chunk ${chunkIndex + 1}. Available keys:`, Object.keys(chunkData));
          throw new Error(`Missing ${dayKey} in chunk ${chunkIndex + 1} response. Available keys: ${Object.keys(chunkData).join(', ')}`);
        }
      }
      // Replace any "dessert": true markers with the fixed dessert object
      injectFixedDesserts(weekPlan);
      alignWeekPlanDaysToScheme(weekPlan, strategy, startDay, endDay);
    } catch (error) {
      throw new Error(`Генериране на дни ${startDay}-${endDay}: ${error.message}`);
    }
  }

  alignWeekPlanDaysToScheme(weekPlan, strategy, 1, 7);
  
  // Generate summary, recommendations, etc. in final request
  try {
    const summaryPrompt = await generateMealPlanSummaryPrompt(data, analysis, strategy, bmr, recommendedCalories, weekPlan, env);
    const summaryResponse = await callAIModel(env, summaryPrompt, SUMMARY_TOKEN_LIMIT, 'step4_summary', sessionId, data, buildCompactAnalysisForStep4(analysis));
    const summaryData = parseAIResponse(summaryResponse);
    
    if (!summaryData || summaryData.error) {
      // Calculate actual macros from generated weekPlan instead of using generic text
      console.warn('Summary generation failed, calculating from weekPlan');
      const calculatedMacros = calculateAverageMacrosFromPlan(weekPlan);
      
      return {
        summary: {
          bmr: bmr,
          dailyCalories: recommendedCalories,
          macros: {
            protein: calculatedMacros.protein || 0,
            carbs: calculatedMacros.carbs || 0,
            fats: calculatedMacros.fats || 0
          }
        },
        weekPlan: weekPlan,
        recommendations: strategy.preferredFoodCategories || strategy.foodsToInclude || ['Варено пилешко месо', 'Киноа', 'Авокадо'],
        forbidden: strategy.avoidFoodCategories || strategy.foodsToAvoid || ['Бързи храни', 'Газирани напитки', 'Сладкиши'],
        psychology: strategy.psychologicalSupport || [],
        waterIntake: strategy.hydrationStrategy || "2-2.5л дневно",
        supplements: strategy.supplementRecommendations || []
      };
    }
    
    return {
      summary: summaryData.summary || {
        bmr: bmr,
        dailyCalories: recommendedCalories,
        macros: summaryData.macros || {}
      },
      weekPlan: weekPlan,
      recommendations: summaryData.recommendations || strategy.preferredFoodCategories || strategy.foodsToInclude || ['Варено пилешко месо', 'Киноа', 'Авокадо'],
      forbidden: summaryData.forbidden || strategy.avoidFoodCategories || strategy.foodsToAvoid || ['Бързи храни', 'Газирани напитки', 'Сладкиши'],
      psychology: summaryData.psychology || strategy.psychologicalSupport || [],
      waterIntake: summaryData.waterIntake || strategy.hydrationStrategy || "2-2.5л дневно",
      supplements: summaryData.supplements || strategy.supplementRecommendations || []
    };
  } catch (error) {
    console.error('Summary generation failed:', error);
    // Calculate actual macros from generated weekPlan instead of using generic text
    const calculatedMacros = calculateAverageMacrosFromPlan(weekPlan);
    
    return {
      summary: {
        bmr: bmr,
        dailyCalories: recommendedCalories,
        macros: { 
          protein: calculatedMacros.protein || 0,
          carbs: calculatedMacros.carbs || 0,
          fats: calculatedMacros.fats || 0
        }
      },
      weekPlan: weekPlan,
      recommendations: strategy.preferredFoodCategories || strategy.foodsToInclude || ['Варено пилешко месо', 'Киноа', 'Авокадо'],
      forbidden: strategy.avoidFoodCategories || strategy.foodsToAvoid || ['Бързи храни', 'Газирани напитки', 'Сладкиши'],
      psychology: strategy.psychologicalSupport || [],
      waterIntake: strategy.hydrationStrategy || "2-2.5л дневно",
      supplements: strategy.supplementRecommendations || []
    };
  }
}



/**
 * Parse a KV thinking-budget value into a numeric budget or undefined.
 * - null / "" → undefined  (no override; callGemini falls back to hardcoded logic)
 * - "0"       → 0          (disable thinking)
 * - "N"       → N          (limit thinking to N tokens)
 */
function parseThinkingBudget(raw) {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = parseInt(raw, 10);
  return isNaN(n) ? undefined : n;
}

/**
 * Get admin configuration with caching to reduce KV reads
 */
async function getAdminConfig(env) {
  // Return cached config if still valid
  const now = Date.now();
  if (adminConfigCache && (now - adminConfigCacheTime) < ADMIN_CONFIG_CACHE_TTL) {
    return adminConfigCache;
  }

  // Fetch fresh config from KV
  const config = {
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    visionProvider: null,
    visionModelName: null,
    // thinkingBudget: undefined = use hardcoded fallback, 0 = disable, N = limit
    thinkingBudget: undefined,
    visionThinkingBudget: undefined,
    stepTokenLimits: {},
    // Generation sampling parameters: undefined = use per-function defaults
    temperature: undefined,
    topP: undefined,
    topK: undefined,
    // Chat-specific model settings (fallback to plan settings when not set)
    chatProvider: null,
    chatModelName: null,
    chatThinkingBudget: undefined,
    chatTemperature: undefined,
    chatTopP: undefined,
    chatTopK: undefined
  };

  if (env.page_content) {
    // Use Promise.all to fetch all values in parallel
    const [
      savedProvider,
      savedModelName,
      savedVisionProvider,
      savedVisionModelName,
      savedThinkingBudget,
      savedVisionThinkingBudget,
      savedStepTokenLimits,
      savedTemperature,
      savedTopP,
      savedTopK,
      savedChatProvider,
      savedChatModelName,
      savedChatThinkingBudget,
      savedChatTemperature,
      savedChatTopP,
      savedChatTopK
    ] = await Promise.all([
      env.page_content.get('admin_ai_provider'),
      env.page_content.get('admin_ai_model_name'),
      env.page_content.get('admin_vision_provider'),
      env.page_content.get('admin_vision_model_name'),
      env.page_content.get('admin_ai_thinking_budget'),
      env.page_content.get('admin_vision_thinking_budget'),
      env.page_content.get('admin_step_token_limits'),
      env.page_content.get('admin_ai_temperature'),
      env.page_content.get('admin_ai_top_p'),
      env.page_content.get('admin_ai_top_k'),
      env.page_content.get('admin_chat_ai_provider'),
      env.page_content.get('admin_chat_ai_model_name'),
      env.page_content.get('admin_chat_ai_thinking_budget'),
      env.page_content.get('admin_chat_ai_temperature'),
      env.page_content.get('admin_chat_ai_top_p'),
      env.page_content.get('admin_chat_ai_top_k')
    ]);

    if (savedProvider) config.provider = savedProvider;
    if (savedModelName) config.modelName = savedModelName;
    if (savedVisionProvider) config.visionProvider = savedVisionProvider;
    if (savedVisionModelName) config.visionModelName = savedVisionModelName;
    config.thinkingBudget = parseThinkingBudget(savedThinkingBudget);
    config.visionThinkingBudget = parseThinkingBudget(savedVisionThinkingBudget);
    if (savedStepTokenLimits) {
      try { config.stepTokenLimits = JSON.parse(savedStepTokenLimits); } catch (_) {}
    }
    if (savedTemperature != null && savedTemperature !== '') {
      const t = parseFloat(savedTemperature);
      if (!isNaN(t)) config.temperature = t;
    }
    if (savedTopP != null && savedTopP !== '') {
      const p = parseFloat(savedTopP);
      if (!isNaN(p)) config.topP = p;
    }
    if (savedTopK != null && savedTopK !== '') {
      const k = parseInt(savedTopK, 10);
      if (!isNaN(k)) config.topK = k;
    }
    // Chat-specific settings
    if (savedChatProvider) config.chatProvider = savedChatProvider;
    if (savedChatModelName) config.chatModelName = savedChatModelName;
    config.chatThinkingBudget = parseThinkingBudget(savedChatThinkingBudget);
    if (savedChatTemperature != null && savedChatTemperature !== '') {
      const t = parseFloat(savedChatTemperature);
      if (!isNaN(t)) config.chatTemperature = t;
    }
    if (savedChatTopP != null && savedChatTopP !== '') {
      const p = parseFloat(savedChatTopP);
      if (!isNaN(p)) config.chatTopP = p;
    }
    if (savedChatTopK != null && savedChatTopK !== '') {
      const k = parseInt(savedChatTopK, 10);
      if (!isNaN(k)) config.chatTopK = k;
    }
  }

  // Update cache
  adminConfigCache = config;
  adminConfigCacheTime = now;

  return config;
}

/**
 * Get admin-configurable validation config from KV.
 * Falls back to DEFAULT_VALIDATION_CONFIG when not set.
 */
async function getValidationConfig(env) {
  const now = Date.now();
  if (validationConfigCache && (now - validationConfigCacheTime) < VALIDATION_CONFIG_CACHE_TTL) {
    return validationConfigCache;
  }

  let config = JSON.parse(JSON.stringify(DEFAULT_VALIDATION_CONFIG)); // deep clone

  if (env.page_content) {
    try {
      const raw = await env.page_content.get('admin_validation_config');
      if (raw) {
        const saved = JSON.parse(raw);
        // Deep-merge saved values over defaults so missing keys fall back gracefully
        if (saved.dataValidation) {
          config.dataValidation = Object.assign({}, config.dataValidation, saved.dataValidation);
        }
        if (saved.contradictionRules) {
          for (const key of Object.keys(saved.contradictionRules)) {
            config.contradictionRules[key] = Object.assign(
              {},
              config.contradictionRules[key] || {},
              saved.contradictionRules[key]
            );
          }
        }
      }
    } catch (e) {
      console.warn('getValidationConfig: could not parse KV value, using defaults:', e.message);
    }
  }

  validationConfigCache = config;
  validationConfigCacheTime = now;
  return config;
}

/**
 * Map a callAIModel stepName to a step key used in stepTokenLimits.
 * Returns null when no per-step override should apply.
 */
function getStepKey(stepName) {
  if (!stepName) return null;
  if (stepName.startsWith('step1')) return 'step1';
  if (stepName.startsWith('step2')) return 'step2';
  if (stepName.startsWith('step3') || stepName === 'fallback_plan') return 'step3';
  if (stepName.startsWith('step4') || stepName === 'fallback_summary') return 'step4';
  if (stepName.startsWith('chat')) return 'chat';
  return null;
}

/**
 * Get chat prompts configuration with caching to reduce KV reads
 */
async function getChatPrompts(env) {
  // Return cached prompts if still valid
  const now = Date.now();
  if (chatPromptsCache && (now - chatPromptsCacheTime) < CHAT_PROMPTS_CACHE_TTL) {
    return chatPromptsCache;
  }

  // Default prompts
  const prompts = {
    modificationEnabled: false,
    consultation: `ТЕКУЩ РЕЖИМ: КОНСУЛТАЦИЯ

ВАЖНИ ПРАВИЛА:
1. Можеш да четеш плана, но НЕ МОЖЕШ да го променяш.
2. Бъди КРАТЪК но информативен - максимум 3-4 изречения, прост език.
3. Ако клиентът иска промяна, кажи: "За промяна активирай режима за промяна на плана."
4. НИКОГА не използвай [REGENERATE_PLAN:...] инструкции.
5. Винаги поддържай мотивиращ тон.
6. Форматирай отговорите си ясно - използвай нови редове за разделяне на мисли.
7. Задавай максимум 1 въпрос на отговор.
8. Адаптирай стила на комуникация към клиента: {communicationStyle}

ПРИМЕРИ:
- "Закуската съдържа овесени ядки с банан (350 калории). За промяна, активирай режима за промяна."
- "Можеш да замениш рибата с пилешко - и двете са отлични източници на протеин. За промяна, активирай режима за промяна."`,
    modification: `ТЕКУЩ РЕЖИМ: ПРОМЯНА НА ПЛАНА

ВАЖНИ ПРАВИЛА:
1. Ти си професионален диетолог. Бъди КРАТЪК но информативен, ЯСЕН и директен.
2. Използвай ПРОСТ език, лесно разбираем.
3. Ограничи се до МАКСИМУМ 3-4 изречения в отговор.
4. Задавай МАКСИМУМ 1 въпрос на отговор.
5. Форматирай отговорите си ясно:
   - Използвай нови редове за разделяне на различни мисли
   - Когато изброяваш опции, сложи всяка на нов ред с тире (-)
   - Използвай празни редове за по-добра четимост между параграфи

2. Когато клиентът иска промяна:
   - Анализирай дали е здравословно за цел: {goal}
   - Обясни КРАТКО последиците (само основното)
   - Ако има по-добра алтернатива, предложи я с 1 изречение
   - Запитай с 1 въпрос за потвърждение
   - След потвърждение, приложи с [REGENERATE_PLAN:{"modifications":["описание"]}]

3. РАЗПОЗНАВАНЕ НА ПОТВЪРЖДЕНИЕ:
   - "да", "yes", "добре", "ок", "окей", "сигурен", "сигурна" = ПОТВЪРЖДЕНИЕ
   - Ако клиентът потвърди (каже "да"), НЕ питай отново! Приложи промяната ВЕДНАГА.
   - Ако вече си задавал същия въпрос в историята, НЕ го питай отново - приложи промяната!
   - НИКОГА не задавай един и същ въпрос повече от ВЕДНЪЖ.

4. НИКОГА не прилагай директно промяна без обсъждане! Винаги обясни и консултирай първо.

5. ЗА ПРЕМАХВАНЕ НА КОНКРЕТНИ ХРАНИ:
   - Ако клиентът иска да премахне конкретна храна (напр. "овесени ядки"), използвай специален модификатор:
   - Формат: "exclude_food:име_на_храната" (напр. "exclude_food:овесени ядки")
   - Пример: [REGENERATE_PLAN:{"modifications":["exclude_food:овесени ядки"]}]
   - Това ще регенерира плана БЕЗ тази храна

6. ПРИМЕР С ФОРМАТИРАНЕ:
   Клиент: "премахни междинните хранения"
   
   Отговор: "Разбирам. Премахването може да опрости храненето, но може и да доведе до преяждане.
   
   За твоята цел препоръчвам една от двете:
   - Премахване на всички междинни хранения (само 3 основни)
   - Оставяне на 1 здравословна закуска (по-балансирано)
   
   Какво предпочиташ?"
   
   [ЧАКАЙ потвърждение преди REGENERATE_PLAN]
   
   Клиент: "да" или "добре, премахни всички"
   
   Отговор: "✓ Разбрано! Регенерирам плана със 3 основни хранения.
   
   [REGENERATE_PLAN:{"modifications":["3_meals_per_day"]}]"
   
   ПРИМЕР ЗА ПРЕМАХВАНЕ НА ХРАНА:
   Клиент: "махни овесените ядки"
   
   Отговор: "Разбирам. Премахването на овесените ядки ще намали фибрите в закуската.
   
   Искаш ли да ги премахна от всички дни?"
   
   Клиент: "да"
   
   Отговор: "✓ Разбрано! Премахвам овесените ядки от плана.
   
   [REGENERATE_PLAN:{"modifications":["exclude_food:овесени ядки"]}]"

7. ПОДДЪРЖАНИ МОДИФИКАЦИИ:
   - "${PLAN_MODIFICATIONS.NO_INTERMEDIATE_MEALS}" - без междинни хранения
   - "${PLAN_MODIFICATIONS.THREE_MEALS_PER_DAY}" - 3 хранения дневно
   - "${PLAN_MODIFICATIONS.FOUR_MEALS_PER_DAY}" - 4 хранения дневно
   - "${PLAN_MODIFICATIONS.VEGETARIAN}" - вегетариански план
   - "${PLAN_MODIFICATIONS.NO_DAIRY}" - без млечни продукти
   - "${PLAN_MODIFICATIONS.LOW_CARB}" - нисковъглехидратна диета
   - "${PLAN_MODIFICATIONS.INCREASE_PROTEIN}" - повече протеини
   - "exclude_food:име_на_храна" - премахване на конкретна храна

ПОМНИ: 
- Форматирай ясно с нови редове и изброяване
- Максимум 3-4 изречения
- Максимум 1 въпрос
- АКО клиентът вече потвърди, НЕ питай отново - ПРИЛОЖИ ВЕДНАГА!
- Адаптирай стила на комуникация към клиента: {communicationStyle}`
  };

  if (env.page_content) {
    // Fetch custom prompts and mode setting from KV in parallel
    const [savedConsultation, savedModification, savedModificationModeEnabled] = await Promise.all([
      env.page_content.get('admin_consultation_prompt'),
      env.page_content.get('admin_modification_prompt'),
      env.page_content.get('admin_chat_modification_mode_enabled')
    ]);

    if (savedConsultation) prompts.consultation = savedConsultation;
    if (savedModification) prompts.modification = savedModification;
    prompts.modificationEnabled = savedModificationModeEnabled === 'true';
  }

  // Update cache
  chatPromptsCache = prompts;
  chatPromptsCacheTime = now;

  return prompts;
}


/**
 * Call OpenAI API with automatic retry logic for transient errors
 */
async function callOpenAI(env, prompt, modelName = 'gpt-4o-mini', maxTokens = null, jsonMode = false, temperature = undefined, topP = undefined) {
  try {
    return await retryWithBackoff(async () => {
      const requestBody = {
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: temperature !== undefined ? temperature : 0.7
      };
      
      // Apply top_p if specified
      if (topP !== undefined) {
        requestBody.top_p = topP;
      }
      
      // Add max_tokens only if specified
      if (maxTokens) {
        requestBody.max_tokens = maxTokens;
      }
      
      // Enforce JSON-only output at the API level to prevent markdown-wrapped responses
      if (jsonMode) {
        requestBody.response_format = { type: 'json_object' };
      }
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Check for errors in response
      if (data.error) {
        throw new Error(`OpenAI API грешка: ${data.error.message || JSON.stringify(data.error)}`);
      }
      
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('OpenAI API върна невалиден формат на отговор');
      }
      
      const choice = data.choices[0];
      
      // Check finish_reason for content filtering or other issues
      if (choice.finish_reason && choice.finish_reason !== 'stop') {
        const reason = choice.finish_reason;

        if (reason === 'length' && choice.message && choice.message.content) {
          // Token limit reached – return partial response so it is always captured in logs
          console.warn(`[OpenAI] Token limit reached (finish_reason: length). Logging partial response.`);
          return choice.message.content;
        }

        let errorMessage = `OpenAI API завърши с причина: ${reason}`;
        
        if (reason === 'content_filter') {
          errorMessage = 'OpenAI AI отказа да генерира отговор поради филтър за съдържание. Моля, опитайте с различни данни.';
        } else if (reason === 'length') {
          errorMessage = 'OpenAI AI достигна лимита на дължина. Опитайте да опростите въпроса.';
        }
        
        throw new Error(errorMessage);
      }
      
      return choice.message.content;
    });
  } catch (error) {
    console.error('OpenAI API call failed:', error);
    throw new Error(`OpenAI API failed: ${error.message}`);
  }
}

/**
 * Helper function to retry API calls with exponential backoff
 * Handles transient errors like 502, 503, 504, 429
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} initialDelay - Initial delay in milliseconds before first retry (default: 1000ms)
 * @returns {Promise<any>} Result from the function call
 * @throws {Error} The last error if all retries fail or if error is not retryable
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable (transient network errors)
      const errorMessage = error.message || '';
      const isRetryable = 
        errorMessage.includes('502') ||  // Bad Gateway
        errorMessage.includes('503') ||  // Service Unavailable
        errorMessage.includes('504') ||  // Gateway Timeout
        errorMessage.includes('429') ||  // Too Many Requests
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('network');
      
      // If not retryable or last attempt, throw error
      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = initialDelay * Math.pow(2, attempt);
      // Log retry without exposing sensitive data (API keys, tokens, auth credentials)
      const safeErrorMessage = errorMessage.replace(/(?:key|token|auth|bearer)[=:]\s*[^\s&]+/gi, (match) => {
        return match.split(/[=:]/)[0] + '=***';
      });
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms due to: ${safeErrorMessage}`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // This line is technically unreachable due to the logic above, but kept for type safety
  throw lastError;
}

/**
 * Call Anthropic Claude API with automatic retry logic for transient errors
 */
async function callClaude(env, prompt, modelName = 'claude-3-5-sonnet-20241022', maxTokens = null, jsonMode = false, temperature = undefined, topP = undefined, topK = undefined) {
  // Note: Claude's API does not expose a native JSON-mode parameter in this version.
  // JSON-only output is enforced via the text instruction added by enforceJSONOnlyPrompt.
  // The jsonMode parameter is accepted here for interface consistency with callOpenAI/callGemini.
  try {
    return await retryWithBackoff(async () => {
      const requestBody = {
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens || 8000
      };

      // Apply sampling parameters if specified
      if (temperature !== undefined) requestBody.temperature = temperature;
      if (topP !== undefined) requestBody.top_p = topP;
      if (topK !== undefined) requestBody.top_k = topK;
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Check for errors in response
      if (data.error) {
        throw new Error(`Claude API грешка: ${data.error.message || JSON.stringify(data.error)}`);
      }
      
      if (!data.content || !data.content[0] || !data.content[0].text) {
        throw new Error('Claude API върна невалиден формат на отговор');
      }
      
      // Check stop_reason for content filtering or other issues
      if (data.stop_reason && data.stop_reason !== 'end_turn') {
        const reason = data.stop_reason;

        if (reason === 'max_tokens' && data.content && data.content[0] && data.content[0].text) {
          // Token limit reached – return partial response so it is always captured in logs
          console.warn(`[Claude] Token limit reached (stop_reason: max_tokens). Logging partial response.`);
          return data.content[0].text;
        }

        let errorMessage = `Claude API завърши с причина: ${reason}`;
        throw new Error(errorMessage);
      }
      
      return data.content[0].text;
    });
  } catch (error) {
    console.error('Claude API call failed:', error);
    throw new Error(`Claude API failed: ${error.message}`);
  }
}

/**
 * Call Gemini API with automatic retry logic for transient errors
 */
async function callGemini(env, prompt, modelName = 'gemini-2.5-flash', maxTokens = null, jsonMode = false, thinkingBudget = undefined, temperature = undefined, topP = undefined, topK = undefined) {
  try {
    return await retryWithBackoff(async () => {
      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }]
      };
      
      // Build generationConfig: add maxOutputTokens and/or JSON mime type as needed
      const generationConfig = {};
      if (maxTokens) {
        generationConfig.maxOutputTokens = maxTokens;
      }
      // Apply sampling parameters if specified
      if (temperature !== undefined) generationConfig.temperature = temperature;
      if (topP !== undefined) generationConfig.topP = topP;
      if (topK !== undefined) generationConfig.topK = topK;
      // Thinking configuration for models that support it (e.g. Gemini 2.5 Flash/Pro).
      // thinkingBudget === undefined → use hardcoded default (disable for 2.5-flash to
      //   prevent spurious MAX_TOKENS errors from internal reasoning exhausting the budget).
      // thinkingBudget === 0         → disable thinking explicitly.
      // thinkingBudget > 0           → allow thinking up to that many tokens.
      if (thinkingBudget !== undefined) {
        generationConfig.thinkingConfig = { thinkingBudget };
      } else if (modelName.includes('gemini-2.5-flash')) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }
      // Enforce JSON-only output at the API level to prevent markdown-wrapped responses
      if (jsonMode) {
        generationConfig.responseMimeType = 'application/json';
      }
      if (Object.keys(generationConfig).length > 0) {
        requestBody.generationConfig = generationConfig;
      }
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Check for safety/content filtering or other finish reasons
      if (data.candidates && data.candidates[0]) {
        const candidate = data.candidates[0];
        
        // Check if response was blocked or filtered
        if (candidate.finishReason && candidate.finishReason !== 'STOP') {
          const reason = candidate.finishReason;

          if (reason === 'MAX_TOKENS' && candidate.content && candidate.content.parts && candidate.content.parts[0]) {
            // Token limit reached – return partial response so it is always captured in logs
            console.warn(`[Gemini] Token limit reached (finishReason: MAX_TOKENS). Logging partial response.`);
            return candidate.content.parts[0].text;
          }

          let errorMessage = `Gemini API отказ: ${reason}`;
          
          if (reason === 'SAFETY') {
            errorMessage = 'Gemini AI отказа да генерира отговор поради съображения за сигурност. Моля, опитайте с различни данни или контактирайте поддръжката.';
          } else if (reason === 'RECITATION') {
            errorMessage = 'Gemini AI отказа да генерира отговор поради потенциално копиране на съдържание.';
          } else if (reason === 'MAX_TOKENS') {
            errorMessage = 'Gemini AI достигна лимита на токени. Опитайте да опростите въпроса.';
          }
          
          throw new Error(errorMessage);
        }
        
        // Check if content exists
        if (!candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
          throw new Error('Gemini API върна празен отговор. Моля, опитайте отново.');
        }
        
        return candidate.content.parts[0].text;
      }
      
      throw new Error('Невалиден формат на отговор от Gemini API');
    });
  } catch (error) {
    console.error('Gemini API call failed:', error);
    throw new Error(`Gemini API failed: ${error.message}`);
  }
}

/**
 * Call AI model with vision (image) support for food analysis.
 * Sends an image along with a text prompt to the configured AI provider.
 * Supports OpenAI (gpt-4o, gpt-4o-mini), Claude (claude-3-5-sonnet), and Gemini (gemini-2.5-flash).
 * @param {Object} env - Environment variables (API keys)
 * @param {string} textPrompt - Text instructions for the AI
 * @param {string} base64Image - Base64-encoded image data (without data URI prefix)
 * @param {string} mimeType - Image MIME type (image/jpeg, image/png, image/webp)
 * @param {number} maxTokens - Max tokens for the response
 * @returns {Promise<string>} AI response text
 */
async function callAIModelWithVision(env, textPrompt, base64Image, mimeType, maxTokens = 2000) {
  const config = await getAdminConfig(env);

  // Use vision-specific provider/model if configured, otherwise fall back to main provider
  const preferredProvider = config.visionProvider || config.provider;

  // Map of default vision-capable models per provider
  const defaultVisionModels = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-20241022',
    google: 'gemini-2.5-flash'
  };

  // Use vision-specific model name if set, otherwise use the default for the provider
  const visionModelName = config.visionModelName || defaultVisionModels[preferredProvider] || defaultVisionModels.openai;

  const startTime = Date.now();
  let response;

  try {
    if (preferredProvider === 'openai' && env.OPENAI_API_KEY) {
      response = await callOpenAIVision(env, textPrompt, base64Image, mimeType, visionModelName, maxTokens);
    } else if (preferredProvider === 'anthropic' && env.ANTHROPIC_API_KEY) {
      response = await callClaudeVision(env, textPrompt, base64Image, mimeType, visionModelName, maxTokens);
    } else if (preferredProvider === 'google' && env.GEMINI_API_KEY) {
      response = await callGeminiVision(env, textPrompt, base64Image, mimeType, visionModelName, maxTokens, config.visionThinkingBudget);
    } else if (env.OPENAI_API_KEY) {
      response = await callOpenAIVision(env, textPrompt, base64Image, mimeType, defaultVisionModels.openai, maxTokens);
    } else if (env.ANTHROPIC_API_KEY) {
      response = await callClaudeVision(env, textPrompt, base64Image, mimeType, defaultVisionModels.anthropic, maxTokens);
    } else if (env.GEMINI_API_KEY) {
      response = await callGeminiVision(env, textPrompt, base64Image, mimeType, defaultVisionModels.google, maxTokens, config.visionThinkingBudget);
    } else {
      throw new Error('No AI provider configured for vision analysis.');
    }
  } catch (err) {
    console.error('Vision AI call failed:', err);
    throw err;
  }

  console.log(`Vision AI call completed in ${Date.now() - startTime}ms`);
  return response;
}

/**
 * OpenAI Vision API call (gpt-4o / gpt-4o-mini with image_url content)
 */
async function callOpenAIVision(env, textPrompt, base64Image, mimeType, modelName, maxTokens) {
  return await retryWithBackoff(async () => {
    const requestBody = {
      model: modelName,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: textPrompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'auto' } } // 'auto' lets the API choose between low/high detail based on image content for optimal cost/quality
        ]
      }],
      max_tokens: maxTokens,
      temperature: 0.3
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`OpenAI Vision API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(`OpenAI Vision error: ${data.error.message}`);
    if (!data.choices?.[0]?.message?.content) throw new Error('OpenAI Vision returned invalid response');
    return data.choices[0].message.content;
  });
}

/**
 * Claude Vision API call (claude-3-5-sonnet with inline image content)
 */
async function callClaudeVision(env, textPrompt, base64Image, mimeType, modelName, maxTokens) {
  return await retryWithBackoff(async () => {
    const requestBody = {
      model: modelName,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
          { type: 'text', text: textPrompt }
        ]
      }]
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Claude Vision API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(`Claude Vision error: ${data.error.message}`);
    if (!data.content?.[0]?.text) throw new Error('Claude Vision returned invalid response');
    return data.content[0].text;
  });
}

/**
 * Gemini Vision API call (gemini-2.5-flash with inlineData)
 */
async function callGeminiVision(env, textPrompt, base64Image, mimeType, modelName, maxTokens, thinkingBudget = undefined) {
  return await retryWithBackoff(async () => {
    const generationConfig = {
      maxOutputTokens: maxTokens,
      temperature: 0.3
    };
    // Thinking configuration (see callGemini for full explanation).
    if (thinkingBudget !== undefined) {
      generationConfig.thinkingConfig = { thinkingBudget };
    } else if (modelName && modelName.includes('gemini-2.5-flash')) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    const requestBody = {
      contents: [{
        parts: [
          { text: textPrompt },
          { inlineData: { mimeType: mimeType, data: base64Image } }
        ]
      }],
      generationConfig
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini Vision API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Gemini Vision returned invalid response');
    }
    return data.candidates[0].content.parts[0].text;
  });
}

/**
 * Handle food image analysis request.
 * Accepts a base64 image, sends it to AI with vision capabilities,
 * and returns nutritional analysis with diet suitability assessment.
 */
async function handleAnalyzeFoodImage(request, env) {
  try {
    const body = await request.json();
    const { imageData, mimeType, userData, dietPlan, mealContext } = body;

    // Validate required fields
    if (!imageData) {
      return jsonResponse({ error: 'Липсва изображение. Моля, направете снимка на храната.' }, 400);
    }

    // Validate mime type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const effectiveMimeType = allowedTypes.includes(mimeType) ? mimeType : 'image/jpeg';

    // Extract base64 data (remove data URI prefix if present)
    let base64Data = imageData;
    if (imageData.startsWith('data:')) {
      const commaIndex = imageData.indexOf(',');
      if (commaIndex !== -1) {
        base64Data = imageData.substring(commaIndex + 1);
      }
    }

    // Validate image size (max 20MB of base64 data — client compresses to ~300-500KB,
    // but we allow large payloads in case compression is less aggressive)
    const MAX_IMAGE_SIZE_BYTES = 20971520; // 20MB
    const estimatedSizeBytes = (base64Data.length * 3) / 4;
    if (estimatedSizeBytes > MAX_IMAGE_SIZE_BYTES) {
      return jsonResponse({ error: 'Изображението е твърде голямо. Моля, използвайте по-малко изображение.' }, 400);
    }

    // Build diet context for the prompt
    let dietContext = '';
    if (userData) {
      const parts = [];
      if (userData.goal) parts.push(`Цел: ${userData.goal}`);
      if (userData.weight) parts.push(`Тегло: ${userData.weight} кг`);
      if (userData.height) parts.push(`Ръст: ${userData.height} см`);
      if (userData.dietPreference) parts.push(`Диетичен предпочитание: ${userData.dietPreference}`);
      if (userData.medicalConditions) parts.push(`Здравословни проблеми: ${userData.medicalConditions}`);
      if (userData.dietDislike) parts.push(`Нежелани храни: ${userData.dietDislike}`);
      dietContext = parts.join('. ');
    }

    let planContext = '';
    if (dietPlan && dietPlan.summary) {
      planContext = typeof dietPlan.summary === 'string' ? dietPlan.summary : JSON.stringify(dietPlan.summary);
    }

    const mealTime = mealContext || 'неуточнено';

    // Try to load custom prompt from KV, fall back to hardcoded default
    const customPrompt = await getCustomPrompt(env, 'admin_food_analysis_prompt');
    
    let analysisPrompt;
    if (customPrompt && customPrompt.trim()) {
      // Replace template variables in custom prompt
      analysisPrompt = customPrompt
        .replace(/\{dietContext\}/g, dietContext || 'Не е предоставен')
        .replace(/\{planContext\}/g, planContext || 'Не е предоставен')
        .replace(/\{mealTime\}/g, mealTime);
    } else {
      // Default hardcoded prompt
      analysisPrompt = `Ти си експерт диетолог с компютърно зрение. Анализирай това изображение на храна и върни САМО валиден JSON обект (без markdown, без \`\`\`).

ЗАДАЧА: Анализирай храната на снимката и дай количествена и качествена оценка.

${dietContext ? `КОНТЕКСТ НА КЛИЕНТА: ${dietContext}` : ''}
${planContext ? `ТЕКУЩ ДИЕТИЧЕН ПЛАН (резюме): ${planContext}` : ''}
МОМЕНТ НА ХРАНЕНЕ: ${mealTime}

Върни ТОЧНО този JSON формат:
{
  "foods": [
    {
      "name": "Име на храната/продукта на български",
      "estimatedWeight": "приблизителен грамаж (напр. 150г)",
      "calories": число_калории,
      "protein": число_грамове_протеин,
      "carbs": число_грамове_въглехидрати,
      "fats": число_грамове_мазнини
    }
  ],
  "totalCalories": общо_калории_число,
  "totalProtein": общо_протеин_число,
  "totalCarbs": общо_въглехидрати_число,
  "totalFats": общо_мазнини_число,
  "totalWeight": "общ_приблизителен_грамаж",
  "dietSuitability": {
    "score": число_от_0_до_5,
    "verdict": "Подходяща" или "Частично подходяща" или "Неподходяща",
    "explanation": "Кратко обяснение защо е или не е подходяща за текущата диета и момент"
  },
  "suggestions": "Препоръки за подобряване на хранението (кратко, 1-2 изречения)",
  "confidence": "high" или "medium" или "low"
}

ВАЖНО:
- calories за ВСЯКА храна е ЗАДЪЛЖИТЕЛНО числово поле — изчисли го ВИНАГИ: протеини×4 + въглехидрати×4 + мазнини×9
- Оценявай грамажа визуално спрямо размера на чинията/контейнера
- Ако не можеш да разпознаеш храната, постави confidence: "low" и обясни
- Всички числа да са числа (не текст)
- Отговори САМО с JSON, без допълнителен текст`;
    }

    // Call AI with vision
    const aiResponse = await callAIModelWithVision(env, analysisPrompt, base64Data, effectiveMimeType, 1500);

    // Parse the JSON response
    let analysisResult;
    try {
      // Clean potential markdown wrapping
      let cleanResponse = aiResponse.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.slice(7);
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.slice(3);
      }
      if (cleanResponse.endsWith('```')) {
        cleanResponse = cleanResponse.slice(0, -3);
      }
      cleanResponse = cleanResponse.trim();

      analysisResult = JSON.parse(cleanResponse);
    } catch (parseError) {
      console.error('Failed to parse food analysis response:', parseError, 'Raw:', aiResponse.substring(0, 200));
      return jsonResponse({
        success: true,
        analysis: null,
        rawResponse: aiResponse,
        parseError: true,
        message: 'AI анализът е готов, но не успяхме да го структурираме. Вижте суровия отговор.'
      });
    }

    // b6 guarantee: every food item MUST have numeric calories.
    // If the AI left calories missing or zero, compute from macros (protein*4 + carbs*4 + fats*9).
    if (analysisResult && Array.isArray(analysisResult.foods)) {
      analysisResult.foods = analysisResult.foods.map(food => {
        if (!(food.calories > 0)) {
          const p = parseFloat(food.protein) || 0;
          const c = parseFloat(food.carbs)   || 0;
          const f = parseFloat(food.fats)    || 0;
          if (p > 0 || c > 0 || f > 0) {
            food.calories = Math.round(p * 4 + c * 4 + f * 9);
          }
        }
        return food;
      });
      // Recompute totalCalories if missing or zero
      if (!(analysisResult.totalCalories > 0)) {
        analysisResult.totalCalories = analysisResult.foods.reduce(
          (sum, food) => sum + (food.calories || 0), 0
        );
      }
    }

    return jsonResponse({
      success: true,
      analysis: analysisResult
    });

  } catch (error) {
    console.error('Food image analysis error:', error);
    return jsonResponse({
      error: `Грешка при анализ на храната: ${error.message}`,
      success: false
    }, 500);
  }
}

/**
 * Handle Restaurant Menu Image Analysis
 * Analyzes a photo of a restaurant menu and recommends the most suitable dish
 * for the client's current diet plan and meal context.
 * Returns a 0-5 suitability score, description, argumentation, and adaptation tip.
 */
async function handleAnalyzeMenuImage(request, env) {
  try {
    const body = await request.json();
    const { imageData, mimeType, userData, dietPlan, mealContext } = body;

    if (!imageData) {
      return jsonResponse({ error: 'Липсва изображение. Моля, направете снимка на менюто.' }, 400);
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const effectiveMimeType = allowedTypes.includes(mimeType) ? mimeType : 'image/jpeg';

    let base64Data = imageData;
    if (imageData.startsWith('data:')) {
      const commaIndex = imageData.indexOf(',');
      if (commaIndex !== -1) {
        base64Data = imageData.substring(commaIndex + 1);
      }
    }

    const MAX_IMAGE_SIZE_BYTES = 20971520; // 20MB
    const estimatedSizeBytes = (base64Data.length * 3) / 4;
    if (estimatedSizeBytes > MAX_IMAGE_SIZE_BYTES) {
      return jsonResponse({ error: 'Изображението е твърде голямо. Моля, използвайте по-малко изображение.' }, 400);
    }

    // Build diet context for the prompt
    let dietContext = '';
    if (userData) {
      const parts = [];
      if (userData.goal) parts.push(`Цел: ${userData.goal}`);
      if (userData.weight) parts.push(`Тегло: ${userData.weight} кг`);
      if (userData.height) parts.push(`Ръст: ${userData.height} см`);
      if (userData.gender) parts.push(`Пол: ${userData.gender}`);
      if (userData.dietPreference) parts.push(`Диетичен режим: ${userData.dietPreference}`);
      if (userData.medicalConditions) parts.push(`Здравословни проблеми: ${userData.medicalConditions}`);
      if (userData.dietDislike) parts.push(`Нежелани храни: ${userData.dietDislike}`);
      dietContext = parts.join('. ');
    }

    let planContext = '';
    if (dietPlan && dietPlan.summary) {
      planContext = typeof dietPlan.summary === 'string' ? dietPlan.summary : JSON.stringify(dietPlan.summary);
    }

    const mealTime = mealContext || 'неуточнено';

    // Try to load custom prompt from KV, fall back to hardcoded default
    const customMenuPrompt = await getCustomPrompt(env, 'admin_menu_analysis_prompt');

    let menuPrompt;
    if (customMenuPrompt && customMenuPrompt.trim()) {
      menuPrompt = customMenuPrompt
        .replace(/\{dietContext\}/g, dietContext || 'Не е предоставен')
        .replace(/\{planContext\}/g, planContext || 'Не е предоставен')
        .replace(/\{mealTime\}/g, mealTime);
    } else {
      menuPrompt = `Ти си експерт диетолог. На снимката има меню от ресторант. Прочети всички ястия и препоръчай НАЙ-ПОДХОДЯЩОТО за клиента. Върни САМО валиден JSON (без markdown, без backtick блокове).

${dietContext ? `ПРОФИЛ НА КЛИЕНТА: ${dietContext}` : ''}
${planContext ? `ДИЕТИЧЕН ПЛАН (резюме): ${planContext}` : ''}
МОМЕНТ НА ХРАНЕНЕ: ${mealTime}

ИНСТРУКЦИИ:
- Прочети внимателно менюто
- Избери НАЙ-ПОДХОДЯЩОТО ястие спрямо профила и целта на клиента
- Дай оценка за подходящост от 0 до 5 (5 = отлично, 0 = абсолютно неподходящо)
- Посочи и до 2 алтернативи ако има
- Дай конкретна адаптация за поръчката (напр. "Поискайте без сос", "Добавете само лимон")

Върни ТОЧНО този JSON:
{
  "recommendedDish": "Пълно название на препоръчаното ястие точно от менюто",
  "suitabilityScore": число от 0 до 5,
  "description": "Кратко описание на ястието (1-2 изречения)",
  "reasoning": "Защо е подходящо за целта и профила на клиента (2-3 изречения)",
  "adaptationTip": "Конкретна препоръка за адаптация при поръчката (напр. 'Поръчайте салатата без дресинг, добавете само лимон и зехтин')",
  "alternatives": [
    {
      "name": "Алтернативно ястие 1",
      "reason": "Защо е добра алтернатива"
    }
  ],
  "dishesRead": число_разчетени_ястия
}

ВАЖНО: Ако менюто не се чете ясно, постави suitabilityScore: 0 и обясни в reasoning. Отговори САМО с JSON.`;
    }

    const aiResponse = await callAIModelWithVision(env, menuPrompt, base64Data, effectiveMimeType, 1200);

    let menuResult;
    try {
      let cleanResponse = aiResponse.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.slice(7);
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.slice(3);
      }
      if (cleanResponse.endsWith('```')) {
        cleanResponse = cleanResponse.slice(0, -3);
      }
      cleanResponse = cleanResponse.trim();
      menuResult = JSON.parse(cleanResponse);
    } catch (parseError) {
      console.error('Failed to parse menu analysis response:', parseError, 'Raw:', aiResponse.substring(0, 200));
      return jsonResponse({
        success: true,
        analysis: null,
        rawResponse: aiResponse,
        parseError: true,
        message: 'AI анализът е готов, но не успяхме да го структурираме. Вижте суровия отговор.'
      });
    }

    return jsonResponse({
      success: true,
      analysis: menuResult
    });

  } catch (error) {
    console.error('Menu image analysis error:', error);
    return jsonResponse({
      error: `Грешка при анализ на менюто: ${error.message}`,
      success: false
    }, 500);
  }
}

/**
 * Handle Kids Food Image Analysis
 * Analyzes food images specifically for child safety and suitability.
 * Considers allergens, choking hazards, additives, sugar content,
 * age-appropriateness, and nutritional value for children.
 */
async function handleAnalyzeKidsFoodImage(request, env) {
  try {
    const body = await request.json();
    const { imageData, mimeType, ageGroup, healthConditions, userRole } = body;

    // Validate required fields
    if (!imageData) {
      return jsonResponse({ error: 'Липсва изображение. Моля, направете снимка на храната.' }, 400);
    }

    // Validate mime type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const effectiveMimeType = allowedTypes.includes(mimeType) ? mimeType : 'image/jpeg';

    // Extract base64 data (remove data URI prefix if present)
    let base64Data = imageData;
    if (imageData.startsWith('data:')) {
      const commaIndex = imageData.indexOf(',');
      if (commaIndex !== -1) {
        base64Data = imageData.substring(commaIndex + 1);
      }
    }

    // Validate image size (max 20MB)
    const MAX_IMAGE_SIZE_BYTES = 20971520;
    const estimatedSizeBytes = (base64Data.length * 3) / 4;
    if (estimatedSizeBytes > MAX_IMAGE_SIZE_BYTES) {
      return jsonResponse({ error: 'Изображението е твърде голямо. Моля, използвайте по-малко изображение.' }, 400);
    }

    const ageLabel = ageGroup || '3-7';

    // Age-specific context for the prompt
    const ageContextMap = {
      '0-1': 'бебе (0-1 години) — ИЗКЛЮЧИТЕЛНО СТРОГИ критерии. Само кърма/адаптирано мляко, пюрета без сол/захар, без мед, без цели ядки, без цели зърна грозде/чери домати (риск от задавяне). Без глутен до 6м. Без краве мляко като основна напитка.',
      '1-3': 'малко дете (1-3 години) — СТРОГИ критерии. Медът вече е допустим след 1г, но без цели ядки/бонбони/грозде (задавяне), минимум сол и захар, без преработени меса (нитрати), ограничена захар, внимание за алергени.',
      '3-7': 'предучилищна възраст (3-7 години) — Умерени критерии. Балансирана храна, ограничени добавки (Е-номера), минимум захар и сол, без кофеин, без енергийни напитки, внимание за размер на порциите.',
      '7-12': 'училищна възраст (7-12 години) — Балансирано хранене. Достатъчно калций за растеж, без кофеин и енергийни напитки, ограничена захар, внимание за прекалено преработени храни.',
      '12-16': 'тийнейджър (12-16 години) — Повишени нужди от протеин и калций. Без алкохол, ограничен кофеин, внимание за хранителни разстройства, достатъчно желязо.',
      '16-18': 'юноша (16-18 години) — Подобни на възрастни, но без алкохол, ограничен кофеин, повишени нужди от калций и желязо за растеж.'
    };

    const ageContext = ageContextMap[ageLabel] || ageContextMap['3-7'];

    // Build health conditions section for the prompt
    const isAge3Plus = ageLabel !== '0-1' && ageLabel !== '1-3';
    let healthSection = '';
    if (healthConditions && healthConditions.trim()) {
      healthSection = `\n\nЗДРАВОСЛОВНИ СЪСТОЯНИЯ НА ДЕТЕТО: ${healthConditions}
ВАЖНО: Вземи предвид тези здравословни състояния при анализа! Съобрази всички рискове и оценката с описаните здравословни проблеми.`;
    }

    // For ages 3+, don't ask for choking risk category
    const riskCategories = isAge3Plus
      ? 'Алергени, Захар, Добавки, Сол, Кофеин'
      : 'Задавяне, Алергени, Захар, Добавки, Сол, Кофеин';
    const safetyCriteria = isAge3Plus
      ? '\n1. БЕЗОПАСНОСТ: Алергени, токсични за деца съставки'
      : '\n1. БЕЗОПАСНОСТ: Риск от задавяне, алергени, токсични за деца съставки';

    const analysisPrompt = `Ти си водещ детски диетолог и педиатър-нутриционист. Анализирай това изображение на храна/напитка и определи дали е БЕЗОПАСНА и ПОДХОДЯЩА за ${ageContext}${healthSection}

ЗАДАЧА: Анализирай храната/напитката от снимката с фокус върху ДЕТСКО здраве и безопасност.

КРИТЕРИИ ЗА ОЦЕНКА (по приоритет):${safetyCriteria}
2. ДОБАВКИ: Изкуствени оцветители (E102, E110, E122, E124, E129, E133 и др.), консерванти, овкусители
3. ЗАХАР: Добавена захар, скрита захар, подсладители (изкуствени подсладители са опасни за деца)
4. СОЛ/НАТРИЙ: Твърде много сол за детски организъм
5. КОФЕИН: Абсолютно забранен за малки деца
6. МАЗНИНИ: Транс-мазнини, наситени мазнини, пържени храни
7. ПРЕРАБОТКА: Степен на преработка (ултрапреработени храни)
8. ХРАНИТЕЛНА СТОЙНОСТ: Калории, протеин, витамини, минерали подходящи за възрастта
9. ПОРЦИЯ: Подходящ ли е размерът за дете от тази възраст

Върни САМО валиден JSON обект (без markdown, без \`\`\`):
{
  "foodName": "Име на храната/напитката на български",
  "foodDescription": "Кратко описание какво виждаш на снимката",
  "safetyScore": число_от_0_до_5, като 0 е всяка храна, която с голяма вероятност би довела до медицинска намеса или представлява сериозна опасност за здравето
  "verdict": "Кратко обяснение на оценката — защо е или не е подходяща за дете на тази възраст (2-3 изречения)",
  "risks": [
    {
      "category": "Име на риска (напр. ${riskCategories})",
      "level": "high" или "medium" или "low" или "none",
      "detail": "Конкретно обяснение на риска за деца"
    }
  ],
  "nutrition": {
    "calories": число,
    "protein": число_грамове,
    "carbs": число_грамове,
    "fats": число_грамове,
    "sugar": число_грамове,
    "sodium": число_милиграма,
    "calcium": число_милиграма
  },
  "allergens": ["списък", "на", "потенциални", "алергени"],
  "ageNote": "Специфична бележка за тази възрастова група — какво трябва да знае родителят",
  "alternatives": ["По-здравословна алтернатива 1", "По-здравословна алтернатива 2"],
  "confidence": "high" или "medium" или "low"
}

ВАЖНО:
- Бъди СТРОГ при оценяването — здравето на децата е приоритет
- При съмнение, дай по-ниска оценка (по-безопасно е)
- Рисковете (risks) трябва да покриват: ${riskCategories} като минимум${isAge3Plus ? '\n- НЕ включвай категория "Задавяне" в рисковете — тя не е релевантна за тази възрастова група' : ''}${healthConditions && healthConditions.trim() ? '\n- ЗАДЪЛЖИТЕЛНО съобрази оценката и рисковете с описаните здравословни състояния на детето!' : ''}
- Ако храната е явно неподходяща (алкохол, кафе, енергийни напитки) — safetyScore трябва да е 0-1
- Всички числа да са числа (не текст)
- Отговори САМО с JSON, без допълнителен текст`;

    // Call AI with vision
    const aiResponse = await callAIModelWithVision(env, analysisPrompt, base64Data, effectiveMimeType, 2000);

    // Parse the JSON response
    let analysisResult;
    try {
      let cleanResponse = aiResponse.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.slice(7);
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.slice(3);
      }
      if (cleanResponse.endsWith('```')) {
        cleanResponse = cleanResponse.slice(0, -3);
      }
      cleanResponse = cleanResponse.trim();

      analysisResult = JSON.parse(cleanResponse);
    } catch (parseError) {
      console.error('Failed to parse kids food analysis response:', parseError, 'Raw:', aiResponse.substring(0, 200));
      return jsonResponse({
        success: true,
        analysis: null,
        rawResponse: aiResponse,
        parseError: true,
        message: 'AI анализът е готов, но не успяхме да го структурираме.'
      });
    }

    return jsonResponse({
      success: true,
      analysis: analysisResult
    });

  } catch (error) {
    console.error('Kids food image analysis error:', error);
    return jsonResponse({
      error: `Грешка при анализ на храната: ${error.message}`,
      success: false
    }, 500);
  }
}

/**
 * Generate mock response for development
 * Note: Mock mode should only be used for testing. In production, always use real AI models.
 */
function generateMockResponse(prompt) {
  if (prompt.includes('7-дневен хранителен план')) {
    // Note: Mock mode should not be used in production. 
    // For testing purposes only - uses clearly marked placeholder values.
    return JSON.stringify({
      summary: {
        bmr: "XXXX (MOCK VALUE - in production this would be individualized)",
        dailyCalories: "XXXX (MOCK VALUE - in production this would be personalized)",
        macros: {
          protein: "XXXg (MOCK)",
          carbs: "XXXg (MOCK)",
          fats: "XXXg (MOCK)"
        }
      },
      weekPlan: {
        day1: {
          meals: [
            {
              type: "Хранене 1",
              name: "Овесена каша с горски плодове",
              weight: "250g",
              description: "Богата на фибри. Бавните въглехидрати осигуряват енергия за целия ден.",
              benefits: "Подобрява храносмилането и контролира кръвната захар.",
              calories: 350
            },
            {
              type: "Хранене 2",
              name: "Пилешка пържола на скара със салата",
              weight: "350g",
              description: "Високо съдържание на протеин с минимални мазнини.",
              benefits: "Подпомага мускулното възстановяване.",
              calories: 450
            },
            {
              type: "Хранене 4",
              name: "Бяла риба със задушени зеленчуци",
              weight: "300g",
              description: "Лека вечеря, богата на Омега-3 мастни киселини.",
              benefits: "Лесна за усвояване преди сън.",
              calories: 380
            }
          ]
        },
        day2: {
          meals: [
            {
              type: "Хранене 1",
              name: "Гръцко кисело мляко с мюсли",
              weight: "200g",
              description: "Протеини и пробиотици за добро храносмилане.",
              benefits: "Подпомага чревното здраве.",
              calories: 320
            },
            {
              type: "Хранене 2",
              name: "Телешко със зеленчуци на тиган",
              weight: "350g",
              description: "Балансирано ястие с протеини и витамини.",
              benefits: "Осигурява енергия и минерали.",
              calories: 480
            },
            {
              type: "Хранене 4",
              name: "Пълнозърнести макарони с пилешко",
              weight: "300g",
              description: "Комплексни въглехидрати и постно месо.",
              benefits: "Продължително чувство за ситост.",
              calories: 420
            }
          ]
        },
        day3: {
          meals: [
            {
              type: "Хранене 1",
              name: "Яйца на очи с авокадо",
              weight: "200g",
              description: "Здравословни мазнини и протеини.",
              benefits: "Дълготрайна енергия и ситост.",
              calories: 340
            },
            {
              type: "Хранене 2",
              name: "Пилешка супа с киноа",
              weight: "400g",
              description: "Топла и питателна храна.",
              benefits: "Подпомага имунната система.",
              calories: 380
            },
            {
              type: "Хранене 4",
              name: "Сьомга на скара с брокули",
              weight: "320g",
              description: "Омега-3 и антиоксиданти.",
              benefits: "Противовъзпалително действие.",
              calories: 450
            }
          ]
        },
        day4: {
          meals: [
            {
              type: "Хранене 1",
              name: "Протеинов смути с банан",
              weight: "300ml",
              description: "Бърза и лесна закуска.",
              benefits: "Идеална за заети сутрини.",
              calories: 310
            },
            {
              type: "Хранене 2",
              name: "Пуешки кюфтета с ориз",
              weight: "350g",
              description: "Постно месо с комплексни въглехидрати.",
              benefits: "Балансирано ястие за активни хора.",
              calories: 470
            },
            {
              type: "Хранене 4",
              name: "Зеленчукова яхния",
              weight: "280g",
              description: "Лека и питателна вечеря.",
              benefits: "Подпомага храносмилането.",
              calories: 220
            }
          ]
        },
        day5: {
          meals: [
            {
              type: "Хранене 1",
              name: "Палачинки от овесени ядки",
              weight: "230g",
              description: "Здравословна алтернатива на класическите.",
              benefits: "Богати на фибри.",
              calories: 360
            },
            {
              type: "Хранене 2",
              name: "Говежди шишчета с печени зеленчуци",
              weight: "370g",
              description: "Протеини и витамини от зеленчуците.",
              benefits: "Подпомага мускулния растеж.",
              calories: 490
            },
            {
              type: "Хранене 4",
              name: "Печена треска с аспержи",
              weight: "310g",
              description: "Лека бяла риба с деликатесни зеленчуци.",
              benefits: "Лесно усвоима и богата на белтък.",
              calories: 370
            }
          ]
        },
        day6: {
          meals: [
            {
              type: "Хранене 1",
              name: "Тост с крема сирене и домати",
              weight: "220g",
              description: "Класическа и вкусна закуска.",
              benefits: "Баланс между протеини и въглехидрати.",
              calories: 330
            },
            {
              type: "Хранене 2",
              name: "Паста с песто и пилешко",
              weight: "360g",
              description: "Средиземноморски вкус с протеини.",
              benefits: "Енергия за следобедието.",
              calories: 510
            },
            {
              type: "Хранене 4",
              name: "Руло Стефани със салата",
              weight: "290g",
              description: "Традиционно българско ястие в здравословна версия.",
              benefits: "Балансирано и вкусно.",
              calories: 400
            }
          ]
        },
        day7: {
          meals: [
            {
              type: "Хранене 1",
              name: "Боул с гранола и плодове",
              weight: "260g",
              description: "Цветна и вкусна закуска.",
              benefits: "Антиоксиданти и витамини.",
              calories: 350
            },
            {
              type: "Хранене 2",
              name: "Пиле по китайски с ориз",
              weight: "380g",
              description: "Екзотичен вкус с балансирани макроси.",
              benefits: "Разнообразие в менюто.",
              calories: 500
            },
            {
              type: "Хранене 4",
              name: "Гръцка мусака с кисело мляко",
              weight: "320g",
              description: "Традиционно ястие в облекчена версия.",
              benefits: "Вкусна награда за края на седмицата.",
              calories: 430
            }
          ]
        }
      },
      recommendations: [
        "Вода (минимум 2.5л на ден)",
        "Зеленолистни зеленчуци",
        "Чисто месо (пилешко, говеждо)",
        "Риба и морски дарове",
        "Сурови ядки (в умерени количества)"
      ],
      forbidden: [
        "Газирани напитки със захар",
        "Пържени храни и фаст фуд",
        "Сладкиши и рафинирана захар",
        "Алкохол (особено концентрати)"
      ],
      psychology: "Не се обвинявайте: Ако 'съгрешите' с едно хранене, просто продължете по план следващия път. Едно хранене не разваля прогреса. Слушайте тялото си: Хранете се, когато сте гладни, а не когато сте емоционални или отегчени.",
      waterIntake: "Поне 2.5 литра вода дневно, разпределени през целия ден",
      supplements: "Витамин D3 (2000 IU), Омега-3 (1000mg), Магнезий (200mg)"
    });
  } else {
    // Mock chat response
    return "Благодаря за въпроса! Като ваш личен диетолог, бих искал да ви подкрепя в постигането на целите ви. Важно е да следвате плана, но също така да слушате тялото си. Имате ли конкретен въпрос за храненията или нуждаете ли се от допълнителна мотивация?";
  }
}

/**
 * Parse AI response to structured format
 * Handles markdown code blocks, greedy regex issues, and common JSON formatting errors
 */

/**
 * Log AI communication to Cache API (normal) and KV (errors only)
 * HYBRID APPROACH:
 * - All logs → Cache API (free, no quota impact, 24h TTL)
 * - Errors only → KV (permanent, for debugging, minimal quota impact)
 * Tracks all communication between backend and AI model
 *
 * SUBREQUEST OPTIMIZATION: This function performs ZERO cache operations.
 * It generates a logId, always tracks it in pendingSessionLogs under an
 * effective session ID (either the provided sessionId or an auto-generated
 * one for standalone calls like chat), and stores that effectiveSessionId
 * back in requestData._effectiveSessionId so callAIModel can finalize
 * auto-sessions immediately after the single call completes.
 * Named sessions (plan generation) are finalized by generatePlanMultiStep /
 * regenerateFromStep, keeping Cache API index updates at 1 per session.
 */
async function logAIRequest(env, stepName, requestData) {
  try {
    // Generate unique log ID
    const logId = generateUniqueId('ai_log');
    
    // Always use an effective session ID – auto-generate one for standalone
    // calls (chat, fallback plan) that don't belong to a named session.
    const effectiveSessionId = requestData.sessionId || generateUniqueId('auto_session');
    
    // Store it so callAIModel can finalize auto-sessions in the finally block.
    requestData._effectiveSessionId = effectiveSessionId;
    
    // Always track so every call is indexed in the combined session log.
    if (!pendingSessionLogs.has(effectiveSessionId)) {
      pendingSessionLogs.set(effectiveSessionId, []);
    }
    pendingSessionLogs.get(effectiveSessionId).push(logId);
    
    console.log(`[Cache API] AI request tracked: ${stepName} (${logId}, session: ${effectiveSessionId})`);
    return logId;
  } catch (error) {
    console.error('[Cache API] Failed to track AI request:', error);
    return null;
  }
}

/**
 * Write a single combined request+response log entry to the Cache API.
 * Accepts the requestData built in callAIModel so that both halves of the
 * conversation are persisted in one cache.put (1 subrequest) instead of two.
 */
async function logAIResponse(env, logId, stepName, responseData, requestData = null) {
  try {
    if (!logId) {
      console.warn('[Cache API] Missing logId, skipping AI response logging');
      return;
    }

    const timestamp = new Date().toISOString();
    
    // Combined entry merges request metadata with response data so the admin
    // panel can reconstruct the full conversation from a single cache entry.
    const logEntry = {
      id: logId,
      sessionId: requestData?.sessionId || null,
      timestamp: requestData?.timestamp || timestamp,
      stepName: stepName,
      type: 'combined',
      // Request fields
      prompt: requestData?.prompt || '',
      promptLength: requestData?.prompt?.length || 0,
      estimatedInputTokens: requestData?.estimatedInputTokens || 0,
      maxOutputTokens: requestData?.maxTokens || null,
      provider: requestData?.provider || 'unknown',
      modelName: requestData?.modelName || 'unknown',
      userData: requestData?.userData || null,
      calculatedData: requestData?.calculatedData || null,
      // Response fields
      responseTimestamp: timestamp,
      response: responseData.response || '',
      responseLength: responseData.response?.length || 0,
      estimatedOutputTokens: responseData.estimatedOutputTokens || 0,
      duration: responseData.duration || 0,
      success: responseData.success || false,
      error: responseData.error || null,
      hasError: !!responseData.error || !responseData.success
    };

    // Single cache.put for the combined entry (1 subrequest instead of 2)
    await cacheSet(`ai_communication_log:${logId}`, logEntry, AI_LOG_CACHE_TTL);
    await kvPutJSON(env, `ai_communication_log:${logId}`, logEntry, AI_LOG_KV_TTL);
    
    // HYBRID: If there's an error or failure, ALSO store in KV for permanent debugging
    if ((responseData.error || !responseData.success) && AI_ERROR_LOG_KV_ENABLED && env && env.page_content) {
      try {
        await env.page_content.put(`ai_error_log:${logId}`, JSON.stringify(logEntry));
        console.log(`[KV] Error logged to KV for permanent storage: ${stepName} (${logId})`);
      } catch (kvError) {
        console.error('[KV] Failed to log error to KV:', kvError);
        // Continue - error is still in Cache API
      }
    }
    
    console.log(`[Cache API] AI response logged: ${stepName} (${logId})`);
  } catch (error) {
    console.error('[Cache API] Failed to log AI response:', error);
  }
}

/**
 * Flush the combined index for a plan-generation session to the Cache API.
 * Called ONCE at the end of generatePlanMultiStep() and regenerateFromStep()
 * instead of once per AI call, reducing the index read+write from 2×N
 * subrequests to just 2 subrequests for the whole session.
 */
async function finalizeAISessionLogs(env, sessionId) {
  if (!sessionId || !pendingSessionLogs.has(sessionId)) return;
  
  const logIds = pendingSessionLogs.get(sessionId);
  pendingSessionLogs.delete(sessionId);
  
  if (!logIds || logIds.length === 0) return;
  
  try {
    let combinedIndex = await kvGetJSON(env, AI_LOG_COMBINED_INDEX_KEY) || await cacheGet(AI_LOG_COMBINED_INDEX_KEY) || { sessions: [], logs: {} };

    // Add sessionId to the ordered list if not already present (most recent first)
    if (!combinedIndex.sessions.includes(sessionId)) {
      combinedIndex.sessions.unshift(sessionId);
      // Keep only the last MAX_LOG_ENTRIES sessions
      if (combinedIndex.sessions.length > MAX_LOG_ENTRIES) {
        const removed = combinedIndex.sessions.splice(MAX_LOG_ENTRIES);
        for (const evictedId of removed) {
          delete combinedIndex.logs[evictedId];
        }
      }
    }

    // Merge with any existing log IDs for this session (guards against duplicate
    // calls for the same sessionId, even though pendingSessionLogs.delete above
    // makes the second invocation a no-op in normal usage).
    combinedIndex.logs[sessionId] = [
      ...(combinedIndex.logs[sessionId] || []),
      ...logIds
    ];
    await cacheSet(AI_LOG_COMBINED_INDEX_KEY, combinedIndex, AI_LOG_CACHE_TTL);
    await kvPutJSON(env, AI_LOG_COMBINED_INDEX_KEY, combinedIndex, AI_LOG_KV_TTL);
    
    console.log(`[Cache API] Session ${sessionId} index finalized with ${logIds.length} log entries`);
  } catch (error) {
    console.error('[Cache API] Failed to finalize session logs:', error);
  }
}

/**
 * Generate user ID from data
 */

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Log Persistence
// Saves AI communication logs, model settings and the assembled plan to the
// repository under ai-logs/latest/ after every successful plan generation.
// Requires GITHUB_TOKEN Cloudflare secret (a PAT with repo write access).
// Optional: GITHUB_REPO (default: Radilovk/aidiet), GITHUB_BRANCH (default: main).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base64-encode a UTF-8 string (handles Cyrillic / multibyte characters).
 */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Commit multiple files to a GitHub repository in one atomic commit.
 * Uses the Git Data API: create blobs → create tree → create commit → update ref.
 * @param {string} token   - GitHub PAT with repo write access
 * @param {string} repo    - e.g. "Radilovk/aidiet"
 * @param {string} branch  - branch name, e.g. "main"
 * @param {Object} files   - { 'path/to/file': 'content string', ... }
 * @param {string} message - Commit message
 */
async function commitFilesToGitHub(token, repo, branch, files, message) {
  const baseUrl = `https://api.github.com/repos/${repo}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'aidiet-worker'
  };

  // 1. Get latest commit SHA for the branch
  const refRes = await fetch(`${baseUrl}/git/ref/heads/${branch}`, { headers });
  if (!refRes.ok) throw new Error(`GitHub: cannot get ref for ${branch} – ${refRes.status}`);
  const refData = await refRes.json();
  const latestCommitSha = refData.object.sha;

  // 2. Get base tree SHA from that commit
  const commitRes = await fetch(`${baseUrl}/git/commits/${latestCommitSha}`, { headers });
  if (!commitRes.ok) throw new Error(`GitHub: cannot get commit ${latestCommitSha} – ${commitRes.status}`);
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;

  // 3. Create a blob for each file (parallel)
  const blobPromises = Object.entries(files).map(async ([path, content]) => {
    const blobRes = await fetch(`${baseUrl}/git/blobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: utf8ToBase64(content), encoding: 'base64' })
    });
    if (!blobRes.ok) throw new Error(`GitHub: cannot create blob for ${path} – ${blobRes.status}`);
    const blobData = await blobRes.json();
    return { path, mode: '100644', type: 'blob', sha: blobData.sha };
  });
  const treeItems = await Promise.all(blobPromises);

  // 4. Create a new tree on top of the base tree
  const treeRes = await fetch(`${baseUrl}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems })
  });
  if (!treeRes.ok) throw new Error(`GitHub: cannot create tree – ${treeRes.status}`);
  const treeData = await treeRes.json();

  // 5. Create commit
  const newCommitRes = await fetch(`${baseUrl}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, tree: treeData.sha, parents: [latestCommitSha] })
  });
  if (!newCommitRes.ok) throw new Error(`GitHub: cannot create commit – ${newCommitRes.status}`);
  const newCommitData = await newCommitRes.json();

  // 6. Fast-forward the branch ref.
  // force: false means the update fails if another commit landed between step 1 and now
  // (race condition). For this app's usage pattern (single user, infrequent commits)
  // this is acceptable – saveLogsToGitHub already catches and logs the error gracefully.
  const updateRefRes = await fetch(`${baseUrl}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: newCommitData.sha, force: false })
  });
  if (!updateRefRes.ok) {
    const body = await updateRefRes.text();
    throw new Error(`GitHub: cannot update ref – ${updateRefRes.status}: ${body}`);
  }
}

/**
 * Save AI communication logs, model settings and assembled plan to the repo.
 * Called as a background task (ctx.waitUntil) after successful plan generation.
 * Personal identifiers (name, email, phone) are stripped from the user profile.
 *
 * Files written to ai-logs/latest/:
 *   communication_log.txt  – full prompt/response for every AI step
 *   ai_settings.json       – model, provider and sampling parameters
 *   final_plan.json        – the assembled diet plan
 *
 * @param {object} env            - Cloudflare env bindings
 * @param {object} structuredPlan - Final plan returned by generatePlanMultiStep
 */
async function saveLogsToGitHub(env, structuredPlan) {
  try {
    // Use GITHUB_TOKEN if set; fall back to GITHUB_TOKEN1 as a reserve.
    const token = env.GITHUB_TOKEN || env.GITHUB_TOKEN1;
    if (!token) {
      console.log('[GitHub Save] Neither GITHUB_TOKEN nor GITHUB_TOKEN1 is set – skipping log save to repo');
      return;
    }

    const repo   = env.GITHUB_REPO   || 'Radilovk/aidiet';
    const branch = env.GITHUB_BRANCH || 'main';

    // ── AI model settings ──────────────────────────────────────────────────
    const config = await getAdminConfig(env);
    // Timestamp marks when log collection started (not when the commit lands).
    const timestamp = new Date().toISOString();

    const settingsJson = JSON.stringify({
      savedAt: timestamp,
      plan: {
        provider:      config.provider,
        modelName:     config.modelName,
        temperature:   config.temperature  ?? null,
        topP:          config.topP         ?? null,
        topK:          config.topK         ?? null,
        thinkingBudget: config.thinkingBudget ?? null,
        stepTokenLimits: config.stepTokenLimits
      },
      chat: {
        provider:      config.chatProvider,
        modelName:     config.chatModelName,
        temperature:   config.chatTemperature  ?? null,
        topP:          config.chatTopP         ?? null,
        topK:          config.chatTopK         ?? null,
        thinkingBudget: config.chatThinkingBudget ?? null
      },
      vision: {
        provider:      config.visionProvider,
        modelName:     config.visionModelName,
        thinkingBudget: config.visionThinkingBudget ?? null
      }
    }, null, 2);

    // ── Communication log ──────────────────────────────────────────────────
    // MAX_LOG_ENTRIES = 1, so sessions[0] is always the most recent (and only) session.
    const combinedIndex = await cacheGet('ai_log_combined_index');
    const sessionId     = combinedIndex?.sessions?.[0];
    const logIds        = (combinedIndex?.logs?.[sessionId]) || [];

    let logText = '='.repeat(80) + '\n';
    logText += 'AI КОМУНИКАЦИОННИ ЛОГОВЕ – ПОСЛЕДНО ГЕНЕРИРАНЕ НА ПЛАН\n';
    logText += '='.repeat(80) + '\n\n';
    logText += `Дата на запис:      ${timestamp}\n`;
    logText += `Сесия:              ${sessionId || 'N/A'}\n`;
    logText += `Провайдър/Модел:    ${config.provider} / ${config.modelName}\n`;
    logText += `Стъпки в лога:      ${logIds.length}\n\n`;

    if (logIds.length > 0) {
      // Use allSettled so a missing cache entry doesn't abort the whole log
      const settled = await Promise.allSettled(
        logIds.flatMap(id => [
          cacheGet(`ai_communication_log:${id}`),
          cacheGet(`ai_communication_log:${id}_response`)
        ])
      );
      const rawLogs = settled.map(r => (r.status === 'fulfilled' ? r.value : null));

      for (let i = 0; i < logIds.length; i++) {
        const req = rawLogs[i * 2];
        const legacyRes = rawLogs[i * 2 + 1];
        const res = req?.type === 'combined' ? {
          timestamp:              req.responseTimestamp || req.timestamp,
          success:                req.success,
          duration:               req.duration,
          responseLength:         req.responseLength,
          estimatedOutputTokens:  req.estimatedOutputTokens,
          error:                  req.error,
          response:               req.response
        } : legacyRes;

        if (!req) continue;

        logText += '─'.repeat(80) + '\n';
        logText += `СТЪПКА ${i + 1}: ${req.stepName || 'unknown'}\n`;
        logText += '─'.repeat(80) + '\n\n';

        logText += '[ ПАРАМЕТРИ ]\n';
        logText += `Времева марка:             ${req.timestamp}\n`;
        logText += `Провайдър:                 ${req.provider || 'N/A'}\n`;
        logText += `Модел:                     ${req.modelName || 'N/A'}\n`;
        logText += `Дължина на промпт:         ${req.promptLength || 0} символа\n`;
        logText += `Прибл. входни токени:      ${req.estimatedInputTokens || 0}\n`;
        logText += `Макс. изходни токени:      ${req.maxOutputTokens || 'N/A'}\n`;

        if (req.userData) {
          const safe = { ...req.userData };
          delete safe.name;
          delete safe.email;
          delete safe.phone;
          logText += '\n[ ВХОДНИ ДАННИ (потребителски профил) ]\n';
          logText += JSON.stringify(safe, null, 2) + '\n';
        }

        if (req.calculatedData) {
          logText += '\n[ БЕКЕНД КАЛКУЛАЦИИ ]\n';
          logText += JSON.stringify(req.calculatedData, null, 2) + '\n';
        }

        logText += '\n[ ПРОМПТ ]\n';
        logText += (req.prompt || '(не е запазен)') + '\n';

        if (res) {
          logText += '\n[ ОТГОВОР НА AI ]\n';
          logText += `Времева марка:             ${res.timestamp || 'N/A'}\n`;
          logText += `Успех:                     ${res.success ? 'Да' : 'Не'}\n`;
          logText += `Времетраене:               ${res.duration || 0} ms\n`;
          logText += `Дължина на отговора:       ${res.responseLength || 0} символа\n`;
          logText += `Прибл. изходни токени:     ${res.estimatedOutputTokens || 0}\n`;
          if (res.error) logText += `Грешка:                    ${res.error}\n`;
          logText += '\n' + (res.response || '(не е запазен)') + '\n\n';
        } else {
          logText += '\n[ ОТГОВОР НА AI ]\n(не е получен)\n\n';
        }
      }
    } else {
      logText += '(Няма записани логове за тази сесия)\n\n';
    }

    logText += '='.repeat(80) + '\n';
    logText += 'КРАЙ\n';
    logText += '='.repeat(80) + '\n';

    // ── Assembled plan ─────────────────────────────────────────────────────
    const planJson = JSON.stringify(structuredPlan, null, 2);

    // ── Commit ─────────────────────────────────────────────────────────────
    await commitFilesToGitHub(token, repo, branch, {
      'ai-logs/latest/communication_log.txt': logText,
      'ai-logs/latest/ai_settings.json':      settingsJson,
      'ai-logs/latest/final_plan.json':       planJson
    }, `ai-logs: ${timestamp.substring(0, 19).replace('T', ' ')} UTC`);

    console.log('[GitHub Save] Logs committed to repo successfully');
  } catch (err) {
    console.error('[GitHub Save] Failed to save logs to GitHub:', err.message);
  }
}

/**
 * Helper function to get KV key for prompt type
 */
function getPromptKVKey(type) {
  const keyMap = {
    'consultation': 'admin_consultation_prompt',
    'modification': 'admin_modification_prompt',
    'correction': 'admin_correction_prompt',
    'chat': 'admin_chat_prompt',
    'analysis': 'admin_analysis_prompt',
    'strategy': 'admin_strategy_prompt',
    'meal_plan': 'admin_meal_plan_prompt',
    'summary': 'admin_summary_prompt',
    'plan': 'admin_plan_prompt',
    'emoeat': 'admin_emoeat_prompt',
    'food_analysis': 'admin_food_analysis_prompt',
    'menu_analysis': 'admin_menu_analysis_prompt',
    'validation': 'admin_validation_prompt'
  };
  
  return keyMap[type] || 'admin_plan_prompt';
}

/**
 * Admin: Save AI prompt to KV
 */
async function handleSavePrompt(request, env) {
  try {
    const { type, prompt } = await request.json();
    
    // Type is required, but prompt can be empty (to revert to default)
    if (!type) {
      return jsonResponse({ error: 'Missing type' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const key = getPromptKVKey(type);
    
    // Save the prompt, even if empty (empty = use default)
    await env.page_content.put(key, prompt || '');
    
    // Invalidate chat prompts cache if consultation or modification prompt was updated
    if (type === 'consultation' || type === 'modification') {
      chatPromptsCache = null;
      chatPromptsCacheTime = 0;
    }
    
    // Invalidate custom prompts cache for this specific prompt key
    invalidateCustomPromptsCache(key);
    
    return jsonResponse({ success: true, message: 'Prompt saved successfully' });
  } catch (error) {
    console.error('Error saving prompt:', error);
    return jsonResponse({ error: 'Failed to save prompt: ' + error.message }, 500);
  }
}

/**

/**
 * Admin: Get default prompt for viewing in admin panel
 * Reads prompts directly from KV storage (admin_*_prompt keys)
 * These are the ACTUAL prompts used in generation
 */
async function handleGetDefaultPrompt(request, env) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    
    if (!type) {
      return jsonResponse({ error: 'Missing prompt type parameter' }, 400);
    }
    
    // Map prompt types to KV keys
    const promptKeyMap = {
      'analysis': 'admin_analysis_prompt',
      'strategy': 'admin_strategy_prompt',
      'meal_plan': 'admin_meal_plan_prompt',
      'summary': 'admin_summary_prompt',
      'consultation': 'admin_consultation_prompt',
      'modification': 'admin_modification_prompt',
      'correction': 'admin_correction_prompt',
      'emoeat': 'admin_emoeat_prompt',
      'food_analysis': 'admin_food_analysis_prompt',
      'menu_analysis': 'admin_menu_analysis_prompt',
      'validation': 'admin_validation_prompt'
    };
    
    const kvKey = promptKeyMap[type];
    if (!kvKey) {
      return jsonResponse({ 
        error: `Unknown prompt type: ${type}. Valid types: analysis, strategy, meal_plan, summary, consultation, modification, correction, emoeat, food_analysis, menu_analysis, validation` 
      }, 400);
    }
    
    // Try to read from KV storage
    let prompt = null;
    if (env.page_content) {
      try {
        prompt = await env.page_content.get(kvKey);
      } catch (error) {
        console.error(`Error reading prompt ${kvKey} from KV:`, error);
      }
    }
    
    if (!prompt) {
      // For the validation prompt, fall back to the built-in default so the
      // "Виж Текущ Промпт" button always shows something useful.
      if (type === 'validation') {
        prompt = DEFAULT_VALIDATION_PROMPT_TEMPLATE;
      } else {
        return jsonResponse({ 
          error: `Prompt not found in KV storage. Please upload prompts using ./KV/upload-kv-keys.sh`,
          hint: `Missing key: ${kvKey}`
        }, 404);
      }
    }
    
    return jsonResponse({ success: true, prompt: prompt }, 200, {
      cacheControl: 'public, max-age=1800' // Cache for 30 minutes
    });
  } catch (error) {
    console.error('Error getting default prompt:', error);
    return jsonResponse({ error: 'Failed to get default prompt: ' + error.message }, 500);
  }
}

/**
 * Admin: Save AI model preference to KV
 */
async function handleSaveModel(request, env) {
  try {
    const { provider, modelName, thinkingBudget, temperature, topP, topK } = await request.json();
    
    if (!provider || !modelName) {
      return jsonResponse({ error: 'Missing provider or modelName' }, 400);
    }

    if (!['openai', 'google', 'anthropic', 'mock'].includes(provider)) {
      return jsonResponse({ error: 'Invalid provider type' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const puts = [
      env.page_content.put('admin_ai_provider', provider),
      env.page_content.put('admin_ai_model_name', modelName)
    ];
    // thinkingBudget: null/undefined → clear, number → store as string
    if (thinkingBudget !== undefined && thinkingBudget !== null && thinkingBudget !== '') {
      puts.push(env.page_content.put('admin_ai_thinking_budget', String(thinkingBudget)));
    } else {
      puts.push(env.page_content.put('admin_ai_thinking_budget', ''));
    }
    // temperature: null/undefined/'' → clear, number → store
    puts.push(env.page_content.put('admin_ai_temperature',
      (temperature !== undefined && temperature !== null && temperature !== '') ? String(temperature) : ''));
    // topP: null/undefined/'' → clear, number → store
    puts.push(env.page_content.put('admin_ai_top_p',
      (topP !== undefined && topP !== null && topP !== '') ? String(topP) : ''));
    // topK: null/undefined/'' → clear, number → store
    puts.push(env.page_content.put('admin_ai_top_k',
      (topK !== undefined && topK !== null && topK !== '') ? String(topK) : ''));
    await Promise.all(puts);
    
    // Invalidate cache so next request gets fresh config
    adminConfigCache = null;
    adminConfigCacheTime = 0;
    
    return jsonResponse({ success: true, message: 'Model saved successfully' });
  } catch (error) {
    console.error('Error saving model:', error);
    return jsonResponse({ error: 'Failed to save model: ' + error.message }, 500);
  }
}

/**
 * Admin: Save chat AI model preference to KV (separate from plan generation model)
 */
async function handleSaveChatModel(request, env) {
  try {
    const { provider, modelName, thinkingBudget, temperature, topP, topK } = await request.json();

    if (!provider) {
      return jsonResponse({ error: 'Missing provider' }, 400);
    }

    if (!['openai', 'google', 'anthropic', 'mock'].includes(provider)) {
      return jsonResponse({ error: 'Invalid provider type' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const puts = [
      env.page_content.put('admin_chat_ai_provider', provider),
      env.page_content.put('admin_chat_ai_model_name', modelName || '')
    ];
    if (thinkingBudget !== undefined && thinkingBudget !== null && thinkingBudget !== '') {
      puts.push(env.page_content.put('admin_chat_ai_thinking_budget', String(thinkingBudget)));
    } else {
      puts.push(env.page_content.put('admin_chat_ai_thinking_budget', ''));
    }
    puts.push(env.page_content.put('admin_chat_ai_temperature',
      (temperature !== undefined && temperature !== null && temperature !== '') ? String(temperature) : ''));
    puts.push(env.page_content.put('admin_chat_ai_top_p',
      (topP !== undefined && topP !== null && topP !== '') ? String(topP) : ''));
    puts.push(env.page_content.put('admin_chat_ai_top_k',
      (topK !== undefined && topK !== null && topK !== '') ? String(topK) : ''));
    await Promise.all(puts);

    // Invalidate cache so next request gets fresh config
    adminConfigCache = null;
    adminConfigCacheTime = 0;

    return jsonResponse({ success: true, message: 'Chat model saved successfully' });
  } catch (error) {
    console.error('Error saving chat model:', error);
    return jsonResponse({ error: 'Failed to save chat model: ' + error.message }, 500);
  }
}

/**
 * Admin: Save chat mode configuration to KV
 */
async function handleSaveChatModeConfig(request, env) {
  try {
    const { modificationModeEnabled } = await request.json();

    if (typeof modificationModeEnabled !== 'boolean') {
      return jsonResponse({ error: 'modificationModeEnabled must be boolean' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const version = Date.now();
    await Promise.all([
      env.page_content.put('admin_chat_modification_mode_enabled', modificationModeEnabled ? 'true' : 'false'),
      env.page_content.put('admin_chat_mode_version', version.toString())
    ]);

    // Invalidate chat prompts cache so mode takes effect immediately
    chatPromptsCache = null;
    chatPromptsCacheTime = 0;

    return jsonResponse({ success: true, message: 'Chat mode config saved successfully', version });
  } catch (error) {
    console.error('Error saving chat mode config:', error);
    return jsonResponse({ error: 'Failed to save chat mode config: ' + error.message }, 500);
  }
}

/**
 * Lightweight endpoint for clients to check current chat mode config.
 * Reads only 2 KV keys instead of the full get-config (15+ keys).
 */
async function handleGetChatModeConfig(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const [modificationModeEnabled, versionData] = await Promise.all([
      env.page_content.get('admin_chat_modification_mode_enabled'),
      env.page_content.get('admin_chat_mode_version')
    ]);

    return jsonResponse({
      success: true,
      modificationModeEnabled: modificationModeEnabled === 'true',
      version: versionData ? parseInt(versionData) : 0
    }, 200, {
      cacheControl: 'public, max-age=300' // 5 min CDN cache (admin changes are infrequent)
    });
  } catch (error) {
    console.error('Error getting chat mode config:', error);
    return jsonResponse({ error: 'Failed to get chat mode config: ' + error.message }, 500);
  }
}

/**
 * Admin: Save protocol AI config (provider, model) to KV
 */
async function handleSaveProtocolConfig(request, env) {
  try {
    const { provider, modelName, thinkingBudget } = await request.json();

    if (!provider) {
      return jsonResponse({ error: 'Missing provider' }, 400);
    }

    if (!['openai', 'google', 'anthropic'].includes(provider)) {
      return jsonResponse({ error: 'Invalid provider type' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const puts = [
      env.page_content.put('admin_protocol_provider', provider),
      env.page_content.put('admin_protocol_model_name', modelName || '')
    ];
    if (thinkingBudget !== undefined && thinkingBudget !== null && thinkingBudget !== '') {
      puts.push(env.page_content.put('admin_protocol_thinking_budget', String(thinkingBudget)));
    } else {
      puts.push(env.page_content.put('admin_protocol_thinking_budget', ''));
    }
    await Promise.all(puts);

    return jsonResponse({ success: true, message: 'Protocol config saved successfully' });
  } catch (error) {
    console.error('Error saving protocol config:', error);
    return jsonResponse({ error: 'Failed to save protocol config: ' + error.message }, 500);
  }
}

/**
 * Admin: Save vision AI config (provider, model) to KV
 */
async function handleSaveVisionConfig(request, env) {
  try {
    const { provider, modelName, thinkingBudget } = await request.json();

    if (!provider) {
      return jsonResponse({ error: 'Missing provider' }, 400);
    }

    if (!['openai', 'google', 'anthropic'].includes(provider)) {
      return jsonResponse({ error: 'Invalid provider type' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const puts = [
      env.page_content.put('admin_vision_provider', provider),
      env.page_content.put('admin_vision_model_name', modelName || '')
    ];
    if (thinkingBudget !== undefined && thinkingBudget !== null && thinkingBudget !== '') {
      puts.push(env.page_content.put('admin_vision_thinking_budget', String(thinkingBudget)));
    } else {
      puts.push(env.page_content.put('admin_vision_thinking_budget', ''));
    }
    await Promise.all(puts);

    // Invalidate admin config cache so next vision call picks up the new settings
    adminConfigCache = null;
    adminConfigCacheTime = 0;

    return jsonResponse({ success: true, message: 'Vision config saved successfully' });
  } catch (error) {
    console.error('Error saving vision config:', error);
    return jsonResponse({ error: 'Failed to save vision config: ' + error.message }, 500);
  }
}

/**
 * Admin: Save per-step token limits to KV
 * Body: { step1: number, step2: number, step3: number, step4: number, chat: number }
 */
async function handleSaveStepTokenLimits(request, env) {
  try {
    const limits = await request.json();

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Accept only valid numeric positive values; ignore anything else
    const allowed = ['step1', 'step2', 'step3', 'step4', 'chat'];
    const clean = {};
    for (const key of allowed) {
      const v = parseInt(limits[key], 10);
      if (!isNaN(v) && v > 0) clean[key] = v;
    }

    await env.page_content.put('admin_step_token_limits', JSON.stringify(clean));

    // Invalidate admin config cache so the next callAIModel picks up new limits
    adminConfigCache = null;
    adminConfigCacheTime = 0;

    return jsonResponse({ success: true, message: 'Step token limits saved successfully', limits: clean });
  } catch (error) {
    console.error('Error saving step token limits:', error);
    return jsonResponse({ error: 'Failed to save step token limits: ' + error.message }, 500);
  }
}


async function handleGenerateProtocol(request, env) {
  try {
    const { prompt } = await request.json();

    if (!prompt) {
      return jsonResponse({ error: 'Missing prompt' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const [savedProvider, savedModelName, savedProtocolThinkingBudget] = await Promise.all([
      env.page_content.get('admin_protocol_provider'),
      env.page_content.get('admin_protocol_model_name'),
      env.page_content.get('admin_protocol_thinking_budget')
    ]);

    const provider = savedProvider || 'openai';
    const modelName = savedModelName || '';
    const protocolThinkingBudget = parseThinkingBudget(savedProtocolThinkingBudget);

    let response;
    if (provider === 'openai' && env.OPENAI_API_KEY) {
      response = await callOpenAI(env, prompt, modelName || 'gpt-4o-mini', 4000, false);
    } else if (provider === 'google' && env.GEMINI_API_KEY) {
      response = await callGemini(env, prompt, modelName || 'gemini-2.5-flash', 4000, false, protocolThinkingBudget);
    } else if (provider === 'anthropic' && env.ANTHROPIC_API_KEY) {
      response = await callClaude(env, prompt, modelName || 'claude-3-5-sonnet-20241022', 4000, false);
    } else {
      return jsonResponse({ error: 'AI provider not configured or API key missing' }, 503);
    }

    return jsonResponse({ success: true, response });
  } catch (error) {
    console.error('Error generating protocol:', error);
    return jsonResponse({ error: 'Failed to generate protocol: ' + error.message }, 500);
  }
}

/**
 * Generate EmoEat emotional eating analysis using AI
 * Takes 15 questionnaire answers and returns deeply personalized psychological analysis
 */
async function generateEmoeatPrompt(answers, env) {
  const customPrompt = await requireKvPrompt(env, 'admin_emoeat_prompt');
  const variables = {};
  for (let i = 1; i <= 15; i++) {
    variables[`answer${i}`] = (answers[i] || '').trim() || '(без отговор)';
  }
  return replacePromptVariables(customPrompt, variables);
}

async function handleGenerateEmoeatAnalysis(request, env) {
  try {
    const data = await request.json();

    if (!data.answers || typeof data.answers !== 'object') {
      return jsonResponse({ error: 'Липсват отговори от въпросника' }, 400);
    }

    // Validate that at least some answers exist
    const answeredCount = Object.values(data.answers).filter(a => a && String(a).trim().length > 0).length;
    if (answeredCount < 5) {
      return jsonResponse({ error: 'Моля, отговорете на поне 5 въпроса за пълноценен анализ' }, 400);
    }

    const prompt = await generateEmoeatPrompt(data.answers, env);

    const EMOEAT_TOKEN_LIMIT = 6000;
    const aiResponse = await callAIModel(
      env,
      prompt,
      EMOEAT_TOKEN_LIMIT,
      'emoeat_analysis',
      null,
      null,
      null
    );

    const parsed = parseAIResponse(aiResponse);

    if (!parsed || !parsed.dominantArchetype) {
      console.error('handleGenerateEmoeatAnalysis: Failed to parse AI response');
      return jsonResponse({
        error: 'Анализът не можа да бъде генериран. Моля, опитайте отново.',
        rawResponse: typeof aiResponse === 'string' ? aiResponse.substring(0, 200) : null
      }, 500);
    }

    return jsonResponse({ success: true, analysis: parsed });
  } catch (error) {
    console.error('Error generating emoeat analysis:', error);
    return jsonResponse({ error: 'Грешка при генериране на анализа: ' + error.message }, 500);
  }
}

/**
 * Generate personalized longevity protocol based on user wizard data
 */
async function generateLongevityPrompt(wizardData, userPrompt) {
  const defaultPrompt = `Ти си експерт по дълголетие и анти-ейджинг медицина. Базираш се на научни изследвания за mTOR, AMPK, NAD+, съртуини, автофагия, митофагия, сенолитика и хормезис.

ВХОДНИ ДАННИ ОТ ПОТРЕБИТЕЛЯ:
${userPrompt}

Допълнителни данни от въпросника:
- Възраст: ${wizardData.age || 'не е посочена'}
- Пол: ${wizardData.gender === 'male' ? 'мъж' : wizardData.gender === 'female' ? 'жена' : 'не е посочен'}
- Ниво на активност: ${wizardData.activityLevel || 'не е посочено'}
- Симптоми: ${(wizardData.symptoms || []).join(', ') || 'няма'}
- Текущо гладуване: ${wizardData.fasting || 'не практикува'}
- Студови процедури: ${wizardData.coldExposure || 'не практикува'}
- Силови тренировки: ${wizardData.strengthTraining || 'не тренира'}
- Сън: ${wizardData.sleepHours || 7} часа
- Цели: ${(wizardData.goals || []).join(', ') || 'общо дълголетие'}
- Готовност за промени: ${wizardData.commitment || 5}/10
- Бюджет за добавки: ${wizardData.budget || 'среден'}

ИНСТРУКЦИИ:
1. Създай персонализиран протокол за дълголетие базиран на горните данни.
2. Фокусирай се върху 6-те основни функции: Енергия (AMPK), Почистване (Автофагия), Защита (NRF2), Код (ДНК репарация), Структура (Кости/Мускули), Детокс (Сенолиза).
3. Препоръчай конкретни поведенчески промени, добавки и маркери за проследяване.

ОТГОВОРИ В СЛЕДНИЯ JSON ФОРМАТ (САМО JSON, БЕЗ ДРУГИ ТЕКСТ):
{
  "lifestyle": [
    {
      "icon": "fas fa-clock",
      "title": "Кратко заглавие",
      "description": "Детайлно описание на препоръката"
    }
  ],
  "supplements": [
    {
      "name": "Име на добавката",
      "dose": "Доза и честота",
      "reason": "Защо е нужна",
      "priority": "Висок/Среден/Нисък"
    }
  ],
  "markers": [
    {
      "name": "Име на маркера",
      "target": "Целева стойност",
      "frequency": "Колко често да се измерва"
    }
  ],
  "timeline": "HTML текст с времева линия за въвеждане на промените"
}`;

  return defaultPrompt;
}

async function handleGenerateLongevityProtocol(request, env) {
  try {
    const data = await request.json();
    const wizardData = data.wizardData || {};
    const userPrompt = data.prompt || '';

    if (!userPrompt && !wizardData.age) {
      return jsonResponse({ error: 'Липсват данни от въпросника' }, 400);
    }

    const prompt = await generateLongevityPrompt(wizardData, userPrompt);
    const LONGEVITY_TOKEN_LIMIT = 4000;

    // Get AI provider settings (reuse protocol settings)
    const [savedProvider, savedModelName, savedProtocolThinkingBudget] = await Promise.all([
      env.page_content?.get('admin_protocol_provider'),
      env.page_content?.get('admin_protocol_model_name'),
      env.page_content?.get('admin_protocol_thinking_budget')
    ]);

    const provider = savedProvider || 'openai';
    const modelName = savedModelName || '';
    const protocolThinkingBudget = parseThinkingBudget(savedProtocolThinkingBudget);

    let aiResponse;
    if (provider === 'openai' && env.OPENAI_API_KEY) {
      aiResponse = await callOpenAI(env, prompt, modelName || 'gpt-4o-mini', LONGEVITY_TOKEN_LIMIT, true);
    } else if (provider === 'google' && env.GEMINI_API_KEY) {
      aiResponse = await callGemini(env, prompt, modelName || 'gemini-2.5-flash', LONGEVITY_TOKEN_LIMIT, true, protocolThinkingBudget);
    } else if (provider === 'anthropic' && env.ANTHROPIC_API_KEY) {
      aiResponse = await callClaude(env, prompt, modelName || 'claude-3-5-sonnet-20241022', LONGEVITY_TOKEN_LIMIT, true);
    } else {
      return jsonResponse({ error: 'AI provider not configured' }, 503);
    }

    // Parse AI response
    const parsed = parseAIResponse(aiResponse);
    
    if (parsed && (parsed.lifestyle || parsed.supplements)) {
      return jsonResponse({ success: true, protocol: parsed });
    } else {
      // Return raw response if parsing fails
      return jsonResponse({ 
        success: false, 
        error: 'Отговорът не може да бъде обработен',
        rawResponse: aiResponse 
      }, 200);
    }

  } catch (error) {
    console.error('Error generating longevity protocol:', error);
    return jsonResponse({ error: 'Грешка при генериране на протокола: ' + error.message }, 500);
  }
}

/**
 * Admin: Get admin configuration from KV
 */
async function handleGetConfig(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Use Promise.all to fetch all config values in parallel (reduces sequential KV reads)
    const [
      provider, 
      modelName, 
      planPrompt, 
      chatPrompt, 
      consultationPrompt, 
      modificationPrompt,
      analysisPrompt,
      strategyPrompt,
      mealPlanPrompt,
      summaryPrompt,
      correctionPrompt,
      protocolProvider,
      protocolModelName,
      emoeatPrompt,
      foodAnalysisPrompt,
      menuAnalysisPrompt,
      modificationModeEnabled,
      visionProvider,
      visionModelName,
      aiThinkingBudget,
      visionThinkingBudget,
      protocolThinkingBudget,
      stepTokenLimits,
      aiTemperature,
      aiTopP,
      aiTopK,
      chatAiProvider,
      chatAiModelName,
      chatAiThinkingBudget,
      chatAiTemperature,
      chatAiTopP,
      chatAiTopK,
      validationPrompt
    ] = await Promise.all([
      env.page_content.get('admin_ai_provider'),
      env.page_content.get('admin_ai_model_name'),
      env.page_content.get('admin_plan_prompt'),
      env.page_content.get('admin_chat_prompt'),
      env.page_content.get('admin_consultation_prompt'),
      env.page_content.get('admin_modification_prompt'),
      env.page_content.get('admin_analysis_prompt'),
      env.page_content.get('admin_strategy_prompt'),
      env.page_content.get('admin_meal_plan_prompt'),
      env.page_content.get('admin_summary_prompt'),
      env.page_content.get('admin_correction_prompt'),
      env.page_content.get('admin_protocol_provider'),
      env.page_content.get('admin_protocol_model_name'),
      env.page_content.get('admin_emoeat_prompt'),
      env.page_content.get('admin_food_analysis_prompt'),
      env.page_content.get('admin_menu_analysis_prompt'),
      env.page_content.get('admin_chat_modification_mode_enabled'),
      env.page_content.get('admin_vision_provider'),
      env.page_content.get('admin_vision_model_name'),
      env.page_content.get('admin_ai_thinking_budget'),
      env.page_content.get('admin_vision_thinking_budget'),
      env.page_content.get('admin_protocol_thinking_budget'),
      env.page_content.get('admin_step_token_limits'),
      env.page_content.get('admin_ai_temperature'),
      env.page_content.get('admin_ai_top_p'),
      env.page_content.get('admin_ai_top_k'),
      env.page_content.get('admin_chat_ai_provider'),
      env.page_content.get('admin_chat_ai_model_name'),
      env.page_content.get('admin_chat_ai_thinking_budget'),
      env.page_content.get('admin_chat_ai_temperature'),
      env.page_content.get('admin_chat_ai_top_p'),
      env.page_content.get('admin_chat_ai_top_k'),
      env.page_content.get('admin_validation_prompt')
    ]);
    
    const parsedModificationModeEnabled = modificationModeEnabled === 'true';
    let parsedStepTokenLimits = {};
    if (stepTokenLimits) { try { parsedStepTokenLimits = JSON.parse(stepTokenLimits); } catch (_) {} }

    return jsonResponse({ 
      success: true, 
      provider: provider || 'openai',
      modelName: modelName || 'gpt-4o-mini',
      planPrompt,
      chatPrompt,
      consultationPrompt,
      modificationPrompt,
      analysisPrompt,
      strategyPrompt,
      mealPlanPrompt,
      summaryPrompt,
      correctionPrompt,
      protocolProvider: protocolProvider || null,
      protocolModelName: protocolModelName || null,
      emoeatPrompt,
      foodAnalysisPrompt,
      menuAnalysisPrompt,
      validationPrompt,
      modificationModeEnabled: parsedModificationModeEnabled,
      visionProvider: visionProvider || null,
      visionModelName: visionModelName || null,
      aiThinkingBudget: aiThinkingBudget || '',
      visionThinkingBudget: visionThinkingBudget || '',
      protocolThinkingBudget: protocolThinkingBudget || '',
      stepTokenLimits: parsedStepTokenLimits,
      aiTemperature: aiTemperature || '',
      aiTopP: aiTopP || '',
      aiTopK: aiTopK || '',
      chatAiProvider: chatAiProvider || null,
      chatAiModelName: chatAiModelName || null,
      chatAiThinkingBudget: chatAiThinkingBudget || '',
      chatAiTemperature: chatAiTemperature || '',
      chatAiTopP: chatAiTopP || '',
      chatAiTopK: chatAiTopK || ''
    }, 200, {
      cacheControl: 'public, max-age=300' // Cache for 5 minutes - config changes infrequently
    });
  } catch (error) {
    console.error('Error getting config:', error);
    return jsonResponse({ error: 'Failed to get config: ' + error.message }, 500);
  }
}

/**
 * Admin: Get validation config (thresholds + contradiction rules)
 */
async function handleGetValidationConfig(request, env) {
  try {
    const config = await getValidationConfig(env);
    return jsonResponse({ success: true, config }, 200, {
      cacheControl: 'public, max-age=300' // Cache for 5 minutes - validation config changes infrequently
    });
  } catch (error) {
    console.error('Error getting validation config:', error);
    return jsonResponse({ error: 'Failed to get validation config: ' + error.message }, 500);
  }
}

/**
 * Admin: Save validation config (thresholds + contradiction rules) to KV
 */
async function handleSaveValidationConfig(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const { config } = await request.json();
    if (!config || typeof config !== 'object') {
      return jsonResponse({ error: 'Missing or invalid config object' }, 400);
    }

    // Basic sanity checks on numeric threshold fields
    const dv = config.dataValidation;
    if (dv) {
      const numFields = ['minAge','maxAge','minWeightKg','maxWeightKg','minHeightCm','maxHeightCm','minBmi','maxBmi','maxWeightLossKg','maxWeightLossPercent'];
      for (const f of numFields) {
        if (dv[f] !== undefined && (typeof dv[f] !== 'number' || isNaN(dv[f]))) {
          return jsonResponse({ error: `Invalid value for dataValidation.${f}` }, 400);
        }
      }
    }

    await env.page_content.put('admin_validation_config', JSON.stringify(config));

    // Invalidate cache
    validationConfigCache = null;
    validationConfigCacheTime = 0;

    return jsonResponse({ success: true, message: 'Validation config saved successfully' });
  } catch (error) {
    console.error('Error saving validation config:', error);
    return jsonResponse({ error: 'Failed to save validation config: ' + error.message }, 500);
  }
}


/**
 * Get AI communication logs
 * Retrieves AI logs from Cache API (free, no KV quota impact)
 * 
 * @param {Request} request - HTTP request with optional query params (limit, offset)
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response with:
 *   - logs: Array of log entries (request + response pairs)
 *   - total: Total number of logs
 *   - limit: Number of logs per page
 *   - offset: Starting position for pagination
 *   - sessionCount: Number of sessions
 *   - storageType: 'cache' (indicates logs are from Cache API, not KV)
 */
async function handleGetAILogs(request, env) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    
    const combinedIndex = await kvGetJSON(env, AI_LOG_COMBINED_INDEX_KEY) || await cacheGet(AI_LOG_COMBINED_INDEX_KEY);
    
    if (combinedIndex && combinedIndex.sessions && combinedIndex.sessions.length > 0) {
      // Session-based format (current)
      const sessionIds = combinedIndex.sessions;
      
      // Get all log IDs from ALL sessions (not just the latest one)
      const allLogIds = [];
      for (const sessionId of sessionIds) {
        const sessionLogsData = combinedIndex.logs && combinedIndex.logs[sessionId];
        if (sessionLogsData) {
          allLogIds.push(...sessionLogsData);
        }
      }
      
      if (allLogIds.length === 0) {
        return jsonResponse({ success: true, logs: [], total: 0 });
      }
      
      const total = allLogIds.length;
      
      // Apply pagination
      const paginatedIds = allLogIds.slice(offset, offset + limit);
      
      const primaryLogs = await Promise.all(
        paginatedIds.map(logId => kvGetJSON(env, `ai_communication_log:${logId}`).then(log => log || cacheGet(`ai_communication_log:${logId}`)))
      );
      
      // Combine request and response logs (backward compatible with both formats)
      const logs = [];
      for (let i = 0; i < paginatedIds.length; i++) {
        const primaryLog = primaryLogs[i];
        
        if (primaryLog) {
          if (primaryLog.type === 'combined') {
            // New format: the primary entry already contains both request and response fields.
            // Expose a nested `response` object so the admin panel sees the same shape as before.
            logs.push({
              ...primaryLog,
              response: {
                id: primaryLog.id,
                timestamp: primaryLog.responseTimestamp || primaryLog.timestamp,
                stepName: primaryLog.stepName,
                type: 'response',
                response: primaryLog.response,
                responseLength: primaryLog.responseLength,
                estimatedOutputTokens: primaryLog.estimatedOutputTokens,
                duration: primaryLog.duration,
                success: primaryLog.success,
                error: primaryLog.error,
                hasError: primaryLog.hasError
              }
            });
          } else {
            const legacyResponseLog = await cacheGet(`ai_communication_log:${paginatedIds[i]}_response`);
            logs.push({
              ...primaryLog,
              response: legacyResponseLog
            });
          }
        }
      }
      
      return jsonResponse({ 
        success: true, 
        logs: logs,
        total: total,
        limit: limit,
        offset: offset,
        sessionCount: sessionIds.length,
        storageType: 'kv+cache'
      }, 200, {
        cacheControl: 'public, max-age=60' // Cache for 1 minute - logs are frequently updated
      });
    } else {
      // No logs found
      return jsonResponse({ 
        success: true, 
        logs: [], 
        total: 0,
        storageType: 'kv+cache'
      });
    }
  } catch (error) {
    console.error('[Cache API] Error fetching AI logs:', error);
    return jsonResponse({ error: 'Failed to fetch AI logs', details: error.message }, 500);
  }
}

/**
 * Cleanup AI logs - delete all previous logs and keep only the most recent one
 * NOTE: Cache API logs automatically expire after 24 hours, so this is optional
 */
async function handleCleanupAILogs(request, env) {
  try {
    let combinedIndex = await kvGetJSON(env, AI_LOG_COMBINED_INDEX_KEY) || await cacheGet(AI_LOG_COMBINED_INDEX_KEY);
    
    if (!combinedIndex || !combinedIndex.sessions || combinedIndex.sessions.length === 0) {
      return jsonResponse({ 
        success: true, 
        message: 'No logs to cleanup', 
        deletedCount: 0,
        storageType: 'kv+cache'
      });
    }
    
    // Get all log IDs from all sessions
    const allLogIds = [];
    for (const sessionId of combinedIndex.sessions) {
      const sessionLogsData = combinedIndex.logs && combinedIndex.logs[sessionId];
      if (sessionLogsData) {
        allLogIds.push(...sessionLogsData);
      }
    }
    
    if (allLogIds.length === 0) {
      return jsonResponse({ 
        success: true, 
        message: 'No logs to cleanup', 
        deletedCount: 0,
        storageType: 'kv+cache'
      });
    }
    
    // Delete all log entries from Cache API
    const deletePromises = [];
    for (const logId of allLogIds) {
      deletePromises.push(
        cacheDelete(`ai_communication_log:${logId}`),
        cacheDelete(`ai_communication_log:${logId}_response`)
      );
    }
    
    // Delete the combined index
    deletePromises.push(cacheDelete(AI_LOG_COMBINED_INDEX_KEY));
    if (env?.page_content) deletePromises.push(env.page_content.delete(AI_LOG_COMBINED_INDEX_KEY));

    for (const logId of allLogIds) {
      if (env?.page_content) deletePromises.push(env.page_content.delete(`ai_communication_log:${logId}`));
    }
    
    await Promise.all(deletePromises);
    
    console.log(`[Cache API] Cleaned up ${allLogIds.length} log entries from ${combinedIndex.sessions.length} sessions`);
    
    return jsonResponse({ 
      success: true, 
      message: `Successfully cleaned up ${allLogIds.length} log entries from ${combinedIndex.sessions.length} sessions`,
      deletedCount: allLogIds.length,
      sessionCount: combinedIndex.sessions.length,
      storageType: 'kv+cache'
    }, 200);
  } catch (error) {
    console.error('[Cache API] Error cleaning up AI logs:', error);
    return jsonResponse({ error: 'Failed to cleanup AI logs: ' + error.message }, 500);
  }
}

/**
 * Export AI communication logs to a text file
 * Returns all steps with sent data, prompts, and AI responses
 */
async function handleExportAILogs(request, env) {
  try {
    let combinedIndex = await kvGetJSON(env, AI_LOG_COMBINED_INDEX_KEY) || await cacheGet(AI_LOG_COMBINED_INDEX_KEY);
    
    if (!combinedIndex || !combinedIndex.sessions || combinedIndex.sessions.length === 0) {
      return new Response('Няма налични логове за експорт.', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="ai_communication_logs.txt"',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }
    
    // Export only the last (most recent) plan - sessions[0] is most recent
    const lastSessionId = combinedIndex.sessions[0];
    
    const allLogIds = (combinedIndex.logs && combinedIndex.logs[lastSessionId]) || [];
    
    if (allLogIds.length === 0) {
      return new Response('Няма налични логове за експорт.', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="ai_communication_logs.txt"',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }
    
    const requestLogs = await Promise.all(
      allLogIds.map(logId => kvGetJSON(env, `ai_communication_log:${logId}`).then(log => log || cacheGet(`ai_communication_log:${logId}`)))
    );
    
    // Build text content
    let textContent = '='.repeat(80) + '\n';
    textContent += 'AI КОМУНИКАЦИОННИ ЛОГОВЕ - ПОСЛЕДЕН ПЛАН\n';
    textContent += '(Съхранени в KV + Cache API за глобален достъп от админ панела)\n';
    textContent += '='.repeat(80) + '\n\n';
    textContent += `Дата на експорт: ${new Date().toISOString()}\n`;
    textContent += `Сесия: ${lastSessionId}\n`;
    textContent += `Общо стъпки: ${allLogIds.length}\n`;
    textContent += '\n';
    
    for (let i = 0; i < allLogIds.length; i++) {
      const requestLog = requestLogs[i];
      const responseLog = requestLog?.type === 'combined' ? {
        timestamp: requestLog.responseTimestamp || requestLog.timestamp,
        success: requestLog.success,
        duration: requestLog.duration,
        responseLength: requestLog.responseLength,
        estimatedOutputTokens: requestLog.estimatedOutputTokens,
        error: requestLog.error,
        response: requestLog.response
      } : await cacheGet(`ai_communication_log:${allLogIds[i]}_response`);
      
      if (requestLog) {
        textContent += '='.repeat(80) + '\n';
        textContent += `СТЪПКА ${i + 1}: ${requestLog.stepName}\n`;
        textContent += `ID на сесия: ${requestLog.sessionId || 'N/A'}\n`;
        textContent += '='.repeat(80) + '\n\n';
        
        // Request information
        textContent += '--- ИЗПРАТЕНИ ДАННИ ---\n';
        textContent += `Времева марка: ${requestLog.timestamp}\n`;
        textContent += `Провайдър: ${requestLog.provider}\n`;
        textContent += `Модел: ${requestLog.modelName}\n`;
        textContent += `Дължина на промпт: ${requestLog.promptLength} символа\n`;
        textContent += `Приблизителни входни токени: ${requestLog.estimatedInputTokens}\n`;
        textContent += `Максимални изходни токени: ${requestLog.maxOutputTokens || 'N/A'}\n\n`;
        
        // User data (client data)
        if (requestLog.userData) {
          textContent += '--- КЛИЕНТСКИ ДАННИ ---\n';
          textContent += JSON.stringify(requestLog.userData, null, 2);
          textContent += '\n\n';
        }
        
        // Calculated data (backend calculations)
        if (requestLog.calculatedData) {
          textContent += '--- БЕКЕНД КАЛКУЛАЦИИ ---\n';
          textContent += JSON.stringify(requestLog.calculatedData, null, 2);
          textContent += '\n\n';
        }
        
        textContent += '--- ПРОМПТ ---\n';
        textContent += requestLog.prompt || '(Няма съхранен промпт)';
        textContent += '\n\n';
        
        // Response information
        if (responseLog) {
          textContent += '--- ПОЛУЧЕН ОТГОВОР ---\n';
          textContent += `Времева марка: ${responseLog.timestamp}\n`;
          textContent += `Успех: ${responseLog.success ? 'Да' : 'Не'}\n`;
          textContent += `Време за отговор: ${responseLog.duration} ms\n`;
          textContent += `Дължина на отговор: ${responseLog.responseLength} символа\n`;
          textContent += `Приблизителни изходни токени: ${responseLog.estimatedOutputTokens}\n`;
          
          if (responseLog.error) {
            textContent += `Грешка: ${responseLog.error}\n`;
          }
          
          textContent += '\n--- AI ОТГОВОР ---\n';
          textContent += responseLog.response || '(Няма съхранен отговор)';
          textContent += '\n\n';
        } else {
          textContent += '--- ПОЛУЧЕН ОТГОВОР ---\n';
          textContent += '(Няма получен отговор)\n\n';
        }
      }
    }
    
    textContent += '='.repeat(80) + '\n';
    textContent += 'КРАЙ НА ЕКСПОРТА\n';
    textContent += '='.repeat(80) + '\n';
    
    return new Response(textContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="ai_communication_logs_${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').substring(0, 19)}.txt"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  } catch (error) {
    console.error('[Cache API] Error exporting AI logs:', error);
    return jsonResponse({ error: 'Failed to export AI logs: ' + error.message }, 500);
  }
}

/**
 * Blacklist Management: Get blacklist from KV storage.
 * Returns array of {item, mode, substitute?} objects.
 */
async function handleGetBlacklist(request, env) {
  try {
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ success: true, blacklist: DEFAULT_FOOD_BLACKLIST });
    }
    
    const blacklistData = await env.page_content.get('food_blacklist');
    let blacklist = blacklistData ? JSON.parse(blacklistData) : DEFAULT_FOOD_BLACKLIST;
    // Normalize old string[] format to object[] for the admin panel
    blacklist = blacklist.map(normalizeBlacklistEntry);
    
    return jsonResponse({ success: true, blacklist: blacklist }, 200, {
      cacheControl: 'public, max-age=300'
    });
  } catch (error) {
    console.error('Error getting blacklist:', error);
    return jsonResponse({ error: `Failed to get blacklist: ${error.message}` }, 500);
  }
}

/**
 * Blacklist Management: Add item to blacklist.
 * Accepts {item, mode: 'ban'|'substitute', substitute?}.
 */
async function handleAddToBlacklist(request, env) {
  try {
    const data = await request.json();
    const item = data.item?.trim()?.toLowerCase();
    const mode = data.mode === 'substitute' ? 'substitute' : 'ban';
    const substitute = mode === 'substitute' ? (data.substitute?.trim() || '') : undefined;
    
    if (!item) {
      return jsonResponse({ error: 'Item is required' }, 400);
    }
    if (mode === 'substitute' && !substitute) {
      return jsonResponse({ error: 'Substitute is required when mode is substitute' }, 400);
    }
    
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get current blacklist and normalize to object format
    const blacklistData = await env.page_content.get('food_blacklist');
    let blacklist = blacklistData ? JSON.parse(blacklistData) : DEFAULT_FOOD_BLACKLIST;
    blacklist = blacklist.map(normalizeBlacklistEntry);
    
    // Replace existing entry or add new one
    const existing = blacklist.findIndex(e => e.item === item);
    const entry = mode === 'substitute' ? { item, mode, substitute } : { item, mode };
    if (existing >= 0) {
      blacklist[existing] = entry;
    } else {
      blacklist.push(entry);
    }
    await env.page_content.put('food_blacklist', JSON.stringify(blacklist));
    invalidateFoodListsCache();
    
    return jsonResponse({ success: true, blacklist: blacklist });
  } catch (error) {
    console.error('Error adding to blacklist:', error);
    return jsonResponse({ error: `Failed to add to blacklist: ${error.message}` }, 500);
  }
}

/**
 * Blacklist Management: Remove item from blacklist.
 * Matches by item name (works for both old string[] and new object[] format).
 */
async function handleRemoveFromBlacklist(request, env) {
  try {
    const data = await request.json();
    const item = data.item?.trim()?.toLowerCase();
    
    if (!item) {
      return jsonResponse({ error: 'Item is required' }, 400);
    }
    
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get current blacklist and normalize to object format
    const blacklistData = await env.page_content.get('food_blacklist');
    let blacklist = blacklistData ? JSON.parse(blacklistData) : [];
    blacklist = blacklist.map(normalizeBlacklistEntry);
    
    // Remove by item name
    blacklist = blacklist.filter(e => e.item !== item);
    await env.page_content.put('food_blacklist', JSON.stringify(blacklist));
    
    // Invalidate food lists cache
    invalidateFoodListsCache();
    
    return jsonResponse({ success: true, blacklist: blacklist });
  } catch (error) {
    console.error('Error removing from blacklist:', error);
    return jsonResponse({ error: `Failed to remove from blacklist: ${error.message}` }, 500);
  }
}

/**
 * Blacklist Management: Bulk-replace the entire blacklist in one call.
 * Accepts { items: string[] } — all items are stored with mode='ban'.
 * Passing an empty array clears the blacklist completely.
 */
async function handleSetBlacklist(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const data = await request.json();
    const items = (data.items || [])
      .map(i => (typeof i === 'string' ? i.trim().toLowerCase() : ''))
      .filter(Boolean);
    const blacklist = items.map(item => ({ item, mode: 'ban' }));
    await env.page_content.put('food_blacklist', JSON.stringify(blacklist));
    invalidateFoodListsCache();
    return jsonResponse({ success: true, blacklist });
  } catch (error) {
    console.error('Error setting blacklist:', error);
    return jsonResponse({ error: `Failed to set blacklist: ${error.message}` }, 500);
  }
}

/**
 * Whitelist Management: Get whitelist from KV storage
 */
async function handleGetWhitelist(request, env) {
  try {
    if (!env.page_content) {
      console.error('KV namespace not configured');
      // Return default whitelist if KV not available
      return jsonResponse({ success: true, whitelist: DEFAULT_FOOD_WHITELIST });
    }
    
    const whitelistData = await env.page_content.get('food_whitelist');
    const whitelist = whitelistData ? JSON.parse(whitelistData) : DEFAULT_FOOD_WHITELIST;
    
    return jsonResponse({ success: true, whitelist: whitelist }, 200, {
      cacheControl: 'public, max-age=300' // Cache for 5 minutes - whitelist changes infrequently
    });
  } catch (error) {
    console.error('Error getting whitelist:', error);
    return jsonResponse({ error: `Failed to get whitelist: ${error.message}` }, 500);
  }
}

/**
 * Whitelist Management: Add item to whitelist
 */
async function handleAddToWhitelist(request, env) {
  try {
    const data = await request.json();
    const item = data.item?.trim()?.toLowerCase();
    
    if (!item) {
      return jsonResponse({ error: 'Item is required' }, 400);
    }
    
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get current whitelist
    const whitelistData = await env.page_content.get('food_whitelist');
    let whitelist = whitelistData ? JSON.parse(whitelistData) : DEFAULT_FOOD_WHITELIST;
    
    // Add item if not already in list
    if (!whitelist.includes(item)) {
      whitelist.push(item);
      await env.page_content.put('food_whitelist', JSON.stringify(whitelist));
      
      // Invalidate food lists cache
      invalidateFoodListsCache();
    }
    
    return jsonResponse({ success: true, whitelist: whitelist });
  } catch (error) {
    console.error('Error adding to whitelist:', error);
    return jsonResponse({ error: `Failed to add to whitelist: ${error.message}` }, 500);
  }
}

/**
 * Whitelist Management: Remove item from whitelist
 */
async function handleRemoveFromWhitelist(request, env) {
  try {
    const data = await request.json();
    const item = data.item?.trim()?.toLowerCase();
    
    if (!item) {
      return jsonResponse({ error: 'Item is required' }, 400);
    }
    
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get current whitelist
    const whitelistData = await env.page_content.get('food_whitelist');
    let whitelist = whitelistData ? JSON.parse(whitelistData) : DEFAULT_FOOD_WHITELIST;
    
    // Remove item
    whitelist = whitelist.filter(i => i !== item);
    await env.page_content.put('food_whitelist', JSON.stringify(whitelist));
    
    // Invalidate food lists cache
    invalidateFoodListsCache();
    
    return jsonResponse({ success: true, whitelist: whitelist });
  } catch (error) {
    console.error('Error removing from whitelist:', error);
    return jsonResponse({ error: `Failed to remove from whitelist: ${error.message}` }, 500);
  }
}

/**
 * Mainlist Management: Get mainlist from KV storage.
 * Returns a flat string array of approved food products.
 */
async function handleGetMainlist(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ success: true, mainlist: [] });
    }
    const mainlistData = await env.page_content.get('food_mainlist');
    const mainlist = mainlistData ? JSON.parse(mainlistData) : [];
    return jsonResponse({ success: true, mainlist }, 200, {
      cacheControl: 'private, max-age=300'
    });
  } catch (error) {
    console.error('Error getting mainlist:', error);
    return jsonResponse({ error: `Failed to get mainlist: ${error.message}` }, 500);
  }
}

/**
 * Mainlist Management: Bulk-replace mainlist with a new set of items.
 * Accepts { items: string[] } — the full new list.
 */
async function handleSetMainlist(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const data = await request.json();
    const items = (data.items || [])
      .map(i => (typeof i === 'string' ? i.trim().toLowerCase() : ''))
      .filter(Boolean);
    await env.page_content.put('food_mainlist', JSON.stringify(items));
    invalidateFoodListsCache();
    return jsonResponse({ success: true, mainlist: items });
  } catch (error) {
    console.error('Error setting mainlist:', error);
    return jsonResponse({ error: `Failed to set mainlist: ${error.message}` }, 500);
  }
}

/**
 * Mainlist Management: Add a single item to the mainlist.
 * Accepts { item: string }.
 */
async function handleAddToMainlist(request, env) {
  try {
    const data = await request.json();
    const item = data.item?.trim()?.toLowerCase();
    if (!item) {
      return jsonResponse({ error: 'Item is required' }, 400);
    }
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const mainlistData = await env.page_content.get('food_mainlist');
    let mainlist = mainlistData ? JSON.parse(mainlistData) : [];
    if (!mainlist.includes(item)) {
      mainlist.push(item);
      await env.page_content.put('food_mainlist', JSON.stringify(mainlist));
      invalidateFoodListsCache();
    }
    return jsonResponse({ success: true, mainlist });
  } catch (error) {
    console.error('Error adding to mainlist:', error);
    return jsonResponse({ error: `Failed to add to mainlist: ${error.message}` }, 500);
  }
}

/**
 * Mainlist Management: Remove a single item from the mainlist.
 * Accepts { item: string }.
 */
async function handleRemoveFromMainlist(request, env) {
  try {
    const data = await request.json();
    const item = data.item?.trim()?.toLowerCase();
    if (!item) {
      return jsonResponse({ error: 'Item is required' }, 400);
    }
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const mainlistData = await env.page_content.get('food_mainlist');
    let mainlist = mainlistData ? JSON.parse(mainlistData) : [];
    mainlist = mainlist.filter(i => i !== item);
    await env.page_content.put('food_mainlist', JSON.stringify(mainlist));
    invalidateFoodListsCache();
    return jsonResponse({ success: true, mainlist });
  } catch (error) {
    console.error('Error removing from mainlist:', error);
    return jsonResponse({ error: `Failed to remove from mainlist: ${error.message}` }, 500);
  }
}

/**
 * Mainlist Management: Clear the entire mainlist.
 */
async function handleClearMainlist(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    await env.page_content.put('food_mainlist', JSON.stringify([]));
    invalidateFoodListsCache();
    return jsonResponse({ success: true, mainlist: [] });
  } catch (error) {
    console.error('Error clearing mainlist:', error);
    return jsonResponse({ error: `Failed to clear mainlist: ${error.message}` }, 500);
  }
}

/**
 * Mainlist Management: Get enabled status.
 */
async function handleGetMainlistStatus(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ success: true, enabled: true });
    }
    const val = await env.page_content.get('food_mainlist_enabled');
    const enabled = val === null ? true : val !== 'false';
    return jsonResponse({ success: true, enabled }, 200, { cacheControl: 'public, max-age=60' }); // Cache 60s; invalidated on toggle
  } catch (error) {
    console.error('Error getting mainlist status:', error);
    return jsonResponse({ error: `Failed to get mainlist status: ${error.message}` }, 500);
  }
}

/**
 * Mainlist Management: Enable or disable the mainlist enforcement.
 * Accepts { enabled: boolean }.
 */
async function handleSetMainlistEnabled(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const data = await request.json();
    const enabled = data.enabled !== false && data.enabled !== 'false';
    await env.page_content.put('food_mainlist_enabled', enabled ? 'true' : 'false');
    invalidateFoodListsCache();
    return jsonResponse({ success: true, enabled });
  } catch (error) {
    console.error('Error setting mainlist enabled:', error);
    return jsonResponse({ error: `Failed to set mainlist status: ${error.message}` }, 500);
  }
}

/**
 * Mainlist Presets: Get list of saved preset names.
 */
async function handleGetMainlistPresets(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ success: true, presets: [] });
    }
    const raw = await env.page_content.get('food_mainlist_presets');
    const presets = raw ? Object.keys(JSON.parse(raw)) : [];
    return jsonResponse({ success: true, presets }, 200, { cacheControl: 'public, max-age=60' }); // Cache 60s; invalidated on preset changes
  } catch (error) {
    console.error('Error getting mainlist presets:', error);
    return jsonResponse({ error: `Failed to get presets: ${error.message}` }, 500);
  }
}

/**
 * Mainlist Presets: Save current mainlist as a named preset.
 * Accepts { name: string }.
 */
async function handleSaveMainlistPreset(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const data = await request.json();
    const name = (data.name || '').trim();
    if (!name) return jsonResponse({ error: 'Preset name is required' }, 400);
    const mainlistData = await env.page_content.get('food_mainlist');
    const mainlist = mainlistData ? JSON.parse(mainlistData) : [];
    const raw = await env.page_content.get('food_mainlist_presets');
    const presets = raw ? JSON.parse(raw) : {};
    presets[name] = mainlist;
    await env.page_content.put('food_mainlist_presets', JSON.stringify(presets));
    return jsonResponse({ success: true, presets: Object.keys(presets) });
  } catch (error) {
    console.error('Error saving mainlist preset:', error);
    return jsonResponse({ error: `Failed to save preset: ${error.message}` }, 500);
  }
}

/**
 * Mainlist Presets: Load a named preset as the active mainlist and enable it.
 * Accepts { name: string }.
 */
async function handleLoadMainlistPreset(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const data = await request.json();
    const name = (data.name || '').trim();
    if (!name) return jsonResponse({ error: 'Preset name is required' }, 400);
    const raw = await env.page_content.get('food_mainlist_presets');
    const presets = raw ? JSON.parse(raw) : {};
    if (!(name in presets)) return jsonResponse({ error: `Preset "${name}" not found` }, 404);
    const items = presets[name];
    if (!Array.isArray(items)) {
      return jsonResponse({ error: `Preset "${name}" has invalid format` }, 400);
    }
    if (items.length === 0) {
      return jsonResponse({ error: `Preset "${name}" is empty and cannot be loaded` }, 400);
    }
    await env.page_content.put('food_mainlist', JSON.stringify(items));
    await env.page_content.put('food_mainlist_enabled', 'true');
    invalidateFoodListsCache();
    return jsonResponse({ success: true, mainlist: items, enabled: true });
  } catch (error) {
    console.error('Error loading mainlist preset:', error);
    return jsonResponse({ error: `Failed to load preset: ${error.message}` }, 500);
  }
}

/**
 * Mainlist Presets: Delete a named preset.
 * Accepts { name: string }.
 */
async function handleDeleteMainlistPreset(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    const data = await request.json();
    const name = (data.name || '').trim();
    if (!name) return jsonResponse({ error: 'Preset name is required' }, 400);
    const raw = await env.page_content.get('food_mainlist_presets');
    const presets = raw ? JSON.parse(raw) : {};
    delete presets[name];
    await env.page_content.put('food_mainlist_presets', JSON.stringify(presets));
    return jsonResponse({ success: true, presets: Object.keys(presets) });
  } catch (error) {
    console.error('Error deleting mainlist preset:', error);
    return jsonResponse({ error: `Failed to delete preset: ${error.message}` }, 500);
  }
}

/**
 * Goal Hacks Management: Get all goal hacks
 */
async function handleGetGoalHacks(request, env) {
  try {
    const hacks = await getAllGoalHacks(env);
    return jsonResponse({ success: true, hacks: hacks }, 200, {
      cacheControl: 'no-cache'
    });
  } catch (error) {
    console.error('Error getting goal hacks:', error);
    return jsonResponse({ error: `Failed to get goal hacks: ${error.message}` }, 500);
  }
}

/**
 * Goal Hacks Management: Set all goal hacks (replace all)
 */
async function handleSetGoalHacks(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    const data = await request.json();
    const hacks = data.hacks;
    
    if (!hacks || typeof hacks !== 'object') {
      return jsonResponse({ error: 'Hacks object is required' }, 400);
    }
    
    await saveGoalHacks(env, hacks);
    return jsonResponse({ success: true, hacks: hacks });
  } catch (error) {
    console.error('Error setting goal hacks:', error);
    return jsonResponse({ error: `Failed to set goal hacks: ${error.message}` }, 500);
  }
}

/**
 * Goal Hacks Management: Add a hack to a specific goal
 */
async function handleAddGoalHack(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    const data = await request.json();
    const { goal, hack } = data;
    
    if (!goal || !hack) {
      return jsonResponse({ error: 'Goal and hack are required' }, 400);
    }
    
    const hacks = await getAllGoalHacks(env);
    
    // Initialize array for goal if it doesn't exist
    if (!hacks[goal]) {
      hacks[goal] = [];
    }
    
    // Add hack if not already present
    if (!hacks[goal].includes(hack)) {
      hacks[goal].push(hack);
      await saveGoalHacks(env, hacks);
    }
    
    return jsonResponse({ success: true, hacks: hacks });
  } catch (error) {
    console.error('Error adding goal hack:', error);
    return jsonResponse({ error: `Failed to add goal hack: ${error.message}` }, 500);
  }
}

/**
 * Goal Hacks Management: Remove a hack from a specific goal
 */
async function handleRemoveGoalHack(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    const data = await request.json();
    const { goal, index } = data;
    
    if (!goal || index === undefined) {
      return jsonResponse({ error: 'Goal and index are required' }, 400);
    }
    
    const hacks = await getAllGoalHacks(env);
    
    if (hacks[goal] && Array.isArray(hacks[goal]) && index >= 0 && index < hacks[goal].length) {
      hacks[goal].splice(index, 1);
      await saveGoalHacks(env, hacks);
    }
    
    return jsonResponse({ success: true, hacks: hacks });
  } catch (error) {
    console.error('Error removing goal hack:', error);
    return jsonResponse({ error: `Failed to remove goal hack: ${error.message}` }, 500);
  }
}

// === Protocol Images Handlers ===

const PROTOCOL_IMAGES_KEY = 'protocol_images';

/**
 * Get all protocol images
 */
async function handleGetAllProtocolImages(request, env) {
  try {
    if (!env || !env.page_content) {
      console.warn('Protocol images: Storage not available, returning empty response');
      return jsonResponse({ success: true, images: {}, storageUnavailable: true });
    }
    const imagesStr = await env.page_content.get(PROTOCOL_IMAGES_KEY);
    let images = {};
    if (imagesStr) {
      try {
        images = JSON.parse(imagesStr);
      } catch (parseError) {
        console.error('Error parsing protocol images JSON, returning empty:', parseError);
      }
    }
    return jsonResponse({ success: true, images });
  } catch (error) {
    console.error('Error getting protocol images:', error);
    return jsonResponse({ error: `Failed to get protocol images: ${error.message}` }, 500);
  }
}

/**
 * Get single protocol image
 */
async function handleGetProtocolImage(request, env) {
  try {
    const url = new URL(request.url);
    const protocolId = url.searchParams.get('protocol');
    
    if (!protocolId) {
      return jsonResponse({ error: 'Protocol ID is required' }, 400);
    }
    
    if (!env || !env.page_content) {
      console.warn('Protocol images: Storage not available for single image request');
      return jsonResponse({ success: true, imageUrl: null, protocolId, storageUnavailable: true });
    }
    
    const imagesStr = await env.page_content.get(PROTOCOL_IMAGES_KEY);
    let images = {};
    if (imagesStr) {
      try {
        images = JSON.parse(imagesStr);
      } catch (parseError) {
        console.error('Error parsing protocol images JSON:', parseError);
      }
    }
    const imageUrl = images[protocolId] || null;
    
    return jsonResponse({ success: true, imageUrl, protocolId });
  } catch (error) {
    console.error('Error getting protocol image:', error);
    return jsonResponse({ error: `Failed to get protocol image: ${error.message}` }, 500);
  }
}

/**
 * Upload protocol image (base64 encoded)
 */
async function handleUploadProtocolImage(request, env) {
  try {
    const body = await request.json();
    const { protocolId, imageData, mimeType } = body;
    
    if (!protocolId || !imageData) {
      return jsonResponse({ error: 'Protocol ID and image data are required' }, 400);
    }
    
    // Validate protocol ID
    const validProtocols = [
      'insulin_resistance', 'autoimmune_aip', 'gi_issues', 'menopause_sarcopenia',
      'cellulite_reduction', 'chronic_stress', 'postpartum_lactation', 'visceral_fat',
      'post_smoking', 'longevity', 'detox'
    ];
    
    if (!validProtocols.includes(protocolId)) {
      return jsonResponse({ error: 'Invalid protocol ID' }, 400);
    }
    
    // Validate mime type (required)
    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!mimeType || !allowedMimeTypes.includes(mimeType)) {
      return jsonResponse({ error: 'Invalid or missing image type. Allowed: PNG, JPG, WebP' }, 400);
    }
    
    // Validate image data format and size
    if (!imageData.startsWith('data:image/')) {
      return jsonResponse({ error: 'Invalid image data format' }, 400);
    }
    
    // Calculate approximate file size from base64 (base64 adds ~33% overhead)
    const base64Data = imageData.split(',')[1] || '';
    const approximateSize = (base64Data.length * 3) / 4;
    const maxSizeBytes = 500 * 1024; // 500KB limit
    
    if (approximateSize > maxSizeBytes) {
      return jsonResponse({ error: `Image too large. Maximum size: 500KB (received ~${Math.round(approximateSize / 1024)}KB)` }, 400);
    }
    
    // Get existing images
    if (!env || !env.page_content) {
      return jsonResponse({ error: 'Storage not available' }, 500);
    }
    const imagesStr = await env.page_content.get(PROTOCOL_IMAGES_KEY);
    let images = {};
    if (imagesStr) {
      try {
        images = JSON.parse(imagesStr);
      } catch (parseError) {
        console.error('Error parsing protocol images JSON, starting fresh:', parseError);
      }
    }
    
    // Store the base64 image directly (for simplicity - in production you'd use R2 or external storage)
    images[protocolId] = imageData;
    
    // Save to KV
    await env.page_content.put(PROTOCOL_IMAGES_KEY, JSON.stringify(images));
    
    return jsonResponse({ 
      success: true, 
      imageUrl: imageData,
      message: 'Image uploaded successfully' 
    });
  } catch (error) {
    console.error('Error uploading protocol image:', error);
    return jsonResponse({ error: `Failed to upload protocol image: ${error.message}` }, 500);
  }
}

/**
 * Delete protocol image
 */
async function handleDeleteProtocolImage(request, env) {
  try {
    const body = await request.json();
    const { protocolId } = body;
    
    if (!protocolId) {
      return jsonResponse({ error: 'Protocol ID is required' }, 400);
    }
    
    // Get existing images
    if (!env || !env.page_content) {
      return jsonResponse({ error: 'Storage not available' }, 500);
    }
    const imagesStr = await env.page_content.get(PROTOCOL_IMAGES_KEY);
    let images = {};
    if (imagesStr) {
      try {
        images = JSON.parse(imagesStr);
      } catch (parseError) {
        console.error('Error parsing protocol images JSON:', parseError);
      }
    }
    
    // Delete the image
    if (images[protocolId]) {
      delete images[protocolId];
      await env.page_content.put(PROTOCOL_IMAGES_KEY, JSON.stringify(images));
    }
    
    return jsonResponse({ success: true, message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error deleting protocol image:', error);
    return jsonResponse({ error: `Failed to delete protocol image: ${error.message}` }, 500);
  }
}

// === UI Images Handlers ===

const UI_IMAGES_KEY = 'ui_images';

// Zone definitions — used for validation
const UI_IMAGE_ZONES = [
  'index_hero',
  'analysis_header',
  'profile_cover',
  'guidelines_banner',
  'plan_pending_bg',
  'plan_greeting',
  'questionnaire2_bg',
];

/**
 * Public: get all UI zone images (no auth required)
 */
async function handleGetAllUIImages(request, env) {
  try {
    if (!env || !env.page_content) {
      return jsonResponse({ success: true, images: {}, storageUnavailable: true });
    }
    const raw = await env.page_content.get(UI_IMAGES_KEY);
    let images = {};
    if (raw) {
      try { images = JSON.parse(raw); } catch (parseError) { console.error('Error parsing UI images JSON:', parseError); }
    }
    return jsonResponse({ success: true, images }, 200, {
      cacheControl: 'public, max-age=1800' // Cache for 30 minutes - UI images change rarely
    });
  } catch (error) {
    console.error('Error getting UI images:', error);
    return jsonResponse({ error: `Failed to get UI images: ${error.message}` }, 500);
  }
}

/**
 * Admin: upload (or replace) a UI zone image
 */
async function handleUploadUIImage(request, env) {
  try {
    const body = await request.json();
    const { zoneId, imageData, mimeType } = body;

    if (!zoneId || !imageData) {
      return jsonResponse({ error: 'zoneId and imageData are required' }, 400);
    }
    if (!UI_IMAGE_ZONES.includes(zoneId)) {
      return jsonResponse({ error: 'Invalid zoneId' }, 400);
    }

    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!mimeType || !allowedMimeTypes.includes(mimeType)) {
      return jsonResponse({ error: 'Invalid or missing image type. Allowed: PNG, JPG, WebP' }, 400);
    }
    if (!imageData.startsWith('data:image/')) {
      return jsonResponse({ error: 'Invalid image data format' }, 400);
    }

    const base64Data = imageData.split(',')[1] || '';
    const approximateSize = (base64Data.length * 3) / 4;
    const maxSizeBytes = 1024 * 1024; // 1 MB
    if (approximateSize > maxSizeBytes) {
      return jsonResponse({ error: `Image too large. Maximum size: 1MB (received ~${Math.round(approximateSize / 1024)}KB)` }, 400);
    }

    if (!env || !env.page_content) {
      return jsonResponse({ error: 'Storage not available' }, 500);
    }

    const raw = await env.page_content.get(UI_IMAGES_KEY);
    let images = {};
    if (raw) {
      try { images = JSON.parse(raw); } catch (parseError) { console.error('Error parsing UI images JSON:', parseError); }
    }

    images[zoneId] = imageData;
    await env.page_content.put(UI_IMAGES_KEY, JSON.stringify(images));

    return jsonResponse({ success: true, message: 'UI image uploaded successfully' });
  } catch (error) {
    console.error('Error uploading UI image:', error);
    return jsonResponse({ error: `Failed to upload UI image: ${error.message}` }, 500);
  }
}

/**
 * Admin: delete a UI zone image
 */
async function handleDeleteUIImage(request, env) {
  try {
    const body = await request.json();
    const { zoneId } = body;

    if (!zoneId) {
      return jsonResponse({ error: 'zoneId is required' }, 400);
    }

    if (!env || !env.page_content) {
      return jsonResponse({ error: 'Storage not available' }, 500);
    }

    const raw = await env.page_content.get(UI_IMAGES_KEY);
    let images = {};
    if (raw) {
      try { images = JSON.parse(raw); } catch (parseError) { console.error('Error parsing UI images JSON:', parseError); }
    }

    if (images[zoneId]) {
      delete images[zoneId];
      await env.page_content.put(UI_IMAGES_KEY, JSON.stringify(images));
    }

    return jsonResponse({ success: true, message: 'UI image deleted successfully' });
  } catch (error) {
    console.error('Error deleting UI image:', error);
    return jsonResponse({ error: `Failed to delete UI image: ${error.message}` }, 500);
  }
}

/**
 * Convert base64url string to Uint8Array
 */
function base64UrlToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Convert Uint8Array to base64url string
 */
function uint8ArrayToBase64Url(uint8Array) {
  const base64 = btoa(String.fromCharCode.apply(null, uint8Array));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Convert raw VAPID keys (base64url format) to JWK format
 * 
 * The web-push library generates VAPID keys as base64url-encoded raw keys.
 * However, Web Crypto API requires EC private keys to be imported in either
 * PKCS8 or JWK format. This function converts the raw keys to JWK format.
 * 
 * @param {string} publicKeyBase64Url - VAPID public key in base64url format
 * @param {string} privateKeyBase64Url - VAPID private key in base64url format
 * @returns {Object} JWK object for the private key
 */
function vapidKeysToJWK(publicKeyBase64Url, privateKeyBase64Url) {
  // Decode the public key (65 bytes: 0x04 + 32 bytes x + 32 bytes y)
  const publicKeyBytes = base64UrlToUint8Array(publicKeyBase64Url);
  
  if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04) {
    throw new Error('Invalid VAPID public key format. Expected 65 bytes starting with 0x04.');
  }
  
  // Extract x and y coordinates (32 bytes each)
  const x = publicKeyBytes.slice(1, 33);
  const y = publicKeyBytes.slice(33, 65);
  
  // The private key is the scalar d (32 bytes)
  const d = base64UrlToUint8Array(privateKeyBase64Url);
  
  if (d.length !== 32) {
    throw new Error('Invalid VAPID private key format. Expected 32 bytes.');
  }
  
  // Create JWK object
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: uint8ArrayToBase64Url(x),
    y: uint8ArrayToBase64Url(y),
    d: uint8ArrayToBase64Url(d)
  };
  
  return jwk;
}

/**
 * Encrypt payload for Web Push using RFC 8291 (aes128gcm)
 * 
 * @param {string} payload - The message payload to encrypt
 * @param {string} userPublicKey - Base64url-encoded user agent public key (p256dh)
 * @param {string} userAuth - Base64url-encoded user agent auth secret
 * @returns {Promise<Object>} Encrypted data with salt and public key
 */
async function encryptWebPushPayload(payload, userPublicKey, userAuth) {
  // Generate a random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  // Generate a local key pair (application server keys for this message)
  const localKeyPair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveBits']
  ));
  
  // Export local public key in raw format
  const localPublicKey = /** @type {ArrayBuffer} */ (await crypto.subtle.exportKey('raw', localKeyPair.publicKey));
  const localPublicKeyBytes = new Uint8Array(localPublicKey);
  
  // Decode user's public key and auth secret
  const userPublicKeyBytes = base64UrlToUint8Array(userPublicKey);
  const userAuthBytes = base64UrlToUint8Array(userAuth);
  
  // Import user's public key for ECDH
  // Public ECDH keys must have empty keyUsages; only the private key uses deriveBits.
  const importedUserPublicKey = await crypto.subtle.importKey(
    'raw',
    userPublicKeyBytes,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    []
  );
  
  // Perform ECDH to get shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    /** @type {any} */({
      name: 'ECDH',
      public: importedUserPublicKey
    }),
    localKeyPair.privateKey,
    256
  );
  
  // Derive keys using HKDF as per RFC 8291
  // Step 1: Derive IKM (Input Keying Material) from shared secret and auth
  // Per RFC 8291: IKM = HKDF-Extract(auth_secret, shared_secret)
  const authInfo = new TextEncoder().encode('Content-Encoding: auth\0');
  const ikm = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: userAuthBytes, // auth secret as salt
      info: authInfo
    },
    await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveBits']),
    256
  );
  
  // Step 2: Build context for key and nonce derivation
  // Context = clientPublicKey || serverPublicKey
  const context = new Uint8Array(userPublicKeyBytes.length + localPublicKeyBytes.length);
  context.set(userPublicKeyBytes, 0);
  context.set(localPublicKeyBytes, userPublicKeyBytes.length);
  
  // Step 3: Derive Content Encryption Key (CEK)
  const keyInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const keyInfoFull = new Uint8Array(keyInfo.length + context.length);
  keyInfoFull.set(keyInfo, 0);
  keyInfoFull.set(context, keyInfo.length);
  
  const cek = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt,
      info: keyInfoFull
    },
    await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']),
    128 // 16 bytes for AES-128
  );
  
  // Step 4: Derive Nonce
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonceInfoFull = new Uint8Array(nonceInfo.length + context.length);
  nonceInfoFull.set(nonceInfo, 0);
  nonceInfoFull.set(context, nonceInfo.length);
  
  const nonce = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt,
      info: nonceInfoFull
    },
    await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']),
    96 // 12 bytes for GCM nonce
  );
  
  // Step 5: Prepare payload with padding
  const payloadBytes = new TextEncoder().encode(payload);
  const paddingLength = 0; // No padding for simplicity
  
  // Record format: padding_length (2 bytes) + padding + payload
  const record = new Uint8Array(2 + paddingLength + payloadBytes.length);
  record[0] = (paddingLength >> 8) & 0xFF;
  record[1] = paddingLength & 0xFF;
  record.set(payloadBytes, 2 + paddingLength);
  
  // Step 6: Encrypt the record with AES-128-GCM
  const cekKey = await crypto.subtle.importKey(
    'raw',
    cek,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(nonce),
      tagLength: 128
    },
    cekKey,
    record
  );
  
  // Return encrypted payload, salt, and server public key
  return {
    ciphertext: new Uint8Array(encrypted),
    salt: salt,
    publicKey: localPublicKeyBytes
  };
}

/**
 * Send Web Push notification with VAPID authentication and RFC 8291 encryption
 * 
 * @param {Object} subscription - Push subscription object with endpoint and keys
 * @param {string} payload - JSON string to send
 * @param {Object} env - Environment with VAPID keys
 * @returns {Promise<Response>} Push service response
 */
async function sendWebPushNotification(subscription, payload, env) {
  const vapidPublicKey = env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = env.VAPID_PRIVATE_KEY;
  
  if (!vapidPublicKey || !vapidPrivateKey) {
    throw new Error('VAPID keys not configured');
  }
  
  // Extract push service endpoint URL
  const endpoint = subscription.endpoint;
  const audienceUrl = new URL(endpoint);
  const audience = `${audienceUrl.protocol}//${audienceUrl.host}`;
  
  // Create JWT header and payload for VAPID
  const jwtHeader = {
    typ: 'JWT',
    alg: 'ES256'
  };
  
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours expiration
  const jwtPayload = {
    aud: audience,
    exp: exp,
    sub: env.VAPID_EMAIL || 'mailto:admin@biocode.website'
  };
  
  // Encode header and payload
  const headerEncoded = uint8ArrayToBase64Url(
    new TextEncoder().encode(JSON.stringify(jwtHeader))
  );
  const payloadEncoded = uint8ArrayToBase64Url(
    new TextEncoder().encode(JSON.stringify(jwtPayload))
  );
  
  const unsignedToken = `${headerEncoded}.${payloadEncoded}`;
  
  // Import VAPID private key for signing
  // Convert raw VAPID keys (from web-push generate-vapid-keys) to JWK format
  const privateKeyJwk = vapidKeysToJWK(vapidPublicKey, vapidPrivateKey);
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    false,
    ['sign']
  );
  
  // Sign the JWT
  const signature = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' }
    },
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );
  
  const signatureBase64 = uint8ArrayToBase64Url(new Uint8Array(signature));
  const jwt = `${unsignedToken}.${signatureBase64}`;
  
  // Encrypt payload using RFC 8291 (aes128gcm)
  // Modern browsers require encrypted payloads for Web Push
  let body;
  const headers = {
    'TTL': '86400', // 24 hours
    'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
    'Urgency': 'normal'
  };
  
  // Check if subscription has encryption keys (required for modern browsers)
  if (subscription.keys && subscription.keys.p256dh && subscription.keys.auth) {
    try {
      // Encrypt the payload
      const encrypted = await encryptWebPushPayload(
        payload,
        subscription.keys.p256dh,
        subscription.keys.auth
      );
      
      // Combine salt (16 bytes) + record size (4 bytes) + public key length (1 byte) + public key (65 bytes) + ciphertext
      const recordSize = 4096; // Standard record size
      const salt = encrypted.salt; // Random 16-byte salt from encryption
      const publicKey = encrypted.publicKey;
      
      // Build the encrypted message body per RFC 8291
      const header = new Uint8Array(16 + 4 + 1 + publicKey.length); // salt + rs + idlen + key
      header.set(salt, 0); // 16 bytes salt
      header[16] = (recordSize >> 24) & 0xFF; // 4 bytes record size (big-endian)
      header[17] = (recordSize >> 16) & 0xFF;
      header[18] = (recordSize >> 8) & 0xFF;
      header[19] = recordSize & 0xFF;
      header[20] = publicKey.length; // 1 byte key ID length
      header.set(publicKey, 21); // 65 bytes public key
      
      // Combine header and ciphertext
      body = new Uint8Array(header.length + encrypted.ciphertext.length);
      body.set(header, 0);
      body.set(encrypted.ciphertext, header.length);
      
      // Add encryption headers
      headers['Content-Type'] = 'application/octet-stream';
      headers['Content-Encoding'] = 'aes128gcm';
      
      console.log('Sending encrypted push notification');
    } catch (encryptError) {
      console.error('Encryption failed, falling back to plaintext:', encryptError);
      // Fallback to plaintext if encryption fails
      body = new TextEncoder().encode(payload);
      headers['Content-Type'] = 'application/octet-stream';
    }
  } else {
    // No encryption keys in subscription - send plaintext (for backwards compatibility)
    console.warn('No encryption keys in subscription, sending plaintext');
    body = new TextEncoder().encode(payload);
    headers['Content-Type'] = 'application/octet-stream';
  }
  
  // Send push notification to the push service
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: headers,
    body: body
  });
  
  return response;
}

/**
 * GET /api/notification-config[?v=<clientVersion>]
 * Returns the GameNotifier / Capacitor notification schedule config stored in KV.
 *
 * If the caller supplies the query param `?v=N` (the version it already has cached),
 * the handler reads ONLY the version key from KV. When the versions match it returns
 * { upToDate: true, version: N } without fetching or transmitting the full config
 * blob — one KV read, near-zero response bytes. This lets clients check for updates
 * on every app open without imposing meaningful backend cost.
 *
 * Response (version match):   { upToDate: true, version: <number> }
 * Response (version mismatch / no v param):  { success: true, config: {...}, version: <number> }
 */
async function handleGetNotificationConfig(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }
    const url = new URL(request.url);
    const clientVersionParam = url.searchParams.get('v');
    const verRaw = await env.page_content.get('notification-config-version');
    const version = verRaw ? parseInt(verRaw, 10) : 0;

    // Cheap path: client already has the current version — skip config KV read entirely.
    if (clientVersionParam !== null && parseInt(clientVersionParam, 10) === version) {
      return jsonResponse({ upToDate: true, version }, 200, { cacheControl: 'no-cache' });
    }

    const raw = await env.page_content.get('notification-config');
    const config = raw ? JSON.parse(raw) : null;
    return jsonResponse({ success: true, config, version }, 200, { cacheControl: 'no-cache' });
  } catch (error) {
    console.error('Error getting notification config:', error);
    return jsonResponse({ error: 'Failed to get notification config: ' + error.message }, 500);
  }
}

/**
 * POST /api/notification-config
 * Body: { config: { morningTime, eveningTime, morningTitle, morningBody, eveningTitle, eveningBody, ... } }
 * Saves the notification config to KV and increments the version so clients pick it up.
 */
async function handleSaveNotificationConfig(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }
    const body = await request.json();
    if (!body || typeof body.config !== 'object') {
      return jsonResponse({ error: 'Missing or invalid config field' }, 400);
    }
    // Bump version
    const verRaw = await env.page_content.get('notification-config-version');
    const version = (verRaw ? parseInt(verRaw, 10) : 0) + 1;
    await env.page_content.put('notification-config', JSON.stringify(body.config));
    await env.page_content.put('notification-config-version', String(version));
    console.log('Notification config saved, version:', version);
    return jsonResponse({ success: true, version });
  } catch (error) {
    console.error('Error saving notification config:', error);
    return jsonResponse({ error: 'Failed to save notification config: ' + error.message }, 500);
  }
}

/**
 * GET /api/calendar.ics
 * Returns a dynamic iCalendar (.ics) feed for the next 60 days with morning and
 * evening check-in reminders sourced from the global notification-config KV key.
 *
 * Calendar apps (Huawei Calendar, iOS Calendar, Google Calendar, Outlook) subscribe
 * once via a webcal:// link and re-fetch the feed ~daily, so any admin config change
 * (times, titles) propagates automatically within 24 h without any client-side action.
 * UIDs are deterministic (date + type) so apps update existing events on re-fetch
 * instead of creating duplicates.
 */
async function handleGetCalendarIcs(request, env) {
  const WORKER_BASE = new URL(request.url).origin;
  const DAYS = 60;

  // Read global notification config from KV (same data store as /api/notification-config)
  const defaults = {
    morningTime:  '07:00',
    morningTitle: 'AI Асистент',
    morningBody:  'Спахте ли добре тази нощ?',
    eveningActivityTime:  '20:00',
    eveningActivityTitle: 'AI Асистент',
    eveningActivityBody:  'Ниво на активност?',
    eveningBalanceTime:   '20:05',
    eveningBalanceTitle:  'AI Асистент',
    eveningBalanceBody:   'Емоционален баланс?',
    eveningWaterTime:     '20:10',
    eveningWaterTitle:    'AI Асистент',
    eveningWaterBody:     'Изпихте ли поне 2 л вода?',
    eveningTime:  '20:00',
  };
  let cfg = Object.assign({}, defaults);
  try {
    if (env.page_content) {
      const raw = await env.page_content.get('notification-config');
      if (raw) cfg = Object.assign(cfg, JSON.parse(raw));
    }
  } catch (_) {}

  const pad = n => String(n).padStart(2, '0');
  function offsetTimeString(timeStr, addMinutes) {
    const parts = String(timeStr || '20:00').split(':').map(Number);
    const d = new Date(2000, 0, 1, parts[0] || 20, parts[1] || 0, 0, 0);
    d.setMinutes(d.getMinutes() + addMinutes);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const legacyEvening = cfg.eveningTime || '20:00';
  cfg.eveningActivityTime = cfg.eveningActivityTime || legacyEvening;
  cfg.eveningBalanceTime = cfg.eveningBalanceTime || offsetTimeString(legacyEvening, 5);
  cfg.eveningWaterTime = cfg.eveningWaterTime || offsetTimeString(legacyEvening, 10);
  cfg.eveningActivityTitle = cfg.eveningActivityTitle || cfg.eveningTitle || defaults.eveningActivityTitle;
  cfg.eveningBalanceTitle = cfg.eveningBalanceTitle || cfg.eveningTitle || defaults.eveningBalanceTitle;
  cfg.eveningWaterTitle = cfg.eveningWaterTitle || cfg.eveningTitle || defaults.eveningWaterTitle;
  cfg.eveningActivityBody = cfg.eveningActivityBody || defaults.eveningActivityBody;
  cfg.eveningBalanceBody = cfg.eveningBalanceBody || defaults.eveningBalanceBody;
  cfg.eveningWaterBody = cfg.eveningWaterBody || defaults.eveningWaterBody;

  const [mH, mM] = cfg.morningTime.split(':').map(Number);
  const eveningSlots = [
    { type: 'evening_activity', time: cfg.eveningActivityTime, title: cfg.eveningActivityTitle, body: cfg.eveningActivityBody },
    { type: 'evening_balance', time: cfg.eveningBalanceTime, title: cfg.eveningBalanceTitle, body: cfg.eveningBalanceBody },
    { type: 'evening_water', time: cfg.eveningWaterTime, title: cfg.eveningWaterTitle, body: cfg.eveningWaterBody }
  ];

  function fmtDt(d) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T` +
           `${pad(d.getHours())}${pad(d.getMinutes())}00`;
  }
  // Escape iCal text fields (RFC 5545 §3.3.11)
  function esc(s) {
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n?|\n/g, '\\n');
  }

  const dtstamp = fmtDt(new Date());

  function makeEvent(type, day, h, m, title, body) {
    const d = new Date(day);
    d.setHours(h, m, 0, 0);
    const dEnd = new Date(d.getTime() + 15 * 60 * 1000);
    const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    // Deterministic UID: same event on re-fetch updates instead of duplicating
    const uid = `nutriplan-${type}-${dateStr}@aidiet.radilov-k.workers.dev`;
    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${fmtDt(d)}`,
      `DTEND:${fmtDt(dEnd)}`,
      `SUMMARY:${esc(title)}`,
      `DESCRIPTION:${esc(body)}`,
      `URL:${WORKER_BASE}/plan.html`,
      'BEGIN:VALARM',
      'TRIGGER:-PT0M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(title)}`,
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  }

  const events = [];
  const today = new Date();
  for (let i = 0; i < DAYS; i++) {
    const day = new Date(today);
    day.setDate(day.getDate() + i);
    events.push(makeEvent('morning', day, mH, mM, cfg.morningTitle, cfg.morningBody));
    eveningSlots.forEach((slot) => {
      const parts = String(slot.time || '20:00').split(':').map(Number);
      if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return;
      events.push(makeEvent(slot.type, day, parts[0], parts[1], slot.title, slot.body));
    });
    // Extra / custom notifications
    const extras = Array.isArray(cfg.extraNotifications) ? cfg.extraNotifications : [];
    extras.forEach((extra, idx) => {
      if (!extra || !extra.time) return;
      const parts = String(extra.time).split(':').map(Number);
      if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return;
      events.push(makeEvent('extra_' + idx, day, parts[0], parts[1],
        extra.title || 'NutriPlan', extra.body || ''));
    });
  }

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NutriPlan//AiDiet//BG',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:NutriPlan Напомняния',
    'X-WR-CALDESC:Сутрешни и вечерни напомняния за вашия диетичен план',
    'REFRESH-INTERVAL;VALUE=DURATION:PT24H',
    'X-PUBLISHED-TTL:PT24H',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="nutriplan-reminders.ics"',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * Push Notifications: Get VAPID public key
 * 
 * Returns the VAPID public key needed for push notification subscription.
 * The public key must be configured in the VAPID_PUBLIC_KEY environment variable.
 * 
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings including VAPID_PUBLIC_KEY
 * @returns {Promise<Response>} JSON response with publicKey field
 * 
 * @example
 * // Request
 * GET /api/push/vapid-public-key
 * 
 * // Response
 * {
 *   "success": true,
 *   "publicKey": "BG3xG3xG..."
 * }
 */
async function handleGetVapidPublicKey(request, env) {
  try {
    // VAPID keys should be stored in environment variables
    // For development, return a placeholder
    const publicKey = env.VAPID_PUBLIC_KEY || 'VAPID_PUBLIC_KEY_NOT_CONFIGURED';
    
    return jsonResponse({ 
      success: true,
      publicKey: publicKey
    });
  } catch (error) {
    console.error('Error getting VAPID public key:', error);
    return jsonResponse({ error: 'Failed to get VAPID public key: ' + error.message }, 500);
  }
}

/**
 * Admin: Get AI logging status
 * Note: AI logging is always enabled to maintain last complete communication log
 */
async function handleGetLoggingStatus(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const enabled = await isAILoggingEnabled(env);
    return jsonResponse({
      success: true,
      enabled: enabled,
      message: enabled
        ? 'AI логването е включено'
        : 'AI логването е изключено'
    }, 200, {
      cacheControl: 'no-cache'
    });
  } catch (error) {
    console.error('Error getting logging status:', error);
    return jsonResponse({ error: 'Failed to get logging status: ' + error.message }, 500);
  }
}

/**
 * Admin: Set AI logging status
 * Saves the enabled/disabled state to KV so it persists across worker invocations.
 */
async function handleSetLoggingStatus(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const data = await request.json();
    const enabled = data.enabled === true || data.enabled === 'true';

    await env.page_content.put('ai_logging_enabled', enabled ? 'true' : 'false');

    // Update module-scope cache immediately so subsequent calls in this invocation
    // reflect the new state without waiting for the TTL to expire.
    loggingStatusCache = enabled;
    loggingStatusCacheTime = Date.now();

    console.log(`AI logging ${enabled ? 'enabled' : 'disabled'}`);
    return jsonResponse({
      success: true,
      enabled: enabled,
      message: enabled
        ? 'AI логването е включено'
        : 'AI логването е изключено'
    });
  } catch (error) {
    console.error('Error setting logging status:', error);
    return jsonResponse({ error: 'Failed to set logging status: ' + error.message }, 500);
  }
}

/**
 * Push Notifications: Subscribe user to push notifications
 * 
 * Stores the push subscription in KV storage for the given user.
 * The subscription can later be used to send push notifications.
 * 
 * @param {Request} request - The incoming request with userId and subscription
 * @param {Object} env - Environment bindings including page_content KV namespace
 * @returns {Promise<Response>} JSON response confirming subscription
 * 
 * @example
 * // Request
 * POST /api/push/subscribe
 * {
 *   "userId": "user123",
 *   "subscription": {
 *     "endpoint": "https://...",
 *     "keys": { "p256dh": "...", "auth": "..." }
 *   }
 * }
 * 
 * // Response
 * {
 *   "success": true,
 *   "message": "Subscription saved successfully"
 * }
 */
async function handlePushSubscribe(request, env) {
  try {
    const { userId, subscription } = await request.json();
    
    if (!userId || !subscription) {
      return jsonResponse({ error: 'Missing userId or subscription' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Store subscription in KV with user ID as key
    const subscriptionKey = `push_subscription_${userId}`;
    await env.page_content.put(subscriptionKey, JSON.stringify(subscription));
    
    // Maintain a list of all subscribed users for cron job processing
    const listKey = 'push_subscriptions_list';
    let userIdsList = [];
    
    const existingListData = await env.page_content.get(listKey);
    if (existingListData) {
      userIdsList = JSON.parse(existingListData);
    }
    
    // Add userId if not already in list
    if (!userIdsList.includes(userId)) {
      userIdsList.push(userId);
      await env.page_content.put(listKey, JSON.stringify(userIdsList));
      console.log(`Added user ${userId} to subscriptions list`);
    }
    
    console.log(`Push subscription saved for user: ${userId}`);
    
    return jsonResponse({ 
      success: true,
      message: 'Subscription saved successfully'
    });
  } catch (error) {
    console.error('Error saving push subscription:', error);
    return jsonResponse({ error: 'Failed to save subscription: ' + error.message }, 500);
  }
}

/**
 * Push Notifications: Send push notification to user
 * 
 * Retrieves the user's push subscription from KV and sends a push notification.
 * This is a simplified implementation - production use requires Web Push protocol
 * with proper VAPID authentication and encryption.
 * 
 * @param {Request} request - The incoming request with userId, title, body, and url
 * @param {Object} env - Environment bindings including page_content KV and VAPID keys
 * @returns {Promise<Response>} JSON response confirming notification sent
 * 
 * @example
 * // Request
 * POST /api/push/send
 * {
 *   "userId": "user123",
 *   "title": "Време за обяд!",
 *   "body": "Не забравяйте да се храните според плана си",
 *   "url": "/plan.html"
 * }
 * 
 * // Response
 * {
 *   "success": true,
 *   "message": "Push notification sent"
 * }
 * 
 * @note Requires VAPID keys to be configured for production use
 * @todo Implement actual Web Push protocol with web-push library
 */
async function handlePushSend(request, env) {
  try {
    const { userId, title, body, url, icon, notificationType } = await request.json();
    
    if (!userId) {
      return jsonResponse({ error: 'Missing userId' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Retrieve subscription from KV
    const subscriptionKey = `push_subscription_${userId}`;
    const subscriptionData = await env.page_content.get(subscriptionKey);
    
    if (!subscriptionData) {
      return jsonResponse({ error: 'No subscription found for user' }, 404);
    }

    const subscription = JSON.parse(subscriptionData);
    
    // Prepare push message
    const pushMessage = {
      title: title || 'NutriPlan',
      body: body || 'Ново напомняне от NutriPlan',
      url: url || '/plan.html',
      icon: icon || '/icon-192x192.png',
      notificationType: notificationType || 'general',
      timestamp: Date.now()
    };

    console.log(`Sending push notification to user ${userId}:`, pushMessage);
    
    // Check if VAPID keys are configured
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      console.warn('VAPID keys not configured. Notification not sent.');
      return jsonResponse({ 
        success: false,
        message: 'VAPID keys not configured',
        note: 'Please configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables'
      }, 500);
    }
    
    // Send the push notification using Web Push protocol
    try {
      const response = await sendWebPushNotification(
        subscription,
        JSON.stringify(pushMessage),
        env
      );
      
      if (response.ok || response.status === 201) {
        console.log(`Push notification sent successfully to user ${userId}`);
        return jsonResponse({ 
          success: true,
          message: 'Push notification sent successfully'
        });
      } else {
        console.error(`Push service returned status ${response.status}:`, await response.text());
        return jsonResponse({ 
          success: false,
          message: `Push service error: ${response.status}`,
          statusCode: response.status
        }, 500);
      }
    } catch (pushError) {
      console.error('Error sending push notification:', pushError);
      return jsonResponse({ 
        success: false,
        error: 'Failed to send push notification: ' + pushError.message 
      }, 500);
    }
  } catch (error) {
    console.error('Error in handlePushSend:', error);
    return jsonResponse({ error: 'Failed to process notification request: ' + error.message }, 500);
  }
}

/**
 * Admin: Save notification settings
 * 
 * Saves global notification settings for the system
 * 
 * @param {Request} request - Request with notification settings
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response
 */
async function handleSaveNotificationSettings(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const settings = await request.json();
    
    // Validate settings structure
    const validSettings = {
      planRegeneration: settings.planRegeneration !== false
    };

    await env.page_content.put('notification_settings', JSON.stringify(validSettings));
    
    // Update version number to invalidate client cache
    const version = Date.now();
    await env.page_content.put('notification_settings_version', version.toString());
    
    console.log('Notification settings saved with version:', version);
    
    return jsonResponse({ 
      success: true,
      message: 'Настройките за известия са запазени',
      settings: validSettings,
      version: version
    });
  } catch (error) {
    console.error('Error saving notification settings:', error);
    return jsonResponse({ error: 'Failed to save notification settings: ' + error.message }, 500);
  }
}

/**
 * Admin: Get notification settings
 * 
 * Retrieves global notification settings
 * 
 * @param {Request} request - Request object
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response with settings
 */
async function handleGetNotificationSettings(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const settingsData = await env.page_content.get('notification_settings');
    
    // Default settings if none exist
    const defaultSettings = {
      planRegeneration: true
    };

    const parsedSettings = settingsData ? JSON.parse(settingsData) : defaultSettings;
    const settings = {
      planRegeneration: parsedSettings.planRegeneration !== false
    };
    
    // Get version from KV or use current timestamp
    const versionData = await env.page_content.get('notification_settings_version');
    const version = versionData ? parseInt(versionData) : Date.now();
    
    return jsonResponse({ 
      success: true,
      settings: settings,
      version: version
    });
  } catch (error) {
    console.error('Error getting notification settings:', error);
    return jsonResponse({ error: 'Failed to get notification settings: ' + error.message }, 500);
  }
}

/**
 * Admin: Get list of subscribed users
 * 
 * Returns list of users who have subscribed to push notifications
 * 
 * @param {Request} request - Request object
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response with subscriptions count
 */
async function handleGetSubscriptions(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const listData = await env.page_content.get('push_subscriptions_list');
    const userIds = listData ? JSON.parse(listData) : [];

    return jsonResponse({ 
      success: true,
      userIds,
      count: userIds.length
    });
  } catch (error) {
    console.error('Error getting subscriptions:', error);
    return jsonResponse({ error: 'Failed to get subscriptions: ' + error.message }, 500);
  }
}

/**
 * User: Get user notification preferences
 * 
 * Retrieves notification preferences for a specific user
 * 
 * @param {Request} request - Request object with userId parameter
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response with user preferences
 */
async function handleGetUserNotificationPreferences(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    
    if (!userId) {
      return jsonResponse({ error: 'Missing userId parameter' }, 400);
    }

    const preferencesKey = `notification_preferences_${userId}`;
    const preferencesData = await env.page_content.get(preferencesKey);
    
    // Default preferences if none exist
    const defaultPreferences = {
      enabled: true,
      meals: { enabled: true, advanceMinutes: 60 },
      water: { enabled: true },
      sleep: { enabled: true, time: '22:00' },
      activity: { enabled: true, morningTime: '07:00', dayTime: '15:00' },
      supplements: { enabled: true }
    };

    const preferences = preferencesData ? JSON.parse(preferencesData) : defaultPreferences;
    
    return jsonResponse({ 
      success: true,
      preferences: preferences
    });
  } catch (error) {
    console.error('Error getting user notification preferences:', error);
    return jsonResponse({ error: 'Failed to get preferences: ' + error.message }, 500);
  }
}

/**
 * User: Save user notification preferences
 * 
 * Saves notification preferences for a specific user
 * 
 * @param {Request} request - Request with userId and preferences
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response
 */
async function handleSaveUserNotificationPreferences(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const { userId, preferences } = await request.json();
    
    if (!userId || !preferences) {
      return jsonResponse({ error: 'Missing userId or preferences' }, 400);
    }

    const preferencesKey = `notification_preferences_${userId}`;
    await env.page_content.put(preferencesKey, JSON.stringify(preferences));
    
    console.log(`Notification preferences saved for user: ${userId}`);
    
    return jsonResponse({ 
      success: true,
      message: 'Preferences saved successfully',
      preferences: preferences
    });
  } catch (error) {
    console.error('Error saving user notification preferences:', error);
    return jsonResponse({ error: 'Failed to save preferences: ' + error.message }, 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Social Authentication (Firebase ID Token)
// ─────────────────────────────────────────────────────────────────────────────

// Clock-skew tolerance when validating `iat` (issued-at) in Firebase JWTs.
const FIREBASE_CLOCK_SKEW_TOLERANCE_SECONDS = 300; // 5 minutes

// How long to cache Google's JWKS response in Cloudflare's Cache API.
const JWKS_CACHE_TTL_SECONDS = 3600; // 1 hour – keys rotate ~daily

// Prefix used when minting an internal userId from a Firebase UID for
// the first time.  Stable prefix makes it easy to identify Firebase-sourced
// user IDs in KV and lets existing anonymous IDs (no prefix) coexist.
const FIREBASE_USER_ID_PREFIX = 'fb_';

/**
 * Verify a Firebase ID Token using Google's public JWKS endpoint.
 *
 * Firebase issues JWTs (RS256) signed with Google's private keys; the matching
 * public keys are published at the JWKS URL below.  We use the Web Crypto API
 * so this works natively inside Cloudflare Workers without any npm packages.
 *
 * @param {string} idToken  - Firebase ID token from the frontend
 * @param {object} env      - Worker env (needs FIREBASE_PROJECT_ID)
 * @returns {Promise<{ uid: any, email: any, name: any, picture: any, provider: any }>}
 */
async function verifyFirebaseIdToken(idToken, env) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  // base64url → base64 → string
  const b64decode = (s) => {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
    return JSON.parse(atob(pad));
  };

  const header  = b64decode(parts[0]);
  const payload = b64decode(parts[1]);

  // ── Basic claim validation ───────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  if (!payload.sub)                                                           throw new Error('Missing uid (sub)');
  if (payload.exp < now)                                                      throw new Error('Token expired');
  if (payload.iat > now + FIREBASE_CLOCK_SKEW_TOLERANCE_SECONDS)             throw new Error('Token issued in the future');
  if (payload.aud !== env.FIREBASE_PROJECT_ID)                               throw new Error('Invalid audience');
  const expectedIss = `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`;
  if (payload.iss !== expectedIss)                                           throw new Error('Invalid issuer');

  // ── Fetch Google's public JWKS (with Cache-API caching for perf) ─────────
  const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
  const jwksRes = await fetch(JWKS_URL, { cf: { cacheTtl: JWKS_CACHE_TTL_SECONDS } });
  if (!jwksRes.ok) throw new Error('Failed to fetch JWKS');
  const { keys } = await jwksRes.json();

  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('No matching public key for kid=' + header.kid);

  // ── Import public key and verify signature ───────────────────────────────
  const cryptoKey = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  );

  const sigBytes  = Uint8Array.from(
    atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
    c => c.charCodeAt(0)
  );
  const dataBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sigBytes, dataBytes);
  if (!valid) throw new Error('Invalid JWT signature');

  return {
    uid:      payload.sub,
    email:    payload.email   || null,
    name:     payload.name    || null,
    picture:  payload.picture || null,
    provider: (payload.firebase && payload.firebase.sign_in_provider) || null,
  };
}

/**
 * POST /api/auth/social
 *
 * Exchanges a Firebase ID Token (issued by Firebase Auth after Google Sign-In)
 * for an internal userId stored in KV.
 *
 * Body:   { idToken: "<firebase-id-token>" }
 * Returns { success, userId, uid, email, name, picture, provider }
 */
async function handleSocialAuth(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    if (!env.FIREBASE_PROJECT_ID) {
      return jsonResponse({ error: 'Firebase is not configured on the server (missing FIREBASE_PROJECT_ID secret)' }, 500);
    }

    const body = await request.json();
    const { idToken } = body || {};
    if (!idToken || typeof idToken !== 'string') {
      return jsonResponse({ error: 'Missing or invalid idToken' }, 400);
    }

    // Verify the token with Google's public keys
    let firebaseUser;
    try {
      firebaseUser = await verifyFirebaseIdToken(idToken, env);
    } catch (err) {
      console.warn('Social auth – token verification failed:', err.message);
      return jsonResponse({ error: 'Token verification failed: ' + err.message }, 401);
    }

    const { uid, email, name, picture, provider } = firebaseUser;

    // ── Resolve or create internal userId ────────────────────────────────────
    // Key is auth:{uid} – one stable userId per Google account.
    const kvKey   = `auth:${uid}`;
    const stored  = await env.page_content.get(kvKey);
    let   userId;

    if (stored) {
      userId = JSON.parse(stored).userId;
    } else {
      // First-time login: mint a stable internal id derived from the Firebase uid
      userId = FIREBASE_USER_ID_PREFIX + uid;
      await env.page_content.put(kvKey, JSON.stringify({
        userId,
        uid,
        email,
        name,
        provider,
        createdAt: new Date().toISOString(),
      }));
      console.log(`Social auth – new user created: userId=${userId} provider=${provider}`);
    }

    console.log(`Social auth – login ok: userId=${userId} provider=${provider}`);
    return jsonResponse({ success: true, userId, uid, email, name, picture, provider });
  } catch (error) {
    console.error('Social auth error:', error);
    return jsonResponse({ error: 'Authentication failed: ' + error.message }, 500);
  }
}

function getEffectivePlanUpdatedAt(profile) {
  if (!profile) return null;
  return profile.planUpdatedAt || profile.savedAt || null;
}

async function upsertUserProfilePlan(env, userId, updates) {
  const ttl = userId.startsWith('fb_')
    ? 365 * 24 * 60 * 60
    : 90 * 24 * 60 * 60;
  const existing = (await kvGetJSON(env, `user_profile:${userId}`)) || {};
  const now = new Date().toISOString();
  const profile = {
    ...existing,
    userId,
    plan: updates.plan,
    userData: updates.userData ?? existing.userData ?? {},
    planSource: updates.planSource ?? existing.planSource ?? '',
    savedAt: now,
    planUpdatedAt: updates.planUpdatedAt || now
  };
  if (updates.clientId) profile.clientId = updates.clientId;
  await kvPutJSON(env, `user_profile:${userId}`, profile, ttl);
  return profile;
}

/**
 * User: Save user profile (plan + userData) for cross-context restoration
 *
 * Stores the generated diet plan and user data in KV so that it can be
 * retrieved when the PWA is opened after installation (iOS Safari isolates
 * localStorage from the browser context, but cookies are shared).
 *
 * POST /api/user/save-profile
 * Body: { userId, plan, userData }
 */
async function handleSaveUserProfile(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }

    const { userId, plan, userData, planSource, idToken, clientId } = await request.json();

    if (!userId || !plan) {
      return jsonResponse({ error: 'Missing userId or plan' }, 400);
    }

    // Verify the Firebase ID token when the caller is authenticated as a Firebase user.
    // This prevents one user from overwriting another user's profile.
    // Only attempt verification when FIREBASE_PROJECT_ID is configured; without it
    // verifyFirebaseIdToken always throws "Invalid audience" causing unnecessary 401s.
    if (userId.startsWith('fb_') && idToken && env.FIREBASE_PROJECT_ID) {
      try {
        const firebaseUser = await verifyFirebaseIdToken(idToken, env);
        if ('fb_' + firebaseUser.uid !== userId) {
          return jsonResponse({ error: 'Token does not match userId' }, 403);
        }
      } catch (_) {
        return jsonResponse({ error: 'Invalid Firebase ID token' }, 401);
      }
    }

    const existingProfile = await kvGetJSON(env, `user_profile:${userId}`);
    const planChanged = !existingProfile?.plan ||
      JSON.stringify(existingProfile.plan) !== JSON.stringify(plan);
    const now = new Date().toISOString();
    const profileData = {
      userId,
      plan,
      userData: userData || {},
      planSource: planSource || '',
      // clientId links a questionnaire-2 submission to its client record so that
      // plan-pending.html can check plan status when the user logs in on a new device.
      ...(clientId ? { clientId } : {}),
      savedAt: now,
      planUpdatedAt: planChanged
        ? now
        : (existingProfile?.planUpdatedAt || existingProfile?.savedAt || now)
    };

    const ttl = userId.startsWith('fb_')
      ? 365 * 24 * 60 * 60
      :  90 * 24 * 60 * 60;

    const normalizedEmail = normalizeEmail(profileData.userData?.email);
    let resolvedClientId = clientId || '';
    if (!resolvedClientId && normalizedEmail) {
      resolvedClientId = (await findClientByEmail(env, normalizedEmail))?.clientId || '';
    }

    await kvPutJSON(env, `user_profile:${userId}`, profileData, ttl);

    if (normalizedEmail) {
      await setEmailIndex(env, normalizedEmail, {
        userId,
        clientId: resolvedClientId || profileData.clientId || '',
      });
      if (planChanged && plan) {
        try {
          const syncResult = await syncPlanToEmailCanonicalStore(env, {
            email: normalizedEmail,
            plan,
            userData: profileData.userData,
            userId,
            clientId: resolvedClientId || profileData.clientId || '',
            requireApproval: profileData.planSource === 'questionnaire2',
          });
          if (syncResult?.clientId) resolvedClientId = syncResult.clientId;
        } catch (e) {
          console.warn(`Failed to sync plan by email for profile ${userId}:`, e.message);
        }
      } else if (profileData.userData && Object.keys(profileData.userData).length > 0) {
        try {
          const syncResult = await syncPlanToEmailCanonicalStore(env, {
            email: normalizedEmail,
            userData: profileData.userData,
            userId,
            clientId: resolvedClientId || profileData.clientId || '',
            requireApproval: false,
          });
          if (syncResult?.clientId) resolvedClientId = syncResult.clientId;
        } catch (e) {
          console.warn(`Failed to sync profile answers for ${userId}:`, e.message);
        }
      }
    }

    // Link questionnaire-2 client records back to the Firebase/anonymous profile.
    // This lets admin activation update the same profile that APK login restores.
    if (resolvedClientId) {
      try {
        const clientData = await kvGetJSON(env, `client:${resolvedClientId}`);
        if (clientData) {
          clientData.id = resolvedClientId;
          if (clientData.userId !== userId) {
            clientData.userId = userId;
            await kvPutJSON(env, `client:${resolvedClientId}`, clientData, null);
          }
          if (!profileData.clientId) {
            profileData.clientId = resolvedClientId;
            await kvPutJSON(env, `user_profile:${userId}`, profileData, ttl);
          }
        }
      } catch (e) {
        console.warn(`Failed to link client ${resolvedClientId} to profile ${userId}:`, e.message);
      }
    }

    console.log(`User profile saved for restore: ${userId}`);
    return jsonResponse({ success: true, planUpdatedAt: profileData.planUpdatedAt });
  } catch (error) {
    console.error('Error saving user profile:', error);
    return jsonResponse({ error: 'Failed to save user profile: ' + error.message }, 500);
  }
}

/**
 * GET /api/user/check-account?email=...
 * Lightweight check whether an email already has a plan (for auth gate before replacement).
 */
async function handleCheckAccountEmail(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }

    const url = new URL(request.url);
    const email = normalizeEmail(url.searchParams.get('email'));
    if (!email) {
      return jsonResponse({ error: 'Missing email' }, 400);
    }

    const matched = await findClientByEmail(env, email);
    if (!matched) {
      return jsonResponse({
        exists: false,
        hasPlan: false,
        hasActivatedPlan: false,
        requiresAuth: false,
        planStatus: 'none',
      });
    }

    const clientData = matched.clientData;
    const hasPlan = Boolean(clientData.plan);
    const hasActivatedPlan = clientData.planStatus === 'activated';
    const requiresAuth = hasPlan || hasActivatedPlan || Boolean(clientData.planActivatedAt);

    return jsonResponse({
      exists: true,
      hasPlan,
      hasActivatedPlan,
      requiresAuth,
      planStatus: clientData.planStatus || 'none',
      clientId: matched.clientId,
    });
  } catch (error) {
    console.error('Error checking account email:', error);
    return jsonResponse({ error: 'Failed to check account: ' + error.message }, 500);
  }
}

/**
 * User: Get user profile (plan + userData) for cross-context restoration
 *
 * Called by the PWA on first launch when localStorage is empty but the
 * np_uid cookie (set by the browser before installation) is present.
 *
 * GET /api/user/profile?userId=XXX
 */
async function handleGetUserProfile(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }

    const url = new URL(request.url);
    let resolvedUserId = url.searchParams.get('userId');

    if (!resolvedUserId) {
      return jsonResponse({ error: 'Missing userId' }, 400);
    }

    // Verify the Firebase ID token when the caller is authenticated as a Firebase user.
    // This prevents one user from reading another user's profile.
    // Only attempt verification when FIREBASE_PROJECT_ID is configured; without it
    // verifyFirebaseIdToken always throws "Invalid audience" causing unnecessary 401s.
    if (resolvedUserId.startsWith('fb_') && env.FIREBASE_PROJECT_ID) {
      const authHeader = request.headers.get('Authorization') || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (idToken) {
        try {
          const firebaseUser = await verifyFirebaseIdToken(idToken, env);
          if ('fb_' + firebaseUser.uid !== resolvedUserId) {
            return jsonResponse({ error: 'Token does not match userId' }, 403);
          }
        } catch (_) {
          return jsonResponse({ error: 'Invalid Firebase ID token' }, 401);
        }
      }
    }

    const requestedEmail = normalizeEmail(url.searchParams.get('email'));
    const localPlanAt = url.searchParams.get('localPlanAt');

    let profile = await kvGetJSON(env, `user_profile:${resolvedUserId}`);

    if (requestedEmail) {
      const emailIndex = await getEmailIndex(env, requestedEmail);
      if (emailIndex?.userId && emailIndex.userId !== resolvedUserId) {
        const canonicalProfile = await kvGetJSON(env, `user_profile:${emailIndex.userId}`);
        if (canonicalProfile?.plan) {
          profile = canonicalProfile;
          resolvedUserId = emailIndex.userId;
        }
      }
      if (!profile?.plan && emailIndex?.clientId) {
        const clientData = await kvGetJSON(env, `client:${emailIndex.clientId}`);
        if (clientData?.plan) {
          profile = {
            userId: emailIndex.userId || resolvedUserId,
            plan: clientData.plan,
            userData: clientData.answers || {},
            planSource: clientData.planStatus === 'activated' ? '' : 'questionnaire2',
            clientId: emailIndex.clientId,
            savedAt: new Date().toISOString(),
            planUpdatedAt: clientData.planUpdatedAt || clientData.planActivatedAt || new Date().toISOString(),
          };
          if (emailIndex.userId) resolvedUserId = emailIndex.userId;
        }
      }
    }

    if (!profile && requestedEmail) {
      const matchedClient = await findClientByEmail(env, requestedEmail);
      if (matchedClient) {
        const clientData = matchedClient.clientData;
        if (resolvedUserId && clientData.userId !== resolvedUserId) {
          clientData.userId = resolvedUserId;
          await kvPutJSON(env, `client:${matchedClient.clientId}`, clientData, null);
        }
        profile = {
          userId: resolvedUserId || clientData.userId || '',
          plan: clientData.plan || null,
          userData: clientData.answers || {},
          planSource: clientData.planStatus === 'activated' ? '' : 'questionnaire2',
          clientId: matchedClient.clientId,
          savedAt: new Date().toISOString(),
          planUpdatedAt: clientData.planUpdatedAt || clientData.planActivatedAt || new Date().toISOString()
        };
        const ttl = resolvedUserId && resolvedUserId.startsWith('fb_')
          ? 365 * 24 * 60 * 60
          : 90 * 24 * 60 * 60;
        if (resolvedUserId) {
          await kvPutJSON(env, `user_profile:${resolvedUserId}`, profile, ttl);
        }
      }
    }

    if (!profile) {
      return jsonResponse({ found: false }, 404);
    }

    // Questionnaire-2 plans are pending only until the admin activates the matching
    // client record.  Older profile entries can remain stuck with
    // planSource="questionnaire2"; normalize them here so fresh APK installs do
    // not send approved users back to the questionnaire/pending flow.
    let planSource = profile.planSource || '';
    let clientId = profile.clientId || '';
    if (planSource === 'questionnaire2') {
      let activatedClient = null;
      if (clientId) {
        activatedClient = await kvGetJSON(env, `client:${clientId}`);
      }

      // Backfill for profiles saved before clientId was added, OR when profile.clientId
      // points to the newest (pending) submission — scan for an activated client by email.
      // Bug fix: was `!activatedClient` — must also run when activatedClient is PENDING.
      if (activatedClient?.planStatus !== 'activated' && profile.userData?.email) {
        const wantedEmail = String(profile.userData.email).trim().toLowerCase();
        const clientIds = await kvGetJSON(env, 'clients_list') || [];
        for (const id of clientIds.slice(0, 500)) {
          const clientData = await kvGetJSON(env, `client:${id}`);
          if (!clientData) continue;
          if (clientData.planStatus !== 'activated' || !clientData.plan) continue;
          const clientEmail = String(clientData.answers?.email || '').trim().toLowerCase();
          if (clientEmail === wantedEmail) {
            activatedClient = clientData;
            clientId = id;
            break;
          }
        }
      }

      if (activatedClient?.planStatus === 'activated') {
        if (activatedClient.plan) profile.plan = activatedClient.plan;
        profile.planSource = '';
        if (clientId) profile.clientId = clientId;
        planSource = '';
        await kvPutJSON(env, `user_profile:${resolvedUserId}`, profile, null);
      } else if (clientId) {
        profile.clientId = clientId;
      }
    }

    const planUpdatedAt = getEffectivePlanUpdatedAt(profile);

    if (localPlanAt && planUpdatedAt && localPlanAt >= planUpdatedAt) {
      return jsonResponse({
        found: true,
        unchanged: true,
        planUpdatedAt,
        planSource,
        ...(clientId ? { clientId } : {})
      });
    }

    return jsonResponse({
      found: true,
      plan: profile.plan,
      userData: profile.userData,
      planSource,
      planUpdatedAt,
      ...(clientId ? { clientId } : {})
    });
  } catch (error) {
    console.error('Error getting user profile:', error);
    return jsonResponse({ error: 'Failed to get user profile: ' + error.message }, 500);
  }
}

/**
 * Admin: Send AI assistant message to user
 * 
 * Sends a notification to a user as if it came from the AI assistant
 * 
 * @param {Request} request - Request with userId and message
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response
 */
async function handleAdminSendMessage(request, env) {
  try {
    const { userId, message } = await request.json();
    
    if (!userId || !message) {
      return jsonResponse({ error: 'Missing userId or message' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Send notification to user by calling handlePushSend directly
    const pushPayload = {
      userId: userId,
      title: 'AI Асистент - NutriPlan',
      body: message,
      url: '/plan.html',
      notificationType: 'chat'
    };

    // Create a new request for handlePushSend
    const url = new URL(request.url);
    url.pathname = '/api/push/send';
    const sendRequest = new Request(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pushPayload)
    });

    const response = await handlePushSend(sendRequest, env);
    const result = await response.json();
    
    if (result.success) {
      console.log(`Admin message sent to user ${userId}: ${message}`);
      return jsonResponse({ 
        success: true,
        message: 'Съобщението беше изпратено успешно'
      });
    } else {
      return jsonResponse({ 
        success: false,
        error: result.error || result.message
      }, 500);
    }
  } catch (error) {
    console.error('Error sending admin message:', error);
    return jsonResponse({ error: 'Failed to send message: ' + error.message }, 500);
  }
}

/**
 * Admin: Get notification templates
 * 
 * Retrieves customizable notification templates
 * 
 * @param {Request} request - Request object
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response with templates
 */
async function handleGetNotificationTemplates(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const templatesData = await env.page_content.get('notification_templates');
    
    // Default templates
    const defaultTemplates = {
      meals: {
        breakfast: { title: 'Време за закуска', body: 'Започнете деня си със здравословна закуска 🍳', time: '08:00' },
        lunch: { title: 'Време за обяд', body: 'Време е за вашия здравословен обяд 🥗', time: '13:00' },
        dinner: { title: 'Време за вечеря', body: 'Не забравяйте вечерята си 🍽️', time: '19:00' },
        snack: { title: 'Време за междинна закуска', body: 'Време е за здравословна междинна закуска 🍎', time: '10:30' }
      },
      water: {
        title: 'Време за вода',
        body: 'Не забравяйте да пиете вода! 💧',
        frequency: 2
      },
      sleep: {
        title: 'Време за сън',
        body: 'Подгответе се за почивка. Добър сън е важен за здравето ви! 😴',
        time: '22:00'
      },
      activity: {
        morning: { title: 'Сутрешна активност', body: 'Започнете деня с лека физическа активност! 🏃', time: '07:00' },
        day: { title: 'Време за движение', body: 'Направете кратка разходка или упражнения! 🚶', time: '15:00' }
      },
      supplements: {
        title: 'Хранителни добавки',
        body: 'Не забравяйте да приемете вашите хранителни добавки 💊',
        times: []
      }
    };

    const templates = templatesData ? JSON.parse(templatesData) : defaultTemplates;
    
    // Get version from KV or use current timestamp
    const versionData = await env.page_content.get('notification_templates_version');
    const version = versionData ? parseInt(versionData) : Date.now();
    
    return jsonResponse({ 
      success: true,
      templates: templates,
      version: version
    });
  } catch (error) {
    console.error('Error getting notification templates:', error);
    return jsonResponse({ error: 'Failed to get templates: ' + error.message }, 500);
  }
}

/**
 * Admin: Save notification templates
 * 
 * Saves customizable notification templates
 * 
 * @param {Request} request - Request with templates
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response
 */
async function handleSaveNotificationTemplates(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const { templates } = await request.json();
    
    if (!templates) {
      return jsonResponse({ error: 'Missing templates' }, 400);
    }

    await env.page_content.put('notification_templates', JSON.stringify(templates));
    
    // Update version number to invalidate client cache
    const version = Date.now();
    await env.page_content.put('notification_templates_version', version.toString());
    
    console.log('Notification templates saved with version:', version);
    
    return jsonResponse({ 
      success: true,
      message: 'Шаблоните за известия са запазени',
      templates: templates,
      version: version
    });
  } catch (error) {
    console.error('Error saving notification templates:', error);
    return jsonResponse({ error: 'Failed to save templates: ' + error.message }, 500);
  }
}

/**
 * Helper to create JSON response with optional cache control
 * @param {Object} data - Response data
 * @param {number} status - HTTP status code
 * @param {Object} options - Optional settings { cacheControl: string }
 */

// ─── Email Template (plan ready) ───

/**
 * Read the plan-ready email template from KV.
 * Falls back to DEFAULT_EMAIL_TEMPLATE if not found.
 */
async function getEmailTemplate(env) {
  if (!env.page_content) return DEFAULT_EMAIL_TEMPLATE;
  try {
    const raw = await env.page_content.get('email_template_plan_ready');
    if (raw) return Object.assign({}, DEFAULT_EMAIL_TEMPLATE, JSON.parse(raw));
  } catch (e) {
    console.warn('[EmailTemplate] Failed to read KV template:', e);
  }
  return DEFAULT_EMAIL_TEMPLATE;
}

/**
 * Admin: Get the editable email template.
 */
async function handleGetEmailTemplate(request, env) {
  try {
    const tpl = await getEmailTemplate(env);
    return jsonResponse({ success: true, template: tpl, defaults: DEFAULT_EMAIL_TEMPLATE });
  } catch (error) {
    return jsonResponse({ error: 'Failed to get email template: ' + error.message }, 500);
  }
}

/**
 * Admin: Save the editable email template to KV.
 */
async function handleSaveEmailTemplate(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }
    const { template } = await request.json();
    if (!template || typeof template !== 'object') {
      return jsonResponse({ error: 'Missing template object' }, 400);
    }
    // Only persist known fields; strip unknown keys
    const allowed = Object.keys(DEFAULT_EMAIL_TEMPLATE);
    const safe = {};
    for (const k of allowed) {
      if (template[k] !== undefined) safe[k] = String(template[k]);
    }
    await env.page_content.put('email_template_plan_ready', JSON.stringify(safe));
    console.log('[EmailTemplate] Template saved by admin');
    return jsonResponse({ success: true, message: 'Шаблонът за имейл е запазен', template: safe });
  } catch (error) {
    return jsonResponse({ error: 'Failed to save email template: ' + error.message }, 500);
  }
}

/**
 * Admin: Send a test plan-ready email using the current template.
 * Body: { to: "email@example.com", clientName: "Test Name" }
 */
async function handleTestSendEmail(request, env) {
  try {
    const { to, clientName } = await request.json();
    if (!to) return jsonResponse({ error: 'Missing recipient email (to)' }, 400);
    const tpl = await getEmailTemplate(env);
    const subject = (tpl.subject || DEFAULT_EMAIL_TEMPLATE.subject) + ' [ТЕСТ]';
    const name = clientName || 'Тестов Клиент';
    await sendEmailViaSMTP(env, to, subject, buildPlanReadyEmailHtml(name, tpl));
    return jsonResponse({ success: true, message: `Тестовият имейл е изпратен до ${to}` });
  } catch (error) {
    console.error('[TestEmail] Error:', error.message);
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 /**
 * Scheduled event handler – intentionally a no-op.
 * Notifications are scheduled locally via Capacitor (APK) or SW postMessage (PWA).
 * The backend is only called by the admin panel when notification config changes.
 */
async function handleScheduledNotifications(env) {
  // No-op: local scheduling is handled client-side (local-scheduler.js).
}

/**
 * Normalize time string to HH:MM format with zero padding
 */
function normalizeTime(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length !== 2) return null;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return null;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Check and send meal reminders
 */
async function checkAndSendMealReminders(userId, mealReminders, currentTime, env) {
  const templates = await getNotificationTemplates(env);
  const mealTypes = ['breakfast', 'lunch', 'dinner'];
  
  for (const mealType of mealTypes) {
    const mealTime = normalizeTime(mealReminders[mealType]);
    if (mealTime && mealTime === currentTime) {
      console.log(`[Cron] Sending ${mealType} reminder to user ${userId}`);
      await sendPushNotificationToUser(userId, {
        title: templates.meals[mealType]?.title || `Време за ${mealType}`,
        body: templates.meals[mealType]?.body || 'Време е за хранене',
        url: '/plan.html',
        notificationType: 'meal'
      }, env);
    }
  }
}

/**
 * Check and send water reminders
 */
async function checkAndSendWaterReminders(userId, waterSettings, currentHour, currentMinute, env) {
  const frequency = waterSettings.frequency || 2;
  const startHour = waterSettings.startHour || 8;
  const endHour = waterSettings.endHour || 22;
  
  // Only send on the hour (0 minutes) and within active hours
  if (currentMinute === 0 && currentHour >= startHour && currentHour <= endHour) {
    // Check if this hour matches the frequency
    if ((currentHour - startHour) % frequency === 0) {
      console.log(`[Cron] Sending water reminder to user ${userId}`);
      const templates = await getNotificationTemplates(env);
      await sendPushNotificationToUser(userId, {
        title: templates.water?.title || 'Време за вода',
        body: templates.water?.body || 'Не забравяйте да пиете вода! 💧',
        url: '/plan.html',
        notificationType: 'water'
      }, env);
    }
  }
}

/**
 * Check and send sleep reminder
 */
async function checkAndSendSleepReminder(userId, sleepTime, currentTime, env) {
  const normalizedSleepTime = normalizeTime(sleepTime);
  if (normalizedSleepTime && normalizedSleepTime === currentTime) {
    console.log(`[Cron] Sending sleep reminder to user ${userId}`);
    const templates = await getNotificationTemplates(env);
    await sendPushNotificationToUser(userId, {
      title: templates.sleep?.title || 'Време за сън',
      body: templates.sleep?.body || 'Подгответе се за почивка 😴',
      url: '/plan.html',
      notificationType: 'sleep'
    }, env);
  }
}

/**
 * Check and send activity reminders
 */
async function checkAndSendActivityReminders(userId, activityPrefs, currentTime, env) {
  const templates = await getNotificationTemplates(env);
  
  const normalizedMorningTime = normalizeTime(activityPrefs.morningTime);
  if (normalizedMorningTime && normalizedMorningTime === currentTime) {
    console.log(`[Cron] Sending morning activity reminder to user ${userId}`);
    await sendPushNotificationToUser(userId, {
      title: templates.activity?.morning?.title || 'Сутрешна активност',
      body: templates.activity?.morning?.body || 'Започнете деня с активност! 🏃',
      url: '/plan.html',
      notificationType: 'activity'
    }, env);
  }
  
  const normalizedDayTime = normalizeTime(activityPrefs.dayTime);
  if (normalizedDayTime && normalizedDayTime === currentTime) {
    console.log(`[Cron] Sending day activity reminder to user ${userId}`);
    await sendPushNotificationToUser(userId, {
      title: templates.activity?.day?.title || 'Време за движение',
      body: templates.activity?.day?.body || 'Направете кратка разходка! 🚶',
      url: '/plan.html',
      notificationType: 'activity'
    }, env);
  }
}

/**
 * Check and send supplement reminders
 */
async function checkAndSendSupplementReminders(userId, supplementTimes, currentTime, env) {
  // Normalize all supplement times and check if any match current time
  const normalizedTimes = supplementTimes.map(t => normalizeTime(t)).filter(t => t !== null);
  if (normalizedTimes.includes(currentTime)) {
    console.log(`[Cron] Sending supplement reminder to user ${userId}`);
    const templates = await getNotificationTemplates(env);
    await sendPushNotificationToUser(userId, {
      title: templates.supplements?.title || 'Хранителни добавки',
      body: templates.supplements?.body || 'Време за хранителните добавки 💊',
      url: '/plan.html',
      notificationType: 'supplements'
    }, env);
  }
}

/**
 * Get notification templates from KV
 */
async function getNotificationTemplates(env) {
  const templatesData = await env.page_content.get('notification_templates');
  if (templatesData) {
    return JSON.parse(templatesData);
  }
  
  // Return defaults if not found
  return {
    meals: {
      breakfast: { title: 'Време за закуска', body: 'Започнете деня си със здравословна закуска 🍳' },
      lunch: { title: 'Време за обяд', body: 'Време е за вашия здравословен обяд 🥗' },
      dinner: { title: 'Време за вечеря', body: 'Не забравяйте вечерята си 🍽️' },
      snack: { title: 'Време за междинна закуска', body: 'Време е за здравословна междинна закуска 🍎' }
    },
    water: { title: 'Време за вода', body: 'Не забравяйте да пиете вода! 💧' },
    sleep: { title: 'Време за сън', body: 'Подгответе се за почивка. Добър сън е важен! 😴' },
    activity: {
      morning: { title: 'Сутрешна активност', body: 'Започнете деня с активност! 🏃' },
      day: { title: 'Време за движение', body: 'Направете кратка разходка! 🚶' }
    },
    supplements: { title: 'Хранителни добавки', body: 'Не забравяйте добавките 💊' }
  };
}

/**
 * Send push notification to a specific user
 */
async function sendPushNotificationToUser(userId, message, env) {
  try {
    // Get user's push subscription
    const subscriptionKey = `push_subscription_${userId}`;
    const subscriptionData = await env.page_content.get(subscriptionKey);
    
    if (!subscriptionData) {
      console.warn(`[Cron] No push subscription found for user ${userId}`);
      return;
    }
    
    const subscription = JSON.parse(subscriptionData);
    
    // Prepare push message
    const pushMessage = {
      title: message.title || 'NutriPlan',
      body: message.body || 'Ново напомняне от NutriPlan',
      url: message.url || '/plan.html',
      icon: message.icon || '/icon-192x192.png',
      notificationType: message.notificationType || 'general',
      planUpdatedAt: message.planUpdatedAt || '',
      timestamp: Date.now()
    };
    
    // Check if VAPID keys are configured
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      console.error('[Cron] VAPID keys not configured');
      return;
    }
    
    // Send the push notification
    const response = await sendWebPushNotification(
      subscription,
      JSON.stringify(pushMessage),
      env
    );
    
    if (response.ok || response.status === 201) {
      console.log(`[Cron] Push notification sent successfully to user ${userId}`);
    } else {
      console.error(`[Cron] Push service returned status ${response.status}`);
      
      // If subscription is no longer valid (410 Gone), remove it
      if (response.status === 410) {
        console.log(`[Cron] Removing invalid subscription for user ${userId}`);
        await env.page_content.delete(subscriptionKey);
        
        // Update subscriptions list
        const listData = await env.page_content.get('push_subscriptions_list');
        if (listData) {
          const userIds = JSON.parse(listData);
          const updatedIds = userIds.filter(id => id !== userId);
          await env.page_content.put('push_subscriptions_list', JSON.stringify(updatedIds));
        }
      }
    }
  } catch (error) {
    console.error(`[Cron] Error sending push notification to user ${userId}:`, error);
  }
}

/**
 * Handle GET /api/clinical-protocols - Returns list of available clinical protocols
 * @returns {Response} JSON response with protocols list
 */
function handleGetClinicalProtocols() {
  const protocolsList = Object.values(CLINICAL_PROTOCOLS).map(p => ({
    id: p.id,
    name: p.name,
    goalMapping: p.goalMapping,
    dietTypeHint: p.dietTypeHint,
    hacks: p.hacks || [],
    restrictions: p.restrictions || [],
    emphasis: p.emphasis || []
  }));
  
  return jsonResponse({
    success: true,
    protocols: protocolsList,
    count: protocolsList.length
  });
}

// ── AIX Chat handler – proxies to OpenRouter with SSE streaming ──────────────
async function handleAIXChat(request, env) {
  if (!env.OPEN_ROUTER) {
    return jsonResponse({ error: 'OpenRouter API key not configured' }, 500);
  }
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid JSON' }, 400); }

  const { model, messages, systemPrompt, stream } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse({ error: 'messages required' }, 400);
  }

  const apiMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPEN_ROUTER}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://aidiet.radilov-k.workers.dev',
      'X-Title': 'AIX'
    },
    body: JSON.stringify({
      model: model || 'google/gemma-4-31b-it:free',
      messages: apiMessages,
      max_tokens: 2048,
      stream: stream === true
    })
  });

  if (!orRes.ok) {
    const err = await orRes.text();
    return jsonResponse({ error: err }, orRes.status);
  }

  if (stream === true) {
    // Pass SSE stream directly to client
    return new Response(orRes.body, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
      }
    });
  }

  const data = await orRes.json();
  const content = data.choices?.[0]?.message?.content || '';
  return jsonResponse({ content, usage: data.usage });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    console.log(`${request.method} ${url.pathname}`);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      console.log('CORS preflight request');
      return new Response(null, { 
        status: 204,
        headers: CORS_HEADERS 
      });
    }

    try {
      // Route handling
      if (url.pathname === '/api/validate-questionnaire' && request.method === 'POST') {
        const rlErr = await checkRateLimit(env, request, 'VALIDATE_QUESTIONNAIRE');
        if (rlErr) return rlErr;
        return await handleValidateQuestionnaire(request, env);
      } else if (url.pathname === '/api/generate-plan' && request.method === 'POST') {
        const rlErr = await checkRateLimit(env, request, 'GENERATE_PLAN');
        if (rlErr) return rlErr;
        return await handleGeneratePlan(request, env, ctx);
      } else if (url.pathname === '/api/generate-plan-async' && request.method === 'POST') {
        const rlErr = await checkRateLimit(env, request, 'GENERATE_PLAN');
        if (rlErr) return rlErr;
        return await handleGeneratePlanAsync(request, env, ctx);
      } else if (url.pathname === '/api/plan-job-status' && request.method === 'GET') {
        return await handleGetPlanJobStatus(request, env);
      } else if (url.pathname === '/api/clinical-protocols' && request.method === 'GET') {
        return handleGetClinicalProtocols();
      } else if (url.pathname === '/api/chat' && request.method === 'POST') {
        const rlErr = await checkRateLimit(env, request, 'CHAT');
        if (rlErr) return rlErr;
        return await handleChat(request, env);
      } else if (url.pathname === '/api/analyze-food-image' && request.method === 'POST') {
        const rlErr = await checkRateLimit(env, request, 'FOOD_ANALYSIS');
        if (rlErr) return rlErr;
        return await handleAnalyzeFoodImage(request, env);
      } else if (url.pathname === '/api/analyze-menu-image' && request.method === 'POST') {
        const rlErr = await checkRateLimit(env, request, 'FOOD_ANALYSIS');
        if (rlErr) return rlErr;
        return await handleAnalyzeMenuImage(request, env);
      } else if (url.pathname === '/api/analyze-kids-food' && request.method === 'POST') {
        const rlErr = await checkRateLimit(env, request, 'FOOD_ANALYSIS');
        if (rlErr) return rlErr;
        return await handleAnalyzeKidsFoodImage(request, env);
      } else if (url.pathname === '/api/report-problem' && request.method === 'POST') {
        return await handleReportProblem(request, env, ctx);
      } else if (url.pathname === '/api/contact' && request.method === 'POST') {
        return await handleContactMessage(request, env, ctx);
      } else if (url.pathname === '/api/save-client-data' && request.method === 'POST') {
        return await handleSaveClientData(request, env, ctx);
      } else if (url.pathname === '/api/admin/get-reports' && request.method === 'GET') {
        return await handleGetReports(request, env);
      } else if (url.pathname === '/api/admin/get-contact-messages' && request.method === 'GET') {
        return await handleGetContactMessages(request, env);
      } else if (url.pathname === '/api/admin/save-prompt' && request.method === 'POST') {
        return await handleSavePrompt(request, env);
      } else if (url.pathname === '/api/admin/get-default-prompt' && request.method === 'GET') {
        return await handleGetDefaultPrompt(request, env);
      } else if (url.pathname === '/api/admin/save-model' && request.method === 'POST') {
        return await handleSaveModel(request, env);
      } else if (url.pathname === '/api/admin/save-chat-model' && request.method === 'POST') {
        return await handleSaveChatModel(request, env);
      } else if (url.pathname === '/api/admin/save-chat-mode-config' && request.method === 'POST') {
        return await handleSaveChatModeConfig(request, env);
      } else if (url.pathname === '/api/admin/chat-mode-config' && request.method === 'GET') {
        return await handleGetChatModeConfig(request, env);
      } else if (url.pathname === '/api/admin/save-protocol-config' && request.method === 'POST') {
        return await handleSaveProtocolConfig(request, env);
      } else if (url.pathname === '/api/admin/save-vision-config' && request.method === 'POST') {
        return await handleSaveVisionConfig(request, env);
      } else if (url.pathname === '/api/admin/save-step-token-limits' && request.method === 'POST') {
        return await handleSaveStepTokenLimits(request, env);
      } else if (url.pathname === '/api/generate-protocol' && request.method === 'POST') {
        return await handleGenerateProtocol(request, env);
      } else if (url.pathname === '/api/generate-emoeat-analysis' && request.method === 'POST') {
        return await handleGenerateEmoeatAnalysis(request, env);
      } else if (url.pathname === '/api/generate-longevity-protocol' && request.method === 'POST') {
        return await handleGenerateLongevityProtocol(request, env);
      } else if (url.pathname === '/api/admin/get-config' && request.method === 'GET') {
        return await handleGetConfig(request, env);
      } else if (url.pathname === '/api/admin/get-validation-config' && request.method === 'GET') {
        return await handleGetValidationConfig(request, env);
      } else if (url.pathname === '/api/admin/save-validation-config' && request.method === 'POST') {
        return await handleSaveValidationConfig(request, env);
      } else if (url.pathname === '/api/admin/get-ai-logs' && request.method === 'GET') {
        return await handleGetAILogs(request, env);
      } else if (url.pathname === '/api/admin/cleanup-ai-logs' && request.method === 'POST') {
        return await handleCleanupAILogs(request, env);
      } else if (url.pathname === '/api/admin/export-ai-logs' && request.method === 'GET') {
        return await handleExportAILogs(request, env);
      } else if (url.pathname === '/api/admin/get-blacklist' && request.method === 'GET') {
        return await handleGetBlacklist(request, env);
      } else if (url.pathname === '/api/admin/add-to-blacklist' && request.method === 'POST') {
        return await handleAddToBlacklist(request, env);
      } else if (url.pathname === '/api/admin/remove-from-blacklist' && request.method === 'POST') {
        return await handleRemoveFromBlacklist(request, env);
      } else if (url.pathname === '/api/admin/set-blacklist' && request.method === 'POST') {
        return await handleSetBlacklist(request, env);
      } else if (url.pathname === '/api/admin/get-whitelist' && request.method === 'GET') {
        return await handleGetWhitelist(request, env);
      } else if (url.pathname === '/api/admin/add-to-whitelist' && request.method === 'POST') {
        return await handleAddToWhitelist(request, env);
      } else if (url.pathname === '/api/admin/remove-from-whitelist' && request.method === 'POST') {
        return await handleRemoveFromWhitelist(request, env);
      } else if (url.pathname === '/api/admin/get-mainlist' && request.method === 'GET') {
        return await handleGetMainlist(request, env);
      } else if (url.pathname === '/api/admin/set-mainlist' && request.method === 'POST') {
        return await handleSetMainlist(request, env);
      } else if (url.pathname === '/api/admin/add-to-mainlist' && request.method === 'POST') {
        return await handleAddToMainlist(request, env);
      } else if (url.pathname === '/api/admin/remove-from-mainlist' && request.method === 'POST') {
        return await handleRemoveFromMainlist(request, env);
      } else if (url.pathname === '/api/admin/clear-mainlist' && request.method === 'POST') {
        return await handleClearMainlist(request, env);
      } else if (url.pathname === '/api/admin/get-mainlist-status' && request.method === 'GET') {
        return await handleGetMainlistStatus(request, env);
      } else if (url.pathname === '/api/admin/set-mainlist-enabled' && request.method === 'POST') {
        return await handleSetMainlistEnabled(request, env);
      } else if (url.pathname === '/api/admin/get-mainlist-presets' && request.method === 'GET') {
        return await handleGetMainlistPresets(request, env);
      } else if (url.pathname === '/api/admin/save-mainlist-preset' && request.method === 'POST') {
        return await handleSaveMainlistPreset(request, env);
      } else if (url.pathname === '/api/admin/load-mainlist-preset' && request.method === 'POST') {
        return await handleLoadMainlistPreset(request, env);
      } else if (url.pathname === '/api/admin/delete-mainlist-preset' && request.method === 'POST') {
        return await handleDeleteMainlistPreset(request, env);
      } else if (url.pathname === '/api/admin/get-goal-hacks' && request.method === 'GET') {
        return await handleGetGoalHacks(request, env);
      } else if (url.pathname === '/api/admin/set-goal-hacks' && request.method === 'POST') {
        return await handleSetGoalHacks(request, env);
      } else if (url.pathname === '/api/admin/add-goal-hack' && request.method === 'POST') {
        return await handleAddGoalHack(request, env);
      } else if (url.pathname === '/api/admin/remove-goal-hack' && request.method === 'POST') {
        return await handleRemoveGoalHack(request, env);
      // Protocol Images API
      } else if (url.pathname === '/api/admin/get-all-protocol-images' && request.method === 'GET') {
        return await handleGetAllProtocolImages(request, env);
      } else if (url.pathname === '/api/admin/get-protocol-image' && request.method === 'GET') {
        return await handleGetProtocolImage(request, env);
      } else if (url.pathname === '/api/admin/upload-protocol-image' && request.method === 'POST') {
        return await handleUploadProtocolImage(request, env);
      } else if (url.pathname === '/api/admin/delete-protocol-image' && request.method === 'POST') {
        return await handleDeleteProtocolImage(request, env);
      // UI Images API (public GET + admin write)
      } else if (url.pathname === '/api/ui-images' && request.method === 'GET') {
        return await handleGetAllUIImages(request, env);
      } else if (url.pathname === '/api/admin/upload-ui-image' && request.method === 'POST') {
        return await handleUploadUIImage(request, env);
      } else if (url.pathname === '/api/admin/delete-ui-image' && request.method === 'POST') {
        return await handleDeleteUIImage(request, env);
      } else if (url.pathname === '/api/notification-config' && request.method === 'GET') {
        return await handleGetNotificationConfig(request, env);
      } else if (url.pathname === '/api/notification-config' && request.method === 'POST') {
        return await handleSaveNotificationConfig(request, env);
      } else if (url.pathname === '/api/calendar.ics' && request.method === 'GET') {
        return await handleGetCalendarIcs(request, env);
      } else if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
        return await handlePushSubscribe(request, env);
      } else if (url.pathname === '/api/push/send' && request.method === 'POST') {
        return await handlePushSend(request, env);
      } else if (url.pathname === '/api/push/vapid-public-key' && request.method === 'GET') {
        return await handleGetVapidPublicKey(request, env);
      } else if (url.pathname === '/api/admin/notification-settings' && request.method === 'GET') {
        return await handleGetNotificationSettings(request, env);
      } else if (url.pathname === '/api/admin/notification-settings' && request.method === 'POST') {
        return await handleSaveNotificationSettings(request, env);
      } else if (url.pathname === '/api/admin/notification-templates' && request.method === 'GET') {
        return await handleGetNotificationTemplates(request, env);
      } else if (url.pathname === '/api/admin/notification-templates' && request.method === 'POST') {
        return await handleSaveNotificationTemplates(request, env);
      } else if (url.pathname === '/api/admin/send-message' && request.method === 'POST') {
        return await handleAdminSendMessage(request, env);
      } else if (url.pathname === '/api/user/notification-preferences' && request.method === 'GET') {
        return await handleGetUserNotificationPreferences(request, env);
      } else if (url.pathname === '/api/user/notification-preferences' && request.method === 'POST') {
        return await handleSaveUserNotificationPreferences(request, env);
      } else if (url.pathname === '/api/user/save-profile' && request.method === 'POST') {
        return await handleSaveUserProfile(request, env);
      } else if (url.pathname === '/api/user/sync-analytics' && request.method === 'POST') {
        return await handleSyncAnalytics(request, env);
      } else if (url.pathname === '/api/user/check-account' && request.method === 'GET') {
        return await handleCheckAccountEmail(request, env);
      } else if (url.pathname === '/api/user/profile' && request.method === 'GET') {
        return await handleGetUserProfile(request, env);
      } else if (url.pathname === '/api/admin/subscriptions' && request.method === 'GET') {
        return await handleGetSubscriptions(request, env);
      } else if (url.pathname === '/api/admin/get-logging-status' && request.method === 'GET') {
        return await handleGetLoggingStatus(request, env);
      } else if (url.pathname === '/api/admin/set-logging-status' && request.method === 'POST') {
        return await handleSetLoggingStatus(request, env);
      } else if (url.pathname === '/api/admin/get-clients-list' && request.method === 'GET') {
        return await handleGetClientsList(request, env);
      } else if (url.pathname === '/api/admin/get-client-data' && request.method === 'GET') {
        return await handleGetClientData(request, env);
      } else if (url.pathname === '/api/admin/delete-clients' && request.method === 'POST') {
        return await handleDeleteClients(request, env);
      } else if (url.pathname === '/api/admin/update-client-plan' && request.method === 'POST') {
        return await handleUpdateClientPlan(request, env, ctx);
      } else if (url.pathname === '/api/admin/activate-client-plan' && request.method === 'POST') {
        return await handleActivateClientPlan(request, env, ctx);
      } else if (url.pathname === '/api/admin/client-card' && request.method === 'GET') {
        return await handleAdminClientCard(request, env);
      } else if (url.pathname === '/api/admin/client-assistant/session' && request.method === 'POST') {
        return await handleAdminAssistantSession(request, env);
      } else if (url.pathname === '/api/admin/client-assistant/chat' && request.method === 'POST') {
        return await handleAdminAssistantChat(request, env, ctx);
      } else if (url.pathname === '/api/admin/client-assistant/apply' && request.method === 'POST') {
        return await handleAdminAssistantApply(request, env, ctx);
      } else if (url.pathname === '/api/admin/email-template' && request.method === 'GET') {
        return await handleGetEmailTemplate(request, env);
      } else if (url.pathname === '/api/admin/email-template' && request.method === 'POST') {
        return await handleSaveEmailTemplate(request, env);
      } else if (url.pathname === '/api/admin/test-send-email' && request.method === 'POST') {
        return await handleTestSendEmail(request, env);
      } else if (url.pathname === '/api/client-plan-status' && request.method === 'GET') {
        return await handleGetClientPlanStatus(request, env);
      } else if (url.pathname === '/api/pep/bootstrap' && request.method === 'GET') {
        return await handlePepBootstrap(request, env);
      } else if (url.pathname === '/api/pep/products' && request.method === 'POST') {
        return await handlePepCreateProduct(request, env);
      } else if (url.pathname === '/api/pep/products/update' && request.method === 'POST') {
        return await handlePepUpdateProduct(request, env);
      } else if (url.pathname === '/api/pep/products/delete' && request.method === 'POST') {
        return await handlePepDeleteProduct(request, env);
      } else if (url.pathname === '/api/pep/sales' && request.method === 'POST') {
        return await handlePepCreateSale(request, env);
      } else if (url.pathname === '/api/pep/sales/delete' && request.method === 'POST') {
        return await handlePepDeleteSale(request, env);
      } else if (url.pathname === '/api/pep/reset-demo' && request.method === 'POST') {
        return await handlePepResetDemo(request, env);
      } else if (url.pathname === '/api/auth/social' && request.method === 'POST') {
        const rlErr = await checkRateLimit(env, request, 'SOCIAL_AUTH');
        if (rlErr) return rlErr;
        return await handleSocialAuth(request, env);
      } else if (url.pathname === '/api/auth/forgot-password' && request.method === 'POST') {
        const rlErr = await checkRateLimit(env, request, 'FORGOT_PASSWORD');
        if (rlErr) return rlErr;
        return await handleForgotPassword(request, env);
      } else if (url.pathname === '/api/aix/chat' && request.method === 'POST') {
        const rlErr = await checkRateLimit(env, request, 'CHAT');
        if (rlErr) return rlErr;
        return await handleAIXChat(request, env);
      } else {
        return jsonResponse({ error: 'Not found' }, 404);
      }
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  },
  
  /**
   * Handle scheduled cron triggers for push notifications
   */
  async scheduled(event, env, ctx) {
    console.log('[Worker] Scheduled event triggered at:', new Date().toISOString());
    ctx.waitUntil(handleScheduledNotifications(env));
  },

  /**
   * Handle Cloudflare Queue messages for plan generation.
   *
   * Each message contains { jobId, data } placed by handleGeneratePlanAsync().
   * Queue consumers run in a dedicated Worker invocation with up to 15 minutes of
   * execution time, so the full multi-step AI plan generation can always complete
   * regardless of how long it takes.
   *
   * Cloudflare retries a message (up to max_retries in wrangler.toml) if the
   * consumer throws or calls message.retry().  On permanent failure the message
   * is written to the dead-letter queue if one is configured.
   */
  async queue(batch, env) {
    for (const message of batch.messages) {
      const { jobId, data, clientId, generationOptions } = message.body;
      console.log(`Queue consumer: received job ${jobId}`);
      try {
        await generatePlanAndSave(env, data, jobId, clientId || null, generationOptions || {});
        message.ack();
        console.log(`Queue consumer: acked job ${jobId}`);
      } catch (err) {
        // generatePlanAndSave has its own try/catch and writes a 'failed' KV entry,
        // so reaching here means an unexpected error outside that guard.
        // Use retry() so Cloudflare can re-attempt up to max_retries times in case
        // the failure was transient (network blip, temporary AI API outage, etc.).
        console.error(`Queue consumer: job ${jobId} unexpected error, scheduling retry:`, err);
        message.retry();
      }
    }
  }
};
