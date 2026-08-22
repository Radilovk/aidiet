import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseEnName,
  canonicalScore,
  buildDuplicateClusters,
  pickCanonicalExercises,
} from '../exercise-canonical.js';

test('baseEnName: маха pov и v.2', () => {
  assert.equal(
    baseEnName('barbell full squat (back pov)'),
    baseEnName('barbell full squat'),
  );
  assert.equal(
    baseEnName('barbell upright row v. 3'),
    baseEnName('barbell upright row'),
  );
});

test('canonicalScore: базов вариант печели', () => {
  const base = { id: '0043', name: 'barbell full squat', displayName: 'Клек с щанга', excluded: false };
  const pov = { id: '1461', name: 'barbell full squat (back pov)', displayName: 'Клек (отзад)', excluded: false };
  assert.ok(canonicalScore(base) > canonicalScore(pov));
});

test('pickCanonicalExercises: един победител на кластер', () => {
  const items = [
    { id: '1', name: 'dumbbell hammer curl', displayName: 'Чук', instructionsEn: 'Stand with dumbbells same text here for test long enough', equipment: 'dumbbell', excluded: false },
    { id: '2', name: 'dumbbell hammer curl v. 2', displayName: 'Чук v2', instructionsEn: 'Stand with dumbbells same text here for test long enough', equipment: 'dumbbell', excluded: false },
    { id: '3', name: 'barbell squat', displayName: 'Клек', instructionsEn: 'Totally different movement description for squat pattern', equipment: 'barbell', excluded: false },
  ];
  const { clusters, canonical, toExclude } = pickCanonicalExercises(items);
  assert.ok(clusters.size >= 1);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].id, '1');
  assert.deepEqual(toExclude.map((x) => x.id), ['2']);
});
