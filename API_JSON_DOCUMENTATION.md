# API JSON Документация - Структура на Данните и Комуникация

## Преглед на Архитектурата

Системата използва **Multi-Step Architecture** за генериране на индивидуализиран хранителен план през **4 основни стъпки + 1 чат функционалност**:

```
Структура: 1 (Анализ) + 1 (Стратегия) + 4 (Хранителен план) + 1 (Резюме) = 7 AI заявки за пълен план
```

### Обща Схема на Комуникацията

```
КЛИЕНТ (Frontend)
    ↓ POST /api/generate-plan + userData
BACKEND (Cloudflare Worker)
    ↓ Стъпка 1-4 (7 AI заявки)
    ↓ Валидация и корекции
    ↓ JSON response
КЛИЕНТ
    ↓ Запазване в localStorage
    ↓ Визуализация в plan.html
```

---

## Стъпка 0: Клиентски Данни (Input от Въпросника)

### Какво се изпраща от клиента към backend

**Endpoint:** `POST /api/generate-plan`

**JSON Структура на Въпросника:**

```json
{
  "name": "Име на клиента",
  "age": 30,
  "gender": "Мъж/Жена",
  "weight": 75,
  "height": 175,
  "goal": "Отслабване/Покачване на мускулна маса/Поддръжка",
  "sportActivity": "Високо/Средно/Ниско/Никаква",
  
  "medicalConditions": [
    "Диабет тип 2",
    "Повишен холестерол"
  ],
  "medications": [
    "Метформин 500mg",
    "Статини"
  ],
  "allergies": "Ядки, соя",
  
  "dietPreference": "Всеяден/Вегетарианец/Веган/Пескетарианец",
  "dietLike": "Пилешко, риба, зеленчуци",
  "dietDislike": "Спанак, карфиол",
  
  "sleepHours": 7,
  "sleepQuality": "Добро/Средно/Лошо",
  "stressLevel": "Високо/Средно/Ниско",
  "waterIntake": 2.5,
  
  "breakfastTime": "07:00",
  "lunchTime": "12:30",
  "dinnerTime": "19:00",
  
  "bloodPressure": "120/80",
  "bloodSugar": "5.5",
  "cholesterolTotal": "5.2",
  "cholesterolLDL": "3.1",
  "cholesterolHDL": "1.8",
  "triglycerides": "1.2",
  "hemoglobin": "140",
  "iron": "15",
  "vitaminD": "45",
  "vitaminB12": "350",
  
  "digestionProblems": ["Запек", "Подуване"],
  "energyLevels": "Ниско/Средно/Високо",
  "appetitePattern": "Нормално/Повишено/Намалено",
  
  "smoking": "Да/Не",
  "alcohol": "Рядко/Понякога/Често/Никога",
  
  "planModifications": []
}
```

### Какво Изчислява Backend-а (преди AI)

Backend-ът изчислява критични здравни показатели:

```javascript
// 1. BMR (Basal Metabolic Rate) - Основен метаболизъм
BMR_мъже = 10 * тегло(kg) + 6.25 * височина(cm) - 5 * възраст + 5
BMR_жени = 10 * тегло(kg) + 6.25 * височина(cm) - 5 * възраст - 161

// 2. TDEE (Total Daily Energy Expenditure) - Общ дневен разход
TDEE = BMR * фактор_активност
// Фактори: Никаква=1.2, Ниско=1.375, Средно=1.55, Високо=1.725

// 3. BMI (Body Mass Index)
BMI = тегло(kg) / (височина(m))²

// 4. Препоръчани калории според целта
Отслабване: TDEE * 0.85 (-15%)
Покачване: TDEE * 1.1 (+10%)
Поддръжка: TDEE

// 5. Водно количество (литри)
min_water = тегло(kg) * 0.033
```

**Резултат от изчисленията:**
```json
{
  "calculatedBMR": 1650,
  "calculatedTDEE": 2475,
  "calculatedBMI": 24.5,
  "recommendedCalories": 2100,
  "minWaterIntake": 2.5
}
```

---

## Стъпка 1: АНАЛИЗ (Analysis) - Холистична Здравна Оценка

### Цел на стъпката
Дълбок анализ на здравния статус, метаболитен профил и корелации между параметри.

