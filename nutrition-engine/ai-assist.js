/**
 * Помощникът AI: чете каквото алгоритъмът не може — свободния текст на
 * клиента — и връща предложения в ЗАТВОРЕН речник. Тук е само проверката:
 * всяко предложение се нормализира до известни кодове, а непознатото се
 * отхвърля. AI не пише калории, макроси или грамове и не маха ограничения.
 */

import { CLINICAL, EXCLUSIONS, BEHAVIORS, DIET_STYLES, DIET_PATTERNS, GOALS } from '../profile-code.js';

/** Промените в менюто, които двигателят разбира. */
export const APPROACH_CODES = ['simplify_meals', 'more_variety', 'gentle_digestion', 'more_volume', 'smaller_portions'];

export const VOCABULARY = {
  exclusions: EXCLUSIONS,
  clinical: CLINICAL,
  behaviors: BEHAVIORS,
  styles: Object.keys(DIET_STYLES),
  patterns: Object.keys(DIET_PATTERNS),
  approach: APPROACH_CODES,
};

/** Значението на всеки код — AI избира от тях, затова трябва да знае какво означават. */
const CODE_MEANING = {
  // изключвания
  GLU: 'без глутен', LAC: 'без млечни/лактоза', EGG: 'без яйца', NUT: 'без ядки', PNT: 'без фъстъци',
  FSH: 'без риба', SHF: 'без морски дарове', SOY: 'без соя', PORK: 'без свинско',
  // състояния
  IR: 'инсулинова резистентност', T2D: 'диабет тип 2', HYPO: 'хипотиреоидизъм', HYPER: 'хипертиреоидизъм',
  AI: 'автоимунно заболяване', CEL: 'цьолиакия', GI: 'храносмилателен дискомфорт без диагноза',
  IBS: 'синдром на раздразненото черво', IBD: 'Крон / улцерозен колит', GERD: 'рефлукс', SIBO: 'SIBO',
  GAST: 'гастрит', HTN: 'хипертония', CVD: 'сърдечно-съдово заболяване', ENDO: 'друго ендокринно',
  PCOS: 'СПКЯ', HORM: 'хормонален дисбаланс', ADR: 'надбъбречна недостатъчност', METS: 'метаболитен синдром',
  NAFLD: 'мастен черен дроб', DYSL: 'висок холестерол/триглицериди', GOUT: 'подагра/висока пикочна киселина',
  MSK: 'мускулно-скелетно', OSTEO: 'остеопороза', JOINT: 'ставни проблеми', DEP: 'депресия',
  ANX: 'тревожност', ALG: 'алергии/непоносимости', ANEM: 'анемия', SKIN: 'кожни проблеми',
  SLP: 'проблеми със съня', OB: 'затлъстяване (ИТМ ≥ 30)', OBS: 'затлъстяване II–III степен (ИТМ ≥ 35)', COG: 'когнитивен спад', INFL: 'хронично възпаление/слаб имунитет',
  MENO: 'менопауза', PP: 'след раждане/кърмене',
  // навици
  NBF: 'не закусва', EVE: 'храни се предимно вечер', SWS: 'сладко между храненията', OUT: 'яде навън/поръчва',
  IRR: 'нередовно хранене', RUSH: 'яде на крак', TV: 'яде пред екран', SWT: 'желание за сладко',
  DOUGH: 'желание за тестени', FASTF: 'желание за бургери/дюнери', SALT: 'желание за солено',
  OVR: 'преяждане', EMO: 'емоционално хранене', CMP: 'компенсиране с гладуване/хапчета',
  SDR: 'сладки напитки', ALC: 'алкохол', IF: 'периодично гладуване', SEAS: 'сезонно хранене',
  // промени в менюто
  simplify_meals: 'по-прости ястия (няма време)', more_variety: 'повече разнообразие',
  gentle_digestion: 'щадящо храносмилането (подуване/тежест)', more_volume: 'повече обем за ситост (бърз глад)',
  smaller_portions: 'по-малки порции на хранене',
};

