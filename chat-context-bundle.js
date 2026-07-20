/**
 * NutriPlan Smart Chat Context (SCC v1)
 *
 * Intent-based section selection + NPCF compression for client AI assistant.
 * Full profile/plan data is indexed once; each message pulls only needed sections.
 */

import {
  serializeUserProfile,
  serializeAnalysisForStep,
  serializeStrategyForMealPlan,
  serializeWeekPlanSummary,
  serializeWeekPlanClient,
  estimateTokenCount,
} from './context-compression.js';
import { serializePlanSummary } from './client-card.js';

/** @typedef {'profile_core'|'profile_full'|'plan_summary'|'plan_meals'|'plan_meals_light'|'analysis'|'strategy'|'recommendations'|'forbidden'|'psychology'|'supplements'|'water'} ChatSectionId */

export const CHAT_SECTION_IDS = /** @type {const} */ ([
  'profile_core',
  'profile_full',
  'plan_summary',
  'plan_meals',
  'plan_meals_light',
  'analysis',
  'strategy',
  'recommendations',
  'forbidden',
  'psychology',
  'supplements',
  'water',
]);

const DAY_ALIASES = {
  понеделник: 'monday', пн: 'monday',
  вторник: 'tuesday', вт: 'tuesday',
  сряда: 'wednesday', ср: 'wednesday',
  четвъртък: 'thursday', чт: 'thursday',
  петък: 'friday', пт: 'friday',
  събота: 'saturday', сб: 'saturday',
  неделя: 'sunday', нед: 'sunday',
};

const INTENT_PATTERNS = /** @type {Record<string, RegExp>} */ ({
  plan_meals: /\b(грам|гр\.?|грамаж|порци|количеств|състав|продукт|рецепт|ястие|хранен|закуск|обяд|вечер|снек|какво\s+да\s+ям)\b/iu,
  plan_summary: /\b(калори|kcal|ккал|bmr|tdee|енерги|дневн|общо\s+кал)\b/iu,
  analysis: /\b(макро|протеин|белтък|въглехидрат|мазнин|bmi|метабол|дефицит|наднормен)\b/iu,
  strategy: /\b(стратег|принцип|подход|режим|разпредел|свободн\w*\s+ден)\b/iu,
  recommendations: /\b(препоръч|съвет|насок|съвети)\b/iu,
  forbidden: /\b(забран|избягв|не\s+ям|алерг|непоносим|противопоказ)\b/iu,
  psychology: /\b(психол|мотивац|стрес|навик|емоци|тригер|компулс)\b/iu,
  supplements: /\b(добавк|витамин|минерал|суплемент)\b/iu,
  water: /\b(вода|хидрат|течност)\b/iu,
  profile_full: /\b(анамнез|история|лекарств|медицин|сън|активност|спорт|хронотип)\b/iu,
});

const DEFAULT_CONSULTATION = ['profile_core', 'plan_summary', 'plan_meals', 'recommendations', 'forbidden'];
const DEFAULT_MODIFICATION = [
  'profile_full', 'plan_summary', 'plan_meals', 'analysis', 'strategy',
  'recommendations', 'forbidden', 'psychology', 'supplements', 'water',
];

const esc = (value) => {
  if (value == null || value === '') return '';
  const s = Array.isArray(value) ? value.filter(Boolean).join('+') : String(value).trim();
  return s.replace(/\|/g, '/').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
};

/**
 * @param {unknown} items
 * @param {number} [max]
 */
function serializeList(items, max = 12) {
  if (!items) return '';
  if (Array.isArray(items)) {
    return items.slice(0, max).map((i) => esc(typeof i === 'string' ? i : i?.text || i?.name || '')).filter(Boolean).join('+');
  }
  return esc(String(items).slice(0, 400));
}

/**
 * @param {string} message
 * @returns {string[]}
 */
export function detectFocusedDays(message) {
  const lower = (message || '').toLowerCase();
  const days = new Set();
  for (const [alias, key] of Object.entries(DAY_ALIASES)) {
    if (lower.includes(alias)) days.add(key);
  }
  if (/\b(днес|today)\b/iu.test(lower)) {
    const jsDay = new Date().getDay();
    const map = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    days.add(map[jsDay]);
  }
  return [...days];
}

/**
 * @param {string} message
 * @param {string} [mode]
 * @param {{ forceAll?: boolean }} [options]
 * @returns {ChatSectionId[]}
 */
