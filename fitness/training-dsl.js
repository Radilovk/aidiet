/**
 * TRAINING DSL v4 — детерминистичен слой за split, седмица, бюджет на сесия и audit.
 * AI попълва упражнения; архитектурата идва от тук.
 */
import { normalizeText } from './normalize.js';
import {
  parseSessionCount,
  parseDurationMin,
  parseLevel,
  goalKey,
  resolveTrainingModality,
} from './program-spec.js';

const DAY_NAMES = ['Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота', 'Неделя'];

const TRAINING_SLOTS = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

const GOAL_ALLOC = {
  fat_loss: { S: [3, 4], C2: [2, 3], CI: [0, 1], M: 2 },
  muscle: { S: [4, 4], C2: [1, 2], CI: [0, 0], M: [1, 2] },
  shape: { S: [3, 3], C2: [2, 2], CI: [0, 1], M: 2 },
  conditioning: { S: [2, 3], C2: [1, 1], CI: [2, 2], M: 1 },
  mobility: { S: [2, 2], C2: [2, 2], CI: [0, 0], M: [3, 4] },
};

const DSL_TO_APP_TYPE = {
  S: 'strength',
  C2: 'cardio',
  CI: 'hiit',
  M: 'mobility',
  R: 'rest',
};

const SESSION_BUDGET = {
  30: { compound: 3, isolation: 0, core: 1, cardioMin: [0, 5], maxExercises: 4 },
  45: { compound: 4, isolation: 1, core: 2, cardioMin: [8, 10], maxExercises: 7 },
  60: { compound: 4, isolation: 2, core: 2, cardioMin: [15, 20], maxExercises: 8 },
  75: { compound: 5, isolation: 3, core: 2, cardioMin: [20, 30], maxExercises: 10 },
};

const SQUAT_RE = /\b(squat|lunge|leg press|hack squat|goblet squat|step.?up|split squat|wall sit|curtsy)\b/i;
const HINGE_RE = /\b(deadlift|rdl|romanian|hip thrust|glute bridge|pull.?through|good morning|back extension|hyperextension|swing)\b/i;
const CORE_RE = /\b(crunch|sit[- ]?up|plank|ab |abs |oblique|dead bug|leg raise|core)\b/i;

function pickMid(range) {
  if (Array.isArray(range)) return Math.round((range[0] + range[1]) / 2);
  return Number(range) || 0;
}

function mapGoalToDsl(answers = {}) {
  const modality = resolveTrainingModality(answers);
  if (modality === 'mobility') return 'mobility';
  if (modality === 'cardio' || modality === 'hiit') return 'conditioning';

  const g = goalKey(answers);
  if (g.includes('отслаб')) return 'fat_loss';
  if (g.includes('хипертроф') || g.includes('сила')) return 'muscle';
  if (g.includes('издръжлив')) return 'conditioning';
  if (g.includes('рехаб')) return 'mobility';
  return 'shape';
}

function mapEnvToDsl(answers = {}) {
  const equip = [...(answers.equipment || []), answers.equipmentOther || '']
    .join(' ')
    .toLowerCase();
  if (/зала|gym|машин|кардио уред|leg press|кросс/i.test(equip)) return 'gym';
  if (/ластик|band|резин/i.test(equip)) return 'bands';
  if (/собствено тегло|bodyweight|без оборудване/i.test(equip)) return 'bodyweight';
  if (/дъмбел|гира|kettlebell/i.test(equip)) return 'dumbbells';
  return 'dumbbells';
}

function mapLevelToDsl(level) {
  return level <= 1 ? 'beginner' : 'late_beginner';
}

function mapPriority(answers = {}) {
  const zones = normalizeText(answers?.goal?.zones || '');
  if (/глут|дупе|posture|стойк/i.test(zones)) return 'glute';
  if (/гръб|рамо|posture/i.test(zones)) return 'posture';
  return 'none';
}

