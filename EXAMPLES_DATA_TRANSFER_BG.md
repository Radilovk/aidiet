# Практически Примери за Контрол на Данни между Стъпките

## 🎯 Цел на този Документ

Този документ съдържа **конкретни примери** как да контролирате кои данни се пренасят между стъпките при генериране на хранителен план.

---

## 📝 Пример 1: Добавяне на Темперамент от Стъпка 1 към Стъпка 2

### Задача
Искате стратегията да използва **психологическия темперамент** от анализа, за да персонализира комуникацията.

### Решение 1: САМО промяна на промптовете (АКО темперамента вече е в analysisCompact)

#### Стъпка 1.1: Проверете дали `analysisCompact` съдържа темперамента

```bash
cd /home/runner/work/aidiet/aidiet
grep -A 20 "const analysisCompact = {" worker.js | grep temperament
```

**Резултат**: Ако НЕ намерите `temperament` в `analysisCompact`, преминете към Решение 2.

#### Стъпка 1.2: Ако темперамента липсва, преминете към Решение 2

### Решение 2: Промяна на worker.js (препоръчително за този случай)

#### Стъпка 2.1: Добавете `temperament` към `analysisCompact`

Редактирайте `worker.js`, ред 4524-4549:

```javascript
// ПРЕДИ:
const analysisCompact = {
  bmr: analysis.bmr || 'не изчислен',
  tdee: analysis.tdee || 'не изчислен',
  recommendedCalories: analysis.recommendedCalories || 'не изчислен',
  macroRatios: analysis.macroRatios ? 
    `Protein: ${analysis.macroRatios.protein != null ? analysis.macroRatios.protein + '%' : 'N/A'}, Carbs: ${analysis.macroRatios.carbs != null ? analysis.macroRatios.carbs + '%' : 'N/A'}, Fats: ${analysis.macroRatios.fats != null ? analysis.macroRatios.fats + '%' : 'N/A'}` : 
    'не изчислени',
  // ... останалите полета ...
  keyProblems: (analysis.keyProblems || [])
    .filter(p => p && p.title && p.severity)
    .slice(0, 3)
    .map(p => `${p.title} (${p.severity})`)
    .join('; ')
};

// СЛЕД:
const analysisCompact = {
  bmr: analysis.bmr || 'не изчислен',
  tdee: analysis.tdee || 'не изчислен',
  recommendedCalories: analysis.recommendedCalories || 'не изчислен',
  macroRatios: analysis.macroRatios ? 
    `Protein: ${analysis.macroRatios.protein != null ? analysis.macroRatios.protein + '%' : 'N/A'}, Carbs: ${analysis.macroRatios.carbs != null ? analysis.macroRatios.carbs + '%' : 'N/A'}, Fats: ${analysis.macroRatios.fats != null ? analysis.macroRatios.fats + '%' : 'N/A'}` : 
    'не изчислени',
  // ... останалите полета ...
  keyProblems: (analysis.keyProblems || [])
    .filter(p => p && p.title && p.severity)
    .slice(0, 3)
    .map(p => `${p.title} (${p.severity})`)
    .join('; '),
  
  // НОВА ДОБАВКА:
  temperament: analysis.psychoProfile?.temperament || 'не е определен'
};
```

#### Стъпка 2.2: Добавете `temperament` към default промпта

Редактирайте `worker.js`, ред 4651 (в `defaultPrompt`):

```javascript
// ПРЕДИ:
defaultPrompt += `Базирайки се на здравословния профил и анализа, определи оптималната диетична стратегия:

КЛИЕНТ: ${data.name}, ${data.age} год., Цел: ${data.goal}

АНАЛИЗ (КОМПАКТЕН):
- BMR/TDEE/Калории: ${analysisCompact.bmr} / ${analysisCompact.tdee} / ${analysisCompact.recommendedCalories}
- Макро съотношения: ${analysisCompact.macroRatios}
- Макро грамове дневно: ${analysisCompact.macroGrams}
- Метаболитен профил: ${analysisCompact.metabolicProfile}
- Здравни рискове: ${analysisCompact.healthRisks}
- Хранителни нужди: ${analysisCompact.nutritionalNeeds}
- Психологически профил: ${analysisCompact.psychologicalProfile}
- Шанс за успех: ${analysisCompact.successChance}
- Ключови проблеми: ${analysisCompact.keyProblems}
`;

// СЛЕД:
defaultPrompt += `Базирайки се на здравословния профил и анализа, определи оптималната диетична стратегия:

КЛИЕНТ: ${data.name}, ${data.age} год., Цел: ${data.goal}

АНАЛИЗ (КОМПАКТЕН):
- BMR/TDEE/Калории: ${analysisCompact.bmr} / ${analysisCompact.tdee} / ${analysisCompact.recommendedCalories}
- Макро съотношения: ${analysisCompact.macroRatios}
- Макро грамове дневно: ${analysisCompact.macroGrams}
- Метаболитен профил: ${analysisCompact.metabolicProfile}
- Здравни рискове: ${analysisCompact.healthRisks}
- Хранителни нужди: ${analysisCompact.nutritionalNeeds}
- Психологически профил: ${analysisCompact.psychologicalProfile}
- Темперамент: ${analysisCompact.temperament}  // НОВА ДОБАВКА
- Шанс за успех: ${analysisCompact.successChance}
- Ключови проблеми: ${analysisCompact.keyProblems}
`;
```

#### Стъпка 2.3: Добавете `temperament` към `replacePromptVariables()`

Редактирайте `worker.js`, ред 4554 (след другите променливи):

```javascript
// ПРЕДИ:
let prompt = replacePromptVariables(customPrompt, {
  userData: data,
  analysisData: analysisCompact,
  name: data.name,
  age: data.age,
  goal: data.goal,
  bmr: analysisCompact.bmr,
  tdee: analysisCompact.tdee,
  recommendedCalories: analysisCompact.recommendedCalories,
  macroRatios: analysisCompact.macroRatios,
  macroGrams: analysisCompact.macroGrams,
  metabolicProfile: analysisCompact.metabolicProfile,
  healthRisks: analysisCompact.healthRisks,
  nutritionalNeeds: analysisCompact.nutritionalNeeds,
  psychologicalProfile: analysisCompact.psychologicalProfile,
  successChance: analysisCompact.successChance,
  keyProblems: analysisCompact.keyProblems,
  dietPreference: JSON.stringify(data.dietPreference || []),
  dietPreference_other: data.dietPreference_other || '',
  dietDislike: data.dietDislike || '',
  dietLove: data.dietLove || '',
  additionalNotes: data.additionalNotes || '',
  eatingHabits: JSON.stringify(data.eatingHabits || []),
  chronotype: data.chronotype || 'Среден тип'
});

// СЛЕД:
let prompt = replacePromptVariables(customPrompt, {
  userData: data,
  analysisData: analysisCompact,
  name: data.name,
  age: data.age,
  goal: data.goal,
  bmr: analysisCompact.bmr,
  tdee: analysisCompact.tdee,
  recommendedCalories: analysisCompact.recommendedCalories,
  macroRatios: analysisCompact.macroRatios,
  macroGrams: analysisCompact.macroGrams,
  metabolicProfile: analysisCompact.metabolicProfile,
  healthRisks: analysisCompact.healthRisks,
  nutritionalNeeds: analysisCompact.nutritionalNeeds,
  psychologicalProfile: analysisCompact.psychologicalProfile,
  temperament: analysisCompact.temperament, // НОВА ДОБАВКА
  successChance: analysisCompact.successChance,
  keyProblems: analysisCompact.keyProblems,
  dietPreference: JSON.stringify(data.dietPreference || []),
  dietPreference_other: data.dietPreference_other || '',
  dietDislike: data.dietDislike || '',
  dietLove: data.dietLove || '',
  additionalNotes: data.additionalNotes || '',
  eatingHabits: JSON.stringify(data.eatingHabits || []),
  chronotype: data.chronotype || 'Среден тип'
});
```

#### Стъпка 2.4: Редактирайте KV промпта

Редактирайте `KV/prompts/admin_strategy_prompt.txt`:

