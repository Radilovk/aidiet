/**
 * Проследяване и корекция — седмичната среща с диетолога.
 *
 * Въпросите са стандартните за контролен преглед: промяна в теглото,
 * придържане, глад, енергия, най-голяма трудност. Решението следва
 * практиката: калориите се пипат само когато планът е спазван и резултатът
 * се разминава с очаквания поне две поредни седмици (единична седмица е
 * шум от вода и гликоген); твърде бързото отслабване се забавя, за да се
 * пази мускулната маса; ниското придържане се лекува с по-прост план, не
 * с по-малко калории. Промяната е най-много 150 kcal седмично и никога под
 * безопасния минимум.
 */

export const WEEKLY_CHECKIN_QUESTIONS = [
  {
    id: 'weightKg',
    // Прегледът излиза по всяко време на деня — пита се последното сутрешно тегло, не „днес“.
    text: 'Последното ти тегло сутрин — на гладно, след тоалетна (кг). Тази или вчерашната сутрин.',
    type: 'number',
    min: 30,
    max: 300,
    placeholder: 'напр. 72,4',
    skipLabel: 'Не съм се теглил/а',
    options: [],
  },
  {
    id: 'waistCm',
    text: 'Обиколка на талията на нивото на пъпа (см) — по желание. Показва напредъка, когато кантарът стои.',
    type: 'number',
    min: 40,
    max: 200,
    placeholder: 'напр. 84',
    skipLabel: 'Не съм мерил/а',
    options: [],
  },
  {
    id: 'weight',
    text: 'Как се промени теглото ти спрямо миналата седмица?',
    type: 'choice',
    skipIfAnswered: 'weightKg',
    options: ['Отслабнах повече от 1 кг', 'Отслабнах до 1 кг', 'Без промяна', 'Качих', 'Не съм се теглил/а'],
  },
  {
    id: 'adherence',
    text: 'Колко от храненията в плана успя да спазиш?',
    type: 'choice',
    options: ['Почти всички', 'Повечето', 'Около половината', 'Малко'],
  },
  {
    // Само когато съставът е водещ (мускулна маса, стягане, смяна на състава) — виж weeklyQuestionsFor.
    id: 'workouts',
    text: 'Колко силови тренировки направи тази седмица?',
    type: 'choice',
    onlyForLead: 'workouts',
    options: ['Нито една', '1', '2', '3 и повече'],
  },
  {
    id: 'hunger',
    text: 'Колко често огладняваше между храненията?',
    type: 'scale_1_3',
    options: ['Рядко', 'Понякога', 'Често'],
  },
  {
    id: 'energy',
    text: 'Как беше енергията ти през деня?',
    type: 'scale_1_3',
    options: ['Добра', 'Средна', 'Ниска'],
  },
  {
    id: 'difficulty',
    text: 'Кое беше най-трудно тази седмица?',
    type: 'choice',
    options: ['Нищо особено', 'Приготвянето отнема време', 'Порциите ми идват много', 'Липсваше ми разнообразие', 'Храносмилането (подуване, тежест)'],
  },
  {
    id: 'note',
    text: 'Искаш ли да добавиш нещо за следващата седмица? (по желание)',
    type: 'text',
    options: [],
  },
];

const KCAL_PER_KG = 7700;
const MAX_WEEKLY_STEP = 150;
const MAX_TOTAL_SHIFT = 400;

const WEIGHT_ANSWERS = {
  'Отслабнах повече от 1 кг': 'fast_loss',
  'Отслабнах до 1 кг': 'loss',
  'Без промяна': 'flat',
  'Качих': 'gain',
  'Качих повече от 0,5 кг': 'fast_gain',
  'Качих до 0,5 кг': 'gain',
  'Отслабнах': 'loss',
  'Не съм се теглил/а': null,
};

/** При цел мускулна маса въпросът за теглото е в посоката на целта. */
const GAIN_WEIGHT_OPTIONS = ['Качих повече от 0,5 кг', 'Качих до 0,5 кг', 'Без промяна', 'Отслабнах', 'Не съм се теглил/а'];

const fmtKg = v => String(Math.round(v * 10) / 10).replace('.', ',');

/**
 * Въпросите за конкретния клиент: посоката на въпроса за теглото следва целта,
 * а това, което приложението вече знае, се показва като подсказка (теглото от
 * везната е попълнено; спазването по отметките е до въпроса), за да не се гадае.
 * @param {{ goal?: string, direction?: string|null, lead?: string[], deviceWeightKg?: number|null, deviceWeightDays?: number, workoutsWeek?: number|null, mealAdherence?: number|null, mealDays?: number }} [ctx]
 */
