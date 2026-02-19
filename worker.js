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
 * 
 * AI PROMPTS ORGANIZATION (Feb 2026):
 *   All AI prompts are extracted to separate files for easier management:
 *   - Location: KV/prompts/ directory
 *   - Files: admin_analysis_prompt.txt, admin_strategy_prompt.txt, 
 *            admin_meal_plan_prompt.txt, admin_summary_prompt.txt,
 *            admin_consultation_prompt.txt, admin_modification_prompt.txt,
 *            admin_correction_prompt.txt
 *   - Upload: ./KV/upload-kv-keys.sh script uploads to Cloudflare KV
 *   - Runtime: Worker checks KV first, uses prompts directly from KV storage
 *   - Admin panel shows prompts from KV via handleGetDefaultPrompt()
 *   
 *   Benefits:
 *   ✓ Prompts are version controlled separately
 *   ✓ Easy to review and update without touching code
 *   ✓ Can be customized via admin panel or KV files
 *   ✓ Maintained in both repository and KV storage
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
// HYBRID APPROACH: Cache API for normal logs + KV for errors
// Cache API is free and doesn't count against KV READ/WRITE quotas
// Logs are stored temporarily in Cache with 24-hour TTL
// Errors are permanently stored in KV for debugging
// MAX_LOG_ENTRIES controls how many sessions to keep (1 = only the most recent session)
// Increased to 10 to preserve error logs for debugging failed plan generations
const MAX_LOG_ENTRIES = 10; // Keep last 10 sessions to ensure error logs are preserved for debugging
const AI_LOG_CACHE_TTL = 24 * 60 * 60; // 24 hours - logs expire after 1 day
const AI_ERROR_LOG_KV_ENABLED = true; // Enable KV storage for errors (debugging capability)

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
  
  // Note for minors - TODO: Implement guardian consent verification in production
  if (age >= MIN_AGE && age < 18) {
    console.warn(`Minor user (age ${age}) - TODO: guardian consent verification required in production`);
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

// Cache for food lists (whitelist/blacklist) to reduce KV reads
// These are read 9 times per plan generation (analysis + strategy + 7 meal plan chunks)
// Caching reduces KV operations from 18 to 2 per plan (89% reduction)
let foodListsCache = null;
let foodListsCacheTime = 0;
const FOOD_LISTS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache

// Cache for custom prompts to reduce KV reads
// Custom prompts are read 10 times per plan generation
// Caching reduces KV operations from 10 to 3-4 per plan (70% reduction)
let customPromptsCache = {};
let customPromptsCacheTime = {};
const CUSTOM_PROMPTS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache (prompts rarely change)

// REVOLUTIONARY OPTIMIZATION: Chat context caching
// Cache user context (userData + userPlan) to dramatically reduce payload sizes
// Instead of sending 10-20KB per chat message, send only message + sessionId (~100 bytes)
// Expected reduction: 85-95% in chat request payload size
let chatContextCache = {};
let chatContextCacheTime = {};
const CHAT_CONTEXT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache (session-based)
const CHAT_CONTEXT_MAX_SIZE = 1000; // Maximum number of cached contexts (prevent memory bloat)

// Validation constants (moved here to be available early in code)
const DAILY_CALORIE_TOLERANCE = 50; // ±50 kcal tolerance for daily calorie target
const MAX_LATE_SNACK_CALORIES = 200; // Maximum calories allowed for late-night snacks

/**
 * Cache API helper functions for AI logging
 * Cache API is free and doesn't count against KV quotas - perfect for temporary data like logs
 * Cache is automatically distributed across Cloudflare's global network
 * 
 * Note: Cache API in Cloudflare Workers uses the Request/Response pattern
 * We use a consistent domain pattern for cache namespacing
 */

/**
 * Store data in Cache API with specified TTL
 * @param {string} key - Cache key
 * @param {any} data - Data to store (will be JSON stringified)
 * @param {number} ttl - Time to live in seconds (default: 24 hours)
 * @returns {Promise<boolean>} - True if stored successfully, false on error
 * Note: cache.put() may fail silently in edge cases, so this returns true if no error is thrown
 */
async function cacheSet(key, data, ttl = AI_LOG_CACHE_TTL) {
  try {
    const cache = caches.default;
    // Use a consistent cache domain for all AI logs
    // In Cloudflare Workers, cache keys are based on URL patterns
    const url = `https://ai-logs-cache.internal/${key}`;
    const response = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${ttl}`
      }
    });
    await cache.put(url, response);
    return true;
  } catch (error) {
    console.error(`[Cache API] Failed to set key ${key}:`, error);
    return false;
  }
}

/**
 * Retrieve data from Cache API
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} - Parsed data or null if not found/expired
 */
async function cacheGet(key) {
  try {
    const cache = caches.default;
    const url = `https://ai-logs-cache.internal/${key}`;
    const response = await cache.match(url);
    if (!response) {
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`[Cache API] Failed to get key ${key}:`, error);
    return null;
  }
}

/**
 * Delete data from Cache API
 * @param {string} key - Cache key
 * @returns {Promise<boolean>} - True if entry was found and deleted, false if not found (not an error)
 */
async function cacheDelete(key) {
  try {
    const cache = caches.default;
    const url = `https://ai-logs-cache.internal/${key}`;
    const deleted = await cache.delete(url);
    return deleted;
  } catch (error) {
    console.error(`[Cache API] Failed to delete key ${key}:`, error);
    return false;
  }
}

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
/**
 * Wrap prompt with strict JSON-only enforcement prefix
 * This reduces unnecessary AI explanation text and output tokens
 */
function enforceJSONOnlyPrompt(prompt) {
  const jsonPrefix = `CRITICAL INSTRUCTION: You MUST respond with ONLY a valid JSON object. 
Do not include any explanatory text, markdown formatting, or anything outside the JSON structure.
Your response must start with { or [ and end with } or ].
NO text before the JSON. NO text after the JSON. ONLY JSON.

`;
  return jsonPrefix + prompt;
}

/**
 * Accurate token count estimation for AI prompts (supports Cyrillic)
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

/**
 * Call AI model with load monitoring
 * Goal: Monitor request sizes to ensure no single request is overloaded
 * Architecture: System already uses multi-step approach (Analysis → Strategy → Meal Plan Chunks)
 */
async function callAIModel(env, prompt, maxTokens = null, stepName = 'unknown', sessionId = null, userData = null, calculatedData = null, skipJSONEnforcement = false) {
  // Apply strict JSON-only enforcement to reduce unnecessary output
  // Skip enforcement for chat requests where plain text responses are expected
  const enforcedPrompt = skipJSONEnforcement ? prompt : enforceJSONOnlyPrompt(prompt);
  
  // Improved token estimation for Cyrillic text
  const estimatedInputTokens = estimateTokenCount(enforcedPrompt);
  
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
    prompt: enforcedPrompt,
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
      response = generateMockResponse(enforcedPrompt);
      success = true;
    } else if (preferredProvider === 'openai' && env.OPENAI_API_KEY) {
      // Try preferred provider first
      response = await callOpenAI(env, enforcedPrompt, modelName, maxTokens);
      success = true;
    } else if (preferredProvider === 'anthropic' && env.ANTHROPIC_API_KEY) {
      response = await callClaude(env, enforcedPrompt, modelName, maxTokens);
      success = true;
    } else if (preferredProvider === 'google' && env.GEMINI_API_KEY) {
      response = await callGemini(env, enforcedPrompt, modelName, maxTokens);
      success = true;
    } else {
      // Fallback hierarchy if preferred not available
      if (env.OPENAI_API_KEY) {
        console.warn('Preferred provider not available. Falling back to OpenAI.');
        response = await callOpenAI(env, enforcedPrompt, modelName, maxTokens);
        success = true;
      } else if (env.ANTHROPIC_API_KEY) {
        console.warn('Preferred provider not available. Falling back to Anthropic.');
        response = await callClaude(env, enforcedPrompt, modelName, maxTokens);
        success = true;
      } else if (env.GEMINI_API_KEY) {
        console.warn('Preferred provider not available. Falling back to Google Gemini.');
        response = await callGemini(env, enforcedPrompt, modelName, maxTokens);
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
 * 
 * SIMPLIFIED: Reuses existing generateMealPlanSummaryPrompt() with KV support
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
  
  // Generate simplified week plan with 1 AI call
  const mealPlanPrompt = `Създай ОПРОСТЕН 7-дневен хранителен план за ${data.name}.

ОСНОВНИ ДАННИ:
- BMR: ${bmr} kcal, TDEE: ${tdee} kcal
- Целеви калории: ${recommendedCalories} kcal/ден
- Цел: ${data.goal}
- Възраст: ${data.age}, Пол: ${data.gender}
- Медицински състояния: ${JSON.stringify(data.medicalConditions || [])}
- Алергии/Непоносимости: ${data.dietDislike || 'няма'}
- Предпочитания: ${data.dietLove || 'няма'}

ИЗИСКВАНИЯ (ОПРОСТЕНИ):
- 3 хранения на ден: Закуска, Обяд, Вечеря
- Всяко ястие с calories и macros (protein, carbs, fats, fiber)
- Общо около ${recommendedCalories} kcal/ден
- Балансирани макроси: 30% протеини, 40% въглехидрати, 30% мазнини

ФОРМАТ (JSON):
{
  "day1": {"meals": [{"name": "...", "time": "...", "type": "Закуска", "calories": число, "macros": {"protein": число, "carbs": число, "fats": число, "fiber": число}}]},
  "day2": {"meals": [...]},
  ...
  "day7": {"meals": [...]}
}

Създай прост, практичен план.`;

  const calculatedData = { bmr, tdee, recommendedCalories };
  const mealPlanResponse = await callAIModel(env, mealPlanPrompt, 3000, 'fallback_plan', null, data, calculatedData);
  const weekPlan = JSON.parse(mealPlanResponse);
  
  // Create minimal analysis and strategy for generateMealPlanSummaryPrompt()
  const analysis = {
    bmr,
    recommendedCalories,
    keyProblems: [{
      problem: 'Използван опростен план поради технически ограничения',
      severity: 'Info'
    }]
  };
  
  const strategy = {
    dietaryModifier: 'Балансиран',
    planJustification: 'Опростен план с базови хранителни принципи, създаден като резервна опция.',
    welcomeMessage: `Здравейте ${data.name}! Този план е създаден да ви помогне да постигнете целта си чрез балансирано хранене.`,
    mealCountJustification: '3 основни хранения за лесно следване',
    afterDinnerMealJustification: 'Не са необходими',
    psychologicalSupport: ['Бъдете последователни', 'Планирайте предварително', 'Не се отказвайте при грешка'],
    supplementRecommendations: [],
    hydrationStrategy: '2-2.5л вода дневно'
  };
  
  // REUSE existing generateMealPlanSummaryPrompt() - it uses KV key 'admin_summary_prompt'
  // This generates recommendations, forbidden, psychology, supplements via AI
  const summaryPrompt = await generateMealPlanSummaryPrompt(data, analysis, strategy, bmr, recommendedCalories, weekPlan, env);
  const summaryResponse = await callAIModel(env, summaryPrompt, 2000, 'fallback_summary', null, data, analysis);
  const summaryData = parseAIResponse(summaryResponse);
  
  // Use AI-generated data or fallback to strategy values
  const recommendations = summaryData.recommendations || strategy.foodsToInclude || ['Варено пилешко месо', 'Киноа', 'Авокадо'];
  const forbidden = summaryData.forbidden || strategy.foodsToAvoid || ['Бързи храни', 'Газирани напитки', 'Сладкиши'];
  const psychology = summaryData.psychology || strategy.psychologicalSupport;
  const waterIntake = summaryData.waterIntake || strategy.hydrationStrategy;
  const supplements = summaryData.supplements || strategy.supplementRecommendations;
  
  // Update strategy with AI-generated values
  strategy.foodsToInclude = recommendations;
  strategy.foodsToAvoid = forbidden;
  strategy.psychologicalSupport = psychology;
  strategy.supplementRecommendations = supplements;
  strategy.hydrationStrategy = waterIntake;
  
  const plan = {
    analysis,
    strategy,
    weekPlan,
    summary: summaryData.summary || {
      bmr,
      dailyCalories: recommendedCalories,
      macros: { protein: 150, carbs: 200, fats: 65 }
    },
    recommendations,
    forbidden,
    psychology,
    waterIntake,
    supplements
  };
  
  return plan;
}

/**
 * Helper function to fetch and build dynamic whitelist/blacklist sections for prompts
 */
async function getDynamicFoodListsSections(env) {
  // Check cache first
  const now = Date.now();
  if (foodListsCache && (now - foodListsCacheTime) < FOOD_LISTS_CACHE_TTL) {
    return foodListsCache;
  }
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
  
  // Cache the result
  const result = { dynamicWhitelistSection, dynamicBlacklistSection };
  foodListsCache = result;
  foodListsCacheTime = now;
  
  return result;
}

/**
 * Invalidate food lists cache
 * Should be called after updating whitelist or blacklist
 */
function invalidateFoodListsCache() {
  foodListsCache = null;
  foodListsCacheTime = 0;
}

/**
 * Invalidate custom prompts cache
 * @param {string|null} key - Specific prompt key to invalidate, or null to clear all
 */
function invalidateCustomPromptsCache(key = null) {
  if (key) {
    delete customPromptsCache[key];
    delete customPromptsCacheTime[key];
  } else {
    customPromptsCache = {};
    customPromptsCacheTime = {};
  }
}

/**
 * REVOLUTIONARY OPTIMIZATION: Chat context cache management
 * Cache user context to reduce payload from 10-20KB to ~100 bytes per chat message
 */

/**
 * Store chat context in worker cache
 * @param {string} sessionId - Unique session identifier (userId)
 * @param {object} userData - User profile data
 * @param {object} userPlan - User's diet plan
 * @returns {boolean} Success status
 */
function setChatContext(sessionId, userData, userPlan) {
  try {
    // Prevent memory bloat: if cache is too large, remove oldest entries
    const cacheKeys = Object.keys(chatContextCache);
    if (cacheKeys.length >= CHAT_CONTEXT_MAX_SIZE) {
      // Sort by timestamp and remove oldest 10%
      const sorted = cacheKeys
        .map(key => ({ key, time: chatContextCacheTime[key] || 0 }))
        .sort((a, b) => a.time - b.time);
      
      const toRemove = Math.ceil(CHAT_CONTEXT_MAX_SIZE * 0.1);
      for (let i = 0; i < toRemove; i++) {
        const key = sorted[i].key;
        delete chatContextCache[key];
        delete chatContextCacheTime[key];
      }
    }
    
    chatContextCache[sessionId] = { userData, userPlan };
    chatContextCacheTime[sessionId] = Date.now();
    return true;
  } catch (error) {
    console.error('[Chat Context Cache] Error storing context:', error);
    return false;
  }
}

/**
 * Retrieve chat context from worker cache
 * @param {string} sessionId - Unique session identifier
 * @returns {object|null} Cached context or null if not found/expired
 */
function getChatContext(sessionId) {
  const now = Date.now();
  
  // Check if context exists and is not expired
  if (chatContextCache[sessionId] && chatContextCacheTime[sessionId]) {
    const age = now - chatContextCacheTime[sessionId];
    
    if (age < CHAT_CONTEXT_CACHE_TTL) {
      return chatContextCache[sessionId];
    } else {
      // Expired - clean up
      delete chatContextCache[sessionId];
      delete chatContextCacheTime[sessionId];
    }
  }
  
  return null;
}

/**
 * Invalidate chat context cache for a specific session or all sessions
 * @param {string|null} sessionId - Session to invalidate, or null for all
 */
function invalidateChatContext(sessionId = null) {
  if (sessionId) {
    delete chatContextCache[sessionId];
    delete chatContextCacheTime[sessionId];
  } else {
    chatContextCache = {};
    chatContextCacheTime = {};
  }
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
  
  let defaultPrompt = `Генерирай ДНИ ${startDay}-${endDay} за ${data.name}.

=== ПРОФИЛ ===
Цел: ${data.goal} | BMR: ${bmr} | Калории: ${recommendedCalories} kcal/ден | Модификатор: "${dietaryModifier}"${modificationsSection}
Стрес: ${data.stressLevel} | Сън: ${data.sleepHours}ч | Хронотип: ${data.chronotype}${previousDaysContext}

=== ДАННИ ОТ СТЪПКА 1 (АНАЛИЗ) ===
Макро съотношения: ${analysisCompact.macroRatios}
Дневни макро грамове: ${analysisCompact.macroGrams}
Дневни фибри: ${analysisCompact.fiber}

=== ДАННИ ОТ СТЪПКА 2 (СТРАТЕГИЯ) ===
Диета: ${strategyCompact.dietType} | Хранения: ${strategyCompact.mealTiming}
Принципи: ${strategyCompact.keyPrinciples}
Предпочитани храни (от стъпка 2): ${strategyCompact.foodsToInclude}
Допълнителни предпочитани храни (от потребител): ${data.dietLove || 'няма'}
Нежелани храни (от стъпка 2): ${strategyCompact.foodsToAvoid}
Допълнителни нежелани храни (от потребител): ${data.dietDislike || 'няма'}
Разпределение на калории (стъпка 2): ${strategyCompact.calorieDistribution}
Разпределение на макроси (стъпка 2): ${strategyCompact.macroDistribution}${strategyCompact.weeklyScheme ? `

=== СЕДМИЧНА СТРУКТУРА (от стъпка 2) ===
${Object.keys(strategyCompact.weeklyScheme).map(day => {
  const dayData = strategyCompact.weeklyScheme[day];
  const dayName = DAY_NAMES_BG[day] || day; // Fallback to English name if not found
  return `${dayName}: ${dayData.meals} хранения - ${dayData.description}`;
}).join('\n')}` : ''}${data.additionalNotes ? `

ВАЖНО - Потребителски бележки: ${data.additionalNotes}` : ''}

=== ADLE v5.1 - АРХИТЕКТУРА НА ХРАНЕНЕТО ===
Ти действаш като Advanced Dietary Logic Engine (ADLE) – логически конструктор на хранителни режими.

МОДИФИКАТОР (Диетичен филтър): "${dietaryModifier}"
Модификаторът филтрира кои храни са ПОЗВОЛЕНИ от универсалната база.

УНИВЕРСАЛНА БАЗА ОТ РЕСУРСИ (Категории храни):
[PRO] БЕЛТЪК - Основен градивен елемент:
  • Животински: месо (пилешко, говеждо, свинско), риба, яйца, млечни (сирене, извара, кисело мляко)
  • Растителен: тофу, темпе, растителен протеин
  • Смесен: бобови (леща, боб, нахут) - PRO или ENG според режима

[ENG] ЕНЕРГИЯ - Въглехидрати/Скорбяла:
  • Зърнени: ориз, киноа, елда, овес, паста, хляб
  • Кореноплодни: картофи, сладки картофи
  • Плодове: всички видове (съдържат захар)

[VOL] ОБЕМ И ФИБРИ - Зеленчуци без скорбяла:
  • Сурови: салати (листни), краставици, домати
  • Готвени: броколи, тиквички, чушки, гъби, карфиол, патладжан

[FAT] МАЗНИНИ - Вкус и ситост:
  • Източници: зехтин, масло, авокадо, ядки, семена, тахан, маслини

[CMPX] СЪСТАВНИ/СЛОЖНИ ЯСТИЯ - Възприемани като "едно цяло":
  • Тестени/Печива: пица, лазаня, мусака, паста със сос, киш/баница
  • Сандвич-тип: бургер, дюнер/врап, такос
  • Яхнии/Оризови: ястия, в които не можеш да отделиш белтъка от гарнитурата (ризото, паеля)

СТРУКТУРНИ ШАБЛОНИ (Форми на ястия):
ШАБЛОН A: "РАЗДЕЛЕНА ЧИНИЯ" → [PRO] + [ENG] + [VOL]
  Пример: Печено пиле + Картофи на фурна + Зелена салата
  Употреба: Стандартен обяд/вечеря

ШАБЛОН B: "СМЕСЕНО ЯСТИЕ/КУПА" → Смес от [PRO] + [ENG] + [VOL]
  Пример: Пилешка яхния с грах и картофи; Купа с киноа, тофу и зеленчуци
  Употреба: Готвено домашно ястие

ШАБЛОН C: "ЛЕКО/САНДВИЧ" → [ENG-Хляб] + [PRO] + [FAT] + [VOL-Свежест]
  Пример: Сандвич с пуешко и кашкавал; Тост с авокадо и яйце
  Употреба: Закуска или Обяд в движение

ШАБЛОН D: "ЕДИНЕН БЛОК" → [CMPX] + [VOL-Салата/Зеленчук]
  Пример: Парче лазаня + Салата домати; Бургер + Салата коулсло
  ЗАДЪЛЖИТЕЛНО: Винаги добавяй [VOL] като баланс към тежките храни
  Употреба: Уикенд, свободно хранене, комфортна храна

ЛОГИЧЕСКИ ЛОСТОВЕ (Как МОДИФИКАТОРЪТ управлява системата):
1. ФИЛТРИРАНЕ: Ако модификатор забранява група → търси алтернатива в същата категория
   • "Веган" → без животински [PRO], използвай растителен
   • "Без глутен" → [ENG] само безглутенови (ориз/картофи/царевица)
   • "Кето/Нисковъглехидратно" → минимизирай [ENG], компенсирай с [VOL] и [FAT]

2. ДЕКОНСТРУКЦИЯ НА [CMPX]: Преди да избереш Шаблон D, провери дали съставът е съвместим!
   • При "Нисковъглехидратно": стандартен бургер (хляб) е несъвместим → "Бургер без хлебче"
   • При "Веган": "Лазаня" → "Веган лазаня със зеленчуци"
   • Ако не можеш да гарантираш съвместимост → НЕ използвай Шаблон D

3. АКТИВНОСТ НА КАТЕГОРИИТЕ:
   • Нисковъглехидратно: [ENG] деактивиран → компенсирай с повече [VOL] и [FAT]
   • Щадящ стомах: [VOL] само готвени/щадящи (без сурови влакнини)

HARD BANS: лук, пуешко месо, мед, захар, кетчуп, майонеза, гръцко кисело мляко, грах+риба
РЯДКО (≤2x/седмица): бекон, пуешка шунка
WHITELIST: ${dynamicWhitelistSection}${dynamicBlacklistSection}

ПРАВИЛА ЗА ИЗХОД:
• Естествен български език - БЕЗ технически кодове ([PRO], [ENG])
• Без странни комбинации - общоприети кулинарни норми
• Шаблон D не е "прегрешение" - нормална част от менюто (напр. уикенд), винаги балансиран със салата
• Адаптивност: Ако категория не може да се попълни → автоматично премини към позволена алтернатива

=== ИЗИСКВАНИЯ ===
1. Разпределение на калории: Използвай "Разпределение на калории" от стъпка 2 за правилно разпределение на калориите по хранения
2. Макроси ЗАДЪЛЖИТЕЛНИ: protein, carbs, fats, fiber в грамове за ВСЯКО ястие
3. Калории: protein×4 + carbs×4 + fats×9
4. Целеви дневни калории: ~${recommendedCalories} kcal (±${DAILY_CALORIE_TOLERANCE} kcal OK)
5. Брой хранения: ${strategy.mealCountJustification || '2-4 хранения според профила (1-2 при IF, 3-4 стандартно)'}
6. Ред: Закуска → Обяд → (Следобедна) → Вечеря → (Късна само ако: >4ч между вечеря и сън + обосновано: диабет, интензивни тренировки)
   Късна закуска САМО с low GI: кисело мляко, ядки, ягоди/боровинки, авокадо, семена (макс ${MAX_LATE_SNACK_CALORIES} kcal)
7. Разнообразие: Различни ястия от предишните дни${data.eatingHabits && data.eatingHabits.includes('Не закусвам') ? '\n8. ВАЖНО: Клиентът НЕ ЗАКУСВА - без закуска или само напитка!' : ''}

${MEAL_NAME_FORMAT_INSTRUCTIONS}
`;

  // Build JSON format example with all days in the chunk
  // Note: Indentation and formatting are intentional for AI model readability
  const mealTemplate = `{"type": "Закуска/Обяд/Вечеря", "name": "име", "weight": "Xg", "description": "описание", "benefits": "ползи", "calories": X, "macros": {"protein": X, "carbs": X, "fats": X, "fiber": X}}`;
  const dayTemplate = (dayNum) => `  "day${dayNum}": {
    "meals": [
      ${mealTemplate}
    ],
    "dailyTotals": {"calories": X, "protein": X, "carbs": X, "fats": X}
  }`;
  
  const jsonExample = [];
  for (let i = startDay; i <= endDay; i++) {
    jsonExample.push(dayTemplate(i));
  }
  
  defaultPrompt += `
JSON ФОРМАТ (дни ${startDay}-${endDay}):
{
${jsonExample.join(',\n')}
}

КРИТИЧНО: Върни JSON за ВСИЧКИ дни от ${startDay} до ${endDay} включително! Генерирай балансирани български ястия. ЗАДЪЛЖИТЕЛНО включи dailyTotals за всеки ден!`;
  
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
  // Check if there's a custom prompt in KV storage
  const customPrompt = await getCustomPrompt(env, 'admin_meal_plan_prompt');
  
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
  
  // If custom prompt exists, use it with variable replacement
  if (customPrompt) {
    let prompt = replacePromptVariables(customPrompt, {
      name: data.name,
      age: data.age,
      gender: data.gender,
      goal: data.goal,
      bmr: bmr,
      recommendedCalories: recommendedCalories,
      dietaryModifier: dietaryModifier,
      modifierReasoning: strategy.modifierReasoning || '',
      dietType: strategyCompact.dietType,
      mealTiming: strategyCompact.mealTiming,
      keyPrinciples: strategyCompact.keyPrinciples,
      foodsToInclude: strategyCompact.foodsToInclude,
      foodsToAvoid: strategyCompact.foodsToAvoid,
      modificationsSection: modificationsSection,
      dynamicWhitelistSection: dynamicWhitelistSection,
      dynamicBlacklistSection: dynamicBlacklistSection,
      errorPreventionComment: errorPreventionComment || '',
      mealCount: strategy.mealCount || 3,
      medicalConditions: JSON.stringify(data.medicalConditions || []),
      dietPreference: JSON.stringify(data.dietPreference || []),
      dietDislike: data.dietDislike || 'няма',
      dietLove: data.dietLove || 'няма'
    });
    
    // CRITICAL: Ensure JSON format instructions are included even with custom prompts
    if (!hasJsonFormatInstructions(prompt)) {
      prompt += `

═══ КРИТИЧНО ВАЖНО - ФОРМАТ НА ОТГОВОР ═══
Отговори САМО с валиден JSON обект БЕЗ допълнителни обяснения или текст преди или след JSON.

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

ВАЖНО: Върни САМО JSON без други текст или обяснения!`;
    }
    return prompt;
  }
  
  // Otherwise use default embedded prompt
  return `Ти действаш като Advanced Dietary Logic Engine (ADLE) – логически конструктор на хранителни режими.

=== КРИТИЧНО ВАЖНО - НИКАКВИ DEFAULT СТОЙНОСТИ ===
- Този план е САМО и ЕДИНСТВЕНО за ${data.name}
- ЗАБРАНЕНО е използването на универсални, общи или стандартни стойности
- ВСИЧКИ калории, макронутриенти и препоръки са ИНДИВИДУАЛНО изчислени
- Хранителните добавки са ПЕРСОНАЛНО подбрани според анализа и нуждите
- Психологическите съвети са базирани на КОНКРЕТНИЯ емоционален профил на ${data.name}

=== МОДИФИКАТОР (Потребителски профил) ===
ОПРЕДЕЛЕН МОДИФИКАТОР ЗА КЛИЕНТА: "${dietaryModifier}"
${strategy.modifierReasoning ? `ОБОСНОВКА: ${strategy.modifierReasoning}` : ''}

=== КЛИЕНТ И ЦЕЛИ ===
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

=== ADLE v5.1 - АРХИТЕКТУРА НА ХРАНЕНЕТО ===
УНИВЕРСАЛНА БАЗА ОТ РЕСУРСИ:
[PRO] БЕЛТЪК: месо (пилешко, говеждо, свинско), риба, яйца, млечни (сирене, извара, кисело мляко), бобови (леща, боб, нахут), тофу
[ENG] ЕНЕРГИЯ: зърнени (ориз, киноа, елда, овес, паста, хляб), кореноплодни (картофи, сладки картофи), плодове
[VOL] ОБЕМ И ФИБРИ: зеленчуци без скорбяла - сурови (салати, краставици, домати) или готвени (броколи, тиквички, чушки, гъби)
[FAT] МАЗНИНИ: зехтин, масло, авокадо, ядки, семена, тахан, маслини
[CMPX] СЛОЖНИ ЯСТИЯ: пица, лазаня, мусака, паста със сос, бургер, дюнер/врап, ризото, паеля

СТРУКТУРНИ ШАБЛОНИ:
Шаблон A "РАЗДЕЛЕНА ЧИНИЯ": [PRO] + [ENG] + [VOL] (напр. пиле + картофи + салата) - стандартен обяд/вечеря
Шаблон B "СМЕСЕНО ЯСТИЕ": [PRO] + [ENG] + [VOL] смесени (напр. яхния с месо и зеленчуци) - домашно готвено
Шаблон C "ЛЕКО/САНДВИЧ": [ENG-Хляб] + [PRO] + [FAT] + [VOL] (напр. сандвич с месо) - закуска/обяд в движение  
Шаблон D "ЕДИНЕН БЛОК": [CMPX] + [VOL задължително] (напр. лазаня + салата) - уикенд/свободно хранене

ФИЛТРИРАНЕ ПО МОДИФИКАТОР "${dietaryModifier}":
${dietaryModifier === 'Веган' ? '→ Без животински [PRO], използвай растителен' : dietaryModifier === 'Кето' || dietaryModifier === 'Нисковъглехидратно' ? '→ Минимизирай [ENG], компенсирай с [VOL] и [FAT]' : dietaryModifier === 'Без глутен' ? '→ [ENG] само безглутенови (ориз, картофи, царевица, киноа)' : dietaryModifier === 'Щадящ стомах' ? '→ [VOL] само готвени/щадящи, без сурови влакнини' : '→ Балансирано използване на всички категории'}

ДЕКОНСТРУКЦИЯ НА [CMPX]: Преди Шаблон D, провери съвместимост!
- При "Нисковъглехидратно": бургер → "Бургер без хлебче" или смени шаблона
- При "Веган": лазаня → "Веган лазаня със зеленчуци"
- Винаги добавяй [VOL] като баланс към сложните ястия

ПРАВИЛА ЗА ИЗХОД:
• Естествен български език - БЕЗ кодове ([PRO], [ENG])
• Без странни комбинации - общоприети кулинарни норми
• Шаблон D е нормална част от менюто (уикенд), винаги балансиран със салата

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

JSON (ТОЧЕН ФОРМАТ):
{
  "summary": {"bmr": ${bmr}, "dailyCalories": ${avgCalories}, "macros": {"protein": ${avgProtein}, "carbs": ${avgCarbs}, "fats": ${avgFats}}},
  "recommendations": ["храна 1", "храна 2", "храна 3", "храна 4", "храна 5"],
  "forbidden": ["храна 1", "храна 2", "храна 3"],
  "psychology": ${strategy.psychologicalSupport ? JSON.stringify(strategy.psychologicalSupport.slice(0, 3)) : '["съвет 1", "съвет 2"]'},
  "waterIntake": "${strategy.hydrationStrategy || '2-2.5л дневно'}",
  "supplements": ["добавка 1 (дозировка)", "добавка 2 (дозировка)"]
}

ЗАДЪЛЖИТЕЛНО:
- recommendations: МИН 3 конкретни храни подходящи за ${data.goal}
- forbidden: МИН 3 храни неподходящи за ${healthContext.keyProblems || 'общи рискове'}
- supplements: според медикаменти ${healthContext.medications} БЕЗ опасни взаимодействия
- psychology: от стратегия, максимум 3 съвета`;

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
      avgFats: avgFats,
      dynamicWhitelistSection: dynamicWhitelistSection,
      dynamicBlacklistSection: dynamicBlacklistSection,
      name: data.name,
      goal: data.goal,
      keyProblems: healthContext.keyProblems || 'няма',
      allergies: healthContext.allergies,
      medications: healthContext.medications,
      psychologicalSupport: JSON.stringify(psychologicalSupport.slice(0, 3)),
      hydrationStrategy: hydrationStrategy
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
    
    // Check for goal contradictions before generating plan
    const { hasContradiction, warningData } = detectGoalContradiction(data);
    
    if (hasContradiction) {
      return jsonResponse({ 
        success: true,
        hasContradiction: true,
        warningData: warningData,
        userId: userId 
      });
    }
    
    // Use multi-step approach for better individualization
    // No caching - client stores plan locally
    let structuredPlan = await generatePlanMultiStep(env, data);
    
    // ENHANCED: Implement step-specific correction loop
    // Instead of correcting the whole plan, regenerate from the earliest error step
    let validation = validatePlan(structuredPlan, data);
    let correctionAttempts = 0;
    
    // Safety check: ensure MAX_CORRECTION_ATTEMPTS is valid
    const maxAttempts = Math.max(0, MAX_CORRECTION_ATTEMPTS);
    
    while (!validation.isValid && correctionAttempts < maxAttempts) {
      correctionAttempts++;
      
      try {
        // Regenerate from the earliest error step with targeted error prevention
        structuredPlan = await regenerateFromStep(
          env, 
          data, 
          structuredPlan, 
          validation.earliestErrorStep, 
          validation.stepErrors,
          correctionAttempts
        );
        
        // Re-validate the regenerated plan
        validation = validatePlan(structuredPlan, data);
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
        try {
          // Generate simplified plan with reduced requirements
          const simplifiedPlan = await generateSimplifiedFallbackPlan(env, data);
          const fallbackValidation = validatePlan(simplifiedPlan, data);
          
          if (fallbackValidation.isValid) {
            const cleanPlan = removeInternalJustifications(simplifiedPlan);
            return jsonResponse({ 
              success: true, 
              plan: cleanPlan,
              userId: userId,
              correctionAttempts: correctionAttempts,
              fallbackUsed: true,
              note: "Използван опростен план поради технически проблеми с основния алгоритъм"
            });
          } else {
            console.error('handleGeneratePlan: Fallback plan failed validation:', fallbackValidation.errors);
            console.error('handleGeneratePlan: Fallback step errors:', JSON.stringify(fallbackValidation.stepErrors, null, 2));
          }
        } catch (fallbackError) {
          console.error('handleGeneratePlan: Simplified fallback also failed:', fallbackError);
          console.error('handleGeneratePlan: Fallback error stack:', fallbackError.stack);
        }
      }
      
      // If all strategies failed, return detailed error
      return jsonResponse({ 
        error: `Планът не премина качествен тест след ${correctionAttempts} опити за корекция: ${validation.errors.join('; ')}`,
        validationErrors: validation.errors,
        suggestion: "Моля, опитайте отново или свържете се с поддръжката"
      }, 400);
    }
    
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
 * REVOLUTIONARY OPTIMIZATION: Supports both full-context (legacy) and cached-context modes
 * Cached-context mode reduces payload from 10-20KB to ~100 bytes (85-95% reduction)
 */
async function handleChat(request, env) {
  try {
    const { message, userId, conversationId, mode, userData, userPlan, conversationHistory, useCachedContext } = await request.json();
    
    if (!message) {
      return jsonResponse({ error: ERROR_MESSAGES.MISSING_MESSAGE }, 400);
    }

    let effectiveUserData = userData;
    let effectiveUserPlan = userPlan;
    let cacheWasUsed = false;
    
    // REVOLUTIONARY OPTIMIZATION: Try to use cached context if requested
    if (useCachedContext && userId) {
      const cachedContext = getChatContext(userId);
      
      if (cachedContext) {
        // Use cached context - massive payload reduction!
        effectiveUserData = cachedContext.userData;
        effectiveUserPlan = cachedContext.userPlan;
        cacheWasUsed = true;
      } else {
        // Cache miss - validate that client provided full context as fallback
        if (!userData || !userPlan) {
          return jsonResponse({ 
            error: 'Chat context not cached and no fallback context provided. Please refresh or send full context.',
            cacheStatus: 'miss'
          }, 400);
        }
        
        // Store context for future requests
        setChatContext(userId, userData, userPlan);
      }
    } else {
      // Legacy mode - full context required
      if (!userData || !userPlan) {
        return jsonResponse({ 
          error: ERROR_MESSAGES.MISSING_CONTEXT
        }, 400);
      }
      
      // Store context for potential future use
      if (userId) {
        setChatContext(userId, userData, userPlan);
      }
    }

    // Use conversation history from client (defaults to empty array)
    const chatHistory = conversationHistory || [];
    
    // Determine chat mode (default: consultation)
    const chatMode = mode || 'consultation';
    
    // Build chat prompt with context and mode
    const chatPrompt = await generateChatPrompt(env, message, effectiveUserData, effectiveUserPlan, chatHistory, chatMode);
    
    // Call AI model with standard token limit (no need for large JSONs with new regeneration approach)
    // Skip JSON enforcement for chat to get plain text conversational responses
    const aiResponse = await callAIModel(env, chatPrompt, 2000, 'chat_consultation', null, effectiveUserData, null, true);
    
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
                  // Add to excluded foods regardless (as preference for future plan generations)
                  excludedFoods.add(foodName);
                  validatedModifications.push(mod);
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
          } else {
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
      const messageTokens = estimateTokenCount(msg.content);
      
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
      planUpdated: planWasUpdated,
      cacheUsed: cacheWasUsed // Inform client if cache was used
    };
    
    // Include updated plan and userData if plan was regenerated
    if (planWasUpdated) {
      responseData.updatedPlan = updatedPlan;
      responseData.updatedUserData = updatedUserData;
      
      // IMPORTANT: Invalidate cached context since plan changed
      // Client needs to send full context on next request to update cache
      if (userId) {
        invalidateChatContext(userId);
      }
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
 * Handle client data submission from questionnaire 2
 * Saves client data to KV storage for team processing
 * 
 * @example
 * // Request
 * POST /api/save-client-data
 * {
 *   "id": "client_1234567890_abc123",
 *   "timestamp": "2026-02-14T12:00:00.000Z",
 *   "answers": { ... },
 *   "files": [ ... ]
 * }
 * 
 * // Response
 * {
 *   "success": true,
 *   "clientId": "client_1234567890_abc123",
 *   "message": "Client data saved successfully"
 * }
 */
async function handleSaveClientData(request, env) {
  try {
    const data = await request.json();
    
    // Validate required fields
    if (!data.id || !data.timestamp || !data.answers) {
      return jsonResponse({ error: 'Missing required fields: id, timestamp, or answers' }, 400);
    }
    
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    const clientId = data.id;
    
    // Create client data object
    const clientData = {
      id: clientId,
      timestamp: data.timestamp,
      answers: data.answers,
      files: data.files || [],
      submittedAt: new Date().toISOString()
    };
    
    // Store client data in KV with client: prefix
    await env.page_content.put(`client:${clientId}`, JSON.stringify(clientData));
    
    // Maintain a list of all client IDs for easy retrieval
    let clientsList = await env.page_content.get('clients_list');
    clientsList = clientsList ? JSON.parse(clientsList) : [];
    clientsList.unshift(clientId); // Add to beginning (most recent first)
    
    // Keep only last 500 clients in the list
    if (clientsList.length > 500) {
      clientsList = clientsList.slice(0, 500);
    }
    
    await env.page_content.put('clients_list', JSON.stringify(clientsList));
    
    console.log('Client data saved:', clientId);
    
    return jsonResponse({ 
      success: true, 
      clientId: clientId,
      message: 'Client data saved successfully'
    });
  } catch (error) {
    console.error('Error saving client data:', error);
    return jsonResponse({ error: `Failed to save client data: ${error.message}` }, 500);
  }
}

/**
 * Get list of all client IDs with basic info (for admin panel)
 * Returns: Array of { id, timestamp, name, email }
 */
async function handleGetClientsList(request, env) {
  try {
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    // Get the list of all client IDs
    let clientsList = await env.page_content.get('clients_list');
    clientsList = clientsList ? JSON.parse(clientsList) : [];
    
    // Fetch basic info for each client (only first 100 for performance)
    const clientsToFetch = clientsList.slice(0, 100);
    
    // Fetch all clients in parallel for better performance
    const fetchPromises = clientsToFetch.map(async (clientId) => {
      try {
        const clientDataStr = await env.page_content.get(`client:${clientId}`);
        if (clientDataStr) {
          const clientData = JSON.parse(clientDataStr);
          return {
            id: clientData.id,
            timestamp: clientData.timestamp,
            submittedAt: clientData.submittedAt,
            name: clientData.answers?.name || 'N/A',
            email: clientData.answers?.email || 'N/A',
            goal: clientData.answers?.goal || 'N/A'
          };
        }
        return null;
      } catch (err) {
        console.error(`Error fetching client ${clientId}:`, err);
        return null;
      }
    });
    
    const results = await Promise.all(fetchPromises);
    const clientsData = results.filter(client => client !== null);
    const failedCount = results.length - clientsData.length;
    
    return jsonResponse({ 
      success: true, 
      clients: clientsData,
      total: clientsList.length,
      showing: clientsData.length,
      failedCount: failedCount
    });
  } catch (error) {
    console.error('Error getting clients list:', error);
    return jsonResponse({ error: `Failed to get clients list: ${error.message}` }, 500);
  }
}

/**
 * Get full data for a specific client (for admin panel)
 * Returns: Complete client data object
 */
async function handleGetClientData(request, env) {
  try {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId');
    
    if (!clientId) {
      return jsonResponse({ error: 'Missing clientId parameter' }, 400);
    }
    
    if (!env.page_content) {
      console.error('KV namespace not configured');
      return jsonResponse({ error: ERROR_MESSAGES.KV_NOT_CONFIGURED }, 500);
    }
    
    const clientDataStr = await env.page_content.get(`client:${clientId}`);
    
    if (!clientDataStr) {
      return jsonResponse({ error: 'Client not found' }, 404);
    }
    
    const clientData = JSON.parse(clientDataStr);
    
    return jsonResponse({ 
      success: true, 
      client: clientData
    });
  } catch (error) {
    console.error('Error getting client data:', error);
    return jsonResponse({ error: `Failed to get client data: ${error.message}` }, 500);
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
    } else if (earliestErrorStep === 'step4_final') {
      // Step 4: Final validation errors (summary, recommendations, forbidden, supplements, etc.)
      // Reuse weekPlan but regenerate the summary and final fields
      console.log('Regenerating Step 4 (Summary and Recommendations) with error prevention');
      
      // Parse BMR and calories from existing analysis
      let bmr;
      if (analysis.bmr) {
        if (typeof analysis.bmr === 'number') {
          bmr = Math.round(analysis.bmr);
        } else {
          const bmrMatch = String(analysis.bmr).match(/\d+/);
          bmr = bmrMatch ? parseInt(bmrMatch[0]) : null;
        }
      }
      if (!bmr) {
        bmr = calculateBMR(data);
      }
      
      let recommendedCalories;
      if (analysis.recommendedCalories) {
        if (typeof analysis.recommendedCalories === 'number') {
          recommendedCalories = Math.round(analysis.recommendedCalories);
        } else {
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
      
      // Regenerate summary with error prevention
      const summaryPrompt = await generateMealPlanSummaryPrompt(data, analysis, strategy, bmr, recommendedCalories, existingPlan.weekPlan, env);
      
      // Add error prevention comment to the prompt
      const summaryPromptWithErrors = errorPreventionComment + '\n\n' + summaryPrompt;
      
      const summaryInputTokens = estimateTokenCount(summaryPromptWithErrors);
      cumulativeTokens.input += summaryInputTokens;
      
      const summaryResponse = await callAIModel(env, summaryPromptWithErrors, SUMMARY_TOKEN_LIMIT, 'step4_summary_regen', sessionId, data, analysis);
      const summaryOutputTokens = estimateTokenCount(summaryResponse);
      cumulativeTokens.output += summaryOutputTokens;
      cumulativeTokens.total = cumulativeTokens.input + cumulativeTokens.output;
      
      const summaryData = parseAIResponse(summaryResponse);
      
      if (!summaryData || summaryData.error) {
        console.warn('Step 4 regeneration failed, using fallback values from strategy');
        // Use strategy fallback values
        const calculatedMacros = calculateAverageMacrosFromPlan(existingPlan.weekPlan);
        
        // Validate calculated macros and log warnings
        if (!calculatedMacros.protein || !calculatedMacros.carbs || !calculatedMacros.fats) {
          console.warn('Step 4 regeneration: calculateAverageMacrosFromPlan returned incomplete data:', calculatedMacros);
          console.warn('Step 4 regeneration: Using generic fallback macros instead');
        }
        
        mealPlan = {
          weekPlan: existingPlan.weekPlan,
          summary: {
            bmr: bmr,
            dailyCalories: recommendedCalories,
            macros: {
              protein: calculatedMacros.protein || 150,
              carbs: calculatedMacros.carbs || 200,
              fats: calculatedMacros.fats || 65
            }
          },
          recommendations: strategy.foodsToInclude || ['Варено пилешко месо', 'Киноа', 'Авокадо'],
          forbidden: strategy.foodsToAvoid || ['Бързи храни', 'Газирани напитки', 'Сладкиши'],
          psychology: strategy.psychologicalSupport || ['Бъдете последователни'],
          waterIntake: strategy.hydrationStrategy || "2-2.5л дневно",
          supplements: strategy.supplementRecommendations || []
        };
      } else {
        // Use regenerated summary data
        mealPlan = {
          weekPlan: existingPlan.weekPlan,
          summary: summaryData.summary || {
            bmr: bmr,
            dailyCalories: recommendedCalories,
            macros: summaryData.macros || {}
          },
          recommendations: summaryData.recommendations || strategy.foodsToInclude || ['Варено пилешко месо', 'Киноа', 'Авокадо'],
          forbidden: summaryData.forbidden || strategy.foodsToAvoid || ['Бързи храни', 'Газирани напитки', 'Сладкиши'],
          psychology: summaryData.psychology || strategy.psychologicalSupport || ['Бъдете последователни'],
          waterIntake: summaryData.waterIntake || strategy.hydrationStrategy || "2-2.5л дневно",
          supplements: summaryData.supplements || strategy.supplementRecommendations || []
        };
      }
      
      console.log('Step 4 regeneration complete');
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
  
  // Check cache first
  const now = Date.now();
  if (customPromptsCache[promptKey] && 
      customPromptsCacheTime[promptKey] && 
      (now - customPromptsCacheTime[promptKey]) < CUSTOM_PROMPTS_CACHE_TTL) {
    console.log(`[Cache HIT] Custom prompt '${promptKey}' from cache`);
    return customPromptsCache[promptKey];
  }
  
  console.log(`[Cache MISS] Loading custom prompt '${promptKey}' from KV`);
  try {
    const prompt = await env.page_content.get(promptKey);
    
    // Cache the result (even if null, to avoid repeated KV reads for non-existent keys)
    customPromptsCache[promptKey] = prompt;
    customPromptsCacheTime[promptKey] = now;
    
    return prompt;
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
  // IMPORTANT: Backend calculates reference values (BMR, TDEE, macros, safe deficit)
  // These are passed as REFERENCE CALCULATIONS to AI for validation and adjustment
  // AI performs holistic analysis and may adjust values based on ALL health correlates
  
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
    "probability": число,
    "reasoning": "текст"
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
    "risks": ["текст", "текст", "текст", "текст", "текст"]
  },
  "forecastOptimistic": {
    "timeframe": "текст",
    "weight": "текст",
    "health": "текст",
    "improvements": ["текст", "текст", "текст", "текст", "текст"]
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

ВАЖНО: Върни САМО JSON без други текст или обяснения!`;
    }
    return prompt;
  }
  
  // Build default prompt with optional error prevention comment
  // Pre-calculate backend values once to avoid redundant calculations
  const activityData = calculateUnifiedActivityScore(data);
  const bmr = calculateBMR(data);
  const tdee = calculateTDEE(bmr, activityData.combinedScore);
  const deficitData = calculateSafeDeficit(tdee, data.goal);
  const macros = calculateMacronutrientRatios(data, activityData.combinedScore, tdee);

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
  additionalNotes: data.additionalNotes,
  
  // Backend-computed values (already calculated, no need to recalculate)
  unifiedActivityScore: activityData,
  BMR: bmr,
  TDEE: tdee,
  safeDeficit: deficitData,
  macronutrientRatios: macros
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

═══ ТВОЯТА ЗАДАЧА - РАЗШИРЕН АНАЛИЗ ═══

Направи ХОЛИСТИЧЕН АНАЛИЗ, включващ следните стъпки:

1. BMI АНАЛИЗ:
   - Изчисли BMI = тегло(kg) / (височина(m))²
   - Категоризирай: Поднормено (<18.5), Нормално (18.5-25), Наднормено (25-30), Затлъстяване (>30)
   - Анализирай съответствие с целта

2. БАЗОВ МЕТАБОЛИЗЪМ (BMR) И TDEE:
   - Използвай Mifflin-St Jeor формулата (виж референтните изчисления)
   - Коригирай според активност скор 1-10 (${activityData.combinedScore}/10)
   - TDEE = BMR × активност фактор

3. СТАНДАРТ ЗА РАЗПРЕДЕЛЯНЕ НА МАКРОСИ:
   - Протеини: базирай на активност, цел и пол
   - Мазнини: необходими за хормонален баланс
   - Въглехидрати: според активност и метаболитен тип
   - Фибри: изчисли според пол, възраст и цел (обикновено ${FIBER_MIN_GRAMS}-${FIBER_MAX_GRAMS}г дневно, но персонализирай)

4. НИВО НА АКТИВНОСТ (скала 1-10):
   - Вече изчислено: ${activityData.combinedScore}/10 (${activityData.activityLevel})
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
      * Активност скор: ${activityData.combinedScore}/10
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
  "activityLevel": "ниво 1-10 и описание",
  "physiologicalPhase": "фаза според възраст и влияние",
  "waterDeficit": {
    "dailyNeed": "литри дневно",
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
    "correction": "описание на корекцията",
    "correctionPercent": "+/-X%"
  },
  "metabolicProfile": "анализ на метаболитния профил",
  "healthRisks": ["риск 1", "риск 2", "риск 3"],
  "nutritionalNeeds": ["нужда 1", "нужда 2", "нужда 3"],
  "psychologicalProfile": "детайлен анализ на психологическия профил",
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
    "risks": ["риск 1", "риск 2", "риск 3", "риск 4", "риск 5"]
  },
  "forecastOptimistic": {
    "timeframe": "12 месеца",
    "weight": "прогнозно тегло",
    "health": "прогнозно здраве",
    "improvements": ["подобрение 1", "подобрение 2", "подобрение 3", "подобрение 4", "подобрение 5"]
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

Бъди КОНКРЕТЕН за ${data.name}. Обяснявай ЗАЩО и КАК, не просто "добър" или "лош".
ВАЖНО: Направи анализ, който е индивидуализиран и базиран на ВСИЧКИ предоставени данни.`;
  
  return defaultPrompt;
}

async function generateStrategyPrompt(data, analysis, env, errorPreventionComment = null) {
  // Check if there's a custom prompt in KV storage
  const customPrompt = await getCustomPrompt(env, 'admin_strategy_prompt');
  
  // Extract only essential analysis data (COMPACT - no full JSON)
  const analysisCompact = {
    bmr: analysis.bmr || 'не изчислен',
    tdee: analysis.tdee || 'не изчислен',
    recommendedCalories: analysis.recommendedCalories || 'не изчислен',
    macroRatios: analysis.macroRatios ? 
      `Protein: ${analysis.macroRatios.protein != null ? analysis.macroRatios.protein + '%' : 'N/A'}, Carbs: ${analysis.macroRatios.carbs != null ? analysis.macroRatios.carbs + '%' : 'N/A'}, Fats: ${analysis.macroRatios.fats != null ? analysis.macroRatios.fats + '%' : 'N/A'}` : 
      'не изчислени',
    macroGrams: analysis.macroGrams ?
      `Protein: ${analysis.macroGrams.protein != null ? analysis.macroGrams.protein + 'g' : 'N/A'}, Carbs: ${analysis.macroGrams.carbs != null ? analysis.macroGrams.carbs + 'g' : 'N/A'}, Fats: ${analysis.macroGrams.fats != null ? analysis.macroGrams.fats + 'g' : 'N/A'}` :
      'не изчислени',
    metabolicProfile: (analysis.metabolicProfile || '').length > 200 ? 
      (analysis.metabolicProfile || '').substring(0, 200) + '...' : 
      (analysis.metabolicProfile || 'не е анализиран'),
    psychoProfile: analysis.psychoProfile ? 
      (analysis.psychoProfile.temperament ? 
        `${analysis.psychoProfile.temperament} (${analysis.psychoProfile.probability}% вероятност)` :
        `Не определен (<80% вероятност, ${analysis.psychoProfile.probability || 0}%)`) :
      'не е анализиран',
    healthRisks: (analysis.healthRisks || []).slice(0, 3).join('; '),
    nutritionalNeeds: (analysis.nutritionalNeeds || []).slice(0, 3).join('; '),
    psychologicalProfile: (analysis.psychologicalProfile || '').length > 150 ?
      (analysis.psychologicalProfile || '').substring(0, 150) + '...' : 
      (analysis.psychologicalProfile || 'не е анализиран'),
    successChance: analysis.successChance || 'не изчислен',
    keyProblems: (analysis.keyProblems || [])
      .filter(p => p && p.title && p.severity)
      .slice(0, 3)
      .map(p => `${p.title} (${p.severity})`)
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
      goal: data.goal,
      bmr: analysisCompact.bmr,
      tdee: analysisCompact.tdee,
      recommendedCalories: analysisCompact.recommendedCalories,
      macroRatios: analysisCompact.macroRatios,
      macroGrams: analysisCompact.macroGrams,
      metabolicProfile: analysisCompact.metabolicProfile,
      psychoProfile: analysisCompact.psychoProfile,
      healthRisks: analysisCompact.healthRisks,
      nutritionalNeeds: analysisCompact.nutritionalNeeds,
      psychologicalProfile: analysisCompact.psychologicalProfile,
      successChance: analysisCompact.successChance,
      keyProblems: analysisCompact.keyProblems,
      dietPreference: JSON.stringify(data.dietPreference || []),
      dietPreference_other: data.dietPreference_other || '',
      dietDislike: data.dietDislike || '',
      dietLove: data.dietLove || '',
      additionalNotes: data.additionalNotes || '',
      eatingHabits: JSON.stringify(data.eatingHabits || []),
      chronotype: data.chronotype || 'Среден тип'
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
  "modifierReasoning": "текст",
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

ВАЖНО: Върни САМО JSON без други текст или обяснения!`;
    }
    return prompt;
  }
  
  // Build default prompt with optional error prevention comment
  let defaultPrompt = '';
  
  if (errorPreventionComment) {
    defaultPrompt += errorPreventionComment + '\n\n';
  }
  
  defaultPrompt += `Базирайки се на здравословния профил и анализа, определи оптималната диетична стратегия:

КЛИЕНТ: ${data.name}, ${data.age} год., Цел: ${data.goal}

АНАЛИЗ (КОМПАКТЕН):
- BMR/TDEE/Калории: ${analysisCompact.bmr} / ${analysisCompact.tdee} / ${analysisCompact.recommendedCalories}
- Макро съотношения: ${analysisCompact.macroRatios}
- Макро грамове дневно: ${analysisCompact.macroGrams}
- Метаболитен профил: ${analysisCompact.metabolicProfile}
- Здравни рискове: ${analysisCompact.healthRisks}
- Хранителни нужди: ${analysisCompact.nutritionalNeeds}
- Психологически профил: ${analysisCompact.psychologicalProfile}
- Шанс за успех: ${analysisCompact.successChance}
- Ключови проблеми: ${analysisCompact.keyProblems}

ПРЕДПОЧИТАНИЯ:
- Диетични предпочитания: ${JSON.stringify(data.dietPreference || [])}
${data.dietPreference_other ? `  (Друго: ${data.dietPreference_other})` : ''}
- Не обича/непоносимост: ${data.dietDislike || 'Няма'}
- Любими храни: ${data.dietLove || 'Няма'}

${data.additionalNotes ? `
═══ 🔥 КРИТИЧНО ВАЖНА ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ 🔥 ═══
⚠️ МАКСИМАЛЕН ПРИОРИТЕТ: Следната информация е предоставена директно от потребителя и ТРЯБВА да се взема предвид при създаването на стратегията!
Това може да променя критично избора на модификатор, брой хранения, време на хранене и цялостния подход!

ДОПЪЛНИТЕЛНИ БЕЛЕЖКИ ОТ ${data.name}:
${data.additionalNotes}

⚠️ ЗАДЪЛЖИТЕЛНО: Адаптирай стратегията на база тази информация, особено:
1. Избора на dietaryModifier и modifierReasoning
2. Времето на хранене (mealTiming)
3. Броя хранения (mealCountJustification)
4. Психологическата подкрепа и дългосрочна стратегия
5. Специфични хранителни препоръки
═══════════════════════════════════════════════════════════════
` : ''}

ВАЖНО: Анализирай холистично всички фактори и създай индивидуализирана стратегия за ${data.name}.
Фокусирай се на постигането на здравословните цели и запазването на здравето на клиента.

═══ СПЕЦИАЛНИ ИЗИСКВАНИЯ ЗА СЕДМИЧНА СХЕМА ═══

1. ОПРЕДЕЛЯНЕ НА СЕДМИЧНА СХЕМА:
   - Определи за всеки ден: колко хранения и кога
   - Адаптирай според:
     * Хранителни навици: ${JSON.stringify(data.eatingHabits || [])}
     * Хронотип: ${data.chronotype}
     * Психопрофил от анализа
     * Цел: ${data.goal}

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
  "dietaryModifier": "термин за основен диетичен профил (напр. Балансирано, Кето, Веган, Средиземноморско, Нисковъглехидратно, Щадящ стомах)",
  "modifierReasoning": "Детайлно обяснение защо този МОДИФИКАТОР е избран СПЕЦИФИЧНО за ${data.name}",
  "welcomeMessage": "ЗАДЪЛЖИТЕЛНО ПОЛЕ: ПЕРСОНАЛИЗИРАНО приветствие за ${data.name} при първото разглеждане на плана. Тонът трябва да бъде професионален, но топъл и мотивиращ. Включи: 1) Персонално поздравление с име, 2) Кратко споменаване на конкретни фактори от профила (възраст, цел, ключови предизвикателства), 3) Как планът е създаден специално за техните нужди, 4) Положителна визия за постигане на целите. Дължина: 150-250 думи. ВАЖНО: Избягвай генерични фрази - използвай конкретни детайли за ${data.name}.",
  "planJustification": "ЗАДЪЛЖИТЕЛНО ПОЛЕ: Обосновка на цялостната стратегия - брой хранения, време на хранене, циклично разпределение (ако има), и ЗАЩО тази стратегия е оптимална за ${data.name}. Минимум 100 символа.",
  "longTermStrategy": "Как планът работи седмично/циклично (разпределение калории/макроси, варииране хранения)",
  "mealCountJustification": "Защо този брой хранения (1-5) - стратегическа/физиологична/психологическа причина",
  "afterDinnerMealJustification": "Ако има хранения след вечеря, защо са необходими. Ако няма - 'Не са необходими'",
  "dietType": "тип диета персонализиран за ${data.name} (напр. средиземноморска, балансирана, ниско-въглехидратна)",
  "weeklyMealPattern": "ХОЛИСТИЧНА седмична схема на хранене (напр. '16:8 интермитентно гладуване ежедневно', '5:2 подход', 'циклично фастинг', 'свободен уикенд', или традиционна схема с варииращи хранения)",
  "weeklyScheme": {
    "monday": {"meals": число, "description": "текст за ден"},
    "tuesday": {"meals": число, "description": "текст за ден"},
    "wednesday": {"meals": число, "description": "текст за ден"},
    "thursday": {"meals": число, "description": "текст за ден"},
    "friday": {"meals": число, "description": "текст за ден"},
    "saturday": {"meals": число, "description": "текст за ден"},
    "sunday": {"meals": число, "description": "текст за ден (включи свободно хранене ако е подходящо)"}
  },
  "breakfastStrategy": "текст - ако не закусва, какво се препоръчва вместо закуска",
  "calorieDistribution": "текст - как се разпределят калориите по дни и хранения",
  "macroDistribution": "текст - как се разпределят макросите според дни/хранения",
  "mealTiming": {
    "pattern": "седмичен модел на хранене БЕЗ точни часове - използвай концепции като 'закуска', 'обяд', 'вечеря' според профила. Напр. 'Понеделник-Петък: 2 хранения (обяд, вечеря), Събота-Неделя: 3 хранения с закуска'",
    "fastingWindows": "периоди на гладуване ако се прилага (напр. '16 часа между последно хранене и следващо', или 'не се прилага')",
    "flexibility": "описание на гъвкавостта в схемата според дните и нуждите",
    "chronotypeGuidance": "ВАЖНО (Issue #30): Обясни КАК хронотипът ${data.chronotype} влияе на времето на хранене - напр. 'Ранобудна птица: Закуска 07:00-08:00, Вечеря до 19:00' или 'Нощна птица: Първо хранене 12:00-13:00, Последно 22:00-23:00'"
  },
  "keyPrinciples": ["принцип 1 специфичен за ${data.name}", "принцип 2 специфичен за ${data.name}", "принцип 3 специфичен за ${data.name}"],
  "foodsToInclude": ["храна 1 подходяща за ${data.name}", "храна 2 подходяща за ${data.name}", "храна 3 подходяща за ${data.name}"],
  "foodsToAvoid": ["храна 1 неподходяща за ${data.name}", "храна 2 неподходяща за ${data.name}", "храна 3 неподходяща за ${data.name}"],
  "supplementRecommendations": [
    "Индивидуална добавка 1 (с дозировка и обосновка специфична за ${data.name})",
    "Индивидуална добавка 2 (с дозировка и обосновка специфична за ${data.name})",
    "Индивидуална добавка 3 (с дозировка и обосновка специфична за ${data.name})"
  ],
  "hydrationStrategy": "препоръки за прием на течности персонализирани за ${data.name} според активност и климат",
  "communicationStyle": {
    "temperament": "определен темперамент от анализа (ако >80%)",
    "tone": "тон на комуникация според психопрофил",
    "approach": "подход към комуникация с клиента",
    "chatGuidelines": "насоки как AI асистентът трябва да общува с ${data.name}"
  },
  "psychologicalSupport": [
    "Психологически съвет 1 базиран на емоционалното хранене на ${data.name}",
    "Психологически съвет 2 базиран на стреса и поведението на ${data.name}",
    "Психологически съвет 3 за мотивация специфичен за профила на ${data.name}"
  ]
}

Създай персонализирана стратегия за ${data.name} базирана на техния уникален профил.`;
  
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
  const totalDays = 7;
  const chunks = Math.ceil(totalDays / DAYS_PER_CHUNK);
  const weekPlan = {};
  const previousDays = []; // Track previous days for variety
  
  // Cache dynamic food lists once (prevents 4 redundant calls per generation)
  const cachedFoodLists = await getDynamicFoodListsSections(env);
  
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
    
    try {
      const chunkPrompt = await generateMealPlanChunkPrompt(
        data, analysis, strategy, bmr, recommendedCalories,
        startDay, endDay, previousDays, env, errorPreventionComment, cachedFoodLists
      );
      
      const chunkResponse = await callAIModel(env, chunkPrompt, MEAL_PLAN_TOKEN_LIMIT, `step3_meal_plan_chunk_${chunkIndex + 1}`, sessionId, data, analysis);
      const chunkData = parseAIResponse(chunkResponse);
      
      if (!chunkData || chunkData.error) {
        const errorMsg = chunkData.error || 'Invalid response';
        throw new Error(`Chunk ${chunkIndex + 1} failed: ${errorMsg}`);
      }
      
      // Log the structure of chunkData for debugging
      console.log(`Chunk ${chunkIndex + 1} data keys:`, Object.keys(chunkData));
      
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
          // Log what keys are actually present
          console.error(`Missing ${dayKey} in chunk ${chunkIndex + 1}. Available keys:`, Object.keys(chunkData));
          throw new Error(`Missing ${dayKey} in chunk ${chunkIndex + 1} response. Available keys: ${Object.keys(chunkData).join(', ')}`);
        }
      }
    } catch (error) {
      throw new Error(`Генериране на дни ${startDay}-${endDay}: ${error.message}`);
    }
  }
  
  // Generate summary, recommendations, etc. in final request
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
 * Log AI communication to Cache API (normal) and KV (errors only)
 * HYBRID APPROACH:
 * - All logs → Cache API (free, no quota impact, 24h TTL)
 * - Errors only → KV (permanent, for debugging, minimal quota impact)
 * Tracks all communication between backend and AI model
 */
async function logAIRequest(env, stepName, requestData) {
  try {
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
      calculatedData: requestData.calculatedData || null,
      // Flag for error state
      hasError: !!requestData.error,
      error: requestData.error || null
    };

    // ALWAYS store in Cache API (no KV quota impact!)
    await cacheSet(`ai_communication_log:${logId}`, logEntry, AI_LOG_CACHE_TTL);
    
    // Get or create session index from Cache API
    let sessionIndex = await cacheGet('ai_communication_session_index');
    sessionIndex = sessionIndex || [];
    
    // Add sessionId to index if not already present
    if (!sessionIndex.includes(sessionId)) {
      sessionIndex.unshift(sessionId); // Add to beginning (most recent first)
      
      // Keep only the last MAX_LOG_ENTRIES sessions
      if (sessionIndex.length > MAX_LOG_ENTRIES) {
        sessionIndex = sessionIndex.slice(0, MAX_LOG_ENTRIES);
      }
      
      await cacheSet('ai_communication_session_index', sessionIndex, AI_LOG_CACHE_TTL);
    }
    
    // Add log to session's log list in Cache API
    let sessionLogs = await cacheGet(`ai_session_logs:${sessionId}`);
    sessionLogs = sessionLogs || [];
    sessionLogs.push(logId);
    await cacheSet(`ai_session_logs:${sessionId}`, sessionLogs, AI_LOG_CACHE_TTL);
    
    // HYBRID: If there's an error, ALSO store in KV for permanent debugging
    if (requestData.error && AI_ERROR_LOG_KV_ENABLED && env && env.page_content) {
      try {
        await env.page_content.put(
          `ai_error_log:${logId}`,
          JSON.stringify(logEntry)
        );
        console.log(`[KV] Error logged to KV for permanent storage: ${stepName} (${logId})`);
      } catch (kvError) {
        console.error('[KV] Failed to log error to KV:', kvError);
        // Continue - error is still in Cache API
      }
    }
    
    console.log(`[Cache API] AI request logged: ${stepName} (${logId}, session: ${sessionId})`);
    return logId;
  } catch (error) {
    console.error('[Cache API] Failed to log AI request:', error);
    return null;
  }
}

async function logAIResponse(env, logId, stepName, responseData) {
  try {
    if (!logId) {
      console.warn('[Cache API] Missing logId, skipping AI response logging');
      return;
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
      error: responseData.error || null,
      hasError: !!responseData.error || !responseData.success
    };

    // ALWAYS store response in Cache API (no KV quota impact!)
    await cacheSet(`ai_communication_log:${logId}_response`, logEntry, AI_LOG_CACHE_TTL);
    
    // HYBRID: If there's an error or failure, ALSO store in KV for permanent debugging
    if ((responseData.error || !responseData.success) && AI_ERROR_LOG_KV_ENABLED && env && env.page_content) {
      try {
        await env.page_content.put(
          `ai_error_log:${logId}_response`,
          JSON.stringify(logEntry)
        );
        console.log(`[KV] Error response logged to KV for permanent storage: ${stepName} (${logId})`);
      } catch (kvError) {
        console.error('[KV] Failed to log error response to KV:', kvError);
        // Continue - error is still in Cache API
      }
    }
    
    console.log(`[Cache API] AI response logged: ${stepName} (${logId})`);
  } catch (error) {
    console.error('[Cache API] Failed to log AI response:', error);
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
    
    // Invalidate custom prompts cache for this specific prompt key
    invalidateCustomPromptsCache(key);
    
    return jsonResponse({ success: true, message: 'Prompt saved successfully' });
  } catch (error) {
    console.error('Error saving prompt:', error);
    return jsonResponse({ error: 'Failed to save prompt: ' + error.message }, 500);
  }
}

/**

/**
 * Admin: Get default prompt for viewing in admin panel
 * Reads prompts directly from KV storage (admin_*_prompt keys)
 * These are the ACTUAL prompts used in generation
 */
async function handleGetDefaultPrompt(request, env) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    
    if (!type) {
      return jsonResponse({ error: 'Missing prompt type parameter' }, 400);
    }
    
    // Map prompt types to KV keys
    const promptKeyMap = {
      'analysis': 'admin_analysis_prompt',
      'strategy': 'admin_strategy_prompt',
      'meal_plan': 'admin_meal_plan_prompt',
      'summary': 'admin_summary_prompt',
      'consultation': 'admin_consultation_prompt',
      'modification': 'admin_modification_prompt',
      'correction': 'admin_correction_prompt'
    };
    
    const kvKey = promptKeyMap[type];
    if (!kvKey) {
      return jsonResponse({ 
        error: `Unknown prompt type: ${type}. Valid types: analysis, strategy, meal_plan, summary, consultation, modification, correction` 
      }, 400);
    }
    
    // Try to read from KV storage
    let prompt = null;
    if (env.page_content) {
      try {
        prompt = await env.page_content.get(kvKey);
      } catch (error) {
        console.error(`Error reading prompt ${kvKey} from KV:`, error);
      }
    }
    
    if (!prompt) {
      return jsonResponse({ 
        error: `Prompt not found in KV storage. Please upload prompts using ./KV/upload-kv-keys.sh`,
        hint: `Missing key: ${kvKey}`
      }, 404);
    }
    
    return jsonResponse({ success: true, prompt: prompt }, 200, {
      cacheControl: 'public, max-age=1800' // Cache for 30 minutes
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
/**
 * Get AI communication logs
 * Retrieves AI logs from Cache API (free, no KV quota impact)
 * 
 * @param {Request} request - HTTP request with optional query params (limit, offset)
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response with:
 *   - logs: Array of log entries (request + response pairs)
 *   - total: Total number of logs
 *   - limit: Number of logs per page
 *   - offset: Starting position for pagination
 *   - sessionCount: Number of sessions
 *   - storageType: 'cache' (indicates logs are from Cache API, not KV)
 */
async function handleGetAILogs(request, env) {
  try {
    // AI logs are now stored in Cache API (free, no KV quota impact)
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    
    // Get session index from Cache API
    let sessionIndex = await cacheGet('ai_communication_session_index');
    
    if (sessionIndex && sessionIndex.length > 0) {
      // Session-based format (current)
      const sessionIds = sessionIndex;
      
      // Get all log IDs from ALL sessions (not just the latest one)
      const allLogIds = [];
      for (const sessionId of sessionIds) {
        const sessionLogsData = await cacheGet(`ai_session_logs:${sessionId}`);
        if (sessionLogsData) {
          allLogIds.push(...sessionLogsData);
        }
      }
      
      if (allLogIds.length === 0) {
        return jsonResponse({ success: true, logs: [], total: 0 });
      }
      
      const total = allLogIds.length;
      
      // Apply pagination
      const paginatedIds = allLogIds.slice(offset, offset + limit);
      
      // Fetch logs in parallel from Cache API
      const logPromises = paginatedIds.flatMap(logId => [
        cacheGet(`ai_communication_log:${logId}`),
        cacheGet(`ai_communication_log:${logId}_response`)
      ]);
      
      const logData = await Promise.all(logPromises);
      
      // Combine request and response logs
      const logs = [];
      for (let i = 0; i < paginatedIds.length; i++) {
        const requestLog = logData[i * 2];
        const responseLog = logData[i * 2 + 1];
        
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
        sessionCount: sessionIds.length,
        storageType: 'cache' // Indicate logs are from Cache API
      }, 200, {
        cacheControl: 'public, max-age=60' // Cache for 1 minute - logs are frequently updated
      });
    } else {
      // No logs found
      return jsonResponse({ 
        success: true, 
        logs: [], 
        total: 0,
        storageType: 'cache'
      });
    }
  } catch (error) {
    console.error('[Cache API] Error fetching AI logs:', error);
    return jsonResponse({ error: 'Failed to fetch AI logs', details: error.message }, 500);
  }
}

/**
 * Cleanup AI logs - delete all previous logs and keep only the most recent one
 * NOTE: Cache API logs automatically expire after 24 hours, so this is optional
 */
async function handleCleanupAILogs(request, env) {
  try {
    // AI logs are now in Cache API and automatically expire after 24 hours
    // This function manually clears all logs from cache
    
    // Get session index from Cache API
    let sessionIndex = await cacheGet('ai_communication_session_index');
    
    if (!sessionIndex || sessionIndex.length === 0) {
      return jsonResponse({ 
        success: true, 
        message: 'No logs to cleanup', 
        deletedCount: 0,
        storageType: 'cache'
      });
    }
    
    // Get all log IDs from all sessions
    const allLogIds = [];
    for (const sessionId of sessionIndex) {
      const sessionLogsData = await cacheGet(`ai_session_logs:${sessionId}`);
      if (sessionLogsData) {
        allLogIds.push(...sessionLogsData);
      }
    }
    
    if (allLogIds.length === 0) {
      return jsonResponse({ 
        success: true, 
        message: 'No logs to cleanup', 
        deletedCount: 0,
        storageType: 'cache'
      });
    }
    
    // Delete all log entries from Cache API
    const deletePromises = [];
    for (const logId of allLogIds) {
      deletePromises.push(
        cacheDelete(`ai_communication_log:${logId}`),
        cacheDelete(`ai_communication_log:${logId}_response`)
      );
    }
    
    // Delete session logs
    for (const sessionId of sessionIndex) {
      deletePromises.push(cacheDelete(`ai_session_logs:${sessionId}`));
    }
    
    // Delete session index
    deletePromises.push(cacheDelete('ai_communication_session_index'));
    
    await Promise.all(deletePromises);
    
    console.log(`[Cache API] Cleaned up ${allLogIds.length} log entries from ${sessionIndex.length} sessions`);
    
    return jsonResponse({ 
      success: true, 
      message: `Successfully cleaned up ${allLogIds.length} log entries from ${sessionIndex.length} sessions`,
      deletedCount: allLogIds.length,
      sessionCount: sessionIndex.length,
      storageType: 'cache'
    }, 200);
  } catch (error) {
    console.error('[Cache API] Error cleaning up AI logs:', error);
    return jsonResponse({ error: 'Failed to cleanup AI logs: ' + error.message }, 500);
  }
}

/**
 * Export AI communication logs to a text file
 * Returns all steps with sent data, prompts, and AI responses
 */
async function handleExportAILogs(request, env) {
  try {
    // AI logs are now in Cache API
    // Get session index from Cache API
    let sessionIndex = await cacheGet('ai_communication_session_index');
    
    if (!sessionIndex || sessionIndex.length === 0) {
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
    
    // Export only the last (most recent) plan - sessionIndex[0] is most recent
    const lastSessionId = sessionIndex[0];
    
    const allLogIds = await cacheGet(`ai_session_logs:${lastSessionId}`) || [];
    
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
    
    // Fetch all logs for the last session from Cache API
    const logPromises = allLogIds.flatMap(logId => [
      cacheGet(`ai_communication_log:${logId}`),
      cacheGet(`ai_communication_log:${logId}_response`)
    ]);
    
    const logData = await Promise.all(logPromises);
    
    // Build text content
    let textContent = '='.repeat(80) + '\n';
    textContent += 'AI КОМУНИКАЦИОННИ ЛОГОВЕ - ПОСЛЕДЕН ПЛАН\n';
    textContent += '(Съхранени в Cache API - автоматично изтриване след 24 часа)\n';
    textContent += '='.repeat(80) + '\n\n';
    textContent += `Дата на експорт: ${new Date().toISOString()}\n`;
    textContent += `Сесия: ${lastSessionId}\n`;
    textContent += `Общо стъпки: ${allLogIds.length}\n`;
    textContent += '\n';
    
    // Note: logData contains paired entries (request, response) for each log ID
    // Each log ID maps to 2 entries in logData: [request at i*2, response at i*2+1]
    for (let i = 0; i < allLogIds.length; i++) {
      const requestLog = logData[i * 2];
      const responseLog = logData[i * 2 + 1];
      
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
  } catch (error) {
    console.error('[Cache API] Error exporting AI logs:', error);
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
      
      // Invalidate food lists cache
      invalidateFoodListsCache();
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
    
    // Invalidate food lists cache
    invalidateFoodListsCache();
    
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
      
      // Invalidate food lists cache
      invalidateFoodListsCache();
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
    
    // Invalidate food lists cache
    invalidateFoodListsCache();
    
    return jsonResponse({ success: true, whitelist: whitelist });
  } catch (error) {
    console.error('Error removing from whitelist:', error);
    return jsonResponse({ error: `Failed to remove from whitelist: ${error.message}` }, 500);
  }
}

/**
 * Web Push Protocol Implementation
 * 
 * Helper functions to implement Web Push protocol with VAPID authentication
 * without external dependencies, using Web Crypto API available in Cloudflare Workers.
 */

/**
 * Convert base64url string to Uint8Array
 */
function base64UrlToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Convert Uint8Array to base64url string
 */
function uint8ArrayToBase64Url(uint8Array) {
  const base64 = btoa(String.fromCharCode.apply(null, uint8Array));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Convert raw VAPID keys (base64url format) to JWK format
 * 
 * The web-push library generates VAPID keys as base64url-encoded raw keys.
 * However, Web Crypto API requires EC private keys to be imported in either
 * PKCS8 or JWK format. This function converts the raw keys to JWK format.
 * 
 * @param {string} publicKeyBase64Url - VAPID public key in base64url format
 * @param {string} privateKeyBase64Url - VAPID private key in base64url format
 * @returns {Object} JWK object for the private key
 */
function vapidKeysToJWK(publicKeyBase64Url, privateKeyBase64Url) {
  // Decode the public key (65 bytes: 0x04 + 32 bytes x + 32 bytes y)
  const publicKeyBytes = base64UrlToUint8Array(publicKeyBase64Url);
  
  if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04) {
    throw new Error('Invalid VAPID public key format. Expected 65 bytes starting with 0x04.');
  }
  
  // Extract x and y coordinates (32 bytes each)
  const x = publicKeyBytes.slice(1, 33);
  const y = publicKeyBytes.slice(33, 65);
  
  // The private key is the scalar d (32 bytes)
  const d = base64UrlToUint8Array(privateKeyBase64Url);
  
  if (d.length !== 32) {
    throw new Error('Invalid VAPID private key format. Expected 32 bytes.');
  }
  
  // Create JWK object
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: uint8ArrayToBase64Url(x),
    y: uint8ArrayToBase64Url(y),
    d: uint8ArrayToBase64Url(d)
  };
  
  return jwk;
}

/**
 * Encrypt payload for Web Push using RFC 8291 (aes128gcm)
 * 
 * @param {string} payload - The message payload to encrypt
 * @param {string} userPublicKey - Base64url-encoded user agent public key (p256dh)
 * @param {string} userAuth - Base64url-encoded user agent auth secret
 * @returns {Promise<Object>} Encrypted data with salt and public key
 */
async function encryptWebPushPayload(payload, userPublicKey, userAuth) {
  // Generate a random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  
  // Generate a local key pair (application server keys for this message)
  const localKeyPair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveBits']
  ));
  
  // Export local public key in raw format
  const localPublicKey = /** @type {ArrayBuffer} */ (await crypto.subtle.exportKey('raw', localKeyPair.publicKey));
  const localPublicKeyBytes = new Uint8Array(localPublicKey);
  
  // Decode user's public key and auth secret
  const userPublicKeyBytes = base64UrlToUint8Array(userPublicKey);
  const userAuthBytes = base64UrlToUint8Array(userAuth);
  
  // Import user's public key for ECDH
  const importedUserPublicKey = await crypto.subtle.importKey(
    'raw',
    userPublicKeyBytes,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    ['deriveBits']
  );
  
  // Perform ECDH to get shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: importedUserPublicKey
    },
    localKeyPair.privateKey,
    256
  );
  
  // Derive keys using HKDF as per RFC 8291
  // Step 1: Derive IKM (Input Keying Material) from shared secret and auth
  // Per RFC 8291: IKM = HKDF-Extract(auth_secret, shared_secret)
  const authInfo = new TextEncoder().encode('Content-Encoding: auth\0');
  const ikm = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: userAuthBytes, // auth secret as salt
      info: authInfo
    },
    await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveBits']),
    256
  );
  
  // Step 2: Build context for key and nonce derivation
  // Context = clientPublicKey || serverPublicKey
  const context = new Uint8Array(userPublicKeyBytes.length + localPublicKeyBytes.length);
  context.set(userPublicKeyBytes, 0);
  context.set(localPublicKeyBytes, userPublicKeyBytes.length);
  
  // Step 3: Derive Content Encryption Key (CEK)
  const keyInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const keyInfoFull = new Uint8Array(keyInfo.length + context.length);
  keyInfoFull.set(keyInfo, 0);
  keyInfoFull.set(context, keyInfo.length);
  
  const cek = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt,
      info: keyInfoFull
    },
    await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']),
    128 // 16 bytes for AES-128
  );
  
  // Step 4: Derive Nonce
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonceInfoFull = new Uint8Array(nonceInfo.length + context.length);
  nonceInfoFull.set(nonceInfo, 0);
  nonceInfoFull.set(context, nonceInfo.length);
  
  const nonce = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt,
      info: nonceInfoFull
    },
    await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']),
    96 // 12 bytes for GCM nonce
  );
  
  // Step 5: Prepare payload with padding
  const payloadBytes = new TextEncoder().encode(payload);
  const paddingLength = 0; // No padding for simplicity
  
  // Record format: padding_length (2 bytes) + padding + payload
  const record = new Uint8Array(2 + paddingLength + payloadBytes.length);
  record[0] = (paddingLength >> 8) & 0xFF;
  record[1] = paddingLength & 0xFF;
  record.set(payloadBytes, 2 + paddingLength);
  
  // Step 6: Encrypt the record with AES-128-GCM
  const cekKey = await crypto.subtle.importKey(
    'raw',
    cek,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(nonce),
      tagLength: 128
    },
    cekKey,
    record
  );
  
  // Return encrypted payload, salt, and server public key
  return {
    ciphertext: new Uint8Array(encrypted),
    salt: salt,
    publicKey: localPublicKeyBytes
  };
}

/**
 * Send Web Push notification with VAPID authentication and RFC 8291 encryption
 * 
 * @param {Object} subscription - Push subscription object with endpoint and keys
 * @param {string} payload - JSON string to send
 * @param {Object} env - Environment with VAPID keys
 * @returns {Promise<Response>} Push service response
 */
async function sendWebPushNotification(subscription, payload, env) {
  const vapidPublicKey = env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = env.VAPID_PRIVATE_KEY;
  
  if (!vapidPublicKey || !vapidPrivateKey) {
    throw new Error('VAPID keys not configured');
  }
  
  // Extract push service endpoint URL
  const endpoint = subscription.endpoint;
  const audienceUrl = new URL(endpoint);
  const audience = `${audienceUrl.protocol}//${audienceUrl.host}`;
  
  // Create JWT header and payload for VAPID
  const jwtHeader = {
    typ: 'JWT',
    alg: 'ES256'
  };
  
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours expiration
  const jwtPayload = {
    aud: audience,
    exp: exp,
    sub: env.VAPID_EMAIL || 'mailto:admin@biocode.website'
  };
  
  // Encode header and payload
  const headerEncoded = uint8ArrayToBase64Url(
    new TextEncoder().encode(JSON.stringify(jwtHeader))
  );
  const payloadEncoded = uint8ArrayToBase64Url(
    new TextEncoder().encode(JSON.stringify(jwtPayload))
  );
  
  const unsignedToken = `${headerEncoded}.${payloadEncoded}`;
  
  // Import VAPID private key for signing
  // Convert raw VAPID keys (from web-push generate-vapid-keys) to JWK format
  const privateKeyJwk = vapidKeysToJWK(vapidPublicKey, vapidPrivateKey);
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    false,
    ['sign']
  );
  
  // Sign the JWT
  const signature = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' }
    },
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );
  
  const signatureBase64 = uint8ArrayToBase64Url(new Uint8Array(signature));
  const jwt = `${unsignedToken}.${signatureBase64}`;
  
  // Encrypt payload using RFC 8291 (aes128gcm)
  // Modern browsers require encrypted payloads for Web Push
  let body;
  const headers = {
    'TTL': '86400', // 24 hours
    'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
    'Urgency': 'normal'
  };
  
  // Check if subscription has encryption keys (required for modern browsers)
  if (subscription.keys && subscription.keys.p256dh && subscription.keys.auth) {
    try {
      // Encrypt the payload
      const encrypted = await encryptWebPushPayload(
        payload,
        subscription.keys.p256dh,
        subscription.keys.auth
      );
      
      // Combine salt (16 bytes) + record size (4 bytes) + public key length (1 byte) + public key (65 bytes) + ciphertext
      const recordSize = 4096; // Standard record size
      const salt = encrypted.salt; // Random 16-byte salt from encryption
      const publicKey = encrypted.publicKey;
      
      // Build the encrypted message body per RFC 8291
      const header = new Uint8Array(16 + 4 + 1 + publicKey.length); // salt + rs + idlen + key
      header.set(salt, 0); // 16 bytes salt
      header[16] = (recordSize >> 24) & 0xFF; // 4 bytes record size (big-endian)
      header[17] = (recordSize >> 16) & 0xFF;
      header[18] = (recordSize >> 8) & 0xFF;
      header[19] = recordSize & 0xFF;
      header[20] = publicKey.length; // 1 byte key ID length
      header.set(publicKey, 21); // 65 bytes public key
      
      // Combine header and ciphertext
      body = new Uint8Array(header.length + encrypted.ciphertext.length);
      body.set(header, 0);
      body.set(encrypted.ciphertext, header.length);
      
      // Add encryption headers
      headers['Content-Type'] = 'application/octet-stream';
      headers['Content-Encoding'] = 'aes128gcm';
      
      console.log('Sending encrypted push notification');
    } catch (encryptError) {
      console.error('Encryption failed, falling back to plaintext:', encryptError);
      // Fallback to plaintext if encryption fails
      body = new TextEncoder().encode(payload);
      headers['Content-Type'] = 'application/octet-stream';
    }
  } else {
    // No encryption keys in subscription - send plaintext (for backwards compatibility)
    console.warn('No encryption keys in subscription, sending plaintext');
    body = new TextEncoder().encode(payload);
    headers['Content-Type'] = 'application/octet-stream';
  }
  
  // Send push notification to the push service
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: headers,
    body: body
  });
  
  return response;
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
 * Note: AI logging is always enabled to maintain last complete communication log
 */
async function handleGetLoggingStatus(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // AI logging is always enabled (required for debugging and monitoring)
    // The system automatically keeps the last 10 sessions (MAX_LOG_ENTRIES = 10)
    // Bulgarian: "AI логването е винаги включено за поддържане на последната пълна комуникация"
    return jsonResponse({ 
      success: true, 
      enabled: true, // Always enabled
      message: 'AI логването е винаги включено за поддържане на последната пълна комуникация' // AI logging is always enabled to maintain last complete communication
    }, 200, {
      cacheControl: 'no-cache'
    });
  } catch (error) {
    console.error('Error getting logging status:', error);
    return jsonResponse({ error: 'Failed to get logging status: ' + error.message }, 500);
  }
}

/**
 * Admin: Set AI logging status
 * Note: AI logging is always enabled and cannot be disabled
 * This endpoint is kept for backward compatibility but will not change the status
 */
async function handleSetLoggingStatus(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const data = await request.json();
    const requestedState = data.enabled === true || data.enabled === 'true';

    // AI logging is always enabled to maintain last complete communication
    // We don't actually change the state, but acknowledge the request
    console.log(`AI logging toggle requested: ${requestedState ? 'enable' : 'disable'}, but logging is always enabled`);
    
    // Bulgarian: "AI логването е винаги включено за поддържане на последната пълна комуникация. Системата автоматично пази само последната сесия."
    return jsonResponse({ 
      success: true,
      enabled: true, // Always enabled
      message: 'AI логването е винаги включено за поддържане на последната пълна комуникация. Системата автоматично пази само последната сесия.' // AI logging is always enabled to maintain last complete communication. System automatically keeps only the last session.
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
    
    // Maintain a list of all subscribed users for cron job processing
    const listKey = 'push_subscriptions_list';
    let userIdsList = [];
    
    const existingListData = await env.page_content.get(listKey);
    if (existingListData) {
      userIdsList = JSON.parse(existingListData);
    }
    
    // Add userId if not already in list
    if (!userIdsList.includes(userId)) {
      userIdsList.push(userId);
      await env.page_content.put(listKey, JSON.stringify(userIdsList));
      console.log(`Added user ${userId} to subscriptions list`);
    }
    
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
    const { userId, title, body, url, icon, notificationType } = await request.json();
    
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
      url: url || '/plan.html',
      icon: icon || '/icon-192x192.png',
      notificationType: notificationType || 'general',
      timestamp: Date.now()
    };

    console.log(`Sending push notification to user ${userId}:`, pushMessage);
    
    // Check if VAPID keys are configured
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      console.warn('VAPID keys not configured. Notification not sent.');
      return jsonResponse({ 
        success: false,
        message: 'VAPID keys not configured',
        note: 'Please configure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables'
      }, 500);
    }
    
    // Send the push notification using Web Push protocol
    try {
      const response = await sendWebPushNotification(
        subscription,
        JSON.stringify(pushMessage),
        env
      );
      
      if (response.ok || response.status === 201) {
        console.log(`Push notification sent successfully to user ${userId}`);
        return jsonResponse({ 
          success: true,
          message: 'Push notification sent successfully'
        });
      } else {
        console.error(`Push service returned status ${response.status}:`, await response.text());
        return jsonResponse({ 
          success: false,
          message: `Push service error: ${response.status}`,
          statusCode: response.status
        }, 500);
      }
    } catch (pushError) {
      console.error('Error sending push notification:', pushError);
      return jsonResponse({ 
        success: false,
        error: 'Failed to send push notification: ' + pushError.message 
      }, 500);
    }
  } catch (error) {
    console.error('Error in handlePushSend:', error);
    return jsonResponse({ error: 'Failed to process notification request: ' + error.message }, 500);
  }
}

/**
 * Admin: Save notification settings
 * 
 * Saves global notification settings for the system
 * 
 * @param {Request} request - Request with notification settings
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response
 */
async function handleSaveNotificationSettings(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const settings = await request.json();
    
    // Validate settings structure
    const validSettings = {
      enabled: settings.enabled !== false, // Default to true
      chatMessages: settings.chatMessages !== false,
      waterReminders: {
        enabled: settings.waterReminders?.enabled !== false,
        frequency: settings.waterReminders?.frequency || 2, // hours
        startHour: settings.waterReminders?.startHour || 8,
        endHour: settings.waterReminders?.endHour || 22
      },
      mealReminders: {
        enabled: settings.mealReminders?.enabled !== false,
        breakfast: settings.mealReminders?.breakfast || '08:00',
        lunch: settings.mealReminders?.lunch || '13:00',
        dinner: settings.mealReminders?.dinner || '19:00',
        snacks: settings.mealReminders?.snacks || false
      },
      customReminders: settings.customReminders || []
    };

    await env.page_content.put('notification_settings', JSON.stringify(validSettings));
    
    // Update version number to invalidate client cache
    const version = Date.now();
    await env.page_content.put('notification_settings_version', version.toString());
    
    console.log('Notification settings saved with version:', version);
    
    return jsonResponse({ 
      success: true,
      message: 'Настройките за известия са запазени',
      settings: validSettings,
      version: version
    });
  } catch (error) {
    console.error('Error saving notification settings:', error);
    return jsonResponse({ error: 'Failed to save notification settings: ' + error.message }, 500);
  }
}

/**
 * Admin: Get notification settings
 * 
 * Retrieves global notification settings
 * 
 * @param {Request} request - Request object
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response with settings
 */
async function handleGetNotificationSettings(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const settingsData = await env.page_content.get('notification_settings');
    
    // Default settings if none exist
    const defaultSettings = {
      enabled: true,
      chatMessages: true,
      waterReminders: {
        enabled: true,
        frequency: 2,
        startHour: 8,
        endHour: 22
      },
      mealReminders: {
        enabled: true,
        breakfast: '08:00',
        lunch: '13:00',
        dinner: '19:00',
        snacks: false
      },
      customReminders: []
    };

    const settings = settingsData ? JSON.parse(settingsData) : defaultSettings;
    
    // Get version from KV or use current timestamp
    const versionData = await env.page_content.get('notification_settings_version');
    const version = versionData ? parseInt(versionData) : Date.now();
    
    return jsonResponse({ 
      success: true,
      settings: settings,
      version: version
    });
  } catch (error) {
    console.error('Error getting notification settings:', error);
    return jsonResponse({ error: 'Failed to get notification settings: ' + error.message }, 500);
  }
}

/**
 * Admin: Get list of subscribed users
 * 
 * Returns list of users who have subscribed to push notifications
 * 
 * @param {Request} request - Request object
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response with subscriptions count
 */
async function handleGetSubscriptions(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // In Cloudflare KV, we can't easily list all keys with a prefix
    // So we'll return a simple response for now
    // In production, you might want to maintain a separate list of subscribed users
    
    return jsonResponse({ 
      success: true,
      message: 'За получаване на пълен списък с абонирани потребители, използвайте Cloudflare KV dashboard',
      note: 'Subscriptions are stored with prefix: push_subscription_'
    });
  } catch (error) {
    console.error('Error getting subscriptions:', error);
    return jsonResponse({ error: 'Failed to get subscriptions: ' + error.message }, 500);
  }
}

