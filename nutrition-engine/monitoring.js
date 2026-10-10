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
    text: 'Колко е теглото ви днес? Претеглете се сутрин, на гладно, след тоалетна (кг).',
    type: 'number',
    min: 30,
    max: 300,
    placeholder: 'напр. 72.4',
    skipLabel: 'Не съм се теглил/а',
    options: [],
  },
  {
    id: 'weight',
    text: 'Как се промени теглото ви спрямо миналата седмица?',
    type: 'choice',
    skipIfAnswered: 'weightKg',
    options: ['Отслабнах повече от 1 кг', 'Отслабнах до 1 кг', 'Без промяна', 'Качих', 'Не съм се теглил/а'],
  },
  {
    id: 'adherence',
    text: 'Колко от храненията в плана успяхте да спазите?',
    type: 'choice',
    options: ['Почти всички', 'Повечето', 'Около половината', 'Малко'],
  },
  {
    id: 'hunger',
    text: 'Колко често бяхте гладни между храненията?',
    type: 'scale_1_3',
    options: ['Рядко', 'Понякога', 'Често'],
  },
  {
    id: 'energy',
    text: 'Как беше енергията ви през деня?',
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
    text: 'Искате ли да добавите нещо за следващата седмица? (по желание)',
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
  'Не съм се теглил/а': null,
};
const ADHERENCE_ANSWERS = { 'Почти всички': 95, 'Повечето': 80, 'Около половината': 50, 'Малко': 25 };
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

/**
 * Отговорите и аналитиката → една картина на седмицата.
 * @param {Array<{questionId: string, value: string}>} answers
 * @param {object|null} analytics  buildAnalyticsSummary()
 * @param {{ prevWeightKg?: number|null, daysSincePrev?: number|null }} [previous]
 *   последното измерено тегло (от предишния преглед или въпросника) и преди колко дни
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
    // Промяната се води към седмица; без дата — приема се една седмица.
    const span = days >= 4 && days <= 28 ? days : 7;
    weeklyChangeKg = Math.round((weightKg - prev) / span * 7 * 100) / 100;
  }
  return {
    weight: weightAnswer ? WEIGHT_ANSWERS[weightAnswer] ?? null : null,
    weightKg,
    weeklyChangeKg,
    adherence,
    hunger: LEVEL_ANSWERS[answerOf(answers, 'hunger')] || null,
    energy: LEVEL_ANSWERS[answerOf(answers, 'energy')] || null,
    difficulty: answerOf(answers, 'difficulty'),
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
};

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

/**
 * Решението за следващата седмица.
 *
 * @param {object} args
 * @param {ReturnType<typeof readCheckin>} args.checkin
 * @param {'LOSS'|'VISC'|'GAIN'|'MAINT'|string} args.goal
 * @param {number} args.kcal          текущият дневен прием
 * @param {number} args.tdee          разходът по формула (с текущото тегло)
 * @param {number} args.floorKcal     безопасният минимум
 * @param {number} args.weightKg
 * @param {number} [args.baseKcal]    първоначалното предписание (за общия таван на промените)
 * @param {boolean} [args.lactating]
 * @param {Array<{weight?: string|null, followed?: boolean, calorieAdjust?: number}>} [args.history]
 */
