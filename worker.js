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
 * ARCHITECTURE - Plan Generation (6 requests):
 *   1. Analysis Request (4k token limit)
 *      - Input: Full user data (profile, habits, medical, preferences)
 *      - Output: Holistic health analysis with correlations
 *   
 *   2. Strategy Request (4k token limit)
 *      - Input: User data + COMPACT analysis results
 *      - Output: Personalized dietary strategy and approach
 *   
 *   3. Meal Plan Requests (4 requests, 8k token limit each)
 *      - Progressive generation: 2 days per chunk
 *      - Input: User data + COMPACT strategy + COMPACT analysis + Previous days context
 *      - Output: Detailed meals with macros and descriptions
 *      - Chunks: Day 1-2, Day 3-4, Day 5-6, Day 7
 *   
 *   4. Summary Request (2k token limit)
 *      - Input: COMPACT strategy + Generated week plan
 *      - Output: Summary, recommendations, psychology tips
 * 
 * ARCHITECTURE - Chat (1 request per message):
 *   - Input: Full user data + Full plan + Conversation history (2k tokens max)
 *   - Output: Response (2k token limit)
 *   - Uses full context for precise consultation
 * 
 * BENEFITS:
 *   ✓ Each request focused on specific task with full relevant data
 *   ✓ No single request exceeds ~10k input tokens
 *   ✓ Better error handling (chunk failures don't fail entire generation)
 *   ✓ Progressive refinement (later days build on earlier days)
 *   ✓ Full analysis quality maintained throughout
 *   ✓ 59% reduction in token usage through compact data format
 */

// No default values - all calculations must be individualized based on user data

// AI Communication Logging Configuration
const MAX_LOG_ENTRIES = 1000; // Maximum number of log entries to keep in index

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
 * Calculate TDEE (Total Daily Energy Expenditure) based on activity level
 * Multipliers based on medical research (Mifflin-St Jeor + activity factors)
 * 
 * NOTE (2026-02-03): This function is DEPRECATED for primary calorie calculation.
 * AI model now calculates TDEE holistically. Kept for validation/fallback only.
 */
function calculateTDEE(bmr, activityLevel) {
  const activityMultipliers = {
    'Никаква (0 дни седмично)': 1.2,      // Sedentary
    'Ниска (1–2 дни седмично)': 1.375,    // Light activity
    'Средна (2–4 дни седмично)': 1.55,    // Moderate activity
    'Висока (5–7 дни седмично)': 1.725,   // Very active
    'Много висока (атлети)': 1.9,          // Extra active / Athletes
    'default': 1.4
  };
  
  const multiplier = activityMultipliers[activityLevel] || activityMultipliers['default'];
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
      } else if (url.pathname === '/api/admin/save-model' && request.method === 'POST') {
        return await handleSaveModel(request, env);
      } else if (url.pathname === '/api/admin/get-config' && request.method === 'GET') {
        return await handleGetConfig(request, env);
      } else if (url.pathname === '/api/admin/get-ai-logs' && request.method === 'GET') {
        return await handleGetAILogs(request, env);
      } else if (url.pathname === '/api/admin/get-blacklist' && request.method === 'GET') {
        return await handleGetBlacklist(request, env);
      } else if (url.pathname === '/api/admin/add-to-blacklist' && request.method === 'POST') {
        return await handleAddToBlacklist(request, env);
      } else if (url.pathname === '/api/admin/remove-from-blacklist' && request.method === 'POST') {
        return await handleRemoveFromBlacklist(request, env);
      } else if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
        return await handlePushSubscribe(request, env);
      } else if (url.pathname === '/api/push/send' && request.method === 'POST') {
        return await handlePushSend(request, env);
      } else if (url.pathname === '/api/push/vapid-public-key' && request.method === 'GET') {
        return await handleGetVapidPublicKey(request, env);
      } else {
        return jsonResponse({ error: 'Not found' }, 404);
      }
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  }
};

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
    
    // REQUIREMENT 4: Validate plan before displaying
    // NEW: Implement correction loop - instead of failing, request AI to fix issues
    let validation = validatePlan(structuredPlan, data);
    let correctionAttempts = 0;
    
    // Safety check: ensure MAX_CORRECTION_ATTEMPTS is valid
    const maxAttempts = Math.max(0, MAX_CORRECTION_ATTEMPTS);
    
    while (!validation.isValid && correctionAttempts < maxAttempts) {
      correctionAttempts++;
      console.log(`handleGeneratePlan: Plan validation failed (attempt ${correctionAttempts}/${maxAttempts}):`, validation.errors);
      
      // Generate correction prompt with specific errors
      const correctionPrompt = generateCorrectionPrompt(structuredPlan, validation.errors, data);
      
      try {
        console.log(`handleGeneratePlan: Requesting AI correction (attempt ${correctionAttempts})`);
        const correctionResponse = await callAIModel(env, correctionPrompt, CORRECTION_TOKEN_LIMIT, 'plan_correction');
        const correctedPlan = parseAIResponse(correctionResponse);
        
        if (!correctedPlan || correctedPlan.error) {
          const errorMsg = correctedPlan?.error || 'Невалиден формат на отговор';
          console.error(`handleGeneratePlan: Correction parsing failed (attempt ${correctionAttempts}):`, errorMsg);
          // Continue with next attempt or exit loop
          if (correctionAttempts >= maxAttempts) {
            break;
          }
          continue;
        }
        
        // Use corrected plan
        structuredPlan = correctedPlan;
        console.log(`handleGeneratePlan: AI correction applied (attempt ${correctionAttempts})`);
        
        // Re-validate the corrected plan
        validation = validatePlan(structuredPlan, data);
        
        if (validation.isValid) {
          console.log(`handleGeneratePlan: Plan validated successfully after ${correctionAttempts} correction(s)`);
        }
      } catch (error) {
        console.error(`handleGeneratePlan: Correction attempt ${correctionAttempts} failed:`, error);
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
    const aiResponse = await callAIModel(env, chatPrompt, 2000, 'chat_consultation');
    
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
    
    return jsonResponse({ success: true, reports: reports });
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

// Token limit for meal plan generation - must be high enough for detailed, high-quality responses
// Note: This is the OUTPUT token limit. Set high to ensure complete, precise meal plans
const MEAL_PLAN_TOKEN_LIMIT = 8000;

// Validation constants
const MIN_MEALS_PER_DAY = 1; // Minimum number of meals per day (1 for intermittent fasting strategies)
const MAX_MEALS_PER_DAY = 5; // Maximum number of meals per day (when there's clear reasoning and strategy)
const MIN_DAILY_CALORIES = 800; // Minimum acceptable daily calories
const DAILY_CALORIE_TOLERANCE = 50; // ±50 kcal tolerance for daily calorie target
const MAX_CORRECTION_ATTEMPTS = 4; // Maximum number of AI correction attempts before failing (must be >= 0)
const CORRECTION_TOKEN_LIMIT = 8000; // Token limit for AI correction requests - must be high for detailed corrections
const MAX_LATE_SNACK_CALORIES = 200; // Maximum calories allowed for late-night snacks
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
  
  // 1. Check for basic plan structure
  if (!plan || typeof plan !== 'object') {
    errors.push('План липсва или е в невалиден формат');
    return { isValid: false, errors };
  }
  
  // 2. Check for required analysis
  if (!plan.analysis || !plan.analysis.keyProblems) {
    errors.push('Липсва задълбочен анализ');
  }
  
  // 3. Check for strategy
  if (!plan.strategy || !plan.strategy.dietaryModifier) {
    errors.push('Липсва диетична стратегия');
  }
  
  // 4. Check for week plan
  if (!plan.weekPlan) {
    errors.push('Липсва седмичен план');
  } else {
    // Verify all 7 days exist
    const daysCount = Object.keys(plan.weekPlan).filter(key => key.startsWith('day')).length;
    if (daysCount < 7) {
      errors.push(`Липсват дни от седмицата (генерирани само ${daysCount} от 7)`);
    }
    
    // Verify each day has meals
    for (let i = 1; i <= 7; i++) {
      const dayKey = `day${i}`;
      const day = plan.weekPlan[dayKey];
      if (!day || !day.meals || !Array.isArray(day.meals) || day.meals.length === 0) {
        errors.push(`Ден ${i} няма хранения`);
      } else {
        // Check that each day has meals within acceptable range (1-5)
        if (day.meals.length < MIN_MEALS_PER_DAY || day.meals.length > MAX_MEALS_PER_DAY) {
          errors.push(`Ден ${i} има ${day.meals.length} хранения - трябва да е между ${MIN_MEALS_PER_DAY} и ${MAX_MEALS_PER_DAY}`);
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
          errors.push(`Ден ${i} има ${mealsWithoutMacros} хранения без макронутриенти`);
        }
        
        // Validate daily calorie totals
        const dayCalories = day.meals.reduce((sum, meal) => sum + (parseInt(meal.calories) || 0), 0);
        if (dayCalories < MIN_DAILY_CALORIES) {
          errors.push(`Ден ${i} има само ${dayCalories} калории - твърде малко`);
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
              errors.push(`Ден ${i}: Има хранения след вечеря (${mealsAfterDinnerTypes.join(', ')}) без обосновка в strategy.afterDinnerMealJustification. Моля, добави обосновка или премахни храненията след вечеря.`);
            } else if (mealsAfterDinner.length === 1 && mealsAfterDinnerTypes[0] === 'Късна закуска') {
              // Validate that late-night snack contains low GI foods
              const lateSnack = mealsAfterDinner[0];
              const snackDescription = (lateSnack.description || '').toLowerCase();
              const snackName = (lateSnack.name || '').toLowerCase();
              const snackText = snackDescription + ' ' + snackName;
              
              const hasLowGIFood = LOW_GI_FOODS.some(food => snackText.includes(food));
              
              if (!hasLowGIFood) {
                errors.push(`Ден ${i}: Късната закуска трябва да съдържа храни с нисък гликемичен индекс (${LOW_GI_FOODS.slice(0, 5).join(', ')}, и др.) или да има ясна обосновка в strategy.afterDinnerMealJustification`);
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
            errors.push(`Ден ${i}, хранене ${idx + 1}: Невалиден тип "${meal.type}" - разрешени са само: ${ALLOWED_MEAL_TYPES.join(', ')}`);
          }
        });
        
        // Check chronological order
        let lastValidIndex = -1;
        day.meals.forEach((meal, idx) => {
          const currentIndex = MEAL_ORDER_MAP[meal.type];
          if (currentIndex !== undefined) {
            if (currentIndex < lastValidIndex) {
              errors.push(`Ден ${i}: Неправилен хронологичен ред - "${meal.type}" след по-късно хранене`);
            }
            lastValidIndex = currentIndex;
          }
        });
        
        // Check for multiple afternoon snacks
        const afternoonSnackCount = mealTypes.filter(type => type === 'Следобедна закуска').length;
        if (afternoonSnackCount > 1) {
          errors.push(`Ден ${i}: Повече от 1 следобедна закуска (${afternoonSnackCount}) - разрешена е максимум 1`);
        }
        
        // Check for multiple late-night snacks
        const lateNightSnackCount = mealTypes.filter(type => type === 'Късна закуска').length;
        if (lateNightSnackCount > 1) {
          errors.push(`Ден ${i}: Повече от 1 късна закуска (${lateNightSnackCount}) - разрешена е максимум 1`);
        }
      }
    }
  }
  
  // 5. Check for required recommendations
  if (!plan.recommendations || !Array.isArray(plan.recommendations) || plan.recommendations.length < 3) {
    errors.push('Липсват препоръчителни храни');
  }
  
  // 6. Check for forbidden foods
  if (!plan.forbidden || !Array.isArray(plan.forbidden) || plan.forbidden.length < 3) {
    errors.push('Липсват забранени храни');
  }
  
  // 7. Check for goal-plan alignment
  if (userData.goal === 'Отслабване' && plan.summary && plan.summary.dailyCalories) {
    // Extract numeric calories
    const caloriesMatch = String(plan.summary.dailyCalories).match(/\d+/);
    if (caloriesMatch) {
      const calories = parseInt(caloriesMatch[0]);
      // For weight loss, calories should be reasonable (not too high)
      if (calories > 3000) {
        errors.push('Калориите са твърде високи за цел отслабване');
      }
    }
  }
  
  // 8. Check for medical conditions alignment
  if (userData.medicalConditions && Array.isArray(userData.medicalConditions)) {
    // Check for diabetes + high carb plan
    if (userData.medicalConditions.includes('Диабет')) {
      const modifier = plan.strategy?.dietaryModifier || '';
      if (modifier.toLowerCase().includes('високовъглехидратно')) {
        errors.push('Планът съдържа високовъглехидратна диета, неподходяща при диабет');
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
    
    // Check for anemia + vegetarian diet without iron supplementation
    if (userData.medicalConditions.includes('Анемия') && 
        userData.dietPreference && 
        (userData.dietPreference.includes('Вегетарианска') || userData.dietPreference.includes('Веган'))) {
      const supplements = plan.supplements || [];
      const hasIronSupplement = supplements.some(s => /желязо|iron/i.test(s));
      if (!hasIronSupplement) {
        errors.push('При анемия и вегетарианска/веган диета е задължителна добавка с желязо');
      }
    }
  }
  
  // 8a. Check for medication-supplement interactions
  if (userData.medications === 'Да' && userData.medicationsDetails && plan.supplements) {
    const medications = userData.medicationsDetails.toLowerCase();
    const supplements = plan.supplements.join(' ').toLowerCase();
    
    // Check for dangerous interactions
    if (medications.includes('варфарин') && supplements.includes('витамин к')) {
      errors.push('ОПАСНО: Витамин K взаимодейства с варфарин (антикоагулант) - може да намали ефективността');
    }
    
    if ((medications.includes('антибиотик') || medications.includes('антибиотици')) && 
        (supplements.includes('калций') || supplements.includes('магнезий'))) {
      console.log('Warning: Калций/Магнезий може да намали усвояването на антибиотици - трябва да се вземат на различно време');
    }
    
    if (medications.includes('антацид') && supplements.includes('желязо')) {
      console.log('Warning: Антацидите блокират усвояването на желязо - трябва да се вземат на различно време');
    }
  }
  
  // 9. Check for dietary preferences alignment
  if (userData.dietPreference && Array.isArray(userData.dietPreference)) {
    if (userData.dietPreference.includes('Вегетарианска') || userData.dietPreference.includes('Веган')) {
      // Check if plan contains meat (would be in forbidden)
      if (plan.recommendations && Array.isArray(plan.recommendations)) {
        const containsMeat = plan.recommendations.some(item => 
          /месо|пиле|риба|говеждо|свинско/i.test(item)
        );
        if (containsMeat && userData.dietPreference.includes('Веган')) {
          errors.push('Планът съдържа животински продукти, неподходящи за веган диета');
        }
      }
    }
  }
  
  // 10. Check for food repetition across days (avoid monotony)
  if (plan.weekPlan) {
    const mealNames = new Set();
    const repeatedMeals = new Set();
    let totalMeals = 0;
    
    Object.keys(plan.weekPlan).forEach(dayKey => {
      const day = plan.weekPlan[dayKey];
      if (day && day.meals && Array.isArray(day.meals)) {
        totalMeals += day.meals.length;
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
    
    // More intelligent threshold: if >20% of meals are repeats, warn
    const repetitionRatio = repeatedMeals.size / totalMeals;
    if (repetitionRatio > 0.2 || repeatedMeals.size > 5) {
      warnings.push(`Планът съдържа повтарящи се ястия (${repeatedMeals.size} различни ястия се повтарят, ${Math.round(repetitionRatio * 100)}% от менюто). Примери: ${Array.from(repeatedMeals).slice(0, 3).join(', ')}`);
    }
  }
  
  // 11. Check for plan justification (REQUIREMENT 3) - updated to require 100+ characters
  if (!plan.strategy || !plan.strategy.planJustification || plan.strategy.planJustification.length < 100) {
    errors.push('Липсва детайлна обосновка защо планът е индивидуален (минимум 100 символа)');
  }
  
  // 11a. Check for welcome message (NEW REQUIREMENT)
  if (!plan.strategy || !plan.strategy.welcomeMessage || plan.strategy.welcomeMessage.length < 100) {
    errors.push('Липсва персонализирано приветствие за клиента (strategy.welcomeMessage, минимум 100 символа)');
  }
  
  // 10a. Check for meal count justification (NEW REQUIREMENT)
  if (!plan.strategy || !plan.strategy.mealCountJustification || plan.strategy.mealCountJustification.length < 20) {
    errors.push('Липсва обосновка за избора на брой хранения (strategy.mealCountJustification)');
  }
  
  // 11. Check that analysis doesn't contain "Normal" severity problems (REQUIREMENT 2)
  if (plan.analysis && plan.analysis.keyProblems && Array.isArray(plan.analysis.keyProblems)) {
    const normalProblems = plan.analysis.keyProblems.filter(p => p.severity === 'Normal');
    if (normalProblems.length > 0) {
      errors.push(`Анализът съдържа ${normalProblems.length} "Normal" проблеми, които не трябва да се показват`);
    }
  }
  
  // 12. Check for ADLE v8 hard bans in meal descriptions
  if (plan.weekPlan) {
    Object.keys(plan.weekPlan).forEach(dayKey => {
      const day = plan.weekPlan[dayKey];
      if (day && day.meals && Array.isArray(day.meals)) {
        day.meals.forEach((meal, mealIndex) => {
          const mealText = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();
          
          // Check for hard bans (onion, turkey meat, artificial sweeteners, honey/sugar, ketchup/mayo)
          if (/\b(лук|onion)\b/.test(mealText)) {
            errors.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: Съдържа ЛУК (hard ban от ADLE v8)`);
          }
          // Check for turkey meat but not turkey ham
          if (/\bпуешко\b(?!\s*шунка)/.test(mealText) || /\bturkey\s+meat\b/.test(mealText)) {
            errors.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: Съдържа ПУЕШКО МЕСО (hard ban от ADLE v8)`);
          }
          // Check for Greek yogurt (blacklisted)
          if (/\bгръцко\s+кисело\s+мляко\b/.test(mealText) || /\bgreek\s+yogurt\b/.test(mealText)) {
            errors.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: Съдържа ГРЪЦКО КИСЕЛО МЛЯКО (в черния списък - използвай само обикновено кисело мляко)`);
          }
          // Check for honey/sugar/syrup in specific contexts (as ingredients, not in compound words)
          if (/\b(мед|захар|сироп)\b(?=\s|,|\.|\))/.test(mealText) && !/медицин|междин|сиропен/.test(mealText)) {
            warnings.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: Може да съдържа МЕД/ЗАХАР/СИРОП (hard ban от ADLE v8) - проверете`);
          }
          if (/\b(кетчуп|майонеза|ketchup|mayonnaise)\b/.test(mealText)) {
            errors.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: Съдържа КЕТЧУП/МАЙОНЕЗА (hard ban от ADLE v8)`);
          }
          
          // Check for peas + fish forbidden combination
          if (/\b(грах|peas)\b/.test(mealText) && /\b(риба|fish)\b/.test(mealText)) {
            errors.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: ГРАХ + РИБА забранена комбинация (ADLE v8 R0)`);
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
                errors.push(`Ден ${dayKey}, хранене ${mealIndex + 1}: Съдържа "${actualWord.toUpperCase()}" което НЕ е в whitelist (ADLE v8 R12). Изисква се Reason: ... ако е обективно необходимо.`);
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
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
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
 * @returns {string} Prompt instructing AI to correct specific errors in the plan
 */
function generateCorrectionPrompt(plan, validationErrors, userData) {
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
  dietLove: userData.dietLove
}, null, 2)}

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

async function generatePlanMultiStep(env, data) {
  console.log('Multi-step generation: Starting (3+ AI requests for precision)');
  
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
      analysisResponse = await callAIModel(env, analysisPrompt, 4000, 'step1_analysis');
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
      strategyResponse = await callAIModel(env, strategyPrompt, 4000, 'step2_strategy');
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
        mealPlan = await generateMealPlanProgressive(env, data, analysis, strategy);
      } catch (error) {
        console.error('Progressive meal plan generation failed:', error);
        throw new Error(`Стъпка 3 (Хранителен план - прогресивно): ${error.message}`);
      }
    } else {
      // Fallback to single-request generation
      console.log('Multi-step generation: Using single-request meal plan generation');
      const mealPlanPrompt = generateMealPlanPrompt(data, analysis, strategy);
      let mealPlanResponse;
      
      try {
        mealPlanResponse = await callAIModel(env, mealPlanPrompt, MEAL_PLAN_TOKEN_LIMIT, 'step3_meal_plan_full');
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
 * Helper function to replace variables in custom prompts
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
async function generateAnalysisPrompt(data, env) {
  // IMPORTANT: AI calculates BMR, TDEE, and calories based on ALL correlates
  // Backend no longer pre-calculates these values - AI does holistic analysis
  
  // Check if there's a custom prompt in KV storage
  const customPrompt = await getCustomPrompt(env, 'admin_analysis_prompt');
  
  // If custom prompt exists, use it; otherwise use default
  if (customPrompt) {
    // Replace variables in custom prompt with actual data
    // Pass the entire data object as userData
    return replacePromptVariables(customPrompt, {
      userData: data
    });
  }
  
  return `ROLE: Expert dietitian, psychologist, endocrinologist
TASK: Holistic client analysis + caloric/macro calculations

BACKEND-AI PROTOCOL:
1. Backend provides mathematical baseline (Mifflin-St Jeor formula below)
2. AI must critically review baseline considering ALL correlates
3. Only modify if confident after comprehensive data analysis
4. Response format: compressed, technical, English/machine language (internal use only)

═══ CLIENT PROFILE ═══
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
  dietLove: data.dietLove
}, null, 2)}

═══ BACKEND BASELINE (MATHEMATICAL GUIDANCE) ═══
Physical params:
- Weight: ${data.weight} kg, Height: ${data.height} cm, Age: ${data.age}, Sex: ${data.gender}
- Goal: ${data.goal}${data.lossKg ? `, Target loss: ${data.lossKg} kg` : ''}

BACKEND FORMULA (Mifflin-St Jeor baseline):
- BMR = 10×weight + 6.25×height - 5×age + (${data.gender === 'Мъж' ? '5' : '-161'})
- TDEE = BMR × ActivityFactor (1.2-1.9 based on ${data.sportActivity})
- Target kcal: adjusted per goal (deficit for weight loss, surplus for muscle gain)

AI CRITICAL REVIEW REQUIRED:
Review backend baseline considering ALL correlates:
- Sleep quality (${data.sleepHours}h) + stress (${data.stressLevel}) → hormone/metabolism impact
- Diet history (${data.dietHistory}) → metabolic adaptation check
- Medical conditions (${JSON.stringify(data.medicalConditions || [])}) → metabolic modifiers
- Psychological factors → realistic sustainable targets
- Chronotype (${data.chronotype}) → optimal timing
- Activity ratio: sport vs daily

AI DECISION:
- Confirm baseline if data supports standard calculations
- Adjust ONLY if confident after analyzing correlates
- Explain deviations from baseline in reasoning fields

REFERENCE (illustrative, do NOT copy):
F, 35y, 70kg, 165cm, moderate activity:
- Good profile (sleep OK, stress low, no diet history): BMR≈1400, TDEE≈2160, Target≈1840 kcal
- Challenged profile (sleep poor, stress high, 3 failed diets): BMR≈1180, TDEE≈1780, Target≈1600 kcal
(Note: AI may lower BMR/TDEE due cumulative metabolic adaptation)

═══ AI TASK ═══
1. HOLISTIC ANALYSIS: Review all data for ${data.name}
2. CALCULATE: BMR, TDEE, target kcal based on AI professional judgment
3. EXPLAIN: Detail reasoning in "_reasoning" fields
4. Use compressed English/machine format (internal analysis, not for frontend)

CORRELATIONAL ANALYSIS:

**SLEEP ↔ STRESS ↔ EATING**: ${data.sleepHours}h sleep (interrupted: ${data.sleepInterrupt}) + stress (${data.stressLevel}) → impact on:
   - Hormones (cortisol, ghrelin, leptin)
   - Cravings: ${JSON.stringify(data.foodCravings || [])}
   - Overeating freq: ${data.overeatingFrequency}

**PSYCHOLOGICAL PROFILE**: Emotion ↔ eating link analysis:
   - Triggers: ${JSON.stringify(data.foodTriggers || [])}
   - Compensations: ${JSON.stringify(data.compensationMethods || [])}
   - Social comparison: ${data.socialComparison}
   - Self-discipline + motivation assessment

**METABOLIC FACTORS**: Unique metabolic profile based on:
   - Chronotype (${data.chronotype}) → optimal eating timing
   - Activity (${data.sportActivity}, ${data.dailyActivityLevel})
   - History: ${data.dietHistory === 'Да' ? `${data.dietType} → ${data.dietResult}` : 'no prior diets'}
   - CRITICAL: Failed diets typically indicate reduced metabolism

**MEDICAL FACTORS**: Medical conditions impact on nutrition:
   - Conditions: ${JSON.stringify(data.medicalConditions || [])}
   - Medications: ${data.medications === 'Да' ? data.medicationsDetails : 'none'}
   - Specific macro/micronutrient needs?

**SUCCESS SCORE**: Calculate (-100 to +100) based on ALL factors:
   - BMI + health status
   - Sleep quality + stress
   - Diet history (failed diets reduce score by 15-25 pts)
   - Psychological resilience
   - Medical conditions + activity

**KEY PROBLEMS**: Identify 3-6 problem areas (ONLY Borderline/Risky/Critical severity):
   - Focus on factors actively hindering goal
   - EXCLUDE "Normal" problems

═══ OUTPUT FORMAT ═══
CRITICAL - DATA TYPES:
- Numeric fields: numbers ONLY (int/float), NO text/units/explanations
- Explanations: in separate "_reasoning" fields
- BMR, TDEE, recommendedCalories: AI calculates based on ALL correlates
- Use compressed English/machine format (internal, not for frontend display)

{
  "bmr": number (AI holistic calculation),
  "bmrReasoning": "compact explanation: how/why baseline adjusted",
  "tdee": number (AI holistic calculation),
  "tdeeReasoning": "compact: activity, stress, sleep impact on TDEE",
  "recommendedCalories": number (AI determines from goal + correlates),
  "caloriesReasoning": "compact: why these exact kcal - goal, stress, diet history, metabolism factors",
  "macroRatios": {
    "protein": number (%, e.g. 30),
    "carbs": number (%, e.g. 35),
    "fats": number (%, e.g. 35)
  },
  "macroRatiosReasoning": {
    "protein": "compact: why optimal % for ${data.name}",
    "carbs": "compact: based on activity, medical conditions",
    "fats": "compact: based on needs"
  },
  "macroGrams": {
    "protein": number (grams/day),
    "carbs": number (grams/day),
    "fats": number (grams/day)
  },
  "weeklyBlueprint": {
    "skipBreakfast": boolean (true if client doesn't eat breakfast),
    "dailyMealCount": number (meals/day, typically 2-4),
    "mealCountReasoning": "compact: why this meal count optimal",
    "dailyStructure": [
      {
        "dayIndex": 1,
        "meals": [
          {
            "type": "breakfast/lunch/dinner/snack",
            "active": boolean,
            "calorieTarget": number (kcal for this meal),
            "proteinSource": "suggested main protein (e.g. chicken, fish, eggs)",
            "carbSource": "suggested carb (e.g. quinoa, rice, vegetables)"
          }
        ]
      }
      // ... repeat for all 7 days
    ]
  },
  "metabolicProfile": "UNIQUE metabolic profile - compressed: how chronotype, activity, history impact metabolism",
  "healthRisks": ["risk 1 specific", "risk 2", "risk 3"],
  "nutritionalNeeds": ["need 1 from analysis", "need 2", "need 3"],
  "psychologicalProfile": "DETAILED analysis: emotional eating, triggers, coping, motivation (compressed format)",
  "successChance": number (-100 to 100),
  "successChanceReasoning": "compact: why score - helping/hindering factors",
  "keyProblems": [
    {
      "title": "short name (2-4 words)",
      "description": "why problem + consequence",
      "severity": "Borderline / Risky / Critical",
      "severityValue": number 0-100,
      "category": "Sleep / Nutrition / Hydration / Stress / Activity / Medical",
      "impact": "health/goal impact"
    }
  ]
}

RULES for weeklyBlueprint:
1. Sum of calorieTarget for all active meals = recommendedCalories/day
2. If skipBreakfast=true → "breakfast" meals active=false, calorieTarget=0
3. Vary proteinSource + carbSource between days for variety
4. Meal types chronological order: breakfast → lunch → snack → dinner
5. Use dailyMealCount consistently across week (unless specific reason for variation)

Be SPECIFIC for ${data.name}. Avoid generic phrases like "good metabolism" - explain WHY + HOW using compressed technical format!

async function generateStrategyPrompt(data, analysis, env) {
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
    weeklyBlueprint: analysis.weeklyBlueprint || null,
    metabolicProfile: (analysis.metabolicProfile || '').length > 200 ? 
      (analysis.metabolicProfile || '').substring(0, 200) + '...' : 
      (analysis.metabolicProfile || 'не е анализиран'), // Only add '...' if truncated
    healthRisks: (analysis.healthRisks || []).slice(0, 3).join('; '), // Up to 3 risks
    nutritionalNeeds: (analysis.nutritionalNeeds || []).slice(0, 3).join('; '), // Up to 3 needs
    psychologicalProfile: (analysis.psychologicalProfile || '').length > 150 ?
      (analysis.psychologicalProfile || '').substring(0, 150) + '...' : 
      (analysis.psychologicalProfile || 'не е анализиран'), // Only add '...' if truncated
    successChance: analysis.successChance || 'не изчислен',
    keyProblems: (analysis.keyProblems || [])
      .filter(p => p && p.title && p.severity) // Filter out invalid entries
      .slice(0, 3)
      .map(p => `${p.title} (${p.severity})`)
      .join('; ') // Up to 3 problems
  };
  
  // If custom prompt exists, use it; otherwise use default
  if (customPrompt) {
    // Replace variables in custom prompt
    return replacePromptVariables(customPrompt, {
      userData: data,
      analysisData: analysisCompact,
      name: data.name,
      age: data.age,
      goal: data.goal
    });
  }
  
  return `TASK: Determine optimal dietary strategy based on health profile + analysis

BACKEND-AI PROTOCOL:
1. Backend provides analysis baseline (BMR/TDEE/macros calculated in Step 1)
2. AI must critically review strategy considering ALL factors holistically
3. Only deviate from analysis if confident after comprehensive review
4. Response format: compressed English/machine (internal), BUT Bulgarian for frontend fields (welcomeMessage, planJustification, etc.)

CLIENT: ${data.name}, ${data.age}y, Goal: ${data.goal}

ANALYSIS BASELINE (from Step 1):
- BMR/TDEE/kcal: ${analysisCompact.bmr} / ${analysisCompact.tdee} / ${analysisCompact.recommendedCalories}
- Macro ratios: ${analysisCompact.macroRatios}
- Macro grams/day: ${analysisCompact.macroGrams}
${analysisCompact.weeklyBlueprint ? `- Weekly structure: ${analysisCompact.weeklyBlueprint.dailyMealCount} meals/day${analysisCompact.weeklyBlueprint.skipBreakfast ? ', NO breakfast' : ''}` : ''}
- Metabolic profile: ${analysisCompact.metabolicProfile}
- Health risks: ${analysisCompact.healthRisks}
- Nutritional needs: ${analysisCompact.nutritionalNeeds}
- Psychological profile: ${analysisCompact.psychologicalProfile}
- Success chance: ${analysisCompact.successChance}
- Key problems: ${analysisCompact.keyProblems}

PREFERENCES:
- Diet preferences: ${JSON.stringify(data.dietPreference || [])}
${data.dietPreference_other ? `  (Other: ${data.dietPreference_other})` : ''}
- Dislikes/intolerances: ${data.dietDislike || 'None'}
- Favorite foods: ${data.dietLove || 'None'}

HOLISTIC INTEGRATION - Consider ALL params + correlations:
1. Medical conditions + medications → nutritional needs impact
2. Food intolerances + allergies → strict constraints
3. Personal preferences + favorites → long-term sustainability
4. Chronotype + daily rhythm → optimal meal timing
5. Stress level + emotional eating → psychological support
6. Cultural context (Bulgarian traditions + available products)
7. Sleep ↔ stress ↔ food cravings correlations
8. Physical activity ↔ caloric needs link
9. Medical conditions ↔ nutritional requirements interplay

CRITICAL - INDIVIDUALIZED RECOMMENDATIONS:
1. Supplements must be STRICTLY INDIVIDUALIZED for ${data.name}
2. FORBIDDEN: generic/universal supplement recommendations
3. Each supplement justified by SPECIFIC needs from analysis
4. Dosages personalized by age, weight, sex, health status
5. Consider medical conditions, medications, possible interactions
6. CRITICAL - INTERACTION CHECKS:
   - If on medications: ${data.medications === 'Да' ? data.medicationsDetails : 'none'}, check:
     * Vit K + anticoagulants (warfarin) = contraindicated
     * Ca/Mg + antibiotics = reduced absorption
     * Iron + antacids = blocked absorption
     * Vit D + corticosteroids = higher dose needed
   - If medical conditions: ${JSON.stringify(data.medicalConditions || [])}, consider:
     * Diabetes: Chromium, Vit D, Omega-3 (blood sugar control)
     * Hypertension: Mg, K, CoQ10 (BP reduction)
     * Thyroid: Selenium, Iodine (only if deficient!), Zinc
     * Anemia: Iron (heme for better absorption), Vit C (aids absorption), B12
     * PCOS: Inositol, Vit D, Omega-3, Chromium
     * IBS/IBD: Probiotics (specific strains), Vit D, Omega-3
7. INDIVIDUAL DOSING based on:
   - Weight: ${data.weight} kg (higher weight = higher dose for fat-soluble vitamins)
   - Age: ${data.age}y (older = higher Vit D, B12, Ca needs)
   - Sex: ${data.gender} (women = more iron during menstruation; men = more zinc)
   - Sleep: ${data.sleepHours}h (under 7h = Mg for sleep, Melatonin)
   - Stress: ${data.stressLevel} (high stress = Mg, B-complex vitamins, Ashwagandha)
   - Activity: ${data.sportActivity} (high = Protein, BCAA, Creatine, Vit D)

CRITICAL - MODIFIER DETERMINATION:
After analyzing all params, determine appropriate MODIFIER (dietary profile) controlling meal generation logic:
- Terms: "Keto", "Paleo", "Vegan", "Vegetarian", "Mediterranean", "Low-carb", "Balanced", "Gentle stomach", "Gluten-free", etc.
- MODIFIER must account for medical conditions, goals, preferences, all analyzed factors
- Determine ONE primary dietary strategy most suitable for client
- If no specific restrictions, use "Balanced" or "Mediterranean"

LONG-TERM STRATEGY DEVELOPMENT:
1. Create CLEAR long-term strategy for achieving ${data.name}'s goals
2. Strategy must cover not just daily, but WEEKLY/MULTI-DAY horizon
3. If physiologically/psychologically/strategically justified:
   - Planning can span 2-3 days as whole
   - Macro/calorie horizon NOT necessarily 24h
   - Cyclical calorie/macro distribution possible (e.g. low-high days)
4. Justify WHY specific meal count (1-5) chosen for each day
5. Justify WHY + WHEN after-dinner meals needed (if any)
6. Each non-standard strategy recommendation MUST have clear goal + justification

OUTPUT JSON format (NO generic recommendations):
NOTE: Fields for frontend display (welcomeMessage, planJustification, longTermStrategy, etc.) MUST be in BULGARIAN.
Internal/technical fields can use compressed English format.

{
  "dietaryModifier": "dietary profile term (e.g. Balanced, Keto, Vegan, Mediterranean, Low-carb, Gentle stomach)",
  "modifierReasoning": "compact explanation why this MODIFIER chosen SPECIFICALLY for ${data.name}",
  "welcomeMessage": "MANDATORY FIELD (IN BULGARIAN): PERSONALIZED greeting for ${data.name} when first viewing plan. Tone: professional yet warm, motivating. Include: 1) Personal greeting with name, 2) Brief mention of specific profile factors (age, goal, key challenges), 3) How plan created specifically for their needs, 4) Positive vision for achieving goals. Length: 150-250 words. IMPORTANT: Avoid generic phrases - use specific details for ${data.name}.",
  "planJustification": "MANDATORY FIELD (IN BULGARIAN): Detailed justification of overall strategy, including meal count, timing, cyclical distribution (if any), after-dinner meals (if any), WHY this strategy optimal for ${data.name}. Minimum 100 chars.",
  "longTermStrategy": "LONG-TERM STRATEGY (IN BULGARIAN): Describe how plan works within 2-3 days/week, not just daily. Include info on cyclical calorie/macro distribution, meal variation, how this supports goals.",
  "mealCountJustification": "MEAL COUNT JUSTIFICATION (IN BULGARIAN): Why this exact meal count (1-5) chosen for each day. Strategic, physiological, or psychological reason.",
  "afterDinnerMealJustification": "AFTER-DINNER MEAL JUSTIFICATION (IN BULGARIAN): If after-dinner meals exist, explain WHY needed, goal, how they support overall strategy. If none - write 'Not needed'.",
  "dietType": "diet type personalized for ${data.name} (e.g. mediterranean, balanced, low-carb)",
  "weeklyMealPattern": "HOLISTIC weekly eating scheme (e.g. '16:8 IF daily', '5:2 approach', 'cyclical fasting', 'free weekend', or traditional scheme with varying meals)",
  "mealTiming": {
    "pattern": "weekly eating model described in detail - e.g. 'Mon-Fri: 2 meals (12:00, 19:00), Sat-Sun: 3 meals with one free'",
    "fastingWindows": "fasting periods if applied (e.g. '16h between last meal and next', or 'not applied')",
    "flexibility": "description of scheme flexibility by day and needs"
  },
  "keyPrinciples": ["principle 1 specific for ${data.name}", "principle 2 specific for ${data.name}", "principle 3 specific for ${data.name}"],
  "foodsToInclude": ["food 1 suitable for ${data.name}", "food 2 suitable for ${data.name}", "food 3 suitable for ${data.name}"],
  "foodsToAvoid": ["food 1 unsuitable for ${data.name}", "food 2 unsuitable for ${data.name}", "food 3 unsuitable for ${data.name}"],
  "supplementRecommendations": [
    "! INDIVIDUAL supplement 1 for ${data.name} - specific supplement with dosage + justification why NEEDED for this client (BASED on: age ${data.age}y, sex ${data.gender}, goal ${data.goal}, medical conditions ${data.medicalConditions || 'none'})",
    "! INDIVIDUAL supplement 2 for ${data.name} - specific supplement with dosage + justification why NEEDED for this client (BASED on: activity ${data.sportActivity}, sleep ${data.sleepHours}h, stress ${data.stressLevel})",
    "! INDIVIDUAL supplement 3 for ${data.name} - specific supplement with dosage + justification why NEEDED for this client (BASED on: eating habits ${data.eatingHabits}, preferences ${data.dietPreference})"
  ],
  "hydrationStrategy": "fluid intake recommendations personalized for ${data.name} by activity + climate",
  "psychologicalSupport": [
    "! psychological advice 1 based on ${data.name}'s emotional eating",
    "! psychological advice 2 based on ${data.name}'s stress + behavior",
    "! psychological advice 3 for motivation specific to ${data.name}'s profile"
  ]
}

IMPORTANT for WEEKLY SCHEME:
- Create HOLISTIC weekly model considering goal, chronotype, habits
- Intermittent fasting (16:8, 18:6, OMAD) fully valid choice if suitable
- Can vary meal count between days (e.g. 2 meals workdays, 3 rest days)
- "Free days" or "free meals" allowed as part of sustainable strategy
- Week must work as SYSTEM, not as 7 independent days

IMPORTANT for SUPPLEMENTS:
- Each supplement must have CLEAR justification based on:
  * Analysis deficiencies (e.g. low Vit D due to limited sun exposure)
  * Medical conditions (e.g. Mg for stress, Omega-3 for inflammation)
  * Goals (e.g. protein for muscle mass, iron for energy)
  * Age + sex (e.g. Ca for women 40+, Zn for men)
- Dosage must be PERSONALIZED by weight, age, needs
- Intake timing must be optimal for absorption
- STRICTLY FORBIDDEN: Using same supplements for different clients
- STRICTLY FORBIDDEN: Generic "multivitamins" without specific justification
- Each supplement MUST be different + specific for client ${data.name}
- Consider unique combination: ${data.age}y ${data.gender}, ${data.goal}, ${data.medicalConditions || 'no med conditions'}, ${data.sportActivity}, stress: ${data.stressLevel}`;
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
async function generateMealPlanProgressive(env, data, analysis, strategy) {
  console.log('Progressive generation: Starting meal plan generation in chunks');
  
  const totalDays = 7;
  const chunks = Math.ceil(totalDays / DAYS_PER_CHUNK);
  const weekPlan = {};
  const previousDays = []; // Track previous days for variety
  
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
        startDay, endDay, previousDays, env
      );
      
      const chunkInputTokens = estimateTokenCount(chunkPrompt);
      console.log(`Chunk ${chunkIndex + 1} input tokens: ~${chunkInputTokens}`);
      
      const chunkResponse = await callAIModel(env, chunkPrompt, MEAL_PLAN_TOKEN_LIMIT, `step3_meal_plan_chunk_${chunkIndex + 1}`);
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
    const summaryResponse = await callAIModel(env, summaryPrompt, 2000, 'step4_summary');
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
 * Generate prompt for a chunk of days (progressive generation)
 */
async function generateMealPlanChunkPrompt(data, analysis, strategy, bmr, recommendedCalories, startDay, endDay, previousDays, env) {
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
    previousDaysContext = `\n\nВЕЧЕ ГЕНЕРИРАНИ ДНИ (за разнообразие):\n${prevMeals}\nИЗБЯГВАЙ повтаряне на тези ястия в следващите дни!`;
  }
  
  // Extract only essential strategy fields (COMPACT - no full JSON)
  const strategyCompact = {
    dietType: strategy.dietType || 'Балансирана',
    weeklyMealPattern: strategy.weeklyMealPattern || 'Традиционна',
    mealTiming: strategy.mealTiming?.pattern || '3 хранения дневно',
    keyPrinciples: (strategy.keyPrinciples || []).slice(0, 3).join('; '), // Only top 3
    foodsToInclude: (strategy.foodsToInclude || []).slice(0, 5).join(', '), // Only top 5
    foodsToAvoid: (strategy.foodsToAvoid || []).slice(0, 5).join(', ') // Only top 5
  };
  
  // Extract weekly blueprint if available
  let blueprintSection = '';
  if (analysis.weeklyBlueprint) {
    const blueprint = analysis.weeklyBlueprint;
    blueprintSection = `
=== СЕДМИЧНА СТРУКТУРА (BLUEPRINT) ===
КРИТИЧНО: Този план определя ТОЧНАТА структура и калории за всеки ден. СПАЗВАЙ ГО СТРИКТНО!

Общи правила:
- Пропусни закуска: ${blueprint.skipBreakfast ? 'ДА - БЕЗ закуски през седмицата' : 'НЕ - включи закуски'}
- Брой хранения на ден: ${blueprint.dailyMealCount || '2-3'}
- Причина: ${blueprint.mealCountReasoning || 'Според профила на клиента'}

Дневна структура (ДНИ ${startDay}-${endDay}):`;

    // Add structure for each day in the chunk
    if (blueprint.dailyStructure && Array.isArray(blueprint.dailyStructure)) {
      for (let day = startDay; day <= endDay; day++) {
        const dayStructure = blueprint.dailyStructure.find(d => d.dayIndex === day);
        if (dayStructure && dayStructure.meals) {
          blueprintSection += `\n\nДЕН ${day}:`;
          dayStructure.meals.forEach(meal => {
            if (meal.active) {
              blueprintSection += `\n  - ${meal.type}: ${meal.calorieTarget} kcal (Предложен протеин: ${meal.proteinSource || 'избери подходящ'}, Въглехидрати: ${meal.carbSource || 'избери подходящ'})`;
            } else {
              blueprintSection += `\n  - ${meal.type}: ПРОПУСНИ (не е активно)`;
            }
          });
        }
      }
    }
    
    blueprintSection += `

ВАЖНО: 
- Спазвай ТОЧНИТЕ калорийни цели за всяко хранене
- Използвай предложените протеинови източници и въглехидрати като насоки
- Сборът на калориите за деня ТРЯБВА да отговаря на сумата от активните хранения
- НЕ добавяй хранения които са маркирани като неактивни (active: false)
`;
  }
  
  const defaultPrompt = `Ти действаш като Advanced Dietary Logic Engine (ADLE) – логически конструктор на хранителни режими.

=== ЗАДАЧА ===
Генерирай ДНИ ${startDay}-${endDay} от 7-дневен хранителен план за ${data.name}.

=== КЛИЕНТ ===
Име: ${data.name}, Цел: ${data.goal}, Калории: ${recommendedCalories} kcal/ден
BMR: ${bmr}, Модификатор: "${dietaryModifier}"${modificationsSection}
Стрес: ${data.stressLevel}, Сън: ${data.sleepHours}ч, Хронотип: ${data.chronotype}
${blueprintSection}
=== СТРАТЕГИЯ (КОМПАКТНА) ===
Диета: ${strategyCompact.dietType}
Схема: ${strategyCompact.weeklyMealPattern}
Хранения: ${strategyCompact.mealTiming}
Принципи: ${strategyCompact.keyPrinciples}
Избягвай: ${data.dietDislike || 'няма'}, ${strategyCompact.foodsToAvoid}
Включвай: ${data.dietLove || 'няма'}, ${strategyCompact.foodsToInclude}${previousDaysContext}

=== КОРЕЛАЦИОННА АДАПТАЦИЯ ===
СТРЕС И ХРАНЕНЕ:
- Стрес: ${data.stressLevel}
- При висок стрес, включи храни богати на:
  * Магнезий (тъмно зелени листни зеленчуци, ядки, семена, пълнозърнести храни)
  * Витамин C (цитруси, чушки, зеле)
  * Омега-3 (мазна риба, ленено семе, орехи)
  * Комплекс B витамини (яйца, месо, бобови)
- Избягвай стимуланти (кафе, енергийни напитки) при висок стрес

ХРОНОТИП И КАЛОРИЙНО РАЗПРЕДЕЛЕНИЕ:
- Хронотип: ${data.chronotype}
- "Ранобуден" / "Сова на сутринта" → По-обилна закуска (30-35% калории), умерена вечеря (25%)
- "Вечерен тип" / "Нощна сова" → Лека закуска (20%), по-обилна вечеря (35% калории)
- "Смесен тип" → Балансирано разпределение (25-30-25-20%)

СЪН И ХРАНЕНЕ:
- Сън: ${data.sleepHours}ч
- При малко сън (< 6ч): Включи храни с триптофан (яйца, кисело мляко, банани, сирене) за подобряване на съня
- Избягвай тежки храни вечер ако съня е прекъсван

=== АРХИТЕКТУРА ===
Категории: [PRO]=Белтък, [ENG]=Енергия/въглехидрати, [VOL]=Зеленчуци/фибри, [FAT]=Мазнини, [CMPX]=Сложни ястия
Шаблони: A) РАЗДЕЛЕНА ЧИНИЯ=[PRO]+[ENG]+[VOL], B) СМЕСЕНО=[PRO]+[ENG]+[VOL] микс, C) ЛЕКО/САНДВИЧ, D) ЕДИНЕН БЛОК=[CMPX]+[VOL]
Филтриране според "${dietaryModifier}": Веган=без животински [PRO]; Кето=минимум [ENG]; Без глутен=[ENG] само ориз/картофи/киноа/елда; Палео=без зърнени/бобови/млечни${data.eatingHabits && data.eatingHabits.includes('Не закусвам') ? `\nЗАКУСКА: Клиентът НЕ ЗАКУСВА - без закуска или само напитка ако критично` : ''}

=== ADLE v8 STRICT RULES (ЗАДЪЛЖИТЕЛНО СПАЗВАНЕ) ===
ПРИОРИТЕТ (винаги): 1) Hard bans → 2) Mode filter (MODE има приоритет над базови правила) → 3) Template constraints → 4) Hard rules (R1-R12) → 5) Repair → 6) Output

