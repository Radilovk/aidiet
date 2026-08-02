import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyExercise,
  ruleBasedDifficulty,
  genderFitScores,
  referenceDifficulty,
  classificationRefStats,
} from '../exercise-classification.js';
import { inferExerciseTraits } from '../exercise-tags.js';
import { heuristicClassification } from '../exercise-metadata.js';

test('referenceDifficulty: зареден bundled ref', () => {
  const stats = classificationRefStats();
  assert.ok(stats.total >= 400, `ref entries: ${stats.total}`);
});

test('ruleBasedDifficulty: barbell curl ≠ barbell squat', () => {
  const curlTraits = inferExerciseTraits('barbell curl', 'barbell');
  const squatTraits = inferExerciseTraits('barbell full squat', 'barbell');
  assert.ok(ruleBasedDifficulty({ name: 'barbell curl', equipment: 'barbell' }, curlTraits) <= 2);
  assert.equal(ruleBasedDifficulty({ name: 'barbell full squat', equipment: 'barbell' }, squatTraits), 3);
});

test('classifyExercise: plyo push-up → diff 3', () => {
  const c = classifyExercise({ id: 'x', name: 'plyo push up', equipment: 'body weight' });
  assert.ok(c.diff >= 3, `diff=${c.diff}`);
});

test('classifyExercise: hip thrust → висок gf', () => {
  const c = classifyExercise({ id: 'x', name: 'barbell hip thrust', equipment: 'barbell', target: 'glutes' });
  assert.ok(c.gf >= 90);
  assert.ok(c.diff >= 2);
});

test('classifyExercise: bench press → по-нисък gf, по-висок gm', () => {
  const c = classifyExercise({ id: 'x', name: 'barbell bench press', equipment: 'barbell', target: 'pectorals' });
  assert.ok(c.gf <= 50, `gf=${c.gf}`);
  assert.ok(c.gm >= 85, `gm=${c.gm}`);
});

test('classifyExercise: close-grip push-up не е press bias', () => {
  const c = classifyExercise({ id: 'x', name: 'close-grip push-up', equipment: 'body weight', target: 'triceps' });
  assert.ok(c.gf >= 55, `gf=${c.gf}`);
});

test('genderFitScores: glute kickback от target', () => {
  const { gf } = genderFitScores({ name: 'cable kickback', equipment: 'cable', target: 'glutes' });
  assert.ok(gf >= 90);
});

test('heuristicClassification: machine leg press → diff 1', () => {
  const h = heuristicClassification({ name: 'sled 45° leg press', equipment: 'sled machine' });
  assert.equal(h.diff, 1);
});

test('heuristicClassification: gender variant excluded via metadata path', async () => {
  const { metadataForExercise } = await import('../exercise-metadata.js');
  const m = metadataForExercise({ id: '1', name: 'push-up (male)', equipment: 'body weight' }, {});
  assert.equal(m.excluded, true);
});
