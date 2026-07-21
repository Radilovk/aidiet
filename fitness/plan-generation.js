/**
 * KA-TRAINER — единен pipeline за генериране на план.
 *
 * Два входа, един алгоритъм:
 *   1. Въпросник (клиент) — структурирани answers
 *   2. Админ бриф — clientProfile + exampleScheme
 *
 * Два слоя насоки:
 *   individual  — таг-съвпадение + профил/схема (най-висок приоритет)
 *   architecture — universal chunks (база); foundation се добавя при prompt build
 */

import { normalizeText } from './normalize.js';
import { buildProfileSummary } from './profile-summary.js';
import { exerciseProfileFromAnswers } from './exercise-metadata.js';
import { GENDER_FIT_RETRY_HINT } from './plan-prompts.js';
import {
  buildProgramSpec,
  formatProgramSpecBlock,
  buildCompactProfileForPrompt,
} from './program-spec.js';

export { GENDER_FIT_RETRY_HINT };

export const MAX_FOUNDATION_CHARS = 800;
export const MAX_GUIDELINE_ITEMS = 12;
export const MAX_GUIDELINE_CHARS = 3600;
export const MAX_ARCHITECTURE_ITEMS = 8;
export const MAX_ARCHITECTURE_CHARS = 2800;

const UNIVERSAL_TAGS = new Set(['all', '*', 'общо']);

export const GUIDELINE_CHUNKS = [
  { tags: ['goal:отслабване'], text: 'Отслабване: комбинирай съпротивителен тренинг (запазва мускулна маса) с кардио. Приоритет — многоставни движения с умерени тежести, 2-3 сек контролирана негативна фаза. Кардио зони: LISS 60-70% от макс. пулс или интервали според опита. Дефицитът идва от храненето — тренировката пази мускула.' },
  { tags: ['goal:покачване на мускулна маса'], text: 'Хипертрофия: 10-20 работни серии на мускулна група седмично, 6-12 повторения при 65-80% 1RM, почивка 60-120 сек, близо до отказ (RIR 1-3). Прогресия: първо повторения в диапазона, после тежест. Всяка група 2x седмично е по-ефективно от 1x.' },
  { tags: ['goal:силови показатели'], text: 'Сила: акцент върху основни движения (клек, тяга, преси) при 75-90% 1RM, 3-6 повторения, пълна почивка 2-4 мин. Обемът на помощните упражнения умерен. Техниката е с абсолютен приоритет пред тежестта.' },
  { tags: ['goal:издръжливост'], text: 'Издръжливост: 60-70% обем в зона 2, 1-2 интервални сесии седмично. Силова поддръжка 2x седмично с 15-20 повторения или кръгов формат за мускулна издръжливост.' },
  { tags: ['goal:рекомпозиция'], text: 'Рекомпозиция: тренирай като за хипертрофия (обемът строи мускул), добави 1-2 кратки кардио/HIIT сесии. Реалистично темпо — бавна видима промяна, затова заложи измерими силови прогресии за мотивация.' },
  { tags: ['goal:обща кондиция'], text: 'Обща кондиция: балансиран микс — 2 дни цялостен силов тренинг, 1-2 дни кардио/функционален, 1 ден мобилност/активно възстановяване. Разнообразието поддържа придържането.' },
  { tags: ['goal:рехабилитация след травма'], text: 'Рехабилитация: работи само в безболезнен диапазон, изокинетичен контрол, ниска тежест/високи повторения (12-20), едностранни упражнения за балансиране на асиметрии. Изрично напомняй, че планът не замества физиотерапевт.' },
  { tags: ['level:начинаещ'], text: 'Начинаещи (0-6 мес): 2-3 тренировки за цяло тяло седмично, 8-12 серии на група седмично стигат. Машини и собствено тегло преди свободни тежести за сложните движения. Първите 4-6 седмици фокус върху техника, RIR 3-4.' },
  { tags: ['level:среден'], text: 'Среден опит (2–5 г): горна/долна част или push/pull/крака, 10–16 серии на група седмично, периодизация на интензитета (тежка/лека седмица или вълнообразна в рамките на седмицата).' },
  { tags: ['level:напреднал'], text: 'Напреднали (5+ г): специализация по приоритетни групи, 14-20+ серии за приоритетните, поддръжка за останалите. Интензификационни техники (drop sets, rest-pause, cluster) пестеливо — 1-2 на тренировка.' },
  { tags: ['health:хипертония', 'health:сърдечно-съдово'], text: 'ВАЖНО (сърдечно-съдов риск): избягвай продължителни изометрични задържания и Валсалва маньовър, без максимални единични опити. Дишането е непрекъснато, интензитет умерен (RPE ≤7), по-дълги почивки. Препоръчай медицинско одобрение преди старт.' },
  { tags: ['health:диабет'], text: 'Диабет/преддиабет: редовността е по-важна от интензитета. Комбинация сила + кардио подобрява инсулиновата чувствителност. Внимание при хипогликемия — тренировка след хранене, не на празен стомах.' },
  { tags: ['health:бременност'], text: 'КРИТИЧНО (бременност): планът трябва да е одобрен от лекар. Без упражнения по гръб след 1-ви триместър, без коремни кранчове, без задържане на дъха, без риск от падане/удар. Умерен интензитет ("можеш да говориш"). Тазово дъно и дишане с приоритет.' },
  { tags: ['health:следродилен'], text: 'Следродилен период: постепенно връщане — първо тазово дъно и дълбоки коремни, после базови движения. Внимание за диастаза — без класически коремни преси преди проверка. Интензитетът се вдига едва след 3+ месеца при добро възстановяване.' },
  { tags: ['health:кърмене'], text: 'Кърмене: умерен интензитет, добра хидратация, без тренировки до отказ. Внимание при тазово дъно и диастаза — консултирай при нужда.' },
  { tags: ['health:менопауза'], text: 'Менопауза: приоритизирай съпротивителен тренинг с по-високи тежести (костна плътност) и балансови елементи. Възстановяването е по-бавно — минимум 48ч между тежки сесии за същите групи.' },
  { tags: ['sleep:лошо', 'stress:висок'], text: 'Лош сън/висок стрес: намали обема с ~20% спрямо стандартната препоръка, избягвай тренировки до отказ, добави дихателни упражнения в cooldown. Възстановяването е лимитиращият фактор — не добавяй HIIT повече от 1x седмично.' },
  { tags: ['equipment:ограничено'], text: 'Ограничено оборудване: използвай tempo манипулация (3-1-3), unilateral варианти, mechanical drop sets и по-къси почивки за прогресивно натоварване без повече тежести.' },
  { tags: ['time:сутрин'], text: 'Сутрешни тренировки: удължи загрявката с 5 минути (ставна мобилност + постепенно вдигане на пулса) — тялото е по-сковано и вероятно на гладно. Тежките максимални опити са по-рискови рано сутрин.' },
  { tags: ['age:50+'], text: 'Възраст 50+: удължена загрявка, приоритет на контролирано темпо пред тежест, задължителни балансови и мобилност елементи, 48-72ч възстановяване между тежки сесии.' },
  { tags: ['gender:жена'], text: 'Жена: приоритет №1 дупе (glutes) — най-голям обем и форма (hip thrust, абдукция, kickback, RDL). Бедра стегнати, но по-малък обем от дупе. Горна част: само постура и стягане на гърба (ред, пулдаун, face pull) — без хипертрофия, без мъжки press/bench/curl. Не балансирай равномерно горна/долна част.' },
  { tags: ['gender:мъж'], text: 'Мъж: програмирай за мъжка анатомия и цели — основни многоставни (клек, тяга, натиск) са уместни според опита. Не използвай женски-специфични акценти (glute isolation focus) без указание от профила.' },
];

