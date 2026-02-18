# Plan2 Промпт Структура - Документация на Разделянето на Данни

## Обща информация

Този документ описва новата структура на промптовете в Plan2 и съответните KV промпти, където данните са ясно разделени на 3 сектора според предназначението им.

## Принципи на разделянето

Всяка стъпка в процеса на генериране на план има ясно дефинирани:

1. **СЕКТОР 1: ВХОДНИ ДАННИ - ОБРАБОТКА И АНАЛИЗ**
   - Цел: Вътрешна обработка, валидация, корекции на изчисления
   - Използване: Backend обработка, стратегически решения

2. **СЕКТОР 2: ДАННИ ЗА FRONTEND ПАРСВАНЕ**
   - Цел: Директно показване на потребителя
   - Използване: UI елементи, съобщения, графики, образование

3. **СЕКТОР 3: ДАННИ ЗА СЛЕДВАЩА СТЪПКА**
   - Цел: Предаване на контекст към следващата стъпка
   - Бележка: Данните се предават в КОМПАКТЕН формат за ефективност

## Структура на стъпките

### Стъпка 1: Анализ (Analysis)

**Вход:**
- Клиентски данни (userData) - пълен профил
- Backend референтни изчисления - BMR, TDEE, активност скор, макроси

**Цели:**
- Анализ: Холистичен здравословен и метаболитен анализ
- Frontend: Здравен статус, ключови проблеми, прогнози
- Следваща стъпка: Метаболитен профил, психопрофил, хранителни нужди

**Изход - Сектор 1 (Backend Processing):**
```
bmi, bmiCategory, bmr, tdee, recommendedCalories
macroRatios, macroGrams, activityLevel, physiologicalPhase
waterDeficit, negativeHealthFactors, hinderingFactors
cumulativeRiskScore, psychoProfile, metabolicReactivity
correctedMetabolism
```

**Изход - Сектор 2 (Frontend Display):**
```
currentHealthStatus (score, description, keyIssues)
forecastPessimistic (timeframe, weight, health, risks)
forecastOptimistic (timeframe, weight, health, improvements)
keyProblems (title, description, severity, category, impact)
```

**Изход - Сектор 3 (Pass to Step 2):**
```
metabolicProfile, healthRisks, nutritionalNeeds
psychologicalProfile, successChance
```

---

### Стъпка 2: Стратегия (Strategy)

**Вход:**
- Клиентски данни (userData) - пълен профил
- Резултат от Стъпка 1 (analysis) - КОМПАКТЕН формат

**Цели:**
- Анализ: Определяне на диетична СТРУКТУРА/АРХИТЕКТУРА
- Frontend: welcomeMessage, обосновки, психологическа подкрепа
- Следваща стъпка: Правила и параметри за генериране на хранения

**Изход - Сектор 1 (Backend Processing):**
```
dietaryModifier, modifierReasoning
mealCountJustification, afterDinnerMealJustification
dietType, breakfastStrategy
```

**Изход - Сектор 2 (Frontend Display):**
```
welcomeMessage, planJustification, longTermStrategy
weeklyMealPattern, hydrationStrategy
communicationStyle (temperament, tone, approach, chatGuidelines)
psychologicalSupport (3 съвета)
```

**Изход - Сектор 3 (Pass to Step 3):**
```
weeklyScheme (monday-sunday: meals, description)
calorieDistribution, macroDistribution
mealTiming (pattern, fastingWindows, flexibility, chronotypeGuidance)
keyPrinciples, foodsToInclude, foodsToAvoid
supplementRecommendations
```

---

### Стъпка 3: Хранителен план (Meal Plan)

**Вход:**
- Клиентски данни - основен профил
- Резултат от Стъпка 1 - МИНИМАЛЕН формат (bmr, macroGrams)
- Резултат от Стъпка 2 - КОМПАКТЕН формат (правила и ограничения)
- Предишни дни - за разнообразие (при chunk генериране)

