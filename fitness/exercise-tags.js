/**
 * Реални тагове за упражнения — gear, effective equipment, traits.
 * Dataset полето equipment=body weight често е грешно (ring dips, suspended row…).
 *
 * ИСТИНСКО СТ = само: под, кърпа/мат, стена, степ/височина, хоризонтална пейка.
 * Всичко друго (халки, лост, TRX, машина…) → effectiveEquipNorm на съответния уред.
 */
import { normalizeText } from './normalize.js';
import {
  GYM_EQUIPMENT_OPTION,
  EQUIPMENT_PICKER_OPTION,
  EQUIPMENT_GROUPS,
  QUESTIONNAIRE_EXTRA_GROUPS,
} from './equipment-groups.js';
import { expandApparatusIds } from './equipment-apparatus.js';

export const GEAR_FLOOR = 'floor';
export const GEAR_MAT = 'mat';
export const GEAR_WALL = 'wall';
export const GEAR_STEP = 'step';
export const GEAR_BENCH = 'bench';
export const GEAR_CHAIR = 'chair';
export const GEAR_PULL_BAR = 'pull_bar';
export const GEAR_PARALLEL_BARS = 'parallel_bars';
export const GEAR_RINGS = 'rings';
export const GEAR_SUSPENSION = 'suspension';
export const GEAR_DUMBBELL = 'dumbbell';
export const GEAR_KETTLEBELL = 'kettlebell';
export const GEAR_BAND = 'band';
export const GEAR_BARBELL = 'barbell';
export const GEAR_CABLE = 'cable';
export const GEAR_MACHINE = 'machine';
export const GEAR_BALL = 'ball';
export const GEAR_CARDIO_MACHINE = 'cardio_machine';
export const GEAR_ASSISTED = 'assisted';
export const GEAR_WEIGHTED = 'weighted';
export const GEAR_ROPE = 'rope';

/** @deprecated alias */
export const GEAR_BOX = GEAR_STEP;

/** Какво е позволено при „Собствено тегло“ от въпросника. */
export const BODYWEIGHT_GEAR = new Set([
  GEAR_FLOOR,
  GEAR_MAT,
  GEAR_WALL,
  GEAR_STEP,
  GEAR_BENCH,
  GEAR_CHAIR,
]);

const GYMNASTICS_RE = /\b(ring|planche|muscle[- ]?up|kipping|skin the cat|iron cross(?! stretch)|l-sit|lsit|handstand|pistol squat|dragon flag|front lever|back lever|human flag|victorian)\b/i;
const SUSPENDED_RE = /\b(suspended|trx)\b/i;
const PARALLEL_BAR_RE = /\b(parallel bar|high parallel|dip bar|dip station)\b/i;
const PULL_BAR_RE = /\b(pull[- ]?up|chin[- ]?up|muscle[- ]?up|kipping|toes to bar|hanging|fixed bar|single bar)\b/i;
const INVERTED_ROW_RE = /\binverted row\b/i;
const DIP_RE = /\b(dip|dips)\b/i;
const BENCH_USE_RE = /\b(on bench|bench hip|hyperextension \(on bench\)|glute bridge two legs on bench|feet on bench|hands on bench)\b/i;
const STEP_USE_RE = /\b(on box|step[- ]?up|step up|box step|plyo box|platform)\b/i;
const WALL_RE = /\b(wall push|push-up \(wall\)|wall sit)\b/i;
const MAT_RE = /\b(towel|mat\b|foam roll)\b/i;
const STRETCH_RE = /\b(stretch|mobility|yoga|pilates|flexibility)\b/i;
const ASSISTED_RE = /\b(assisted|band assisted|machine assisted)\b/i;

const CHAIR_RE = /\bchair\b/i;
const CAPTAINS_CHAIR_RE = /\bcaptain'?s?\s+chair\b/i;
const BEGINNER_SAFE_RE = /\b(wall push|push-up \(wall\)|glute bridge|bird dog|dead bug|cat cow|clamshell|fire hydrant|step-up|bodyweight squat|chair squat|split squat(?! jump)|lunge|plank|crunch|march|marching|hamstring stretch|hip flexor stretch|child pose|cobra|sphinx)\b/i;

