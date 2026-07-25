/**
 * Каталог на конкретни уреди/станции в залата — за въпросника.
 * Не са групи оборудване, а реални машини и съоръжения (лежанка, лег преса…).
 */
import { normalizeText, tokenize, tokenOverlapScore } from './normalize.js';
import { expandSearchTokens } from './exercise-synonyms.js';

export const APPARATUS_CATEGORIES = [
  { id: 'all', label: 'Всички' },
  { id: 'machine', label: 'Силови машини' },
  { id: 'cable', label: 'Кабел / скрипец' },
  { id: 'bench', label: 'Лежанки' },
  { id: 'rack', label: 'Стойки' },
  { id: 'cardio', label: 'Кардио' },
];

/** @type {{ id: string, label: string, category: string, terms: string[], equipHints: string[], nameMatch?: RegExp }[]} */
export const GYM_APPARATUS = [
  // --- Лежанки ---
  { id: 'bench_flat', label: 'Лежанка хоризонтална', category: 'bench', terms: ['flat bench', 'horizontal bench', 'хоризонтална', 'лежанка'], equipHints: ['barbell', 'dumbbell'], nameMatch: /flat bench|horizontal bench/i },
  { id: 'bench_incline', label: 'Лежанка наклонена', category: 'bench', terms: ['incline bench', 'наклонена', 'incline'], equipHints: ['barbell', 'dumbbell'], nameMatch: /incline bench/i },
  { id: 'bench_decline', label: 'Лежанка отрицателна', category: 'bench', terms: ['decline bench', 'отрицателна', 'decline'], equipHints: ['barbell', 'dumbbell'], nameMatch: /decline bench/i },
  { id: 'bench_preacher', label: 'Скамейка проповедник', category: 'bench', terms: ['preacher bench', 'preacher curl', 'проповедник', 'скот'], equipHints: ['barbell', 'ez barbell', 'dumbbell'], nameMatch: /preacher/i },

  // --- Стойки ---
  { id: 'rack_squat', label: 'Стойка за клек / power rack', category: 'rack', terms: ['squat rack', 'power rack', 'стойка', 'клек', 'rack'], equipHints: ['barbell'], nameMatch: /squat|power rack|rack pull/i },
  { id: 'smith', label: 'Смит машина', category: 'rack', terms: ['smith', 'смит', 'smith machine'], equipHints: ['smith machine'], nameMatch: /smith/i },

  // --- Силови машини ---
  { id: 'leg_press', label: 'Лег преса', category: 'machine', terms: ['leg press', 'лег преса', 'преса крака', 'преса'], equipHints: ['leverage machine', 'sled machine', 'smith machine'], nameMatch: /leg press/i },
  { id: 'hack_squat', label: 'Хак квот / преса', category: 'machine', terms: ['hack squat', 'hack', 'хак'], equipHints: ['sled machine', 'leverage machine'], nameMatch: /hack squat|hack leg/i },
  { id: 'chest_press', label: 'Гръдна преса (машина)', category: 'machine', terms: ['chest press', 'гръдна преса', 'чест преса', 'seated chest'], equipHints: ['leverage machine', 'smith machine'], nameMatch: /chest press/i },
  { id: 'incline_chest_press', label: 'Гръдна преса наклонена', category: 'machine', terms: ['incline chest press', 'наклонена преса'], equipHints: ['leverage machine', 'smith machine'], nameMatch: /incline chest press/i },
  { id: 'lat_pulldown', label: 'Горен скрипец (машина)', category: 'machine', terms: ['lat pulldown', 'горен скрипец', 'pulldown', 'lat pull'], equipHints: ['leverage machine', 'cable'], nameMatch: /lat pulldown|front pulldown/i },
  { id: 'seated_row_machine', label: 'Гребен тресч (машина)', category: 'machine', terms: ['seated row', 'гребен', 'тресч', 'row machine'], equipHints: ['leverage machine', 'cable'], nameMatch: /seated row|machine row|high row/i },
  { id: 'leg_extension', label: 'Машина предно бедро', category: 'machine', terms: ['leg extension', 'предно бедро', 'quads'], equipHints: ['leverage machine'], nameMatch: /leg extension/i },
  { id: 'leg_curl', label: 'Машина задно бедро', category: 'machine', terms: ['leg curl', 'задно бедро', 'hamstring curl', 'lying leg curl'], equipHints: ['leverage machine'], nameMatch: /leg curl/i },
  { id: 'hip_abductor', label: 'Машина отвеждащи (абдуктор)', category: 'machine', terms: ['abductor', 'отвеждащи', 'абдуктор', 'hip abduction'], equipHints: ['leverage machine'], nameMatch: /abduct/i },
  { id: 'hip_adductor', label: 'Машина привеждащи (аддуктор)', category: 'machine', terms: ['adductor', 'привеждащи', 'аддуктор', 'hip adduction'], equipHints: ['leverage machine'], nameMatch: /adduct/i },
  { id: 'pec_deck', label: 'Пек-дек / бабърфлай', category: 'machine', terms: ['pec deck', 'fly machine', 'бабърфлай', 'butterfly'], equipHints: ['leverage machine'], nameMatch: /pec deck|reverse fly|fly machine/i },
  { id: 'shoulder_press_machine', label: 'Раменна преса (машина)', category: 'machine', terms: ['shoulder press machine', 'раменна преса', 'military press machine'], equipHints: ['leverage machine', 'smith machine'], nameMatch: /shoulder press/i },
  { id: 'lateral_raise_machine', label: 'Машина странични повдигания', category: 'machine', terms: ['lateral raise machine', 'странични', 'lateral raise'], equipHints: ['leverage machine'], nameMatch: /lateral raise/i },
  { id: 'calf_machine', label: 'Машина за прасци', category: 'machine', terms: ['calf raise machine', 'прасци', 'calf press', 'donkey calf'], equipHints: ['leverage machine', 'sled machine', 'smith machine'], nameMatch: /calf raise|calf press|donkey calf/i },
  { id: 'assisted_pullup', label: 'Асистирани набирания / кофички', category: 'machine', terms: ['assisted pull', 'assisted chin', 'кофички', 'gravitron', 'assisted dip'], equipHints: ['leverage machine', 'assisted'], nameMatch: /assisted (pull|chin|dip)/i },
  { id: 'back_extension_machine', label: 'Машина за гръб (екстензия)', category: 'machine', terms: ['back extension', 'хиперекстензия', 'hyperextension'], equipHints: ['leverage machine'], nameMatch: /back extension|hyperextension/i },
  { id: 'glute_machine', label: 'Машина за седалищни (kickback/hip)', category: 'machine', terms: ['glute', 'kickback machine', 'седалищни', 'hip thrust machine'], equipHints: ['leverage machine', 'cable'], nameMatch: /glute|kickback|hip extension/i },

  // --- Кабел / скрипец ---
  { id: 'cable_high_pulley', label: 'Горен скрипец (кабел)', category: 'cable', terms: ['high pulley', 'горен скрипец', 'high cable', 'lat pulldown cable'], equipHints: ['cable'], nameMatch: /high pulley|lat pulldown|straight arm pulldown/i },
  { id: 'cable_low_pulley', label: 'Долен скрипец (кабел)', category: 'cable', terms: ['low pulley', 'долен скрипец', 'low cable'], equipHints: ['cable'], nameMatch: /low pulley|low cable/i },
  { id: 'cable_crossover', label: 'Кръстосан скрипец (crossover)', category: 'cable', terms: ['crossover', 'кръстосан', 'cable fly', 'cross over'], equipHints: ['cable'], nameMatch: /cross.?over|crossover/i },
  { id: 'cable_row', label: 'Хоризонтален кабел (гръб)', category: 'cable', terms: ['cable row', 'seated cable row', 'хоризонтален скрипец', 'гръб кабел'], equipHints: ['cable'], nameMatch: /cable.*row|row.*cable/i },
  { id: 'cable_triceps', label: 'Кабел за трицепс (pushdown)', category: 'cable', terms: ['triceps pushdown', 'трицепс кабел', 'pushdown', 'rope pushdown'], equipHints: ['cable'], nameMatch: /triceps pushdown|pushdown/i },
  { id: 'cable_face_pull', label: 'Face pull (кабел)', category: 'cable', terms: ['face pull', 'facepull', 'задни дълги'], equipHints: ['cable'], nameMatch: /face pull/i },
  { id: 'cable_curl', label: 'Кабел за бицепс', category: 'cable', terms: ['cable curl', 'бицепс кабел'], equipHints: ['cable'], nameMatch: /cable curl/i },

  // --- Кардио ---
  { id: 'treadmill', label: 'Пътека', category: 'cardio', terms: ['treadmill', 'пътека', 'бягане'], equipHints: ['leverage machine'], nameMatch: /treadmill/i },
  { id: 'elliptical', label: 'Елиптик', category: 'cardio', terms: ['elliptical', 'елиптик', 'cross trainer'], equipHints: ['elliptical machine'], nameMatch: /elliptical|cross trainer/i },
  { id: 'stationary_bike', label: 'Велоергометър', category: 'cardio', terms: ['stationary bike', 'велоерг', 'bike', 'cycle'], equipHints: ['stationary bike'], nameMatch: /stationary bike|cycle cross/i },
  { id: 'stepmill', label: 'Степери / стълби', category: 'cardio', terms: ['stepmill', 'stair', 'стълби', 'stair climber'], equipHints: ['stepmill machine'], nameMatch: /stepmill|stair/i },
  { id: 'ski_erg', label: 'Ski erg', category: 'cardio', terms: ['ski erg', 'skierg', 'гребане'], equipHints: ['skierg machine'], nameMatch: /skierg|ski erg/i },
  { id: 'upper_erg', label: 'Горен ергометър (ръце)', category: 'cardio', terms: ['upper body ergometer', 'arm erg', 'эрг'], equipHints: ['upper body ergometer'], nameMatch: /ergometer|upper body erg/i },
];

const BY_ID = new Map(GYM_APPARATUS.map((a) => [a.id, a]));

export function apparatusLabel(id) {
  return BY_ID.get(id)?.label || id;
}

export function searchApparatus({ query = '', category = 'all' } = {}) {
  const tokens = expandSearchTokens(query);
  return GYM_APPARATUS.filter((a) => {
    if (category && category !== 'all' && a.category !== category) return false;
    if (!tokens.length) return true;
    const hay = tokenize(`${a.label} ${a.terms.join(' ')}`);
    return tokenOverlapScore(tokens, hay) > 0;
  });
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

/** EN equipNorm hints + BG етикети за AI/constraints. */
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