### AI Заявка (Input към AI)
**Тип:** `step1_analysis`  
**Token Limit:** 4000 tokens  
**Prompt съдържа:**
- Пълни потребителски данни (профил, навици, медицински история)
- Лабораторни показатели
- Изчислени BMR, TDEE, BMI
- Поведенчески данни (сън, стрес, храносмилане)

### AI Отговор (Output от AI)

**Очакван JSON формат:**

```json
{
  "bmr": 1650,
  "recommendedCalories": 2100,
  "bmi": 24.5,
  "bmiCategory": "Нормално тегло",
  
  "keyProblems": [
    {
      "problem": "Инсулинова резистентност",
      "severity": "Висока",
      "reasoning": "Кръвна захар 6.8 mmol/L, HbA1c 6.2%, признаци на метаболитен синдром"
    },
    {
      "problem": "Хроничен стрес",
      "severity": "Средна",
      "reasoning": "Нарушен сън, висок кортизол, хранително компенсиране"
    }
  ],
  
  "metabolicProfile": {
    "metabolismSpeed": "Забавен",
    "insulinSensitivity": "Ниска",
    "hormonalBalance": "Дисбаланс - висок кортизол, ниски щитовидни",
    "inflammationLevel": "Умерено повишено"
  },
  
  "nutritionalDeficiencies": [
    {
      "nutrient": "Витамин D",
      "current": "22 ng/mL",
      "optimal": "40-60 ng/mL",
      "impact": "Имунна система, костна плътност, настроение"
    },
    {
      "nutrient": "Магнезий",
      "reasoning": "Стрес, мускулни крампи, лош сън",
      "impact": "Енергиен метаболизъм, нервна система"
    }
  ],
  
  "digestiveHealth": {
    "status": "Компрометирано",
    "issues": ["Запек", "Подуване след ядене"],
    "probableCause": "Ниски фибри, недостатъчно течности, стрес"
  },
  
  "cardioMetabolicRisk": {
    "level": "Среден",
    "factors": [
      "Холестерол LDL 3.8 (цел <3.0)",
      "Триглицериди 2.1 (цел <1.7)",
      "Абдоминално затлъстяване"
    ]
  },
  
  "psychologicalFactors": {
    "stressImpact": "Висок - хранително компенсиране",
    "sleepQuality": "Ниско - 5-6 часа фрагментиран сън",
    "emotionalEating": "Присъства - вечерни преяждания"
  },
  
  "keyCorrelations": [
    "Висока кръвна захар + Нисък сън → Повишен апетит и инсулинова резистентност",
    "Хроничен стрес + Ниски фибри → Проблеми с храносмилането",
    "Ниски витамин D + Висок стрес → Намалена имунна функция"
  ]
}
```

### Какво се използва за следващи стъпки
- `keyProblems` → определя приоритети в стратегията
- `metabolicProfile` → влияе на макронутриенти
- `nutritionalDeficiencies` → влияе на добавки и хранителен избор
- `cardioMetabolicRisk` → определя ограничения
- `keyCorrelations` → персонализация на плана

---

## Стъпка 2: СТРАТЕГИЯ (Strategy) - Диетичен Подход

### Цел на стъпката
Определяне на персонализирана стратегия, хранителен подход, ограничения и принципи.

### AI Заявка (Input към AI)
**Тип:** `step2_strategy`  
**Token Limit:** 4000 tokens  
**Prompt съдържа:**
- Потребителски данни
- **КОМПАКТЕН формат на анализа** (67% по-малко токени)
- Изчислени калории и макроси

### AI Отговор (Output от AI)

**Очакван JSON формат:**