/**
 * User: Get user notification preferences
 * 
 * Retrieves notification preferences for a specific user
 * 
 * @param {Request} request - Request object with userId parameter
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response with user preferences
 */
async function handleGetUserNotificationPreferences(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    
    if (!userId) {
      return jsonResponse({ error: 'Missing userId parameter' }, 400);
    }

    const preferencesKey = `notification_preferences_${userId}`;
    const preferencesData = await env.page_content.get(preferencesKey);
    
    // Default preferences if none exist
    const defaultPreferences = {
      enabled: true,
      meals: { enabled: true, advanceMinutes: 60 },
      water: { enabled: true },
      sleep: { enabled: true, time: '22:00' },
      activity: { enabled: true, morningTime: '07:00', dayTime: '15:00' },
      supplements: { enabled: true }
    };

    const preferences = preferencesData ? JSON.parse(preferencesData) : defaultPreferences;
    
    return jsonResponse({ 
      success: true,
      preferences: preferences
    });
  } catch (error) {
    console.error('Error getting user notification preferences:', error);
    return jsonResponse({ error: 'Failed to get preferences: ' + error.message }, 500);
  }
}

/**
 * User: Save user notification preferences
 * 
 * Saves notification preferences for a specific user
 * 
 * @param {Request} request - Request with userId and preferences
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response
 */
