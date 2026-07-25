import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchApparatus,
  exerciseMatchesApparatus,
  expandApparatusIds,
  apparatusLabel,
  groupApparatusByMuscle,
} from '../equipment-apparatus.js';

test('searchApparatus: намира лег преса по BG', () => {
  const hits = searchApparatus({ query: 'лег преса' });
  assert.ok(hits.some((h) => h.id === 'leg_press'));
});

test('searchApparatus: филтър по категория', () => {
  const hits = searchApparatus({ category: 'bench' });
  assert.ok(hits.every((h) => h.category === 'bench'));
  assert.ok(hits.some((h) => h.id === 'bench_flat'));
});

test('searchApparatus: филтър по мускулна група', () => {
  const hits = searchApparatus({ muscle: 'chest' });
  assert.ok(hits.length >= 3);
  assert.ok(hits.every((h) => h.muscle === 'chest'));
});

test('groupApparatusByMuscle: групира видимите', () => {
  const all = searchApparatus({});
  const groups = groupApparatusByMuscle(all);
  assert.ok(groups.length >= 5);
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), all.length);
});

test('exerciseMatchesApparatus: leg press упражнение', () => {
  assert.ok(exerciseMatchesApparatus(
    { name: 'Sled 45 Leg Press', equipNorm: 'sled machine' },
    'leg_press',
  ));
});

test('expandApparatusIds: разширява equip hints', () => {
  const { equipHints, labels } = expandApparatusIds(['leg_press', 'bench_flat']);
  assert.ok(equipHints.has('sled machine'));
  assert.ok(labels.includes('Лег преса'));
  assert.equal(apparatusLabel('bench_flat'), 'Лежанка хоризонтална');
});
