/**
 * Cloudflare Worker for AI Diet Application
 * Backend endpoint: https://aidiet.radilov-k.workers.dev/
 */

// Constants for nutrition calculations
const DEFAULT_BMR = 1650;
const DEFAULT_DAILY_CALORIES = 1800;

// Error messages
// Bulgarian error message shown when UPDATE_PLAN parsing fails and no clean response text remains
const ERROR_MESSAGE_PARSE_FAILURE = 'Имаше проблем с обработката на отговора. Моля опитайте отново.';

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
    
    // Check if plan exists in cache
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
 * Helper function to clean a response by removing UPDATE_PLAN from a given index
 * Returns a fallback error message if the cleaned response is empty
 */
function cleanResponseFromUpdatePlan(aiResponse, updatePlanIndex) {
  const cleanedResponse = aiResponse.substring(0, updatePlanIndex).trim();
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
    const chatPrompt = generateChatPrompt(message, userData, userPlan, conversationHistory, chatMode);
    
    // Call AI model with increased token limit to accommodate plan updates (2000 tokens for full week plan updates)
    const aiResponse = await callAIModel(env, chatPrompt, 2000);
    
    // Check if the response contains a plan update instruction
    const updatePlanIndex = aiResponse.indexOf('[UPDATE_PLAN:');
    let finalResponse = aiResponse;
    let planWasUpdated = false;
    
    if (updatePlanIndex !== -1) {
      // Always parse and remove UPDATE_PLAN from the response, regardless of mode
      try {
        // Find the JSON content between [UPDATE_PLAN: and the matching closing ]
        const jsonStart = updatePlanIndex + '[UPDATE_PLAN:'.length;
        let jsonEnd = -1; // Will be set when we find the closing bracket
        let bracketCount = 0;
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        
        // Parse character by character to find where the JSON ends
        for (let i = jsonStart; i < aiResponse.length; i++) {
          const char = aiResponse[i];
          
          // Handle escape sequences in strings
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          // Track whether we're inside a string
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
              // If both counts are 0 before decrementing, this ] closes UPDATE_PLAN
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
          
          // Remove the UPDATE_PLAN instruction from the response (always, regardless of mode)
          const beforeUpdate = aiResponse.substring(0, updatePlanIndex);
          const afterUpdate = aiResponse.substring(jsonEnd + 1); // +1 to skip the closing ]
          finalResponse = (beforeUpdate + afterUpdate).trim();
          
          // Only actually apply the update if we're in modification mode
          if (chatMode === 'modification') {
            console.log('UPDATE_PLAN detected and parsed successfully (length:', jsonContent.length, 'chars)');
            
            const updateData = JSON.parse(jsonContent);
            
            // Update the plan in cache
            const updatedPlan = {
              ...userPlan,
              ...updateData,
              lastModified: new Date().toISOString(),
              modificationReason: 'User requested change via assistant'
            };
            await cachePlan(env, userId, updatedPlan);
            planWasUpdated = true;
            
            console.log('Plan updated successfully');
          } else {
            console.log('UPDATE_PLAN instruction removed from response (not in modification mode)');
          }
        } else {
          // Parsing failed - still try to remove the UPDATE_PLAN section
          console.error('Could not find closing bracket for UPDATE_PLAN');
          console.error('AI Response excerpt (last 500 chars):', aiResponse.substring(Math.max(0, aiResponse.length - 500)));
          // Remove everything from [UPDATE_PLAN: onwards to avoid showing broken JSON
          finalResponse = cleanResponseFromUpdatePlan(aiResponse, updatePlanIndex);
        }
      } catch (error) {
        // Error occurred - still try to remove the UPDATE_PLAN section
        console.error('Error parsing plan update:', error);
        console.error('Error details:', error.message);
        console.error('AI Response excerpt (last 500 chars):', aiResponse.substring(Math.max(0, aiResponse.length - 500)));
        // Remove everything from [UPDATE_PLAN: onwards to avoid showing broken JSON
        finalResponse = cleanResponseFromUpdatePlan(aiResponse, updatePlanIndex);
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
  return `Ти си опитен диетолог и ендокринолог. Анализирай здравословния профил на този клиент:

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

ХРАНИТЕЛНИ НАВИЦИ И ПОВЕДЕНИЕ:
- Прекомерно хранене: ${data.overeatingFrequency}
- Хранителни навици: ${JSON.stringify(data.eatingHabits || [])}
- Желания за храна: ${JSON.stringify(data.foodCravings || [])}
- Тригери за хранене: ${JSON.stringify(data.foodTriggers || [])}
- Методи за компенсация: ${JSON.stringify(data.compensationMethods || [])}
- Социално сравнение: ${data.socialComparison}

МЕДИЦИНСКИ СЪСТОЯНИЯ:
- Състояния: ${JSON.stringify(data.medicalConditions || [])}
- Лекарства: ${data.medications === 'Да' ? data.medicationsDetails : 'Не приема'}

ХРАНИТЕЛНА ИСТОРИЯ:
- Рязко покачване на тегло: ${data.weightChange === 'Да' ? data.weightChangeDetails : 'Не'}
- Диети в миналото: ${data.dietHistory === 'Да' ? `Тип: ${data.dietType}, Резултат: ${data.dietResult}` : 'Не'}

Върни JSON с анализ на:
{
  "bmr": "изчислена базова метаболитна скорост",
  "tdee": "общ дневен разход на енергия",
  "recommendedCalories": "препоръчителен калориен прием",
  "macroRatios": {
    "protein": "препоръчителен процент протеини",
    "carbs": "препоръчителен процент въглехидрати",
    "fats": "препоръчителен процент мазнини"
  },
  "metabolicProfile": "описание на метаболитния профил",
  "healthRisks": ["риск 1", "риск 2"],
  "nutritionalNeeds": ["нужда 1", "нужда 2"],
  "psychologicalProfile": "анализ на психологическите фактори и взаимоотношението с храната"
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
- Не обича/непоносимост: ${data.dietDislike || 'Няма'}
- Любими храни: ${data.dietLove || 'Няма'}

ВАЖНО: Вземи предвид:
1. Медицинските състояния и лекарства
2. Хранителните непоносимости и алергии
3. Личните предпочитания и любими храни
4. Хронотипа и дневния ритъм
5. Нивото на стрес и емоционалното хранене
6. Културния контекст (български традиции и налични продукти)

Върни JSON със стратегия:
{
  "dietType": "тип диета (напр. средиземноморска, балансирана, ниско-въглехидратна)",
  "mealTiming": {
    "breakfast": "оптимално време за закуска",
    "lunch": "оптимално време за обяд",
    "dinner": "оптимално време за вечеря",
    "snacks": "брой и време на снакове"
  },
  "keyPrinciples": ["принцип 1", "принцип 2", "принцип 3"],
  "foodsToInclude": ["храна 1", "храна 2", "храна 3"],
  "foodsToAvoid": ["храна 1", "храна 2", "храна 3"],
  "supplementRecommendations": ["добавка 1", "добавка 2"],
  "hydrationStrategy": "препоръки за прием на течности",
  "psychologicalSupport": "специфични психологически съвети базирани на профила"
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
  
  return `Създай подробен 7-дневен хранителен план, базиран на анализа и стратегията:

КЛИЕНТ: ${data.name}
ЦЕЛИ: Калории: ${recommendedCalories} kcal/ден, ${data.goal}

СТРАТЕГИЯ:
${JSON.stringify(strategy, null, 2)}

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
  "psychology": "${strategy.psychologicalSupport || 'психологически съвети'}",
  "waterIntake": "${strategy.hydrationStrategy || 'препоръки за вода'}",
  "supplements": "${JSON.stringify(strategy.supplementRecommendations || [])}"
}

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
4. Спазвай медицинските ограничения
5. Използвай РАЗНООБРАЗНИ храни - избягвай повторения
6. Всички ястия трябва да бъдат реалистични и лесни за приготвяне
7. Използвай български и средиземноморски продукти
8. Адаптирай времето на хранене към хронотипа
9. Всяко ястие да е балансирано и подходящо за целта

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
  "psychology": "Персонализирани психологически съвети базирани на емоционалното хранене и поведението на клиента",
  "waterIntake": "Детайлен препоръчителен прием на вода",
  "supplements": "Специфични препоръки за хранителни добавки базирани на здравословното състояние"
}

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
function generateChatPrompt(userMessage, userData, userPlan, conversationHistory, mode = 'consultation') {
  // Base context that's always included
  const baseContext = `Ти си личен диетолог, психолог и здравен асистент за ${userData.name}.

КЛИЕНТСКИ ПРОФИЛ:
${JSON.stringify(userData, null, 2)}

ПЪЛЕН ХРАНИТЕЛЕН ПЛАН:
${JSON.stringify(userPlan, null, 2)}

${conversationHistory.length > 0 ? `ИСТОРИЯ НА РАЗГОВОРА:\n${conversationHistory.map(h => `${h.role}: ${h.content}`).join('\n')}` : ''}
`;

  // Mode-specific instructions
  let modeInstructions = '';
  
  if (mode === 'consultation') {
    // Consultation mode: CANNOT modify the plan
    modeInstructions = `
ТЕКУЩ РЕЖИМ: КОНСУЛТАЦИЯ

ВАЖНИ ПРАВИЛА:
1. Ти си в режим на консултация. Можеш да четеш плана, но НЕ МОЖЕШ да го променяш.
2. Ако клиентът иска промяна в плана, обясни му че трябва да активира режима за промяна на плана
3. Кажи: "За да променя плана, моля активирай режима за промяна в интерфейса на чата."
4. Можеш да даваш съвети, да отговаряш на въпроси и да обясняваш плана
5. Бъди КРАТЪК и КОНКРЕТЕН в отговорите си (максимум 2-3 изречения)
6. Не давай дълги обяснения, освен ако не е необходимо
7. Винаги поддържай мотивиращ тон
8. НИКОГА не използвай [UPDATE_PLAN:...] инструкции в консултационен режим

Примери за правилни отговори в консултационен режим:
- "Закуската ти съдържа овесени ядки с банан (350 калории). За да я сменя, активирай режима за промяна на плана."
- "Можеш да замениш рибата с пилешко месо - и двете са отлични източници на протеин. За промяна, активирай режима за промяна на плана."
- "Количеството кашкавал в момента е 100г. Това е добро количество за твоята цел."
`;
  } else if (mode === 'modification') {
    // Modification mode: CAN modify the plan
    modeInstructions = `
ТЕКУЩ РЕЖИМ: ПРОМЯНА НА ПЛАНА

ВАЖНИ ПРАВИЛА ЗА ПРОМЕНИ В ПЛАНА:
1. Ти си в режим за промяна на плана. Можеш да четеш И да променяш плана.
2. Ако клиентът иска промяна в плана (замяна на храна, промяна на време на хранене, премахване на хранене, промяна на количество и т.н.):
   - Анализирай дали желанието е разумно и здравословно
   - Ако промяната е здравословна, ОДОБРИ Я и приложи промяната към плана
   - Ако промяната е нездравословна, обясни защо и предложи по-добра алтернатива
3. За да приложиш промяна в плана, добави към края на отговора си специална инструкция във формат:
   [UPDATE_PLAN:{"weekPlan":{"day1":{"meals":[...новите ястия за ден 1...]}}, "recommendations":[...], "forbidden":[...]}]
   
   ВАЖНО: Винаги включвай ЦЕЛИЯ масив meals за дните, които променяш, дори ако променяш само едно хранене!
   
   Примери:
   - Премахване на последното хранене от Ден 1: включи целия масив meals за day1 БЕЗ последното хранене
   - Замяна на закуската за Ден 2: включи целия масив meals за day2 с новата закуска
   - Промяна на ястия за няколко дни: включи целите масиви meals за всички променени дни
   - Промяна на препоръки: [UPDATE_PLAN:{"recommendations":[...новите препоръки...]}]
   
4. Структурата на meals за всеки ден е масив от обекти във формат:
   {
     "type": "Закуска/Обяд/Вечеря/Следобедна закуска/Междинно хранене",
     "time": "08:00",
     "name": "Име на ястието",
     "weight": "250g",
     "calories": 350,
     "description": "Описание",
     "benefits": "Ползи"
   }
   ВАЖНО: 
   - calories трябва да е число (без "kcal" текст)
   - weight използвай формат "250g" (предпочитан) или "250 гр." (приемлив)
   
5. Бъди КРАТЪК и КОНКРЕТЕН в отговорите си (максимум 2-3 изречения)
6. Не давай дълги обяснения, освен ако не е необходимо
7. Винаги поддържай мотивиращ тон
8. След като приложиш промяна, кажи на клиента "✓ Промяната е приложена!" и обясни кратко какво е променено
`;
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

async function getConversationHistory(env, conversationKey) {
  if (!env.page_content) return [];
  const cached = await env.page_content.get(conversationKey);
  return cached ? JSON.parse(cached) : [];
}

async function updateConversationHistory(env, conversationKey, userMessage, aiResponse) {
  if (!env.page_content) return;
  const history = await getConversationHistory(env, conversationKey);
  history.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: aiResponse }
  );
  // Keep last 20 messages
  const trimmed = history.slice(-20);
  // Cache for 24 hours
  await env.page_content.put(conversationKey, JSON.stringify(trimmed), {
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

    const key = type === 'chat' ? 'admin_chat_prompt' : 'admin_plan_prompt';
    await env.page_content.put(key, prompt);
    
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
    const [provider, modelName, planPrompt, chatPrompt] = await Promise.all([
      env.page_content.get('admin_ai_provider'),
      env.page_content.get('admin_ai_model_name'),
      env.page_content.get('admin_plan_prompt'),
      env.page_content.get('admin_chat_prompt')
    ]);
    
    return jsonResponse({ 
      success: true, 
      provider: provider || 'openai',
      modelName: modelName || 'gpt-4o-mini',
      planPrompt,
      chatPrompt
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