/** @returns {object} */
export function mapAnswersToDslInput(answers = {}) {
  const assumptions = [];
  const freq = parseSessionCount(answers?.preferences?.freq);
  const sessionMin = parseDurationMin(answers?.preferences?.duration);
  const level = parseLevel(answers?.experience);
  const goal = mapGoalToDsl(answers);
  const env = mapEnvToDsl(answers);

  if (!answers?.preferences?.freq) assumptions.push('freq=3 (по подразбиране)');
  if (!answers?.preferences?.duration) assumptions.push('session_min=45 (по подразбиране)');
  if (!answers?.goal?.main) assumptions.push(`goal=${goal} (по подразбиране)`);

  return {
    goal,
    level: mapLevelToDsl(level),
    freq,
    env,
    session_min: sessionMin <= 32 ? 30 : sessionMin <= 47 ? 45 : sessionMin <= 67 ? 60 : 75,
    days_available: 7,
    priority: mapPriority(answers),
    limits: (answers.limitations || []).filter((l) => l && !normalizeText(l).includes('нямам')),
    split: 'auto',
    assumptions,
    rawLevel: level,
  };
}

/**
 * @typedef {object} DslInput
 * @property {'fat_loss'|'muscle'|'shape'|'conditioning'|'mobility'} goal
 * @property {'beginner'|'late_beginner'} level
 * @property {number} freq
 * @property {'gym'|'dumbbells'|'bands'|'bodyweight'} env
 * @property {30|45|60|75} session_min
 * @property {number} days_available
 * @property {'none'|'glute'|'posture'} priority
 * @property {string[]} limits
 * @property {string} split
 * @property {string[]} [assumptions]
 * @property {number} [rawLevel]
 */

/**
 * @typedef {object} SplitOptions
 * @property {number} [freq]
 * @property {string} [split]
 * @property {'none'|'glute'|'posture'} [priority]
 */

/**
 * @param {SplitOptions} [opts]
 */
export function resolveSplit({ freq = 3, split = 'auto', priority = 'none' } = {}) {
  if (split && split !== 'auto') {
    return { template: split, label: String(split), variants: [] };
  }
  if (freq <= 3) {
    return {
      template: 'FULLBODY',
      label: 'FULLBODY × A/B/C',
      variants: ['A', 'B', 'C'],
      forbid: ['UL'],
    };
  }
  if (freq === 4) {
    if (priority === 'posture' || priority === 'glute') {
      return { template: 'AP', label: 'ANT/POST (AP)', variants: ['ANT', 'POST'], forbid: ['UL'] };
    }
    return { template: 'PUSHPULL', label: 'PUSH/PULL', variants: ['PUSH', 'PULL'], forbid: ['UL'] };
  }
  return {
    template: 'AP_PRIORITY',
    label: 'AP + приоритетен ден',
    variants: ['ANT', 'POST', 'PRIORITY'],
    forbid: ['UL'],
  };
}

function strengthFocus(splitInfo, index, priority) {
  const { template, variants = [] } = splitInfo;
  const v = variants[index % variants.length] || 'A';
  if (template === 'FULLBODY') {
    const map = {
      A: 'разпределение A — предна верига, глутеус, горна част (силова)',
      B: 'разпределение B — задна верига, дърпане, глутеус (силова)',
      C: 'разпределение C — full-body баланс (силова)',
    };
    return map[v] || map.A;
  }
  if (template === 'AP' || template === 'AP_PRIORITY') {
    if (v === 'ANT') return 'ANT — квадрицепс, гърди, рамене, бицепс (силова)';
    if (v === 'POST') return 'POST — hinge, гръб, глутеус, трицепс (силова)';
    if (v === 'PRIORITY') {
      return priority === 'glute'
        ? 'приоритетен ден — глутеус и задна верига (силова)'
        : 'приоритетен ден — постура и гръб (силова)';
    }
  }
  if (template === 'PUSHPULL') {
    return v === 'PUSH'
      ? 'PUSH — клек/избутване, гърди, трицепс (силова)'
      : 'PULL — hinge, дърпане, бицепс (силова)';
  }
  return 'силова тренировка';
}

function computeWeekCounts(goal, freq) {
  const alloc = GOAL_ALLOC[goal] || GOAL_ALLOC.shape;
  const s = Math.min(pickMid(alloc.S), freq);
  return {
    S: s,
    C2: pickMid(alloc.C2),
    CI: pickMid(alloc.CI),
    M: pickMid(alloc.M),
  };
}