const TEXT_TAG_RULES = [
  { tag: 'goal:отслабване', keys: ['отслабване', 'липолиза', 'отслаб', 'сваля', 'дефицит', 'liss', 'goal:отслабване'] },
  { tag: 'goal:покачване на мускулна маса', keys: ['хипертрофия', 'мускулна маса', 'покачване на маса', 'volume driven', 'goal:покачване'] },
  { tag: 'goal:силови показатели', keys: ['силови показатели', 'силов тренинг', '1rm', 'goal:силови'] },
  { tag: 'goal:рехабилитация след травма', keys: ['рехабилитация', 'рехаб', 'след травма', 'goal:рехаб'] },
  { tag: 'goal:издръжливост', keys: ['издръжливост', 'zone 2', 'zone2', 'goal:издръжливост'] },
  { tag: 'goal:рекомпозиция', keys: ['рекомпозиция', 'оформяне', 'стягане', 'релеф', 'тонус', 'дефиниция', 'goal:рекомпозиция'] },
  { tag: 'goal:обща кондиция', keys: ['обща кондиция', 'goal:обща'] },
  { tag: 'health:хипертония', keys: ['хипертония', 'високо кръвно', 'health:хипертония'] },
  { tag: 'health:сърдечно-съдово', keys: ['сърдечно', 'cardio риск', 'health:сърдечно'] },
  { tag: 'health:диабет', keys: ['диабет', 'преддиабет', 'health:диабет'] },
  { tag: 'health:бременност', keys: ['бременн', 'триместър', 'health:бременност'] },
  { tag: 'health:следродилен', keys: ['следродил', 'след раждане', 'health:следродилен'] },
  { tag: 'health:кърмене', keys: ['кърмене', 'кърмя', 'health:кърмене'] },
  { tag: 'health:менопауза', keys: ['менопауза', 'перименопауза', 'health:менопауза'] },
  { tag: 'sleep:лошо', keys: ['лош сън', 'sleep:лошо', 'лошо сън'] },
  { tag: 'stress:висок', keys: ['висок стрес', 'стрес 8', 'стрес 9', 'стрес 10', 'stress:висок'] },
  { tag: 'equipment:ограничено', keys: ['ограничено оборудване', 'само дъмбели', 'собствено тегло', 'equipment:ограничено'] },
  { tag: 'time:сутрин', keys: ['сутрешн', 'time:сутрин'] },
  { tag: 'age:50+', keys: ['над 50', '50+', 'age:50', '50 години'] },
  { tag: 'gender:жена', keys: ['жена', 'жени', 'пол жена', 'gender:жена', 'female'] },
  { tag: 'gender:мъж', keys: ['мъж', 'мъже', 'пол мъж', 'gender:мъж', 'male'] },
];

