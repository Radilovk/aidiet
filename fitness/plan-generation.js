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

export const MAX_FOUNDATION_CHARS = 800;
export const MAX_GUIDELINE_ITEMS = 8;
export const MAX_GUIDELINE_CHARS = 2400;

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
  { tags: ['gender:жена'], text: 'Жена: програмирай за женска физиология и цели — не копирай типичен мъжки powerlifting/bro-split. Приоритет: долна част (glutes, бедра), core и тазово дъно, горен гръб/posture; умерен обем на гръдобедрен без мъжки press-dominant акцент. При дефицит/отслабване — запази мускул на краката и glutes. Ако е посочен цикъл/хормони — варирай интензитета.' },
  { tags: ['gender:мъж'], text: 'Мъж: програмирай за мъжка анатомия и цели — основни многоставни (клек, тяга, натиск) са уместни според опита. Не използвай женски-специфични акценти (glute isolation focus) без указание от профила.' },
];

const TEXT_TAG_RULES = [
  { tag: 'goal:отслабване', keys: ['отслабване', 'липолиза', 'отслаб', 'сваля', 'дефицит', 'liss', 'goal:отслабване'] },
  { tag: 'goal:покачване на мускулна маса', keys: ['хипертрофия', 'мускулна маса', 'покачване на маса', 'volume driven', 'goal:покачване'] },
  { tag: 'goal:силови показатели', keys: ['силови показатели', 'силов тренинг', '1rm', 'goal:силови'] },
  { tag: 'goal:рехабилитация след травма', keys: ['рехабилитация', 'рехаб', 'след травма', 'goal:рехаб'] },
  { tag: 'goal:издръжливост', keys: ['издръжливост', 'zone 2', 'zone2', 'goal:издръжливост'] },
  { tag: 'goal:рекомпозиция', keys: ['рекомпозиция', 'goal:рекомпозиция'] },
  { tag: 'goal:обща кондиция', keys: ['обща кондиция', 'goal:обща'] },
  { tag: 'level:начинаещ', keys: ['начинаещ', '0-6 мес', 'level:начинаещ'] },
  { tag: 'level:среден', keys: ['среден опит', '2-5 год', 'level:среден'] },
  { tag: 'level:напреднал', keys: ['напреднал', '5+ год', 'level:напреднал'] },
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
  { tag: 'age:50+', keys: ['над 50', '50+', 'age:50'] },
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

function isUniversal(tags) {
  return !tags?.length || tags.some((t) => UNIVERSAL_TAGS.has(t));
}

/** Тагове от свободен текст (админ бриф). */
export function extractTagsFromText(...parts) {
  const combined = normalizeText(parts.filter(Boolean).join(' '));
  const tags = new Set();
  if (!combined) return tags;
  for (const { tag, keys } of TEXT_TAG_RULES) {
    if (keys.some((k) => combined.includes(normalizeText(k)))) tags.add(tag);
  }
  const explicit = combined.match(/(?:goal|level|health|sleep|stress|equipment|time|age|gender):[a-zа-я0-9+-]+/gi) || [];
  for (const raw of explicit) tags.add(raw.toLowerCase().replace(/\s/g, ''));
  return tags;
}

/** Тагове от структуриран въпросник. */
export function buildTagsFromAnswers(answers) {
  const tags = new Set();
  const goal = normalizeText(answers?.goal?.main);
  if (goal && GOAL_TAG_BY_ANSWER[goal]) tags.add(GOAL_TAG_BY_ANSWER[goal]);

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

  return tags;
}

function collectTags(source) {
  if (source.answers) return buildTagsFromAnswers(source.answers);
  return extractTagsFromText(source.clientProfile, source.exampleScheme);
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
export function resolveGuidelineLayers(tags, adminConfig = null) {
  const tagSet = tags instanceof Set ? tags : new Set(tags);
  const adminChunks = Array.isArray(adminConfig?.chunks) ? adminConfig.chunks : [];
  const adminTagged = new Set(adminChunks.flatMap((c) => c.tags || []));

  const individual = [];
  const architecture = [];
  const seen = new Set();
  const push = (list, text) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    list.push(text);
  };

  for (const chunk of adminChunks) {
    if (!chunk.text) continue;
    if (isUniversal(chunk.tags)) push(architecture, chunk.text);
    else if (chunk.tags.some((t) => tagSet.has(t))) push(individual, chunk.text);
  }

  for (const chunk of GUIDELINE_CHUNKS) {
    if (!chunk.tags.some((t) => tagSet.has(t))) continue;
    if (chunk.tags.some((t) => adminTagged.has(t))) continue;
    push(individual, chunk.text);
  }

  return {
    individual: capGuidelineTexts(prioritizeGenderGuidelines(individual, tagSet, adminChunks)),
    architecture: capGuidelineTexts(architecture, 6, 2000),
  };
}

export const selectGuidelineLayers = resolveGuidelineLayers;

export function pickGuidelineTexts(tags, adminConfig = null) {
  return resolveGuidelineLayers(tags, adminConfig).individual;
}

export function selectGuidelines(profile, adminConfig = null) {
  return resolveGuidelineLayers(buildTagsFromAnswers(profile), adminConfig);
}

export function selectGuidelinesFromBrief(record, adminConfig = null) {
  const tags = extractTagsFromText(record?.clientProfile, record?.exampleScheme);
  return resolveGuidelineLayers(tags, adminConfig);
}

function formatArchitectureBlock(architecture, foundation) {
  const foundationText = String(foundation || '').trim().slice(0, MAX_FOUNDATION_CHARS);
  const parts = [];
  if (foundationText) parts.push(`Базови принципи (foundation):\n${foundationText}`);
  if (architecture?.length) parts.push(`Универсални архитектурни насоки:\n- ${architecture.join('\n- ')}`);
  if (!parts.length) return '';
  return `\n\n═══ АРХИТЕКТУРНА РАМКА (база — отстъпва при конфликт с индивидуалното) ═══\n${parts.join('\n\n')}`;
}

export function buildPlanUserPrompt(profileSummary, layers, foundation = '') {
  const { individual = [], architecture = [] } = layers || {};
  const individualBlock = [
    '═══ ИНДИВИДУАЛЕН ПРОФИЛ (НАЙ-ВИСОК ПРИОРИТЕТ — над архитектурната рамка) ═══',
    profileSummary,
  ].join('\n');
  const individualGuidelines = individual.length
    ? `\n\nИНДИВИДУАЛНИ НАСОКИ ЗА ТОЗИ КЛИЕНТ (приоритет над общата рамка):\n- ${individual.join('\n- ')}`
    : '';
  return `${individualBlock}${individualGuidelines}${formatArchitectureBlock(architecture, foundation)}\n\nСъздай седмичния план сега. Отговори САМО с JSON.`;
}

export function buildBriefIdentityBlock(brief) {
  const profile = String(brief?.clientProfile || '').trim();
  const scheme = String(brief?.exampleScheme || '').trim();
  const tags = extractTagsFromText(profile, scheme);
  const tagList = [...tags].sort().join(', ') || '—';

  let genderLine = '';
  if (tags.has('gender:жена')) {
    genderLine = 'Пол: ЖЕНА — програмата е ИЗКЛЮЧИТЕЛНО за жена. Забранено е мъжки шаблон (press/bench-dominant split, игнориране на glutes/крака).';
  } else if (tags.has('gender:мъж')) {
    genderLine = 'Пол: МЪЖ — програмата е за мъж. Не използвай женски-специфични акценти без указание.';
  }

  return [
    '═══ КРИТИЧНИ ИДЕНТИФИКАТОРИ (не променяй, не игнорирай) ═══',
    genderLine,
    `Открити тагове от профила: ${tagList}`,
    '',
    'ПРЕДИ ГЕНЕРАЦИЯ — провери:',
    '□ Всяко изречение от ПРОФИЛА е отразено (здраве, оборудване, ограничения, цел, опит, пол)',
    '□ Всяка точка от СХЕМАТА е структурна основа на седмицата',
    '□ Всяка насока по-долу е приложена в упражненията, обема и интензитета',
  ].filter(Boolean).join('\n');
}

export function buildAdminPlanUserPrompt(brief, layers, foundation = '') {
  const { individual = [], architecture = [] } = layers || {};
  const { clientProfile = '', exampleScheme = '' } = brief || {};

  const individualBlock = [
    buildBriefIdentityBlock(brief),
    '',
    'РЕЖИМ: Треньорът е подготвил профила и примерна схема. Следвай конкретиката — дни, упражнения, обеми, ограничения. Не игнорирай НИТО ЕДНО изречение от полетата по-долу.',
    'canonicalName трябва да съвпада със стандартни имена от exercise бази, за да се намерят GIF/видеа.',
    '',
    'ПРОФИЛ И ДАННИ ЗА КЛИЕНТА (индивидуален — задължително отрази ВСИЧКО):',
    String(clientProfile || '').trim(),
  ];
  if (String(exampleScheme || '').trim()) {
    individualBlock.push('', 'СХЕМА, РАЗПРЕДЕЛЕНИЕ И УКАЗАНИЯ (индивидуални — структурирай плана по тях):', String(exampleScheme).trim());
  }

  const individualGuidelines = individual.length
    ? `\n\nИНДИВИДУАЛНИ НАСОКИ ЗА ТОЗИ КЛИЕНТ (приоритет над архитектурната рамка):\n- ${individual.join('\n- ')}`
    : '';

  return `${individualBlock.join('\n')}${individualGuidelines}${formatArchitectureBlock(architecture, foundation)}\n\nСъздай седмичния план сега. Отговори САМО с JSON.`;
}

/**
 * Единна подготовка за AI генерация.
 * @param source — { answers } от въпросник ИЛИ { clientProfile, exampleScheme, clientName?, clientContact? } от админ
 */
export function preparePlanGeneration(source, adminConfig, helpers) {
  const tags = collectTags(source);
  const layers = resolveGuidelineLayers(tags, adminConfig);
  const foundation = adminConfig?.foundation || '';

  if (source.answers) {
    const profileText = helpers.buildProfileSummary(source.answers);
    return {
      userPrompt: buildPlanUserPrompt(profileText, layers, foundation),
      coachProfileText: profileText,
      allowedEquipment: helpers.allowedEquipmentSet(source.answers.equipment),
    };
  }

  const brief = {
    clientProfile: source.clientProfile,
    exampleScheme: source.exampleScheme,
  };
  const coachProfileText = [
    source.clientName ? `Клиент: ${source.clientName}` : 'Клиент: —',
    source.clientContact ? `Контакт: ${source.clientContact}` : '',
    '',
    String(source.clientProfile || '').trim(),
    source.exampleScheme ? `\nСхема и указания:\n${source.exampleScheme}` : '',
  ].filter(Boolean).join('\n');

  return {
    userPrompt: buildAdminPlanUserPrompt(brief, layers, foundation),
    coachProfileText,
    allowedEquipment: null,
  };
}
