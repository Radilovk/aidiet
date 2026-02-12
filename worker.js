/**
 * Cloudflare Worker for AI Diet Application
 * Backend endpoint: https://aidiet.radilov-k.workers.dev/
 * 
 * AI LOAD DISTRIBUTION STRATEGY:
 * 
 * Problem: Sending all data in a single large request can overload AI model and reduce quality
 * Solution: Multi-step architecture that distributes work across focused requests
 * 
 * KEY PRINCIPLE: NO compromise on data completeness, precision, or individualization
 * 
 * TOKEN OPTIMIZATION (Feb 2026):
 * - Strategy objects are sent in COMPACT format (76% reduction: 695→167 tokens)
 * - Analysis objects are sent in COMPACT format (37.6% reduction: 524→327 tokens)
 * - Total input token reduction: 59.1% (4799→1962 tokens per plan generation)
 * - Strategy is used 5 times, analysis 1 time, so compact format has multiplied effect
 * 
 * ARCHITECTURE - Plan Generation (Reorganized for efficiency):
 * Структура: 4 основни стъпки, стъпка 3 с 4 подстъпки = 7 заявки
 * 
 *   1. Analysis Request (4k token limit)
 *      - Input: Full user data (profile, habits, medical, preferences)
 *      - Output: Holistic health analysis with correlations
 *   
 *   2. Strategy Request (4k token limit)
 *      - Input: User data + COMPACT analysis results
 *      - Output: Personalized dietary strategy and approach
 *   
 *   3. Meal Plan Requests (4 sub-requests, 8k token limit each - SIMPLIFIED)
 *      - Progressive generation: 2 days per chunk
 *      - Input: MINIMAL context - only essential rules, no duplication
 *      - Output: Detailed meals with macros and descriptions
 *      - REORGANIZATION: Removed 150+ lines of repeated ADLE rules
 *      - Sub-steps: Day 1-2, Day 3-4, Day 5-6, Day 7
 *      - OPTIMIZATION: Food whitelist/blacklist cached once and reused
 *   
 *   4. Summary Request (2k token limit - LIGHTWEIGHT)
 *      - Input: Essential data only - health context, food lists
 *      - Output: Summary, recommendations, supplements
 *      - SIMPLIFICATION: Removed verbose guidelines, kept AI flexibility
 * 
 * Total: 1 (analysis) + 1 (strategy) + 4 (meal plan sub-steps) + 1 (summary) = 7 steps
 * 
 * OPTIMIZATION STRATEGY (Reorganization, NOT just adding tokens):
 *   - Step 3: Removed ~200 lines of duplicate ADLE rules (70% prompt reduction)
 *   - Step 4: Removed ~50 lines of supplement guidelines (60% prompt reduction)
 *   - Kept token limits at 8k/2k - improvements through SIMPLIFICATION
 *   - Result: Same quality, dramatically less prompt bloat
 * 
 * ARCHITECTURE - Chat (1 request per message):
 *   - Input: Full user data + Full plan + Conversation history (2k tokens max)
 *   - Output: Response (2k token limit)
 *   - Uses full context for precise consultation
 * 
 * BENEFITS:
 *   ✓ Each request focused and lean - no unnecessary duplication
 *   ✓ Prompts simplified by 60-70% while maintaining quality
 *   ✓ Better error handling (chunk failures don't fail entire generation)
 *   ✓ Progressive refinement (later days build on earlier days)
 *   ✓ Full analysis quality maintained
 *   ✓ Cached food lists prevent redundant KV reads (4x → 1x per generation)
 *   ✓ AI has flexibility without over-prescription
 */

// No default values - all calculations must be individualized based on user data

// Data Validation Configuration
const MIN_AGE = 10; // Minimum age for diet planning (minors require guardian consent)
const MAX_AGE = 100;
const MIN_WEIGHT_KG = 20;
const MAX_WEIGHT_KG = 300;
const MIN_HEIGHT_CM = 100;
const MAX_HEIGHT_CM = 250;
const MIN_BMI = 10; // Medically possible minimum
const MAX_BMI = 80; // Medically possible maximum
const MAX_WEIGHT_LOSS_KG = 50; // Maximum weight loss per plan
const MAX_WEIGHT_LOSS_PERCENT = 0.5; // Maximum 50% of body weight

// Analysis Configuration
const WATER_PER_KG_MULTIPLIER = 0.035; // Liters per kg body weight
const BASE_WATER_NEED_LITERS = 0.5; // Base water need in liters
const ACTIVITY_WATER_BONUS_LITERS = 0.45; // Additional water for active individuals
const TEMPERAMENT_CONFIDENCE_THRESHOLD = 80; // Minimum confidence % to report temperament
const HEALTH_STATUS_UNDERESTIMATE_PERCENT = 10; // Underestimate health status by this %
const FIBER_MIN_GRAMS = 25; // Minimum fiber recommendation
const FIBER_MAX_GRAMS = 40; // Maximum fiber recommendation

// Offensive Content Patterns (for data validation)
const OFFENSIVE_PATTERNS = [
  // Vulgar words (Cyrillic - no word boundaries, no 'g' flag)
  /(педал|курв|мръсн|идиот|глупа[кц]|дебил|тъп[аи])/i,
  // Spam patterns
  /(viagra|casino|xxx|porn)/i,
  // Test/spam data
  /^(test|тест|asdf|qwerty|12345|aaa|zzz)$/i
];

// AI Communication Logging Configuration
const MAX_LOG_ENTRIES = 1; // Maximum number of log entries to keep in index (only keep the latest)

// Error messages (Bulgarian)
const ERROR_MESSAGES = {
  PARSE_FAILURE: 'Имаше проблем с обработката на отговора. Моля опитайте отново.',
  MISSING_FIELDS: 'Липсват задължителни полета',
  KV_NOT_CONFIGURED: 'KV хранилището не е конфигурирано',
  INVALID_PROVIDER: 'Невалиден AI доставчик',
  MISSING_CONTEXT: 'Липсват потребителски данни или план',
  MISSING_MESSAGE: 'Липсва съобщение',
  MISSING_TYPE_PROMPT: 'Липсва тип или промпт',
  MISSING_PROVIDER_MODEL: 'Липсва доставчик или модел',
  MISSING_SUBSCRIPTION: 'Липсва потребителски ID или subscription',
  NOT_FOUND: 'Не е намерено',
  PLAN_GENERATION_FAILED: 'Неуспешно генериране на план',
  CHAT_FAILED: 'Грешка в чата',
  PROMPT_SAVE_FAILED: 'Неуспешно запазване на промпт',
  PROMPT_GET_FAILED: 'Неуспешно получаване на промпт',
  MODEL_SAVE_FAILED: 'Неуспешно запазване на модел',
  CONFIG_GET_FAILED: 'Неуспешно получаване на конфигурация',
  PUSH_SUBSCRIBE_FAILED: 'Неуспешно абониране за известия',
  PUSH_SEND_FAILED: 'Неуспешно изпращане на известие',
  VAPID_KEY_FAILED: 'Неуспешно получаване на VAPID ключ'
};

// Day name translations for weekly scheme display
const DAY_NAMES_BG = {
  monday: 'Понеделник',
  tuesday: 'Вторник',
  wednesday: 'Сряда',
  thursday: 'Четвъртък',
  friday: 'Петък',
  saturday: 'Събота',
  sunday: 'Неделя'
};

// Bulgarian error message shown when REGENERATE_PLAN parsing fails and no clean response text remains
const ERROR_MESSAGE_PARSE_FAILURE = ERROR_MESSAGES.PARSE_FAILURE;

// Plan modification descriptions for AI prompts
const PLAN_MODIFICATIONS = {
  NO_INTERMEDIATE_MEALS: 'no_intermediate_meals',
  THREE_MEALS_PER_DAY: '3_meals_per_day',
  FOUR_MEALS_PER_DAY: '4_meals_per_day',
  VEGETARIAN: 'vegetarian',
  NO_DAIRY: 'no_dairy',
  LOW_CARB: 'low_carb',
  INCREASE_PROTEIN: 'increase_protein'
};

const PLAN_MODIFICATION_DESCRIPTIONS = {
  [PLAN_MODIFICATIONS.NO_INTERMEDIATE_MEALS]: '- БЕЗ междинни хранения/закуски - само основни хранения (закуска, обяд, вечеря)',
  [PLAN_MODIFICATIONS.THREE_MEALS_PER_DAY]: '- Точно 3 хранения на ден (закуска, обяд, вечеря)',
  [PLAN_MODIFICATIONS.FOUR_MEALS_PER_DAY]: '- 4 хранения на ден (закуска, обяд, следобедна закуска, вечеря)',
  [PLAN_MODIFICATIONS.VEGETARIAN]: '- ВЕГЕТАРИАНСКО хранене - без месо и риба',
  [PLAN_MODIFICATIONS.NO_DAIRY]: '- БЕЗ млечни продукти',
  [PLAN_MODIFICATIONS.LOW_CARB]: '- Нисковъглехидратна диета',
  [PLAN_MODIFICATIONS.INCREASE_PROTEIN]: '- Повишен прием на протеини'
};

// Meal name and description formatting instructions for AI prompts
const MEAL_NAME_FORMAT_INSTRUCTIONS = `
=== ФОРМАТ НА MEAL NAME И DESCRIPTION ===
КРИТИЧНО ВАЖНО: Спазвай СТРОГО следния формат за структуриране на name и description:

ФОРМАТ НА "name" (структуриран със СИМВОЛИ):
- Използвай символи (•, -, *) за структура, НЕ пиши изречения
- Разделяй компонентите на отделни редове със символи
- Формат: компонент след компонент (без смесване)
- НЕ използвай етикети като "Салата:", "Основно:" - пиши директно названията на ястията

Структура (по ред, само ако е налично):
• [Вид салата в естествена форма] (ако има - напр. "Шопска салата", "салата Цезар", "салата от пресни зеленчуци")
• [Основно ястие] (ако има гарнитура: "с гарнитура / гарнитура от [име на гарнитура]")
• [Хляб: количество и вид] (ако има, напр. "1 филия пълнозърнест")

Примери за ПРАВИЛЕН формат на name:
✓ "• Шопска салата\\n• Пилешки гърди на скара с картофено пюре"
✓ "• Бяла риба печена с киноа"
✓ "• Зелена салата\\n• Леща яхния\\n• Хляб: 1 филия пълнозърнест"
✓ "• Салата от пресни зеленчуци\\n• Пилешко филе с киноа"
✓ "• Овесена каша с боровинки" (за закуска без салата/хляб)

ЗАБРАНЕНИ формати за name (НЕ пиши така):
✗ "• Салата: Шопска" (твърдо кодирани етикети)
✗ "• Основно: Пилешки гърди" (твърдо кодирани етикети)
✗ "Пилешки гърди на скара с картофено пюре и салата Шопска" (смесено описание)
✗ "Печена бяла риба, приготвена с киноа и подправки" (изречение)

ФОРМАТ НА "description":
- Структурирай description с булет пойнти (•) за разделяне на компонентите
- Всеки компонент на хранене (салата, основно ястие, гарнитура, хляб) започва на нов ред с •
- В description пиши ВСИЧКИ уточнения за:
  * Начин на приготвяне (печено, задушено, на скара, пресно и т.н.)
  * Препоръки за приготвяне
  * Конкретни подправки (сол, черен пипер, риган, магданоз и т.н.)
  * Допълнителни продукти (зехтин, лимон, чесън и т.н.)
  * Количества и пропорции

Пример за ПРАВИЛНА комбинация name + description:
name: "• Зелена салата\\n• Пилешки гърди с киноа\\n• Хляб: 1 филия пълнозърнест"
description: "• Зелена салата от листа, краставици и чери домати с лимонов дресинг.\\n• Пилешките гърди се приготвят на скара или печени в тава с малко зехтин, подправени със сол, черен пипер и риган.\\n• Киноата се готви според инструкциите.\\n• 1 филия пълнозърнест хляб."
`;


/**
 * Calculate BMR using Mifflin-St Jeor Equation
 * Men: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) + 5
 * Women: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) - 161
 * 
 * NOTE (2026-02-03): This function is DEPRECATED for primary calorie calculation.
 * AI model now calculates BMR/TDEE/calories holistically considering ALL correlates.
 * This function is kept ONLY for:
 * - Safety validation (ensure AI values are reasonable)
 * - Fallback if AI calculation fails
 * - Testing and comparison purposes
 * 
 * IMPORTANT: Never returns default values - all calculations are individualized
 * If required data is missing, throws an error to ensure proper data collection
 */
function calculateBMR(data) {
  if (!data.weight || !data.height || !data.age || !data.gender) {
    throw new Error('Cannot calculate BMR: Missing required data (weight, height, age, or gender). All calculations must be individualized.');
  }
  
  const weight = parseFloat(data.weight);
  const height = parseFloat(data.height);
  const age = parseFloat(data.age);
  
  if (isNaN(weight) || isNaN(height) || isNaN(age) || weight <= 0 || height <= 0 || age <= 0) {
    throw new Error('Cannot calculate BMR: Invalid numerical values for weight, height, or age.');
  }
  
  let bmr = 10 * weight + 6.25 * height - 5 * age;
  
  if (data.gender === 'Мъж') {
    bmr += 5;
  } else if (data.gender === 'Жена') {
    bmr -= 161;
  } else {
    throw new Error('Cannot calculate BMR: Gender must be specified as "Мъж" or "Жена".');
  }
  
  return Math.round(bmr);
}

/**
 * Calculate unified activity score (1-10 scale) - Issue #7 Resolution
 * Combines daily activity level (1-3) with sport/exercise frequency (0-7 days/week)
 * 
 * Scale interpretation:
 * - dailyActivityLevel: "Ниско"=1, "Средно"=2, "Високо"=3
 * - sportActivity: Extract days per week from string (0-7)
 * - Combined score = dailyActivityLevel + min(sportDays, 7)
 * 
 * Examples:
 * - Високо (3) + Ниска 1-2 дни (1.5avg) → ~4.5 → 5
 * - Ниско (1) + Средна 2-4 дни (3avg) → ~4
 * - Средно (2) + Висока 5-7 дни (6avg) → ~8
 */
function calculateUnifiedActivityScore(data) {
  // Map daily activity level to 1-3 scale
  const dailyActivityMap = {
    'Ниско': 1,
    'Средно': 2,
    'Високо': 3
  };
  
  const dailyScore = dailyActivityMap[data.dailyActivityLevel] || 2;
  
  // Extract sport days from sportActivity string
  // Using midpoint values for ranges: 1-2 days → 1.5, 2-4 days → 3, 5-7 days → 6
  const SPORT_DAYS_LOW = 1.5;    // Average of 1-2 days range
  const SPORT_DAYS_MEDIUM = 3;   // Average of 2-4 days range  
  const SPORT_DAYS_HIGH = 6;     // Average of 5-7 days range
  
  let sportDays = 0;
  if (data.sportActivity) {
    const sportStr = data.sportActivity;
    if (sportStr.includes('0 дни')) sportDays = 0;
    else if (sportStr.includes('1–2 дни')) sportDays = SPORT_DAYS_LOW;
    else if (sportStr.includes('2–4 дни')) sportDays = SPORT_DAYS_MEDIUM;
    else if (sportStr.includes('5–7 дни')) sportDays = SPORT_DAYS_HIGH;
  }
  
  // Combined score: 1-10 scale
  const combinedScore = Math.min(10, Math.max(1, dailyScore + sportDays));
  
  return {
    dailyScore,
    sportDays,
    combinedScore: Math.round(combinedScore * 10) / 10, // Round to 1 decimal
    activityLevel: combinedScore <= 3 ? 'Ниска' : 
                   combinedScore <= 6 ? 'Средна' : 
                   combinedScore <= 8 ? 'Висока' : 'Много висока'
  };
}

/**
 * Calculate TDEE (Total Daily Energy Expenditure) based on unified activity score
 * Updated multipliers based on 1-10 activity scale - Issue #7 & #10 Resolution
 * 
 * NOTE (2026-02-06): Updated to use unified activity score (1-10)
 * Maximum caloric deficit capped at 25% per Issue #9
 * AI model now calculates TDEE holistically. Kept for validation/fallback only.
 */
function calculateTDEE(bmr, activityLevel) {
  // Legacy support: if activityLevel is string, use old multipliers
  if (typeof activityLevel === 'string') {
    const activityMultipliers = {
      'Никаква (0 дни седмично)': 1.2,
      'Ниска (1–2 дни седмично)': 1.375,
      'Средна (2–4 дни седмично)': 1.55,
      'Висока (5–7 дни седмично)': 1.725,
      'Много висока (атлети)': 1.9,
      'default': 1.4
    };
    const multiplier = activityMultipliers[activityLevel] || activityMultipliers['default'];
    return Math.round(bmr * multiplier);
  }
  
  // New unified score-based multipliers (1-10 scale)
  // Smoother progression for more accurate TDEE calculation
  const scoreMultipliers = {
    1: 1.2,    // Sedentary
    2: 1.3,
    3: 1.375,  // Light
    4: 1.45,
    5: 1.525,
    6: 1.6,    // Moderate
    7: 1.675,
    8: 1.75,   // Very active
    9: 1.85,
    10: 1.95   // Extremely active
  };
  
  const score = Math.round(activityLevel);
  const multiplier = scoreMultipliers[score] || scoreMultipliers[5];
  return Math.round(bmr * multiplier);
}

/**
 * Calculate BMI (Body Mass Index)
 * BMI = weight(kg) / (height(m))^2
 */
function calculateBMI(data) {
  if (!data.weight || !data.height) {
    return null;
  }
  
  const weight = parseFloat(data.weight);
  const heightInMeters = parseFloat(data.height) / 100; // Convert cm to meters
  
  return weight / (heightInMeters * heightInMeters);
}

/**
 * Calculate macronutrient ratios - Issue #2 & #28 Resolution
 * Non-circular formula based on percentage distribution
 * Gender-specific protein requirements
 * 
 * NOTE (2026-02-06): This provides baseline ratios for reference.
 * AI model should see and validate/adjust these based on individual factors.
 * 
 * @param {Object} data - User data with weight, gender, goal
 * @param {number} activityScore - Unified activity score (1-10)
 * @param {number} tdee - Total Daily Energy Expenditure (optional, for accurate %)
 * @returns {{protein: number, carbs: number, fats: number, proteinGramsPerKg: number}} - protein/carbs/fats are percentages that sum to 100, proteinGramsPerKg is g/kg
 */
function calculateMacronutrientRatios(data, activityScore, tdee = null) {
  const weight = parseFloat(data.weight) || 70;
  const gender = data.gender;
  const goal = data.goal || '';
  
  // Base protein needs (g/kg body weight)
  // Women generally need slightly less due to lower muscle mass
  // Men need more for muscle maintenance/growth
  let proteinPerKg;
  if (gender === 'Мъж') {
    proteinPerKg = activityScore >= 7 ? 2.0 : activityScore >= 5 ? 1.6 : 1.2;
  } else { // Жена
    proteinPerKg = activityScore >= 7 ? 1.8 : activityScore >= 5 ? 1.4 : 1.0;
  }
  
  // Adjust for goal
  if (goal.includes('Мускулна маса')) {
    proteinPerKg *= 1.2;
  } else if (goal.includes('Отслабване')) {
    proteinPerKg *= 1.1; // Slightly more protein to preserve muscle
  }
  
  // Calculate protein grams needed
  const proteinGrams = weight * proteinPerKg;
  
  // Protein has 4 cal/g
  // Use provided TDEE if available, otherwise estimate based on weight/gender
  const estimatedCalories = tdee || (gender === 'Мъж' ? weight * 30 : weight * 28);
  const proteinCalories = proteinGrams * 4;
  const proteinPercent = Math.round((proteinCalories / estimatedCalories) * 100);
  
  // Distribute remaining calories between carbs and fats
  // Higher activity = more carbs for energy
  // Lower activity = more fats for satiety
  const remainingPercent = 100 - proteinPercent;
  let carbsPercent, fatsPercent;
  
  if (activityScore >= 7) {
    // Very active: prioritize carbs for energy
    carbsPercent = Math.round(remainingPercent * 0.6);
    fatsPercent = remainingPercent - carbsPercent;
  } else if (activityScore >= 4) {
    // Moderate: balanced
    carbsPercent = Math.round(remainingPercent * 0.5);
    fatsPercent = remainingPercent - carbsPercent;
  } else {
    // Low activity: prioritize fats for satiety
    carbsPercent = Math.round(remainingPercent * 0.4);
    fatsPercent = remainingPercent - carbsPercent;
  }
  
  // Ensure ratios sum to exactly 100%
  const total = proteinPercent + carbsPercent + fatsPercent;
  if (total !== 100) {
    fatsPercent += (100 - total); // Adjust fats to make it exactly 100
  }
  
  return {
    protein: proteinPercent,
    carbs: carbsPercent,
    fats: fatsPercent,
    proteinGramsPerKg: Math.round(proteinPerKg * 10) / 10
  };
}

/**
 * Calculate safe caloric deficit - Issue #9 Resolution
 * Maximum 25% deficit, but AI can adjust for specific strategies
 * 
 * @returns {{targetCalories: number, deficitPercent: number, maxDeficitCalories: number, note?: string}}
 */
function calculateSafeDeficit(tdee, goal) {
  const MAX_DEFICIT_PERCENT = 0.25; // 25% maximum
  
  if (!goal || !goal.includes('Отслабване')) {
    return {
      targetCalories: tdee,
      deficitPercent: 0,
      maxDeficitCalories: tdee
    };
  }
  
  // Conservative deficit: 15-20% for most people
  const standardDeficit = 0.18;
  const targetCalories = Math.round(tdee * (1 - standardDeficit));
  const maxDeficitCalories = Math.round(tdee * (1 - MAX_DEFICIT_PERCENT));
  
  return {
    targetCalories,
    deficitPercent: standardDeficit * 100,
    maxDeficitCalories,
    note: 'AI може да коригира при специални стратегии (напр. интермитентно гладуване)'
  };
}

/**
 * Validate data adequacy - check for unrealistic, inappropriate, or invalid data
 * Returns an object with { isValid: boolean, errorMessage: string }
 */
function validateDataAdequacy(data) {
  const errors = [];
  
  // Check weight (realistic range)
  const weight = parseFloat(data.weight);
  if (isNaN(weight) || weight < MIN_WEIGHT_KG || weight > MAX_WEIGHT_KG) {
    errors.push(`Теглото трябва да бъде между ${MIN_WEIGHT_KG} и ${MAX_WEIGHT_KG} кг. Моля, въведете реалистична стойност.`);
  }
  
  // Check height (realistic range)
  const height = parseFloat(data.height);
  if (isNaN(height) || height < MIN_HEIGHT_CM || height > MAX_HEIGHT_CM) {
    errors.push(`Височината трябва да бъде между ${MIN_HEIGHT_CM} и ${MAX_HEIGHT_CM} см. Моля, въведете реалистична стойност.`);
  }
  
  // Check age (realistic range - minors require special considerations)
  const age = parseInt(data.age);
  if (isNaN(age) || age < MIN_AGE || age > MAX_AGE) {
    errors.push(`Възрастта трябва да бъде между ${MIN_AGE} и ${MAX_AGE} години. Моля, въведете реалистична стойност.`);
  }
  
  // Add note for minors
  if (age >= MIN_AGE && age < 18) {
    // Note: In production, this should trigger a guardian consent flow
    console.log(`Minor user (age ${age}) - guardian consent should be obtained`);
  }
  
  // Check BMI extremes (medically unrealistic BMI values)
  if (!isNaN(weight) && !isNaN(height) && weight >= MIN_WEIGHT_KG && weight <= MAX_WEIGHT_KG && height >= MIN_HEIGHT_CM && height <= MAX_HEIGHT_CM) {
    const heightM = height / 100;
    const bmi = weight / (heightM * heightM);
    if (bmi < MIN_BMI) {
      errors.push('Въведените данни водят до медицински невъзможно ниско BMI. Моля, проверете теглото и височината.');
    } else if (bmi > MAX_BMI) {
      errors.push('Въведените данни водят до медицински невъзможно високо BMI. Моля, проверете теглото и височината.');
    }
  }
  
  // Check weight loss goal reasonableness
  if (data.goal && data.goal.includes('Отслабване') && data.lossKg) {
    const lossKg = parseFloat(data.lossKg);
    if (!isNaN(lossKg) && !isNaN(weight)) {
      if (lossKg > weight * MAX_WEIGHT_LOSS_PERCENT) {
        errors.push(`Целевото отслабване е твърде голямо (повече от ${MAX_WEIGHT_LOSS_PERCENT * 100}% от телесното тегло). Моля, задайте по-реалистична цел.`);
      }
      if (lossKg > MAX_WEIGHT_LOSS_KG) {
        errors.push(`Целевото отслабване не може да надвишава ${MAX_WEIGHT_LOSS_KG} кг в рамките на един план. Моля, задайте по-умерена начална цел.`);
      }
    }
  }
  
  // Check for offensive or vulgar content in text fields
  const textFields = [
    { field: 'name', value: data.name },
    { field: 'dietDislike', value: data.dietDislike },
    { field: 'dietLove', value: data.dietLove },
    { field: 'additionalNotes', value: data.additionalNotes },
    { field: 'medicationsDetails', value: data.medicationsDetails },
    { field: 'weightChangeDetails', value: data.weightChangeDetails }
  ];
  
  for (const { field, value } of textFields) {
    if (value && typeof value === 'string') {
      for (const pattern of OFFENSIVE_PATTERNS) {
        if (pattern.test(value)) {
          // Generic error message for security (don't reveal which field)
          errors.push('Въведената информация съдържа неподходящо съдържание. Моля, проверете всички полета и въведете коректна информация.');
          // Log specific field server-side for monitoring
          console.warn(`Offensive content detected in field: ${field}`);
          break; // Only report once per validation
        }
      }
      // If we found offensive content, stop checking other fields
      if (errors.some(e => e.includes('неподходящо съдържание'))) {
        break;
      }
    }
  }
  
  if (errors.length > 0) {
    return {
      isValid: false,
      errorMessage: 'Моля, проверете въведените данни:\n\n' + errors.join('\n\n')
    };
  }
  
  return { isValid: true };
}

/**
 * Detect goal contradictions (e.g., underweight person wanting to lose weight)
 * Returns an object with { hasContradiction: boolean, warningData: object }
 */
function detectGoalContradiction(data) {
  const bmi = calculateBMI(data);
  
  if (!bmi || !data.goal) {
    return { hasContradiction: false };
  }
  
  // BMI categories:
  // < 16: Severely underweight
  // 16-18.5: Underweight
  // 18.5-25: Normal weight
  // 25-30: Overweight
  // > 30: Obese
  
  let hasContradiction = false;
  let warningData = {};
  
  // Normalize goal for comparison (case-insensitive, trimmed)
  const normalizedGoal = (data.goal || '').toLowerCase().trim();
  
  // Check for severe underweight with weight loss goal
  // Use includes() for more flexible matching
  if (bmi < 18.5 && normalizedGoal.includes('отслабване')) {
    hasContradiction = true;
    warningData = {
      type: 'underweight_loss',
      bmi: bmi.toFixed(1),
      currentCategory: bmi < 16 ? 'Значително поднормено тегло' : 'Поднормено тегло',
      goalCategory: data.goal, // Use original goal text from user
      risks: [
        'Недохранване и дефицит на важни хранителни вещества',
        'Отслабване на имунната система',
        'Загуба на мускулна маса и костна плътност',
        'Хормонален дисбаланс',
        'Повишен риск от здравословни усложнения'
      ],
      recommendation: 'При вашето текущо тегло целта за отслабване е медицински неподходяща и опасна. Препоръчваме да консултирате лекар и да работите за постигане на здравословно тегло чрез балансирано хранене.'
    };
  }
  
  // Check for obesity with muscle gain goal
  // Use includes() for more flexible matching
  if (bmi >= 30 && normalizedGoal.includes('мускулна маса')) {
    hasContradiction = true;
    warningData = {
      type: 'overweight_gain',
      bmi: bmi.toFixed(1),
      currentCategory: bmi >= 35 ? 'Значително наднормено тегло (клас II затлъстяване)' : 'Наднормено тегло (затлъстяване)',
      goalCategory: data.goal, // Use original goal text from user
      risks: [
        'Повишен риск от сърдечносъдови заболявания',
        'Диабет тип 2',
        'Хипертония и метаболитни нарушения',
        'Ставни проблеми и намалена подвижност',
        'Повишен риск от множество здравословни усложнения'
      ],
      recommendation: 'При вашето текущо тегло целта за покачване на тегло е медицински неподходяща. Ако искате да увеличите мускулна маса, трябва първо да постигнете здравословно тегло чрез контролирано отслабване под медицински надзор.'
    };
  }
  
  // Check for dangerous combinations with medical conditions
  if (!hasContradiction && data.medicalConditions && Array.isArray(data.medicalConditions)) {
    // Check for thyroid conditions + aggressive caloric deficit
    if (data.medicalConditions.some(c => c.includes('Щитовидна жлеза') || c.includes('Хипотиреоидизъм')) && 
        normalizedGoal.includes('отслабване')) {
      const tdee = calculateTDEE(calculateBMR(data), data.sportActivity);
      const targetCalories = Math.round(tdee * 0.85); // 15% deficit
      const maxSafeDeficit = tdee * 0.75; // 25% is max safe deficit
      
      if (targetCalories < maxSafeDeficit) { // If deficit is more than 25%
        hasContradiction = true;
        warningData = {
          type: 'thyroid_aggressive_deficit',
          bmi: bmi.toFixed(1),
          currentCategory: 'Щитовидна дисфункция',
          goalCategory: data.goal,
          risks: [
            'Влошаване на метаболизма и хормоналния баланс',
            'Повишена умора и изтощение',
            'Допълнително забавяне на щитовидната функция'
          ],
          recommendation: 'При щитовидни проблеми е необходим много внимателен подход към отслабването. Препоръчваме медицинска консултация преди стартиране на диета с калориен дефицит.'
        };
      }
    }
    
    // Check for PCOS + high carb approach - validation handled in analysis
    if (data.medicalConditions.includes('PCOS') || data.medicalConditions.includes('СПКЯ')) {
      // PCOS patients typically need lower carb approach - this will be flagged in analysis
      // No contradiction here, but AI should be aware via analysis prompt
    }
    
    // Check for anemia + vegetarian/vegan diet without iron awareness
    if (data.medicalConditions.includes('Анемия') && 
        data.dietPreference && 
        (data.dietPreference.includes('Вегетарианска') || data.dietPreference.includes('Веган'))) {
      hasContradiction = true;
      warningData = {
        type: 'anemia_plant_based',
        bmi: bmi.toFixed(1),
        currentCategory: 'Анемия',
        goalCategory: data.goal,
        risks: [
          'Влошаване на анемията поради ниско усвояване на растително желязо',
          'Хронична умора и отслабване',
          'Имунна дисфункция'
        ],
        recommendation: 'При анемия и вегетарианска/веган диета е критично важно да се осигури достатъчно желязо чрез добавки и оптимизирано хранене. Задължителна е медицинска консултация и наблюдение на нивата на желязо.'
      };
    }
  }
  
  // Check for sleep deprivation + muscle gain goal (dangerous combination)
  if (!hasContradiction && data.sleepHours && parseFloat(data.sleepHours) < 6 && 
      normalizedGoal.includes('мускулна маса')) {
    hasContradiction = true;
    warningData = {
      type: 'sleep_deficit_muscle_gain',
      bmi: bmi.toFixed(1),
      currentCategory: `Недостатъчен сън (${data.sleepHours}ч)`,
      goalCategory: data.goal,
      risks: [
        'Невъзможност за мускулно възстановяване и растеж',
        'Повишен кортизол води до разграждане на мускулна тъкан',
        'Намален тестостерон и растежен хормон',
        'Риск от претренираност и травми'
      ],
      recommendation: `При ${data.sleepHours} часа сън на нощ мускулният растеж е силно затруднен. Първо трябва да оптимизирате съня (минимум 7-8 часа), след това да започнете програма за мускулна маса. Недостатъчният сън е критичен фактор за провал.`
    };
  }
  
  return { hasContradiction, warningData };
}

// CORS headers for client-side requests
// NOTE: For production, replace '*' with specific allowed domains
// Example: 'https://yourdomain.com, https://www.yourdomain.com'
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // TODO: Restrict to specific domains in production
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
  'Content-Type': 'application/json'
};

// Cache for admin configuration to reduce KV reads
let adminConfigCache = null;
let adminConfigCacheTime = 0;
const ADMIN_CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// Cache for chat prompts to reduce KV reads
let chatPromptsCache = null;
let chatPromptsCacheTime = 0;
const CHAT_PROMPTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// Validation constants (moved here to be available early in code)
const DAILY_CALORIE_TOLERANCE = 50; // ±50 kcal tolerance for daily calorie target
const MAX_LATE_SNACK_CALORIES = 200; // Maximum calories allowed for late-night snacks


/**
 * Remove internal justification fields from plan before returning to client
 * These fields are only for the validator and should not be visible to the end user
 */
function removeInternalJustifications(plan) {
  if (!plan) {
    return plan;
  }
  
  // Create a deep copy to avoid modifying the original
  // Using JSON methods is acceptable here as the plan is already JSON-serializable
  const cleanPlan = JSON.parse(JSON.stringify(plan));
  
  // Remove internal justification fields that are only for validation
  if (cleanPlan.strategy) {
    delete cleanPlan.strategy.longTermStrategy;
    delete cleanPlan.strategy.mealCountJustification;
    delete cleanPlan.strategy.afterDinnerMealJustification;
  }
  
  return cleanPlan;
}

/**
 * JSON response helper with CORS headers
 */
function jsonResponse(data, status = 200, options = {}) {
  const headers = { ...CORS_HEADERS };
  
  // Add cache-control header if specified
  // Examples:
  //   - 'no-cache' - don't cache (default for dynamic data)
  //   - 'public, max-age=300' - cache for 5 minutes
  //   - 'public, max-age=1800' - cache for 30 minutes
  if (options.cacheControl) {
    headers['Cache-Control'] = options.cacheControl;
  } else {
    // Default: no-cache for dynamic API responses
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
  }
  
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

/**
 * Sanitize JSON string to fix common AI formatting issues
 * - Remove trailing commas before } or ]
 * - Fix missing commas between array/object elements
 * - Remove duplicate commas
 */
function sanitizeJSON(jsonStr) {
  let result = jsonStr;
  
  // 1. Remove trailing commas before } or ]
  result = result.replace(/,(\s*[}\]])/g, '$1');
  
  // 2. Remove duplicate commas (,,)
  result = result.replace(/,\s*,+/g, ',');
  
  // 3. Fix missing comma between consecutive objects in arrays
  // Pattern: }\s*{ -> },{
  result = result.replace(/}(\s*){/g, '},$1{');
  
  // 4. Fix missing comma between consecutive arrays
  // Pattern: ]\s*[ -> ],[
  result = result.replace(/](\s*)\[/g, '],$1[');
  
  // 5. Fix missing comma between object and array
  // Pattern: }\s*[ -> },[
  result = result.replace(/}(\s*)\[/g, '},$1[');
  
  // 6. Fix missing comma between array and object
  // Pattern: ]\s*{ -> ],{
  result = result.replace(/](\s*){/g, '],$1{');
  
  return result;
}

/**
 * Extract JSON object or array from response using balanced brace/bracket matching
 * This prevents greedy regex from capturing non-JSON text after the object/array
 */
function extractBalancedJSON(text) {
  // Look for either { or [ as the start of JSON
  let firstBrace = text.indexOf('{');
  let firstBracket = text.indexOf('[');
  
  // Determine which comes first (or if only one exists)
  let startIndex = -1;
  let startChar = null;
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    startChar = '{';
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    startChar = '[';
  } else {
    return null; // No JSON structure found
  }
  
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    
    // Handle escape sequences
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    // Track string boundaries to ignore braces/brackets in strings
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    // Only count braces/brackets outside of strings
    if (!inString) {
      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
      } else if (char === '[') {
        bracketCount++;
      } else if (char === ']') {
        bracketCount--;
      }
      
      // When we close all braces/brackets, we have a complete JSON structure
      if (startChar === '{' && braceCount === 0) {
        return text.substring(startIndex, i + 1);
      } else if (startChar === '[' && bracketCount === 0) {
        return text.substring(startIndex, i + 1);
      }
    }
  }
  
  return null; // No balanced JSON found
}

/**
 * Parse AI response and extract JSON
 */