export function weeklyQuestionsFor(ctx = {}) {
  const lead = Array.isArray(ctx.lead) ? ctx.lead : [];
  const direction = ctx.direction || (ctx.goal === 'GAIN' ? 'gain' : null);
  // Вечерните отговори „Тренирахте ли днес?“ показват 0 тренировки за седмицата — известно, не се пита.
  const knownNoTraining = ctx.workoutsWeek === 0;
  return WEEKLY_CHECKIN_QUESTIONS
    .filter(q => !q.onlyForLead || lead.includes(q.onlyForLead))
    .filter(q => !(q.id === 'workouts' && knownNoTraining))
    .map((q) => {
      /** @type {Record<string, any>} */
      const out = { ...q, options: [...q.options] };
      delete out.onlyForLead;
      if (q.id === 'weight' && direction === 'gain') out.options = [...GAIN_WEIGHT_OPTIONS];
      // Талията е водещ показател (коремни мазнини, стягане, смяна на състава) — не „по желание“.
      if (q.id === 'waistCm' && lead.slice(0, 3).includes('waist')) {
        out.text = 'Обиколка на талията на нивото на пъпа (см). За твоята цел тя показва напредъка по-точно от кантара.';
      }
      if (q.id === 'weightKg' && Number(ctx.deviceWeightKg) >= 30) {
        out.prefill = String(Math.round(ctx.deviceWeightKg * 10) / 10);
        // При поне 3 сутрешни измервания средното им е по-точно от едно претегляне —
        // число, различно с над 2%, не го заменя (виж runWeeklyAdaptation).
        out.hint = (ctx.deviceWeightDays || 0) >= 3
          ? `От везната: ${fmtKg(ctx.deviceWeightKg)} кг — средно от последните ${ctx.deviceWeightDays} дни. То е по-точно от едно претегляне; число с над 2% разлика няма да го замени.`
          : `От везната: ${fmtKg(ctx.deviceWeightKg)} кг (средно от последните дни). Поправи, ако не е вярно.`;
      }
      if (q.id === 'workouts' && Number(ctx.workoutsWeek) > 0) {
        out.hint = `По вечерните отговори: ${ctx.workoutsWeek} тренировки тази седмица (всякакви). Колко от тях са силови?`;
      }
      if (q.id === 'adherence' && ctx.mealAdherence != null && (ctx.mealDays || 0) >= 3) {
        out.hint = `По отметките в приложението: около ${Math.round(ctx.mealAdherence)}% от храненията.`;
      }
      return out;
    });
}
/** Над толкова разлика едно претегляне не е колебание (вода, храна: 1–2% на ден). */
const WEIGH_IN_TOLERANCE = 0.02;
/** От толкова различни дни измервания средното от везната е по-сигурно от едно число. */
const DEVICE_RELIABLE_DAYS = 3;

/**
 * Кое тегло влиза в прегледа: въведеното от клиента или средното от везната.
 * Въведеното печели (може да е поправка), освен когато везната има поне 3 дни
 * измервания и числото се различава с над 2% — тогава е по-вероятно вечерно
 * претегляне, с дрехи или грешка, отколкото промяна в тялото.
 * @param {number|string|null} typedKg  въведеното (числото или текстът от отговора)
 * @param {{ kg?: number|null, days?: number }} device
 * @returns {{ kg: number|null, source: 'client'|'device'|null, typedKg: number|null }}
 */
export function pickWeighIn(typedKg, device = {}) {
  const typed = Number(typedKg) >= 30 && Number(typedKg) <= 300 ? Number(typedKg) : null;
  const dev = Number(device.kg) >= 30 && Number(device.kg) <= 300 ? Number(device.kg) : null;
  if (!dev) return { kg: typed, source: typed ? 'client' : null, typedKg: typed };
  if (!typed) return { kg: dev, source: 'device', typedKg: null };
  if ((device.days || 0) >= DEVICE_RELIABLE_DAYS && Math.abs(typed - dev) / dev > WEIGH_IN_TOLERANCE) {
    return { kg: dev, source: 'device', typedKg: typed };
  }
  return { kg: typed, source: 'client', typedKg: typed };
}

