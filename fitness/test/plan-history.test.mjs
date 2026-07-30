import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planHistoryIndexKey,
  planHistorySnapKey,
  makeRevisionId,
  archiveClientProgramPlan,
  loadPlanHistoryIndex,
  getClientProgramPlanRevision,
  PLAN_HISTORY_MAX,
} from '../plan-history.js';

function mockKv() {
  const store = new Map();
  return {
    FITNESS_KV: {
      async get(key, opts) {
        const val = store.get(key);
        if (val == null) return null;
        return opts?.type === 'json' ? JSON.parse(val) : val;
      },
      async put(key, val) { store.set(key, val); },
      async delete(key) { store.delete(key); },
    },
    _store: store,
  };
}

test('plan history keys and revision id', () => {
  assert.equal(planHistoryIndexKey('fcp_x'), 'fcp:planhist:index:fcp_x');
  assert.equal(planHistorySnapKey('fcp_x', 'rev1'), 'fcp:planhist:snap:fcp_x:rev1');
  assert.match(makeRevisionId(new Date('2026-07-30T12:00:00.000Z')), /^2026-07-30T12-00-00-000Z$/);
});

test('archiveClientProgramPlan: записва snapshot и индекс', async () => {
  const env = mockKv();
  const record = { plan: { title: 'Test', days: [] }, editedAt: '2026-07-30T10:00:00Z' };
  const entry = await archiveClientProgramPlan(env, 'fcp_1', record, { source: 'manual_edit', planId: 'p1' });
  assert.ok(entry?.id);
  const index = await loadPlanHistoryIndex(env, 'fcp_1');
  assert.equal(index.length, 1);
  assert.equal(index[0].planTitle, 'Test');
  const snap = await getClientProgramPlanRevision(env, 'fcp_1', entry.id);
  assert.equal(snap.plan.title, 'Test');
});

test('archiveClientProgramPlan: ограничава до PLAN_HISTORY_MAX', async () => {
  const env = mockKv();
  const record = { plan: { title: 'X', days: [] } };
  for (let i = 0; i < PLAN_HISTORY_MAX + 3; i++) {
    await archiveClientProgramPlan(env, 'fcp_2', record, { revId: `rev-${i}`, source: 'manual_edit' });
  }
  const index = await loadPlanHistoryIndex(env, 'fcp_2');
  assert.equal(index.length, PLAN_HISTORY_MAX);
  const old = await getClientProgramPlanRevision(env, 'fcp_2', 'rev-0');
  assert.equal(old, null);
});
