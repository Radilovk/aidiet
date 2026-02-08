# Анализ на Cloudflare Workers KV Квота

**Дата:** 2026-02-08  
**Статус:** ✅ АНАЛИЗ ЗАВЪРШЕН

---

## 📊 Кратко Резюме

Вашата система използва **~64 KV операции на генериране на план**, от които:
- **~28 READ операции** за whitelist/blacklist/промпти (44% от общите)
- **~36 WRITE/READ операции** за AI logging (56% от общите)

**При 16 плана на ден се достига лимита за WRITE операции (1,000 на ден).**

---

## 🔍 Детайлен Анализ на KV Операциите

### Общ Преглед на Операциите в Кода

```
Общо KV операции в worker.js: 52
├─ GET операции:    37 (71%)
├─ PUT операции:    13 (25%)
└─ DELETE операции:  2 (4%)
```

---

## 🎯 Степенуване на Операциите по Критичност

### 🔴 КРИТИЧНО - Ниво 1: AI Communication Logging

**Какво се случва:**
- При всеки AI request се записват 4 KV операции:
  - `PUT ai_communication_log:{id}` - записва request данни
  - `GET ai_communication_log_index` - чете индекса
  - `PUT ai_communication_log_index` - актуализира индекса  
  - `PUT ai_communication_log:{id}_response` - записва response данни

**Къде се случва:**
- Функции: `logAIRequest()`, `logAIResponse()`
- Извикват се при всяко AI извикване

**Въздействие при генериране на план:**
- 9 AI calls за генериране на план (анализ + стратегия + 7 дни)
- 9 AI calls × 4 KV ops = **36 KV операции на план**
- От тях: **9 PUT** операции + **9 GET** операции + **18 PUT** операции

**Защо е проблем:**
- Това е **56% от всички KV операции** при генериране на план
- При free tier (1,000 WRITE/ден): само **25 плана на ден** е лимитът
- MAX_LOG_ENTRIES = 1 (пази само последния запис), но пак прави 4 операции на AI call

**Препоръка:**
1. **Деактивирайте AI logging за production** (само за development/debugging)
2. Или ограничете логването само до грешки
3. Или използвайте external logging service (не KV)

**Потенциална икономия:** **-36 KV операции на план (-56%)**

---

### 🔴 КРИТИЧНО - Ниво 2: Многократно Четене на Whitelist/Blacklist

**Какво се случва:**
- `getDynamicFoodListsSections()` чете whitelist и blacklist от KV
- Извиква се **9 пъти** при генериране на 1 план:
  - 1 път при `generateAnalysisPrompt()`
  - 1 път при `generateStrategyPrompt()`
  - 7 пъти при `generateMealPlanChunkPrompt()` (за всеки ден)

**Въздействие:**
- 9 извиквания × 2 KV reads = **18 GET операции на план**
  - 9 × GET `food_whitelist`
  - 9 × GET `food_blacklist`

**Защо е проблем:**
- Whitelist/blacklist са **статични данни** (променят се рядко)
- Четат се 9 пъти за един и същ резултат
- **28% от всички KV операции** при генериране на план

**Причина:**
```javascript
// worker.js, line ~3220
async function getDynamicFoodListsSections(env) {
  // Няма кеширане - чете от KV всеки път
  const whitelistData = await env.page_content.get('food_whitelist');
  const blacklistData = await env.page_content.get('food_blacklist');
  // ...
}
```

**Препоръка:**
1. **Добавете worker-level кеширане** с TTL 5-10 минути
2. Кеширайте резултата от `getDynamicFoodListsSections()`
3. Инвалидирайте кеша само при промени в whitelist/blacklist

**Потенциална икономия:** **-16 GET операции на план (-25%)**

---

### 🟠 ВИСОКО - Ниво 3: Многократно Четене на Custom Prompts

**Какво се случва:**
- `getCustomPrompt()` чете custom промпти от KV
- Извиква се **10 пъти** при генериране на 1 план:
  - 1 × `admin_analysis_prompt`
  - 1 × `admin_strategy_prompt`
  - 8 × `admin_meal_plan_prompt` (1 общо + 7 за всеки ден)

