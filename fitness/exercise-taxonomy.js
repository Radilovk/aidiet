/**
 * Таксономия за EFP — всеки target и equipment имат базови gf/gm/diff.
 * Източник: S&C практика + open-source level полета (yuhonas, harshvishu).
 */
import { normalizeText } from './normalize.js';

/** @typedef {{ gf: number, gm: number }} GenderBias */

/** Базов bias по primary target (покрива всички 18 target-а в dataset-а). */
export const TARGET_BIAS = {
  glutes: { gf: 94, gm: 58 },
  abductors: { gf: 93, gm: 55 },
  adductors: { gf: 88, gm: 60 },
  hamstrings: { gf: 82, gm: 72 },
  quads: { gf: 68, gm: 82 },
  pectorals: { gf: 42, gm: 90 },
  triceps: { gf: 50, gm: 85 },
  biceps: { gf: 52, gm: 80 },
  delts: { gf: 62, gm: 76 },
  lats: { gf: 55, gm: 88 },
  'upper back': { gf: 58, gm: 86 },
  traps: { gf: 55, gm: 82 },
  abs: { gf: 80, gm: 68 },
  calves: { gf: 70, gm: 72 },
  forearms: { gf: 48, gm: 78 },
  'cardiovascular system': { gf: 72, gm: 75 },
  spine: { gf: 84, gm: 65 },
  'serratus anterior': { gf: 65, gm: 74 },
  'levator scapulae': { gf: 70, gm: 72 },
};

/** Базова трудност по equipment (1=начинаещ, 2=среден, 3=напреднал). */
export const EQUIP_DIFF = {
  assisted: 1,
  'leverage machine': 1,
  'smith machine': 1,
  'sled machine': 2,
  cable: 1,
  band: 1,
  'resistance band': 1,
  dumbbell: 2,
  kettlebell: 2,
  'ez barbell': 2,
  barbell: 2,
  'olympic barbell': 3,
  'trap bar': 3,
  weighted: 2,
  'medicine ball': 2,
  'stability ball': 2,
  'bosu ball': 2,
  rope: 2,
  roller: 1,
  'wheel roller': 2,
  'body weight': 2,
};

/** Име/движение → diff modifier. */
export const DIFF_ADVANCED_RE = /\b(snatch|clean and jerk|muscle[- ]?up|planche|handstand|pistol|dragon flag|front lever|back lever|human flag|kipping|one leg squat|plyo|depth jump|clapping|archer|iron cross|victorian|skin the cat|explosive)\b/i;
export const DIFF_BEGINNER_RE = /\b(stretch|mobility|yoga|pilates|wall push|chair squat|assisted|seated|lying|machine|lever)\b/i;
export const DIFF_BARbell_COMPOUND_RE = /\b(squat|deadlift|bench press|overhead press|military press|good morning|hip thrust|thruster|clean|snatch|push press|jerk|row from floor|pendlay)\b/i;
export const DIFF_BARbell_ISOLATION_RE = /\b(curl|shrug|wrist curl|front raise|lateral raise|fly|kickback|extension)\b/i;

/** Име → допълнителен gender bias (над target). */
export const NAME_FEMALE_RE = /\b(hip thrust|glute|abduct|adduct|kickback|clam|frog|fire hydrant|bridge|donkey|cable pull through|pull through)\b/i;
export const NAME_MALE_RE = /\b(bench press|skull crush|military press|close[\s-]?grip\s+(bench|barbell|press)|upright row|pendlay|deadlift|pull[- ]?up|chin[- ]?up)\b/i;

export function clampDiff(n) {
  const v = Number(n);
  return v >= 1 && v <= 3 ? v : 2;
}

export function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 70;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function targetBias(target = '') {
  const key = normalizeText(target);
  return TARGET_BIAS[key] || { gf: 65, gm: 65 };
}

export function equipmentBaseDiff(equipment = '') {
  const eq = normalizeText(equipment);
  return EQUIP_DIFF[eq] ?? 2;
}

/**
 * @param {string} name
 * @param {string} equipment
 * @param {string} target
 */
export function scoreDifficulty(name = '', equipment = '', target = '') {
  const n = normalizeText(name);
  const eq = normalizeText(equipment);
  const blob = `${n} ${eq}`;

  if (DIFF_ADVANCED_RE.test(blob)) return 3;

  let diff = equipmentBaseDiff(equipment);

  if (eq === 'body weight') {
    if (DIFF_BEGINNER_RE.test(blob) || /push[- ]?up|plank|crunch|march|glute bridge|wall sit|lunge|squat/.test(blob)) {
      diff = 1;
    }
  }

  if (/barbell|olympic|trap bar|ez barbell/.test(eq) || /\bbarbell\b/.test(n)) {
    if (DIFF_BARbell_COMPOUND_RE.test(blob)) diff = 3;
    else if (DIFF_BARbell_ISOLATION_RE.test(blob)) diff = 2;
    else diff = Math.max(diff, 2);
  }

  if (/one arm|one-arm|single leg|unilateral/.test(blob)) diff = Math.min(3, diff + 1);
  if (/assisted|stretch|mobility|seated|machine|lever|smith/.test(blob) && !DIFF_ADVANCED_RE.test(blob)) {
    diff = Math.min(diff, 1);
  }
  if (/pull[- ]?up|chin[- ]?up|dip/.test(blob) && !/assisted|machine|band/.test(blob)) {
    diff = Math.max(diff, 2);
  }

  return clampDiff(diff);
}

/**
 * @param {string} name
 * @param {string} target
 * @param {string} [muscleGroup]
 */
export function scoreGenderFit(name = '', target = '', muscleGroup = '') {
  const base = targetBias(target);
  let gf = base.gf;
  let gm = base.gm;
  const n = normalizeText(name);
  const mg = normalizeText(muscleGroup);

  if (NAME_FEMALE_RE.test(n) || /glute|abduct|adduct/.test(mg)) {
    gf = Math.max(gf, 92);
    gm = Math.min(gm, 62);
  }
  if (NAME_MALE_RE.test(n) && !/push[- ]?up/.test(n)) {
    gm = Math.max(gm, 88);
    gf = Math.min(gf, 45);
  }
  if (/bench press|incline bench|decline bench/.test(n)) {
    gm = Math.max(gm, 90);
    gf = Math.min(gf, 42);
  }
  if (/pectorals/.test(normalizeText(target)) && /press|fly|push|dip/.test(n)) {
    gm = Math.max(gm, 82);
    gf = Math.min(gf, 50);
  }

  return { gf: clampScore(gf), gm: clampScore(gm) };
}