```json
{
  "dietaryModifier": "Нискогликемичен с контролирани въглехидрати",
  
  "welcomeMessage": "Здравей, Иван! Твоят план е създаден специално за теб, за да...",
  
  "planJustification": "Избраният подход е нискогликемичен...",
  
  "mealCountJustification": "Препоръчвам 4 хранения дневно - закуска, обяд, следобедна закуска и вечеря...",
  
  "mealsPerDay": 4,
  
  "macroDistribution": {
    "protein": "30%",
    "carbs": "40%",
    "fats": "30%",
    "reasoning": "Повишен протеин за инсулинова чувствителност..."
  },
  
  "foodsToInclude": [
    "Зеленчуци с високо съдържание на фибри",
    "Качествени протеини (риба, пилешко, яйца)",
    "Ферментирали храни за пробиотици",
    "Ядки и семена за здравословни мазнини"
  ],
  
  "foodsToAvoid": [
    "Рафинирани въглехидрати и бяла захар",
    "Преработени меса",
    "Транс-мазнини и фритюр",
    "Алкохол и газирани напитки"
  ],
  
  "mealTiming": {
    "breakfast": "07:00-08:00",
    "lunch": "12:30-13:30",
    "snack": "16:00-17:00",
    "dinner": "18:30-19:30",
    "reasoning": "Ранна вечеря за подобрена инсулинова чувствителност"
  },
  
  "specialGuidelines": [
    "Започвай хранението със салата/зеленчуци",
    "Избягвай въглехидрати след 19:00",
    "Комбинирай винаги протеин + фибри"
  ],
  
  "hydrationStrategy": "2.5-3л дневно, разпределени равномерно",
  
  "supplementRecommendations": [
    {
      "supplement": "Витамин D3",
      "dosage": "4000 IU дневно",
      "reasoning": "Нива 22 ng/mL (цел: 40-60)",
      "timing": "С мазнини, сутрин"
    },
    {
      "supplement": "Омега-3",
      "dosage": "1000-2000mg EPA+DHA",
      "reasoning": "Противовъзпалително, сърдечно здраве",
      "timing": "С храна"
    }
  ],
  
  "psychologicalSupport": [
    "Техники за управление на стреса (медитация, дишане)",
    "Хранително дневник за проследяване на емоционално ядене",
    "Постепенни промени - фокус върху прогреса, не перфекцията"
  ],
  
  "expectedOutcomes": {
    "short_term": "Подобрена енергия и сън (2-4 седмици)",
    "medium_term": "Нормализиране на кръвна захар (1-3 месеца)",
    "long_term": "Постигане на целево тегло и здравни маркери (6-12 месеца)"
  }
}
```

### Какво се използва за следващи стъпки
- `dietaryModifier` → влияе на избора на храни
- `mealsPerDay` → определя структурата на деня
- `macroDistribution` → целеви макроси за всяко ядене
- `foodsToAvoid` → стриктни ограничения
- `mealTiming` → времеви рамки

---

## Стъпка 3: ХРАНИТЕЛЕН ПЛАН (Meal Plan) - Прогресивна Генерация

### Структура
Стъпка 3 се състои от **4 подстъпки** (chunks) за генериране на 7-дневен план:

1. **Подстъпка 3.1:** Ден 1-2
2. **Подстъпка 3.2:** Ден 3-4
3. **Подстъпка 3.3:** Ден 5-6
4. **Подстъпка 3.4:** Ден 7

### Цел на стъпката
Генериране на детайлни хранения с точни макронутриенти и описания.

### AI Заявка за всяка подстъпка (Input към AI)

**Тип:** `step3_meal_plan_chunk_1` до `step3_meal_plan_chunk_4`  
**Token Limit:** 8000 tokens (за всяка подстъпка)  
**Prompt съдържа:**
- Потребителски данни (компактен)
- **КОМПАКТЕН анализ** (само keyProblems, nutritionalDeficiencies)
- **КОМПАКТНА стратегия** (само ключови правила)
- Предишни дни (за разнообразие)
- ADLE v8 Whitelist/Blacklist (кеширани)
- Калории и макроси за деня
- Инструкции за ADLE v8 храносъставяне

### AI Отговор за всяка подстъпка (Output от AI)

**Очакван JSON формат (пример за Ден 1-2):**

