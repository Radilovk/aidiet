/**
 * Каталог на конкретни уреди/станции в залата — за въпросника.
 */
import { normalizeText, tokenize, tokenOverlapScore } from './normalize.js';
import { expandSearchTokens } from './exercise-synonyms.js';

export const APPARATUS_CATEGORIES = [
  { id: 'all', label: 'Всички типове' },
  { id: 'machine', label: 'Силови машини' },
  { id: 'cable', label: 'Кабел / скрипец' },
  { id: 'bench', label: 'Лежанки' },
  { id: 'rack', label: 'Стойки' },
  { id: 'cardio', label: 'Кардио' },
];

export const APPARATUS_MUSCLES = [
  { id: 'all', label: 'Всички зони' },
  { id: 'chest', label: 'Гърди' },
  { id: 'back', label: 'Гръб' },
  { id: 'legs', label: 'Крака' },
  { id: 'glutes', label: 'Седалищни' },
  { id: 'shoulders', label: 'Рамене' },
  { id: 'arms', label: 'Ръце' },
  { id: 'core', label: 'Корем / гръбнак' },
  { id: 'cardio', label: 'Кардио' },
  { id: 'general', label: 'Многоцелеви' },
];

const MUSCLE_BY_ID = new Map(APPARATUS_MUSCLES.map((m) => [m.id, m.label]));
const CATEGORY_BY_ID = new Map(APPARATUS_CATEGORIES.map((c) => [c.id, c.label]));

