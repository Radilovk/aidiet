# Blacklist и Whitelist Система - Документация

## Дата: 2026-02-05
## Статус: ✅ ВНЕДРЕНО

---

## Преглед

AI Diet системата използва двойна система от blacklist (черен списък) и whitelist (бял списък) за контрол на храните в хранителните планове.

---

## 1. BLACKLIST (Черен списък) - Забранени храни

### 1.1 Хардкодиран Blacklist (ADLE_V8_HARD_BANS)

**Локация:** `worker.js`, ред 1022

**Съдържание:**
```javascript
const ADLE_V8_HARD_BANS = [
  'лук', 'onion',
  'пуешко месо', 'turkey meat',
  'изкуствени подсладители', 'artificial sweeteners',
  'мед', 'захар', 'конфитюр', 'сиропи', 'honey', 'sugar', 'jam', 'syrups',
  'кетчуп', 'майонеза', 'BBQ сос', 'ketchup', 'mayonnaise', 'BBQ sauce',
  'гръцко кисело мляко', 'greek yogurt'
];
```

**Характеристики:**
- ✅ HARD BAN - напълно забранени винаги
- ✅ Не могат да се променят от потребителя
- ✅ Базирани на медицински/хранителни причини
- ✅ Проверяват се от валидацията

### 1.2 Динамичен Blacklist (от KV Storage)

**Локация:** KV Storage ключ `food_blacklist`

**Управление:** Чрез admin endpoints
- `GET /api/admin/get-blacklist` - Извлича текущия blacklist
- `POST /api/admin/add-to-blacklist` - Добавя храна в blacklist
- `POST /api/admin/remove-from-blacklist` - Премахва храна от blacklist

**Характеристики:**
- ✅ Динамичен - може да се променя от администратор
- ✅ Съхранява се в KV Storage
- ✅ Сливане с ADLE_V8_HARD_BANS преди подаване към AI
- ✅ Специфичен за всяка инсталация

### 1.3 Merged Blacklist (Обединен списък)

**Функция:** `getMergedBlacklist(env)` (worker.js, ред ~1096)

**Как работи:**
```javascript
1. Извлича динамичния blacklist от KV storage
2. Слива го с ADLE_V8_HARD_BANS
3. Премахва дубликати чрез Set
4. Връща обединен списък
```

**Използване:**
```javascript
const mergedBlacklist = await getMergedBlacklist(env);
// В промпт:
0) HARD BANS: ${mergedBlacklist.join(', ')}
```

**Fallback:** Ако KV storage е недостъпен, връща само ADLE_V8_HARD_BANS

### 1.4 RARE Items (Рядко позволени)

**Локация:** `worker.js`, ред 1030

```javascript
const ADLE_V8_RARE_ITEMS = [
  'пуешка шунка', 'turkey ham', 
  'бекон', 'bacon'
];
```

**Правило:** ≤2 пъти седмично (не hard ban, но ограничени)

---

## 2. WHITELIST (Бял списък) - Разрешени храни

### 2.1 Protein Whitelist

**Локация:** `worker.js`, ред 1057

**Разрешени протеини:**
```
- яйца/eggs
- пилешко/chicken
- говеждо/beef
- свинско/pork (постно)
- риба/fish (всички видове)
- кисело мляко/yogurt (обикновено, НЕ гръцко)
- извара/cottage cheese
- сирене/cheese
- боб/beans
- леща/lentils
- нахут/chickpeas
- грах/peas
```

**ЗАБРАНЕНИ протеини:**
```
- пуешко месо/turkey meat (HARD BAN)
- заешко/rabbit (OFF whitelist)
- патешко/duck (OFF whitelist)
- гъска/goose (OFF whitelist)
- агнешко/lamb (OFF whitelist)
- дивеч/game (OFF whitelist)
```

### 2.2 Non-Whitelist Proteins (с обосновка)

**Локация:** `worker.js`, ред 1075