function parseAIResponse(response) {
  try {
    // Step 1: Try to extract JSON from markdown code blocks first
    const markdownJsonMatch = response.match(/```(?:json)?\s*([\[{][\s\S]*?[}\]])\s*```/);
    if (markdownJsonMatch) {
      try {
        const cleaned = sanitizeJSON(markdownJsonMatch[1]);
        return JSON.parse(cleaned);
      } catch (e) {
        console.warn('Failed to parse JSON from markdown block, trying other methods:', e.message);
      }
    }
    
    // Step 2: Try to find JSON using balanced brace matching (non-greedy)
    const jsonObject = extractBalancedJSON(response);
    if (jsonObject) {
      try {
        const cleaned = sanitizeJSON(jsonObject);
        return JSON.parse(cleaned);
      } catch (e) {
        console.warn('Failed to parse extracted JSON object, trying fallback:', e.message);
      }
    }
    
    // Step 3: Fallback to greedy match but with sanitization
    const jsonMatch = response.match(/[\[{][\s\S]*[}\]]/);
    if (jsonMatch) {
      try {
        const cleaned = sanitizeJSON(jsonMatch[0]);
        return JSON.parse(cleaned);
      } catch (e) {
        console.error('All JSON parsing attempts failed:', e.message);
        
        // Extract position from error message if available
        const posMatch = e.message.match(/position (\d+)/);
        if (posMatch) {
          const errorPos = parseInt(posMatch[1]);
          const contextStart = Math.max(0, errorPos - 100);
          const contextEnd = Math.min(jsonMatch[0].length, errorPos + 100);
          console.error('Context around error position:', jsonMatch[0].substring(contextStart, contextEnd));
        }
        
        console.error('Response excerpt (first 500 chars):', response.substring(0, 500));
        console.error('Response excerpt (last 500 chars):', response.substring(Math.max(0, response.length - 500)));
        
        // Return a user-friendly error without exposing the raw response
        return { error: `All JSON parsing attempts failed: ${e.message}` };
      }
    }
    
    // If no JSON found, return the response as-is wrapped in a structure
    console.error('No JSON structure found in AI response');
    console.error('Response excerpt (first 1000 chars):', response.substring(0, 1000));
    return { error: 'Could not parse AI response - no JSON found' };
  } catch (error) {
    console.error('Error parsing AI response:', error);
    console.error('Response length:', response?.length || 0);
    return { error: `Failed to parse response: ${error.message}` };
  }
}

// Enhancement #3: Estimate tokens for a message
// Note: This is a rough approximation (~4 chars per token for mixed content).
// Actual GPT tokenization varies by language and content. This is sufficient
// for conversation history management where approximate limits are acceptable.
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * More accurate token count estimation for AI prompts (supports Cyrillic)
 */
function estimateTokenCount(text) {
  if (!text) return 0;
  
  // Count Cyrillic vs Latin characters
  const cyrillicChars = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const totalChars = text.length;
  const cyrillicRatio = cyrillicChars / totalChars;
  
  // Cyrillic-heavy text: ~3 chars per token
  // Latin-heavy text: ~4 chars per token
  // Mixed text: interpolate between them
  const charsPerToken = 4 - (cyrillicRatio * 1); // 3-4 range
  
  return Math.ceil(totalChars / charsPerToken);
}

/**
 * Generate a unique session or log ID
 * @param {string} prefix - Prefix for the ID (e.g., 'session', 'regen', 'ai_log')
 * @returns {string} Unique ID with timestamp and random component
 */
function generateUniqueId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Generate user ID from user data
 */
function generateUserId(data) {
  const str = `${data.name}_${data.age}_${data.email || Date.now()}`;
  return btoa(str).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
}

// Enhancement #4: Check if a food item exists in the meal plan (case-insensitive, partial match)
function checkFoodExistsInPlan(plan, foodName) {
  if (!plan || !plan.weekPlan) return false;
  
  const searchTerm = foodName.toLowerCase();
  
  // Search through all days and meals
  for (const dayKey in plan.weekPlan) {
    const day = plan.weekPlan[dayKey];
    if (day && Array.isArray(day.meals)) {
      for (const meal of day.meals) {
        // Check meal name and description
        if (meal.name && meal.name.toLowerCase().includes(searchTerm)) {
          return true;
        }
        if (meal.description && meal.description.toLowerCase().includes(searchTerm)) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Call AI model with load monitoring
 * Goal: Monitor request sizes to ensure no single request is overloaded
 * Architecture: System already uses multi-step approach (Analysis → Strategy → Meal Plan Chunks)
 */
async function callAIModel(env, prompt, maxTokens = null, stepName = 'unknown', sessionId = null, userData = null, calculatedData = null) {
  // Improved token estimation for Cyrillic text
  const estimatedInputTokens = estimateTokenCount(prompt);
  console.log(`AI Request: estimated input tokens: ${estimatedInputTokens}, max output tokens: ${maxTokens || 'default'}`);
  
  // Monitor for large prompts - informational only
  // Note: Progressive generation already distributes meal plan across multiple requests
  if (estimatedInputTokens > 8000) {
    console.warn(`⚠️ Large input prompt detected: ~${estimatedInputTokens} tokens. This is expected for chat requests with full context. Progressive generation is already enabled for meal plans.`);
  }
  
  // Alert if prompt is very large - may indicate issue
  if (estimatedInputTokens > 12000) {
    console.error(`🚨 Very large input prompt: ~${estimatedInputTokens} tokens. Review the calling function to ensure this is intentional.`);
  }
  
  // Get admin config with caching (reduces KV reads from 2 to 0 when cached)
  const config = await getAdminConfig(env);
  const preferredProvider = config.provider;
  const modelName = config.modelName;

  // Log AI request
  const logId = await logAIRequest(env, stepName, {
    prompt: prompt,
    estimatedInputTokens: estimatedInputTokens,
    maxTokens: maxTokens,
    provider: preferredProvider,
    modelName: modelName,
    sessionId: sessionId,
    userData: userData,
    calculatedData: calculatedData
  });

  const startTime = Date.now();
  let response;
  let success = false;
  let error = null;

  try {
    // If mock is selected, return mock response
    if (preferredProvider === 'mock') {
      console.warn('Mock mode selected. Returning mock response.');
      response = generateMockResponse(prompt);
      success = true;
    } else if (preferredProvider === 'openai' && env.OPENAI_API_KEY) {
      // Try preferred provider first
      response = await callOpenAI(env, prompt, modelName, maxTokens);
      success = true;
    } else if (preferredProvider === 'anthropic' && env.ANTHROPIC_API_KEY) {
      response = await callClaude(env, prompt, modelName, maxTokens);
      success = true;
    } else if (preferredProvider === 'google' && env.GEMINI_API_KEY) {
      response = await callGemini(env, prompt, modelName, maxTokens);
      success = true;
    } else {
      // Fallback hierarchy if preferred not available
      if (env.OPENAI_API_KEY) {
        console.warn('Preferred provider not available. Falling back to OpenAI.');
        response = await callOpenAI(env, prompt, modelName, maxTokens);
        success = true;
      } else if (env.ANTHROPIC_API_KEY) {
        console.warn('Preferred provider not available. Falling back to Anthropic.');
        response = await callClaude(env, prompt, modelName, maxTokens);
        success = true;
      } else if (env.GEMINI_API_KEY) {
        console.warn('Preferred provider not available. Falling back to Google Gemini.');
        response = await callGemini(env, prompt, modelName, maxTokens);
        success = true;
      } else {
        throw new Error('No AI provider configured. Please configure at least one provider.');
      }
    }
  } catch (err) {
    console.error('Error calling AI model:', err);
    error = err.message || 'Unknown error';
    throw err;
  } finally {
    // Log AI response
    await logAIResponse(env, logId, stepName, {
      response: response,
      success: success,
      error: error,
      duration: Date.now() - startTime
    });
  }

  return response;
}

/**
 * Generate chat prompt with full context for precise analysis
 * NOTE: Uses full data in both modes to ensure comprehensive understanding of user context
 */
async function generateChatPrompt(env, userMessage, userData, userPlan, conversationHistory, mode = 'consultation') {
  // Use FULL data for both modes to ensure precise, comprehensive analysis
  // No compromise on data completeness for individualization and quality
  
  // Base context with complete data
  const baseContext = `Ти си личен диетолог, психолог и здравен асистент за ${userData.name}.

КЛИЕНТСКИ ПРОФИЛ:
${JSON.stringify(userData, null, 2)}

ПЪЛЕН ХРАНИТЕЛЕН ПЛАН:
${JSON.stringify(userPlan, null, 2)}

${conversationHistory.length > 0 ? `ИСТОРИЯ НА РАЗГОВОРА:\n${conversationHistory.map(h => `${h.role}: ${h.content}`).join('\n')}` : ''}
`;

  // Get mode-specific instructions from KV (with caching)
  const chatPrompts = await getChatPrompts(env);
  let modeInstructions = '';
  
  if (mode === 'consultation') {
    modeInstructions = chatPrompts.consultation;
  } else if (mode === 'modification') {
    // Replace {goal} placeholder with actual user goal
    modeInstructions = chatPrompts.modification.replace(/{goal}/g, userData.goal || 'твоята цел');
  }

  const fullPrompt = `${baseContext}
${modeInstructions}

ВЪПРОС: ${userMessage}

АСИСТЕНТ (отговори КРАТКО):`;

  return fullPrompt;
}

/**
 * Generate simplified fallback plan when main generation fails
 * Uses conservative approach with basic meals and minimal complexity
 * Last resort to provide user with something useful rather than complete failure
 */
async function generateSimplifiedFallbackPlan(env, data) {
  console.log('Generating simplified fallback plan');
  
  const bmr = calculateBMR(data);
  const tdee = calculateTDEE(bmr, data.sportActivity);
  let recommendedCalories = tdee;
  
  // Adjust for goal
  if (data.goal && data.goal.toLowerCase().includes('отслабване')) {
    recommendedCalories = Math.round(tdee * 0.85);
  } else if (data.goal && data.goal.toLowerCase().includes('мускулна маса')) {
    recommendedCalories = Math.round(tdee * 1.1);
  }
  
  // Simplified prompt with basic requirements
  const simplifiedPrompt = `Създай ОПРОСТЕН 7-дневен хранителен план за ${data.name}.

ОСНОВНИ ДАННИ:
- BMR: ${bmr} kcal, TDEE: ${tdee} kcal
- Целеви калории: ${recommendedCalories} kcal/ден
- Цел: ${data.goal}
- Възраст: ${data.age}, Пол: ${data.gender}
- Медицински състояния: ${JSON.stringify(data.medicalConditions || [])}
- Алергии/Непоносимости: ${data.dietDislike || 'няма'}

ИЗИСКВАНИЯ (ОПРОСТЕНИ):
- 3 хранения на ден: Закуска, Обяд, Вечеря
- Всяко ястие с calories и macros (protein, carbs, fats, fiber)
- Общо около ${recommendedCalories} kcal/ден
- Балансирани макроси: 30% протеини, 40% въглехидрати, 30% мазнини

ФОРМАТ (JSON):
{
  "day1": {"meals": [...]},
  "day2": {"meals": [...]},
  ...
  "day7": {"meals": [...]}
}

Създай прост, практичен план.`;

  // Call AI with simplified prompt
  const calculatedData = { bmr, tdee, recommendedCalories };
  const response = await callAIModel(env, simplifiedPrompt, 2000, 'fallback_plan', null, data, calculatedData);
  
  const plan = {
    analysis: { bmr, recommendedCalories, goal: data.goal },
    weekPlan: JSON.parse(response),
    summary: {
      bmr,
      dailyCalories: recommendedCalories,
      macros: { protein: 150, carbs: 200, fats: 65 }
    },
    recommendations: ['Пийте достатъчно вода', 'Спазвайте хранителните часове'],
    forbidden: [],
    psychology: ['Бъдете постоянни'],
    waterIntake: '2-3 литра дневно',
    supplements: []
  };
  
  return plan;
}

/**
 * Helper function to fetch and build dynamic whitelist/blacklist sections for prompts
 */
async function getDynamicFoodListsSections(env) {
  let dynamicWhitelist = [];
  let dynamicBlacklist = [];
  
  try {
    if (env && env.page_content) {
      const whitelistData = await env.page_content.get('food_whitelist');
      if (whitelistData) {
        dynamicWhitelist = JSON.parse(whitelistData);
      }
      
      const blacklistData = await env.page_content.get('food_blacklist');
      if (blacklistData) {
        dynamicBlacklist = JSON.parse(blacklistData);
      }
    }
  } catch (error) {
    console.error('Error loading whitelist/blacklist from KV:', error);
  }
  
  // Build dynamic whitelist section if there are custom items
  let dynamicWhitelistSection = '';
  if (dynamicWhitelist.length > 0) {
    dynamicWhitelistSection = `\n\nАДМИН WHITELIST (ПРИОРИТЕТНИ ХРАНИ ОТ АДМИН ПАНЕЛ):\n- ${dynamicWhitelist.join('\n- ')}\nТези храни са допълнително одобрени и трябва да се предпочитат при възможност.`;
  }
  
  // Build dynamic blacklist section if there are custom items
  let dynamicBlacklistSection = '';
  if (dynamicBlacklist.length > 0) {
    dynamicBlacklistSection = `\n\nАДМИН BLACKLIST (ДОПЪЛНИТЕЛНИ ЗАБРАНИ ОТ АДМИН ПАНЕЛ):\n- ${dynamicBlacklist.join('\n- ')}\nТези храни са категорично забранени от администратора и НЕ трябва да се използват.`;
  }
  
  return { dynamicWhitelistSection, dynamicBlacklistSection };
}

/**
 * Generate prompt for a chunk of days (progressive generation)
 */
async function generateMealPlanChunkPrompt(data, analysis, strategy, bmr, recommendedCalories, startDay, endDay, previousDays, env, errorPreventionComment = null, cachedFoodLists = null) {
  // Check if there's a custom prompt in KV storage
  const customPrompt = await getCustomPrompt(env, 'admin_meal_plan_prompt');
  
  const dietaryModifier = strategy.dietaryModifier || 'Балансирано';
  const daysInChunk = endDay - startDay + 1;
  
  // Build modifications section
  let modificationsSection = '';
  if (data.planModifications && data.planModifications.length > 0) {
    const modLines = data.planModifications
      .map(mod => PLAN_MODIFICATION_DESCRIPTIONS[mod])
      .filter(desc => desc !== undefined);
    if (modLines.length > 0) {
      modificationsSection = `\nМОДИФИКАЦИИ: ${modLines.join('; ')}`;
    }
  }
  
  // Build previous days context for variety (compact - only meal names)
  let previousDaysContext = '';
  if (previousDays.length > 0) {
    const prevMeals = previousDays.map(d => {
      const mealNames = d.meals.map(m => m.name).join(', ');
      return `Ден ${d.day}: ${mealNames}`;
    }).join('; ');
    previousDaysContext = `\n\nВЕЧЕ ГЕНЕРИРАНИ ДНИ (за разнообразие):\n${prevMeals}\n\nПОВТОРЕНИЕ (Issue #11 - ФАЗА 4): Максимум 5 ястия могат да се повторят в цялата седмица. ИЗБЯГВАЙ повтаряне на горните ястия, освен ако не е абсолютно необходимо!`;
  }
  
  // Extract essential data from Steps 1 & 2 for menu generation
  // Per issue: Step 3 should receive all relevant data from Steps 1 & 2
  const strategyCompact = {
    dietType: strategy.dietType || 'Балансирана',
    weeklyMealPattern: strategy.weeklyMealPattern || 'Традиционна',
    mealTiming: strategy.mealTiming?.pattern || '3 хранения дневно',
    keyPrinciples: (strategy.keyPrinciples || []).join('; '), // All principles from Step 2
    foodsToInclude: (strategy.foodsToInclude || []).join(', '), // All preferred foods from Step 2
    foodsToAvoid: (strategy.foodsToAvoid || []).join(', '), // All unwanted foods from Step 2
    calorieDistribution: strategy.calorieDistribution || 'не е определено', // From Step 2
    macroDistribution: strategy.macroDistribution || 'не е определено', // From Step 2
    weeklyScheme: strategy.weeklyScheme || null // Weekly structure from Step 2
  };
  
  // Extract macro information from Step 1 (analysis)
  // Note: fiber is in macroRatios.fiber (grams) per the system's schema design
  const analysisCompact = {
    macroRatios: analysis.macroRatios ? 
      `Protein: ${analysis.macroRatios.protein != null ? analysis.macroRatios.protein + '%' : 'N/A'}, Carbs: ${analysis.macroRatios.carbs != null ? analysis.macroRatios.carbs + '%' : 'N/A'}, Fats: ${analysis.macroRatios.fats != null ? analysis.macroRatios.fats + '%' : 'N/A'}` : 
      'не изчислени',
    macroGrams: analysis.macroGrams ?
      `Protein: ${analysis.macroGrams.protein != null ? analysis.macroGrams.protein + 'g' : 'N/A'}, Carbs: ${analysis.macroGrams.carbs != null ? analysis.macroGrams.carbs + 'g' : 'N/A'}, Fats: ${analysis.macroGrams.fats != null ? analysis.macroGrams.fats + 'g' : 'N/A'}` :
      'не изчислени',
    fiber: analysis.macroRatios?.fiber != null ? `${analysis.macroRatios.fiber}g` : 'N/A' // Fiber is stored in macroRatios but measured in grams
  };
  
  // Use cached food lists if provided, otherwise fetch (optimization)
  let dynamicWhitelistSection, dynamicBlacklistSection;
  if (cachedFoodLists) {
    dynamicWhitelistSection = cachedFoodLists.dynamicWhitelistSection;
    dynamicBlacklistSection = cachedFoodLists.dynamicBlacklistSection;
  } else {
    const foodLists = await getDynamicFoodListsSections(env);
    dynamicWhitelistSection = foodLists.dynamicWhitelistSection;
    dynamicBlacklistSection = foodLists.dynamicBlacklistSection;
  }
  
  // Extract meal pattern from strategy
  let mealPlanGuidance = '';
  if (strategy && strategy.mealTiming) {
    const timing = strategy.mealTiming;
    mealPlanGuidance = `
=== СЕДМИЧНА СТРУКТУРА НА ХРАНЕНЕ ===
ВАЖНО: Създай хранения според стратегията и хронотипа на клиента.

Седмичен модел: ${strategy.weeklyMealPattern || 'Стандартен модел'}
Структура: ${timing.pattern || 'Консистентна структура'}
Прозорци на гладуване: ${timing.fastingWindows || 'няма'}
Гъвкавост: ${timing.flexibility || 'Модерирана'}
Насоки за хронотип (${data.chronotype}): ${timing.chronotypeGuidance || 'Адаптирай според енергийните пикове'}

Брой хранения: ${strategy.mealCountJustification || 'Определи според профила (обикновено 2-4 хранения)'}

ВАЖНО:
- Генерирай хранения според горната структура и целевите калории (${recommendedCalories} kcal/ден)
- Сборът на калориите за деня ТРЯБВА да е приблизително ${recommendedCalories} kcal
- Адаптирай времето и размера на храненията според хронотипа
- Ако има интермитентно гладуване, спазвай прозорците на хранене
`;
  }
  
  const defaultPrompt = `Generate DAYS ${startDay}-${endDay} for ${data.name}.

=== PROFILE ===
Goal: ${data.goal} | BMR: ${bmr} | Cals: ${recommendedCalories}/day | Modifier: "${dietaryModifier}"${modificationsSection}
Stress: ${data.stressLevel} | Sleep: ${data.sleepHours}h | Chronotype: ${data.chronotype}${previousDaysContext}

=== STEP1 DATA (ANALYSIS) ===
MacroRatios: ${analysisCompact.macroRatios}
MacroGrams/day: ${analysisCompact.macroGrams}
Fiber/day: ${analysisCompact.fiber}

=== STEP2 DATA (STRATEGY) ===
Diet: ${strategyCompact.dietType} | Meals: ${strategyCompact.mealTiming}
Principles: ${strategyCompact.keyPrinciples}
Include (step2): ${strategyCompact.foodsToInclude}
Include (user): ${data.dietLove || 'none'}
Avoid (step2): ${strategyCompact.foodsToAvoid}
Avoid (user): ${data.dietDislike || 'none'}
CalDist (step2): ${strategyCompact.calorieDistribution}
MacroDist (step2): ${strategyCompact.macroDistribution}${strategyCompact.weeklyScheme ? `

=== WEEKLY STRUCTURE (step2) ===
${Object.keys(strategyCompact.weeklyScheme).map(day => {
  const dayData = strategyCompact.weeklyScheme[day];
  const dayName = DAY_NAMES_BG[day] || day;
  return `${dayName}: ${dayData.meals}meals - ${dayData.description}`;
}).join('\n')}` : ''}${data.additionalNotes ? `

⚠️ USER NOTES: ${data.additionalNotes}` : ''}
${data.dietPreference && data.dietPreference.length > 0 ? `\n⚠️ MANDATORY DIET PREF: ${JSON.stringify(data.dietPreference)}` : ''}
${data.eatingHabits && data.eatingHabits.includes('Не закусвам') ? '\n⚠️ MANDATORY: NO BREAKFAST (exception: drinks/liquids if health)' : ''}

=== CORE RULES ===
HARD BANS: onion, turkey, honey, sugar, ketchup, mayo, Greek yogurt, peas+fish
RARE (≤2x/week): bacon, turkey ham
WHITELIST: ${dynamicWhitelistSection}${dynamicBlacklistSection}

Композиция ястие (ADLE): [PRO (1x)] + [ENG (0-1x)] + [VOL (1-2x)] + [FAT (0-1x)]
- PRO (точно 1): яйца, пилешко, риба, говеждо, кисело мляко, извара, сирене, боб, леща
- ENG (0-1, НЕ 2): овес, ориз, картофи, паста, булгур
- VOL (1-2, ЕДНА форма: салата ИЛИ пресни): домати, краставици, чушки, салата, спанак, броколи
- FAT (0-1): зехтин, масло, ядки (ако ядки → без зехтин/масло)

Специални правила:
- Сирене → без зехтин/масло (маслини OK)
- Бекон → FAT=0
- Боб/леща като основно → ENG=0 (хляб опционално 1 филия)
- Млечни макс 1 на хранене (кисело мляко ИЛИ извара ИЛИ сирене)
Филтър MODE "${dietaryModifier}": ${dietaryModifier === 'Веган' ? 'без животински PRO' : dietaryModifier === 'Кето' ? 'минимум ENG' : dietaryModifier === 'Без глутен' ? 'ENG само безглутенови' : 'балансирано'}

=== REQUIREMENTS ===
1. Calorie distribution: Use step2 calDist for proper meal calorie distribution
2. Macros MANDATORY: protein, carbs, fats, fiber in grams for EACH meal
3. Calories: protein×4 + carbs×4 + fats×9
4. Target daily calories: ~${recommendedCalories} kcal (±${DAILY_CALORIE_TOLERANCE} kcal OK)
5. Meal count: ${strategy.mealCountJustification || '2-4 meals per profile (1-2 IF, 3-4 standard)'}
6. Order: Breakfast → Lunch → (Afternoon) → Dinner → (Late only if: >4h between dinner-sleep + justified)
   Late snack ONLY low GI: yogurt, nuts, berries, avocado, seeds (max ${MAX_LATE_SNACK_CALORIES} kcal)
7. Variety: Different meals from previous days${data.eatingHabits && data.eatingHabits.includes('Не закусвам') ? '\n8. MANDATORY: Client NO BREAKFAST - skip or drinks only!' : ''}
8. ⚠️ FREE MEAL: If strategy includes free meal (Sunday lunch recommended), record meal name as "свободно хранене" exactly - let user decide what to eat

${MEAL_NAME_FORMAT_INSTRUCTIONS}

JSON FORMAT (days ${startDay}-${endDay}):
{
  "day${startDay}": {
    "meals": [
      {"type": "Breakfast/Lunch/Dinner", "name": "name (use 'свободно хранене' for free meal)", "weight": "Xg", "description": "desc", "benefits": "benefits", "calories": X, "macros": {"protein": X, "carbs": X, "fats": X, "fiber": X}}
    ],
    "dailyTotals": {"calories": X, "protein": X, "carbs": X, "fats": X}
  }${daysInChunk > 1 ? `,\n  "day${startDay + 1}": {...}` : ''}
}

Generate balanced Bulgarian meals. MANDATORY include dailyTotals!`;
  
  // If custom prompt exists, use it; otherwise use default
  if (customPrompt) {
    // Replace variables in custom prompt
    let prompt = replacePromptVariables(customPrompt, {
      userData: data,
      analysisData: analysis,
      strategyData: strategy,
      bmr: bmr,
      recommendedCalories: recommendedCalories,
      startDay: startDay,
      endDay: endDay,
      previousDays: previousDays
    });
    
    // CRITICAL: Ensure JSON format instructions are included even with custom prompts
    if (!hasJsonFormatInstructions(prompt)) {
      prompt += `

═══ КРИТИЧНО ВАЖНО - ФОРМАТ НА ОТГОВОР ═══
Отговори САМО с валиден JSON обект БЕЗ допълнителни обяснения или текст преди или след JSON.

Структурата ТРЯБВА да е:
{
  "dayN": {
    "meals": [
      {"type": "Закуска/Обяд/Вечеря", "name": "име", "weight": "Xg", "description": "текст", "benefits": "текст", "calories": число, "macros": {"protein": число, "carbs": число, "fats": число, "fiber": число}}
    ],
    "dailyTotals": {"calories": число, "protein": число, "carbs": число, "fats": число}
  }
}

ВАЖНО: Върни САМО JSON без други текст или обяснения!`;
    }
    return prompt;
  }
  
  return defaultPrompt;
}

/**
 * Step 3: Generate prompt for detailed meal plan (LEGACY - used when progressive generation is disabled)
 * 
 * ARCHPROMPT INTEGRATION:
 * This function integrates the sophisticated dietary logic system from archprompt.txt
 * The system uses a MODIFIER (dietary profile) determined by the AI in Step 2 to:
 * - Filter food categories based on dietary restrictions
 * - Select appropriate meal templates (Шаблон A, B, C, D)
 * - Apply logical rules for food combinations
 * - Generate balanced, natural-sounding meals
 * 
 * The MODIFIER acts as a filter applied to the universal food architecture:
 * [PRO] = Protein, [ENG] = Energy/Carbs, [VOL] = Volume/Fiber, [FAT] = Fats, [CMPX] = Complex dishes
 */
async function generateMealPlanPrompt(data, analysis, strategy, env, errorPreventionComment = null) {
  // Parse BMR from analysis (may be a number or string) or calculate from user data
  let bmr;
  if (analysis.bmr) {
    // If bmr is already a number, use it directly
    if (typeof analysis.bmr === 'number') {
      bmr = Math.round(analysis.bmr);
    } else {
      // Try to extract numeric value from analysis.bmr (it may contain text like "1780 (ІНДИВІДУАЛНО изчислен)")
      const bmrMatch = String(analysis.bmr).match(/\d+/);
      bmr = bmrMatch ? parseInt(bmrMatch[0]) : null;
    }
  }
  
  // If no valid BMR from analysis, calculate it
  if (!bmr) {
    bmr = calculateBMR(data);
  }
  
  // Parse recommended calories from analysis or calculate from TDEE
  let recommendedCalories;
  if (analysis.recommendedCalories) {
    // If recommendedCalories is already a number, use it directly
    if (typeof analysis.recommendedCalories === 'number') {
      recommendedCalories = Math.round(analysis.recommendedCalories);
    } else {
      // Try to extract numeric value from analysis.recommendedCalories
      const caloriesMatch = String(analysis.recommendedCalories).match(/\d+/);
      recommendedCalories = caloriesMatch ? parseInt(caloriesMatch[0]) : null;
    }
  }
  
  // If no recommended calories from analysis, calculate TDEE
  if (!recommendedCalories) {
    const tdee = calculateTDEE(bmr, data.sportActivity);
    // Adjust based on goal
    if (data.goal === 'Отслабване') {
      recommendedCalories = Math.round(tdee * 0.85); // 15% deficit
    } else if (data.goal === 'Покачване на мускулна маса') {
      recommendedCalories = Math.round(tdee * 1.1); // 10% surplus
    } else {
      recommendedCalories = tdee; // Maintenance
    }
  }
  
  // Build modifications section if any
  let modificationsSection = '';
  if (data.planModifications && data.planModifications.length > 0) {
    const modLines = data.planModifications
      .map(mod => PLAN_MODIFICATION_DESCRIPTIONS[mod])
      .filter(desc => desc !== undefined); // Skip unknown modifications
    
    if (modLines.length > 0) {
      modificationsSection = `
СПЕЦИАЛНИ МОДИФИКАЦИИ НА ПЛАНА:
${modLines.join('\n')}

ВАЖНО: Спазвай СТРИКТНО тези модификации при генерирането на плана!
`;
    }
  }
  
  // Extract dietary modifier from strategy
  const dietaryModifier = strategy.dietaryModifier || 'Балансирано';
  
  // Fetch dynamic whitelist and blacklist from KV storage
  const { dynamicWhitelistSection, dynamicBlacklistSection } = await getDynamicFoodListsSections(env);
  
  // Create compact strategy (no full JSON)
  const strategyCompact = {
    dietType: strategy.dietType || 'Балансирана',
    weeklyMealPattern: strategy.weeklyMealPattern || 'Традиционна',
    mealTiming: strategy.mealTiming?.pattern || '3 хранения дневно',
    keyPrinciples: (strategy.keyPrinciples || []).slice(0, 3).join('; '),
    foodsToInclude: (strategy.foodsToInclude || []).slice(0, 5).join(', '),
    foodsToAvoid: (strategy.foodsToAvoid || []).slice(0, 5).join(', '),
    psychologicalSupport: (strategy.psychologicalSupport || []).slice(0, 3),
    supplementRecommendations: (strategy.supplementRecommendations || []).slice(0, 3),
    hydrationStrategy: strategy.hydrationStrategy || 'препоръки за вода'
  };
  
  return `Ти действаш като Advanced Dietary Logic Engine (ADLE) – логически конструктор на хранителни режими.

=== КРИТИЧНО ВАЖНО - НИКАКВИ DEFAULT СТОЙНОСТИ ===
- Този план е САМО и ЕДИНСТВЕНО за ${data.name}
- ЗАБРАНЕНО е използването на универсални, общи или стандартни стойности
- ВСИЧКИ калории, макронутриенти и препоръки са ИНДИВИДУАЛНО изчислени
- Хранителните добавки са ПЕРСОНАЛНО подбрани според анализа и нуждите
- Психологическите съвети са базирани на КОНКРЕТНИЯ емоционален профил на ${data.name}

=== DIET MODIFIER (User profile) ===
MODIFIER: "${dietaryModifier}"

=== CLIENT & GOALS ===
Име: ${data.name}, Възраст: ${data.age}, Пол: ${data.gender}
Цел: ${data.goal}
BMR (изчислен): ${bmr} kcal
Препоръчан калориен прием: ${recommendedCalories} kcal/ден

=== СТРАТЕГИЯ (КОМПАКТНА) ===
Тип: ${strategyCompact.dietType}
Хранене: ${strategyCompact.mealTiming}
Принципи: ${strategyCompact.keyPrinciples}
Включвай: ${strategyCompact.foodsToInclude}
Избягвай: ${strategyCompact.foodsToAvoid}

${modificationsSection}

${dynamicWhitelistSection}
${dynamicBlacklistSection}

=== АРХИТЕКТУРА НА ХРАНИТЕ (AFAM) ===
Базови категории (от които се избират храни според модификатора):
- [PRO]: Протеинови източници (месо, риба, яйца, протеин на прах)
- [ENG]: Енергийни източници (зърнени, ориз, паста, картофи, тестени)
- [VOL]: Обемни/фибърни (зеленчуци, салати, зелени храни)
- [FAT]: Мазнини (масло, олио, ядки, семки, авокадо)
- [CMPX]: Комплексни ястия (пълни готови ястия, супи, гозби)

=== ЛОГИКА ЗА КОМБИНИРАНЕ ===
ШАБЛОНИ ЗА ХРАНЕНИЯ:
A) PRO + ENG + VOL + FAT (класическо пълно хранене, напр. пиле с ориз и салата)
B) PRO + VOL + FAT (ниско въглехидратно, напр. риба със зеленчуци)
C) CMPX (цяло готово ястие, напр. яхния, супа)
D) ENG + FAT (бърза закуска, напр. овесена каша с ядки)

ОГРАНИЧЕНИЯ:
- Един топъл обяд (CMPX) дневно е ДОСТАТЪЧЕН
- Не са нужни комплексни готвени ястия за ВСЯКО хранене
- Разнообразие = различни КОМПОНЕНТИ, не различно готвене
- След обяд с пълна гозба → вечеря по-лека
- Никога обяд И вечеря тежки/сложни същия ден

=== ЗАДАЧА ===
Генерирай 7-дневен хранителен план (day1-day7) като използваш модификатора за филтриране на позволени храни.
За ВСЕКИ ДЕН:
- ${strategy.mealCount || 3} хранения ПО РЕДА НА ХРАНЕНЕ (Закуска първо, после Обяд, след това Вечеря...)
- Прилагай правилата за комбиниране
- Всяко ястие с name, time, calories, macros (protein, carbs, fats, fiber)
- Седмично мислене: РАЗНООБРАЗИЕ между дните

${errorPreventionComment ? `\n=== КОРЕКЦИИ НА ГРЕШКИ ===\n${errorPreventionComment}\n` : ''}

JSON ФОРМАТ:
{
  "day1": {
    "meals": [
      {"name": "...", "time": "...", "calories": число, "macros": {...}},
      ...
    ]
  },
  ...
  "day7": {...}
}

=== ИНДИВИДУАЛНИ ИЗИСКВАНИЯ ===
- Медицински: ${JSON.stringify(data.medicalConditions || [])}
- Предпочитания: ${JSON.stringify(data.dietPreference || [])}
- Избягвай: ${data.dietDislike || 'няма'}
- Включвай: ${data.dietLove || 'няма'}

ВАЖНО: Използвай strategy.planJustification, strategy.longTermStrategy, strategy.mealCountJustification и strategy.afterDinnerMealJustification за обосновка на всички нестандартни решения. "recommendations"/"forbidden"=САМО конкретни храни. Всички 7 дни (day1-day7) с 1-5 хранения В ПРАВИЛЕН ХРОНОЛОГИЧЕН РЕД. Точни калории/макроси за всяко ястие. Около ${recommendedCalories} kcal/ден като ориентир (може да варира при многодневно планиране). Седмичен подход: МИСЛИ СЕДМИЧНО/МНОГОДНЕВНО - ЦЯЛОСТНА схема като система. ВСИЧКИ 7 дни (day1-day7) ЗАДЪЛЖИТЕЛНО.

Създай пълния 7-дневен план с балансирани, индивидуални ястия за ${data.name}, следвайки стратегията.`;
}

/**
 * Generate prompt for summary and recommendations (final step of progressive generation)
 */
async function generateMealPlanSummaryPrompt(data, analysis, strategy, bmr, recommendedCalories, weekPlan, env) {
  // Check if there's a custom prompt in KV storage
  const customPrompt = await getCustomPrompt(env, 'admin_summary_prompt');
  
  // Calculate total calories and macros across the week for validation
  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFats = 0;
  let dayCount = 0;
  
  Object.keys(weekPlan).forEach(dayKey => {
    if (weekPlan[dayKey] && weekPlan[dayKey].meals) {
      weekPlan[dayKey].meals.forEach(meal => {
        totalCalories += (parseInt(meal.calories) || 0);
        if (meal.macros) {
          totalProtein += (parseInt(meal.macros.protein) || 0);
          totalCarbs += (parseInt(meal.macros.carbs) || 0);
          totalFats += (parseInt(meal.macros.fats) || 0);
        }
      });
      dayCount++;
    }
  });
  
  const avgCalories = dayCount > 0 ? Math.round(totalCalories / dayCount) : recommendedCalories;
  const avgProtein = dayCount > 0 ? Math.round(totalProtein / dayCount) : 0;
  const avgCarbs = dayCount > 0 ? Math.round(totalCarbs / dayCount) : 0;
  const avgFats = dayCount > 0 ? Math.round(totalFats / dayCount) : 0;
  
  // Extract compact strategy info (no full JSON)
  const psychologicalSupport = strategy.psychologicalSupport || ['Бъди мотивиран', 'Следвай плана', 'Постоянство е ключово'];
  const supplementRecommendations = strategy.supplementRecommendations || ['Според нуждите'];
  const hydrationStrategy = strategy.hydrationStrategy || 'Минимум 2-2.5л вода дневно';
  const foodsToInclude = strategy.foodsToInclude || [];
  const foodsToAvoid = strategy.foodsToAvoid || [];
  
  // Fetch dynamic whitelist and blacklist from KV storage (FIX: was missing from summary step)
  const { dynamicWhitelistSection, dynamicBlacklistSection } = await getDynamicFoodListsSections(env);
  
  // Extract health analysis context for supplement recommendations
  const healthContext = {
    keyProblems: (analysis.keyProblems || []).map(p => `${p.problem} (${p.severity})`).join('; '),
    allergies: data.allergies || 'няма',
    medications: data.medications || 'няма',
    medicalHistory: data.medicalHistory || 'няма',
    deficiencies: (analysis.nutritionalDeficiencies || []).join(', ') || 'няма установени'
  };
  
  const defaultPrompt = `Summary за 7-дневен план.

КЛИЕНТ: ${data.name}, Цел: ${data.goal}, BMR: ${bmr}
Целеви: ${recommendedCalories} kcal/ден | Реален: ${avgCalories} kcal/ден
Макроси: Protein ${avgProtein}g, Carbs ${avgCarbs}g, Fats ${avgFats}g

ЗДРАВНИ ДАННИ: Проблеми: ${healthContext.keyProblems || 'няма'} | Алергии: ${healthContext.allergies} | Медикаменти: ${healthContext.medications}${dynamicWhitelistSection}${dynamicBlacklistSection}

JSON:
{
  "summary": {"bmr": ${bmr}, "dailyCalories": ${avgCalories}, "macros": {"protein": ${avgProtein}, "carbs": ${avgCarbs}, "fats": ${avgFats}}},
  "recommendations": ["храна 1", "храна 2", "храна 3"],
  "forbidden": ["храна 1", "храна 2"],
  "psychology": ${strategy.psychologicalSupport ? JSON.stringify(strategy.psychologicalSupport.slice(0, 3)) : '["съвет 1", "съвет 2"]'},
  "waterIntake": "${strategy.hydrationStrategy || '2-2.5л дневно'}",
  "supplements": ["добавка 1 (дозировка)", "добавка 2 (дозировка)"]
}

ВАЖНО: recommendations/forbidden=конкретни храни; supplements=според здравен статус и медикаменти с дозировка`;

  // If custom prompt exists, use it; otherwise use default
  if (customPrompt) {
    // Replace variables in custom prompt
    let prompt = replacePromptVariables(customPrompt, {
      userData: data,
      strategyData: strategy,
      weekPlan: weekPlan,
      bmr: bmr,
      recommendedCalories: recommendedCalories,
      avgCalories: avgCalories,
      avgProtein: avgProtein,
      avgCarbs: avgCarbs,
      avgFats: avgFats
    });
    
    // CRITICAL: Ensure JSON format instructions are included even with custom prompts
    if (!hasJsonFormatInstructions(prompt)) {
      prompt += `

═══ КРИТИЧНО ВАЖНО - ФОРМАТ НА ОТГОВОР ═══
Отговори САМО с валиден JSON обект БЕЗ допълнителни обяснения или текст преди или след JSON.

Структурата ТРЯБВА да е:
{
  "summary": {
    "bmr": число,
    "dailyCalories": число,
    "macros": {"protein": число, "carbs": число, "fats": число}
  },
  "recommendations": ["текст"],
  "forbidden": ["текст"],
  "psychology": ["текст"],
  "waterIntake": "текст",
  "supplements": ["текст"]
}

ВАЖНО: Върни САМО JSON без други текст или обяснения!`;
    }
    return prompt;
  }
  
  return defaultPrompt;
}

/**
 * Generate nutrition plan from questionnaire data using multi-step approach
 */
async function handleGeneratePlan(request, env) {
  try {
    console.log('handleGeneratePlan: Starting');
    const data = await request.json();
    
    // Validate required fields
    if (!data.name || !data.age || !data.weight || !data.height) {
      console.error('handleGeneratePlan: Missing required fields');
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_FIELDS }, 400);
    }
    
    // Step 0: Validate data adequacy (unrealistic, offensive, inappropriate data)
    const dataValidation = validateDataAdequacy(data);
    if (!dataValidation.isValid) {
      console.error('handleGeneratePlan: Data adequacy validation failed:', dataValidation.errorMessage);
      return jsonResponse({ 
        error: dataValidation.errorMessage,
        validationFailed: true 
      }, 400);
    }

    // Generate unique user ID (could be email or session-based)
    const userId = data.email || generateUserId(data);
    console.log('handleGeneratePlan: Request received for userId:', userId);
    
    // Check for goal contradictions before generating plan
    const { hasContradiction, warningData } = detectGoalContradiction(data);
    
    if (hasContradiction) {
      console.log('handleGeneratePlan: Goal contradiction detected, returning warning');
      return jsonResponse({ 
        success: true,
        hasContradiction: true,
        warningData: warningData,
        userId: userId 
      });
    }
    
    console.log('handleGeneratePlan: Generating new plan with multi-step approach for userId:', userId);
    
    // Use multi-step approach for better individualization
    // No caching - client stores plan locally
    let structuredPlan = await generatePlanMultiStep(env, data);
    console.log('handleGeneratePlan: Plan structured for userId:', userId);
    
    // ENHANCED: Implement step-specific correction loop
    // Instead of correcting the whole plan, regenerate from the earliest error step
    let validation = validatePlan(structuredPlan, data);
    let correctionAttempts = 0;
    
    // Safety check: ensure MAX_CORRECTION_ATTEMPTS is valid
    const maxAttempts = Math.max(0, MAX_CORRECTION_ATTEMPTS);
    
    while (!validation.isValid && correctionAttempts < maxAttempts) {
      correctionAttempts++;
      console.log(`handleGeneratePlan: Plan validation failed (attempt ${correctionAttempts}/${maxAttempts}):`, validation.errors);
      console.log(`handleGeneratePlan: Earliest error step: ${validation.earliestErrorStep}`);
      
      try {
        // Regenerate from the earliest error step with targeted error prevention
        console.log(`handleGeneratePlan: Regenerating from ${validation.earliestErrorStep} (attempt ${correctionAttempts})`);
        structuredPlan = await regenerateFromStep(
          env, 
          data, 
          structuredPlan, 
          validation.earliestErrorStep, 
          validation.stepErrors,
          correctionAttempts
        );
        
        console.log(`handleGeneratePlan: Plan regenerated from ${validation.earliestErrorStep} (attempt ${correctionAttempts})`);
        
        // Re-validate the regenerated plan
        validation = validatePlan(structuredPlan, data);
        
        if (validation.isValid) {
          console.log(`handleGeneratePlan: Plan validated successfully after ${correctionAttempts} correction(s)`);
        }
      } catch (error) {
        console.error(`handleGeneratePlan: Regeneration attempt ${correctionAttempts} failed:`, error);
        // Continue with next attempt or exit loop
        if (correctionAttempts >= maxAttempts) {
          break;
        }
      }
    }
    
    // Final validation check - if still invalid after max attempts, try fallback strategy
    if (!validation.isValid) {
      console.error(`handleGeneratePlan: Plan validation failed after ${correctionAttempts} correction attempts:`, validation.errors);
      
      // Fallback strategy: Try to generate a simplified plan as last resort
      if (correctionAttempts >= maxAttempts) {
        console.log('handleGeneratePlan: Attempting simplified fallback plan generation');
        try {
          // Generate simplified plan with reduced requirements
          const simplifiedPlan = await generateSimplifiedFallbackPlan(env, data);
          const fallbackValidation = validatePlan(simplifiedPlan, data);
          
          if (fallbackValidation.isValid) {
            console.log('handleGeneratePlan: Simplified fallback plan validated successfully');
            const cleanPlan = removeInternalJustifications(simplifiedPlan);
            return jsonResponse({ 
              success: true, 
              plan: cleanPlan,
              userId: userId,
              correctionAttempts: correctionAttempts,
              fallbackUsed: true,
              note: "Използван опростен план поради технически проблеми с основния алгоритъм"
            });
          }
        } catch (fallbackError) {
          console.error('handleGeneratePlan: Simplified fallback also failed:', fallbackError);
        }
      }
      
      // If all strategies failed, return detailed error
      return jsonResponse({ 
        error: `Планът не премина качествен тест след ${correctionAttempts} опити за корекция: ${validation.errors.join('; ')}`,
        validationErrors: validation.errors,
        suggestion: "Моля, опитайте отново или свържете се с поддръжката"
      }, 400);
    }
    
    console.log('handleGeneratePlan: Plan validated successfully');
    
    // Remove internal justification fields before returning to client
    const cleanPlan = removeInternalJustifications(structuredPlan);
    
    return jsonResponse({ 
      success: true, 
      plan: cleanPlan,
      userId: userId,
      correctionAttempts: correctionAttempts // Inform client how many corrections were needed
    });
  } catch (error) {
    console.error('Error generating plan:', error);
    return jsonResponse({ error: `${ERROR_MESSAGES.PLAN_GENERATION_FAILED}: ${error.message}` }, 500);
  }
}

/**
 * Helper function to clean a response by removing REGENERATE_PLAN from a given index
 * Returns a fallback error message if the cleaned response is empty
 */
function cleanResponseFromRegenerate(aiResponse, regenerateIndex) {
  const cleanedResponse = aiResponse.substring(0, regenerateIndex).trim();
  return cleanedResponse || ERROR_MESSAGE_PARSE_FAILURE;
}

/**
 * Handle chat assistant requests
 * No longer uses KV storage - all context is provided by client
 */
async function handleChat(request, env) {
  try {
    const { message, userId, conversationId, mode, userData, userPlan, conversationHistory } = await request.json();
    
    if (!message) {
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_MESSAGE }, 400);
    }

    // Validate that required context is provided by client
    if (!userData || !userPlan) {
      return jsonResponse({ 
        error: ERROR_MESSAGES.MISSING_CONTEXT
      }, 400);
    }

    // Use conversation history from client (defaults to empty array)
    const chatHistory = conversationHistory || [];
    
    // Determine chat mode (default: consultation)
    const chatMode = mode || 'consultation';
    
    // Build chat prompt with context and mode
    const chatPrompt = await generateChatPrompt(env, message, userData, userPlan, chatHistory, chatMode);
    
    // Call AI model with standard token limit (no need for large JSONs with new regeneration approach)
    const aiResponse = await callAIModel(env, chatPrompt, 2000, 'chat_consultation', null, userData, null);
    
    // Check if the response contains a plan regeneration instruction
    const regenerateIndex = aiResponse.indexOf('[REGENERATE_PLAN:');
    let finalResponse = aiResponse;
    let planWasUpdated = false;
    let updatedPlan = null;
    let updatedUserData = null;
    
    if (regenerateIndex !== -1) {
      // Always parse and remove REGENERATE_PLAN from the response, regardless of mode
      try {
        // Find the JSON content between [REGENERATE_PLAN: and the matching closing ]
        const jsonStart = regenerateIndex + '[REGENERATE_PLAN:'.length;
        let jsonEnd = -1;
        let bracketCount = 0;
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        
        // Parse character by character to find where the JSON ends
        for (let i = jsonStart; i < aiResponse.length; i++) {
          const char = aiResponse[i];
          
          // Handle escape sequences in strings (e.g., \", \\)
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          // Track whether we're inside a string (to ignore brackets in string values)
          if (char === '"') {
            inString = !inString;
            continue;
          }
          
          // Only count brackets/braces outside of strings
          if (!inString) {
            if (char === '{') {
              braceCount++;
            } else if (char === '}') {
              braceCount--;
            } else if (char === '[') {
              bracketCount++;
            } else if (char === ']') {
              // If both counts are 0 before decrementing, this ] closes REGENERATE_PLAN
              if (braceCount === 0 && bracketCount === 0) {
                jsonEnd = i;
                break;
              }
              bracketCount--;
            }
          }
        }
        
        if (jsonEnd > jsonStart) {
          const jsonContent = aiResponse.substring(jsonStart, jsonEnd);
          
          // Remove the REGENERATE_PLAN instruction from the response
          const beforeRegenerate = aiResponse.substring(0, regenerateIndex);
          const afterRegenerate = aiResponse.substring(jsonEnd + 1);
          finalResponse = (beforeRegenerate + afterRegenerate).trim();
          
          // Only actually regenerate if we're in modification mode
          if (chatMode === 'modification') {
            console.log('REGENERATE_PLAN detected, regenerating plan with modifications');
            
            const regenerateData = JSON.parse(jsonContent);
            const modifications = regenerateData.modifications || [];
            
            // Apply modifications to user data and regenerate plan
            // Use Set to avoid duplicates when accumulating modifications
            const existingMods = new Set(userData.planModifications || []);
            const excludedFoods = new Set((userData.dietDislike || '').split(',').map(f => f.trim()).filter(f => f));
            
            // Enhancement #4: Validate food exclusions against current plan
            const validatedModifications = [];
            
            modifications.forEach(mod => {
              if (mod.startsWith('exclude_food:')) {
                // Extract food name from "exclude_food:име_на_храна"
                const foodName = mod.substring('exclude_food:'.length).trim();
                if (foodName) {
                  // Enhancement #4: Check if food exists in plan (case-insensitive)
                  const foodExistsInPlan = checkFoodExistsInPlan(userPlan, foodName);
                  
                  // Add to excluded foods regardless (as preference for future plan generations)
                  excludedFoods.add(foodName);
                  validatedModifications.push(mod);
                  
                  if (foodExistsInPlan) {
                    console.log('Adding food exclusion (found in current plan):', foodName);
                  } else {
                    console.log('Adding food exclusion (preference for future plans):', foodName);
                  }
                }
              } else {
                existingMods.add(mod);
                validatedModifications.push(mod);
              }
            });
            
            const modifiedUserData = {
              ...userData,
              planModifications: Array.from(existingMods),
              dietDislike: Array.from(excludedFoods).join(', ')
            };
            
            // Regenerate the plan using multi-step approach with new criteria
            // Return updated data to client - no server storage
            const newPlan = await generatePlanMultiStep(env, modifiedUserData);
            
            planWasUpdated = true;
            updatedPlan = newPlan;
            updatedUserData = modifiedUserData;
            
            console.log('Plan regenerated successfully with modifications:', validatedModifications);
          } else {
            console.log('REGENERATE_PLAN instruction removed from response (not in modification mode)');
          }
        } else {
          console.error('Could not find closing bracket for REGENERATE_PLAN');
          console.error('AI Response excerpt (last 500 chars):', aiResponse.substring(Math.max(0, aiResponse.length - 500)));
          finalResponse = cleanResponseFromRegenerate(aiResponse, regenerateIndex);
        }
      } catch (error) {
        console.error('Error processing plan regeneration:', error);
        console.error('Error details:', error.message);
        console.error('AI Response excerpt (last 500 chars):', aiResponse.substring(Math.max(0, aiResponse.length - 500)));
        finalResponse = cleanResponseFromRegenerate(aiResponse, regenerateIndex);
      }
    }
    
    // Build updated conversation history for client to store
    const updatedHistory = [...chatHistory];
    updatedHistory.push(
      { role: 'user', content: message },
      { role: 'assistant', content: finalResponse }
    );
    
    // Trim history to keep within token budget - keeping more history for better context
    const MAX_HISTORY_TOKENS = 2000;
    let totalTokens = 0;
    const trimmedHistory = [];
    
    // Process history in reverse to keep most recent messages
    for (let i = updatedHistory.length - 1; i >= 0; i--) {
      const msg = updatedHistory[i];
      const messageTokens = estimateTokens(msg.content);
      
      if (totalTokens + messageTokens <= MAX_HISTORY_TOKENS) {
        trimmedHistory.unshift(msg);
        totalTokens += messageTokens;
      } else {
        // Stop adding older messages
        break;
      }
    }
    
    console.log(`Conversation history trimmed to ${trimmedHistory.length} messages (~${totalTokens} tokens)`);
    
    const responseData = { 
      success: true, 
      response: finalResponse,
      conversationHistory: trimmedHistory,
      planUpdated: planWasUpdated
    };
    
    // Include updated plan and userData if plan was regenerated
    if (planWasUpdated) {
      responseData.updatedPlan = updatedPlan;
      responseData.updatedUserData = updatedUserData;
    }
    
    return jsonResponse(responseData);
  } catch (error) {
    console.error('Error in chat:', error);
    return jsonResponse({ error: `${ERROR_MESSAGES.CHAT_FAILED}: ${error.message}` }, 500);
  }
}