const GEAR_TO_FILTER_NORM = {
  [GEAR_RINGS]: 'rings',
  [GEAR_PULL_BAR]: 'pull_up_bar',
  [GEAR_SUSPENSION]: 'suspension',
  [GEAR_PARALLEL_BARS]: 'parallel_bars',
  [GEAR_DUMBBELL]: 'dumbbell',
  [GEAR_KETTLEBELL]: 'kettlebell',
  [GEAR_BAND]: 'band',
  [GEAR_BARBELL]: 'barbell',
  [GEAR_CABLE]: 'cable',
  [GEAR_MACHINE]: 'leverage machine',
  [GEAR_CARDIO_MACHINE]: 'elliptical machine',
  [GEAR_BALL]: 'stability ball',
  [GEAR_ROPE]: 'rope',
  [GEAR_WEIGHTED]: 'weighted',
  [GEAR_ASSISTED]: 'assisted',
};

/** Приоритет при прекласификация на body weight → уред. */
const APPARATUS_PRIORITY = [
  GEAR_CARDIO_MACHINE,
  GEAR_MACHINE,
  GEAR_CABLE,
  GEAR_BARBELL,
  GEAR_DUMBBELL,
  GEAR_KETTLEBELL,
  GEAR_BAND,
  GEAR_BALL,
  GEAR_ROPE,
  GEAR_WEIGHTED,
  GEAR_ASSISTED,
  GEAR_RINGS,
  GEAR_SUSPENSION,
  GEAR_PARALLEL_BARS,
  GEAR_PULL_BAR,
];

const GROUP_GEAR = new Map();
const GROUP_GEAR_NORM = new Map();
for (const group of [...EQUIPMENT_GROUPS, ...QUESTIONNAIRE_EXTRA_GROUPS]) {
  const gear = [];
  for (const norm of group.norms) {
    if (norm === 'body weight') {
      for (const g of BODYWEIGHT_GEAR) gear.push(g);
      continue;
    }
    if (norm === 'assisted') { gear.push(GEAR_ASSISTED, GEAR_MACHINE); continue; }
    if (norm === 'dumbbell') gear.push(GEAR_DUMBBELL, GEAR_FLOOR);
    else if (norm === 'kettlebell') gear.push(GEAR_KETTLEBELL, GEAR_FLOOR);
    else if (norm === 'band' || norm === 'resistance band') gear.push(GEAR_BAND, GEAR_FLOOR);
    else if (norm.includes('barbell') || norm === 'trap bar') gear.push(GEAR_BARBELL, GEAR_FLOOR);
    else if (norm === 'cable') gear.push(GEAR_CABLE);
    else if (norm.includes('machine') || norm === 'smith machine' || norm === 'sled machine') gear.push(GEAR_MACHINE);
    else if (norm.includes('ball')) gear.push(GEAR_BALL, GEAR_FLOOR);
    else if (norm === 'weighted') gear.push(GEAR_WEIGHTED, GEAR_FLOOR);
    else if (norm === 'rope') gear.push(GEAR_ROPE, GEAR_FLOOR);
    else if (['elliptical machine', 'skierg machine', 'stationary bike', 'stepmill machine', 'upper body ergometer'].includes(norm)) {
      gear.push(GEAR_CARDIO_MACHINE);
    }
  }
  GROUP_GEAR.set(group.label, [...new Set(gear)]);
  GROUP_GEAR_NORM.set(normalizeText(group.label), [...new Set(gear)]);
}

