import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDiffFromDimensions, clampDiff, clampScore } from '../exercise-efp-rubric.js';

test('deriveDiffFromDimensions: motor 3 forces diff 3', () => {
  assert.equal(deriveDiffFromDimensions({ motor: 3, coordination: 1, plyometric: false, diff: 2 }), 3);
});

test('clampDiff and clampScore', () => {
  assert.equal(clampDiff(0), 1);
  assert.equal(clampDiff(4), 3);
  assert.equal(clampScore(150), 100);
});