```json
{
  "day1": {
    "date": "Понеделник",
    "totalCalories": 2100,
    "totalMacros": {
      "protein": 157,
      "carbs": 210,
      "fats": 70
    },
    "meals": [
      {
        "type": "Закуска",
        "time": "07:30",
        "name": "Омлет със зеленчуци и пълнозърнест хляб",
        "description": "3 яйца с домати, чушки и спанак, поднесени с 1 филийка пълнозърнест хляб",
        "ingredients": [
          "3 целеви яйца (210g)",
          "100g домати",
          "80g чушки",
          "50g бейби спанак",
          "1 филийка пълнозърнест хляб (50g)",
          "5мл зехтин за готвене"
        ],
        "calories": 450,
        "macros": {
          "protein": 28,
          "carbs": 35,
          "fats": 20
        },
        "cookingInstructions": "Разбий яйцата...",
        "notes": "Високопротеинова закуска за дълготрайна ситост"
      },
      {
        "type": "Обяд",
        "time": "12:30",
        "name": "Пилешко филе с киноа и зелена салата",
        "description": "Печено пилешко филе с киноа и разнообразна салата",
        "ingredients": [
          "150g пилешко филе",
          "100g киноа (сухо тегло)",
          "100g краставици",
          "100g домати",
          "50g зелена салата",
          "10мл зехтин",
          "Лимонов сок"
        ],
        "calories": 550,
        "macros": {
          "protein": 45,
          "carbs": 55,
          "fats": 12
        },
        "cookingInstructions": "Изпечи пилето...",
        "notes": "Комплексни въглехидрати с висок протеин"
      },
      {
        "type": "Следобедна закуска",
        "time": "16:00",
        "name": "Кисело мляко с ядки",
        "description": "Натурално кисело мляко с бадеми и семена",
        "ingredients": [
          "200g кисело мляко 2%",
          "20g бадеми",
          "10g чиа семена"
        ],
        "calories": 280,
        "macros": {
          "protein": 14,
          "carbs": 18,
          "fats": 16
        },
        "cookingInstructions": "Смесване",
        "notes": "Здравословни мазнини и пробиотици"
      },
      {
        "type": "Вечеря",
        "time": "19:00",
        "name": "Печена риба със задушени зеленчуци",
        "description": "Филе от риба със зеленчуци на пара",
        "ingredients": [
          "180g риба (сьомга или скумрия)",
          "150g броколи",
          "100g моркови",
          "80g тиквички",
          "10мл зехтин"
        ],
        "calories": 420,
        "macros": {
          "protein": 38,
          "carbs": 22,
          "fats": 18
        },
        "cookingInstructions": "Изпечи рибата...",
        "notes": "Лека вечеря, богата на омега-3"
      }
    ]
  },
  "day2": {
    "date": "Вторник",
    "totalCalories": 2050,
    "totalMacros": {
      "protein": 155,
      "carbs": 205,
      "fats": 68
    },
    "meals": [
      // Подобна структура...
    ]
  }
}
```

### Детайли за всяко ядене

**Задължителни полета за всяко meal:**
```json
{
  "type": "Закуска/Обяд/Следобедна закуска/Вечеря/Късна закуска",
  "time": "HH:MM",
  "name": "Кратко име на яденето",
  "description": "1-2 изречения описание",
  "ingredients": ["Списък с точни количества"],
  "calories": 450,
  "macros": {
    "protein": 28,
    "carbs": 35,
    "fats": 20
  },
  "cookingInstructions": "Стъпки за приготвяне",
  "notes": "Допълнителни бележки"
}
```

### ADLE v8 Валидация

Всяко ядене следва стриктни правила:
- **R1:** Протеин = точно 1 (exception: закуска с яйца може 0-1 secondary)
- **R2:** Зеленчуци = 1-2 (Салата ИЛИ Свежа гарнитура, НЕ и двете)
- **R3:** Енергия = 0-1 (никога 2)
- **R4:** Млечни = макс 1 на ядене
- **R5:** Мазнини = 0-1 (ако има ядки → без зехтин)
- **R6:** Сирене правило (ако сирене → без зехтин/масло)
- **R7:** Бекон правило (ако бекон → Fat=0)
- **R8:** Бобови като основно (боб/леща/нахут → Energy=0)

### Прогресивна Генерация - Резултат

След 4 подстъпки backend-ът комбинира резултатите в:

```json
{
  "weekPlan": {
    "day1": { /* Ден 1 данни */ },
    "day2": { /* Ден 2 данни */ },
    "day3": { /* Ден 3 данни */ },
    "day4": { /* Ден 4 данни */ },
    "day5": { /* Ден 5 данни */ },
    "day6": { /* Ден 6 данни */ },
    "day7": { /* Ден 7 данни */ }
  }
}
```

---

## Стъпка 4: РЕЗЮМЕ (Summary) - Препоръки и Добавки

### Цел на стъпката
Финализиране на плана с обща информация, препоръки и добавки.

### AI Заявка (Input към AI)
**Тип:** `step4_summary`  
**Token Limit:** 2000 tokens (lightweight)  
**Prompt съдържа:**
- Здравен контекст (кратки keyProblems)
- Whitelist/Blacklist храни
- Генериран weekPlan (за валидация)
- Стратегия (за consistency)

