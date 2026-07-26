/**
 * Групиране на оборудване — един източник за admin picker, въпросник и BG етикети.
 */
import { normalizeText } from './normalize.js';

export const GYM_EQUIPMENT_OPTION = 'Пълно оборудване на зала';
export const EQUIPMENT_PICKER_OPTION = 'Посочи конкретни уреди';

export const CARDIO_TRAINER_NORMS = [
  'elliptical machine', 'skierg machine', 'stationary bike', 'stepmill machine', 'upper body ergometer',
];

export const STRENGTH_MACHINE_NORMS = ['leverage machine', 'smith machine', 'sled machine'];

const CARDIO_LEVERAGE_NAME_RE = /treadmill|elliptical|cross trainer|stationary bike|cycle cross|stepmill|skierg|ergometer|rowing machine/i;

export const EQUIPMENT_GROUPS = [
  { id: 'body_weight', label: 'Собствено тегло', norms: ['body weight', 'assisted'] },
  { id: 'dumbbell', label: 'Дъмбели / гири', norms: ['dumbbell'] },
  { id: 'barbell', label: 'Щанга и лостове', norms: ['barbell', 'ez barbell', 'olympic barbell', 'trap bar'] },
  { id: 'kettlebell', label: 'Пудовка', norms: ['kettlebell'] },
  { id: 'cable', label: 'Кабел / скрипец', norms: ['cable'] },
  { id: 'band', label: 'Ластици', norms: ['band', 'resistance band'] },
  { id: 'machine', label: 'Силови машини', norms: [...STRENGTH_MACHINE_NORMS] },
  { id: 'cardio_trainer', label: 'Кардио тренажори', norms: [...CARDIO_TRAINER_NORMS] },
  { id: 'balls', label: 'Топки / фитбол', norms: ['stability ball', 'medicine ball', 'bosu ball'] },
  { id: 'weight_plate', label: 'Тежест (Диск)', norms: ['weighted'] },
  { id: 'accessory', label: 'Аксесоари', norms: ['rope', 'roller', 'wheel roller', 'tire', 'hammer'] },
];

export const VIRTUAL_EQUIPMENT_GROUPS = { equipment_rig: ['machine', 'cable'] };

/** Допълнителни групи само за въпросника (няма отделен equipNorm в DB). */
export const QUESTIONNAIRE_EXTRA_GROUPS = [
  { id: 'step_platform', label: 'Степ платформа / блок', norms: ['body weight'] },
];

/** Групи извън „Посочи конкретни уреди“ (машини/кабел/кардио → apparatus picker). */
export const QUESTIONNAIRE_EXCLUDED_GROUP_IDS = new Set(['machine', 'cable', 'cardio_trainer']);

export const QUESTIONNAIRE_EQUIPMENT_SECTIONS = [
  {
    id: 'free_weights',
    label: 'Свободни тежести',
    groupIds: ['dumbbell', 'barbell', 'kettlebell', 'weight_plate'],
  },
  {
    id: 'flexible',
    label: 'Ластици и топки',
    groupIds: ['band', 'balls'],
  },
  {
    id: 'body_and_accessory',
    label: 'Собствено тегло и аксесоари',
    groupIds: ['body_weight', 'step_platform', 'accessory'],
  },
];

const GROUP_BY_ID = new Map([...EQUIPMENT_GROUPS, ...QUESTIONNAIRE_EXTRA_GROUPS].map((g) => [g.id, g]));
const NORM_TO_GROUP = new Map();
for (const group of EQUIPMENT_GROUPS) {
  for (const norm of group.norms) NORM_TO_GROUP.set(norm, group);
}

export const EQUIP_NORM_LABELS = {
  'body weight': 'собствено тегло', assisted: 'с асистенция', dumbbell: 'дъмбели',
  barbell: 'щанга', 'ez barbell': 'щанга (EZ)', 'olympic barbell': 'щанга', 'trap bar': 'щанга',
  kettlebell: 'пудовка', cable: 'кабел', band: 'ластик', 'resistance band': 'ластик',
  'leverage machine': 'силова машина', 'smith machine': 'силова машина', 'sled machine': 'силова машина (преса)',
  hammer: 'кърмач', 'elliptical machine': 'кардио тренажор', 'skierg machine': 'кардио тренажор',
  'stationary bike': 'кардио тренажор', 'stepmill machine': 'кардио тренажор', 'upper body ergometer': 'кардио тренажор',
  'stability ball': 'фитбол', 'medicine ball': 'медицинска топка', 'bosu ball': 'BOSU',
  weighted: 'тежест (диск)', rope: 'въже', roller: 'ролер', 'wheel roller': 'ролер', tire: 'гума',
};

