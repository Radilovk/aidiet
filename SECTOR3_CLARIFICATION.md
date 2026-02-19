# ЯСНО ОБЯСНЕНИЕ: Какво е Сектор 3 и как работи data flow

## ❓ Въпросът

Какво съдържа Сектор 3 и как данните се предават между стъпките?

## ✅ ОТГОВОР

### Какво е Сектор 3?

**Сектор 3 = ИЗХОД от текущата стъпка**

**Този изход се предава като ВХОДНИ ДАННИ в СЕКТОР 1 на следващата стъпка за обработка**

## 📊 Правилното разбиране

### Секторите в една стъпка:

```
┌─────────────────────────────────────────────────┐
│               СТЪПКА N                          │
├─────────────────────────────────────────────────┤
│                                                 │
│  СЕКТОР 1: ВХОДНИ ДАННИ И ОБРАБОТКА            │
│  ┌──────────────────────────────────────────┐  │
│  │ Получава:                                │  │
│  │  - userData (от въпросника)              │  │
│  │  - Сектор 3 от предишни стъпки           │  │
│  │  - Допълнителни елементи                 │  │
│  │                                          │  │
│  │ Обработва и анализира тези данни         │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  СЕКТОР 2: ИЗХОД ЗА FRONTEND                   │
│  ┌──────────────────────────────────────────┐  │
│  │ Генерира данни за показване:             │  │
│  │  - UI елементи                           │  │
│  │  - Съобщения                             │  │
│  │  - Графики                               │  │
│  │                                          │  │
│  │ → НЕ се предава на следващи стъпки       │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  СЕКТОР 3: ИЗХОД ЗА СЛЕДВАЩА СТЪПКА            │
│  ┌──────────────────────────────────────────┐  │
│  │ Генерира данни за следваща стъпка:       │  │
│  │  - Обработени резултати                  │  │
│  │  - Анализирана информация                │  │
│  │                                          │  │
│  │ → Предава се в Сектор 1 на следваща      │  │
│  └──────────────────────────────────────────┘  │
│                    ↓                            │
└────────────────────┼────────────────────────────┘
                     ↓
         Става ВХОД в Сектор 1 на следваща стъпка
```

## 🎯 Data Flow между стъпките

## 🎯 Data Flow между стъпките

### Стъпка 1 → Стъпка 2

```
┌─────────────────────────────────────────────────┐
│            СТЪПКА 1: АНАЛИЗ                     │
├─────────────────────────────────────────────────┤
│ СЕКТОР 1 (Вход и обработка):                   │
│  - userData (въпросник)                         │
│  - Backend изчисления (BMR, TDEE и др.)         │
│           ↓ АНАЛИЗ И ОБРАБОТКА ↓                │
│                                                 │
│ СЕКТОР 2 (Изход за Frontend):                  │
│  - currentHealthStatus                          │
│  - keyProblems                                  │
│  - forecastPessimistic/Optimistic               │
│           → Показва се на потребителя           │
│                                                 │
│ СЕКТОР 3 (Изход за Стъпка 2):                  │ ◄─┐
│  - metabolicProfile                             │   │
│  - psychoProfile                                │   │
│  - healthRisks                                  │   │ Изход от
│  - nutritionalNeeds                             │   │ Стъпка 1
│  - psychologicalProfile                         │   │
│  - successChance                                │   │
└─────────────────────────────────────────────────┘   │
                                                      │
                    ↓ Предава се като вход ↓          │
                                                      │
┌─────────────────────────────────────────────────┐   │
│          СТЪПКА 2: СТРАТЕГИЯ                    │   │
├─────────────────────────────────────────────────┤   │
│ СЕКТОР 1 (Вход и обработка):                   │ ◄─┘
│  - userData (въпросник)                         │
│  - Сектор 3 от Стъпка 1:                       │ ◄─── Получава
│    • metabolicProfile                           │      и
│    • psychoProfile                              │      обработва
│    • healthRisks                                │
│    • nutritionalNeeds                           │
│    • psychologicalProfile                       │
│    • successChance                              │
│           ↓ АНАЛИЗ И ГЕНЕРИРАНЕ СТРАТЕГИЯ ↓     │
│                                                 │
│ СЕКТОР 2 (Изход за Frontend):                  │
│  - welcomeMessage                               │
│  - planJustification                            │
│  - psychologicalSupport                         │
│           → Показва се на потребителя           │
│                                                 │
│ СЕКТОР 3 (Изход за Стъпка 3):                  │ ◄─┐
│  - weeklyScheme                                 │   │
│  - keyPrinciples                                │   │ Изход от
│  - foodsToInclude                               │   │ Стъпка 2
│  - foodsToAvoid                                 │   │
│  - calorieDistribution                          │   │
│  - macroDistribution                            │   │
└─────────────────────────────────────────────────┘   │
                    ↓                                  │
              (и т.н. за Стъпка 3)                    │
```

### Стъпка 2 → Стъпка 3

