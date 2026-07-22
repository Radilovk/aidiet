/**
 * Exercise Fitness Profile (EFP) — трудност (1–3) + gender fit (0–100).
 * Production: KV `exercise:metadata:v1` + индекс `exidx:v1`.
 */
import { normalizeText, tokenize, tokenOverlapScore } from './normalize.js';
import { expandSearchTokens } from './exercise-synonyms.js';
import { localizeEquipment, localizeTarget } from './exercise-labels-bg.js';

/** @typedef {{ gender?: string, experience?: string }} AnswersInput */
/** @typedef {{ isFemale: boolean, isMale: boolean, maxDiff: number, minGf: number, minGm: number }} ExerciseProfileFilter */
/** @typedef {{ answers?: AnswersInput, tags?: Iterable<string>|Set<string>|null, profileText?: string }} ExerciseProfileContextInput */

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

const MOBILITY_RE = /stretch|yoga|mobility|pilates|flexibility|foam|pigeon|child pose|cat cow|downward|spinal twist/i;
const CARDIO_RE = /run|cycle|elliptic|row machine|jump rope|burpee|jog|cardio|walking|stepper/i;
const HIIT_RE = /hiit|tabata|sprint interval|mountain climber|battle rope/i;
const STRENGTH_RE = /press|squat|deadlift|curl|row|pull up|lunge|thrust|extension|raise|fly|kickback/i;

/** Модалност на упражнение (от индекс или име). */
export function inferExerciseModality(entryOrName) {
  const name = typeof entryOrName === 'string'
    ? entryOrName
    : `${entryOrName?.name || ''} ${(entryOrName?.flags || []).join(' ')}`;
  const n = normalizeText(name);
  if (MOBILITY_RE.test(n)) return 'mobility';
  if (HIIT_RE.test(n)) return 'hiit';
  if (CARDIO_RE.test(n) || normalizeText(entryOrName?.equipment || '').includes('cardio')) return 'cardio';
  if (STRENGTH_RE.test(n)) return 'strength';
  if (typeof entryOrName === 'object' && entryOrName?.diff === 1 && /stretch|mobil/.test(n)) return 'mobility';
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
  const eq = entry?.equipNorm || normalizeText(entry?.equipment);
  return allowedEquipment.has(eq);
}

/** Филтрира индекс по профил + оборудване + модалност (EFP diff/gf/gm). */
export function filterExercises(index, profile, allowedEquipment = null, modalities = null) {
  if (!index?.length) return [];
  return index.filter((e) =>
    fitsExerciseProfile(e, profile)
    && passesEquipment(e, allowedEquipment)
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
  const filtered = filterExercises(index, profile, allowedEquipment, modalities);
  if (!filtered.length) return '';

  const groups = new Map();
  for (const entry of filtered) {
    const g = groupKey(entry);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(entry);
  }

  const isFemale = Boolean(profile?.isFemale);
  const isMale = Boolean(profile?.isMale);
  for (const items of groups.values()) {
    items.sort((a, b) => {
      const diffCmp = (a.diff ?? 2) - (b.diff ?? 2);
      if (diffCmp) return diffCmp;
      // При равна трудност: най-подходящите за пола на клиента първо.
      const relCmp = isFemale
        ? (b.gf ?? 70) - (a.gf ?? 70)
        : isMale
          ? (b.gm ?? 70) - (a.gm ?? 70)
          : 0;
      if (relCmp) return relCmp;
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
      const flags = (e.flags || []).slice(0, 3).join(',') || '-';
      const gf = e.gf ?? 70;
      const gm = e.gm ?? 70;
      return `${e.name}|d${e.diff ?? 2}|gf${gf}|${flags}`;
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

/** Facets (равностойности + брой) за филтър dropdown-ите в admin picker-а. */
export function computeExerciseFacets(index) {
  const equipment = new Map();
  const target = new Map();
  for (const entry of index || []) {
    if (entry.equipNorm) {
      if (!equipment.has(entry.equipNorm)) {
        equipment.set(entry.equipNorm, { value: entry.equipNorm, label: localizeEquipment(entry.equipment) || entry.equipment, count: 0 });
      }
      equipment.get(entry.equipNorm).count++;
    }
    if (entry.targetNorm) {
      if (!target.has(entry.targetNorm)) {
        target.set(entry.targetNorm, { value: entry.targetNorm, label: localizeTarget(entry.target) || entry.target, count: 0 });
      }
      target.get(entry.targetNorm).count++;
    }
  }
  const byCount = (a, b) => b.count - a.count;
  return {
    equipment: [...equipment.values()].sort(byCount),
    target: [...target.values()].sort(byCount),
  };
}
