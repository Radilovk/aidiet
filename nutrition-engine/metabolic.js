/**
 * Метаболитната седмица: не само колко енергия, а от какво е тя и кога.
 *
 * Принципите (с източниците — за специалиста, не за клиента):
 *
 * 1. Посоката (отслабване, маса, задържане) идва от седмичния енергиен баланс —
 *    сборът за седмицата е точно 7 × дневната цел. Разпределението по дни
 *    решава какво става с енергията: гориво за работата или запас.
 *
 * 2. Белтъкът е постоянен всеки ден. Мускулният синтез след натоварване трае
 *    24–48 ч (Phillips 2014), затова почивният ден не е ден с по-малко белтък.
 *
 * 3. Въглехидратите следват работата — „гориво според работата“ (Impey и др.
 *    2018; Burke 2011; ACSM 2016). Силовите и интервалните тренировки работят
 *    на гликоген, затова въглехидратите на деня растат и отиват около тях.
 *    Дългото равномерно кардио гори смес мазнини и гликоген. Йогата и ходенето
 *    не изискват повече въглехидрати. В почивния ден тялото разчита повече на
 *    мазнините и въглехидратите намаляват. При инсулинова резистентност и цел
 *    отслабване разликата е по-голяма. Мускулът след тренировка поема глюкоза
 *    и без инсулин (GLUT4), затова въглехидратите на деня отиват след нея.
 *
 * 4. Часът на деня има значение: инсулиновата чувствителност е по-висока сутрин
 *    и спада вечер (Poggiogalle 2018; Jakubowicz 2013). В почивния ден, при
 *    цел отслабване или метаболитен риск, въглехидратите се изместват към
 *    първата половина на деня, а вечерята е по-лека на въглехидрати.
 *
 * 5. Фастингът е протокол с граници, не пропуснато хранене. Нощна пауза от
 *    ~12 ч е за всички. Хранене в часови прозорец (14:10, 16:8) — по избор или
 *    като предложение, само без противопоказания (бременност и кърмене,
 *    лекарства с риск от хипогликемия, компенсиране с гладуване, емоционално
 *    хранене, ИТМ под 18,5, под 18 или над 70 г.). Ранният прозорец (до ~18 ч)
 *    има по-силен ефект върху инсулиновата чувствителност (Sutton 2018).
 *    Прозорецът е в почивните дни, а в тренировъчните храненето обгражда
 *    тренировката.
 *
 * 6. Колко уверено се разпределя: при научени тренировъчни дни (вечерния
 *    въпрос) — по редовността им. Когато дните са само предположение от
 *    въпросника, амплитудата е наполовина: грешен ден коства малко.
 *
 * Тренировката се оценява като нетен разход (MET − 1) × кг × ч (Compendium of
 * Physical Activities), а когато има отговори от вечерния въпрос — по тях (там
 * крачките от тренировката вече не се броят два пъти).
 */

import { referenceWeightKg, MIN_FAT_G_PER_KG, KETO_MAX_CARB_G, LOW_CARB_MAX_G } from '../macro-targets.js';

/** Видовете тренировки от въпросника (questionnaire2.html, sportTypes) → енергийна система. */
export const SESSION_TYPES = {
  'Силови (фитнес, тежести)': { id: 'strength', met: 5.0, fuel: 'glycolytic', label: 'силова' },
  'Кардио (бягане, колело, плуване)': { id: 'cardio', met: 7.5, fuel: 'endurance', label: 'кардио' },
  'Групови (аеробика, зумба, кросфит)': { id: 'group', met: 6.5, fuel: 'glycolytic', label: 'групова' },
  'Отборен спорт, тенис': { id: 'team', met: 7.0, fuel: 'glycolytic', label: 'отборен спорт' },
  'Бойни спортове': { id: 'combat', met: 8.0, fuel: 'glycolytic', label: 'бойни спортове' },
  'Йога, пилатес, стречинг': { id: 'mind', met: 3.0, fuel: 'low', label: 'йога/пилатес' },
  'Бързо ходене, туризъм': { id: 'walk', met: 4.5, fuel: 'aerobic', label: 'ходене' },
};
const OTHER_SESSION = { id: 'other', met: 5.0, fuel: 'mixed', label: 'тренировка' };

/**
 * Каква част от допълнителната енергия на деня е въглехидрати — по енергийната
 * система. Останалото са мазнини; белтъкът е постоянен.
 */