async function handleSaveUserNotificationPreferences(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const { userId, preferences } = await request.json();
    
    if (!userId || !preferences) {
      return jsonResponse({ error: 'Missing userId or preferences' }, 400);
    }

    const preferencesKey = `notification_preferences_${userId}`;
    await env.page_content.put(preferencesKey, JSON.stringify(preferences));
    
    console.log(`Notification preferences saved for user: ${userId}`);
    
    return jsonResponse({ 
      success: true,
      message: 'Preferences saved successfully',
      preferences: preferences
    });
  } catch (error) {
    console.error('Error saving user notification preferences:', error);
    return jsonResponse({ error: 'Failed to save preferences: ' + error.message }, 500);
  }
}

/**
 * Admin: Send AI assistant message to user
 * 
 * Sends a notification to a user as if it came from the AI assistant
 * 
 * @param {Request} request - Request with userId and message
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response
 */
async function handleAdminSendMessage(request, env) {
  try {
    const { userId, message } = await request.json();
    
    if (!userId || !message) {
      return jsonResponse({ error: 'Missing userId or message' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    // Send notification to user by calling handlePushSend directly
    const pushPayload = {
      userId: userId,
      title: 'AI Асистент - NutriPlan',
      body: message,
      url: '/plan.html',
      notificationType: 'chat'
    };

    // Create a new request for handlePushSend
    const url = new URL(request.url);
    url.pathname = '/api/push/send';
    const sendRequest = new Request(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pushPayload)
    });

    const response = await handlePushSend(sendRequest, env);
    const result = await response.json();
    
    if (result.success) {
      console.log(`Admin message sent to user ${userId}: ${message}`);
      return jsonResponse({ 
        success: true,
        message: 'Съобщението беше изпратено успешно'
      });
    } else {
      return jsonResponse({ 
        success: false,
        error: result.error || result.message
      }, 500);
    }
  } catch (error) {
    console.error('Error sending admin message:', error);
    return jsonResponse({ error: 'Failed to send message: ' + error.message }, 500);
  }
}

/**
 * Admin: Get notification templates
 * 
 * Retrieves customizable notification templates
 * 
 * @param {Request} request - Request object
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response with templates
 */
async function handleGetNotificationTemplates(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const templatesData = await env.page_content.get('notification_templates');
    
    // Default templates
    const defaultTemplates = {
      meals: {
        breakfast: { title: 'Време за закуска', body: 'Започнете деня си със здравословна закуска 🍳', time: '08:00' },
        lunch: { title: 'Време за обяд', body: 'Време е за вашия здравословен обяд 🥗', time: '13:00' },
        dinner: { title: 'Време за вечеря', body: 'Не забравяйте вечерята си 🍽️', time: '19:00' },
        snack: { title: 'Време за междинна закуска', body: 'Време е за здравословна междинна закуска 🍎', time: '10:30' }
      },
      water: {
        title: 'Време за вода',
        body: 'Не забравяйте да пиете вода! 💧',
        frequency: 2
      },
      sleep: {
        title: 'Време за сън',
        body: 'Подгответе се за почивка. Добър сън е важен за здравето ви! 😴',
        time: '22:00'
      },
      activity: {
        morning: { title: 'Сутрешна активност', body: 'Започнете деня с лека физическа активност! 🏃', time: '07:00' },
        day: { title: 'Време за движение', body: 'Направете кратка разходка или упражнения! 🚶', time: '15:00' }
      },
      supplements: {
        title: 'Хранителни добавки',
        body: 'Не забравяйте да приемете вашите хранителни добавки 💊',
        times: []
      }
    };

    const templates = templatesData ? JSON.parse(templatesData) : defaultTemplates;
    
    // Get version from KV or use current timestamp
    const versionData = await env.page_content.get('notification_templates_version');
    const version = versionData ? parseInt(versionData) : Date.now();
    
    return jsonResponse({ 
      success: true,
      templates: templates,
      version: version
    });
  } catch (error) {
    console.error('Error getting notification templates:', error);
    return jsonResponse({ error: 'Failed to get templates: ' + error.message }, 500);
  }
}

