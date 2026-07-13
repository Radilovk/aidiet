import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pickInstructionsEn,
  pickInstructionsBg,
  mergeExerciseTranslation,
  translationForExercise,
} from '../exercise-translations.js';
import { buildCompactIndex } from '../worker.js';

const RAW = {
  id: '0042',
  name: 'Barbell Bench Press',
  equipment: 'barbell',
  target: 'pectorals',
  instructions: { en: 'Lie flat on bench and press.', bg: '' },
};

test('pickInstructionsEn: string, array и object', () => {
  assert.equal(pickInstructionsEn(' Step one. '), 'Step one.');
  assert.equal(pickInstructionsEn(['A', 'B']), 'A B');
  assert.equal(pickInstructionsEn({ en: 'Press up' }), 'Press up');
});

test('pickInstructionsBg: връща bg само ако има', () => {
  assert.equal(pickInstructionsBg({ en: 'x', bg: 'Легни' }), 'Легни');
  assert.equal(pickInstructionsBg({ en: 'x' }), '');
});

test('mergeExerciseTranslation: build-time превод над EN fallback', () => {
  const base = { id: '0042', name: 'Barbell Bench Press', equipment: 'barbell' };
  const tr = {
    '0042': {
      nameBg: 'Избутване с щанга от лежанка',
      instructionsBg: 'Легни на лежанката и избутвай.',
    },
  };
  const merged = mergeExerciseTranslation(base, RAW, tr, 200);
  assert.equal(merged.nameBg, 'Избутване с щанга от лежанка');
  assert.equal(merged.instructions, 'Легни на лежанката и избутвай.');
  assert.equal(merged.instructionsLang, 'bg');
});

test('buildCompactIndex: прилага преводи по id', () => {
  const list = [RAW];
  const index = buildCompactIndex(list, {
    '0042': { nameBg: 'Избутване с щанга', instructionsBg: 'BG текст.' },
  });
  assert.equal(index[0].nameBg, 'Избутване с щанга');
  assert.equal(index[0].instructionsLang, 'bg');
  assert.equal(translationForExercise(RAW, { '0042': { nameBg: 'x' } }).nameBg, 'x');
});
