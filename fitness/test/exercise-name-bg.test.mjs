import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isGenderSpecificExerciseName,
  neutralExerciseName,
  exerciseNameLookupKey,
} from '../exercise-name-bg.js';
import { localizeExerciseDisplayName } from '../exercise-labels-bg.js';
import { buildCompactIndex } from '../worker.js';
import { filterExercises, exerciseProfileFromAnswers } from '../exercise-metadata.js';
import { allowedEquipmentSet } from '../worker.js';
import { resolveAllowedGear } from '../exercise-tags.js';

test('isGenderSpecificExerciseName: (male) и (female)', () => {
  assert.equal(isGenderSpecificExerciseName('kneeling push-up (male)'), true);
  assert.equal(isGenderSpecificExerciseName('barbell sitted alternate leg raise (female)'), true);
  assert.equal(isGenderSpecificExerciseName('push-up'), false);
  assert.equal(isGenderSpecificExerciseName('hamstring stretch'), false);
});

test('neutralExerciseName: маха половия маркер', () => {
  assert.equal(neutralExerciseName('kneeling push-up (male)'), 'kneeling push-up');
  assert.equal(exerciseNameLookupKey('chest tap push-up (male)'), 'chest tap push up');
});

test('localizeExerciseDisplayName: полови варианти → неутрален BG превод', () => {
  assert.equal(localizeExerciseDisplayName('kneeling push-up (male)'), 'Лицева опора на колене');
  assert.equal(localizeExerciseDisplayName('forward lunge (male)'), 'Напад напред');
  assert.equal(localizeExerciseDisplayName('hamstring stretch'), 'Разтягане на задно бедро');
  assert.equal(localizeExerciseDisplayName('glute bridge march'), 'Мостик за седалищни с марш');
  assert.equal(localizeExerciseDisplayName('push-up (wall)'), 'Лицева опора на стена');
  assert.equal(localizeExerciseDisplayName('incline push-up'), 'Наклонена лицева опора');
  assert.ok(!/male|push-up/i.test(localizeExerciseDisplayName('chest tap push-up (male)')));
});

test('filterExercises: без (male)/(female) в каталога', async () => {
  const raw = await (await fetch('https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/data/exercises.json')).json();
  const meta = (await import('../data/exercise-metadata.json', { with: { type: 'json' } })).default;
  const index = buildCompactIndex(raw, {}, meta);
  const profile = exerciseProfileFromAnswers({ gender: 'Жена', experience: 'Начинаещ' });
  const gear = resolveAllowedGear(['Собствено тегло']);
  const filtered = filterExercises(index, profile, allowedEquipmentSet(['Собствено тегло']), null, null, gear);
  const gender = filtered.filter((e) => isGenderSpecificExerciseName(e.name));
  assert.equal(gender.length, 0);
});