### AI Отговор (Output от AI)

**Очакван JSON формат:**

```json
{
  "summary": {
    "bmr": 1650,
    "dailyCalories": 2100,
    "macros": {
      "protein": 157,
      "carbs": 210,
      "fats": 70
    }
  },
  
  "recommendations": [
    "Консумирай зеленчуци при всяко хранене",
    "Пий вода 30 мин преди ядене",
    "Избягвай въглехидрати след 19:00",
    "Консумирай ферментирали храни за пробиотици"
  ],
  
  "forbidden": [
    "Рафинирана захар и сладкиши",
    "Преработени меса (колбаси, наденици)",
    "Лук (ADLE v8 забрана)",
    "Пуешко месо (ADLE v8 забрана)",
    "Транс-мазнини и фритюр"
  ],
  
  "psychology": [
    "Практикувай 10 мин медитация сутрин",
    "Води хранително дневник за емоции",
    "Спи минимум 7-8 часа",
    "Прави кратки разходки след ядене"
  ],
  
  "waterIntake": "2.5-3 литра дневно, разпределени равномерно",
  
  "supplements": [
    {
      "name": "Витамин D3",
      "dosage": "4000 IU дневно",
      "timing": "Сутрин с храна",
      "reason": "Дефицит (22 ng/mL), имунна подкрепа"
    },
    {
      "name": "Омега-3",
      "dosage": "1000-2000mg EPA+DHA",
      "timing": "С обяд или вечеря",
      "reason": "Противовъзпалително, кардиопротекция"
    },
    {
      "name": "Магнезий",
      "dosage": "300-400mg",
      "timing": "Вечер преди сън",
      "reason": "Стрес, мускулни крампи, сън"
    },
    {
      "name": "Пробиотици",
      "dosage": "10-15 милиарда CFU",
      "timing": "Сутрин на празен стомах",
      "reason": "Храносмилателно здраве, имунитет"
    }
  ]
}
```

---

## Финален Обект - Пълен План (Комбиниран Резултат)

### Какво връща backend към frontend

**Response от POST /api/generate-plan:**

```json
{
  "success": true,
  "userId": "user_abc123xyz789",
  "correctionAttempts": 0,
  "plan": {
    "analysis": {
      /* Стъпка 1 - Анализ */
      "bmr": 1650,
      "recommendedCalories": 2100,
      "bmi": 24.5,
      "bmiCategory": "Нормално тегло",
      "keyProblems": [ /* ... */ ],
      "metabolicProfile": { /* ... */ },
      "nutritionalDeficiencies": [ /* ... */ ],
      "digestiveHealth": { /* ... */ },
      "cardioMetabolicRisk": { /* ... */ },
      "psychologicalFactors": { /* ... */ },
      "keyCorrelations": [ /* ... */ ]
    },
    
    "strategy": {
      /* Стъпка 2 - Стратегия */
      "dietaryModifier": "Нискогликемичен",
      "welcomeMessage": "...",
      "planJustification": "...",
      "mealCountJustification": "...",
      "mealsPerDay": 4,
      "macroDistribution": { /* ... */ },
      "foodsToInclude": [ /* ... */ ],
      "foodsToAvoid": [ /* ... */ ],
      "mealTiming": { /* ... */ },
      "specialGuidelines": [ /* ... */ ],
      "hydrationStrategy": "...",
      "supplementRecommendations": [ /* ... */ ],
      "psychologicalSupport": [ /* ... */ ],
      "expectedOutcomes": { /* ... */ }
    },
    
    "weekPlan": {
      /* Стъпка 3 - Хранителен план (7 дни) */
      "day1": {
        "date": "Понеделник",
        "totalCalories": 2100,
        "totalMacros": { "protein": 157, "carbs": 210, "fats": 70 },
        "meals": [ /* 4 ядения */ ]
      },
      "day2": { /* ... */ },
      "day3": { /* ... */ },
      "day4": { /* ... */ },
      "day5": { /* ... */ },
      "day6": { /* ... */ },
      "day7": { /* ... */ }
    },
    
    "summary": {
      /* Стъпка 4 - Резюме */
      "bmr": 1650,
      "dailyCalories": 2100,
      "macros": { "protein": 157, "carbs": 210, "fats": 70 }
    },
    
    "recommendations": [ /* ... */ ],
    "forbidden": [ /* ... */ ],
    "psychology": [ /* ... */ ],
    "waterIntake": "2.5-3л дневно",
    "supplements": [ /* ... */ ],
    
    "_meta": {
      "tokenUsage": {
        "input": 8500,
        "output": 12000,
        "total": 20500
      },
      "generatedAt": "2026-02-10T01:35:00.000Z"
    }
  }
}
```

