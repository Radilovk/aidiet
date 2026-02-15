# AI Prompts Directory - РЕАЛНИ ПРОМПТОВЕ ОТ WORKER.JS

⚠️ **ВАЖНО**: Тези файлове съдържат ДЕЙСТВИТЕЛНИТЕ промптове, използвани в worker.js!

Тази папка съдържа всички AI промптове, извлечени директно от worker.js. 
Това са РЕАЛНИТЕ промптове, които системата използва за генериране на хранителни планове и консултации.

## ❗ КРИТИЧНО ВАЖНО ❗

**Промптовете в тази папка са ЕДНО И СЪЩО със заложените в worker.js!**

Това означава:
- Това са ДЕЙСТВИТЕЛНИТЕ промптове, използвани в production
- Промптовете в KV/prompts/ файловете са само за референция и upload към KV storage
- Промптовете в worker.js НЕ СЕ ИЗПОЛЗВАТ, ако има custom промптове в KV
- След upload на тези файлове, системата ще използва ТЯХ вместо hardcoded промптовете

## Файлове с промптове

### Стъпки на генериране на план

1. **admin_analysis_prompt.txt** (13KB) - Стъпка 1: Холистичен анализ
   - Входни данни: Пълен профил на потребителя (възраст, тегло, цели, здравословни фактори)
   - Изходни данни: Холистичен анализ с BMR, TDEE, макроси, психопрофил, рискове, прогнози
   - Използва се в: `generateAnalysisPrompt()` в worker.js
   - Съдържа: Референтни изчисления, водно равновесие, темперамент, метаболитна реактивност
   - **ИЗВЛЕЧЕН ОТ**: worker.js lines 3954-4290

2. **admin_strategy_prompt.txt** (13KB) - Стъпка 2: Диетична стратегия
   - Входни данни: Потребителски данни + Компактен анализ
   - Изходни данни: Персонализирана стратегия с dietaryModifier, седмична схема, време на хранене
   - Използва се в: `generateStrategyPrompt()` в worker.js
   - Съдържа: Седмична схема, модификатор обосновка, welcomeMessage, психологическа подкрепа
   - **ИЗВЛЕЧЕН ОТ**: worker.js lines 4422-4563

3. **admin_meal_plan_prompt.txt** (12KB) - Стъпка 3: ADLE хранителен план ⭐ MOST IMPORTANT!
   - Входни данни: Данни + Анализ + Стратегия + previousDays
   - Изходни данни: 2-day chunks (progressive generation) или 7-дневен план
   - Използва се в: `generateMealPlanChunkPrompt()` в worker.js
   - Съдържа: ADLE v5.1 архитектура, AFAM категории ([PRO], [ENG], [VOL], [FAT], [CMPX])
   - Логически лостове, структурни шаблони, HARD BANS, whitelist/blacklist
   - **ИЗВЛЕЧЕН ОТ**: worker.js lines 1456-1580

4. **admin_summary_prompt.txt** (1.4KB) - Стъпка 4: Обобщение
   - Входни данни: Данни + Анализ + Седмичен план
   - Изходни данни: Резюме, препоръчани храни, забранени храни, добавки
   - Използва се в: `generateMealPlanSummaryPrompt()` в worker.js
   - **ИЗВЛЕЧЕН ОТ**: worker.js lines 1914-1936

### Чат режими

5. **admin_consultation_prompt.txt** (1.2KB) - Режим на консултация
   - Използва се за четене и обяснение на плана БЕЗ промени
   - Използва се в: `generateChatPrompt()` с mode='consultation'
   - Съдържа: Правила за кратки отговори, форматиране, мотивиращ тон
   - **ИЗВЛЕЧЕН ОТ**: worker.js lines 5034-5047 (getChatPrompts function)

6. **admin_modification_prompt.txt** (5KB) - Режим на промяна на плана
   - Използва се за обсъждане и прилагане на промени в плана
   - Използва се в: `generateChatPrompt()` с mode='modification'
   - Съдържа: REGENERATE_PLAN инструкции, модификатори, потвърждаване
   - **ИЗВЛЕЧЕН ОТ**: worker.js lines 5048-5127 (getChatPrompts function)