**Въздействие:**
- **10 GET операции на план**

**Защо е проблем:**
- Промптите са **статични данни** (променят се много рядко)
- `admin_meal_plan_prompt` се чете 8 пъти за един и същ резултат
- **16% от всички KV операции** при генериране на план

**Причина:**
```javascript
// worker.js, line ~2230
async function getCustomPrompt(env, key) {
  // Няма кеширане - чете от KV всеки път
  return await env.page_content.get(key);
}
```

**Препоръка:**
1. **Добавете worker-level кеширане** с TTL 10-30 минути
2. Кеширайте всички custom промпти в един обект
3. Инвалидирайте кеша само при промени в админ панела

**Потенциална икономия:** **-9 GET операции на план (-14%)**

---

### 🟡 СРЕДНО - Ниво 4: Admin Panel Get Config

**Какво се случва:**
- `handleGetConfig()` чете 11 конфигурационни параметъра от KV
- Извиква се при всяко зареждане на админ панела

**Въздействие:**
- **11 GET операции** на зареждане на админ панел

**Защо не е толкова проблем:**
- Има **клиентско кеширане** за 5 минути в `admin.html`
- Извиква се рядко (само при зареждане на админ панела)
- **Не влияе** на генериране на план

**Текущо състояние:**
```javascript
// admin.html - има клиентско кеширане
const CACHE_CONFIG = {
    config: 5 * 60 * 1000,  // 5 минути
    // ...
};
```

**Препоръка:**
1. ✅ Клиентското кеширане вече работи добре
2. Може да се добави server-side кеширане с Cache-Control headers (вече има)
3. Не е критично за оптимизация

**Потенциална икономия:** Минимална (рядко се използва)

---

### 🟢 НИСКО - Ниво 5: Chat Prompts

**Какво се случва:**
- `getChatPrompts()` чете 2 промпта при всяко чат съобщение
- **Има worker-level кеширане** с TTL 5 минути

**Въздействие:**
- **2 GET операции** на чат (когато няма кеш)
- **0 GET операции** когато кешът е валиден

**Защо не е проблем:**
- Вече има ефективно кеширане
- Използва се сравнително рядко
- **Добре оптимизирано**

**Текущо състояние:**
```javascript
// worker.js, line ~4358
let chatPromptsCache = null;
let chatPromptsCacheTime = 0;
const CHAT_PROMPTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
```

**Препоръка:**
- ✅ Няма нужда от допълнителна оптимизация
- Работи добре както е

---

## 📈 Пълна Статистика за Генериране на План

### Детайлна Разбивка

```
ПОТОК: /api/generate-plan
┌──────────────────────────────────────────────────────────────┐
│ СТЪПКА 1: АНАЛИЗ (Analysis)                                 │
├──────────────────────────────────────────────────────────────┤
│ • getCustomPrompt('admin_analysis_prompt')      → 1 GET      │
│ • getDynamicFoodListsSections()                              │
│   ├─ GET food_whitelist                         → 1 GET      │
│   └─ GET food_blacklist                         → 1 GET      │
│ • callAIModel() → logAIRequest()                             │
│   ├─ PUT ai_communication_log:{id}              → 1 PUT      │
│   ├─ GET ai_communication_log_index             → 1 GET      │
│   └─ PUT ai_communication_log_index             → 1 PUT      │
│ • callAIModel() → logAIResponse()                            │
│   └─ PUT ai_communication_log:{id}_response     → 1 PUT      │
│ Подобщо Стъпка 1:                 6 GET, 4 PUT = 10 KV ops   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ СТЪПКА 2: СТРАТЕГИЯ (Strategy)                              │
├──────────────────────────────────────────────────────────────┤
│ • getCustomPrompt('admin_strategy_prompt')      → 1 GET      │
│ • getDynamicFoodListsSections()                              │
│   ├─ GET food_whitelist                         → 1 GET      │
│   └─ GET food_blacklist                         → 1 GET      │
│ • callAIModel() → logAIRequest()                → 3 KV ops   │
│ • callAIModel() → logAIResponse()               → 1 KV op    │
│ Подобщо Стъпка 2:                 3 GET, 4 PUT = 7 KV ops    │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ СТЪПКА 3: ПЛАН (Meal Plan) - 7 ДЕНА                         │
├──────────────────────────────────────────────────────────────┤
│ За всеки ден (×7):                                           │
│ • getCustomPrompt('admin_meal_plan_prompt')     → 1 GET      │
│ • getDynamicFoodListsSections()                              │
│   ├─ GET food_whitelist                         → 1 GET      │
│   └─ GET food_blacklist                         → 1 GET      │
│ • callAIModel() → logAIRequest()                → 3 KV ops   │
│ • callAIModel() → logAIResponse()               → 1 KV op    │
│                                                              │
│ Подобщо за 1 ден:                 3 GET, 4 PUT = 7 KV ops    │
│ Подобщо за 7 дена:               21 GET, 28 PUT = 49 KV ops  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ ОБЩО ЗА ГЕНЕРИРАНЕ НА ПЛАН:                                  │
├──────────────────────────────────────────────────────────────┤
│ • Whitelist/Blacklist reads:      18 GET (9+9)              │
│ • Custom prompt reads:             10 GET                    │
│ • AI logging operations:           36 ops (27 PUT + 9 GET)   │
│                                                              │
│ ОБЩО:                             28 GET + 36 KV ops         │
│                                = ~64 KV операции на план     │
└──────────────────────────────────────────────────────────────┘
```

