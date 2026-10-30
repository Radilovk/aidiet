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

import { textIssues } from './text-guard.js';
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
    emotionalProfile: emotionalProfileText(userData?._enrichment?.voice) || 'няма',
  };
}

/** Профилът от EmoEat — за портрета, психологията и навиците. */
export function emotionalProfileText(v) {
  if (!v || typeof v !== 'object') return '';
  return [
    v.archetype ? `Архетип: ${v.archetype}${v.archetypeDescription ? ` — ${v.archetypeDescription}` : ''}` : '',
    v.secondArchetype ? `Втори архетип: ${v.secondArchetype}` : '',
    v.intensity ? `Интензитет на емоционалното хранене: ${v.intensity}` : '',
    v.drivers?.length ? `Какво го захранва: ${v.drivers.join(', ')}` : '',
    v.patterns?.length ? `Модели: ${v.patterns.join('; ')}` : '',
    v.bodySignals ? `Телесни сигнали: ${v.bodySignals}` : '',
    v.realNeed ? `Реалната нужда (с думите на клиента): ${v.realNeed}` : '',
  ].filter(Boolean).join('\n');
}

/* ─── Проверка на отговора ─────────────────────────────────────────────── */

/** Числа, които са работа на двигателя: грамове, калории, дози, проценти. */
const NUMBERS_RE = /\d+(?:[.,]\d+)?\s*(?:kcal|ккал\p{L}*|калори\p{L}*|грам\p{L}*|порци\p{L}*|mcg|мкг|mg|мг|ml|мл|iu|ме|гр|г|g|%)(?!\p{L})/iu;

function cleanLine(v, max) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s || /[{}<>]/.test(s)) return '';
  return s.length > max ? '' : s;
}

/** Защо текстът от AI не става — с думи, които AI разбира при поправката. */
const ISSUE_REASONS = {
  ai_self: 'говори за себе си като AI/модел',
  placeholder: 'съдържа незапълнен шаблон',
  cure_claim: 'обещава лечение или гарантиран резултат',
  stop_meds: 'съветва за спиране или промяна на лекарство',
  shaming: 'съдържа обидна или засрамваща дума',
  markup: 'съдържа код или разметка',
  english: 'е на английски',
  imitation: 'сравнява плана с диетолог или казва, че подражава — планът е от специалиста, който води клиента',
  jargon: 'използва жаргон („калораж“) — пиши „калории“ или „дневен прием“',
};

function makeReason(blockedTerms) {
  const terms = (blockedTerms || [])
    .map(t => String(t).toLowerCase().replace(/^без\s+/, '').trim())
    .filter(t => t.length >= 3);
  /** @returns {string} празно, ако текстът става */
  return (text) => {
    if (!text) return 'празен';
    if (NUMBERS_RE.test(text)) return 'съдържа количества или калории (те са работа на програмата)';
    const issues = textIssues(text);
    if (issues.length) return issues.map(c => ISSUE_REASONS[c] || c).join('; ');
    const low = text.toLowerCase();
    const term = terms.find(t => low.includes(t));
    return term ? `споменава „${term}“, което клиентът не бива да яде` : '';
  };
}

function makeChecker(blockedTerms) {
  const reason = makeReason(blockedTerms);
  return (text) => !reason(text);
}

/** Суровият текст и защо е отхвърлен (дълъг, с шаблон, с числа…). */
function rejectReason(raw, max, reason) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length > max) return `твърде дълъг (над ${max} знака)`;
  if (/[{}<>]/.test(s)) return 'съдържа символи от код или шаблон';
  return reason(s);
}

function cleanList(list, ok, { min = 0, max = 6, len = 320 } = {}) {
  const out = [...new Set((Array.isArray(list) ? list : []).map(x => cleanLine(x, len)).filter(ok))].slice(0, max);
  return out.length >= min ? out : [];
}

/**
 * Отговорът на AI → проверен глас на плана или null.
 * @param {any} raw
 * @param {{ dishIds: Set<string>|string[], blockedTerms?: string[] }} ctx
 * @param {Array<{ field: string, text: string, reason: string }>} [rejected]  тук се записва отхвърленото — за поправката
 */
