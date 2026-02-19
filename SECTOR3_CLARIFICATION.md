# ЯСНО ОБЯСНЕНИЕ: Какво е Сектор 3 и какво се предава между стъпките

## ❓ Въпросът на потребителя

> "означава ли това, че всичко, което попада в сектор 3 при промпта ще бъде само и единствено то предадено на останалите стъпки и няма да има смесено предаване с други елементи и анализи извън засегнатите в сектор 3."

## ✅ ОТГОВОР: НЕ

**Сектор 3 НЕ е единственото което се предава.**

## 📊 Визуално обяснение

### Стъпка 1 → Стъпка 2

```
┌─────────────────────────────────────────────────┐
│         ЩО ГЕНЕРИРА СТЪПКА 1?                  │
├─────────────────────────────────────────────────┤
│ СЕКТОР 1: BMR, TDEE, macroRatios и др.        │
│ СЕКТОР 2: currentHealthStatus, keyProblems    │
│ СЕКТОР 3: metabolicProfile, psychoProfile     │ ◄─┐
└─────────────────────────────────────────────────┘   │
                                                       │
                                                       │ Само Сектор 3
                                                       │ от Стъпка 1
┌─────────────────────────────────────────────────┐   │
│       ЩО ПОЛУЧАВА СТЪПКА 2?                    │   │
├─────────────────────────────────────────────────┤   │
│ 1. userData (от въпросника)                    │ ◄─┼─ ВИНАГИ се предава
│    - name, age, goal                            │   │
│    - dietPreference, dietDislike, dietLove      │   │
│    - eatingHabits, chronotype                   │   │
│    - всички други данни от потребителя          │   │
│                                                 │   │
│ 2. Сектор 3 от Стъпка 1                       │ ◄─┘
│    - metabolicProfile                           │
│    - psychoProfile                              │
│    - healthRisks                                │
│    - nutritionalNeeds                           │
│    - psychologicalProfile                       │
│    - successChance                              │
└─────────────────────────────────────────────────┘
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
