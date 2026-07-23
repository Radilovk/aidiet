/**
 * ProgramSpec — детерминистичен слой: сплит, обем, reps, RPE от answers.
 * AI попълва упражнения от филтриран каталог; не измисля макроструктурата.
 */
import { normalizeText } from './normalize.js';
import { formatSessionFrame } from './session-principles.js';

const ZONE_TO_GROUP = [
  { keys: ['дупе', 'глут', 'седалищ'], group: 'glutes' },
  { keys: ['бедр', 'крак', 'quad'], group: 'quads' },
  { keys: ['задн', 'hamstring', 'бедро зад'], group: 'hamstrings' },
  { keys: ['корем', 'таз', 'пресс', 'core', 'abs'], group: 'core' },
  { keys: ['гърди', 'гръд', 'chest', 'pec'], group: 'chest' },
  { keys: ['гръб', 'лат', 'back'], group: 'back' },
  { keys: ['рам', 'shoulder', 'делт'], group: 'shoulders' },
  { keys: ['ръце', 'бицепс', 'трицепс', 'arm'], group: 'arms' },
];

const GOAL_NORM = {
  'отслабване': 'отслабване',
  'покачване на мускулна маса': 'хипертрофия',
  'рекомпозиция': 'рекомпозиция',
  'силови показатели': 'сила',
  'издръжливост': 'издръжливост',
  'обща кондиция': 'обща',
  'рехабилитация след травма': 'рехаб',
};

/** @typedef {{ glutes: number; quads: number; hamstrings: number; back: number; core: number; chest: number; shoulders: number; arms: number }} VolumeMap */

/** @type {VolumeMap} */
const DEFAULT_VOLUME = { glutes: 10, quads: 8, hamstrings: 6, back: 8, core: 6, chest: 6, shoulders: 6, arms: 6 };

const DAY_NAMES = ['Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота', 'Неделя'];

const TRAINING_SLOTS = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 5],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};

/** От preferences.types → основна модалност на седмицата. */
export function resolveTrainingModality(answers = {}) {
  const types = (answers?.preferences?.types || []).map((t) => normalizeText(t));
  if (!types.length || types.some((t) => t.includes('отворен'))) return 'mixed';
  if (types.length > 1) return 'mixed';
  const t = types[0] || '';
  if (t.includes('йога') || t.includes('мобилност')) return 'mobility';
  if (t.includes('hiit')) return 'hiit';
  if (t.includes('кардио')) return 'cardio';
  if (t.includes('функционал')) return 'functional';
  return 'strength';
}

function focusForDayType(type) {
  const map = {
    strength: 'Сила',
    cardio: 'Кардио',
    hiit: 'HIIT',
    mobility: 'Мобилност / стречинг',
    rest: 'Почивка',
  };
  return map[type] || type;
}

/** Детерминистичен шаблон: основен фокус (dayFocus) на всеки тренировъчен ден. */
export function buildWeekDayTypes(sessions, modality, goalNorm = '') {
  const n = Math.min(6, Math.max(2, sessions || 3));
  const slots = TRAINING_SLOTS[n] || TRAINING_SLOTS[3];
  let types;
  if (modality === 'mixed') {
    const cycle = String(goalNorm).includes('издръжлив')
      ? ['cardio', 'strength', 'mobility']
      : ['strength', 'mobility', 'cardio'];
    types = slots.map((_, i) => cycle[i % cycle.length]);
  } else if (modality === 'mobility') {
    types = slots.map(() => 'mobility');
  } else if (modality === 'cardio') {
    types = slots.map(() => 'cardio');
  } else if (modality === 'hiit') {
    types = slots.map(() => 'hiit');
  } else {
    types = slots.map(() => 'strength');
  }
  return DAY_NAMES.map((day, i) => {
    const slotIdx = slots.indexOf(i);
    if (slotIdx === -1) return { day, type: 'rest', focus: 'Почивка' };
    const type = types[slotIdx] || 'strength';
    return { day, type, focus: focusForDayType(type) };
  });
}

function modalitiesInWeek(dayTypes = []) {
  return [...new Set(dayTypes.map((d) => d.type).filter((t) => t && t !== 'rest'))];
}

function goalKey(answers) {
  const main = normalizeText(answers?.goal?.main || '');
  if (main === 'друго') return normalizeText(answers?.goal?.other || '') || 'обща';
  return GOAL_NORM[main] || main || 'обща';
}

export function parseLevel(experience = '') {
  const exp = normalizeText(experience);
  if (exp.includes('никакъв') || (exp.includes('начинаещ') && !exp.includes('средно'))) return 1;
  if (exp.includes('напреднал') || exp.includes('5+')) return 3;
  return 2;
}