/**
 * Admin: Save notification templates
 * 
 * Saves customizable notification templates
 * 
 * @param {Request} request - Request with templates
 * @param {Object} env - Environment bindings
 * @returns {Promise<Response>} JSON response
 */
async function handleSaveNotificationTemplates(request, env) {
  try {
    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    const { templates } = await request.json();
    
    if (!templates) {
      return jsonResponse({ error: 'Missing templates' }, 400);
    }

    await env.page_content.put('notification_templates', JSON.stringify(templates));
    
    // Update version number to invalidate client cache
    const version = Date.now();
    await env.page_content.put('notification_templates_version', version.toString());
    
    console.log('Notification templates saved with version:', version);
    
    return jsonResponse({ 
      success: true,
      message: 'Шаблоните за известия са запазени',
      templates: templates,
      version: version
    });
  } catch (error) {
    console.error('Error saving notification templates:', error);
    return jsonResponse({ error: 'Failed to save templates: ' + error.message }, 500);
  }
}

/**
 * Helper to create JSON response with optional cache control
 * @param {Object} data - Response data
 * @param {number} status - HTTP status code
 * @param {Object} options - Optional settings { cacheControl: string }
 */

/**
 * Scheduled event handler for cron-triggered push notifications
 * Runs every hour to check and send scheduled notifications
 */
