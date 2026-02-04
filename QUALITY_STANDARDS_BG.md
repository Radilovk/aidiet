# Стандарти за качество на AI Diet система

## Обзор

Този документ описва как AI Diet системата отговаря на високите стандарти за качество и индивидуализация.

## Изискване 1: Мощен анализ ориентиран към целта

### ✅ Имплементация

**Холистичен анализ** (`generateAnalysisPrompt()`, линия 1761):
```
CRITICAL QUALITY STANDARDS:
1. INDIVIDUALIZATION: Base EVERY conclusion on THIS client's specific data
2. CORRELATIONAL THINKING: Analyze interconnections (sleep↔stress↔eating)
3. EVIDENCE-BASED: Use modern, proven methods
4. SPECIFICITY: Concrete recommendations, not vague generalities
5. NO DEFAULTS: All values calculated from client data
```

**Анализирани фактори:**
- Sleep: Часове сън, прекъсвания → влияние върху хормони (cortisol, ghrelin, leptin)
- Stress: Ниво на стрес → въздействие върху метаболизъм и апетит
- Chronotype: Ранобуден/Вечерен → оптимизация на времето за хранене
- Diet history: Провалени диети → метаболитна адаптация
- Medical conditions: Заболявания + лекарства → хранителни потребности
- Psychological factors: Тригери, компенсации, мотивация

**Без компромиси със здравето:**
- Медицински състояния се проверяват и интегрират
- Лекарства се анализират за взаимодействия
- Специфични хранителни потребности се определят
- Здравни рискове се идентифицират

**Ориентация към целта:**
- BMR/TDEE изчисления базирани на цел (отслабване/мускулна маса/поддръжка)
- Макронутриенти оптимизирани за целта
- Стратегия адаптирана към желания резултат

## Изискване 2: Корелации + AI може да предложи по-добро

### ✅ Имплементация

**Backend дава baseline:**
```
BASELINE (Mifflin-St Jeor):
Weight Xkg, Height Xcm, Age X, Sex X, Goal X
BMR = 10×weight + 6.25×height - 5×age + (5 or -161)
TDEE = BMR × Activity(1.2-1.9)
```

**AI критично преразглежда:**
```
PROTOCOL:
- Backend baseline: Mifflin-St Jeor formula as starting point
- AI: Critically review and adjust using comprehensive analysis of ALL factors
```

**Корелационен анализ:**
- **Sleep ↔ Stress ↔ Eating**: Сън влияе на стрес, стрес влияе на хранене
- **Chronotype ↔ Calorie distribution**: Ранобуден → по-обилна закуска, Вечерен → по-обилна вечеря
- **Diet history ↔ Metabolism**: Провалени диети → метаболитна адаптация → по-ниски калории
- **Medical ↔ Nutritional needs**: Диабет → нисковъглехидратни, Анемия → желязо

**AI може да коригира:**
- Ако анализът показва метаболитна адаптация → по-ниски BMR/TDEE
- Ако стресът е много висок → адаптиране на калориите
- Ако съня е лош → включване на храни за подобряване на съня
- Ако има психологически фактори → по-устойчива стратегия

## Изискване 3: Информационна плътност без шум

### ✅ Имплементация

**Token optimization (worker.js, линия 12-16):**
```
TOKEN OPTIMIZATION (Feb 2026):
- Strategy objects: 76% reduction (695→167 tokens)
- Analysis objects: 37.6% reduction (524→327 tokens)
- Total: 59.1% reduction (4799→1962 tokens per plan)
```

**Compact format:**
- Само съществени данни се изпращат към AI
- Verbose полета се съкращават (200 chars max)
- Arrays се ограничават до top 3-5 елемента
- JSON структури се минимизират

**English instructions, Bulgarian data:**
- AI инструкции: Кратки английски
- Reasoning полета: English (bmrReasoning, caloriesReasoning)
- User-facing полета: Bulgarian (metabolicProfile, healthRisks)

**Quality validation:**
- `validateAnalysisQuality()`: Проверява за празни/generic полета
- `validateStrategyQuality()`: Валидира смислено съдържание
- Всички полета трябва да носят конкретна информация

