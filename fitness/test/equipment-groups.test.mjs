import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandEquipmentGroupIds,
  equipmentGroupIdForEntry,
  QUESTIONNAIRE_EQUIPMENT_MAP,
  buildVirtualEquipmentFacets,
} from '../equipment-groups.js';

test('equipmentGroupIdForEntry: smith и sled са силови машини', () => {
  assert.equal(equipmentGroupIdForEntry({ equipNorm: 'smith machine' }), 'machine');
  assert.equal(equipmentGroupIdForEntry({ equipNorm: 'sled machine', name: 'Sled 45 Leg Press' }), 'machine');
});

test('equipmentGroupIdForEntry: кардио тренажори са отделно', () => {
  assert.equal(equipmentGroupIdForEntry({ equipNorm: 'elliptical machine' }), 'cardio_trainer');
  assert.equal(equipmentGroupIdForEntry({ equipNorm: 'stepmill machine' }), 'cardio_trainer');
  assert.equal(equipmentGroupIdForEntry({ equipNorm: 'stationary bike' }), 'cardio_trainer');
});

test('equipmentGroupIdForEntry: пътека под leverage machine → кардио', () => {
  assert.equal(
    equipmentGroupIdForEntry({ equipNorm: 'leverage machine', name: 'walking on incline treadmill' }),
    'cardio_trainer',
  );
  assert.equal(
    equipmentGroupIdForEntry({ equipNorm: 'leverage machine', name: 'Sled 45 Leg Press' }),
    'machine',
  );
});

test('expandEquipmentGroupIds: виртуална група уреди = машини + кабел', () => {
  const norms = expandEquipmentGroupIds(['equipment_rig']);
  assert.ok(norms.has('cable'));
  assert.ok(norms.has('leverage machine'));
  assert.ok(norms.has('smith machine'));
  assert.ok(!norms.has('elliptical machine'));
});

test('buildVirtualEquipmentFacets: сумира machine + cable', () => {
  const facets = buildVirtualEquipmentFacets({ machine: 120, cable: 157 });
  assert.equal(facets.length, 1);
  assert.equal(facets[0].value, 'equipment_rig');
  assert.equal(facets[0].count, 277);
});

test('QUESTIONNAIRE_EQUIPMENT_MAP: уреди, силови и кардио', () => {
  assert.ok(QUESTIONNAIRE_EQUIPMENT_MAP['уреди (машини + кабел)'].includes('cable'));
  assert.ok(QUESTIONNAIRE_EQUIPMENT_MAP['уреди (машини + кабел)'].includes('smith machine'));
  assert.ok(QUESTIONNAIRE_EQUIPMENT_MAP['силови машини'].includes('leverage machine'));
  assert.ok(!QUESTIONNAIRE_EQUIPMENT_MAP['силови машини'].includes('elliptical machine'));
  assert.ok(QUESTIONNAIRE_EQUIPMENT_MAP['кардио тренажори'].includes('elliptical machine'));
  assert.ok(QUESTIONNAIRE_EQUIPMENT_MAP['машини'].includes('smith machine'));
});
