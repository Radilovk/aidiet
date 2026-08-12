/**
 * Step 2 deterministic builder — protocol-engine authority for strategy/scheme.
 * Frozen weeklyScheme from profile + analysis; AI only for copy or REVIEW fallback.
 */

import { LIBRARY_PROTOCOL_RULES } from './nutrition-library-bridge.js';
import { resolveLibraryDietProfile } from './protocol-engine.js';
import { getMealDistribution } from './meal-template-engine.js';
import { validateProtocolStrategy } from './protocol-validate.js';
import { isKetoUser, userSkipsBreakfast } from './plan-normalize.js';
import { buildQuestionnaireDietHints } from './questionnaire-engine-map.js';

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const DIET_PROFILE_LABELS = {
  balanced: 'Балансирано',
  mediterranean: 'Средиземноморска',
  keto: 'Кетогенна диета',
  low_carb: 'Нисковъглехидратна',
  vegan: 'Веган',
  vegetarian: 'Вегетарианска',
  pescatarian: 'Пескетарианска',
  high_protein: 'Високопротеинова',
  low_fodmap: 'Low-FODMAP',
  dash: 'DASH',
  paleo: 'Пaleo',
  gluten_free: 'Без глутен',
  dairy_free: 'Без млечни',
  anti_inflammatory: 'Противовъзпалителна',
};

/** Default on — set DETERMINISTIC_STEP2=0 to force AI-first Step 2. */
export function deterministicStep2Enabled(env = {}) {
  const v = env?.DETERMINISTIC_STEP2;
  if (v === '0' || v === 'false' || v === false) return false;
  return true;
}

