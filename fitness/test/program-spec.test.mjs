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
  resolveTrainingModality,
  buildWeekDayTypes,
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

test('resolveTrainingModality: йога / mixed / сила', () => {
  assert.equal(resolveTrainingModality({ preferences: { types: ['Йога / мобилност'] } }), 'mobility');
  assert.equal(resolveTrainingModality({ preferences: { types: ['Силов тренинг', 'Кардио'] } }), 'mixed');
  assert.equal(resolveTrainingModality({ preferences: { types: ['Силов тренинг'] } }), 'strength');
});

test('buildProgramSpec: йога → mobility dayTypes без strength split', () => {
  const spec = buildProgramSpec({
    gender: 'Жена',
    experience: 'Среден',
    goal: { main: 'Обща кондиция' },
    preferences: { types: ['Йога / мобилност'], freq: '3–4', duration: '30–45 мин' },
  });
  assert.equal(spec.modality, 'mobility');
  assert.ok(spec.split.includes('mobility'));
  assert.ok(spec.dayTypes.every((d) => d.type === 'rest' || d.type === 'mobility'));
  const block = formatProgramSpecBlock(spec);
  assert.ok(block.includes('dayTypes:'));
  assert.ok(block.includes('mobility'));
});

test('buildWeekDayTypes: mixed разделя типове по дни', () => {
  const week = buildWeekDayTypes(3, 'mixed', 'рекомпозиция');
  const training = week.filter((d) => d.type !== 'rest');
  assert.equal(training.length, 3);
  assert.ok(new Set(training.map((d) => d.type)).size >= 2);
});

test('buildCompactProfileForPrompt: свободен текст и друго', () => {
  const p = buildCompactProfileForPrompt({
    health: ['Хипертония'],
    healthOther: 'астма',
    limitations: ['Болка: коляно'],
    preferences: { avoid: 'клек', types: ['Кардио'] },
    extraInfo: 'работя на смени',
    equipmentOther: 'резистентни ленти',
    nutrition: { type: 'Друго', custom: 'веган', mealsPerDay: 4 },
  });
  assert.ok(p.includes('Хипертония'));
  assert.ok(p.includes('астма'));
  assert.ok(p.includes('коляно'));
  assert.ok(p.includes('смени'));
  assert.ok(p.includes('веган'));
  assert.ok(!p.includes('трен./седм'));
});