export function parseSessionCount(freq = '') {
  const f = normalizeText(freq);
  if (f.includes('ежеднев')) return 6;
  if (f.includes('5') && f.includes('6')) return 5;
  if (f.includes('3') && f.includes('4')) return 3;
  if (f.includes('1') && f.includes('2')) return 2;
  return 3;
}

export function parseDurationMin(duration = '') {
  const d = normalizeText(duration);
  if (d.includes('до 30')) return 30;
  if (d.includes('30') && d.includes('45')) return 45;
  if (d.includes('45') && d.includes('60')) return 55;
  if (d.includes('над 60')) return 75;
  return 45;
}

export function suggestSplit(sessions, level, goalNorm, isFemale) {
  if (sessions <= 2) return 'full-body ×2';
  if (sessions === 3) {
    if (level === 1) return 'full-body ×3';
    return isFemale ? 'lower/glute + upper/posture + full' : 'upper/lower + full';
  }
  if (sessions === 4) return isFemale ? 'glute/lower ×2 + upper/posture ×2' : 'upper/lower ×2';
  if (sessions === 5) return level >= 3 ? 'PPL + glute/lower' : 'upper/lower + PPL';
  return 'PPL ×2 (rotate)';
}

function parseZonesOrdered(zonesText = '') {
  const ordered = [];
  const seen = new Set();
  for (const part of String(zonesText).split(/[,;/\n]+/)) {
    const z = part.trim().toLowerCase();
    if (!z) continue;
    for (const { keys, group } of ZONE_TO_GROUP) {
      if (keys.some((k) => z.includes(k)) && !seen.has(group)) {
        seen.add(group);
        ordered.push(group);
        break;
      }
    }
  }
  return ordered;
}

function baseVolumeByGoal(goalNorm) {
  const g = goalNorm;
  if (g.includes('отслаб')) {
    return { glutes: 10, quads: 8, hamstrings: 6, back: 8, core: 6, chest: 4, shoulders: 4, arms: 4 };
  }
  if (g.includes('хипертроф') || g.includes('рекомпоз')) {
    return { glutes: 14, quads: 12, hamstrings: 10, back: 12, core: 6, chest: 10, shoulders: 8, arms: 8 };
  }
  if (g.includes('сила')) {
    return { glutes: 8, quads: 10, hamstrings: 8, back: 12, core: 4, chest: 8, shoulders: 6, arms: 6 };
  }
  if (g.includes('издръжлив') || g.includes('рехаб')) {
    return { glutes: 8, quads: 8, hamstrings: 6, back: 8, core: 8, chest: 4, shoulders: 4, arms: 4 };
  }
  return { glutes: 10, quads: 8, hamstrings: 6, back: 8, core: 6, chest: 6, shoulders: 6, arms: 6 };
}

/**
 * @param {VolumeMap} vol
 * @param {number} level
 * @returns {VolumeMap}
 */
function applyLevelScale(vol, level) {
  const scale = level === 1 ? 0.8 : (level === 3 ? 1.12 : 1);
  /** @type {VolumeMap} */
  const out = { ...DEFAULT_VOLUME, ...vol };
  for (const k of /** @type {(keyof VolumeMap)[]} */ (Object.keys(DEFAULT_VOLUME))) {
    out[k] = Math.max(4, Math.round(out[k] * scale));
  }
  return out;
}

/** @param {VolumeMap} vol @returns {VolumeMap} */
function applyGenderBias(vol, isFemale, isMale) {
  const out = { ...vol };
  if (isFemale) {
    out.glutes = Math.round((out.glutes || 8) * 1.35);
    out.quads = Math.round((out.quads || 8) * 0.9);
    out.chest = Math.min(out.chest || 4, 4);
    out.arms = Math.min(out.arms || 4, 5);
  } else if (isMale) {
    out.chest = Math.round((out.chest || 8) * 1.1);
    out.back = Math.round((out.back || 8) * 1.05);
  }
  return out;
}

/** @param {VolumeMap} vol @returns {VolumeMap} */
function applyZoneBoost(vol, zonesOrdered) {
  const out = { ...vol };
  zonesOrdered.forEach((group, i) => {
    const boost = i === 0 ? 4 : (i === 1 ? 2 : 1);
    out[group] = (out[group] || 6) + boost;
  });
  return out;
}

export function repRangeForGoal(goalNorm, level) {
  const g = goalNorm;
  if (g.includes('сила')) return { reps: '4-6', rest: '120-180s' };
  if (g.includes('издръжлив') || g.includes('рехаб')) return { reps: '12-20', rest: '45-60s' };
  if (g.includes('отслаб')) return { reps: '10-15', rest: '60-75s' };
  if (level === 1) return { reps: '10-12', rest: '75-90s' };
  return { reps: '8-12', rest: '60-90s' };
}

