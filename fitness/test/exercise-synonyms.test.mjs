import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandSearchTokens } from '../exercise-synonyms.js';

test('expandSearchTokens: единична дума синоним', () => {
  const tokens = expandSearchTokens('клек');
  assert.ok(tokens.includes('клек'));
  assert.ok(tokens.includes('squat'));
});

test('expandSearchTokens: многословен синоним по подниз', () => {
  const tokens = expandSearchTokens('искам клек с гира у дома');
  assert.ok(tokens.includes('goblet'));
  assert.ok(tokens.includes('squat'));
});

test('expandSearchTokens: EN абревиатура', () => {
  const tokens = expandSearchTokens('rdl техника');
  assert.ok(tokens.includes('romanian'));
  assert.ok(tokens.includes('deadlift'));
});

test('expandSearchTokens: без съвпадение връща само базовите токени', () => {
  const tokens = expandSearchTokens('xyz123');
  assert.deepEqual(tokens, ['xyz123']);
});

test('expandSearchTokens: празна заявка', () => {
  assert.deepEqual(expandSearchTokens(''), []);
});