const GOAL_TAG_BY_ANSWER = {
  'отслабване': 'goal:отслабване',
  'покачване на мускулна маса': 'goal:покачване на мускулна маса',
  'рекомпозиция': 'goal:рекомпозиция',
  'силови показатели': 'goal:силови показатели',
  'издръжливост': 'goal:издръжливост',
  'обща кондиция': 'goal:обща кондиция',
  'рехабилитация след травма': 'goal:рехабилитация след травма',
};

export function capGuidelineTexts(texts, maxItems = MAX_GUIDELINE_ITEMS, maxChars = MAX_GUIDELINE_CHARS) {
  const result = [];
  let total = 0;
  for (const text of texts) {
    const t = String(text || '').trim();
    if (!t) continue;
    if (result.length >= maxItems) break;
    const remaining = maxChars - total;
    if (remaining <= 0) break;
    const slice = t.length > remaining ? t.slice(0, remaining) : t;
    result.push(slice);
    total += slice.length;
  }
  return result;
}

/** Админ RAG chunks винаги влизат; hardcoded fallback се реже при лимит. */
function capIndividualGuidelines(adminTexts, hardcodedTexts, tagSet, adminChunks) {
  const admin = adminTexts.map((t) => String(t || '').trim()).filter(Boolean);
  const adminSet = new Set(admin);
  const merged = prioritizeGenderGuidelines(
    [...admin, ...hardcodedTexts.filter((t) => !adminSet.has(t))],
    tagSet,
    adminChunks,
  );
  const hardcodedOnly = merged.filter((t) => !adminSet.has(t));
  const adminChars = admin.join('').length;
  const hardcodedBudget = Math.max(0, MAX_GUIDELINE_CHARS - adminChars);
  const hardcodedCapped = capGuidelineTexts(
    hardcodedOnly,
    Math.max(0, MAX_GUIDELINE_ITEMS - admin.length),
    hardcodedBudget,
  );
  return capGuidelineTexts([...admin, ...hardcodedCapped], MAX_GUIDELINE_ITEMS, MAX_GUIDELINE_CHARS);
}

function isUniversal(tags) {
  return !tags?.length || tags.some((t) => UNIVERSAL_TAGS.has(t));
}

const STANDARD_TAG_RE = /^(gender|goal|level|health|sleep|stress|equipment|time|age):/;

export function isStandardMachineTag(tag) {
  return STANDARD_TAG_RE.test(String(tag || '').trim().toLowerCase());
}

/** Тагове от админ UI / KV — поправя счупени split-ове от запетая в „пол (в1, в12)“. */
export function parseChunkTags(raw) {
  if (Array.isArray(raw)) {
    return repairQuestionnaireTags(
      raw.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean),
    );
  }
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return [];
  if (/\(в\d/i.test(s)) return [s];
  return repairQuestionnaireTags(s.split(',').map((t) => t.trim()).filter(Boolean));
}

function repairQuestionnaireTags(tags) {
  if (!tags.length) return tags;
  const out = [];
  let buf = [];
  for (const tag of tags) {
    if (!buf.length && !tag.includes('(') && !tag.includes('в')) {
      out.push(tag);
      continue;
    }
    buf.push(tag);
    const joined = buf.join(', ');
    const opens = (joined.match(/\(/g) || []).length;
    const closes = (joined.match(/\)/g) || []).length;
    if (opens > 0 && opens <= closes) {
      out.push(joined);
      buf = [];
    }
  }
  if (buf.length) out.push(buf.join(', '));
  return [...new Set(out)];
}

function isQuestionnaireCategoryTag(tag) {
  const t = String(tag || '').trim().toLowerCase();
  if (isStandardMachineTag(t)) return false;
  return /\(в\d|в\d+[\s.,)\]]/.test(t) || /^[а-яёъюяґ\d\s().,\-—]+$/i.test(t);
}

export function hasClientScheme(exampleScheme) {
  return Boolean(String(exampleScheme || '').trim());
}

export function isStrictAssembly(strictScheme, exampleScheme) {
  return Boolean(strictScheme) && hasClientScheme(exampleScheme);
}

/** Админ chunks: questionnaire категории — само при съвпадение на пол; machine tags — филтър. */
export function shouldIncludeAdminChunk(chunk, tagSet) {
  const tags = chunk?.tags || [];
  if (!tags.length || isUniversal(tags)) return true;

  const stdTags = tags.filter(isStandardMachineTag);
  const categoryTags = tags.filter(isQuestionnaireCategoryTag);

  if (categoryTags.length > 0) {
    const tokens = new Set(normalizeText(chunk.text || '').split(' ').filter(Boolean));
    const femaleChunk = tokens.has('жена') || tokens.has('жени') || tokens.has('female');
    const maleChunk = tokens.has('мъж') || tokens.has('мъже') || tokens.has('male');
    if (femaleChunk && !tagSet.has('gender:жена')) return false;
    if (maleChunk && !tagSet.has('gender:мъж')) return false;
    return true;
  }
  if (stdTags.length > 0) return stdTags.some((t) => tagSet.has(t));
  return true;
}

