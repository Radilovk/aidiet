import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompactIndex } from '../worker.js';
import {
  inferRequiredGear,
  inferExerciseTraits,
  applyMetadataCorrections,
  resolveAllowedGear,
  passesGearFilter,
  passesBeginnerSafety,
  GEAR_FLOOR,
  GEAR_WALL,
  GEAR_RINGS,
  GEAR_SUSPENSION,
} from '../exercise-tags.js';
import {
  filterExercises,
  exerciseProfileFromAnswers,
  buildExerciseCatalogSnippet,
} from '../exercise-metadata.js';
import { allowedEquipmentSet } from '../worker.js';

test('inferRequiredGear: ring dips → rings+floor', () => {
  const gear = inferRequiredGear('ring dips', 'body weight');
  assert.ok(gear.includes(GEAR_RINGS));
  assert.ok(gear.includes(GEAR_FLOOR));
});

test('inferRequiredGear: suspended split squat → suspension', () => {
  const gear = inferRequiredGear('suspended split squat', 'body weight');
  assert.ok(gear.includes(GEAR_SUSPENSION));
});

test('applyMetadataCorrections: lean planche → diff 3', () => {
  const c = applyMetadataCorrections({ name: 'lean planche', equipment: 'body weight' }, { diff: 1, gf: 70, gm: 70, flags: [] });
  assert.equal(c.diff, 3);
  assert.ok(c.flags.includes('gymnastics'));
});

test('resolveAllowedGear: собствено тегло → floor+wall only', () => {
  const gear = resolveAllowedGear(['Собствено тегло']);
  assert.ok(gear.has(GEAR_FLOOR));
  assert.ok(gear.has(GEAR_WALL));
  assert.equal(gear.has(GEAR_RINGS), false);
  assert.equal(gear.has(GEAR_SUSPENSION), false);
});

test('beginner woman bodyweight: no rings/suspended in catalog', async () => {
  const raw = await (await fetch('https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/data/exercises.json')).json();
  const meta = (await import('../data/exercise-metadata.json', { with: { type: 'json' } })).default;
  const index = buildCompactIndex(raw, {}, meta);
  const profile = exerciseProfileFromAnswers({ gender: 'Жена', experience: 'Начинаещ' });
  const allowed = allowedEquipmentSet(['Собствено тегло']);
  const gear = resolveAllowedGear(['Собствено тегло']);
  const filtered = filterExercises(index, profile, allowed, null, null, gear);
  const catalog = buildExerciseCatalogSnippet(index, profile, allowed, { allowedGear: gear });

  const bad = filtered.filter((e) => /\bring\b|suspended|planche|muscle[- ]?up|parallel bar/i.test(e.name));
  assert.equal(bad.length, 0, `unexpected: ${bad.map((e) => e.name).join(', ')}`);
  assert.ok(!catalog.includes('suspended split squat'));
  assert.ok(!catalog.includes('ring dips'));
  assert.ok(catalog.includes('glute bridge') || catalog.includes('push-up (wall)'));
});

test('passesBeginnerSafety blocks pull-ups without bar gear', () => {
  const profile = exerciseProfileFromAnswers({ gender: 'Жена', experience: 'Начинаещ' });
  const entry = { name: 'pull-up', equipment: 'body weight', diff: 2, gear: ['floor', 'pull_bar'] };
  assert.equal(passesBeginnerSafety(entry, profile), false);
});

test('passesGearFilter: ring dips blocked for floor-only', () => {
  const entry = applyMetadataCorrections({ name: 'ring dips', equipment: 'body weight' }, { diff: 2, gf: 60, gm: 80, flags: [] });
  const gear = resolveAllowedGear(['Собствено тегло']);
  assert.equal(passesGearFilter(entry, gear), false);
});
