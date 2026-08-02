import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompactIndex } from '../worker.js';
import {
  inferRequiredGear,
  inferExerciseTraits,
  applyMetadataCorrections,
  resolveAllowedGear,
  resolveEffectiveEquipNorm,
  isTrueBodyweightExercise,
  passesGearFilter,
  passesBeginnerSafety,
  GEAR_FLOOR,
  GEAR_RINGS,
  GEAR_SUSPENSION,
  GEAR_PULL_BAR,
  BODYWEIGHT_GEAR,
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

test('resolveAllowedGear: собствено тегло → домашна среда (под, стена, стол, пейка…)', () => {
  const gear = resolveAllowedGear(['Собствено тегло']);
  for (const g of BODYWEIGHT_GEAR) assert.ok(gear.has(g));
  assert.equal(gear.has(GEAR_RINGS), false);
  assert.equal(gear.has(GEAR_PULL_BAR), false);
});

test('chair squat е истинско СТ; captain s chair — не', () => {
  assert.equal(isTrueBodyweightExercise('chair squat', 'body weight'), true);
  assert.equal(isTrueBodyweightExercise('captains chair straight leg raise', 'body weight'), false);
});

test('resolveEffectiveEquipNorm: body weight с уред → уред', () => {
  assert.equal(resolveEffectiveEquipNorm('ring dips', 'body weight'), 'rings');
  assert.equal(resolveEffectiveEquipNorm('suspended row', 'body weight'), 'suspension');
  assert.equal(resolveEffectiveEquipNorm('pull-up', 'body weight'), 'pull_up_bar');
  assert.equal(resolveEffectiveEquipNorm('inverted row', 'body weight'), 'pull_up_bar');
  assert.equal(resolveEffectiveEquipNorm('glute bridge', 'body weight'), 'body weight');
  assert.equal(resolveEffectiveEquipNorm('hyperextension (on bench)', 'body weight'), 'body weight');
  assert.equal(resolveEffectiveEquipNorm('step-up', 'body weight'), 'body weight');
});

test('isTrueBodyweightExercise: разграничава СТ от уред', () => {
  assert.equal(isTrueBodyweightExercise('push-up', 'body weight'), true);
  assert.equal(isTrueBodyweightExercise('ring dips', 'body weight'), false);
  assert.equal(isTrueBodyweightExercise('exercise ball plank', 'stability ball'), false);
});

test('beginner woman bodyweight: no rings/suspended in catalog', async () => {
  const raw = await (await fetch('https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/data/exercises.json')).json();
  const curated = (id, diff = 1) => ({
    diff, gf: 85, gm: 60, aiClassified: true, efpVersion: 2,
    flags: ['beginner_safe', 'home_friendly', 'true_bodyweight'],
  });
  const meta = {};
  for (const ex of raw) {
    const n = (ex.name || '').toLowerCase();
    if (/glute bridge|push-up \(wall\)|wall push|chair squat|bodyweight squat/.test(n)) {
      meta[String(ex.id)] = curated(ex.id, 1);
    } else if (/ring|suspended|planche|muscle[- ]?up|parallel bar/.test(n)) {
      meta[String(ex.id)] = { diff: 3, gf: 50, gm: 80, aiClassified: true, efpVersion: 2, flags: ['advanced', 'gymnastics'] };
    }
  }
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
