import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyExercise, findFlagContradictions } from '../exercise-classifier.js';
import { metadataForExercise, mergeMetadataStores, kvMetadataWins } from '../exercise-metadata.js';

const c = (name, equipment = 'body weight', target = '', body_part = '') => classifyExercise({ name, equipment, target, body_part });

test('classifier: pattern по модел, не по уред', () => {
  assert.equal(c('barbell romanian deadlift', 'barbell', 'glutes').pattern, 'hinge');
  assert.equal(c('dumbbell prone incline curl', 'dumbbell', 'biceps').pattern, 'biceps');
  assert.equal(c('jump squat', 'body weight', 'glutes').pattern, 'plyo');
  assert.equal(c('split squats', 'body weight', 'quads').pattern, 'lunge');
  assert.equal(c('cable cross-over lateral pulldown', 'cable', 'lats').pattern, 'pull_v');
  assert.equal(c('lever leg extension', 'leverage machine', 'quads').pattern, 'knee_ext');
  assert.equal(c('hamstring stretch', 'body weight', 'hamstrings').category, 'mobility');
  assert.equal(c('wheel rollerout', 'wheel roller', 'abs').pattern, 'core_static');
});

test('classifier: трудност — референтни упражнения', () => {
  assert.equal(c('lever chest press', 'leverage machine', 'pectorals').diff, 1);
  assert.equal(c('push-up (wall)', 'body weight', 'pectorals').diff, 1);
  assert.equal(c('barbell bench press', 'barbell', 'pectorals').diff, 2);
  assert.equal(c('barbell deadlift', 'barbell', 'glutes').diff, 2);
  assert.equal(c('pull-up', 'body weight', 'lats').diff, 2);
  assert.equal(c('chin-ups (narrow parallel grip)', 'body weight', 'upper back').diff, 2);
  assert.equal(c('muscle up', 'body weight', 'lats').diff, 3);
  assert.equal(c('power clean', 'barbell', 'hamstrings').diff, 3);
  assert.equal(c('clap push up', 'body weight', 'pectorals').diff, 3);
  assert.equal(c('sissy squat', 'body weight', 'quads').diff, 3);
  assert.equal(c('ez barbell spider curl', 'ez barbell', 'biceps').diff, 1, 'barbell curl не е d3');
  assert.equal(c('sled 45в° leg press', 'sled machine', 'glutes').diff, 1, 'leg press не е d3');
  assert.equal(c('iron cross stretch', 'body weight', 'glutes').diff, 1, 'стречинг е d1');
});

test('classifier: флагове без противоречия', () => {
  const chin = c('gironda sternum chin', 'body weight', 'lats');
  assert.ok(chin.flags.includes('pull_bar'));
  assert.ok(!chin.flags.includes('true_bodyweight'));
  assert.ok(!chin.flags.includes('home_friendly'));

  const band = c('band squat', 'band', 'glutes');
  assert.ok(!band.flags.includes('home_friendly'), 'home_friendly само за истинско СТ');

  const jump = c('jump squat', 'body weight', 'glutes');
  assert.ok(jump.flags.includes('plyometric'));
  assert.ok(!jump.flags.includes('beginner_safe'));

  const bench = c('bench dip (knees bent)', 'body weight', 'triceps');
  assert.ok(bench.gear.includes('bench'));
  assert.ok(!bench.gear.includes('pull_bar'));

  const male = c('kneeling push-up (male)', 'body weight', 'pectorals');
  assert.equal(male.excluded, false, 'уникално упражнение');
  assert.ok(male.flags.includes('gender_variant'));
  const dup = c('twisted leg raise (female)', 'body weight', 'abs');
  assert.equal(dup.excluded, true);
  assert.equal(c('quads', 'body weight', 'quads').pattern, 'squat');
});

test('classifier: gf/gm от модела', () => {
  const bridge = c('low glute bridge on floor', 'body weight', 'glutes');
  const bench = c('barbell bench press', 'barbell', 'pectorals');
  assert.ok(bridge.gf > bridge.gm);
  assert.ok(bench.gm > bench.gf);
});

test('bundled EFP v3: пълно покритие и 0 противоречия', () => {
  const meta = JSON.parse(readFileSync(new URL('../data/exercise-metadata.json', import.meta.url), 'utf8'));
  const rows = Object.values(meta);
  assert.equal(rows.length, 1324);
  for (const [id, row] of Object.entries(meta)) {
    assert.deepEqual(findFlagContradictions(row), [], `${id}`);
    if (!row.manual && !row.manualEdit) {
      assert.equal(row.ruleClassified, true, id);
      assert.ok(row.pattern && row.category && row.reasons?.length, id);
    }
  }
});

test('metadata merge: стар AI v2 в KV не скрива v3; ръчна корекция печели', () => {
  const bundled = { 1: { diff: 1, efpVersion: 3, ruleClassified: true } };
  assert.equal(kvMetadataWins({ diff: 3, efpVersion: 2, aiClassified: true }, bundled[1]), false);
  assert.equal(kvMetadataWins({ diff: 3, efpVersion: 2, manual: true }, bundled[1]), true);
  const merged = mergeMetadataStores(bundled, { 1: { diff: 3, efpVersion: 2, aiClassified: true }, 2: { diff: 2, efpVersion: 2, aiClassified: true } });
  assert.equal(merged[1].diff, 1);
  assert.equal(merged[2].diff, 2);
});

test('metadataForExercise: v3 запис се ползва без евристични корекции', () => {
  const raw = { id: '9', name: 'jump squat', equipment: 'body weight', target: 'glutes' };
  const cls = classifyExercise(raw);
  const meta = metadataForExercise(raw, { 9: { ...cls } });
  assert.equal(meta.diff, cls.diff);
  assert.deepEqual([...meta.flags].sort(), [...cls.flags].sort());
  assert.equal(meta.pattern, 'plyo');
});