/** Правила от треньора + RAG насоки → system prompt. */
export function buildTrainerSystemAddon(adminConfig, tagSet, layers = null, options = {}) {
  const strictAssembly = Boolean(options.strictAssembly);
  if (strictAssembly) return '';

  const schemeMode = Boolean(options.schemeMode);
  const foundation = String(adminConfig?.foundation || '').trim().slice(0, MAX_FOUNDATION_CHARS);
  const resolved = layers || resolveGuidelineLayers(tagSet, adminConfig, options);
  const individual = schemeMode ? [] : (resolved?.individual || []);
  const architecture = resolved?.architecture || [];

  if (!foundation && !individual.length && !architecture.length && !schemeMode) return '';

  const parts = ['<trainer_rules>'];
  if (schemeMode) {
    parts.push('<scheme> в user е задължителен шаблон — при конфликт scheme > тези правила.');
  } else {
    parts.push('Приоритет: individual_guidelines > architecture_guidelines.');
  }
  if (foundation) parts.push(`<foundation>\n${foundation}\n</foundation>`);
  if (individual.length) {
    parts.push(`<individual_guidelines>\n${individual.map((t) => `- ${t}`).join('\n')}\n</individual_guidelines>`);
  }
  if (architecture.length) {
    parts.push(`<architecture_guidelines>\n${architecture.map((t) => `- ${t}`).join('\n')}\n</architecture_guidelines>`);
  }
  parts.push('</trainer_rules>');
  return parts.join('\n\n');
}

/** Ниво от свободен текст — без фалшиви съвпадения (напр. „45 годишна“ ≠ 5+ год опит). */
function extractLevelTags(combined) {
  const tags = new Set();
  if (/\bсреден\b|средно\s+начинаещ|2\s*5\s*год/.test(combined)) {
    tags.add('level:среден');
    return tags;
  }
  if (/\bнапреднал\b|\b5\+\s*години\b|\bнад\s*5\s*години?\s+опит/.test(combined)) {
    tags.add('level:напреднал');
    return tags;
  }
  if ((/\bначинаещ\b|0\s*6\s*мес/.test(combined) || /\bникакъв\b/.test(combined)) && !/средно\s+начинаещ/.test(combined)) {
    tags.add('level:начинаещ');
  }
  return tags;
}

function extractAgeTag(combined) {
  const m = combined.match(/\b(\d{2})\s*(?:годишн|г(?:одини)?)\b/);
  const age = m ? Number(m[1]) : NaN;
  return Number.isFinite(age) && age >= 50 ? 'age:50+' : null;
}

/**
 * Извлича твърди ограничения от админ бриф (профил + схема).
 * Профилът е свободен текст — AI не винаги го „чете“; тук го структурираме като hard-veto.
 */
export function parseAdminBriefConstraints(clientProfile = '', exampleScheme = '') {
  const raw = [clientProfile, exampleScheme].filter(Boolean).join('\n');
  const equipmentList = [];
  const exclusions = [];
  const priorities = [];
  const schedule = [];

  const equipMatch = raw.match(/(?:уреди|оборудване)\s*[:：]\s*([^\n]+)/i);
  if (equipMatch) {
    for (const item of equipMatch[1].split(/[,;]/)) {
      const t = item.trim();
      if (t) equipmentList.push(t);
    }
  }

  for (const pattern of [
    /гърди\s+не[^.\n]*/gi,
    /без\s+гърди[^.\n]*/gi,
    /имплант[^.\n]*/gi,
    /без\s+страничн[иа]\s+рамен[ае][^.\n]*/gi,
    /без\s+(?:бърпи|клек|мъртв|преси|кранч|падан)[^.\n]*/gi,
    /не\s+(?:прави|правим|включвай|искам)[^.\n]*/gi,
    /избягвай[^.\n]*/gi,
    /забранено[^.\n]*/gi,
  ]) {
    for (const m of raw.match(pattern) || []) {
      const t = m.trim();
      if (t.length > 4) exclusions.push(t);
    }
  }

  for (const pattern of [
    /приоритет[^.\n]*/gi,
    /акцент[^.\n]*/gi,
    /фокус[^.\n]*/gi,
  ]) {
    for (const m of raw.match(pattern) || []) {
      const t = m.trim();
      if (t.length > 6) priorities.push(t);
    }
  }

  for (const pattern of [
    /\d+\s*тренировк[аи][^.\n]*/gi,
    /без\s+(?:събота|неделя)[^.\n]*/gi,
  ]) {
    for (const m of raw.match(pattern) || []) schedule.push(m.trim());
  }

  return {
    equipmentList: [...new Set(equipmentList)],
    exclusions: [...new Set(exclusions)],
    priorities: [...new Set(priorities)],
    schedule: [...new Set(schedule)],
  };
}

