import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adjustRpeBySteps,
  effortLabelFromRpe,
  rpeInfoForValue,
  applyIntensity,
} from '../intensity.js';

test('rpeInfoForValue: точно обяснение за единична стойност', () => {
  const info = rpeInfoForValue('8');
  assert.ok(info.text.includes('Можеш още около 2 повторения'));
  assert.ok(info.text.includes('Трудно'));
});

test('rpeInfoForValue: диапазон показва и двете нива', () => {
  const info = rpeInfoForValue('7-8');
  assert.ok(info.text.includes('RPE 7'));
  assert.ok(info.text.includes('RPE 8'));
  assert.ok(info.text.includes('3 повторения'));
  assert.ok(info.text.includes('2 повторения'));
});

test('effortLabelFromRpe: съответства на скалата', () => {
  assert.equal(effortLabelFromRpe('5'), 'Загрявка');
  assert.equal(effortLabelFromRpe('7'), 'Умерено трудно');
  assert.equal(effortLabelFromRpe('7-8'), 'Трудно');
});

test('adjustRpeBySteps: мести диапазон с 1 стъпка', () => {
  assert.equal(adjustRpeBySteps('7-8', -1), '6–7');
  assert.equal(adjustRpeBySteps('7-8', 1), '8–9');
  assert.equal(adjustRpeBySteps('10', 1), '10');
});

test('applyIntensity: Лесно намалява RPE при силов ден', () => {
  const out = applyIntensity(
    { sets: 4, reps: '8', restSeconds: 90, rpe: '8' },
    -1,
    { type: 'strength' },
  );
  assert.equal(out.rpe, '7');
  assert.equal(out.sets, 4);
  assert.equal(out.restSeconds, 90);
  assert.ok(out.intensityNote.includes('Лесно'));
});

test('applyIntensity: Трудно при сила качва RPE и серии, не пипа почивка', () => {
  const out = applyIntensity(
    { sets: 4, reps: '8', restSeconds: 120, rpe: '7' },
    1,
    { type: 'strength' },
  );
  assert.equal(out.rpe, '8');
  assert.equal(out.sets, 5);
  assert.equal(out.restSeconds, 120);
  assert.ok(out.intensityNote.includes('не я съкращавай'));
});

test('applyIntensity: Трудно при кардио съкращава почивка, не пипа RPE', () => {
  const out = applyIntensity(
    { sets: 3, reps: '5 мин', restSeconds: 60, rpe: '7' },
    1,
    { type: 'cardio' },
  );
  assert.equal(out.rpe, '7');
  assert.equal(out.restSeconds, 45);
});

test('applyIntensity: Трудно при HIIT качва RPE, не съкращава почивка', () => {
  const out = applyIntensity(
    { sets: 6, reps: '30 сек', restSeconds: 45, rpe: '8' },
    1,
    { type: 'hiit' },
  );
  assert.equal(out.rpe, '9');
  assert.equal(out.restSeconds, 45);
  assert.ok(out.intensityNote.includes('интервал'));
});