0) HARD BANS (0% ВИНАГИ):
- лук (всякаква форма), пуешко месо, изкуствени подсладители
- мед, захар, конфитюр, сиропи
- кетчуп, майонеза, BBQ/сладки сосове
- гръцко кисело мляко (използвай САМО обикновено кисело мляко)
- грах + риба (забранена комбинация)

0.1) РЯДКО (≤2 пъти/седмично): пуешка шунка, бекон

HARD RULES (R1-R12):
R1: Белтък главен = точно 1. Вторичен белтък САМО ако (закуска AND яйца), 0-1.
R2: Зеленчуци = 1-2. Избери ТОЧНО ЕДНА форма: Салата ИЛИ Пресни (НЕ и двете едновременно). Картофите НЕ СА зеленчуци.
R3: Енергия = 0-1 (никога 2).
R4: Млечни макс = 1 на хранене (кисело мляко ИЛИ извара ИЛИ сирене), включително като сос/дресинг.
R5: Мазнини = 0-1. Ако ядки/семена → без зехтин/масло.
R6: Правило за сирене: Ако сирене → без зехтин/масло. Маслини разрешени със сирене.
R7: Правило за бекон: Ако бекон → Мазнини=0.
R8: Бобови-като-основно (боб/леща/нахут/гювеч от грах): Енергия=0 (без ориз/картофи/паста/булгур/овесени). Хляб може да е опционален: +1 филия пълнозърнест.
R9: Правило за хляб (извън Template C): Разрешен САМО ако Енергия=0. Изключение: с бобови-като-основно (R8), хляб може да е опционален (1 филия). Ако има Енергия → Хляб=0.
R10: Грах като добавка към месо: Грахът НЕ Е енергия, но БЛОКИРА слота Енергия → Енергия=0. Хляб може да е опционален (+1 филия).
R11: Template C (сандвич): Само за закуски; бобови забранени; без забранени сосове/подсладители.
R12: Извън-whitelist добавяне: По подразбиране=само whitelist. Извън-whitelist САМО ако обективно нужно (MODE/медицинско/наличност), mainstream/универсално, налично в България. Добави ред: Reason: ...

