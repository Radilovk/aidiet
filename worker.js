/**
 * Cloudflare Worker for AI Diet Application
 * Backend endpoint: https://aidiet.radilov-k.workers.dev/
 */

// Constants for nutrition calculations
const DEFAULT_BMR = 1650;
const DEFAULT_DAILY_CALORIES = 1800;

// Error messages
// Bulgarian error message shown when REGENERATE_PLAN parsing fails and no clean response text remains
const ERROR_MESSAGE_PARSE_FAILURE = 'Имаше проблем с обработката на отговора. Моля опитайте отново.';

// Plan modification descriptions for AI prompts
const PLAN_MODIFICATION_DESCRIPTIONS = {
  'no_intermediate_meals': '- БЕЗ междинни хранения/закуски - само основни хранения (закуска, обяд, вечеря)',
  '3_meals_per_day': '- Точно 3 хранения на ден (закуска, обяд, вечеря)',
  '4_meals_per_day': '- 4 хранения на ден (закуска, обяд, следобедна закуска, вечеря)',
  'vegetarian': '- ВЕГЕТАРИАНСКО хранене - без месо и риба',
  'no_dairy': '- БЕЗ млечни продукти',
  'low_carb': '- Нисковъглехидратна диета',
  'increase_protein': '- Повишен прием на протеини'
};

/**
 * Calculate BMR using Mifflin-St Jeor Equation
 * Men: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) + 5
 * Women: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age(y) - 161
 */
