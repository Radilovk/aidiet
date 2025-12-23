/**
 * Cloudflare Worker for AI Diet Application
 * Backend endpoint: https://aidiet.radilov-k.workers.dev/
 */

// Constants for nutrition calculations
const DEFAULT_BMR = 1650;
const DEFAULT_DAILY_CALORIES = 1800;

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
 * Handle chat assistant requests
 */
async function handleChat(request, env) {
  try {
    const { message, userId, conversationId } = await request.json();
    
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
    
    // Build chat prompt with context
    const chatPrompt = generateChatPrompt(message, userData, userPlan, conversationHistory);
    
    // Call AI model
    const aiResponse = await callAIModel(env, chatPrompt);
    
    // Update conversation history
    await updateConversationHistory(env, conversationKey, message, aiResponse);
    
    return jsonResponse({ 
      success: true, 
      response: aiResponse 
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
function generateChatPrompt(userMessage, userData, userPlan, conversationHistory) {
  const context = `Ти си личен диетолог, психолог и здравен асистент за ${userData.name}.

КЛИЕНТСКИ ПРОФИЛ:
${JSON.stringify(userData, null, 2)}

ХРАНИТЕЛЕН ПЛАН:
${JSON.stringify(userPlan.summary || {}, null, 2)}

${conversationHistory.length > 0 ? `ИСТОРИЯ НА РАЗГОВОРА:\n${conversationHistory.map(h => `${h.role}: ${h.content}`).join('\n')}` : ''}

Отговори на въпроса на клиента като професионален диетолог, психолог и здравен консултант. Използвай информацията от неговия профил и план, за да дадеш персонализиран съвет. Бъди топъл, подкрепящ и мотивиращ.

КЛИЕНТ: ${userMessage}

АСИСТЕНТ:`;

  return context;
}

/**
 * Call AI model (placeholder for Gemini or OpenAI)
 */
async function callAIModel(env, prompt) {
  // Check admin preference for AI provider and model
  let preferredProvider = 'openai'; // default
  let modelName = 'gpt-4o-mini'; // default
  
  if (env.page_content) {
    const savedProvider = await env.page_content.get('admin_ai_provider');
    const savedModelName = await env.page_content.get('admin_ai_model_name');
    
    if (savedProvider) {
      preferredProvider = savedProvider;
    }
    if (savedModelName) {
      modelName = savedModelName;
    }
  }

  // If mock is selected, return mock response
  if (preferredProvider === 'mock') {
    console.warn('Mock mode selected. Returning mock response.');
    return generateMockResponse(prompt);
  }

  // Try preferred provider first
  if (preferredProvider === 'openai' && env.OPENAI_API_KEY) {
    return await callOpenAI(env, prompt, modelName);
  } else if (preferredProvider === 'google' && env.GEMINI_API_KEY) {
    return await callGemini(env, prompt, modelName);
  }
  
  // Fallback to any available API key
  if (env.OPENAI_API_KEY) {
    return await callOpenAI(env, prompt, modelName);
  } else if (env.GEMINI_API_KEY) {
    return await callGemini(env, prompt, modelName);
  } else {
    // Return mock response for development
    console.warn('No AI API key configured. Returning mock response.');
    return generateMockResponse(prompt);
  }
}

/**
 * Call OpenAI API
 */
async function callOpenAI(env, prompt, modelName = 'gpt-4o-mini') {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7
      })
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
async function callGemini(env, prompt, modelName = 'gemini-pro') {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
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

    await env.page_content.put('admin_ai_provider', provider);
    await env.page_content.put('admin_ai_model_name', modelName);
    
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

    const provider = await env.page_content.get('admin_ai_provider') || 'openai';
    const modelName = await env.page_content.get('admin_ai_model_name') || 'gpt-4o-mini';
    const planPrompt = await env.page_content.get('admin_plan_prompt');
    const chatPrompt = await env.page_content.get('admin_chat_prompt');
    
    return jsonResponse({ 
      success: true, 
      provider,
      modelName,
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