=== WHITELISTS (РАЗРЕШЕНИ ХРАНИ) - ЗАДЪЛЖИТЕЛНО СПАЗВАНЕ ===
КРИТИЧНО: Използвай САМО храни от тези списъци! Извън-whitelist САМО с Reason: ...

WHITELIST PROTEIN (избери точно 1 главен белтък):
- яйца (eggs)
- пилешко (chicken)
- говеждо (beef)
- постна свинска (lean pork)
- риба (white fish, скумрия/mackerel, риба тон/canned tuna)
- кисело мляко (yogurt - plain, несладко)
- извара (cottage cheese - plain)
- сирене (cheese - умерено)
- боб (beans)
- леща (lentils)
- нахут (chickpeas)
- грах (peas - виж 3.5)

ЗАБРАНЕНИ БЕЛТЪЦИ (НЕ използвай без Reason):
- пуешко месо (turkey meat) - HARD BAN
- заешко (rabbit) - ИЗВЪН whitelist
- патица (duck) - ИЗВЪН whitelist
- гъска (goose) - ИЗВЪН whitelist
- агне (lamb) - ИЗВЪН whitelist
- дивеч (game meat) - ИЗВЪН whitelist
- всички екзотични меса - ИЗВЪН whitelist

WHITELIST VEGETABLES (избери 1-2):
- домати, краставици, чушки, зеле, моркови
- салата/листни зеленчуци (lettuce/greens), спанак
- тиквички, гъби, броколи, карфиол
- пресни нарязани: домати/краставици/чушки (БЕЗ дресинг)