async function handleScheduledNotifications(env) {
  console.log('[Cron] Running scheduled notifications check');
  
  try {
    if (!env.page_content) {
      console.error('[Cron] KV storage not configured');
      return;
    }
    
    // Get all user subscriptions
    const subscriptionsData = await env.page_content.get('push_subscriptions_list');
    if (!subscriptionsData) {
      console.log('[Cron] No subscriptions found');
      return;
    }
    
    const userIds = JSON.parse(subscriptionsData);
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
    
    console.log(`[Cron] Checking notifications for ${userIds.length} users at ${currentTime}`);
    
    // Process each user
    for (const userId of userIds) {
      try {
        // Get user's notification preferences
        const prefsKey = `notification_preferences_${userId}`;
        const prefsData = await env.page_content.get(prefsKey);
        
        if (!prefsData) {
          console.log(`[Cron] No preferences found for user ${userId}`);
          continue;
        }
        
        const prefs = JSON.parse(prefsData);
        
        if (!prefs.enabled) {
          console.log(`[Cron] Notifications disabled for user ${userId}`);
          continue;
        }
        
        // Get global notification settings
        const globalSettingsData = await env.page_content.get('global_notification_settings');
        const globalSettings = globalSettingsData ? JSON.parse(globalSettingsData) : {};
        
        // Check meal reminders
        if (prefs.meals?.enabled && globalSettings.mealReminders) {
          await checkAndSendMealReminders(userId, globalSettings.mealReminders, currentTime, env);
        }
        
        // Check water reminders (every 2 hours by default)
        if (prefs.water?.enabled && globalSettings.waterReminders?.enabled) {
          await checkAndSendWaterReminders(userId, globalSettings.waterReminders, currentHour, currentMinute, env);
        }
        
        // Check sleep reminder
        if (prefs.sleep?.enabled && prefs.sleep.time) {
          await checkAndSendSleepReminder(userId, prefs.sleep.time, currentTime, env);
        }
        
        // Check activity reminders
        if (prefs.activity?.enabled) {
          await checkAndSendActivityReminders(userId, prefs.activity, currentTime, env);
        }
        
        // Check supplement reminders
        if (prefs.supplements?.enabled && globalSettings.supplements?.times) {
          await checkAndSendSupplementReminders(userId, globalSettings.supplements.times, currentTime, env);
        }
        
      } catch (userError) {
        console.error(`[Cron] Error processing user ${userId}:`, userError);
        // Continue with next user
      }
    }
    
    console.log('[Cron] Scheduled notifications check completed');
  } catch (error) {
    console.error('[Cron] Error in scheduled notifications:', error);
  }
}

