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
  assert.ok(hits.some((h) => h.id === '0739' || /преса/i.test(h.label)));
});

test('searchApparatus: филтър по конкретен тип уред', () => {
  const hits = searchApparatus({ equip: 'sled machine' });
  assert.ok(hits.length >= 10);
  assert.ok(hits.every((h) => h.equipNorm === 'sled machine'));
});

test('catalog entries: имат subtitle за разграничаване', () => {
  const withSub = GYM_APPARATUS.filter((a) => a.subtitle);
  assert.ok(withSub.length >= 200);
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

test('searchApparatus: филтър по категория лежанки', () => {
  const hits = searchApparatus({ category: 'bench' });
  assert.ok(hits.length >= 5);
  assert.ok(hits.every((h) => h.category === 'bench'));
  assert.ok(hits.some((h) => h.id === 'station_bench_flat'));
});

test('searchApparatus: филтър по категория стойки', () => {
  const hits = searchApparatus({ category: 'rack' });
  assert.ok(hits.length >= 3);
  assert.ok(hits.every((h) => h.category === 'rack'));
});

test('exerciseMatchesApparatus: хоризонтална лежанка + bench press', () => {
  assert.ok(exerciseMatchesApparatus(
    { name: 'Barbell Bench Press', equipNorm: 'barbell' },
    'station_bench_flat',
  ));
});

test('exerciseMatchesApparatus: squat rack + barbell squat', () => {
  assert.ok(exerciseMatchesApparatus(
    { name: 'barbell back squat', equipNorm: 'barbell' },
    'station_rack_squat',
  ));
});

test('expandApparatusIds: станция разширява barbell hints', () => {
  const { equipHints } = expandApparatusIds(['station_bench_flat']);
  assert.ok(equipHints.has('barbell'));
  assert.ok(equipHints.has('dumbbell'));
});

import { apparatusThumbUrl } from '../equipment-media.js';

test('apparatusThumbUrl: миниатюра от каталога', () => {
  const item = GYM_APPARATUS.find((a) => a.image);
  assert.ok(item);
  const url = apparatusThumbUrl(item);
  assert.match(url, /^https:\/\//);
  assert.match(url, /images\//);
});

test('catalog: машини и станции имат image поле', () => {
  const withImage = GYM_APPARATUS.filter((a) => a.image);
  assert.ok(withImage.length >= 300);
  const stations = GYM_APPARATUS.filter((a) => a.station);
  assert.ok(stations.every((s) => s.image));
});

test('expandApparatusIds: машини разширяват equip hints', () => {
  const { equipHints } = expandApparatusIds(['0739', '2287']);
  assert.ok(equipHints.has('sled machine'));
  assert.ok(equipHints.has('leverage machine'));
  assert.ok(apparatusLabel('0739').length > 2);
});