/** Ограничения от структурирани answers + схема на треньора. */
export function constraintsFromAnswers(answers, exampleScheme = '', options = {}) {
  const strictAssembly = Boolean(options.strictAssembly);
  const equipmentList = [];
  for (const e of answers?.equipment || []) {
    if (e && e !== 'Друго') equipmentList.push(e);
  }
  if (answers?.equipmentOther) {
    for (const part of String(answers.equipmentOther).split(/[,;\n]/)) {
      const t = part.trim();
      if (t) equipmentList.push(t);
    }
  }

  const exclusions = [];
  if (answers?.preferences?.avoid?.trim()) {
    exclusions.push(`Не желае движения: ${answers.preferences.avoid.trim()}`);
  }
  for (const lim of answers?.limitations || []) {
    if (lim && !normalizeText(lim).includes('нямам')) exclusions.push(`Ограничение: ${lim}`);
  }
  if (answers?.breastImplants?.implants) {
    const months = answers.breastImplants.implantMonths ? ` (${answers.breastImplants.implantMonths} мес. след операция)` : '';
    exclusions.push(`Гръдни импланти${months}: без натиск върху гърдите — без лежанки, флайс, кръстосани въдици, пуш-ъп, пек-дек, кабел кръстосване; само леки изолирани движения с леки тежести и без компресия`);
  }
  for (const h of [...(answers?.health || []), ...(answers?.healthFemale || [])]) {
    if (/бременн|кърм/i.test(h)) {
      exclusions.push('Бременност/кърмене: без коремни преси, без лежанки, без висок интензитет');
      break;
    }
  }

  const priorities = [];
  if (!strictAssembly) {
    const schemeMode = hasClientScheme(exampleScheme);
    const zoneText = String(answers?.goal?.zones || '').trim();
    if (!schemeMode) {
      if (zoneText) priorities.push(`Зони↓: ${zoneText}`);
      else if (normalizeText(answers?.gender || '').includes('жена')) {
        priorities.push('Дупе>бедра; горна: постура/гръб');
      }
    }
    if (answers?.extraInfo?.trim()) priorities.push(answers.extraInfo.trim());
  }

  const schedule = [];
  if (!strictAssembly) {
    if (answers?.preferences?.freq) schedule.push(`${answers.preferences.freq} тренировки седмично`);
    if (answers?.preferences?.duration) schedule.push(`Продължителност: ${answers.preferences.duration}`);
  }

  const fromScheme = parseAdminBriefConstraints('', exampleScheme);
  return {
    equipmentList: [...new Set([...equipmentList, ...fromScheme.equipmentList])],
    exclusions: [...new Set([...exclusions, ...fromScheme.exclusions])],
    priorities: strictAssembly ? [...fromScheme.priorities] : [...new Set([...priorities, ...fromScheme.priorities])],
    schedule: strictAssembly ? [...fromScheme.schedule] : [...new Set([...schedule, ...fromScheme.schedule])],
  };
}

const ADMIN_EQUIPMENT_HINTS = [
  { keys: ['скрипец', 'pulley', 'кабел', 'cable'], hints: ['cable'] },
  { keys: ['гирич', 'дъмбел', 'dumbbell'], hints: ['dumbbell'] },
  { keys: ['лост', 'щанг', 'barbell'], hints: ['barbell'] },
  { keys: ['машин', 'аддуктор', 'абдуктор', 'leg press', 'преса'], hints: ['leverage machine'] },
  { keys: ['степ', 'блокче'], hints: ['body weight'] },
  { keys: ['ластик', 'band', 'резист'], hints: ['band'] },
  { keys: ['гира', 'kettlebell'], hints: ['kettlebell'] },
  { keys: ['топка', 'ball'], hints: ['stability ball'] },
  { keys: ['trx', 'ремък', 'подвеск'], hints: ['body weight'] },
];

/** BG текст (чип или „Друго“) → EN equipmentHint токени за филтър/AI. */
export function equipmentHintTokensFromText(text) {
  const out = new Set();
  const n = normalizeText(text);
  if (!n) return out;
  for (const { keys, hints } of ADMIN_EQUIPMENT_HINTS) {
    if (keys.some((k) => n.includes(normalizeText(k)))) {
      for (const h of hints) out.add(normalizeText(h));
    }
  }
  return out;
}

export function expandEquipmentAnswers(equipmentAnswers) {
  const items = [];
  for (const answer of equipmentAnswers || []) {
    for (const part of String(answer).split(/[,;\n]/)) {
      const t = part.trim();
      if (t) items.push(t);
    }
  }
  return items;
}

/** Позволено оборудване от админ бриф (за post-filter на упражнения). */
export function allowedEquipmentFromBrief(clientProfile = '', exampleScheme = '') {
  const { equipmentList } = parseAdminBriefConstraints(clientProfile, exampleScheme);
  if (!equipmentList.length) return null;
  const set = new Set(['body weight']);
  for (const item of equipmentList) {
    for (const hint of equipmentHintTokensFromText(item)) set.add(hint);
  }
  return set.size > 1 ? set : null;
}

export function mergeAllowedEquipment(a, b) {
  if (a === null || b === null) return null;
  if (!a) return b || null;
  if (!b) return a || null;
  return new Set([...a, ...b]);
}

