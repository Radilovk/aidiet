import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCatalogRecord,
  filterCatalogRecords,
  normalizeCatalogPatch,
  paginateCatalogRecords,
  importCatalogPayload,
} from '../exercise-catalog.js';

const sampleEntry = {
  id: '0042',
  name: 'forward lunge',
  equipment: 'body weight',
  equipNorm: 'body weight',
  target: 'glutes',
  targetNorm: 'glutes',
  diff: 1,
  gf: 85,
  gm: 70,
  flags: ['bodyweight', 'compound'],
  gear: ['floor'],
  effectiveEquipNorm: 'body weight',
};

test('normalizeCatalogPatch: напад + excluded', () => {
  const patch = normalizeCatalogPatch({
    nameBg: 'Напад напред',
    diff: 1,
    gf: 90,
    gm: 65,
    flags: 'bodyweight, compound',
    gear: 'floor',
    excluded: true,
  }, { id: '1', name: 'forward lunge', equipment: 'body weight' });
  assert.equal(patch.metadata.diff, 1);
  assert.equal(patch.translation.nameBg, 'Напад напред');
  assert.ok(patch.metadata.flags.includes('excluded'));
});

test('buildCatalogRecord: displayName от nameBg', () => {
  const row = buildCatalogRecord(sampleEntry, null, {}, {}, {}, { '0042': { nameBg: 'Напад напред' } });
  assert.equal(row.displayName, 'Напад напред');
  assert.equal(row.overridden.translation, true);
});

test('filterCatalogRecords: търсене по напад', () => {
  const rows = [
    buildCatalogRecord(sampleEntry),
    buildCatalogRecord({ ...sampleEntry, id: '99', name: 'barbell squat' }),
  ];
  const filtered = filterCatalogRecords(rows, { q: 'lunge' });
  assert.equal(filtered.length, 1);
});

test('paginateCatalogRecords', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: String(i) }));
  const page = paginateCatalogRecords(rows, 2, 50);
  assert.equal(page.items.length, 50);
  assert.equal(page.page, 2);
  assert.equal(page.total, 120);
});

test('importCatalogPayload: обновява stores', () => {
  const payload = {
    exercises: [{
      id: '10',
      metadata: { diff: 2, gf: 80, gm: 75, flags: ['compound'], gear: ['floor'], excluded: false },
      translation: { nameBg: 'Напад', instructionsBg: 'Стъпка напред.' },
    }],
  };
  const out = importCatalogPayload(payload, {}, {});
  assert.equal(out.updated, 1);
  assert.equal(out.translations['10'].nameBg, 'Напад');
  assert.equal(out.metadata['10'].diff, 2);
});