```
// ПРЕДИ:
АНАЛИЗ (КОМПАКТЕН):
- BMR/TDEE/Калории: ${bmr} / ${tdee} / ${recommendedCalories}
- Макро съотношения: ${macroRatios}
- Макро грамове дневно: ${macroGrams}
- Метаболитен профил: ${metabolicProfile}
- Здравни рискове: ${healthRisks}
- Хранителни нужди: ${nutritionalNeeds}
- Психологически профил: ${psychologicalProfile}
- Шанс за успех: ${successChance}
- Ключови проблеми: ${keyProblems}

// СЛЕД:
АНАЛИЗ (КОМПАКТЕН):
- BMR/TDEE/Калории: ${bmr} / ${tdee} / ${recommendedCalories}
- Макро съотношения: ${macroRatios}
- Макро грамове дневно: ${macroGrams}
- Метаболитен профил: ${metabolicProfile}
- Здравни рискове: ${healthRisks}
- Хранителни нужди: ${nutritionalNeeds}
- Психологически профил: ${psychologicalProfile}
- Темперамент: ${temperament}  // НОВА ДОБАВКА
- Шанс за успех: ${successChance}
- Ключови проблеми: ${keyProblems}
```

#### Стъпка 2.5: Качете промпта към KV

```bash
cd /home/runner/work/aidiet/aidiet
./KV/upload-kv-keys.sh
```

### Резултат

Сега стратегията ще получава темперамента от анализа и ще може да го използва за персонализация на `communicationStyle`.

---

## 📝 Пример 2: Премахване на Метаболитен Профил от Стъпка 1 към Стъпка 2

### Задача
Искате да **намалите размера на промпта** като премахнете метаболитния профил от данните, изпращани към Стъпка 2.

### Решение: Промяна на worker.js

#### Стъпка 1: Премахнете `metabolicProfile` от `analysisCompact`

Редактирайте `worker.js`, ред 4524-4549:

```javascript
// ПРЕДИ:
const analysisCompact = {
  bmr: analysis.bmr || 'не изчислен',
  tdee: analysis.tdee || 'не изчислен',
  recommendedCalories: analysis.recommendedCalories || 'не изчислен',
  macroRatios: analysis.macroRatios ? 
    `Protein: ${analysis.macroRatios.protein != null ? analysis.macroRatios.protein + '%' : 'N/A'}, Carbs: ${analysis.macroRatios.carbs != null ? analysis.macroRatios.carbs + '%' : 'N/A'}, Fats: ${analysis.macroRatios.fats != null ? analysis.macroRatios.fats + '%' : 'N/A'}` : 
    'не изчислени',
  macroGrams: analysis.macroGrams ?
    `Protein: ${analysis.macroGrams.protein != null ? analysis.macroGrams.protein + 'g' : 'N/A'}, Carbs: ${analysis.macroGrams.carbs != null ? analysis.macroGrams.carbs + 'g' : 'N/A'}, Fats: ${analysis.macroGrams.fats != null ? analysis.macroGrams.fats + 'g' : 'N/A'}` :
    'не изчислени',
  metabolicProfile: (analysis.metabolicProfile || '').length > 200 ? 
    (analysis.metabolicProfile || '').substring(0, 200) + '...' : 
    (analysis.metabolicProfile || 'не е анализиран'),
  // ... останалите полета ...
};

// СЛЕД:
const analysisCompact = {
  bmr: analysis.bmr || 'не изчислен',
  tdee: analysis.tdee || 'не изчислен',
  recommendedCalories: analysis.recommendedCalories || 'не изчислен',
  macroRatios: analysis.macroRatios ? 
    `Protein: ${analysis.macroRatios.protein != null ? analysis.macroRatios.protein + '%' : 'N/A'}, Carbs: ${analysis.macroRatios.carbs != null ? analysis.macroRatios.carbs + '%' : 'N/A'}, Fats: ${analysis.macroRatios.fats != null ? analysis.macroRatios.fats + '%' : 'N/A'}` : 
    'не изчислени',
  macroGrams: analysis.macroGrams ?
    `Protein: ${analysis.macroGrams.protein != null ? analysis.macroGrams.protein + 'g' : 'N/A'}, Carbs: ${analysis.macroGrams.carbs != null ? analysis.macroGrams.carbs + 'g' : 'N/A'}, Fats: ${analysis.macroGrams.fats != null ? analysis.macroGrams.fats + 'g' : 'N/A'}` :
    'не изчислени',
  // ПРЕМАХНАТО: metabolicProfile
  // ... останалите полета ...
};
```

