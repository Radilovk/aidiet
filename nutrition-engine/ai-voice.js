/**
 * Гласът на плана: AI пише как планът говори на конкретния човек — портрет
 * (психо-емоционален статус, социален контекст, тригери, стил на личността),
 * обръщение и тон, лично писмо, насоки и бележки към ястията.
 *
 * Границата е същата като при останалите AI помощници: числата, храните и
 * ограниченията са на двигателя. Тук всичко се проверява — текст с грамове,
 * калории, дози или забранена храна се отхвърля, бележка към ястие, което не
 * е в менюто, се изпуска. При грешка планът остава с детерминистичните текстове.
 */

import { isCleanClientText } from './text-guard.js';
import { GOALS } from '../profile-code.js';
import { profileBrief, collectFreeText } from './ai-assist.js';
import { MEAL_LABELS } from './strategy.js';

/** Отговорите, от които се чете човекът — с въпроса, за да е ясен контекстът. */
const PERSON_FIELDS = [
  ['gender', 'Пол'],
  ['age', 'Възраст'],
  ['goal', 'Цел'],
  ['lossKg', 'Желани килограми'],
  ['dietHistory', 'Диета през последната година'],
  ['dietType', 'Каква диета'],
  ['dietResult', 'Резултат от диетата'],
  ['weightChange', 'Рязка промяна на теглото'],
  ['weightChangeDetails', 'Подробности за промяната'],
  ['overeatingFrequency', 'Колко често яде повече от планираното'],
  ['foodCravings', 'Често изпитва нужда от'],
  ['foodCravings_other', 'Нужда от (друго)'],
  ['foodTriggers', 'Ситуации, които предизвикват желание за храна'],
  ['foodTriggers_other', 'Ситуации (друго)'],
  ['eatingHabits', 'Хранителни навици'],
  ['compensationMethods', 'Компенсация след преяждане'],
  ['socialComparison', 'Сравнява се с други (вкл. социални мрежи)'],
  ['stressLevel', 'Ниво на стрес'],
  ['stressSources', 'Източници на стрес'],
  ['stressSymptoms', 'Симптоми на стрес'],
  ['relaxationPractices', 'Техники за релаксация'],
  ['sleepHours', 'Сън (часове)'],
  ['sleepInterrupt', 'Прекъсвания на съня'],
  ['chronotype', 'Хронотип'],
  ['dailyActivityLevel', 'Активност през деня'],
  ['sportActivity', 'Спорт'],
  ['sedentaryHours', 'Часове седнал'],
  ['drinksSweet', 'Сладки напитки'],
  ['drinksAlcohol', 'Алкохол'],
  ['dietLove', 'Не може без, обича'],
  ['dietDislike', 'Не обича / не понася'],
  ['additionalNotes', 'Допълнителни бележки'],
];

const asText = v => (Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v ?? '')).trim();

/** Отговорите на човека като редове „въпрос: отговор“ (празните се пропускат). */
export function personAnswers(userData = {}) {
  const rows = [];
  for (const [key, label] of PERSON_FIELDS) {
    let v = asText(userData[key]);
    if (key === 'goal') v = GOALS[v] || v;
    if (v && v.length <= 400) rows.push(`${label}: ${v}`);
  }
  return rows.join('\n');
}

/** Менюто за AI: уникалните ястия с id — бележките се връзват по id. */
export function menuForVoice(weekPlan) {
  const seen = new Map();
  for (let d = 1; d <= 7; d++) {
    for (const m of weekPlan?.[`day${d}`]?.meals || []) {
      if (!m?.dishId || seen.has(m.dishId)) continue;
      seen.set(m.dishId, `${m.dishId} | ${MEAL_LABELS[m.type] || m.type} | ${m.name}`);
    }
  }
  return [...seen.values()].join('\n');
}

/** Всички входни променливи на промпта. */
export function planVoiceVars(profile, userData, plan) {
  const s = plan?.strategy || {};
  const free = collectFreeText(userData);
  return {
    name: asText(userData?.name) || 'клиента',
    profileSummary: profileBrief(profile),
    answers: personAnswers(userData) || 'няма',
    freeText: free.length ? free.map(i => `- ${i.text}`).join('\n') : 'няма',
    planFacts: [
      `Хранителен модел: ${s.dietType || s.dietaryModifier || '—'}`,
      `Хранения на ден: ${profile.slots?.length || '—'}`,
      s.weeklyMealPattern ? `Седмица: ${s.weeklyMealPattern}` : '',
      s.freeDayNumber ? `Свободно хранене: ден ${s.freeDayNumber}` : '',
    ].filter(Boolean).join('\n'),
    avoid: (s.foodsToAvoid || []).join(', ') || 'няма',
    menu: menuForVoice(plan?.weekPlan) || 'няма',
  };
}

/* ─── Проверка на отговора ─────────────────────────────────────────────── */

/** Числа, които са работа на двигателя: грамове, калории, дози, проценти. */
const NUMBERS_RE = /\d+(?:[.,]\d+)?\s*(?:kcal|ккал\p{L}*|калори\p{L}*|грам\p{L}*|порци\p{L}*|mcg|мкг|mg|мг|ml|мл|iu|ме|гр|г|g|%)(?!\p{L})/iu;

