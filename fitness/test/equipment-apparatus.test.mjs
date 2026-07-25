import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchApparatus,
  exerciseMatchesApparatus,
  expandApparatusIds,
  apparatusLabel,
  groupApparatusByMuscle,
  GYM_APPARATUS,
} from '../equipment-apparatus.js';

test('GYM_APPARATUS: генериран от базата (стотици уреда)', () => {
  assert.ok(GYM_APPARATUS.length >= 300, `очаквани ≥300 уреда, има ${GYM_APPARATUS.length}`);
});

test('searchApparatus: намира лег преса по BG', () => {
  const hits = searchApparatus({ query: 'лег преса' });
  assert.ok(hits.length >= 1);
  assert.ok(hits.some((h) => h.id === '0739' || /преса.*крака/i.test(h.label)));
});

test('searchApparatus: филтър по категория кабел', () => {
  const hits = searchApparatus({ category: 'cable' });
  assert.ok(hits.length >= 100);
  assert.ok(hits.every((h) => h.category === 'cable'));
});

test('searchApparatus: филтър по мускулна група', () => {
  const hits = searchApparatus({ muscle: 'chest' });
  assert.ok(hits.length >= 10);
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
    { name: 'Sled 45 Leg Press', equipNorm: 'sled machine', tokens: ['sled', '45', 'leg', 'press'] },
    '0739',
  ));
});

test('expandApparatusIds: разширява equip hints', () => {
  const { equipHints, labels } = expandApparatusIds(['0739', '2287']);
  assert.ok(equipHints.has('sled machine'));
  assert.ok(equipHints.has('leverage machine'));
  assert.ok(labels.length === 2);
  assert.ok(apparatusLabel('0739').length > 2);
});