/** @type {{ id: string, label: string, category: string, muscle: string, terms: string[], equipHints: string[], nameMatch?: RegExp }[]} */
export const GYM_APPARATUS = [
  { id: 'bench_flat', label: 'Лежанка хоризонтална', category: 'bench', muscle: 'chest', terms: ['flat bench', 'horizontal bench', 'хоризонтална', 'лежанка'], equipHints: ['barbell', 'dumbbell'], nameMatch: /flat bench|horizontal bench/i },
  { id: 'bench_incline', label: 'Лежанка наклонена', category: 'bench', muscle: 'chest', terms: ['incline bench', 'наклонена'], equipHints: ['barbell', 'dumbbell'], nameMatch: /incline bench/i },
  { id: 'bench_decline', label: 'Лежанка отрицателна', category: 'bench', muscle: 'chest', terms: ['decline bench', 'отрицателна'], equipHints: ['barbell', 'dumbbell'], nameMatch: /decline bench/i },
  { id: 'bench_preacher', label: 'Скамейка проповедник', category: 'bench', muscle: 'arms', terms: ['preacher bench', 'проповедник', 'скот'], equipHints: ['barbell', 'ez barbell', 'dumbbell'], nameMatch: /preacher/i },

  { id: 'rack_squat', label: 'Стойка за клек / power rack', category: 'rack', muscle: 'legs', terms: ['squat rack', 'power rack', 'стойка', 'клек'], equipHints: ['barbell'], nameMatch: /squat|power rack|rack pull/i },
  { id: 'smith', label: 'Смит машина', category: 'rack', muscle: 'general', terms: ['smith', 'смит', 'smith machine'], equipHints: ['smith machine'], nameMatch: /smith/i },

  { id: 'leg_press', label: 'Лег преса', category: 'machine', muscle: 'legs', terms: ['leg press', 'лег преса', 'преса крака'], equipHints: ['leverage machine', 'sled machine', 'smith machine'], nameMatch: /leg press/i },
  { id: 'hack_squat', label: 'Хак квот', category: 'machine', muscle: 'legs', terms: ['hack squat', 'хак'], equipHints: ['sled machine', 'leverage machine'], nameMatch: /hack squat|hack leg/i },
  { id: 'chest_press', label: 'Гръдна преса', category: 'machine', muscle: 'chest', terms: ['chest press', 'гръдна преса', 'чест преса'], equipHints: ['leverage machine', 'smith machine'], nameMatch: /chest press/i },
  { id: 'incline_chest_press', label: 'Гръдна преса наклонена', category: 'machine', muscle: 'chest', terms: ['incline chest press', 'наклонена преса'], equipHints: ['leverage machine', 'smith machine'], nameMatch: /incline chest press/i },
  { id: 'lat_pulldown', label: 'Горен скрипец (машина)', category: 'machine', muscle: 'back', terms: ['lat pulldown', 'горен скрипец', 'pulldown'], equipHints: ['leverage machine', 'cable'], nameMatch: /lat pulldown|front pulldown/i },
  { id: 'seated_row_machine', label: 'Гребен тресч (машина)', category: 'machine', muscle: 'back', terms: ['seated row', 'гребен', 'тресч'], equipHints: ['leverage machine', 'cable'], nameMatch: /seated row|machine row|high row/i },
  { id: 'leg_extension', label: 'Машина предно бедро', category: 'machine', muscle: 'legs', terms: ['leg extension', 'предно бедро', 'quads'], equipHints: ['leverage machine'], nameMatch: /leg extension/i },
  { id: 'leg_curl', label: 'Машина задно бедро', category: 'machine', muscle: 'legs', terms: ['leg curl', 'задно бедро', 'hamstring'], equipHints: ['leverage machine'], nameMatch: /leg curl/i },
  { id: 'hip_abductor', label: 'Машина отвеждащи', category: 'machine', muscle: 'glutes', terms: ['abductor', 'отвеждащи', 'абдуктор'], equipHints: ['leverage machine'], nameMatch: /abduct/i },
  { id: 'hip_adductor', label: 'Машина привеждащи', category: 'machine', muscle: 'legs', terms: ['adductor', 'привеждащи', 'аддуктор'], equipHints: ['leverage machine'], nameMatch: /adduct/i },
  { id: 'pec_deck', label: 'Пек-дек / бабърфлай', category: 'machine', muscle: 'chest', terms: ['pec deck', 'fly machine', 'бабърфлай'], equipHints: ['leverage machine'], nameMatch: /pec deck|reverse fly|fly machine/i },
  { id: 'shoulder_press_machine', label: 'Раменна преса', category: 'machine', muscle: 'shoulders', terms: ['shoulder press machine', 'раменна преса'], equipHints: ['leverage machine', 'smith machine'], nameMatch: /shoulder press/i },
  { id: 'lateral_raise_machine', label: 'Странични повдигания (машина)', category: 'machine', muscle: 'shoulders', terms: ['lateral raise machine', 'странични'], equipHints: ['leverage machine'], nameMatch: /lateral raise/i },
  { id: 'calf_machine', label: 'Машина за прасци', category: 'machine', muscle: 'legs', terms: ['calf raise machine', 'прасци', 'calf press'], equipHints: ['leverage machine', 'sled machine', 'smith machine'], nameMatch: /calf raise|calf press|donkey calf/i },
  { id: 'assisted_pullup', label: 'Асистирани набирания / кофички', category: 'machine', muscle: 'back', terms: ['assisted pull', 'кофички', 'gravitron'], equipHints: ['leverage machine', 'assisted'], nameMatch: /assisted (pull|chin|dip)/i },
  { id: 'back_extension_machine', label: 'Хиперекстензия / гръб', category: 'machine', muscle: 'core', terms: ['back extension', 'хиперекстензия'], equipHints: ['leverage machine'], nameMatch: /back extension|hyperextension/i },
  { id: 'glute_machine', label: 'Машина седалищни', category: 'machine', muscle: 'glutes', terms: ['glute', 'kickback machine', 'седалищни'], equipHints: ['leverage machine', 'cable'], nameMatch: /glute|kickback|hip extension/i },
  { id: 'triceps_dip_machine', label: 'Машина за кофички / трицепс', category: 'machine', muscle: 'arms', terms: ['dip machine', 'triceps dip', 'кофички'], equipHints: ['leverage machine'], nameMatch: /dip machine|triceps dip/i },
  { id: 'preacher_curl_machine', label: 'Машина бицепс (проповедник)', category: 'machine', muscle: 'arms', terms: ['preacher curl machine', 'бицепс машина'], equipHints: ['leverage machine'], nameMatch: /preacher curl/i },
  { id: 'reverse_hyper', label: 'Reverse hyper', category: 'machine', muscle: 'glutes', terms: ['reverse hyper', 'гръб седалищни'], equipHints: ['leverage machine'], nameMatch: /reverse hyper/i },
  { id: 'rowing_machine', label: 'Гребен ергометър', category: 'cardio', muscle: 'cardio', terms: ['rowing machine', 'rower', 'гребане'], equipHints: ['leverage machine'], nameMatch: /rowing machine/i },

  { id: 'cable_high_pulley', label: 'Горен скрипец (кабел)', category: 'cable', muscle: 'back', terms: ['high pulley', 'горен скрипец', 'high cable'], equipHints: ['cable'], nameMatch: /high pulley|lat pulldown|straight arm pulldown/i },
  { id: 'cable_low_pulley', label: 'Долен скрипец (кабел)', category: 'cable', muscle: 'general', terms: ['low pulley', 'долен скрипец'], equipHints: ['cable'], nameMatch: /low pulley|low cable/i },
  { id: 'cable_crossover', label: 'Кръстосан скрипец', category: 'cable', muscle: 'chest', terms: ['crossover', 'кръстосан', 'cable fly'], equipHints: ['cable'], nameMatch: /cross.?over|crossover/i },
  { id: 'cable_row', label: 'Хоризонтален кабел (гръб)', category: 'cable', muscle: 'back', terms: ['cable row', 'seated cable row', 'гръб кабел'], equipHints: ['cable'], nameMatch: /cable.*row|row.*cable/i },
  { id: 'cable_triceps', label: 'Кабел трицепс (pushdown)', category: 'cable', muscle: 'arms', terms: ['triceps pushdown', 'трицепс кабел', 'pushdown'], equipHints: ['cable'], nameMatch: /triceps pushdown|pushdown/i },
  { id: 'cable_face_pull', label: 'Face pull (кабел)', category: 'cable', muscle: 'shoulders', terms: ['face pull', 'задни дълги'], equipHints: ['cable'], nameMatch: /face pull/i },
  { id: 'cable_curl', label: 'Кабел бицепс', category: 'cable', muscle: 'arms', terms: ['cable curl', 'бицепс кабел'], equipHints: ['cable'], nameMatch: /cable curl/i },
  { id: 'cable_glute_kickback', label: 'Кабел седалищни (kickback)', category: 'cable', muscle: 'glutes', terms: ['cable kickback', 'glute kickback'], equipHints: ['cable'], nameMatch: /kickback/i },

  { id: 'treadmill', label: 'Пътека', category: 'cardio', muscle: 'cardio', terms: ['treadmill', 'пътека'], equipHints: ['leverage machine'], nameMatch: /treadmill/i },
  { id: 'elliptical', label: 'Елиптик', category: 'cardio', muscle: 'cardio', terms: ['elliptical', 'елиптик'], equipHints: ['elliptical machine'], nameMatch: /elliptical|cross trainer/i },
  { id: 'stationary_bike', label: 'Велоергометър', category: 'cardio', muscle: 'cardio', terms: ['stationary bike', 'велоерг'], equipHints: ['stationary bike'], nameMatch: /stationary bike|cycle cross/i },
  { id: 'stepmill', label: 'Степери / стълби', category: 'cardio', muscle: 'cardio', terms: ['stepmill', 'stair', 'стълби'], equipHints: ['stepmill machine'], nameMatch: /stepmill|stair/i },
  { id: 'ski_erg', label: 'Ski erg', category: 'cardio', muscle: 'cardio', terms: ['ski erg', 'skierg'], equipHints: ['skierg machine'], nameMatch: /skierg|ski erg/i },
  { id: 'upper_erg', label: 'Горен ергометър', category: 'cardio', muscle: 'cardio', terms: ['upper body ergometer', 'arm erg'], equipHints: ['upper body ergometer'], nameMatch: /ergometer|upper body erg/i },
];