/**
 * Handle problem report submission
 */
async function handleReportProblem(request, env) {
  try {
    const { userId, userName, message, timestamp, userAgent } = await request.json();
    
    if (!message) {
      return jsonResponse({ error: 'Message is required' }, 400);
    }
    
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Generate a unique report ID
    const reportId = `report_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Create report object
    const report = {
      id: reportId,
      userId: userId || 'anonymous',
      userName: userName || 'Anonymous',
      message: message,
      timestamp: timestamp || new Date().toISOString(),
      userAgent: userAgent || 'unknown',
      status: 'unread'
    };
    
    // Store report in KV with reportId as key
    await env.page_content.put(`problem_report:${reportId}`, JSON.stringify(report));
    
    // Also maintain a list of all report IDs for easy retrieval
    let reportsList = await env.page_content.get('problem_reports_list');
    reportsList = reportsList ? JSON.parse(reportsList) : [];
    reportsList.unshift(reportId); // Add to beginning (most recent first)
    
    // Keep only last 100 reports in the list
    if (reportsList.length > 100) {
      reportsList = reportsList.slice(0, 100);
    }
    
    await env.page_content.put('problem_reports_list', JSON.stringify(reportsList));
    
    console.log('Problem report saved:', reportId);
    
    return jsonResponse({ 
      success: true, 
      reportId: reportId,
      message: 'Report submitted successfully'
    });
  } catch (error) {
    console.error('Error saving problem report:', error);
    return jsonResponse({ error: `Failed to save report: ${error.message}` }, 500);
  }
}

/**
 * Get all problem reports for admin panel
 */
async function handleGetReports(request, env) {
  try {
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get list of report IDs
    const reportsList = await env.page_content.get('problem_reports_list');
    if (!reportsList) {
      return jsonResponse({ success: true, reports: [] });
    }
    
    const reportIds = JSON.parse(reportsList);
    
    // Fetch all reports in parallel for better performance
    const reportPromises = reportIds.map(reportId => 
      env.page_content.get(`problem_report:${reportId}`)
    );
    
    const reportDataList = await Promise.all(reportPromises);
    const reports = reportDataList
      .filter(data => data !== null)
      .map(data => JSON.parse(data));
    
    return jsonResponse({ success: true, reports: reports }, 200, {
      cacheControl: 'public, max-age=120' // Cache for 2 minutes - reports can be somewhat dynamic
    });
  } catch (error) {
    console.error('Error getting problem reports:', error);
    return jsonResponse({ error: `Failed to get reports: ${error.message}` }, 500);
  }
}


/**
 * Multi-step plan generation for better individualization
 * 
 * This approach uses MULTIPLE AI requests for maximum precision and personalization:
 * Step 1: Analyze user profile and health status (holistic health analysis)
 * Step 2: Determine dietary strategy and restrictions (personalized strategy)
 * Step 3: Generate detailed meal plan (specific meals based on analysis + strategy)
 * 
 * Benefits of multi-step approach:
 * ✅ Better individualization - Each step builds on previous insights
 * ✅ More precise analysis - Dedicated AI focus per step
 * ✅ Higher quality output - Strategy informs meal generation
 * ✅ Deeper understanding - Correlations between health parameters
 * ✅ Can be extended - Additional steps can be added for more data/precision
 * 
 * Each step receives progressively more refined context:
 * - Step 1: Raw user data → Health analysis
 * - Step 2: User data + Analysis → Dietary strategy
 * - Step 3: User data + Analysis + Strategy → Complete meal plan
 */

// Token limits optimized through prompt simplification (not artificial limits)
const MEAL_PLAN_TOKEN_LIMIT = 8000; // Sufficient for detailed meal generation
const SUMMARY_TOKEN_LIMIT = 2000; // Lightweight summary generation

// Validation constants
const MIN_MEALS_PER_DAY = 1; // Minimum number of meals per day (1 for intermittent fasting strategies)
const MAX_MEALS_PER_DAY = 5; // Maximum number of meals per day (when there's clear reasoning and strategy)
const MIN_DAILY_CALORIES = 800; // Minimum acceptable daily calories
// Note: DAILY_CALORIE_TOLERANCE and MAX_LATE_SNACK_CALORIES moved earlier in file (line ~580) to be available in template strings
const MAX_CORRECTION_ATTEMPTS = 4; // Maximum number of AI correction attempts before failing (must be >= 0)
const CORRECTION_TOKEN_LIMIT = 8000; // Token limit for AI correction requests - must be high for detailed corrections
const MEAL_ORDER_MAP = { 'Закуска': 0, 'Обяд': 1, 'Следобедна закуска': 2, 'Вечеря': 3, 'Късна закуска': 4 }; // Chronological meal order
const ALLOWED_MEAL_TYPES = ['Закуска', 'Обяд', 'Следобедна закуска', 'Вечеря', 'Късна закуска']; // Valid meal types

// Low glycemic index foods allowed in late-night snacks (GI < 55)
const LOW_GI_FOODS = [
  'кисело мляко', 'кефир', 'ядки', 'бадеми', 'орехи', 'кашу', 'лешници',
  'ябълка', 'круша', 'ягоди', 'боровинки', 'малини', 'черници',
  'авокадо', 'краставица', 'домат', 'зелени листни зеленчуци',
  'хумус', 'тахан', 'семена', 'чиа', 'ленено семе', 'тиквени семки'
];

// ADLE v8 Universal Meal Constructor - Hard Rules and Constraints
// Based on meallogic.txt - slot-based constructor with strict validation
// This will be merged with dynamic blacklist from KV storage
const ADLE_V8_HARD_BANS = [
  'лук', 'onion', 'пуешко месо', 'turkey meat',
  'изкуствени подсладители', 'artificial sweeteners',
  'мед', 'захар', 'конфитюр', 'сиропи', 'honey', 'sugar', 'jam', 'syrups',
  'кетчуп', 'майонеза', 'BBQ сос', 'ketchup', 'mayonnaise', 'BBQ sauce',
  'гръцко кисело мляко', 'greek yogurt'
];

// Default whitelist - approved foods for admin panel
const DEFAULT_FOOD_WHITELIST = [
  'яйца', 'eggs',
  'пилешко', 'chicken',
  'говеждо', 'beef',
  'свинско', 'свинска', 'pork',
  'риба', 'fish', 'скумрия', 'тон', 'сьомга',
  'кисело мляко', 'yogurt',
  'извара', 'cottage cheese',
  'сирене', 'cheese',
  'боб', 'beans',
  'леща', 'lentils',
  'нахут', 'chickpeas',
  'грах', 'peas'
];

// Default blacklist - hard banned foods for admin panel
const DEFAULT_FOOD_BLACKLIST = [
  'лук', 'onion',
  'пуешко месо', 'turkey meat',
  'изкуствени подсладители', 'artificial sweeteners',
  'мед', 'захар', 'конфитюр', 'сиропи',
  'honey', 'sugar', 'jam', 'syrups',
  'кетчуп', 'майонеза', 'BBQ сос',
  'ketchup', 'mayonnaise', 'BBQ sauce',
  'гръцко кисело мляко', 'greek yogurt'
];

const ADLE_V8_RARE_ITEMS = ['пуешка шунка', 'turkey ham', 'бекон', 'bacon']; // ≤2 times/week

const ADLE_V8_HARD_RULES = {
  R1: 'Protein main = exactly 1. Secondary protein only if (breakfast AND eggs), 0-1.',
  R2: 'Vegetables = 1-2. Choose exactly ONE form: Salad OR Fresh side (not both). Potatoes ≠ vegetables.',
  R3: 'Energy = 0-1 (never 2).',
  R4: 'Dairy max = 1 per meal (yogurt OR cottage cheese OR cheese), including as sauce/dressing.',
  R5: 'Fat = 0-1. If nuts/seeds present → no olive oil/butter.',
  R6: 'Cheese rule: If cheese present → no olive oil/butter. Olives allowed with cheese.',
  R7: 'Bacon rule: If bacon present → Fat=0.',
  R8: 'Legumes-as-main (beans/lentils/chickpeas/peas stew): Energy=0 (no rice/potatoes/pasta/bulgur/oats). Bread may be optional: +1 slice wholegrain.',
  R9: 'Bread optional rule (outside Template C): Allowed only if Energy=0. Exception: with legumes-as-main (R8), bread may still be optional (1 slice). If any Energy item present → Bread=0.',
  R10: 'Peas as meat-side add-on: Peas are NOT energy, but they BLOCK the Energy slot → Energy=0. Bread may be optional (+1 slice) if carbs needed.',
  R11: 'Template C (sandwich): Only snack; legumes forbidden; no banned sauces/sweeteners.',
  R12: 'Outside-whitelist additions: Default=use whitelists only. Outside-whitelist ONLY if objectively required (MODE/medical/availability), mainstream/universal, available in Bulgaria. Add line: Reason: ...'
};

const ADLE_V8_SPECIAL_RULES = {
  PEAS_FISH_BAN: 'Peas + fish combination is strictly forbidden.',
  VEGETABLE_FORM_RULE: 'Choose exactly ONE vegetable form per meal: Salad (with dressing) OR Fresh side (sliced, no dressing). Never both.',
  DAIRY_INCLUDES_SAUCE: 'Dairy count includes yogurt/cheese used in sauces, dressings, or cooking.',
  OLIVES_NOT_FAT: 'Olives are salad add-on (NOT Fat slot). If olives present → do NOT add olive oil/butter.',
  CORN_NOT_ENERGY: 'Corn is NOT an energy source. Small corn only in salads as add-on.',
  TEMPLATE_C_RESTRICTION: 'Template C (sandwich) allowed ONLY for snacks, NOT for main meals.'
};

// ADLE v8 Whitelists - Allowed foods (from meallogic.txt)
const ADLE_V8_PROTEIN_WHITELIST = [
  'яйца', 'eggs', 'egg', 'яйце',
  'пилешко', 'chicken', 'пиле', 'пилешк',
  'говеждо', 'beef', 'говежд',
  'свинско', 'свинска', 'pork', 'свин',
  'риба', 'fish', 'скумрия', 'mackerel', 'тон', 'tuna', 'сьомга', 'salmon',
  'кисело мляко', 'yogurt', 'йогурт', 'кефир',
  'извара', 'cottage cheese', 'извар',
  'сирене', 'cheese', 'сирен',
  'боб', 'beans', 'бобови',
  'леща', 'lentils', 'лещ',
  'нахут', 'chickpeas', 'нахут',
  'грах', 'peas', 'гра'
];

// Proteins explicitly NOT on whitelist (should trigger warning)
// Using word stems to catch variations (e.g., заешко, заешки, заешка)
// SECURITY NOTE: These strings are static and pre-validated, not user input
const ADLE_V8_NON_WHITELIST_PROTEINS = [
  'заеш', 'rabbit', 'зайч',  // заешко, заешки, заешка
  'патиц', 'патешк', 'duck',  // патица, патешко, патешки
  'гъс', 'goose',  // гъска, гъсешко
  'агн', 'lamb',  // агне, агнешко, агнешки
  'дивеч', 'елен', 'deer', 'wild boar', 'глиган'
];

/**
 * Helper: Check if meal has "Reason:" justification for non-whitelist items
 */
function hasReasonJustification(meal) {
  return /reason:/i.test(meal.description || '') || /reason:/i.test(meal.name || '');
}

/**
 * Helper: Escape regex special characters in a string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Progressive generation: split meal plan into smaller chunks to avoid token limits
// Progressive generation configuration:
// - Splits 7-day plan into smaller chunks to avoid overloading single AI request
// - Each chunk maintains full data quality and precision
// - Smaller chunks = more requests but better load distribution
const ENABLE_PROGRESSIVE_GENERATION = true;
const DAYS_PER_CHUNK = 2; // Generate 2 days at a time (optimal: 4 chunks total for 7 days)
// Note: Can reduce to 1 day per chunk if needed for even better distribution (7 chunks total)

/**
 * REQUIREMENT 4: Validate plan against all parameters and check for contradictions
 * Returns { isValid: boolean, errors: string[] }
 */
function validatePlan(plan, userData) {
  const errors = [];
  const warnings = [];
  const stepErrors = {
    step1_analysis: [],
    step2_strategy: [],
    step3_mealplan: [],
    step4_final: []
  };
  
  // 1. Check for basic plan structure
  if (!plan || typeof plan !== 'object') {
    errors.push('План липсва или е в невалиден формат');
    stepErrors.step4_final.push('План липсва или е в невалиден формат');
    return { isValid: false, errors, stepErrors };
  }
  
  // 2. Check for required analysis (Step 1)
  if (!plan.analysis || !plan.analysis.keyProblems) {
    const error = 'Липсва задълбочен анализ';
    errors.push(error);
    stepErrors.step1_analysis.push(error);
  }
  
  // 3. Check for strategy (Step 2)
  if (!plan.strategy || !plan.strategy.dietaryModifier) {
    const error = 'Липсва диетична стратегия';
    errors.push(error);
    stepErrors.step2_strategy.push(error);
  }
  
  // 4. Check for week plan (Step 3)
  if (!plan.weekPlan) {
    const error = 'Липсва седмичен план';
    errors.push(error);
    stepErrors.step3_mealplan.push(error);
  } else {
    // Verify all 7 days exist
    const daysCount = Object.keys(plan.weekPlan).filter(key => key.startsWith('day')).length;
    if (daysCount < 7) {
      const error = `Липсват дни от седмицата (генерирани само ${daysCount} от 7)`;
      errors.push(error);
      stepErrors.step3_mealplan.push(error);
    }
    
    // Verify each day has meals
    for (let i = 1; i <= 7; i++) {
      const dayKey = `day${i}`;
      const day = plan.weekPlan[dayKey];
      if (!day || !day.meals || !Array.isArray(day.meals) || day.meals.length === 0) {
        const error = `Ден ${i} няма хранения`;
        errors.push(error);
        stepErrors.step3_mealplan.push(error);
      } else {
        // Check that each day has meals within acceptable range (1-5)
        if (day.meals.length < MIN_MEALS_PER_DAY || day.meals.length > MAX_MEALS_PER_DAY) {
          const error = `Ден ${i} има ${day.meals.length} хранения - трябва да е между ${MIN_MEALS_PER_DAY} и ${MAX_MEALS_PER_DAY}`;
          errors.push(error);
          stepErrors.step3_mealplan.push(error);
        }
        
        // Validate that meals have macros
        let mealsWithoutMacros = 0;
        day.meals.forEach((meal, mealIndex) => {
          if (!meal.macros || !meal.macros.protein || !meal.macros.carbs || !meal.macros.fats) {
            mealsWithoutMacros++;
          } else {
            // Validate macro accuracy: protein×4 + carbs×4 + fats×9 should ≈ calories
            const calculatedCalories = 
              (parseInt(meal.macros.protein) || 0) * 4 + 
              (parseInt(meal.macros.carbs) || 0) * 4 + 
              (parseInt(meal.macros.fats) || 0) * 9;
            const declaredCalories = parseInt(meal.calories) || 0;
            const difference = Math.abs(calculatedCalories - declaredCalories);
            
            // Allow 10% tolerance or minimum 50 kcal difference
            const tolerance = Math.max(50, declaredCalories * 0.1);
            if (difference > tolerance && declaredCalories > 0) {
              warnings.push(`Ден ${i}, хранене ${mealIndex + 1} (${meal.type}): Макросите не съвпадат с калориите. Изчислени: ${calculatedCalories} kcal, Декларирани: ${declaredCalories} kcal (разлика: ${difference} kcal)`);
            }
            
            // Validate portion sizes (weight field)
            if (meal.weight) {
              // Extract weight in grams, handling decimals and multiple servings
              const weightMatch = meal.weight.match(/(\d+(?:\.\d+)?)\s*g/);
              if (weightMatch) {
                const weightGrams = parseFloat(weightMatch[1]);
                if (weightGrams < 50) {
                  warnings.push(`Ден ${i}, хранене ${mealIndex + 1} (${meal.type}): Много малка порция (${weightGrams}g) - проверете дали е реалистична`);
                } else if (weightGrams > 800) {
                  warnings.push(`Ден ${i}, хранене ${mealIndex + 1} (${meal.type}): Много голяма порция (${weightGrams}g) - проверете дали е реалистична`);
                }
              }
            }
          }
        });
        if (mealsWithoutMacros > 0) {
          const error = `Ден ${i} има ${mealsWithoutMacros} хранения без макронутриенти`;
          errors.push(error);
          stepErrors.step3_mealplan.push(error);
        }
        
        // Validate daily calorie totals
        const dayCalories = day.meals.reduce((sum, meal) => sum + (parseInt(meal.calories) || 0), 0);
        if (dayCalories < MIN_DAILY_CALORIES) {
          const error = `Ден ${i} има само ${dayCalories} калории - твърде малко`;
          errors.push(error);
          stepErrors.step3_mealplan.push(error);
        }
        
        // Validate meal ordering (UPDATED: allow meals after dinner when justified by strategy)
        const mealTypes = day.meals.map(meal => meal.type);
        const dinnerIndex = mealTypes.findIndex(type => type === 'Вечеря');
        
        if (dinnerIndex !== -1 && dinnerIndex !== mealTypes.length - 1) {
          // Dinner exists but is not the last meal - check if there's justification
          const mealsAfterDinner = day.meals.slice(dinnerIndex + 1);
          const mealsAfterDinnerTypes = mealsAfterDinner.map(m => m.type);
          
          // Check if strategy provides specific justification for meals after dinner
          const hasAfterDinnerJustification = plan.strategy && 
                                               plan.strategy.afterDinnerMealJustification && 
                                               plan.strategy.afterDinnerMealJustification !== 'Не са необходими';
          
          // Allow meals after dinner if there's clear justification in strategy
          // Otherwise, require it to be a late-night snack with appropriate properties
          if (!hasAfterDinnerJustification) {
            // No justification - apply strict rules for late-night snack only
            if (mealsAfterDinner.length > 1 || 
                (mealsAfterDinner.length === 1 && mealsAfterDinnerTypes[0] !== 'Късна закуска')) {
              const error = `Ден ${i}: Има хранения след вечеря (${mealsAfterDinnerTypes.join(', ')}) без обосновка в strategy.afterDinnerMealJustification. Моля, добави обосновка или премахни храненията след вечеря.`;
              errors.push(error);
              stepErrors.step2_strategy.push(error); // This is a strategy issue
            } else if (mealsAfterDinner.length === 1 && mealsAfterDinnerTypes[0] === 'Късна закуска') {
              // Validate that late-night snack contains low GI foods
              const lateSnack = mealsAfterDinner[0];
              const snackDescription = (lateSnack.description || '').toLowerCase();
              const snackName = (lateSnack.name || '').toLowerCase();
              const snackText = snackDescription + ' ' + snackName;
              
              const hasLowGIFood = LOW_GI_FOODS.some(food => snackText.includes(food));
              
              if (!hasLowGIFood) {
                const error = `Ден ${i}: Късната закуска трябва да съдържа храни с нисък гликемичен индекс (${LOW_GI_FOODS.slice(0, 5).join(', ')}, и др.) или да има ясна обосновка в strategy.afterDinnerMealJustification`;
                errors.push(error);
                stepErrors.step3_mealplan.push(error);
              }
              
              // Validate that late-night snack is not too high in calories (warning only if no justification)
              const snackCalories = parseInt(lateSnack.calories) || 0;
              if (snackCalories > MAX_LATE_SNACK_CALORIES) {
                console.log(`Warning Ден ${i}: Късната закуска има ${snackCalories} калории - препоръчват се максимум ${MAX_LATE_SNACK_CALORIES} калории при липса на обосновка`);
              }
            }
          }
          // If there IS afterDinnerMealJustification, we allow meals after dinner without strict validation
        }
        
        // Check for invalid meal types
        day.meals.forEach((meal, idx) => {
          if (!ALLOWED_MEAL_TYPES.includes(meal.type)) {
            const error = `Ден ${i}, хранене ${idx + 1}: Невалиден тип "${meal.type}" - разрешени са само: ${ALLOWED_MEAL_TYPES.join(', ')}`;
            errors.push(error);
            stepErrors.step3_mealplan.push(error);
          }
        });
        
        // Check chronological order
        let lastValidIndex = -1;
        day.meals.forEach((meal, idx) => {
          const currentIndex = MEAL_ORDER_MAP[meal.type];
          if (currentIndex !== undefined) {
            if (currentIndex < lastValidIndex) {
              const error = `Ден ${i}: Неправилен хронологичен ред - "${meal.type}" след по-късно хранене`;
              errors.push(error);
              stepErrors.step3_mealplan.push(error);
            }
            lastValidIndex = currentIndex;
          }
        });
        
        // Check for multiple afternoon snacks
        const afternoonSnackCount = mealTypes.filter(type => type === 'Следобедна закуска').length;
        if (afternoonSnackCount > 1) {
          const error = `Ден ${i}: Повече от 1 следобедна закуска (${afternoonSnackCount}) - разрешена е максимум 1`;
          errors.push(error);
          stepErrors.step3_mealplan.push(error);
        }
        
        // Check for multiple late-night snacks
        const lateNightSnackCount = mealTypes.filter(type => type === 'Късна закуска').length;
        if (lateNightSnackCount > 1) {
          const error = `Ден ${i}: Повече от 1 късна закуска (${lateNightSnackCount}) - разрешена е максимум 1`;
          errors.push(error);
          stepErrors.step3_mealplan.push(error);
        }
      }
    }
  }
  
  // 5. Check for required recommendations (Step 4 - Final validation)
  if (!plan.recommendations || !Array.isArray(plan.recommendations) || plan.recommendations.length < 3) {
    const error = 'Липсват препоръчителни храни';
    errors.push(error);
    stepErrors.step4_final.push(error);
  }
  
  // 6. Check for forbidden foods (Step 4 - Final validation)
  if (!plan.forbidden || !Array.isArray(plan.forbidden) || plan.forbidden.length < 3) {
    const error = 'Липсват забранени храни';
    errors.push(error);
    stepErrors.step4_final.push(error);
  }
  
  // 7. Check for goal-plan alignment (Step 2 - Strategy issue)
  if (userData.goal === 'Отслабване' && plan.summary && plan.summary.dailyCalories) {
    // Extract numeric calories
    const caloriesMatch = String(plan.summary.dailyCalories).match(/\d+/);
    if (caloriesMatch) {
      const calories = parseInt(caloriesMatch[0]);
      // For weight loss, calories should be reasonable (not too high)
      if (calories > 3000) {
        const error = 'Калориите са твърде високи за цел отслабване';
        errors.push(error);
        stepErrors.step2_strategy.push(error);
      }
    }
  }
  
  // 8. Check for medical conditions alignment (Step 2 - Strategy issue)
  if (userData.medicalConditions && Array.isArray(userData.medicalConditions)) {
    // Check for diabetes + high carb plan
    if (userData.medicalConditions.includes('Диабет')) {
      const modifier = plan.strategy?.dietaryModifier || '';
      if (modifier.toLowerCase().includes('високовъглехидратно')) {
        const error = 'Планът съдържа високовъглехидратна диета, неподходяща при диабет';
        errors.push(error);
        stepErrors.step2_strategy.push(error);
      }
    }
    
    // Check for IBS/IBD + raw fiber heavy plan
    if (userData.medicalConditions.includes('IBS') || userData.medicalConditions.includes('IBD')) {
      const modifier = plan.strategy?.dietaryModifier || '';
      if (!modifier.toLowerCase().includes('щадящ')) {
        // Warning, but not fatal error
        console.log('Warning: IBS/IBD detected but plan may not be gentle enough');
      }
    }
    
    // Check for PCOS + high carb plan
    if (userData.medicalConditions.includes('PCOS') || userData.medicalConditions.includes('СПКЯ')) {
      const modifier = plan.strategy?.dietaryModifier || '';
      if (modifier.toLowerCase().includes('високовъглехидратно') || modifier.toLowerCase().includes('балансирано')) {
        console.log('Warning: PCOS detected - should prefer lower carb approach');
      }
    }
    
    // Check for anemia + vegetarian diet without iron supplementation (Step 4 - Final validation)
    if (userData.medicalConditions.includes('Анемия') && 
        userData.dietPreference && 
        (userData.dietPreference.includes('Вегетарианска') || userData.dietPreference.includes('Веган'))) {
      const supplements = plan.supplements || [];
      const hasIronSupplement = supplements.some(s => /желязо|iron/i.test(s));
      if (!hasIronSupplement) {
        const error = 'При анемия и вегетарианска/веган диета е задължителна добавка с желязо';
        errors.push(error);
        stepErrors.step4_final.push(error);
      }
    }
  }
  
  // 8a. Check for medication-supplement interactions (Step 4 - Final validation)
  if (userData.medications === 'Да' && userData.medicationsDetails && plan.supplements) {
    const medications = userData.medicationsDetails.toLowerCase();
    const supplements = plan.supplements.join(' ').toLowerCase();
    
    // Check for dangerous interactions
    if (medications.includes('варфарин') && supplements.includes('витамин к')) {
      const error = 'ОПАСНО: Витамин K взаимодейства с варфарин (антикоагулант) - може да намали ефективността';
      errors.push(error);
      stepErrors.step4_final.push(error);
    }
    
    if ((medications.includes('антибиотик') || medications.includes('антибиотици')) && 
        (supplements.includes('калций') || supplements.includes('магнезий'))) {
      console.log('Warning: Калций/Магнезий може да намали усвояването на антибиотици - трябва да се вземат на различно време');
    }
    
    if (medications.includes('антацид') && supplements.includes('желязо')) {
      console.log('Warning: Антацидите блокират усвояването на желязо - трябва да се вземат на различно време');
    }
  }
  
  // 9. Check for dietary preferences alignment (Step 4 - Final validation)
  if (userData.dietPreference && Array.isArray(userData.dietPreference)) {
    if (userData.dietPreference.includes('Вегетарианска') || userData.dietPreference.includes('Веган')) {
      // Check if plan contains meat (would be in forbidden)
      if (plan.recommendations && Array.isArray(plan.recommendations)) {
        const containsMeat = plan.recommendations.some(item => 
          /месо|пиле|риба|говеждо|свинско/i.test(item)
        );
        if (containsMeat && userData.dietPreference.includes('Веган')) {
          const error = 'Планът съдържа животински продукти, неподходящи за веган диета';
          errors.push(error);
          stepErrors.step4_final.push(error);
        }
      }
    }
  }
  
  // 10. Check for food repetition across days (Step 3 - Meal plan issue)
  // SIMPLIFIED REPETITION METRIC: Максимум 5 повтарящи се ястия в седмичния план
  if (plan.weekPlan) {
    const mealNames = new Set();
    const repeatedMeals = new Set();
    
    Object.keys(plan.weekPlan).forEach(dayKey => {
      const day = plan.weekPlan[dayKey];
      if (day && day.meals && Array.isArray(day.meals)) {
        day.meals.forEach(meal => {
          if (meal.name) {
            // Normalize meal name (lowercase, remove extra spaces)
            const normalizedName = meal.name.toLowerCase().trim().replace(/\s+/g, ' ');
            if (mealNames.has(normalizedName)) {
              repeatedMeals.add(normalizedName);
            }
            mealNames.add(normalizedName);
          }
        });
      }
    });
    
    // SIMPLIFIED RULE (Issue #11): Максимум 5 повтарящи се ястия
    if (repeatedMeals.size > 5) {
      warnings.push(`Планът съдържа твърде много повтарящи се ястия (${repeatedMeals.size} > 5). За разнообразие, ограничи повторенията до 5 ястия максимум. Повтарящи се: ${Array.from(repeatedMeals).slice(0, 5).join(', ')}`);
    }
  }
  
  // 11. Check for plan justification (Step 2 - Strategy issue)
  if (!plan.strategy || !plan.strategy.planJustification || plan.strategy.planJustification.length < 100) {
    const error = 'Липсва детайлна обосновка защо планът е индивидуален (минимум 100 символа)';
    errors.push(error);
    stepErrors.step2_strategy.push(error);
  }
  
  // 11a. Check for welcome message (Step 2 - Strategy issue)
  if (!plan.strategy || !plan.strategy.welcomeMessage || plan.strategy.welcomeMessage.length < 100) {
    const error = 'Липсва персонализирано приветствие за клиента (strategy.welcomeMessage, минимум 100 символа)';
    errors.push(error);
    stepErrors.step2_strategy.push(error);
  }
  
  // 10a. Check for meal count justification (Step 2 - Strategy issue)
  if (!plan.strategy || !plan.strategy.mealCountJustification || plan.strategy.mealCountJustification.length < 20) {
    const error = 'Липсва обосновка за избора на брой хранения (strategy.mealCountJustification)';
    errors.push(error);
    stepErrors.step2_strategy.push(error);
  }
  
  // 11. Check that analysis doesn't contain "Normal" severity problems (Step 1 - Analysis issue)
  if (plan.analysis && plan.analysis.keyProblems && Array.isArray(plan.analysis.keyProblems)) {
    const normalProblems = plan.analysis.keyProblems.filter(p => p.severity === 'Normal');
    if (normalProblems.length > 0) {
      const error = `Анализът съдържа ${normalProblems.length} "Normal" проблеми, които не трябва да се показват`;
      errors.push(error);
      stepErrors.step1_analysis.push(error);
    }
  }
  
  // 12. Check for ADLE v8 hard bans in meal descriptions (Step 3 - Meal plan issue)
  if (plan.weekPlan) {
    Object.keys(plan.weekPlan).forEach(dayKey => {
      const day = plan.weekPlan[dayKey];
      if (day && day.meals && Array.isArray(day.meals)) {
        day.meals.forEach((meal, mealIndex) => {
          const mealText = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();
          
          // Check for hard bans (onion, turkey meat, artificial sweeteners, honey/sugar, ketchup/mayo)
          if (/\b(лук|onion)\b/.test(mealText)) {
            const error = `Ден ${dayKey}, хранене ${mealIndex + 1}: Съдържа ЛУК (hard ban от ADLE v8)`;
            errors.push(error);
            stepErrors.step3_mealplan.push(error);
          }
          // Check for turkey meat but not turkey ham
          if (/\bпуешко\b(?!\s*шунка)/.test(mealText) || /\bturkey\s+meat\b/.test(mealText)) {
            const error = `Ден ${dayKey}, хранене ${mealIndex + 1}: Съдържа ПУЕШКО МЕСО (hard ban от ADLE v8)`;
            errors.push(error);
            stepErrors.step3_mealplan.push(error);
          }
          // Check for Greek yogurt (blacklisted)
          if (/\bгръцко\s+кисело\s+мляко\b/.test(mealText) || /\bgreek\s+yogurt\b/.test(mealText)) {
            const error = `Ден ${dayKey}, хранене ${mealIndex + 1}: Съдържа ГРЪЦКО КИСЕЛО МЛЯКО (в черния списък - използвай само обикновено кисело мляко)`;
            errors.push(error);
            stepErrors.step3_mealplan.push(error);
          }
          // Check for honey/sugar/syrup in specific contexts (as ingredients, not in compound words)
          if (/\b(мед|захар|сироп)\b(?=\s|,|\.|\))/.test(mealText) && !/медицин|междин|сиропен/.test(mealText)) {
            warnings.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: Може да съдържа МЕД/ЗАХАР/СИРОП (hard ban от ADLE v8) - проверете`);
          }
          if (/\b(кетчуп|майонеза|ketchup|mayonnaise)\b/.test(mealText)) {
            const error = `Ден ${dayKey}, хранене ${mealIndex + 1}: Съдържа КЕТЧУП/МАЙОНЕЗА (hard ban от ADLE v8)`;
            errors.push(error);
            stepErrors.step3_mealplan.push(error);
          }
          
          // Check for peas + fish forbidden combination
          if (/\b(грах|peas)\b/.test(mealText) && /\b(риба|fish)\b/.test(mealText)) {
            const error = `Ден ${dayKey}, хранене ${mealIndex + 1}: ГРАХ + РИБА забранена комбинация (ADLE v8 R0)`;
            errors.push(error);
            stepErrors.step3_mealplan.push(error);
          }
          
          // Check for non-whitelist proteins (R12 enforcement)
          let foundNonWhitelistProtein = false;
          for (const protein of ADLE_V8_NON_WHITELIST_PROTEINS) {
            // Use flexible matching for Cyrillic - check if pattern exists without being part of another word
            // For Bulgarian words, match at word start (e.g., "заеш" matches "заешко", "заешки")
            // SECURITY: Escape regex special chars to prevent ReDoS attacks
            const escapedProtein = escapeRegex(protein);
            const regex = new RegExp(`(^|[^а-яa-z])${escapedProtein}`, 'i');
            const match = mealText.match(regex);
            
            if (match) {
              // Extract the actual matched word from meal text for better error messages
              const matchedWordRegex = new RegExp(`${escapedProtein}[а-яa-z]*`, 'i');
              const actualWord = mealText.match(matchedWordRegex)?.[0] || protein;
              
              if (!hasReasonJustification(meal)) {
                const error = `Ден ${dayKey}, хранене ${mealIndex + 1}: Съдържа "${actualWord.toUpperCase()}" което НЕ е в whitelist (ADLE v8 R12). Изисква се Reason: ... ако е обективно необходимо.`;
                errors.push(error);
                stepErrors.step3_mealplan.push(error);
                foundNonWhitelistProtein = true;
              } else {
                warnings.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: Съдържа "${actualWord}" с обосновка - проверете дали е валидна`);
              }
            }
          }
        });
      }
    });
  }
  
  // Determine which step to restart from (earliest step with errors)
  let earliestErrorStep = null;
  if (stepErrors.step1_analysis.length > 0) {
    earliestErrorStep = 'step1_analysis';
  } else if (stepErrors.step2_strategy.length > 0) {
    earliestErrorStep = 'step2_strategy';
  } else if (stepErrors.step3_mealplan.length > 0) {
    earliestErrorStep = 'step3_mealplan';
  } else if (stepErrors.step4_final.length > 0) {
    earliestErrorStep = 'step4_final';
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stepErrors,
    earliestErrorStep
  };
}

/**
 * Helper: Validate ADLE v8 specific rules for a single meal
 * This provides hints about rule violations but doesn't fail validation
 * (AI instructions are primary enforcement mechanism)
 */
function checkADLEv8Rules(meal) {
  const warnings = [];
  const mealText = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();
  
  // R2: Check for both salad AND fresh side (should be ONE form)
  const hasSalad = /\b(салата|салатка|salad)\b/.test(mealText);
  const hasFresh = /\b(пресн|fresh|нарязан)\b/.test(mealText) && /\b(домати|краставици|чушки)\b/.test(mealText);
  if (hasSalad && hasFresh) {
    warnings.push('Възможно нарушение на R2: Салата И Пресни зеленчуци (трябва ЕДНА форма)');
  }
  
  // R8: Legumes as main should not have energy sources
  const hasLegumes = /\b(боб|леща|нахут|грах|beans|lentils|chickpeas)\b/.test(mealText);
  const hasEnergy = /\b(ориз|картофи|паста|овес|булгур|rice|potatoes|pasta|oats|bulgur)\b/.test(mealText);
  if (hasLegumes && hasEnergy) {
    warnings.push('Възможно нарушение на R8: Бобови + Енергия (бобовите като основно трябва Energy=0)');
  }
  
  return warnings;
}

/**
 * Generate correction prompt for AI when plan validation fails
 * This allows the AI to fix specific issues instead of regenerating from scratch
 * 
 * @param {Object} plan - The generated plan that failed validation
 * @param {string[]} validationErrors - Array of specific validation error messages
 * @param {Object} userData - User profile data for context
 * @returns {Promise<string>} Prompt instructing AI to correct specific errors in the plan
 */
async function generateCorrectionPrompt(plan, validationErrors, userData, env) {
  // Check if there's a custom prompt in KV storage
  const customPrompt = await getCustomPrompt(env, 'admin_correction_prompt');
  
  // If custom prompt exists, use it with variable replacement
  if (customPrompt) {
    let prompt = replacePromptVariables(customPrompt, {
      validationErrors: validationErrors,
      plan: plan,
      userData: userData,
      errorsFormatted: validationErrors.map((error, idx) => `${idx + 1}. ${error}`).join('\n'),
      planJSON: JSON.stringify(plan, null, 2),
      userDataJSON: JSON.stringify({
        name: userData.name,
        age: userData.age,
        gender: userData.gender,
        goal: userData.goal,
        medicalConditions: userData.medicalConditions,
        dietPreference: userData.dietPreference,
        dietDislike: userData.dietDislike,
        dietLove: userData.dietLove
      }, null, 2),
      MEAL_NAME_FORMAT_INSTRUCTIONS: MEAL_NAME_FORMAT_INSTRUCTIONS,
      MIN_DAILY_CALORIES: MIN_DAILY_CALORIES
    });
    
    // CRITICAL: Ensure JSON format instructions are included even with custom prompts
    if (!hasJsonFormatInstructions(prompt)) {
      prompt += `

═══ КРИТИЧНО ВАЖНО - ФОРМАТ НА ОТГОВОР ═══
Отговори САМО с валиден JSON обект - ПЪЛНИЯ КОРИГИРАН план БЕЗ допълнителни обяснения или текст преди или след JSON.

ВАЖНО: Върни САМО JSON без други текст или обяснения!`;
    }
    return prompt;
  }
  
  return `Ти си експертен диетолог и трябва да КОРИГИРАШ хранителен план, който има следните проблеми:

═══ ГРЕШКИ ЗА КОРИГИРАНЕ ═══
${validationErrors.map((error, idx) => `${idx + 1}. ${error}`).join('\n')}

═══ ТЕКУЩ ПЛАН (С ГРЕШКИ) ═══
${JSON.stringify(plan, null, 2)}

═══ КЛИЕНТСКИ ДАННИ ═══
${JSON.stringify({
  name: userData.name,
  age: userData.age,
  gender: userData.gender,
  goal: userData.goal,
  medicalConditions: userData.medicalConditions,
  dietPreference: userData.dietPreference,
  dietDislike: userData.dietDislike,
  dietLove: userData.dietLove,
  additionalNotes: userData.additionalNotes
}, null, 2)}

${userData.additionalNotes ? `
═══ 🔥 КРИТИЧНО ВАЖНА ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ 🔥 ═══
⚠️ МАКСИМАЛЕН ПРИОРИТЕТ при корекциите!

ДОПЪЛНИТЕЛНИ БЕЛЕЖКИ ОТ ${userData.name}:
${userData.additionalNotes}

⚠️ ЗАДЪЛЖИТЕЛНО: Всички корекции трябва да уважават тази информация!
═══════════════════════════════════════════════════════════════
` : ''}

═══ ПРАВИЛА ЗА КОРИГИРАНЕ ═══

${MEAL_NAME_FORMAT_INSTRUCTIONS}

ВАЖНО - СТРАТЕГИЯ И ОБОСНОВКА:
1. ВСЯКА корекция ТРЯБВА да бъде обоснована
2. Ако добавяш/променяш хранения, обясни ЗАЩО в strategy.planJustification
3. Ако добавяш хранения след вечеря, обясни причината в strategy.afterDinnerMealJustification
4. Ако променяш броя хранения, обясни в strategy.mealCountJustification
5. При многодневно планиране, обясни подхода в strategy.longTermStrategy

ТИПОВЕ ХРАНЕНИЯ И РЕД:
1. ПОЗВОЛЕНИ ТИПОВЕ ХРАНЕНИЯ (в хронологичен ред):
   - "Закуска" (сутрин)
   - "Обяд" (обед)
   - "Следобедна закуска" (опционално, след обяд)
   - "Вечеря" (вечер)
   - "Късна закуска" (опционално, след вечеря - С ОБОСНОВКА!)

2. БРОЙ ХРАНЕНИЯ: 1-5 на ден
   - ЗАДЪЛЖИТЕЛНО обоснови избора в strategy.mealCountJustification

3. ХРАНЕНИЯ СЛЕД ВЕЧЕРЯ - разрешени С ОБОСНОВКА:
   - Физиологична причина (диабет, дълъг период до сън, проблеми със съня)
   - Психологическа причина (управление на стрес)
   - Стратегическа причина (спортни тренировки вечер, работа на смени)
   - ДОБАВИ обосновката в strategy.afterDinnerMealJustification!
   - Предпочитай ниско-гликемични храни (кисело мляко, ядки, ягоди, семена)

4. МНОГОДНЕВЕН ХОРИЗОНТ:
   - Може да планираш 2-3 дни като цяло при обоснована стратегия
   - Циклично разпределение на калории/макроси е позволено
   - ОБЯСНИ в strategy.longTermStrategy

5. МЕДИЦИНСКИ ИЗИСКВАНИЯ:
   - При диабет: НЕ високовъглехидратни храни
   - При анемия + вегетарианство: добавка с желязо ЗАДЪЛЖИТЕЛНА
   - При PCOS/СПКЯ: предпочитай нисковъглехидратни варианти
   - Спазвай: ${JSON.stringify(userData.medicalConditions || [])}

6. КАЛОРИИ И МАКРОСИ:
   - Всяко хранене ТРЯБВА да има "calories", "macros" (protein, carbs, fats, fiber)
   - Дневни калории минимум ${MIN_DAILY_CALORIES} kcal (може да варират между дни)
   - Прецизни изчисления: 1г протеин=4kcal, 1г въглехидрати=4kcal, 1г мазнини=9kcal

7. СТРУКТУРА:
   - Всички 7 дни (day1-day7) ЗАДЪЛЖИТЕЛНО
   - 1-5 хранения на ден (ОБОСНОВАНИ в strategy)
   - Избягвай: ${userData.dietDislike || 'няма'}
   - Включвай: ${userData.dietLove || 'няма'}

═══ ТВОЯТА ЗАДАЧА ═══
Коригирай проблемните части и ДОБАВИ ОБОСНОВКИ в strategy полетата:
- strategy.planJustification - обща обосновка на плана
- strategy.mealCountJustification - защо този брой хранения
- strategy.afterDinnerMealJustification - защо хранения след вечеря (ако има)
- strategy.longTermStrategy - многодневна стратегия (ако има)

Върни ПЪЛНИЯ КОРИГИРАН план в същия JSON формат като оригиналния.

ВАЖНО: Върни САМО JSON без допълнителни обяснения!`;
}

/**
 * Regenerate from a specific step with targeted error prevention
 * This allows the system to restart from the earliest error step instead of full regeneration
 */
async function regenerateFromStep(env, data, existingPlan, earliestErrorStep, stepErrors, correctionAttempt) {
  console.log(`Regenerating from ${earliestErrorStep}, attempt ${correctionAttempt}`);
  
  // Generate a unique session ID for this regeneration
  const sessionId = generateUniqueId('regen');
  console.log(`Regeneration session ID: ${sessionId}`);
  
  // Create high-priority error prevention comment for the step
  const errorPreventionComment = generateErrorPreventionComment(stepErrors[earliestErrorStep], earliestErrorStep, correctionAttempt);
  
  // Token tracking
  let cumulativeTokens = {
    input: 0,
    output: 0,
    total: 0
  };
  
  let analysis, strategy, mealPlan;
  
  try {
    // Step 1: Analysis (regenerate if this step has errors, otherwise reuse)
    if (earliestErrorStep === 'step1_analysis') {
      console.log('Regenerating Step 1 (Analysis) with error prevention');
      const analysisPrompt = await generateAnalysisPrompt(data, env, errorPreventionComment);
      const analysisInputTokens = estimateTokenCount(analysisPrompt);
      cumulativeTokens.input += analysisInputTokens;
      
      const analysisResponse = await callAIModel(env, analysisPrompt, 4000, 'step1_analysis_regen', sessionId, data, null);
      const analysisOutputTokens = estimateTokenCount(analysisResponse);
      cumulativeTokens.output += analysisOutputTokens;
      cumulativeTokens.total = cumulativeTokens.input + cumulativeTokens.output;
      
      analysis = parseAIResponse(analysisResponse);
      
      if (!analysis || analysis.error) {
        throw new Error(`Регенерацията на анализа се провали: ${analysis?.error || 'Невалиден формат'}`);
      }
      
      // Filter out "Normal" severity problems
      if (analysis.keyProblems && Array.isArray(analysis.keyProblems)) {
        analysis.keyProblems = analysis.keyProblems.filter(problem => problem.severity !== 'Normal');
      }
    } else {
      // Reuse existing analysis
      analysis = existingPlan.analysis;
      console.log('Reusing existing analysis');
    }
    
    // Step 2: Strategy (regenerate if this or earlier step has errors)
    if (earliestErrorStep === 'step1_analysis' || earliestErrorStep === 'step2_strategy') {
      const stepErrorComment = earliestErrorStep === 'step2_strategy' ? errorPreventionComment : null;
      console.log(`Regenerating Step 2 (Strategy)${stepErrorComment ? ' with error prevention' : ''}`);
      
      const strategyPrompt = await generateStrategyPrompt(data, analysis, env, stepErrorComment);
      const strategyInputTokens = estimateTokenCount(strategyPrompt);
      cumulativeTokens.input += strategyInputTokens;
      
      const strategyResponse = await callAIModel(env, strategyPrompt, 4000, 'step2_strategy_regen', sessionId, data, analysis);
      const strategyOutputTokens = estimateTokenCount(strategyResponse);
      cumulativeTokens.output += strategyOutputTokens;
      cumulativeTokens.total = cumulativeTokens.input + cumulativeTokens.output;
      
      strategy = parseAIResponse(strategyResponse);
      
      if (!strategy || strategy.error) {
        throw new Error(`Регенерацията на стратегията се провали: ${strategy?.error || 'Невалиден формат'}`);
      }
    } else {
      // Reuse existing strategy
      strategy = existingPlan.strategy;
      console.log('Reusing existing strategy');
    }
    
    // Step 3: Meal Plan (regenerate if any earlier step has errors or this step has errors)
    if (earliestErrorStep === 'step1_analysis' || earliestErrorStep === 'step2_strategy' || earliestErrorStep === 'step3_mealplan') {
      const stepErrorComment = earliestErrorStep === 'step3_mealplan' ? errorPreventionComment : null;
      console.log(`Regenerating Step 3 (Meal Plan)${stepErrorComment ? ' with error prevention' : ''}`);
      
      if (ENABLE_PROGRESSIVE_GENERATION) {
        mealPlan = await generateMealPlanProgressive(env, data, analysis, strategy, stepErrorComment, sessionId);
      } else {
        const mealPlanPrompt = await generateMealPlanPrompt(data, analysis, strategy, env, stepErrorComment);
        const mealPlanResponse = await callAIModel(env, mealPlanPrompt, MEAL_PLAN_TOKEN_LIMIT, 'step3_meal_plan_regen', sessionId, data, analysis);
        mealPlan = parseAIResponse(mealPlanResponse);
        
        if (!mealPlan || mealPlan.error) {
          throw new Error(`Регенерацията на хранителния план се провали: ${mealPlan?.error || 'Невалиден формат'}`);
        }
      }
    } else {
      // Reuse existing meal plan parts
      mealPlan = {
        weekPlan: existingPlan.weekPlan,
        summary: existingPlan.summary,
        recommendations: existingPlan.recommendations,
        forbidden: existingPlan.forbidden,
        psychology: existingPlan.psychology,
        waterIntake: existingPlan.waterIntake,
        supplements: existingPlan.supplements
      };
      console.log('Reusing existing meal plan');
    }
    
    // Combine all parts into final plan
    return {
      ...mealPlan,
      analysis: analysis,
      strategy: strategy,
      _meta: {
        tokenUsage: cumulativeTokens,
        regeneratedFrom: earliestErrorStep,
        correctionAttempt: correctionAttempt,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error(`Regeneration from ${earliestErrorStep} failed:`, error);
    throw new Error(`Регенерацията от ${earliestErrorStep} се провали: ${error.message}`);
  }
}

/**
 * Generate high-priority error prevention comment for a specific step
 */
function generateErrorPreventionComment(errors, stepName, attemptNumber) {
  if (!errors || errors.length === 0) {
    return null;
  }
  
  const stepNames = {
    'step1_analysis': 'АНАЛИЗ',
    'step2_strategy': 'СТРАТЕГИЯ',
    'step3_mealplan': 'ХРАНИТЕЛЕН ПЛАН',
    'step4_final': 'ФИНАЛНА ВАЛИДАЦИЯ'
  };
  
  const displayName = stepNames[stepName] || stepName;
  
  return `
═══ 🚨 КРИТИЧНО: ПРЕДОТВРАТЯВАНЕ НА ГРЕШКИ - ОПИТ ${attemptNumber} 🚨 ═══
⚠️ МАКСИМАЛЕН ПРИОРИТЕТ: При предишния опит бяха открити следните грешки в стъпка "${displayName}":

${errors.map((error, idx) => `${idx + 1}. ${error}`).join('\n')}

🔴 ЗАДЪЛЖИТЕЛНО: Избягвай горните грешки! Обърни специално внимание на:
- Всички задължителни полета трябва да присъстват
- Спазване на ADLE v8 правила (hard bans, whitelist, meal types, chronological order)
- Правилни изчисления на калории и макроси
- Детайлни обосновки (минимум 100 символа където е поискано)
- Точно 7 дни в седмичния план
- 1-5 хранения на ден според стратегията

НЕ ПОВТАРЯЙ тези грешки в този опит!
═══════════════════════════════════════════════════════════════
`;
}

async function generatePlanMultiStep(env, data) {
  console.log('Multi-step generation: Starting (3+ AI requests for precision)');
  
  // Generate a unique session ID for this plan generation
  const sessionId = generateUniqueId('session');
  console.log(`Plan generation session ID: ${sessionId}`);
  
  // Token tracking for multi-step generation
  let cumulativeTokens = {
    input: 0,
    output: 0,
    total: 0
  };
  
  try {
    // Step 1: Analyze user profile (1st AI request)
    // Focus: Deep health analysis, metabolic profile, correlations
    const analysisPrompt = await generateAnalysisPrompt(data, env);
    const analysisInputTokens = estimateTokenCount(analysisPrompt);
    cumulativeTokens.input += analysisInputTokens;
    
    let analysisResponse, analysis;
    
    try {
      analysisResponse = await callAIModel(env, analysisPrompt, 4000, 'step1_analysis', sessionId, data, null);
      const analysisOutputTokens = estimateTokenCount(analysisResponse);
      cumulativeTokens.output += analysisOutputTokens;
      cumulativeTokens.total = cumulativeTokens.input + cumulativeTokens.output;
      
      console.log(`Step 1 tokens: input=${analysisInputTokens}, output=${analysisOutputTokens}, cumulative=${cumulativeTokens.total}`);
      
      analysis = parseAIResponse(analysisResponse);
      
      if (!analysis || analysis.error) {
        const errorMsg = analysis.error || 'Невалиден формат на отговор';
        console.error('Analysis parsing failed:', errorMsg);
        console.error('AI Response preview (first 1000 chars):', analysisResponse?.substring(0, 1000));
        throw new Error(`Анализът не можа да бъде създаден: ${errorMsg}`);
      }
      
      // REQUIREMENT 2: Filter out "Normal" severity problems from analysis
      if (analysis.keyProblems && Array.isArray(analysis.keyProblems)) {
        const originalCount = analysis.keyProblems.length;
        analysis.keyProblems = analysis.keyProblems.filter(problem => 
          problem.severity !== 'Normal'
        );
        const filteredCount = analysis.keyProblems.length;
        if (filteredCount < originalCount) {
          console.log(`Filtered out ${originalCount - filteredCount} Normal severity problems from analysis`);
        }
      }
    } catch (error) {
      console.error('Analysis step failed:', error);
      throw new Error(`Стъпка 1 (Анализ): ${error.message}`);
    }
    
    console.log('Multi-step generation: Analysis complete (1/3)');
    
    // Step 2: Generate dietary strategy based on analysis (2nd AI request)
    // Focus: Personalized approach, timing, principles, restrictions
    const strategyPrompt = await generateStrategyPrompt(data, analysis, env);
    const strategyInputTokens = estimateTokenCount(strategyPrompt);
    cumulativeTokens.input += strategyInputTokens;
    
    let strategyResponse, strategy;
    
    try {
      strategyResponse = await callAIModel(env, strategyPrompt, 4000, 'step2_strategy', sessionId, data, analysis);
      const strategyOutputTokens = estimateTokenCount(strategyResponse);
      cumulativeTokens.output += strategyOutputTokens;
      cumulativeTokens.total = cumulativeTokens.input + cumulativeTokens.output;
      
      console.log(`Step 2 tokens: input=${strategyInputTokens}, output=${strategyOutputTokens}, cumulative=${cumulativeTokens.total}`);
      
      strategy = parseAIResponse(strategyResponse);
      
      if (!strategy || strategy.error) {
        const errorMsg = strategy.error || 'Невалиден формат на отговор';
        console.error('Strategy parsing failed:', errorMsg);
        console.error('AI Response preview (first 1000 chars):', strategyResponse?.substring(0, 1000));
        throw new Error(`Стратегията не можа да бъде създадена: ${errorMsg}`);
      }
    } catch (error) {
      console.error('Strategy step failed:', error);
      throw new Error(`Стъпка 2 (Стратегия): ${error.message}`);
    }
    
    console.log('Multi-step generation: Strategy complete (2/3)');
    
    // Step 3: Generate detailed meal plan
    // Use progressive generation if enabled (multiple smaller requests)
    let mealPlan;
    
    if (ENABLE_PROGRESSIVE_GENERATION) {
      console.log('Multi-step generation: Using progressive meal plan generation');
      try {
        mealPlan = await generateMealPlanProgressive(env, data, analysis, strategy, null, sessionId);
      } catch (error) {
        console.error('Progressive meal plan generation failed:', error);
        throw new Error(`Стъпка 3 (Хранителен план - прогресивно): ${error.message}`);
      }
    } else {
      // Fallback to single-request generation
      console.log('Multi-step generation: Using single-request meal plan generation');
      const mealPlanPrompt = await generateMealPlanPrompt(data, analysis, strategy, env);
      let mealPlanResponse;
      
      try {
        mealPlanResponse = await callAIModel(env, mealPlanPrompt, MEAL_PLAN_TOKEN_LIMIT, 'step3_meal_plan_full', sessionId, data, analysis);
        mealPlan = parseAIResponse(mealPlanResponse);
        
        if (!mealPlan || mealPlan.error) {
          const errorMsg = mealPlan.error || 'Невалиден формат на отговор';
          console.error('Meal plan parsing failed:', errorMsg);
          console.error('AI Response preview (first 1000 chars):', mealPlanResponse?.substring(0, 1000));
          throw new Error(`Хранителният план не можа да бъде създаден: ${errorMsg}`);
        }
      } catch (error) {
        console.error('Meal plan step failed:', error);
        throw new Error(`Стъпка 3 (Хранителен план): ${error.message}`);
      }
    }
    
    console.log('Multi-step generation: Meal plan complete (3/3)');
    
    // Final token usage summary
    console.log(`=== CUMULATIVE TOKEN USAGE ===`);
    console.log(`Total Input Tokens: ${cumulativeTokens.input}`);
    console.log(`Total Output Tokens: ${cumulativeTokens.output}`);
    console.log(`Total Tokens: ${cumulativeTokens.total}`);
    
    // Warn if approaching limits (most models have 30k-100k context windows)
    if (cumulativeTokens.total > 25000) {
      console.warn(`⚠️ High token usage (${cumulativeTokens.total} tokens) - approaching model limits`);
    }
    
    // Combine all parts into final plan (meal plan takes precedence)
    // Returns comprehensive plan with analysis and strategy included
    return {
      ...mealPlan,
      analysis: analysis,
      strategy: strategy,
      _meta: {
        tokenUsage: cumulativeTokens,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Multi-step generation failed:', error);
    // Return error with details instead of falling back silently
    throw new Error(`Генерирането на план се провали: ${error.message}`);
  }
}

/**
 * Helper function to get custom prompt from KV storage
 */
async function getCustomPrompt(env, promptKey) {
  if (!env || !env.page_content) {
    return null;
  }
  
  try {
    return await env.page_content.get(promptKey);
  } catch (error) {
    console.error(`Error fetching custom prompt ${promptKey}:`, error);
    return null;
  }
}

/**
 * Check if a prompt already includes JSON format instructions
 * Used to avoid adding duplicate JSON format instructions to custom prompts
 * 
 * @param {string} prompt - The prompt text to check
 * @returns {boolean} - True if JSON instructions are detected, false otherwise
 */
function hasJsonFormatInstructions(prompt) {
  // Check for common JSON format instruction markers in Bulgarian
  // Note: Includes both generic markers and prompt-specific ones for comprehensive detection
  const jsonMarkers = [
    'JSON формат',           // "JSON format" - generic
    'ФОРМАТ НА ОТГОВОР',     // "RESPONSE FORMAT" - generic
    'Върни САМО JSON',       // "Return ONLY JSON" - generic
    'Върни JSON',            // "Return JSON" - generic
    'Върни ПЪЛНИЯ КОРИГИРАН план' // "Return FULL CORRECTED plan" - correction prompt specific
  ];
  
  return jsonMarkers.some(marker => prompt.includes(marker));
}

/**
 * Replace variables in prompt template
 * Variables are marked with {variableName} syntax
 */
function replacePromptVariables(template, variables) {
  // Use replace with regex and replacer function for efficient variable substitution
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (key in variables) {
      const value = variables[key];
      return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    }
    return match; // Return original if variable not found
  });
}

/**
 * Step 1: Generate prompt for user profile analysis
 * Simplified - focuses on AI's strengths: correlations, psychology, individualization
 * Backend handles: BMR, TDEE, safety checks
 */
async function generateAnalysisPrompt(data, env, errorPreventionComment = null) {
  // IMPORTANT: AI calculates BMR, TDEE, and calories based on ALL correlates
  // Backend no longer pre-calculates these values - AI does holistic analysis
  
  // Check if there's a custom prompt in KV storage
  const customPrompt = await getCustomPrompt(env, 'admin_analysis_prompt');
  
  // If custom prompt exists, use it; otherwise use default
  if (customPrompt) {
    // Replace variables in custom prompt with actual data
    // Pass the entire data object as userData
    let prompt = replacePromptVariables(customPrompt, {
      userData: data
    });
    
    // Inject error prevention comment if provided
    if (errorPreventionComment) {
      prompt = errorPreventionComment + '\n\n' + prompt;
    }
    
    // CRITICAL: Ensure JSON format instructions are included even with custom prompts
    // This prevents AI from responding with natural language instead of structured JSON
    if (!hasJsonFormatInstructions(prompt)) {
      prompt += `

═══ КРИТИЧНО ВАЖНО - ФОРМАТ НА ОТГОВОР ═══
Отговори САМО с валиден JSON обект БЕЗ допълнителни обяснения или текст преди или след JSON.

Структурата ТРЯБВА да включва:
{
  "bmi": число,
  "bmiCategory": "текст",
  "bmr": число,
  "tdee": число,
  "recommendedCalories": число,
  "macroRatios": {
    "protein": число,
    "carbs": число,
    "fats": число,
    "fiber": число
  },
  "macroGrams": {
    "protein": число,
    "carbs": число,
    "fats": число
  },
  "activityLevel": "текст",
  "physiologicalPhase": "текст",
  "waterDeficit": {
    "dailyNeed": "текст",
    "currentIntake": "текст",
    "deficit": "текст",
    "impactOnLipolysis": "текст"
  },
  "negativeHealthFactors": [{"factor": "текст", "severity": число, "description": "текст"}],
  "hinderingFactors": [{"factor": "текст", "severity": число, "description": "текст"}],
  "cumulativeRiskScore": "текст",
  "psychoProfile": {
    "temperament": "текст",
    "probability": число
  },
  "metabolicReactivity": {
    "speed": "текст",
    "adaptability": "текст"
  },
  "correctedMetabolism": {
    "realBMR": число,
    "realTDEE": число,
    "correction": "текст",
    "correctionPercent": "текст"
  },
  "metabolicProfile": "текст",
  "healthRisks": ["текст"],
  "nutritionalNeeds": ["текст"],
  "psychologicalProfile": "текст",
  "successChance": число,
  "currentHealthStatus": {
    "score": число,
    "description": "текст",
    "keyIssues": ["текст"]
  },
  "forecastPessimistic": {
    "timeframe": "текст",
    "weight": "текст",
    "health": "текст",
    "risks": ["текст"]
  },
  "forecastOptimistic": {
    "timeframe": "текст",
    "weight": "текст",
    "health": "текст",
    "improvements": ["текст"]
  },
  "keyProblems": [
    {
      "title": "текст",
      "description": "текст",
      "severity": "Borderline/Risky/Critical",
      "severityValue": число,
      "category": "текст",
      "impact": "текст"
    }
  ]
}

ВАЖНО: Върни САМО JSON с ЧИСЛА и ДАННИ, БЕЗ обяснения или обосновки!`;
    }
    return prompt;
  }
  
  // Build default prompt with optional error prevention comment
  let defaultPrompt = '';
  
  if (errorPreventionComment) {
    defaultPrompt += errorPreventionComment + '\n\n';
  }
  
  defaultPrompt += `Ти си експертен клиничен диетолог, ендокринолог и бихейвиорален психолог. 

ТВОЯТА ЗАДАЧА: Направи професионален ХОЛИСТИЧЕН АНАЛИЗ на здравословния и метаболитен профил на клиента.

ФОКУС: Анализирай КОРЕЛАЦИИТЕ между всички фактори и определи оптималните калорийни и макронутриентни нужди базирани на цялостната клинична картина.

═══ КЛИЕНТСКИ ПРОФИЛ ═══
${JSON.stringify({
  name: data.name,
  age: data.age,
  gender: data.gender,
  height: data.height,
  weight: data.weight,
  goal: data.goal,
  lossKg: data.lossKg,
  
  // Sleep & circadian rhythm
  sleepHours: data.sleepHours,
  sleepInterrupt: data.sleepInterrupt,
  chronotype: data.chronotype,
  
  // Activity & stress
  sportActivity: data.sportActivity,
  dailyActivityLevel: data.dailyActivityLevel,
  stressLevel: data.stressLevel,
  
  // Nutrition & hydration
  waterIntake: data.waterIntake,
  drinksSweet: data.drinksSweet,
  drinksAlcohol: data.drinksAlcohol,
  
  // Eating behavior - FULL DATA for precise correlational analysis
  overeatingFrequency: data.overeatingFrequency,
  eatingHabits: data.eatingHabits,
  foodCravings: data.foodCravings,
  foodTriggers: data.foodTriggers,
  compensationMethods: data.compensationMethods,
  socialComparison: data.socialComparison,
  
  // Medical & history - FULL DATA for comprehensive understanding
  medicalConditions: data.medicalConditions,
  medications: data.medications,
  medicationsDetails: data.medicationsDetails,
  weightChange: data.weightChange,
  weightChangeDetails: data.weightChangeDetails,
  dietHistory: data.dietHistory,
  dietType: data.dietType,
  dietResult: data.dietResult,
  
  // Preferences
  dietPreference: data.dietPreference,
  dietDislike: data.dietDislike,
  dietLove: data.dietLove,
  
  // Additional notes from user (CRITICAL INFORMATION)
  additionalNotes: data.additionalNotes
}, null, 2)}

${data.additionalNotes ? `
═══ 🔥 КРИТИЧНО ВАЖНА ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ 🔥 ═══
⚠️ МАКСИМАЛЕН ПРИОРИТЕТ: Следната информация е предоставена директно от потребителя и ТРЯБВА да бъде взета предвид при ЦЕЛИЯ анализ, изчисления и препоръки.
Това може да променя критично анализа, стратегията и плана!

ДОПЪЛНИТЕЛНИ БЕЛЕЖКИ ОТ ${data.name}:
${data.additionalNotes}

⚠️ ЗАДЪЛЖИТЕЛНО: Анализирай как тази информация влияе на:
1. Изчисленията на BMR/TDEE/Калории
2. Избора на диетична стратегия
3. Психологическия профил
4. Медицинските противопоказания
5. Храните и храненията в плана
═══════════════════════════════════════════════════════════════
` : ''}

═══ БАЗОВА ИНФОРМАЦИЯ ЗА ИЗЧИСЛЕНИЯ ═══
Основни физически параметри (за референция):
- Тегло: ${data.weight} кг
- Височина: ${data.height} см
- Възраст: ${data.age} години
- Пол: ${data.gender}
- Цел: ${data.goal}
${data.lossKg ? `- Желано отслабване: ${data.lossKg} кг` : ''}

═══ BACKEND РЕФЕРЕНТНИ ИЗЧИСЛЕНИЯ (Issues #2, #7, #9, #10, #28 - Feb 2026) ═══
${(() => {
  // Calculate unified activity score (Issue #7)
  const activityData = calculateUnifiedActivityScore(data);
  
  // Calculate BMR
  const bmr = calculateBMR(data);
  
  // Calculate TDEE using new unified score
  const tdee = calculateTDEE(bmr, activityData.combinedScore);
  
  // Calculate safe deficit (Issue #9)
  const deficitData = calculateSafeDeficit(tdee, data.goal);
  
  // Calculate baseline macros (Issue #2, #28) - pass TDEE for accurate percentages
  const macros = calculateMacronutrientRatios(data, activityData.combinedScore, tdee);
  
  return `
УНИФИЦИРАН АКТИВНОСТ СКОР (Issue #7):
- Дневна активност: ${data.dailyActivityLevel} → ${activityData.dailyScore}/3
- Спортна активност: ${data.sportActivity} → ~${activityData.sportDays} дни
- КОМБИНИРАН СКОР: ${activityData.combinedScore}/10 (${activityData.activityLevel})
- Формула: дневна активност (1-3) + спортни дни → скала 1-10

БАЗОВИ КАЛКУЛАЦИИ:
- BMR (Mifflin-St Jeor): ${bmr} kcal
  * Мъж: 10×${data.weight} + 6.25×${data.height} - 5×${data.age} + 5
  * Жена: 10×${data.weight} + 6.25×${data.height} - 5×${data.age} - 161
  
- TDEE (Issue #10): ${tdee} kcal
  * BMR × ${(tdee / bmr).toFixed(2)} (фактор за активност скор ${activityData.combinedScore})
  * Нов множител базиран на 1-10 скала (не дублирани дефиниции)
  
- БЕЗОПАСЕН ДЕФИЦИТ (Issue #9): ${deficitData.targetCalories} kcal
  * Максимален дефицит: 25% (${deficitData.maxDeficitCalories} kcal минимум)
  * Стандартен дефицит: ${deficitData.deficitPercent}%
  * AI може да коригира за специални стратегии (интермитентно гладуване и др.)

БАЗОВИ МАКРОНУТРИЕНТИ (Issue #2, #28 - НЕ циркулярна логика):
- Протеин: ${macros.protein}% (${macros.proteinGramsPerKg}g/kg за ${data.gender})
  * ${data.gender === 'Мъж' ? 'Мъже имат по-високи нужди' : 'Жени имат по-ниски нужди'} от протеин
  * Коригирано според активност скор ${activityData.combinedScore}
- Въглехидрати: ${macros.carbs}%
- Мазнини: ${macros.fats}%
- СУМА: ${macros.protein + macros.carbs + macros.fats}% (валидирано = 100%)
- Формула: процентно разпределение базирано на активност и цел
`;
})()}

РЕФЕРЕНТНИТЕ изчисления са само ОТПРАВНА ТОЧКА за валидация. ТИ определяш финалните стойности според холистичния анализ.

═══ ТВОЯТА ЗАДАЧА - РАЗШИРЕН АНАЛИЗ ═══

Направи ХОЛИСТИЧЕН АНАЛИЗ, включващ следните стъпки:

1. BMI АНАЛИЗ:
   - Изчисли BMI = тегло(kg) / (височина(m))²
   - Категоризирай: Поднормено (<18.5), Нормално (18.5-25), Наднормено (25-30), Затлъстяване (>30)
   - Анализирай съответствие с целта

2. БАЗОВ МЕТАБОЛИЗЪМ (BMR) И TDEE:
   - Използвай Mifflin-St Jeor формулата (виж референтните изчисления)
   - Коригирай според активност скор 1-10 (${(() => { const ad = calculateUnifiedActivityScore(data); return ad.combinedScore; })()}/10)
   - TDEE = BMR × активност фактор

3. СТАНДАРТ ЗА РАЗПРЕДЕЛЯНЕ НА МАКРОСИ:
   - Протеини: базирай на активност, цел и пол
   - Мазнини: необходими за хормонален баланс
   - Въглехидрати: според активност и метаболитен тип
   - Фибри: изчисли според пол, възраст и цел (обикновено ${FIBER_MIN_GRAMS}-${FIBER_MAX_GRAMS}г дневно, но персонализирай)

4. НИВО НА АКТИВНОСТ (скала 1-10):
   - Вече изчислено: ${(() => { const ad = calculateUnifiedActivityScore(data); return ad.combinedScore; })()}/10 (${(() => { const ad = calculateUnifiedActivityScore(data); return ad.activityLevel; })()})
   - Анализирай как това влияе на калорийни нужди

5. ФИЗИОЛОГИЧНА ФАЗА В ЖИВОТА:
   - Възраст: ${data.age} години
   - Определи фаза: Млад възрастен (18-30), Зряла възраст (31-50), Средна възраст (51-65), Напреднала възраст (65+)
   - Влияние на метаболизъм и хормонален профил

6. ДНЕВЕН ВОДЕН ДЕФИЦИТ (Water Gap):
   - Формула: (Тегло × ${WATER_PER_KG_MULTIPLIER}) + ${BASE_WATER_NEED_LITERS}Л (базиран на активност)
   - Нужда: (${data.weight} × ${WATER_PER_KG_MULTIPLIER}) + ${BASE_WATER_NEED_LITERS} = ${(parseFloat(data.weight) * WATER_PER_KG_MULTIPLIER + BASE_WATER_NEED_LITERS).toFixed(2)} до ${(parseFloat(data.weight) * WATER_PER_KG_MULTIPLIER + BASE_WATER_NEED_LITERS + ACTIVITY_WATER_BONUS_LITERS).toFixed(2)} литра
   - Текущ прием: ${data.waterIntake || 'неизвестен'}
   - Изчисли дефицит и влияние върху липолизата

8. ОТРИЦАТЕЛНИ ЗДРАВОСЛОВНИ ФАКТОРИ (тежест 1-3):
   - Медицински състояния: ${JSON.stringify(data.medicalConditions || [])}
   - Лекарства: ${data.medications === 'Да' ? data.medicationsDetails : 'Не приема'}
   - Оцени всеки фактор по скала 1 (леко) до 3 (тежко)

9. ПРЕЧЕЩИ ФАКТОРИ ЗА ПОСТИГАНЕ НА ЦЕЛТА (тежест 1-3):
   - Стрес: ${data.stressLevel}
   - Качество на съня: ${data.sleepHours}ч, прекъсвания: ${data.sleepInterrupt}
   - Навици: ${JSON.stringify(data.eatingHabits || [])}
   - Емоционални тригери: ${JSON.stringify(data.foodTriggers || [])}
   - Оцени всеки по скала 1-3

10. СУМАРНИ ФАКТОРИ:
    - Където има припокриващи се фактори (напр. стрес + емоционално хранене), СУМИРАЙ числата
    - Създай сумарен риск профил

11. ХИПОТЕЗА ЗА ПСИХОПРОФИЛ И ТЕМПЕРАМЕНТ:
    - Анализирай данните за:
      * Хранителни желания: ${JSON.stringify(data.foodCravings || [])}
      * Тригери: ${JSON.stringify(data.foodTriggers || [])}
      * Копинг механизми: ${JSON.stringify(data.compensationMethods || [])}
      * Социално сравнение: ${data.socialComparison}
    - Определи вероятен темперамент с процент вероятност (само ако >${TEMPERAMENT_CONFIDENCE_THRESHOLD}%)
    - Възможни типове: Холерик, Сангвиник, Флегматик, Меланхолик

11a. РЕАКТИВНОСТ НА МЕТАБОЛИЗМА:
    - Анализирай спрямо:
      * Активност скор: ${(() => { const ad = calculateUnifiedActivityScore(data); return ad.combinedScore; })()}/10
      * Физиологична фаза: ${data.age} год.
      * Психопрофил (от т.11)
      * История на диети: ${data.dietHistory}, ${data.dietType || 'N/A'}, ${data.dietResult || 'N/A'}
      * Хронотип: ${data.chronotype}
      * Стрес: ${data.stressLevel}
    - Определи: Бавен/Среден/Бърз метаболизъм
    - Адаптивност към промени: Ниска/Средна/Висока

12. КОРЕКЦИЯ НА РЕАЛЕН МЕТАБОЛИЗЪМ:
    - Коригирай BMR/TDEE според:
      * Точки 4, 5, 11, 11a
      * Качество на сън: ${data.sleepHours}ч, ${data.sleepInterrupt}
      * Хронотип: ${data.chronotype}
      * Стрес: ${data.stressLevel}
      * Здравен статус и медикаменти
    - Определи РЕАЛЕН метаболизъм (може да е ±10-20% от изчисления)

13. ИЗЧИСЛЯВАНЕ НА ПРЕПОРЪЧИТЕЛНИ КАЛОРИИ И МАКРОСИ:
    - Базирай на:
      * Коригиран метаболизъм (т.12)
      * Реактивност (т.11a)
      * Активност, възраст, психопрофил
      * Хронотип и оптимални енергийни прозорци
      * Здравен статус и медикаменти
    - Определи ФИНАЛНИ препоръки

14. КРИТИЧНИ ПРОБЛЕМИ (3-6 бр.):
    - Започни от сумарния риск (т.10)
    - Включи най-тежките от т.9 и т.8
    - Представи ги по КРИТИЧЕН И ПЛАШЕЩ начин
    - САМО Borderline/Risky/Critical severity

15. ЗДРАВОСЛОВНО СЪСТОЯНИЕ В МОМЕНТА:
    - Базирано на целия анализ
    - Изведи с 10% ЗАНИЖЕНО (по-песимистична оценка за мотивация)
    - Скала: 0-100

16. ПРОГНОЗА - ПЕСИМИСТИЧНА (1 година):
    - Ако клиентът ПРОДЪЛЖИ по същия начин
    - Какви здравни рискове ще се развият
    - Къде ще бъде след 12 месеца (тегло, здраве, енергия)

17. ПРОГНОЗА - ОПТИМИСТИЧНА (1 година):
    - След подобряване на ВСИЧКИ проблемни параметри
    - Какви подобрения са възможни
    - Къде може да бъде след 12 месеца (тегло, здраве, енергия)

═══ ФОРМАТ НА ОТГОВОР ═══

{
  "bmi": число,
  "bmiCategory": "текст категория",
  "bmr": число,
  "tdee": число,
  "recommendedCalories": число,
  "macroRatios": {
    "protein": число процент,
    "carbs": число процент,
    "fats": число процент,
    "fiber": число грамове дневно
  },
  "macroGrams": {
    "protein": число грамове,
    "carbs": число грамове,
    "fats": число грамове
  },
  "activityLevel": "ниво 1-10 и кратко описание",
  "physiologicalPhase": "фаза според възраст",
  "waterDeficit": {
    "dailyNeed": "литри дневно",
    "currentIntake": "текущ прием",
    "deficit": "дефицит в литри",
    "impactOnLipolysis": "влияние"
  },
  "negativeHealthFactors": [
    {
      "factor": "фактор",
      "severity": число 1-3,
      "description": "кратко описание"
    }
  ],
  "hinderingFactors": [
    {
      "factor": "фактор",
      "severity": число 1-3,
      "description": "кратко описание"
    }
  ],
  "cumulativeRiskScore": "сума на рисковете",
  "psychoProfile": {
    "temperament": "тип (само ако >${TEMPERAMENT_CONFIDENCE_THRESHOLD}% вероятност)",
    "probability": число процент
  },
  "metabolicReactivity": {
    "speed": "Бавен/Среден/Бърз",
    "adaptability": "Ниска/Средна/Висока"
  },
  "correctedMetabolism": {
    "realBMR": число,
    "realTDEE": число,
    "correction": "кратко описание на корекцията",
    "correctionPercent": "+/-X%"
  },
  "metabolicProfile": "кратък профил на метаболизма",
  "healthRisks": ["риск 1", "риск 2", "риск 3"],
  "nutritionalNeeds": ["нужда 1", "нужда 2", "нужда 3"],
  "psychologicalProfile": "кратък психологически профил",
  "successChance": число (-100 до 100),
  "currentHealthStatus": {
    "score": число 0-100 (ЗАНИЖЕНО с ${HEALTH_STATUS_UNDERESTIMATE_PERCENT}%),
    "description": "текущо състояние",
    "keyIssues": ["проблем 1", "проблем 2"]
  },
  "forecastPessimistic": {
    "timeframe": "12 месеца",
    "weight": "прогнозно тегло",
    "health": "прогнозно здраве",
    "risks": ["риск 1", "риск 2"]
  },
  "forecastOptimistic": {
    "timeframe": "12 месеца",
    "weight": "прогнозно тегло",
    "health": "прогнозно здраве",
    "improvements": ["подобрение 1", "подобрение 2"]
  },
  "keyProblems": [
    {
      "title": "заглавие (кратко)",
      "description": "КРИТИЧНО описание на проблема",
      "severity": "Borderline/Risky/Critical",
      "severityValue": число 0-100,
      "category": "Sleep/Nutrition/Hydration/Stress/Activity/Medical",
      "impact": "въздействие"
    }
  ]
}

ВАЖНО: Върни САМО JSON с ЧИСЛА и КРАТКИ ДАННИ за ${data.name}, БЕЗ обяснения и обосновки.`;
  
  return defaultPrompt;
}

async function generateStrategyPrompt(data, analysis, env, errorPreventionComment = null) {
  // Check if there's a custom prompt in KV storage
  const customPrompt = await getCustomPrompt(env, 'admin_strategy_prompt');
  
  // Extract only essential analysis data (COMPACT - English/code format)
  const analysisCompact = {
    bmr: analysis.bmr || 'N/A',
    tdee: analysis.tdee || 'N/A',
    cals: analysis.recommendedCalories || 'N/A',
    macroP: analysis.macroRatios?.protein != null ? `${analysis.macroRatios.protein}%` : 'N/A',
    macroC: analysis.macroRatios?.carbs != null ? `${analysis.macroRatios.carbs}%` : 'N/A',
    macroF: analysis.macroRatios?.fats != null ? `${analysis.macroRatios.fats}%` : 'N/A',
    macroGP: analysis.macroGrams?.protein != null ? `${analysis.macroGrams.protein}g` : 'N/A',
    macroGC: analysis.macroGrams?.carbs != null ? `${analysis.macroGrams.carbs}g` : 'N/A',
    macroGF: analysis.macroGrams?.fats != null ? `${analysis.macroGrams.fats}g` : 'N/A',
    metabProf: (analysis.metabolicProfile || '').substring(0, 100),
    risks: (analysis.healthRisks || []).slice(0, 3).join(', '),
    needs: (analysis.nutritionalNeeds || []).slice(0, 3).join(', '),
    psycho: (analysis.psychologicalProfile || '').substring(0, 100),
    successCh: analysis.successChance || 'N/A',
    keyProbs: (analysis.keyProblems || [])
      .slice(0, 3)
      .map(p => `${p.title}(${p.severity})`)
      .join('; ')
  };
  
  // If custom prompt exists, use it; otherwise use default
  if (customPrompt) {
    // Replace variables in custom prompt
    let prompt = replacePromptVariables(customPrompt, {
      userData: data,
      analysisData: analysisCompact,
      name: data.name,
      age: data.age,
      goal: data.goal
    });
    
    // Inject error prevention comment if provided
    if (errorPreventionComment) {
      prompt = errorPreventionComment + '\n\n' + prompt;
    }
    
    // CRITICAL: Ensure JSON format instructions are included even with custom prompts
    if (!hasJsonFormatInstructions(prompt)) {
      prompt += `

═══ КРИТИЧНО ВАЖНО - ФОРМАТ НА ОТГОВОР ═══
Отговори САМО с валиден JSON обект БЕЗ допълнителни обяснения или текст преди или след JSON.

Структурата ТРЯБВА да включва:
{
  "dietaryModifier": "текст",
  "welcomeMessage": "текст",
  "planJustification": "текст",
  "longTermStrategy": "текст",
  "mealCountJustification": "текст",
  "afterDinnerMealJustification": "текст",
  "dietType": "текст",
  "weeklyMealPattern": "текст",
  "weeklyScheme": {
    "monday": {"meals": число, "description": "текст"},
    "tuesday": {"meals": число, "description": "текст"},
    "wednesday": {"meals": число, "description": "текст"},
    "thursday": {"meals": число, "description": "текст"},
    "friday": {"meals": число, "description": "текст"},
    "saturday": {"meals": число, "description": "текст"},
    "sunday": {"meals": число, "description": "текст"}
  },
  "breakfastStrategy": "текст",
  "calorieDistribution": "текст",
  "macroDistribution": "текст",
  "mealTiming": {
    "pattern": "текст",
    "fastingWindows": "текст",
    "flexibility": "текст",
    "chronotypeGuidance": "текст"
  },
  "keyPrinciples": ["текст"],
  "foodsToInclude": ["текст"],
  "foodsToAvoid": ["текст"],
  "supplementRecommendations": ["текст"],
  "hydrationStrategy": "текст",
  "communicationStyle": {
    "temperament": "текст",
    "tone": "текст",
    "approach": "текст",
    "chatGuidelines": "текст"
  },
  "psychologicalSupport": ["текст"]
}

ВАЖНО: Върни САМО JSON с ДАННИ, БЕЗ обяснения!`;
    }
    return prompt;
  }
  
  // Build default prompt with optional error prevention comment
  let defaultPrompt = '';
  
  if (errorPreventionComment) {
    defaultPrompt += errorPreventionComment + '\n\n';
  }
  
  defaultPrompt += `Базирайки се на здравословния профил и анализа, определи оптималната диетична стратегия:

CLIENT: ${data.name}, ${data.age}y, Goal: ${data.goal}

ANALYSIS (compact):
BMR=${analysisCompact.bmr} TDEE=${analysisCompact.tdee} Cals=${analysisCompact.cals}
Macro%: P=${analysisCompact.macroP} C=${analysisCompact.macroC} F=${analysisCompact.macroF}
MacroG: P=${analysisCompact.macroGP} C=${analysisCompact.macroGC} F=${analysisCompact.macroGF}
Metab: ${analysisCompact.metabProf}
Risks: ${analysisCompact.risks}
Needs: ${analysisCompact.needs}
Psycho: ${analysisCompact.psycho}
Success: ${analysisCompact.successCh}
KeyProbs: ${analysisCompact.keyProbs}

PREFERENCES:
dietPref: ${JSON.stringify(data.dietPreference || [])}${data.dietPreference_other ? ` (${data.dietPreference_other})` : ''}
dislike: ${data.dietDislike || 'None'}
love: ${data.dietLove || 'None'}
${data.eatingHabits && data.eatingHabits.includes('Не закусвам') ? '⚠️ NO BREAKFAST (exception: drinks/liquids if health-related)\n' : ''}

${data.additionalNotes ? `
🔥 USER NOTES: ${data.additionalNotes}
⚠️ MANDATORY: Adapt strategy based on above notes
` : ''}

⚠️ ═══ MANDATORY REQUIREMENTS ═══
1. DIET PREFERENCE: ${data.dietPreference && data.dietPreference.length > 0 ? `MUST RESPECT: ${JSON.stringify(data.dietPreference)}` : 'None specified'}
2. NO BREAKFAST: ${data.eatingHabits && data.eatingHabits.includes('Не закусвам') ? 'MUST SKIP breakfast (exception: drinks/liquids if health-related)' : 'Not applicable'}
3. FREE MEAL: If appropriate for psycho profile, include "свободно хранене" (recommended: Sunday lunch, followed by light dinner)

═══ WEEKLY SCHEME REQUIREMENTS ═══
1. Determine meals per day based on:
   * Eating habits: ${JSON.stringify(data.eatingHabits || [])}
   * Chronotype: ${data.chronotype}
   * Psycho profile from analysis
   * Goal: ${data.goal}

2. SPECIAL CASES:
   a) NO BREAKFAST: Skip breakfast OR recommend drink (water+lemon, green tea, ayran)
   b) FREE MEAL: Include if suitable, note as "свободно хранене", light dinner after
   c) FASTING: Consider IF (16:8, 18:6) if appropriate

3. CALORIE/MACRO DISTRIBUTION:
   - Set daily calories and meal calories
   - Vary by: weekday/weekend, chronotype, activity

4. COMMUNICATION STYLE:
   - Adapt to psycho profile temperament
   - Choleric: Direct, results-focused
     * Сангвиник: Позитивен, вдъхновяващ, разнообразие
     * Флегматик: Спокоен, постепенен, без натиск
     * Меланхолик: Детайлен, научно обоснован, емпатичен
   - Това ще влияе на:
     * Тон на welcomeMessage
     * Стил на обосновки
     * Психологическа подкрепа
     * Бъдеща комуникация с AI асистента

Return JSON strategy:
{
  "dietaryModifier": "diet profile term (e.g. Balanced, Keto, Vegan, Mediterranean)",
  "welcomeMessage": "REQUIRED: Personalized welcome for ${data.name} (150-250 words, specific)",
  "planJustification": "REQUIRED: Strategy justification (min 100 chars)",
  "longTermStrategy": "long-term approach (2-3 days/week, cycling)",
  "mealCountJustification": "meal count reasoning (1-5)",
  "afterDinnerMealJustification": "after-dinner reasoning OR 'Not needed'",
  "dietType": "diet type for ${data.name}",
  "weeklyMealPattern": "weekly pattern (e.g. 16:8 IF, 5:2, cyclic, traditional)",
  "weeklyScheme": {
    "monday": {"meals": число, "description": "текст за ден"},
    "tuesday": {"meals": число, "description": "текст за ден"},
    "wednesday": {"meals": число, "description": "текст за ден"},
    "thursday": {"meals": число, "description": "текст за ден"},
    "friday": {"meals": число, "description": "текст за ден"},
    "saturday": {"meals": число, "description": "текст за ден"},
    "sunday": {"meals": number, "description": "text (include free meal='свободно хранене' if appropriate)"}
  },
  "breakfastStrategy": "if no breakfast: recommended drinks",
  "calorieDistribution": "calorie distribution by days/meals",
  "macroDistribution": "macro distribution by days/meals",
  "mealTiming": {
    "pattern": "weekly pattern (no exact hours, use concepts)",
    "fastingWindows": "fasting periods if applicable",
    "flexibility": "flexibility description",
    "chronotypeGuidance": "HOW chronotype ${data.chronotype} affects timing"
  },
  "keyPrinciples": ["principle 1 for ${data.name}", "principle 2", "principle 3"],
  "foodsToInclude": ["food 1 for ${data.name}", "food 2", "food 3"],
  "foodsToAvoid": ["food 1 avoid for ${data.name}", "food 2", "food 3"],
  "supplementRecommendations": ["supplement 1 (dose+reason)", "supplement 2 (dose+reason)", "supplement 3 (dose+reason)"],
  "hydrationStrategy": "hydration recommendations for ${data.name}",
  "communicationStyle": {
    "temperament": "temperament from analysis (if >80%)",
    "tone": "communication tone",
    "approach": "communication approach",
    "chatGuidelines": "how AI assistant should communicate with ${data.name}"
  },
  "psychologicalSupport": ["psycho tip 1 for ${data.name}", "psycho tip 2", "psycho tip 3"]
}

Create personalized strategy for ${data.name} based on unique profile.`;
  
  return defaultPrompt;
}

/**
 * Calculate average macros from a week plan
 * Used as fallback when AI summary generation fails
 */
function calculateAverageMacrosFromPlan(weekPlan) {
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFats = 0;
  let dayCount = 0;
  
  try {
    Object.keys(weekPlan).forEach(dayKey => {
      const day = weekPlan[dayKey];
      if (day && day.meals && Array.isArray(day.meals)) {
        dayCount++;
        day.meals.forEach(meal => {
          if (meal.macros) {
            totalProtein += parseInt(meal.macros.protein) || 0;
            totalCarbs += parseInt(meal.macros.carbs) || 0;
            totalFats += parseInt(meal.macros.fats) || 0;
          }
        });
      }
    });
    
    if (dayCount > 0) {
      return {
        protein: Math.round(totalProtein / dayCount),
        carbs: Math.round(totalCarbs / dayCount),
        fats: Math.round(totalFats / dayCount)
      };
    }
  } catch (error) {
    console.error('Error calculating macros from plan:', error);
  }
  
  return { protein: null, carbs: null, fats: null };
}

/**
 * Progressive meal plan generation - generates meal plan in smaller chunks
 * Each chunk builds on previous days for variety and consistency
 * This approach reduces token usage per request and provides better error handling
 */
async function generateMealPlanProgressive(env, data, analysis, strategy, errorPreventionComment = null, sessionId = null) {
  console.log('Progressive generation: Starting meal plan generation in chunks');
  
  const totalDays = 7;
  const chunks = Math.ceil(totalDays / DAYS_PER_CHUNK);
  const weekPlan = {};
  const previousDays = []; // Track previous days for variety
  
  // Cache dynamic food lists once (prevents 4 redundant calls per generation)
  const cachedFoodLists = await getDynamicFoodListsSections(env);
  console.log('Progressive generation: Cached food lists for reuse across chunks');
  
  // Parse BMR and calories - handle both numeric and string values
  let bmr;
  if (analysis.bmr) {
    // If bmr is already a number, use it directly
    if (typeof analysis.bmr === 'number') {
      bmr = Math.round(analysis.bmr);
    } else {
      // Otherwise, extract from string
      const bmrMatch = String(analysis.bmr).match(/\d+/);
      bmr = bmrMatch ? parseInt(bmrMatch[0]) : null;
    }
  }
  if (!bmr) {
    bmr = calculateBMR(data);
  }
  
  let recommendedCalories;
  if (analysis.recommendedCalories) {
    // If recommendedCalories is already a number, use it directly
    if (typeof analysis.recommendedCalories === 'number') {
      recommendedCalories = Math.round(analysis.recommendedCalories);
    } else {
      // Otherwise, extract from string
      const caloriesMatch = String(analysis.recommendedCalories).match(/\d+/);
      recommendedCalories = caloriesMatch ? parseInt(caloriesMatch[0]) : null;
    }
  }
  if (!recommendedCalories) {
    const tdee = calculateTDEE(bmr, data.sportActivity);
    if (data.goal === 'Отслабване') {
      recommendedCalories = Math.round(tdee * 0.85);
    } else if (data.goal === 'Покачване на мускулна маса') {
      recommendedCalories = Math.round(tdee * 1.1);
    } else {
      recommendedCalories = tdee;
    }
  }
  
  // Generate meal plan in chunks
  for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
    const startDay = chunkIndex * DAYS_PER_CHUNK + 1;
    const endDay = Math.min(startDay + DAYS_PER_CHUNK - 1, totalDays);
    const daysInChunk = endDay - startDay + 1;
    
    console.log(`Progressive generation: Generating days ${startDay}-${endDay} (chunk ${chunkIndex + 1}/${chunks})`);
    
    try {
      const chunkPrompt = await generateMealPlanChunkPrompt(
        data, analysis, strategy, bmr, recommendedCalories,
        startDay, endDay, previousDays, env, errorPreventionComment, cachedFoodLists
      );
      
      const chunkInputTokens = estimateTokenCount(chunkPrompt);
      console.log(`Chunk ${chunkIndex + 1} input tokens: ~${chunkInputTokens}`);
      
      const chunkResponse = await callAIModel(env, chunkPrompt, MEAL_PLAN_TOKEN_LIMIT, `step3_meal_plan_chunk_${chunkIndex + 1}`, sessionId, data, analysis);
      const chunkOutputTokens = estimateTokenCount(chunkResponse);
      console.log(`Chunk ${chunkIndex + 1} output tokens: ~${chunkOutputTokens}`);
      
      const chunkData = parseAIResponse(chunkResponse);
      
      if (!chunkData || chunkData.error) {
        const errorMsg = chunkData.error || 'Invalid response';
        console.error(`Chunk ${chunkIndex + 1} parsing failed:`, errorMsg);
        console.error('AI Response preview (first 1000 chars):', chunkResponse?.substring(0, 1000));
        throw new Error(`Chunk ${chunkIndex + 1} failed: ${errorMsg}`);
      }
      
      // Merge chunk data into weekPlan
      for (let day = startDay; day <= endDay; day++) {
        const dayKey = `day${day}`;
        if (chunkData[dayKey]) {
          weekPlan[dayKey] = chunkData[dayKey];
          previousDays.push({
            day: day,
            meals: chunkData[dayKey].meals || []
          });
        } else {
          throw new Error(`Missing ${dayKey} in chunk ${chunkIndex + 1} response`);
        }
      }
      
      console.log(`Progressive generation: Chunk ${chunkIndex + 1}/${chunks} complete`);
    } catch (error) {
      console.error(`Progressive generation: Chunk ${chunkIndex + 1} failed:`, error);
      throw new Error(`Генериране на дни ${startDay}-${endDay}: ${error.message}`);
    }
  }
  
  // Generate summary, recommendations, etc. in final request
  console.log('Progressive generation: Generating summary and recommendations');
  try {
    const summaryPrompt = await generateMealPlanSummaryPrompt(data, analysis, strategy, bmr, recommendedCalories, weekPlan, env);
    const summaryResponse = await callAIModel(env, summaryPrompt, SUMMARY_TOKEN_LIMIT, 'step4_summary', sessionId, data, analysis);
    const summaryData = parseAIResponse(summaryResponse);
    
    if (!summaryData || summaryData.error) {
      // Calculate actual macros from generated weekPlan instead of using generic text
      console.warn('Summary generation failed, calculating from weekPlan');
      const calculatedMacros = calculateAverageMacrosFromPlan(weekPlan);
      
      return {
        summary: {
          bmr: bmr,
          dailyCalories: recommendedCalories,
          macros: {
            protein: calculatedMacros.protein || 0,
            carbs: calculatedMacros.carbs || 0,
            fats: calculatedMacros.fats || 0
          }
        },
        weekPlan: weekPlan,
        recommendations: strategy.foodsToInclude || [],
        forbidden: strategy.foodsToAvoid || [],
        psychology: strategy.psychologicalSupport || [],
        waterIntake: strategy.hydrationStrategy || "2-2.5л дневно",
        supplements: strategy.supplementRecommendations || []
      };
    }
    
    return {
      summary: summaryData.summary || {
        bmr: bmr,
        dailyCalories: recommendedCalories,
        macros: summaryData.macros || {}
      },
      weekPlan: weekPlan,
      recommendations: summaryData.recommendations || strategy.foodsToInclude || [],
      forbidden: summaryData.forbidden || strategy.foodsToAvoid || [],
      psychology: summaryData.psychology || strategy.psychologicalSupport || [],
      waterIntake: summaryData.waterIntake || strategy.hydrationStrategy || "2-2.5л дневно",
      supplements: summaryData.supplements || strategy.supplementRecommendations || []
    };
  } catch (error) {
    console.error('Summary generation failed:', error);
    // Calculate actual macros from generated weekPlan instead of using generic text
    const calculatedMacros = calculateAverageMacrosFromPlan(weekPlan);
    
    return {
      summary: {
        bmr: bmr,
        dailyCalories: recommendedCalories,
        macros: { 
          protein: calculatedMacros.protein || 0,
          carbs: calculatedMacros.carbs || 0,
          fats: calculatedMacros.fats || 0
        }
      },
      weekPlan: weekPlan,
      recommendations: strategy.foodsToInclude || [],
      forbidden: strategy.foodsToAvoid || [],
      psychology: strategy.psychologicalSupport || [],
      waterIntake: strategy.hydrationStrategy || "2-2.5л дневно",
      supplements: strategy.supplementRecommendations || []
    };
  }
}

/**
 * Generate nutrition plan prompt for AI (legacy single-step approach, kept for backward compatibility)
 */
async function generateNutritionPrompt(data, env) {
  // Try to get custom prompt from KV
  let promptTemplate = null;
  if (env.page_content) {
    promptTemplate = await env.page_content.get('admin_plan_prompt');
  }

  // Use default if no custom prompt
  if (!promptTemplate) {
    promptTemplate = `Ти си професионален диетолог, ендокринолог и здравен консултант. Създай подробен, индивидуализиран 7-дневен хранителен план за клиент със следните характеристики:

ОСНОВНИ ДАННИ:
- Име: {name}
- Пол: {gender}
- Възраст: {age} години
- Ръст: {height} см
- Тегло: {weight} кг
- Цел: {goal}
{lossKg}

ЗДРАВОСЛОВЕН ПРОФИЛ:
- Сън: {sleepHours} часа (прекъсвания: {sleepInterrupt})
- Хронотип: {chronotype}
- Активност през деня: {dailyActivityLevel}
- Стрес: {stressLevel}
- Спортна активност: {sportActivity}

ХРАНИТЕЛНИ НАВИЦИ:
- Вода: {waterIntake}
- Прекомерно хранене: {overeatingFrequency}
- Хранителни навици: {eatingHabits}
- Желания за храна: {foodCravings}
- Тригери за хранене: {foodTriggers}

ПРЕДПОЧИТАНИЯ:
- Диетични предпочитания: {dietPreference}
- Не обича/непоносимост/алергия: {dietDislike}
- Любими храни: {dietLove}

МЕДИЦИНСКИ СЪСТОЯНИЯ:
- Състояния: {medicalConditions}
- Лекарства: {medications}

КРИТИЧНО ВАЖНО - НИКАКВИ DEFAULT СТОЙНОСТИ:
- Този план е САМО и ЕДИНСТВЕНО за {name}
- ЗАБРАНЕНО е използването на универсални, общи или стандартни стойности
- ВСИЧКИ калории, BMR, макронутриенти са ИНДИВИДУАЛНО изчислени
- Хранителните добавки са ПЕРСОНАЛНО подбрани според анализа
- Психологическите съвети са базирани на КОНКРЕТНИЯ емоционален профил

ВАЖНИ НАСОКИ ЗА СЪЗДАВАНЕ НА ПЛАНА:
1. Използвай САМО храни, които клиентът обича или няма непоносимост към
2. СТРОГО избягвай храните от списъка с непоносимости и алергии
3. Включвай любимите храни в здравословен контекст
4. Спазвай медицинските ограничения и корелирай ги с хранителните нужди
5. Използвай РАЗНООБРАЗНИ храни - избягвай повторения
6. Всички ястия трябва да бъдат реалистични и лесни за приготвяне
7. Използвай български и средиземноморски продукти
8. Адаптирай времето на хранене към хронотипа {chronotype}
9. Всяко ястие да е балансирано и подходящо за целта {goal}
10. АНАЛИЗИРАЙ корелациите между сън, стрес и хранителни нужди
11. ИНДИВИДУАЛИЗИРАЙ макронутриентите според активност, медицински състояния и цели

КРИТИЧНО ИЗИСКВАНЕ ЗА ИНДИВИДУАЛИЗАЦИЯ:
- Този план е САМО за {name} и трябва да отразява УНИКАЛНИЯ профил
- Вземи предвид ХОЛИСТИЧНО всички параметри и тяхната взаимовръзка
- Психологическите съвети трябва да са СПЕЦИФИЧНИ за емоционалния профил на {name}
- Хранителните добавки трябва да са ИНДИВИДУАЛНО подбрани според:
  * Дефицити от анализа (напр. нисък витамин D заради малко излагане на слънце)
  * Медицински състояния (напр. магнезий за стрес, омега-3 за възпаление)
  * Цели (напр. протеин за мускулна маса, желязо за енергия)
  * Възраст и пол (напр. калций за жени над 40, цинк за мъже)
- Дозировките трябва да са ПЕРСОНАЛИЗИРАНИ според тегло, възраст и нужди
- ЗАБРАНЕНИ са универсални "мултивитамини" без конкретна обосновка

СТРОГО ЗАБРАНЕНО:
- Странни комбинации от храни (напр. чийзкейк със салата)
- Екзотични продукти, трудно достъпни в България
- Повтаряне на едни и същи храни в различни дни
- Комбинации, нетипични за българската/средиземноморска кухня
- Храни от списъка с непоносимости

Моля, върни отговора в следния JSON формат (с ИНДИВИДУАЛНИ стойности):

{
  "summary": {
    "bmr": "ИНДИВИДУАЛНО изчислена базова метаболитна скорост за {name}",
    "dailyCalories": "ПЕРСОНАЛИЗИРАН дневен прием калории според цел {goal}",
    "macros": {
      "protein": "протеин в грамове ПЕРСОНАЛИЗИРАН за {name}",
      "carbs": "въглехидрати в грамове ПЕРСОНАЛИЗИРАНИ за {name}", 
      "fats": "мазнини в грамове ПЕРСОНАЛИЗИРАНИ за {name}"
    }
  },
  "weekPlan": {
    "day1": {
      "meals": [
        {
          "type": "Закуска",
          "name": "Име на реалистично българско/средиземноморско ястие",
          "weight": "250g",
          "description": "Детайлно описание на ястието и съставки",
          "benefits": "Конкретни ползи за здравето на {name}",
          "calories": 350
        }
      ]
    }
  },
  "recommendations": ["конкретна храна 1 подходяща за {name}", "конкретна храна 2 подходяща за {name}", "конкретна храна 3 подходяща за {name}", "конкретна храна 4 подходяща за {name}", "конкретна храна 5 подходяща за {name}"],
  "forbidden": ["конкретна забранена храна 1 за {name}", "конкретна забранена храна 2 за {name}", "конкретна забранена храна 3 за {name}", "конкретна забранена храна 4 за {name}"],
  "psychology": ["психологически съвет 1 базиран на емоционалното хранене на {name}", "психологически съвет 2 базиран на поведението на {name}", "психологически съвет 3 за мотивация специфичен за {name}"],
  "waterIntake": "Детайлен препоръчителен прием на вода персонализиран за {name}",
  "supplements": ["ИНДИВИДУАЛНА добавка 1 за {name} с дозировка и обосновка (БАЗИРАНА на: ${data.age} год. ${data.gender}, ${data.goal}, ${data.medicalConditions || 'няма'})", "ИНДИВИДУАЛНА добавка 2 за {name} с дозировка и обосновка (БАЗИРАНА на: ${data.sportActivity}, сън ${data.sleepHours}ч)", "ИНДИВИДУАЛНА добавка 3 за {name} с дозировка и обосновка (БАЗИРАНА на: ${data.eatingHabits}, ${data.dietPreference})"]
}

КРИТИЧНО ВАЖНО ЗА "recommendations" И "forbidden":
- "recommendations" ТРЯБВА да съдържа САМО конкретни храни (минимум 5-6 елемента)
  * ДА: "Зеленолистни зеленчуци (спанак, марули, рукола)", "Пилешко месо", "Риба (сьомга, скумрия, паламуд)", "Киноа и кафявориз", "Гръцко кисело мляко"
  * НЕ: "Пийте повече вода", "Хранете се редовно", "Слушайте тялото си"
- "forbidden" ТРЯБВА да съдържа САМО конкретни храни или категории храни (минимум 4-5 елемента)
  * ДА: "Бели хлебни изделия", "Газирани напитки", "Пържени храни", "Сладкиши и торти", "Фаст фуд"
  * НЕ: "Избягвайте стреса", "Не прекалявайте с порциите"
- ЗАБРАНЕНО е да слагаш общи съвети в "recommendations" или "forbidden"
- Всеки елемент трябва да е САМО име на храна или категория храни
- Препоръчаните храни трябва да са съобразени с целта на клиента ({goal})

КРИТИЧНО ВАЖНО ЗА ФОРМАТИРАНЕ:
1. "psychology" ТРЯБВА да е масив с ТОЧНО 3 елемента
2. "supplements" ТРЯБВА да е масив с ТОЧНО 3 елемента
3. "recommendations" ТРЯБВА да е масив с минимум 5-6 конкретни храни
4. "forbidden" ТРЯБВА да е масив с минимум 4-5 конкретни храни
5. Всеки елемент е просто текст БЕЗ специални префикси
6. Елементите трябва да бъдат конкретни и специфични за клиента

Пример за ПРАВИЛЕН формат:
"recommendations": [
  "Зеленолистни зеленчуци (спанак, марули, рукола)",
  "Пилешко месо без кожа",
  "Бяла риба (цаца, пъстърва)",
  "Киноа и кафявориз",
  "Гръцко кисело мляко",
  "Ядки (бадеми, орехи - малки порции)"
],
"forbidden": [
  "Бели хлебни изделия и паста",
  "Газирани напитки със захар",
  "Пържени храни и фаст фуд",
  "Сладкиши, торти и бонбони",
  "Преработено месо (салами, наденици)"
],
"psychology": [
  "Не се обвинявайте при грешка - един лош ден не разваля прогреса",
  "Слушайте сигналите на тялото си за глад и ситост вместо да се храните емоционално", 
  "Водете дневник на емоциите при хранене за по-добро самоосъзнаване"
],
"supplements": [
  "Витамин D3 - 2000 IU дневно, сутрин с храна за добро усвояване (СПЕЦИФИЧНО за {name}: ${data.age} год., ${data.gender}, слънчева експозиция)",
  "Омега-3 мастни киселини - 1000mg дневно за сърдечно здраве (СПЕЦИФИЧНО за {name}: цел ${data.goal}, активност ${data.sportActivity})",
  "Магнезий - 200mg вечер преди лягане за по-добър сън (СПЕЦИФИЧНО за {name}: сън ${data.sleepHours}ч, стрес ${data.stressLevel})"
]

=== МЕДИЦИНСКИ И ДИЕТИЧНИ ПРИНЦИПИ ЗА РЕД НА ХРАНЕНИЯ ===
КРИТИЧНО ВАЖНО: Следвай СТРОГО медицинските и диететични принципи за ред на храненията:
1. ХРОНОЛОГИЧЕН РЕД: Храненията ТРЯБВА да следват естествения дневен ритъм
   - Закуска (сутрин) - ВИНАГИ първо ако има закуска
   - Обяд (обед) - след закуската или първо хранене ако няма закуска
   - Следобедна закуска (опционално, между обяд и вечеря)
   - Вечеря (вечер) - ВИНАГИ последно хранене
2. ЗАБРАНЕНО: Хранения след вечеря (НЕ може да има закуска след вечеря!)
3. ЗАБРАНЕНО: Хранения в неестествен ред (напр. вечеря преди обяд)
4. ПОЗВОЛЕНИ ТИПОВЕ: "Закуска", "Обяд", "Следобедна закуска", "Вечеря"

Създай пълни 7 дни (day1 до day7) с 1-5 хранения според стратегията В ПРАВИЛЕН ХРОНОЛОГИЧЕН РЕД. Всяко хранене трябва да е УНИКАЛНО, балансирано и строго съобразено с индивидуалните нужди, предпочитания и здравословно състояние на клиента.`;
  }

  // Replace template variables with actual data
  return promptTemplate
    .replace(/{name}/g, data.name || '')
    .replace(/{gender}/g, data.gender || '')
    .replace(/{age}/g, data.age || '')
    .replace(/{height}/g, data.height || '')
    .replace(/{weight}/g, data.weight || '')
    .replace(/{goal}/g, data.goal || '')
    .replace(/{lossKg}/g, data.lossKg ? `- Целево отслабване: ${data.lossKg} кг` : '')
    .replace(/{sleepHours}/g, data.sleepHours || '')
    .replace(/{sleepInterrupt}/g, data.sleepInterrupt || 'Не')
    .replace(/{chronotype}/g, data.chronotype || '')
    .replace(/{dailyActivityLevel}/g, data.dailyActivityLevel || '')
    .replace(/{stressLevel}/g, data.stressLevel || '')
    .replace(/{sportActivity}/g, data.sportActivity || '')
    .replace(/{waterIntake}/g, data.waterIntake || '')
    .replace(/{overeatingFrequency}/g, data.overeatingFrequency || '')
    .replace(/{eatingHabits}/g, JSON.stringify(data.eatingHabits || []))
    .replace(/{foodCravings}/g, JSON.stringify(data.foodCravings || []))
    .replace(/{foodTriggers}/g, JSON.stringify(data.foodTriggers || []))
    .replace(/{dietPreference}/g, JSON.stringify(data.dietPreference || []))
    .replace(/{dietDislike}/g, data.dietDislike || 'Няма')
    .replace(/{dietLove}/g, data.dietLove || 'Няма')
    .replace(/{medicalConditions}/g, JSON.stringify(data.medicalConditions || []))
    .replace(/{medications}/g, data.medications === 'Да' ? data.medicationsDetails : 'Не приема');
}


/**
 * Get admin configuration with caching to reduce KV reads
 */
async function getAdminConfig(env) {
  // Return cached config if still valid
  const now = Date.now();
  if (adminConfigCache && (now - adminConfigCacheTime) < ADMIN_CONFIG_CACHE_TTL) {
    return adminConfigCache;
  }

  // Fetch fresh config from KV
  const config = {
    provider: 'openai',
    modelName: 'gpt-4o-mini'
  };

  if (env.page_content) {
    // Use Promise.all to fetch both values in parallel
    const [savedProvider, savedModelName] = await Promise.all([
      env.page_content.get('admin_ai_provider'),
      env.page_content.get('admin_ai_model_name')
    ]);

    if (savedProvider) config.provider = savedProvider;
    if (savedModelName) config.modelName = savedModelName;
  }

  // Update cache
  adminConfigCache = config;
  adminConfigCacheTime = now;

  return config;
}

/**
 * Get chat prompts configuration with caching to reduce KV reads
 */
async function getChatPrompts(env) {
  // Return cached prompts if still valid
  const now = Date.now();
  if (chatPromptsCache && (now - chatPromptsCacheTime) < CHAT_PROMPTS_CACHE_TTL) {
    return chatPromptsCache;
  }

  // Default prompts
  const prompts = {
    consultation: `ТЕКУЩ РЕЖИМ: КОНСУЛТАЦИЯ

ВАЖНИ ПРАВИЛА:
1. Можеш да четеш плана, но НЕ МОЖЕШ да го променяш.
2. Бъди КРАТЪК но информативен - максимум 3-4 изречения, прост език.
3. Ако клиентът иска промяна, кажи: "За промяна активирай режима за промяна на плана."
4. НИКОГА не използвай [REGENERATE_PLAN:...] инструкции.
5. Винаги поддържай мотивиращ тон.
6. Форматирай отговорите си ясно - използвай нови редове за разделяне на мисли.
7. Задавай максимум 1 въпрос на отговор.

ПРИМЕРИ:
- "Закуската съдържа овесени ядки с банан (350 калории). За промяна, активирай режима за промяна."
- "Можеш да замениш рибата с пилешко - и двете са отлични източници на протеин. За промяна, активирай режима за промяна."`,
    modification: `ТЕКУЩ РЕЖИМ: ПРОМЯНА НА ПЛАНА

ВАЖНИ ПРАВИЛА:
1. Ти си професионален диетолог. Бъди КРАТЪК но информативен, ЯСЕН и директен.
2. Използвай ПРОСТ език, лесно разбираем.
3. Ограничи се до МАКСИМУМ 3-4 изречения в отговор.
4. Задавай МАКСИМУМ 1 въпрос на отговор.
5. Форматирай отговорите си ясно:
   - Използвай нови редове за разделяне на различни мисли
   - Когато изброяваш опции, сложи всяка на нов ред с тире (-)
   - Използвай празни редове за по-добра четимост между параграфи

2. Когато клиентът иска промяна:
   - Анализирай дали е здравословно за цел: {goal}
   - Обясни КРАТКО последиците (само основното)
   - Ако има по-добра алтернатива, предложи я с 1 изречение
   - Запитай с 1 въпрос за потвърждение
   - След потвърждение, приложи с [REGENERATE_PLAN:{"modifications":["описание"]}]

3. РАЗПОЗНАВАНЕ НА ПОТВЪРЖДЕНИЕ:
   - "да", "yes", "добре", "ок", "окей", "сигурен", "сигурна" = ПОТВЪРЖДЕНИЕ
   - Ако клиентът потвърди (каже "да"), НЕ питай отново! Приложи промяната ВЕДНАГА.
   - Ако вече си задавал същия въпрос в историята, НЕ го питай отново - приложи промяната!
   - НИКОГА не задавай един и същ въпрос повече от ВЕДНЪЖ.

4. НИКОГА не прилагай директно промяна без обсъждане! Винаги обясни и консултирай първо.

5. ЗА ПРЕМАХВАНЕ НА КОНКРЕТНИ ХРАНИ:
   - Ако клиентът иска да премахне конкретна храна (напр. "овесени ядки"), използвай специален модификатор:
   - Формат: "exclude_food:име_на_храната" (напр. "exclude_food:овесени ядки")
   - Пример: [REGENERATE_PLAN:{"modifications":["exclude_food:овесени ядки"]}]
   - Това ще регенерира плана БЕЗ тази храна

6. ПРИМЕР С ФОРМАТИРАНЕ:
   Клиент: "премахни междинните хранения"
   
   Отговор: "Разбирам. Премахването може да опрости храненето, но може и да доведе до преяждане.
   
   За твоята цел препоръчвам една от двете:
   - Премахване на всички междинни хранения (само 3 основни)
   - Оставяне на 1 здравословна закуска (по-балансирано)
   
   Какво предпочиташ?"
   
   [ЧАКАЙ потвърждение преди REGENERATE_PLAN]
   
   Клиент: "да" или "добре, премахни всички"
   
   Отговор: "✓ Разбрано! Регенерирам плана със 3 основни хранения.
   
   [REGENERATE_PLAN:{"modifications":["3_meals_per_day"]}]"
   
   ПРИМЕР ЗА ПРЕМАХВАНЕ НА ХРАНА:
   Клиент: "махни овесените ядки"
   
   Отговор: "Разбирам. Премахването на овесените ядки ще намали фибрите в закуската.
   
   Искаш ли да ги премахна от всички дни?"
   
   Клиент: "да"
   
   Отговор: "✓ Разбрано! Премахвам овесените ядки от плана.
   
   [REGENERATE_PLAN:{"modifications":["exclude_food:овесени ядки"]}]"

7. ПОДДЪРЖАНИ МОДИФИКАЦИИ:
   - "${PLAN_MODIFICATIONS.NO_INTERMEDIATE_MEALS}" - без междинни хранения
   - "${PLAN_MODIFICATIONS.THREE_MEALS_PER_DAY}" - 3 хранения дневно
   - "${PLAN_MODIFICATIONS.FOUR_MEALS_PER_DAY}" - 4 хранения дневно
   - "${PLAN_MODIFICATIONS.VEGETARIAN}" - вегетариански план
   - "${PLAN_MODIFICATIONS.NO_DAIRY}" - без млечни продукти
   - "${PLAN_MODIFICATIONS.LOW_CARB}" - нисковъглехидратна диета
   - "${PLAN_MODIFICATIONS.INCREASE_PROTEIN}" - повече протеини
   - "exclude_food:име_на_храна" - премахване на конкретна храна

ПОМНИ: 
- Форматирай ясно с нови редове и изброяване
- Максимум 3-4 изречения
- Максимум 1 въпрос
- АКО клиентът вече потвърди, НЕ питай отново - ПРИЛОЖИ ВЕДНАГА!`
  };

  if (env.page_content) {
    // Fetch custom prompts from KV in parallel
    const [savedConsultation, savedModification] = await Promise.all([
      env.page_content.get('admin_consultation_prompt'),
      env.page_content.get('admin_modification_prompt')
    ]);

    if (savedConsultation) prompts.consultation = savedConsultation;
    if (savedModification) prompts.modification = savedModification;
  }

  // Update cache
  chatPromptsCache = prompts;
  chatPromptsCacheTime = now;

  return prompts;
}


/**
 * Call OpenAI API with automatic retry logic for transient errors
 */
async function callOpenAI(env, prompt, modelName = 'gpt-4o-mini', maxTokens = null) {
  try {
    return await retryWithBackoff(async () => {
      const requestBody = {
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7
      };
      
      // Add max_tokens only if specified
      if (maxTokens) {
        requestBody.max_tokens = maxTokens;
      }
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Check for errors in response
      if (data.error) {
        throw new Error(`OpenAI API грешка: ${data.error.message || JSON.stringify(data.error)}`);
      }
      
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('OpenAI API върна невалиден формат на отговор');
      }
      
      const choice = data.choices[0];
      
      // Check finish_reason for content filtering or other issues
      if (choice.finish_reason && choice.finish_reason !== 'stop') {
        const reason = choice.finish_reason;
        let errorMessage = `OpenAI API завърши с причина: ${reason}`;
        
        if (reason === 'content_filter') {
          errorMessage = 'OpenAI AI отказа да генерира отговор поради филтър за съдържание. Моля, опитайте с различни данни.';
        } else if (reason === 'length') {
          errorMessage = 'OpenAI AI достигна лимита на дължина. Опитайте да опростите въпроса.';
        }
        
        throw new Error(errorMessage);
      }
      
      return choice.message.content;
    });
  } catch (error) {
    console.error('OpenAI API call failed:', error);
    throw new Error(`OpenAI API failed: ${error.message}`);
  }
}

/**
 * Helper function to retry API calls with exponential backoff
 * Handles transient errors like 502, 503, 504, 429
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} initialDelay - Initial delay in milliseconds before first retry (default: 1000ms)
 * @returns {Promise<any>} Result from the function call
 * @throws {Error} The last error if all retries fail or if error is not retryable
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable (transient network errors)
      const errorMessage = error.message || '';
      const isRetryable = 
        errorMessage.includes('502') ||  // Bad Gateway
        errorMessage.includes('503') ||  // Service Unavailable
        errorMessage.includes('504') ||  // Gateway Timeout
        errorMessage.includes('429') ||  // Too Many Requests
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('network');
      
      // If not retryable or last attempt, throw error
      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = initialDelay * Math.pow(2, attempt);
      // Log retry without exposing sensitive data (API keys, tokens, auth credentials)
      const safeErrorMessage = errorMessage.replace(/(?:key|token|auth|bearer)[=:]\s*[^\s&]+/gi, (match) => {
        return match.split(/[=:]/)[0] + '=***';
      });
      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms due to: ${safeErrorMessage}`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // This line is technically unreachable due to the logic above, but kept for type safety
  throw lastError;
}