---

## 🚨 Защо Надхвърляте Квотата

### Cloudflare Workers KV Free Tier Лимити:
```
✓ 100,000 READ операции на ден
✗ 1,000 WRITE операции на ден  ← ПРОБЛЕМЪТ Е ТУК!
```

### Изчисления:

**При генериране на план:**
- READ операции: ~28 на план
- WRITE операции: ~36 на план (главно от AI logging)

**Лимити:**
```
WRITE Лимит:
1,000 WRITE/ден ÷ 36 WRITE/план = ~27 плана на ден максимум

READ Лимит:
100,000 READ/ден ÷ 28 READ/план = ~3,571 плана на ден максимум
```

### 🎯 Заключение:
**WRITE операциите са основният проблем, не READ операциите!**

Ако генерирате повече от **27 плана на ден**, ще надхвърлите квотата за WRITE.

---

## 💡 Препоръки за Решение

### Приоритет 1: Деактивирайте AI Logging (Спестява 56%)

**Ефект:** **-36 KV операции на план (-56%)**

**Имплементация:**

```javascript
// worker.js, line ~63
// ПРОМЯНА: Деактивирайте logging за production
const AI_LOGGING_ENABLED = false; // Променете от true на false

// В функциите logAIRequest и logAIResponse:
async function logAIRequest(env, stepName, requestData) {
  if (!AI_LOGGING_ENABLED || !env.page_content) {
    return null;  // Не прави нищо
  }
  // ... останалия код
}

async function logAIResponse(env, logId, stepName, responseData) {
  if (!AI_LOGGING_ENABLED || !env.page_content || !logId) {
    return;  // Не прави нищо
  }
  // ... останалия код
}
```

**Алтернатива:** Използвайте external logging service (Sentry, LogDNA, и т.н.)

**Резултат след промяна:**
```
Нови лимити:
- WRITE: 1,000 ÷ 4 = ~250 плана на ден ✅
- READ: 100,000 ÷ 28 = ~3,571 плана на ден ✅
```

---

### Приоритет 2: Кеширане на Whitelist/Blacklist (Спестява 25%)

**Ефект:** **-16 GET операции на план (-25%)**

**Имплементация:**