const FREE_TEXT_GEAR_HINTS = [
  { keys: ['скрипец', 'pulley', 'кабел', 'cable'], gear: [GEAR_CABLE] },
  { keys: ['дъмбел', 'dumbbell', 'гирич', 'гира '], gear: [GEAR_DUMBBELL] },
  { keys: ['лост', 'щанг', 'barbell'], gear: [GEAR_BARBELL] },
  { keys: ['машин', 'leg press', 'преса', 'смит', 'smith', 'сани', 'sled'], gear: [GEAR_MACHINE] },
  { keys: ['кардио', 'пътек', 'treadmill', 'велоерг', 'елипт', 'стълби', 'stepmill'], gear: [GEAR_CARDIO_MACHINE] },
  { keys: ['ластик', 'band', 'резист'], gear: [GEAR_BAND] },
  { keys: ['пудовк', 'kettlebell'], gear: [GEAR_KETTLEBELL] },
  { keys: ['топка', 'ball', 'фитбол'], gear: [GEAR_BALL] },
  { keys: ['диск', 'plate', 'тежест'], gear: [GEAR_WEIGHTED] },
  { keys: ['халк', 'ring', 'гимнаст'], gear: [GEAR_RINGS] },
  { keys: ['trx', 'ремък', 'подвеск', 'suspended'], gear: [GEAR_SUSPENSION] },
  { keys: ['лост за набиран', 'pull up bar', 'турник', 'турник'], gear: [GEAR_PULL_BAR] },
  { keys: ['паралел', 'parallel bar'], gear: [GEAR_PARALLEL_BARS] },
  { keys: ['степ', 'платформа', 'блокче'], gear: [GEAR_STEP] },
  { keys: ['пейка', 'bench'], gear: [GEAR_BENCH] },
  { keys: ['стол', 'chair'], gear: [GEAR_CHAIR] },
];

function gearFromFreeText(text) {
  const out = new Set();
  const n = normalizeText(text);
  if (!n) return out;
  for (const { keys, gear } of FREE_TEXT_GEAR_HINTS) {
    if (keys.some((k) => n.includes(normalizeText(k)))) {
      for (const g of gear) out.add(g);
    }
  }
  return out;
}

/**
 * Какво реално трябва за изпълнение.
 * @param {string} name
 * @param {string} [equipment]
 * @returns {string[]}
 */
export function inferRequiredGear(name = '', equipment = '') {
  const n = normalizeText(name);
  const eq = normalizeText(equipment || '');
  const gear = new Set([GEAR_FLOOR]);

  if (WALL_RE.test(n)) gear.add(GEAR_WALL);
  if (MAT_RE.test(n)) gear.add(GEAR_MAT);
  if (BENCH_USE_RE.test(n)) gear.add(GEAR_BENCH);
  if (STEP_USE_RE.test(n)) gear.add(GEAR_STEP);
  if (CHAIR_RE.test(n) && !CAPTAINS_CHAIR_RE.test(n) && !/machine|lever/i.test(eq)) gear.add(GEAR_CHAIR);
  if (CAPTAINS_CHAIR_RE.test(n)) gear.add(GEAR_PULL_BAR);
  if (/\bring\b/.test(n)) gear.add(GEAR_RINGS);
  if (SUSPENDED_RE.test(n)) gear.add(GEAR_SUSPENSION);
  if (PARALLEL_BAR_RE.test(n)) gear.add(GEAR_PARALLEL_BARS);

  if (INVERTED_ROW_RE.test(n)) {
    if (/on bench|bench/i.test(n)) gear.add(GEAR_BENCH);
    else gear.add(GEAR_PULL_BAR);
  }

  const needsBar = PULL_BAR_RE.test(n) && !ASSISTED_RE.test(n) && !/machine|band|lat pulldown|cable|lever|dumbbell|kettlebell/i.test(n)
    && !INVERTED_ROW_RE.test(n);
  if (needsBar) gear.add(GEAR_PULL_BAR);

  if (DIP_RE.test(n) && !/floor|bench dip on floor|triceps dip on floor/i.test(n) && !/machine|band|cable|lever|dumbbell/i.test(n)) {
    if (/\bring\b/.test(n)) gear.add(GEAR_RINGS);
    else if (PARALLEL_BAR_RE.test(n)) gear.add(GEAR_PARALLEL_BARS);
    else gear.add(GEAR_PULL_BAR);
  }

  if (eq === 'dumbbell') gear.add(GEAR_DUMBBELL);
  if (eq === 'kettlebell') gear.add(GEAR_KETTLEBELL);
  if (eq === 'band' || eq === 'resistance band') gear.add(GEAR_BAND);
  if (eq.includes('barbell')) gear.add(GEAR_BARBELL);
  if (eq === 'cable') gear.add(GEAR_CABLE);
  if (eq.includes('machine') || eq.includes('lever') || eq.includes('smith') || eq === 'sled machine') gear.add(GEAR_MACHINE);
  if (eq.includes('ball')) gear.add(GEAR_BALL);
  if (eq === 'weighted') gear.add(GEAR_WEIGHTED);
  if (eq === 'rope') gear.add(GEAR_ROPE);
  if (eq === 'assisted') gear.add(GEAR_ASSISTED);
  if (/elliptical|bike|treadmill|stepmill|ergometer|skierg/i.test(eq) || /treadmill|rowing machine|stationary bike/i.test(n)) {
    gear.add(GEAR_CARDIO_MACHINE);
  }

  return [...gear];
}

