/**
 * Код на профила — един компилиран, типизиран профил вместо сурови отговори.
 *
 * Досега всеки модул сам търсеше с регулярни изрази в текстовете от въпросника
 * и всеки разбираше нещо различно: „Нисковъглехидратна“ ставаше кето с 30 г
 * въглехидрати, „не обичам кето“ в полето за нелюбими храни — също кето,
 * „Хашимото“ не задействаше нито една проверка за щитовидна жлеза, а „5–6“
 * часа сън се четеше като NaN.
 *
 * Тук отговорите се превеждат по изрични таблици към затворен речник от кодове.
 * Всичко надолу по веригата чете профила, не текста. Непознат отговор не се
 * отгатва — записва се в `unmapped`, за да се добави към таблицата.
 *
 * Формат (NP1), сегменти, разделени с точка:
 *   NP1.F35.165.70>64.LOSS2.A2S3.K1640P118C142F62.M5:2345.D:MED/OMNI.X:GLU+LAC.C:IR.B:NBF+SWT.R:PIR
 */

export const PROFILE_CODE_VERSION = 'NP1';

/* ─── Речници ─────────────────────────────────────────────────────────── */

/** Хранителен стил — определя макро зоната. */
export const DIET_STYLES = {
  balanced: 'BAL',
  mediterranean: 'MED',
  keto: 'KETO',
  low_carb: 'LC',
  high_protein: 'HP',
  low_fodmap: 'FOD',
  dash: 'DASH',
  paleo: 'PAL',
  anti_inflammatory: 'AIF',
};

/** Животински продукти — етично ограничение, независимо от стила. */
export const DIET_PATTERNS = {
  omnivore: 'OMNI',
  pescatarian: 'PSC',
  vegetarian: 'VEG',
  vegan: 'VGN',
};

export const DIET_STYLE_LABELS = {
  balanced: 'Балансирано',
  mediterranean: 'Средиземноморска',
  keto: 'Кетогенна диета',
  low_carb: 'Нисковъглехидратна',
  high_protein: 'Високопротеинова',
  low_fodmap: 'Low-FODMAP',
  dash: 'DASH',
  paleo: 'Палео',
  anti_inflammatory: 'Противовъзпалителна',
};

export const DIET_PATTERN_LABELS = {
  pescatarian: 'Пескетарианска',
  vegetarian: 'Вегетарианска',
  vegan: 'Веган',
};

export const EXCLUSION_LABELS = {
  GLU: 'Без глутен',
  LAC: 'Без млечни',
};

/** Твърди изключвания по категория. Конкретните храни остават в blockedTerms. */
export const EXCLUSIONS = ['GLU', 'LAC', 'EGG', 'NUT', 'PNT', 'FSH', 'SHF', 'SOY', 'PORK'];

export const CLINICAL = [
  'IR', 'T2D', 'HYPO', 'HYPER', 'AI', 'CEL', 'GI', 'IBS', 'IBD', 'GERD', 'SIBO', 'GAST',
  'HTN', 'CVD', 'ENDO', 'PCOS', 'HORM', 'ADR', 'METS', 'NAFLD', 'DYSL', 'GOUT', 'MSK',
  'OSTEO', 'JOINT', 'DEP', 'ANX', 'ALG', 'ANEM', 'SKIN', 'SLP', 'COG', 'INFL', 'MENO', 'PP',
];

export const BEHAVIORS = [
  'NBF', 'EVE', 'SWS', 'OUT', 'IRR', 'RUSH', 'TV', 'SWT', 'DOUGH', 'FASTF', 'SALT',
  'OVR', 'EMO', 'CMP', 'SDR', 'ALC', 'IF', 'SEAS',
];

export const GOALS = {
  LOSS: 'Отслабване',
  VISC: 'Изчистване на коремните мазнини',
  GAIN: 'Мускулна маса',
  TONE: 'Стягане и оформяне на тялото',
  HLTH: 'Подобряване на здравето',
  AGE: 'Антиейджинг',
  DTX: 'Детокс и прочистване',
  CELL: 'Антицелулитна програма',
  PP: 'Възстановяване на тялото след бременност',
  MAINT: 'Поддържане',
};

export const PROTOCOL_CODES = {
  insulin_resistance: 'PIR',
  autoimmune_aip: 'PAIP',
  gi_issues: 'PGI',
  menopause_sarcopenia: 'PMEN',
  cellulite_reduction: 'PCEL',
  chronic_stress: 'PSTR',
  postpartum_lactation: 'PLAC',
  visceral_fat: 'PVIS',
  post_smoking: 'PSMK',
  longevity: 'PLON',
  detox: 'PDTX',
};

const ALL_SLOTS = ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5'];

/* ─── Таблици: отговор → код ──────────────────────────────────────────── */