function buildAdminHardRulesBlock(constraints) {
  const parts = [];
  if (constraints.equipmentList?.length) {
    parts.push(
      'ЕДИНСТВЕНО ПОЗВОЛЕНО ОБОРУДВАНЕ (hard-veto — забранено е всичко извън списъка):',
      ...constraints.equipmentList.map((e) => `• ${e}`),
      'equipmentHint: cable за скрипец; leverage machine за машини; dumbbell за гирички; barbell само ако е изрично изброен лост/щанга.',
    );
  }
  if (constraints.exclusions?.length) {
    parts.push(
      'ЗАБРАНЕНИ ДВИЖЕНИЯ / МУСКУЛНИ ГРУПИ (hard-veto — 0 серии, 0 упражнения):',
      ...constraints.exclusions.map((e) => `• ${e}`),
    );
  }
  if (constraints.priorities?.length) {
    parts.push('ПРИОРИТЕТ:', ...constraints.priorities.map((p) => `• ${p}`));
  }
  if (constraints.schedule?.length) {
    parts.push(
      'ГРАФИК И СТРУКТУРА НА СЕДМИЦАТА:',
      ...constraints.schedule.map((s) => `• ${s}`),
    );
  }
  if (!parts.length) return '';
  return [
    '═══ ТВЪРДИ ПРАВИЛА ОТ ТРЕНЬОРА (hard-veto — над всичко друго) ═══',
    ...parts,
  ].join('\n');
}

/** Тагове от свободен текст (админ бриф). */
export function extractTagsFromText(...parts) {
  const combined = normalizeText(parts.filter(Boolean).join(' '));
  const tags = new Set();
  if (!combined) return tags;
  for (const { tag, keys } of TEXT_TAG_RULES) {
    if (tag.startsWith('level:') || tag === 'age:50+') continue;
    if (keys.some((k) => combined.includes(normalizeText(k)))) tags.add(tag);
  }
  for (const t of extractLevelTags(combined)) tags.add(t);
  const ageTag = extractAgeTag(combined);
  if (ageTag) tags.add(ageTag);

  const explicit = combined.match(/(?:goal|level|health|sleep|stress|equipment|time|age|gender):[a-zа-я0-9+-]+/gi) || [];
  for (const raw of explicit) tags.add(raw.toLowerCase().replace(/\s/g, ''));
  return tags;
}

/** Тагове от структуриран въпросник. */
export function buildTagsFromAnswers(answers) {
  const tags = new Set();
  const goal = normalizeText(answers?.goal?.main);
  if (goal && GOAL_TAG_BY_ANSWER[goal]) {
    tags.add(GOAL_TAG_BY_ANSWER[goal]);
  } else if (goal === 'друго' && answers?.goal?.other) {
    for (const t of extractTagsFromText(answers.goal.other)) tags.add(t);
  }

  const gender = normalizeText(answers?.gender || '');
  if (gender.includes('жена')) tags.add('gender:жена');
  else if (gender.includes('мъж')) tags.add('gender:мъж');

  const exp = normalizeText(answers?.experience || '');
  if (exp.includes('никакъв') || exp.includes('начинаещ')) tags.add('level:начинаещ');
  else if (exp.includes('напреднал')) tags.add('level:напреднал');
  else if (exp.includes('среден')) tags.add('level:среден');

  const health = [...(answers?.health || []), ...(answers?.healthFemale || [])].map(normalizeText).join(' ');
  if (health.includes('хипертония')) tags.add('health:хипертония');
  if (health.includes('сърдечно')) tags.add('health:сърдечно-съдово');
  if (health.includes('диабет')) tags.add('health:диабет');
  if (health.includes('бременн')) tags.add('health:бременност');
  if (health.includes('следродил') || health.includes('след раждане')) tags.add('health:следродилен');
  if (health.includes('кърмене') || health.includes('кърмя')) tags.add('health:кърмене');
  if (health.includes('менопауза')) tags.add('health:менопауза');

  if (normalizeText(answers?.sleep || '').includes('лошо') || Number(answers?.stress) >= 8) {
    tags.add('sleep:лошо');
    tags.add('stress:висок');
  }

  const equipment = answers?.equipment || [];
  const hasGym = equipment.some((e) => normalizeText(e).includes('зала'));
  if (!hasGym && equipment.length <= 2) tags.add('equipment:ограничено');

  if (normalizeText(answers?.preferences?.timeOfDay || '').includes('сутрин')) tags.add('time:сутрин');
  if (Number(answers?.age) >= 50) tags.add('age:50+');

  const freeText = [
    answers?.goal?.other,
    answers?.extraInfo,
    answers?.preferences?.avoid,
    answers?.healthOther,
    ...(answers?.limitations || []),
  ].filter(Boolean).join(' ');
  for (const t of extractTagsFromText(freeText)) tags.add(t);

  return tags;
}

function prioritizeGenderGuidelines(individual, tagSet, adminChunks) {
  const genderTag = tagSet.has('gender:жена') ? 'gender:жена' : tagSet.has('gender:мъж') ? 'gender:мъж' : null;
  if (!genderTag) return individual;
  const genderTexts = [];
  for (const chunk of adminChunks) {
    if (chunk.tags?.includes(genderTag) && chunk.text) genderTexts.push(chunk.text);
  }
  const hardcodedGender = GUIDELINE_CHUNKS.find((c) => c.tags.includes(genderTag))?.text;
  if (hardcodedGender) genderTexts.push(hardcodedGender);
  const uniqueGender = [...new Set(genderTexts)];
  const rest = individual.filter((t) => !uniqueGender.includes(t));
  return [...uniqueGender, ...rest];
}