/**
 * Call Anthropic Claude API with automatic retry logic for transient errors
 */
async function callClaude(env, prompt, modelName = 'claude-3-5-sonnet-20241022', maxTokens = null) {
  try {
    return await retryWithBackoff(async () => {
      const requestBody = {
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens || 8000
      };
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Check for errors in response
      if (data.error) {
        throw new Error(`Claude API грешка: ${data.error.message || JSON.stringify(data.error)}`);
      }
      
      if (!data.content || !data.content[0] || !data.content[0].text) {
        throw new Error('Claude API върна невалиден формат на отговор');
      }
      
      // Check stop_reason for content filtering or other issues
      if (data.stop_reason && data.stop_reason !== 'end_turn') {
        const reason = data.stop_reason;
        let errorMessage = `Claude API завърши с причина: ${reason}`;
        
        if (reason === 'max_tokens') {
          errorMessage = 'Claude AI достигна лимита на дължина. Опитайте да опростите въпроса.';
        }
        
        throw new Error(errorMessage);
      }
      
      return data.content[0].text;
    });
  } catch (error) {
    console.error('Claude API call failed:', error);
    throw new Error(`Claude API failed: ${error.message}`);
  }
}

/**
 * Call Gemini API with automatic retry logic for transient errors
 */
async function callGemini(env, prompt, modelName = 'gemini-pro', maxTokens = null) {
  try {
    return await retryWithBackoff(async () => {
      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }]
      };
      
      // Add maxOutputTokens if specified
      if (maxTokens) {
        requestBody.generationConfig = {
          maxOutputTokens: maxTokens
        };
      }
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Check for safety/content filtering or other finish reasons
      if (data.candidates && data.candidates[0]) {
        const candidate = data.candidates[0];
        
        // Check if response was blocked or filtered
        if (candidate.finishReason && candidate.finishReason !== 'STOP') {
          const reason = candidate.finishReason;
          let errorMessage = `Gemini API отказ: ${reason}`;
          
          if (reason === 'SAFETY') {
            errorMessage = 'Gemini AI отказа да генерира отговор поради съображения за сигурност. Моля, опитайте с различни данни или контактирайте поддръжката.';
          } else if (reason === 'RECITATION') {
            errorMessage = 'Gemini AI отказа да генерира отговор поради потенциално копиране на съдържание.';
          } else if (reason === 'MAX_TOKENS') {
            errorMessage = 'Gemini AI достигна лимита на токени. Опитайте да опростите въпроса.';
          }
          
          throw new Error(errorMessage);
        }
        
        // Check if content exists
        if (!candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
          throw new Error('Gemini API върна празен отговор. Моля, опитайте отново.');
        }
        
        return candidate.content.parts[0].text;
      }
      
      throw new Error('Невалиден формат на отговор от Gemini API');
    });
  } catch (error) {
    console.error('Gemini API call failed:', error);
    throw new Error(`Gemini API failed: ${error.message}`);
  }
}

