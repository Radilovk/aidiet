import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreDifficulty,
  scoreGenderFit,
  targetBias,
  TARGET_BIAS,
} from '../exercise-taxonomy.js';
import { classifyExercise } from '../exercise-classification.js';
import { heuristicClassification, metadataForExercise, isMetadataOverride } from '../exercise-metadata.js';

test('TARGET_BIAS покрива всички dataset targets', async () => {
  const { fetchExerciseDataset } = await import('../exercise-translate-batch.js');
  const all = await fetchExerciseDataset();
  const targets = new Set(all.map((e) => (e.target || '').toLowerCase()));
  for (const t of targets) {
    assert.ok(TARGET_BIAS[t], `липсва bias за target: ${t}`);
  }
});

test('scoreGenderFit: glutes target → висок gf', () => {
  const { gf, gm } = scoreGenderFit('cable kickback', 'glutes', 'glutes');
  assert.ok(gf >= 90, `gf=${gf}`);
  assert.ok(gm <= 65, `gm=${gm}`);
});

test('scoreGenderFit: pectorals + bench → нисък gf, висок gm', () => {
  const { gf, gm } = scoreGenderFit('barbell bench press', 'pectorals', 'triceps');
  assert.ok(gf <= 45, `gf=${gf}`);
  assert.ok(gm >= 88, `gm=${gm}`);
});

test('scoreDifficulty: machine leg press → 1', () => {
  assert.equal(scoreDifficulty('sled 45° leg press', 'sled machine', 'quads'), 1);
});

test('scoreDifficulty: barbell curl → 2, barbell squat → 3', () => {
  assert.equal(scoreDifficulty('barbell curl', 'barbell', 'biceps'), 2);
  assert.equal(scoreDifficulty('barbell full squat', 'barbell', 'glutes'), 3);
});

test('scoreDifficulty: muscle-up → 3', () => {
  assert.equal(scoreDifficulty('muscle up', 'body weight', 'lats'), 3);
});

test('classifyExercise: wall push-up → diff 1', () => {
  const c = classifyExercise({ id: '1', name: 'push-up (wall)', equipment: 'body weight', target: 'pectorals' });
  assert.equal(c.diff, 1);
});

test('isMetadataOverride: heuristicOnly кеш се игнорира', () => {
  assert.equal(isMetadataOverride({ diff: 1, gf: 70, gm: 70, heuristicOnly: true }), false);
  assert.equal(isMetadataOverride({ diff: 2, gf: 80, gm: 75, manual: true }), true);
  assert.equal(isMetadataOverride({ diff: 2, gf: 80, gm: 75, aiClassified: true }), true);
});

test('metadataForExercise: stale bundled не презаписва live taxonomy', () => {
  const raw = { id: '99', name: 'barbell bench press', equipment: 'barbell', target: 'pectorals' };
  const stale = { '99': { diff: 1, gf: 70, gm: 70, heuristicOnly: true } };
  const m = metadataForExercise(raw, stale);
  assert.ok(m.diff >= 2, `diff=${m.diff}`);
  assert.ok(m.gf <= 50, `gf=${m.gf}`);
  assert.ok(m.gm >= 85, `gm=${m.gm}`);
});

test('metadataForExercise: abs → по-висок gf от neutral', () => {
  const m = metadataForExercise({ id: '1', name: 'crunch', equipment: 'body weight', target: 'abs' }, {});
  assert.ok(m.gf >= 78, `gf=${m.gf}`);
});

test('heuristicClassification: gender variant excluded', () => {
  const m = metadataForExercise({ id: '1', name: 'push-up (male)', equipment: 'body weight', target: 'pectorals' }, {});
  assert.equal(m.excluded, true);
});
