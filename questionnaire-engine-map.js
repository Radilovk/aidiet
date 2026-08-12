/**
 * Questionnaire → deterministic engine mapping.
 * Stable, explicit field rules — no NLP guessing on free text.
 */

/** Protocol / questionnaire fields known to list foods to exclude. */
export const QUESTIONNAIRE_FOOD_BLOCK_FIELD_IDS = [
  'dietDislike',
  'medicalConditions_Алергии',
  'foodTriggers',
  'triggerFoods',
  'giTriggers',
  'foodSensitivities',
];

/** Dynamic question key / label fragments that indicate food exclusion answers. */
const DQ_FOOD_KEY_PATTERN = /food|trigger|allerg|intoler|хран|избяг|алерг|не\s*тoler/i;

/** Condition detail fields from questionnaire2 dropdowns. */
export const CONDITION_DETAIL_FIELD_IDS = [
  'medicalConditions_Сърдечно-съдови_детайл',
  'medicalConditions_Ендокринни_детайл',
  'medicalConditions_Храносмилателни_детайл',
  'medicalConditions_Метаболитни_детайл',
  'medicalConditions_Мускулно-скелетни_детайл',
  'medicalConditions_Автоимунно',
  'medicalConditions_other',
];

/** Clinical protocol → extra diet hint text for resolveLibraryDietProfile. */
const CLINICAL_PROTOCOL_DIET_HINTS = {
  gi_issues: 'fodmap ibs храносмилателни',
  autoimmune_aip: 'противовъзпалителна aip autoimun',
  insulin_resistance: 'инсулинова резистентност нисковъглехидратна',
};