```javascript
const ADLE_V8_NON_WHITELIST_PROTEINS = [
  'заеш', 'rabbit', 'зайч',
  'патиц', 'патешк', 'duck',
  'гъс', 'goose',
  'агн', 'lamb',
  'дивеч', 'елен', 'deer', 'wild boar', 'глиган'
];
```

**Правило R12:** Позволени САМО ако:
- Обективно необходими (MODE/medical/availability)
- Mainstream/universal
- Налични в България
- С добавен ред: `Reason: ...`

### 2.3 Vegetables Whitelist

**Разрешени зеленчуци:**
```
- домати/tomatoes
- краставици/cucumbers
- чушки/peppers
- зеле/cabbage
- моркови/carrots
- маруля/зелени листа/lettuce/greens
- спанак/spinach
- тиквички/zucchini
- гъби/mushrooms
- броколи/broccoli
- карфиол/cauliflower
```

### 2.4 Energy Whitelist

**Разрешени енергийни източници:**
```
- овесени ядки/oats
- ориз/rice
- картофи/potatoes
- паста/pasta
- булгур/bulgur
```

**ВАЖНО:** Царевица НЕ е енергиен източник!

### 2.5 Fat Whitelist

**Разрешени мазнини:**
```
- зехтин/olive oil
- масло/butter (умерено)
- ядки/семена/nuts/seeds (умерено)
```

---

## 3. Как работи системата

### 3.1 В AI Промптовете

**generateMealPlanChunkPrompt()** (worker.js, ред 2341):
```javascript
// 1. Извлича merged blacklist
const mergedBlacklist = await getMergedBlacklist(env);

// 2. Инжектира в промпт
ADLE v8 RULES (MANDATORY):
0) HARD BANS (strictly forbidden): ${mergedBlacklist.join(', ')}

WHITELISTS: PROTEIN (1 main): eggs, chicken, beef, lean pork, fish, yogurt (plain), 
cottage cheese, cheese, beans, lentils, chickpeas, peas. 
BANNED: turkey (HARD), rabbit/duck/goose/lamb/game/exotic.
```

**generateMealPlanPrompt()** (legacy, worker.js, ред 2625):
```javascript
// Същата логика - извлича и използва merged blacklist
const mergedBlacklist = await getMergedBlacklist(env);
```

### 3.2 В Валидацията

**validatePlan()** (worker.js, ред 1110):

**Проверка #1 - ADLE v8 Hard Bans** (ред 1451-1484):
```javascript
// Проверява за:
- Лук/onion
- Пуешко месо/turkey meat (не шунка)
- Гръцко кисело мляко
- Мед/захар/сиропи
- Кетчуп/майонеза
```

**Проверка #2 - Peas + Fish забранена комбинация** (ред 1454):
```javascript
if (/\b(грах|peas)\b/.test(mealText) && /\b(риба|fish)\b/.test(mealText)) {
  errors.push('ГРАХ + РИБА забранена комбинация');
}
```

**Проверка #3 - Non-Whitelist Proteins** (ред 1458-1480):
```javascript
for (const protein of ADLE_V8_NON_WHITELIST_PROTEINS) {
  if (match && !hasReasonJustification(meal)) {
    errors.push('НЕ е в whitelist (ADLE v8 R12). Изисква се Reason: ...');
  }
}
```

**ЗАБЕЛЕЖКА:** Валидацията проверява само хардкодирания ADLE_V8_HARD_BANS. 
Динамичният blacklist от KV storage НЕ се проверява от валидацията 
(изисква рефакторинг - отделна задача).

---

## 4. ADLE v8 Правила

### R12: Outside-Whitelist Rule

**Правило:**
- Default = използвай САМО whitelists
- Outside-whitelist САМО ако обективно необходимо
- Изисквания:
  - MODE/medical/availability обосновка
  - Mainstream/universal продукт
  - Наличен в България
  - Добави ред: `Reason: ...`

**Пример:**
```
"Заешко месо 150g със зеленчуци
Reason: Клиентът е алергичен към пилешко и говеждо, 
заешко е единствената алтернатива с ниско съдържание на мазнини"
```