const FUEL_CARB_SHARE = { glycolytic: 0.85, endurance: 0.8, mixed: 0.7, aerobic: 0.5, low: 0.3 };

/**
 * Колко от разхода на тренировката се връща в същия ден, по цел:
 * отслабване — 60% (тренировката е качествена, дефицитът е в почивните дни);
 * стягане/рекомпозиция — 90% (горивото е в тренировката, дефицитът — извън нея);
 * мускулна маса — 100%; здраве — 80%.
 */
const COUPLING_BY_GOAL = { LOSS: 0.6, VISC: 0.6, CELL: 0.6, PP: 0.6, TONE: 0.9, GAIN: 1.0 };
const DEFAULT_COUPLING = 0.8;

/**
 * Разлика във въглехидратите между тренировъчен и почивен ден при еднакви
 * калории — дял от средните въглехидрати. По-голяма при метаболитен риск и
 * отслабване: там почивният ден на по-малко въглехидрати има най-голяма полза.
 */
const CARB_SWING_BY_GOAL = { LOSS: 0.25, VISC: 0.3, CELL: 0.25, TONE: 0.25, GAIN: 0.15 };
const DEFAULT_CARB_SWING = 0.15;
const METABOLIC_RISK = ['IR', 'T2D', 'METS', 'PCOS', 'NAFLD', 'OB', 'OBS'];

/** Обичайни дни, когато не са научени: равномерно през седмицата (1 = понеделник). */
const ASSUMED_DAYS = { 1: [3], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 7] };

/** Граници на деня спрямо средното — денят не се отдалечава прекалено. */
const DAY_MIN_SHARE = 0.82;
const DAY_MAX_SHARE = 1.25;
const LOW_DAY_SHARE = 0.75;
const MEAL_KCAL_CAPACITY = 650;
const KCAL_FLOOR = { M: 1500, F: 1200, X: 1200 };

const r0 = (x) => Math.round(Number(x) || 0);
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String);

function sessionMinutesOf(label) {
  const s = String(label || '');
  if (/^до 30/i.test(s)) return 25;
  if (/^30/.test(s)) return 40;
  if (/^45/.test(s)) return 55;
  if (/^60/.test(s)) return 75;
  if (/^над 90/i.test(s)) return 100;
  return null;
}

/** Ден от седмицата (0 = неделя) → ден от плана (1 = понеделник … 7 = неделя). */
const planDayOf = (dow) => (dow === 0 ? 7 : dow);

/**
 * Тренировъчната седмица: кои дни, каква тренировка, кога, колко струва.
 * @returns {{ days: number[], source: 'pattern'|'assumed'|'none', confidence: number,
 *   slot: 'am'|'pm'|null, fuel: string, types: string[], minutes: number, sessionKcal: number }}
 */
export function trainingWeek(profile, userData = {}) {
  const types = asList(userData.sportTypes).map(l => SESSION_TYPES[l]).filter(Boolean);
  if (asList(userData.sportTypes_other).length) types.push(OTHER_SESSION);
  const minutes = sessionMinutesOf(userData.sportSessionMinutes) || 55;
  const pattern = userData?._enrichment?.essence?.metrics?.training || null;
  const perWeek = pattern ? pattern.perWeek : (profile.activity?.sportDays || 0);
  if (!(perWeek >= 0.5)) return { days: [], source: 'none', confidence: 0, slot: null, fuel: 'low', types: [], minutes: 0, sessionKcal: 0 };
  const list = types.length ? types : [OTHER_SESSION];
  const met = list.reduce((s, t) => s + t.met, 0) / list.length;
  const kg = Number(profile.weightKg) || 70;
  // Отговорите от вечерния въпрос са по-лични от формулата (без двойно броените крачки).
  const sessionKcal = pattern?.kcal > 0 ? pattern.kcal : r0((met - 1) * kg * minutes / 60);
  // Енергийната система, която доминира: гликолитичната печели при смесени видове.
  const order = ['glycolytic', 'endurance', 'mixed', 'aerobic', 'low'];
  const fuel = order.find(f => list.some(t => t.fuel === f)) || 'mixed';
  let days;
  let source;
  let confidence;
  if (pattern?.usual?.length) {
    days = pattern.usual.map(planDayOf).sort((a, b) => a - b);
    source = 'pattern';
    // Редовност 0,65 → половин амплитуда, 1 → пълна.
    confidence = Math.max(0.5, Math.min(1, (pattern.regularity - 0.4) / 0.6));
  } else {
    days = ASSUMED_DAYS[Math.min(7, Math.max(1, Math.round(perWeek)))] || [];
    source = 'assumed';
    confidence = 0.5;
  }
  return { days, source, confidence, slot: pattern?.slot === 'am' || pattern?.slot === 'pm' ? pattern.slot : null, fuel, types: list.map(t => t.label), minutes, sessionKcal };
}