/**
 * Normalize time string to HH:MM format with zero padding
 */
function normalizeTime(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length !== 2) return null;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return null;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Check and send meal reminders
 */
async function checkAndSendMealReminders(userId, mealReminders, currentTime, env) {
  const templates = await getNotificationTemplates(env);
  const mealTypes = ['breakfast', 'lunch', 'dinner'];
  
  for (const mealType of mealTypes) {
    const mealTime = normalizeTime(mealReminders[mealType]);
    if (mealTime && mealTime === currentTime) {
      console.log(`[Cron] Sending ${mealType} reminder to user ${userId}`);
      await sendPushNotificationToUser(userId, {
        title: templates.meals[mealType]?.title || `Време за ${mealType}`,
        body: templates.meals[mealType]?.body || 'Време е за хранене',
        url: '/plan.html',
        notificationType: 'meal'
      }, env);
    }
  }
}

/**
 * Check and send water reminders
 */
async function checkAndSendWaterReminders(userId, waterSettings, currentHour, currentMinute, env) {
  const frequency = waterSettings.frequency || 2;
  const startHour = waterSettings.startHour || 8;
  const endHour = waterSettings.endHour || 22;
  
  // Only send on the hour (0 minutes) and within active hours
  if (currentMinute === 0 && currentHour >= startHour && currentHour <= endHour) {
    // Check if this hour matches the frequency
    if ((currentHour - startHour) % frequency === 0) {
      console.log(`[Cron] Sending water reminder to user ${userId}`);
      const templates = await getNotificationTemplates(env);
      await sendPushNotificationToUser(userId, {
        title: templates.water?.title || 'Време за вода',
        body: templates.water?.body || 'Не забравяйте да пиете вода! 💧',
        url: '/plan.html',
        notificationType: 'water'
      }, env);
    }
  }
}

