/**
 * Exercise Fitness Profile (EFP) — трудност (1–3) + gender fit (0–100).
 * Production: KV `exercise:metadata:v1` + индекс `exidx:v2`.
 */
import { normalizeText, tokenize, tokenOverlapScore } from './normalize.js';
import { expandSearchTokens } from './exercise-synonyms.js';
import { localizeEquipment, localizeTarget } from './exercise-labels-bg.js';
import { equipmentGroupIdForEntry, EQUIPMENT_GROUPS, buildVirtualEquipmentFacets } from './equipment-groups.js';
import { passesApparatusFilter } from './equipment-apparatus.js';
import {
  applyMetadataCorrections,
  inferExerciseTraits,
  inferRequiredGear,
  passesBeginnerSafety,
  passesGearFilter,
} from './exercise-tags.js';
import { isGenderSpecificExerciseName } from './exercise-name-bg.js';

/** @typedef {{ gender?: string, experience?: string }} AnswersInput */
/** @typedef {{ isFemale: boolean, isMale: boolean, maxDiff: number, minGf: number, minGm: number }} ExerciseProfileFilter */
/** @typedef {{ answers?: AnswersInput, tags?: Iterable<string>|Set<string>|null, profileText?: string }} ExerciseProfileContextInput */

export const EXERCISE_METADATA_KV_KEY = 'exercise:metadata:v1';