/**
 * Може ли да има хранене в часови прозорец и какъв. Изборът на клиента
 * (Фастинг → IF) го включва; иначе е предложение, ако е безопасно.
 * @returns {{ active: boolean, offered: boolean, protocol: 'none'|'tre12'|'tre14'|'tre16', early: boolean,
 *   windowText: string, lowDay: number|null, blocked: string[], note: string }}
 */
export function fastingPlan(profile, userData = {}, week = { days: [], slot: null }) {
  const blocked = [];
  const behaviors = new Set(profile.behaviors || []);
  const clinical = new Set(profile.clinical || []);
  const bmi = profile.weightKg && profile.heightCm ? profile.weightKg / ((profile.heightCm / 100) ** 2) : null;
  if (clinical.has('PP') || profile.goal === 'PP' || profile.protocol === 'postpartum_lactation') blocked.push('бременност/кърмене');
  if ((profile.adjustments || []).some(a => /^MEDS_NO_FASTING/.test(a))) blocked.push('лекарства с риск от хипогликемия');
  if (behaviors.has('CMP')) blocked.push('компенсиране с гладуване');
  if (behaviors.has('EMO') && behaviors.has('OVR')) blocked.push('емоционално хранене с преяждане');
  if (bmi != null && bmi < 18.5) blocked.push('ниско тегло');
  if (profile.age != null && (profile.age < 18 || profile.age >= 70)) blocked.push('възраст');
  if (profile.goal === 'GAIN') blocked.push('цел мускулна маса (енергията се събира трудно в кратък прозорец)');
  const chose = behaviors.has('IF');
  const early = /сутрешен/i.test(String(userData.chronotype || '')) || week.slot === 'am';
  if (blocked.length) {
    return { active: false, offered: false, protocol: 'none', early, windowText: '', lowDay: null, blocked,
      note: chose ? `Хранене в часови прозорец не се прилага: ${blocked.join(', ')}.` : '' };
  }
  // Висок стрес, надбъбречна умора, T2D: най-много 14:10 — по-дълъг глад вдига кортизола и риска от хипогликемия.
  const gentle = profile.stress === 3 || clinical.has('ADR') || clinical.has('T2D') || profile.protocol === 'chronic_stress';
  const protocol = gentle ? 'tre12' : (profile.sex === 'M' ? 'tre16' : 'tre14');
  const hours = { tre12: 12, tre14: 10, tre16: 8 }[protocol];
  const windowText = early
    ? `${hours === 12 ? '07:00–19:00' : hours === 10 ? '08:00–18:00' : '08:00–16:00'} (ранен прозорец)`
    : `${hours === 12 ? '08:00–20:00' : hours === 10 ? '10:00–20:00' : '12:00–20:00'}`;
  // Един по-лек ден (~75%) в седмицата — при цел отслабване и избран фастинг, в почивен ден.
  let lowDay = null;
  if (chose && ['LOSS', 'VISC', 'CELL'].includes(profile.goal) && !gentle) {
    // Почивен ден, след който няма тренировка (гликогенът за нея не се изчерпва);
    // неделята е денят със свободното хранене — тя не е лека.
    const rest = [1, 2, 3, 4, 5, 6].filter(d => !week.days.includes(d));
    lowDay = rest.find(d => !week.days.includes(d + 1) && !week.days.includes(d - 1))
      ?? rest.find(d => !week.days.includes(d + 1)) ?? null;
  }
  return {
    active: chose,
    offered: !chose,
    protocol,
    early,
    windowText,
    lowDay,
    blocked: [],
    note: chose
      ? `Хранене в прозорец ${windowText} в почивните дни; в тренировъчните храненето обгражда тренировката.`
      : `Възможност: хранене в прозорец ${windowText} в почивните дни — включва се по желание.`,
  };
}