**Забрана на празни данни:**
```javascript
// Check user-facing Bulgarian fields are meaningful
if (analysis.metabolicProfile.length < MIN_PROFILE_LENGTH || 
    analysis.metabolicProfile.includes('не е анализиран') || 
    analysis.metabolicProfile.toLowerCase().includes('standard')) {
  warnings.push('Metabolic profile may be generic');
}
```

## Изискване 4: Индивидуален подход с модерни методи

### ✅ Имплементация - ЗНАЧИТЕЛНО ПОДОБРЕНА

**Explicit забрани на generic подходи** (Strategy prompt, линия 1912):

```
CRITICAL QUALITY STANDARDS:
1. STRICTLY FORBIDDEN: Generic/universal/averaged recommendations
2. MODERN APPROACHES: Use current, evidence-based methods 
   (IF, cyclical nutrition, chronotype optimization, psychology-based)
3. AVOID CLICHÉS: No "eat more vegetables", "drink water", "exercise" 
   - client knows basics, wants SPECIFICS
4. INDIVIDUALIZED SUPPLEMENTS: Each justified by THIS client's specific needs
5. APPROPRIATE DETAILS: Food groups from whitelist, approximate dosages, flexible timing
6. STRATEGIC THINKING: Consider 2-3 day horizons, cyclical approaches
```

**Забранени фрази:**
- "balanced diet" (балансирана диета)
- "eat healthy" (яж здравословно)
- "exercise regularly" (редовно упражнявай)
- "drink water" (пий вода)
- "eat vegetables" (яж зеленчуци)
- "avoid junk food" (избягвай вредни храни)
- "standard approach" (стандартен подход)
- "typical plan" (типичен план)

**Изисквани модерни подходи:**
- **Intermittent Fasting (IF)**: 16:8, 18:6, OMAD - ако е подходящо
- **Циклично хранене**: Ниски/високи калорийни дни
- **Chronotype optimization**: Различно разпределение според биоритъм
- **Psychology-based**: Базирано на емоционален профил
- **Multi-day horizon**: 2-3 дневен хоризонт, не само дневен

**Индивидуализирани добавки**:
```
FORBIDDEN GENERIC APPROACHES:
- Standard multivitamins without specific justification
- "Eat balanced meals" - specify food groups from whitelist appropriate for THIS client
- "Drink 2L water" - approximate based on weight, activity, climate
- Cookie-cutter meal plans - design for THIS client's chronotype
- Textbook recommendations - adapt to THIS client's unique factors
```

**Validation на индивидуализация:**
```javascript
// Check for dosage in supplements - approximate ranges acceptable
const hasDosage = DOSAGE_UNITS.some(unit => supp.includes(unit));
if (!hasDosage) {
  warnings.push('Supplement may be missing dosage');
}
```

**Конкретни примери:**

❌ **ГРЕШНО (Generic):**
- "Вземайте мултивитамини"
- "Яжте балансирана диета"
- "3 хранения дневно"
- "Пийте 2л вода"

✅ **ПРАВИЛНО (Individual, но не прекалено специфично):**
- "Магнезий 300-400mg вечер (заради ниския сън 5ч и високия стрес)"
- "2 хранения дневно около 12:00-13:00 и 19:00-20:00 (16:8 IF за вечерния хронотип)"
- "Около 2.5-3л вода дневно (85kg, висока активност)"
- "По-обилна вечеря (около 35% калории) заради вечерния хронотип"