const ADHERENCE_ANSWERS = { 'Почти всички': 95, 'Повечето': 80, 'Около половината': 50, 'Малко': 25 };
const WORKOUT_ANSWERS = { 'Нито една': 0, '1': 1, '2': 2, '3 и повече': 3 };
const LEVEL_ANSWERS = { 'Рядко': 1, 'Понякога': 2, 'Често': 3, 'Добра': 1, 'Средна': 2, 'Ниска': 3 };

function answerOf(answers, id) {
  const hit = (answers || []).find(a => a.questionId === id);
  return hit ? String(hit.value) : null;
}

/** Под тази промяна за седмица кантарът не различава тренд от вода и храна в червата. */
const FLAT_KG = 0.2;
/** Над 1% от теглото седмично при отслабване — губи се мускулна маса (ACSM, NICE). */
const FAST_LOSS_RATE = 0.01;
/** При кърмене — до ~0.5 кг седмично, за да не пада млекото (IOM/ACOG). */
const LACTATION_MAX_LOSS_KG = 0.5;
/** Мускулна маса: до 0.5% от теглото седмично; над това качването е предимно мазнини. */
const FAST_GAIN_RATE = 0.005;
/** Под 40% от очакваното отслабване при спазен план — застой. */
const SLOW_LOSS_SHARE = 0.4;
/** Над толкова дни от предишното претегляне темпото не се смята. */
const MAX_SPAN_DAYS = 84;
/** Първата седмица на дефицит сваля вода и гликоген (1–2 кг са обичайни): калориите не се вдигат, освен над 3% от теглото. */
const FIRST_WEEK_FAST_RATE = 0.03;
/** Толкова см по-малко в талията при застой на кантара — мазнини се губят, а мускули/вода се задържат. */
const WAIST_PROGRESS_CM = 1;

/**
 * Отговорите и аналитиката → една картина на седмицата.
 * @param {Array<{questionId: string, value: string}>} answers
 * @param {object|null} analytics  buildAnalyticsSummary()
 * @param {{ prevWeightKg?: number|null, daysSincePrev?: number|null, prevWaistCm?: number|null }} [previous]
 *   последното измерено тегло (от предишния преглед или въпросника), преди колко дни и последната талия
 */
export function readCheckin(answers, analytics, previous = {}) {
  const weightAnswer = answerOf(answers, 'weight');
  const adherenceAnswer = answerOf(answers, 'adherence');
  // Спазване на храненията от приложението (не ангажираност) — от поне 3 дни с отметки.
  const appValue = analytics?.status === 'active' && (analytics.mealDays || 0) >= 3 && analytics.mealAdherence != null
    ? Number(analytics.mealAdherence)
    : null;
  const fromAnswer = adherenceAnswer ? ADHERENCE_ANSWERS[adherenceAnswer] ?? null : null;
  // Отговорът е за цялата седмица; отметките — за дните, в които са правени.
  // При двата източника — средното; само единият — той.
  let adherence = null;
  if (fromAnswer != null && appValue != null) adherence = Math.round((fromAnswer + appValue) / 2);
  else adherence = fromAnswer ?? appValue;

  const kg = Number(String(answerOf(answers, 'weightKg') || '').replace(',', '.'));
  const weightKg = kg >= 30 && kg <= 300 ? kg : null;
  let weeklyChangeKg = null;
  const prev = Number(previous.prevWeightKg) || null;
  if (weightKg && prev) {
    const days = Number(previous.daysSincePrev);
    // Промяната се води към седмица по реалните дни между двете претегляния.
    // Под 4 дни разликата е вода и храна в червата; над 12 седмици — твърде
    // стара точка: и в двата случая темпо не се смята (остава отговорът).
    // Без дата — приема се една седмица.
    const span = Number.isFinite(days) && days > 0 ? days : 7;
    weeklyChangeKg = span >= 4 && span <= MAX_SPAN_DAYS ? Math.round((weightKg - prev) / span * 7 * 100) / 100 : null;
  }
  // Тенденцията от поне 5 претегляния за 2 седмици е по-точна от две точки.
  const trend = Number(answerOf(answers, 'weightTrendKgWeek'));
  if (answerOf(answers, 'weightTrendKgWeek') != null && Number.isFinite(trend) && Math.abs(trend) <= 3) weeklyChangeKg = trend;
  // Талията: промяна спрямо предишното измерване (каквото и да е било преди).
  const cm = Number(String(answerOf(answers, 'waistCm') || '').replace(',', '.'));
  const waistCm = cm >= 40 && cm <= 200 ? Math.round(cm * 10) / 10 : null;
  const prevWaist = Number(previous.prevWaistCm) || null;
  const waistChangeCm = waistCm && prevWaist ? Math.round((waistCm - prevWaist) * 10) / 10 : null;
  // Среден дневен прием от тракер (Health Connect) — само при поне 4 записани дни.
  const intake = Number(answerOf(answers, 'intakeKcal'));
  return {
    weight: weightAnswer ? WEIGHT_ANSWERS[weightAnswer] ?? null : null,
    weightKg,
    weeklyChangeKg,
    waistCm,
    waistChangeCm,
    intakeKcal: intake >= 500 && intake <= 8000 ? Math.round(intake) : null,
    recoveryLow: answerOf(answers, 'recoveryLow') === 'true',
    leanLoss: answerOf(answers, 'leanLoss') === 'true',
    adherence,
    hunger: LEVEL_ANSWERS[answerOf(answers, 'hunger')] || null,
    energy: LEVEL_ANSWERS[answerOf(answers, 'energy')] || null,
    difficulty: answerOf(answers, 'difficulty'),
    workouts: WORKOUT_ANSWERS[answerOf(answers, 'workouts')] ?? null,
    junk: analytics?.junk7 || 0,
  };
}