/** Евристичен bootstrap преди/без AI класификация. */
export function heuristicClassification(raw) {
  const name = normalizeText(raw?.name || '');
  const equip = normalizeText(raw?.equipment || '');
  const blob = `${name} ${equip}`;
  const traits = inferExerciseTraits(raw?.name || '', raw?.equipment || '');
  let diff = 2;
  let gf = 70;
  let gm = 70;
  const flags = [];

  if (traits.stretch) {
    diff = 1;
    flags.push('bodyweight');
  } else if (traits.gymnastics || traits.rings) {
    diff = 3;
    flags.push('gymnastics', 'advanced');
  } else if (traits.suspended || traits.parallelBars) {
    diff = 2;
  } else if (traits.pullBar && !traits.assisted) {
    diff = 2;
  } else if (/snatch|clean and jerk|pistol squat|dragon flag|handstand|kipping|muscle up/.test(blob)) {
    diff = 3;
    flags.push('advanced');
  } else if (/machine|lever|cable|band|smith|assisted|seated|lying/.test(blob) && !traits.highSkill) {
    diff = 1;
    if (/machine|lever|smith/.test(blob)) flags.push('machine');
  } else if (/barbell|olympic|kettlebell swing|deadlift|good morning/.test(blob)) {
    diff = 3;
    flags.push('barbell');
  } else if (/body weight|bodyweight/.test(equip) && /squat|lunge|bridge|plank|push-up|push up|wall|march|stretch/.test(blob)) {
    diff = 1;
    flags.push('bodyweight');
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
  if (/compound|press|squat|deadlift|lunge|thrust|row|pull|push/.test(blob)) flags.push('compound');
  if (/curl|extension|fly|kickback|raise|crunch|stretch/.test(blob) && !flags.includes('compound')) flags.push('isolation');
  if (traits.beginnerSafe) flags.push('beginner_safe');
  if (traits.homeFriendly) flags.push('home_friendly');

  return applyMetadataCorrections(raw, { diff, gf, gm, flags: [...new Set(flags)] });
}

export function metadataForExercise(raw, store = {}) {
  const id = String(raw?.id ?? '');
  const saved = store[id];
  const base = saved?.diff
    ? {
      diff: saved.diff,
      gf: saved.gf ?? 70,
      gm: saved.gm ?? 70,
      flags: saved.flags || [],
      ...(saved.gear?.length ? { gear: saved.gear } : {}),
      ...(saved.effectiveEquipNorm ? { effectiveEquipNorm: saved.effectiveEquipNorm } : {}),
      ...(saved.excluded ? { excluded: true } : {}),
    }
    : heuristicClassification(raw);
  return applyMetadataCorrections(raw, base);
}

export function mergeExerciseMetadata(entry, raw, metadata = {}) {
  const meta = metadataForExercise(raw, metadata);
  return {
    ...entry,
    diff: meta.diff,
    gf: meta.gf,
    gm: meta.gm,
    effectiveEquipNorm: meta.effectiveEquipNorm || entry.equipNorm || normalizeText(entry.equipment),
    ...(meta.flags?.length ? { flags: meta.flags } : {}),
    ...(meta.gear?.length ? { gear: meta.gear } : {}),
    ...(meta.traits ? { traits: meta.traits } : {}),
    ...(meta.excluded ? { excluded: true } : {}),
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
export function resolveMaxDiff(experience = '', tags = null, profileText = '') {
  const exp = normalizeText(experience || '');
  const tagSet = tags instanceof Set ? tags : new Set(tags || []);
  const blob = normalizeText(profileText || '');

  if (exp.includes('напреднал') || exp.includes('5+')) return 3;
  if (exp.includes('никакъв') || (exp.includes('начинаещ') && !exp.includes('средно'))) return 1;
  if (exp.includes('среден')) return 2;

  if (tagSet.has('level:напреднал')) return 3;
  if (tagSet.has('level:начинаещ')) return 1;
  if (tagSet.has('level:среден')) return 2;

  if (/\bнапреднал\b|\b5\+\s*години/.test(blob)) return 3;
  if ((/\bначинаещ\b|\bникакъв\b|0\s*6\s*мес/.test(blob)) && !/средно\s+начинаещ/.test(blob)) return 1;
  if (/\bсреден\b|средно\s+начинаещ/.test(blob)) return 2;

  return 2;
}

function applyMaxDiffToProfile(profile, maxDiff) {
  const out = { ...profile, maxDiff };
  if (maxDiff === 1 && profile.isFemale) out.minGf = Math.max(out.minGf, 65);
  if (maxDiff === 1 && profile.isMale) out.minGm = Math.max(out.minGm, 50);
  if (maxDiff === 3) { out.minGf = 30; out.minGm = 30; }
  return out;
}

export function exerciseProfileFromAnswers(answers = /** @type {AnswersInput} */ ({})) {
  const gender = normalizeText(answers.gender || '');
  const isFemale = gender.includes('жена');
  const isMale = gender.includes('мъж');

  let minGf = isFemale ? 50 : 35;
  let minGm = isMale ? 50 : 35;
  const maxDiff = resolveMaxDiff(answers.experience);

  return applyMaxDiffToProfile({ isFemale, isMale, maxDiff, minGf, minGm }, maxDiff);
}

/** Профил от answers + тагове/бриф (админ път без пълен въпросник). */
export function exerciseProfileFromContext(ctx = /** @type {ExerciseProfileContextInput} */ ({})) {
  const { answers = {}, tags = null, profileText = '' } = ctx;
  const base = exerciseProfileFromAnswers(answers);
  const tagSet = tags instanceof Set ? tags : new Set(tags || []);

  if (!answers.gender && tagSet.has('gender:жена')) {
    base.isFemale = true;
    base.isMale = false;
    base.minGf = 50;
    base.minGm = 35;
  }
  if (!answers.gender && tagSet.has('gender:мъж')) {
    base.isMale = true;
    base.isFemale = false;
    base.minGm = 50;
    base.minGf = 35;
  }

  const maxDiff = resolveMaxDiff(answers.experience, tagSet, profileText);
  return applyMaxDiffToProfile(base, maxDiff);
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

/** Алтернативи за замяна в UI — само СТ, дъмбели, гири. */
export const SWAP_EQUIPMENT = new Set(['body weight', 'dumbbell', 'kettlebell']);

/** По-нисък ранг = по-просто/предпочитано оборудване (СТ → щанга). */
export function equipmentSimplicityRank(equipNorm) {
  const eq = normalizeText(equipNorm || '');
  if (!eq) return 5;
  const table = {
    'body weight': 0,
    dumbbell: 1,
    kettlebell: 2,
    band: 3,
    'resistance band': 3,
    'medicine ball': 4,
    assisted: 4,
    'stability ball': 4,
    cable: 5,
    rope: 5,
    machine: 6,
    'leverage machine': 6,
    'smith machine': 7,
    barbell: 8,
    'ez barbell': 8,
    'olympic barbell': 8,
  };
  if (table[eq] !== undefined) return table[eq];
  if (eq.includes('body weight')) return 0;
  if (eq.includes('dumbbell')) return 1;
  if (eq.includes('kettlebell')) return 2;
  if (eq.includes('band')) return 3;
  if (eq.includes('cable')) return 5;
  if (eq.includes('machine') || eq.includes('lever')) return 6;
  if (eq.includes('barbell')) return 8;
  return 5;
}

/** По-висок = по-естествено/лесно движение при равни кандидати. */
export function naturalMovementScore(entry) {
  const flags = entry?.flags || [];
  let score = 0;
  if (flags.includes('bodyweight')) score += 3;
  if (flags.includes('compound')) score += 2;
  if (flags.includes('isolation')) score -= 1;
  if (flags.includes('machine')) score -= 2;
  score += Math.max(0, 8 - equipmentSimplicityRank(entry?.equipNorm || entry?.equipment));
  return score;
}

/**
 * Сравнява два кандидата: по-лесно (d↓), по-малко оборудване, по-естествено движение.
 * Връща <0 ако a е по-предпочитан.
 */
export function compareExercisePreference(a, b, profile = null) {
  const diffA = a?.diff ?? 2;
  const diffB = b?.diff ?? 2;
  if (diffA !== diffB) return diffA - diffB;

  const eqA = equipmentSimplicityRank(a?.equipNorm || a?.equipment);
  const eqB = equipmentSimplicityRank(b?.equipNorm || b?.equipment);
  if (eqA !== eqB) return eqA - eqB;

  const natA = naturalMovementScore(a);
  const natB = naturalMovementScore(b);
  if (natA !== natB) return natB - natA;

  if (profile?.isFemale) {
    const gfA = a?.gf ?? 70;
    const gfB = b?.gf ?? 70;
    if (gfA !== gfB) return gfB - gfA;
  } else if (profile?.isMale) {
    const gmA = a?.gm ?? 70;
    const gmB = b?.gm ?? 70;
    if (gmA !== gmB) return gmB - gmA;
  }

  return (a?.name || '').localeCompare(b?.name || '');
}

export function pickPreferredExercise(candidates, profile = null) {
  if (!candidates?.length) return null;
  return [...candidates].sort((a, b) => compareExercisePreference(a, b, profile))[0];
}

/** Машинно/силово оборудване — алтернативи от него са на последно място. */
export function isMachineEquipment(equipNorm) {
  const eq = normalizeText(equipNorm || '');
  return eq.includes('machine') || eq.includes('lever') || eq.includes('smith');
}

/**
 * Функционално семейство за алтернативи — същ тип движение и мускулна цел.
 * knee_dominant: клек, напад, leg press; horizontal_push: bench, push-up, chest press.
 */
export function exerciseAlternativeFamily(entry) {
  const name = normalizeText(entry?.name || '');
  const target = entry?.targetNorm || '';
  const body = entry?.bodyNorm || '';

  if (/stretch|mobility|yoga|pilates|foam|pigeon|child pose|cat cow/.test(name)) return 'mobility';
  if (/\b(jump rope|burpee|mountain climber|high knees|battle rope|sprint|jog|run|walk)\b/.test(name)) return 'cardio';

  if (/\b(leg press|hack squat)\b/.test(name)) return 'knee_dominant';
  if (/\b(squat|lunge|split squat|step.?up|curtsy|wall sit|goblet squat|sissy squat)\b/.test(name)
    && !/deadlift|pullover|bench squat/i.test(name)) return 'knee_dominant';
  if (/\b(deadlift|rdl|romanian|hip thrust|glute bridge|pull.?through|good morning|hyperextension|back extension|kettlebell swing)\b/.test(name)) {
    return 'hip_hinge';
  }
  if (/\b(calf raise|calf press|seated calf|donkey calf)\b/.test(name)) return 'iso_calves';
  if (/\b(adduct|abduct)\b/.test(name) || target === 'adductors' || target === 'abductors') return 'iso_hips';

  if (/\b(bench press|push-up|push up|chest press|pec deck)\b/.test(name) && !/triceps|tricep/i.test(name)) return 'horizontal_push';
  if (/\b(fly|flye)\b/.test(name) && (body === 'chest' || /pec/.test(target))) return 'horizontal_push';
  if (/\b(dip)\b/.test(name) && (body === 'chest' || /pec/.test(target))) return 'horizontal_push';
  if (/\b(overhead press|shoulder press|military press|arnold press|push press)\b/.test(name)) return 'vertical_push';

  if (/\b(pulldown|pull-up|pull up|chin-up|chin up)\b/.test(name)) return 'vertical_pull';
  if (/\b(row|rowing)\b/.test(name) && !/upright/i.test(name)) return 'horizontal_pull';

  if (/\b(curl|preacher curl|hammer curl)\b/.test(name)) return 'iso_biceps';
  if (/\b(tricep|triceps|pushdown|skull)\b/.test(name) || (/\bkickback\b/.test(name) && /tricep/.test(target))) return 'iso_triceps';
  if (/\b(lateral raise|front raise|rear delt|reverse fly)\b/.test(name)) return 'iso_shoulder';

  if (/\b(crunch|sit-up|sit up|plank|leg raise|dead bug|russian twist|rollout|hollow)\b/.test(name)
    || target === 'abs' || body === 'waist') return 'core';

  const flags = entry?.flags || [];
  const kind = flags.includes('isolation') ? 'iso' : 'compound';
  return `${kind}:${target || body || 'other'}`;
}

/**
 * Колко „далече“ е кандидатът от оригиналното упражнение.
 * По-нисък резултат = по-близка алтернатива (същ мускул, тип, движение).
 */
export function alternativeClosenessScore(candidate, matchedEntry) {
  if (!candidate || !matchedEntry) return 999;
  let score = 0;

  const eqM = normalizeText(matchedEntry.equipNorm || matchedEntry.equipment);
  const eqC = normalizeText(candidate.equipNorm || candidate.equipment);
  if (eqM && eqC) {
    if (eqM === eqC) score -= 12;
    else score += 8;
  }

  if (isMachineEquipment(eqC)) {
    score += 30;
    if (!isMachineEquipment(eqM)) score += 40;
  }

  if (matchedEntry.bodyNorm && candidate.bodyNorm) {
    if (candidate.bodyNorm === matchedEntry.bodyNorm) score -= 4;
    else score += 6;
  }

  if (exerciseAlternativeFamily(matchedEntry) === exerciseAlternativeFamily(candidate)) score -= 8;

  const fam = exerciseAlternativeFamily(candidate);
  const baseFam = exerciseAlternativeFamily(matchedEntry);
  const candName = normalizeText(candidate.name || '');
  const baseName = normalizeText(matchedEntry.name || '');
  if (fam === baseFam) {
    if (fam === 'knee_dominant') {
      if (/\b(lunge|split squat|leg press|step.?up|goblet squat)\b/.test(candName)) score -= 14;
      if (/\b(jump|plyo|drop)\b/.test(candName) && !/\b(jump|plyo|drop)\b/.test(baseName)) score += 12;
    }
    if (fam === 'horizontal_push') {
      if (/\b(push-up|push up|dumbbell bench|chest press)\b/.test(candName)) score -= 14;
      if (/\b(archer|clap|depth jump|planche)\b/.test(candName)) score += 12;
    }
  }

  const overlap = tokenOverlapScore(matchedEntry.tokens, candidate.tokens);
  score -= Math.round(overlap * 20);

  return score;
}

/** Сравнява алтернативи по близост до оригинала; при равенство — compareExercisePreference. */
export function compareAlternativeCloseness(a, b, matchedEntry, profile = null) {
  const scoreA = alternativeClosenessScore(a, matchedEntry);
  const scoreB = alternativeClosenessScore(b, matchedEntry);
  if (scoreA !== scoreB) return scoreA - scoreB;
  return compareExercisePreference(a, b, profile);
}

/** Алтернатива е валидна при също движение/мускул, модалност и близка трудност. */
export function isSameAlternativeFamily(matchedEntry, candidate, sessionType = null) {
  if (!matchedEntry || !candidate) return false;
  const matchedMod = inferExerciseModality(matchedEntry);
  const candMod = inferExerciseModality(candidate);
  if (matchedMod !== candMod) return false;
  if (sessionType && !modalityMatchesDay(sessionType, candMod)) return false;
  if (exerciseAlternativeFamily(matchedEntry) !== exerciseAlternativeFamily(candidate)) return false;
  const matchedDiff = matchedEntry.diff ?? 2;
  const candDiff = candidate.diff ?? 2;
  if (Math.abs(candDiff - matchedDiff) > 1) return false;
  return true;
}

const MOBILITY_RE = /stretch|yoga|mobility|pilates|flexibility|foam|pigeon|child pose|cat cow|downward|spinal twist/i;
const HIIT_RE = /\b(hiit|tabata|sprint interval|mountain climber|battle rope)\b/i;
/** Явно кардио/аеробика — преди общите силови шаблони (напр. rowing machine). */
const CARDIO_EXPLICIT_RE = /\b(rowing machine|assault bike|air bike|stationary bike|recumbent bike|exercise bike|treadmill|elliptic|stairmaster|stepper|jump rope|jumping jack|burpee|high knees|ski erg|cross trainer)\b/i;
const CARDIO_RE = /\b(run(?:ning)?|jog(?:ging)?|walk(?:ing)?|cardio)\b/i;
const STRENGTH_RE = /\b(press|squat|deadlift|curl|pull[- ]?up|lunge|thrust|extension|raise|fly|kickback|crunch|sit[- ]?up|plank|bench|pulldown|pull down|hip thrust|glute bridge)\b/i;
const STRENGTH_ROW_RE = /\b(row|rowing)\b/i;

/** Модалност на упражнение (от индекс или име). */
export function inferExerciseModality(entryOrName) {
  const entry = typeof entryOrName === 'object' ? entryOrName : null;
  const name = typeof entryOrName === 'string'
    ? entryOrName
    : `${entryOrName?.name || ''}`;
  const flags = entry?.flags || [];
  const n = normalizeText(name);
  const equip = normalizeText(entry?.equipment || '');

  if (MOBILITY_RE.test(n)) return 'mobility';
  if (HIIT_RE.test(n)) return 'hiit';
  // Силови комбинации (напр. walking lunge) преди кардио ключови думи.
  if (/\blunge\b/.test(n)) return 'strength';
  if (STRENGTH_RE.test(n)) return 'strength';
  if (equip.includes('cardio') || CARDIO_EXPLICIT_RE.test(n)) return 'cardio';
  if (STRENGTH_ROW_RE.test(n) && !/\b(machine|erg)\b/.test(n)) return 'strength';
  if (CARDIO_RE.test(n)) return 'cardio';
  if (flags.includes('cardio')) return 'cardio';
  if (entry?.diff === 1 && /stretch|mobil/.test(n)) return 'mobility';
  return 'strength';
}

export function modalityMatchesDay(sessionType, exerciseMod) {
  const day = normalizeText(sessionType);
  const ex = exerciseMod;
  if (day === 'rest') return true;
  if (day === 'mobility') return ex === 'mobility';
  if (day === 'cardio') return ex === 'cardio' || ex === 'mobility';
  if (day === 'hiit') return ex === 'hiit' || ex === 'cardio' || ex === 'strength';
  return ex === 'strength';
}

export function passesModality(entry, modalities = null) {
  if (!modalities?.length) return true;
  const mod = inferExerciseModality(entry);
  return modalities.some((m) => modalityMatchesDay(m, mod));
}

export function passesEquipment(entry, allowedEquipment) {
  if (!allowedEquipment) return true;
  const eq = entry?.effectiveEquipNorm || entry?.equipNorm || normalizeText(entry?.equipment);
  return allowedEquipment.has(eq);
}

/** Филтрира индекс по профил + оборудване + gear + модалност (EFP diff/gf/gm). */
export function filterExercises(index, profile, allowedEquipment = null, modalities = null, pickedApparatus = null, allowedGear = null) {
  if (!index?.length) return [];
  return index.filter((e) =>
    !e.excluded
    && !(e.flags || []).includes('excluded')
    && fitsExerciseProfile(e, profile)
    && passesBeginnerSafety(e, profile)
    && !isGenderSpecificExerciseName(e.name)
    && passesEquipment(e, allowedEquipment)
    && passesGearFilter(e, allowedGear)
    && passesApparatusFilter(e, pickedApparatus)
    && passesModality(e, modalities)
  );
}

const MODALITY_GROUPS = ['mobility', 'cardio', 'hiit'];
const GROUP_ORDER = ['glutes', 'quads', 'hamstrings', 'back', 'chest', 'shoulders', 'arms', 'core', ...MODALITY_GROUPS, 'other'];

/**
 * Групира упражнението: не-силова модалност (mobility/cardio/hiit) взима
 * приоритет пред мускулната група, за да не бъде изместена от нея при
 * ограничен бюджет — иначе clean/stretch упражнения потъват в „quads“/„back“
 * зад силовите варианти и никога не се показват на AI-я.
 */
function groupKey(entry) {
  const modality = inferExerciseModality(entry);
  if (MODALITY_GROUPS.includes(modality)) return modality;
  const t = entry.targetNorm || entry.bodyNorm || '';
  if (/glute/.test(t)) return 'glutes';
  if (/quad/.test(t)) return 'quads';
  if (/hamstring/.test(t)) return 'hamstrings';
  if (/lat|back|trap/.test(t)) return 'back';
  if (/chest|pec/.test(t)) return 'chest';
  if (/shoulder|delt/.test(t)) return 'shoulders';
  if (/bicep|tricep|forearm|arm/.test(t)) return 'arms';
  if (/ab|oblique|core|waist/.test(t)) return 'core';
  return 'other';
}

/**
 * Компактен каталог за AI prompt (~2KB).
 * canonicalName = entry.name (EN от dataset).
 * opts.modalities — активните dayFocus типове в седмицата (от ProgramSpec);
 * филтрира и подрежда каталога така, че mobility/cardio/hiit дните да имат
 * реални, релевантни упражнения вместо силови машини по подразбиране.
 */
export function buildExerciseCatalogSnippet(index, profile, allowedEquipment = null, opts = {}) {
  const maxTotal = opts.maxTotal ?? 120;
  const maxPerGroup = opts.maxPerGroup ?? 14;
  const modalities = opts.modalities || null;
  const pickedApparatus = opts.pickedApparatus || null;
  const allowedGear = opts.allowedGear ?? null;
  const filtered = filterExercises(index, profile, allowedEquipment, modalities, pickedApparatus, allowedGear);
  if (!filtered.length) return '';

  const groups = new Map();
  for (const entry of filtered) {
    const g = groupKey(entry);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(entry);
  }

  for (const items of groups.values()) {
    items.sort((a, b) => {
      const pref = compareExercisePreference(a, b, profile);
      if (pref !== 0) return pref;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  // Активните не-силови модалности (mobility/cardio/hiit) излизат първи, за
  // да не бъдат изтласкани от бюджета, преди редовните мускулни групи.
  const priorityGroups = (modalities || []).filter((m) => MODALITY_GROUPS.includes(m));
  const orderedGroups = [...new Set([...priorityGroups, ...GROUP_ORDER])];

  const maxDiff = profile?.maxDiff;
  const lines = ['<exercise_catalog>', `canonicalName САМО отдолу${maxDiff ? `; d≤${maxDiff}` : ''} (d=1 лесно|2 средно|3 трудно, gf=жена):`];
  let total = 0;

  for (const g of orderedGroups) {
    const remaining = maxTotal - total;
    if (remaining <= 0) break;
    const items = groups.get(g);
    if (!items?.length) continue;
    const slice = items.slice(0, Math.min(maxPerGroup, remaining));
    const part = slice.map((e) => {
      const flags = (e.flags || []).slice(0, 4).join(',') || '-';
      const gf = e.gf ?? 70;
      const gear = (e.gear || inferRequiredGear(e.name, e.equipment || e.equipNorm)).slice(0, 3).join('+') || 'floor';
      return `${e.name}|d${e.diff ?? 2}|gf${gf}|${gear}|${flags}`;
    }).join(', ');
    lines.push(`${g}: ${part}`);
    total += slice.length;
  }

  lines.push('</exercise_catalog>');
  return lines.join('\n');
}

// ============================================================================
// Админ търсене/филтър (program editor) — по дума+синоними и всички EFP полета.
// ============================================================================

const searchTokenCache = new WeakMap();

/** EN име + BG превод + BG етикети на target/equipment — за търсене по дума. */
function searchTokensForEntry(entry) {
  const cached = searchTokenCache.get(entry);
  if (cached) return cached;
  const tokens = new Set(entry.tokens?.length ? entry.tokens : tokenize(entry.name));
  for (const t of tokenize(entry.nameBg)) tokens.add(t);
  for (const t of tokenize(localizeTarget(entry.target))) tokens.add(t);
  for (const t of tokenize(localizeEquipment(entry.equipment))) tokens.add(t);
  const arr = [...tokens];
  searchTokenCache.set(entry, arr);
  return arr;
}

/**
 * Търсене/филтър в индекса по всички EFP параметри — за админ picker.
 * @param {object[]} index
 * @param {{
 *   q?: string, equipment?: string[], target?: string[], modality?: string[],
 *   diffMin?: number|null, diffMax?: number|null, minGf?: number|null, minGm?: number|null,
 *   limit?: number, offset?: number,
 * }} options
 */
export function searchExerciseIndex(index, options = {}) {
  const {
    q = '', equipment = null, target = null, modality = null,
    diffMin = null, diffMax = null, minGf = null, minGm = null,
    limit = 40, offset = 0,
  } = options;

  const queryTokens = expandSearchTokens(q);
  const equipSet = equipment?.length ? new Set(equipment.map(normalizeText)) : null;
  const targetSet = target?.length ? new Set(target.map(normalizeText)) : null;
  const modalitySet = modality?.length ? new Set(modality) : null;

  const scored = [];
  for (const entry of index || []) {
    if (equipSet && !equipSet.has(entry.equipNorm)) continue;
    if (targetSet && !targetSet.has(entry.targetNorm) && !targetSet.has(entry.bodyNorm)) continue;
    const diff = entry.diff ?? 2;
    if (diffMin != null && diff < diffMin) continue;
    if (diffMax != null && diff > diffMax) continue;
    if (minGf != null && (entry.gf ?? 70) < minGf) continue;
    if (minGm != null && (entry.gm ?? 70) < minGm) continue;
    if (modalitySet && !modalitySet.has(inferExerciseModality(entry))) continue;

    let score = 1;
    if (queryTokens.length) {
      score = tokenOverlapScore(queryTokens, searchTokensForEntry(entry));
      if (score <= 0) continue;
    }
    scored.push({ entry, score });
  }

  scored.sort((a, b) =>
    b.score - a.score
    || (a.entry.diff ?? 2) - (b.entry.diff ?? 2)
    || (a.entry.name || '').localeCompare(b.entry.name || ''));

  return {
    total: scored.length,
    results: scored.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit)),
  };
}

/** Facets (групирано оборудване + target) за admin picker. */
export function computeExerciseFacets(index) {
  const equipment = new Map();
  const target = new Map();
  const countsByGroupId = {};
  const groupOrder = new Map(EQUIPMENT_GROUPS.map((g, i) => [g.id, i]));
  for (const entry of index || []) {
    const groupId = equipmentGroupIdForEntry(entry);
    if (groupId) {
      countsByGroupId[groupId] = (countsByGroupId[groupId] || 0) + 1;
      if (!equipment.has(groupId)) {
        const group = EQUIPMENT_GROUPS.find((g) => g.id === groupId);
        equipment.set(groupId, {
          value: groupId,
          label: group?.label || localizeEquipment(entry.equipment) || entry.equipment,
          count: 0,
        });
      }
      equipment.get(groupId).count++;
    }
    if (entry.targetNorm) {
      if (!target.has(entry.targetNorm)) {
        target.set(entry.targetNorm, { value: entry.targetNorm, label: localizeTarget(entry.target) || entry.target, count: 0 });
      }
      target.get(entry.targetNorm).count++;
    }
  }
  const byCount = (a, b) => b.count - a.count;
  const sortEquipment = (a, b) => {
    if (a.value === 'equipment_rig') return -1;
    if (b.value === 'equipment_rig') return 1;
    const oa = groupOrder.has(a.value) ? groupOrder.get(a.value) : 999;
    const ob = groupOrder.has(b.value) ? groupOrder.get(b.value) : 999;
    if (oa !== ob) return oa - ob;
    return byCount(a, b);
  };
  const equipmentFacets = [...equipment.values()].sort(sortEquipment);
  for (const virtual of buildVirtualEquipmentFacets(countsByGroupId)) {
    equipmentFacets.unshift(virtual);
  }
  return {
    equipment: equipmentFacets,
    target: [...target.values()].sort(byCount),
  };
}
