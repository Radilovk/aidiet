# API Quick Reference - Бърз Справочник

## Endpoints

### 1. Генериране на План
```
POST /api/generate-plan
```

**Request Body:**
```json
{
  "name": "string",
  "age": number,
  "gender": "string",
  "weight": number,
  "height": number,
  "goal": "string",
  "sportActivity": "string",
  "medicalConditions": ["string"],
  "medications": ["string"],
  "allergies": "string",
  "dietPreference": "string",
  "dietLike": "string",
  "dietDislike": "string",
  // ... и други полета от въпросника
}
```

**Response:**
```json
{
  "success": true,
  "userId": "string",
  "correctionAttempts": number,
  "plan": {
    "analysis": { /* Стъпка 1 */ },
    "strategy": { /* Стъпка 2 */ },
    "weekPlan": { /* Стъпка 3 */ },
    "summary": { /* Стъпка 4 */ },
    "recommendations": [],
    "forbidden": [],
    "psychology": [],
    "waterIntake": "string",
    "supplements": []
  }
}
```

### 2. Чат
```
POST /api/chat
```

**Request Body:**
```json
{
  "message": "string",
  "userId": "string",
  "conversationId": "string",
  "mode": "consultation | modification",
  "userData": { /* Пълни потребителски данни */ },
  "userPlan": { /* Компактен план */ },
  "conversationHistory": []
}
```

**Response:**
```json
{
  "response": "string",
  "conversationHistory": [],
  "planWasUpdated": boolean,
  "updatedPlan": { /* Ако planWasUpdated */ },
  "updatedUserData": { /* Ако planWasUpdated */ }
}
```

---

## Структура на Plan Object

### analysis (Стъпка 1)
```javascript
{
  bmr: number,                    // Основен метаболизъм
  recommendedCalories: number,    // Препоръчани калории
  bmi: number,                    // BMI индекс
  bmiCategory: string,            // "Нормално тегло" и т.н.
  keyProblems: [{                 // Здравни проблеми
    problem: string,
    severity: string,
    reasoning: string
  }],
  metabolicProfile: {},           // Метаболитен профил
  nutritionalDeficiencies: [],    // Хранителни дефицити
  digestiveHealth: {},            // Храносмилателно здраве
  cardioMetabolicRisk: {},        // Кардио-метаболитен риск
  psychologicalFactors: {},       // Психологически фактори
  keyCorrelations: []             // Ключови корелации
}
```

### strategy (Стъпка 2)
```javascript
{
  dietaryModifier: string,            // "Нискогликемичен" и т.н.
  welcomeMessage: string,             // Приветствие
  planJustification: string,          // Обосновка на плана
  mealCountJustification: string,     // Защо X ядения
  mealsPerDay: number,                // Брой ядения
  macroDistribution: {},              // Разпределение на макроси
  foodsToInclude: [],                 // Препоръчани храни
  foodsToAvoid: [],                   // Забранени храни
  mealTiming: {},                     // Времена за хранене
  specialGuidelines: [],              // Специални насоки
  hydrationStrategy: string,          // Водна стратегия
  supplementRecommendations: [],      // Добавки
  psychologicalSupport: [],           // Психологическа подкрепа
  expectedOutcomes: {}                // Очаквани резултати
}
```

### weekPlan (Стъпка 3)
```javascript
{
  day1: {
    date: string,                     // "Понеделник"
    totalCalories: number,            // Общо калории за деня
    totalMacros: {                    // Общо макроси за деня
      protein: number,
      carbs: number,
      fats: number
    },
    meals: [{                         // Масив от ядения
      type: string,                   // "Закуска", "Обяд" и т.н.
      time: string,                   // "07:30"
      name: string,                   // Име на яденето
      description: string,            // Описание
      ingredients: [],                // Съставки с количества
      calories: number,               // Калории
      macros: {                       // Макроси
        protein: number,
        carbs: number,
        fats: number
      },
      cookingInstructions: string,    // Инструкции
      notes: string                   // Бележки
    }]
  },
  day2: { /* same structure */ },
  day3: { /* same structure */ },
  day4: { /* same structure */ },
  day5: { /* same structure */ },
  day6: { /* same structure */ },
  day7: { /* same structure */ }
}
```

### summary (Стъпка 4)
```javascript
{
  bmr: number,
  dailyCalories: number,
  macros: {
    protein: number,
    carbs: number,
    fats: number
  }
}
```

### recommendations, forbidden, psychology
```javascript
recommendations: [string],    // Списък препоръки
forbidden: [string],         // Списък забрани
psychology: [string]         // Психологически съвети
```

### supplements
```javascript
supplements: [{
  name: string,              // "Витамин D3"
  dosage: string,            // "4000 IU дневно"
  timing: string,            // "Сутрин с храна"
  reason: string             // Защо е необходим
}]
```