/** „КОД (значение)“ за списъците в промпта. */
/** Значенията на кодовете — за показване на клиента (напр. предложенията от документ). */
export function codeMeanings(codes) {
  return Object.fromEntries(codes.map(c => [c, CODE_MEANING[c] || c]));
}

export function describeCodes(codes) {
  return codes.map(c => (CODE_MEANING[c] ? `${c} (${CODE_MEANING[c]})` : c)).join(', ');
}

/** Полета, които не са свободен текст за хранене. */
const SKIP_KEY = /^(_|dq_)|name|email|phone|password|token|id$|date|birth|city|address|userId|uid/i;
const MAX_TEXT_CHARS = 1800;

/** Свободният текст в отговорите на клиента: [{ field, text }]. */
export function collectFreeText(userData = {}) {
  const out = [];
  let total = 0;
  for (const [field, value] of Object.entries(userData || {})) {
    if (typeof value !== 'string' || SKIP_KEY.test(field)) continue;
    const text = value.trim().replace(/\s+/g, ' ');
    // Ключови думи и етикети от въпросника са кратки; свободният текст е по-дълъг.
    if (text.length < 12 || !/\s/.test(text)) continue;
    if (total + text.length > MAX_TEXT_CHARS) break;
    out.push({ field, text });
    total += text.length;
  }
  return out;
}

/** Отговори без информация за плана. */
const EMPTY_ANSWER = /^(не|нито едно|нищо от изброените|не знам|не съм сигурн[аи]?|никога|рядко)$/i;
const MAX_ANSWER_CHARS = 3500;

/**
 * Отговорите на динамичните (цел × състояние) и протоколните въпроси — заедно с
 * текста на въпроса, за да ги разбере AI. Двигателят не ги чете директно: те са
 * стотици и нюансирани, затова AI ги превежда в затворения речник, а алгоритъмът
 * проверява всеки код. Отрицателните отговори не носят информация и се пропускат.
 * @param {object} userData
 * @param {Record<string, string>} [protocolLabels] id → текст на протоколния въпрос
 * @returns {Array<{ field: string, text: string }>}
 */
export function collectQuestionAnswers(userData = {}, protocolLabels = {}) {
  const textMap = userData?._dq_text_map || {};
  const out = [];
  let total = 0;
  for (const [field, value] of Object.entries(userData || {})) {
    const question = field.startsWith('dq_') ? textMap[field] : protocolLabels[field];
    if (!question) continue;
    const answer = (Array.isArray(value) ? value : [value])
      .map(v => String(v ?? '').trim())
      .filter(v => v && !EMPTY_ANSWER.test(v))
      .join(', ');
    if (!answer) continue;
    const text = `${String(question).trim()} → ${answer}`.replace(/\s+/g, ' ');
    if (total + text.length > MAX_ANSWER_CHARS) break;
    out.push({ field, text });
    total += text.length;
  }
  return out;
}

/**
 * Каквото системата вече е разбрала за клиента — за да чете AI свободния текст
 * В КОНТЕКСТА на целия профил (цел, здраве, навици), а не изолирано.
 * @param {ReturnType<typeof import('../profile-code.js').compileProfile>} profile
 */
export function profileBrief(profile) {
  const goal = GOALS[profile.goal] || profile.goal;
  const rows = [
    `пол ${profile.sex}, възраст ${profile.age ?? '?'}, ръст ${profile.heightCm ?? '?'} см, тегло ${profile.weightKg ?? '?'} кг`,
    `цел: ${goal}${profile.pace ? ` (темп ${profile.pace})` : ''}`,
    `активност: ежедневна ${profile.activity.daily}/3, спорт ${profile.activity.sportDays} дни`,
    `хранителен стил: ${profile.diet.style}, модел: ${profile.diet.pattern}`,
    `изключвания: ${profile.exclusions.join(', ') || 'няма'}`,
    `здравословни състояния: ${profile.clinical.join(', ') || 'няма'}${profile.protocol ? `; протокол ${profile.protocol}` : ''}`,
    `навици и поведение: ${profile.behaviors.join(', ') || 'няма'}`,
    `сън ${profile.sleepHours ?? '?'} ч, стрес ${profile.stress ?? '?'}/3`,
  ];
  return rows.join('\n');
}