/** Само под/мат/стена/степ/пейка — без уреди. */
export function isTrueBodyweightExercise(name = '', equipment = '') {
  const gear = inferRequiredGear(name, equipment);
  return gear.length > 0 && gear.every((g) => BODYWEIGHT_GEAR.has(g));
}

/**
 * Реална категория за филтър — прекласифицира body weight с уред към уреда.
 * @param {string} name
 * @param {string} [equipment]
 * @returns {string}
 */
export function resolveEffectiveEquipNorm(name = '', equipment = '') {
  const eq = normalizeText(equipment || '');
  const gear = inferRequiredGear(name, equipment);

  if (isTrueBodyweightExercise(name, equipment)) return 'body weight';

  for (const g of APPARATUS_PRIORITY) {
    if (gear.includes(g) && GEAR_TO_FILTER_NORM[g]) return GEAR_TO_FILTER_NORM[g];
  }

  if (eq && eq !== 'body weight') return eq;

  const extra = gear.filter((g) => !BODYWEIGHT_GEAR.has(g));
  if (extra.length) return GEAR_TO_FILTER_NORM[extra[0]] || extra[0];

  return 'body weight';
}

/**
 * @param {string} name
 * @param {string} [equipment]
 */
export function inferExerciseTraits(name = '', equipment = '') {
  const n = normalizeText(name);
  const eq = normalizeText(equipment || '');
  const gear = inferRequiredGear(name, equipment);
  const trueBodyweight = isTrueBodyweightExercise(name, equipment);
  const effectiveEquipNorm = resolveEffectiveEquipNorm(name, equipment);

  const gymnastics = GYMNASTICS_RE.test(n);
  const suspended = SUSPENDED_RE.test(n) || gear.includes(GEAR_SUSPENSION);
  const rings = /\bring\b/.test(n) || gear.includes(GEAR_RINGS);
  const parallelBars = PARALLEL_BAR_RE.test(n) || gear.includes(GEAR_PARALLEL_BARS);
  const pullBar = gear.includes(GEAR_PULL_BAR);
  const highSkill = gymnastics || rings || /\b(pistol squat|one arm push|archer push|clapping push|clap push|drop push|depth jump|explosive|plyo|burpee|muscle)\b/i.test(n);
  const assisted = ASSISTED_RE.test(n) || eq === 'assisted' || /machine|lever|cable|band/i.test(eq);
  const stretch = STRETCH_RE.test(n);
  const beginnerSafe = trueBodyweight && !highSkill && !rings && !suspended && !parallelBars
    && (BEGINNER_SAFE_RE.test(n) || (stretch && !pullBar));

  return {
    gear,
    trueBodyweight,
    effectiveEquipNorm,
    gymnastics,
    suspended,
    rings,
    parallelBars,
    pullBar,
    highSkill,
    assisted,
    stretch,
    beginnerSafe,
    homeFriendly: trueBodyweight && !highSkill,
  };
}

/**
 * @param {object} raw
 * @param {{ diff?: number, gf?: number, gm?: number, flags?: string[] }} meta
 */