export function rpeCapFromAnswers(answers = {}) {
  const blob = [
    ...(answers.health || []),
    ...(answers.healthFemale || []),
    answers.sleep || '',
    answers.stress != null ? String(answers.stress) : '',
  ].join(' ').toLowerCase();

  if (/бременн|кърм|следродил|сърдечно|хипертон|кръвно/i.test(blob)) return 7;
  if (/лош сън|много лош|stress|стрес.*[89]|стрес.*10/i.test(blob) || Number(answers.stress) >= 8) return 7;
  if (/рехаб|травм/i.test(normalizeText(answers?.goal?.main || ''))) return 7;
  return 8;
}

export function buildVolumeBudget(answers) {
  const gender = normalizeText(answers?.gender || '');
  const isFemale = gender.includes('жена');
  const isMale = gender.includes('мъж');
  const level = parseLevel(answers?.experience);
  const goalNorm = goalKey(answers);

  let vol = baseVolumeByGoal(goalNorm);
  if (!vol || typeof vol !== 'object' || !Object.keys(vol).length) vol = { ...DEFAULT_VOLUME };
  vol = applyLevelScale(vol, level);
  vol = applyGenderBias(vol, isFemale, isMale);

  const zonesText = answers?.goal?.zones || '';
  const zonesOrdered = parseZonesOrdered(zonesText);
  if (zonesOrdered.length) {
    vol = applyZoneBoost(vol, zonesOrdered);
  } else if (isFemale) {
    vol = applyZoneBoost(vol, ['glutes', 'quads']);
  }

  return { volume: vol, zonesOrdered, zonesText: zonesText.trim() };
}

function buildApproachRationale({
  sessions, level, goal, split, modality, volume, zonesText, isFemale, dayTypes,
}) {
  const parts = [`${split} — ${sessions} сесии, ниво ${level}, цел ${goal}, модалност ${modality}.`];
  if (zonesText) parts.push(`Приоритет зони: ${zonesText}.`);
  else if (isFemale) parts.push('Женски bias: glute/бедра над bench.');
  const activeDays = (dayTypes || [])
    .filter((d) => d.type !== 'rest')
    .map((d) => `${d.day.slice(0, 2)}=${d.type}`)
    .join(', ');
  if (activeDays) parts.push(`Разпределение: ${activeDays}.`);
  const volLine = formatVolumeLine(volume);
  if (volLine) parts.push(`Обем/седм: ${volLine}.`);
  parts.push('Ред и подбор: compound→isolation; по dayFocus и обем; без случайни избори.');
  return parts.join(' ');
}

/** Детерминистичен ProgramSpec от answers. */
export function buildProgramSpec(answers = {}) {
  const gender = normalizeText(answers?.gender || '');
  const isFemale = gender.includes('жена');
  const level = parseLevel(answers?.experience);
  const sessions = parseSessionCount(answers?.preferences?.freq);
  const durationMin = parseDurationMin(answers?.preferences?.duration);
  const goalNorm = goalKey(answers);
  const goalLabel = answers?.goal?.main === 'Друго'
    ? (answers?.goal?.other || 'Друго')
    : (answers?.goal?.main || '—');

  const { volume, zonesOrdered, zonesText } = buildVolumeBudget(answers);
  const { reps, rest } = repRangeForGoal(goalNorm, level);
  const rpeMax = rpeCapFromAnswers(answers);
  const modality = resolveTrainingModality(answers);
  const dayTypes = buildWeekDayTypes(sessions, modality, goalNorm);

  let split = suggestSplit(sessions, level, goalNorm, isFemale);
  let orderHint = 'compound→isolation; zones↓ first each day';
  let repsOut = reps;
  let restOut = rest;
  if (modality === 'mobility') {
    split = `mobility/yoga ×${sessions}`;
    orderHint = 'основен блок: flow/пози/hold; warmup/cooldown с кардио и стреч по session_principles';
    repsOut = '30-60s hold';
    restOut = '15-30s';
  } else if (modality === 'cardio') {
    split = `cardio ×${sessions}`;
    orderHint = 'основен блок: zone 2/темпо; warmup/cooldown по session_principles';
  } else if (modality === 'hiit') {
    split = `HIIT ×${sessions}`;
    orderHint = 'основен блок: интервали; warmup прогресивен, cooldown лесен кардио+стреч';
  } else {
    orderHint = 'compound→isolation в exercises; warmup=кардио+мобилност, cooldown=стреч+леко кардио';
  }

  return {
    sessions,
    durationMin,
    level,
    maxDiff: level,
    goal: goalLabel,
    goalNorm,
    modality,
    dayTypes,
    weekModalities: modalitiesInWeek(dayTypes),
    sessionFrame: formatSessionFrame({
      durationMin,
      dayTypes,
    }),
    split,
    zonesText,
    zonesOrdered,
    volume,
    reps: repsOut,
    rest: restOut,
    rpeMax,
    isFemale,
    orderHint,
    approachRationale: buildApproachRationale({
      sessions, level, goal: goalLabel, split, modality, volume, zonesText, isFemale, dayTypes,
    }),
  };
}