WHITELIST ENERGY (избери 0-1):
- овесени ядки (oats)
- ориз (rice)
- картофи (potatoes)
- паста (pasta)
- булгур (bulgur)
ЗАБЕЛЕЖКА: Царевица НЕ е енергия!

WHITELIST FAT (избери 0-1):
- зехтин (olive oil)
- масло (butter - умерено)
- ядки/семена (nuts/seeds - умерено)

СПЕЦИАЛНИ ПРАВИЛА:
- Грах + риба = СТРОГО ЗАБРАНЕНО
- Зеленчуци: ЕДНА форма на хранене (Салата ИЛИ Пресни нарязани, не и двете)
- Маслини = добавка към салата (НЕ Мазнини слот). Ако маслини → БЕЗ зехтин/масло
- Царевица = НЕ е енергия. Малко царевица само в салати като добавка
- Template C (сандвич) = САМО за закуски, НЕ за основни хранения

=== КРИТИЧНИ ИЗИСКВАНИЯ ===
1. ЗАДЪЛЖИТЕЛНИ МАКРОСИ: Всяко ястие ТРЯБВА да има точни macros (protein, carbs, fats, fiber в грамове)
2. ПРЕЦИЗНИ КАЛОРИИ: Изчислени като protein×4 + carbs×4 + fats×9 за ВСЯКО ястие
3. ЦЕЛЕВА ДНЕВНА СУМА: Около ${recommendedCalories} kcal на ден (±${DAILY_CALORIE_TOLERANCE} kcal е приемливо)
   - Целта е ОРИЕНТИР, НЕ строго изискване
   - По-важно е да спазиш правилния брой и ред на хранения, отколкото да достигнеш точно калориите
