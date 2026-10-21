/** Synthetic gameData scenarios for weekly adaptation benchmark */

function zp(n) { return n < 10 ? `0${n}` : `${n}`; }

export function dateKeyOffset(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${zp(d.getMonth() + 1)}-${zp(d.getDate())}`;
}

export function mealKeysFromPlan(plan) {
  const meals = plan?.weekPlan?.day1?.meals || [];
  const seen = {};
  return meals.map((m) => {
    const type = m.type || 'Хранене';
    seen[type] = (seen[type] || 0) + 1;
    return seen[type] === 1 ? type : `${type}_${seen[type]}`;
  });
}

export function plannedCaloriesFromPlan(plan) {
  const meals = plan?.weekPlan?.day1?.meals || [];
  return meals.reduce((s, m) => s + (m.calories || m._plannedCalories || 0), 0);
}

function baseRecord(dayKey, mealKeys, planned) {
  const mealCalories = {};
  mealKeys.forEach((k, i) => {
    mealCalories[k] = Math.round(planned / Math.max(mealKeys.length, 1));
  });
  return {
    date: dayKey,
    meals: {},
    mealCalories,
    plannedCalories: Math.round(planned),
    extraMeals: [],
    freeMealRatings: {},
    morningCheck: null,
    eveningCheck: null,
    dailyScore: null,
  };
}

function finishRecord(rec, opts) {
  // Храненията на деня са ключовете на mealCalories (rec.meals започва празен —
  // преди тук не се отметваше нищо и „силна седмица“ излизаше 0% спазване).
  rec.mealSlots = Object.keys(rec.mealCalories || {});
  rec.mealSlots.forEach((k) => {
    rec.meals[k] = opts.allMealsDone !== false;
  });
  if (opts.morning) {
    rec.morningCheck = { sleptWell: opts.sleptWell !== false, ts: new Date().toISOString() };
  }
  if (opts.evening) {
    rec.eveningCheck = {
      activityLevel: opts.activityLevel ?? 3,
      emotionalBalance: opts.emotionalBalance ?? 3,
      waterIntake: opts.waterIntake !== false,
      ts: new Date().toISOString(),
    };
  }
  if (opts.junkCount > 0) {
    rec.extraMeals = Array.from({ length: opts.junkCount }, (_, i) => ({
      name: `junk-${i + 1}`,
      calories: 180,
      isJunk: true,
      ts: new Date().toISOString(),
    }));
  }
  return rec;
}

/**
 * @param {object} plan
 * @param {string} scenarioId
 */
export function buildGameData(plan, scenarioId) {
  const mealKeys = mealKeysFromPlan(plan);
  const planned = plannedCaloriesFromPlan(plan) || 1800;
  const today = dateKeyOffset(0);

  const scenarios = {
    strong_week: {
      daysBack: [6, 5, 4, 3, 2, 1, 0],
      opts: { allMealsDone: true, morning: true, evening: true, sleptWell: true, junkCount: 0 },
      answerBias: 'positive',
      expect: { maxLevel: 0, minDays: 6, minMealAdherence: 90, calorieAdjust: 0, noSimplify: true },
    },
    struggling_week: {
      daysBack: [6, 5, 4, 3, 2, 1, 0],
      opts: { allMealsDone: false, morning: true, evening: true, sleptWell: false, junkCount: 2, activityLevel: 1 },
      answerBias: 'negative',
      expect: { minLevel: 1, minDays: 6, maxMealAdherence: 75, calorieAdjust: 0, simplify: true },
    },
    partial_new_client: {
      daysBack: [2, 1, 0],
      opts: { allMealsDone: true, morning: true, evening: true, junkCount: 0 },
      answerBias: 'neutral',
      expect: { minDays: 3, maxDays: 3, minMealAdherence: 90, calorieAdjust: 0 },
    },
  };

  const sc = scenarios[scenarioId];
  if (!sc) throw new Error(`Unknown scenario: ${scenarioId}`);

  const gameData = {};
  for (const back of sc.daysBack) {
    const key = dateKeyOffset(back);
    const rec = baseRecord(key, mealKeys, planned);
    if (scenarioId === 'struggling_week' && back % 2 === 0) {
      finishRecord(rec, { ...sc.opts, allMealsDone: true, junkCount: 0 });
    } else {
      finishRecord(rec, sc.opts);
    }
    gameData[key] = rec;
  }
  return { gameData, meta: sc };
}

/** Отговорите на седмичния преглед според посоката на сценария (по id на въпроса). */
const BIASED = {
  positive: { weight: 'Отслабнах до 1 кг', adherence: 'Почти всички', hunger: 'Рядко', energy: 'Добра', difficulty: 'Нищо особено' },
  negative: { weight: 'Без промяна', adherence: 'Около половината', hunger: 'Често', energy: 'Ниска', difficulty: 'Приготвянето отнема време' },
  neutral: { weight: 'Без промяна', adherence: 'Повечето', hunger: 'Понякога', energy: 'Средна', difficulty: 'Нищо особено' },
};

export function autoAnswers(questions, answerBias) {
  const pick = BIASED[answerBias] || BIASED.neutral;
  return (questions || [])
    .filter((q) => pick[q.id] && (q.options || []).includes(pick[q.id]))
    .map((q) => ({ questionId: q.id, value: pick[q.id] }));
}

export const SCENARIO_IDS = ['strong_week', 'struggling_week', 'partial_new_client'];
