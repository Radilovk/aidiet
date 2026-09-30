/**
 * KA-TRAINER Program Engine — детерминистичен генератор на седмична програма.
 *
 * Структурата (дни, сплит, упражнения, серии/повторения/почивка) НЕ се оставя на AI.
 * Всяко решение следва от въпросника по едни и същи правила:
 *
 *   1. resolveClient     — ниво, цел, брой сесии, продължителност, рискове, контузии
 *   2. composeWeek       — колко силови / кардио / интервални / мобилност сесии и в кои дни
 *   3. strengthTemplates — сплит (full-body A/B/C или предна/задна верига) → слотове
 *   4. pickExercise      — слот (двигателен модел + роля) → упражнение от класифицирания каталог
 *   5. doseFor           — серии/повторения/почивка/RPE/темпо по цел × ниво × роля
 *   6. fitSessionTime    — сесията се събира в избраното време (реже аксесоари/серии)
 *
 * Каталогът е класифициран от exercise-classifier.js (pattern/category/mechanic/diff).
 */
import { normalizeText } from './normalize.js';
import { classifyExercise } from './exercise-classifier.js';
import { filterExercises } from './exercise-metadata.js';

export const ENGINE_VERSION = 1;

const DAY_NAMES = ['Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота', 'Неделя'];

/** Активни дни по брой сесии — максимално разпределени, с почивка между силовите. */
const DAY_SLOTS = {
  1: [2],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};

// ---------------------------------------------------------------------------
// 1. Клиент
// ---------------------------------------------------------------------------

function textOf(...parts) {
  return normalizeText(parts.flat().filter(Boolean).join(' '));
}

/** 0–6 мес → 1, 6 мес–2 г → 2, 2–5 г → 2, 5+ → 3. */
export function engineLevel(experience = '') {
  const e = normalizeText(experience);
  if (e.includes('напреднал') || e.includes('5+')) return 3;
  if (e.includes('никакъв') || (e.includes('0 6') && !e.includes('2 години'))) return 1;
  if (e.includes('начинаещ') && !e.includes('среден')) return 1;
  return 2;
}

export function engineGoal(answers = {}) {
  const main = normalizeText(answers?.goal?.main || '');
  const other = normalizeText(answers?.goal?.other || '');
  const g = main === 'друго' ? other : main;
  if (g.includes('отслаб') || g.includes('тегло') || g.includes('мазнин')) return 'fat_loss';
  if (g.includes('мускулна') || g.includes('маса') || g.includes('хипертроф')) return 'hypertrophy';
  if (g.includes('силов') || g.includes('сила')) return 'strength';
  if (g.includes('рекомпоз')) return 'recomp';
  if (g.includes('издръжлив')) return 'endurance';
  if (g.includes('рехаб') || g.includes('травм') || g.includes('контуз')) return 'rehab';
  return 'general';
}

export const GOAL_LABELS_BG = {
  fat_loss: 'Отслабване',
  hypertrophy: 'Мускулна маса',
  strength: 'Сила',
  recomp: 'Рекомпозиция',
  endurance: 'Издръжливост',
  rehab: 'Рехабилитация',
  general: 'Обща кондиция',
};

function sessionsRequested(freq = '', level = 1) {
  const f = normalizeText(freq);
  if (f.includes('ежеднев')) return level === 1 ? 5 : 6;
  if (f.includes('5') && f.includes('6')) return level === 1 ? 4 : 5;
  if (f.includes('3') && f.includes('4')) return level === 1 ? 3 : 4;
  if (f.includes('1') && f.includes('2')) return 2;
  return 3;
}

function sessionMinutes(duration = '') {
  const d = normalizeText(duration);
  if (d.includes('до 30')) return 30;
  if (d.includes('30') && d.includes('45')) return 45;
  if (d.includes('45') && d.includes('60')) return 60;
  if (d.includes('над 60')) return 75;
  return 45;
}

/** Зони на контузия/болка (BG свободен текст) → забранени двигателни модели и думи в имената. */
const INJURY_RULES = [
  {
    zone: 'knee', label: 'коляно', re: /колян|колен|мениск|кръстн\w* връзк|пател|пателар/,
    patterns: ['plyo', 'lunge'], names: /\b(pistol|sissy|jump|hop|deep|full squat|cossack|curtsey|curtsy|nordic|kneeling squat)\b/,
    maxDiffPatterns: { squat: 1, knee_ext: 1 },
  },
  {
    zone: 'low_back', label: 'кръст / долен гръб', re: /кръст|долн\w* гръб|лумба|диск|херни|гръбнак|сколиоз|ишиас|кръстец/,
    patterns: ['olympic', 'plyo', 'core_flex'], names: /\b(good morning|deadlift|barbell (?:full |back |high bar |low bar )?squat|jefferson|zercher|bent over row|pendlay|rack pull|sit up|v up|jackknife|jack knife|toes to bar|superman|hyperextension|swing)\b/,
    maxDiffPatterns: { hinge: 1, squat: 1 },
  },
  {
    zone: 'shoulder', label: 'рамо', re: /рам[оеа]|ротатор|ключиц|лопат/,
    patterns: ['push_v', 'dip', 'olympic', 'pullover'], names: /\b(upright row|behind (?:the )?(?:neck|head)|kipping|muscle up|handstand|skull|snatch|pull ?over|dip)\b/,
    maxDiffPatterns: { push_h: 1, pull_v: 1, lat_raise: 1 },
  },
  {
    zone: 'elbow', label: 'лакът', re: /лакът|лакт|епикондил/,
    patterns: ['dip'], names: /\b(skull|french press|close grip|diamond|dip|jm press|tate press|chin up|preacher)\b/,
    maxDiffPatterns: { triceps: 1, biceps: 1 },
  },
  {
    zone: 'wrist', label: 'китка', re: /китк|карпал/,
    patterns: ['olympic', 'forearm', 'dip'], names: /\b(push up|pushup|front squat|clean|snatch|wrist|handstand|plank|burpee|mountain climber|bear crawl)\b/,
    maxDiffPatterns: {},
  },
  {
    zone: 'neck', label: 'врат', re: /врат|шия|шиен|цервикал/,
    patterns: ['neck', 'olympic', 'shrug'], names: /\b(behind (?:the )?(?:neck|head)|headstand|sit up|crunch|neck)\b/,
    maxDiffPatterns: { push_v: 1 },
  },
  {
    zone: 'ankle', label: 'глезен / ахилес', re: /глез|ахил|стъпал|плантар/,
    patterns: ['plyo'], names: /\b(jump|hop|run|sprint|skip|calf raise|burpee|jack)\b/,
    maxDiffPatterns: { lunge: 1 },
  },
  {
    zone: 'hip', label: 'тазобедрена става', re: /тазобедр|таз\b|бедрена става|слабин|ингвин/,
    patterns: ['plyo'], names: /\b(pistol|cossack|deep|sumo|curtsey|curtsy|adduction|split squat|lunge)\b/,
    maxDiffPatterns: { squat: 1, hinge: 1 },
  },
];

