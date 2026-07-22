import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  heuristicClassification,
  exerciseProfileFromAnswers,
  exerciseProfileFromContext,
  resolveMaxDiff,
  fitsExerciseProfile,
  filterExercises,
  buildExerciseCatalogSnippet,
  mergeExerciseMetadata,
  inferExerciseModality,
  modalityMatchesDay,
  searchExerciseIndex,
  computeExerciseFacets,
} from '../exercise-metadata.js';

test('heuristicClassification: hip thrust → висок gf', () => {
  const h = heuristicClassification({ name: 'barbell hip thrust', equipment: 'barbell' });
  assert.ok(h.gf >= 85);
  assert.ok(h.diff >= 1 && h.diff <= 3);
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

test('buildExerciseCatalogSnippet: сортира по diff и показва maxDiff', () => {
  const index = [
    { name: 'Hard Move', diff: 3, gf: 70, gm: 70, equipNorm: 'barbell', targetNorm: 'chest' },
    { name: 'Easy Move', diff: 1, gf: 80, gm: 70, equipNorm: 'cable', targetNorm: 'chest' },
  ];
  const profile = exerciseProfileFromAnswers({ gender: 'Мъж', experience: 'Напреднал' });
  const catalog = buildExerciseCatalogSnippet(index, profile);
  assert.ok(catalog.includes('d≤3'));
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
  assert.ok(catalog.includes('kickback'));
  assert.ok(!catalog.includes('bench press'));
});

test('inferExerciseModality + filter по mobility', () => {
  assert.equal(inferExerciseModality('Standing Hamstring Stretch'), 'mobility');
  assert.equal(inferExerciseModality('Barbell Bench Press'), 'strength');
  assert.equal(modalityMatchesDay('mobility', 'mobility'), true);
  assert.equal(modalityMatchesDay('mobility', 'strength'), false);
  const index = [
    { name: 'Hamstring Stretch', diff: 1, gf: 80, gm: 70, equipNorm: 'body weight' },
    { name: 'Barbell Squat', diff: 3, gf: 70, gm: 85, equipNorm: 'barbell' },
  ];
  const filtered = filterExercises(index, null, null, ['mobility']);
  assert.equal(filtered.length, 1);
  assert.ok(filtered[0].name.includes('Stretch'));
});

test('mergeExerciseMetadata: heuristic без KV', () => {
  const entry = mergeExerciseMetadata({ id: '1', name: 'hip thrust' }, { id: '1', name: 'hip thrust' }, {});
  assert.ok(entry.diff >= 1);
  assert.ok(entry.gf >= 80);
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

test('computeExerciseFacets: брой + BG етикет по оборудване/target', () => {
  const facets = computeExerciseFacets(SEARCH_INDEX);
  const barbell = facets.equipment.find((e) => e.value === 'barbell');
  assert.equal(barbell.count, 2);
  assert.equal(barbell.label, 'щанга');
  const glutes = facets.target.find((t) => t.value === 'glutes');
  assert.equal(glutes.count, 1);
});
