import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFP_VERSION } from '../exercise-efp-rubric.js';
import {
  metadataForExercise,
  isMetadataOverride,
  exerciseProfileFromAnswers,
  exerciseProfileFromContext,
  resolveMaxDiff,
  fitsExerciseProfile,
  filterExercises,
  buildExerciseCatalogSnippet,
  mergeExerciseMetadata,
  inferExerciseModality,
  modalityMatchesDay,
  compareAlternativeCloseness,
  alternativeClosenessScore,
  isMachineEquipment,
  alternativeSlotKey,
  isSameAlternativeFamily,
  searchExerciseIndex,
  computeExerciseFacets,
} from '../exercise-metadata.js';

function curated(overrides = {}) {
  return {
    diff: 2,
    gf: 70,
    gm: 70,
    flags: [],
    aiClassified: true,
    efpVersion: EFP_VERSION,
    ...overrides,
  };
}

test('isMetadataOverride: само curated v2 или manual', () => {
  assert.equal(isMetadataOverride({ diff: 1, heuristicOnly: true }), false);
  assert.equal(isMetadataOverride(curated()), true);
  assert.equal(isMetadataOverride({ diff: 2, manual: true }), true);
});

test('metadataForExercise: без curated → unclassified/excluded', () => {
  const m = metadataForExercise({ id: '1', name: 'barbell bench press', equipment: 'barbell', target: 'pectorals' }, {});
  assert.ok(m.flags.includes('unclassified'));
  assert.equal(m.excluded, true);
});

test('metadataForExercise: curated запис се ползва', () => {
  const store = { '1': curated({ diff: 3, gf: 42, gm: 90, flags: ['press'] }) };
  const m = metadataForExercise({ id: '1', name: 'barbell bench press', equipment: 'barbell', target: 'pectorals' }, store);
  assert.equal(m.diff, 3);
  assert.equal(m.gf, 42);
  assert.ok(!m.excluded);
});

test('exerciseProfileFromAnswers: жена начинаеща → строг филтър', () => {
  const p = exerciseProfileFromAnswers({
    gender: 'Жена',
    experience: 'Никакъв / начинаещ (0–6 месеца системно)',
  });
  assert.equal(p.maxDiff, 1);
  assert.ok(p.minGf >= 65);
});

test('resolveMaxDiff: от experience, тагове и бриф', () => {
  assert.equal(resolveMaxDiff('Никакъв / начинаещ'), 1);
  assert.equal(resolveMaxDiff('', new Set(['level:напреднал'])), 3);
  assert.equal(resolveMaxDiff('', null, 'средно начинаещи упражнения'), 2);
});

test('exerciseProfileFromContext: админ бриф без answers.experience', () => {
  const p = exerciseProfileFromContext({
    answers: { gender: 'Жена' },
    tags: new Set(['gender:жена', 'level:начинаещ']),
    profileText: 'начинаеща',
  });
  assert.equal(p.maxDiff, 1);
  assert.ok(p.minGf >= 65);
});

test('buildExerciseCatalogSnippet: сортира по diff, без EFP индекси в prompt', () => {
  const index = [
    { name: 'Hard Move', diff: 3, gf: 70, gm: 70, equipNorm: 'barbell', targetNorm: 'chest' },
    { name: 'Easy Move', diff: 1, gf: 80, gm: 70, equipNorm: 'cable', targetNorm: 'chest' },
  ];
  const profile = exerciseProfileFromAnswers({ gender: 'Мъж', experience: 'Напреднал' });
  const catalog = buildExerciseCatalogSnippet(index, profile);
  assert.ok(catalog.includes('филтрирано'));
  assert.ok(catalog.includes('Easy Move'));
  assert.ok(catalog.includes('Hard Move'));
  assert.ok(!catalog.includes('|d'));
  assert.ok(!catalog.includes('gf'));
  assert.ok(catalog.indexOf('Easy Move') < catalog.indexOf('Hard Move'));
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
  assert.ok(catalog.includes('начинаещо ниво'));
  assert.ok(catalog.includes('жена'));
  assert.ok(catalog.includes('kickback'));
  assert.ok(!catalog.includes('bench press'));
  assert.ok(!catalog.includes('|d'));
});

test('inferExerciseModality + filter по mobility', () => {
  assert.equal(inferExerciseModality('Standing Hamstring Stretch'), 'mobility');
  assert.equal(inferExerciseModality('Barbell Bench Press'), 'strength');
  const index = [
    { name: 'Hamstring Stretch', diff: 1, gf: 80, gm: 70, equipNorm: 'body weight' },
    { name: 'Barbell Squat', diff: 3, gf: 70, gm: 85, equipNorm: 'barbell' },
  ];
  const filtered = filterExercises(index, null, null, ['mobility']);
  assert.equal(filtered.length, 1);
  assert.ok(filtered[0].name.includes('Stretch'));
});

test('mergeExerciseMetadata: curated KV', () => {
  const meta = { '1': curated({ diff: 2, gf: 92, gm: 58, flags: ['glute'] }) };
  const entry = mergeExerciseMetadata({ id: '1', name: 'hip thrust' }, { id: '1', name: 'hip thrust', target: 'glutes' }, meta);
  assert.equal(entry.diff, 2);
  assert.ok(entry.gf >= 90);
});

test('alternativeClosenessScore: също оборудване и машини накрая', () => {
  const base = {
    name: 'dumbbell bench press',
    equipNorm: 'dumbbell',
    bodyNorm: 'chest',
    tokens: ['dumbbell', 'bench', 'press'],
  };
  const sameEq = { name: 'dumbbell fly', equipNorm: 'dumbbell', bodyNorm: 'chest', tokens: ['dumbbell', 'fly'] };
  const machine = { name: 'lever chest press', equipNorm: 'leverage machine', bodyNorm: 'chest', tokens: ['lever', 'chest', 'press'] };
  assert.ok(alternativeClosenessScore(sameEq, base) < alternativeClosenessScore(machine, base));
  assert.equal(isMachineEquipment('leverage machine'), true);
  assert.equal(isMachineEquipment('dumbbell'), false);
});

