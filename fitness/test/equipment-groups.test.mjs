import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandEquipmentGroupIds,
  equipmentGroupForNorm,
  QUESTIONNAIRE_EQUIPMENT_MAP,
} from '../equipment-groups.js';

test('equipmentGroupForNorm: smith и sled са машини', () => {
  assert.equal(equipmentGroupForNorm('smith machine')?.id, 'machine');
  assert.equal(equipmentGroupForNorm('sled machine')?.id, 'machine');
  assert.equal(equipmentGroupForNorm('leverage machine')?.id, 'machine');
});

test('equipmentGroupForNorm: EZ лост е щанга', () => {
  assert.equal(equipmentGroupForNorm('ez barbell')?.id, 'barbell');
});

test('expandEquipmentGroupIds: машини включват smith/sled/lever', () => {
  const norms = expandEquipmentGroupIds(['machine']);
  assert.ok(norms.has('smith machine'));
  assert.ok(norms.has('sled machine'));
  assert.ok(norms.has('leverage machine'));
});

test('QUESTIONNAIRE_EQUIPMENT_MAP: пудовка и legacy гира', () => {
  assert.deepEqual(QUESTIONNAIRE_EQUIPMENT_MAP['пудовка'], ['kettlebell']);
  assert.deepEqual(QUESTIONNAIRE_EQUIPMENT_MAP['гира'], ['kettlebell']);
});