/**
 * Generate mock response for development
 * Note: Mock mode should only be used for testing. In production, always use real AI models.
 */
function generateMockResponse(prompt) {
  if (prompt.includes('7-дневен хранителен план')) {
    // Note: Mock mode should not be used in production. 
    // For testing purposes only - uses clearly marked placeholder values.
    return JSON.stringify({
      summary: {
        bmr: "XXXX (MOCK VALUE - in production this would be individualized)",
        dailyCalories: "XXXX (MOCK VALUE - in production this would be personalized)",
        macros: {
          protein: "XXXg (MOCK)",
          carbs: "XXXg (MOCK)",
          fats: "XXXg (MOCK)"
        }
      },
      weekPlan: {
        day1: {
          meals: [
            {
              type: "Закуска",
              name: "Овесена каша с горски плодове",
              weight: "250g",
              description: "Богата на фибри. Бавните въглехидрати осигуряват енергия за целия ден.",
              benefits: "Подобрява храносмилането и контролира кръвната захар.",
              calories: 350
            },
            {
              type: "Обяд",
              name: "Пилешка пържола на скара със салата",
              weight: "350g",
              description: "Високо съдържание на протеин с минимални мазнини.",
              benefits: "Подпомага мускулното възстановяване.",
              calories: 450
            },
            {
              type: "Вечеря",
              name: "Бяла риба със задушени зеленчуци",
              weight: "300g",
              description: "Лека вечеря, богата на Омега-3 мастни киселини.",
              benefits: "Лесна за усвояване преди сън.",
              calories: 380
            }
          ]
        },
        day2: {
          meals: [
            {
              type: "Закуска",
              name: "Гръцко кисело мляко с мюсли",
              weight: "200g",
              description: "Протеини и пробиотици за добро храносмилане.",
              benefits: "Подпомага чревното здраве.",
              calories: 320
            },
            {
              type: "Обяд",
              name: "Телешко със зеленчуци на тиган",
              weight: "350g",
              description: "Балансирано ястие с протеини и витамини.",
              benefits: "Осигурява енергия и минерали.",
              calories: 480
            },
            {
              type: "Вечеря",
              name: "Пълнозърнести макарони с пилешко",
              weight: "300g",
              description: "Комплексни въглехидрати и постно месо.",
              benefits: "Продължително чувство за ситост.",
              calories: 420
            }
          ]
        },
        day3: {
          meals: [
            {
              type: "Закуска",
              name: "Яйца на очи с авокадо",
              weight: "200g",
              description: "Здравословни мазнини и протеини.",
              benefits: "Дълготрайна енергия и ситост.",
              calories: 340
            },
            {
              type: "Обяд",
              name: "Пилешка супа с киноа",
              weight: "400g",
              description: "Топла и питателна храна.",
              benefits: "Подпомага имунната система.",
              calories: 380
            },
            {
              type: "Вечеря",
              name: "Сьомга на скара с брокули",
              weight: "320g",
              description: "Омега-3 и антиоксиданти.",
              benefits: "Противовъзпалително действие.",
              calories: 450
            }
          ]
        },
        day4: {
          meals: [
            {
              type: "Закуска",
              name: "Протеинов смути с банан",
              weight: "300ml",
              description: "Бърза и лесна закуска.",
              benefits: "Идеална за заети сутрини.",
              calories: 310
            },
            {
              type: "Обяд",
              name: "Пуешки кюфтета с ориз",
              weight: "350g",
              description: "Постно месо с комплексни въглехидрати.",
              benefits: "Балансирано ястие за активни хора.",
              calories: 470
            },
            {
              type: "Вечеря",
              name: "Зеленчукова яхния",
              weight: "280g",
              description: "Лека и питателна вечеря.",
              benefits: "Подпомага храносмилането.",
              calories: 220
            }
          ]
        },
        day5: {
          meals: [
            {
              type: "Закуска",
              name: "Палачинки от овесени ядки",
              weight: "230g",
              description: "Здравословна алтернатива на класическите.",
              benefits: "Богати на фибри.",
              calories: 360
            },
            {
              type: "Обяд",
              name: "Говежди шишчета с печени зеленчуци",
              weight: "370g",
              description: "Протеини и витамини от зеленчуците.",
              benefits: "Подпомага мускулния растеж.",
              calories: 490
            },
            {
              type: "Вечеря",
              name: "Печена треска с аспержи",
              weight: "310g",
              description: "Лека бяла риба с деликатесни зеленчуци.",
              benefits: "Лесно усвоима и богата на белтък.",
              calories: 370
            }
          ]
        },
        day6: {
          meals: [
            {
              type: "Закуска",
              name: "Тост с крема сирене и домати",
              weight: "220g",
              description: "Класическа и вкусна закуска.",
              benefits: "Баланс между протеини и въглехидрати.",
              calories: 330
            },
            {
              type: "Обяд",
              name: "Паста с песто и пилешко",
              weight: "360g",
              description: "Средиземноморски вкус с протеини.",
              benefits: "Енергия за следобедието.",
              calories: 510
            },
            {
              type: "Вечеря",
              name: "Руло Стефани със салата",
              weight: "290g",
              description: "Традиционно българско ястие в здравословна версия.",
              benefits: "Балансирано и вкусно.",
              calories: 400
            }
          ]
        },
        day7: {
          meals: [
            {
              type: "Закуска",
              name: "Боул с гранола и плодове",
              weight: "260g",
              description: "Цветна и вкусна закуска.",
              benefits: "Антиоксиданти и витамини.",
              calories: 350
            },
            {
              type: "Обяд",
              name: "Пиле по китайски с ориз",
              weight: "380g",
              description: "Екзотичен вкус с балансирани макроси.",
              benefits: "Разнообразие в менюто.",
              calories: 500
            },
            {
              type: "Вечеря",
              name: "Гръцка мусака с кисело мляко",
              weight: "320g",
              description: "Традиционно ястие в облекчена версия.",
              benefits: "Вкусна награда за края на седмицата.",
              calories: 430
            }
          ]
        }
      },
      recommendations: [
        "Вода (минимум 2.5л на ден)",
        "Зеленолистни зеленчуци",
        "Чисто месо (пилешко, говеждо)",
        "Риба и морски дарове",
        "Сурови ядки (в умерени количества)"
      ],
      forbidden: [
        "Газирани напитки със захар",
        "Пържени храни и фаст фуд",
        "Сладкиши и рафинирана захар",
        "Алкохол (особено концентрати)"
      ],
      psychology: "Не се обвинявайте: Ако 'съгрешите' с едно хранене, просто продължете по план следващия път. Едно хранене не разваля прогреса. Слушайте тялото си: Хранете се, когато сте гладни, а не когато сте емоционални или отегчени.",
      waterIntake: "Поне 2.5 литра вода дневно, разпределени през целия ден",
      supplements: "Витамин D3 (2000 IU), Омега-3 (1000mg), Магнезий (200mg)"
    });
  } else {
    // Mock chat response
    return "Благодаря за въпроса! Като ваш личен диетолог, бих искал да ви подкрепя в постигането на целите ви. Важно е да следвате плана, но също така да слушате тялото си. Имате ли конкретен въпрос за храненията или нуждаете ли се от допълнителна мотивация?";
  }
}