export function detectChatSections(message, mode = 'consultation', options = {}) {
  if (options.forceAll || mode === 'modification') {
    return /** @type {ChatSectionId[]} */ ([...DEFAULT_MODIFICATION]);
  }

  /** @type {Set<string>} */
  const sections = new Set(DEFAULT_CONSULTATION);
  const msg = (message || '').toLowerCase();

  for (const [section, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (!pattern.test(msg)) continue;
    if (section === 'plan_meals') {
      sections.delete('plan_meals_light');
      sections.add('plan_meals');
    } else if (section === 'plan_summary') {
      sections.add('plan_summary');
      sections.add('analysis');
    } else {
      sections.add(/** @type {ChatSectionId} */ (section));
    }
  }

  if (sections.has('profile_full')) {
    sections.delete('profile_core');
    sections.add('profile_full');
  }

  return /** @type {ChatSectionId[]} */ (CHAT_SECTION_IDS.filter((id) => sections.has(id)));
}

/**
 * @param {Record<string, unknown>} userData
 * @param {object|null} userPlan
 * @param {{ focusedDays?: string[] }} [options]
 * @returns {Record<string, string>}
 */
export function buildChatContextSections(userData, userPlan, options = {}) {
  const plan = userPlan || {};
  const focusedDays = options.focusedDays?.length ? options.focusedDays : null;
  const weekPlan = plan.weekPlan || null;

  const psychology = plan.psychology;
  let psychologyBlock = '';
  if (psychology) {
    const parts = [];
    if (psychology.profile) parts.push(`prof=${esc(String(psychology.profile).slice(0, 300))}`);
    if (psychology.tips?.length) parts.push(`tips=${serializeList(psychology.tips, 6)}`);
    if (psychology.motivation) parts.push(`mot=${esc(String(psychology.motivation).slice(0, 200))}`);
    if (parts.length) psychologyBlock = `#PS v1 ${parts.join('|')}`;
  }

  const sections = {
    profile_core: serializeUserProfile(userData, 'strategy'),
    profile_full: serializeUserProfile(userData, 'full', {
      hasNotesSection: Boolean(userData.additionalNotes),
      hasClinicalSection: Boolean(userData.clinicalProtocol),
    }),
    plan_summary: serializePlanSummary(plan.summary) || '',
    plan_meals: weekPlan
      ? serializeWeekPlanClient(weekPlan, focusedDays ? { days: focusedDays } : {})
      : '',
    plan_meals_light: weekPlan ? serializeWeekPlanSummary(weekPlan) : '',
    analysis: serializeAnalysisForStep(plan.analysis || plan.step0, 4) || '',
    strategy: serializeStrategyForMealPlan(plan.strategy) || '',
    recommendations: plan.recommendations ? `#RC v1 ${serializeList(plan.recommendations, 15)}` : '',
    forbidden: plan.forbidden ? `#FB v1 ${serializeList(plan.forbidden, 15)}` : '',
    psychology: psychologyBlock,
    supplements: plan.supplements ? `#SP v1 ${serializeList(plan.supplements, 10)}` : '',
    water: plan.waterIntake
      ? `#WT v1 ${esc(typeof plan.waterIntake === 'string' ? plan.waterIntake : JSON.stringify(plan.waterIntake).slice(0, 200))}`
      : '',
  };

  for (const key of Object.keys(sections)) {
    if (!sections[key]) delete sections[key];
  }
  return sections;
}

/**
 * @param {Record<string, string>} sections
 * @param {ChatSectionId[]} selectedIds
 * @returns {string}
 */
export function assembleContextPrompt(sections, selectedIds) {
  const lines = [
    '#SCC v1 — Smart Chat Context (NPCF)',
    'Легенда: NP=профил PL=план SM=обобщение AN=анализ ST=стратегия RC=препоръки FB=забранени PS=психология',
  ];
  for (const id of selectedIds) {
    const text = sections[id];
    if (!text) continue;
    lines.push(`##[${id}]`);
    lines.push(text);
  }
  return lines.join('\n');
}

/**
 * Fast stable fingerprint for cache keys (djb2 over section texts).
 * @param {Record<string, string>} sections
 */
export function computeContextFingerprint(sections) {
  const payload = Object.keys(sections).sort().map((k) => `${k}:${sections[k]}`).join('\n');
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) + hash) ^ payload.charCodeAt(i);
  }
  return `scc_${(hash >>> 0).toString(16)}_${payload.length}`;
}

/**
 * @param {Record<string, unknown>} userData
 * @param {object|null} userPlan
 * @param {string} message
 * @param {string} [mode]
 */
export function buildChatRequestContext(userData, userPlan, message, mode = 'consultation') {
  const focusedDays = detectFocusedDays(message);
  const allSections = buildChatContextSections(userData, userPlan, { focusedDays });
  const selectedIds = detectChatSections(message, mode);
  const fingerprint = computeContextFingerprint(allSections);
  const contextText = assembleContextPrompt(allSections, selectedIds);
  return {
    sections: allSections,
    selectedIds,
    fingerprint,
    contextText,
    tokenEstimate: estimateTokenCount(contextText),
    fullTokenEstimate: estimateTokenCount(Object.values(allSections).join('\n')),
    focusedDays,
  };
}

/**
 * @param {Record<string, string>} sections
 * @param {ChatSectionId[]} selectedIds
 */
export function resolveContextFromSections(sections, selectedIds) {
  const ids = selectedIds?.length ? selectedIds : CHAT_SECTION_IDS.filter((id) => sections[id]);
  return {
    contextText: assembleContextPrompt(sections, ids),
    selectedIds: ids,
    tokenEstimate: estimateTokenCount(assembleContextPrompt(sections, ids)),
  };
}
