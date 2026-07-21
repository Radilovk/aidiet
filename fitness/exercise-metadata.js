/**
 * Exercise Fitness Profile (EFP) — трудност (1–3) + gender fit (0–100).
 * Production: KV `exercise:metadata:v1` + индекс `exidx:v1`.
 */
import { normalizeText } from './normalize.js';

export const EXERCISE_METADATA_KV_KEY = 'exercise:metadata:v1';

/** Евристичен bootstrap преди/без AI класификация. */
export function heuristicClassification(raw) {
  const name = normalizeText(raw?.name || '');
  const equip = normalizeText(raw?.equipment || '');
  const blob = `${name} ${equip}`;
  let diff = 2;
  let gf = 70;
  let gm = 70;
  const flags = [];

  if (/snatch|clean and jerk|muscle up|pistol squat|dragon flag|handstand|kipping/.test(blob)) {
    diff = 3;
    flags.push('advanced');
  } else if (/machine|lever|cable|band|smith|assisted|seated|lying/.test(blob)) {
    diff = 1;
  } else if (/barbell|olympic|kettlebell swing|deadlift|good morning/.test(blob)) {
    diff = 3;
    flags.push('barbell');
  } else if (/body weight|bodyweight/.test(blob) && !/pull up|chin up|dip|push up/.test(blob)) {
    diff = 1;
  }

  if (/hip thrust|glute|abduct|kickback|clam|frog|fire hydrant|pull through/.test(blob)) {
    gf = 92;
    flags.push('glute');
  }
  if (/bench press|skull crush|close grip|military press|barbell curl|upright row/.test(blob)) {
    gf = 32;
    gm = 88;
    flags.push('press');
  }
  if (/squat|deadlift|row|pull up|chin up/.test(blob)) gm = Math.max(gm, 82);

  return { diff, gf, gm, flags: [...new Set(flags)] };
}

export function metadataForExercise(raw, store = {}) {
  const id = String(raw?.id ?? '');
  const saved = store[id];
  if (saved?.diff) {
    return {
      diff: clampDiff(saved.diff),
      gf: clampScore(saved.gf ?? 70),
      gm: clampScore(saved.gm ?? 70),
      flags: saved.flags || [],
    };
  }
  return heuristicClassification(raw);
}

export function mergeExerciseMetadata(entry, raw, metadata = {}) {
  const meta = metadataForExercise(raw, metadata);
  return {
    ...entry,
    diff: meta.diff,
    gf: meta.gf,
    gm: meta.gm,
    ...(meta.flags?.length ? { flags: meta.flags } : {}),
  };
}

function clampDiff(n) {
  const v = Number(n);
  return v >= 1 && v <= 3 ? v : 2;
}

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 70;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Профил за филтър от answers (въпросник / админ). */
export function exerciseProfileFromAnswers(answers = {}) {
  const gender = normalizeText(answers.gender || '');
  const isFemale = gender.includes('жена');
  const isMale = gender.includes('мъж');
  const exp = normalizeText(answers.experience || '');

  let maxDiff = 2;
  if (exp.includes('напреднал') || exp.includes('5+')) maxDiff = 3;
  else if (exp.includes('никакъв') || (exp.includes('начинаещ') && !exp.includes('средно'))) maxDiff = 1;
  else if (exp.includes('среден')) maxDiff = 2;

  let minGf = isFemale ? 50 : 35;
  let minGm = isMale ? 50 : 35;
  if (maxDiff === 1 && isFemale) minGf = 65;
  if (maxDiff === 1 && isMale) minGm = 50;
  if (maxDiff === 3) { minGf = 30; minGm = 30; }

  return { isFemale, isMale, maxDiff, minGf, minGm };
}

export function fitsExerciseProfile(entry, profile) {
  if (!profile) return true;
  const diff = entry?.diff ?? 2;
  const gf = entry?.gf ?? 70;
  const gm = entry?.gm ?? 70;
  if (diff > profile.maxDiff) return false;
  if (profile.isFemale && gf < profile.minGf) return false;
  if (profile.isMale && gm < profile.minGm) return false;
  return true;
}

function passesEquipment(entry, allowedEquipment) {
  if (!allowedEquipment) return true;
  const eq = entry?.equipNorm || normalizeText(entry?.equipment);
  return allowedEquipment.has(eq) || allowedEquipment.has('body weight');
}

/** Филтрира индекс по профил + оборудване. */
export function filterExercises(index, profile, allowedEquipment = null) {
  if (!index?.length) return [];
  return index.filter((e) => fitsExerciseProfile(e, profile) && passesEquipment(e, allowedEquipment));
}

const GROUP_ORDER = ['glutes', 'quads', 'hamstrings', 'back', 'chest', 'shoulders', 'arms', 'core', 'cardio', 'other'];

function groupKey(entry) {
  const t = entry.targetNorm || entry.bodyNorm || '';
  if (/glute/.test(t)) return 'glutes';
  if (/quad/.test(t)) return 'quads';
  if (/hamstring/.test(t)) return 'hamstrings';
  if (/lat|back|trap/.test(t)) return 'back';
  if (/chest|pec/.test(t)) return 'chest';
  if (/shoulder|delt/.test(t)) return 'shoulders';
  if (/bicep|tricep|forearm|arm/.test(t)) return 'arms';
  if (/ab|oblique|core|waist/.test(t)) return 'core';
  if (/cardio/.test(t)) return 'cardio';
  return 'other';
}

/**
 * Компактен каталог за AI prompt (~2KB).
 * canonicalName = entry.name (EN от dataset).
 */
export function buildExerciseCatalogSnippet(index, profile, allowedEquipment = null, opts = {}) {
  const maxTotal = opts.maxTotal ?? 120;
  const maxPerGroup = opts.maxPerGroup ?? 14;
  const filtered = filterExercises(index, profile, allowedEquipment);
  if (!filtered.length) return '';

  const groups = new Map();
  for (const entry of filtered) {
    const g = groupKey(entry);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(entry);
  }

  const lines = ['<exercise_catalog>', 'canonicalName САМО от списъка (d=трудност 1–3):'];
  let total = 0;

  for (const g of GROUP_ORDER) {
    const items = groups.get(g);
    if (!items?.length) continue;
    const slice = items.slice(0, maxPerGroup);
    const part = slice.map((e) => `${e.name}|d${e.diff ?? 2}`).join(', ');
    lines.push(`${g}: ${part}`);
    total += slice.length;
    if (total >= maxTotal) break;
  }

  lines.push('</exercise_catalog>');
  return lines.join('\n');
}
