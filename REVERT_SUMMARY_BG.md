# Връщане към оригиналните промпти

## Обобщение

Всички промени за "качествени стандарти" и "индивидуализация" от последните разговори са премахнати.
Системата е върната към по-прости, по-гъвкави промпти.

## Причина за промяната

Клиентът посочи че добавените изисквания за:
- Специфични храни
- Прецизни дози
- Точно време
- Групи храни
- Детайлни стандарти за качество

...са прекалено **задължаващи** и **не са полезни**.

## Какво беше премахнато

### 1. Analysis Prompt
**Премахнато:**
```
CRITICAL QUALITY STANDARDS:
1. INDIVIDUALIZATION: Base EVERY conclusion on THIS client's specific data
2. CORRELATIONAL THINKING: Analyze interconnections
3. EVIDENCE-BASED: Use modern, proven methods
4. SPECIFICITY: Concrete recommendations, not vague generalities
5. NO DEFAULTS: All values calculated from client data
```

**Заменено с:**
```
You are an expert nutritionist. Analyze the client's data and calculate personalized nutrition parameters.

Calculate BMR, TDEE, target calories, and macro ratios based on client's goal, activity level, and other factors.

Consider correlations: sleep quality affects metabolism, stress affects eating behavior, chronotype affects meal timing preferences.
```

### 2. Strategy Prompt
**Премахнато:**
```
CRITICAL QUALITY STANDARDS:
1. STRICTLY FORBIDDEN: Generic/universal/averaged recommendations
2. MODERN APPROACHES: Use current, evidence-based methods
3. AVOID CLICHÉS: No "eat more vegetables"
4. INDIVIDUALIZED SUPPLEMENTS: Each justified
5. APPROPRIATE/CONCRETE DETAILS: Specific foods, dosages, timing
6. STRATEGIC THINKING: 2-3 day horizons

FORBIDDEN GENERIC APPROACHES:
- Standard multivitamins without justification
- "Eat balanced meals" - specify food groups
- "Drink 2L water" - calculate/approximate based on weight
- Cookie-cutter meal plans
- Textbook recommendations

TASKS:
1-4. Detailed requirements for modifier, strategy, meal count, supplements
```

**Заменено с:**
```
Develop personalized dietary strategy for [name].

[Client data summary]

Determine dietary modifier.
Justify meal count and timing based on client's needs.
Suggest supplements if needed based on deficiencies from analysis.
Consider medical conditions and medication interactions.

OUTPUT (JSON):
USER-FACING FIELDS IN BULGARIAN: [list of fields]
```

### 3. Meal Plan Prompts
**Премахнато:**
```
CRITICAL QUALITY STANDARDS - INDIVIDUALIZATION:
1. THIS PLAN IS ONLY FOR [name] - no generic/template approach
2. FORBIDDEN: Copy-paste standard meal plans
3. REQUIRED: Unique combinations
4. VARIETY: Never repeat meals
5. CULTURAL CONTEXT: Real Bulgarian/Mediterranean dishes
6. FLEXIBILITY: Use food groups from whitelist
7. WHITELIST PRIORITY: Availability, accessibility
```

**Заменено с:**
```
Generate meal plan for days X-Y for [name].

[Client data, strategy, correlational adaptation]
```

### 4. Validation функции
**Изтрити:**
- `validateAnalysisQuality()`
- `validateStrategyQuality()`
- Константи: `MIN_PROFILE_LENGTH`, `MIN_REASONING_LENGTH`, `DOSAGE_UNITS`
- Quality check calls в `generatePlanMultiStep()`

### 5. Документация
**Изтрити файлове:**
- `QUALITY_STANDARDS_BG.md`
- `FINAL_QUALITY_REVIEW_BG.md`
- `CORRECTION_FLEXIBILITY.md`

## Какво е запазено

✅ **ADLE v8 правила (R1-R12)** - Основните архитектурни правила
✅ **Whitelists** - Списъци на разрешени храни (протеини, зеленчуци, енергия, мазнини)
✅ **Hard bans** - Забранени храни (лук, пуешко, подсладители, мед/захар, кетчуп/майонеза)
✅ **CORRELATIONAL ADAPTATION** - Стрес→храна, Chronotype→калории, Сън→храна
✅ **Meal templates (A/B/C/D)** - Структурни шаблони за ястия
✅ **Mode filters** - Веган, Кето, Без глутен и др.
✅ **Основни инструкции** - За анализ, стратегия, и meal plan

## Ефект от промяната

### Преди (с качествени стандарти):
- Прекалено детайлни изисквания
- Задължаващи стандарти
- Сложни валидации
- Много правила за индивидуализация

### След (опростено):
- По-прости инструкции
- По-гъвкав подход
- Без прекомерна специфичност
- Фокус върху основната функционалност

## Техническа информация

**Променени файлове:**
- `worker.js` - Опростени промпти (Analysis, Strategy, Meal Plan, Chunk)

**Изтрити файлове:**
- 3 документационни MD файла

**Премахнати функции:**
- 2 validation функции
- 3 константи

**Запазени компоненти:**
- ADLE v8 архитектура и правила
- Whitelists и hard bans
- Correlational adaptation
- Meal templates и mode filters

## Заключение

Системата е върната към състояние преди добавянето на прекалено детайлните стандарти за качество и индивидуализация. 

Фокусът е върху:
- Гъвкавост
- Простота
- Основна функционалност
- Без прекомерни изисквания

Запазени са всички критични компоненти (ADLE v8, whitelists, корелации), но без задължаващите стандарти за индивидуализация.

---

*Дата: 2026-02-04*
*Статус: Завършено*