/** Храненето преди и след тренировката по частта от деня. */
function sessionSlots(slots, slot) {
  if (slot === 'am') return { pre: slots.includes('Хранене 1') ? 'Хранене 1' : null, post: 'Хранене 2' };
  if (slot === 'pm') return { pre: slots.includes('Хранене 3') ? 'Хранене 3' : 'Хранене 2', post: 'Хранене 4' };
  return { pre: null, post: null };
}

/**
 * Дневните цели на седмицата.
 * @param {object} profile компилиран профил (след промените)
 * @param {{ kcal: number, macros: { protein: number, carbs: number, fats: number } }} base средното за деня
 * @param {ReturnType<typeof trainingWeek>} week
 * @param {ReturnType<typeof fastingPlan>} fasting
 * @param {string[]} slots храненията на клиента
 * @returns {Array<{ day: number, kind: 'train'|'rest'|'low', kcal: number, macros: { protein: number, carbs: number, fats: number },
 *   slots: string[], bias: Record<string, Record<string, number>>, timing: { pre: string|null, post: string|null }, window: string|null }>}
 */
export function weekTargets(profile, base, week, fasting, slots) {
  const K = r0(base.kcal);
  const P = r0(base.macros.protein);
  const C = r0(base.macros.carbs);
  const F = r0(base.macros.fats);
  const style = profile.diet?.style || 'balanced';
  const kg = Number(profile.weightKg) || referenceWeightKg(profile);
  const minFat = Math.round(kg * MIN_FAT_G_PER_KG);
  // Безопасният минимум за деня — с резерв за кухненските грамажи (менюто е ±3% от целта).
  const sexFloor = Math.round((KCAL_FLOOR[profile.sex] || 1200) * 1.06);
  const floor = Math.max(sexFloor, r0(K * DAY_MIN_SHARE));
  const metabolicRisk = (profile.clinical || []).some(c => METABOLIC_RISK.includes(c)) || profile.protocol === 'insulin_resistance';
  const carbSensitive = metabolicRisk || ['LOSS', 'VISC', 'CELL'].includes(profile.goal);
  const w = week.confidence || 0;
  const coupling = (COUPLING_BY_GOAL[profile.goal] ?? DEFAULT_COUPLING) * w;
  let swing = (CARB_SWING_BY_GOAL[profile.goal] ?? DEFAULT_CARB_SWING) * w * (metabolicRisk ? 1.3 : 1);
  if (style === 'keto') swing = 0; // кето пази кетозата всеки ден — въглехидратите не се циклират
  const carbShare = FUEL_CARB_SHARE[week.fuel] ?? 0.6;
  // Таванът на деня: и спрямо средното, и спрямо това, което храненията побират (~650 kcal средно).
  const dayMax = Math.min(K * DAY_MAX_SHARE, Math.max(K, MEAL_KCAL_CAPACITY * slots.length));

  // 1. Енергия по ден: средното + частта от тренировката, сборът за седмицата се пази.
  const E = [1, 2, 3, 4, 5, 6, 7].map(d => (week.days.includes(d) ? week.sessionKcal : 0));
  const meanE = E.reduce((a, b) => a + b, 0) / 7;
  let kcal = E.map(e => K + coupling * (e - meanE));
  if (fasting.lowDay) {
    // По-лекият ден: 75% от средното; разликата се разпределя по останалите дни.
    const i = fasting.lowDay - 1;
    const cut = kcal[i] - Math.max(sexFloor, K * LOW_DAY_SHARE);
    if (cut > 0) {
      kcal[i] -= cut;
      kcal = kcal.map((k, j) => (j === i ? k : k + cut / 6));
    }
  }
  kcal = kcal.map((k, i) => Math.min(dayMax, Math.max(i === fasting.lowDay - 1 ? Math.max(sexFloor, K * LOW_DAY_SHARE) : floor, k)));
  // Изравняване на сбора след границите (разликата отива в нетренировъчните дни, после навсякъде).
  for (let pass = 0; pass < 3; pass++) {
    const diff = 7 * K - kcal.reduce((a, b) => a + b, 0);
    if (Math.abs(diff) < 1) break;
    const open = kcal.map((k, i) => i).filter(i => (diff > 0 ? kcal[i] < dayMax : kcal[i] > floor) && i !== fasting.lowDay - 1);
    if (!open.length) break;
    for (const i of open) kcal[i] += diff / open.length;
  }

  // 2. Въглехидрати по ден: следват енергията на деня (по горивото) + люлка тренировка/почивка при еднакви калории.
  const trainDays = week.days.length;
  const restDays = 7 - trainDays;
  const swingG = trainDays && restDays ? swing * C : 0;
  const days = [1, 2, 3, 4, 5, 6, 7].map((d, i) => {
    const kind = d === fasting.lowDay ? 'low' : week.days.includes(d) ? 'train' : 'rest';
    let carbs = C + carbShare * (kcal[i] - K) / 4;
    if (swingG) carbs += kind === 'train' ? swingG * restDays / 7 : -swingG * trainDays / 7;
    if (kind === 'low') carbs = Math.min(carbs, C * 0.6);
    // Граници по стила: кето — таванът; нисковъглехидратна — таванът и в тренировъчния ден.
    if (style === 'keto') carbs = Math.min(KETO_MAX_CARB_G, C);
    else if (style === 'low_carb') carbs = Math.min(LOW_CARB_MAX_G, carbs);
    // При метаболитен риск почивният ден се стреми към ≤25% от енергията от въглехидрати.
    // Само при тренировъчни дни — те поемат разликата; без тях макросите остават клиничните (macro-targets.js).
    if (metabolicRisk && trainDays && kind !== 'train' && style !== 'keto') carbs = Math.min(carbs, kcal[i] * 0.25 / 4);
    // Колко може да се отдалечи денят от средното: ястията на диетата трябва да могат да го носят
    // (въглехидрати −30…+35%, мазнини до 1,35 пъти средните).
    if (style !== 'keto') carbs = Math.min(C * 1.35, Math.max(C * 0.7, carbs));
    carbs = Math.max(style === 'keto' ? 0 : 40, carbs);
    let fats = (kcal[i] - 4 * P - 4 * carbs) / 9;
    const maxFat = Math.max(minFat, F * 1.35);
    if (fats > maxFat && style !== 'keto') {
      fats = maxFat;
      carbs = (kcal[i] - 4 * P - 9 * fats) / 4;
    }
    if (fats < minFat) {
      // Мазнините не падат под хормоналния минимум — въглехидратите отстъпват.
      fats = minFat;
      carbs = Math.max(0, (kcal[i] - 4 * P - 9 * fats) / 4);
    }
    const timing = kind === 'train' ? sessionSlots(slots, week.slot) : { pre: null, post: null };
    return { day: d, kind, kcal: kcal[i], macros: { protein: P, carbs, fats }, timing };
  });

  // 3. Грамове: цели числа и точни калории на деня.
  return days.map((x) => {
    const protein = P;
    const carbs = Math.round(x.macros.carbs);
    const fats = Math.max(minFat, Math.round((x.kcal - 4 * protein - 4 * carbs) / 9));
    const kcalDay = protein * 4 + carbs * 4 + fats * 9;
    // Храненията на деня: в почивния ден при фастинг — прозорецът.
    let daySlots = [...slots];
    let window = null;
    if (fasting.active && x.kind !== 'train') {
      window = fasting.windowText;
      // Ранен прозорец: без късна закуска (при 16:8 и без следобедната — вечерята е рано).
      // Късен прозорец: денят започва с обяда.
      if (fasting.early) daySlots = daySlots.filter(s => s !== 'Хранене 5' && !(fasting.protocol === 'tre16' && s === 'Хранене 3'));
      else if (fasting.protocol !== 'tre12') daySlots = daySlots.filter(s => s !== 'Хранене 1' && s !== 'Хранене 5');
      else daySlots = daySlots.filter(s => s !== 'Хранене 5');
      if (daySlots.filter(s => s === 'Хранене 2' || s === 'Хранене 4').length < 2) daySlots = [...slots];
    }
    // Къде отиват въглехидратите в деня (STA — зърнени, FRU — плодове).
    const bias = { STA: {}, FRU: {} };
    if (x.kind === 'train' && x.timing.post) {
      bias.STA[x.timing.post] = 1.6;
      if (x.timing.pre) { bias.STA[x.timing.pre] = 1.15; bias.FRU[x.timing.pre] = 1.4; }
    } else if (x.kind !== 'train' && carbSensitive) {
      // Почивен ден: въглехидратите — по-рано през деня, вечерята по-лека на тях.
      // Без закуска обядът поема дела ѝ — изместването е по-меко, за да не прелее.
      const hasBreakfast = daySlots.includes('Хранене 1');
      if (hasBreakfast) bias.STA['Хранене 1'] = 1.2;
      bias.STA['Хранене 2'] = hasBreakfast ? 1.15 : 1.05;
      bias.STA['Хранене 4'] = hasBreakfast ? 0.6 : 0.8;
    }
    return { day: x.day, kind: x.kind, kcal: kcalDay, macros: { protein, carbs, fats }, slots: daySlots, bias, timing: x.timing, window };
  });
}