/**
 * Check and send sleep reminder
 */
async function checkAndSendSleepReminder(userId, sleepTime, currentTime, env) {
  const normalizedSleepTime = normalizeTime(sleepTime);
  if (normalizedSleepTime && normalizedSleepTime === currentTime) {
    console.log(`[Cron] Sending sleep reminder to user ${userId}`);
    const templates = await getNotificationTemplates(env);
    await sendPushNotificationToUser(userId, {
      title: templates.sleep?.title || 'Време за сън',
      body: templates.sleep?.body || 'Подгответе се за почивка 😴',
      url: '/plan.html',
      notificationType: 'sleep'
    }, env);
  }
}

/**
 * Check and send activity reminders
 */
async function checkAndSendActivityReminders(userId, activityPrefs, currentTime, env) {
  const templates = await getNotificationTemplates(env);
  
  const normalizedMorningTime = normalizeTime(activityPrefs.morningTime);
  if (normalizedMorningTime && normalizedMorningTime === currentTime) {
    console.log(`[Cron] Sending morning activity reminder to user ${userId}`);
    await sendPushNotificationToUser(userId, {
      title: templates.activity?.morning?.title || 'Сутрешна активност',
      body: templates.activity?.morning?.body || 'Започнете деня с активност! 🏃',
      url: '/plan.html',
      notificationType: 'activity'
    }, env);
  }
  
  const normalizedDayTime = normalizeTime(activityPrefs.dayTime);
  if (normalizedDayTime && normalizedDayTime === currentTime) {
    console.log(`[Cron] Sending day activity reminder to user ${userId}`);
    await sendPushNotificationToUser(userId, {
      title: templates.activity?.day?.title || 'Време за движение',
      body: templates.activity?.day?.body || 'Направете кратка разходка! 🚶',
      url: '/plan.html',
      notificationType: 'activity'
    }, env);
  }
}

