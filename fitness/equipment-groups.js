/**
 * Групиране на оборудване за админ филтри, въпросник и BG етикети.
 * kettlebell = пудовка; dumbbell = дъмбели/гирички; smith/sled/lever = машини; EZ/trap/olympic = щанга.
 */
import { normalizeText } from './normalize.js';

/** @typedef {{ id: string, label: string, norms: string[] }} EquipmentGroup */

/** @type {EquipmentGroup[]} */
export const EQUIPMENT_GROUPS = [
  { id: 'body_weight', label: 'Собствено тегло', norms: ['body weight', 'assisted'] },
  { id: 'dumbbell', label: 'Дъмбели', norms: ['dumbbell'] },
  { id: 'barbell', label: 'Щанга и лостове', norms: ['barbell', 'ez barbell', 'olympic barbell', 'trap bar'] },
  { id: 'kettlebell', label: 'Пудовка', norms: ['kettlebell'] },
  { id: 'cable', label: 'Кабел / скрипец', norms: ['cable'] },
  { id: 'band', label: 'Ластици', norms: ['band', 'resistance band'] },
  {
    id: 'machine',
    label: 'Машини',
    norms: [
      'leverage machine', 'smith machine', 'sled machine', 'hammer',
      'elliptical machine', 'skierg machine', 'stationary bike', 'stepmill machine',
      'upper body ergometer',
    ],
  },
  { id: 'balls', label: 'Топки', norms: ['stability ball', 'medicine ball', 'bosu ball'] },
  { id: 'weight_plate', label: 'Тежест (Диск)', norms: ['weighted'] },
  { id: 'accessory', label: 'Аксесоари', norms: ['rope', 'roller', 'wheel roller', 'tire'] },
];

const NORM_TO_GROUP = new Map();
for (const group of EQUIPMENT_GROUPS) {
  for (const norm of group.norms) NORM_TO_GROUP.set(norm, group);
}

/** BG етикет за отделен equipNorm (badge, meta). */
export const EQUIP_NORM_LABELS = {
  'body weight': 'собствено тегло',
  assisted: 'с асистенция',
  dumbbell: 'дъмбели',
  barbell: 'щанга',
  'ez barbell': 'щанга (EZ)',
  'olympic barbell': 'щанга',
  'trap bar': 'щанга',
  kettlebell: 'пудовка',
  cable: 'кабел',
  band: 'ластик',
  'resistance band': 'ластик',
  'leverage machine': 'машина',
  'smith machine': 'машина',
  'sled machine': 'машина',
  hammer: 'машина',
  'elliptical machine': 'машина',
  'skierg machine': 'машина',
  'stationary bike': 'машина',
  'stepmill machine': 'машина',
  'upper body ergometer': 'машина',
  'stability ball': 'фитбол',
  'medicine ball': 'медицинска топка',
  'bosu ball': 'BOSU',
  weighted: 'тежест (диск)',
  rope: 'въже',
  roller: 'ролер',
  'wheel roller': 'ролер',
  tire: 'гума',
};

const machineGroup = EQUIPMENT_GROUPS.find((g) => g.id === 'machine');
const cableGroup = EQUIPMENT_GROUPS.find((g) => g.id === 'cable');

/** BG въпросник → EN equipNorm (null = без филтър). */
export const QUESTIONNAIRE_EQUIPMENT_MAP = {
  'пълно оборудване на зала': null,
  'собствено тегло': ['body weight'],
  'дъмбели': ['dumbbell'],
  'дъмбели / гирички': ['dumbbell'],
  'щанга и дискове': ['barbell', 'ez barbell', 'olympic barbell', 'trap bar'],
  'кабели / скрипец': [...(cableGroup?.norms || ['cable'])],
  'машини': [...(machineGroup?.norms || [])],
  'пудовка': ['kettlebell'],
  'гира': ['kettlebell'],
  'ластици': ['band', 'resistance band'],
  'стабилизираща топка': ['stability ball', 'medicine ball', 'bosu ball'],
  'trx / окачени ремъци': ['body weight'],
};

/** @param {string} equipNorm */
export function equipmentGroupForNorm(equipNorm) {
  return NORM_TO_GROUP.get(normalizeText(equipNorm)) || null;
}

/** @param {string} equipNorm */
export function equipmentGroupLabelForNorm(equipNorm) {
  const group = equipmentGroupForNorm(equipNorm);
  if (group) return group.label;
  const key = normalizeText(equipNorm);
  return EQUIP_NORM_LABELS[key] || equipNorm || '';
}

/** @param {Iterable<string>} groupIdsOrNorms */
export function expandEquipmentGroupIds(groupIdsOrNorms) {
  const out = new Set();
  for (const raw of groupIdsOrNorms || []) {
    const id = String(raw || '').trim();
    const group = EQUIPMENT_GROUPS.find((g) => g.id === id);
    if (group) {
      for (const norm of group.norms) out.add(norm);
      continue;
    }
    const norm = normalizeText(id);
    if (norm) out.add(norm);
  }
  return out;
}