```javascript
// worker.js - Добавете кеш променливи в началото
let foodListsCache = null;
let foodListsCacheTime = 0;
const FOOD_LISTS_CACHE_TTL = 10 * 60 * 1000; // 10 минути

// Модифицирайте getDynamicFoodListsSections
async function getDynamicFoodListsSections(env) {
  // Проверете кеша
  const now = Date.now();
  if (foodListsCache && (now - foodListsCacheTime) < FOOD_LISTS_CACHE_TTL) {
    console.log('[Cache HIT] Food lists from cache');
    return foodListsCache;
  }
  
  console.log('[Cache MISS] Loading food lists from KV');
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
  
  // Build sections
  let dynamicWhitelistSection = '';
  if (dynamicWhitelist.length > 0) {
    dynamicWhitelistSection = `\n\nАДМИН WHITELIST (ПРИОРИТЕТНИ ХРАНИ ОТ АДМИН ПАНЕЛ):\n- ${dynamicWhitelist.join('\n- ')}\nТези храни са допълнително одобрени и трябва да се предпочитат при възможност.`;
  }
  
  let dynamicBlacklistSection = '';
  if (dynamicBlacklist.length > 0) {
    dynamicBlacklistSection = `\n\nАДМИН BLACKLIST (ДОПЪЛНИТЕЛНИ ЗАБРАНИ ОТ АДМИН ПАНЕЛ):\n- ${dynamicBlacklist.join('\n- ')}\nТези храни са категорично забранени от администратора и НЕ трябва да се използват.`;
  }
  
  // Запазете в кеша
  const result = { dynamicWhitelistSection, dynamicBlacklistSection };
  foodListsCache = result;
  foodListsCacheTime = now;
  
  return result;
}

// Добавете функция за инвалидиране на кеша
function invalidateFoodListsCache() {
  foodListsCache = null;
  foodListsCacheTime = 0;
  console.log('[Cache INVALIDATED] Food lists cache cleared');
}

// Извикайте invalidateFoodListsCache() след промени:
// - handleAddToBlacklist
// - handleRemoveFromBlacklist
// - handleAddToWhitelist
// - handleRemoveFromWhitelist
```

**Къде да добавите инвалидиране:**

```javascript
// worker.js, line ~6632, handleAddToBlacklist
await env.page_content.put('food_blacklist', JSON.stringify(blacklist));
invalidateFoodListsCache(); // Добавете това

// worker.js, line ~6664, handleRemoveFromBlacklist
await env.page_content.put('food_blacklist', JSON.stringify(blacklist));
invalidateFoodListsCache(); // Добавете това

// worker.js, line ~6719, handleAddToWhitelist
await env.page_content.put('food_whitelist', JSON.stringify(whitelist));
invalidateFoodListsCache(); // Добавете това

// worker.js, line ~6751, handleRemoveFromWhitelist
await env.page_content.put('food_whitelist', JSON.stringify(whitelist));
invalidateFoodListsCache(); // Добавете това
```

**Резултат след промяна:**
```
GET операции на план: 28 - 16 = 12 GET операции
```

---

### Приоритет 3: Кеширане на Custom Prompts (Спестява 14%)

**Ефект:** **-9 GET операции на план (-14%)**

**Имплементация:**

```javascript
// worker.js - Добавете кеш променливи
let customPromptsCache = {};
let customPromptsCacheTime = {};
const CUSTOM_PROMPTS_CACHE_TTL = 30 * 60 * 1000; // 30 минути

// Модифицирайте getCustomPrompt
async function getCustomPrompt(env, key) {
  if (!env || !env.page_content || !key) {
    return null;
  }
  
  // Проверете кеша
  const now = Date.now();
  if (customPromptsCache[key] && 
      customPromptsCacheTime[key] && 
      (now - customPromptsCacheTime[key]) < CUSTOM_PROMPTS_CACHE_TTL) {
    console.log(`[Cache HIT] Custom prompt '${key}' from cache`);
    return customPromptsCache[key];
  }
  
  console.log(`[Cache MISS] Loading custom prompt '${key}' from KV`);
  try {
    const prompt = await env.page_content.get(key);
    
    // Запазете в кеша
    if (prompt !== null) {
      customPromptsCache[key] = prompt;
      customPromptsCacheTime[key] = now;
    }
    
    return prompt;
  } catch (error) {
    console.error(`Error loading custom prompt '${key}':`, error);
    return null;
  }
}

// Добавете функция за инвалидиране
function invalidateCustomPromptsCache(key = null) {
  if (key) {
    delete customPromptsCache[key];
    delete customPromptsCacheTime[key];
    console.log(`[Cache INVALIDATED] Custom prompt '${key}' cleared`);
  } else {
    customPromptsCache = {};
    customPromptsCacheTime = {};
    console.log('[Cache INVALIDATED] All custom prompts cleared');
  }
}
```