/**
 * Резултатът по теглото: от измерването (кг/седмица спрямо очакваното и
 * теглото), иначе от отговора на клиента.
 * @returns {'fast_loss'|'loss'|'slow'|'flat'|'gain'|'fast_gain'|null}
 */
export function weightOutcome(checkin, { goalKind, expectedLossKg = 0, weightKg = 0, lactating = false }) {
  const change = checkin.weeklyChangeKg;
  if (change == null) {
    // „Над 1 кг“ без измерване: над 100 кг това е под 1% от теглото — нормален темп.
    if (checkin.weight === 'fast_loss' && !lactating && weightKg >= 100 && checkin.energy !== 3) return 'loss';
    return checkin.weight;
  }
  const base = checkin.weightKg || weightKg || 70;
  const loss = -change;
  if (loss > 0 && (loss >= base * FAST_LOSS_RATE || (lactating && loss > LACTATION_MAX_LOSS_KG))) return 'fast_loss';
  if (change >= FLAT_KG) return goalKind === 'gain' && change > base * FAST_GAIN_RATE ? 'fast_gain' : 'gain';
  if (Math.abs(change) < FLAT_KG) return 'flat';
  // Отслабва, но под 40% от очакваното — застой, ако дефицитът е реален.
  if (goalKind === 'loss' && expectedLossKg >= 0.25 && loss < expectedLossKg * SLOW_LOSS_SHARE) return 'slow';
  return 'loss';
}

/** Еднакви за решението резултати — „без промяна“ и „качих“ са един застой при отслабване. */
const OUTCOME_CLASS = {
  loss: { fast_loss: 'down', loss: 'down', slow: 'stall', flat: 'stall', gain: 'stall', fast_gain: 'stall' },
  gain: { fast_loss: 'down', loss: 'down', slow: 'down', flat: 'stall', gain: 'up', fast_gain: 'fast' },
  keep: { fast_loss: 'down', loss: 'down', slow: 'down', flat: 'flat', gain: 'up', fast_gain: 'up' },
  recomp: { fast_loss: 'down', loss: 'down', slow: 'down', flat: 'flat', gain: 'up', fast_gain: 'up' },
};

/** Смяна на състава: теглото стои, а темп над 0,5% седмично е вече сваляне или трупане. */
const RECOMP_DRIFT_RATE = 0.005;

/**
 * Колко поредни предишни седмици са били от същия клас — само седмици, в
 * които планът е спазван (иначе резултатът не казва нищо за калориите).
 */
function streak(history, goalKind, cls) {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h?.followed === false) break;
    const c = h?.weight ? OUTCOME_CLASS[goalKind][h.weight] : null;
    if (c === cls) n++;
    else break;
  }
  return n;
}

const LOSING_GOALS = new Set(['LOSS', 'VISC', 'CELL', 'PP']);

/** Посоката по стария код на целта — само ако моделът на целта не е подал своята. */
function directionOfGoal(goal) {
  if (LOSING_GOALS.has(goal)) return 'lose';
  if (goal === 'GAIN') return 'gain';
  return 'maintain';
}

