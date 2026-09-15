/**
 * Plan generation engine version — v1 (legacy) vs v2 (dish-first, no full-week AI Step 3).
 *
 * PLAN_ENGINE env:
 *   v2 | (unset) — dish pick + gram solver; relaxed retry; slot repair; no full-chunk AI fallback
 *   v1 | legacy  — deterministic Step 3 may fall back to AI for whole chunk
 */

import { MEAL_DISHES } from './meal-dishes.js';

export const PLAN_ENGINE_VERSION = '2.5';
export const DEFAULT_PLAN_ENGINE = 'v2';

/** @returns {'v1' | 'v2'} */
export function resolvePlanEngine(env = {}) {
  const raw = String(env.PLAN_ENGINE ?? env.plan_engine ?? DEFAULT_PLAN_ENGINE).trim().toLowerCase();
  if (raw === 'v1' || raw === 'legacy') return 'v1';
  if (raw === 'v2' || raw === 'dish' || raw === 'dish-first') return 'v2';
  return DEFAULT_PLAN_ENGINE;
}

export function isPlanEngineV2(env = {}) {
  return resolvePlanEngine(env) === 'v2';
}

/** v2 never regenerates an entire week via AI when deterministic Step 3 fails. */
export function step3AllowsFullChunkAiFallback(env = {}) {
  return !isPlanEngineV2(env);
}

/** Max slot-level AI repair calls per plan (v2 stage 3). */
export const SLOT_REPAIR_MAX_CALLS_PER_PLAN = 2;

export function step3SlotRepairEnabled(env = {}) {
  return isPlanEngineV2(env);
}

/**
 * Engine telemetry for _meta.engine — used for v1/v2 A/B comparison in admin/logs.
 * @param {object|null} analysis
 * @param {object|null} strategy
 * @param {object|null} mealPlan
 * @param {{ slotRepairCalls?: number, step3DurationMs?: number }} [metrics]
 */
export function buildPlanEngineMeta(analysis, strategy, mealPlan, metrics = {}) {
  const warnings = mealPlan?.generationWarnings;
  const slotRepairCalls = Number(
    metrics.slotRepairCalls ?? mealPlan?.slotRepairCalls ?? 0,
  );
  const step3Engine = mealPlan?.step3Engine || 'unknown';
  return {
    planEngine: mealPlan?.planEngine || resolvePlanEngine({}),
    step3Engine,
    step1Deterministic: Boolean(analysis?._deterministicEnergy),
    step2Deterministic: Boolean(strategy?._deterministicCore),
    slotRepairCalls,
    step3UsedAiFallback: step3Engine === 'ai_fallback',
    step3DurationMs: metrics.step3DurationMs ?? mealPlan?.step3DurationMs ?? null,
    generationWarningsCount: Array.isArray(warnings) ? warnings.length : 0,
    dishCatalogCount: MEAL_DISHES.length,
    planEngineVersion: PLAN_ENGINE_VERSION,
    pipelineVersion: 2,
    generatedAt: new Date().toISOString(),
  };
}
