/**
 * EFP класификация — външен референтен слой + правила по target/equipment/движение.
 *
 * Референции (open source, MIT/public domain):
 * - yuhonas/free-exercise-db — level: beginner | intermediate | expert
 * - harshvishu/free-exercise-db-with-videos — difficulty: beginner | intermediate | advanced
 *
 * gf/gm = подходящост за женски/мъжки план (не „мъжко/женско упражнение“).
 */
import { normalizeText } from './normalize.js';
import { inferExerciseTraits } from './exercise-tags.js';
import bundledRef from './data/exercise-difficulty-ref.json' with { type: 'json' };

const LEVEL_TO_DIFF = {
  beginner: 1,
  intermediate: 2,
  expert: 3,
  advanced: 3,
};

/** @typedef {{ diff: number, gf: number, gm: number, flags: string[], classifySource?: string }} ClassificationResult */

const ADVANCED_RE = /\b(snatch|clean and jerk|muscle[- ]?up|planche|handstand|pistol squat|dragon flag|front lever|back lever|human flag|kipping|one leg squat|plyo push|depth jump|clapping push|archer push|iron cross|victorian|skin the cat)\b/i;
const BARbell_COMPOUND_RE = /\b(squat|deadlift|bench press|overhead press|military press|good morning|hip thrust|thruster|clean|snatch|push press|jerk)\b/i;
const BARbell_ISOLATION_RE = /\b(curl|shrug|wrist curl|front raise|lateral raise|upright row|iron cross)\b/i;
const MALE_PRESS_RE = /\b(bench press|skull crush|military press|close[\s-]?grip\s+(bench|barbell|press|pulldown))\b/i;
const FEMALE_GLUTE_RE = /\b(hip thrust|glute|abduct|adduct|kickback|clam|frog|fire hydrant|pull through|hip bridge)\b/i;
const MALE_PULL_RE = /\b(pull[- ]?up|chin[- ]?up|deadlift|barbell row|pendlay row)\b/i;

function clampDiff(n) {
  const v = Number(n);
  return v >= 1 && v <= 3 ? v : 2;
}

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 70;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function exerciseBlob(raw) {
  const name = normalizeText(raw?.name || '');
  const equip = normalizeText(raw?.equipment || '');
  const target = normalizeText(raw?.target || '');
  const muscle = normalizeText(raw?.muscle_group || raw?.muscleGroup || '');
  return { name, equip, target, muscle, blob: `${name} ${equip} ${target} ${muscle}` };
}

/**
 * Трудност от външен референтен слой (build-classification-ref.mjs).
 * @param {string} id
 */
export function referenceDifficulty(id) {
  const row = bundledRef[String(id)];
  if (!row?.level) return null;
  return LEVEL_TO_DIFF[row.level] ?? null;
}

/**
 * Правила за diff — след референция, преди trait corrections.
 * @param {object} raw
 * @param {ReturnType<typeof inferExerciseTraits>} traits
 */
export function ruleBasedDifficulty(raw, traits) {
  const { name, equip, blob } = exerciseBlob(raw);

  if (ADVANCED_RE.test(blob)) return 3;
  if (traits.gymnastics || traits.rings) return 3;
  if (traits.highSkill && !traits.stretch) return 3;

  if (traits.stretch) return 1;

  if (/machine|lever|smith|assisted/.test(blob)) return 1;
  if ((equip === 'cable' || equip === 'band' || equip === 'resistance band') && !traits.highSkill) return 1;
  if (/seated|lying/.test(name) && /machine|cable|lever/.test(blob)) return 1;

  if (traits.pullBar && !traits.assisted && !traits.stretch) return 2;
  if (traits.suspended || traits.parallelBars) return 2;

  if (/barbell|olympic|trap bar/.test(equip) || /\bbarbell\b/.test(name)) {
    if (BARbell_ISOLATION_RE.test(blob) && !BARbell_COMPOUND_RE.test(blob)) return 2;
    if (BARbell_COMPOUND_RE.test(blob)) return 3;
    return 2;
  }

  if (/kettlebell swing|kettlebell snatch/.test(blob)) return 3;

  if (/\b(deadlift|romanian deadlift|rdl)\b/.test(blob) && !/machine|cable|band|assisted/.test(blob)) {
    return /single leg|one leg|one-arm|one arm/.test(blob) ? 3 : 2;
  }

  if (equip === 'dumbbell' || equip === 'kettlebell') {
    if (traits.highSkill || /single leg|one arm|one-arm/.test(blob)) return 3;
    return 2;
  }

  if (equip === 'body weight') {
    if (/push[- ]?up|push up|bodyweight squat|chair squat|glute bridge|plank|crunch|march|wall sit|lunge/.test(blob)
      && !traits.highSkill) return 1;
    return 2;
  }

  return 2;
}