/**
 * Цялата метаболитна седмица за профила.
 * @returns {{ week: ReturnType<typeof trainingWeek>, fasting: ReturnType<typeof fastingPlan>, days: ReturnType<typeof weekTargets> }}
 */
export function metabolicWeek(profile, userData, base, slots) {
  const week = trainingWeek(profile, userData);
  const fasting = fastingPlan(profile, userData, week);
  const days = weekTargets(profile, base, week, fasting, slots);
  return { week, fasting, days };
}

const DAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];
const fmt = (n) => String(n).replace('.', ',');

/** Текстът за клиента: кой ден какъв е и защо — с конкретни числа. */
export function describeMetabolicWeek(mw, profile) {
  const { week, fasting, days } = mw;
  const train = days.filter(d => d.kind === 'train');
  const rest = days.filter(d => d.kind !== 'train');
  const avg = (list, f) => (list.length ? Math.round(list.reduce((s, d) => s + f(d), 0) / list.length) : 0);
  const lines = [];
  if (train.length && rest.length) {
    const tC = avg(train, d => d.macros.carbs);
    const rC = avg(rest, d => d.macros.carbs);
    const tK = avg(train, d => d.kcal);
    const rK = avg(rest, d => d.kcal);
    const which = week.source === 'pattern'
      ? `по отговорите Ви вечер тренирате обикновено ${train.map(d => DAY_SHORT[d.day - 1]).join(', ')}`
      : `приети са ${train.map(d => DAY_SHORT[d.day - 1]).join(', ')} — уточняват се от отговорите Ви вечер`;
    lines.push(`Тренировъчни дни (${which}): ~${tK} kcal и ~${tC} г въглехидрати; почивни: ~${rK} kcal и ~${rC} г въглехидрати. Белтъкът е еднакъв всеки ден — ${days[0].macros.protein} г.`);
    const slot = week.slot === 'am' ? 'обяда след сутрешната тренировка' : week.slot === 'pm' ? 'вечерята след тренировката, а лека закуска с плод — преди нея' : 'храненето след тренировката';
    if (profile.diet?.style !== 'keto') lines.push(`В тренировъчния ден по-голямата част от въглехидратите е в ${slot}: тогава мускулът ги поема за възстановяване на гликогена.`);
    if (rest.some(d => d.macros.carbs < tC) && profile.diet?.style !== 'keto') {
      lines.push('В почивния ден енергията е повече от мазнини и зеленчуци, а въглехидратите са по-рано през деня — инсулиновата чувствителност е по-висока сутрин.');
    }
  } else if (!train.length) {
    lines.push('Без тренировки дните са еднакви по енергия; въглехидратите са по-рано през деня, вечерята е по-лека на тях.');
  }
  const low = days.find(d => d.kind === 'low');
  if (low) lines.push(`${DAY_SHORT[low.day - 1].toUpperCase()} е по-лек ден (~${low.kcal} kcal) с пълния белтък — седмичният баланс е същият, разликата е разпределена в другите дни.`);
  if (fasting.note) lines.push(fasting.note);
  return lines;
}