---

## Frontend - localStorage Структура

### Какво се запазва в браузъра

След успешно генериране, frontend-ът запазва следните данни:

```javascript
// 1. Пълният план
localStorage.setItem('dietPlan', JSON.stringify(result.plan));

// 2. User ID
localStorage.setItem('userId', result.userId);

// 3. Потребителски данни от въпросника
localStorage.setItem('userData', JSON.stringify(questionnaireAnswers));
```

### Структура на localStorage

```javascript
// dietPlan - Целият генериран план
{
  "analysis": { /* ... */ },
  "strategy": { /* ... */ },
  "weekPlan": { /* ... */ },
  "summary": { /* ... */ },
  "recommendations": [ /* ... */ ],
  "forbidden": [ /* ... */ ],
  "psychology": [ /* ... */ ],
  "waterIntake": "...",
  "supplements": [ /* ... */ ]
}

// userData - Въпросник отговори
{
  "name": "...",
  "age": 30,
  "weight": 75,
  // ... всички данни от въпросника
}

// userId - Уникален идентификатор
"user_abc123xyz789"
```

---

## Frontend Визуализация - plan.html

### Какви данни очаква frontend-ът

#### 1. Приветствие и Overview
```javascript
// От strategy
const welcomeMessage = dietPlan.strategy.welcomeMessage;
const justification = dietPlan.strategy.planJustification;
const modifier = dietPlan.strategy.dietaryModifier;
```

#### 2. Калории и Макроси
```javascript
// От summary
const calories = dietPlan.summary.dailyCalories;
const protein = dietPlan.summary.macros.protein;
const carbs = dietPlan.summary.macros.carbs;
const fats = dietPlan.summary.macros.fats;
```

#### 3. Седмичен План
```javascript
// От weekPlan
const day1 = dietPlan.weekPlan.day1;
const meals = day1.meals; // Array of meals

// За всяко ядене
meal.type        // "Закуска"
meal.time        // "07:30"
meal.name        // "Омлет със зеленчуци"
meal.description // "3 яйца със..."
meal.calories    // 450
meal.macros      // {protein: 28, carbs: 35, fats: 20}
meal.ingredients // ["3 яйца", "100g домати", ...]
```

#### 4. Препоръки и Забрани
```javascript
// От root level
const recommendations = dietPlan.recommendations; // Array
const forbidden = dietPlan.forbidden;             // Array
const psychology = dietPlan.psychology;           // Array
const supplements = dietPlan.supplements;         // Array
```

#### 5. Навигация между дни
```javascript
// Frontend итерира през day1-day7
for (let i = 1; i <= 7; i++) {
  const dayKey = `day${i}`;
  const dayData = dietPlan.weekPlan[dayKey];
  // Рендериране на деня
}
```

---

## Чат Функционалност (+1 Стъпка)

### Два Режима на Чат

#### 1. Consultation Mode (Консултация)
**Цел:** Отговаряне на въпроси за плана, съвети, мотивация

#### 2. Modification Mode (Модификация)
**Цел:** Промяна на плана (премахване на храни, промяна на броя ядения)

### Чат Заявка (Input към AI)

**Endpoint:** `POST /api/chat`

**JSON структура:**

```json
{
  "message": "Мога ли да премахна овесените ядки?",
  "userId": "user_abc123xyz789",
  "conversationId": "conv_xyz",
  "mode": "modification",
  
  "userData": {
    /* Пълни потребителски данни от въпросника */
    "name": "Иван",
    "age": 30,
    /* ... */
  },
  
  "userPlan": {
    /* КОМПАКТНА версия на плана */
    "summary": {
      "dailyCalories": 2100,
      "macros": { "protein": 157, "carbs": 210, "fats": 70 }
    },
    "weekPlan": {
      /* Компактна версия - само meal names, не пълни данни */
      "day1": {
        "meals": [
          { "type": "Закуска", "name": "Омлет със зеленчуци" },
          { "type": "Обяд", "name": "Пилешко с киноа" }
        ]
      }
      /* ... */
    }
  },
  
  "conversationHistory": [
    { "role": "user", "content": "Колко вода трябва да пия?" },
    { "role": "assistant", "content": "Препоръчвам 2.5-3 литра дневно..." },
    { "role": "user", "content": "Мога ли да премахна овесените ядки?" }
  ]
}
```

