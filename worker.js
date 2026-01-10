/**
 * Cloudflare Worker for AI Diet Application
 * Backend endpoint: https://aidiet.radilov-k.workers.dev/
 */

// No default values - all calculations must be individualized based on user data

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

/**
 * Calculate BMR using Mifflin-St Jeor Equation
 * Men: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) + 5
 * Women: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) - 161
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
 */
function calculateTDEE(bmr, activityLevel) {
  const activityMultipliers = {
    'Никаква (0 дни седмично)': 1.2,
    'Ниска (1–2 дни седмично)': 1.375,
    'Средна (2–4 дни седмично)': 1.55,
    'Висока (5–7 дни седмично)': 1.725,
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
  // Exact match for "Отслабване" (case-insensitive)
  if (bmi < 18.5 && normalizedGoal === 'отслабване') {
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
  // Exact match for "Покачване на мускулна маса" (case-insensitive)
  if (bmi >= 30 && normalizedGoal === 'покачване на мускулна маса') {
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
      } else if (url.pathname === '/api/admin/save-prompt' && request.method === 'POST') {
        return await handleSavePrompt(request, env);
      } else if (url.pathname === '/api/admin/get-prompt' && request.method === 'GET') {
        return await handleGetPrompt(request, env);
      } else if (url.pathname === '/api/admin/save-model' && request.method === 'POST') {
        return await handleSaveModel(request, env);
      } else if (url.pathname === '/api/admin/get-config' && request.method === 'GET') {
        return await handleGetConfig(request, env);
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
    const structuredPlan = await generatePlanMultiStep(env, data);
    console.log('handleGeneratePlan: Plan structured for userId:', userId);
    
    // REQUIREMENT 4: Validate plan before displaying
    const validation = validatePlan(structuredPlan, data);
    if (!validation.isValid) {
      console.error('handleGeneratePlan: Plan validation failed:', validation.errors);
      return jsonResponse({ 
        error: `Планът не премина качествен тест: ${validation.errors.join('; ')}`,
        validationErrors: validation.errors
      }, 400);
    }
    console.log('handleGeneratePlan: Plan validated successfully');
    
    return jsonResponse({ 
      success: true, 
      plan: structuredPlan,
      userId: userId 
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
    const aiResponse = await callAIModel(env, chatPrompt, 2000);
    
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
    
    // Trim history to keep within token budget (approx 1500 tokens = 6000 chars)
    const MAX_HISTORY_TOKENS = 1500;
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

// Token limit for meal plan generation - increased to ensure all 7 days with 3-4 meals each are generated
// Note: This is the OUTPUT token limit. Input prompt formatting is optimized to reduce token count while preserving all analysis criteria and requirements.
const MEAL_PLAN_TOKEN_LIMIT = 5000;

/**
 * REQUIREMENT 4: Validate plan against all parameters and check for contradictions
 * Returns { isValid: boolean, errors: string[] }
 */
function validatePlan(plan, userData) {
  const errors = [];
  
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
  
  // 10. Check for plan justification (REQUIREMENT 3)
  if (!plan.strategy || !plan.strategy.planJustification || plan.strategy.planJustification.length < 20) {
    errors.push('Липсва обосновка защо планът е индивидуален');
  }
  
  // 11. Check that analysis doesn't contain "Normal" severity problems (REQUIREMENT 2)
  if (plan.analysis && plan.analysis.keyProblems && Array.isArray(plan.analysis.keyProblems)) {
    const normalProblems = plan.analysis.keyProblems.filter(p => p.severity === 'Normal');
    if (normalProblems.length > 0) {
      errors.push(`Анализът съдържа ${normalProblems.length} "Normal" проблеми, които не трябва да се показват`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

async function generatePlanMultiStep(env, data) {
  console.log('Multi-step generation: Starting (3 AI requests for precision)');
  
  try {
    // Step 1: Analyze user profile (1st AI request)
    // Focus: Deep health analysis, metabolic profile, correlations
    const analysisPrompt = generateAnalysisPrompt(data);
    let analysisResponse, analysis;
    
    try {
      analysisResponse = await callAIModel(env, analysisPrompt);
      analysis = parseAIResponse(analysisResponse);
      
      if (!analysis || analysis.error) {
        throw new Error(`Анализът не можа да бъде създаден: ${analysis.error || 'Невалиден формат на отговор'}`);
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
    const strategyPrompt = generateStrategyPrompt(data, analysis);
    let strategyResponse, strategy;
    
    try {
      strategyResponse = await callAIModel(env, strategyPrompt);
      strategy = parseAIResponse(strategyResponse);
      
      if (!strategy || strategy.error) {
        throw new Error(`Стратегията не можа да бъде създадена: ${strategy.error || 'Невалиден формат на отговор'}`);
      }
    } catch (error) {
      console.error('Strategy step failed:', error);
      throw new Error(`Стъпка 2 (Стратегия): ${error.message}`);
    }
    
    console.log('Multi-step generation: Strategy complete (2/3)');
    
    // Step 3: Generate detailed meal plan (3rd AI request)
    // Focus: Specific meals, portions, timing based on strategy
    // Increased token limit to ensure all 7 days with 3-4 meals each are generated
    const mealPlanPrompt = generateMealPlanPrompt(data, analysis, strategy);
    let mealPlanResponse, mealPlan;
    
    try {
      mealPlanResponse = await callAIModel(env, mealPlanPrompt, MEAL_PLAN_TOKEN_LIMIT);
      mealPlan = parseAIResponse(mealPlanResponse);
      
      if (!mealPlan || mealPlan.error) {
        throw new Error(`Хранителният план не можа да бъде създаден: ${mealPlan.error || 'Невалиден формат на отговор'}`);
      }
    } catch (error) {
      console.error('Meal plan step failed:', error);
      throw new Error(`Стъпка 3 (Хранителен план): ${error.message}`);
    }
    
    console.log('Multi-step generation: Meal plan complete (3/3)');
    
    // Combine all parts into final plan (meal plan takes precedence)
    // Returns comprehensive plan with analysis and strategy included
    return {
      ...mealPlan,
      analysis: analysis,
      strategy: strategy
    };
  } catch (error) {
    console.error('Multi-step generation failed:', error);
    // Return error with details instead of falling back silently
    throw new Error(`Генерирането на план се провали: ${error.message}`);
  }
}

/**
 * Step 1: Generate prompt for user profile analysis
 */
function generateAnalysisPrompt(data) {
  return `Ти си ИЗКЛЮЧИТЕЛЕН СПЕЦИАЛИСТ с дълбоки познания в МЕДИЦИНА, ПСИХОЛОГИЯ и ДИЕТЕТИКА, базирани на най-новите научни проучвания и клинична практика. Действаш като опитен диетолог, ендокринолог и психолог със специализация в хранителното поведение.

Твоята експертиза включва:
- Последни проучвания в областта на метаболизма и хранителните науки
- Психологически механизми на хранителното поведение и емоционалното хранене
- Ендокринни взаимовръзки между хормони, стрес, сън и хранене
- Холистичен подход към здравето, обхващащ физически и психологически аспекти
- Индивидуализирани стратегии базирани на научни доказателства

Направи ЗАДЪЛБОЧЕН ХОЛИСТИЧЕН АНАЛИЗ на този клиент:

ОСНОВНИ ДАННИ:
- Име: ${data.name}
- Пол: ${data.gender}
- Възраст: ${data.age} години
- Ръст: ${data.height} см
- Тегло: ${data.weight} кг
- Цел: ${data.goal}
${data.lossKg ? `- Целево отслабване: ${data.lossKg} кг` : ''}

ЗДРАВОСЛОВЕН ПРОФИЛ:
- Сън: ${data.sleepHours} часа (прекъсвания: ${data.sleepInterrupt})
- Хронотип: ${data.chronotype}
- Активност през деня: ${data.dailyActivityLevel}
- Стрес: ${data.stressLevel}
- Спортна активност: ${data.sportActivity}
- Прием на вода: ${data.waterIntake}
- Сладки напитки: ${data.drinksSweet || 'Не е посочено'}
- Алкохол: ${data.drinksAlcohol || 'Не е посочено'}

ХРАНИТЕЛНИ НАВИЦИ И ПОВЕДЕНИЕ:
- Прекомерно хранене: ${data.overeatingFrequency}
- Хранителни навици: ${JSON.stringify(data.eatingHabits || [])}
- Желания за храна: ${JSON.stringify(data.foodCravings || [])}
${data.foodCravings_other ? `  (Друго: ${data.foodCravings_other})` : ''}
- Тригери за хранене: ${JSON.stringify(data.foodTriggers || [])}
${data.foodTriggers_other ? `  (Друго: ${data.foodTriggers_other})` : ''}
- Методи за компенсация: ${JSON.stringify(data.compensationMethods || [])}
${data.compensationMethods_other ? `  (Друго: ${data.compensationMethods_other})` : ''}
- Социално сравнение: ${data.socialComparison}

МЕДИЦИНСКИ СЪСТОЯНИЯ:
- Състояния: ${JSON.stringify(data.medicalConditions || [])}
${data['medicalConditions_Алергии'] ? `- Детайли за алергии: ${data['medicalConditions_Алергии']}` : ''}
${data['medicalConditions_Автоимунно'] ? `- Детайли за автоимунно заболяване: ${data['medicalConditions_Автоимунно']}` : ''}
${data.medicalConditions_other ? `- Други медицински състояния: ${data.medicalConditions_other}` : ''}
- Лекарства: ${data.medications === 'Да' ? data.medicationsDetails : 'Не приема'}

ХРАНИТЕЛНА ИСТОРИЯ:
- Рязко покачване на тегло: ${data.weightChange === 'Да' ? data.weightChangeDetails : 'Не'}
- Диети в миналото: ${data.dietHistory === 'Да' ? `Тип: ${data.dietType}, Резултат: ${data.dietResult}` : 'Не'}

КРИТИЧНО ВАЖНО - НИКАКВИ DEFAULT СТОЙНОСТИ:
- ВСИЧКО трябва да бъде ИЗЧИСЛЕНО индивидуално за ${data.name}
- ЗАБРАНЕНО е използването на универсални, общи или стандартни стойности
- BMR, TDEE, калории, макронутриенти - ВСИЧКИ трябва да са ПРЕЦИЗНО изчислени според УНИКАЛНИЯ профил
- Вземи предвид АБСОЛЮТНО ВСИЧКИ параметри при изчисленията

ИЗИСКВАНИЯ ЗА АНАЛИЗ:
1. Анализирай КОРЕЛАЦИИТЕ между сън, стрес и хранителни желания
2. Определи как медицинските състояния влияят на хранителните нужди
3. Разбери ПСИХОЛОГИЧЕСКИЯ профил - връзката между емоции и хранене
4. Идентифицирай МЕТАБОЛИТНИ особености базирани на всички параметри
5. Прецени как хронотипът влияе на храносмилането и енергията
6. Определи СПЕЦИФИЧНИТЕ нужди от макронутриенти въз основа на целите, активност и медицински състояния
7. Създай ИНДИВИДУАЛИЗИРАН подход, който отчита ВСИЧКИ фактори заедно
8. Идентифицирай между 3 и 6 КЛЮЧОВИ ПРОБЛЕМА които пречат на здравето или постигането на целта
   КРИТИЧНО: НИКОГА не включвай проблеми с "Normal" severity - само Borderline, Risky или Critical
   ФОКУСИРАЙ СЕ САМО на проблемните области, които изискват внимание
   Не описвай нормални показатели като "добър сън" или "средна активност"
9. ИЗЧИСЛИ шанса за успех като число от -100 до 100:
   - Отрицателни стойности (-100 до -1): когато МНОЖЕСТВО фактори активно саботират целта (напр. поднормено тегло + цел отслабване)
   - Нулева стойност (0): неутрално състояние - равностойни подкрепящи и противопоказващи фактори
   - Ниски стойности (1-30): много противопоказващи фактори, малко подкрепящи
   - Средни стойности (31-70): балансирани или смесени фактори
   - Високи стойности (71-100): много подкрепящи фактори, малко противопоказващи
   - Вземи предвид: здравословно състояние, BMI, медицински условия, хранителни навици, сън, стрес, активност

Върни JSON с ДЕТАЙЛЕН анализ (НИКАКВИ универсални/default стойности):
{
  "bmr": "ПРЕЦИЗНО изчислена базова метаболитна скорост за ${data.name} с детайлно обяснение на изчислението",
  "tdee": "ИНДИВИДУАЛНО изчислен общ дневен разход на енергия базиран на активността и профила с детайли",
  "recommendedCalories": "ПЕРСОНАЛИЗИРАН калориен прием БАЗИРАН НА ЦЯЛОСТНИЯ АНАЛИЗ и целта ${data.goal} - НЕ универсална стойност",
  "macroRatios": {
    "protein": "ИНДИВИДУАЛНО препоръчителен процент протеини С ДЕТАЙЛНА ОБОСНОВКА според целта, активността и състоянието",
    "carbs": "ИНДИВИДУАЛНО препоръчителен процент въглехидрати С ДЕТАЙЛНА ОБОСНОВКА според целта и метаболизма",
    "fats": "ИНДИВИДУАЛНО препоръчителен процент мазнини С ДЕТАЙЛНА ОБОСНОВКА според нуждите и здравето"
  },
  "metabolicProfile": "ЗАДЪЛБОЧЕНО описание на УНИКАЛНИЯ метаболитен профил на ${data.name} и корелации",
  "healthRisks": ["специфичен за ${data.name} риск 1 с обяснение", "специфичен за ${data.name} риск 2 с обяснение"],
  "nutritionalNeeds": ["специфична за ${data.name} нужда 1 базирана на профила", "специфична за ${data.name} нужда 2 базирана на профила"],
  "psychologicalProfile": "ДЕТАЙЛЕН анализ на психологическите фактори НА ${data.name}, емоционалното хранене и корелации със стрес, сън и поведение",
  "successChance": "число от -100 до 100 базирано на анализ на ВСИЧКИ фактори на ${data.name}",
  "successChanceReasoning": "детайлно обяснение защо този шанс за успех КОНКРЕТНО за ${data.name}, кои фактори подкрепят и кои саботират целта",
  "keyProblems": [
    {
      "title": "кратък заглавие на проблема (2-4 думи)",
      "description": "кратко описание до 3 изречения защо е проблем и до какво води",
      "severity": "Normal, Borderline, Risky или Critical",
      "severityValue": "число от 0-100 за визуализация",
      "category": "Sleep, Nutrition, Hydration, Stress, Activity, или Medical",
      "impact": "кратко описание на въздействието върху здравето или целта"
    }
  ]
}`;
}

/**
 * Step 2: Generate prompt for dietary strategy
 */
function generateStrategyPrompt(data, analysis) {
  return `Базирайки се на здравословния профил и анализа, определи оптималната диетична стратегия:

КЛИЕНТ: ${data.name}, ${data.age} год., Цел: ${data.goal}

АНАЛИЗ:
${JSON.stringify(analysis, null, 2)}

ПРЕДПОЧИТАНИЯ:
- Диетични предпочитания: ${JSON.stringify(data.dietPreference || [])}
${data.dietPreference_other ? `  (Друго: ${data.dietPreference_other})` : ''}
- Не обича/непоносимост: ${data.dietDislike || 'Няма'}
- Любими храни: ${data.dietLove || 'Няма'}

ВАЖНО: Вземи предвид ВСИЧКИ параметри холистично и създай КОРЕЛАЦИИ между тях:
1. Медицинските състояния и лекарства - как влияят на хранителните нужди
2. Хранителните непоносимости и алергии - строго ограничение
3. Личните предпочитания и любими храни - за дългосрочна устойчивост
4. Хронотипа и дневния ритъм - оптимално време на хранене
5. Нивото на стрес и емоционалното хранене - психологическа подкрепа
6. Културния контекст (български традиции и налични продукти)
7. КОРЕЛАЦИИ между сън, стрес и хранителни желания
8. ВРЪЗКАТА между физическа активност и калорийни нужди
9. ВЗАИМОВРЪЗКАТА между медицински състояния и хранителни потребности

КРИТИЧНО ВАЖНО - ИНДИВИДУАЛИЗАЦИЯ НА ВСИЧКИ ПРЕПОРЪКИ:
1. Хранителните добавки трябва да са СТРОГО ИНДИВИДУАЛНО подбрани за ${data.name}
2. ЗАБРАНЕНО е използването на универсални/общи препоръки за добавки
3. Всяка добавка трябва да е обоснована с КОНКРЕТНИ нужди от анализа
4. Дозировките трябва да са персонализирани според възраст, тегло, пол и здравословно състояние
5. Вземи предвид медицински състояния, лекарства и възможни взаимодействия

КРИТИЧНО ВАЖНО - ОПРЕДЕЛЯНЕ НА МОДИФИКАТОР:
След анализ на всички параметри, определи подходящ МОДИФИКАТОР (диетичен профил), който ще управлява логиката на генериране на ястия:
- Може да бъде термин: "Кето", "Палео", "Веган", "Вегетарианско", "Средиземноморско", "Нисковъглехидратно", "Балансирано", "Щадящ стомах", "Без глутен" и др.
- МОДИФИКАТОРЪТ трябва да отчита медицинските състояния, цели, предпочитания и всички анализирани фактори
- Определи ЕДНА основна диетична стратегия, която е най-подходяща за клиента
- Ако няма специфични ограничения, използвай "Балансирано" или "Средиземноморско"

Анализирай ЗАДЪЛБОЧЕНО как всеки параметър влияе и взаимодейства с другите.

Върни JSON със стратегия (БЕЗ универсални препоръки):
{
  "dietaryModifier": "термин за основен диетичен профил (напр. Балансирано, Кето, Веган, Средиземноморско, Нисковъглехидратно, Щадящ стомах)",
  "modifierReasoning": "Детайлно обяснение защо този МОДИФИКАТОР е избран СПЕЦИФИЧНО за ${data.name}",
  "planJustification": "КРАТКО (максимум 200 символа) конкретно обяснение защо този план е индивидуален и съобразен с контекста и целите на ${data.name}. Без общи приказки - само конкретика и ползи!",
  "dietType": "тип диета персонализиран за ${data.name} (напр. средиземноморска, балансирана, ниско-въглехидратна)",
  "weeklyMealPattern": "ХОЛИСТИЧНА седмична схема на хранене (напр. '16:8 интермитентно гладуване ежедневно', '5:2 подход', 'циклично фастинг', 'свободен уикенд', или традиционна схема с варииращи хранения)",
  "mealTiming": {
    "pattern": "седмичен модел на хранене описан детайлно - напр. 'Понеделник-Петък: 2 хранения (12:00, 19:00), Събота-Неделя: 3 хранения с едно свободно'",
    "fastingWindows": "периоди на гладуване ако се прилага (напр. '16 часа между последно хранене и следващо', или 'не се прилага')",
    "flexibility": "описание на гъвкавостта в схемата според дните и нуждите"
  },
  "keyPrinciples": ["принцип 1 специфичен за ${data.name}", "принцип 2 специфичен за ${data.name}", "принцип 3 специфичен за ${data.name}"],
  "foodsToInclude": ["храна 1 подходяща за ${data.name}", "храна 2 подходяща за ${data.name}", "храна 3 подходяща за ${data.name}"],
  "foodsToAvoid": ["храна 1 неподходяща за ${data.name}", "храна 2 неподходяща за ${data.name}", "храна 3 неподходяща за ${data.name}"],
  "supplementRecommendations": [
    "! ИНДИВИДУАЛНА добавка 1 за ${data.name} - конкретна добавка с дозировка и обосновка защо Е НУЖНА за този клиент (БАЗИРАНА на: възраст ${data.age} год., пол ${data.gender}, цел ${data.goal}, медицински състояния ${data.medicalConditions || 'няма'})",
    "! ИНДИВИДУАЛНА добавка 2 за ${data.name} - конкретна добавка с дозировка и обосновка защо Е НУЖНА за този клиент (БАЗИРАНА на: активност ${data.sportActivity}, сън ${data.sleepHours}ч, стрес ${data.stressLevel})",
    "! ИНДИВИДУАЛНА добавка 3 за ${data.name} - конкретна добавка с дозировка и обосновка защо Е НУЖНА за този клиент (БАЗИРАНА на: хранителни навици ${data.eatingHabits}, предпочитания ${data.dietPreference})"
  ],
  "hydrationStrategy": "препоръки за прием на течности персонализирани за ${data.name} според активност и климат",
  "psychologicalSupport": [
    "! психологически съвет 1 базиран на емоционалното хранене на ${data.name}",
    "! психологически съвет 2 базиран на стреса и поведението на ${data.name}",
    "! психологически съвет 3 за мотивация специфичен за профила на ${data.name}"
  ]
}

ВАЖНО ЗА СЕДМИЧНАТА СХЕМА:
- Създай ХОЛИСТИЧЕН седмичен модел, който взема предвид целта, хронотипа и навиците
- Интермитентно гладуване (16:8, 18:6, OMAD) е напълно валиден избор ако подхожда
- Може да варираш броя хранения между дните (напр. 2 хранения в работни дни, 3 в почивни)
- "Свободни дни" или "свободни хранения" са позволени като част от устойчива стратегия
- Седмицата трябва да работи като СИСТЕМА, не като 7 независими дни

ВАЖНО ЗА ХРАНИТЕЛНИ ДОБАВКИ:
- Всяка добавка трябва да има ЯСНА обосновка базирана на:
  * Дефицити от анализа (напр. нисък витамин D заради малко излагане на слънце)
  * Медицински състояния (напр. магнезий за стрес, омега-3 за възпаление)
  * Цели (напр. протеин за мускулна маса, желязо за енергия)
  * Възраст и пол (напр. калций за жени над 40, цинк за мъже)
- Дозировката трябва да е ПЕРСОНАЛИЗИРАНА според тегло, възраст и нужди
- Времето на прием трябва да е оптимално за усвояване
- СТРОГО ЗАБРАНЕНО: Използването на едни и същи добавки за различни клиенти
- СТРОГО ЗАБРАНЕНО: Универсални "мултивитамини" без конкретна обосновка
- Всяка добавка ТРЯБВА да е различна и специфична за конкретния клиент ${data.name}
- Вземи предвид уникалната комбинация от: ${data.age} год. ${data.gender}, ${data.goal}, ${data.medicalConditions || 'няма мед. състояния'}, ${data.sportActivity}, стрес: ${data.stressLevel}`;
}

/**
 * Step 3: Generate prompt for detailed meal plan
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
  // Parse BMR from analysis (may be a string) or calculate from user data
  let bmr;
  if (analysis.bmr) {
    // Try to extract numeric value from analysis.bmr (it may contain text like "1780 (ИНДИВИДУАЛНО изчислен)")
    const bmrMatch = String(analysis.bmr).match(/\d+/);
    bmr = bmrMatch ? parseInt(bmrMatch[0]) : null;
  }
  
  // If no valid BMR from analysis, calculate it
  if (!bmr) {
    bmr = calculateBMR(data);
  }
  
  // Parse recommended calories from analysis or calculate from TDEE
  let recommendedCalories;
  if (analysis.recommendedCalories) {
    // Try to extract numeric value from analysis.recommendedCalories
    const caloriesMatch = String(analysis.recommendedCalories).match(/\d+/);
    recommendedCalories = caloriesMatch ? parseInt(caloriesMatch[0]) : null;
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

=== ПЪЛНА СТРАТЕГИЯ ===
${JSON.stringify(strategy, null, 2)}
${modificationsSection}

=== АРХИТЕКТУРА НА ХРАНЕНЕТО ===
Категории: [PRO]=Белтък (животински: месо, риба, яйца, млечни; растителен: тофу, темпе; бобови: леща, боб, нахут), [ENG]=Енергия/въглехидрати (зърнени: ориз, киноа, елда, овес, паста, хляб; кореноплодни: картофи; плодове), [VOL]=Зеленчуци/фибри (листни салати, краставици, домати, броколи, тиквички, чушки, гъби, карфиол, патладжан), [FAT]=Мазнини (зехтин, масло, авокадо, ядки, семена, тахан, маслини), [CMPX]=Сложни ястия (пица, лазаня, мусака, баница, бургер, врап, ризото, паеля).

Шаблони за ястия: A) РАЗДЕЛЕНА ЧИНИЯ=[PRO]+[ENG]+[VOL] (печено пиле+картофи+салата), B) СМЕСЕНО=[PRO]+[ENG]+[VOL] микс (яхнии, купи), C) ЛЕКО/САНДВИЧ=[ENG-хляб]+[PRO]+[FAT]+[VOL] (сандвич, тост), D) ЕДИНЕН БЛОК=[CMPX]+[VOL] (лазаня+салата). 

Филтриране според МОДИФИКАТОР "${dietaryModifier}": Веган=без животински [PRO]; Кето/Нисковъглехидратно=минимум [ENG], повече [PRO]+[FAT]; Без глутен=[ENG] само ориз/картофи/киноа/елда; Палео=без зърнени/бобови/млечни; Щадящ стомах=готвени [VOL], без сурови влакнини. Избор на шаблон: закуска=C или A, обяд=A или B, вечеря=A/B/D. Слотове с продукти от филтриран списък. Избягвай: ${data.dietDislike || 'няма'}. Включвай: ${data.dietLove || 'няма'}. Естествен български език БЕЗ кодове в изхода.

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

JSON ФОРМАТ:
{
  "summary": {"bmr": "${bmr}", "dailyCalories": "${recommendedCalories}", "macros": {"protein": "Xg", "carbs": "Xg", "fats": "Xg"}},
  "weekPlan": {"day1": {"meals": [{"type": "Закуска/Обяд/Вечеря", "name": "име", "weight": "Xg", "description": "описание", "benefits": "ползи за ${data.name}", "calories": X, "macros": {"protein": X, "carbs": X, "fats": X, "fiber": X}}]}, ... "day7": {...}},
  "recommendations": ["храна 1", "храна 2", "храна 3", "храна 4", "храна 5+"],
  "forbidden": ["храна 1", "храна 2", "храна 3", "храна 4+"],
  "psychology": ${strategy.psychologicalSupport ? JSON.stringify(strategy.psychologicalSupport) : '["съвет 1", "съвет 2", "съвет 3"]'},
  "waterIntake": "${strategy.hydrationStrategy || 'препоръки за вода'}",
  "supplements": ${strategy.supplementRecommendations ? JSON.stringify(strategy.supplementRecommendations) : '["добавка 1 с дозировка", "добавка 2 с дозировка", "добавка 3 с дозировка"]'}
}

ВАЖНО: "recommendations"/"forbidden"=САМО конкретни храни (НЕ общи съвети). Всички 7 дни (day1-day7) с 2-4 хранения. Точни калории/макроси за всяко ястие. Общо ${recommendedCalories} kcal/ден средно. Калориите прецизно изчислени (1г протеин=4kcal, 1г въглехидрати=4kcal, 1г мазнини=9kcal). Седмичен подход: МИСЛИ СЕДМИЧНО - ЦЯЛОСТНА схема като система. Броят хранения варира според ЦЕЛТА, ХРОНОТИПА, ПРЕДПОЧИТАНИЯТА на ${data.name}. Интермитентно гладуване 16:8/18:6 позволено. БАЛАНСИРАЙ седмицата - ако един ден е с по-малко калории, друг компенсира. АДАПТИРАЙ към хронотип. ВСИЧКИ 7 дни (day1-day7) ЗАДЪЛЖИТЕЛНО.

Създай пълния 7-дневен план с балансирани, индивидуални ястия за ${data.name}.`;
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

Създай пълни 7 дни (day1 до day7) с по 3-4 хранения на ден. Всяко хранене трябва да е УНИКАЛНО, балансирано и строго съобразено с индивидуалните нужди, предпочитания и здравословно състояние на клиента.`;
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
 * Generate chat prompt with full context
 */
async function generateChatPrompt(env, userMessage, userData, userPlan, conversationHistory, mode = 'consultation') {
  // Base context that's always included
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
 * Call AI model (placeholder for Gemini or OpenAI)
 */
async function callAIModel(env, prompt, maxTokens = null) {
  // Estimate input token count (rough approximation for Cyrillic/Latin mix)
  // This is sufficient for identifying extremely large prompts that may cause issues
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  console.log(`AI Request: estimated input tokens: ${estimatedInputTokens}, max output tokens: ${maxTokens || 'default'}`);
  
  // Warn if input prompt is very large (potential issue with Gemini)
  if (estimatedInputTokens > 8000) {
    console.warn(`⚠️ Large input prompt detected: ~${estimatedInputTokens} tokens. This may exceed API limits for some models.`);
  }
  
  // Get admin config with caching (reduces KV reads from 2 to 0 when cached)
  const config = await getAdminConfig(env);
  const preferredProvider = config.provider;
  const modelName = config.modelName;

  // If mock is selected, return mock response
  if (preferredProvider === 'mock') {
    console.warn('Mock mode selected. Returning mock response.');
    return generateMockResponse(prompt);
  }

  // Try preferred provider first
  if (preferredProvider === 'openai' && env.OPENAI_API_KEY) {
    return await callOpenAI(env, prompt, modelName, maxTokens);
  } else if (preferredProvider === 'google' && env.GEMINI_API_KEY) {
    return await callGemini(env, prompt, modelName, maxTokens);
  }
  
  // Fallback to any available API key
  if (env.OPENAI_API_KEY) {
    return await callOpenAI(env, prompt, modelName, maxTokens);
  } else if (env.GEMINI_API_KEY) {
    return await callGemini(env, prompt, modelName, maxTokens);
  } else {
    // Return mock response for development
    console.warn('No AI API key configured. Returning mock response.');
    return generateMockResponse(prompt);
  }
}

/**
 * Call OpenAI API
 */
async function callOpenAI(env, prompt, modelName = 'gpt-4o-mini', maxTokens = null) {
  try {
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
  } catch (error) {
    console.error('OpenAI API call failed:', error);
    throw new Error(`OpenAI API failed: ${error.message}`);
  }
}

/**
 * Call Gemini API
 */
async function callGemini(env, prompt, modelName = 'gemini-pro', maxTokens = null) {
  try {
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
              name: "Пълнозърнести макарони с пуешко",
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
        "Чисто месо (пилешко, пуешко)",
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
 */
function parseAIResponse(response) {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    // If no JSON found, return the response as-is wrapped in a structure
    return { error: 'Could not parse AI response', raw: response };
  } catch (error) {
    console.error('Error parsing AI response:', error);
    return { error: 'Failed to parse response', raw: response };
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
 * Admin: Save AI prompt to KV
 */
async function handleSavePrompt(request, env) {
  try {
    const { type, prompt } = await request.json();
    
    if (!type || !prompt) {
      return jsonResponse({ error: 'Missing type or prompt' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    let key;
    if (type === 'consultation') {
      key = 'admin_consultation_prompt';
    } else if (type === 'modification') {
      key = 'admin_modification_prompt';
    } else if (type === 'chat') {
      key = 'admin_chat_prompt'; // Keep for backward compatibility
    } else {
      key = 'admin_plan_prompt';
    }
    
    await env.page_content.put(key, prompt);
    
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

    const key = type === 'chat' ? 'admin_chat_prompt' : 'admin_plan_prompt';
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
    const [provider, modelName, planPrompt, chatPrompt, consultationPrompt, modificationPrompt] = await Promise.all([
      env.page_content.get('admin_ai_provider'),
      env.page_content.get('admin_ai_model_name'),
      env.page_content.get('admin_plan_prompt'),
      env.page_content.get('admin_chat_prompt'),
      env.page_content.get('admin_consultation_prompt'),
      env.page_content.get('admin_modification_prompt')
    ]);
    
    return jsonResponse({ 
      success: true, 
      provider: provider || 'openai',
      modelName: modelName || 'gpt-4o-mini',
      planPrompt,
      chatPrompt,
      consultationPrompt,
      modificationPrompt
    });
  } catch (error) {
    console.error('Error getting config:', error);
    return jsonResponse({ error: 'Failed to get config: ' + error.message }, 500);
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