export function allocateWeekDays(dslInput, splitInfo) {
  const { freq, goal, priority } = dslInput;
  const counts = computeWeekCounts(goal, freq);
  const slots = (TRAINING_SLOTS[Math.min(6, Math.max(2, freq))] || TRAINING_SLOTS[3]).slice(0, counts.S);

  const week = DAY_NAMES.map((day) => ({
    day,
    dslType: 'R',
    appType: 'rest',
    focus: 'почивка',
    sessionId: null,
  }));

  slots.forEach((idx, si) => {
    week[idx] = {
      day: DAY_NAMES[idx],
      dslType: 'S',
      appType: 'strength',
      focus: strengthFocus(splitInfo, si, priority),
      sessionId: `S${si + 1}`,
    };
  });

  const freeIdx = week.map((_, i) => i).filter((i) => week[i].dslType === 'R');
  let fi = 0;

  const place = (type, count, focus, sessionPrefix) => {
    let placed = 0;
    while (placed < count && fi < freeIdx.length) {
      const idx = freeIdx[fi++];
      week[idx] = {
        day: DAY_NAMES[idx],
        dslType: type,
        appType: DSL_TO_APP_TYPE[type],
        focus,
        sessionId: `${sessionPrefix}${placed + 1}`,
      };
      placed += 1;
    }
    return placed;
  };

  place('M', counts.M, 'Почивка и възстановяване — мобилност', 'M');
  place('C2', counts.C2, 'Кардио зона 2 — умерен темпо', 'C2');
  place('CI', counts.CI, 'Интервална кондиция', 'CI');

  return { week, counts };
}

export function sessionExerciseBudget(sessionMin) {
  const key = sessionMin <= 32 ? 30 : sessionMin <= 47 ? 45 : sessionMin <= 67 ? 60 : 75;
  return { ...SESSION_BUDGET[key], sessionMin: key };
}

export function buildDslSpec(answers = {}) {
  const input = mapAnswersToDslInput(answers);
  const split = resolveSplit(input);
  const { week, counts } = allocateWeekDays(input, split);
  const sessionBudget = sessionExerciseBudget(input.session_min);

  return {
    input,
    split,
    week,
    counts,
    sessionBudget,
    invariants: [
      'squat ⊥ hinge в една силова сесия',
      'ред: warmup → compound → isolation → core → (cardio)',
      `силов ден: ${sessionBudget.compound} compound + ${sessionBudget.isolation} isolation + ${sessionBudget.core} core`,
      'sets/сесия ∈ 12..20 при strength',
      'C2 след strength ≤30min или отделен ден',
      'CI не 24h преди POST/долна сила',
      'FORBID: upper/lower split осве split=ul',
    ],
  };
}

export function formatDslSpecBlock(dslSpec) {
  if (!dslSpec) return '';
  const { input, split, week, counts, sessionBudget, invariants } = dslSpec;
  const lines = [
    'АРХИТЕКТУРА (DSL v4 — задължителна рамка; попълни упражнения от каталога):',
    `goal=${input.goal} | level=${input.level} | freq=${input.freq} | env=${input.env} | session=${input.session_min}min`,
    `split: ${split.label} (template=${split.template})`,
  ];
  if (input.assumptions?.length) {
    lines.push(`assumptions: ${input.assumptions.join('; ')}`);
  }
  lines.push(`week targets: S=${counts.S} C2=${counts.C2} CI=${counts.CI} M=${counts.M}`);
  lines.push('week plan:');
  for (const d of week) {
  lines.push(`  ${d.day}: ${d.dslType} → type=${d.appType} | ${d.focus}`);
  }
  lines.push(`session budget (${sessionBudget.sessionMin}min): compound×${sessionBudget.compound}, isolation×${sessionBudget.isolation}, core×${sessionBudget.core}, cardio ${sessionBudget.cardioMin[0]}–${sessionBudget.cardioMin[1]}min`);
  lines.push(`dose: compound 3×8-12 RIR2-3 rest60-90s | isolation 2×12-15 | goal=muscle → rest90-120s`);
  lines.push(`invariants: ${invariants.join(' | ')}`);
  lines.push('ЗАДАЧА: следвай week plan и session budget; map dslType→day.type; focus = текста от плана; без UL split.');
  return lines.join('\n');
}