**Meal Plan Quality Standards**:
```
CRITICAL QUALITY STANDARDS - INDIVIDUALIZATION:
1. NO GENERIC MEALS: Each unique to client
2. NO REPETITION: All days different
3. REALISTIC & CULTURAL: Bulgarian/Mediterranean cuisine
4. SPECIFIC BENEFITS: WHY this meal helps THIS goal
5. FOOD GROUPS & FLEXIBILITY: Use food groups from whitelist (e.g. "fish with vegetables"), 
   NOT overly specific quantities
6. WHITELIST FOCUS: Prioritize availability, accessibility, close macro values
7. STRATEGIC THINKING: Chronotype for timing, psychology for sustainability
```
4. SPECIFIC BENEFITS: Explain WHY this meal helps THIS client's specific goal
5. AVOID OVERLY SPECIFIC: "fish with vegetables" NOT "180g sea bass with 200g broccoli"
6. STRATEGIC THINKING: Chronotype for timing/size, psychology for sustainability
```

## Изискване 5: Whitelist/Blacklist с гъвкавост

### ✅ Имплементация

**Hard Bans (ADLE v8 R0):**
```
0) HARD BANS (always 0%):
- onions (any form)
- turkey meat
- artificial sweeteners
- honey/sugar/jam/syrups
- ketchup/mayo/BBQ sauces
- Greek yogurt (use plain yogurt only)
- peas + fish (forbidden combination)
```

**Whitelists:**
- **PROTEIN**: eggs, chicken, beef, lean pork, fish, yogurt, cottage cheese, cheese, beans, lentils, chickpeas, peas
- **VEGETABLES**: tomatoes, cucumbers, peppers, cabbage, carrots, lettuce/greens, spinach, zucchini, mushrooms, broccoli, cauliflower
- **ENERGY**: oats, rice, potatoes, pasta, bulgur
- **FAT**: olive oil, butter, nuts/seeds

**OFF-WHITELIST разрешен (Rule R12):**
```
R12: Off-whitelist addition: Default=whitelist only. 
Off-whitelist ONLY if objectively needed (MODE/medical/availability), 
mainstream/universal, available in Bulgaria. 
Add line: Reason: ...
```

**Примери кога се разрешава off-whitelist:**
- Веган диета → тофу (не е в whitelist, но необходимо за протеин)
- Целиакия → киноа, елда (глутен-free алтернативи)
- Алергия към яйца → алтернативни протеини
- Специфично медицинско състояние → специфична храна

**Validation:**
```javascript
// Check for non-whitelist proteins (R12 enforcement)
for (const protein of ADLE_V8_NON_WHITELIST_PROTEINS) {
  if (match && !hasReasonJustification(meal)) {
    errors.push('Contains off-whitelist protein without Reason justification');
  }
}
```

## Резюме: Спазване на всички изисквания

### ✅ Всички 5 изисквания НАПЪЛНО изпълнени:

1. ✅ **Мощен анализ**: Холистичен, без компромиси, ориентиран към целта
2. ✅ **Корелации + AI предложения**: Backend baseline + AI критичен преглед
3. ✅ **Информационна плътност**: 59% token reduction, quality validation
4. ✅ **Индивидуален подход**: Explicit забрани на generic, модерни методи, конкретика
5. ✅ **Whitelist/Blacklist**: Hard bans + whitelists + R12 за гъвкавост

### Допълнителни подобрения:

- **Quality validation**: Автоматична проверка за generic съдържание
- **Modern approaches**: IF, циклично хранене, chronotype optimization
- **Specificity**: Конкретни дози, време, храни - не общи съвети
- **Strategic thinking**: Multi-day хоризонт, нестандартни решения
- **Evidence-based**: Доказани модерни методи

## Технически детайли

**Файл**: `/home/runner/work/aidiet/aidiet/worker.js`

**Ключови функции:**
- `generateAnalysisPrompt()` - линия 1761: Quality standards за анализ
- `generateStrategyPrompt()` - линия 1868: Забрани на generic подходи
- `generateMealPlanPrompt()` - линия 2434: Индивидуализация на хранене
- `generateMealPlanChunkPrompt()` - линия 2057: Quality standards за meals
- `validateAnalysisQuality()` - линия 932: Валидация на анализ
- `validateStrategyQuality()` - линия 955: Валидация на стратегия

**Константи за качество:**
```javascript
const MIN_PROFILE_LENGTH = 50;
const MIN_REASONING_LENGTH = 20;
const DOSAGE_UNITS = ['mg', 'µg', 'mcg', 'IU', 'г', 'g', 'UI'];
```

**Security scan**: ✅ 0 vulnerabilities
**Code review**: ✅ All issues addressed

---

*Документ създаден: 2026-02-04*
*Автор: AI Diet Development Team*
