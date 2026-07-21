import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  heuristicClassification,
  exerciseProfileFromAnswers,
  fitsExerciseProfile,
  filterExercises,
  buildExerciseCatalogSnippet,
  mergeExerciseMetadata,
} from '../exercise-metadata.js';

test('heuristicClassification: hip thrust → висок gf', () => {
  const h = heuristicClassification({ name: 'barbell hip thrust', equipment: 'barbell' });
  assert.ok(h.gf >= 85);
  assert.ok(h.diff >= 1 && h.diff <= 3);
});

test('exerciseProfileFromAnswers: жена начинаеща → строг филтър', () => {
  const p = exerciseProfileFromAnswers({
    gender: 'Жена',
    experience: 'Никакъв / начинаещ (0–6 месеца системно)',
  });
  assert.equal(p.maxDiff, 1);
  assert.ok(p.minGf >= 65);
});

test('fitsExerciseProfile + catalog', () => {
  const profile = exerciseProfileFromAnswers({ gender: 'Жена', experience: 'Начинаещ' });
  const easy = { name: 'cable glute kickback', diff: 1, gf: 90, gm: 70, equipNorm: 'cable', targetNorm: 'glutes' };
  const hard = { name: 'barbell bench press', diff: 2, gf: 30, gm: 90, equipNorm: 'barbell', targetNorm: 'chest' };
  assert.equal(fitsExerciseProfile(easy, profile), true);
  assert.equal(fitsExerciseProfile(hard, profile), false);

  const index = [easy, hard];
  const filtered = filterExercises(index, profile);
  assert.equal(filtered.length, 1);

  const catalog = buildExerciseCatalogSnippet(index, profile);
  assert.ok(catalog.includes('<exercise_catalog>'));
  assert.ok(catalog.includes('kickback'));
  assert.ok(!catalog.includes('bench press'));
});

test('mergeExerciseMetadata: heuristic без KV', () => {
  const entry = mergeExerciseMetadata({ id: '1', name: 'hip thrust' }, { id: '1', name: 'hip thrust' }, {});
  assert.ok(entry.diff >= 1);
  assert.ok(entry.gf >= 80);
});