/* ─── Качеството на менюто: не колко, а от какво ──────────────────────── */

/**
 * Измерими показатели на седмичното меню от храните и грамовете му:
 *   фибри — 14 г на 1000 kcal (IOM/DGA);
 *   растително разнообразие — 30 различни растителни храни седмично (American Gut, McDonald 2018);
 *   мазна риба — 2+ порции седмично (EPA/DHA, AHA);
 *   пълнозърнести — поне половината от зърнените (DGA);
 *   белтък на основно хранене — над прага за мускулен синтез, ~0,3 г/кг и поне 20 г (Moore 2015);
 *   въглехидрати към фибри — до 10:1 (критерий за качествени въглехидрати, Mozaffarian 2013).
 * Витамини и минерали не се оценяват: базата има само макроси, фибри и натрий.
 * @param {Array<{ foods: Array<{ id: string, grams: number }>, mealsProtein: number[] }>} days
 * @param {{ food: (id: string) => any, fiberPer100: (id: string) => number|null }} lib
 */
export function menuQuality(days, lib, profile, kcal) {
  let fiber = 0;
  let fiberKnownG = 0;
  let totalG = 0;
  let carbs = 0;
  const plants = new Set();
  let oilyFishMeals = 0;
  let wholeG = 0;
  let grainG = 0;
  let highGiG = 0;
  let staG = 0;
  let mainMeals = 0;
  let mainMealsOk = 0;
  const refKg = referenceWeightKg(profile);
  const proteinMin = Math.max(20, 0.3 * refKg);
  const PLANT_GROUPS = new Set(['VEG', 'FRU', 'LEG', 'STA']);
  for (const day of days) {
    for (const meal of day.meals || []) {
      let fishInMeal = false;
      for (const { id, grams } of meal.foods) {
        const f = lib.food(id);
        totalG += grams;
        carbs += (f.per100?.carbs || 0) * grams / 100;
        const fb = lib.fiberPer100(id);
        if (fb != null) { fiber += fb * grams / 100; fiberKnownG += grams; }
        const flags = f.flags instanceof Set ? f.flags : new Set(Object.keys(f.flags || {}));
        if (PLANT_GROUPS.has(f.group) || f.kind === 'plant' || flags.has('nut') || flags.has('seed')) plants.add(id);
        if (flags.has('oily_fish')) fishInMeal = true;
        if (flags.has('grain') || flags.has('whole_grain') || flags.has('refined')) {
          grainG += grams;
          if (flags.has('whole_grain')) wholeG += grams;
        }
        if (f.group === 'STA') {
          staG += grams;
          if (flags.has('high_gi')) highGiG += grams;
        }
      }
      if (fishInMeal) oilyFishMeals++;
      if (meal.main) {
        mainMeals++;
        if (meal.protein >= proteinMin) mainMealsOk++;
      }
    }
  }
  const n = days.length || 1;
  const coverage = totalG ? fiberKnownG / totalG : 0;
  // Непокритите грамове (вода в ястието, подправки) — по средната плътност на покритите.
  const fiberDay = coverage > 0 ? (fiber / coverage) / n : null;
  const fiberTarget = Math.round(14 * kcal / 1000);
  const items = [];
  const add = (code, value, target, ok, text) => items.push({ code, value, target, status: ok ? 'ok' : 'low', text });
  if (fiberDay != null) add('fiber', Math.round(fiberDay), fiberTarget, fiberDay >= fiberTarget * 0.9, `Фибри: ~${Math.round(fiberDay)} г дневно (цел ${fiberTarget} г — 14 г на 1000 kcal).`);
  add('plants', plants.size, 30, plants.size >= 30, `Растително разнообразие: ${plants.size} различни растителни храни за седмицата (цел 30 — за чревната микробиота).`);
  add('oily_fish', oilyFishMeals, 2, oilyFishMeals >= 2, `Мазна риба: ${oilyFishMeals} пъти седмично (цел 2 — омега-3 EPA/DHA).`);
  if (grainG > 0) {
    const share = Math.round(wholeG / grainG * 100);
    add('whole_grain', share, 50, share >= 50, `Пълнозърнести: ${share}% от зърнените (цел поне 50%).`);
  }
  if (staG > 0) {
    const share = Math.round(highGiG / staG * 100);
    add('high_gi', share, 20, share <= 20, `Нишестени с висок гликемичен индекс: ${share}% (до 20%).`);
  }
  if (mainMeals) {
    const share = Math.round(mainMealsOk / mainMeals * 100);
    add('protein_meal', share, 90, share >= 90, `Белтък над прага за мускулен синтез (≥${Math.round(proteinMin)} г) в ${share}% от основните хранения.`);
  }
  if (fiberDay != null && carbs > 0) {
    const ratio = (carbs / n) / fiberDay;
    add('carb_fiber', Math.round(ratio * 10) / 10, 10, ratio <= 10, `Въглехидрати към фибри: ${fmt(Math.round(ratio * 10) / 10)}:1 (до 10:1 — въглехидрати с фибри, не рафинирани).`);
  }
  return { items, fiberCoverage: Math.round(coverage * 100) };
}
