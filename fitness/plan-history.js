/**
 * Версии на клиентски програми в KV — snapshot преди всяка промяна/регенерация.
 * Ключовете са по clientProgramId, за да оцелява историята при смяна на planId.
 */

export const PLAN_HISTORY_MAX = 30;
export const PLAN_HISTORY_TTL = 60 * 60 * 24 * 90; // 90 дни

export const PLAN_HISTORY_SOURCE_LABELS = {
  manual_edit: 'Ръчна редакция',
  ai_generate: 'AI генерация',
  ai_replace: 'Заменен при нова AI генерация',
  before_restore: 'Преди възстановяване',
  restore: 'Възстановена версия',
  approve: 'Одобрение',
};

export function planHistoryIndexKey(clientProgramId) {
  return `fcp:planhist:index:${clientProgramId}`;
}

export function planHistorySnapKey(clientProgramId, revId) {
  return `fcp:planhist:snap:${clientProgramId}:${revId}`;
}

export function makeRevisionId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function loadPlanHistoryIndex(env, clientProgramId) {
  if (!env?.FITNESS_KV || !clientProgramId) return [];
  const raw = await env.FITNESS_KV.get(planHistoryIndexKey(clientProgramId), { type: 'json' });
  return Array.isArray(raw) ? raw : [];
}

export async function savePlanHistoryIndex(env, clientProgramId, index) {
  if (!env?.FITNESS_KV || !clientProgramId) return [];
  const trimmed = index.slice(0, PLAN_HISTORY_MAX);
  await env.FITNESS_KV.put(
    planHistoryIndexKey(clientProgramId),
    JSON.stringify(trimmed),
    { expirationTtl: PLAN_HISTORY_TTL },
  );
  return trimmed;
}

/**
 * Записва snapshot на planRecord в историята на клиентската програма.
 */
export async function archiveClientProgramPlan(env, clientProgramId, planRecord, meta = {}) {
  if (!env?.FITNESS_KV || !clientProgramId || !planRecord?.plan) return null;

  const revId = meta.revId || makeRevisionId();
  const entry = {
    id: revId,
    savedAt: meta.savedAt || new Date().toISOString(),
    source: meta.source || 'manual_edit',
    planId: meta.planId || planRecord.planId || null,
    planTitle: planRecord.plan?.title || '',
    note: meta.note || '',
  };

  await env.FITNESS_KV.put(
    planHistorySnapKey(clientProgramId, revId),
    JSON.stringify(planRecord),
    { expirationTtl: PLAN_HISTORY_TTL },
  );

  const index = await loadPlanHistoryIndex(env, clientProgramId);
  index.unshift(entry);
  const removed = index.slice(PLAN_HISTORY_MAX);
  const trimmed = index.slice(0, PLAN_HISTORY_MAX);
  await savePlanHistoryIndex(env, clientProgramId, trimmed);
  for (const old of removed) {
    await env.FITNESS_KV.delete(planHistorySnapKey(clientProgramId, old.id));
  }
  return entry;
}

export async function getClientProgramPlanRevision(env, clientProgramId, revId) {
  if (!env?.FITNESS_KV || !clientProgramId || !revId) return null;
  return env.FITNESS_KV.get(planHistorySnapKey(clientProgramId, revId), { type: 'json' });
}

export function formatPlanHistoryEntry(entry) {
  if (!entry) return null;
  return {
    ...entry,
    sourceLabel: PLAN_HISTORY_SOURCE_LABELS[entry.source] || entry.source,
  };
}
