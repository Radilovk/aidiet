/**
 * Plan source metadata — reproducibility when registries are admin-editable.
 */

import { getCatalogVersion } from './food-registry.js';
import { getDietRegistryVersion } from './diet-registry.js';

export function buildPlanSourceMeta(extra = {}) {
  return {
    catalogVersion: getCatalogVersion(),
    dietRegistryVersion: getDietRegistryVersion(),
    generatedAt: new Date().toISOString(),
    ...extra,
  };
}

/** Attach to plan if missing (non-destructive). */
export function ensurePlanSourceMeta(plan, extra = {}) {
  if (!plan || typeof plan !== 'object') return plan;
  if (!plan.sourceMeta || typeof plan.sourceMeta !== 'object') {
    plan.sourceMeta = buildPlanSourceMeta(extra);
  }
  return plan;
}