/** Кратък хеш — за да не викаме AI повторно за същия текст. */
export function textHash(items) {
  const s = items.map(i => `${i.field}:${i.text}`).join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const pickKnown = (list, allowed) => [...new Set((Array.isArray(list) ? list : [])
  .map(x => String(x).trim()).filter(x => allowed.includes(x)))];

const cleanTerms = (list, max = 8) => [...new Set((Array.isArray(list) ? list : [])
  .map(x => String(x).trim().toLowerCase()).filter(x => x.length >= 3 && x.length <= 40 && !/[{}<>]/.test(x)))].slice(0, max);

/** Предложенията при приемане на клиент → само позволени кодове. */
export function normalizeIntakeHints(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const style = DIET_STYLES[raw.style] ? raw.style : null;
  const pattern = DIET_PATTERNS[raw.pattern] ? raw.pattern : null;
  return {
    exclusions: pickKnown(raw.exclusions, EXCLUSIONS),
    clinical: pickKnown(raw.clinical, CLINICAL),
    behaviors: pickKnown(raw.behaviors, BEHAVIORS),
    style,
    pattern: pattern === 'omnivore' ? null : pattern,
    blockedTerms: cleanTerms(raw.blockedFoods),
    loves: cleanTerms(raw.lovedFoods),
    approach: pickKnown(raw.approach, APPROACH_CODES),
    cautions: (Array.isArray(raw.cautions) ? raw.cautions : []).map(x => String(x).trim().slice(0, 160)).filter(Boolean).slice(0, 4),
  };
}

/** Свободният коментар от седмичния преглед → промени в менюто. */
export function normalizeFeedbackHints(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    modifications: pickKnown(raw.approach, APPROACH_CODES),
    blockedTerms: cleanTerms(raw.blockedFoods, 5),
    exclusions: pickKnown(raw.exclusions, EXCLUSIONS),
  };
}

/** Резюме на седмицата за AI прегледа — само имена на ястия. */
export function weekDigest(weekPlan) {
  const lines = [];
  for (let d = 1; d <= 7; d++) {
    const meals = weekPlan?.[`day${d}`]?.meals || [];
    const parts = meals.filter(m => m.macros).map(m => `${m.type.replace('Хранене ', 'H')}: ${m.name}`);
    if (parts.length) lines.push(`ден ${d} | ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

/**
 * Замените, поискани от AI прегледа на менюто: ден, хранене и храни, които
 * да се избегнат. Валидни са само съществуващи хранения; алгоритъмът решава
 * с какво да се замени.
 * @returns {Array<{ day: number, type: string, avoid: string[], reason: string }>}
 */
export function normalizeSwaps(raw, weekPlan, max = 6) {
  const list = Array.isArray(raw?.swaps) ? raw.swaps : [];
  const out = [];
  for (const s of list) {
    const day = Number(s?.day);
    const type = /^H?(\d)$/i.test(String(s?.slot || s?.type || '')) ? `Хранене ${String(s.slot || s.type).replace(/\D/g, '')}` : String(s?.type || '');
    const meal = weekPlan?.[`day${day}`]?.meals?.find(m => m.type === type);
    const avoid = cleanTerms(s?.avoid, 3);
    if (!meal || !meal.macros || !avoid.length) continue;
    out.push({ day, type, avoid, reason: String(s?.reason || '').trim().slice(0, 160) });
    if (out.length >= max) break;
  }
  return out;
}
