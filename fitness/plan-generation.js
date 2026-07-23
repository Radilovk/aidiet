/**
 * KA-TRAINER — единен pipeline за генериране на план.
 *
 * Архитектура (един AI call + до 3 retry при audit):
 *   КОД (детерминистично): ProgramSpec, EFP каталог, constraints, equipment, audit
 *   AI (една заявка): избор упражнения от каталог + warmup/cooldown текст + JSON
 *   Няма нужда от multi-step AI — числата и veto-тата идват от кода.
 *
 * Два входа: въпросник (answers) | админ бриф (clientProfile + scheme)
 */

import { normalizeText } from './normalize.js';
import { buildProfileSummary } from './profile-summary.js';
import { exerciseProfileFromContext, fitsExerciseProfile } from './exercise-metadata.js';
import {
  GENDER_FIT_RETRY_HINT,
  CONSTRAINT_RETRY_HINT,
  EQUIPMENT_RETRY_HINT,
  SESSION_STRUCTURE_RETRY_HINT,
  DIFF_RETRY_HINT,
} from './plan-prompts.js';
import {
  buildProgramSpec,
  formatProgramSpecBlock,
  buildCompactProfileForPrompt,
} from './program-spec.js';

export {
  GENDER_FIT_RETRY_HINT,
  CONSTRAINT_RETRY_HINT,
  EQUIPMENT_RETRY_HINT,
  SESSION_STRUCTURE_RETRY_HINT,
  DIFF_RETRY_HINT,
};

export const MAX_FOUNDATION_CHARS = 800;
export const MAX_GUIDELINE_ITEMS = 12;
export const MAX_GUIDELINE_CHARS = 3600;
export const MAX_ARCHITECTURE_ITEMS = 8;
export const MAX_ARCHITECTURE_CHARS = 2800;

const UNIVERSAL_TAGS = new Set(['all', '*', 'общо']);

