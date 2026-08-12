/**
 * Step 6 Final Director — AI holistic QA + client presentation (bounded corrections).
 * Engine keeps authority on scheme, products, grams, kcal.
 */

import { buildFinalAuditPacket } from './questionnaire-engine-map.js';

/** Default on — set FINAL_DIRECTOR=0 to skip Step 6 AI review. */
export function finalDirectorEnabled(env = {}) {
  const v = env?.FINAL_DIRECTOR;
  if (v === '0' || v === 'false' || v === false) return false;
  return true;
}

export const DEFAULT_FINAL_DIRECTOR_PROMPT = `Ти си старши диетичен мениджър. Получаваш ГОТОВ план, изграден от deterministic engine.

═══ AUDIT ═══
{auditPacket}

═══ ЗАДАЧА ═══
Оцени дали планът отговаря на профила и очакванията. НЕ променяй продукти, грамове, калории или slot scheme.

Върни САМО JSON:
{
  "verdict": "APPROVE" | "ADJUST" | "REJECT",
  "qualityScore": 0-100,
  "headline": "кратко заглавие за клиента",
  "clientMessage": "2-4 изречения — финално послание",
  "coherenceNotes": ["бележки за coherence, max 3"],
  "recommendations": ["10 типа храни"],
  "forbidden": ["10 типа храни"],
  "psychology": ["мин. 3 съвета"],
  "supplements": [{"name":"...","dosage":"...","reason":"..."}],
  "waterIntake": "string",
  "mealCopyPatches": [{"day":1,"mealIndex":0,"name":"...","benefits":"...","recipe":"..."}]
}

Правила:
- APPROVE: планът е coherent; patch arrays могат да са празни
- ADJUST: minor copy/coherence fixes — попълни recommendations/forbidden/psychology/mealCopyPatches
- REJECT: сериозна некohерентност (само в coherenceNotes — engine data не се пипа)
- mealCopyPatches: САМО name, benefits, recipe — без description/products/grams/calories
- forbidden/recommendations: типове храни, не ястия`;

/**
 * Parse director AI response.
 */
export function parseDirectorResponse(raw) {
  const base = {
    verdict: 'APPROVE',
    qualityScore: 80,
    headline: '',
    clientMessage: '',
    coherenceNotes: [],
    recommendations: [],
    forbidden: [],
    psychology: [],
    supplements: [],
    waterIntake: '',
    mealCopyPatches: [],
  };
  if (!raw || typeof raw !== 'object' || raw.error) return { ...base, verdict: 'APPROVE' };

  const verdict = ['APPROVE', 'ADJUST', 'REJECT'].includes(raw.verdict) ? raw.verdict : 'APPROVE';
  return {
    verdict,
    qualityScore: Math.max(0, Math.min(100, Number(raw.qualityScore) || 80)),
    headline: String(raw.headline || '').slice(0, 160),
    clientMessage: String(raw.clientMessage || '').slice(0, 1200),
    coherenceNotes: Array.isArray(raw.coherenceNotes) ? raw.coherenceNotes.map(String).slice(0, 5) : [],
    recommendations: Array.isArray(raw.recommendations) ? raw.recommendations.map(String).slice(0, 12) : [],
    forbidden: Array.isArray(raw.forbidden) ? raw.forbidden.map(String).slice(0, 12) : [],
    psychology: Array.isArray(raw.psychology) ? raw.psychology.map(String).slice(0, 6) : [],
    supplements: Array.isArray(raw.supplements) ? raw.supplements.slice(0, 8) : [],
    waterIntake: String(raw.waterIntake || '').slice(0, 200),
    mealCopyPatches: Array.isArray(raw.mealCopyPatches) ? raw.mealCopyPatches.slice(0, 21) : [],
  };
}

/** Apply bounded director overlays — never touches structural meal fields. */
export function applyDirectorAdjustments(plan, director) {
  if (!plan || !director) return plan;

  if (director.headline) plan.directorHeadline = director.headline;
  if (director.clientMessage) plan.directorMessage = director.clientMessage;
  if (director.qualityScore != null) plan.directorQualityScore = director.qualityScore;

  if (director.recommendations?.length) plan.recommendations = director.recommendations;
  if (director.forbidden?.length) plan.forbidden = director.forbidden;
  if (director.psychology?.length) plan.psychology = director.psychology;
  if (director.supplements?.length) plan.supplements = director.supplements;
  if (director.waterIntake) plan.waterIntake = director.waterIntake;

  if (plan.summary && typeof plan.summary === 'object' && director.clientMessage) {
    plan.summary.directorNote = director.clientMessage;
  }

  for (const patch of director.mealCopyPatches || []) {
    const dayNum = Number(patch.day);
    const mealIdx = Number(patch.mealIndex);
    if (!dayNum || dayNum < 1 || dayNum > 7 || mealIdx < 0) continue;
    const meal = plan.weekPlan?.[`day${dayNum}`]?.meals?.[mealIdx];
    if (!meal) continue;
    if (patch.name) meal.name = String(patch.name).slice(0, 120);
    if (patch.benefits) meal.benefits = String(patch.benefits).slice(0, 600);
    if (patch.recipe) meal.recipe = String(patch.recipe).slice(0, 1200);
  }

  if (!plan.generationWarnings) plan.generationWarnings = [];
  if (director.verdict === 'REJECT' && director.coherenceNotes?.length) {
    plan.generationWarnings.push(`Director REJECT: ${director.coherenceNotes.join('; ')}`);
  } else if (director.coherenceNotes?.length) {
    plan.generationWarnings.push(...director.coherenceNotes.slice(0, 3));
  }

  plan._finalDirector = {
    verdict: director.verdict,
    qualityScore: director.qualityScore,
    at: new Date().toISOString(),
  };

  return plan;
}

/** Build prompt text for Final Director call. */
export function buildFinalDirectorPrompt(auditPacket, customTemplate = null) {
  const tpl = customTemplate || DEFAULT_FINAL_DIRECTOR_PROMPT;
  return tpl.replace(/\{auditPacket\}/g, auditPacket || '');
}

export { buildFinalAuditPacket };