/**
 * Решението за следващата седмица.
 *
 * @param {object} args
 * @param {ReturnType<typeof readCheckin>} args.checkin
 * @param {'LOSS'|'VISC'|'GAIN'|'MAINT'|string} args.goal
 * @param {string} [args.direction]  посоката от модела на целта (goal-model.js): lose | gain | recomp | maintain
 * @param {number} args.kcal          текущият дневен прием
 * @param {number} args.tdee          разходът по формула (с текущото тегло)
 * @param {number} args.floorKcal     безопасният минимум
 * @param {number} args.weightKg
 * @param {number} [args.baseKcal]    първоначалното предписание (за общия таван на промените)
 * @param {boolean} [args.lactating]
 * @param {Array<{weight?: string|null, followed?: boolean, calorieAdjust?: number}>} [args.history]
 */
export function decideWeeklyAdjustment({ checkin, goal, direction, kcal, tdee, floorKcal, weightKg, baseKcal = kcal, lactating = false, history = [] }) {
  const reasons = [];
  const changes = [];
  const modifications = [];
  let delta = 0;
  let recomp = false;
  // Седмицата върви по плана — само тогава съобщението хвали (weeklyMessage).
  let onTrack = false;
  // Посоката е от целта в контекста на профила, не от етикета: антиейджинг при
  // затлъстяване е сваляне, мускулна маса при наднормено тегло — смяна на състава.
  const dir = direction || directionOfGoal(goal);
  const losing = dir === 'lose';
  const gaining = dir === 'gain';
  const recomposing = dir === 'recomp';
  const goalKind = losing ? 'loss' : gaining ? 'gain' : recomposing ? 'recomp' : 'keep';
  const adherence = checkin.adherence;
  const followed = adherence != null && adherence >= 75;
  const expectedLoss = Math.max(0, (tdee - kcal) * 7 / KCAL_PER_KG);
  const outcome = weightOutcome(checkin, { goalKind, expectedLossKg: expectedLoss, weightKg, lactating });
  const cls = outcome ? OUTCOME_CLASS[goalKind][outcome] : null;
  // Измереният прием обяснява застоя по-добре от „метаболизмът се е забавил“.
  const overIntake = checkin.intakeKcal != null && checkin.intakeKcal > kcal * 1.1;
  const underIntake = checkin.intakeKcal != null && checkin.intakeKcal < kcal * 0.9;
  const measured = checkin.weeklyChangeKg != null
    ? `${checkin.weeklyChangeKg > 0 ? '+' : ''}${checkin.weeklyChangeKg.toFixed(1).replace('.', ',')} кг за седмица`
    : null;

  if (adherence != null && adherence < 60) {
    // Планът не е изпробван — калориите остават, менюто става по-просто.
    modifications.push('simplify_meals');
    reasons.push(`Спазване на плана: около ${adherence}% — калориите остават, менюто се опростява, за да се спазва по-лесно.`);
    changes.push('По-прости и повтарящи се ястия');
  } else if (outcome && !followed) {
    reasons.push(adherence != null
      ? `Спазване на плана: около ${adherence}% — резултатът по теглото още не показва дали калориите са верни; приемът остава.`
      : 'Няма данни дали планът е спазван (отговор или отметки на храненията) — без тях теглото не показва дали калориите са верни; приемът остава.');
  } else if (outcome && followed) {
    const weeks = streak(history, goalKind, cls) + 1;
    if (losing) {
      const base = checkin.weightKg || weightKg || 70;
      const firstWeekWater = outcome === 'fast_loss' && !lactating && !(history || []).length
        && checkin.energy !== 3 && !(checkin.weeklyChangeKg != null && -checkin.weeklyChangeKg >= base * FIRST_WEEK_FAST_RATE);
      if (firstWeekWater) {
        onTrack = true;
        reasons.push(`Първата седмица${measured ? ` (${measured})` : ''} теглото пада бързо основно от вода и гликоген — приемът остава; темпото се преценява от втората седмица.`);
      } else if (outcome === 'fast_loss') {
        delta = +MAX_WEEKLY_STEP;
        reasons.push(lactating
          ? 'Отслабването е над 0,5 кг седмично при кърмене — приемът се увеличава, за да се пази кърмата.'
          : `Отслабването е над 1% от теглото седмично${measured ? ` (${measured})` : ''} — темпото се забавя, за да се пази мускулната маса.`);
      } else if (cls === 'stall' && overIntake) {
        reasons.push(`По тракера приемът е около ${checkin.intakeKcal} kcal дневно при план ${kcal} kcal — калориите на плана остават; първо приемът да се доближи до плана.`);
      } else if (cls === 'stall' && checkin.waistChangeCm != null && checkin.waistChangeCm <= -WAIST_PROGRESS_CM) {
        recomp = true;
        onTrack = true;
        reasons.push(`Кантарът стои, но талията е с ${fmtKg(-checkin.waistChangeCm)} см по-малко — тялото губи мазнини; приемът остава.`);
      } else if (cls === 'stall') {
        if (weeks >= 2) {
          delta = outcome === 'gain' ? -MAX_WEEKLY_STEP : -100;
          reasons.push(`${weeks} поредни седмици ${outcome === 'slow' ? 'с много бавен спад' : 'без спад'} при спазен план${measured ? ` (${measured})` : ''} — приемът се намалява леко.`);
        } else {
          reasons.push(`${measured ? `${measured}. ` : ''}Една седмица без спад е обичайна (вода, гликоген, цикъл) — приемът остава, следим и следващата.`);
        }
      } else {
        onTrack = true;
        reasons.push(`Темпото отговаря на очакваното (около ${expectedLoss.toFixed(1).replace('.', ',')} кг седмично${measured ? `; измерено ${measured}` : ''}) — приемът остава.`);
      }
    } else if (gaining) {
      if (cls === 'fast') {
        delta = -100;
        reasons.push(`Теглото расте над 0,5% седмично${measured ? ` (${measured})` : ''} — излишъкът отива в мазнини; приемът се намалява леко.`);
      } else if (cls === 'down') {
        delta = +MAX_WEEKLY_STEP;
        reasons.push('Теглото пада при цел покачване на мускулна маса — приемът се увеличава.');
      } else if (cls === 'stall' && underIntake) {
        reasons.push(`По тракера приемът е около ${checkin.intakeKcal} kcal дневно при план ${kcal} kcal — калориите на плана остават; първо приемът да стигне плана.`);
      } else if (cls === 'stall') {
        if (weeks >= 2) {
          delta = +MAX_WEEKLY_STEP;
          reasons.push(`${weeks} поредни седмици без покачване при спазен план — приемът се увеличава.`);
        } else {
          reasons.push('Една седмица без покачване — приемът остава, следим и следващата.');
        }
      } else {
        onTrack = true;
        reasons.push('Теглото расте по план — приемът остава.');
      }
    } else if (recomposing) {
      // Успехът тук е талията и съставът, не кантарът: теглото трябва да стои.
      const base = checkin.weightKg || weightKg || 70;
      const change = checkin.weeklyChangeKg;
      const waistDown = checkin.waistChangeCm != null && checkin.waistChangeCm <= -WAIST_PROGRESS_CM;
      const drifting = change != null && Math.abs(change) > base * RECOMP_DRIFT_RATE;
      if (checkin.workouts === 0) {
        reasons.push('Смяната на състава иска силови тренировки — без тях калориите не решават; приемът остава.');
      } else if (waistDown) {
        recomp = true;
        onTrack = true;
        reasons.push(`Талията е с ${fmtKg(-checkin.waistChangeCm)} см по-малко${measured ? ` при ${measured}` : ''} — съставът се подобрява; приемът остава.`);
      } else if (cls === 'down' && (drifting || outcome === 'fast_loss') && weeks >= 2) {
        delta = +100;
        reasons.push(`Теглото пада втора поредна седмица${measured ? ` (${measured})` : ''} при цел смяна на състава — приемът се увеличава леко, за да се пазят мускулите.`);
      } else if (cls === 'up' && drifting && weeks >= 2) {
        delta = -100;
        reasons.push(`Теглото расте втора поредна седмица${measured ? ` (${measured})` : ''} без по-малка талия — приемът се намалява леко.`);
      } else {
        onTrack = cls === 'flat';
        reasons.push(`Теглото се задържа${measured ? ` (${measured})` : ''} — при смяна на състава това е очакваното; следим талията и тренировките.`);
      }
    } else if (cls === 'up' && weeks >= 2) {
      delta = -100;
      reasons.push('Теглото расте втора поредна седмица при цел поддържане — приемът се намалява леко.');
    } else if (cls === 'down' && weeks >= 2) {
      delta = +100;
      reasons.push('Теглото пада втора поредна седмица при цел поддържане — приемът се увеличава леко.');
    } else {
      onTrack = cls === 'flat';
      reasons.push(`Теглото се задържа в нормалните граници${measured ? ` (${measured})` : ''} — приемът остава.`);
    }
  } else if (!outcome && checkin.weightKg) {
    reasons.push('Теглото е записано; темпото се преценява, когато между две претегляния има поне 4 дни — калориите остават.');
  } else if (!outcome) {
    reasons.push('Без данни за теглото калориите остават — претегли се сутрин на гладно преди следващия преглед.');
  }

  // Обявената корекция отпада по правило за безопасност: фактът остава, а
  // „приемът се намалява“ се маха — иначе две поредни изречения си противоречат.
  let deltaReason = delta ? reasons.length - 1 : -1;
  const cancelDelta = (text) => {
    if (deltaReason >= 0) reasons[deltaReason] = reasons[deltaReason].replace(/\s—\s[^—]*$/, '.');
    reasons.push(text);
    deltaReason = -1;
  };

  // Чест глад и ниска енергия при дефицит и спазен план: не се реже повече,
  // а ако няма корекция — дефицитът се смекчава.
  if (losing && adherence != null && adherence >= 60 && checkin.hunger === 3 && checkin.energy === 3) {
    onTrack = false;
    if (delta < 0) {
      delta = 0;
      cancelDelta('Чест глад и ниска енергия — калориите не се намаляват тази седмица.');
    } else if (delta === 0) {
      delta = +100;
      reasons.push('Чест глад и ниска енергия — дефицитът се смекчава.');
      deltaReason = reasons.length - 1;
    }
  } else if (checkin.hunger === 3) {
    modifications.push('more_volume');
    changes.push('Повече зеленчуци и белтък за ситост');
  }

  if (checkin.difficulty === 'Приготвянето отнема време' && !modifications.includes('simplify_meals')) {
    modifications.push('simplify_meals');
    changes.push('По-бързи за приготвяне ястия');
  }
  if (checkin.difficulty === 'Липсваше ми разнообразие') {
    modifications.push('more_variety');
    changes.push('Повече разнообразие в менюто');
  }
  if (checkin.difficulty === 'Порциите ми идват много') {
    modifications.push('smaller_portions');
    changes.push('Порциите се разпределят в повече хранения');
  }
  if (checkin.difficulty === 'Храносмилането (подуване, тежест)') {
    modifications.push('gentle_digestion');
    changes.push('Щадящи храни с ниско съдържание на FODMAP за следващата седмица');
  }

  // Мускулите растат от натоварването, не от излишъка: без силови тренировки
  // повече калории отиват в мазнини.
  if ((gaining || recomposing) && checkin.workouts === 0 && delta > 0) {
    delta = 0;
    cancelDelta('Без силови тренировки тази седмица — приемът не се увеличава.');
  }

  // Сигнали от устройства: при ниско възстановяване (пулс/HRV) или загуба на
  // мускулна маса по везната дефицитът не се задълбочава.
  if (delta < 0 && checkin.recoveryLow) {
    delta = 0;
    onTrack = false;
    cancelDelta('Пулсът в покой и HRV показват натоварване — тази седмица калориите не се намаляват; приоритет са сънят и възстановяването.');
  }
  if (checkin.leanLoss) {
    onTrack = false;
    modifications.push('increase_protein');
    const text = 'По везната част от загубеното тегло е мускулна маса — повече белтък, без по-голям дефицит.';
    if (delta < 0) {
      delta = 0;
      cancelDelta(text);
    } else reasons.push(text);
    changes.push('Повече белтък за пазене на мускулите');
  }

  // Граници: стъпка, общ таван спрямо първоначалното и безопасен минимум.
  delta = Math.max(-MAX_WEEKLY_STEP, Math.min(MAX_WEEKLY_STEP, delta));
  let next = kcal + delta;
  next = Math.max(baseKcal - MAX_TOTAL_SHIFT, Math.min(baseKcal + MAX_TOTAL_SHIFT, next));
  if (losing) next = Math.min(next, tdee);
  next = Math.max(next, floorKcal);
  delta = Math.round(next - kcal);
  if (delta) changes.unshift(`Калории: ${delta > 0 ? '+' : ''}${delta} kcal на ден`);

  return {
    calorieAdjust: delta,
    kcal: Math.round(next),
    modifications: [...new Set(modifications)],
    reasoning: reasons.join(' '),
    changeSummary: changes.slice(0, 4),
    // За историята: резултатът по теглото, измереното тегло и дали планът е спазван.
    // Застой на кантара с по-малка талия не е застой — „recomp“ прекъсва поредицата.
    weight: recomp ? 'recomp' : outcome,
    waistCm: checkin.waistCm,
    weightKg: checkin.weightKg,
    weeklyChangeKg: checkin.weeklyChangeKg,
    intakeKcal: checkin.intakeKcal,
    followed,
    adherence,
    onTrack,
    // Решаващата причина на седмицата — съобщението към клиента я казва, когато калориите остават.
    note: reasons[reasons.length - 1] || '',
  };
}