/** Legacy + текущи опции от въпросника. */
export const QUESTIONNAIRE_EQUIPMENT_MAP = (() => {
  const map = {
    [normalizeText(GYM_EQUIPMENT_OPTION)]: null,
    [normalizeText(EQUIPMENT_PICKER_OPTION)]: [],
  };
  for (const group of [...EQUIPMENT_GROUPS, ...QUESTIONNAIRE_EXTRA_GROUPS]) {
    if (QUESTIONNAIRE_EXCLUDED_GROUP_IDS.has(group.id)) continue;
    map[normalizeText(group.label)] = group.norms;
  }
  // Legacy етикети
  map['дъмбели'] = ['dumbbell'];
  map['дъмбели / гирички'] = ['dumbbell'];
  map['щанга и дискове'] = ['barbell', 'ez barbell', 'olympic barbell', 'trap bar'];
  map['гира'] = ['kettlebell'];
  map['стабилизираща топка'] = ['stability ball', 'medicine ball', 'bosu ball'];
  map['trx / окачени ремъци'] = ['body weight'];
  return map;
})();

export function questionnaireEquipmentGroups() {
  const all = [...EQUIPMENT_GROUPS, ...QUESTIONNAIRE_EXTRA_GROUPS];
  return all.filter((g) => !QUESTIONNAIRE_EXCLUDED_GROUP_IDS.has(g.id));
}

export function buildQuestionnaireEquipmentOptions() {
  return questionnaireEquipmentGroups().map((g) => ({
    value: g.label,
    groupId: g.id,
  }));
}

export function groupLabelById(id) {
  return GROUP_BY_ID.get(id)?.label || id;
}

export function equipmentLabelForGroupId(id) {
  if (id === 'equipment_rig') return 'Уреди (машини + кабел)';
  return GROUP_BY_ID.get(id)?.label || id;
}

export function equipmentGroupIdForEntry(entry) {
  const norm = normalizeText(entry?.equipNorm || entry?.equipment);
  if (!norm) return null;
  if (CARDIO_TRAINER_NORMS.includes(norm)) return 'cardio_trainer';
  if (norm === 'leverage machine' && CARDIO_LEVERAGE_NAME_RE.test(String(entry?.name || ''))) return 'cardio_trainer';
  return NORM_TO_GROUP.get(norm)?.id || norm;
}

export function equipmentGroupForNorm(equipNorm) {
  const id = equipmentGroupIdForEntry({ equipNorm, equipment: equipNorm });
  return id ? GROUP_BY_ID.get(id) || null : null;
}

export function equipmentGroupLabelForNorm(equipNorm) {
  const group = equipmentGroupForNorm(equipNorm);
  if (group) return group.label;
  return EQUIP_NORM_LABELS[normalizeText(equipNorm)] || equipNorm || '';
}

export function expandEquipmentGroupIds(groupIdsOrNorms) {
  const out = new Set();
  for (const raw of groupIdsOrNorms || []) {
    const id = String(raw || '').trim();
    const virtual = VIRTUAL_EQUIPMENT_GROUPS[id];
    if (virtual?.length) {
      for (const sub of virtual) for (const n of expandEquipmentGroupIds([sub])) out.add(n);
      continue;
    }
    const group = GROUP_BY_ID.get(id);
    if (group) {
      for (const norm of group.norms) out.add(norm);
      continue;
    }
    const norm = normalizeText(id);
    if (norm) out.add(norm);
  }
  return out;
}

export function buildVirtualEquipmentFacets(countsByGroupId) {
  const machine = countsByGroupId.machine || 0;
  const cable = countsByGroupId.cable || 0;
  if (!machine && !cable) return [];
  return [{ value: 'equipment_rig', label: 'Уреди (машини + кабел)', count: machine + cable }];
}
