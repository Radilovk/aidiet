# AI Prompts Directory

Тази папка съдържа всички AI промптове, използвани за генериране на хранителни планове и консултации.

## Файлове с промптове

### Стъпки на генериране на план

1. **admin_analysis_prompt.txt** - Анализ на здравословния профил
   - Входни данни: Пълен профил на потребителя
   - Изходни данни: Холистичен анализ с BMR, TDEE, макроси, психопрофил
   - Използва се в: `generateAnalysisPrompt()`

2. **admin_strategy_prompt.txt** - Определяне на диетична стратегия
   - Входни данни: Потребителски данни + Анализ
   - Изходни данни: Персонализирана стратегия с хранителен модел, време на хранене
   - Използва се в: `generateStrategyPrompt()`

3. **admin_meal_plan_prompt.txt** - Генериране на хранителен план
   - Входни данни: Данни + Анализ + Стратегия
   - Изходни данни: 7-дневен хранителен план с детайлни ястия
   - Използва се в: `generateMealPlanChunkPrompt()`

4. **admin_summary_prompt.txt** - Обобщение на плана
   - Входни данни: Данни + Анализ + План
   - Изходни данни: Резюме, препоръки, добавки
   - Използва се в: `generateMealPlanSummaryPrompt()`

### Чат режими

5. **admin_consultation_prompt.txt** - Режим на консултация
   - Използва се за четене и обяснение на плана БЕЗ промени
   - Използва се в: `generateChatPrompt()` с mode='consultation'

6. **admin_modification_prompt.txt** - Режим на промяна на плана
   - Използва се за обсъждане и прилагане на промени в плана
   - Използва се в: `generateChatPrompt()` с mode='modification'

7. **admin_correction_prompt.txt** - Корекция на грешки
   - Използва се за коригиране на невалидни планове
   - Използва се в: Validation error flow

### Емоционално хранене

8. **admin_emoeat_prompt.txt** - AI анализ на емоционалното хранене
   - Входни данни: 15 отговора от проективен въпросник за емоционално хранене
   - Изходни данни: Дълбок индивидуализиран психологически профил с архетипи, кръстосани модели, лични прозрения, терапевтични стратегии и спешен протокол
   - Използва се в: `generateEmoeatPrompt()` / `handleGenerateEmoeatAnalysis()`

## Формат на промптовете

Всички промптове използват `{placeholders}` с точкова нотация за достъп до вложени обекти:
- `{name}` - Име на потребителя
- `{age}` - Възраст
- `{goal}` - Цел (отслабване, поддържане, набиране)
- `{bmr}` - Базова метаболитна скорост
- `{recommendedCalories}` - Препоръчителни калории (за стъпки 3 и 4)
- И други променливи според контекста на всеки промпт

### Налични променливи по стъпки

#### Стъпка 1 – `admin_analysis_prompt.txt`
`{userData}`, `{backendCalculations}`, `{bmr}`, `{tdee}`, `{name}`, `{age}`, `{gender}`, `{weight}`, `{height}`, `{goal}`, `{sleepHours}`, `{sleepInterrupt}`, `{chronotype}`, `{sportActivity}`, `{dailyActivityLevel}`, `{stressLevel}`, `{waterIntake}`, `{waterMin}`, `{waterMax}`, `{medicalConditions}`, `{medicalConditions_other}`, `{medicalConditions_allergy_details}`, `{medicalConditions_autoimmune_details}`, `{medicalConditions_cardiovascular_details}`, `{medicalConditions_endocrine_details}`, `{medicalConditions_digestive_details}`, `{medicalConditions_metabolic_details}`, `{medicalConditions_musculoskeletal_details}`, `{medications}`, `{medicationsText}`, `{eatingHabits}`, `{foodCravings}`, `{foodTriggers}`, `{compensationMethods}`, `{socialComparison}`, `{dietHistory}`, `{additionalNotes}`, `{additionalNotesSection}`, `{clinicalProtocolSection}`, `{clinicalProtocolName}`, `{TEMPERAMENT_CONFIDENCE_THRESHOLD}`, `{HEALTH_STATUS_UNDERESTIMATE_PERCENT}`, `{MIN_RECOMMENDED_CALORIES}`, `{MIN_FAT_GRAMS}`, `{FIBER_MIN_GRAMS}`, `{FIBER_MAX_GRAMS}`
> **Забележка:** `{additionalNotesSection}` автоматично включва детайлите на здравословните състояния (`medicalConditions_*_details`) като секция `[Детайли за здравословни състояния]`, ако са попълнени.

#### Стъпка 2 – `admin_strategy_prompt.txt`
Данни от стъпка 1 (само компактни полета): `{bmi}`, `{realBMR}`, `{realTDEE}`, `{temperament}`, `{temperamentProbability}`, `{add1}`
Потребителски данни: `{name}`, `{age}`, `{goal}`, `{dietPreference}`, `{dietDislike}`, `{dietLove}`, `{eatingHabits}`, `{chronotype}`, `{medicalConditions}`, `{medicalConditions_other}`, `{medicalConditions_allergy_details}`, `{medicalConditions_autoimmune_details}`, `{medicalConditions_cardiovascular_details}`, `{medicalConditions_endocrine_details}`, `{medicalConditions_digestive_details}`, `{medicalConditions_metabolic_details}`, `{medicalConditions_musculoskeletal_details}`, `{additionalNotes}`, `{additionalNotesSection}`, `{clinicalProtocolSection}`, `{clinicalProtocolName}`, `{TEMPERAMENT_CONFIDENCE_THRESHOLD}`
⚠️ **Не са налични**: `{recommendedCalories}`, `{macroRatios}`, `{macroGrams}`, `{psychologicalProfile}`, `{successChance}`, `{keyProblems}` — използвай `{realTDEE}` вместо `{recommendedCalories}`