7. **admin_correction_prompt.txt** (5.2KB) - Корекция на грешки
   - Използва се за коригиране на невалидни планове
   - Използва се в: Validation error flow
   - Съдържа: Правила за корекция, обосновки, meal name format
   - **ИЗВЛЕЧЕН ОТ**: worker.js lines 3252-3344

## Формат на промптовете

Всички промптове използват специален формат с placeholders:
- `{name}` - Име на потребителя
- `{age}` - Възраст
- `{goal}` - Цел (отслабване, поддържане, набиране)
- `{bmr}` - Базова метаболитна скорост
- `{recommendedCalories}` - Препоръчителни калории
- `{macroRatios}` - Макронутриентни съотношения
- `{analysisCompact}` - Компактен анализ
- `{strategyCompact}` - Компактна стратегия
- `{dynamicWhitelistSection}` - Динамичен whitelist от KV
- `{dynamicBlacklistSection}` - Динамичен blacklist от KV
- `{previousDaysContext}` - Контекст от предишни дни (за разнообразие)
- И др.

Тези placeholders се заменят с реални данни от функцията `replacePromptVariables()` във worker.js.

## Как се използват

1. **В worker.js**: Промптовете са hardcoded като default в `generateXXXPrompt()` функциите
2. **В KV storage**: Промптовете от тази папка се качват с `upload-kv-keys.sh` скрипта
3. **В runtime**: Worker ПЪРВО проверява за custom промптове в KV storage
   - Ако има custom промпт в KV → използва го
   - Ако няма custom промпт в KV → използва hardcoded default от worker.js
4. **В admin panel**: Показва промпта от KV или fallback към hardcoded default

## Качване към Cloudflare KV

За да качите промптовете към Cloudflare:

```bash
cd /path/to/aidiet
./KV/upload-kv-keys.sh
```

Това ще качи всички промптове от тази папка към KV storage с ключове:
- `admin_analysis_prompt`
- `admin_strategy_prompt`
- `admin_meal_plan_prompt`
- `admin_summary_prompt`
- `admin_consultation_prompt`
- `admin_modification_prompt`
- `admin_correction_prompt`

## Редактиране

За да редактирате промптове:

1. **Локално**: Редактирайте файловете в тази папка
2. **Upload към KV**: Използвайте `./KV/upload-kv-keys.sh`
3. **В admin panel**: https://aidiet.radilov-k.workers.dev/admin.html
4. **Директно в KV**: Чрез Cloudflare Dashboard

**⚠️ КРИТИЧНО ВАЖНО**: 
- Промптовете в тази папка ТРЯБВА да бъдат СЪЩИТЕ като в worker.js!
- При промяна на промпт в worker.js → АКТУАЛИЗИРАЙ този файл!
- При промяна на файл тук → АКТУАЛИЗИРАЙ worker.js (или upload към KV)!

## Размери на файловете

След извличането от worker.js (Feb 2026):
- admin_analysis_prompt.txt: **13KB** (пълен холистичен анализ)
- admin_strategy_prompt.txt: **13KB** (детайлна стратегия)
- admin_meal_plan_prompt.txt: **12KB** (ADLE архитектура - MOST IMPORTANT!)
- admin_summary_prompt.txt: **1.4KB** (лек summary)
- admin_consultation_prompt.txt: **1.2KB** (кратки правила)
- admin_modification_prompt.txt: **5KB** (детайлни инструкции)
- admin_correction_prompt.txt: **5.2KB** (корекция правила)

## Бележки

- Промптовете са на български език за по-добро разбиране от AI на локален контекст
- Всеки промпт е оптимизиран за конкретната стъпка в процеса
- Форматът е консистентен с оригиналните промптове от worker.js
- Промптовете използват token optimization техники (компактни формати)
- ADLE v5.1 архитектура е вградена в meal_plan промпта
- Progressive generation е основният метод за Стъпка 3 (2 дни per chunk)

## История на промптовете

- **Feb 2026**: Извлечени реални промптове от worker.js (Issue: "промпт 3 да се изведе целия")
- **Feb 2026**: Token optimization - компактни формати за strategy/analysis
- **Feb 2026**: ADLE v5.1 - reorganization, simplification
- **Previous**: Placeholder промптове, не съответстващи на реалните в worker.js
