/**
 * NutriPlan Client Card (CC v1) — compressed, structured dossier for admin AI assistant.
 * Extends NPCF (context-compression.js) with plan metadata, outputs, and analytics slot.
 */

import {
  serializeUserProfile,
  serializeAnalysisForStep,
  serializeStrategyForMealPlan,
  serializeWeekPlanSummary,
  serializeWeekPlanAdmin,
  serializeWeekPlanClient,
  estimateTokenCount,
} from './context-compression.js';
import { serializeAnalyticsBlock } from './analytics-compression.js';

const esc = (value) => {
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
    `${esc(p.title || p.name)}:${p.severity || ''}`
  ).join('+');
  const needs = (analysis.nutritionalNeeds || analysis.nutritionalDeficiencies || []).slice(0, 6).join('+');
  const cm = analysis.correctedMetabolism || {};
  const mr = analysis.macroRatios || {};
  const mg = analysis.macroGrams || {};
  return [
    '#AN v1 admin',
    `bmi=${analysis.bmi ?? ''}|bmr=${cm.realBMR ?? analysis.bmr ?? ''}|tdee=${cm.realTDEE ?? analysis.tdee ?? ''}|cal=${analysis.Final_Calories || analysis.recommendedCalories || ''}`,
    analysis.psychoProfile?.temperament ? `temp=${esc(analysis.psychoProfile.temperament)}@${analysis.psychoProfile.probability ?? 0}%` : '',
    analysis.psychologicalProfile ? `psy=${esc(String(analysis.psychologicalProfile).slice(0, 500))}` : '',
    analysis.holisticSummary ? `hol=${esc(String(analysis.holisticSummary).slice(0, 400))}` : '',
    probs ? `prob=${probs}` : '',
    needs ? `need=${esc(needs)}` : '',
    mr.protein != null ? `pct|P${mr.protein}/C${mr.carbs}/F${mr.fats}` : '',
    mg.protein != null ? `g|P${mg.protein}/C${mg.carbs}/F${mg.fats}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * @param {object} summary
 * @returns {string}
 */
export function serializePlanSummary(summary) {
  if (!summary) return '';
  const m = summary.macros || {};
  return [
    '#SM v1',
    `bmr=${summary.bmr ?? ''}|cal=${summary.dailyCalories ?? ''}`,
    m.protein != null ? `mac|P${m.protein}/C${m.carbs}/F${m.fats}` : '',
    summary.overview ? `ov=${esc(String(summary.overview).slice(0, 300))}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * @param {unknown} items
 * @param {number} max
 * @returns {string}
 */
function serializeList(items, max = 12) {
  if (!items) return '';
  if (Array.isArray(items)) return items.slice(0, max).map(i => esc(typeof i === 'string' ? i : i?.text || i?.name || JSON.stringify(i))).join('+');
  if (typeof items === 'object') return esc(JSON.stringify(items).slice(0, 400));
  return esc(String(items).slice(0, 400));
}

/**
 * @param {object} psychology
 * @returns {string}
 */
function serializePsychology(psychology) {
  if (!psychology) return '';
  const parts = [];
  if (psychology.profile) parts.push(`prof=${esc(String(psychology.profile).slice(0, 300))}`);
  if (psychology.tips?.length) parts.push(`tips=${serializeList(psychology.tips, 6)}`);
  if (psychology.challenges?.length) parts.push(`ch=${serializeList(psychology.challenges, 5)}`);
  if (psychology.motivation) parts.push(`mot=${esc(String(psychology.motivation).slice(0, 200))}`);
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
export function buildClientCard(clientData, options = {}) {
  const answers = clientData?.answers || {};
  const plan = clientData?.plan || null;
  const analytics = options.analytics ?? clientData?.analytics ?? null;

  const hasNotes = Boolean(answers.additionalNotes);
  const hasClinical = Boolean(answers.clinicalProtocol);
  const profile = serializeUserProfile(answers, 'full', { hasNotesSection: hasNotes, hasClinicalSection: hasClinical });

  const meta = [
    '#CC v1 — Клиентски картон',
    `META|id=${esc(clientData?.id)}|st=${esc(clientData?.planStatus || 'none')}|sub=${esc((clientData?.submittedAt || clientData?.timestamp || '').slice(0, 10))}|act=${esc((clientData?.planActivatedAt || '').slice(0, 10) || '—')}|uid=${esc(clientData?.userId || '—')}|upd=${esc((clientData?.planUpdatedAt || '').slice(0, 10) || '—')}`,
    clientData?.planGenerationError ? `ERR|${esc(clientData.planGenerationError)}` : '',
    answers.email ? `EM|${esc(answers.email)}` : '',
    answers.additionalNotes ? `NT|${esc(String(answers.additionalNotes).slice(0, 500))}` : '',
    (clientData?.files?.length) ? `FL|count=${clientData.files.length}|names=${clientData.files.slice(0, 5).map(f => esc(f.name)).join('+')}` : '',
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
    if (plan.waterIntake) planBlocks.push(`#WT v1 ${esc(typeof plan.waterIntake === 'string' ? plan.waterIntake : JSON.stringify(plan.waterIntake).slice(0, 200))}`);
    if (clientData?.adminNotes) planBlocks.push(`#AD v1 ${esc(String(clientData.adminNotes).slice(0, 400))}`);
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

/** @typedef {'profile'|'profile_full'|'summary'|'meals'|'analysis'|'strategy'|'recommendations'|'forbidden'|'psychology'|'supplements'|'water'} ChatSectionId */

const CHAT_SECTION_ORDER = /** @type {const} */ ([
  'profile', 'profile_full', 'summary', 'meals', 'analysis', 'strategy',
  'recommendations', 'forbidden', 'psychology', 'supplements', 'water',
]);

const CHAT_BASE = ['profile', 'summary', 'meals', 'recommendations', 'forbidden'];
const CHAT_MODIFICATION = [...CHAT_SECTION_ORDER];

const CHAT_INTENTS = /** @type {Array<[RegExp, ChatSectionId|ChatSectionId[]]>} */ ([
  [/\b(калори|kcal|ккал|bmr|tdee|енерги|макро|протеин|белтък|въглехидрат|мазнин|bmi|метабол)\b/iu, ['summary', 'analysis']],
  [/\b(стратег|принцип|подход|режим|разпредел|свободн\w*\s+ден)\b/iu, 'strategy'],
  [/\b(препоръч|съвет|насок)\b/iu, 'recommendations'],
  [/\b(забран|избягв|не\s+ям|алерг|непоносим)\b/iu, 'forbidden'],
  [/\b(психол|мотивац|стрес|навик|емоци|тригер)\b/iu, 'psychology'],
  [/\b(добавк|витамин|минерал|суплемент)\b/iu, 'supplements'],
  [/\b(вода|хидрат|течност)\b/iu, 'water'],
  [/\b(анамнез|история|лекарств|медицин|сън|активност|спорт|хронотип)\b/iu, 'profile_full'],
]);

/**
 * @param {Record<string, unknown>} userData
 * @param {object|null} plan
 * @returns {Record<string, string>}
 */
export function buildChatContextSections(userData, plan) {
  const p = plan || {};
  const hasNotes = Boolean(userData?.additionalNotes);
  const sections = {
    profile: serializeUserProfile(userData, 'strategy'),
    profile_full: serializeUserProfile(userData, 'full', {
      hasNotesSection: hasNotes,
      hasClinicalSection: Boolean(userData?.clinicalProtocol),
    }),
    summary: serializePlanSummary(p.summary) || '',
    meals: p.weekPlan ? serializeWeekPlanClient(p.weekPlan) : '',
    analysis: serializeAnalysisForStep(p.analysis || p.step0, 4) || '',
    strategy: serializeStrategyForMealPlan(p.strategy) || '',
    recommendations: p.recommendations ? `#RC v1 ${serializeList(p.recommendations, 15)}` : '',
    forbidden: p.forbidden ? `#FB v1 ${serializeList(p.forbidden, 15)}` : '',
    psychology: serializePsychology(p.psychology),
    supplements: p.supplements ? `#SP v1 ${serializeList(p.supplements, 10)}` : '',
    water: p.waterIntake
      ? `#WT v1 ${esc(typeof p.waterIntake === 'string' ? p.waterIntake : JSON.stringify(p.waterIntake).slice(0, 200))}`
      : '',
  };
  for (const key of Object.keys(sections)) {
    if (!sections[key]) delete sections[key];
  }
  return sections;
}

/**
 * @param {string} message
 * @param {string} [mode]
 * @returns {ChatSectionId[]}
 */
export function selectChatSections(message, mode = 'consultation') {
  if (mode === 'modification') return [...CHAT_MODIFICATION];
  const picked = new Set(/** @type {ChatSectionId[]} */ (CHAT_BASE));
  const msg = (message || '').toLowerCase();
  for (const [pattern, target] of CHAT_INTENTS) {
    if (!pattern.test(msg)) continue;
    const ids = Array.isArray(target) ? target : [target];
    for (const id of ids) picked.add(id);
  }
  if (picked.has('profile_full')) picked.delete('profile');
  return CHAT_SECTION_ORDER.filter((id) => picked.has(id));
}

/**
 * @param {Record<string, string>} sections
 * @param {ChatSectionId[]} selectedIds
 */
export function assembleChatContextPrompt(sections, selectedIds) {
  const lines = ['#CC chat v1 — NPCF контекст'];
  for (const id of selectedIds) {
    const text = sections[id];
    if (!text) continue;
    lines.push(`##[${id}]`, text);
  }
  return lines.join('\n');
}

/**
 * @param {Record<string, unknown>} userData
 * @param {object|null} plan
 * @param {string} message
 * @param {string} [mode]
 */
export function buildChatContext(userData, plan, message, mode = 'consultation') {
  const sections = buildChatContextSections(userData, plan);
  const selectedIds = selectChatSections(message, mode);
  const contextText = assembleChatContextPrompt(sections, selectedIds);
  return {
    sections,
    selectedIds,
    contextText,
    tokenEstimate: estimateTokenCount(contextText),
  };
}

export { estimateTokenCount };