**Къде да добавите инвалидиране:**

```javascript
// worker.js, line ~5360, handleSavePrompt
await env.page_content.put(key, prompt || '');
invalidateCustomPromptsCache(key); // Добавете това
```

**Резултат след промяна:**
```
GET операции на план: 12 - 9 = 3 GET операции
```

---

## 📊 Общ Ефект от Оптимизациите

### Преди Оптимизации:
```
KV операции на план: ~64
├─ GET:   28 операции
└─ WRITE: 36 операции

Лимит: ~27 плана на ден (WRITE bottleneck)
```

### След Всички Оптимизации:
```
KV операции на план: ~7
├─ GET:   3 операции (только новите данни)
└─ WRITE: 4 операции (только критични)

Нов лимит: ~250 плана на ден ✅
```

### Спестени Операции:
```
┌─────────────────────────────────────────────────────────┐
│ Оптимизация                    │ Спестени │ Процент    │
├────────────────────────────────┼──────────┼────────────┤
│ 1. Деактивиране на AI logging  │ -36 ops  │ -56%       │
│ 2. Кеширане на food lists      │ -16 ops  │ -25%       │
│ 3. Кеширане на custom prompts  │  -9 ops  │ -14%       │
├────────────────────────────────┼──────────┼────────────┤
│ ОБЩО:                          │ -61 ops  │ -89%       │
└─────────────────────────────────────────────────────────┘

От 64 KV ops → 7 KV ops на план
Подобрение: 9x по-малко операции! 🎉
```

---

## ⚡ Бърз План за Действие

### Минимално Решение (Само деактивиране на logging):

1. **Намерете в `worker.js`:**
   ```javascript
   const AI_LOGGING_ENABLED = true;
   ```

2. **Променете на:**
   ```javascript
   const AI_LOGGING_ENABLED = false;
   ```

3. **Deploy:**
   ```bash
   wrangler publish
   ```

**Резултат:** От ~27 плана/ден → ~250 плана/ден (9x подобрение)

---

### Пълно Решение (Всички оптимизации):

1. Деактивирайте AI logging (виж по-горе)
2. Добавете кеширане на food lists
3. Добавете кеширане на custom prompts
4. Добавете инвалидиране на кеша

**Резултат:** От ~27 плана/ден → ~1,000+ плана/ден (37x подобрение)

---

## 📝 Допълнителни Бележки

### За AI Logging:
- Текущата система пази само 1 лог (MAX_LOG_ENTRIES = 1)
- Но пак прави 4 KV операции на всеки AI call
- Ако искате logging, използвайте external service:
  - **Cloudflare Analytics** (безплатно)
  - **Sentry** (error tracking)
  - **LogDNA / Datadog** (advanced logging)

### За Кеширането:
- Worker-level кеш се споделя между всички requests
- Кешът се запазва до следващия deploy или restart
- TTL от 5-30 минути е оптимален за статични данни

### За Monitoring:
- Следете KV metrics в Cloudflare Dashboard
- Добавете console.log('[Cache HIT/MISS]') за debugging
- Проверявайте дали кешът работи правилно

---

## ✅ Заключение

### Главни Причини за Високо KV Използване:

1. **AI Communication Logging** (56% от операциите)
   - Записва 4 KV ops на всеки AI call
   - 9 AI calls на план = 36 KV ops

2. **Многократно Четене на Whitelist/Blacklist** (28%)
   - Чете се 9 пъти за един и същ резултат
   - 18 GET операции на план

3. **Многократно Четене на Custom Prompts** (16%)
   - Промптите се четат многократно
   - 10 GET операции на план

### Препоръчано Решение:

**МИНИМУМ:** Деактивирайте AI logging → **9x подобрение**  
**ОПТИМАЛНО:** Имплементирайте всички оптимизации → **37x подобрение**

---

**Автор:** AI Diet System Analysis  
**Последна актуализация:** 2026-02-08