/**
 * Parse AI response to structured format
 * Handles markdown code blocks, greedy regex issues, and common JSON formatting errors
 */

/**
 * Log AI communication to KV storage
 * Tracks all communication between backend and AI model
 */
async function logAIRequest(env, stepName, requestData) {
  try {
    if (!env.page_content) {
      console.warn('KV storage not configured, skipping AI request logging');
      return null;
    }

    // Check if logging is enabled (default to enabled if key doesn't exist or on error)
    try {
      const loggingEnabled = await env.page_content.get('ai_logging_enabled');
      if (loggingEnabled === 'false') {
        console.log('AI logging is disabled, skipping');
        return null;
      }
    } catch (error) {
      // On error reading KV, default to enabled (preserve original functionality)
      console.warn('Error checking logging status, defaulting to enabled:', error);
    }

    // Generate unique log ID
    const logId = generateUniqueId('ai_log');
    const timestamp = new Date().toISOString();
    
    // Get sessionId from requestData, or generate one if not provided (for backward compatibility with non-session calls)
    const sessionId = requestData.sessionId || generateUniqueId('auto_session');
    
    const logEntry = {
      id: logId,
      sessionId: sessionId,
      timestamp: timestamp,
      stepName: stepName,
      type: 'request',
      prompt: requestData.prompt || '',
      promptLength: requestData.prompt?.length || 0,
      estimatedInputTokens: requestData.estimatedInputTokens || 0,
      maxOutputTokens: requestData.maxTokens || null,
      provider: requestData.provider || 'unknown',
      modelName: requestData.modelName || 'unknown',
      // Include structured user data and calculations for export
      userData: requestData.userData || null,
      calculatedData: requestData.calculatedData || null
    };

    // Store individual log entry
    await env.page_content.put(`ai_communication_log:${logId}`, JSON.stringify(logEntry));
    
    // Get or create session index
    let sessionIndex = await env.page_content.get('ai_communication_session_index');
    sessionIndex = sessionIndex ? JSON.parse(sessionIndex) : [];
    
    // Add sessionId to index if not already present
    if (!sessionIndex.includes(sessionId)) {
      sessionIndex.unshift(sessionId); // Add to beginning (most recent first)
      
      // Keep only the last MAX_LOG_ENTRIES sessions
      if (sessionIndex.length > MAX_LOG_ENTRIES) {
        sessionIndex = sessionIndex.slice(0, MAX_LOG_ENTRIES);
      }
      
      await env.page_content.put('ai_communication_session_index', JSON.stringify(sessionIndex));
    }
    
    // Add log to session's log list
    let sessionLogs = await env.page_content.get(`ai_session_logs:${sessionId}`);
    sessionLogs = sessionLogs ? JSON.parse(sessionLogs) : [];
    sessionLogs.push(logId);
    await env.page_content.put(`ai_session_logs:${sessionId}`, JSON.stringify(sessionLogs));
    
    console.log(`AI request logged: ${stepName} (${logId}, session: ${sessionId})`);
    return logId;
  } catch (error) {
    console.error('Failed to log AI request:', error);
    return null;
  }
}

