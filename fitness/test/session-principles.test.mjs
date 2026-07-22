import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionPhaseBudget,
  buildSessionPrinciples,
  formatSessionPrinciplesBlock,
} from '../session-principles.js';
import { buildProgramSpec } from '../program-spec.js';

test('sessionPhaseBudget: разпределя време по фази', () => {
  const b = sessionPhaseBudget(45);
  assert.equal(b.total, 45);
  assert.ok(b.warmup >= 5);
  assert.ok(b.cooldown >= 5);
  assert.equal(b.warmup + b.main + b.cooldown, 45);
});

test('formatSessionPrinciplesBlock: включва warmup/exercises/cooldown', () => {
  const spec = buildProgramSpec({
    gender: 'Жена',
    experience: 'Среден',
    goal: { main: 'Рекомпозиция' },
    preferences: { types: ['Силов тренинг'], freq: '3–4', duration: '45–60 мин' },
  });
  const block = formatSessionPrinciplesBlock(spec);
  assert.ok(block.includes('warmup'));
  assert.ok(block.includes('cooldown'));
  assert.ok(block.includes('dayFocus=strength') || block.includes('compound'));
  assert.ok(block.includes('рекомпозиция') || block.includes('Рекомпозиция'));
});

test('buildSessionPrinciples: mixed седмица включва няколко dayFocus', () => {
  const spec = buildProgramSpec({
    gender: 'Мъж',
    experience: 'Среден',
    goal: { main: 'Обща кондиция' },
    preferences: { types: ['Силов тренинг', 'Кардио'], freq: '3–4', duration: '45–60 мин' },
  });
  const p = buildSessionPrinciples(spec);
  assert.ok(p.focusBlocks.includes('strength'));
  assert.ok(p.focusBlocks.includes('cardio') || p.focusBlocks.includes('mobility'));
});
