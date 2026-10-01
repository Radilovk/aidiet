// XEMS селекторът за KA fitness: само избраните за нов план, кадрите от селектора навсякъде.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyXemsSelection } from '../worker.js';

const index = [
  { id: 'wg-squat', frames: ['squat/frame-1.svg', 'squat/frame-2.svg', 'squat/frame-3.svg'] },
  { id: 'wg-row', frames: ['row/frame-1.svg'] },
  { id: 'wg-plank', frames: ['plank/frame-1.svg'] },
];

test('без селекция — индексът както е', () => {
  assert.equal(applyXemsSelection(index, null), index);
});

test('нов план: само избраните, с кадрите от селектора', () => {
  const sel = new Map([['wg-squat', { frames: ['https://x/squat-1.svg', 'https://x/squat-3.svg'], zone: 'legs' }],
    ['wg-plank', { frames: [], zone: 'abs' }]]);
  const only = applyXemsSelection(index, sel, { only: true });
  assert.deepEqual(only.map((e) => e.id), ['wg-squat', 'wg-plank']);
  assert.deepEqual(only[0].frames, ['https://x/squat-1.svg', 'https://x/squat-3.svg']);
  assert.deepEqual(only[1].frames, ['plank/frame-1.svg']);          // без кадри от селектора — своите
  const all = applyXemsSelection(index, sel, { only: false });
  assert.deepEqual(all.map((e) => e.id), ['wg-squat', 'wg-row', 'wg-plank']);   // стар план: нищо не изчезва
  assert.equal(all[0].frames.length, 2);
});

test('нищо избрано от индекса — целият индекс (планът не остава празен)', () => {
  const sel = new Map([['wg-unknown', { frames: [], zone: '' }]]);
  assert.equal(applyXemsSelection(index, sel, { only: true }).length, 3);
});