#### Стъпка 2: Премахнете `metabolicProfile` от default промпта

Редактирайте `worker.js`, ред 4651:

```javascript
// ПРЕДИ:
АНАЛИЗ (КОМПАКТЕН):
- BMR/TDEE/Калории: ${analysisCompact.bmr} / ${analysisCompact.tdee} / ${analysisCompact.recommendedCalories}
- Макро съотношения: ${analysisCompact.macroRatios}
- Макро грамове дневно: ${analysisCompact.macroGrams}
- Метаболитен профил: ${analysisCompact.metabolicProfile}
- Здравни рискове: ${analysisCompact.healthRisks}
// ...

// СЛЕД:
АНАЛИЗ (КОМПАКТЕН):
- BMR/TDEE/Калории: ${analysisCompact.bmr} / ${analysisCompact.tdee} / ${analysisCompact.recommendedCalories}
- Макро съотношения: ${analysisCompact.macroRatios}
- Макро грамове дневно: ${analysisCompact.macroGrams}
// ПРЕМАХНАТО: Метаболитен профил
- Здравни рискове: ${analysisCompact.healthRisks}
// ...
```

#### Стъпка 3: Премахнете от `replacePromptVariables()`

Редактирайте `worker.js`, ред 4554:

```javascript
// ПРЕДИ:
let prompt = replacePromptVariables(customPrompt, {
  userData: data,
  analysisData: analysisCompact,
  name: data.name,
  age: data.age,
  goal: data.goal,
  bmr: analysisCompact.bmr,
  tdee: analysisCompact.tdee,
  recommendedCalories: analysisCompact.recommendedCalories,
  macroRatios: analysisCompact.macroRatios,
  macroGrams: analysisCompact.macroGrams,
  metabolicProfile: analysisCompact.metabolicProfile,
  healthRisks: analysisCompact.healthRisks,
  // ...
});

// СЛЕД:
let prompt = replacePromptVariables(customPrompt, {
  userData: data,
  analysisData: analysisCompact,
  name: data.name,
  age: data.age,
  goal: data.goal,
  bmr: analysisCompact.bmr,
  tdee: analysisCompact.tdee,
  recommendedCalories: analysisCompact.recommendedCalories,
  macroRatios: analysisCompact.macroRatios,
  macroGrams: analysisCompact.macroGrams,
  // ПРЕМАХНАТО: metabolicProfile
  healthRisks: analysisCompact.healthRisks,
  // ...
});
```

#### Стъпка 4: Редактирайте KV промпта

Редактирайте `KV/prompts/admin_strategy_prompt.txt`:

```
// ПРЕДИ:
АНАЛИЗ (КОМПАКТЕН):
- BMR/TDEE/Калории: ${bmr} / ${tdee} / ${recommendedCalories}
- Макро съотношения: ${macroRatios}
- Макро грамове дневно: ${macroGrams}
- Метаболитен профил: ${metabolicProfile}
- Здравни рискове: ${healthRisks}

// СЛЕД:
АНАЛИЗ (КОМПАКТЕН):
- BMR/TDEE/Калории: ${bmr} / ${tdee} / ${recommendedCalories}
- Макро съотношения: ${macroRatios}
- Макро грамове дневно: ${macroGrams}
// ПРЕМАХНАТО: Метаболитен профил
- Здравни рискове: ${healthRisks}
```

#### Стъпка 5: Качете промпта

```bash
./KV/upload-kv-keys.sh
```

### Резултат

Стратегията вече НЯМА да получава метаболитен профил, което ще намали размера на промпта с ~50 токена.

---

## 📝 Пример 3: Изпращане на Пълната Седмична Схема от Стъпка 2 към Стъпка 3

### Задача
Искате **цялата седмична схема** (`weeklyScheme`) да се изпраща към Стъпка 3, не само като обект, но и като форматиран текст.

### Решение: Промяна на worker.js

#### Стъпка 1: Добавете форматирана версия на `weeklyScheme` в `strategyCompact`