### Чат Отговор (Output от AI)

#### Consultation Mode
```json
{
  "response": "Да, можеш да премахнеш овесените ядки. Обаче това ще намали фибрите в закуската. Искаш ли да ги заменя с нещо друго или просто да ги премахна?",
  "conversationHistory": [
    /* Обновена история с новия обмен */
  ]
}
```

#### Modification Mode - С REGENERATE_PLAN

Ако AI реши да регенерира плана:

```json
{
  "response": "✓ Разбрано! Премахвам овесените ядки от всички дни на плана.\n\n[REGENERATE_PLAN:{\"modifications\":[\"exclude_food:овесени ядки\"]}]",
  "planWasUpdated": true,
  "updatedPlan": {
    /* Нов пълен план без овесени ядки */
  },
  "updatedUserData": {
    /* Обновени потребителски данни */
    "dietDislike": "спанак, карфиол, овесени ядки",
    "planModifications": []
  },
  "conversationHistory": [
    /* Обновена история */
  ]
}
```

### Поддържани Модификации

```javascript
// Модификации чрез REGENERATE_PLAN
const MODIFICATIONS = {
  // Структурни промени
  "no_intermediate_meals": "Без междинни хранения",
  "3_meals_per_day": "3 хранения дневно",
  "4_meals_per_day": "4 хранения дневно",
  
  // Диетични ограничения
  "vegetarian": "Вегетариански план",
  "no_dairy": "Без млечни продукти",
  "low_carb": "Нисковъглехидратна диета",
  "increase_protein": "Повече протеини",
  
  // Премахване на конкретна храна
  "exclude_food:име_на_храна": "Премахване на специфична храна"
};
```

### Frontend Обработка на Чат

```javascript
// Изпращане на съобщение
const chatRequest = {
  message: userMessage,
  userId: localStorage.getItem('userId'),
  conversationId: currentConversationId,
  mode: chatMode, // 'consultation' or 'modification'
  userData: JSON.parse(localStorage.getItem('userData')),
  userPlan: {
    summary: dietPlan.summary,
    weekPlan: compactWeekPlan(dietPlan.weekPlan) // Компактна версия
  },
  conversationHistory: chatHistory
};

// Обработка на отговор
if (response.planWasUpdated) {
  // Обнови localStorage с новия план
  localStorage.setItem('dietPlan', JSON.stringify(response.updatedPlan));
  localStorage.setItem('userData', JSON.stringify(response.updatedUserData));
  
  // Презареди страницата за визуализация на новия план
  location.reload();
} else {
  // Само добави съобщението в чата
  displayMessage(response.response);
}
```

---

## Валидация и Корекции

### Автоматична Валидация

Backend-ът валидира генерирания план през 12+ проверки:

1. **Анализ валидност** - Наличие на keyProblems, BMR, calories
2. **Стратегия валидност** - Наличие на dietaryModifier, justification
3. **Седмичен план** - 7 дни с meals
4. **Препоръки** - Forbidden foods, recommendations
5. **Забранени храни в план** - ADLE v8 blacklist проверка
6. **Цел-план съответствие** - Goal alignment
7. **Медицински условия** - Medical conditions alignment
8. **Диетични предпочитания** - Vegetarian/vegan compliance
9. **Повторение на храни** - Не повече от 3 пъти/седмица
10. **Анемия + вегетарианство** - Проверка за желязо
11. **Лекарства-добавки взаимодействия**
12. **ADLE v8 правила** - Strict meal constructor validation

### Корекционен Механизъм

Ако валидацията намери грешки:

```javascript
// Backend
if (!validation.isValid) {
  // Определи най-ранната стъпка с грешка
  const errorStep = validation.earliestErrorStep; // 1, 2, 3, или 4
  
  // Регенерирай само тази стъпка + следващите
  // Пример: Ако грешка в Strategy (стъпка 2)
  //   → Регенерирай стъпки 2, 3, 4
  //   → Запази стъпка 1 (Analysis)
  
  await regenerateFromStep(errorStep, errorPreventionComment);
}
```