---

## 5. Как да добавиш/премахнеш от динамичния blacklist

### 5.1 Добавяне на храна

```bash
curl -X POST https://yourdomain.com/api/admin/add-to-blacklist \
  -H "Content-Type: application/json" \
  -d '{"item": "ананас"}'
```

**Отговор:**
```json
{
  "success": true,
  "blacklist": ["лук", "onion", ..., "ананас"]
}
```

### 5.2 Премахване на храна

```bash
curl -X POST https://yourdomain.com/api/admin/remove-from-blacklist \
  -H "Content-Type: application/json" \
  -d '{"item": "ананас"}'
```

### 5.3 Извличане на blacklist

```bash
curl https://yourdomain.com/api/admin/get-blacklist
```

**Отговор:**
```json
{
  "success": true,
  "blacklist": ["лук", "onion", "пуешко месо", ...]
}
```

---

## 6. Тестване

### 6.1 Проверка че merged blacklist работи

1. Добави тестова храна в blacklist
2. Генерирай хранителен план
3. Провери в логовете:
   ```
   Merged blacklist: 14 hard bans + 1 dynamic = 15 total
   ```
4. Провери че AI не използва тази храна в плана

### 6.2 Проверка на валидацията

1. Създай план с храна от blacklist
2. Провери че validatePlan() връща errors
3. Провери конкретното съобщение за грешка

---

## 7. Известни ограничения

### 7.1 Validation не проверява динамичен blacklist

**Проблем:** 
- validatePlan() е синхронна функция
- Няма достъп до env (KV storage)
- Проверява само ADLE_V8_HARD_BANS

**Последици:**
- Храни от динамичния blacklist могат да минат валидацията
- AI няма да ги използва (защото са в промпта)
- Но ако някой ръчно създаде план, валидацията няма да ги хване

**Решение:** Отделна задача за рефакторинг на validatePlan()

### 7.2 Динамичен whitelist не съществува

**Текущо състояние:**
- Whitelists са само хардкодирани константи
- Не могат да се променят динамично

**Ако е необходимо:**
- Може да се имплементира similar система с KV storage
- Admin endpoints за управление на whitelist
- Merge с хардкодираните whitelists

---

## 8. Резюме

### Какво работи ✅

1. ✅ ADLE_V8_HARD_BANS - хардкодиран blacklist
2. ✅ Динамичен blacklist в KV storage (food_blacklist)
3. ✅ getMergedBlacklist() слива двата списъка
4. ✅ Merged blacklist се използва в AI промптовете
5. ✅ ADLE_V8_PROTEIN_WHITELIST - хардкодиран whitelist
6. ✅ R12 правило за non-whitelist с Reason:
7. ✅ Admin endpoints за управление на blacklist
8. ✅ Валидация проверява хардкодирания blacklist

### Какво не работи напълно ⚠️

1. ⚠️ Валидацията НЕ проверява динамичния blacklist
   - Причина: validatePlan() е sync и няма достъп до env
   - Решение: Рефакторинг в бъдеща задача

2. ⚠️ Няма динамичен whitelist
   - Причина: Не е имплементиран
   - Решение: Ако е необходимо, може да се добави

---

## 9. Заключение

**ОТГОВОР НА ВЪПРОСА:** Да, blacklist и whitelist СЕ ВЗЕМАТ ПРЕДВИД! ✅

**Как:**
1. Blacklist се слива от две места (хардкодиран + KV storage)
2. Merged blacklist се подава към AI в промптовете
3. AI не използва забранени храни
4. Whitelist определя разрешени храни по категории
5. Non-whitelist храни изискват Reason: обосновка
6. Валидацията проверява (частично) спазването на правилата

**Статус:** ✅ РАБОТИ  
**Дата:** 2026-02-05  
**Автор:** GitHub Copilot Coding Agent

---

*Този документ обяснява как blacklist/whitelist системата работи в AI Diet приложението.*
