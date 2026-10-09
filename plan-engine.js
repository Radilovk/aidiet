/**
 * Plan generation engine — един детерминистичен двигател.
 *
 * Код на профила → макро цели → схема → ястия по отпечатък → грамажи.
 * AI не взема решения в плана; по желание пише само текстовете на ястията.
 */

import { MEAL_DISHES } from './meal-dishes.js';

export const PLAN_ENGINE_VERSION = '3.0';

/**
 * Engine telemetry for _meta.engine — shown in admin/logs.
 * @param {object|null} analysis
 * @param {object|null} strategy
 * @param {object|null} mealPlan
 * @param {{ step3DurationMs?: number }} [metrics]
 */
export function buildPlanEngineMeta(analysis, strategy, mealPlan, metrics = {}) {
  const warnings = mealPlan?.generationWarnings;
  const step3Engine = mealPlan?.step3Engine || 'unknown';
  return {
    planEngine: mealPlan?.planEngine || 'deterministic',
    step3Engine,
    profileCode: strategy?.profileCode || null,
    step1Deterministic: Boolean(analysis?._deterministicEnergy),
    analysisDeterministic: Boolean(analysis?._deterministicAnalysis),
    analysisAiNarrative: Boolean(analysis?._aiNarrative),
    step2Deterministic: Boolean(strategy?._deterministicCore),
    step3DurationMs: metrics.step3DurationMs ?? mealPlan?.step3DurationMs ?? null,
    generationWarningsCount: Array.isArray(warnings) ? warnings.length : 0,
    dishCatalogCount: MEAL_DISHES.length,
    planEngineVersion: PLAN_ENGINE_VERSION,
    pipelineVersion: 3,
    generatedAt: new Date().toISOString(),
  };
}