**Max корекции:** 4 опита  
**Ако не успее:** Fallback към simplified план

---

## Резюме - Данни Потоци

### 1. План Генериране (7 AI заявки)

```
Клиент → POST userData
  ↓
Backend изчислява BMR, TDEE, BMI, calories
  ↓
Стъпка 1: Analysis (4k tokens) → analysis JSON
  ↓
Стъпка 2: Strategy (4k tokens) → strategy JSON
  ↓
Стъпка 3.1: Days 1-2 (8k tokens) → day1, day2 JSON
Стъпка 3.2: Days 3-4 (8k tokens) → day3, day4 JSON
Стъпка 3.3: Days 5-6 (8k tokens) → day5, day6 JSON
Стъпка 3.4: Day 7 (8k tokens) → day7 JSON
  ↓
Стъпка 4: Summary (2k tokens) → summary, recommendations JSON
  ↓
Комбиниране → Пълен план
  ↓
Валидация (12+ checks)
  ↓ (ако грешка)
Корекция (макс 4 опита)
  ↓
Backend → JSON response
  ↓
Клиент → localStorage (dietPlan, userData, userId)
  ↓
plan.html → Визуализация
```

### 2. Чат Комуникация (1 AI заявка на съобщение)

```
Клиент → POST message + userData + userPlan + history + mode
  ↓
Backend → Промпт с пълен контекст
  ↓
AI → Отговор (2k tokens)
  ↓
Backend → Проверка за [REGENERATE_PLAN:]
  ↓ (ако има)
Регенериране на план с модификации (7 AI заявки)
  ↓
Backend → response + updatedPlan + updatedUserData
  ↓
Клиент → Обнови localStorage + Визуализация
```

### 3. Данни, Които НЕ СЕ СЪХРАНЯВАТ на сървъра

```
❌ userData - Само в localStorage
❌ dietPlan - Само в localStorage  
❌ chatHistory - Само в localStorage
❌ userId - Генериран от backend, но не се съхранява

✅ Admin config - KV storage (prompts, AI settings)
```

---

## Технически Детайли

### Token Оптимизация

```
КОМПАКТЕН формат за Strategy (в prompts):
- Пълен JSON: 695 tokens
- Компактен: 167 tokens
- Спестяване: 76%

КОМПАКТЕН формат за Analysis:
- Пълен JSON: 524 tokens
- Компактен: 327 tokens
- Спестяване: 37.6%

ОБЩО спестяване: 59.1% (4799 → 1962 tokens)
```

### Кеширане

```javascript
// Food lists - 1x fetch вместо 4x
const cachedFoodLists = await getDynamicFoodListsSections(env);
// Използва се в 4-те подстъпки на meal plan

// Admin prompts - 5min cache
let chatPromptsCache = null;
let chatPromptsCacheTime = 0;
```

### Грешки и Retry

```javascript
// Автоматичен retry при transient грешки
const RETRYABLE_ERRORS = [502, 503, 504, 429, 'ECONNRESET', 'ETIMEDOUT'];
const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000; // ms

// Exponential backoff
delay = initialDelay * Math.pow(2, attempt);
```

---

## Заключение

Системата използва **Multi-Step Architecture с 4+1 стъпки** за създаване на дълбоко индивидуализиран, медицински обоснован хранителен план:

✅ **Стъпка 1 (Analysis):** Холистична здравна оценка  
✅ **Стъпка 2 (Strategy):** Персонализиран диетичен подход  
✅ **Стъпка 3 (Meal Plan):** Детайлни 7-дневни ядения (4 подстъпки)  
✅ **Стъпка 4 (Summary):** Препоръки и добавки  
✅ **+1 (Chat):** Консултация и модификация на плана  

**Privacy-First:** Всички потребителски данни се съхраняват в localStorage, НИКОГА на сървъра.

**AI-Powered:** 7 AI заявки за генериране + неограничени за чат консултации.

**Validation-Heavy:** 12+ автоматични проверки + до 4 корекционни опита.

**ADLE v8 Compliant:** Стриктни правила за хранително съставяне базирани на meallogic.txt.