export function applyMetadataCorrections(raw, meta = {}) {
  const name = raw?.name || '';
  const equipment = raw?.equipment || '';
  const traits = inferExerciseTraits(name, equipment);
  let diff = meta.diff ?? 2;
  let gf = meta.gf ?? 70;
  let gm = meta.gm ?? 70;
  const flags = new Set(meta.flags || []);

  if (!traits.trueBodyweight && normalizeText(equipment) === 'body weight') {
    flags.add('mislabeled_bw');
    flags.add(`needs_${traits.effectiveEquipNorm.replace(/\s+/g, '_')}`);
  }
  if (traits.trueBodyweight) flags.add('true_bodyweight');

  if (traits.gymnastics || traits.rings) {
    diff = Math.max(diff, 3);
    gf = Math.min(gf, 55);
    flags.add('gymnastics');
    flags.add('rings');
    flags.add('advanced');
  }
  if (traits.suspended) {
    diff = Math.max(diff, 2);
    flags.add('suspension');
  }
  if (traits.parallelBars && !traits.assisted) {
    diff = Math.max(diff, 2);
    flags.add('parallel_bars');
  }
  if (traits.pullBar && !traits.assisted && !traits.stretch) {
    diff = Math.max(diff, 2);
    flags.add('pull_bar');
  }
  if (traits.highSkill && !traits.stretch) {
    diff = Math.max(diff, 3);
    flags.add('advanced');
  }
  if (/burpee|mountain climber|box jump|jump squat|plyo/i.test(normalizeText(name))) {
    diff = Math.max(diff, 2);
    flags.add('cardio');
  }
  if (traits.beginnerSafe) flags.add('beginner_safe');
  if (traits.homeFriendly) flags.add('home_friendly');

  if (traits.stretch && diff > 1 && !traits.highSkill) diff = 1;

  return {
    diff,
    gf,
    gm,
    flags: [...flags],
    gear: traits.gear,
    effectiveEquipNorm: traits.effectiveEquipNorm,
    traits,
  };
}

function expandEquipmentAnswers(equipmentAnswers) {
  const items = [];
  for (const a of equipmentAnswers || []) {
    if (!a || a === 'Друго') continue;
    items.push(a);
  }
  return items;
}

/**
 * Позволен gear от въпросника. null = пълна зала.
 * @param {string[]} equipmentAnswers
 * @param {string[]} [pickedItems]
 * @returns {Set<string>|null}
 */
export function resolveAllowedGear(equipmentAnswers = [], pickedItems = []) {
  const gymKey = normalizeText(GYM_EQUIPMENT_OPTION);
  const pickerKey = normalizeText(EQUIPMENT_PICKER_OPTION);
  const gear = new Set(BODYWEIGHT_GEAR);

  if (pickedItems?.length) {
    const { equipHints } = expandApparatusIds(pickedItems);
    for (const h of equipHints) {
      if (h.includes('machine') || h.includes('lever') || h.includes('smith') || h === 'sled machine') gear.add(GEAR_MACHINE);
      if (h === 'cable') gear.add(GEAR_CABLE);
      if (/elliptical|bike|ergometer|stepmill|skierg/i.test(h)) gear.add(GEAR_CARDIO_MACHINE);
    }
  }

  const items = expandEquipmentAnswers(equipmentAnswers);
  for (const answer of items) {
    const key = normalizeText(answer);
    if (key === pickerKey) continue;
    if (key === gymKey || key.includes('зала') || key.includes('gym')) return null;

    const fromGroup = GROUP_GEAR.get(answer) || GROUP_GEAR_NORM.get(key);
    if (fromGroup) {
      for (const g of fromGroup) gear.add(g);
      continue;
    }

    for (const g of gearFromFreeText(answer)) gear.add(g);
  }

  return gear;
}

/** @param {object} entry @param {Set<string>|null} allowedGear */
export function passesGearFilter(entry, allowedGear) {
  if (!allowedGear) return true;
  const required = entry?.gear?.length ? entry.gear : inferRequiredGear(entry?.name, entry?.equipment || entry?.equipNorm);
  return required.every((g) => allowedGear.has(g));
}

/** @param {object} entry @param {{ maxDiff?: number }} profile */
export function passesBeginnerSafety(entry, profile) {
  if (!profile || profile.maxDiff > 1) return true;
  const traits = entry?.traits || inferExerciseTraits(entry?.name, entry?.equipment || entry?.equipNorm);
  if (traits.gymnastics || traits.rings || traits.suspended || traits.parallelBars) return false;
  if (traits.highSkill && !traits.stretch) return false;
  if (traits.pullBar && !traits.assisted && !traits.stretch) return false;
  if ((entry?.diff ?? 2) > 1 && !traits.stretch) return false;
  return true;
}
