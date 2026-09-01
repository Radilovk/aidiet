/**
 * Plan generation engine version — v1 (legacy) vs v2 (dish-first, no full-week AI Step 3).
 *
 * PLAN_ENGINE env:
 *   v1 | (unset) — current behaviour; deterministic Step 3 may fall back to AI for whole chunk
 *   v2 | dish    — dish pick + gram solver only; relaxed retry; no full-chunk AI fallback
 */

/** @returns {'v1' | 'v2'} */
export function resolvePlanEngine(env = {}) {
  const raw = String(env.PLAN_ENGINE ?? env.plan_engine ?? 'v1').trim().toLowerCase();
  if (raw === 'v2' || raw === 'dish' || raw === 'dish-first') return 'v2';
  return 'v1';
}

export function isPlanEngineV2(env = {}) {
  return resolvePlanEngine(env) === 'v2';
}

/** v2 never regenerates an entire week via AI when deterministic Step 3 fails. */
export function step3AllowsFullChunkAiFallback(env = {}) {
  return !isPlanEngineV2(env);
}