#### Стъпка 3 – `admin_meal_plan_prompt.txt`
Данни от стъпка 1 (компактни): `{analysisCompact.macroRatios}`, `{analysisCompact.macroGrams}`, `{analysisCompact.fiber}`
Данни от стъпка 2 (пълна стратегия): `{strategyData.*}`, `{strategyCompact.*}`, `{dietaryModifier}`
Изчислени: `{bmr}`, `{recommendedCalories}`, `{startDay}`, `{endDay}`, `{modificationsSection}`, `{previousDaysContext}`, `{dynamicWhitelistSection}`, `{dynamicBlacklistSection}`
Потребителски: `{userData.*}`, `{dietLove}`, `{dietDislike}`, `{additionalNotes}` ← комбинирано (additionalNotes + детайли здравосл. нарушения + протокол-специфични отговори + dq_ отговори), `{medicalConditions_cardiovascular_details}`, `{medicalConditions_endocrine_details}`, `{medicalConditions_digestive_details}`, `{medicalConditions_metabolic_details}`, `{medicalConditions_musculoskeletal_details}`
Клиничен протокол: `{clinicalProtocolSection}` ← пълен контекст: насоки, акцент, ограничения, суплементи (празно ако няма протокол)
Константи: `{DAILY_CALORIE_TOLERANCE}`, `{MAX_LATE_SNACK_CALORIES}`, `{MEAL_NAME_FORMAT_INSTRUCTIONS}`

#### Корекция – `admin_correction_prompt.txt`
`{errorsFormatted}`, `{planJSON}`, `{userDataJSON}` (включва additionalNotes), `{additionalNotes}`, `{additionalNotesSection}`, `{MEAL_NAME_FORMAT_INSTRUCTIONS}`, `{MIN_DAILY_CALORIES}`

#### Стъпка 4 – `admin_summary_prompt.txt`
Данни от стъпка 1 (компактни): `{temperament}`, `{temperamentProbability}`, `{psychologicalProfile}`, `{keyProblems}`
Данни от стъпка 2: `{dietType}`, `{psychologicalSupport}`, `{hydrationStrategy}`, `{supplementRecommendations}`
Изчислени: `{bmr}`, `{recommendedCalories}`, `{avgCalories}`, `{avgProtein}`, `{avgCarbs}`, `{avgFats}`
Потребителски: `{name}`, `{goal}`, `{medications}`, `{allergies}`, `{stressLevel}`, `{sleepQuality}`, `{sleepDuration}`, `{sportActivity}`, `{dailyActivity}`, `{dailyActivityLevel}`
Клиничен протокол: `{clinicalProtocolSection}`, `{clinicalProtocolSupplementSection}`, `{clinicalProtocolName}`
Динамични списъци: `{dynamicWhitelistSection}`, `{dynamicBlacklistSection}`

#### EmoEat – `admin_emoeat_prompt.txt`
Отговори от въпросника: `{answer1}` до `{answer15}` (свободен текст от 15 въпроса за емоционално хранене)

**ВАЖНО**: Промптовете съдържат placeholders `{varName}` и `{obj.field}` (точкова нотация), които се заместват при runtime. Те НЕ са JavaScript template literals.

## Как се използват

1. **KV/prompts/** — единствен източник на текст за AI промптове (редактирай `.txt` файловете тук)
2. **KV storage** — `./KV/upload-kv-keys.sh` качва файловете като KV ключове
3. **worker.js** — зарежда стъпковите промпти от KV (`requireKvPrompt`), инжектира `{placeholders}`; малки фрагменти (формат на име, правило за десерт) са в кода — не се качват отделно
4. **Admin panel** — показва/редактира KV промптовете

## Качване към Cloudflare KV

За да качите промптовете към Cloudflare:

```bash
cd /path/to/aidiet
./KV/upload-kv-keys.sh
```

Това ще качи всички промптове от тази папка към KV storage.

## Редактиране

За да редактирате промптове:

1. **Локално**: Редактирайте файловете в тази папка
2. **В admin panel**: https://aidiet.radilov-k.workers.dev/admin.html
3. **Директно в KV**: Чрез Cloudflare Dashboard

**ВАЖНО**: 
- Редактирайте САМО файловете в `KV/prompts/` — не в `worker.js`
- След промяна: `./KV/upload-kv-keys.sh` за активиране в production
- Snippets в `KV/prompts/snippets/` — инжектират се в стъпка 3 (`{MEAL_NAME_FORMAT_INSTRUCTIONS}`, `{sweetsCravingRule}`)

## Бележки

- Промптовете са на български език за по-добро разбиране от AI на локален контекст
- Всеки промпт е оптимизиран за конкретната стъпка в процеса
- Форматът е ИДЕНТИЧЕН с default промптовете hardcoded в worker.js
- Промптовете използват `{varName}` placeholders — НЕ JavaScript template literals (`${...}`)