/** BG „не желая“ → EN шаблони в имената / двигателни модели. */
const AVOID_RULES = [
  { re: /бърпи/, names: /\bburpee\b/ },
  { re: /скач|скок|подскок|плиом/, patterns: ['plyo'], names: /\b(jump|hop|bound|skip)\b/ },
  { re: /клек\w* (?:с|със) щанг/, names: /\b(barbell|smith)\b.*\bsquat\b|\bsquat\b.*\bbarbell\b/ },
  { re: /клек(?!\w* (?:с|със) щанг)/, patterns: ['squat'] },
  { re: /напад/, patterns: ['lunge'] },
  { re: /мъртв\w* тяг|румънск/, names: /\b(deadlift|rdl|romanian)\b/ },
  { re: /лицев/, names: /\b(push ?up|pushup)\b/ },
  { re: /набиран|лост/, patterns: ['pull_v'], names: /\b(pull ?up|chin ?up|muscle up)\b/ },
  { re: /кофичк/, patterns: ['dip'] },
  { re: /лежанк/, names: /\bbench press\b/ },
  { re: /коремн|кранч/, patterns: ['core_flex'] },
  { re: /планк/, names: /\bplank\b/ },
  { re: /щанг/, equip: /barbell/ },
  { re: /машин/, equip: /machine|lever|smith|sled/ },
  { re: /бяган|тичан/, names: /\b(run|jog|sprint)\b/ },
  { re: /гребан/, patterns: ['pull_h'] },
  { re: /раменн\w* преса|над глава/, patterns: ['push_v'] },
];

function parseRestrictions(answers = {}) {
  const limitText = textOf(answers.limitations || []);
  const hasLimit = (answers.limitations || []).some((l) => l && !normalizeText(l).includes('нямам'));
  const injuries = hasLimit ? INJURY_RULES.filter((r) => r.re.test(limitText)) : [];
  const unknownLimit = hasLimit && !injuries.length;

  const avoidText = normalizeText(answers?.preferences?.avoid || '');
  const avoid = avoidText ? AVOID_RULES.filter((r) => r.re.test(avoidText)) : [];

  const health = textOf(answers.health || [], answers.healthFemale || [], answers.healthOther || '');
  const pregnant = /бремен/.test(health);
  const postpartum = /кърм|следродил|раждане/.test(health);
  const cardiac = /сърдеч/.test(health);
  const hypertension = /хипертон|кръвно/.test(health);
  const implants = Boolean(answers?.breastImplants?.implants);
  const age = Number(answers.age) || 30;
  const sleepPoor = /лошо|нарушение/.test(normalizeText(answers.sleep || ''));
  const stressHigh = Number(answers.stress) >= 8;

  const rehabGoal = /рехаб|травм/.test(normalizeText(answers?.goal?.main || ''));
  let rpeCap = 8;
  if (pregnant || cardiac || postpartum || rehabGoal) rpeCap = 6;
  else if (hypertension || age >= 65 || unknownLimit || injuries.length) rpeCap = 7;
  else if (sleepPoor || stressHigh) rpeCap = 7;

  const noPlyo = pregnant || postpartum || cardiac || hypertension || age >= 60 || injuries.some((i) => ['knee', 'ankle', 'hip', 'low_back'].includes(i.zone));
  const noHighIntensity = pregnant || postpartum || cardiac;

  return {
    injuries, unknownLimit, avoid, pregnant, postpartum, cardiac, hypertension, implants,
    age, rpeCap, noPlyo, noHighIntensity, sleepPoor, stressHigh,
  };
}

export function resolveClient(answers = {}) {
  const gender = normalizeText(answers.gender || '');
  const isFemale = gender.includes('жена');
  const level = engineLevel(answers.experience);
  const goal = engineGoal(answers);
  const restrictions = parseRestrictions(answers);
  let effLevel = level;
  if (restrictions.pregnant || restrictions.cardiac || goal === 'rehab') effLevel = 1;
  if (restrictions.age >= 65 && effLevel > 2) effLevel = 2;
  const sessions = sessionsRequested(answers?.preferences?.freq, effLevel);
  const minutes = sessionMinutes(answers?.preferences?.duration);
  const types = (answers?.preferences?.types || []).map((t) => normalizeText(t));
  const prefs = {
    strength: types.some((t) => t.includes('силов') || t.includes('функцион')),
    cardio: types.some((t) => t.includes('кардио')),
    hiit: types.some((t) => t.includes('hiit')),
    mobility: types.some((t) => t.includes('йога') || t.includes('мобилност')),
    open: !types.length || types.some((t) => t.includes('отворен')),
  };
  return {
    isFemale, isMale: gender.includes('мъж'), level, effLevel, goal, sessions, minutes, prefs, restrictions,
    zones: parseZones(answers?.goal?.zones || ''),
  };
}

const ZONE_PATTERNS = [
  { re: /дупе|глут|седалищ/, patterns: ['glute', 'abductor'] },
  { re: /задн\w* бедр|hamstring/, patterns: ['knee_flex', 'hinge'] },
  { re: /бедр|крак|квадр/, patterns: ['lunge', 'knee_ext'] },
  { re: /корем|талия|core|преса/, patterns: ['core_static', 'core_rot', 'core_hip'] },
  { re: /гърд|гръд/, patterns: ['fly', 'push_h'] },
  { re: /гръб|стойк|постур/, patterns: ['pull_h', 'rear_delt', 'pull_v'] },
  { re: /рам/, patterns: ['lat_raise', 'rear_delt'] },
  { re: /ръце|бицепс|трицепс/, patterns: ['triceps', 'biceps'] },
  { re: /прасц/, patterns: ['calf'] },
];

