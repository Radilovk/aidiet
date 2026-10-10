/**
 * Метаданни на двигателя в плана — коя версия го е изградила и с какви
 * данни. Двигателят е nutrition-engine/: хранителна схема в обменни порции.
 */

import { ENGINE_ID, ENGINE_VERSION } from './nutrition-engine/plan-shape.js';
import { DISHES } from './nutrition-engine/knowledge.js';

export const PLAN_ENGINE_VERSION = ENGINE_VERSION;

/**
 * @param {object|null} analysis
 * @param {object|null} strategy
 * @param {object|null} mealPlan
 * @param {{ step3DurationMs?: number }} [metrics]
 */
export function buildPlanEngineMeta(analysis, strategy, mealPlan, metrics = {}) {
  const warnings = mealPlan?.generationWarnings;
  return {
    planEngine: mealPlan?.planEngine || ENGINE_ID,
    step3Engine: mealPlan?.step3Engine || ENGINE_ID,
    profileCode: strategy?.profileCode || null,
    step1Deterministic: Boolean(analysis?._deterministicEnergy),
    analysisDeterministic: Boolean(analysis?._deterministicAnalysis),
    analysisAiNarrative: Boolean(analysis?._aiNarrative),
    step2Deterministic: Boolean(strategy?._deterministicCore),
    step3DurationMs: metrics.step3DurationMs ?? mealPlan?.step3DurationMs ?? null,
    generationWarningsCount: Array.isArray(warnings) ? warnings.length : 0,
    dishCatalogCount: DISHES.length,
    planEngineVersion: PLAN_ENGINE_VERSION,
    pipelineVersion: 4,
    generatedAt: new Date().toISOString(),
  };
}