async function logAIResponse(env, logId, stepName, responseData) {
  try {
    if (!env.page_content || !logId) {
      console.warn('KV storage not configured or missing logId, skipping AI response logging');
      return;
    }

    // Check if logging is enabled (default to enabled if key doesn't exist or on error)
    try {
      const loggingEnabled = await env.page_content.get('ai_logging_enabled');
      if (loggingEnabled === 'false') {
        console.log('AI logging is disabled, skipping');
        return;
      }
    } catch (error) {
      // On error reading KV, default to enabled (preserve original functionality)
      console.warn('Error checking logging status, defaulting to enabled:', error);
    }

    const timestamp = new Date().toISOString();
    
    const logEntry = {
      id: logId,
      timestamp: timestamp,
      stepName: stepName,
      type: 'response',
      response: responseData.response || '',
      responseLength: responseData.response?.length || 0,
      estimatedOutputTokens: responseData.estimatedOutputTokens || 0,
      duration: responseData.duration || 0,
      success: responseData.success || false,
      error: responseData.error || null
    };

    // Update the log entry with response data
    await env.page_content.put(`ai_communication_log:${logId}_response`, JSON.stringify(logEntry));
    
    console.log(`AI response logged: ${stepName} (${logId})`);
  } catch (error) {
    console.error('Failed to log AI response:', error);
  }
}

/**
 * Generate user ID from data
 */

/**
 * Helper function to get KV key for prompt type
 */
function getPromptKVKey(type) {
  const keyMap = {
    'consultation': 'admin_consultation_prompt',
    'modification': 'admin_modification_prompt',
    'correction': 'admin_correction_prompt',
    'chat': 'admin_chat_prompt',
    'analysis': 'admin_analysis_prompt',
    'strategy': 'admin_strategy_prompt',
    'meal_plan': 'admin_meal_plan_prompt',
    'summary': 'admin_summary_prompt',
    'plan': 'admin_plan_prompt'
  };
  
  return keyMap[type] || 'admin_plan_prompt';
}

/**
 * Admin: Save AI prompt to KV
 */
async function handleSavePrompt(request, env) {
  try {
    const { type, prompt } = await request.json();
    
    // Type is required, but prompt can be empty (to revert to default)
    if (!type) {
      return jsonResponse({ error: 'Missing type' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const key = getPromptKVKey(type);
    
    // Save the prompt, even if empty (empty = use default)
    await env.page_content.put(key, prompt || '');
    
    // Invalidate chat prompts cache if consultation or modification prompt was updated
    if (type === 'consultation' || type === 'modification') {
      chatPromptsCache = null;
      chatPromptsCacheTime = 0;
    }
    
    return jsonResponse({ success: true, message: 'Prompt saved successfully' });
  } catch (error) {
    console.error('Error saving prompt:', error);
    return jsonResponse({ error: 'Failed to save prompt: ' + error.message }, 500);
  }
}

/**
 * Admin: Get AI prompt from KV
 */
async function handleGetPrompt(request, env) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'plan';

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const key = getPromptKVKey(type);
    const prompt = await env.page_content.get(key);
    
    return jsonResponse({ success: true, prompt: prompt || null });
  } catch (error) {
    console.error('Error getting prompt:', error);
    return jsonResponse({ error: 'Failed to get prompt: ' + error.message }, 500);
  }
}

/**
 * Get the actual default prompt templates used in generation functions
 * These are the prompts that will be used if no custom prompt is set in KV
 * This ensures the "View Standard Prompt" button shows the ACTUAL prompts from worker.js
 * 
 * IMPORTANT: These templates use {variable} placeholders that will be shown to admins in the UI.
 * The actual generation functions in generateAnalysisPrompt, generateStrategyPrompt, etc. 
 * use these same prompts but with ${data.field} JavaScript template literal syntax.
 * 
 * When viewing in admin panel, variables are shown as {variable} for clarity.
 * When used in generation, they are replaced with actual data values.
 */
function getDefaultPromptTemplates() {
  // NOTE: This function returns the COMPLETE template strings with {placeholders} for display in admin panel.
  // The actual generation functions use the same prompts but with ${data.field} syntax for JavaScript interpolation.
  // These are the REAL prompts used in production - copied directly from the generation functions.
  // 
  // MAINTENANCE: When updating prompts in generation functions, update these templates too!
  // - Keep the logic and structure identical
  // - Only change variable syntax from ${variable} to {variable}
  
  return {
    analysis: `Ти си експертен клиничен диетолог, ендокринолог и бихейвиорален психолог. 

ТВОЯТА ЗАДАЧА: Направи професионален ХОЛИСТИЧЕН АНАЛИЗ на здравословния и метаболитен профил на клиента.

ФОКУС: Анализирай КОРЕЛАЦИИТЕ между всички фактори и определи оптималните калорийни и макронутриентни нужди базирани на цялостната клинична картина.

═══ КЛИЕНТСКИ ПРОФИЛ ═══
{userData: JSON object with fields - name, age, gender, height, weight, goal, lossKg, sleepHours, sleepInterrupt, chronotype, sportActivity, dailyActivityLevel, stressLevel, waterIntake, drinksSweet, drinksAlcohol, overeatingFrequency, eatingHabits, foodCravings, foodTriggers, compensationMethods, socialComparison, medicalConditions, medications, medicationsDetails, weightChange, weightChangeDetails, dietHistory, dietType, dietResult, dietPreference, dietDislike, dietLove, additionalNotes}

{Conditionally shown if additionalNotes exists:
"═══ 🔥 КРИТИЧНО ВАЖНА ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ 🔥 ═══
⚠️ МАКСИМАЛЕН ПРИОРИТЕТ: Следната информация е предоставена директно от потребителя и ТРЯБВА да бъде взета предвид при ЦЕЛИЯ анализ, изчисления и препоръки.
Това може да променя критично анализа, стратегията и плана!

ДОПЪЛНИТЕЛНИ БЕЛЕЖКИ ОТ {name}:
{additionalNotes}

⚠️ ЗАДЪЛЖИТЕЛНО: Анализирай как тази информация влияе на:
1. Изчисленията на BMR/TDEE/Калории
2. Избора на диетична стратегия
3. Психологическия профил
4. Медицинските противопоказания
5. Храните и храненията в плана
═══════════════════════════════════════════════════════════════"}

═══ БАЗОВА ИНФОРМАЦИЯ ЗА ИЗЧИСЛЕНИЯ ═══
Основни физически параметри (за референция):
- Тегло: {weight} кг
- Височина: {height} см
- Възраст: {age} години
- Пол: {gender}
- Цел: {goal}
{Conditionally shown if lossKg exists: "- Желано отслабване: {lossKg} кг"}

═══ BACKEND РЕФЕРЕНТНИ ИЗЧИСЛЕНИЯ (Issues #2, #7, #9, #10, #28 - Feb 2026) ═══
{Backend auto-calculated values section - computed from calculateUnifiedActivityScore(), calculateBMR(), calculateTDEE(), calculateSafeDeficit(), calculateMacronutrientRatios()}

УНИФИЦИРАН АКТИВНОСТ СКОР (Issue #7):
- Дневна активност: {dailyActivityLevel} → {dailyScore}/3
- Спортна активност: {sportActivity} → ~{sportDays} дни
- КОМБИНИРАН СКОР: {combinedScore}/10 ({activityLevel})
- Формула: дневна активност (1-3) + спортни дни → скала 1-10

БАЗОВИ КАЛКУЛАЦИИ:
- BMR (Mifflin-St Jeor): {bmr} kcal
  * Мъж: 10×{weight} + 6.25×{height} - 5×{age} + 5
  * Жена: 10×{weight} + 6.25×{height} - 5×{age} - 161
  
- TDEE (Issue #10): {tdee} kcal
  * BMR × {activityFactor} (фактор за активност скор {combinedScore})
  * Нов множител базиран на 1-10 скала (не дублирани дефиниции)
  
- БЕЗОПАСЕН ДЕФИЦИТ (Issue #9): {targetCalories} kcal
  * Максимален дефицит: 25% ({maxDeficitCalories} kcal минимум)
  * Стандартен дефицит: {deficitPercent}%
  * AI може да коригира за специални стратегии (интермитентно гладуване и др.)

БАЗОВИ МАКРОНУТРИЕНТИ (Issue #2, #28 - НЕ циркулярна логика):
- Протеин: {protein}% ({proteinGramsPerKg}g/kg за {gender})
  * Протеинови нужди според пол: {gender}
  * Коригирано според активност скор {combinedScore}
- Въглехидрати: {carbs}%
- Мазнини: {fats}%
- СУМА: {sum}% (валидирано = 100%)
- Формула: процентно разпределение базирано на активност и цел

РЕФЕРЕНТНИТЕ изчисления са само ОТПРАВНА ТОЧКА за валидация. ТИ определяш финалните стойности според холистичния анализ.

═══ ТВОЯТА ЗАДАЧА - РАЗШИРЕН АНАЛИЗ ═══

Направи ХОЛИСТИЧЕН АНАЛИЗ, включващ следните стъпки:

1. BMI АНАЛИЗ:
   - Изчисли BMI = тегло(kg) / (височина(m))²
   - Категоризирай: Поднормено (<18.5), Нормално (18.5-25), Наднормено (25-30), Затлъстяване (>30)
   - Анализирай съответствие с целта

2. БАЗОВ МЕТАБОЛИЗЪМ (BMR) И TDEE:
   - Използвай Mifflin-St Jeor формулата (виж референтните изчисления)
   - Коригирай според активност скор 1-10 ({combinedScore}/10)
   - TDEE = BMR × активност фактор

3. СТАНДАРТ ЗА РАЗПРЕДЕЛЯНЕ НА МАКРОСИ:
   - Протеини: базирай на активност, цел и пол
   - Мазнини: необходими за хормонален баланс
   - Въглехидрати: според активност и метаболитен тип
   - Фибри: изчисли според пол, възраст и цел (обикновено персонализирай)

4. НИВО НА АКТИВНОСТ (скала 1-10):
   - Вече изчислено: {combinedScore}/10 ({activityLevel})
   - Анализирай как това влияе на калорийни нужди

5. ФИЗИОЛОГИЧНА ФАЗА В ЖИВОТА:
   - Възраст: {age} години
   - Определи фаза: Млад възрастен (18-30), Зряла възраст (31-50), Средна възраст (51-65), Напреднала възраст (65+)
   - Влияние на метаболизъм и хормонален профил

6. ДНЕВЕН ВОДЕН ДЕФИЦИТ (Water Gap):
   - Формула: (Тегло × множител) + базова нужда (базиран на активност)
   - Нужда: ({weight} × множител) + базова = изчислена нужда литра
   - Текущ прием: {waterIntake}
   - Изчисли дефицит и влияние върху липолизата

8. ОТРИЦАТЕЛНИ ЗДРАВОСЛОВНИ ФАКТОРИ (тежест 1-3):
   - Медицински състояния: {medicalConditions as JSON array}
   - Лекарства: {medications} - {medicationsDetails}
   - Оцени всеки фактор по скала 1 (леко) до 3 (тежко)

9. ПРЕЧЕЩИ ФАКТОРИ ЗА ПОСТИГАНЕ НА ЦЕЛТА (тежест 1-3):
   - Стрес: {stressLevel}
   - Качество на съня: {sleepHours}ч, прекъсвания: {sleepInterrupt}
   - Навици: {eatingHabits as JSON array}
   - Емоционални тригери: {foodTriggers as JSON array}
   - Оцени всеки по скала 1-3

10. СУМАРНИ ФАКТОРИ:
    - Където има припокриващи се фактори (напр. стрес + емоционално хранене), СУМИРАЙ числата
    - Създай сумарен риск профил

11. ХИПОТЕЗА ЗА ПСИХОПРОФИЛ И ТЕМПЕРАМЕНТ:
    - Анализирай данните за:
      * Хранителни желания: {foodCravings as JSON array}
      * Тригери: {foodTriggers as JSON array}
      * Копинг механизми: {compensationMethods as JSON array}
      * Социално сравнение: {socialComparison}
    - Определи вероятен темперамент с процент вероятност (само ако >80%)
    - Възможни типове: Холерик, Сангвиник, Флегматик, Меланхолик

11a. РЕАКТИВНОСТ НА МЕТАБОЛИЗМА:
    - Анализирай спрямо:
      * Активност скор: {combinedScore}/10
      * Физиологична фаза: {age} год.
      * Психопрофил (от т.11)
      * История на диети: {dietHistory}, {dietType}, {dietResult}
      * Хронотип: {chronotype}
      * Стрес: {stressLevel}
    - Определи: Бавен/Среден/Бърз метаболизъм
    - Адаптивност към промени: Ниска/Средна/Висока

12. КОРЕКЦИЯ НА РЕАЛЕН МЕТАБОЛИЗЪМ:
    - Коригирай BMR/TDEE според:
      * Точки 4, 5, 11, 11a
      * Качество на сън: {sleepHours}ч, {sleepInterrupt}
      * Хронотип: {chronotype}
      * Стрес: {stressLevel}
      * Здравен статус и медикаменти
    - Определи РЕАЛЕН метаболизъм (може да е ±10-20% от изчисления)

13. ИЗЧИСЛЯВАНЕ НА ПРЕПОРЪЧИТЕЛНИ КАЛОРИИ И МАКРОСИ:
    - Базирай на:
      * Коригиран метаболизъм (т.12)
      * Реактивност (т.11a)
      * Активност, възраст, психопрофил
      * Хронотип и оптимални енергийни прозорци
      * Здравен статус и медикаменти
    - Определи ФИНАЛНИ препоръки

14. КРИТИЧНИ ПРОБЛЕМИ (3-6 бр.):
    - Започни от сумарния риск (т.10)
    - Включи най-тежките от т.9 и т.8
    - Представи ги по КРИТИЧЕН И ПЛАШЕЩ начин
    - САМО Borderline/Risky/Critical severity

15. ЗДРАВОСЛОВНО СЪСТОЯНИЕ В МОМЕНТА:
    - Базирано на целия анализ
    - Изведи с 10% ЗАНИЖЕНО (по-песимистична оценка за мотивация)
    - Скала: 0-100

16. ПРОГНОЗА - ПЕСИМИСТИЧНА (1 година):
    - Ако клиентът ПРОДЪЛЖИ по същия начин
    - Какви здравни рискове ще се развият
    - Къде ще бъде след 12 месеца (тегло, здраве, енергия)

17. ПРОГНОЗА - ОПТИМИСТИЧНА (1 година):
    - След подобряване на ВСИЧКИ проблемни параметри
    - Какви подобрения са възможни
    - Къде може да бъде след 12 месеца (тегло, здраве, енергия)

═══ ФОРМАТ НА ОТГОВОР ═══

{
  "bmi": число,
  "bmiCategory": "текст категория",
  "bmr": число,
  "tdee": число,
  "recommendedCalories": число,
  "macroRatios": {
    "protein": число процент,
    "carbs": число процент,
    "fats": число процент,
    "fiber": число грамове дневно
  },
  "macroGrams": {
    "protein": число грамове,
    "carbs": число грамове,
    "fats": число грамове
  },
  "activityLevel": "ниво 1-10 и описание",
  "physiologicalPhase": "фаза според възраст и влияние",
  "waterDeficit": {
    "dailyNeed": "литри дневно (формула)",
    "currentIntake": "текущ прием",
    "deficit": "дефицит в литри",
    "impactOnLipolysis": "влияние върху отслабването"
  },
  "negativeHealthFactors": [
    {
      "factor": "фактор",
      "severity": число 1-3,
      "description": "описание"
    }
  ],
  "hinderingFactors": [
    {
      "factor": "фактор",
      "severity": число 1-3,
      "description": "описание"
    }
  ],
  "cumulativeRiskScore": "сума на припокриващи се фактори",
  "psychoProfile": {
    "temperament": "тип (само ако >80% вероятност)",
    "probability": число процент
  },
  "metabolicReactivity": {
    "speed": "Бавен/Среден/Бърз",
    "adaptability": "Ниска/Средна/Висока"
  },
  "correctedMetabolism": {
    "realBMR": число,
    "realTDEE": число,
    "correction": "описание на корекцията",
    "correctionPercent": "+/-X%"
  },
  "metabolicProfile": "анализ на метаболитния профил",
  "healthRisks": ["риск 1", "риск 2", "риск 3"],
  "nutritionalNeeds": ["нужда 1", "нужда 2", "нужда 3"],
  "psychologicalProfile": "детайлен анализ на психологическия профил",
  "successChance": число (-100 до 100),
  "currentHealthStatus": {
    "score": число 0-100 (ЗАНИЖЕНО с 10%),
    "description": "текущо състояние",
    "keyIssues": ["проблем 1", "проблем 2"]
  },
  "forecastPessimistic": {
    "timeframe": "12 месеца",
    "weight": "прогнозно тегло",
    "health": "прогнозно здраве",
    "risks": ["риск 1", "риск 2"]
  },
  "forecastOptimistic": {
    "timeframe": "12 месеца",
    "weight": "прогнозно тегло",
    "health": "прогнозно здраве",
    "improvements": ["подобрение 1", "подобрение 2"]
  },
  "keyProblems": [
    {
      "title": "заглавие (кратко)",
      "description": "КРИТИЧНО и ПЛАШЕЩО описание защо е проблем",
      "severity": "Borderline/Risky/Critical",
      "severityValue": число 0-100,
      "category": "Sleep/Nutrition/Hydration/Stress/Activity/Medical",
      "impact": "въздействие върху здравето и целта"
    }
  ]
}

Бъди КОНКРЕТЕН за {name}. Обяснявай ЗАЩО и КАК, не просто "добър" или "лош".
ВАЖНО: Направи анализ, който е индивидуализиран и базиран на ВСИЧКИ предоставени данни.`,

    strategy: `Базирайки се на здравословния профил и анализа, определи оптималната диетична стратегия:

КЛИЕНТ: {name}, {age} год., Цел: {goal}

АНАЛИЗ (КОМПАКТЕН):
- BMR/TDEE/Калории: {bmr} / {tdee} / {recommendedCalories}
- Макро съотношения: {macroRatios}
- Макро грамове дневно: {macroGrams}
- Метаболитен профил: {metabolicProfile}
- Здравни рискове: {healthRisks}
- Хранителни нужди: {nutritionalNeeds}
- Психологически профил: {psychologicalProfile}
- Шанс за успех: {successChance}
- Ключови проблеми: {keyProblems}

ПРЕДПОЧИТАНИЯ:
- Диетични предпочитания: {dietPreference as JSON array}
{Conditionally shown if dietPreference_other exists: "  (Друго: {dietPreference_other})"}
- Не обича/непоносимост: {dietDislike}
- Любими храни: {dietLove}

{Conditionally shown if additionalNotes exists:
"═══ 🔥 КРИТИЧНО ВАЖНА ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ 🔥 ═══
⚠️ МАКСИМАЛЕН ПРИОРИТЕТ: Следната информация е предоставена директно от потребителя и ТРЯБВА да се взема предвид при създаването на стратегията!
Това може да променя критично избора на модификатор, брой хранения, време на хранене и цялостния подход!

ДОПЪЛНИТЕЛНИ БЕЛЕЖКИ ОТ {name}:
{additionalNotes}

⚠️ ЗАДЪЛЖИТЕЛНО: Адаптирай стратегията на база тази информация, особено:
1. Избора на dietaryModifier и modifierReasoning
2. Времето на хранене (mealTiming)
3. Броя хранения (mealCountJustification)
4. Психологическата подкрепа и дългосрочна стратегия
5. Специфични хранителни препоръки
═══════════════════════════════════════════════════════════════"}

ВАЖНО: Анализирай холистично всички фактори и създай индивидуализирана стратегия за {name}.
Фокусирай се на постигането на здравословните цели и запазването на здравето на клиента.

═══ СПЕЦИАЛНИ ИЗИСКВАНИЯ ЗА СЕДМИЧНА СХЕМА ═══

1. ОПРЕДЕЛЯНЕ НА СЕДМИЧНА СХЕМА:
   - Определи за всеки ден: колко хранения и кога
   - Адаптирай според:
     * Хранителни навици: {eatingHabits as JSON array}
     * Хронотип: {chronotype}
     * Психопрофил от анализа
     * Цел: {goal}

2. СПЕЦИАЛНИ СЛУЧАИ:
   a) Ако клиентът НЕ ЗАКУСВА:
      - Закуската ОТПАДА
      - ПРЕПОРЪЧАЙ вместо нея: вода с лимон, зелен чай, айран, или друга подходяща напитка
      - Обясни в mealTiming защо това е подходящо
   
   b) СВОБОДНО ХРАНЕНЕ/ЛЮБИМА ХРАНА:
      - Ако е подходящо според психопрофил, ВКЛЮЧИ свободно хранене
      - Препоръчително: НЕДЕЛЯ ЗА ОБЯД
      - След свободното хранене: ЛЕКА ВЕЧЕРЯ
      - Обясни стратегическата стойност на това
   
   c) ФАСТИНГ И ЦИКЛИЧНИ СХЕМИ:
      - Ако е подходящо: интермитентно гладуване (16:8, 18:6)
      - Ако е подходящо: carb cycling (високо/ниско въглехидрати)
      - Ако е подходящо: зареждащи и разреждащи дни
      - Обясни физиологичната логика

3. РАЗПРЕДЕЛЯНЕ НА КАЛОРИИ И МАКРОСИ:
   - Определи за ВСЕКИ ДЕН: препоръчителни калории
   - Определи за ВСЯКО ХРАНЕНЕ: калории и макрос баланс
   - Варирай според:
     * Ден от седмицата (работни/почивни дни)
     * Хронотип (сутрешни/вечерни енергийни пикове)
     * Физическа активност

4. НАЧИН НА КОМУНИКАЦИЯ:
   - Адаптирай комуникацията според психопрофил от анализа
   - Ако темперамент е определен (>80% вероятност):
     * Холерик: Директен, фокусиран на резултати, кратки обяснения
     * Сангвиник: Позитивен, вдъхновяващ, разнообразие
     * Флегматик: Спокоен, постепенен, без натиск
     * Меланхолик: Детайлен, научно обоснован, емпатичен
   - Това ще влияе на:
     * Тон на welcomeMessage
     * Стил на обосновки
     * Психологическа подкрепа
     * Бъдеща комуникация с AI асистента

Върни JSON със стратегия:
{
  "dietaryModifier": "diet profile term (e.g. Balanced, Keto, Vegan, Mediterranean)",
  "welcomeMessage": "REQUIRED: Personalized welcome for {name} (150-250 words, specific)",
  "planJustification": "REQUIRED: Strategy justification (min 100 chars)",
  "longTermStrategy": "long-term approach (2-3 days/week, cycling)",
  "mealCountJustification": "meal count reasoning (1-5)",
  "afterDinnerMealJustification": "after-dinner reasoning OR 'Not needed'",
  "dietType": "diet type for {name}",
  "weeklyMealPattern": "weekly pattern (e.g. 16:8 IF, 5:2, cyclic, traditional)",
  "weeklyScheme": {
    "monday": {"meals": number, "description": "text"},
    "tuesday": {"meals": number, "description": "text"},
    "wednesday": {"meals": number, "description": "text"},
    "thursday": {"meals": number, "description": "text"},
    "friday": {"meals": number, "description": "text"},
    "saturday": {"meals": number, "description": "text"},
    "sunday": {"meals": number, "description": "text (include free meal='свободно хранене' if appropriate)"}
  },
  "breakfastStrategy": "if no breakfast: recommended drinks",
  "calorieDistribution": "calorie distribution by days/meals",
  "macroDistribution": "macro distribution by days/meals",
  "mealTiming": {
    "pattern": "weekly pattern (no exact hours, use concepts)",
    "fastingWindows": "fasting periods if applicable",
    "flexibility": "flexibility description",
    "chronotypeGuidance": "HOW chronotype {chronotype} affects timing"
  },
  "keyPrinciples": ["principle 1 for {name}", "principle 2", "principle 3"],
  "foodsToInclude": ["food 1 for {name}", "food 2", "food 3"],
  "foodsToAvoid": ["food 1 avoid for {name}", "food 2", "food 3"],
  "supplementRecommendations": ["supplement 1 (dose+reason)", "supplement 2 (dose+reason)", "supplement 3 (dose+reason)"],
  "hydrationStrategy": "hydration recommendations for {name}",
  "communicationStyle": {
    "temperament": "temperament from analysis (if >80%)",
    "tone": "communication tone",
    "approach": "communication approach",
    "chatGuidelines": "how AI assistant should communicate with {name}"
  },
  "psychologicalSupport": [
  },
  "psychologicalSupport": ["psycho tip 1 for {name}", "psycho tip 2", "psycho tip 3"]
}

Create personalized strategy for {name} based on unique profile.`,

    meal_plan: `You act as Advanced Dietary Logic Engine (ADLE) – logical meal plan constructor.

=== CRITICAL - NO DEFAULT VALUES ===
- This plan is ONLY for {name}
- FORBIDDEN to use universal/generic/standard values
- ALL calories, macros, recommendations are INDIVIDUALLY calculated
- Supplements are PERSONALLY selected per analysis and needs
- Psycho tips are based on SPECIFIC emotional profile of {name}

=== DIET MODIFIER (User profile) ===
ОПРЕДЕЛЕН МОДИФИКАТОР ЗА КЛИЕНТА: "{dietaryModifier}"
{Conditionally shown if modifierReasoning exists: "ОБОСНОВКА: {modifierReasoning}"}

=== КЛИЕНТ И ЦЕЛИ ===
Име: {name}, Възраст: {age}, Пол: {gender}
Цел: {goal}
BMR (изчислен): {bmr} kcal
Препоръчан калориен прием: {recommendedCalories} kcal/ден

=== СТРАТЕГИЯ (КОМПАКТНА) ===
Тип: {dietType}
Хранене: {mealTiming}
Принципи: {keyPrinciples}
Включвай: {foodsToInclude}
Избягвай: {foodsToAvoid}

{modificationsSection - dynamic content from modifications}

{dynamicWhitelistSection - dynamic content from KV storage}
{dynamicBlacklistSection - dynamic content from KV storage}

=== АРХИТЕКТУРА НА ХРАНИТЕ (AFAM) ===
Базови категории (от които се избират храни според модификатора):
- [PRO]: Протеинови източници (месо, риба, яйца, протеин на прах)
- [ENG]: Енергийни източници (зърнени, ориз, паста, картофи, тестени)
- [VOL]: Обемни/фибърни (зеленчуци, салати, зелени храни)
- [FAT]: Мазнини (масло, олио, ядки, семки, авокадо)
- [CMPX]: Комплексни ястия (пълни готови ястия, супи, гозби)

=== ЛОГИКА ЗА КОМБИНИРАНЕ ===
ШАБЛОНИ ЗА ХРАНЕНИЯ:
A) PRO + ENG + VOL + FAT (класическо пълно хранене, напр. пиле с ориз и салата)
B) PRO + VOL + FAT (ниско въглехидратно, напр. риба със зеленчуци)
C) CMPX (цяло готово ястие, напр. яхния, супа)
D) ENG + FAT (бърза закуска, напр. овесена каша с ядки)

ОГРАНИЧЕНИЯ:
- Един топъл обяд (CMPX) дневно е ДОСТАТЪЧЕН
- Не са нужни комплексни готвени ястия за ВСЯКО хранене
- Разнообразие = различни КОМПОНЕНТИ, не различно готвене
- След обяд с пълна гозба → вечеря по-лека
- Никога обяд И вечеря тежки/сложни същия ден

=== ЗАДАЧА ===
Генерирай 7-дневен хранителен план (day1-day7) като използваш модификатора за филтриране на позволени храни.
За ВСЕКИ ДЕН:
- {mealCount or 3} хранения ПО РЕДА НА ХРАНЕНЕ (Закуска първо, после Обяд, след това Вечеря...)
- Прилагай правилата за комбиниране
- Всяко ястие с name, time, calories, macros (protein, carbs, fats, fiber)
- Седмично мислене: РАЗНООБРАЗИЕ между дните

{Conditionally shown if errorPreventionComment exists: "
=== КОРЕКЦИИ НА ГРЕШКИ ===
{errorPreventionComment}
"}

JSON ФОРМАТ:
{
  "day1": {
    "meals": [
      {"name": "...", "time": "...", "calories": число, "macros": {...}},
      ...
    ]
  },
  ...
  "day7": {...}
}

=== ИНДИВИДУАЛНИ ИЗИСКВАНИЯ ===
- Медицински: {medicalConditions as JSON array}
- Предпочитания: {dietPreference as JSON array}
- Избягвай: {dietDislike}
- Включвай: {dietLove}

ВАЖНО: Използвай strategy.planJustification, strategy.longTermStrategy, strategy.mealCountJustification и strategy.afterDinnerMealJustification за обосновка на всички нестандартни решения. "recommendations"/"forbidden"=САМО конкретни храни. Всички 7 дни (day1-day7) с 1-5 хранения В ПРАВИЛЕН ХРОНОЛОГИЧЕН РЕД. Точни калории/макроси за всяко ястие. Около {recommendedCalories} kcal/ден като ориентир (може да варира при многодневно планиране). Седмичен подход: МИСЛИ СЕДМИЧНО/МНОГОДНЕВНО - ЦЯЛОСТНА схема като система. ВСИЧКИ 7 дни (day1-day7) ЗАДЪЛЖИТЕЛНО.

Създай пълния 7-дневен план с балансирани, индивидуални ястия за {name}, следвайки стратегията.`,

    summary: `Summary за 7-дневен план.

КЛИЕНТ: {name}, Цел: {goal}, BMR: {bmr}
Целеви: {recommendedCalories} kcal/ден | Реален: {avgCalories} kcal/ден
Макроси: Protein {avgProtein}g, Carbs {avgCarbs}g, Fats {avgFats}g

ЗДРАВНИ ДАННИ: Проблеми: {keyProblems} | Алергии: {allergies} | Медикаменти: {medications}
{dynamicWhitelistSection - dynamic content from KV storage}
{dynamicBlacklistSection - dynamic content from KV storage}

JSON:
{
  "summary": {"bmr": {bmr}, "dailyCalories": {avgCalories}, "macros": {"protein": {avgProtein}, "carbs": {avgCarbs}, "fats": {avgFats}}},
  "recommendations": ["храна 1", "храна 2", "храна 3"],
  "forbidden": ["храна 1", "храна 2"],
  "psychology": {psychologicalSupport array from strategy - first 3 items or ["съвет 1", "съвет 2"]},
  "waterIntake": "{hydrationStrategy or default '2-2.5л дневно'}",
  "supplements": ["добавка 1 (дозировка)", "добавка 2 (дозировка)"]
}

ВАЖНО: recommendations/forbidden=конкретни храни; supplements=според здравен статус и медикаменти с дозировка`,

    consultation: `ТЕКУЩ РЕЖИМ: КОНСУЛТАЦИЯ

ВАЖНИ ПРАВИЛА:
1. Можеш да четеш плана, но НЕ МОЖЕШ да го променяш.
2. Бъди КРАТЪК но информативен - максимум 3-4 изречения, прост език.
3. Ако клиентът иска промяна, кажи: "За промяна активирай режима за промяна на плана."
4. НИКОГА не използвай [REGENERATE_PLAN:...] инструкции.
5. Винаги поддържай мотивиращ тон.
6. Форматирай отговорите си ясно - използвай нови редове за разделяне на мисли.
7. Задавай максимум 1 въпрос на отговор.

ПРИМЕРИ:
- "Закуската съдържа овесени ядки с банан (350 калории). За промяна, активирай режима за промяна."
- "Можеш да замениш рибата с пилешко - и двете са отлични източници на протеин. За промяна, активирай режима за промяна."`,

    modification: `ТЕКУЩ РЕЖИМ: ПРОМЯНА НА ПЛАНА

ВАЖНИ ПРАВИЛА:
1. Ти си професионален диетолог. Бъди КРАТЪК но информативен, ЯСЕН и директен.
2. Използвай ПРОСТ език, лесно разбираем.
3. Ограничи се до МАКСИМУМ 3-4 изречения в отговор.
4. Задавай МАКСИМУМ 1 въпрос на отговор.
5. Форматирай отговорите си ясно:
   - Използвай нови редове за разделяне на различни мисли
   - Когато изброяваш опции, сложи всяка на нов ред с тире (-)
   - Използвай празни редове за по-добра четимост между параграфи

2. Когато клиентът иска промяна:
   - Анализирай дали е здравословно за цел: {goal}
   - Обясни КРАТКО последиците (само основното)
   - Ако има по-добра алтернатива, предложи я с 1 изречение
   - Запитай с 1 въпрос за потвърждение
   - След потвърждение, приложи с [REGENERATE_PLAN:{"modifications":["описание"]}]

3. РАЗПОЗНАВАНЕ НА ПОТВЪРЖДЕНИЕ:
   - "да", "yes", "добре", "ок", "окей", "сигурен", "сигурна" = ПОТВЪРЖДЕНИЕ
   - Ако клиентът потвърди (каже "да"), НЕ питай отново! Приложи промяната ВЕДНАГА.
   - Ако вече си задавал същия въпрос в историята, НЕ го питай отново - приложи промяната!
   - НИКОГА не задавай един и същ въпрос повече от ВЕДНЪЖ.

4. НИКОГА не прилагай директно промяна без обсъждане! Винаги обясни и консултирай първо.

5. ЗА ПРЕМАХВАНЕ НА КОНКРЕТНИ ХРАНИ:
   - Ако клиентът иска да премахне конкретна храна (напр. "овесени ядки"), използвай специален модификатор:
   - Формат: "exclude_food:име_на_храната" (напр. "exclude_food:овесени ядки")
   - Пример: [REGENERATE_PLAN:{"modifications":["exclude_food:овесени ядки"]}]
   - Това ще регенерира плана БЕЗ тази храна

6. ПРИМЕР С ФОРМАТИРАНЕ:
   Клиент: "премахни междинните хранения"
   
   Отговор: "Разбирам. Премахването може да опрости храненето, но може и да доведе до преяждане.
   
   За твоята цел препоръчвам една от двете:
   - Премахване на всички междинни хранения (само 3 основни)
   - Оставяне на 1 здравословна закуска (по-балансирано)
   
   Какво предпочиташ?"
   
   [ЧАКАЙ потвърждение преди REGENERATE_PLAN]
   
   Клиент: "да" или "добре, премахни всички"
   
   Отговор: "✓ Разбрано! Регенерирам плана със 3 основни хранения.
   
   [REGENERATE_PLAN:{"modifications":["3_meals_per_day"]}]"
   
   ПРИМЕР ЗА ПРЕМАХВАНЕ НА ХРАНА:
   Клиент: "махни овесените ядки"
   
   Отговор: "Разбирам. Премахването на овесените ядки ще намали фибрите в закуската.
   
   Искаш ли да ги премахна от всички дни?"
   
   Клиент: "да"
   
   Отговор: "✓ Разбрано! Премахвам овесените ядки от плана.
   
   [REGENERATE_PLAN:{"modifications":["exclude_food:овесени ядки"]}]"

7. ПОДДЪРЖАНИ МОДИФИКАЦИИ:
   - "no_intermediate_meals" - без междинни хранения
   - "3_meals_per_day" - 3 хранения дневно
   - "4_meals_per_day" - 4 хранения дневно
   - "vegetarian" - вегетариански план
   - "no_dairy" - без млечни продукти
   - "low_carb" - нисковъглехидратна диета
   - "increase_protein" - повече протеини
   - "exclude_food:име_на_храна" - премахване на конкретна храна

ПОМНИ: 
- Форматирай ясно с нови редове и изброяване
- Максимум 3-4 изречения
- Максимум 1 въпрос
- АКО клиентът вече потвърди, НЕ питай отново - ПРИЛОЖИ ВЕДНАГА!`,

    correction: `Ти си експертен диетолог и трябва да КОРИГИРАШ хранителен план, който има следните проблеми:

═══ ГРЕШКИ ЗА КОРИГИРАНЕ ═══
{validationErrors formatted list - numbered errors like "1. Missing calories", "2. Invalid macros", etc.}

═══ ТЕКУЩ ПЛАН (С ГРЕШКИ) ═══
{plan as JSON - full plan object that failed validation}

═══ КЛИЕНТСКИ ДАННИ ═══
{userData as JSON - essential fields: name, age, gender, goal, medicalConditions, dietPreference, dietDislike, dietLove, additionalNotes}

{Conditionally shown if additionalNotes exists:
"═══ 🔥 КРИТИЧНО ВАЖНА ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ 🔥 ═══
⚠️ МАКСИМАЛЕН ПРИОРИТЕТ при корекциите!

ДОПЪЛНИТЕЛНИ БЕЛЕЖКИ ОТ {name}:
{additionalNotes}

⚠️ ЗАДЪЛЖИТЕЛНО: Всички корекции трябва да уважават тази информация!
═══════════════════════════════════════════════════════════════"}

═══ ПРАВИЛА ЗА КОРИГИРАНЕ ═══

{MEAL_NAME_FORMAT_INSTRUCTIONS - detailed formatting rules for meal names and descriptions}

ВАЖНО - СТРАТЕГИЯ И ОБОСНОВКА:
1. ВСЯКА корекция ТРЯБВА да бъде обоснована
2. Ако добавяш/променяш хранения, обясни ЗАЩО в strategy.planJustification
3. Ако добавяш хранения след вечеря, обясни причината в strategy.afterDinnerMealJustification
4. Ако променяш броя хранения, обясни в strategy.mealCountJustification
5. При многодневно планиране, обясни подхода в strategy.longTermStrategy

ТИПОВЕ ХРАНЕНИЯ И РЕД:
1. ПОЗВОЛЕНИ ТИПОВЕ ХРАНЕНИЯ (в хронологичен ред):
   - "Закуска" (сутрин)
   - "Обяд" (обед)
   - "Следобедна закуска" (опционално, след обяд)
   - "Вечеря" (вечер)
   - "Късна закуска" (опционално, след вечеря - С ОБОСНОВКА!)

2. БРОЙ ХРАНЕНИЯ: 1-5 на ден
   - ЗАДЪЛЖИТЕЛНО обоснови избора в strategy.mealCountJustification

3. ХРАНЕНИЯ СЛЕД ВЕЧЕРЯ - разрешени С ОБОСНОВКА:
   - Физиологична причина (диабет, дълъг период до сън, проблеми със съня)
   - Психологическа причина (управление на стрес)
   - Стратегическа причина (спортни тренировки вечер, работа на смени)
   - ДОБАВИ обосновката в strategy.afterDinnerMealJustification!
   - Предпочитай ниско-гликемични храни (кисело мляко, ядки, ягоди, семена)

4. МНОГОДНЕВЕН ХОРИЗОНТ:
   - Може да планираш 2-3 дни като цяло при обоснована стратегия
   - Циклично разпределение на калории/макроси е позволено
   - ОБЯСНИ в strategy.longTermStrategy

5. МЕДИЦИНСКИ ИЗИСКВАНИЯ:
   - При диабет: НЕ високовъглехидратни храни
   - При анемия + вегетарианство: добавка с желязо ЗАДЪЛЖИТЕЛНА
   - При PCOS/СПКЯ: предпочитай нисковъглехидратни варианти
   - Спазвай медицинските условия от клиентските данни

6. КАЛОРИИ И МАКРОСИ:
   - Всяко хранене ТРЯБВА да има "calories", "macros" (protein, carbs, fats, fiber)
   - Дневни калории минимум {MIN_DAILY_CALORIES constant} kcal (може да варират между дни)
   - Прецизни изчисления: 1г протеин=4kcal, 1г въглехидрати=4kcal, 1г мазнини=9kcal

7. СТРУКТУРА:
   - Всички 7 дни (day1-day7) ЗАДЪЛЖИТЕЛНО
   - 1-5 хранения на ден (ОБОСНОВАНИ в strategy)
   - Избягвай храни които клиентът не обича
   - Включвай любими храни където е подходящо

═══ ТВОЯТА ЗАДАЧА ═══
Коригирай проблемните части и ДОБАВИ ОБОСНОВКИ в strategy полетата:
- strategy.planJustification - обща обосновка на плана
- strategy.mealCountJustification - защо този брой хранения
- strategy.afterDinnerMealJustification - защо хранения след вечеря (ако има)
- strategy.longTermStrategy - многодневна стратегия (ако има)

Върни ПЪЛНИЯ КОРИГИРАН план в същия JSON формат като оригиналния.

ВАЖНО: Върни САМО JSON без допълнителни обяснения!`
  };
}

/**
 * Admin: Get default prompt for viewing in admin panel
 * Uses getDefaultPromptTemplates() to ensure we show the ACTUAL prompts used in generation
 */
async function handleGetDefaultPrompt(request, env) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    
    if (!type) {
      return jsonResponse({ error: 'Missing prompt type parameter' }, 400);
    }
    
    const defaultPrompts = getDefaultPromptTemplates();
    const prompt = defaultPrompts[type];
    
    if (!prompt) {
      return jsonResponse({ 
        error: `Unknown prompt type: ${type}. Valid types: analysis, strategy, meal_plan, summary, consultation, modification, correction` 
      }, 400);
    }
    
    return jsonResponse({ success: true, prompt: prompt }, 200, {
      cacheControl: 'public, max-age=1800' // Cache for 30 minutes - default prompts rarely change
    });
  } catch (error) {
    console.error('Error getting default prompt:', error);
    return jsonResponse({ error: 'Failed to get default prompt: ' + error.message }, 500);
  }
}