function parseZones(text = '') {
  const out = [];
  for (const part of String(text).toLowerCase().split(/[,;/\n]+/)) {
    for (const z of ZONE_PATTERNS) {
      if (z.re.test(part)) { out.push(...z.patterns); break; }
    }
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// 2. Седмица
// ---------------------------------------------------------------------------

/** Брой сесии по тип: S сила, C кардио зона 2, I интервали, M мобилност. */
export function composeWeek(client) {
  const n = client.sessions;
  const { goal, prefs, restrictions, effLevel } = client;
  let S; let C = 0; let I = 0; let M = 0;

  if (goal === 'rehab') {
    S = Math.min(n, 3); M = n - S;
  } else if (prefs.mobility && !prefs.strength && !prefs.cardio && !prefs.hiit && !prefs.open) {
    S = n >= 3 ? 1 : 0; M = n - S;
  } else if ((prefs.cardio || prefs.hiit) && !prefs.strength && !prefs.open) {
    S = Math.max(1, Math.floor(n / 3)); C = n - S;
  } else {
    const table = {
      hypertrophy: [[2, 0], [3, 0], [4, 0], [4, 1], [5, 1]],
      strength: [[2, 0], [3, 0], [4, 0], [4, 1], [4, 2]],
      recomp: [[2, 0], [3, 0], [3, 1], [4, 1], [4, 2]],
      fat_loss: [[2, 0], [3, 0], [3, 1], [3, 2], [4, 2]],
      general: [[2, 0], [3, 0], [3, 1], [3, 2], [4, 2]],
      endurance: [[1, 1], [2, 1], [2, 2], [2, 3], [3, 3]],
    };
    const row = (table[goal] || table.general)[Math.min(4, Math.max(0, n - 2))];
    [S, C] = row;
    if (n === 1) { S = 1; C = 0; }
    if (goal === 'hypertrophy' && n >= 5 && effLevel === 1) { S = 4; C = n - 4; }
  }

  // Предпочитания: мобилност/кардио получават поне 1 ден при ≥3 сесии
  if (prefs.mobility && M === 0 && n >= 3) {
    if (C > 0) C -= 1; else if (S > 2) S -= 1;
    M += 1;
  }
  if (prefs.cardio && C === 0 && n >= 3 && S > 2) { S -= 1; C += 1; }
  // HIIT: само ниво ≥2 и без противопоказания; замества един кардио ден
  const hiitAllowed = !restrictions.noHighIntensity && !restrictions.noPlyo && effLevel >= 2;
  if (hiitAllowed && (prefs.hiit || ((goal === 'fat_loss' || goal === 'endurance') && C >= 2))) {
    if (C > 0) { C -= 1; I += 1; } else if (prefs.hiit && S > 2) { S -= 1; I += 1; }
  }
  // Дълги седмици на силно натоварени хора: 6-ти ден = мобилност, не още сила
  if (n >= 6 && S + C + I + M === n && M === 0 && goal !== 'endurance' && C > 0) { C -= 1; M += 1; }
  return { S, C, I, M, total: S + C + I + M };
}

function placeWeek(counts) {
  const active = DAY_SLOTS[Math.min(6, Math.max(1, counts.total))] || DAY_SLOTS[3];
  const types = new Array(active.length).fill(null);
  // Силовите се разпределят равномерно между активните слотове
  const sIdx = [];
  if (counts.S) {
    const step = active.length / counts.S;
    for (let i = 0; i < counts.S; i++) sIdx.push(Math.min(active.length - 1, Math.floor(i * step)));
  }
  for (const i of sIdx) types[i] = 'S';
  const others = [...Array(counts.I).fill('I'), ...Array(counts.C).fill('C'), ...Array(counts.M).fill('M')];
  for (let i = 0; i < types.length; i++) if (!types[i]) types[i] = others.shift() || 'M';
  return DAY_NAMES.map((day, i) => {
    const k = active.indexOf(i);
    return { day, index: i, kind: k === -1 ? 'R' : types[k] };
  });
}

// ---------------------------------------------------------------------------
// 3. Сплит и слотове
// ---------------------------------------------------------------------------

/**
 * Слот: role — main (основно многоставно), sec (второ многоставно), acc (аксесоар), core.
 * patterns — предпочитани модели по ред; първият наличен в каталога печели.
 */
const TEMPLATES = {
  FB_A: {
    label: 'Цяло тяло A — клек, хоризонтално бутане, вертикално дърпане',
    region: 'full',
    slots: [
      { role: 'main', patterns: ['squat', 'lunge'] },
      { role: 'sec', patterns: ['push_h', 'dip', 'push_v'] },
      { role: 'sec', patterns: ['pull_v', 'pull_h'] },
      { role: 'core', patterns: ['core_static', 'core_rot'] },
      { role: 'acc', patterns: ['@lowerP', 'glute', 'calf'] },
      { role: 'acc', patterns: ['@upperA'] },
      { role: 'acc', patterns: ['@armsA'] },
    ],
  },
  FB_B: {
    label: 'Цяло тяло B — тазово сгъване, хоризонтално дърпане, вертикално бутане',
    region: 'full',
    slots: [
      { role: 'main', patterns: ['hinge', 'glute'] },
      { role: 'sec', patterns: ['pull_h', 'pull_v'] },
      { role: 'sec', patterns: ['push_v', 'push_h'] },
      { role: 'core', patterns: ['core_hip', 'core_flex', 'core_static'] },
      { role: 'acc', patterns: ['@lowerP', 'knee_flex', 'abductor'] },
      { role: 'acc', patterns: ['@upperP'] },
      { role: 'acc', patterns: ['@armsP'] },
    ],
  },
  FB_C: {
    label: 'Цяло тяло C — единичен крак, бутане, дърпане',
    region: 'full',
    slots: [
      { role: 'main', patterns: ['lunge', 'squat'] },
      { role: 'sec', patterns: ['push_h', 'push_v'] },
      { role: 'sec', patterns: ['pull_h', 'pull_v'] },
      { role: 'core', patterns: ['core_rot', 'core_static', 'back_ext'] },
      { role: 'acc', patterns: ['@lowerA', 'abductor', 'calf', 'knee_ext'] },
      { role: 'acc', patterns: ['@upper', 'lat_raise', 'rear_delt'] },
      { role: 'acc', patterns: ['@arms', 'triceps', 'biceps'] },
    ],
  },
  ANT: {
    label: 'Предна верига — клек, бутане, рамене, корем',
    region: 'ant',
    slots: [
      { role: 'main', patterns: ['squat', 'lunge'] },
      { role: 'sec', patterns: ['push_h', 'dip'] },
      { role: 'sec', patterns: ['push_v', 'push_h'] },
      { role: 'acc', patterns: ['@lowerA', 'lunge', 'knee_ext'] },
      { role: 'core', patterns: ['core_flex', 'core_hip', 'core_static'] },
      { role: 'acc', patterns: ['@upperA'] },
      { role: 'acc', patterns: ['@armsA'] },
      { role: 'acc', patterns: ['lat_raise', 'calf', 'abductor'] },
    ],
  },
  POST: {
    label: 'Задна верига — тазово сгъване, гръб, седалище',
    region: 'post',
    slots: [
      { role: 'main', patterns: ['hinge', 'glute'] },
      { role: 'sec', patterns: ['pull_v', 'pull_h'] },
      { role: 'sec', patterns: ['pull_h', 'pull_v'] },
      { role: 'acc', patterns: ['@lowerP', 'glute', 'knee_flex'] },
      { role: 'core', patterns: ['core_static', 'back_ext', 'core_rot'] },
      { role: 'acc', patterns: ['@upperP'] },
      { role: 'acc', patterns: ['@armsP'] },
      { role: 'acc', patterns: ['calf', 'abductor', 'glute'] },
    ],
  },
  REHAB: {
    label: 'Контролирана сила — безопасни базови модели',
    region: 'full',
    slots: [
      { role: 'acc', patterns: ['glute', 'hinge'] },
      { role: 'acc', patterns: ['squat', 'lunge'] },
      { role: 'acc', patterns: ['pull_h', 'rear_delt'] },
      { role: 'acc', patterns: ['push_h', 'push_v'] },
      { role: 'core', patterns: ['core_static'] },
      { role: 'acc', patterns: ['calf', 'abductor', 'rotator'] },
    ],
  },
};

export function strengthTemplates(client, count) {
  if (client.goal === 'rehab' || client.restrictions.pregnant) return { split: 'Контролирана сила', keys: Array(count).fill('REHAB') };
  if (count <= 1) return { split: 'Цяло тяло', keys: ['FB_A'] };
  if (count === 2) return { split: 'Цяло тяло A/B', keys: ['FB_A', 'FB_B'] };
  if (count === 3) return { split: 'Цяло тяло A/B/C', keys: ['FB_A', 'FB_B', 'FB_C'] };
  const keys = [];
  for (let i = 0; i < count; i++) keys.push(i % 2 === 0 ? 'ANT' : 'POST');
  if (count === 5) keys[4] = 'FB_C';
  return { split: count === 5 ? 'Предна/задна верига ×2 + цяло тяло' : `Предна/задна верига ×${count / 2}`, keys };
}

/** Резервни модели за незапълнен аксесоар (напр. у дома няма упражнение за рамо). */
const ACC_FALLBACK = ['glute', 'rear_delt', 'triceps', 'pull_h', 'lunge', 'calf', 'core_static', 'core_rot', 'back_ext', 'abductor'];

/** Колко слота по продължителност и ниво. */
function slotBudget(minutes, level) {
  const base = minutes <= 30 ? 4 : minutes <= 45 ? 5 : minutes <= 60 ? 6 : 7;
  return level === 1 ? Math.min(base, 5) : base;
}

/** Приоритети за аксесоарите (@lower/@upper/@arms) — зони от анкетата, после пол. */
function accessoryPriorities(client) {
  const lower = client.zones.filter((p) => ['glute', 'abductor', 'knee_flex', 'lunge', 'knee_ext', 'calf', 'hinge'].includes(p));
  const upper = client.zones.filter((p) => ['lat_raise', 'rear_delt', 'fly', 'pull_h', 'pull_v', 'push_h'].includes(p));
  const arms = client.zones.filter((p) => ['biceps', 'triceps'].includes(p));
  if (client.isFemale) {
    lower.push('glute', 'abductor', 'knee_flex');
    upper.push('rear_delt', 'lat_raise');
    arms.push('triceps', 'biceps');
  } else {
    lower.push('knee_flex', 'calf', 'glute');
    upper.push('lat_raise', 'rear_delt', 'fly');
    arms.push('biceps', 'triceps');
  }
  const chestFirst = !client.isFemale && ['hypertrophy', 'strength', 'recomp'].includes(client.goal);
  const upperA = [...client.zones.filter((p) => ['fly', 'lat_raise', 'push_h'].includes(p)), ...(chestFirst ? ['fly', 'lat_raise'] : ['lat_raise', 'fly'])];
  const upperP = [...client.zones.filter((p) => ['rear_delt', 'pull_h', 'lat_raise'].includes(p)), 'rear_delt', 'lat_raise'];
  const armsA = [...client.zones.filter((p) => p === 'triceps'), 'triceps', 'biceps'];
  const armsP = [...client.zones.filter((p) => p === 'biceps'), 'biceps', 'triceps'];
  const front = client.zones.filter((p) => ['lunge', 'knee_ext', 'abductor', 'calf'].includes(p));
  const back = client.zones.filter((p) => ['glute', 'knee_flex', 'abductor'].includes(p));
  front.push(...(client.isFemale ? ['lunge', 'abductor', 'knee_ext'] : ['knee_ext', 'lunge', 'calf']));
  back.push(...(client.isFemale ? ['glute', 'knee_flex', 'abductor'] : ['knee_flex', 'glute', 'calf']));
  return {
    '@lower': [...new Set(lower)], '@upper': [...new Set(upper)], '@arms': [...new Set(arms)],
    '@lowerA': [...new Set(front)], '@lowerP': [...new Set(back)],
    '@upperA': [...new Set(upperA)], '@upperP': [...new Set(upperP)], '@armsA': [...new Set(armsA)], '@armsP': [...new Set(armsP)],
  };
}

function expandSlotPatterns(slot, prio) {
  const out = [];
  for (const p of slot.patterns) {
    if (p.startsWith('@')) out.push(...(prio[p] || []));
    else out.push(p);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// 4. Избор на упражнение
// ---------------------------------------------------------------------------

const patternCache = new Map();
/** pattern/category/mechanic от метаданните; ако липсват (ръчна корекция) — класифицира на място. */
export function exerciseShape(entry) {
  if (entry.pattern && entry.category) return entry;
  const key = entry.id;
  if (!patternCache.has(key)) {
    const c = classifyExercise({ name: entry.name, equipment: entry.equipment, target: entry.target, body_part: entry.bodyPart });
    patternCache.set(key, { pattern: c.pattern, category: c.category, mechanic: c.mechanic });
  }
  return { ...entry, ...patternCache.get(key) };
}

function loadKind(entry) {
  const eq = normalizeText(entry.effectiveEquipNorm || entry.equipment || '');
  if (!eq || eq === 'body weight') return 'bodyweight';
  if (/barbell|trap bar/.test(eq)) return 'barbell';
  if (eq === 'dumbbell' || eq === 'kettlebell') return 'free';
  if (eq === 'cable') return 'cable';
  if (/machine|lever|smith|sled|assisted/.test(eq)) return 'machine';
  if (/band/.test(eq)) return 'band';
  return 'other';
}

/** Основни упражнения, които треньор избира първо (при равни други условия). */
const STAPLES = new Set([
  'squat', 'front squat', 'goblet squat', 'leg press', 'hack squat', 'bodyweight squat', 'banded squat',
  'deadlift', 'romanian deadlift', 'dumbbell romanian deadlift', 'kettlebell swing', 'cable pull through',
  'hip thrust', 'dumbbell hip thrust', 'glute bridge', 'banded glute bridge', 'walking lunge', 'reverse lunge', 'forward lunge',
  'bulgarian split squat', 'split squat', 'step up', 'bench press', 'dumbbell bench press', 'incline dumbbell press',
  'machine chest press', 'push up', 'knee push up', 'incline push up', 'wall push up', 'overhead press',
  'dumbbell seated shoulder press', 'machine shoulder press', 'barbell row', 'dumbbell bent over row', 'one arm dumbbell row',
  'seated cable row', 'machine row', 'chest supported row', 'inverted row', 'banded row', 'lat pulldown', 'pull up', 'chin up',
  'assisted pull up', 'banded lat pulldown', 'lateral raise', 'cable lateral raise', 'rear delt fly', 'face pull', 'band pull apart',
  'cable fly', 'pec deck', 'dumbbell fly', 'bicep curl', 'hammer curl', 'tricep pushdown', 'rope tricep pushdown',
  'overhead tricep extension', 'leg extension', 'lying leg curl', 'seated leg curl', 'standing calf raise', 'calf raise',
  'plank', 'side plank', 'dead bug', 'bird dog', 'crunch', 'reverse crunch', 'russian twist', 'hanging knee raise', 'pallof press',
  'walking', 'cycling', 'elliptical', 'treadmill incline walk', 'rowing', 'stair climber', 'jumping jack', 'mountain climber',
]);

/** Имена в dataset-а, които не са ясни упражнения или са дубли/демо варианти. */
const ODD_NAMES = /^(swimming|elevator|cocoons|bottoms up|butt ups|body up|flag|standing calves|wind sprints|swing 360|quick feet v 2|left hook boxing|push and pull bodyweight|push to run|hands bike|isometric wipers|dumbbell iron cross|dumbbell incline raise|dumbbell raise|dumbbell lying femoral|march sit wall|kick out sit|spell caster|sledge hammer|tire flip|london bridge|hug keens to chest)$/;

/** Колкото по-обичайно/чисто е името, толкова по-добре (dataset-ът има много екзотични варианти). */
function oddity(entry) {
  const n = normalizeText(entry.name);
  const tokens = n.split(' ').length;
  let s = Math.max(0, tokens - 3);
  if (ODD_NAMES.test(n)) s += 8;
  if (STAPLES.has(n)) s -= 3;
  if (/\b(upright row|good morning|behind neck|behind head)\b/.test(n)) s += 2;
  if (/\bv \d\b|\bpov\b|arm blaster|with towel|\(|\)|variation|version/.test(n)) s += 4;
  if (/\b(exercise ball|stability ball|on ball|bosu|suspended|on bench|from bench|on box|with rope attachment)\b/.test(n)) s += 2;
  if (/\b(one arm|single arm|alternate|alternating|one leg|single leg|twisting|rotation|kneeling)\b/.test(n)) s += 1;
  if (/\b(reverse grip|close grip|wide grip|decline|guillotine|pin|board|jm|anti gravity|bradford|frankenstein|potty|zercher|jefferson|speed|sprint|skier|pirate|stalder|london|rocky|kick out)\b/.test(n)) s += 2;
  return s;
}

/** Предпочитание за натоварване според цел, ниво и среда (по-ниско = по-добре). */
function loadRank(kind, role, client, env) {
  const beginner = client.effLevel === 1;
  const heavy = client.goal === 'strength' || client.goal === 'hypertrophy';
  const tables = {
    main: beginner
      ? { machine: 0, free: 0, bodyweight: 1, cable: 1, band: 2, barbell: 3, other: 3 }
      : heavy
        ? { barbell: 0, free: 1, machine: 2, bodyweight: 2, cable: 3, band: 4, other: 4 }
        : { free: 0, barbell: 1, bodyweight: 1, machine: 1, cable: 2, band: 2, other: 3 },
    sec: beginner
      ? { machine: 0, free: 0, cable: 1, bodyweight: 1, band: 2, barbell: 3, other: 3 }
      : { free: 0, barbell: 1, machine: 1, cable: 1, bodyweight: 1, band: 2, other: 3 },
    acc: { free: 0, cable: 0, machine: 0, bodyweight: 1, band: 1, barbell: 2, other: 3 },
    core: { bodyweight: 0, cable: 1, free: 1, machine: 1, band: 1, barbell: 3, other: 3 },
  };
  const t = tables[role] || tables.acc;
  // У дома без уреди ластикът е „тежестта“ — не го наказваме
  if (env === 'home' && kind === 'band') return 0;
  return t[kind] ?? 3;
}

/**
 * Целева трудност: начинаещ → 1, иначе 2. Трудност 3 (гимнастика, плиометрия, олимпийски)
 * не е „по-добро“ упражнение за напреднал — основните щангови движения са 2.
 */
function targetDiff(role, client) {
  if (role === 'main' || role === 'sec') return client.effLevel === 1 ? 1 : 2;
  if (role === 'core') return client.effLevel === 3 ? 2 : 1;
  return 1;
}

function violatesRestrictions(entry, shape, client) {
  const r = client.restrictions;
  const n = normalizeText(entry.name);
  const eq = normalizeText(entry.equipment || '');
  for (const inj of r.injuries) {
    if (inj.patterns.includes(shape.pattern)) return true;
    if (inj.names?.test(n)) return true;
    const cap = inj.maxDiffPatterns?.[shape.pattern];
    if (cap && (entry.diff ?? 2) > cap) return true;
  }
  for (const a of r.avoid) {
    if (a.patterns?.includes(shape.pattern)) return true;
    if (a.names?.test(n)) return true;
    if (a.equip?.test(eq)) return true;
  }
  if (r.noPlyo && (shape.pattern === 'plyo' || (entry.flags || []).includes('plyometric'))) return true;
  if (r.pregnant && (['core_flex', 'core_hip', 'olympic'].includes(shape.pattern)
    || /\b(lying|supine|prone|decline|dead bug|bridge|hip lift|floor press|flutter|on back)\b/.test(n))) return true;
  if (r.noHighIntensity && /\b(run|running|sprint|jog|jump|jumping|jack|rope|burpee|climber|skipping)\b/.test(n)) return true;
  if (r.implants && ['push_h', 'fly', 'dip', 'pullover'].includes(shape.pattern)) return true;
  if (r.hypertension && /\b(hanging|inverted|headstand|handstand)\b/.test(n)) return true;
  if (r.age >= 60 && shape.pattern === 'olympic') return true;
  return false;
}

/**
 * Избира упражнение за слот. used — вече избрани в седмицата (за разнообразие),
 * dayUsed — в същата сесия (забранени).
 */
/** Всички допустими кандидати за слот, подредени по пригодност (по-ниско = по-добре). */
export function rankCandidates(pool, slotPatterns, role, client, { dayUsed, weekUsed, env, category = 'strength' }) {
  const candidates = [];
  for (const entry of pool) {
    if (dayUsed.has(entry.id)) continue;
    const shape = exerciseShape(entry);
    const order = slotPatterns.indexOf(shape.pattern);
    if (order === -1) continue;
    if (category === 'strength' && !['strength', 'core'].includes(shape.category)) continue;
    if ((role === 'main' || role === 'sec') && shape.mechanic !== 'compound') continue;
    if (violatesRestrictions(entry, shape, client)) continue;
    const kind = loadKind(entry);
    const diff = entry.diff ?? 2;
    // Редът на моделите в слота е предпочитание, не твърдо правило: основно упражнение
    // от втория модел бие екзотичен вариант от първия.
    let score = order * 3;
    score += Math.abs(diff - targetDiff(role, client)) * 3;
    score += loadRank(kind, role, client, env) * 2;
    score += oddity(entry);
    if (role === 'main' && (entry.flags || []).includes('balance')) score += 3;
    if (role === 'main' && shape.pattern !== 'lunge' && (entry.flags || []).includes('unilateral')) score += 2;
    if (diff === 3) score += 4;
    if ((entry.flags || []).includes('gymnastics')) score += 8;
    if (weekUsed.has(entry.id)) score += 6;
    candidates.push({ entry, score, pattern: shape.pattern });
  }
  candidates.sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name));
  return candidates;
}

export function pickExercise(pool, slotPatterns, role, client, opts) {
  const ranked = rankCandidates(pool, slotPatterns, role, client, opts);
  return ranked.length ? { entry: ranked[0].entry, pattern: ranked[0].pattern } : null;
}

const SIBLING_PATTERNS = {
  squat: ['lunge'], lunge: ['squat'], hinge: ['glute'], glute: ['hinge', 'abductor'],
  push_h: ['push_v', 'dip'], push_v: ['push_h'], dip: ['push_h', 'triceps'], fly: ['push_h'],
  pull_h: ['pull_v', 'rear_delt'], pull_v: ['pull_h'], lat_raise: ['rear_delt', 'front_raise'], rear_delt: ['lat_raise', 'pull_h'],
  biceps: ['pull_h'], triceps: ['dip', 'push_h'], knee_ext: ['squat', 'lunge'], knee_flex: ['hinge', 'glute'],
  abductor: ['glute'], adductor: ['lunge'], calf: ['lunge'],
  core_static: ['core_rot', 'core_flex', 'core_hip', 'back_ext'], core_rot: ['core_static', 'core_flex'],
  core_flex: ['core_hip', 'core_static'], core_hip: ['core_flex', 'core_static'], back_ext: ['core_static', 'glute'],
  cardio: ['plyo'], stretch: [],
};

/** До 3 алтернативи за замяна: същият двигателен модел и роля, същите ограничения (контузии, оборудване). */
function alternativesFor(pool, item, client, env, excludeIds) {
  const role = item.role === 'finisher' || item.role === 'cardio' || item.role === 'interval' ? 'acc' : item.role;
  const category = ['cardio', 'interval', 'mobility', 'finisher'].includes(item.role) ? 'any' : 'strength';
  // Същият модел първо, после сроден (клек↔напад, дърпане хор.↔верт. …) — наказанието за реда
  // в rankCandidates гарантира, че сродният модел идва след всички от същия.
  const patterns = [item.pattern, ...(SIBLING_PATTERNS[item.pattern] || [])];
  const ranked = rankCandidates(pool, patterns, role === 'mobility' ? 'acc' : role, client, {
    dayUsed: excludeIds, weekUsed: new Set(), env, category,
  });
  const out = [];
  const names = new Set([normalizeText(item.entry.name)]);
  for (const c of ranked) {
    if (out.length >= 3) break;
    const n = normalizeText(c.entry.name.replace(/\(.*?\)|\bv\.?\s*\d+\b/g, ''));
    if (names.has(n)) continue;
    names.add(n);
    out.push(c.entry.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Доза
// ---------------------------------------------------------------------------

const HOLD_RE = /\b(plank|hold|hollow|l sit|lsit|wall sit|side bridge|isometric|dead hang|static)\b/;

/** Серии × повторения × почивка × RPE × темпо — таблица цел × роля, скалирана по ниво. */
export function doseFor(goal, role, level, { name = '', rpeCap = 8, isHold = false } = {}) {
  const T = {
    strength: { main: [4, '4-6', 180], sec: [3, '6-8', 120], acc: [3, '8-12', 75], core: [3, '8-12', 60] },
    hypertrophy: { main: [4, '6-10', 120], sec: [3, '8-12', 90], acc: [3, '10-15', 60], core: [3, '10-15', 60] },
    recomp: { main: [3, '8-10', 120], sec: [3, '8-12', 90], acc: [3, '10-15', 60], core: [3, '10-15', 45] },
    fat_loss: { main: [3, '8-12', 90], sec: [3, '10-12', 75], acc: [2, '12-15', 60], core: [3, '12-15', 45] },
    general: { main: [3, '8-12', 90], sec: [3, '10-12', 75], acc: [2, '12-15', 60], core: [3, '10-15', 45] },
    endurance: { main: [3, '12-15', 60], sec: [3, '12-15', 60], acc: [2, '15-20', 45], core: [3, '15-20', 45] },
    rehab: { main: [2, '10-12', 60], sec: [2, '10-12', 60], acc: [2, '10-12', 60], core: [2, '8-10', 45] },
  };
  let [sets, reps, rest] = (T[goal] || T.general)[role] || T.general.acc;
  if (level === 1) {
    sets = Math.min(sets, 3);
    if (goal === 'strength' && (role === 'main' || role === 'sec')) reps = '6-8';
    if (goal === 'strength' && role === 'main') rest = 120;
  }
  if (level === 3 && role === 'main' && goal !== 'rehab') sets += 1;
  const n = normalizeText(name);
  if (HOLD_RE.test(n) || isHold) {
    reps = level === 1 ? '20-30 сек' : level === 2 ? '30-45 сек' : '45-60 сек';
  }
  const rpeBase = role === 'main' || role === 'sec'
    ? (level === 1 ? 7 : 8)
    : (level === 1 ? 7 : 8);
  const rpeTop = Math.min(rpeCap, rpeBase + (level === 3 && role !== 'core' ? 1 : 0));
  const rpeLow = Math.max(5, rpeTop - 1);
  const tempo = goal === 'rehab' ? '3-1-2' : goal === 'strength' && role === 'main' ? '2-1-1' : '2-0-2';
  return { sets, reps, restSeconds: rest, rpe: `${rpeLow}-${rpeTop}`, tempo };
}

/** Прибл. време на сесия (мин): серия ≈ 45 сек работа + почивка + 2 мин смяна на упражнение. */
export function estimateMinutes(exercises, warmupMin = 6, cooldownMin = 5) {
  let sec = 0;
  for (const ex of exercises) {
    const sets = Number(ex.sets) || 0;
    sec += sets * 45 + Math.max(0, sets - 1) * (Number(ex.restSeconds) || 60) + 90;
  }
  return Math.round(sec / 60 + warmupMin + cooldownMin);
}

function fitSessionTime(exercises, minutes) {
  const limit = minutes + 5;
  const out = exercises.map((e) => ({ ...e }));
  const over = () => estimateMinutes(out) > limit;
  const restFloor = { main: 120, sec: 90, acc: 45, core: 30, finisher: 0 };
  // 1) аксесоари до 2 серии
  for (const ex of out) { if (!over()) break; if (ex.role === 'acc' && ex.sets > 2) ex.sets = 2; }
  // 2) махни финишъра, после аксесоарите от края (ядрото остава)
  while (over() && out.some((e) => e.role === 'finisher')) out.splice(out.findIndex((e) => e.role === 'finisher'), 1);
  while (over() && out.filter((e) => e.role === 'acc').length) out.splice(out.map((e) => e.role).lastIndexOf('acc'), 1);
  // 3) по-къси почивки до разумния минимум за ролята
  for (const ex of out) { if (!over()) break; ex.restSeconds = Math.min(ex.restSeconds, restFloor[ex.role] ?? 45); }
  // 4) по-малко серии на основните (минимум 2)
  for (const cap of [3, 2]) {
    for (const ex of out) { if (!over()) break; if (ex.sets > cap) ex.sets = cap; }
  }
  // 5) последна мярка — махни упражнения от края, но пази поне 3
  while (over() && out.length > 3) out.splice(out.length - 1, 1);
  return out;
}

// ---------------------------------------------------------------------------
// Кардио / интервали / мобилност
// ---------------------------------------------------------------------------

/**
 * @param {object[]} pool @param {string[]} patterns @param {object} client @param {number} count
 * @param {{ dayUsed: Set<string>, weekUsed?: Set<string>|null, filter?: (e: any, s: any) => boolean, sortKey?: ((e: any) => number)|null }} opts
 */
function pickByPattern(pool, patterns, client, count, { dayUsed, weekUsed = null, filter = () => true, sortKey = null }) {
  const out = [];
  const seenTargets = new Set();
  const list = pool
    .map((e) => ({ e, s: exerciseShape(e) }))
    .filter(({ e, s }) => patterns.includes(s.pattern) && !dayUsed.has(e.id) && !violatesRestrictions(e, s, client) && filter(e, s))
    .sort((a, b) => (weekUsed ? Number(weekUsed.has(a.e.id)) - Number(weekUsed.has(b.e.id)) : 0)
      || (sortKey ? sortKey(a.e) - sortKey(b.e) : 0) || oddity(a.e) - oddity(b.e) || a.e.name.localeCompare(b.e.name));
  // Първо разнообразие по мускул/зона, после каквото остане; без дубли като „run“ / „run (equipment)“
  const baseName = (e) => normalizeText(e.name.replace(/\(.*?\)|\bv\.?\s*\d+\b/g, ''));
  const seenNames = new Set();
  const take = (e) => { out.push(e); seenNames.add(baseName(e)); };
  for (const { e } of list) {
    if (out.length >= count) break;
    const t = e.targetNorm || e.target;
    if (seenTargets.has(t) || seenNames.has(baseName(e))) continue;
    seenTargets.add(t);
    take(e);
  }
  for (const { e } of list) {
    if (out.length >= count) break;
    if (!out.includes(e) && !seenNames.has(baseName(e))) take(e);
  }
  return out;
}

/** Зона 2 = равномерно, ритмично движение. Пълзене, бърпи, удари — само за интервали. */
const ZONE2_RE = /\b(walk|walking|march|run|jog|step|stepmill|elliptical|cross trainer|bike|cycle|treadmill|rope|jack|skier|ski)\b/;
const INTERVAL_ONLY_RE = /\b(crawl|burpee|climber|boxing|hook|punch|swing 360|frog|crab|plank jack|seal jack|sprawl|squat thrust|battle|swimming)\b/;

const EASY_CARDIO_RE = /\b(walk|walking|march|step|elliptical|cross trainer|bike|cycle|stepmill)\b/;

function cardioSession(pool, client, minutes, dayUsed, weekUsed = null) {
  const easyFirst = (e) => (client.effLevel === 1 || client.restrictions.rpeCap <= 7) && !EASY_CARDIO_RE.test(normalizeText(e.name)) ? 1 : 0;
  const work = Math.max(15, minutes - 10);
  const zone2 = (e) => ZONE2_RE.test(normalizeText(e.name)) && !INTERVAL_ONLY_RE.test(normalizeText(e.name));
  const machines = pickByPattern(pool, ['cardio'], client, 2, {
    dayUsed, weekUsed, sortKey: easyFirst, filter: (e) => loadKind(e) === 'machine' && zone2(e) && !/hands bike|ergometer/.test(normalizeText(e.name + ' ' + e.equipment)),
  });
  const bodyweight = pickByPattern(pool, ['cardio'], client, 2, {
    dayUsed, weekUsed, sortKey: easyFirst,
    filter: (e) => loadKind(e) !== 'machine' && zone2(e) && (e.diff ?? 2) <= client.effLevel,
  });
  const chosen = machines.length ? machines : bodyweight;
  if (!chosen.length) return [];
  const per = Math.round(work / chosen.length);
  return chosen.map((e) => ({
    entry: e, role: 'cardio', sets: 1, reps: `${per} мин`, restSeconds: 0,
    rpe: client.restrictions.rpeCap <= 6 ? '4-5' : '5-6', tempo: '', notes: 'Зона 2: можеш да говориш на изречения, но не да пееш.',
  }));
}

function intervalSession(pool, client, minutes, dayUsed, weekUsed = null) {
  const allowPlyo = !client.restrictions.noPlyo && client.effLevel >= 2;
  const picks = pickByPattern(pool, allowPlyo ? ['cardio', 'plyo'] : ['cardio'], client, 4, {
    dayUsed, weekUsed,
    filter: (e) => loadKind(e) !== 'machine' || /bike|ergometer|skierg|row/.test(normalizeText(e.name + ' ' + e.equipment)),
  });
  if (!picks.length) return [];
  const rounds = minutes <= 30 ? 3 : minutes <= 45 ? 4 : 5;
  const work = client.effLevel >= 3 ? 40 : 30;
  return picks.map((e) => ({
    entry: e, role: 'interval', sets: rounds,
    reps: `${work} сек работа / ${60 - work} сек почивка`, restSeconds: 60 - work,
    rpe: `${Math.min(client.restrictions.rpeCap, 8)}-${Math.min(client.restrictions.rpeCap + 1, 9)}`, tempo: '', notes: 'Кръгов формат: мини през всички упражнения, после повтори.',
  }));
}

function mobilitySession(pool, client, minutes, dayUsed, weekUsed = null) {
  // ~2.5 мин на упражнение (2–3 серии × 30–45 сек + преход) → запълва времето без тренировъчен стрес
  const count = Math.max(5, Math.min(12, Math.round((minutes - 10) / 3)));
  const stretches = pickByPattern(pool, ['stretch'], client, count - 2, { dayUsed, weekUsed });
  const core = pickByPattern(pool, ['core_static', 'back_ext', 'glute'], client, 2, { dayUsed, weekUsed, filter: (e) => (e.diff ?? 2) === 1 });
  const sets = minutes >= 45 ? 3 : 2;
  return [...stretches, ...core].map((e) => {
    const shape = exerciseShape(e);
    return {
      entry: e, role: shape.pattern === 'stretch' ? 'mobility' : 'core', sets,
      reps: shape.pattern === 'stretch' ? '30-45 сек' : (HOLD_RE.test(normalizeText(e.name)) ? '20-30 сек' : '8-10'),
      restSeconds: 20, rpe: '3-4', tempo: shape.pattern === 'stretch' ? '' : '3-1-2', notes: '',
    };
  });
}

// ---------------------------------------------------------------------------
// Текстове
// ---------------------------------------------------------------------------

function warmupFor(kind, region) {
  if (kind === 'M') return ['3 мин спокойно ходене или маршируване на място', 'Кръгове с рамене, таз и глезени — по 10', 'Дълбоко диафрагмено дишане — 1 мин'];
  if (kind === 'C') return ['5 мин постепенно увеличаване на темпото', 'Динамично разтягане на прасци и бедра', 'Кръгове с рамене и ръце'];
  if (kind === 'I') return ['5 мин леко кардио', 'Динамична мобилност на цялото тяло', '2 кратки ускорения на 60–70% усилие'];
  const lower = region === 'post'
    ? 'Мост за седалище и котка-крава — по 10'
    : 'Клек със собствено тегло и напад с ротация — по 8';
  return ['5 мин леко кардио (ходене, колело, въже)', lower, 'Кръгове с рамене и дърпане на ластик — по 10', 'Първото упражнение: 1–2 загряващи серии с лека тежест'];
}

function cooldownFor(kind) {
  if (kind === 'M') return ['Лежащо отпускане с дълбоко дишане — 2 мин', 'Бавно ходене — 2 мин', 'Лека глътка вода и отпускане'];
  if (kind === 'C' || kind === 'I') return ['3–5 мин бавно ходене до нормален пулс', 'Разтягане на прасци, предно и задно бедро — по 30 сек', 'Дълбоко дишане — 1 мин'];
  return ['3 мин спокойно ходене', 'Разтягане на натоварените мускули — по 30 сек', 'Дълбоко дишане — 1 мин'];
}

const KIND_TYPE = { S: 'strength', C: 'cardio', I: 'hiit', M: 'mobility', R: 'rest' };

function weeklyVolume(days) {
  const map = {
    squat: 'крака', lunge: 'крака', knee_ext: 'крака', calf: 'прасци', hinge: 'задна верига', glute: 'седалище', knee_flex: 'задна верига',
    abductor: 'седалище', adductor: 'крака', push_h: 'гърди', fly: 'гърди', dip: 'гърди', push_v: 'рамене', lat_raise: 'рамене', front_raise: 'рамене',
    rear_delt: 'рамене', pull_v: 'гръб', pull_h: 'гръб', pullover: 'гръб', shrug: 'гръб', biceps: 'ръце', triceps: 'ръце', forearm: 'ръце',
    core_flex: 'корем', core_rot: 'корем', core_static: 'корем', core_hip: 'корем', back_ext: 'задна верига',
  };
  const out = {};
  for (const d of days) {
    for (const ex of d.exercises) {
      const g = map[ex.pattern];
      if (!g || d.type !== 'strength') continue;
      out[g] = (out[g] || 0) + (Number(ex.sets) || 0);
    }
  }
  return out;
}

function buildTexts(client, week, split, days) {
  const goalLabel = GOAL_LABELS_BG[client.goal];
  const levelLabel = ['', 'начинаещ', 'среден', 'напреднал'][client.effLevel];
  const c = week.counts;
  const parts = [];
  if (c.S) parts.push(`${c.S} силови`);
  if (c.C) parts.push(`${c.C} кардио`);
  if (c.I) parts.push(`${c.I} интервални`);
  if (c.M) parts.push(`${c.M} мобилност`);
  const r = client.restrictions;
  const safetyNotes = [];
  for (const inj of r.injuries) safetyNotes.push(`Зона ${inj.label}: изключени са натоварващите я движения. При болка над 3/10 спри упражнението.`);
  if (r.unknownLimit) safetyNotes.push('Посоченото ограничение не беше разпознато автоматично — консултирай се с треньор преди тежки серии.');
  if (r.pregnant) safetyNotes.push('Бременност: без легнали по гръб упражнения, коремни преси и скокове; спри при замайване или болка.');
  if (r.postpartum) safetyNotes.push('След раждане: постепенно, с акцент върху тазовото дъно и дишането; без скокове.');
  if (r.cardiac || r.hypertension) safetyNotes.push('Сърдечно-съдов риск: без задържане на дъха; усилието не надвишава RPE 7. Необходимо е одобрение от лекар.');
  if (r.implants) safetyNotes.push('Гръдни импланти: изключени са лежанки, флайс и кофички.');
  if (r.sleepPoor || r.stressHigh) safetyNotes.push('Лош сън/висок стрес: дръж усилието с 1 RPE по-ниско в тежки дни.');
  safetyNotes.push('Техниката е преди тежестта: последните 1–3 повторения трябва да са трудни, но чисти.');

  const progression = client.goal === 'strength'
    ? 'Когато изпълниш горната граница на повторенията във всички серии при зададения RPE, добави 2.5–5% тежест. На всеки 4–6 седмици направи лека седмица (−40% серии).'
    : 'Двойна прогресия: първо стигни горната граница на повторенията във всички серии, после добави тежест (2–5%) и започни отново от долната граница. На всеки 5–6 седмици — лека седмица.';
  const recovery = client.effLevel === 1
    ? 'Поне 48 ч между силовите тренировки за едни и същи мускули; 7–9 ч сън; леко ходене в почивните дни.'
    : '7–9 ч сън; 7–10 хил. крачки дневно; при натрупана умора намали обема, не пропускай тренировки.';
  const nutrition = {
    fat_loss: 'Умерен калориен дефицит и 1.6–2 г протеин на кг телесно тегло. Подробният режим е отделна услуга.',
    hypertrophy: 'Лек калориен излишък и 1.6–2.2 г протеин на кг. Подробният режим е отделна услуга.',
    recomp: 'Калории около поддръжката и 1.8–2.2 г протеин на кг. Подробният режим е отделна услуга.',
  }[client.goal] || 'Балансирано хранене с достатъчно протеин (1.4–1.8 г/кг) и вода. Подробният режим е отделна услуга.';
  const adaptation = 'Лош ден: махни последния аксесоар и една серия от основните. Добър ден: добави една серия на основното упражнение.';

  return {
    title: `${goalLabel} — ${split}, ${week.counts.total} ${week.counts.total === 1 ? 'тренировка' : 'тренировки'} седмично`,
    summary: `Програма за ${levelLabel} ниво с цел „${goalLabel.toLowerCase()}“. Седмицата има ${parts.join(', ')} ${week.counts.total === 1 ? 'сесия' : 'сесии'} по около ${client.minutes} мин. Основните упражнения покриват всички двигателни модели (клек, тазово сгъване, бутане, дърпане, корем); аксесоарите следват приоритетите ти.`,
    weeklySplit: `${split}. Силовите дни са разделени с почивка, за да се възстановят мускулите; ${c.C || c.I ? 'кардиото е в отделни дни, за да не пречи на силовите.' : 'почивните дни са за ходене и възстановяване.'}`,
    safetyNotes,
    guidelines: { progression, recovery, nutrition, adaptation },
  };
}

// ---------------------------------------------------------------------------
// Главна функция
// ---------------------------------------------------------------------------

function envOf(allowedEquipment) {
  if (!allowedEquipment) return 'gym';
  const hasMachines = [...allowedEquipment].some((e) => /machine|cable|smith|sled|lever/.test(e));
  return hasMachines ? 'gym' : 'home';
}

/**
 * @param {{ answers: object, index: object[], exerciseProfile?: object|null, allowedEquipment?: Set<string>|null,
 *   allowedGear?: Set<string>|null, pickedApparatus?: string[]|null, constraints?: { exclusions?: string[] }|null }} input
 */
export function buildTrainingProgram({
  answers = {}, index = [], exerciseProfile = null, allowedEquipment = null, allowedGear = null, pickedApparatus = null, constraints = null,
}) {
  const client = resolveClient(answers);
  // Нивото се определя тук (engineLevel), не от груб текстов парсер; пол/gf/gm идват от профила
  const profile = exerciseProfile ? { ...exerciseProfile, maxDiff: client.effLevel } : null;
  const pool = filterExercises(index, profile, allowedEquipment, null, pickedApparatus, allowedGear, constraints?.exclusions || null);
  const env = envOf(allowedEquipment);
  const counts = composeWeek(client);
  const placed = placeWeek(counts);
  const sDays = placed.filter((d) => d.kind === 'S').length;
  const { split, keys } = strengthTemplates(client, sDays);
  const prio = accessoryPriorities(client);
  const budget = slotBudget(client.minutes, client.effLevel);
  const weekUsed = new Set();
  const issues = [];

  let sCounter = 0;
  const days = placed.map((d) => {
    if (d.kind === 'R') {
      return { day: d.day, focus: 'Почивка — леко ходене и възстановяване', type: 'rest', durationMin: 0, warmup: [], exercises: [], cooldown: [] };
    }
    const dayUsed = new Set();
    let items = [];
    let focus = '';
    let region = 'full';
    if (d.kind === 'S') {
      const tpl = TEMPLATES[keys[sCounter++] || 'FB_A'];
      focus = tpl.label;
      region = tpl.region;
      const ordered = ['hypertrophy', 'strength', 'recomp'].includes(client.goal)
        ? [...tpl.slots.filter((x) => x.role !== 'core'), ...tpl.slots.filter((x) => x.role === 'core')]
        : tpl.slots;
      for (const slot of ordered.slice(0, budget)) {
        const patterns = expandSlotPatterns(slot, prio);
        let got = pickExercise(pool, patterns, slot.role, client, { dayUsed, weekUsed, env })
          // слот без многоставно (напр. у дома без лост) → приеми изолиращо от същите модели
          || ((slot.role === 'main' || slot.role === 'sec') ? pickExercise(pool, patterns, 'acc', client, { dayUsed, weekUsed, env }) : null);
        const fallback = !got
          ? pickExercise(pool, ACC_FALLBACK.filter((p) => !items.some((it) => it.pattern === p)), 'acc', client, { dayUsed, weekUsed, env })
          : null;
        const chosen = got || fallback;
        if (!chosen) { issues.push(`${d.day}: няма упражнение за ${slot.role} [${patterns.join(', ')}]`); continue; }
        if (!got) got = chosen;
        dayUsed.add(got.entry.id);
        weekUsed.add(got.entry.id);
        const dose = doseFor(client.goal, slot.role, client.effLevel, { name: got.entry.name, rpeCap: client.restrictions.rpeCap, isHold: got.entry.exerciseType === 'duration' });
        items.push({ entry: got.entry, role: slot.role, pattern: got.pattern, ...dose, notes: '' });
      }
      // Финишър за отслабване/кондиция при достатъчно време
      if (['fat_loss', 'general', 'recomp'].includes(client.goal) && client.minutes >= 45 && !counts.C && !counts.I) {
        const fin = cardioSession(pool, client, 18, dayUsed, weekUsed)[0];
        if (fin) items.push({ ...fin, reps: '8-10 мин', role: 'finisher', notes: 'Финишър: равномерно темпо, зона 2–3.' });
      }
      items = fitSessionTime(items, client.minutes);
      // Рехабилитация/бременност: остатъкът от времето — мобилност, не още натоварване
      if (keys[sCounter - 1] === 'REHAB' && client.minutes >= 45) {
        for (const m of mobilitySession(pool, client, 30, dayUsed).filter((x) => x.role === 'mobility').slice(0, client.minutes >= 60 ? 3 : 2)) {
          dayUsed.add(m.entry.id);
          items.push({ ...m, pattern: 'stretch' });
        }
      }
    } else if (d.kind === 'C') {
      focus = 'Кардио зона 2 — аеробна база, изгаряне на мазнини, възстановяване';
      items = cardioSession(pool, client, client.minutes, dayUsed, weekUsed);
    } else if (d.kind === 'I') {
      focus = 'Интервали — кондиция и VO2max, кратки усилия с почивки';
      items = intervalSession(pool, client, client.minutes, dayUsed, weekUsed);
    } else {
      focus = 'Мобилност — подвижност на ставите, стойка и възстановяване';
      items = mobilitySession(pool, client, client.minutes, dayUsed, weekUsed);
    }
    for (const it of items) weekUsed.add(it.entry.id);
    if (!items.length) issues.push(`${d.day}: празна сесия (${d.kind})`);
    return {
      day: d.day,
      focus,
      type: KIND_TYPE[d.kind],
      durationMin: client.minutes,
      warmup: warmupFor(d.kind, region),
      cooldown: cooldownFor(d.kind),
      exercises: items.map((it) => ({
        exerciseId: it.entry.id,
        alternativeIds: alternativesFor(pool, { ...it, pattern: it.pattern || exerciseShape(it.entry).pattern }, client, env,
          new Set(items.map((x) => x.entry.id))),
        displayName: it.entry.nameBg || '',
        canonicalName: it.entry.name,
        equipmentHint: it.entry.equipment,
        bodyPart: it.entry.bodyPart || it.entry.target,
        sets: it.sets,
        reps: it.reps,
        restSeconds: it.restSeconds,
        tempo: it.tempo || '',
        rpe: it.rpe || '',
        notes: it.notes || '',
        role: it.role,
        pattern: it.pattern || exerciseShape(it.entry).pattern,
      })),
    };
  });

  const texts = buildTexts(client, { counts }, split, days);
  const plan = { ...texts, days };
  return {
    plan,
    meta: {
      engineVersion: ENGINE_VERSION,
      client: {
        level: client.level, effLevel: client.effLevel, goal: client.goal, sessions: client.sessions, minutes: client.minutes,
        injuries: client.restrictions.injuries.map((i) => i.zone), rpeCap: client.restrictions.rpeCap, env,
      },
      counts,
      split,
      weeklySets: weeklyVolume(days),
      poolSize: pool.length,
      issues,
    },
  };
}