/** RAG насоки — само health/safety/edge; goal/level/gender са в ProgramSpec + audit. */
export const GUIDELINE_CHUNKS = [
  { tags: ['goal:рехабилитация след травма'], text: 'Рехаб: безболезнен ROM; не замества физиотерапевт.' },
  { tags: ['health:хипертония', 'health:сърдечно-съдово'], text: 'Сърдечно-съдов риск: без Valsalva/mакс singles; rpe≤spec; safetyNotes: лекарско одобрение.' },
  { tags: ['health:диабет'], text: 'Диабет: редовност > интензитет; внимание при хипогликемия.' },
  { tags: ['health:бременност'], text: 'Бременност: лекарско одобрение. Без кранчове, лежанки по гръб (след 1-ви трим.), задържане на дъха, падания.' },
  { tags: ['health:следродилен'], text: 'След раждане: тазово дъно → базови движения; без класически преси при съмнение за диастаза.' },
  { tags: ['health:кърмене'], text: 'Кърмене: умерен интензитет; без тренировки до отказ.' },
  { tags: ['health:менопауза'], text: 'Менопауза: силов акцент (кости); 48ч между тежки сесии за една група.' },
  { tags: ['sleep:лошо', 'stress:висок'], text: 'Лош сън/стрес: -20% обем под spec; макс 1 HIIT/седм.' },
  { tags: ['equipment:ограничено'], text: 'Ограничено оборудване: tempo/unilateral вместо повече тежест.' },
  { tags: ['time:сутрин'], text: 'Сутрин: +5 мин warmup; без макс на гладно.' },
  { tags: ['age:50+'], text: '50+: удължена warmup; 48–72ч между тежки сесии.' },
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

const EXERCISE_LINE_RE = /(\d+\s*[x×х]\s*\d+|\d+\s*серии|\d+\s*по\s*\d+|sets?\s*[:=]?\s*\d+)/i;
const DAY_LINE_RE = /^(пон|вто|сря|чет|пет|съб|нед|mon|tue|wed|thu|fri|sat|sun|ден\s*\d|day\s*\d)/i;

/**
 * brief — свободен текст (уреди, акценти); structured — дни/упражнения/серии.
 * Brief НЕ е абсолютна схема — ProgramSpec + каталог остават активни.
 */
export function classifySchemeInput(schemeText = '') {
  const raw = String(schemeText || '').trim();
  if (!raw) return 'none';
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let exerciseLines = 0;
  let hasDay = false;
  for (const line of lines) {
    if (EXERCISE_LINE_RE.test(line)) exerciseLines++;
    if (DAY_LINE_RE.test(line)) hasDay = true;
  }
  if (exerciseLines === 0 && EXERCISE_LINE_RE.test(raw)) exerciseLines = 1;
  if (exerciseLines >= 2 || (hasDay && exerciseLines >= 1)) return 'structured';
  return 'brief';
}

export function isStructuredScheme(exampleScheme) {
  return classifySchemeInput(exampleScheme) === 'structured';
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
  const individual = resolved?.individual || [];
  const architecture = resolved?.architecture || [];

  if (!foundation && !individual.length && !architecture.length && !schemeMode) return '';

  const parts = ['<trainer_rules>'];
  if (schemeMode) {
    parts.push('Схемата е абсолютна. Тук само делта — без промяна на дни/обем/упражнения.');
  } else {
    parts.push('Само делта над program_spec. individual > architecture.');
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
  // zones, female bias, freq/duration, extraInfo → program_spec + profile (не дублираме тук)

  const schedule = [];

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

export function mergeAllowedEquipment(fromBrief, fromAnswers) {
  // Изрични уреди в схема/бриф имат приоритет над „пълна зала“ от въпросника
  if (fromBrief?.size) return fromBrief;
  return fromAnswers ?? null;
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
  return ['HARD-VETO (над program_spec и trainer_rules):', ...parts].join('\n');
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
    else push(adminIndividual, chunk.text);
  }

  if (!schemeMode) {
    for (const chunk of GUIDELINE_CHUNKS) {
      if (!chunk.tags.some((t) => tagSet.has(t))) continue;
      if (chunk.tags.some((t) => adminTagged.has(t))) continue;
      if (adminCoversGender && chunk.tags.some((t) => t.startsWith('gender:'))) continue;
      push(hardcodedIndividual, chunk.text);
    }
  }

  const individual = strictAssembly
    ? []
    : schemeMode
      ? capGuidelineTexts(adminIndividual)
      : capIndividualGuidelines(adminIndividual, hardcodedIndividual, tagSet, adminChunks);

  return {
    individual,
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
  const { clientProfile = '', exampleScheme = '', trainerBrief = '', constraints: presetConstraints, programSpec } = brief || {};
  const scheme = String(exampleScheme || '').trim();
  const briefText = String(trainerBrief || '').trim();
  const hasStructuredScheme = Boolean(scheme);
  const constraints = presetConstraints || parseAdminBriefConstraints(
    strictAssembly ? '' : clientProfile,
    [scheme, briefText].filter(Boolean).join('\n'),
  );
  const hardRules = buildAdminHardRulesBlock(constraints);

  const parts = [buildBriefIdentityBlock(brief)];
  if (scheme) parts.push(`<scheme>\n${scheme}\n</scheme>`);
  if (briefText) parts.push(`<trainer_brief>\n${briefText}\n</trainer_brief>`);
  if (!strictAssembly) {
    if (constraints.equipmentList?.length) {
      parts.push(`<equipment>\n${constraints.equipmentList.join(', ')}\n</equipment>`);
    }
    if (hardRules) parts.push(`<constraints>\n${hardRules}\n</constraints>`);
    if (programSpec) {
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
    ? 'ASSEMBLY: сглоби JSON от <scheme> буквално. canonicalName + displayName. JSON само.'
    : (hasStructuredScheme
      ? 'Следвай <scheme> точно. Запълни 7 дни. JSON само.'
      : 'Генерирай 7 дни от <program_spec> + <exercise_catalog>. canonicalName САМО от каталога. volume/reps/rest/order/logic по spec — обоснован подход, без случайни упражнения. JSON само.');
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

const HEAVY_COMPOUND_RE = /bench press|barbell squat|back squat|deadlift|hip thrust|leg press/i;

/** dayFocus + задължителна структура warmup/exercises/cooldown; без veto за стреч/кардио в сесия. */
export function auditPlanSessionStructure(plan, programSpec = null) {
  const dayTypes = programSpec?.dayTypes;
  if (!dayTypes?.length) return [];
  const typeByDay = new Map(dayTypes.map((d) => [normalizeText(d.day), d.type]));
  const issues = [];
  for (const day of plan?.days || []) {
    const key = normalizeText(day.day);
    const expected = typeByDay.get(key);
    if (!expected || expected === 'rest') continue;
    const sessionType = day.type || expected;
    if (sessionType !== expected) {
      issues.push(`${day.day}: dayFocus ${sessionType} ≠ очакван ${expected} от program_spec`);
    }
    if (day.type === 'rest' && !(day.exercises?.length)) continue;
    if (!day.warmup?.length) issues.push(`${day.day}: липсва warmup (3 стъпки)`);
    if (!day.cooldown?.length) issues.push(`${day.day}: липсва cooldown (3 стъпки)`);
    if (expected === 'mobility') {
      for (const ex of day.exercises || []) {
        const name = String(ex.canonicalName || ex.displayName || '');
        if (HEAVY_COMPOUND_RE.test(name)) {
          issues.push(`${day.day}: „${name}“ не е за основен mobility блок — премести в силов ден или махни`);
        }
      }
    }
  }
  return issues;
}

/** Проверка d/gf/gm на избраните упражнения спрямо индекса. */
export function auditPlanExerciseProfile(plan, exerciseProfile, index = []) {
  if (!exerciseProfile || !index?.length) return [];
  const byNorm = new Map(index.map((e) => [normalizeText(e.name), e]));
  const issues = [];
  for (const day of plan?.days || []) {
    if (day.type === 'rest') continue;
    for (const ex of day.exercises || []) {
      const name = String(ex.canonicalName || ex.displayName || '');
      const entry = byNorm.get(normalizeText(name));
      if (!entry) continue;
      if (!fitsExerciseProfile(entry, exerciseProfile)) {
        issues.push(`${day.day}: „${name}“ d${entry.diff ?? 2} > max d${exerciseProfile.maxDiff} от spec`);
      }
    }
  }
  return issues;
}

const CHEST_IMPLANT_RE = /bench|fly|chest press|push-?up|pec deck|crossover|dip|пек.?дек|избутване от лежанка|лъжичк/i;
const LATERAL_RAISE_RE = /lateral raise|side raise|страничн/i;

/** Hard-veto: импланти, avoid, оборудване. */
export function auditPlanConstraints(plan, constraints = {}) {
  const issues = [];
  const exclusions = constraints?.exclusions || [];
  const blob = exclusions.join(' ').toLowerCase();
  const implantRule = /имплант|гърди не|без натиск върху гърдите/i.test(blob);
  const avoidLateral = /страничн/i.test(blob) || exclusions.some((e) => /не желае.*страничн/i.test(e));

  for (const day of plan?.days || []) {
    if (day.type === 'rest') continue;
    for (const ex of day.exercises || []) {
      const name = String(ex.canonicalName || ex.displayName || '');
      if (implantRule && CHEST_IMPLANT_RE.test(name)) {
        issues.push(`Забранено (импланти/гърди): ${name}`);
      }
      if (avoidLateral && LATERAL_RAISE_RE.test(name)) {
        issues.push(`Забранено движение: ${name}`);
      }
    }
  }
  return issues;
}

export function auditPlanEquipment(plan, allowedEquipment) {
  if (!allowedEquipment?.size) return { ok: true, issues: [] };
  const issues = [];
  for (const day of plan?.days || []) {
    if (day.type === 'rest') continue;
    for (const ex of day.exercises || []) {
      const hint = normalizeText(ex.equipmentHint || '');
      if (!hint) continue;
      if (allowedEquipment.has(hint)) continue;
      const ok = [...allowedEquipment].some((a) => hint.includes(a) || a.includes(hint));
      if (!ok) {
        issues.push(`Непозволено оборудване: ${ex.canonicalName || ex.displayName} (${ex.equipmentHint})`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Обединен post-AI audit + retry hint. */
export function auditPlan(plan, {
  clientTags = null,
  constraints = null,
  allowedEquipment = null,
  programSpec = null,
  exerciseProfile = null,
  exerciseIndex = null,
} = {}) {
  const issues = [];
  const gender = auditPlanGenderFit(plan, clientTags);
  if (!gender.ok) issues.push(...gender.issues);
  issues.push(...auditPlanConstraints(plan, constraints || {}));
  issues.push(...auditPlanSessionStructure(plan, programSpec));
  issues.push(...auditPlanExerciseProfile(plan, exerciseProfile, exerciseIndex));
  const equip = auditPlanEquipment(plan, allowedEquipment);
  if (!equip.ok) issues.push(...equip.issues);
  return { ok: issues.length === 0, issues };
}

export function auditRetryHint(issues = []) {
  const joined = issues.join(' ');
  if (/d\d.*> max|maxDiff|d≤/i.test(joined)) return DIFF_RETRY_HINT;
  if (/dayFocus|warmup|cooldown|session_principles|основен mobility/i.test(joined)) return SESSION_STRUCTURE_RETRY_HINT;
  if (/имплант|забранено|гърди/i.test(joined)) return CONSTRAINT_RETRY_HINT;
  if (/оборудване/i.test(joined)) return EQUIPMENT_RETRY_HINT;
  if (/дупе|мъжки|bench|press/i.test(joined)) return GENDER_FIT_RETRY_HINT;
  return CONSTRAINT_RETRY_HINT;
}

/**
 * Единна подготовка за AI генерация.
 * @param source — { answers } от въпросник ИЛИ { clientProfile, exampleScheme, clientName?, clientContact? } от админ
 */
export function preparePlanGeneration(source, adminConfig, helpers) {
  function buildFromAnswers(answers, extra = {}) {
    const profileText = answers?.gender ? helpers.buildProfileSummary(answers) : '';
    const tags = answers?.gender ? buildTagsFromAnswers(answers) : new Set();
    const schemeText = String(extra.exampleScheme || '').trim();
    const schemeKind = classifySchemeInput(schemeText);
    for (const t of extractTagsFromText(profileText, schemeText)) {
      if (t.startsWith('goal:') && [...tags].some((x) => x.startsWith('goal:'))) continue;
      tags.add(t);
    }
    const strictAssembly = isStrictAssembly(extra.strictScheme, schemeText);
    const structuredScheme = schemeKind === 'structured';
    const schemeMode = strictAssembly || structuredScheme;
    const layers = resolveGuidelineLayers(tags, adminConfig, { schemeMode, strictAssembly });
    const programSpec = (!strictAssembly && answers?.gender) ? buildProgramSpec(answers) : null;
    const planConstraints = constraintsFromAnswers(answers || {}, schemeText, { strictAssembly });
    const brief = {
      clientProfile: profileText,
      compactProfile: programSpec ? buildCompactProfileForPrompt(answers) : profileText,
      exampleScheme: structuredScheme ? schemeText : '',
      trainerBrief: schemeKind === 'brief' ? schemeText : '',
      constraints: planConstraints,
      tags,
      programSpec,
    };
    const equipmentInput = expandEquipmentAnswers([...(answers?.equipment || []), answers?.equipmentOther].filter(Boolean));
    const fromBrief = allowedEquipmentFromBrief(profileText, schemeText);
    const fromAnswers = helpers.allowedEquipmentSet(equipmentInput);
    return {
      userPrompt: buildAdminPlanUserPrompt(brief, { strictAssembly }),
      guidelineLayers: layers,
      coachProfileText: extra.coachProfileText || profileText,
      allowedEquipment: mergeAllowedEquipment(fromBrief, fromAnswers),
      clientTags: tags,
      hasScheme: structuredScheme,
      strictAssembly,
      exerciseProfile: strictAssembly ? null : exerciseProfileFromContext({
        answers,
        tags,
        profileText: [profileText, schemeText].filter(Boolean).join('\n'),
      }),
      constraints: planConstraints,
      schemeKind,
      programSpec,
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