Редактирайте `worker.js`, ред 1541-1551:

```javascript
// ПРЕДИ:
const strategyCompact = {
  dietType: strategy.dietType || 'Балансирана',
  weeklyMealPattern: strategy.weeklyMealPattern || 'Традиционна',
  mealTiming: strategy.mealTiming?.pattern || '3 хранения дневно',
  keyPrinciples: (strategy.keyPrinciples || []).join('; '),
  foodsToInclude: (strategy.foodsToInclude || []).join(', '),
  foodsToAvoid: (strategy.foodsToAvoid || []).join(', '),
  calorieDistribution: strategy.calorieDistribution || 'не е определено',
  macroDistribution: strategy.macroDistribution || 'не е определено',
  weeklyScheme: strategy.weeklyScheme || null
};

// СЛЕД:
const strategyCompact = {
  dietType: strategy.dietType || 'Балансирана',
  weeklyMealPattern: strategy.weeklyMealPattern || 'Традиционна',
  mealTiming: strategy.mealTiming?.pattern || '3 хранения дневно',
  keyPrinciples: (strategy.keyPrinciples || []).join('; '),
  foodsToInclude: (strategy.foodsToInclude || []).join(', '),
  foodsToAvoid: (strategy.foodsToAvoid || []).join(', '),
  calorieDistribution: strategy.calorieDistribution || 'не е определено',
  macroDistribution: strategy.macroDistribution || 'не е определено',
  weeklyScheme: strategy.weeklyScheme || null,
  
  // НОВА ДОБАВКА: Форматирана версия на седмичната схема
  weeklySchemeFormatted: strategy.weeklyScheme ? 
    Object.keys(strategy.weeklyScheme).map(day => {
      const dayData = strategy.weeklyScheme[day];
      const dayName = DAY_NAMES_BG[day] || day;
      return `${dayName}: ${dayData.meals} хранения - ${dayData.description}`;
    }).join('\n') : 
    'няма дефинирана схема'
};
```

**ВАЖНО**: Трябва да дефинирате `DAY_NAMES_BG` в началото на `worker.js`:

```javascript
// Добавете преди функциите (например ред 100-110)
const DAY_NAMES_BG = {
  monday: 'Понеделник',
  tuesday: 'Вторник',
  wednesday: 'Сряда',
  thursday: 'Четвъртък',
  friday: 'Петък',
  saturday: 'Събота',
  sunday: 'Неделя'
};
```

#### Стъпка 2: Използвайте форматираната версия в промпта

Редактирайте `worker.js`, ред 1619 (вече съществуващ код):

```javascript
// ТЕКУЩ КОД (НЕ ГО ПРОМЕНЯЙТЕ):
${strategyCompact.weeklyScheme ? `

=== СЕДМИЧНА СТРУКТУРА (от стъпка 2) ===
${Object.keys(strategyCompact.weeklyScheme).map(day => {
  const dayData = strategyCompact.weeklyScheme[day];
  const dayName = DAY_NAMES_BG[day] || day;
  return `${dayName}: ${dayData.meals} хранения - ${dayData.description}`;
}).join('\n')}` : ''}

// МОЖЕ ДА СЕ ОПРОСТИ ДО:
${strategyCompact.weeklyScheme ? `

=== СЕДМИЧНА СТРУКТУРА (от стъпка 2) ===
${strategyCompact.weeklySchemeFormatted}` : ''}
```

#### Стъпка 3: Качете промпта

```bash
./KV/upload-kv-keys.sh
```

### Резултат

Седмичната схема вече се изпраща във форматиран вид, което прави промпта по-четим.

---

## 📝 Пример 4: Изпращане на Повече Здравни Данни от Стъпка 1 към Стъпка 4

### Задача
Искате да изпратите **всички ключови проблеми** от анализа към обобщението (Стъпка 4), не само първите 3.

### Решение: Промяна на worker.js

#### Стъпка 1: Променете `healthContext` в `generateMealPlanSummaryPrompt()`

Редактирайте `worker.js`, ред 2050-2056:

```javascript
// ПРЕДИ:
const healthContext = {
  keyProblems: (analysis.keyProblems || []).map(p => `${p.problem} (${p.severity})`).join('; '),
  allergies: data.allergies || 'няма',
  medications: data.medications || 'няма',
  medicalHistory: data.medicalHistory || 'няма',
  deficiencies: (analysis.nutritionalDeficiencies || []).join(', ') || 'няма установени'
};

// СЛЕД:
const healthContext = {
  // ПРОМЕНЕНО: Вземаме ВСИЧКИ ключови проблеми, не само първите 3
  keyProblems: (analysis.keyProblems || [])
    .map(p => `${p.title || p.problem} (${p.severity})`)
    .join('; '),
  allergies: data.allergies || 'няма',
  medications: data.medications || 'няма',
  medicalHistory: data.medicalHistory || 'няма',
  deficiencies: (analysis.nutritionalDeficiencies || []).join(', ') || 'няма установени'
};
```

**ЗАБЕЛЕЖКА**: Текущият код вече използва `.map(p => \`${p.problem} (${p.severity})\`)`, но анализът връща `.title`, така че трябва да го поправим на `.title || p.problem`.

### Резултат

Обобщението вече ще получава всички ключови проблеми от анализа, което ще помогне при препоръки за добавки.

---

## 📝 Пример 5: Контрол на Данни САМО чрез Промптове (БЕЗ промяна на worker.js)

### Задача
Искате да **покажете само някои от принципите** от стратегията в хранителния план, без да променяте `worker.js`.

### Решение: Промяна на промпта

#### Стъпка 1: Редактирайте `KV/prompts/admin_meal_plan_prompt.txt`

```
// ПРЕДИ:
=== ДАННИ ОТ СТЪПКА 2 (СТРАТЕГИЯ) ===
Диета: ${strategyData.dietType} | Хранения: ${strategyData.mealTiming}
Принципи: ${strategyData.keyPrinciples}
Предпочитани храни (от стъпка 2): ${strategyData.foodsToInclude}
Нежелани храни (от стъпка 2): ${strategyData.foodsToAvoid}

// СЛЕД (ПРИМЕРНА ПРОМЯНА - показва само диета и хранения):
=== ДАННИ ОТ СТЪПКА 2 (СТРАТЕГИЯ - МИНИМАЛНИ) ===
Диета: ${strategyData.dietType} | Хранения: ${strategyData.mealTiming}

ВАЖНО: Следвай принципите на ${strategyData.dietType} диетата.
```

#### Стъпка 2: Качете промпта

```bash
./KV/upload-kv-keys.sh
```

### Резултат

Хранителният план вече получава само диетата и броя хранения, без да показва пълния списък от принципи, което намалява размера на промпта.

**ЗАБЕЛЕЖКА**: Това може да намали качеството на плана, тъй като AI няма да знае конкретните принципи!

---

## 🎓 Обобщение

| Пример | Какво Променяме | Къде Променяме | Трябва ли worker.js? |
|--------|----------------|----------------|---------------------|
| 1. Добавяне на темперамент | Добавяме ново поле | `worker.js` + KV промпт | ✅ Да |
| 2. Премахване на метаболитен профил | Премахваме съществуващо поле | `worker.js` + KV промпт | ✅ Да |
| 3. Форматиране на седмична схема | Добавяме форматирана версия | `worker.js` + KV промпт | ✅ Да |
| 4. Повече здравни данни | Премахваме лимита на полета | `worker.js` | ✅ Да |
| 5. Минимални принципи | Скриваме съществуващи данни | Само KV промпт | ❌ Не |

### Ключови Правила:

1. **Ако искате да добавите НОВО поле** → Променете `worker.js` + KV промпт
2. **Ако искате да премахнете съществуващо поле** → Променете `worker.js` + KV промпт
3. **Ако искате да покажете/скриете вече съществуващи данни** → Променете само KV промпт
4. **ВИНАГИ качвайте промптовете след промяна** → `./KV/upload-kv-keys.sh`

---

За повече информация, вижте:
- [DATA_FLOW_EXPLANATION_BG.md](./DATA_FLOW_EXPLANATION_BG.md) - Пълно обяснение на потока от данни
- [DATA_FLOW_DIAGRAM_BG.md](./DATA_FLOW_DIAGRAM_BG.md) - Визуални диаграми на архитектурата