/** Два слоя насоки: individual (таг) + architecture (universal). Foundation се добавя при prompt build. */
export function resolveGuidelineLayers(tags, adminConfig = null, options = {}) {
  const strictAssembly = Boolean(options.strictAssembly);
  const schemeMode = Boolean(options.schemeMode) || strictAssembly;
  const tagSet = tags instanceof Set ? tags : new Set(tags);
  const adminChunks = Array.isArray(adminConfig?.chunks) ? adminConfig.chunks : [];
  const adminTagged = new Set(adminChunks.flatMap((c) => c.tags || []));
  const adminCoversGender = adminChunks.some(
    (c) => shouldIncludeAdminChunk(c, tagSet) && /пол|gender|жена|мъж/i.test(`${(c.tags || []).join(' ')} ${c.text}`),
  );

  const adminIndividual = [];
  const adminArchitecture = [];
  const hardcodedIndividual = [];
  const seen = new Set();
  const push = (list, text) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    list.push(text);
  };

  for (const chunk of adminChunks) {
    if (!chunk.text || !shouldIncludeAdminChunk(chunk, tagSet)) continue;
    if (isUniversal(chunk.tags)) push(adminArchitecture, chunk.text);
    else if (!schemeMode) push(adminIndividual, chunk.text);
  }

  if (!schemeMode) {
    for (const chunk of GUIDELINE_CHUNKS) {
      if (!chunk.tags.some((t) => tagSet.has(t))) continue;
      if (chunk.tags.some((t) => adminTagged.has(t))) continue;
      if (adminCoversGender && chunk.tags.some((t) => t.startsWith('gender:'))) continue;
      push(hardcodedIndividual, chunk.text);
    }
  }

  return {
    individual: (schemeMode || strictAssembly)
      ? []
      : capIndividualGuidelines(adminIndividual, hardcodedIndividual, tagSet, adminChunks),
    architecture: strictAssembly
      ? []
      : capGuidelineTexts(adminArchitecture, MAX_ARCHITECTURE_ITEMS, MAX_ARCHITECTURE_CHARS),
  };
}

export function selectGuidelines(profile, adminConfig = null) {
  return resolveGuidelineLayers(buildTagsFromAnswers(profile), adminConfig);
}

export function selectGuidelinesFromBrief(record, adminConfig = null) {
  const tags = extractTagsFromText(record?.clientProfile, record?.exampleScheme);
  return resolveGuidelineLayers(tags, adminConfig);
}

export function buildBriefIdentityBlock(brief) {
  const profile = String(brief?.clientProfile || '').trim();
  const scheme = String(brief?.exampleScheme || '').trim();
  const tags = brief?.tags instanceof Set
    ? brief.tags
    : Array.isArray(brief?.tags)
      ? new Set(brief.tags)
      : extractTagsFromText(profile, scheme);
  const tagList = [...tags].sort().join(', ') || '—';
  return `<tags>${tagList}</tags>`;
}

/** User prompt: контекст + задача. strictAssembly = само scheme. */
export function buildAdminPlanUserPrompt(brief, options = {}) {
  const strictAssembly = Boolean(options.strictAssembly);
  const hasScheme = Boolean(String(brief?.exampleScheme || '').trim());
  const { clientProfile = '', exampleScheme = '', constraints: presetConstraints, programSpec } = brief || {};
  const scheme = String(exampleScheme || '').trim();
  const constraints = presetConstraints || parseAdminBriefConstraints(
    strictAssembly ? '' : clientProfile,
    scheme,
  );
  const hardRules = buildAdminHardRulesBlock(constraints);

  const parts = [buildBriefIdentityBlock(brief)];
  if (scheme) parts.push(`<scheme>\n${scheme}\n</scheme>`);
  if (!strictAssembly) {
    if (constraints.equipmentList?.length) {
      parts.push(`<equipment>\n${constraints.equipmentList.join(', ')}\n</equipment>`);
    }
    if (hardRules) parts.push(`<constraints>\n${hardRules}\n</constraints>`);
    if (programSpec && !hasScheme) {
      parts.push(`<program_spec>\n${formatProgramSpecBlock(programSpec)}\n</program_spec>`);
    }
    const compactProfile = brief?.compactProfile?.trim()
      || (programSpec ? '' : String(clientProfile || '').trim());
    if (compactProfile) {
      parts.push(`<profile>\n${compactProfile}\n</profile>`);
    }
  } else if (hardRules) {
    parts.push(`<constraints>\n${hardRules}\n</constraints>`);
  }

  const task = strictAssembly
    ? 'ASSEMBLY: сглоби JSON от <scheme> буквално. Само canonicalName/displayName. JSON само.'
    : (scheme
      ? 'Следвай <scheme> точно (дни, упражнения, обем). Запълни 7 дни. JSON само.'
      : 'От <program_spec> + <exercise_catalog>: 7 дни, canonicalName САМО от каталога, sets/reps/rest по spec. JSON само.');
  return `${parts.join('\n\n')}\n\n${task}`;
}