function parseDailyKcal(analysis) {
  const raw = analysis?.Final_Calories ?? analysis?.recommendedCalories;
  if (typeof raw === 'number' && raw > 0) return Math.round(raw);
  const m = String(raw || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 2000;
}

function parseMacroGrams(analysis) {
  const mg = analysis?.macroGrams || {};
  return {
    protein: Math.round(Number(mg.protein) || 0),
    carbs: Math.round(Number(mg.carbs) || 0),
    fats: Math.round(Number(mg.fats) || 0),
  };
}

function userHasSweetsCraving(foodCravings) {
  const list = Array.isArray(foodCravings) ? foodCravings : foodCravings ? [foodCravings] : [];
  return list.some(c => /слад|шоколад|dessert|sweet/i.test(String(c)));
}

function resolveIncludeDessert(userData) {
  if (!userHasSweetsCraving(userData?.foodCravings)) return false;
  const conditions = userData?.medicalConditions;
  const blocked = Array.isArray(conditions) && conditions.some(c => {
    const s = String(c);
    return s.includes('Диабет') || s.includes('Инсулинова резистентност');
  });
  return !blocked;
}

function resolveMealsPerDay(userData) {
  const text = (userData?.eatingHabits || []).join(' ').toLowerCase();
  if (/5\s*хран|пет\s*хран|5\s*meal/i.test(text)) return 5;
  if (/4\s*хран|четири\s*хран|4\s*meal/i.test(text)) return 4;
  if (/3\s*хран|три\s*хран|3\s*meal|без\s*междин/i.test(text)) return 3;
  if (/2\s*хран|две\s*хран/i.test(text)) return 3;
  return 5;
}

function resolveActiveSlots(mealsPerDay, userData) {
  const skipBreakfast = userSkipsBreakfast(userData);
  if (mealsPerDay <= 3) {
    return skipBreakfast ? ['Хранене 2', 'Хранене 4'] : ['Хранене 1', 'Хранене 2', 'Хранене 4'];
  }
  if (mealsPerDay === 4) {
    return skipBreakfast
      ? ['Хранене 2', 'Хранене 3', 'Хранене 4']
      : ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4'];
  }
  return skipBreakfast
    ? ['Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5']
    : ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5'];
}

function applyDietMacroCaps(macros, dietProfile, dailyKcal, weightKg = 70) {
  const rules = LIBRARY_PROTOCOL_RULES.diet_profiles?.[dietProfile] || {};
  let { protein, carbs, fats } = macros;

  if (rules.max_carbs_g_day && carbs > rules.max_carbs_g_day) {
    carbs = rules.max_carbs_g_day;
    const remaining = Math.max(0, dailyKcal - protein * 4 - carbs * 4);
    fats = Math.round(remaining / 9);
  }

  if (rules.min_protein_g_kg && weightKg > 0) {
    const minP = Math.round(weightKg * rules.min_protein_g_kg);
    if (protein < minP) protein = minP;
  }

  return { protein, carbs, fats };
}

function buildSlotBreakdown(slotTypes, dailyKcal, macros) {
  const distribution = getMealDistribution(Math.min(5, Math.max(3, slotTypes.length)));
  const weights = slotTypes.map((_, i) => distribution[i] ?? (1 / slotTypes.length));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  return slotTypes.map((type, i) => {
    const share = weights[i] / weightSum;
    return {
      type,
      calories: Math.round(dailyKcal * share),
      protein: Math.round(macros.protein * share),
      carbs: Math.round(macros.carbs * share),
      fats: Math.round(macros.fats * share),
    };
  });
}

function buildDayScheme(slotTypes, dailyKcal, macros, isFreeDay) {
  let types = [...slotTypes];
  if (isFreeDay) {
    types = types.map(t => (t === 'Хранене 2' ? 'Свободно хранене' : t));
  }
  const mealBreakdown = buildSlotBreakdown(types, dailyKcal, macros);
  return {
    meals: mealBreakdown.length,
    calories: dailyKcal,
    protein: macros.protein,
    carbs: macros.carbs,
    fats: macros.fats,
    description: isFreeDay ? 'Свободен ден с контролиран бюджет' : 'Стандартен ден по протокол',
    mealBreakdown,
  };
}

function buildCopyFields(dietProfile, mealsPerDay, slotTypes, userData) {
  const label = DIET_PROFILE_LABELS[dietProfile] || DIET_PROFILE_LABELS.balanced;
  const mealList = slotTypes.join(', ');
  const name = userData?.name || 'клиента';

  return {
    dietaryModifier: label,
    dietType: label,
    modifierReasoning: `Профил "${dietProfile}" — избран детерминистично от предпочитания, цели и медицински сигнали.`,
    welcomeMessage: `${name}, планът следва ${label.toLowerCase()} модел с ${mealsPerDay} хранения на ден.`,
    planJustification: `Структурата (${mealList}) и калориите идват от анализа и протоколни правила — стабилна база за седмичното меню.`,
    longTermStrategy: 'Постепенна адаптация чрез седмичен мониторинг на тегло, енергия и придържане.',
    mealCountJustification: `${mealsPerDay} хранения (${mealList}) осигуряват стабилна енергия и по-лесно разпределение на макросите през деня.`,
    afterDinnerMealJustification: slotTypes.includes('Хранене 5')
      ? 'Късната лека закуска поддържа протеина вечер без натоварване на храносмилането.'
      : '',
    weeklyMealPattern: `Единна схема с${slotTypes.includes('Хранене 5') ? ' лека вечерна закуска и' : ''} ротация на продукти през седмицата.`,
    calorieDistribution: 'Разпределение по протоколни тегла — основни хранения носят по-голям калориен дял.',
    macroDistribution: 'Макросите следват Step 1 анализа и diet profile ограниченията.',
    breakfastStrategy: userSkipsBreakfast(userData)
      ? 'Без закуска — калориите са в основните хранения.'
      : 'Закуската стартира деня с балансиран PRO/ENG профил.',
    mealTiming: {
      pattern: `${mealsPerDay} structured meals`,
      fastingWindows: 'Без форсиран фастинг — хранене по схемата на клиента.',
      flexibility: '±30–45 мин около планираните часове.',
      chronotypeGuidance: userData?.chronotype
        ? `Съобразено с хронотип: ${userData.chronotype}.`
        : 'Съобразено със стандартен дневен ритъм.',
    },
    keyPrinciples: [
      'Продукти само от одобрения каталог',
      'Замразена схема — калориите на слот не се местят',
      label,
    ],
    preferredFoodCategories: [],
    avoidFoodCategories: [],
    hydrationStrategy: '2–2.5 L вода дневно, разпределена между храненията.',
  };
}

/**
 * Build full Step 2 strategy object (deterministic core).
 * Caller should run normalizeWeeklyScheme + validateProtocolStrategy after.
 * @param {{ userData?: object|null, analysis?: object|null, options?: { dietaryModifier?: string, mealsPerDay?: number, freeDayNumber?: number } }} [ctx]
 */
export function buildDeterministicStrategy({ userData = null, analysis = null, options = {} } = {}) {
  const weightKg = Number(userData?.weight) || 70;

  const dietProfile = resolveLibraryDietProfile({
    dietaryModifier: options.dietaryModifier,
    dietPreference: userData?.dietPreference,
    dietDislike: userData?.dietDislike || '',
    questionnaireHints: userData?._engineDietHints || buildQuestionnaireDietHints(userData),
  });

  const dailyKcal = parseDailyKcal(analysis);
  let macros = parseMacroGrams(analysis);
  if (!macros.protein && !macros.carbs && !macros.fats) {
    macros = {
      protein: Math.round(weightKg * 1.4),
      carbs: Math.round(dailyKcal * 0.4 / 4),
      fats: Math.round(dailyKcal * 0.28 / 9),
    };
  }
  macros = applyDietMacroCaps(macros, dietProfile, dailyKcal, weightKg);

  const mealsPerDay = options.mealsPerDay || resolveMealsPerDay(userData);
  const slotTypes = resolveActiveSlots(mealsPerDay, userData);
  const freeDayNumber = options.freeDayNumber ?? 7;

  const weeklyScheme = {};
  for (let i = 0; i < 7; i++) {
    const isFreeDay = i + 1 === freeDayNumber;
    weeklyScheme[DAY_KEYS[i]] = buildDayScheme(slotTypes, dailyKcal, macros, isFreeDay);
  }

  const copy = buildCopyFields(dietProfile, mealsPerDay, slotTypes, userData);

  return {
    ...copy,
    weeklyScheme,
    freeDayNumber,
    includeDessert: resolveIncludeDessert(userData),
    libraryDietProfile: dietProfile,
    _deterministicCore: true,
  };
}

/** Build + validate in one call. */
export function buildAndValidateDeterministicStrategy(ctx = {}) {
  const strategy = buildDeterministicStrategy(ctx);
  const validation = validateProtocolStrategy(strategy, ctx.analysis, ctx.userData);
  return { strategy, validation };
}