4. БРОЙ ХРАНЕНИЯ: 1-6 хранения на ден според диетичната стратегия и целта
   - 1 хранене (OMAD): само при ясна стратегия за интермитентно гладуване
   - 2 хранения: при стратегия за интермитентно гладуване (16:8, 18:6)
   - 3 хранения: Закуска, Обяд, Вечеря (стандартен вариант)
   - 4 хранения: Закуска, Обяд, Следобедна закуска, Вечеря (при нужда от по-честа хранене)
   - 5 хранения: Закуска, Обяд, Следобедна закуска, Вечеря, Късна закуска (при специфични случаи)
   - 6 хранения: рядко, само при специфична медицинска/спортна стратегия
   - КРИТИЧНО: Броят хранения се определя от СТРАТЕГИЯТА, НЕ от нуждата да се достигнат калории!
   - НИКОГА не добавяй хранения САМО за достигане на калории!
5. РАЗНООБРАЗИЕ: Всеки ден различен от предишните
6. Реалистични български/средиземноморски ястия

=== МЕДИЦИНСКИ И ДИЕТЕТИЧНИ ПРИНЦИПИ ЗА РЕД НА ХРАНЕНИЯ ===
КРИТИЧНО ВАЖНО: Следвай СТРОГО медицинските и диететични принципи за ред на храненията:

1. ПОЗВОЛЕНИ ТИПОВЕ ХРАНЕНИЯ (в хронологичен ред):
   - "Закуска" (сутрин) - САМО като първо хранене на деня
   - "Обяд" (обед) - САМО след закуската или като първо хранене (ако няма закуска)
   - "Следобедна закуска" (опционално, между обяд и вечеря)
   - "Вечеря" (вечер) - обикновено последно хранене
   - "Късна закуска" (опционално, САМО след вечеря, специални случаи)

2. ХРОНОЛОГИЧЕН РЕД: Храненията ТРЯБВА да следват естествения дневен ритъм
   - НЕ може да има закуска след обяд
   - НЕ може да има обяд след вечеря
   - НЕ може да има вечеря преди обяд

3. КЪСНА ЗАКУСКА - строги изисквания:
   КОГАТО Е ДОПУСТИМА:
   - Дълъг период между вечеря и сън (> 4 часа)
   - Проблеми със съня заради глад
   - Диабет тип 2 (стабилизиране на кръвната захар)
   - Интензивни тренировки вечер
   - Работа на смени (нощни смени)
   
   ЗАДЪЛЖИТЕЛНИ УСЛОВИЯ:
   - САМО след "Вечеря" (никога преди)
   - МАКСИМУМ 1 на ден
   - САМО храни с НИСЪК ГЛИКЕМИЧЕН ИНДЕКС (ГИ < 55):
     * Кисело мляко (150ml), кефир
     * Ядки: 30-40g бадеми/орехи/лешници/кашу
     * Ягоди/боровинки/малини (50-100g)
     * Авокадо (половин)
     * Семена: чиа/ленено/тиквени (1-2 с.л.)
   - МАКСИМУМ ${MAX_LATE_SNACK_CALORIES} калории
   - НЕ използвай ако не е оправдано от профила на клиента!

4. КАЛОРИЙНО РАЗПРЕДЕЛЕНИЕ: 
   - Разпредели калориите в избраните хранения според стратегията (1-6 хранения)
   - Ако порциите стават твърде големи, това е приемливо - по-добре от добавяне на хранения след вечеря
   - Допустимо е да имаш 1800 kcal вместо 2000 kcal - това НЕ е проблем
   - АБСОЛЮТНО ЗАБРАНЕНО е да добавяш хранения след вечеря без оправдание!

${MEAL_NAME_FORMAT_INSTRUCTIONS}

JSON ФОРМАТ (върни САМО дните ${startDay}-${endDay}):
{
  "day${startDay}": {
    "meals": [
      {"type": "Закуска", "name": "име ястие", "weight": "Xg", "description": "описание", "benefits": "ползи", "calories": X, "macros": {"protein": X, "carbs": X, "fats": X, "fiber": X}},
      {"type": "Обяд", "name": "име ястие", "weight": "Xg", "description": "описание", "benefits": "ползи", "calories": X, "macros": {"protein": X, "carbs": X, "fats": X, "fiber": X}},
      {"type": "Вечеря", "name": "име ястие", "weight": "Xg", "description": "описание", "benefits": "ползи", "calories": X, "macros": {"protein": X, "carbs": X, "fats": X, "fiber": X}}
    ],
    "dailyTotals": {"calories": X, "protein": X, "carbs": X, "fats": X}
  }${daysInChunk > 1 ? `,\n  "day${startDay + 1}": {...}` : ''}
}

Генерирай дни ${startDay}-${endDay} с балансирани ястия в правилен хронологичен ред. ЗАДЪЛЖИТЕЛНО включи dailyTotals за проверка!`;
  
  // If custom prompt exists, use it; otherwise use default
  if (customPrompt) {
    // Replace variables in custom prompt
    return replacePromptVariables(customPrompt, {
      userData: data,
      analysisData: analysis,
      strategyData: strategy,
      bmr: bmr,
      recommendedCalories: recommendedCalories,
      startDay: startDay,
      endDay: endDay,
      previousDays: previousDays
    });
  }
  
  return defaultPrompt;
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
  
  const defaultPrompt = `Създай summary, препоръки и допълнения за 7-дневен хранителен план.

КЛИЕНТ: ${data.name}, Цел: ${data.goal}
BMR: ${bmr}, Целеви калории: ${recommendedCalories} kcal/ден
Реален среден прием: ${avgCalories} kcal/ден
Реални средни макроси: Protein ${avgProtein}g, Carbs ${avgCarbs}g, Fats ${avgFats}g

СТРАТЕГИЯ (КОМПАКТНА):
- Психологическа подкрепа: ${psychologicalSupport.slice(0, 3).join('; ')}
- Добавки: ${supplementRecommendations.slice(0, 3).join('; ')}
- Хидратация: ${hydrationStrategy}
- Включвай: ${foodsToInclude.slice(0, 5).join(', ')}
- Избягвай: ${foodsToAvoid.slice(0, 5).join(', ')}

JSON ФОРМАТ (КРИТИЧНО - използвай САМО числа за числови полета):
{
  "summary": {
    "bmr": ${bmr},
    "dailyCalories": ${avgCalories},
    "macros": {"protein": ${avgProtein}, "carbs": ${avgCarbs}, "fats": ${avgFats}}
  },
  "recommendations": ["конкретна храна 1", "храна 2", "храна 3", "храна 4", "храна 5"],
  "forbidden": ["забранена храна 1", "храна 2", "храна 3", "храна 4"],
  "psychology": ${strategy.psychologicalSupport ? JSON.stringify(strategy.psychologicalSupport) : '["съвет 1", "съвет 2", "съвет 3"]'},
  "waterIntake": "${strategy.hydrationStrategy || 'Минимум 2-2.5л вода дневно'}",
  "supplements": ${strategy.supplementRecommendations ? JSON.stringify(strategy.supplementRecommendations) : '["добавка 1 с дозировка", "добавка 2 с дозировка", "добавка 3 с дозировка"]'}
}