export function decideWeeklyAdjustment({ checkin, goal, kcal, tdee, floorKcal, weightKg, baseKcal = kcal, lactating = false, history = [] }) {
  const reasons = [];
  const changes = [];
  const modifications = [];
  let delta = 0;
  const losing = LOSING_GOALS.has(goal);
  const gaining = goal === 'GAIN';
  const goalKind = losing ? 'loss' : gaining ? 'gain' : 'keep';
  const adherence = checkin.adherence;
  const followed = adherence != null && adherence >= 75;
  const expectedLoss = Math.max(0, (tdee - kcal) * 7 / KCAL_PER_KG);
  const outcome = weightOutcome(checkin, { goalKind, expectedLossKg: expectedLoss, weightKg, lactating });
  const cls = outcome ? OUTCOME_CLASS[goalKind][outcome] : null;
  const measured = checkin.weeklyChangeKg != null
    ? `${checkin.weeklyChangeKg > 0 ? '+' : ''}${checkin.weeklyChangeKg.toFixed(1)} кг за седмица`
    : null;

  if (adherence != null && adherence < 60) {
    // Планът не е изпробван — калориите остават, менюто става по-просто.
    modifications.push('simplify_meals');
    reasons.push(`Придържане около ${adherence}% — калориите остават, менюто се опростява, за да се спазва по-лесно.`);
    changes.push('По-прости и повтарящи се ястия');
  } else if (outcome && !followed) {
    reasons.push(`Придържане около ${adherence ?? '?'}% — резултатът по теглото още не показва дали калориите са верни; приемът остава.`);
  } else if (outcome && followed) {
    const weeks = streak(history, goalKind, cls) + 1;
    if (losing) {
      if (outcome === 'fast_loss') {
        delta = +MAX_WEEKLY_STEP;
        reasons.push(lactating
          ? 'Отслабването е над 0.5 кг седмично при кърмене — приемът се увеличава, за да се пази кърмата.'
          : `Отслабването е над 1% от теглото седмично${measured ? ` (${measured})` : ''} — темпото се забавя, за да се пази мускулната маса.`);
      } else if (cls === 'stall') {
        if (weeks >= 2) {
          delta = outcome === 'gain' ? -MAX_WEEKLY_STEP : -100;
          reasons.push(`${weeks} поредни седмици ${outcome === 'slow' ? 'с много бавен спад' : 'без спад'} при спазен план${measured ? ` (${measured})` : ''} — приемът се намалява леко.`);
        } else {
          reasons.push(`${measured ? `${measured}. ` : ''}Една седмица без спад е обичайна (вода, гликоген, цикъл) — приемът остава, следим и следващата.`);
        }
      } else {
        reasons.push(`Темпото отговаря на очакваното (около ${expectedLoss.toFixed(1)} кг седмично${measured ? `; измерено ${measured}` : ''}) — приемът остава.`);
      }
    } else if (gaining) {
      if (cls === 'fast') {
        delta = -100;
        reasons.push(`Теглото расте над 0.5% седмично${measured ? ` (${measured})` : ''} — излишъкът отива в мазнини; приемът се намалява леко.`);
      } else if (cls === 'down') {
        delta = +MAX_WEEKLY_STEP;
        reasons.push('Теглото пада при цел мускулна маса — приемът се увеличава.');
      } else if (cls === 'stall') {
        if (weeks >= 2) {
          delta = +MAX_WEEKLY_STEP;
          reasons.push(`${weeks} поредни седмици без покачване при спазен план — приемът се увеличава.`);
        } else {
          reasons.push('Една седмица без покачване — приемът остава, следим и следващата.');
        }
      } else {
        reasons.push('Теглото расте по план — приемът остава.');
      }
    } else if (cls === 'up' && weeks >= 2) {
      delta = -100;
      reasons.push('Теглото расте втора поредна седмица при цел поддържане — приемът се намалява леко.');
    } else if (cls === 'down' && weeks >= 2) {
      delta = +100;
      reasons.push('Теглото пада втора поредна седмица при цел поддържане — приемът се увеличава леко.');
    } else {
      reasons.push(`Теглото се задържа в нормалните граници${measured ? ` (${measured})` : ''} — приемът остава.`);
    }
  } else if (!outcome) {
    reasons.push('Без данни за теглото калориите остават — претеглете се сутрин на гладно преди следващия преглед.');
  }

  // Чест глад и ниска енергия при дефицит и спазен план: не се реже повече,
  // а ако няма корекция — дефицитът се смекчава.
  if (losing && adherence != null && adherence >= 60 && checkin.hunger === 3 && checkin.energy === 3) {
    if (delta < 0) {
      delta = 0;
      reasons.push('Чест глад и ниска енергия — калориите не се намаляват тази седмица.');
    } else if (delta === 0) {
      delta = +100;
      reasons.push('Чест глад и ниска енергия — дефицитът се смекчава.');
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
    changes.push('Храни с ниско FODMAP за следващата седмица');
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
    weight: outcome,
    weightKg: checkin.weightKg,
    weeklyChangeKg: checkin.weeklyChangeKg,
    followed,
    adherence,
  };
}

/** Кратко съобщение към клиента — без AI, по резултата на седмицата. */
export function weeklyMessage(decision, checkin) {
  if (checkin.adherence != null && checkin.adherence < 60) {
    return {
      headline: 'Нова седмица — по-лесен план',
      message: 'Тази седмица е трудно да се спазва — нормално е. Следващата е по-проста: по-малко различни ястия и по-бързо приготвяне. Целта е постоянство, не съвършенство.',
    };
  }
  if (decision.calorieAdjust < 0) {
    return {
      headline: 'Малка корекция за следващата седмица',
      message: 'Спазихте плана — браво. Резултатът се разминава с очаквания, затова приемът се коригира леко. Продължавайте със същото темпо.',
    };
  }
  if (decision.calorieAdjust > 0) {
    return {
      headline: 'Новата седмица е по-щедра',
      message: 'Приемът се увеличава леко — за енергия и за запазване на мускулната маса. Продължавайте със спазването на плана.',
    };
  }
  return {
    headline: 'Отлична седмица — продължаваме',
    message: 'Вървите по план. Новото меню е със същите калории и нови ястия за разнообразие.',
  };
}