---

## localStorage Структура

### Какво се запазва
```javascript
// Пълен план
localStorage.setItem('dietPlan', JSON.stringify(plan));

// User ID
localStorage.setItem('userId', userId);

// Въпросник данни
localStorage.setItem('userData', JSON.stringify(userData));
```

### Какво се чете
```javascript
// В plan.html
const dietPlan = JSON.parse(localStorage.getItem('dietPlan'));
const userId = localStorage.getItem('userId');
const userData = JSON.parse(localStorage.getItem('userData'));
```

---

## Frontend Използване

### Показване на приветствие
```javascript
const welcomeMessage = dietPlan.strategy.welcomeMessage;
const justification = dietPlan.strategy.planJustification;
```

### Показване на калории и макроси
```javascript
const calories = dietPlan.summary.dailyCalories;
const protein = dietPlan.summary.macros.protein;
const carbs = dietPlan.summary.macros.carbs;
const fats = dietPlan.summary.macros.fats;
```

### Итериране през дните
```javascript
for (let i = 1; i <= 7; i++) {
  const dayKey = `day${i}`;
  const dayData = dietPlan.weekPlan[dayKey];
  
  // Показване на деня
  const meals = dayData.meals;
  meals.forEach(meal => {
    console.log(meal.name, meal.calories);
  });
}
```

### Показване на ядене
```javascript
const meal = dayData.meals[0];

// Основна информация
meal.type          // "Закуска"
meal.time          // "07:30"
meal.name          // "Омлет със зеленчуци"
meal.description   // Описание

// Хранителни стойности
meal.calories      // 450
meal.macros.protein // 28
meal.macros.carbs   // 35
meal.macros.fats    // 20

// Детайли
meal.ingredients   // ["3 яйца", "100g домати", ...]
meal.cookingInstructions // Стъпки
```

### Показване на препоръки
```javascript
dietPlan.recommendations.forEach(rec => {
  console.log('✓', rec);
});

dietPlan.forbidden.forEach(food => {
  console.log('✗', food);
});
```

### Показване на добавки
```javascript
dietPlan.supplements.forEach(supp => {
  console.log(`${supp.name} - ${supp.dosage}`);
  console.log(`Време: ${supp.timing}`);
  console.log(`Причина: ${supp.reason}`);
});
```

---

## Chat Използване

### Изпращане на съобщение (Consultation)
```javascript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: "Колко вода трябва да пия?",
    userId: localStorage.getItem('userId'),
    conversationId: 'conv_123',
    mode: 'consultation',
    userData: JSON.parse(localStorage.getItem('userData')),
    userPlan: {
      summary: dietPlan.summary,
      weekPlan: compactWeekPlan(dietPlan.weekPlan)
    },
    conversationHistory: []
  })
});

const result = await response.json();
console.log(result.response); // AI отговор
```

### Изпращане на модификация
```javascript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: "Махни овесените ядки от плана",
    mode: 'modification',
    // ... същите параметри
  })
});

const result = await response.json();

if (result.planWasUpdated) {
  // Обнови localStorage
  localStorage.setItem('dietPlan', JSON.stringify(result.updatedPlan));
  localStorage.setItem('userData', JSON.stringify(result.updatedUserData));
  
  // Презареди за показване на новия план
  location.reload();
}
```

---

## Компактен формат на weekPlan (за Chat)

### Функция за компресиране
```javascript
function compactWeekPlan(weekPlan) {
  if (!weekPlan) return null;
  
  const compact = {};
  for (const dayKey in weekPlan) {
    if (weekPlan[dayKey] && weekPlan[dayKey].meals) {
      compact[dayKey] = {
        meals: weekPlan[dayKey].meals.map(meal => ({
          type: meal.type,
          name: meal.name
          // Само основна информация
        }))
      };
    }
  }
  return compact;
}
```

---

## Модификации на План

### Налични модификации (чрез Chat)
```javascript
// Структурни промени
"no_intermediate_meals"     // Без междинни хранения
"3_meals_per_day"           // 3 хранения дневно
"4_meals_per_day"           // 4 хранения дневно

// Диетични ограничения
"vegetarian"                // Вегетариански
"no_dairy"                  // Без млечни
"low_carb"                  // Нисковъглехидратна
"increase_protein"          // Повече протеини

// Премахване на храна
"exclude_food:име_на_храна" // Премахни конкретна храна
```

---

## Валидация и Корекция

### Стъпка 5: Валидация (12+ проверки)
Автоматична валидация след генериране на план:

**Структурни проверки:**
- ✓ analysis наличен с keyProblems, BMR, calories
- ✓ strategy наличен с dietaryModifier, justification, welcomeMessage
- ✓ weekPlan с точно 7 дни, всеки с 1-5 meals
- ✓ summary с калории и макроси
- ✓ recommendations и forbidden (минимум 3)

**Съдържателни проверки:**
- ✓ Забранени храни НЕ са в плана (ADLE v8 hard bans)
- ✓ Goal-план съответствие (калории)
- ✓ Medical conditions alignment (диабет, анемия, и др.)
- ✓ Dietary preferences compliance (веган, вегетарианец)
- ✓ Максимум 5 повтарящи се ястия
- ✓ ADLE v8 правила (meal types, chronological order, low-GI late snacks)
- ✓ Medication-supplement interactions
- ✓ Macro accuracy (protein×4 + carbs×4 + fats×9 ≈ calories)

### Стъпка 6: Корекция (до 4 опита)
Ако валидацията открие грешки:

**Интелигентно регенериране:**
```javascript
// Определя най-ранната грешна стъпка
step1_analysis  → Регенерира: 1, 2, 3, 4
step2_strategy  → Регенерира: 2, 3, 4 (запазва Анализ)
step3_mealplan  → Регенерира: 3, 4 (запазва Анализ и Стратегия)
step4_final     → Регенерира: 4 (запазва всичко друго)
```

**Error Prevention Промпт:**
- AI получава детайлна информация за грешките
- Критичен приоритет за избягване на същите грешки
- Ясни инструкции какво трябва да се коригира

**Fallback Механизъм:**
- След 4 неуспешни опита → Опит за simplified план
- При пълен провал → `success: false` с error details

**Response с корекции:**
```json
{
  "success": true,
  "correctionAttempts": 2,
  "plan": { /* Коригиран план */ },
  "_meta": {
    "regeneratedFrom": "step2_strategy",
    "correctionAttempt": 2
  }
}
```

**Статистика:**
- 95%+ случаи: `correctionAttempts = 0` (валиден от първи път)
- Редки случаи: `correctionAttempts = 1-2`
- Много рядко: `correctionAttempts = 3-4` или fallback

---

## Backend Изчисления

### BMR (Basal Metabolic Rate)
```javascript
// Mifflin-St Jeor Formula
BMR_мъже = 10 × weight(kg) + 6.25 × height(cm) - 5 × age + 5
BMR_жени = 10 × weight(kg) + 6.25 × height(cm) - 5 × age - 161
```

### TDEE (Total Daily Energy Expenditure)
```javascript
TDEE = BMR × activity_factor

// Activity factors:
Никаква  = 1.2
Ниско    = 1.375
Средно   = 1.55
Високо   = 1.725
```

### BMI (Body Mass Index)
```javascript
BMI = weight(kg) / (height(m))²

// Категории:
< 18.5  = Поднормено
18.5-25 = Нормално
25-30   = Наднормено
> 30    = Затлъстяване
```

### Препоръчани калории
```javascript
// Според цел
Отслабване:  TDEE × 0.85  // -15%
Покачване:   TDEE × 1.1   // +10%
Поддръжка:   TDEE         // 100%
```

---

## Token Лимити

### План генериране (7 AI заявки)
```
Стъпка 1 (Analysis):  4000 tokens
Стъпка 2 (Strategy):  4000 tokens
Стъпка 3.1 (Day 1-2): 8000 tokens
Стъпка 3.2 (Day 3-4): 8000 tokens
Стъпка 3.3 (Day 5-6): 8000 tokens
Стъпка 3.4 (Day 7):   8000 tokens
Стъпка 4 (Summary):   2000 tokens
```

### Chat
```
Chat консултация:  2000 tokens на съобщение
```

---

## Грешки

### Често срещани грешки
```javascript
// 400 Bad Request
{
  "error": "Липсват задължителни полета"
}

{
  "error": "Липсват потребителски данни или план"
}

// 500 Internal Server Error
{
  "error": "Неуспешно генериране на план: ..."
}

{
  "error": "Грешка в чата: ..."
}
```

### Retry механизъм
- Автоматичен retry при 502, 503, 504, 429
- Максимум 3 опита
- Exponential backoff (1s, 2s, 4s)

---

## Privacy & Security

### Какво НЕ СЕ съхранява на сървъра
- ❌ userData
- ❌ dietPlan
- ❌ chatHistory
- ❌ Лични здравни данни

### Какво СЕ съхранява
- ✅ Admin prompts (KV storage)
- ✅ AI provider config (KV storage)
- ✅ Food whitelist/blacklist (KV storage)

### GDPR Compliance
- Всички данни в localStorage (клиент)
- Никакво server-side съхранение на потребителски данни
- Пълен контрол от потребителя

---

## За повече информация

Вижте пълната документация в `API_JSON_DOCUMENTATION.md`