**Цели:**
- Анализ: Генериране на конкретни ястия според стратегията
- Frontend: Готови хранения за показване
- Следваща стъпка: Данни за summary (средни стойности)

**Изход - Сектор 1 (Backend Processing):**
```
(използва данните от Стъпка 1 и 2 за генериране)
```

**Изход - Сектор 2 (Frontend Display):**
```
day1-day7:
  meals (type, name, weight, description, benefits, calories, macros)
  dailyTotals (calories, protein, carbs, fats)
```

**Изход - Сектор 3 (Pass to Step 4):**
```
(Backend изчислява автоматично):
avgCalories, avgProtein, avgCarbs, avgFats
```

---

### Стъпка 4: Резюме (Summary)

**Вход:**
- Клиентски данни - име, цел, здравни проблеми
- Резултат от Стъпка 1 - BMR, keyProblems
- Резултат от Стъпка 2 - psychologicalSupport, hydrationStrategy
- Резултат от Стъпка 3 - агрегирани данни (avgCalories, avgMacros)
- Динамични списъци - whitelist/blacklist от KV storage

**Цели:**
- Анализ: Обобщаване на плана, проверка на съответствие
- Frontend: Summary, препоръки, психология, добавки
- Следваща стъпка: Няма (финална стъпка)

**Изход - Сектор 1 (Backend Processing):**
```
summary (bmr, dailyCalories, macros)
```

**Изход - Сектор 2 (Frontend Display):**
```
recommendations (списък храни за включване)
forbidden (списък храни за избягване)
psychology (3 психологически съвета)
waterIntake (препоръки за хидратация)
supplements (3 добавки с дозировка)
```

**Изход - Сектор 3 (Next Step):**
```
Няма - финална стъпка
```

---

## Файлове, засегнати от промените

### План2 (основен файл)
- `/home/runner/work/aidiet/aidiet/Plan2`
- Съдържа: Пълни промпти за стъпки 1-4 с документация и разделяне

### KV Промпти (backend storage)
- `/home/runner/work/aidiet/aidiet/KV/prompts/admin_analysis_prompt.txt` (Стъпка 1)
- `/home/runner/work/aidiet/aidiet/KV/prompts/admin_strategy_prompt.txt` (Стъпка 2)
- `/home/runner/work/aidiet/aidiet/KV/prompts/admin_meal_plan_prompt.txt` (Стъпка 3)
- `/home/runner/work/aidiet/aidiet/KV/prompts/admin_summary_prompt.txt` (Стъпка 4)

Всички файлове са **синхронизирани** и следват еднаква структура.

---

## Предимства на новата структура

1. **Яснота**: Всеки промпт ясно показва какви данни очаква и какви данни връща
2. **Документация**: Всяка стъпка има хедър с вход/цели/изход
3. **Разделяне на отговорностите**: 
   - Backend обработва само необходимото
   - Frontend получава само това, което показва
   - Следваща стъпка получава само контекста
4. **Оптимизация**: Ясно е къде данните се компактират за ефективност
5. **Поддръжка**: Лесно е да се види какво се използва къде

---

## Важни бележки

- **Нула промени в JSON полетата**: Всички промени са само коментари и документация
- **Запазена функционалност**: Системата работи идентично, само е по-добре документирана
- **Компактни формати**: Стъпки 2 и 3 получават данните в оптимизиран формат (76% и 37.6% редукция)
- **Backend изчисления**: Някои данни (като avgCalories) се изчисляват автоматично от backend

---

## Използване

При четене на промптите:
1. Погледнете хедъра (═══) за да разберете какво влиза и какво е целта
2. В JSON формата потърсете коментарите за СЕКТОР X
3. Разберете къде отиват данните според секторите

При промяна на промптите:
1. Запазете структурата на секторите
2. Добавяйте полета в правилния сектор според тяхното предназначение
3. Синхронизирайте промените между Plan2 и KV промптите

---

Последна актуализация: 2026-02-18
Създадено в рамките на Issue: Разделяне на данните в Plan2 промпти
