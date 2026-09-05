/**
 * Step 2 Strategy Reviewer — AI audits deterministic diet/strategy proposal.
 * Engine keeps authority on weeklyScheme (slots, kcal); AI may correct diet profile,
 * food inclusions/exclusions, dessert flag, and client-facing copy.
 */

import { buildQuestionnaireDietHints, extractQuestionnaireBlockedTerms } from './questionnaire-engine-map.js';

export const ALLOWED_DIET_PROFILES = [
  'balanced',
  'mediterranean',
  'keto',
  'low_carb',
  'vegan',
  'vegetarian',
  'pescatarian',
  'high_protein',
  'low_fodmap',
  'dash',
  'paleo',
  'gluten_free',
  'dairy_free',
  'anti_inflammatory',
];

const DIET_PROFILE_LABELS = {
  balanced: 'Балансирано',
  mediterranean: 'Средиземноморска',
  keto: 'Кетогенна диета',
  low_carb: 'Нисковъглехидратна',
  vegan: 'Веган',
  vegetarian: 'Вегетарианска',
  pescatarian: 'Пескетарианска',
  high_protein: 'Високопротеинова',
  low_fodmap: 'Low-FODMAP',
  dash: 'DASH',
  paleo: 'Paleo',
  gluten_free: 'Без глутен',
  dairy_free: 'Без млечни',
  anti_inflammatory: 'Противовъзпалителна',
};

/** Default on — set STRATEGY_REVIEWER=0 to skip Step 2 AI audit. */
export function strategyReviewerEnabled(env = {}) {
  const v = env?.STRATEGY_REVIEWER;
  if (v === '0' || v === 'false' || v === false) return false;
  return true;
}