export function normalizePlanVoice(raw, ctx, rejected = []) {
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
    // Обръщението на NutriPlan е „ти“ — едно за целия продукт (екраните, въпросника, известията).
    address: 'ти',
    style: cleanLine(t.style, 160),
  };

  const reason = makeReason(ctx.blockedTerms);
  const reject = (field, text, max) => {
    const why = rejectReason(text, max, reason);
    if (why) rejected.push({ field, text: String(text).slice(0, max + 200), reason: why });
  };
  const welcome = cleanLine(raw.welcome, 1200);
  const specialistNote = cleanLine(raw.specialistNote, 700);
  if (!ok(welcome)) reject('welcome', raw.welcome, 1200);
  if (!ok(specialistNote)) reject('specialistNote', raw.specialistNote, 700);
  for (const key of ['psychology', 'habits']) {
    for (const item of Array.isArray(raw[key]) ? raw[key] : []) {
      if (!ok(cleanLine(item, 320))) reject(key, item, 320);
    }
  }
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
    else if (dishIds.has(id) && !voice.mealNotes[id] && n?.note) reject(`mealNotes:${id}`, n.note, 220);
    if (Object.keys(voice.mealNotes).length >= 12) break;
  }

  const useful = voice.welcome || voice.psychology.length || voice.habits.length;
  return useful ? voice : null;
}

/** Най-много толкова текста се връщат на AI за поправка — една заявка, кратка. */
const REPAIR_LIMIT = 8;

/**
 * Промптът за поправка: отхвърлените текстове с причината. AI връща само тях,
 * пренаписани; новият отговор минава през същата проверка.
 * @param {Array<{ field: string, text: string, reason: string }>} rejected
 * @param {{ name?: string, address?: string }} [ctx]
 */
export function voiceRepairPrompt(rejected, ctx = {}) {
  const items = rejected.slice(0, REPAIR_LIMIT).map((r, i) => `${i + 1}. [${r.field}] Причина: ${r.reason}\nТекст: ${r.text}`).join('\n\n');
  return [
    'Ти си редактор в екипа на NutriPlan. Следните текстове към клиент бяха отхвърлени от автоматичната проверка.',
    `Пренапиши всеки така, че да запази смисъла и топлия тон, но да няма посочения проблем. Обръщение: на „ти“.`,
    'Правила: без числа за грамове, калории, порции, дози и проценти; без продукти, които клиентът не бива да яде; без обещания за лечение; без съвети за лекарства; без код, шаблони и английски; естествен български.',
    'Ако текстът не може да се поправи, пропусни го.',
    '',
    items,
    '',
    'Върни САМО JSON: {"items":[{"field":"<същото поле>","text":"<поправеният текст>"}]}',
  ].join('\n');
}

/**
 * Поправените текстове влизат там, където първият отговор е бил отхвърлен.
 * Всеки минава отново през пълната проверка (normalizePlanVoice).
 * @param {object} voice  гласът от първия отговор (може да е null)
 * @param {any} raw       отговорът на поправката
 * @param {{ dishIds: Set<string>|string[], blockedTerms?: string[] }} ctx
 */
export function mergeVoiceRepair(voice, raw, ctx) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  if (!items.length) return voice;
  const draft = { psychology: [], habits: [], mealNotes: [], portrait: voice?.portrait, tone: voice?.tone };
  for (const it of items) {
    const field = String(it?.field || '');
    const text = String(it?.text || '');
    if (field === 'welcome' || field === 'specialistNote') draft[field] = text;
    else if (field === 'psychology' || field === 'habits') draft[field].push(text);
    else if (field.startsWith('mealNotes:')) draft.mealNotes.push({ dishId: field.slice(10), note: text });
  }
  // Списъците минават проверката поотделно (minimum 3 важи само за целия списък).
  const fixed = normalizePlanVoice({ ...draft, psychology: [...(voice?.psychology || []), ...draft.psychology], habits: [...(voice?.habits || []), ...draft.habits] }, ctx);
  if (!fixed) return voice;
  if (!voice) return fixed;
  const out = { ...voice, mealNotes: { ...voice.mealNotes } };
  if (!out.welcome && fixed.welcome) out.welcome = fixed.welcome;
  if (!out.specialistNote && fixed.specialistNote) out.specialistNote = fixed.specialistNote;
  if (fixed.psychology.length > out.psychology.length) out.psychology = fixed.psychology;
  if (fixed.habits.length > out.habits.length) out.habits = fixed.habits;
  for (const [id, note] of Object.entries(fixed.mealNotes)) if (!out.mealNotes[id]) out.mealNotes[id] = note;
  return out;
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
