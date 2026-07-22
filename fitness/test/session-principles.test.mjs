import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionPhaseBudget,
  formatSessionFrame,
} from '../session-principles.js';
import { buildProgramSpec } from '../program-spec.js';

test('sessionPhaseBudget: разпределя време по фази', () => {
  const b = sessionPhaseBudget(45);
  assert.equal(b.total, 45);
  assert.ok(b.warmup >= 5);
  assert.ok(b.cooldown >= 5);
  assert.equal(b.warmup + b.main + b.cooldown, 45);
});

test('formatSessionFrame: компактна рамка с dayFocus deltas', () => {
  const spec = buildProgramSpec({
    gender: 'Жена',
    experience: 'Среден',
    goal: { main: 'Рекомпозиция' },
    preferences: { types: ['Силов тренинг', 'Кардио'], freq: '3–4', duration: '45–60 мин' },
  });
  const frame = formatSessionFrame(spec);
  assert.ok(frame.includes('warmup(3)'));
  assert.ok(frame.includes('dayFocus'));
  assert.ok(frame.length < 400, 'рамката е кратка, не учебник');
});
