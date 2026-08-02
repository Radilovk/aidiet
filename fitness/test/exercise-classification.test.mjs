import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveDiffFromDimensions,
  isCuratedEfpRecord,
  EFP_VERSION,
} from '../exercise-efp-rubric.js';
import {
  buildClassifyUserPayload,
  normalizeClassifyResult,
  needsClassification,
} from '../exercise-classify-batch.js';
import { metadataForExercise } from '../exercise-metadata.js';

test('deriveDiffFromDimensions: plyometric → diff 3', () => {
  assert.equal(deriveDiffFromDimensions({ motor: 2, coordination: 2, plyometric: true, diff: 1 }), 3);
});

test('deriveDiffFromDimensions: machine isolation → diff 1', () => {
  assert.equal(deriveDiffFromDimensions({ motor: 1, coordination: 1, plyometric: false, diff: 1 }), 1);
});

test('isCuratedEfpRecord: отхвърля heuristicOnly', () => {
  assert.equal(isCuratedEfpRecord({ diff: 2, aiClassified: true, efpVersion: 2, heuristicOnly: true }), false);
  assert.equal(isCuratedEfpRecord({ diff: 2, aiClassified: true, efpVersion: 2 }), true);
});

test('buildClassifyUserPayload: включва instructions без hint', () => {
  const payload = buildClassifyUserPayload([{
    id: '1',
    name: 'plyo push up',
    equipment: 'body weight',
    target: 'pectorals',
    instructions: { en: 'Explosive push with hand clap.' },
  }]);
  assert.ok(payload.includes('instructions'));
  assert.ok(!payload.includes('hint'));
});

test('normalizeClassifyResult: plyo push-up → diff 3', () => {
  const batch = [{ id: '1', name: 'plyo push up', equipment: 'body weight', target: 'pectorals' }];
  const out = normalizeClassifyResult({
    classifications: [{
      id: '1', diff: 1, gf: 70, gm: 75, motor: 2, coordination: 3, plyometric: true,
      flags: ['plyometric', 'advanced'],
    }],
  }, batch);
  assert.equal(out['1'].diff, 3);
  assert.equal(out['1'].efpVersion, EFP_VERSION);
  assert.equal(out['1'].aiClassified, true);
});

test('needsClassification: стар heuristicOnly запис е pending', () => {
  const ex = { id: '1', name: 'squat', equipment: 'barbell', instructions: { en: 'x' } };
  assert.equal(needsClassification(ex, { '1': { diff: 2, heuristicOnly: true, aiClassified: true } }), true);
});

test('metadataForExercise: gender variant excluded', () => {
  const store = { '1': { diff: 1, gf: 70, gm: 70, aiClassified: true, efpVersion: 2, flags: [] } };
  const m = metadataForExercise({ id: '1', name: 'push-up (male)', equipment: 'body weight', target: 'pectorals' }, store);
  assert.equal(m.excluded, true);
  assert.ok(m.flags.includes('gender_variant'));
});
