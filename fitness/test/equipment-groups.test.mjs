import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandEquipmentGroupIds,
  equipmentGroupIdForEntry,
  QUESTIONNAIRE_EQUIPMENT_MAP,
  buildVirtualEquipmentFacets,
  buildQuestionnaireEquipmentOptions,
  questionnaireEquipmentGroups,
  QUESTIONNAIRE_EXCLUDED_GROUP_IDS,
  QUESTIONNAIRE_EQUIPMENT_SECTIONS,
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

test('QUESTIONNAIRE_EQUIPMENT_MAP: legacy опции', () => {
  assert.ok(QUESTIONNAIRE_EQUIPMENT_MAP['дъмбели гири'].includes('dumbbell'));
  assert.ok(QUESTIONNAIRE_EQUIPMENT_MAP['дъмбели'].includes('dumbbell'));
  assert.equal(QUESTIONNAIRE_EQUIPMENT_MAP['пълно оборудване на зала'], null);
  assert.ok(QUESTIONNAIRE_EQUIPMENT_MAP['ластици'].includes('band'));
  assert.ok(QUESTIONNAIRE_EQUIPMENT_MAP['степ платформа блок'].includes('body weight'));
  assert.ok(QUESTIONNAIRE_EQUIPMENT_MAP['топки фитбол'].includes('stability ball'));
});

test('questionnaireEquipmentGroups: без машини, кабел и кардио', () => {
  const ids = questionnaireEquipmentGroups().map((g) => g.id);
  for (const ex of QUESTIONNAIRE_EXCLUDED_GROUP_IDS) {
    assert.ok(!ids.includes(ex), `не трябва ${ex}`);
  }
  assert.ok(ids.includes('dumbbell'));
  assert.ok(ids.includes('step_platform'));
  assert.ok(ids.includes('balls'));
});

test('buildQuestionnaireEquipmentOptions: секции покриват всички групи', () => {
  const opts = buildQuestionnaireEquipmentOptions();
  const sectionIds = QUESTIONNAIRE_EQUIPMENT_SECTIONS.flatMap((s) => s.groupIds);
  const optIds = opts.map((o) => o.groupId);
  for (const id of optIds) {
    assert.ok(sectionIds.includes(id), `липсва секция за ${id}`);
  }
});