ВАЖНО: recommendations/forbidden=САМО конкретни храни според цел ${data.goal}, НЕ общи съвети.`;

  // If custom prompt exists, use it; otherwise use default
  if (customPrompt) {
    // Replace variables in custom prompt
    return replacePromptVariables(customPrompt, {
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
function generateMealPlanPrompt(data, analysis, strategy) {
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

=== МОДИФИКАТОР (Потребителски профил) ===
ОПРЕДЕЛЕН МОДИФИКАТОР ЗА КЛИЕНТА: "${dietaryModifier}"
${strategy.modifierReasoning ? `ОБОСНОВКА: ${strategy.modifierReasoning}` : ''}

=== КЛИЕНТ И ЦЕЛИ ===
- Име: ${data.name}
- Цел: ${data.goal}
- Калории: ${recommendedCalories} kcal/ден (ИНДИВИДУАЛНО изчислени според BMR=${bmr}, активност и цел)

=== СТРАТЕГИЯ (КОМПАКТНА) ===
Диета: ${strategyCompact.dietType}
Схема: ${strategyCompact.weeklyMealPattern}
Хранения: ${strategyCompact.mealTiming}
Принципи: ${strategyCompact.keyPrinciples}
Храни включвай: ${strategyCompact.foodsToInclude}
Храни избягвай: ${strategyCompact.foodsToAvoid}
${modificationsSection}

=== АРХИТЕКТУРА НА ХРАНЕНЕТО ===
Категории: [PRO]=Белтък (животински: месо, риба, яйца, млечни; растителен: тофу, темпе; бобови: леща, боб, нахут), [ENG]=Енергия/въглехидрати (зърнени: ориз, киноа, елда, овес, паста, хляб; кореноплодни: картофи; плодове), [VOL]=Зеленчуци/фибри (листни салати, краставици, домати, броколи, тиквички, чушки, гъби, карфиол, патладжан), [FAT]=Мазнини (зехтин, масло, авокадо, ядки, семена, тахан, маслини), [CMPX]=Сложни ястия (пица, лазаня, мусака, баница, бургер, врап, ризото, паеля).

Шаблони за ястия: A) РАЗДЕЛЕНА ЧИНИЯ=[PRO]+[ENG]+[VOL] (печено пиле+картофи+салата), B) СМЕСЕНО=[PRO]+[ENG]+[VOL] микс (яхнии, купи), C) ЛЕКО/САНДВИЧ=[ENG-хляб]+[PRO]+[FAT]+[VOL] (сандвич, тост), D) ЕДИНЕН БЛОК=[CMPX]+[VOL] (лазаня+салата). 

Филтриране според МОДИФИКАТОР "${dietaryModifier}": Веган=без животински [PRO]; Кето/Нисковъглехидратно=минимум [ENG], повече [PRO]+[FAT]; Без глутен=[ENG] само ориз/картофи/киноа/елда; Палео=без зърнени/бобови/млечни; Щадящ стомах=готвени [VOL], без сурови влакнини. Избор на шаблон: закуска=C или A, обяд=A или B, вечеря=A/B/D. Слотове с продукти от филтриран списък. Избягвай: ${data.dietDislike || 'няма'}. Включвай: ${data.dietLove || 'няма'}. Естествен български език БЕЗ кодове в изхода.

=== ADLE v8 STRICT RULES (ЗАДЪЛЖИТЕЛНО СПАЗВАНЕ) ===
ПРИОРИТЕТ (винаги): 1) Hard bans → 2) Mode filter (MODE има приоритет над базови правила) → 3) Template constraints → 4) Hard rules (R1-R12) → 5) Repair → 6) Output

0) HARD BANS (0% ВИНАГИ):
- лук (всякаква форма), пуешко месо, изкуствени подсладители
- мед, захар, конфитюр, сиропи
- кетчуп, майонеза, BBQ/сладки сосове
- гръцко кисело мляко (използвай САМО обикновено кисело мляко)
- грах + риба (забранена комбинация)

0.1) РЯДКО (≤2 пъти/седмично): пуешка шунка, бекон

HARD RULES (R1-R12):
R1: Белтък главен = точно 1. Вторичен белтък САМО ако (закуска AND яйца), 0-1.
R2: Зеленчуци = 1-2. Избери ТОЧНО ЕДНА форма: Салата ИЛИ Пресни (НЕ и двете едновременно). Картофите НЕ СА зеленчуци.
R3: Енергия = 0-1 (никога 2).
R4: Млечни макс = 1 на хранене (кисело мляко ИЛИ извара ИЛИ сирене), включително като сос/дресинг.
R5: Мазнини = 0-1. Ако ядки/семена → без зехтин/масло.
R6: Правило за сирене: Ако сирене → без зехтин/масло. Маслини разрешени със сирене.
R7: Правило за бекон: Ако бекон → Мазнини=0.
R8: Бобови-като-основно (боб/леща/нахут/гювеч от грах): Енергия=0 (без ориз/картофи/паста/булгур/овесени). Хляб може да е опционален: +1 филия пълнозърнест.
R9: Правило за хляб (извън Template C): Разрешен САМО ако Енергия=0. Изключение: с бобови-като-основно (R8), хляб може да е опционален (1 филия). Ако има Енергия → Хляб=0.
R10: Грах като добавка към месо: Грахът НЕ Е енергия, но БЛОКИРА слота Енергия → Енергия=0. Хляб може да е опционален (+1 филия).
R11: Template C (сандвич): Само за закуски; бобови забранени; без забранени сосове/подсладители.
R12: Извън-whitelist добавяне: По подразбиране=само whitelist. Извън-whitelist САМО ако обективно нужно (MODE/медицинско/наличност), mainstream/универсално, налично в България. Добави ред: Reason: ...

=== WHITELISTS (РАЗРЕШЕНИ ХРАНИ) - ЗАДЪЛЖИТЕЛНО СПАЗВАНЕ ===
КРИТИЧНО: Използвай САМО храни от тези списъци! Извън-whitelist САМО с Reason: ...

WHITELIST PROTEIN (избери точно 1 главен белтък):
- яйца (eggs)
- пилешко (chicken)
- говеждо (beef)
- постна свинска (lean pork)
- риба (white fish, скумрия/mackerel, риба тон/canned tuna)
- кисело мляко (yogurt - plain, несладко)
- извара (cottage cheese - plain)
- сирене (cheese - умерено)
- боб (beans)
- леща (lentils)
- нахут (chickpeas)
- грах (peas - виж 3.5)

ЗАБРАНЕНИ БЕЛТЪЦИ (НЕ използвай без Reason):
- пуешко месо (turkey meat) - HARD BAN
- заешко (rabbit) - ИЗВЪН whitelist
- патица (duck) - ИЗВЪН whitelist
- гъска (goose) - ИЗВЪН whitelist
- агне (lamb) - ИЗВЪН whitelist
- дивеч (game meat) - ИЗВЪН whitelist
- всички екзотични меса - ИЗВЪН whitelist

WHITELIST VEGETABLES (избери 1-2):
- домати, краставици, чушки, зеле, моркови
- салата/листни зеленчуци (lettuce/greens), спанак
- тиквички, гъби, броколи, карфиол
- пресни нарязани: домати/краставици/чушки (БЕЗ дресинг)

WHITELIST ENERGY (избери 0-1):
- овесени ядки (oats)
- ориз (rice)
- картофи (potatoes)
- паста (pasta)
- булгур (bulgur)
ЗАБЕЛЕЖКА: Царевица НЕ е енергия!

WHITELIST FAT (избери 0-1):
- зехтин (olive oil)
- масло (butter - умерено)
- ядки/семена (nuts/seeds - умерено)

СПЕЦИАЛНИ ПРАВИЛА:
- Грах + риба = СТРОГО ЗАБРАНЕНО
- Зеленчуци: ЕДНА форма на хранене (Салата ИЛИ Пресни нарязани, не и двете)
- Маслини = добавка към салата (НЕ Мазнини слот). Ако маслини → БЕЗ зехтин/масло
- Царевица = НЕ е енергия. Малко царевица само в салати като добавка
- Template C (сандвич) = САМО за закуски, НЕ за основни хранения

=== ВАЖНИ ОГРАНИЧЕНИЯ ===

СТРОГО ИЗБЯГВАЙ:
- Прекалено конкретни имена (позволи избор на клиента)
  ДА: "плодове с кисело мляко", "риба със зеленчуци", "месо със салата"
  НЕ: "боровинки с кисело мляко", "пастърва с броколи"
- Странни комбинации (чийзкейк със салата, пица с тофу)
- Екзотични продукти (труднодостъпни в България)
- Повтаряне на същите храни в различни дни
- Нетрадиционни комбинации за българската/средиземноморска кухня

ОГРАНИЧЕНИЯ: Избягвай странни комбинации, екзотични продукти, повтаряне на храни, нетрадиционни комбинации. Медицински: ${JSON.stringify(data.medicalConditions || [])}. РАЗНООБРАЗИЕ всеки ден. Реалистични български/средиземноморски ястия.${data.eatingHabits && data.eatingHabits.includes('Не закусвам') ? ` ЗАКУСКА: Клиентът НЕ ЗАКУСВА - уважи предпочитанието. Допустима САМО напитка ако критично важно.` : ''}

${MEAL_NAME_FORMAT_INSTRUCTIONS}

JSON ФОРМАТ:
{
  "summary": {"bmr": "${bmr}", "dailyCalories": "${recommendedCalories}", "macros": {"protein": "Xg", "carbs": "Xg", "fats": "Xg"}},
  "weekPlan": {"day1": {"meals": [{"type": "Закуска", "name": "име", "weight": "Xg", "description": "описание", "benefits": "ползи за ${data.name}", "calories": X, "macros": {"protein": X, "carbs": X, "fats": X, "fiber": X}}, {"type": "Обяд", "name": "...", ...}, {"type": "Вечеря", "name": "...", ...}]}, ... "day7": {...}},
  "recommendations": ["храна 1", "храна 2", "храна 3", "храна 4", "храна 5+"],
  "forbidden": ["храна 1", "храна 2", "храна 3", "храна 4+"],
  "psychology": ${JSON.stringify(strategyCompact.psychologicalSupport)},
  "waterIntake": "${strategyCompact.hydrationStrategy}",
  "supplements": ${JSON.stringify(strategyCompact.supplementRecommendations)}
}

=== МЕДИЦИНСКИ И ДИЕТЕТИЧНИ ПРИНЦИПИ ЗА РЕД НА ХРАНЕНИЯ ===
КРИТИЧНО ВАЖНО: Следвай медицинските и диететични принципи, но ПРИОРИТИЗИРАЙ СТРАТЕГИЯТА:

1. ПОЗВОЛЕНИ ТИПОВЕ ХРАНЕНИЯ (в хронологичен ред):
   - "Закуска" (сутрин) - ВИНАГИ първо ако има закуска
   - "Обяд" (обед) - след закуската или първо хранене ако няма закуска
   - "Следобедна закуска" (опционално, между обяд и вечеря)
   - "Вечеря" (вечер) - обикновено последно хранене
   - "Късна закуска" (опционално, след вечеря)

2. БРОЙ ХРАНЕНИЯ: 1-5 хранения на ден
   - ЗАДЪЛЖИТЕЛНО обоснови избора на брой хранения в стратегията
   - 1 хранене (OMAD): само при ясна стратегия за интермитентно гладуване
   - 2 хранения: при стратегия за интермитентно гладуване (16:8, 18:6)
   - 3 хранения: Закуска, Обяд, Вечеря (стандартен вариант)
   - 4 хранения: добави Следобедна закуска когато е обосновано
   - 5 хранения: добави Късна закуска САМО когато е обосновано от стратегията

3. ХРАНЕНИЯ СЛЕД ВЕЧЕРЯ - разрешени при обосновка:
   ОБОСНОВКА Е НЕОБХОДИМА за всяко хранене след вечеря:
   - Физиологична причина (диабет, дълъг период до сън >4ч, проблеми със съня от глад)
   - Психологическа причина (управление на стрес, емоционално хранене)
   - Стратегическа причина (спортни тренировки вечер, работа на смени)
   
   ДОБАВИ ОБОСНОВКАТА В strategy.afterDinnerMealJustification!
   
   Ако добавяш хранене след вечеря:
   - Предпочитай "Късна закуска" с ниско-гликемични храни
   - Калории: препоръчват се до ${MAX_LATE_SNACK_CALORIES} kcal (може повече ако е обосновано)
   - ЗАДЪЛЖИТЕЛНО обясни ЗАЩО е необходимо в planJustification

4. МНОГОДНЕВЕН ХОРИЗОНТ:
   - При обоснована физиологична/психологическа/стратегическа идея можеш да планираш 2-3 дни като цяло
   - Хоризонтът на макроси и калории НЕ е задължително 24 часа
   - Може да използваш циклично разпределение (напр. ниски-високи калорийни дни)
   - ОБЯСНИ подхода в strategy.longTermStrategy

5. МАКРОНУТРИЕНТИ:
   - Всяко хранене ЗАДЪЛЖИТЕЛНО има: "type", "name", "weight", "description", "benefits", "calories"
   - Всяко хранене ЗАДЪЛЖИТЕЛНО има "macros": {"protein": X, "carbs": X, "fats": X, "fiber": X}
   - Прецизни калории: 1г протеин=4kcal, 1г въглехидрати=4kcal, 1г мазнини=9kcal
   - Дневни калории минимум ${MIN_DAILY_CALORIES} kcal (може да варират между дни при циклично планиране)

6. МЕДИЦИНСКИ ОГРАНИЧЕНИЯ:
   - При диабет: НЕ високовъглехидратни храни
   - При анемия + вегетарианство: желязо ЗАДЪЛЖИТЕЛНО в supplements
   - При IBS/IBD: щадящи храни, готвени зеленчуци
   - При PCOS/СПКЯ: предпочитай нисковъглехидратни варианти
   - Спазвай: ${JSON.stringify(data.medicalConditions || [])}

7. СТРУКТУРА И РАЗНООБРАЗИЕ:
   - ВСИЧКИ 7 дни (day1-day7) ЗАДЪЛЖИТЕЛНО
   - 1-5 хранения на ден според стратегията (ОБОСНОВАНИ в strategy.mealCountJustification)
   - Избягвай повторения на храни в различни дни
   - Избягвай: ${data.dietDislike || 'няма'}
   - Включвай: ${data.dietLove || 'няма'}

ВАЖНО: Използвай strategy.planJustification, strategy.longTermStrategy, strategy.mealCountJustification и strategy.afterDinnerMealJustification за обосновка на всички нестандартни решения. "recommendations"/"forbidden"=САМО конкретни храни. Всички 7 дни (day1-day7) с 1-5 хранения В ПРАВИЛЕН ХРОНОЛОГИЧЕН РЕД. Точни калории/макроси за всяко ястие. Около ${recommendedCalories} kcal/ден като ориентир (може да варира при многодневно планиране). Седмичен подход: МИСЛИ СЕДМИЧНО/МНОГОДНЕВНО - ЦЯЛОСТНА схема като система. ВСИЧКИ 7 дни (day1-day7) ЗАДЪЛЖИТЕЛНО.

Създай пълния 7-дневен план с балансирани, индивидуални ястия за ${data.name}, следвайки стратегията.`;
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
- Балансирани български ястия
- СПАЗВАЙ медицинските ограничения
- Избягвай: ${data.dietDislike || 'няма'}
- Включвай: ${data.dietLove || 'няма'}