/**
 * Admin: Save AI model preference to KV
 */
async function handleSaveModel(request, env) {
  try {
    const { provider, modelName } = await request.json();
    
    if (!provider || !modelName) {
      return jsonResponse({ error: 'Missing provider or modelName' }, 400);
    }

    if (!['openai', 'google', 'mock'].includes(provider)) {
      return jsonResponse({ error: 'Invalid provider type' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Use Promise.all to save both values in parallel
    await Promise.all([
      env.page_content.put('admin_ai_provider', provider),
      env.page_content.put('admin_ai_model_name', modelName)
    ]);
    
    // Invalidate cache so next request gets fresh config
    adminConfigCache = null;
    adminConfigCacheTime = 0;
    
    return jsonResponse({ success: true, message: 'Model saved successfully' });
  } catch (error) {
    console.error('Error saving model:', error);
    return jsonResponse({ error: 'Failed to save model: ' + error.message }, 500);
  }
}

/**
 * Admin: Get admin configuration from KV
 */
async function handleGetConfig(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Use Promise.all to fetch all config values in parallel (reduces sequential KV reads)
    const [
      provider, 
      modelName, 
      planPrompt, 
      chatPrompt, 
      consultationPrompt, 
      modificationPrompt,
      analysisPrompt,
      strategyPrompt,
      mealPlanPrompt,
      summaryPrompt,
      correctionPrompt
    ] = await Promise.all([
      env.page_content.get('admin_ai_provider'),
      env.page_content.get('admin_ai_model_name'),
      env.page_content.get('admin_plan_prompt'),
      env.page_content.get('admin_chat_prompt'),
      env.page_content.get('admin_consultation_prompt'),
      env.page_content.get('admin_modification_prompt'),
      env.page_content.get('admin_analysis_prompt'),
      env.page_content.get('admin_strategy_prompt'),
      env.page_content.get('admin_meal_plan_prompt'),
      env.page_content.get('admin_summary_prompt'),
      env.page_content.get('admin_correction_prompt')
    ]);
    
    return jsonResponse({ 
      success: true, 
      provider: provider || 'openai',
      modelName: modelName || 'gpt-4o-mini',
      planPrompt,
      chatPrompt,
      consultationPrompt,
      modificationPrompt,
      analysisPrompt,
      strategyPrompt,
      mealPlanPrompt,
      summaryPrompt,
      correctionPrompt
    }, 200, {
      cacheControl: 'public, max-age=300' // Cache for 5 minutes - config changes infrequently
    });
  } catch (error) {
    console.error('Error getting config:', error);
    return jsonResponse({ error: 'Failed to get config: ' + error.message }, 500);
  }
}

/**
 * Get AI communication logs
 * Returns logged AI requests and responses for monitoring and debugging
 */
async function handleGetAILogs(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    
    // Try to get session index first (new format)
    let sessionIndex = await env.page_content.get('ai_communication_session_index');
    
    if (sessionIndex) {
      // New session-based format
      const sessionIds = JSON.parse(sessionIndex);
      
      if (sessionIds.length === 0) {
        return jsonResponse({ success: true, logs: [], total: 0 });
      }
      
      // Get all log IDs from ALL sessions (not just the latest one)
      const allLogIds = [];
      for (const sessionId of sessionIds) {
        const sessionLogsData = await env.page_content.get(`ai_session_logs:${sessionId}`);
        if (sessionLogsData) {
          const sessionLogIds = JSON.parse(sessionLogsData);
          allLogIds.push(...sessionLogIds);
        }
      }
      
      if (allLogIds.length === 0) {
        return jsonResponse({ success: true, logs: [], total: 0 });
      }
      
      const total = allLogIds.length;
      
      // Apply pagination
      const paginatedIds = allLogIds.slice(offset, offset + limit);
      
      // Fetch logs in parallel
      const logPromises = paginatedIds.flatMap(logId => [
        env.page_content.get(`ai_communication_log:${logId}`),
        env.page_content.get(`ai_communication_log:${logId}_response`)
      ]);
      
      const logData = await Promise.all(logPromises);
      
      // Combine request and response logs
      const logs = [];
      for (let i = 0; i < paginatedIds.length; i++) {
        const requestLog = logData[i * 2] ? JSON.parse(logData[i * 2]) : null;
        const responseLog = logData[i * 2 + 1] ? JSON.parse(logData[i * 2 + 1]) : null;
        
        if (requestLog) {
          logs.push({
            ...requestLog,
            response: responseLog
          });
        }
      }
      
      return jsonResponse({ 
        success: true, 
        logs: logs,
        total: total,
        limit: limit,
        offset: offset,
        sessionCount: sessionIds.length
      }, 200, {
        cacheControl: 'public, max-age=60' // Cache for 1 minute - logs are frequently updated
      });
    } else {
      // Fallback to old log index format for backward compatibility
      const logIndex = await env.page_content.get('ai_communication_log_index');
      if (!logIndex) {
        return jsonResponse({ success: true, logs: [], total: 0 });
      }
      
      const logIds = JSON.parse(logIndex);
      const total = logIds.length;
      
      // Apply pagination
      const paginatedIds = logIds.slice(offset, offset + limit);
      
      // Fetch logs in parallel
      const logPromises = paginatedIds.flatMap(logId => [
        env.page_content.get(`ai_communication_log:${logId}`),
        env.page_content.get(`ai_communication_log:${logId}_response`)
      ]);
      
      const logData = await Promise.all(logPromises);
      
      // Combine request and response logs
      const logs = [];
      for (let i = 0; i < paginatedIds.length; i++) {
        const requestLog = logData[i * 2] ? JSON.parse(logData[i * 2]) : null;
        const responseLog = logData[i * 2 + 1] ? JSON.parse(logData[i * 2 + 1]) : null;
        
        if (requestLog) {
          logs.push({
            ...requestLog,
            response: responseLog
          });
        }
      }
      
      return jsonResponse({ 
        success: true, 
        logs: logs,
        total: total,
        limit: limit,
        offset: offset
      }, 200, {
        cacheControl: 'public, max-age=60' // Cache for 1 minute - logs are frequently updated
      });
    }
  } catch (error) {
    console.error('Error getting AI logs:', error);
    return jsonResponse({ error: 'Failed to get AI logs: ' + error.message }, 500);
  }
}

/**
 * Cleanup AI logs - delete all previous logs and keep only the most recent one
 */
async function handleCleanupAILogs(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Get log index
    const logIndex = await env.page_content.get('ai_communication_log_index');
    if (!logIndex) {
      return jsonResponse({ success: true, message: 'No logs to cleanup', deletedCount: 0 });
    }
    
    let logIds;
    try {
      logIds = JSON.parse(logIndex);
    } catch (parseError) {
      console.error('Failed to parse log index:', parseError);
      return jsonResponse({ error: 'Invalid log index format' }, 500);
    }
    
    if (logIds.length === 0) {
      return jsonResponse({ success: true, message: 'No logs to cleanup', deletedCount: 0 });
    }
    
    // Keep only the most recent log (first in the array)
    const recentLogId = logIds[0];
    const logsToDelete = logIds.slice(1);
    
    // Delete old log entries
    // Note: This operation is not atomic and may have race conditions if called concurrently
    // However, this is an admin-only function and concurrent calls are unlikely
    if (logsToDelete.length > 0) {
      const deletePromises = logsToDelete.flatMap(id => [
        env.page_content.delete(`ai_communication_log:${id}`),
        env.page_content.delete(`ai_communication_log:${id}_response`)
      ]);
      
      await Promise.all(deletePromises);
    }
    
    // Update log index to contain only the most recent log
    await env.page_content.put('ai_communication_log_index', JSON.stringify([recentLogId]));
    
    console.log(`Cleaned up ${logsToDelete.length} old log entries, kept ${recentLogId}`);
    
    return jsonResponse({ 
      success: true, 
      message: `Successfully cleaned up ${logsToDelete.length} old log entries`,
      deletedCount: logsToDelete.length,
      keptLogId: recentLogId
    }, 200);
  } catch (error) {
    console.error('Error cleaning up AI logs:', error);
    return jsonResponse({ error: 'Failed to cleanup AI logs: ' + error.message }, 500);
  }
}

/**
 * Export AI communication logs to a text file
 * Returns all steps with sent data, prompts, and AI responses
 */
async function handleExportAILogs(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Try to get session index first (new format)
    let sessionIndex = await env.page_content.get('ai_communication_session_index');
    
    if (sessionIndex) {
      // New session-based format
      const sessionIds = JSON.parse(sessionIndex);
      
      if (sessionIds.length === 0) {
        return new Response('Няма налични логове за експорт.', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename="ai_communication_logs.txt"',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      }
      
      // Get all log IDs from ALL sessions (not just the latest one)
      const allLogIds = [];
      const sessionLogCounts = [];
      for (const sessionId of sessionIds) {
        const sessionLogsData = await env.page_content.get(`ai_session_logs:${sessionId}`);
        if (sessionLogsData) {
          const sessionLogIds = JSON.parse(sessionLogsData);
          sessionLogCounts.push({ sessionId, count: sessionLogIds.length });
          allLogIds.push(...sessionLogIds);
        }
      }
      
      if (allLogIds.length === 0) {
        return new Response('Няма налични логове за експорт.', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename="ai_communication_logs.txt"',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      }
      
      // Fetch all logs from ALL sessions
      const logPromises = allLogIds.flatMap(logId => [
        env.page_content.get(`ai_communication_log:${logId}`),
        env.page_content.get(`ai_communication_log:${logId}_response`)
      ]);
      
      const logData = await Promise.all(logPromises);
      
      // Build text content
      let textContent = '='.repeat(80) + '\n';
      textContent += 'AI КОМУНИКАЦИОННИ ЛОГОВЕ - ЕКСПОРТ\n';
      textContent += '='.repeat(80) + '\n\n';
      textContent += `Дата на експорт: ${new Date().toISOString()}\n`;
      textContent += `Общо сесии: ${sessionIds.length}\n`;
      textContent += `Общо стъпки: ${allLogIds.length}\n`;
      sessionLogCounts.forEach((session, index) => {
        textContent += `  Сесия ${index + 1} (${session.sessionId}): ${session.count} стъпки\n`;
      });
      textContent += '\n';
      
      // Note: logData contains paired entries (request, response) for each log ID
      // Each log ID maps to 2 entries in logData: [request at i*2, response at i*2+1]
      for (let i = 0; i < allLogIds.length; i++) {
        const requestLog = logData[i * 2] ? JSON.parse(logData[i * 2]) : null;
        const responseLog = logData[i * 2 + 1] ? JSON.parse(logData[i * 2 + 1]) : null;
        
        if (requestLog) {
          textContent += '='.repeat(80) + '\n';
          textContent += `СТЪПКА ${i + 1}: ${requestLog.stepName}\n`;
          textContent += `ID на сесия: ${requestLog.sessionId || 'N/A'}\n`;
          textContent += '='.repeat(80) + '\n\n';
          
          // Request information
          textContent += '--- ИЗПРАТЕНИ ДАННИ ---\n';
          textContent += `Времева марка: ${requestLog.timestamp}\n`;
          textContent += `Провайдър: ${requestLog.provider}\n`;
          textContent += `Модел: ${requestLog.modelName}\n`;
          textContent += `Дължина на промпт: ${requestLog.promptLength} символа\n`;
          textContent += `Приблизителни входни токени: ${requestLog.estimatedInputTokens}\n`;
          textContent += `Максимални изходни токени: ${requestLog.maxOutputTokens || 'N/A'}\n\n`;
          
          // User data (client data)
          if (requestLog.userData) {
            textContent += '--- КЛИЕНТСКИ ДАННИ ---\n';
            textContent += JSON.stringify(requestLog.userData, null, 2);
            textContent += '\n\n';
          }
          
          // Calculated data (backend calculations)
          if (requestLog.calculatedData) {
            textContent += '--- БЕКЕНД КАЛКУЛАЦИИ ---\n';
            textContent += JSON.stringify(requestLog.calculatedData, null, 2);
            textContent += '\n\n';
          }
          
          textContent += '--- ПРОМПТ ---\n';
          textContent += requestLog.prompt || '(Няма съхранен промпт)';
          textContent += '\n\n';
          
          // Response information
          if (responseLog) {
            textContent += '--- ПОЛУЧЕН ОТГОВОР ---\n';
            textContent += `Времева марка: ${responseLog.timestamp}\n`;
            textContent += `Успех: ${responseLog.success ? 'Да' : 'Не'}\n`;
            textContent += `Време за отговор: ${responseLog.duration} ms\n`;
            textContent += `Дължина на отговор: ${responseLog.responseLength} символа\n`;
            textContent += `Приблизителни изходни токени: ${responseLog.estimatedOutputTokens}\n`;
            
            if (responseLog.error) {
              textContent += `Грешка: ${responseLog.error}\n`;
            }
            
            textContent += '\n--- AI ОТГОВОР ---\n';
            textContent += responseLog.response || '(Няма съхранен отговор)';
            textContent += '\n\n';
          } else {
            textContent += '--- ПОЛУЧЕН ОТГОВОР ---\n';
            textContent += '(Няма получен отговор)\n\n';
          }
        }
      }
      
      textContent += '='.repeat(80) + '\n';
      textContent += 'КРАЙ НА ЕКСПОРТА\n';
      textContent += '='.repeat(80) + '\n';
      
      return new Response(textContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="ai_communication_logs_${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').substring(0, 19)}.txt"`,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    } else {
      // Fallback to old log index format for backward compatibility
      const logIndex = await env.page_content.get('ai_communication_log_index');
      if (!logIndex) {
        return new Response('Няма налични логове за експорт.', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename="ai_communication_logs.txt"',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      }
      
      const logIds = JSON.parse(logIndex);
      
      // Fetch all logs (old format - only one entry)
      const logPromises = logIds.flatMap(logId => [
        env.page_content.get(`ai_communication_log:${logId}`),
        env.page_content.get(`ai_communication_log:${logId}_response`)
      ]);
      
      const logData = await Promise.all(logPromises);
      
      // Build text content (same as before for old format)
      let textContent = '='.repeat(80) + '\n';
      textContent += 'AI КОМУНИКАЦИОННИ ЛОГОВЕ - ЕКСПОРТ (СТАР ФОРМАТ)\n';
      textContent += '='.repeat(80) + '\n\n';
      textContent += `Дата на експорт: ${new Date().toISOString()}\n`;
      textContent += `Общо стъпки: ${logIds.length}\n`;
      textContent += `Забележка: Това е стар формат на логове без групиране по сесии.\n\n`;
      
      for (let i = 0; i < logIds.length; i++) {
        const requestLog = logData[i * 2] ? JSON.parse(logData[i * 2]) : null;
        const responseLog = logData[i * 2 + 1] ? JSON.parse(logData[i * 2 + 1]) : null;
        
        if (requestLog) {
          textContent += '='.repeat(80) + '\n';
          textContent += `СТЪПКА ${i + 1}: ${requestLog.stepName}\n`;
          textContent += '='.repeat(80) + '\n\n';
          
          // Request information
          textContent += '--- ИЗПРАТЕНИ ДАННИ ---\n';
          textContent += `Времева марка: ${requestLog.timestamp}\n`;
          textContent += `Провайдър: ${requestLog.provider}\n`;
          textContent += `Модел: ${requestLog.modelName}\n`;
          textContent += `Дължина на промпт: ${requestLog.promptLength} символа\n`;
          textContent += `Приблизителни входни токени: ${requestLog.estimatedInputTokens}\n`;
          textContent += `Максимални изходни токени: ${requestLog.maxOutputTokens || 'N/A'}\n\n`;
          
          // User data (client data)
          if (requestLog.userData) {
            textContent += '--- КЛИЕНТСКИ ДАННИ ---\n';
            textContent += JSON.stringify(requestLog.userData, null, 2);
            textContent += '\n\n';
          }
          
          // Calculated data (backend calculations)
          if (requestLog.calculatedData) {
            textContent += '--- БЕКЕНД КАЛКУЛАЦИИ ---\n';
            textContent += JSON.stringify(requestLog.calculatedData, null, 2);
            textContent += '\n\n';
          }
          
          textContent += '--- ПРОМПТ ---\n';
          textContent += requestLog.prompt || '(Няма съхранен промпт)';
          textContent += '\n\n';
          
          // Response information
          if (responseLog) {
            textContent += '--- ПОЛУЧЕН ОТГОВОР ---\n';
            textContent += `Времева марка: ${responseLog.timestamp}\n`;
            textContent += `Успех: ${responseLog.success ? 'Да' : 'Не'}\n`;
            textContent += `Време за отговор: ${responseLog.duration} ms\n`;
            textContent += `Дължина на отговор: ${responseLog.responseLength} символа\n`;
            textContent += `Приблизителни изходни токени: ${responseLog.estimatedOutputTokens}\n`;
            
            if (responseLog.error) {
              textContent += `Грешка: ${responseLog.error}\n`;
            }
            
            textContent += '\n--- AI ОТГОВОР ---\n';
            textContent += responseLog.response || '(Няма съхранен отговор)';
            textContent += '\n\n';
          } else {
            textContent += '--- ПОЛУЧЕН ОТГОВОР ---\n';
            textContent += '(Няма получен отговор)\n\n';
          }
        }
      }
      
      textContent += '='.repeat(80) + '\n';
      textContent += 'КРАЙ НА ЕКСПОРТА\n';
      textContent += '='.repeat(80) + '\n';
      
      return new Response(textContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="ai_communication_logs_${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').substring(0, 19)}.txt"`,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }
  } catch (error) {
    console.error('Error exporting AI logs:', error);
    return jsonResponse({ error: 'Failed to export AI logs: ' + error.message }, 500);
  }
}

/**
 * Blacklist Management: Get blacklist from KV storage
 */
async function handleGetBlacklist(request, env) {
  try {
    if (!env.page_content) {
      console.error('KV namespace not configured');
      // Return default blacklist if KV not available
      return jsonResponse({ success: true, blacklist: DEFAULT_FOOD_BLACKLIST });
    }
    
    const blacklistData = await env.page_content.get('food_blacklist');
    const blacklist = blacklistData ? JSON.parse(blacklistData) : DEFAULT_FOOD_BLACKLIST;
    
    return jsonResponse({ success: true, blacklist: blacklist }, 200, {
      cacheControl: 'public, max-age=300' // Cache for 5 minutes - blacklist changes infrequently
    });
  } catch (error) {
    console.error('Error getting blacklist:', error);
    return jsonResponse({ error: `Failed to get blacklist: ${error.message}` }, 500);
  }
}

/**
 * Blacklist Management: Add item to blacklist
 */
async function handleAddToBlacklist(request, env) {
  try {
    const data = await request.json();
    const item = data.item?.trim()?.toLowerCase();
    
    if (!item) {
      return jsonResponse({ error: 'Item is required' }, 400);
    }
    
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get current blacklist
    const blacklistData = await env.page_content.get('food_blacklist');
    let blacklist = blacklistData ? JSON.parse(blacklistData) : DEFAULT_FOOD_BLACKLIST;
    
    // Add item if not already in list
    if (!blacklist.includes(item)) {
      blacklist.push(item);
      await env.page_content.put('food_blacklist', JSON.stringify(blacklist));
    }
    
    return jsonResponse({ success: true, blacklist: blacklist });
  } catch (error) {
    console.error('Error adding to blacklist:', error);
    return jsonResponse({ error: `Failed to add to blacklist: ${error.message}` }, 500);
  }
}

/**
 * Blacklist Management: Remove item from blacklist
 */
async function handleRemoveFromBlacklist(request, env) {
  try {
    const data = await request.json();
    const item = data.item?.trim()?.toLowerCase();
    
    if (!item) {
      return jsonResponse({ error: 'Item is required' }, 400);
    }
    
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get current blacklist
    const blacklistData = await env.page_content.get('food_blacklist');
    let blacklist = blacklistData ? JSON.parse(blacklistData) : [];
    
    // Remove item
    blacklist = blacklist.filter(i => i !== item);
    await env.page_content.put('food_blacklist', JSON.stringify(blacklist));
    
    return jsonResponse({ success: true, blacklist: blacklist });
  } catch (error) {
    console.error('Error removing from blacklist:', error);
    return jsonResponse({ error: `Failed to remove from blacklist: ${error.message}` }, 500);
  }
}

/**
 * Whitelist Management: Get whitelist from KV storage
 */
async function handleGetWhitelist(request, env) {
  try {
    if (!env.page_content) {
      console.error('KV namespace not configured');
      // Return default whitelist if KV not available
      return jsonResponse({ success: true, whitelist: DEFAULT_FOOD_WHITELIST });
    }
    
    const whitelistData = await env.page_content.get('food_whitelist');
    const whitelist = whitelistData ? JSON.parse(whitelistData) : DEFAULT_FOOD_WHITELIST;
    
    return jsonResponse({ success: true, whitelist: whitelist }, 200, {
      cacheControl: 'public, max-age=300' // Cache for 5 minutes - whitelist changes infrequently
    });
  } catch (error) {
    console.error('Error getting whitelist:', error);
    return jsonResponse({ error: `Failed to get whitelist: ${error.message}` }, 500);
  }
}

/**
 * Whitelist Management: Add item to whitelist
 */
async function handleAddToWhitelist(request, env) {
  try {
    const data = await request.json();
    const item = data.item?.trim()?.toLowerCase();
    
    if (!item) {
      return jsonResponse({ error: 'Item is required' }, 400);
    }
    
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get current whitelist
    const whitelistData = await env.page_content.get('food_whitelist');
    let whitelist = whitelistData ? JSON.parse(whitelistData) : DEFAULT_FOOD_WHITELIST;
    
    // Add item if not already in list
    if (!whitelist.includes(item)) {
      whitelist.push(item);
      await env.page_content.put('food_whitelist', JSON.stringify(whitelist));
    }
    
    return jsonResponse({ success: true, whitelist: whitelist });
  } catch (error) {
    console.error('Error adding to whitelist:', error);
    return jsonResponse({ error: `Failed to add to whitelist: ${error.message}` }, 500);
  }
}

/**
 * Whitelist Management: Remove item from whitelist
 */
async function handleRemoveFromWhitelist(request, env) {
  try {
    const data = await request.json();
    const item = data.item?.trim()?.toLowerCase();
    
    if (!item) {
      return jsonResponse({ error: 'Item is required' }, 400);
    }
    
    if (!env.page_content) {
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get current whitelist
    const whitelistData = await env.page_content.get('food_whitelist');
    let whitelist = whitelistData ? JSON.parse(whitelistData) : DEFAULT_FOOD_WHITELIST;
    
    // Remove item
    whitelist = whitelist.filter(i => i !== item);
    await env.page_content.put('food_whitelist', JSON.stringify(whitelist));
    
    return jsonResponse({ success: true, whitelist: whitelist });
  } catch (error) {
    console.error('Error removing from whitelist:', error);
    return jsonResponse({ error: `Failed to remove from whitelist: ${error.message}` }, 500);
  }
}

/**
 * Push Notifications: Get VAPID public key
 * 
 * Returns the VAPID public key needed for push notification subscription.
 * The public key must be configured in the VAPID_PUBLIC_KEY environment variable.
 * 
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings including VAPID_PUBLIC_KEY
 * @returns {Promise<Response>} JSON response with publicKey field
 * 
 * @example
 * // Request
 * GET /api/push/vapid-public-key
 * 
 * // Response
 * {
 *   "success": true,
 *   "publicKey": "BG3xG3xG..."
 * }
 */
async function handleGetVapidPublicKey(request, env) {
  try {
    // VAPID keys should be stored in environment variables
    // For development, return a placeholder
    const publicKey = env.VAPID_PUBLIC_KEY || 'VAPID_PUBLIC_KEY_NOT_CONFIGURED';
    
    return jsonResponse({ 
      success: true,
      publicKey: publicKey
    });
  } catch (error) {
    console.error('Error getting VAPID public key:', error);
    return jsonResponse({ error: 'Failed to get VAPID public key: ' + error.message }, 500);
  }
}

/**
 * Admin: Get AI logging status
 */
async function handleGetLoggingStatus(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const loggingEnabled = await env.page_content.get('ai_logging_enabled');
    
    return jsonResponse({ 
      success: true, 
      enabled: loggingEnabled === 'true' || loggingEnabled === null // Default to true if not set
    }, 200, {
      cacheControl: 'no-cache' // Don't cache this response
    });
  } catch (error) {
    console.error('Error getting logging status:', error);
    return jsonResponse({ error: 'Failed to get logging status: ' + error.message }, 500);
  }
}

/**
 * Admin: Set AI logging status
 */
async function handleSetLoggingStatus(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const data = await request.json();
    const enabled = data.enabled === true || data.enabled === 'true';

    await env.page_content.put('ai_logging_enabled', enabled.toString());
    
    console.log(`AI logging ${enabled ? 'enabled' : 'disabled'} by admin`);
    
    return jsonResponse({ 
      success: true,
      enabled: enabled,
      message: `AI логването е ${enabled ? 'включено' : 'изключено'}`
    });
  } catch (error) {
    console.error('Error setting logging status:', error);
    return jsonResponse({ error: 'Failed to set logging status: ' + error.message }, 500);
  }
}

/**
 * Push Notifications: Subscribe user to push notifications
 * 
 * Stores the push subscription in KV storage for the given user.
 * The subscription can later be used to send push notifications.
 * 
 * @param {Request} request - The incoming request with userId and subscription
 * @param {Object} env - Environment bindings including page_content KV namespace
 * @returns {Promise<Response>} JSON response confirming subscription
 * 
 * @example
 * // Request
 * POST /api/push/subscribe
 * {
 *   "userId": "user123",
 *   "subscription": {
 *     "endpoint": "https://...",
 *     "keys": { "p256dh": "...", "auth": "..." }
 *   }
 * }
 * 
 * // Response
 * {
 *   "success": true,
 *   "message": "Subscription saved successfully"
 * }
 */
async function handlePushSubscribe(request, env) {
  try {
    const { userId, subscription } = await request.json();
    
    if (!userId || !subscription) {
      return jsonResponse({ error: 'Missing userId or subscription' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Store subscription in KV with user ID as key
    const subscriptionKey = `push_subscription_${userId}`;
    await env.page_content.put(subscriptionKey, JSON.stringify(subscription));
    
    console.log(`Push subscription saved for user: ${userId}`);
    
    return jsonResponse({ 
      success: true,
      message: 'Subscription saved successfully'
    });
  } catch (error) {
    console.error('Error saving push subscription:', error);
    return jsonResponse({ error: 'Failed to save subscription: ' + error.message }, 500);
  }
}

/**
 * Push Notifications: Send push notification to user
 * 
 * Retrieves the user's push subscription from KV and sends a push notification.
 * This is a simplified implementation - production use requires Web Push protocol
 * with proper VAPID authentication and encryption.
 * 
 * @param {Request} request - The incoming request with userId, title, body, and url
 * @param {Object} env - Environment bindings including page_content KV and VAPID keys
 * @returns {Promise<Response>} JSON response confirming notification sent
 * 
 * @example
 * // Request
 * POST /api/push/send
 * {
 *   "userId": "user123",
 *   "title": "Време за обяд!",
 *   "body": "Не забравяйте да се храните според плана си",
 *   "url": "/plan.html"
 * }
 * 
 * // Response
 * {
 *   "success": true,
 *   "message": "Push notification sent"
 * }
 * 
 * @note Requires VAPID keys to be configured for production use
 * @todo Implement actual Web Push protocol with web-push library
 */
async function handlePushSend(request, env) {
  try {
    const { userId, title, body, url } = await request.json();
    
    if (!userId) {
      return jsonResponse({ error: 'Missing userId' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Retrieve subscription from KV
    const subscriptionKey = `push_subscription_${userId}`;
    const subscriptionData = await env.page_content.get(subscriptionKey);
    
    if (!subscriptionData) {
      return jsonResponse({ error: 'No subscription found for user' }, 404);
    }

    const subscription = JSON.parse(subscriptionData);
    
    // Prepare push message
    const pushMessage = {
      title: title || 'NutriPlan',
      body: body || 'Ново напомняне от NutriPlan',
      url: url || '/'
    };

    // In a production environment, you would:
    // 1. Use the web-push library or similar to send the actual push notification
    // 2. Use VAPID keys for authentication
    // 3. Encrypt the payload according to Web Push protocol
    
    // For now, we'll just log that we would send the notification
    console.log(`Would send push notification to user ${userId}:`, pushMessage);
    console.log('Subscription endpoint:', subscription.endpoint);
    
    // TODO: Implement actual Web Push sending with VAPID
    // This requires the 'web-push' library or manual implementation of the Web Push protocol
    // Example with web-push library (needs to be imported):
    // const webpush = require('web-push');
    // webpush.setVapidDetails('mailto:example@domain.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    // await webpush.sendNotification(subscription, JSON.stringify(pushMessage));
    
    return jsonResponse({ 
      success: true,
      message: 'Push notification sent (simulated)',
      note: 'Full Web Push implementation requires VAPID keys and web-push library'
    });
  } catch (error) {
    console.error('Error sending push notification:', error);
    return jsonResponse({ error: 'Failed to send notification: ' + error.message }, 500);
  }
}

/**
 * Helper to create JSON response with optional cache control
 * @param {Object} data - Response data
 * @param {number} status - HTTP status code
 * @param {Object} options - Optional settings { cacheControl: string }
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    console.log(`${request.method} ${url.pathname}`);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      console.log('CORS preflight request');
      return new Response(null, { 
        status: 204,
        headers: CORS_HEADERS 
      });
    }

    try {
      // Route handling
      if (url.pathname === '/api/generate-plan' && request.method === 'POST') {
        return await handleGeneratePlan(request, env);
      } else if (url.pathname === '/api/chat' && request.method === 'POST') {
        return await handleChat(request, env);
      } else if (url.pathname === '/api/report-problem' && request.method === 'POST') {
        return await handleReportProblem(request, env);
      } else if (url.pathname === '/api/admin/get-reports' && request.method === 'GET') {
        return await handleGetReports(request, env);
      } else if (url.pathname === '/api/admin/save-prompt' && request.method === 'POST') {
        return await handleSavePrompt(request, env);
      } else if (url.pathname === '/api/admin/get-prompt' && request.method === 'GET') {
        return await handleGetPrompt(request, env);
      } else if (url.pathname === '/api/admin/get-default-prompt' && request.method === 'GET') {
        return await handleGetDefaultPrompt(request, env);
      } else if (url.pathname === '/api/admin/save-model' && request.method === 'POST') {
        return await handleSaveModel(request, env);
      } else if (url.pathname === '/api/admin/get-config' && request.method === 'GET') {
        return await handleGetConfig(request, env);
      } else if (url.pathname === '/api/admin/get-ai-logs' && request.method === 'GET') {
        return await handleGetAILogs(request, env);
      } else if (url.pathname === '/api/admin/cleanup-ai-logs' && request.method === 'POST') {
        return await handleCleanupAILogs(request, env);
      } else if (url.pathname === '/api/admin/export-ai-logs' && request.method === 'GET') {
        return await handleExportAILogs(request, env);
      } else if (url.pathname === '/api/admin/get-blacklist' && request.method === 'GET') {
        return await handleGetBlacklist(request, env);
      } else if (url.pathname === '/api/admin/add-to-blacklist' && request.method === 'POST') {
        return await handleAddToBlacklist(request, env);
      } else if (url.pathname === '/api/admin/remove-from-blacklist' && request.method === 'POST') {
        return await handleRemoveFromBlacklist(request, env);
      } else if (url.pathname === '/api/admin/get-whitelist' && request.method === 'GET') {
        return await handleGetWhitelist(request, env);
      } else if (url.pathname === '/api/admin/add-to-whitelist' && request.method === 'POST') {
        return await handleAddToWhitelist(request, env);
      } else if (url.pathname === '/api/admin/remove-from-whitelist' && request.method === 'POST') {
        return await handleRemoveFromWhitelist(request, env);
      } else if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
        return await handlePushSubscribe(request, env);
      } else if (url.pathname === '/api/push/send' && request.method === 'POST') {
        return await handlePushSend(request, env);
      } else if (url.pathname === '/api/push/vapid-public-key' && request.method === 'GET') {
        return await handleGetVapidPublicKey(request, env);
      } else if (url.pathname === '/api/admin/get-logging-status' && request.method === 'GET') {
        return await handleGetLoggingStatus(request, env);
      } else if (url.pathname === '/api/admin/set-logging-status' && request.method === 'POST') {
        return await handleSetLoggingStatus(request, env);
      } else {
        return jsonResponse({ error: 'Not found' }, 404);
      }
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  }
};