const BY_ID = new Map(GYM_APPARATUS.map((a) => [a.id, a]));

export function apparatusLabel(id) {
  return BY_ID.get(id)?.label || id;
}

export function muscleLabel(id) {
  return MUSCLE_BY_ID.get(id) || id;
}

export function categoryLabel(id) {
  return CATEGORY_BY_ID.get(id) || id;
}

export function searchApparatus({ query = '', category = 'all', muscle = 'all' } = {}) {
  const tokens = expandSearchTokens(query);
  return GYM_APPARATUS.filter((a) => {
    if (category && category !== 'all' && a.category !== category) return false;
    if (muscle && muscle !== 'all' && a.muscle !== muscle) return false;
    if (!tokens.length) return true;
    const hay = tokenize(`${a.label} ${a.terms.join(' ')} ${MUSCLE_BY_ID.get(a.muscle) || ''} ${CATEGORY_BY_ID.get(a.category) || ''}`);
    return tokenOverlapScore(tokens, hay) > 0;
  });
}

export function groupApparatusByMuscle(items) {
  const order = APPARATUS_MUSCLES.filter((m) => m.id !== 'all').map((m) => m.id);
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.muscle)) groups.set(item.muscle, []);
    groups.get(item.muscle).push(item);
  }
  return order
    .filter((id) => groups.has(id))
    .map((id) => ({ id, label: MUSCLE_BY_ID.get(id), items: groups.get(id) }));
}

export function exerciseMatchesApparatus(entry, apparatusId) {
  const item = BY_ID.get(apparatusId);
  if (!item) return false;
  const eq = normalizeText(entry?.equipNorm || entry?.equipment);
  const hints = item.equipHints.map(normalizeText);
  if (hints.length && !hints.includes(eq)) return false;
  const name = normalizeText(entry?.name || '');
  if (item.nameMatch?.test(entry?.name || '')) return true;
  return item.terms.some((t) => name.includes(normalizeText(t)));
}

export function passesApparatusFilter(entry, pickedIds) {
  if (!pickedIds?.length) return true;
  return pickedIds.some((id) => exerciseMatchesApparatus(entry, id));
}

export function expandApparatusIds(pickedIds) {
  const equipHints = new Set(['body weight']);
  const labels = [];
  for (const id of pickedIds || []) {
    const item = BY_ID.get(id);
    if (!item) continue;
    labels.push(item.label);
    for (const h of item.equipHints) equipHints.add(normalizeText(h));
  }
  return { equipHints, labels };
}
