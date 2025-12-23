/**
 * Cloudflare Worker for AI Diet Application
 * Backend endpoint: https://aidiet.radilov-k.workers.dev/
 */

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
 * Generate nutrition plan from questionnaire data
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

    console.log('handleGeneratePlan: Generating new plan for userId:', userId);
    // Generate prompt for AI model (check KV for custom prompt)
    const prompt = await generateNutritionPrompt(data, env);
    
    // Call AI model (placeholder - will be configured with Gemini or OpenAI)
    const aiResponse = await callAIModel(env, prompt);
    console.log('handleGeneratePlan: AI response received for userId:', userId);
    
    // Parse and structure the response
    const structuredPlan = parseAIResponse(aiResponse);
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
 * Generate nutrition plan prompt for AI
 */
async function generateNutritionPrompt(data, env) {
  // Try to get custom prompt from KV
  let promptTemplate = null;
  if (env.page_content) {
    promptTemplate = await env.page_content.get('admin_plan_prompt');
  }

  // Use default if no custom prompt
  if (!promptTemplate) {
    promptTemplate = `Ти си професионален диетолог и здравен консултант. Създай подробен 7-дневен хранителен план за клиент със следните характеристики:

ОСНОВНИ ДАННИ:
- Име: {name}
- Пол: {gender}
- Възраст: {age} години
- Ръст: {height} см
- Тегло: {weight} кг
- Цел: {goal}
{lossKg}

ЗДРАВОСЛОВЕН ПРОФИЛ:
- Сън: {sleepHours} часа
- Хронотип: {chronotype}
- Активност през деня: {dailyActivityLevel}
- Стрес: {stressLevel}
- Спортна активност: {sportActivity}

ХРАНИТЕЛНИ НАВИЦИ:
- Вода: {waterIntake}
- Прекомерно хранене: {overeatingFrequency}
- Хранителни навици: {eatingHabits}

ПРЕДПОЧИТАНИЯ:
- Диетични предпочитания: {dietPreference}
- Не обича/непоносимост: {dietDislike}
- Любими храни: {dietLove}

МЕДИЦИНСКИ СЪСТОЯНИЯ:
- Състояния: {medicalConditions}
- Лекарства: {medications}

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
          "name": "Име на ястието",
          "weight": "250g",
          "description": "Кратко описание",
          "benefits": "Ползи за здравето",
          "calories": 350
        }
      ]
    }
  },
  "recommendations": ["препоръка 1", "препоръка 2"],
  "forbidden": ["забранена храна 1", "забранена храна 2"],
  "psychology": "Психологически съвети и мотивация",
  "waterIntake": "Препоръчителен прием на вода",
  "supplements": "Препоръки за хранителни добавки"
}

Включи 3-5 хранения на ден за всеки от 7-те дни. Адаптирай плана към целите, предпочитанията и здравословното състояние на клиента.`;
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
    .replace(/{chronotype}/g, data.chronotype || '')
    .replace(/{dailyActivityLevel}/g, data.dailyActivityLevel || '')
    .replace(/{stressLevel}/g, data.stressLevel || '')
    .replace(/{sportActivity}/g, data.sportActivity || '')
    .replace(/{waterIntake}/g, data.waterIntake || '')
    .replace(/{overeatingFrequency}/g, data.overeatingFrequency || '')
    .replace(/{eatingHabits}/g, JSON.stringify(data.eatingHabits || []))
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
  // Check admin preference for AI model
  let preferredModel = 'openai'; // default
  if (env.page_content) {
    const savedModel = await env.page_content.get('admin_ai_model');
    if (savedModel) {
      preferredModel = savedModel;
    }
  }

  // If mock is selected, return mock response
  if (preferredModel === 'mock') {
    console.warn('Mock mode selected. Returning mock response.');
    return generateMockResponse(prompt);
  }

  // Try preferred model first
  if (preferredModel === 'openai' && env.OPENAI_API_KEY) {
    return await callOpenAI(env, prompt);
  } else if (preferredModel === 'gemini' && env.GEMINI_API_KEY) {
    return await callGemini(env, prompt);
  }
  
  // Fallback to any available API key
  if (env.OPENAI_API_KEY) {
    return await callOpenAI(env, prompt);
  } else if (env.GEMINI_API_KEY) {
    return await callGemini(env, prompt);
  } else {
    // Return mock response for development
    console.warn('No AI API key configured. Returning mock response.');
    return generateMockResponse(prompt);
  }
}

/**
 * Call OpenAI API
 */
async function callOpenAI(env, prompt) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
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
async function callGemini(env, prompt) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${env.GEMINI_API_KEY}`,
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
        bmr: "1650",
        dailyCalories: "1800",
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
    const { model } = await request.json();
    
    if (!model) {
      return jsonResponse({ error: 'Missing model' }, 400);
    }

    if (!['openai', 'gemini', 'mock'].includes(model)) {
      return jsonResponse({ error: 'Invalid model type' }, 400);
    }

    if (!env.page_content) {
      return jsonResponse({ error: 'KV storage not configured' }, 500);
    }

    await env.page_content.put('admin_ai_model', model);
    
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

    const model = await env.page_content.get('admin_ai_model') || 'openai';
    const planPrompt = await env.page_content.get('admin_plan_prompt');
    const chatPrompt = await env.page_content.get('admin_chat_prompt');
    
    return jsonResponse({ 
      success: true, 
      model,
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