function cleanLine(v, max) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s || /[{}<>]/.test(s)) return '';
  return s.length > max ? '' : s;
}

function makeChecker(blockedTerms) {
  const terms = (blockedTerms || [])
    .map(t => String(t).toLowerCase().replace(/^без\s+/, '').trim())
    .filter(t => t.length >= 3);
  return (text) => {
    if (!text || NUMBERS_RE.test(text) || !isCleanClientText(text)) return false;
    const low = text.toLowerCase();
    return !terms.some(t => low.includes(t));
  };
}

function cleanList(list, ok, { min = 0, max = 6, len = 320 } = {}) {
  const out = [...new Set((Array.isArray(list) ? list : []).map(x => cleanLine(x, len)).filter(ok))].slice(0, max);
  return out.length >= min ? out : [];
}

/**
 * Отговорът на AI → проверен глас на плана или null.
 * @param {any} raw
 * @param {{ dishIds: Set<string>|string[], blockedTerms?: string[] }} ctx
 */
export function normalizePlanVoice(raw, ctx) {
  if (!raw || typeof raw !== 'object') return null;
  const dishIds = ctx.dishIds instanceof Set ? ctx.dishIds : new Set(ctx.dishIds || []);
  const ok = makeChecker(ctx.blockedTerms);
  // Портретът е за специалиста — без проверката за храни, но без числа и с лимит.
  const portraitText = (v, max = 600) => {
    const s = cleanLine(v, max);
    return s && !NUMBERS_RE.test(s) ? s : '';
  };
  const p = raw.portrait && typeof raw.portrait === 'object' ? raw.portrait : {};
  const portrait = {
    summary: portraitText(p.summary),
    emotional: portraitText(p.emotional),
    social: portraitText(p.social),
    triggers: cleanList(p.triggers, s => !NUMBERS_RE.test(s), { max: 6, len: 200 }),
    personality: portraitText(p.personality),
    motivation: portraitText(p.motivation),
    risks: cleanList(p.risks, s => !NUMBERS_RE.test(s), { max: 4, len: 200 }),
  };

  const t = raw.tone && typeof raw.tone === 'object' ? raw.tone : {};
  const tone = {
    address: t.address === 'Вие' ? 'Вие' : 'ти',
    style: cleanLine(t.style, 160),
  };

  const welcome = cleanLine(raw.welcome, 1200);
  const specialistNote = cleanLine(raw.specialistNote, 700);
  const voice = {
    portrait,
    tone,
    welcome: ok(welcome) ? welcome : '',
    specialistNote: ok(specialistNote) ? specialistNote : '',
    psychology: cleanList(raw.psychology, ok, { min: 3, max: 6 }),
    habits: cleanList(raw.habits, ok, { min: 3, max: 6 }),
    mealNotes: {},
  };
  for (const n of Array.isArray(raw.mealNotes) ? raw.mealNotes : []) {
    const id = String(n?.dishId || '').trim();
    const note = cleanLine(n?.note, 220);
    if (dishIds.has(id) && ok(note) && !voice.mealNotes[id]) voice.mealNotes[id] = note;
    if (Object.keys(voice.mealNotes).length >= 12) break;
  }

  const useful = voice.welcome || voice.psychology.length || voice.habits.length;
  return useful ? voice : null;
}

/** Дали отговорът на AI е бил използваем — за лога и админа. */
export function voiceSummary(voice) {
  if (!voice) return 'няма';
  return [
    voice.welcome ? 'писмо' : '',
    voice.psychology.length ? `психология ×${voice.psychology.length}` : '',
    voice.habits.length ? `навици ×${voice.habits.length}` : '',
    Object.keys(voice.mealNotes).length ? `бележки ×${Object.keys(voice.mealNotes).length}` : '',
    `обръщение „${voice.tone.address}“`,
  ].filter(Boolean).join(', ');
}

/**
 * Гласът влиза в плана. Детерминистичните текстове остават там, където AI
 * не е дал годен заместител.
 */
export function applyPlanVoice(plan, voice) {
  if (!plan || !voice) return plan;
  plan.aiVoice = voice;
  const s = plan.strategy || (plan.strategy = {});
  if (voice.welcome) s.welcomeMessage = voice.welcome;
  if (voice.specialistNote) s.specialistNote = voice.specialistNote;
  s.addressForm = voice.tone.address;
  if (voice.psychology.length) {
    plan.psychology = [...voice.psychology];
    s.psychologicalSupport = [...voice.psychology];
  }
  if (voice.habits.length) plan.personalHabits = [...voice.habits];
  for (let d = 1; d <= 7; d++) {
    for (const m of plan.weekPlan?.[`day${d}`]?.meals || []) {
      const note = m?.dishId && voice.mealNotes[m.dishId];
      if (note) m.personalNote = note;
    }
  }
  return plan;
}

/** id-тата на ястията в менюто. */
export function planDishIds(weekPlan) {
  const ids = new Set();
  for (let d = 1; d <= 7; d++) for (const m of weekPlan?.[`day${d}`]?.meals || []) if (m?.dishId) ids.add(m.dishId);
  return ids;
}