export function normLabel(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function table(entries) {
  const map = new Map();
  for (const [labels, value] of entries) {
    for (const label of labels) map.set(normLabel(label), value);
  }
  return map;
}

/**
 * Етикети за диета — от въпросника, от админ панела и от етикетите на
 * стратегията. Всеки етикет дава стил, модел или изключване, никога и трите.
 */
const DIET_LABELS = table([
  [['Балансирана', 'Балансирано', 'balanced'], { style: 'balanced' }],
  [['Средиземноморска', 'mediterranean'], { style: 'mediterranean' }],
  [['Кето', 'Кетогенна', 'Кетогенна диета', 'keto', 'ketogenic'], { style: 'keto' }],
  [['Нисковъглехидратна', 'Нисковъглехидратна диета', 'low carb', 'low_carb'], { style: 'low_carb' }],
  [['Високопротеинова', 'high protein', 'high_protein'], { style: 'high_protein' }],
  [['Low-FODMAP', 'low fodmap', 'low_fodmap'], { style: 'low_fodmap' }],
  [['DASH', 'dash'], { style: 'dash' }],
  [['Палео', 'Пaleo', 'paleo'], { style: 'paleo' }],
  [['Противовъзпалителна', 'anti_inflammatory', 'anti-inflammatory'], { style: 'anti_inflammatory' }],
  [['Вегетарианска', 'Вегетарианско', 'vegetarian'], { pattern: 'vegetarian' }],
  [['Веган', 'Веганска', 'vegan'], { pattern: 'vegan' }],
  [['Пескетарианска', 'Пескетарианско', 'pescatarian'], { pattern: 'pescatarian' }],
  [['Без глутен', 'gluten_free', 'gluten free'], { exclusion: 'GLU' }],
  [['Без млечни', 'Без млечни продукти', 'dairy_free', 'dairy free'], { exclusion: 'LAC' }],
  [['Фастинг', 'Интермитентно гладуване'], { behavior: 'IF' }],
  [['Сезонна'], { behavior: 'SEAS' }],
  [['Нямам предпочитания', 'Друго', 'Няма'], {}],
]);

const GOAL_LABELS = table([
  [['Отслабване', 'fat_loss', 'loss'], 'LOSS'],
  [['Изчистване на коремните мазнини'], 'VISC'],
  [['Мускулна маса', 'Покачване на мускулна маса', 'muscle_gain'], 'GAIN'],
  [['Стягане и оформяне на тялото'], 'TONE'],
  [['Подобряване на здравето'], 'HLTH'],
  [['Антиейджинг'], 'AGE'],
  [['Детокс и прочистване'], 'DTX'],
  [['Антицелулитна програма'], 'CELL'],
  [['Възстановяване на тялото след бременност'], 'PP'],
  [['Поддържане', 'Поддържане на теглото', 'maintenance'], 'MAINT'],
]);

/** Отговорите от въпросника (суровите и тези след HEALTH_CONDITIONS_MAP). */
const CONDITION_LABELS = table([
  [['Диабет / Инсулинова резистентност', 'Инсулинова резистентност'], ['IR']],
  [['Диабет', 'Диабет тип 2'], ['T2D']],
  [['Автоимунни заболявания', 'Автоимунно', 'Автоимунно заболяване'], ['AI']],
  [['Щитовидна жлеза (Хашимото и др.)', 'Хашимото', 'Хипотиреоидизъм', 'Хипотиреоидизъм (намалена функция)'], ['HYPO']],
  [['Хипертиреоидизъм'], ['HYPER']],
  [['Храносмилателни проблеми'], ['GI']],
  // HEALTH_CONDITIONS_MAP превръща групата в тези три наведнъж — само по
  // себе си това значи „храносмилателен проблем“, не три диагнози.
  [['IBS', 'IBD', 'Рефлукс'], ['GI']],
  [['Сърдечно-съдови заболявания', 'Сърдечно-съдови'], ['CVD']],
  [['Ендокринни заболявания', 'Ендокринни'], ['ENDO']],
  [['Метаболитни нарушения'], ['METS']],
  [['Метаболитен синдром'], ['METS']],
  [['Стеатоза'], ['NAFLD']],
  [['Мускулно-скелетни заболявания', 'Мускулно-скелетни'], ['MSK']],
  [['Депресия'], ['DEP']],
  [['Тревожност'], ['ANX']],
  [['Алергии и хранителна непоносимост', 'Алергии'], ['ALG']],
  [['Емоционално хранене'], []],
  [['Анемия'], ['ANEM']],
  [['Кожни проблеми'], ['SKIN']],
  [['Проблеми със съня'], ['SLP']],
  [['Когнитивен спад'], ['COG']],
  [['Хронично възпаление и слаб имунитет', 'Хронично възпаление', 'Слаб имунитет'], ['INFL']],
  [['Менопауза'], ['MENO']],
  [['След бременност'], ['PP']],
  [['Нямам', 'Друго', 'Няма'], []],
]);

/** Подробностите от падащите менюта на въпросника. */
const CONDITION_DETAIL_LABELS = table([
  [['Хашимото (тиреоидит)'], ['HYPO', 'AI']],
  [['Целиакия (глутенова ентеропатия)'], ['CEL', 'AI']],
  [['Болест на Крон', 'Улцерозен колит'], ['IBD', 'AI']],
  [['Ревматоиден артрит', 'Системен лупус еритематозус', 'Псориазис', 'Множествена склероза',
    'Склеродермия', 'Витилиго', 'Друго автоимунно заболяване'], ['AI']],
  [['Хипертония (високо кръвно налягане)', 'Хипертония'], ['HTN']],
  [['Исхемична болест на сърцето', 'Сърдечна недостатъчност', 'Аритмия (предсърдно мъждене и други)',
    'Атеросклероза', 'Варикозни вени', 'Друго сърдечно-съдово заболяване'], ['CVD']],
  [['Синдром на поликистозните яйчници', 'СПКЯ', 'PCOS'], ['PCOS']],
  [['Хормонален дисбаланс', 'Хиперпролактинемия'], ['HORM']],
  [['Надбъбречна недостатъчност'], ['ADR']],
  [['Друго ендокринно заболяване'], ['ENDO']],
  [['Синдром на раздразненото черво'], ['IBS']],
  [['Възпалително чревно заболяване (Крон, улцерозен колит)'], ['IBD']],
  [['Гастроезофагеален рефлукс'], ['GERD']],
  [['Синдром на бактериалния свръхрастеж в тънкото черво'], ['SIBO']],
  [['Хроничен гастрит'], ['GAST']],
  [['Друг храносмилателен проблем'], ['GI']],
  [['Метаболитен синдром'], ['METS']],
  [['Мастна чернодробна болест (стеатоза)'], ['NAFLD']],
  [['Дислипидемия (висок холестерол или триглицериди)'], ['DYSL']],
  [['Подагра'], ['GOUT']],
  [['Друго метаболитно нарушение'], ['METS']],
  [['Остеопороза', 'Остеопения'], ['OSTEO']],
  [['Артрит (остеоартрит)', 'Фибромиалгия', 'Хронична болка в ставите', 'Дискова херния',
    'Друго мускулно-скелетно заболяване'], ['JOINT']],
]);

const CONDITION_DETAIL_FIELDS = [
  'medicalConditions_Автоимунно',
  'medicalConditions_Сърдечно-съдови_детайл',
  'medicalConditions_Ендокринни_детайл',
  'medicalConditions_Храносмилателни_детайл',
  'medicalConditions_Метаболитни_детайл',
  'medicalConditions_Мускулно-скелетни_детайл',
];

const EATING_HABIT_LABELS = table([
  [['Не закусвам'], 'NBF'],
  [['Храня се предимно вечер'], 'EVE'],
  [['Хапвам сладко между храненията'], 'SWS'],
  [['Поръчвам храна или ям навън'], 'OUT'],
  [['На периоди съм'], 'IRR'],
  [['Хапвам на крак'], 'RUSH'],
  [['Хапвам пред телевизора'], 'TV'],
]);

const CRAVING_LABELS = table([
  [['Сладко'], 'SWT'],
  [['Тестени храни'], 'DOUGH'],
  [['Бургери / дюнери'], 'FASTF'],
  [['Чипс / Солети'], 'SALT'],
]);

/**
 * Думи-категории в свободния текст (алергии, „не обичам“). Само категории:
 * „прясно мляко“ не прави клиента без млечни, а „непоносимост към лактоза“ —
 * да. Конкретните храни се блокират отделно, като термини.
 */
const EXCLUSION_TERMS = {
  GLU: ['глутен', 'целиак', 'gluten'],
  LAC: ['лактоз', 'млечни', 'млечн продукт', 'dairy', 'lactose'],
  EGG: ['яйца', 'яйце', 'eggs'],
  NUT: ['ядки', 'nuts'],
  PNT: ['фъстъ', 'peanut'],
  FSH: ['риба', 'fish'],
  SHF: ['морски дарове', 'ракообраз', 'скарид', 'миди', 'shellfish', 'seafood'],
  SOY: ['соя', 'соев', 'soy'],
  PORK: ['свинско', 'свински', 'pork'],
};

const SLEEP_HOURS = table([
  [['Под 5'], 4.5], [['5-6'], 5.5], [['6-7'], 6.5], [['7-8'], 7.5], [['Над 8'], 8.5],
]);

/** Вода на ден в литри — средата на отговора. */
const WATER_LITERS = table([
  [['под 1 л'], 0.75], [['1-1.5 л'], 1.25], [['1.5-2 л'], 1.75], [['над 2 л'], 2.25],
]);

const LEVEL_1_3 = table([
  [['Ниско', 'Ниска'], 1], [['Средно', 'Средна'], 2],
  [['Високо', 'Висока', 'Много високо', 'Много висока'], 3],
]);

/** Спорт: дни седмично (среда на диапазона) и клас 0–3. */
const SPORT_LABELS = table([
  [['Никаква (0 дни седмично)'], { days: 0, band: 0 }],
  [['Ниска (1–2 дни седмично)'], { days: 1.5, band: 1 }],
  [['Средна (2–4 дни седмично)'], { days: 3, band: 2 }],
  [['Висока (5–7 дни седмично)'], { days: 6, band: 3 }],
  [['Много висока (атлети)'], { days: 6, band: 3 }],
]);

/**
 * Етикет, който не е в таблицата (свободен текст от админ, AI или „Друго“),
 * се чете по ключови думи — на едно място и с ясни граници: кето не е
 * нисковъглехидратна, а нелюбимите храни никога не определят диетата.
 */
/** @type {Array<[string, { style?: string, pattern?: string, exclusion?: string }]>} */
const DIET_KEYWORDS = [
  ['нисковъглехидрат', { style: 'low_carb' }],
  ['ниско съдържание на въглехидрати', { style: 'low_carb' }],
  ['low carb', { style: 'low_carb' }],
  ['кетоген', { style: 'keto' }],
  ['кето', { style: 'keto' }],
  ['keto', { style: 'keto' }],
  ['средиземномор', { style: 'mediterranean' }],
  ['mediterr', { style: 'mediterranean' }],
  ['високопротеин', { style: 'high_protein' }],
  ['high protein', { style: 'high_protein' }],
  ['fodmap', { style: 'low_fodmap' }],
  ['dash', { style: 'dash' }],
  ['палео', { style: 'paleo' }],
  ['paleo', { style: 'paleo' }],
  ['противовъзпал', { style: 'anti_inflammatory' }],
  ['anti-inflam', { style: 'anti_inflammatory' }],
  ['веган', { pattern: 'vegan' }],
  ['vegan', { pattern: 'vegan' }],
  ['вегетариан', { pattern: 'vegetarian' }],
  ['vegetarian', { pattern: 'vegetarian' }],
  ['пескетариан', { pattern: 'pescatarian' }],
  ['pescatarian', { pattern: 'pescatarian' }],
  ['без глутен', { exclusion: 'GLU' }],
  ['gluten', { exclusion: 'GLU' }],
  ['без млечни', { exclusion: 'LAC' }],
  ['dairy', { exclusion: 'LAC' }],
];

/** Лекарства, които сами казват диагнозата. */
/** @type {Array<[string[], string]>} */
const MEDICATION_TERMS = [
  [['левотироксин', 'тироксин', 'еутирокс', 'euthyrox', 'letrox', 'летрокс', 'l-thyrox', 'levothyrox'], 'HYPO'],
  [['метформин', 'metformin', 'глюкофаж', 'glucophage', 'сиофор', 'siofor'], 'IR'],
  [['тиамазол', 'thiamazol', 'метизол', 'metizol'], 'HYPER'],
];

const FREQUENT = new Set(['често', 'много често', 'постоянно']);

/* ─── Помощни ─────────────────────────────────────────────────────────── */

function asList(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(asList);
  return String(value).split(/[,;|·\n]/).map(s => s.trim()).filter(Boolean);
}

function num(value) {
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function addAll(set, values) {
  for (const v of values || []) if (v) set.add(v);
}

function textHasTerm(text, term) {
  return normLabel(text).includes(term);
}

/**
 * Стил, модел и изключвания от етикети на диета.
 * Връща и непознатите етикети — те не се отгатват.
 */
export function readDietLabels(labels) {
  const out = { styles: [], patterns: [], exclusions: [], behaviors: [], unmapped: [] };
  for (const label of asList(labels)) {
    // „Кетогенна диета (строга)“ → „кетогенна диета“: забележките в скоби
    // не променят каква е диетата.
    const key = normLabel(label.replace(/\([^)]*\)/g, ''));
    let hit = DIET_LABELS.get(key) ?? DIET_LABELS.get(normLabel(label));
    if (!hit) hit = dietKeywordsOf(label);
    if (!hit) {
      out.unmapped.push(label);
      continue;
    }
    addHit(out, hit);
  }
  return out;
}

function addHit(out, hit) {
  if (Array.isArray(hit)) {
    for (const h of hit) addHit(out, h);
    return;
  }
  if (hit.style) out.styles.push(hit.style);
  if (hit.pattern) out.patterns.push(hit.pattern);
  if (hit.exclusion) out.exclusions.push(hit.exclusion);
  if (hit.behavior) out.behaviors.push(hit.behavior);
}

/** @returns {object[]|null} */
function dietKeywordsOf(label) {
  const text = normLabel(label);
  const hits = DIET_KEYWORDS.filter(([term]) => text.includes(term)).map(([, hit]) => hit);
  return hits.length ? hits : null;
}

const PATTERN_STRICTNESS = ['omnivore', 'pescatarian', 'vegetarian', 'vegan'];

function strictestPattern(patterns) {
  let best = 'omnivore';
  for (const p of patterns) {
    if (PATTERN_STRICTNESS.indexOf(p) > PATTERN_STRICTNESS.indexOf(best)) best = p;
  }
  return best;
}

/** Ако клиентът е посочил няколко стила, по-ограничаващият печели. */
const STYLE_PRIORITY = [
  'keto', 'low_fodmap', 'low_carb', 'paleo', 'dash', 'high_protein',
  'anti_inflammatory', 'mediterranean', 'balanced',
];

function firstStyle(styles) {
  for (const s of STYLE_PRIORITY) if (styles.includes(s)) return s;
  return null;
}

/** Изключвания по категория от свободен текст. */
export function exclusionsFromText(text) {
  const found = [];
  if (!text) return found;
  for (const [code, terms] of Object.entries(EXCLUSION_TERMS)) {
    if (terms.some(t => textHasTerm(text, t))) found.push(code);
  }
  return found;
}

function readConditions(userData, unmapped) {
  const codes = new Set();
  for (const label of asList(userData.medicalConditions)) {
    const hit = CONDITION_LABELS.get(normLabel(label));
    if (hit) addAll(codes, hit);
    else unmapped.push(label);
  }
  let detailed = false;
  for (const field of CONDITION_DETAIL_FIELDS) {
    for (const label of asList(userData[field])) {
      const hit = CONDITION_DETAIL_LABELS.get(normLabel(label));
      if (hit) {
        addAll(codes, hit);
        detailed = true;
      } else {
        unmapped.push(label);
      }
    }
  }
  // Конкретната диагноза прави общия код излишен.
  if (detailed && ['IBS', 'IBD', 'GERD', 'SIBO', 'GAST'].some(c => codes.has(c))) codes.delete('GI');
  const meds = normLabel([...asList(userData.medications), ...asList(userData.medicationsDetails)].join(' '));
  for (const [terms, code] of MEDICATION_TERMS) {
    if (terms.some(t => meds.includes(t))) codes.add(code);
  }
  if (codes.has('PCOS') || codes.has('HORM') || codes.has('ADR')) codes.delete('ENDO');
  if (codes.has('HTN')) codes.delete('CVD');
  if (codes.has('OSTEO') || codes.has('JOINT')) codes.delete('MSK');
  return codes;
}

/**
 * Стил по клинична необходимост, когато клиентът не е избрал стил.
 * Изричният избор на клиента печели — той е този, който ще яде.
 */
function clinicalDefaultStyle(clinical, protocolId) {
  if (clinical.has('IBS') || clinical.has('SIBO') || protocolId === 'gi_issues') return 'low_fodmap';
  // Общ храносмилателен проблем без уточнение — щадящо, както досега.
  if (clinical.has('GI')) return 'low_fodmap';
  if (clinical.has('HTN')) return 'dash';
  if (protocolId === 'insulin_resistance' || clinical.has('IR') || clinical.has('T2D') || clinical.has('PCOS')) {
    return 'low_carb';
  }
  if (protocolId === 'autoimmune_aip') return 'anti_inflammatory';
  return null;
}

/** Хранения на ден — числото, ако е казано, иначе 5. */
function mealsPerDayFrom(userData) {
  const explicit = num(userData.mealsPerDay);
  if (explicit && explicit >= 2 && explicit <= 6) return Math.min(5, Math.max(3, Math.round(explicit)));
  const text = asList(userData.eatingHabits).join(' ').toLowerCase();
  if (/(^|\D)5\s*хран|пет\s*хран/.test(text)) return 5;
  if (/(^|\D)4\s*хран|четири\s*хран/.test(text)) return 4;
  if (/(^|\D)[23]\s*хран|три\s*хран|две\s*хран|без\s*междин/.test(text)) return 3;
  return 5;
}

export function slotsFor(mealsPerDay, skipsBreakfast) {
  let slots;
  if (mealsPerDay <= 3) slots = ['Хранене 1', 'Хранене 2', 'Хранене 4'];
  else if (mealsPerDay === 4) slots = ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4'];
  else slots = [...ALL_SLOTS];
  return skipsBreakfast ? slots.filter(s => s !== 'Хранене 1') : slots;
}

function paceFor(goal, weightKg, lossKg) {
  if (goal !== 'LOSS' && goal !== 'VISC') return 0;
  const share = weightKg > 0 && lossKg > 0 ? lossKg / weightKg : 0;
  if (share >= 0.1) return 3;
  if (share >= 0.05) return 2;
  return 1;
}

/* ─── Компилатор ──────────────────────────────────────────────────────── */

/**
 * Компилира отговорите в профил. Чиста функция — едни и същи данни дават един
 * и същ профил, затова не се кешира.
 *
 * @param {object} userData отговорите от въпросника (+ админ полета)
 * @param {{ dietaryModifier?: string }} [overrides] етикет на диета от стратегията/админа
 */
export function compileProfile(userData = {}, overrides = {}) {
  const data = userData || {};
  const unmapped = [];

  const sex = data.gender === 'Мъж' ? 'M' : data.gender === 'Жена' ? 'F' : 'X';
  const age = num(data.age);
  const heightCm = num(data.height);
  const weightKg = num(data.weight);
  const lossKg = num(data.lossKg);

  const goalLabel = Array.isArray(data.goal) ? data.goal[0] : data.goal;
  let goal = GOAL_LABELS.get(normLabel(goalLabel)) || null;
  if (!goal && goalLabel) {
    // Целта понякога идва съставна („Отслабване + Тонус“) — първата позната част.
    for (const part of String(goalLabel).split(/[+,;]/)) {
      goal = GOAL_LABELS.get(normLabel(part));
      if (goal) break;
    }
    if (!goal) unmapped.push(String(goalLabel));
  }
  goal = goal || 'MAINT';
  const targetWeightKg = (goal === 'LOSS' || goal === 'VISC') && weightKg && lossKg > 0
    ? Math.round((weightKg - lossKg) * 10) / 10
    : weightKg;

  const daily = LEVEL_1_3.get(normLabel(data.dailyActivityLevel)) || 2;
  const sport = SPORT_LABELS.get(normLabel(data.sportActivity)) || { days: 0, band: 0 };

  const sleepHours = SLEEP_HOURS.get(normLabel(data.sleepHours)) ?? num(data.sleepHours);
  const stress = LEVEL_1_3.get(normLabel(data.stressLevel)) || null;
  const waterL = WATER_LITERS.get(normLabel(data.waterIntake)) ?? null;

  // Диета: изричните етикети на клиента + етикетът на стратегията/админа.
  const prefs = readDietLabels([...asList(data.dietPreference), ...asList(data.dietPreference_other)]);
  const modifier = readDietLabels(overrides.dietaryModifier ? [overrides.dietaryModifier] : []);
  unmapped.push(...prefs.unmapped);

  const clinical = readConditions(data, unmapped);
  const protocolId = data.clinicalProtocol && PROTOCOL_CODES[data.clinicalProtocol]
    ? data.clinicalProtocol
    : null;

  const exclusions = new Set([...prefs.exclusions, ...modifier.exclusions]);
  addAll(exclusions, exclusionsFromText(data['medicalConditions_Алергии']));
  addAll(exclusions, exclusionsFromText(data.dietDislike));
  if (clinical.has('CEL')) exclusions.add('GLU');
  // Полето от протоколните въпросници за непоносимости.
  for (const label of asList(data.foodSensitivities)) addAll(exclusions, exclusionsFromText(label));

  const pattern = strictestPattern([...prefs.patterns, ...modifier.patterns]);
  const style = firstStyle(modifier.styles)
    || firstStyle(prefs.styles.filter(s => s !== 'balanced'))
    || clinicalDefaultStyle(clinical, protocolId)
    || 'balanced';
  // Палео изключва зърнени и млечни по дефиниция.
  if (style === 'paleo') {
    exclusions.add('GLU');
    exclusions.add('LAC');
  }
  if (pattern === 'vegan') {
    exclusions.add('LAC');
    exclusions.add('EGG');
  }

  const behaviors = new Set([...prefs.behaviors, ...modifier.behaviors]);
  for (const label of asList(data.eatingHabits)) {
    const code = EATING_HABIT_LABELS.get(normLabel(label));
    if (code) behaviors.add(code);
  }
  for (const label of asList(data.foodCravings)) {
    const code = CRAVING_LABELS.get(normLabel(label));
    if (code) behaviors.add(code);
  }
  if (FREQUENT.has(normLabel(data.overeatingFrequency))) behaviors.add('OVR');
  const triggers = asList(data.foodTriggers).filter(t => !['нито едно', 'не'].includes(normLabel(t)));
  if (triggers.length || asList(data.medicalConditions).some(c => normLabel(c) === 'емоционално хранене')) {
    behaviors.add('EMO');
  }
  if (asList(data.compensationMethods).some(m => ['гладуване', 'хапчета за отслабване'].includes(normLabel(m)))) {
    behaviors.add('CMP');
  }
  if (FREQUENT.has(normLabel(data.drinksSweet))) behaviors.add('SDR');
  if (FREQUENT.has(normLabel(data.drinksAlcohol))) behaviors.add('ALC');

  const skipsBreakfast = behaviors.has('NBF');
  const slots = slotsFor(mealsPerDayFrom(data), skipsBreakfast);

  return {
    v: PROFILE_CODE_VERSION,
    sex,
    age: age != null ? Math.round(age) : null,
    heightCm: heightCm != null ? Math.round(heightCm) : null,
    weightKg,
    targetWeightKg,
    goal,
    pace: paceFor(goal, weightKg, lossKg),
    activity: { daily, sportDays: sport.days, sportBand: sport.band },
    sleepHours: sleepHours ?? null,
    sleepInterrupted: normLabel(data.sleepInterrupt) === 'да',
    stress,
    waterL,
    diet: { style, pattern },
    exclusions: EXCLUSIONS.filter(c => exclusions.has(c)),
    clinical: CLINICAL.filter(c => clinical.has(c)),
    protocol: protocolId,
    behaviors: BEHAVIORS.filter(c => behaviors.has(c)),
    // Колко хранения клиентът реално има — след махането на закуската.
    mealsPerDay: slots.length,
    skipsBreakfast,
    slots,
    unmapped: [...new Set(unmapped)],
  };
}

/* ─── Изводи от профила (за модулите надолу по веригата) ─────────────── */

/** Един id за библиотеката: етичният модел печели, иначе стилът. */
export function libraryDietProfileOf(profile) {
  const { style, pattern } = profile.diet;
  if (pattern !== 'omnivore') return pattern;
  if (style === 'balanced') {
    if (profile.exclusions.includes('GLU')) return 'gluten_free';
    if (profile.exclusions.includes('LAC')) return 'dairy_free';
  }
  return style;
}

/**
 * Етикет на диетата, който носи и модела, и изключванията — напр.
 * „Веган · Без глутен“. Генериран е от кодовете, затова се чете обратно
 * еднозначно от readDietLabels.
 */
export function dietLabelOf(profile) {
  const { style, pattern } = profile.diet;
  const parts = [];
  if (pattern !== 'omnivore') parts.push(DIET_PATTERN_LABELS[pattern]);
  if (style !== 'balanced' || !parts.length) parts.push(DIET_STYLE_LABELS[style]);
  for (const code of ['GLU', 'LAC']) {
    if (!profile.exclusions.includes(code)) continue;
    // Веган и палео вече значат „без млечни“.
    if (code === 'LAC' && (pattern === 'vegan' || style === 'paleo')) continue;
    if (code === 'GLU' && style === 'paleo') continue;
    parts.push(EXCLUSION_LABELS[code]);
  }
  return parts.join(' · ');
}

/** Флаговете, които каталогът с храни разбира. */
export function catalogDietFlagsOf(profile) {
  const { style, pattern } = profile.diet;
  return {
    vegan: pattern === 'vegan',
    vegetarian: pattern === 'vegetarian',
    pescatarian: pattern === 'pescatarian',
    keto: style === 'keto',
    lowCarb: style === 'low_carb',
    glutenFree: profile.exclusions.includes('GLU'),
    dairyFree: profile.exclusions.includes('LAC'),
  };
}

/* ─── Кодиране / декодиране ───────────────────────────────────────────── */

const STYLE_BY_CODE = Object.fromEntries(Object.entries(DIET_STYLES).map(([k, v]) => [v, k]));
const PATTERN_BY_CODE = Object.fromEntries(Object.entries(DIET_PATTERNS).map(([k, v]) => [v, k]));
const PROTOCOL_BY_CODE = Object.fromEntries(Object.entries(PROTOCOL_CODES).map(([k, v]) => [v, k]));

function intOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/**
 * @param {ReturnType<typeof compileProfile>} profile
 * @param {{ kcal?: number, protein?: number, carbs?: number, fats?: number }|null} [energy]
 */
export function encodeProfileCode(profile, energy = null) {
  const seg = [PROFILE_CODE_VERSION];
  const w = intOr(profile.weightKg);
  const tw = intOr(profile.targetWeightKg, w);
  seg.push(`${profile.sex}${intOr(profile.age)}`);
  seg.push(String(intOr(profile.heightCm)));
  seg.push(tw && tw !== w ? `${w}>${tw}` : String(w));
  seg.push(`${profile.goal}${profile.pace || ''}`);
  seg.push(`A${profile.activity.daily}S${profile.activity.sportBand}`);
  if (energy && Number(energy.kcal) > 0) {
    seg.push(`K${intOr(energy.kcal)}P${intOr(energy.protein)}C${intOr(energy.carbs)}F${intOr(energy.fats)}`);
  }
  const slotDigits = profile.slots.map(s => s.replace('Хранене ', '')).join('');
  seg.push(`M${profile.mealsPerDay}:${slotDigits}`);
  seg.push(`D:${DIET_STYLES[profile.diet.style]}/${DIET_PATTERNS[profile.diet.pattern]}`);
  if (profile.exclusions.length) seg.push(`X:${profile.exclusions.join('+')}`);
  if (profile.clinical.length) seg.push(`C:${profile.clinical.join('+')}`);
  if (profile.behaviors.length) seg.push(`B:${profile.behaviors.join('+')}`);
  if (profile.protocol) seg.push(`R:${PROTOCOL_CODES[profile.protocol]}`);
  return seg.join('.');
}

/**
 * Обратно от кода към профил (без суровите данни и `unmapped`).
 * @returns {{ profile: object, energy: object|null }}
 */
export function decodeProfileCode(code) {
  const parts = String(code || '').split('.');
  if (parts[0] !== PROFILE_CODE_VERSION) throw new Error(`Непозната версия на кода: ${parts[0]}`);
  const [, sexAge, height, weights, goalSeg, actSeg, ...rest] = parts;

  const [w, tw] = weights.split('>');
  const goalMatch = /^([A-Z]+)(\d?)$/.exec(goalSeg) || [];
  const actMatch = /^A(\d)S(\d)$/.exec(actSeg) || [];
  const profile = {
    v: PROFILE_CODE_VERSION,
    sex: sexAge[0],
    age: intOr(sexAge.slice(1), null),
    heightCm: intOr(height, null),
    weightKg: intOr(w, null),
    targetWeightKg: intOr(tw ?? w, null),
    goal: goalMatch[1] || 'MAINT',
    pace: intOr(goalMatch[2], 0),
    activity: { daily: intOr(actMatch[1], 2), sportBand: intOr(actMatch[2], 0) },
    diet: { style: 'balanced', pattern: 'omnivore' },
    exclusions: [],
    clinical: [],
    behaviors: [],
    protocol: null,
    mealsPerDay: 5,
    skipsBreakfast: false,
    slots: [...ALL_SLOTS],
  };
  let energy = null;

  for (const s of rest) {
    const k = /^K(\d+)P(\d+)C(\d+)F(\d+)$/.exec(s);
    if (k) {
      energy = { kcal: +k[1], protein: +k[2], carbs: +k[3], fats: +k[4] };
      continue;
    }
    const m = /^M(\d):(\d+)$/.exec(s);
    if (m) {
      profile.mealsPerDay = +m[1];
      profile.slots = m[2].split('').map(d => `Хранене ${d}`);
      profile.skipsBreakfast = !profile.slots.includes('Хранене 1');
      continue;
    }
    const [key, value = ''] = s.split(':');
    const list = value ? value.split('+') : [];
    if (key === 'D') {
      const [st, pt] = value.split('/');
      profile.diet = { style: STYLE_BY_CODE[st] || 'balanced', pattern: PATTERN_BY_CODE[pt] || 'omnivore' };
    } else if (key === 'X') profile.exclusions = list;
    else if (key === 'C') profile.clinical = list;
    else if (key === 'B') profile.behaviors = list;
    else if (key === 'R') profile.protocol = PROTOCOL_BY_CODE[value] || null;
  }
  return { profile, energy };
}

/* ─── Етикети без въпросник ───────────────────────────────────────────── */

/**
 * Диетата от етикети, когато няма пълни отговори — етикет на стратегията,
 * предпочитания, нелюбими храни, клинични подсказки. Същите правила като
 * compileProfile: изричният стил печели, подсказките само допълват, а
 * нелюбимите храни дават изключвания, никога стил или модел.
 *
 * @param {{ dietaryModifier?: string, dietPreference?: string|string[]|null, dietDislike?: string, questionnaireHints?: string }} ctx
 */
export function dietFromSignals(ctx = {}) {
  const explicit = readDietLabels([...asList(ctx.dietaryModifier), ...asList(ctx.dietPreference)]);
  const hints = readDietLabels(ctx.questionnaireHints ? [ctx.questionnaireHints] : []);
  const exclusions = new Set([...explicit.exclusions, ...hints.exclusions]);
  addAll(exclusions, exclusionsFromText(ctx.dietDislike));

  const pattern = strictestPattern(explicit.patterns);
  const style = firstStyle(explicit.styles.filter(s => s !== 'balanced'))
    || firstStyle(hints.styles)
    || 'balanced';
  if (style === 'paleo') {
    exclusions.add('GLU');
    exclusions.add('LAC');
  }
  if (pattern === 'vegan') {
    exclusions.add('LAC');
    exclusions.add('EGG');
  }
  return { diet: { style, pattern }, exclusions: EXCLUSIONS.filter(c => exclusions.has(c)) };
}
