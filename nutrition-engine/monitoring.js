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
    id: 'weight',
    text: 'Как се промени теглото ви спрямо миналата седмица?',
    type: 'choice',
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

/**
 * Отговорите и аналитиката → една картина на седмицата.
 * @param {Array<{questionId: string, value: string}>} answers
 * @param {object|null} analytics  buildAnalyticsSummary()
 */
export function readCheckin(answers, analytics) {
  const weightAnswer = answerOf(answers, 'weight');
  const adherenceAnswer = answerOf(answers, 'adherence');
  const fromApp = analytics?.status === 'active' && (analytics.daysRecorded || 0) >= 3
    ? Number(analytics.adherence) || null
    : null;
  const fromAnswer = adherenceAnswer ? ADHERENCE_ANSWERS[adherenceAnswer] ?? null : null;
  // Приложението и клиентът често се разминават — по-ниското е по-вярното.
  const adherence = [fromApp, fromAnswer].filter(v => v != null);
  return {
    weight: weightAnswer ? WEIGHT_ANSWERS[weightAnswer] ?? null : null,
    adherence: adherence.length ? Math.min(...adherence) : null,
    hunger: LEVEL_ANSWERS[answerOf(answers, 'hunger')] || null,
    energy: LEVEL_ANSWERS[answerOf(answers, 'energy')] || null,
    difficulty: answerOf(answers, 'difficulty'),
    junk: analytics?.junk7 || 0,
  };
}

/** Колко поредни предишни седмици са имали същия резултат по теглото. */
function streak(history, weight) {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.weight === weight) n++;
    else break;
  }
  return n;
}

/**
 * Решението за следващата седмица.
 *
 * @param {object} args
 * @param {ReturnType<typeof readCheckin>} args.checkin
 * @param {'LOSS'|'VISC'|'GAIN'|'MAINT'|string} args.goal
 * @param {number} args.kcal          текущият дневен прием
 * @param {number} args.tdee          разходът по формула
 * @param {number} args.floorKcal     безопасният минимум
 * @param {number} args.weightKg
 * @param {number} [args.baseKcal]    първоначалното предписание (за общия таван на промените)
 * @param {Array<{weight?: string|null, calorieAdjust?: number}>} [args.history]
 */
export function decideWeeklyAdjustment({ checkin, goal, kcal, tdee, floorKcal, weightKg, baseKcal = kcal, history = [] }) {
  const reasons = [];
  const changes = [];
  const modifications = [];
  let delta = 0;
  const losing = goal === 'LOSS' || goal === 'VISC' || goal === 'CELL';
  const gaining = goal === 'GAIN';
  const adherence = checkin.adherence;
  const followed = adherence != null && adherence >= 75;

  if (adherence != null && adherence < 60) {
    // Планът не е изпробван — калориите остават, менюто става по-просто.
    modifications.push('simplify_meals');
    reasons.push(`Придържане около ${adherence}% — калориите остават, менюто се опростява, за да се спазва по-лесно.`);
    changes.push('По-прости и повтарящи се ястия');
  } else if (checkin.weight && followed) {
    const expectedLoss = Math.max(0, (tdee - kcal) * 7 / KCAL_PER_KG);
    if (losing) {
      // Над 1 кг седмично е над 1% от теглото за всеки под 100 кг.
      const tooFast = checkin.weight === 'fast_loss' && ((weightKg > 0 && weightKg < 100) || checkin.energy === 3);
      if (tooFast) {
        delta = +MAX_WEEKLY_STEP;
        reasons.push('Отслабването е над 1% от теглото седмично — темпото се забавя, за да се пази мускулната маса.');
      } else if (checkin.weight === 'flat' || checkin.weight === 'gain') {
        const weeks = streak(history, checkin.weight) + 1;
        if (weeks >= 2) {
          delta = checkin.weight === 'gain' ? -MAX_WEEKLY_STEP : -100;
          reasons.push(`${weeks} поредни седмици без спад при спазен план — приемът се намалява леко.`);
        } else {
          reasons.push('Една седмица без промяна е обичайна (вода, гликоген) — приемът остава, следим и следващата.');
        }
      } else {
        reasons.push(`Темпото отговаря на очакваното (около ${expectedLoss.toFixed(1)} кг седмично) — приемът остава.`);
      }
    } else if (gaining) {
      if (checkin.weight === 'flat' || checkin.weight === 'loss' || checkin.weight === 'fast_loss') {
        delta = +MAX_WEEKLY_STEP;
        reasons.push('Теглото не расте при спазен план — приемът се увеличава.');
      } else {
        reasons.push('Теглото расте по план — приемът остава.');
      }
    } else if (checkin.weight === 'gain' && streak(history, 'gain') >= 1) {
      delta = -100;
      reasons.push('Теглото расте втора поредна седмица при цел поддържане — приемът се намалява леко.');
    } else if ((checkin.weight === 'loss' || checkin.weight === 'fast_loss') && streak(history, 'loss') >= 1) {
      delta = +100;
      reasons.push('Теглото пада при цел поддържане — приемът се увеличава леко.');
    }
  } else if (!checkin.weight) {
    reasons.push('Без данни за теглото калориите остават — претеглете се в началото на седмицата.');
  }

  // Глад и умора при дефицит: първо обем, после калории.
  if (losing && delta <= 0 && checkin.hunger === 3 && checkin.energy === 3) {
    delta = Math.max(delta, +100);
    reasons.push('Чест глад и ниска енергия — дефицитът се смекчава.');
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
    weight: checkin.weight,
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
      message: 'Спазихте плана — браво. Теглото стои, затова приемът намалява леко. Продължавайте със същото темпо.',
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