function calculateBMR(data) {
  if (!data.weight || !data.height || !data.age || !data.gender) {
    return DEFAULT_BMR;
  }
  
  const weight = parseFloat(data.weight);
  const height = parseFloat(data.height);
  const age = parseFloat(data.age);
  
  let bmr = 10 * weight + 6.25 * height - 5 * age;
  
  if (data.gender === 'Мъж') {
    bmr += 5;
  } else if (data.gender === 'Жена') {
    bmr -= 161;
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

// CORS headers for client-side requests
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
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
      } else if (url.pathname === '/api/get-plan' && request.method === 'GET') {
        return await handleGetPlan(request, env);
      } else if (url.pathname === '/api/update-plan' && request.method === 'POST') {
        return await handleUpdatePlan(request, env);
      } else if (url.pathname === '/api/admin/save-prompt' && request.method === 'POST') {
        return await handleSavePrompt(request, env);
      } else if (url.pathname === '/api/admin/get-prompt' && request.method === 'GET') {
        return await handleGetPrompt(request, env);
      } else if (url.pathname === '/api/admin/save-model' && request.method === 'POST') {
        return await handleSaveModel(request, env);
      } else if (url.pathname === '/api/admin/get-config' && request.method === 'GET') {
        return await handleGetConfig(request, env);
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
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    // Generate unique user ID (could be email or session-based)
    const userId = data.email || generateUserId(data);
    console.log('handleGeneratePlan: Request received for userId:', userId);
    
    // Check for force regeneration flag (e.g., from profile update)
    const forceRegenerate = data.forceRegenerate === true;
    
    // Check if plan exists in cache (skip if forceRegenerate is true)
    if (!forceRegenerate) {
      const cachedPlan = await getCachedPlan(env, userId);
      if (cachedPlan) {
        console.log('handleGeneratePlan: Returning cached plan for user:', userId);
        return jsonResponse({ 
          success: true, 
          plan: cachedPlan,
          cached: true,
          userId: userId 
        });
      }
    } else {
      console.log('handleGeneratePlan: Force regenerate requested - clearing all cached data for userId:', userId);
      // Clear ALL cached data (plan, user data, conversation history) before regenerating
      await clearUserCache(env, userId);
    }

    console.log('handleGeneratePlan: Generating new plan with multi-step approach for userId:', userId);
    
    // Use multi-step approach for better individualization
    const structuredPlan = await generatePlanMultiStep(env, data);
    console.log('handleGeneratePlan: Plan structured for userId:', userId);
    
    // Cache the plan and user data
    await cachePlan(env, userId, structuredPlan);
    await cacheUserData(env, userId, data);
    console.log('handleGeneratePlan: Plan cached for userId:', userId);
    
    return jsonResponse({ 
      success: true, 
      plan: structuredPlan,
      cached: false,
      userId: userId 
    });
  } catch (error) {
    console.error('Error generating plan:', error);
    return jsonResponse({ error: 'Failed to generate plan: ' + error.message }, 500);
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
 */
async function handleChat(request, env) {
  try {
    const { message, userId, conversationId, mode } = await request.json();
    
    if (!message || !userId) {
      return jsonResponse({ error: 'Missing message or userId' }, 400);
    }

    // Get user context from cache
    const userData = await getCachedUserData(env, userId);
    const userPlan = await getCachedPlan(env, userId);
    
    if (!userData || !userPlan) {
      return jsonResponse({ 
        error: 'User data not found. Please complete the questionnaire first.' 
      }, 404);
    }

    // Get conversation history
    const conversationKey = `chat_${userId}_${conversationId || 'default'}`;
    const conversationHistory = await getConversationHistory(env, conversationKey);
    
    // Determine chat mode (default: consultation)
    const chatMode = mode || 'consultation';
    
    // Build chat prompt with context and mode
    const chatPrompt = await generateChatPrompt(env, message, userData, userPlan, conversationHistory, chatMode);
    
    // Call AI model with standard token limit (no need for large JSONs with new regeneration approach)
    const aiResponse = await callAIModel(env, chatPrompt, 2000);
    
    // Check if the response contains a plan regeneration instruction
    const regenerateIndex = aiResponse.indexOf('[REGENERATE_PLAN:');
    let finalResponse = aiResponse;
    let planWasUpdated = false;
    
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
            
            // Clear conversation history before regenerating plan to avoid cross-contamination
            console.log('Clearing conversation history before plan regeneration');
            await env.page_content.delete(conversationKey);
            
            // Regenerate the plan using multi-step approach with new criteria
            const newPlan = await generatePlanMultiStep(env, modifiedUserData);
            
            // Cache the updated plan and user data
            await cachePlan(env, userId, newPlan);
            await cacheUserData(env, userId, modifiedUserData);
            planWasUpdated = true;
            
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
    
    // Update conversation history with the final (cleaned) response
    await updateConversationHistory(env, conversationKey, message, finalResponse);
    
    return jsonResponse({ 
      success: true, 
      response: finalResponse,
      planUpdated: planWasUpdated
    });
  } catch (error) {
    console.error('Error in chat:', error);
    return jsonResponse({ error: 'Chat failed: ' + error.message }, 500);
  }
}

/**
 * Get cached plan for a user
 */
async function handleGetPlan(request, env) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  
  if (!userId) {
    return jsonResponse({ error: 'Missing userId' }, 400);
  }

  const cachedPlan = await getCachedPlan(env, userId);
  
  if (!cachedPlan) {
    return jsonResponse({ error: 'Plan not found' }, 404);
  }

  return jsonResponse({ 
    success: true, 
    plan: cachedPlan 
  });
}

/**
 * Update plan for a user (after AI assistant approval)
 */
async function handleUpdatePlan(request, env) {
  try {
    const { userId, updatedPlan, changeReason } = await request.json();
    
    if (!userId || !updatedPlan) {
      return jsonResponse({ error: 'Missing userId or updatedPlan' }, 400);
    }

    // Get existing plan
    const existingPlan = await getCachedPlan(env, userId);
    
    if (!existingPlan) {
      return jsonResponse({ error: 'Plan not found' }, 404);
    }

    // Merge the updated plan with existing plan
    const mergedPlan = {
      ...existingPlan,
      ...updatedPlan,
      lastModified: new Date().toISOString(),
      modificationReason: changeReason || 'User requested change'
    };

    // Cache the updated plan
    await cachePlan(env, userId, mergedPlan);
    
    return jsonResponse({ 
      success: true, 
      plan: mergedPlan,
      message: 'Plan updated successfully'
    });
  } catch (error) {
    console.error('Error updating plan:', error);
    return jsonResponse({ error: 'Failed to update plan: ' + error.message }, 500);
  }
}

/**
 * Multi-step plan generation for better individualization
 * Step 1: Analyze user profile and health status
 * Step 2: Determine dietary strategy and restrictions
 * Step 3: Generate detailed meal plan
 */
async function generatePlanMultiStep(env, data) {
  console.log('Multi-step generation: Starting');
  
  try {
    // Step 1: Analyze user profile
    const analysisPrompt = generateAnalysisPrompt(data);
    const analysisResponse = await callAIModel(env, analysisPrompt);
    const analysis = parseAIResponse(analysisResponse);
    
    if (!analysis || analysis.error) {
      throw new Error('Failed to parse analysis response');
    }
    console.log('Multi-step generation: Analysis complete');
    
    // Step 2: Generate dietary strategy based on analysis
    const strategyPrompt = generateStrategyPrompt(data, analysis);
    const strategyResponse = await callAIModel(env, strategyPrompt);
    const strategy = parseAIResponse(strategyResponse);
    
    if (!strategy || strategy.error) {
      throw new Error('Failed to parse strategy response');
    }
    console.log('Multi-step generation: Strategy complete');
    
    // Step 3: Generate detailed meal plan
    const mealPlanPrompt = generateMealPlanPrompt(data, analysis, strategy);
    const mealPlanResponse = await callAIModel(env, mealPlanPrompt);
    const mealPlan = parseAIResponse(mealPlanResponse);
    
    if (!mealPlan || mealPlan.error) {
      throw new Error('Failed to parse meal plan response');
    }
    console.log('Multi-step generation: Meal plan complete');
    
    // Combine all parts into final plan (meal plan takes precedence)
    return {
      ...mealPlan,
      analysis: analysis,
      strategy: strategy
    };
  } catch (error) {
    console.error('Multi-step generation failed:', error);
    // Fall back to single-step generation if multi-step fails
    console.log('Falling back to single-step generation');
    const prompt = await generateNutritionPrompt(data, env);
    const response = await callAIModel(env, prompt);
    return parseAIResponse(response);
  }
}

/**
 * Step 1: Generate prompt for user profile analysis
 */
function generateAnalysisPrompt(data) {
  return `Ти си опитен диетолог и ендокринолог с ДЪЛБОКИ познания за КОРЕЛАЦИИ между различни здравословни параметри. Направи ЗАДЪЛБОЧЕН ХОЛИСТИЧЕН АНАЛИЗ на този клиент:

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

ИЗИСКВАНИЯ ЗА АНАЛИЗ:
1. Анализирай КОРЕЛАЦИИТЕ между сън, стрес и хранителни желания
2. Определи как медицинските състояния влияят на хранителните нужди
3. Разбери ПСИХОЛОГИЧЕСКИЯ профил - връзката между емоции и хранене
4. Идентифицирай МЕТАБОЛИТНИ особености базирани на всички параметри
5. Прецени как хронотипът влияе на храносмилането и енергията
6. Определи СПЕЦИФИЧНИТЕ нужди от макронутриенти въз основа на целите, активност и медицински състояния
7. Създай ИНДИВИДУАЛИЗИРАН подход, който отчита ВСИЧКИ фактори заедно

Върни JSON с ДЕТАЙЛЕН анализ:
{
  "bmr": "изчислена базова метаболитна скорост с обяснение",
  "tdee": "общ дневен разход на енергия с детайли",
  "recommendedCalories": "препоръчителен калориен прием БАЗИРАН НА ЦЯЛОСТНИЯ АНАЛИЗ",
  "macroRatios": {
    "protein": "препоръчителен процент протеини С ОБОСНОВКА",
    "carbs": "препоръчителен процент въглехидрати С ОБОСНОВКА",
    "fats": "препоръчителен процент мазнини С ОБОСНОВКА"
  },
  "metabolicProfile": "ЗАДЪЛБОЧЕНО описание на метаболитния профил и корелации",
  "healthRisks": ["специфичен риск 1 с обяснение", "специфичен риск 2 с обяснение"],
  "nutritionalNeeds": ["специфична нужда 1 базирана на профила", "специфична нужда 2 базирана на профила"],
  "psychologicalProfile": "ДЕТАЙЛЕН анализ на психологическите фактори, емоционалното хранене и корелации със стрес, сън и поведение"
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

Анализирай ЗАДЪЛБОЧЕНО как всеки параметър влияе и взаимодейства с другите.

Върни JSON със стратегия:
{
  "dietType": "тип диета (напр. средиземноморска, балансирана, ниско-въглехидратна)",
  "mealTiming": {
    "breakfast": "оптимално време за закуска",
    "lunch": "оптимално време за обяд",
    "dinner": "оптимално време за вечеря",
    "snacks": "брой и време на междинни хранения"
  },
  "keyPrinciples": ["принцип 1", "принцип 2", "принцип 3"],
  "foodsToInclude": ["храна 1", "храна 2", "храна 3"],
  "foodsToAvoid": ["храна 1", "храна 2", "храна 3"],
  "supplementRecommendations": ["! добавка 1", "! добавка 2", "! добавка 3"],
  "hydrationStrategy": "препоръки за прием на течности",
  "psychologicalSupport": ["! психологически съвет 1", "! психологически съвет 2", "! психологически съвет 3"]
}`;
}

/**
 * Step 3: Generate prompt for detailed meal plan
 */
function generateMealPlanPrompt(data, analysis, strategy) {
  // Use analysis values or calculate from user data
  let bmr = analysis.bmr || calculateBMR(data);
  let recommendedCalories = analysis.recommendedCalories;
  
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
  
  return `Създай подробен 7-дневен хранителен план, базиран на анализа и стратегията:

КЛИЕНТ: ${data.name}
ЦЕЛИ: Калории: ${recommendedCalories} kcal/ден, ${data.goal}

СТРАТЕГИЯ:
${JSON.stringify(strategy, null, 2)}
${modificationsSection}
ВАЖНИ НАСОКИ:
1. Използвай САМО храни, които клиентът обича или няма непоносимост към
2. Избягвай: ${data.dietDislike || 'няма'}
3. Включвай любимите храни: ${data.dietLove || 'няма'}, но в здравословен контекст
4. Спазвай медицинските ограничения: ${JSON.stringify(data.medicalConditions || [])}
5. Използвай РАЗНООБРАЗНИ храни - избягвай повторения на едни и същи ястия
6. Всички ястия трябва да бъдат реалистични и лесни за приготвяне
7. Използвай български и средиземноморски продукти
8. Адаптирай времето на хранене към хронотипа: ${data.chronotype}
9. Всяко ястие да е балансирано и подходящо за целта ${data.goal}

ВАЖНО - ИЗБЯГВАЙ:
- Странни комбинации от храни (напр. чийзкейк със салата, пица с тофу)
- Екзотични продукти, които са трудно достъпни в България
- Повтаряне на едни и същи храни в различни дни
- Комбинации, които не са традиционни за българската/средиземноморска кухня

Върни JSON формат:
{
  "summary": {
    "bmr": "${bmr}",
    "dailyCalories": "${recommendedCalories}",
    "macros": {
      "protein": "грамове протеин",
      "carbs": "грамове въглехидрати",
      "fats": "грамове мазнини"
    }
  },
  "weekPlan": {
    "day1": {
      "meals": [
        {
          "type": "Закуска",
          "time": "${strategy.mealTiming?.breakfast || '08:00'}",
          "name": "име на реалистично и вкусно българско/средиземноморско ястие",
          "weight": "точно тегло в грамове",
          "description": "кратко описание на ястието и съставки",
          "benefits": "конкретни ползи за здравето",
          "calories": "точни калории"
        }
      ]
    }
  },
  "recommendations": ["конкретна препоръка 1", "конкретна препоръка 2"],
  "forbidden": ["конкретна забранена храна 1", "конкретна забранена храна 2"],
  "psychology": ${strategy.psychologicalSupport ? JSON.stringify(strategy.psychologicalSupport) : '["психологически съвет 1", "психологически съвет 2", "психологически съвет 3"]'},
  "waterIntake": "${strategy.hydrationStrategy || 'препоръки за вода'}",
  "supplements": ${strategy.supplementRecommendations ? JSON.stringify(strategy.supplementRecommendations) : '["добавка 1 с дозировка", "добавка 2 с дозировка", "добавка 3 с дозировка"]'}
}

ВАЖНО ЗА ФОРМАТИРАНЕ:
- "psychology" ТРЯБВА да е масив с ТОЧНО 3 елемента (като recommendations и forbidden)
- "supplements" ТРЯБВА да е масив с ТОЧНО 3 елемента (като recommendations и forbidden)
- Всеки елемент е просто текст без специални префикси

Пример за правилен формат:
"psychology": [
  "Не се обвинявайте при грешка - един лош ден не разваля прогреса",
  "Слушайте сигналите на тялото си за глад и ситост", 
  "Водете дневник на емоциите при хранене за по-добро самоосъзнаване"
],
"supplements": [
  "Витамин D3 - 2000 IU дневно, сутрин с храна",
  "Омега-3 мастни киселини - 1000mg дневно",
  "Магнезий - 200mg вечер преди лягане"
]

Създай пълни 7 дни (day1 до day7) с по 3-4 хранения на ден. Всяко хранене трябва да е уникално, балансирано и подходящо за целите на клиента.`;
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
- Психологическите съвети и хранителните добавки трябва да са СПЕЦИФИЧНИ за този клиент

СТРОГО ЗАБРАНЕНО:
- Странни комбинации от храни (напр. чийзкейк със салата)
- Екзотични продукти, трудно достъпни в България
- Повтаряне на едни и същи храни в различни дни
- Комбинации, нетипични за българската/средиземноморска кухня
- Храни от списъка с непоносимости

Моля, върни отговора в следния JSON формат:

{
  "summary": {
    "bmr": "базова метаболитна скорост в калории",
    "dailyCalories": "препоръчителен дневен прием калории",
    "macros": {
      "protein": "протеин в грамове",
      "carbs": "въглехидрати в грамове", 
      "fats": "мазнини в грамове"
    }
  },
  "weekPlan": {
    "day1": {
      "meals": [
        {
          "type": "Закуска",
          "time": "08:00",
          "name": "Име на реалистично българско/средиземноморско ястие",
          "weight": "250g",
          "description": "Детайлно описание на ястието и съставки",
          "benefits": "Конкретни ползи за здравето на клиента",
          "calories": 350
        }
      ]
    }
  },
  "recommendations": ["конкретна препоръка 1", "конкретна препоръка 2"],
  "forbidden": ["конкретна забранена храна 1", "конкретна забранена храна 2"],
  "psychology": ["психологически съвет 1 базиран на емоционалното хранене", "психологически съвет 2 базиран на поведението", "психологически съвет 3 за мотивация"],
  "waterIntake": "Детайлен препоръчителен прием на вода",
  "supplements": ["добавка 1 с дозировка и прием", "добавка 2 с дозировка и прием", "добавка 3 с дозировка и прием"]
}

КРИТИЧНО ВАЖНО ЗА ФОРМАТИРАНЕ:
1. "psychology" ТРЯБВА да е масив с ТОЧНО 3 елемента (като "recommendations" и "forbidden")
2. "supplements" ТРЯБВА да е масив с ТОЧНО 3 елемента (като "recommendations" и "forbidden")
3. Всеки елемент е просто текст БЕЗ специални префикси
4. Елементите трябва да бъдат конкретни и специфични за клиента

Пример за ПРАВИЛЕН формат:
"psychology": [
  "Не се обвинявайте при грешка - един лош ден не разваля прогреса",
  "Слушайте сигналите на тялото си за глад и ситост вместо да се храните емоционално", 
  "Водете дневник на емоциите при хранене за по-добро самоосъзнаване"
],
"supplements": [
  "Витамин D3 - 2000 IU дневно, сутрин с храна за добро усвояване",
  "Омега-3 мастни киселини - 1000mg дневно за сърдечно здраве",
  "Магнезий - 200mg вечер преди лягане за по-добър сън"
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
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response format from OpenAI API');
    }
    
    return data.choices[0].message.content;
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
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || 
        !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
      throw new Error('Invalid response format from Gemini API');
    }
    
    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Gemini API call failed:', error);
    throw new Error(`Gemini API failed: ${error.message}`);
  }
}

