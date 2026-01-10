# Конфигурируеми Настройки за Multi-Step Генериране

## Обзор

Системата за генериране на хранителни планове използва 3-стъпков процес (Multi-Step Generation) за максимална прецизност и индивидуализация. Сега всяка стъпка може да бъде конфигурирана отделно чрез админ панела.

## Стъпките на Multi-Step генерирането

### Стъпка 1: Анализ на Профила
**Цел:** Задълбочен здравословен анализ

**Изход:**
- BMR (базов метаболизъм)
- TDEE (общ дневен разход на енергия)
- Препоръчителни калории
- Макронутриенти (протеини, въглехидрати, мазнини)
- Метаболитен профил
- Здравословни рискове
- Психологически профил
- Ключови проблеми

**KV ключ:** `admin_analysis_prompt`
**Файл:** `/KV/admin_analysis_prompt.txt`

### Стъпка 2: Диетична Стратегия
**Цел:** Персонализирана диетична стратегия

**Вход:** Потребителски данни + Анализ от Стъпка 1

**Изход:**
- Диетичен модификатор (Кето, Веган, Балансирано и др.)
- Тип диета
- Седмична схема на хранене
- Време на хранене
- Ключови принципи
- Храни за включване/избягване
- Препоръки за хранителни добавки
- Стратегия за хидратация
- Психологическа подкрепа

**KV ключ:** `admin_strategy_prompt`
**Файл:** `/KV/admin_strategy_prompt.txt`

### Стъпка 3: Хранителен План
**Цел:** Конкретен 7-дневен план с ястия

**Вход:** Потребителски данни + Анализ + Стратегия

**Изход:**
- 7-дневен план (day1-day7)
- Всеки ден с 3-5 хранения
- Всяко хранене с:
  - Тип, време, име
  - Тегло/количество
  - Описание и ползи
  - Точни калории

**KV ключ:** `admin_meal_plan_prompt`
**Файл:** `/KV/admin_meal_plan_prompt.txt`

## Настройки за Валидация

Системата може да проверява генерираните планове преди да ги покаже на потребителите.

**Параметри:**
- `minMealsPerDay`: Минимален брой хранения (default: 3)
- `maxMealsPerDay`: Максимален брой хранения (default: 5)
- `minCaloriesPerMeal`: Минимални калории на хранене (default: 150)
- `maxCaloriesPerMeal`: Максимални калории на хранене (default: 800)
- `validateMacros`: Валидирай макронутриенти (default: true)
- `validateCaloriesWithGoal`: Проверявай съответствието на калориите с целта (default: true)
- `validateMedicalConditions`: Проверявай съответствието с медицинските състояния (default: true)

**KV ключ:** `admin_validation_settings`
**Файл:** `/KV/admin_validation_settings.json`

## Как да използвате настройките

### 1. Чрез Админ Панел (Препоръчително)

1. Отворете `https://yourdomain.com/admin.html`
2. Влезте с админ парола
3. Намерете секцията "Multi-Step Генериране"
4. Редактирайте всяка стъпка отделно
5. Запазете промените

### 2. Чрез KV Storage (Директно)

```bash
# Upload prompts to KV
cd KV
./upload-kv-keys.sh
```

### 3. Чрез Worker API

```javascript
// Save analysis prompt
fetch('https://aidiet.radilov-k.workers.dev/api/admin/save-prompt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    type: 'analysis', 
    prompt: 'Вашият промпт тук...' 
  })
});

// Save validation settings
fetch('https://aidiet.radilov-k.workers.dev/api/admin/save-validation-settings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    settings: {
      minMealsPerDay: 3,
      maxMealsPerDay: 5,
      // ... други настройки
    }
  })
});
```

## Променливи в Промптите

Промптите поддържат следните променливи:

### Data променливи (от въпросника)
- `${data.name}` - Име
- `${data.age}` - Възраст
- `${data.weight}` - Тегло
- `${data.height}` - Ръст
- `${data.goal}` - Цел
- `${data.gender}` - Пол
- `${data.sleepHours}` - Часове сън
- `${data.stressLevel}` - Ниво на стрес
- `${data.sportActivity}` - Спортна активност
- и всички други полета от въпросника