JSON ФОРМАТ:
{
  "summary": {"bmr": "${bmr}", "dailyCalories": "${recommendedCalories}", "macros": {"protein": "Xg", "carbs": "Xg", "fats": "Xg"}},
  "weekPlan": {"day1": {"meals": [...]}, ... "day7": {...}},
  "recommendations": ["храна 1", "храна 2", "храна 3"],
  "forbidden": ["храна 1", "храна 2", "храна 3"],
  "psychology": ["съвет 1", "съвет 2", "съвет 3"],
  "waterIntake": "2-2.5л дневно",
  "supplements": ["добавка 1", "добавка 2", "добавка 3"]
}

ВАЖНО: Върни САМО JSON, без допълнителни обяснения!`;

  const response = await callAIModel(env, simplifiedPrompt, MEAL_PLAN_TOKEN_LIMIT, 'fallback_plan_generation');
  const plan = parseAIResponse(response);
  
  if (!plan || plan.error) {
    throw new Error('Simplified fallback plan generation failed');
  }
  
  // Add basic strategy and analysis for compatibility
  plan.strategy = {
    planJustification: `Опростен план създаден автоматично за ${data.name} с цел ${data.goal}. Този план използва основни принципи на здравословното хранене.`,
    dietaryModifier: "Балансирано",
    dietType: "Балансирана"
  };
  
  plan.analysis = {
    bmr: bmr,
    recommendedCalories: recommendedCalories,
    keyProblems: []
  };
  
  return plan;
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

КЛИЕНТ: ${userMessage}

АСИСТЕНТ (отговори КРАТКО):`;

  return fullPrompt;
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
 * Improved token estimation for mixed Cyrillic/Latin text
 * Cyrillic characters typically use 2-3 bytes in UTF-8, so tokens/char ratio is higher
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
 * Call AI model with load monitoring
 * Goal: Monitor request sizes to ensure no single request is overloaded
 * Architecture: System already uses multi-step approach (Analysis → Strategy → Meal Plan Chunks)
 */
async function callAIModel(env, prompt, maxTokens = null, stepName = 'unknown') {
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
    modelName: modelName
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
    } else if (preferredProvider === 'google' && env.GEMINI_API_KEY) {
      response = await callGemini(env, prompt, modelName, maxTokens);
      success = true;
    } else if (env.OPENAI_API_KEY) {
      // Fallback to any available API key
      response = await callOpenAI(env, prompt, modelName, maxTokens);
      success = true;
    } else if (env.GEMINI_API_KEY) {
      response = await callGemini(env, prompt, modelName, maxTokens);
      success = true;
    } else {
      // Return mock response for development
      console.warn('No AI API key configured. Returning mock response.');
      response = generateMockResponse(prompt);
      success = true;
    }
  } catch (e) {
    error = e.message;
    throw e;
  } finally {
    // Log AI response
    const duration = Date.now() - startTime;
    const estimatedOutputTokens = response ? estimateTokenCount(response) : 0;
    
    await logAIResponse(env, logId, stepName, {
      response: response,
      estimatedOutputTokens: estimatedOutputTokens,
      duration: duration,
      success: success,
      error: error
    });
  }

  return response;
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

// Enhancement #3: Estimate tokens for a message
// Note: This is a rough approximation (~4 chars per token for mixed content).
// Actual GPT tokenization varies by language and content. This is sufficient
// for conversation history management where approximate limits are acceptable.
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

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

    // Generate unique log ID using crypto.randomUUID() if available, fallback to timestamp+random
    const logId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `ai_log_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`
      : `ai_log_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const timestamp = new Date().toISOString();
    
    const logEntry = {
      id: logId,
      timestamp: timestamp,
      stepName: stepName,
      type: 'request',
      prompt: requestData.prompt || '',
      promptLength: requestData.prompt?.length || 0,
      estimatedInputTokens: requestData.estimatedInputTokens || 0,
      maxOutputTokens: requestData.maxTokens || null,
      provider: requestData.provider || 'unknown',
      modelName: requestData.modelName || 'unknown'
    };

    // Store individual log entry
    await env.page_content.put(`ai_communication_log:${logId}`, JSON.stringify(logEntry));
    
    // Add to log index
    let logIndex = await env.page_content.get('ai_communication_log_index');
    logIndex = logIndex ? JSON.parse(logIndex) : [];
    logIndex.unshift(logId); // Add to beginning (most recent first)
    
    // Keep only last MAX_LOG_ENTRIES log entries in index
    // Note: Old log entries will remain in KV until their TTL expires or manual cleanup
    // For now, we accept this trade-off to avoid expensive delete operations on every log write
    // Future improvement: Implement periodic cleanup job or add expiration time when writing logs
    if (logIndex.length > MAX_LOG_ENTRIES) {
      const removedLogIds = logIndex.slice(MAX_LOG_ENTRIES);
      logIndex = logIndex.slice(0, MAX_LOG_ENTRIES);
      
      // Optional: Cleanup old log entries asynchronously (doesn't block current request)
      // This helps prevent storage bloat over time
      if (removedLogIds.length > 0) {
        // Use Promise.allSettled to avoid blocking if some deletes fail
        Promise.allSettled(
          removedLogIds.flatMap(id => [
            env.page_content.delete(`ai_communication_log:${id}`),
            env.page_content.delete(`ai_communication_log:${id}_response`)
          ])
        ).catch(err => console.error('Background log cleanup error:', err));
      }
    }
    
    await env.page_content.put('ai_communication_log_index', JSON.stringify(logIndex));
    
    console.log(`AI request logged: ${stepName} (${logId})`);
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
 * Helper function to get KV key for prompt type
 */
function getPromptKVKey(type) {
  const keyMap = {
    'consultation': 'admin_consultation_prompt',
    'modification': 'admin_modification_prompt',
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
      summaryPrompt
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
      env.page_content.get('admin_summary_prompt')
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
      summaryPrompt
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
    
    // Get log index
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
    });
  } catch (error) {
    console.error('Error getting AI logs:', error);
    return jsonResponse({ error: 'Failed to get AI logs: ' + error.message }, 500);
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
      const defaultBlacklist = [
        'лук', 'onion', 
        'пуешко месо', 'turkey meat',
        'изкуствени подсладители', 'artificial sweeteners',
        'мед', 'захар', 'конфитюр', 'сиропи', 
        'honey', 'sugar', 'jam', 'syrups',
        'кетчуп', 'майонеза', 'BBQ сос', 
        'ketchup', 'mayonnaise', 'BBQ sauce',
        'гръцко кисело мляко', 'greek yogurt'
      ];
      return jsonResponse({ success: true, blacklist: defaultBlacklist });
    }
    
    const blacklistData = await env.page_content.get('food_blacklist');
    const blacklist = blacklistData ? JSON.parse(blacklistData) : [
      'лук', 'onion', 
      'пуешко месо', 'turkey meat',
      'изкуствени подсладители', 'artificial sweeteners',
      'мед', 'захар', 'конфитюр', 'сиропи', 
      'honey', 'sugar', 'jam', 'syrups',
      'кетчуп', 'майонеза', 'BBQ сос', 
      'ketchup', 'mayonnaise', 'BBQ sauce',
      'гръцко кисело мляко', 'greek yogurt'
    ];
    
    return jsonResponse({ success: true, blacklist: blacklist });
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
    let blacklist = blacklistData ? JSON.parse(blacklistData) : [
      'лук', 'onion', 
      'пуешко месо', 'turkey meat',
      'изкуствени подсладители', 'artificial sweeteners',
      'мед', 'захар', 'конфитюр', 'сиропи', 
      'honey', 'sugar', 'jam', 'syrups',
      'кетчуп', 'майонеза', 'BBQ сос', 
      'ketchup', 'mayonnaise', 'BBQ sauce',
      'гръцко кисело мляко', 'greek yogurt'
    ];
    
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
 * Helper to create JSON response
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}