/** Кратко съобщение към клиента — без AI, по резултата на седмицата. */
export function weeklyMessage(decision, checkin) {
  if (checkin.adherence != null && checkin.adherence < 60) {
    return {
      headline: 'Нова седмица — по-лесен план',
      message: 'Тази седмица планът беше труден за спазване — това е нормално. Следващата е по-проста: по-малко различни ястия и по-бързо приготвяне. Целта е постоянство, не съвършенство.',
    };
  }
  if (decision.calorieAdjust < 0) {
    return {
      headline: 'Малка корекция за следващата седмица',
      message: 'Планът е спазен — браво. Резултатът се разминава с очакваното, затова приемът се коригира леко. Продължавай със същото темпо.',
    };
  }
  if (decision.calorieAdjust > 0) {
    return {
      headline: 'Новата седмица е по-щедра',
      message: 'Приемът се увеличава леко — за енергия и за запазване на мускулната маса. Продължавай да спазваш плана.',
    };
  }
  if (decision.onTrack) {
    return {
      headline: 'Отлична седмица — продължаваме',
      message: 'Вървите по плана. Новото меню е със същите калории и нови ястия за разнообразие.',
    };
  }
  // Без похвала, когато резултатът е неясен: няма тегло, няма данни за спазването или седмицата е в застой.
  const noWeight = !decision.weight && !decision.weightKg;
  return {
    headline: 'Нова седмица — същите калории',
    message: noWeight
      ? 'Без претегляне калориите остават същите. Претегли се сутрин на гладно преди следващия преглед — така корекцията е точна. Менюто е ново, за разнообразие.'
      : `${decision.note || 'Калориите остават същите.'} Менюто е ново, за разнообразие.`,
  };
}