export function formatVolumeLine(volume) {
  const order = ['glutes', 'quads', 'hamstrings', 'back', 'core', 'chest', 'shoulders', 'arms'];
  return order
    .filter((g) => volume[g])
    .map((g) => `${g}:${volume[g]}`)
    .join(', ');
}

/** Компактен блок за user prompt (~15 реда). */
export function formatProgramSpecBlock(spec) {
  if (!spec) return '';
  const lines = [
    `sessions: ${spec.sessions} | dur: ${spec.durationMin}min | level: ${spec.level} | maxDiff: d≤${spec.maxDiff ?? spec.level} | goal: ${spec.goal}`,
    `modality: ${spec.modality || 'strength'}`,
    `split: ${spec.split}`,
  ];
  if (spec.dayTypes?.length) {
    const dt = spec.dayTypes
      .filter((d) => d.type !== 'rest')
      .map((d) => `${d.day.slice(0, 2)}=${d.type}`)
      .join(', ');
    if (dt) lines.push(`dayFocus: ${dt}`);
  }
  if (spec.sessionFrame) lines.push(`session: ${spec.sessionFrame}`);
  if (spec.zonesText) lines.push(`zones↓: ${spec.zonesText}`);
  else if (spec.isFemale) lines.push('zones↓: дупе>бедра');
  lines.push(`volume/wk: ${formatVolumeLine(spec.volume)}`);
  lines.push(`reps: ${spec.reps} | rest: ${spec.rest} | rpe≤${spec.rpeMax}`);
  if (spec.orderHint) lines.push(`order: ${spec.orderHint}`);
  if (spec.approachRationale) lines.push(`logic: ${spec.approachRationale}`);
  return lines.join('\n');
}

/** Контекст извън program_spec — без полета вече в spec/constraints. */
export function buildCompactProfileForPrompt(answers = {}) {
  const lines = [];
  const health = [...(answers.health || []), ...(answers.healthFemale || [])]
    .filter((h) => h && !normalizeText(h).includes('няма'));
  if (answers.healthMeds?.trim()) health.push(`медикаменти: ${answers.healthMeds.trim()}`);
  if (answers.healthOther?.trim()) health.push(answers.healthOther.trim());
  if (health.length) lines.push(`Здраве: ${health.join('; ')}`);

  const limits = (answers.limitations || []).filter((l) => l && !normalizeText(l).includes('нямам'));
  if (limits.length) lines.push(`Ограничения: ${limits.join('; ')}`);
  if (answers.breastImplants?.implants) {
    lines.push(`Импланти: ${answers.breastImplants.implants}`);
  }

  if (answers.weightChange?.type && answers.weightChange.type !== 'stable') {
    const dir = answers.weightChange.type === 'gain' ? '+' : '−';
    lines.push(`Тегло 6м: ${dir}${answers.weightChange.amountKg || '?'} кг${answers.weightChange.reason ? ` (${answers.weightChange.reason})` : ''}`);
  }
  if (answers.dailyActivity) lines.push(`Дневна активност: ${answers.dailyActivity}`);
  if (answers.sportActivity?.status && answers.sportActivity.status !== 'Не тренирам в момента') {
    lines.push(`Спорт: ${answers.sportActivity.status}${answers.sportActivity.current ? ` — ${answers.sportActivity.current}` : ''}`);
  }
  if (answers.nutrition?.type) {
    const nut = answers.nutrition.type === 'Друго' && answers.nutrition.custom
      ? answers.nutrition.custom
      : answers.nutrition.type;
    if (answers.nutrition.mealsPerDay) {
      lines.push(`Хранене: ${nut}, ${answers.nutrition.mealsPerDay} хран./ден`);
    } else {
      lines.push(`Хранене: ${nut}`);
    }
  }
  if (answers.goal?.deadline) lines.push(`Срок: ${answers.goal.deadline}`);

  const equipExtra = answers.equipmentOther?.trim();
  if (equipExtra) lines.push(`Оборудване (друго): ${equipExtra}`);

  if (answers.preferences?.timeOfDay) {
    lines.push(`Време: ${answers.preferences.timeOfDay}`);
  }

  const sleep = answers.sleep || '';
  if (sleep) lines.push(`Сън: ${sleep}`);
  if (Number(answers.stress) >= 1) lines.push(`Стрес: ${answers.stress}/10`);
  if (answers.extraInfo?.trim()) lines.push(`Допълнително: ${answers.extraInfo.trim()}`);

  return lines.join('\n');
}