/**
 * gf/gm от target, muscle_group и movement pattern (не само regex по име).
 * @param {object} raw
 */
export function genderFitScores(raw) {
  const { name, target, muscle, blob } = exerciseBlob(raw);
  let gf = 70;
  let gm = 70;
  const flags = [];

  if (FEMALE_GLUTE_RE.test(blob) || /glute|abduct|adduct/.test(target) || /glute|abduct|adduct/.test(muscle)) {
    gf = 92;
    flags.push('glute');
  } else if (/hamstring|inner thigh|outer thigh/.test(blob) || /hamstring/.test(target)) {
    gf = 82;
  } else if (/yoga|pilates|stretch|mobility/.test(blob)) {
    gf = 80;
  }

  if (MALE_PRESS_RE.test(name) && !/push[- ]?up/.test(name)) {
    gf = Math.min(gf, 38);
    gm = Math.max(gm, 90);
    flags.push('press');
  } else if (/bench press|incline bench|decline bench/.test(name)) {
    gm = Math.max(gm, 88);
    gf = Math.min(gf, 45);
    flags.push('press');
  }

  if (MALE_PULL_RE.test(blob) && !/assisted|machine|band|cable/.test(blob)) {
    gm = Math.max(gm, 85);
  }
  if (/\b(squat|lunge|thrust)\b/.test(blob) && !/stretch/.test(blob)) {
    gm = Math.max(gm, 78);
  }

  if (/pectorals|triceps/.test(target) && /press|bench|dip|push/.test(blob)) {
    gm = Math.max(gm, 80);
    if (/barbell/.test(blob)) gf = Math.min(gf, 48);
  }

  if (/biceps|forearm/.test(target) && /curl/.test(blob)) {
    gm = Math.max(gm, 75);
    gf = Math.min(gf, 62);
  }

  return { gf: clampScore(gf), gm: clampScore(gm), flags };
}

function movementFlags(raw, traits) {
  const { blob } = exerciseBlob(raw);
  const flags = [];
  if (/compound|press|squat|deadlift|lunge|thrust|row|pull|push/.test(blob)) flags.push('compound');
  if (/curl|extension|fly|kickback|raise|crunch|stretch/.test(blob) && !flags.includes('compound')) {
    flags.push('isolation');
  }
  if (/barbell|olympic|trap bar/.test(blob)) flags.push('barbell');
  if (/machine|lever|smith/.test(blob)) flags.push('machine');
  if (traits.trueBodyweight) flags.push('bodyweight');
  if (traits.beginnerSafe) flags.push('beginner_safe');
  if (traits.homeFriendly) flags.push('home_friendly');
  return flags;
}

/**
 * Основна класификация за едно упражнение (преди applyMetadataCorrections).
 * @param {object} raw
 * @returns {ClassificationResult}
 */
export function classifyExercise(raw) {
  const traits = inferExerciseTraits(raw?.name || '', raw?.equipment || '');
  const id = String(raw?.id ?? '');
  const refDiff = referenceDifficulty(id);
  const ruleDiff = ruleBasedDifficulty(raw, traits);
  const diff = clampDiff(refDiff ?? ruleDiff);
  const { gf, gm, flags: genderFlags } = genderFitScores(raw);
  const flags = [...new Set([...genderFlags, ...movementFlags(raw, traits)])];

  return {
    diff,
    gf,
    gm,
    flags,
    classifySource: refDiff != null ? (bundledRef[id]?.source || 'ref') : 'rules',
  };
}

export function classificationRefStats() {
  const ids = Object.keys(bundledRef);
  const bySource = {};
  const byLevel = {};
  for (const id of ids) {
    const row = bundledRef[id];
    bySource[row.source] = (bySource[row.source] || 0) + 1;
    byLevel[row.level] = (byLevel[row.level] || 0) + 1;
  }
  return { total: ids.length, bySource, byLevel };
}
