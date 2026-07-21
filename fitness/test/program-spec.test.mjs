import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLevel,
  parseSessionCount,
  suggestSplit,
  buildProgramSpec,
  formatProgramSpecBlock,
  buildCompactProfileForPrompt,
  buildVolumeBudget,
} from '../program-spec.js';

test('parseLevel: начинаещ → 1', () => {
  assert.equal(parseLevel('Никакъв / начинаещ (0–6 месеца системно)'), 1);
  assert.equal(parseLevel('Напреднал (5+ години)'), 3);
});

test('parseSessionCount: от freq', () => {
  assert.equal(parseSessionCount('3–4'), 3);
  assert.equal(parseSessionCount('5–6'), 5);
});

test('buildProgramSpec: жена отслабване + зони', () => {
  const spec = buildProgramSpec({
    gender: 'Жена',
    experience: 'Никакъв / начинаещ (0–6 месеца системно)',
    goal: { main: 'Отслабване', zones: 'бедра, корем' },
    preferences: { freq: '3–4', duration: '30–45 мин' },
    health: ['Няма установени заболявания'],
    limitations: ['Нямам ограничения'],
  });
  assert.equal(spec.sessions, 3);
  assert.equal(spec.level, 1);
  assert.ok(spec.volume.glutes >= spec.volume.chest);
  assert.ok(spec.zonesText.includes('бедра'));
  assert.ok(spec.split.includes('full-body') || spec.split.includes('lower'));
});

test('formatProgramSpecBlock: компактен XML блок', () => {
  const spec = buildProgramSpec({
    gender: 'Жена',
    experience: 'Среден опит (2–5 години)',
    goal: { main: 'Рекомпозиция', zones: 'дупе, бедра' },
    preferences: { freq: '3–4', duration: '45–60 мин' },
  });
  const block = formatProgramSpecBlock(spec);
  assert.ok(block.includes('sessions: 3'));
  assert.ok(block.includes('volume/wk:'));
  assert.ok(block.includes('zones↓:'));
  assert.ok(block.includes('reps:'));
});

test('buildVolumeBudget: зони boost първата зона', () => {
  const { volume, zonesOrdered } = buildVolumeBudget({
    gender: 'Мъж',
    experience: 'Среден',
    goal: { main: 'Покачване на мускулна маса', zones: 'гръб, гърди' },
  });
  assert.ok(zonesOrdered.includes('back'));
  assert.ok(volume.back >= volume.arms);
});

test('buildCompactProfileForPrompt: без дублиране на goal/freq', () => {
  const p = buildCompactProfileForPrompt({
    health: ['Хипертония'],
    limitations: ['Болка: коляно'],
    preferences: { avoid: 'клек' },
    stress: 9,
  });
  assert.ok(p.includes('Хипертония'));
  assert.ok(p.includes('коляно'));
  assert.ok(!p.includes('трен./седм'));
});