/**
 * Check and send supplement reminders
 */
async function checkAndSendSupplementReminders(userId, supplementTimes, currentTime, env) {
  // Normalize all supplement times and check if any match current time
  const normalizedTimes = supplementTimes.map(t => normalizeTime(t)).filter(t => t !== null);
  if (normalizedTimes.includes(currentTime)) {
    console.log(`[Cron] Sending supplement reminder to user ${userId}`);
    const templates = await getNotificationTemplates(env);
    await sendPushNotificationToUser(userId, {
      title: templates.supplements?.title || 'Хранителни добавки',
      body: templates.supplements?.body || 'Време за хранителните добавки 💊',
      url: '/plan.html',
      notificationType: 'supplements'
    }, env);
  }
}

/**
 * Get notification templates from KV
 */
async function getNotificationTemplates(env) {
  const templatesData = await env.page_content.get('notification_templates');
  if (templatesData) {
    return JSON.parse(templatesData);
  }
  
  // Return defaults if not found
  return {
    meals: {
      breakfast: { title: 'Време за закуска', body: 'Започнете деня си със здравословна закуска 🍳' },
      lunch: { title: 'Време за обяд', body: 'Време е за вашия здравословен обяд 🥗' },
      dinner: { title: 'Време за вечеря', body: 'Не забравяйте вечерята си 🍽️' },
      snack: { title: 'Време за междинна закуска', body: 'Време е за здравословна междинна закуска 🍎' }
    },
    water: { title: 'Време за вода', body: 'Не забравяйте да пиете вода! 💧' },
    sleep: { title: 'Време за сън', body: 'Подгответе се за почивка. Добър сън е важен! 😴' },
    activity: {
      morning: { title: 'Сутрешна активност', body: 'Започнете деня с активност! 🏃' },
      day: { title: 'Време за движение', body: 'Направете кратка разходка! 🚶' }
    },
    supplements: { title: 'Хранителни добавки', body: 'Не забравяйте добавките 💊' }
  };
}

/**
 * Send push notification to a specific user
 */
async function sendPushNotificationToUser(userId, message, env) {
  try {
    // Get user's push subscription
    const subscriptionKey = `push_subscription_${userId}`;
    const subscriptionData = await env.page_content.get(subscriptionKey);
    
    if (!subscriptionData) {
      console.warn(`[Cron] No push subscription found for user ${userId}`);
      return;
    }
    
    const subscription = JSON.parse(subscriptionData);
    
    // Prepare push message
    const pushMessage = {
      title: message.title || 'NutriPlan',
      body: message.body || 'Ново напомняне от NutriPlan',
      url: message.url || '/plan.html',
      icon: message.icon || '/icon-192x192.png',
      notificationType: message.notificationType || 'general',
      timestamp: Date.now()
    };
    
    // Check if VAPID keys are configured
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      console.error('[Cron] VAPID keys not configured');
      return;
    }
    
    // Send the push notification
    const response = await sendWebPushNotification(
      subscription,
      JSON.stringify(pushMessage),
      env
    );
    
    if (response.ok || response.status === 201) {
      console.log(`[Cron] Push notification sent successfully to user ${userId}`);
    } else {
      console.error(`[Cron] Push service returned status ${response.status}`);
      
      // If subscription is no longer valid (410 Gone), remove it
      if (response.status === 410) {
        console.log(`[Cron] Removing invalid subscription for user ${userId}`);
        await env.page_content.delete(subscriptionKey);
        
        // Update subscriptions list
        const listData = await env.page_content.get('push_subscriptions_list');
        if (listData) {
          const userIds = JSON.parse(listData);
          const updatedIds = userIds.filter(id => id !== userId);
          await env.page_content.put('push_subscriptions_list', JSON.stringify(updatedIds));
        }
      }
    }
  } catch (error) {
    console.error(`[Cron] Error sending push notification to user ${userId}:`, error);
  }
}

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
      } else if (url.pathname === '/api/save-client-data' && request.method === 'POST') {
        return await handleSaveClientData(request, env);
      } else if (url.pathname === '/api/admin/get-reports' && request.method === 'GET') {
        return await handleGetReports(request, env);
      } else if (url.pathname === '/api/admin/save-prompt' && request.method === 'POST') {
        return await handleSavePrompt(request, env);
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
      } else if (url.pathname === '/api/admin/notification-settings' && request.method === 'GET') {
        return await handleGetNotificationSettings(request, env);
      } else if (url.pathname === '/api/admin/notification-settings' && request.method === 'POST') {
        return await handleSaveNotificationSettings(request, env);
      } else if (url.pathname === '/api/admin/notification-templates' && request.method === 'GET') {
        return await handleGetNotificationTemplates(request, env);
      } else if (url.pathname === '/api/admin/notification-templates' && request.method === 'POST') {
        return await handleSaveNotificationTemplates(request, env);
      } else if (url.pathname === '/api/admin/send-message' && request.method === 'POST') {
        return await handleAdminSendMessage(request, env);
      } else if (url.pathname === '/api/user/notification-preferences' && request.method === 'GET') {
        return await handleGetUserNotificationPreferences(request, env);
      } else if (url.pathname === '/api/user/notification-preferences' && request.method === 'POST') {
        return await handleSaveUserNotificationPreferences(request, env);
      } else if (url.pathname === '/api/admin/subscriptions' && request.method === 'GET') {
        return await handleGetSubscriptions(request, env);
      } else if (url.pathname === '/api/admin/get-logging-status' && request.method === 'GET') {
        return await handleGetLoggingStatus(request, env);
      } else if (url.pathname === '/api/admin/set-logging-status' && request.method === 'POST') {
        return await handleSetLoggingStatus(request, env);
      } else if (url.pathname === '/api/admin/get-clients-list' && request.method === 'GET') {
        return await handleGetClientsList(request, env);
      } else if (url.pathname === '/api/admin/get-client-data' && request.method === 'GET') {
        return await handleGetClientData(request, env);
      } else {
        return jsonResponse({ error: 'Not found' }, 404);
      }
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  },
  
  /**
   * Handle scheduled cron triggers for push notifications
   */
  async scheduled(event, env, ctx) {
    console.log('[Worker] Scheduled event triggered at:', new Date().toISOString());
    ctx.waitUntil(handleScheduledNotifications(env));
  }
};
