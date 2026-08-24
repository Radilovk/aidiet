import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dHashFromRgba,
  hammingDistanceHex,
  buildVisualSimilarityIndex,
} from '../exercise-visual-hash.js';

test('dHashFromRgba: идентични пиксели → разстояние 0', () => {
  const rgba = new Uint8ClampedArray(9 * 8 * 4).fill(128);
  const h1 = dHashFromRgba(rgba);
  const h2 = dHashFromRgba(rgba);
  assert.equal(hammingDistanceHex(h1, h2), 0);
});

test('buildVisualSimilarityIndex: групира близки хешове', () => {
  const entries = [
    { id: '1', hash: '0000000000000000', target: 'biceps' },
    { id: '2', hash: '0000000000000001', target: 'biceps' },
    { id: '3', hash: 'ffffffffffffffff', target: 'triceps' },
  ];
  const { clusterGroups } = buildVisualSimilarityIndex(entries, 2);
  assert.equal(clusterGroups.length, 1);
  assert.equal(clusterGroups[0].length, 2);
});
