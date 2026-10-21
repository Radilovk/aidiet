# Бързо Ръководство за KV Оптимизация
# KV Optimization Quick Guide

⚠️ **Проблем:** Надхвърлен лимит за Cloudflare Workers KV квота  
🎯 **Причина:** 36 WRITE операции на генериране на план (лимит: 1,000/ден)  
✅ **Решение:** Деактивиране на AI logging + Кеширане

---

## 📊 Текущо Състояние

```
Генериране на 1 план = 64 KV операции
├─ 28 READ операции
└─ 36 WRITE операции (AI logging)

Лимит: ~27 плана на ден
```

---

## ⚡ БЪРЗО РЕШЕНИЕ (5 минути)

### Стъпка 1: Деактивирайте AI Logging

**Файл:** `worker.js`  
**Ред:** ~63

```javascript
// ПРЕДИ:
const AI_LOGGING_ENABLED = true;

// СЛЕД:
const AI_LOGGING_ENABLED = false;
```

**Резултат:**
```
От: 64 KV ops/план → 28 KV ops/план
От: ~27 плана/ден → ~250 плана/ден
Подобрение: 9x 🎉
```

### Стъпка 2: Deploy

```bash
wrangler publish
```

---

## 🚀 ПЪЛНО РЕШЕНИЕ (30 минути)

### 1. Деактивирайте AI Logging (виж по-горе)

### 2. Добавете Кеширане на Food Lists

**Файл:** `worker.js`

**В началото на файла (след imports):**
```javascript
// Food lists cache
let foodListsCache = null;
let foodListsCacheTime = 0;
const FOOD_LISTS_CACHE_TTL = 10 * 60 * 1000; // 10 минути
```

**Заменете функцията `getDynamicFoodListsSections` (~ред 3220):**
```javascript
async function getDynamicFoodListsSections(env) {
  // Cache check
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
  
  let dynamicWhitelistSection = '';
  if (dynamicWhitelist.length > 0) {
    dynamicWhitelistSection = `\n\nАДМИН WHITELIST (ПРИОРИТЕТНИ ХРАНИ ОТ АДМИН ПАНЕЛ):\n- ${dynamicWhitelist.join('\n- ')}\nТези храни са допълнително одобрени и трябва да се предпочитат при възможност.`;
  }
  
  let dynamicBlacklistSection = '';
  if (dynamicBlacklist.length > 0) {
    dynamicBlacklistSection = `\n\nАДМИН BLACKLIST (ДОПЪЛНИТЕЛНИ ЗАБРАНИ ОТ АДМИН ПАНЕЛ):\n- ${dynamicBlacklist.join('\n- ')}\nТези храни са категорично забранени от администратора и НЕ трябва да се използват.`;
  }
  
  const result = { dynamicWhitelistSection, dynamicBlacklistSection };
  foodListsCache = result;
  foodListsCacheTime = now;
  
  return result;
}

// Cache invalidation function
function invalidateFoodListsCache() {
  foodListsCache = null;
  foodListsCacheTime = 0;
}
```

**Добавете инвалидиране на кеша след промени:**
```javascript
// В handleAddToBlacklist (~ред 6632):
await env.page_content.put('food_blacklist', JSON.stringify(blacklist));
invalidateFoodListsCache(); // ← Добавете това

// В handleRemoveFromBlacklist (~ред 6664):
await env.page_content.put('food_blacklist', JSON.stringify(blacklist));
invalidateFoodListsCache(); // ← Добавете това

// В handleAddToWhitelist (~ред 6719):
await env.page_content.put('food_whitelist', JSON.stringify(whitelist));
invalidateFoodListsCache(); // ← Добавете това

// В handleRemoveFromWhitelist (~ред 6751):
await env.page_content.put('food_whitelist', JSON.stringify(whitelist));
invalidateFoodListsCache(); // ← Добавете това
```

### 3. Добавете Кеширане на Custom Prompts

**В началото на файла:**
```javascript
// Custom prompts cache
let customPromptsCache = {};
let customPromptsCacheTime = {};
const CUSTOM_PROMPTS_CACHE_TTL = 30 * 60 * 1000; // 30 минути
```

**Заменете функцията `getCustomPrompt` (~ред 2230):**
```javascript
async function getCustomPrompt(env, key) {
  if (!env || !env.page_content || !key) {
    return null;
  }
  
  // Cache check
  const now = Date.now();
  if (customPromptsCache[key] && 
      customPromptsCacheTime[key] && 
      (now - customPromptsCacheTime[key]) < CUSTOM_PROMPTS_CACHE_TTL) {
    return customPromptsCache[key];
  }
  
  try {
    const prompt = await env.page_content.get(key);
    
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

// Cache invalidation function
function invalidateCustomPromptsCache(key = null) {
  if (key) {
    delete customPromptsCache[key];
    delete customPromptsCacheTime[key];
  } else {
    customPromptsCache = {};
    customPromptsCacheTime = {};
  }
}
```

**Добавете инвалидиране на кеша:**
```javascript
// В handleSavePrompt (~ред 5360):
await env.page_content.put(key, prompt || '');
invalidateCustomPromptsCache(key); // ← Добавете това
```

### 4. Deploy

```bash
wrangler publish
```

**Резултат:**
```
От: 64 KV ops/план → 7 KV ops/план
От: ~27 плана/ден → ~1,000+ плана/ден
Подобрение: 37x 🎉🎉🎉
```

---

## 📈 Сравнение

| Оптимизация | KV ops/план | Плана/ден | Подобрение |
|-------------|-------------|-----------|------------|
| **Преди** | 64 | 27 | - |
| **Само logging OFF** | 28 | 250 | 9x |
| **С всички оптимизации** | 7 | 1,000+ | 37x |

---

## ✅ Проверка

След deploy, проверете в Cloudflare Dashboard:
1. Analytics → Workers → Вашият worker
2. KV → Операции за последните 24 часа
3. Трябва да видите значително намаление

---

## 🔍 Debugging

Ако кешът не работи:
1. Добавете `console.log()` в кеш функциите
2. Проверете Cloudflare Logs
3. Уверете се, че инвалидирането работи

---

## 📚 Допълнителна Информация

Вижте пълния анализ в: `docs/archive/root/KV_QUOTA_ANALYSIS_BG.md`

---

**Последна актуализация:** 2026-02-08
