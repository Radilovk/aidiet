/**
 * Step 2 deterministic builder — protocol-engine authority for strategy/scheme.
 * Frozen weeklyScheme from profile + analysis; AI only for copy or REVIEW fallback.
 */

import { LIBRARY_PROTOCOL_RULES } from './nutrition-library-bridge.js';
import { resolveLibraryDietProfile } from './protocol-engine.js';
import { getMealDistribution } from './meal-template-engine.js';
import { validateProtocolStrategy } from './protocol-validate.js';
import {
  isKetoUser,
  userSkipsBreakfast,
  slotCeilingKcal,
  dayCapacityKcal,
  FIRST_MEAL_SLOT,
} from './plan-normalize.js';
import { buildQuestionnaireDietHints, extractQuestionnaireBlockedTerms } from './questionnaire-engine-map.js';

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

/** Слотовете, които навиците на клиента искат — преди проверката за капацитет. */
function preferredSlots(mealsPerDay, userData) {
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

/**
 * Първо хранене, върнато само защото денят не се събира без него.
 *
 * Клиент на 2881 kcal, който не закусва, има обяд, следобедна закуска, вечеря
 * и лека вечерна закуска — таваните им събират 2432 kcal. Другите 449 отиваха
 * в обяда и вечерята и правеха от тях цел от 1165 kcal, която никое истинско
 * ястие не може да изпълни: оттам идваха „калории 985 ≠ цел 1166“ и денят с
 * 600 kcal по-малко. По-честно е клиентът да получи леко първо хранене,
 * отколкото два обяда, които не съществуват.
 *
 * @returns {string|null} слотът за връщане, или null когато денят се събира
 */
function restoredFirstMeal(slotTypes, dailyKcal) {
  if (!(dailyKcal > 0) || slotTypes.includes(FIRST_MEAL_SLOT)) return null;
  return dayCapacityKcal(slotTypes, dailyKcal) >= dailyKcal ? null : FIRST_MEAL_SLOT;
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

/**
 * Energy share per meal type. Keyed by type, not by position: indexing a flat
 * distribution array meant a skip-breakfast client gave lunch the breakfast
 * weight, and the afternoon snack ended up larger than dinner.
 * Shares are renormalised over whichever slots the day actually has.
 */
const SLOT_ENERGY_SHARE = {
  'Хранене 1': 0.25,
  'Хранене 2': 0.32,
  'Свободно хранене': 0.32,
  'Хранене 3': 0.10,
  'Хранене 4': 0.26,
  'Хранене 5': 0.07,
};

/**
 * Macro emphasis per meal type, relative to that slot's energy share.
 * Mornings carry the carbohydrates, evenings the protein and fat, the late
 * snack is protein and fat only — the slot contract Step 3 already enforces.
 * Weights are renormalised so the day still sums to the prescribed grams.
 */
const SLOT_MACRO_BIAS = {
  'Хранене 1': { protein: 0.90, carbs: 1.25, fats: 0.85 },
  'Хранене 2': { protein: 1.05, carbs: 1.10, fats: 0.95 },
  'Свободно хранене': { protein: 1.0, carbs: 1.0, fats: 1.0 },
  'Хранене 3': { protein: 1.00, carbs: 1.05, fats: 0.95 },
  'Хранене 4': { protein: 1.25, carbs: 0.60, fats: 1.15 },
  'Хранене 5': { protein: 1.50, carbs: 0.10, fats: 1.30 },
};

const DEFAULT_MACRO_BIAS = { protein: 1, carbs: 1, fats: 1 };
const MACRO_KEYS = ['protein', 'carbs', 'fats'];
const KCAL_PER_GRAM = { protein: 4, carbs: 4, fats: 9 };

/** Distribute a daily gram total across slots by biased weight (unrounded). */
function splitMacroAcrossSlots(slotTypes, shares, totalGrams, macroKey) {
  const weights = slotTypes.map((type, i) =>
    shares[i] * ((SLOT_MACRO_BIAS[type] || DEFAULT_MACRO_BIAS)[macroKey] ?? 1));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0 || totalGrams <= 0) return slotTypes.map(() => 0);
  return weights.map(w => (w / weightSum) * totalGrams);
}

/** Round a float split to whole grams, keeping the day total exact. */
function roundMacroSplit(raw, totalGrams) {
  const grams = raw.map(g => Math.round(g));
  const drift = Math.round(totalGrams) - grams.reduce((a, b) => a + b, 0);
  if (drift !== 0) {
    let biggest = 0;
    for (let i = 1; i < grams.length; i++) if (raw[i] > raw[biggest]) biggest = i;
    grams[biggest] = Math.max(0, grams[biggest] + drift);
  }
  return grams;
}

/**
 * Макроси по слот, които едновременно събират дневните грамове и дават точно
 * калориите на слота.
 *
 * Двете условия си противоречат при първото разпределение: пристрастието по
 * хранене мести грамове между слотовете и калориите на слота тръгват над
 * тавана му — така обядът получаваше цел, каквато никое ястие не носи.
 * Редуваните нормализации (по слот, после по макрос) ги помиряват.
 */
function fitMacrosToSlotKcal(slotTypes, slotKcal, macros) {
  const macroKcal = MACRO_KEYS.reduce((sum, k) => sum + macros[k] * KCAL_PER_GRAM[k], 0);
  const kcalSum = slotKcal.reduce((a, b) => a + b, 0);
  if (macroKcal <= 0 || kcalSum <= 0) {
    return Object.fromEntries(MACRO_KEYS.map(k => [k, slotTypes.map(() => 0)]));
  }
  // Целите на слотовете и дневните грамове трябва да описват един и същ ден.
  const targets = slotKcal.map(k => (k / kcalSum) * macroKcal);
  const shares = slotKcal.map(k => k / kcalSum);

  const grid = {};
  for (const key of MACRO_KEYS) {
    grid[key] = splitMacroAcrossSlots(slotTypes, shares, macros[key], key);
  }

  for (let pass = 0; pass < 12; pass++) {
    let worst = 0;
    for (let i = 0; i < slotTypes.length; i++) {
      const kcal = MACRO_KEYS.reduce((sum, k) => sum + grid[k][i] * KCAL_PER_GRAM[k], 0);
      if (kcal <= 0) continue;
      const ratio = targets[i] / kcal;
      worst = Math.max(worst, Math.abs(kcal - targets[i]));
      for (const k of MACRO_KEYS) grid[k][i] *= ratio;
    }
    // Под един килокалория разлика няма какво повече да се помирява.
    if (pass > 0 && worst < 1) break;
    for (const key of MACRO_KEYS) {
      const sum = grid[key].reduce((a, b) => a + b, 0);
      if (sum <= 0) continue;
      const ratio = macros[key] / sum;
      for (let i = 0; i < grid[key].length; i++) grid[key][i] *= ratio;
    }
  }
  return Object.fromEntries(MACRO_KEYS.map(k => [k, roundMacroSplit(grid[k], macros[k])]));
}

/**
 * Калории по слот, които слотът наистина може да изпълни.
 *
 * Дяловете дават целта, таванът я реже, а излишъкът отива там, където има
 * запас. Върнатото първо хранене приема последно и започва само с това, което
 * останалите слотове не могат да поемат — така остава леко.
 */
function feasibleSlotKcal(slotTypes, dailyKcal, restoredSlot) {
  const daily = Math.max(0, Number(dailyKcal) || 0);
  const ceilings = slotTypes.map(type => slotCeilingKcal(type, daily));
  const fallback = getMealDistribution(Math.min(5, Math.max(3, slotTypes.length)));
  const raw = slotTypes.map((type, i) =>
    SLOT_ENERGY_SHARE[type] ?? fallback[i] ?? (1 / slotTypes.length));
  const rawSum = raw.reduce((a, b) => a + b, 0) || 1;
  const kcal = raw.map(w => (w / rawSum) * daily);
  if (!daily) return kcal;

  const restoredIdx = restoredSlot ? slotTypes.indexOf(restoredSlot) : -1;
  if (restoredIdx >= 0) {
    const othersCeiling = ceilings.reduce((sum, c, i) => (i === restoredIdx ? sum : sum + c), 0);
    kcal[restoredIdx] = Math.max(0, daily - othersCeiling);
    const rest = daily - kcal[restoredIdx];
    const restRaw = raw.reduce((sum, w, i) => (i === restoredIdx ? sum : sum + w), 0) || 1;
    for (let i = 0; i < kcal.length; i++) {
      if (i !== restoredIdx) kcal[i] = (raw[i] / restRaw) * rest;
    }
  }

  let surplus = 0;
  for (let i = 0; i < kcal.length; i++) {
    if (kcal[i] > ceilings[i]) {
      surplus += kcal[i] - ceilings[i];
      kcal[i] = ceilings[i];
    }
  }
  // Първо слотовете, които клиентът и без това има; върнатото първо хранене — накрая.
  const order = slotTypes
    .map((_, i) => i)
    .sort((a, b) => (a === restoredIdx ? 1 : 0) - (b === restoredIdx ? 1 : 0));
  for (const i of order) {
    if (surplus <= 0) break;
    const room = Math.min(surplus, ceilings[i] - kcal[i]);
    if (room > 0) {
      kcal[i] += room;
      surplus -= room;
    }
  }
  return kcal;
}

function buildSlotBreakdown(slotTypes, dailyKcal, macros, restoredSlot = null) {
  const slotKcal = feasibleSlotKcal(slotTypes, dailyKcal, restoredSlot);
  const { protein, carbs, fats } = fitMacrosToSlotKcal(slotTypes, slotKcal, macros);

  return slotTypes.map((type, i) => ({
    type,
    // kcal derives from this slot's own macros, so the two can never disagree.
    calories: Math.round(protein[i] * 4 + carbs[i] * 4 + fats[i] * 9),
    protein: protein[i],
    carbs: carbs[i],
    fats: fats[i],
  }));
}

function buildDayScheme(slotTypes, dailyKcal, macros, isFreeDay, restoredSlot = null) {
  let types = [...slotTypes];
  if (isFreeDay) {
    types = types.map(t => (t === 'Хранене 2' ? 'Свободно хранене' : t));
  }
  const mealBreakdown = buildSlotBreakdown(types, dailyKcal, macros, restoredSlot);
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

function buildCopyFields(dietProfile, mealsPerDay, slotTypes, userData, restoredSlot = null) {
  const label = DIET_PROFILE_LABELS[dietProfile] || DIET_PROFILE_LABELS.balanced;
  // Клиентът е казал, че не закусва — ако денят не се събира без първо хранене,
  // това трябва да е обяснено, а не просто да се появи в плана.
  const restoredNote = restoredSlot
    ? 'Леко първо хранене — при този калораж обядът и вечерята иначе излизат над 1000 kcal, което не е реална чиния.'
    : '';
  const mealList = slotTypes.join(', ');
  const name = userData?.name || 'клиента';
  const loves = String(userData?.dietLove || '')
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean);
  const blocked = extractQuestionnaireBlockedTerms(userData).slice(0, 12);

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
    breakfastStrategy: restoredNote
      || (userSkipsBreakfast(userData)
        ? 'Без закуска — калориите са в основните хранения.'
        : 'Закуската стартира деня с балансиран PRO/ENG профил.'),
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
    preferredFoodCategories: loves,
    avoidFoodCategories: blocked,
    foodsToInclude: loves,
    foodsToAvoid: blocked,
    psychologicalSupport: [
      restoredNote || (userSkipsBreakfast(userData)
        ? 'Без закуска — калориите са в основните хранения.'
        : null),
      Array.isArray(userData?.foodCravings) && userData.foodCravings.length
        ? `Осъзнатост за craving: ${userData.foodCravings.join(', ')}`
        : null,
    ].filter(Boolean),
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
  const preferred = preferredSlots(mealsPerDay, userData);
  const restoredSlot = restoredFirstMeal(preferred, dailyKcal);
  const slotTypes = restoredSlot ? [restoredSlot, ...preferred] : preferred;
  const freeDayNumber = options.freeDayNumber ?? 7;

  const weeklyScheme = {};
  for (let i = 0; i < 7; i++) {
    const isFreeDay = i + 1 === freeDayNumber;
    weeklyScheme[DAY_KEYS[i]] = buildDayScheme(slotTypes, dailyKcal, macros, isFreeDay, restoredSlot);
  }

  const copy = buildCopyFields(dietProfile, slotTypes.length, slotTypes, userData, restoredSlot);

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