function uniqueTerms(list = []) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const t = String(item || '').trim();
    if (t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function summarizeWeeklyScheme(strategy) {
  const mon = strategy?.weeklyScheme?.monday;
  if (!mon?.mealBreakdown?.length) return '—';
  const slots = mon.mealBreakdown.map(s => `${s.type}=${s.calories}kcal`).join(', ');
  return `${slots}; freeDay=${strategy.freeDayNumber ?? '?'}; dessert=${strategy.includeDessert}`;
}

/**
 * Compressed packet for Step 2 strategy review.
 * @param {{ strategy?: object, analysis?: object, userData?: object }} ctx
 */
export function buildStrategyReviewPacket({ strategy = null, analysis = null, userData = null } = {}) {
  const mg = analysis?.macroGrams || {};
  const blocked = userData?._engineBlockedTerms || extractQuestionnaireBlockedTerms(userData);
  const hints = userData?._engineDietHints || buildQuestionnaireDietHints(userData);

  const dqNotes = [];
  const textMap = userData?._dq_text_map || {};
  for (const key of Object.keys(userData || {})) {
    if (!key.startsWith('dq_')) continue;
    const val = userData[key];
    if (val == null || val === '') continue;
    const label = textMap[key] || key;
    dqNotes.push(`${label}: ${String(val).slice(0, 200)}`);
  }

  const sections = [
    '=== ALGORITHM PROPOSAL (do not change weeklyScheme slots/kcal) ===',
    `libraryDietProfile: ${strategy?.libraryDietProfile || '?'}`,
    `dietaryModifier: ${strategy?.dietaryModifier || '?'}`,
    `modifierReasoning: ${(strategy?.modifierReasoning || '').slice(0, 300)}`,
    `includeDessert: ${strategy?.includeDessert}`,
    `weeklyScheme: ${summarizeWeeklyScheme(strategy)}`,
    `foodsToInclude: ${(strategy?.foodsToInclude || strategy?.preferredFoodCategories || []).join('; ')}`,
    `foodsToAvoid: ${(strategy?.foodsToAvoid || strategy?.avoidFoodCategories || []).join('; ')}`,
    '',
    '=== STEP 1 CONTRACT (fixed — do not change calories/macros) ===',
    `intake: ${analysis?.Final_Calories || '?'} kcal/day`,
    `macros: P${mg.protein || '?'}/C${mg.carbs || '?'}/F${mg.fats || '?'} g`,
    '',
    '=== CLIENT PROFILE ===',
    `goal: ${JSON.stringify(userData?.goal || '')}`,
    `preferences: ${JSON.stringify(userData?.dietPreference || '')}`,
    `dislikes: ${userData?.dietDislike || '—'}`,
    `favorites: ${userData?.dietLove || '—'}`,
    `medical: ${JSON.stringify(userData?.medicalConditions || [])}`,
    `clinicalProtocol: ${userData?.clinicalProtocol || 'none'}`,
    `habits: ${JSON.stringify(userData?.eatingHabits || [])}`,
    `cravings: ${JSON.stringify(userData?.foodCravings || [])}`,
    `engineDietHints: ${hints || '—'}`,
    `engineBlockedTerms: ${blocked.join('; ') || '—'}`,
  ];

  const notes = userData?.additionalNotes ? String(userData.additionalNotes).trim() : '';
  if (notes) sections.push('', `additionalNotes:\n${notes.slice(0, 1200)}`);
  if (dqNotes.length) sections.push('', `questionnaireDetails:\n${dqNotes.slice(0, 12).join('\n')}`);

  return sections.join('\n');
}

export const DEFAULT_STRATEGY_REVIEWER_PROMPT = `Ти си старши клиничен диетолог-ревизор. Получаваш ГОТОВО алгоритмично предложение за Step 2 (диета, ограничения, рамка).

═══ КОНТЕКСТ ═══
{reviewPacket}

═══ РОЛЯ ═══
Одитирай дали алгоритъмът е избрал правилната диета и хранителна рамка за този клиент.
Чети внимателно additionalNotes и questionnaireDetails — те имат приоритет над общи предположения.

НЕ създавай нов план от нулата. НЕ променяй weeklyScheme (слотове, калории, макроси по ден).
Можеш да коригираш: libraryDietProfile, dietaryModifier, foodsToInclude, foodsToAvoid, includeDessert, клиентски текст.

Върни САМО JSON:
{
  "verdict": "APPROVE" | "ADJUST" | "REJECT",
  "libraryDietProfile": "balanced|mediterranean|keto|low_carb|vegan|vegetarian|pescatarian|high_protein|low_fodmap|dash|paleo|gluten_free|dairy_free|anti_inflammatory",
  "dietaryModifier": "кратко име на диетата за клиента",
  "modifierReasoning": "защо тази рамка е подходяща (мин. 40 знака)",
  "foodsToInclude": ["3-8 категории/типове храни за рамката"],
  "foodsToAvoid": ["3-10 категории/типове — категорично изключени"],
  "includeDessert": true | false,
  "reviewNotes": ["бележки за одита, max 4"],
  "welcomeMessage": "по избор — 80-200 думи",
  "planJustification": "по избор — обосновка за клиента"
}

Правила:
- APPROVE: алгоритъмът е коректен; можеш да върнеш същите стойности
- ADJUST: коригирай диета/ограничения/десерт; задължително попълни modifierReasoning
- REJECT: само при явна медицинска несъвместимост (engine scheme не се пипа)
- foodsToAvoid: включи ВСИЧКО от engineBlockedTerms + допълнителни от свободния текст
- foodsToInclude/foodsToAvoid: типове храни, не конкретни ястия
- includeDessert=false при диабет/инсулинова резистентност или ако клиентът не иска сладко
- Промяна на libraryDietProfile САМО при ясна клинична нужда (IBS→low_fodmap, веган→vegan). При диабет/IR — коригирай foodsToAvoid и includeDessert, не сменяй профила без нужда`;

/**
 * Parse reviewer AI response.
 */
export function parseStrategyReviewerResponse(raw) {
  const base = {
    verdict: 'APPROVE',
    libraryDietProfile: null,
    dietaryModifier: '',
    modifierReasoning: '',
    foodsToInclude: [],
    foodsToAvoid: [],
    includeDessert: null,
    reviewNotes: [],
    welcomeMessage: '',
    planJustification: '',
  };
  if (!raw || typeof raw !== 'object' || raw.error) return base;

  const verdict = ['APPROVE', 'ADJUST', 'REJECT'].includes(raw.verdict) ? raw.verdict : 'APPROVE';
  const profile = ALLOWED_DIET_PROFILES.includes(raw.libraryDietProfile)
    ? raw.libraryDietProfile
    : null;

  return {
    verdict,
    libraryDietProfile: profile,
    dietaryModifier: String(raw.dietaryModifier || '').slice(0, 80),
    modifierReasoning: String(raw.modifierReasoning || '').slice(0, 800),
    foodsToInclude: Array.isArray(raw.foodsToInclude) ? raw.foodsToInclude.map(String).slice(0, 12) : [],
    foodsToAvoid: Array.isArray(raw.foodsToAvoid) ? raw.foodsToAvoid.map(String).slice(0, 16) : [],
    includeDessert: typeof raw.includeDessert === 'boolean' ? raw.includeDessert : null,
    reviewNotes: Array.isArray(raw.reviewNotes) ? raw.reviewNotes.map(String).slice(0, 5) : [],
    welcomeMessage: String(raw.welcomeMessage || '').slice(0, 2000),
    planJustification: String(raw.planJustification || '').slice(0, 1200),
  };
}

/**
 * Apply bounded reviewer corrections onto deterministic strategy.
 * @param {object} strategy
 * @param {ReturnType<typeof parseStrategyReviewerResponse>} review
 * @param {{ mandatoryBlocked?: string[] }} [guardrails]
 */
export function applyStrategyReviewAdjustments(strategy, review, guardrails = {}) {
  if (!strategy || !review) return strategy;

  const mandatoryBlocked = uniqueTerms([
    ...(guardrails.mandatoryBlocked || []),
    ...(strategy.foodsToAvoid || []),
    ...(strategy.avoidFoodCategories || []),
  ]);

  if (review.libraryDietProfile) {
    strategy.libraryDietProfile = review.libraryDietProfile;
  }
  if (review.dietaryModifier) {
    strategy.dietaryModifier = review.dietaryModifier;
    strategy.dietType = review.dietaryModifier;
  } else if (review.libraryDietProfile && DIET_PROFILE_LABELS[review.libraryDietProfile]) {
    strategy.dietaryModifier = DIET_PROFILE_LABELS[review.libraryDietProfile];
    strategy.dietType = strategy.dietaryModifier;
  }
  if (review.modifierReasoning) strategy.modifierReasoning = review.modifierReasoning;

  if (review.foodsToInclude?.length) {
    strategy.foodsToInclude = uniqueTerms(review.foodsToInclude);
    strategy.preferredFoodCategories = [...strategy.foodsToInclude];
  }
  if (review.foodsToAvoid?.length || mandatoryBlocked.length) {
    strategy.foodsToAvoid = uniqueTerms([...mandatoryBlocked, ...(review.foodsToAvoid || [])]);
    strategy.avoidFoodCategories = [...strategy.foodsToAvoid];
  }
  if (review.includeDessert != null) strategy.includeDessert = review.includeDessert;

  if (review.welcomeMessage) strategy.welcomeMessage = review.welcomeMessage;
  if (review.planJustification) strategy.planJustification = review.planJustification;

  strategy._strategyReview = {
    verdict: review.verdict,
    at: new Date().toISOString(),
    notes: review.reviewNotes || [],
  };

  return strategy;
}

/** Build prompt text for Strategy Reviewer call. */
export function buildStrategyReviewerPrompt(reviewPacket, customTemplate = null) {
  const tpl = customTemplate || DEFAULT_STRATEGY_REVIEWER_PROMPT;
  return tpl.replace(/\{reviewPacket\}/g, reviewPacket || '');
}