export function classifyMovementPatterns(name) {
  const n = String(name || '');
  const patterns = new Set();
  if (HINGE_RE.test(n)) patterns.add('hinge');
  if (SQUAT_RE.test(n) && !/deadlift/i.test(n)) patterns.add('squat');
  return patterns;
}

function isCoreExercise(name) {
  return CORE_RE.test(String(name || ''));
}

function countStrengthSlots(exercises = []) {
  let core = 0;
  let main = 0;
  for (const ex of exercises) {
    const name = ex.canonicalName || ex.displayName || '';
    if (isCoreExercise(name)) core += 1;
    else main += 1;
  }
  return { main, core, total: exercises.length };
}

function dayNameToDsl(dayName, dslSpec) {
  return dslSpec?.week?.find((d) => d.day === dayName) || null;
}

/** Post-AI DSL audit — връща списък с проблеми. */
export function auditPlanDsl(plan, dslSpec) {
  if (!dslSpec || !plan?.days?.length) return [];

  const issues = [];
  const budget = dslSpec.sessionBudget;
  const expected = dslSpec.counts || {};

  let sDays = 0;
  let c2Days = 0;
  let ciDays = 0;
  let mDays = 0;

  for (const day of plan.days) {
    const dslDay = dayNameToDsl(day.day, dslSpec);
    const appType = day.type || 'rest';

    if (appType === 'strength') sDays += 1;
    if (appType === 'cardio') c2Days += 1;
    if (appType === 'hiit') ciDays += 1;
    if (appType === 'mobility' || appType === 'active-recovery') mDays += 1;

    if (dslDay && dslDay.appType !== 'rest' && appType !== dslDay.appType && appType !== 'active-recovery') {
      if (!(dslDay.appType === 'mobility' && appType === 'mobility')) {
        issues.push(`${day.day}: очакван type=${dslDay.appType} (DSL ${dslDay.dslType}), получен ${appType}`);
      }
    }

    if (appType !== 'strength' || !day.exercises?.length) continue;

    const names = day.exercises.map((e) => e.canonicalName || e.displayName || '');
    let hasSquat = false;
    let hasHinge = false;
    for (const name of names) {
      const p = classifyMovementPatterns(name);
      if (p.has('squat')) hasSquat = true;
      if (p.has('hinge')) hasHinge = true;
    }
    if (hasSquat && hasHinge) {
      issues.push(`${day.day}: squat и hinge в една сесия — нарушен DSL invariant`);
    }

    const counts = countStrengthSlots(day.exercises);
    const maxEx = budget.compound + budget.isolation + budget.core + 1;
    if (counts.total > maxEx) {
      issues.push(`${day.day}: твърде много упражнения (${counts.total} > ${maxEx})`);
    }
    if (counts.main > budget.compound + budget.isolation + 1) {
      issues.push(`${day.day}: твърде много основни упражнения (${counts.main} > ${budget.compound + budget.isolation + 1})`);
    }

    const totalSets = day.exercises.reduce((s, e) => s + (Number(e.sets) || 0), 0);
    if (totalSets > 0 && (totalSets < 10 || totalSets > 22)) {
      issues.push(`${day.day}: общи серии ${totalSets} извън 12–20 (DSL volume)`);
    }
  }

  if (Math.abs(sDays - (expected.S || 0)) > 1) {
    issues.push(`Седмица: ${sDays} силови дни (очаквани ~${expected.S})`);
  }
  if (c2Days < Math.max(0, (expected.C2 || 0) - 1)) {
    issues.push(`Седмица: малко кардио дни (${c2Days}/${expected.C2})`);
  }
  if (mDays < Math.max(0, (expected.M || 0) - 1)) {
    issues.push(`Седмица: малко мобилност (${mDays}/${expected.M})`);
  }

  return issues;
}