### Analysis променливи (от Стъпка 1)
- `${analysis.bmr}` - BMR
- `${analysis.tdee}` - TDEE
- `${analysis.recommendedCalories}` - Препоръчителни калории
- `${JSON.stringify(analysis, null, 2)}` - Пълен анализ като JSON

### Strategy променливи (от Стъпка 2)
- `${strategy.dietaryModifier}` - Диетичен модификатор
- `${strategy.dietType}` - Тип диета
- `${JSON.stringify(strategy, null, 2)}` - Пълна стратегия като JSON

### Други променливи
- `${recommendedCalories}` - Изчислени калории (за Стъпка 3)

## API Endpoints

### GET /api/admin/get-config
Връща цялата конфигурация включително всички промпти и настройки.

**Response:**
```json
{
  "success": true,
  "provider": "openai",
  "modelName": "gpt-4o-mini",
  "planPrompt": "...",
  "analysisPrompt": "...",
  "strategyPrompt": "...",
  "mealPlanPrompt": "...",
  "consultationPrompt": "...",
  "modificationPrompt": "...",
  "validationSettings": { ... }
}
```

### POST /api/admin/save-prompt
Запазва промпт в KV storage.

**Request:**
```json
{
  "type": "analysis | strategy | mealplan | consultation | modification | plan",
  "prompt": "Промпт текст..."
}
```

### POST /api/admin/save-validation-settings
Запазва настройките за валидация.

**Request:**
```json
{
  "settings": {
    "minMealsPerDay": 3,
    "maxMealsPerDay": 5,
    "minCaloriesPerMeal": 150,
    "maxCaloriesPerMeal": 800,
    "validateMacros": true,
    "validateCaloriesWithGoal": true,
    "validateMedicalConditions": true
  }
}
```

## Важни Бележки

1. **Кеширане**: Промптите се кешират за 5 минути. След промяна изчакайте или рестартирайте worker-а.

2. **Fallback**: Ако промпт не е зададен в KV, системата ще използва default промптите.

3. **Валидация**: Винаги валидирайте промптите преди запазване. Грешни промпти могат да доведат до некоректни планове.

4. **Format**: Промптите трябва да връщат JSON в специфичен формат. Вижте default промптите за примери.

5. **Тестване**: След промяна на промпт, тествайте с реални данни преди да го пуснете в производство.

## Решаване на Проблеми

### Проблем: Грешно изчислени калории
**Решение:** 
- Проверете промпта за анализ (Стъпка 1) - осигурете правилно изчисляване на BMR/TDEE
- Проверете промпта за хранителен план (Стъпка 3) - осигурете точни калории за всяко хранене
- Активирайте `validateCaloriesWithGoal` в настройките за валидация

### Проблем: Непълно меню
**Решение:**
- Проверете промпта за хранителен план (Стъпка 3)
- Уверете се, че изисква всички 7 дни (day1-day7)
- Проверете `minMealsPerDay` и `maxMealsPerDay` настройките

### Проблем: Неподходящи храни за медицински състояния
**Решение:**
- Проверете промпта за стратегия (Стъпка 2) - трябва да взема предвид медицинските състояния
- Активирайте `validateMedicalConditions` в настройките
- Проверете дали промптът правилно обработва `${data.medicalConditions}`

## Примери

### Пример 1: Променете минималния брой хранения
В админ панела:
1. Отидете на "Настройки за Валидация"
2. Променете "Минимален брой хранения на ден" на 4
3. Запазете

### Пример 2: Добавете специфична проверка в анализа
Редактирайте `admin_analysis_prompt`:
```
ДОПЪЛНИТЕЛНО ИЗИСКВАНЕ:
Ако клиентът е с високо ниво на стрес (${data.stressLevel}) и лош сън (${data.sleepHours} < 7), 
задължително включи в анализа препоръки за намаляване на кортизола.
```

### Пример 3: Персонализирайте съобщенията
В `admin_meal_plan_prompt`:
```
СТИЛ НА КОМУНИКАЦИЯ:
Използвай приятелски тон и обърни се към ${data.name} по име.
Пример: "Здравей, ${data.name}! Твоят план..."
```