/**
 * Generate mock response for development
 */
function generateMockResponse(prompt) {
  if (prompt.includes('7-дневен хранителен план')) {
    return JSON.stringify({
      summary: {
        bmr: String(DEFAULT_BMR),
        dailyCalories: String(DEFAULT_DAILY_CALORIES),
        macros: {
          protein: "120g",
          carbs: "180g",
          fats: "60g"
        }
      },
      weekPlan: {
        day1: {
          meals: [
            {
              type: "Закуска",
              time: "08:00",
              name: "Овесена каша с горски плодове",
              weight: "250g",
              description: "Богата на фибри. Бавните въглехидрати осигуряват енергия за целия ден.",
              benefits: "Подобрява храносмилането и контролира кръвната захар.",
              calories: 350
            },
            {
              type: "Обяд",
              time: "13:00",
              name: "Пилешка пържола на скара със салата",
              weight: "350g",
              description: "Високо съдържание на протеин с минимални мазнини.",
              benefits: "Подпомага мускулното възстановяване.",
              calories: 450
            },
            {
              type: "Вечеря",
              time: "19:30",
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
              time: "08:00",
              name: "Гръцко кисело мляко с мюсли",
              weight: "200g",
              description: "Протеини и пробиотици за добро храносмилане.",
              benefits: "Подпомага чревното здраве.",
              calories: 320
            },
            {
              type: "Обяд",
              time: "13:00",
              name: "Телешко със зеленчуци на тиган",
              weight: "350g",
              description: "Балансирано ястие с протеини и витамини.",
              benefits: "Осигурява енергия и минерали.",
              calories: 480
            },
            {
              type: "Вечеря",
              time: "19:30",
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
              time: "08:00",
              name: "Яйца на очи с авокадо",
              weight: "200g",
              description: "Здравословни мазнини и протеини.",
              benefits: "Дълготрайна енергия и ситост.",
              calories: 340
            },
            {
              type: "Обяд",
              time: "13:00",
              name: "Пилешка супа с киноа",
              weight: "400g",
              description: "Топла и питателна храна.",
              benefits: "Подпомага имунната система.",
              calories: 380
            },
            {
              type: "Вечеря",
              time: "19:30",
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
              time: "08:00",
              name: "Протеинов смути с банан",
              weight: "300ml",
              description: "Бърза и лесна закуска.",
              benefits: "Идеална за заети сутрини.",
              calories: 310
            },
            {
              type: "Обяд",
              time: "13:00",
              name: "Пуешки кюфтета с ориз",
              weight: "350g",
              description: "Постно месо с комплексни въглехидрати.",
              benefits: "Балансирано ястие за активни хора.",
              calories: 470
            },
            {
              type: "Вечеря",
              time: "19:30",
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
              time: "08:00",
              name: "Палачинки от овесени ядки",
              weight: "230g",
              description: "Здравословна алтернатива на класическите.",
              benefits: "Богати на фибри.",
              calories: 360
            },
            {
              type: "Обяд",
              time: "13:00",
              name: "Говежди шишчета с печени зеленчуци",
              weight: "370g",
              description: "Протеини и витамини от зеленчуците.",
              benefits: "Подпомага мускулния растеж.",
              calories: 490
            },
            {
              type: "Вечеря",
              time: "19:30",
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
              time: "08:00",
              name: "Тост с крема сирене и домати",
              weight: "220g",
              description: "Класическа и вкусна закуска.",
              benefits: "Баланс между протеини и въглехидрати.",
              calories: 330
            },
            {
              type: "Обяд",
              time: "13:00",
              name: "Паста с песто и пилешко",
              weight: "360g",
              description: "Средиземноморски вкус с протеини.",
              benefits: "Енергия за следобедието.",
              calories: 510
            },
            {
              type: "Вечеря",
              time: "19:30",
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
              time: "09:00",
              name: "Боул с гранола и плодове",
              weight: "260g",
              description: "Цветна и вкусна закуска.",
              benefits: "Антиоксиданти и витамини.",
              calories: 350
            },
            {
              type: "Обяд",
              time: "13:30",
              name: "Пиле по китайски с ориз",
              weight: "380g",
              description: "Екзотичен вкус с балансирани макроси.",
              benefits: "Разнообразие в менюто.",
              calories: 500
            },
            {
              type: "Вечеря",
              time: "19:30",
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

/**
 * Cache management functions using KV
 */
async function getCachedPlan(env, userId) {
  if (!env.page_content) return null;
  const cached = await env.page_content.get(`plan_${userId}`);
  return cached ? JSON.parse(cached) : null;
}

async function cachePlan(env, userId, plan) {
  if (!env.page_content) return;
  // Cache for 7 days
  await env.page_content.put(`plan_${userId}`, JSON.stringify(plan), {
    expirationTtl: 60 * 60 * 24 * 7
  });
}

async function getCachedUserData(env, userId) {
  if (!env.page_content) return null;
  const cached = await env.page_content.get(`user_${userId}`);
  return cached ? JSON.parse(cached) : null;
}

async function cacheUserData(env, userId, data) {
  if (!env.page_content) return;
  // Cache for 7 days
  await env.page_content.put(`user_${userId}`, JSON.stringify(data), {
    expirationTtl: 60 * 60 * 24 * 7
  });
}

/**
 * Clear all cached data for a user
 * This includes: plan, user data, and conversation history
 */
async function clearUserCache(env, userId) {
  if (!env.page_content) return;
  
  console.log(`Clearing all cached data for userId: ${userId}`);
  
  try {
    // Delete plan cache
    await env.page_content.delete(`plan_${userId}`);
    
    // Delete user data cache
    await env.page_content.delete(`user_${userId}`);
    
    // Delete conversation histories - we need to delete all possible conversation keys
    // Standard chat conversations
    await env.page_content.delete(`chat_${userId}_default`);
    await env.page_content.delete(`chat_${userId}_consultation`);
    await env.page_content.delete(`chat_${userId}_modification`);
    
    console.log(`Successfully cleared cache for userId: ${userId}`);
  } catch (error) {
    console.error(`Error clearing cache for userId ${userId}:`, error);
  }
}

async function getConversationHistory(env, conversationKey) {
  if (!env.page_content) return [];
  const cached = await env.page_content.get(conversationKey);
  return cached ? JSON.parse(cached) : [];
}

// Enhancement #3: Estimate tokens for a message
// Note: This is a rough approximation (~4 chars per token for mixed content).
// Actual GPT tokenization varies by language and content. This is sufficient
// for conversation history management where approximate limits are acceptable.
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

async function updateConversationHistory(env, conversationKey, userMessage, aiResponse) {
  if (!env.page_content) return;
  const history = await getConversationHistory(env, conversationKey);
  history.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: aiResponse }
  );
  
  // Enhancement #3: Keep conversation within token budget (approx 1500 tokens = 6000 chars)
  const MAX_HISTORY_TOKENS = 1500;
  let totalTokens = 0;
  const trimmedHistory = [];
  
  // Process history in reverse to keep most recent messages
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    const messageTokens = estimateTokens(message.content);
    
    if (totalTokens + messageTokens <= MAX_HISTORY_TOKENS) {
      trimmedHistory.unshift(message);
      totalTokens += messageTokens;
    } else {
      // Stop adding older messages
      break;
    }
  }
  
  console.log(`Conversation history trimmed to ${trimmedHistory.length} messages (~${totalTokens} tokens)`);
  
  // Cache for 24 hours
  await env.page_content.put(conversationKey, JSON.stringify(trimmedHistory), {
    expirationTtl: 60 * 60 * 24
  });
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
 * Helper to create JSON response
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}