function pushTermsFromValue(terms, seen, val) {
  if (val == null || val === '') return;
  const parts = Array.isArray(val) ? val : String(val).split(/[,;|\n]/);
  for (const part of parts) {
    const t = String(part).trim();
    if (t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(t);
  }
}

/**
 * Extract blocked food terms from questionnaire (deterministic catalog filter).
 * @param {object} userData
 * @returns {string[]}
 */
export function extractQuestionnaireBlockedTerms(userData = {}) {
  const terms = [];
  const seen = new Set();

  for (const fieldId of QUESTIONNAIRE_FOOD_BLOCK_FIELD_IDS) {
    pushTermsFromValue(terms, seen, userData[fieldId]);
  }

  if (Array.isArray(userData.planModifications)) {
    for (const mod of userData.planModifications) {
      if (typeof mod === 'string' && mod.startsWith('exclude_food:')) {
        pushTermsFromValue(terms, seen, mod.slice('exclude_food:'.length));
      }
    }
  }

  if (Array.isArray(userData.userFoodExclude)) {
    for (const entry of userData.userFoodExclude) {
      pushTermsFromValue(terms, seen, entry);
    }
  }

  if (Array.isArray(userData.forbidden)) {
    for (const entry of userData.forbidden) {
      pushTermsFromValue(terms, seen, entry);
    }
  }

  const textMap = userData._dq_text_map || {};
  for (const key of Object.keys(userData)) {
    if (!key.startsWith('dq_')) continue;
    const label = String(textMap[key] || '');
    if (!DQ_FOOD_KEY_PATTERN.test(key) && !DQ_FOOD_KEY_PATTERN.test(label)) continue;
    pushTermsFromValue(terms, seen, userData[key]);
  }

  return terms;
}

/**
 * Build supplemental diet hint string from conditions / clinical protocol.
 * Appended to resolveLibraryDietProfile text — explicit dietPreference flags still win.
 * @param {object} userData
 * @returns {string}
 */
export function buildQuestionnaireDietHints(userData = {}) {
  const parts = [];

  const cp = userData.clinicalProtocol;
  if (cp && CLINICAL_PROTOCOL_DIET_HINTS[cp]) {
    parts.push(CLINICAL_PROTOCOL_DIET_HINTS[cp]);
  }

  const textChunks = [];
  if (Array.isArray(userData.medicalConditions)) {
    textChunks.push(userData.medicalConditions.join(' '));
  }
  for (const key of CONDITION_DETAIL_FIELD_IDS) {
    if (userData[key]) textChunks.push(String(userData[key]));
  }

  const blob = textChunks.join(' ').toLowerCase();
  if (/fodmap|ibs|подуване|сърбеж|храносмилател/i.test(blob)) parts.push('fodmap ibs');
  if (/целиак|глутен|gluten/i.test(blob)) parts.push('без глутен gluten');
  if (/лактоз|млеч|dairy/i.test(blob)) parts.push('без млечни dairy');
  if (/хипертон|кръвно/i.test(blob)) parts.push('dash хипертония');
  if (/пaleo|палео/i.test(blob)) parts.push('paleo');

  return [...new Set(parts.join(' ').split(/\s+/).filter(Boolean))].join(' ');
}

/** Merge engine context onto userData (non-destructive fields). */
export function enrichUserDataEngineContext(userData) {
  if (!userData || typeof userData !== 'object') return userData;
  const blockedTerms = extractQuestionnaireBlockedTerms(userData);
  /** @type {Record<string, unknown>} */ (userData)._engineBlockedTerms = blockedTerms;
  /** @type {Record<string, unknown>} */ (userData)._engineDietHints = buildQuestionnaireDietHints(userData);
  return userData;
}

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function summarizeWeekPlanSkeleton(weekPlan) {
  if (!weekPlan) return '';
  const lines = [];
  for (let d = 1; d <= 7; d++) {
    const day = weekPlan[`day${d}`];
    if (!day?.meals?.length) continue;
    const slots = day.meals.map(m => {
      const kcal = m.calories != null ? `${m.calories}kcal` : '';
      return `${m.type}:${m.name || '?'}${kcal ? `(${kcal})` : ''}`;
    }).join(' | ');
    lines.push(`D${d}: ${slots}`);
  }
  return lines.join('\n');
}

function summarizeWeeklyScheme(strategy) {
  const scheme = strategy?.weeklyScheme;
  if (!scheme) return '';
  const mon = scheme.monday;
  if (!mon?.mealBreakdown?.length) return '';
  const slots = mon.mealBreakdown.map(s => `${s.type}=${s.calories}kcal`).join(', ');
  return `slots(${slots}) freeDay=${strategy.freeDayNumber ?? '?'} dessert=${strategy.includeDessert}`;
}

/**
 * Compressed audit packet for Final Director (Step 6).
 * @param {{ plan?: object, userData?: object, codeValidation?: object }} ctx
 */
export function buildFinalAuditPacket({ plan = null, userData = null, codeValidation = null } = {}) {
  const analysis = plan?.analysis || {};
  const strategy = plan?.strategy || {};
  const mg = analysis.macroGrams || {};

  const sections = [
    '=== ENGINE AUDIT ===',
    `profile: goal=${JSON.stringify(userData?.goal || '')} clinical=${userData?.clinicalProtocol || 'none'}`,
    `engine: dietHints="${userData?._engineDietHints || buildQuestionnaireDietHints(userData)}" blocked=${(userData?._engineBlockedTerms || extractQuestionnaireBlockedTerms(userData)).slice(0, 12).join('; ')}`,
    `step1: intake=${analysis.Final_Calories || '?'}kcal P${mg.protein || '?'}/C${mg.carbs || '?'}/F${mg.fats || '?'} deterministic=${analysis._deterministicEnergy ? 'yes' : 'no'}`,
    `step2: profile=${strategy.libraryDietProfile || '?'} modifier=${strategy.dietaryModifier || '?'} ${summarizeWeeklyScheme(strategy)}`,
    `step3 skeleton:\n${summarizeWeekPlanSkeleton(plan?.weekPlan)}`,
  ];

  const warnings = [
    ...(plan?.generationWarnings || []),
    ...(codeValidation?.warnings || []),
    ...(codeValidation?.errors || []),
  ].filter(Boolean);
  if (warnings.length) {
    sections.push(`code_warnings (${warnings.length}): ${warnings.slice(0, 8).join(' | ')}`);
  }

  const problems = (analysis.keyProblems || []).slice(0, 4).map(p => p.title).filter(Boolean);
  if (problems.length) sections.push(`keyProblems: ${problems.join('; ')}`);

  const notes = userData?.additionalNotes ? String(userData.additionalNotes).slice(0, 400) : '';
  if (notes) sections.push(`notes: ${notes}`);

  return sections.join('\n');
}