test('compareAlternativeCloseness: предпочита същото оборудване и движение', () => {
  const base = {
    name: 'dumbbell bench press',
    equipNorm: 'dumbbell',
    bodyNorm: 'chest',
    tokens: ['dumbbell', 'bench', 'press'],
    diff: 2,
    targetNorm: 'pectorals',
    flags: ['compound', 'press'],
  };
  const close = { name: 'dumbbell incline bench press', equipNorm: 'dumbbell', bodyNorm: 'chest', tokens: ['dumbbell', 'incline', 'bench', 'press'], diff: 2, targetNorm: 'pectorals', flags: ['compound', 'press'] };
  const machine = { name: 'lever chest press', equipNorm: 'leverage machine', bodyNorm: 'chest', tokens: ['lever', 'chest', 'press'], diff: 2, targetNorm: 'pectorals', flags: ['compound', 'machine', 'press'] };
  assert.ok(compareAlternativeCloseness(close, machine, base) < 0);
});

test('alternativeSlotKey: dataset target + muscle_group разделя клек от RDL', () => {
  const squat = { name: 'barbell full squat', targetNorm: 'glutes', muscleGroupNorm: 'quadriceps', flags: ['compound'] };
  const lunge = { name: 'walking lunge', targetNorm: 'glutes', muscleGroupNorm: 'quadriceps', flags: ['compound'] };
  const deadlift = { name: 'barbell romanian deadlift', targetNorm: 'glutes', muscleGroupNorm: 'hamstrings', flags: ['compound'] };
  const bench = { name: 'barbell bench press', targetNorm: 'pectorals', muscleGroupNorm: 'triceps', flags: ['compound'] };
  const fly = { name: 'dumbbell fly', targetNorm: 'pectorals', flags: ['isolation'] };
  assert.equal(alternativeSlotKey(squat), 'compound:glutes:quadriceps');
  assert.equal(alternativeSlotKey(lunge), alternativeSlotKey(squat));
  assert.notEqual(alternativeSlotKey(deadlift), alternativeSlotKey(squat));
  assert.equal(alternativeSlotKey(bench), 'compound:pectorals:triceps');
  assert.equal(alternativeSlotKey(fly), 'iso:pectorals');
  assert.ok(isSameAlternativeFamily(squat, lunge, 'strength'));
  assert.ok(!isSameAlternativeFamily(squat, deadlift, 'strength'));
  assert.ok(!isSameAlternativeFamily(bench, fly, 'strength'));
});

const SEARCH_INDEX = [
  { name: 'Barbell Squat', nameBg: 'Клек с щанга', diff: 3, gf: 65, gm: 88, equipment: 'barbell', equipNorm: 'barbell', target: 'quads', targetNorm: 'quads', tokens: ['barbell', 'squat'] },
  { name: 'Hip Thrust', nameBg: 'Хип тръст', diff: 2, gf: 92, gm: 70, equipment: 'barbell', equipNorm: 'barbell', target: 'glutes', targetNorm: 'glutes', tokens: ['hip', 'thrust'] },
  { name: 'Standing Hamstring Stretch', nameBg: '', diff: 1, gf: 80, gm: 70, equipment: 'body weight', equipNorm: 'body weight', target: 'hamstrings', targetNorm: 'hamstrings', tokens: ['standing', 'hamstring', 'stretch'] },
];

test('searchExerciseIndex: BG синоним намира EN упражнение', () => {
  const { results, total } = searchExerciseIndex(SEARCH_INDEX, { q: 'клек' });
  assert.equal(total, 1);
  assert.equal(results[0].entry.name, 'Barbell Squat');
});

test('searchExerciseIndex: филтър по target + diff range', () => {
  const byTarget = searchExerciseIndex(SEARCH_INDEX, { target: ['glutes'] });
  assert.equal(byTarget.results.length, 1);
  assert.equal(byTarget.results[0].entry.name, 'Hip Thrust');

  const byDiff = searchExerciseIndex(SEARCH_INDEX, { diffMax: 1 });
  assert.equal(byDiff.results.length, 1);
  assert.equal(byDiff.results[0].entry.name, 'Standing Hamstring Stretch');
});

test('searchExerciseIndex: филтър по модалност (mobility изключва strength)', () => {
  const { results } = searchExerciseIndex(SEARCH_INDEX, { modality: ['mobility'] });
  assert.equal(results.length, 1);
  assert.equal(results[0].entry.name, 'Standing Hamstring Stretch');
});

test('searchExerciseIndex: пагинация (limit/offset)', () => {
  const page1 = searchExerciseIndex(SEARCH_INDEX, { limit: 2, offset: 0 });
  const page2 = searchExerciseIndex(SEARCH_INDEX, { limit: 2, offset: 2 });
  assert.equal(page1.total, 3);
  assert.equal(page1.results.length, 2);
  assert.equal(page2.results.length, 1);
});

test('computeExerciseFacets: групирано оборудване + BG етикет', () => {
  const facets = computeExerciseFacets(SEARCH_INDEX);
  const barbell = facets.equipment.find((e) => e.value === 'barbell');
  assert.equal(barbell.count, 2);
  assert.equal(barbell.label, 'Щанга и лостове');
  const glutes = facets.target.find((t) => t.value === 'glutes');
  assert.equal(glutes.count, 1);
});