```
┌─────────────────────────────────────────────────┐
│         ЩО ГЕНЕРИРА СТЪПКА 2?                  │
├─────────────────────────────────────────────────┤
│ СЕКТОР 1: dietaryModifier, dietType и др.     │
│ СЕКТОР 2: welcomeMessage, planJustification   │
│ СЕКТОР 3: weeklyScheme, keyPrinciples и др.   │ ◄─┐
└─────────────────────────────────────────────────┘   │
                                                       │
┌─────────────────────────────────────────────────┐   │
│       ЩО ПОЛУЧАВА СТЪПКА 3?                    │   │
├─────────────────────────────────────────────────┤   │
│ 1. userData (от въпросника)                    │ ◄─┼─ ВИНАГИ се предава
│    - name, age, goal                            │   │
│    - dietDislike, dietLove                      │   │
│    - stressLevel, sleepHours, chronotype        │   │
│                                                 │   │
│ 2. Сектор 3 от Стъпка 1                       │ ◄─┼─ От предишни стъпки
│    - macroGrams, recommendedCalories            │   │
│                                                 │   │
│ 3. Сектор 3 от Стъпка 2                       │ ◄─┘
│    - weeklyScheme                               │
│    - keyPrinciples                              │
│    - foodsToInclude, foodsToAvoid               │
│    - calorieDistribution, macroDistribution     │
│                                                 │
│ 4. Допълнителни елементи от KV storage         │ ◄─── ДОПЪЛНИТЕЛНО
│    - dynamicWhitelistSection                    │
│    - dynamicBlacklistSection                    │
│                                                 │
│ 5. previousDays (за разнообразие)              │ ◄─── ДОПЪЛНИТЕЛНО
└─────────────────────────────────────────────────┘
```

### Стъпка 3 → Стъпка 4

```
┌─────────────────────────────────────────────────┐
│         ЩО ГЕНЕРИРА СТЪПКА 3?                  │
├─────────────────────────────────────────────────┤
│ СЕКТОР 2: weekPlan (meals за 7 дни)           │
│ СЕКТОР 3: (средни стойности - от backend)     │
└─────────────────────────────────────────────────┘
                                                    
┌─────────────────────────────────────────────────┐
│       ЩО ПОЛУЧАВА СТЪПКА 4?                    │
├─────────────────────────────────────────────────┤
│ 1. userData (частични)                         │ ◄─── ВИНАГИ се предава
│    - name, goal                                 │
│    - medicalConditions, medications, allergies  │
│                                                 │
│ 2. Избрани от Стъпка 1                        │ ◄─── От предишни стъпки
│    - BMR, keyProblems                           │
│                                                 │
│ 3. Избрани от Стъпка 2                        │
│    - psychologicalSupport                       │
│    - hydrationStrategy                          │
│                                                 │
│ 4. Агрегирани от Стъпка 3 (backend)           │
│    - avgCalories, avgProtein, avgCarbs, avgFats │
│                                                 │
│ 5. Допълнителни елементи от KV storage         │ ◄─── ДОПЪЛНИТЕЛНО
│    - dynamicWhitelistSection                    │
│    - dynamicBlacklistSection                    │
└─────────────────────────────────────────────────┘
```

## 🎯 ЗАКЛЮЧЕНИЕ

### Какво е Сектор 3?

**Сектор 3 = Данни от АНАЛИЗА на текущата стъпка, които са полезни за следващата**

### Какво се предава между стъпките?

**ПЪЛНАТА формула:**

```
Вход на Стъпка N = 
    userData (въпросник) +
    Сектор 3 от предишни стъпки +
    Допълнителни елементи (whitelists, blacklists и др.)
```

### Отговор на въпроса

❌ **НЕ**, Сектор 3 НЕ е единственото което се предава

✅ **ДА**, има "смесено предаване" с:
- userData (отговорите от въпросника)
- Допълнителни елементи (whitelists, blacklists, previousDays)

## 📝 Примери от реалния код (worker.js)

### generateStrategyPrompt (Стъпка 2)

```javascript
// Линия 4560 в worker.js
let prompt = replacePromptVariables(customPrompt, {
  userData: data,              // ← ПЪЛНИ клиентски данни
  analysisData: analysisCompact, // ← Сектор 3 от Стъпка 1
  // ...още променливи от userData
  dietPreference: JSON.stringify(data.dietPreference || []),
  dietDislike: data.dietDislike || '',
  dietLove: data.dietLove || '',
  additionalNotes: data.additionalNotes || '',
  eatingHabits: JSON.stringify(data.eatingHabits || []),
  chronotype: data.chronotype || 'Среден тип'
});
```

### generateMealPlanChunkPrompt (Стъпка 3)

```javascript
// Линия 1539-1574 в worker.js
const strategyCompact = {
  // Сектор 3 от Стъпка 2
  dietType: strategy.dietType || 'Балансирана',
  weeklyScheme: strategy.weeklyScheme || null,
  keyPrinciples: (strategy.keyPrinciples || []).join('; '),
  foodsToInclude: (strategy.foodsToInclude || []).join(', '),
  foodsToAvoid: (strategy.foodsToAvoid || []).join(', '),
  // ...
};

// Линия 1565-1574
// Допълнителни елементи от KV storage
let dynamicWhitelistSection, dynamicBlacklistSection;
if (cachedFoodLists) {
  dynamicWhitelistSection = cachedFoodLists.dynamicWhitelistSection;
  dynamicBlacklistSection = cachedFoodLists.dynamicBlacklistSection;
} else {
  const foodLists = await getDynamicFoodListsSections(env);
  dynamicWhitelistSection = foodLists.dynamicWhitelistSection;
  dynamicBlacklistSection = foodLists.dynamicBlacklistSection;
}

// Plus: userData, analysisCompact, previousDays
```

## ✨ Обобщение

| Компонент | Какво съдържа | Предава се към |
|-----------|---------------|----------------|
| **userData** | Всички отговори от въпросника | ВСИЧКИ стъпки |
| **Сектор 1** | Backend обработка, изчисления | Само текущата стъпка |
| **Сектор 2** | Данни за Frontend display | Frontend (не се предава) |
| **Сектор 3** | Данни от анализа на стъпката | Следващата стъпка |
| **Допълнителни** | whitelists, blacklists и др. | Специфични стъпки |

---

**Дата:** 19 февруари 2026  
**Статус:** ✅ Разяснено и документирано  
**Актуализирани файлове:** Plan2, всички KV промпти, документация