const MALE_BIAS_EXERCISE = /bench press|incline bench|decline bench|skull crush|close.?grip bench|barbell curl|military press|overhead press|shoulder press|tricep extension|bicep curl/i;
const GLUTE_FOCUS_EXERCISE = /hip thrust|glute bridge|glute|abduct|kickback|clam|fire hydrant|frog pump|pull.?through/i;
const GLUTE_SUPPORT_EXERCISE = /romanian deadlift|rdl|bulgarian split|step.?up|hamstring curl|leg curl/i;
const THIGH_VOLUME_EXERCISE = /squat|lunge|leg press|leg extension|hack squat|front squat|goblet squat/i;

/** Проверка дали планът съответства на пола на клиента (след AI генерация). */
export function auditPlanGenderFit(plan, clientTags) {
  const tagSet = clientTags instanceof Set ? clientTags : new Set(clientTags || []);
  if (!tagSet.has('gender:жена')) return { ok: true, issues: [] };

  const exercises = [];
  for (const day of plan?.days || []) {
    if (day.type === 'rest') continue;
    for (const ex of day.exercises || []) {
      exercises.push(String(ex.canonicalName || ex.displayName || '').trim());
    }
  }
  if (!exercises.length) return { ok: true, issues: [] };

  const gluteFocus = exercises.filter((name) => GLUTE_FOCUS_EXERCISE.test(name) || GLUTE_SUPPORT_EXERCISE.test(name));
  const thighVolume = exercises.filter((name) => THIGH_VOLUME_EXERCISE.test(name));
  const maleBias = exercises.filter((name) => MALE_BIAS_EXERCISE.test(name));
  const issues = [];

  if (maleBias.length >= 2) {
    issues.push(`Прекалено мъжки горен обем (${maleBias.length} press/bench/curl упражнения) — за жена само постура/гръб.`);
  }
  if (gluteFocus.length < Math.max(2, Math.ceil(exercises.length * 0.3))) {
    issues.push(`Недостатъчен приоритет на дупе: ${gluteFocus.length}/${exercises.length} упражнения (очаква се ≥30%).`);
  }
  if (thighVolume.length > gluteFocus.length) {
    issues.push(`Бедрата имат повече обем от дупе: ${thighVolume.length} бедрени vs ${gluteFocus.length} за дупе.`);
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Единна подготовка за AI генерация.
 * @param source — { answers } от въпросник ИЛИ { clientProfile, exampleScheme, clientName?, clientContact? } от админ
 */
export function preparePlanGeneration(source, adminConfig, helpers) {
  function buildFromAnswers(answers, extra = {}) {
    const profileText = answers?.gender ? helpers.buildProfileSummary(answers) : '';
    const tags = answers?.gender ? buildTagsFromAnswers(answers) : new Set();
    const strictAssembly = isStrictAssembly(extra.strictScheme, extra.exampleScheme);
    const schemeMode = strictAssembly || hasClientScheme(extra.exampleScheme);
    const layers = resolveGuidelineLayers(tags, adminConfig, { schemeMode, strictAssembly });
    const programSpec = (!strictAssembly && !schemeMode && answers?.gender)
      ? buildProgramSpec(answers)
      : null;
    const brief = {
      clientProfile: profileText,
      compactProfile: programSpec ? buildCompactProfileForPrompt(answers) : profileText,
      exampleScheme: extra.exampleScheme || '',
      constraints: constraintsFromAnswers(answers || {}, extra.exampleScheme || '', { strictAssembly }),
      tags,
      programSpec,
    };
    const equipmentInput = expandEquipmentAnswers([...(answers?.equipment || []), answers?.equipmentOther].filter(Boolean));
    const fromBrief = allowedEquipmentFromBrief(profileText, extra.exampleScheme || '');
    const fromAnswers = helpers.allowedEquipmentSet(equipmentInput);
    return {
      userPrompt: buildAdminPlanUserPrompt(brief, { strictAssembly }),
      guidelineLayers: layers,
      coachProfileText: extra.coachProfileText || profileText,
      allowedEquipment: mergeAllowedEquipment(fromBrief, fromAnswers),
      clientTags: tags,
      hasScheme: schemeMode,
      strictAssembly,
      exerciseProfile: answers?.gender ? exerciseProfileFromAnswers(answers) : null,
    };
  }

  if (source.clientAnswers || source.strictScheme) {
    const answers = source.clientAnswers || {};
    const profileText = answers.gender ? helpers.buildProfileSummary(answers) : '';
    const coachProfileText = [
      source.clientName ? `Клиент: ${source.clientName}` : 'Клиент: —',
      source.clientContact ? `Контакт: ${source.clientContact}` : '',
      profileText ? `\n${profileText}` : '',
      source.exampleScheme ? `\nСхема:\n${source.exampleScheme}` : '',
    ].filter(Boolean).join('\n');
    return buildFromAnswers(answers, {
      exampleScheme: source.exampleScheme || '',
      coachProfileText,
      strictScheme: source.strictScheme,
    });
  }

  if (source.answers) {
    return buildFromAnswers(source.answers);
  }

  throw new Error('preparePlanGeneration: липсват answers или clientAnswers');
}