/* ─── Без да чакаме прегледа ────────────────────────────────────────────── */

export const WEEKLY_CYCLE_MS = 7 * 86400000;
/** Толкова след срока, без отговор от клиента, прегледът се прави автоматично. */
export const WEEKLY_OVERDUE_GRACE_MS = 3 * 86400000;
/** След толкова поредни автоматични прегледа без отговор — спират. */
export const AUTO_WEEKLY_MAX_STREAK = 2;
/** Без данни от приложението и устройствата толкова време — профилът е спящ. */
export const AUTO_WEEKLY_DORMANT_MS = 30 * 86400000;

/**
 * Какво да стане с просрочен преглед. Автоматичен преглед се прави само ако има
 * нови данни след последния (иначе няма какво да се коригира — и няма разход).
 * @param {{ hasPlan: boolean, pending: boolean, lastReviewMs: number, activeMs: number, autoStreak: number, dueMs: number, now: number }} s
 * @returns {'wait'|'no-plan'|'pending'|'dormant'|'streak'|'quiet'|'run'}
 */
export function autoWeeklyAction(s) {
  if (!s.dueMs || s.now - s.dueMs < WEEKLY_OVERDUE_GRACE_MS) return 'wait';
  if (!s.hasPlan) return 'no-plan';
  if (s.pending) return 'pending';
  if (s.now - (s.activeMs || 0) > AUTO_WEEKLY_DORMANT_MS) return 'dormant';
  if ((s.autoStreak || 0) >= AUTO_WEEKLY_MAX_STREAK) return 'streak';
  if ((s.activeMs || 0) <= (s.lastReviewMs || 0)) return 'quiet';
  return 'run';
}

/**
 * Промени в данните, които засягат безопасността — менюто се сглобява наново веднага:
 * граници от изследвания, ново здравословно състояние, лекарства с конфликт с храни.
 * @param {{ reasons?: string[] }|null} change  recalcLevel()
 * @param {boolean} urgent  isUrgent() — променени граници за безопасност
 */
export function needsSafetyRebuild(change, urgent) {
  if (urgent) return true;
  const reasons = change?.reasons || [];
  return reasons.includes('здравословно състояние') || reasons.some(r => r.startsWith('лекарства'));
}
