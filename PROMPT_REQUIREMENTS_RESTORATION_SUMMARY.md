# Възстановяване на изисквания в промптовете - Резюме

## Дата: 2026-02-05
## Статус: ✅ ЗАВЪРШЕНО

---

## Проблем

След PR#145, планът коректор (validatePlan функция) хваща много грешки, което показва, че промптовете не налагат всички критични изисквания, които валидацията очаква. Имаше несъответствия между това, което промптовете инструктират AI модела да прави, и това, което validatePlan функцията проверява.

---

## Анализ на пропуските

### КРИТИЧНИ проблеми (открити и коригирани):

1. **НЕСЪОТВЕТСТВИЕ В БРОЯ ХРАНЕНИЯ** ❌→✅
   - Промптът казваше: "1-6/day per strategy"
   - Валидацията проверява: MIN_MEALS_PER_DAY=1, MAX_MEALS_PER_DAY=5
   - **Проблем:** Планове с 6 хранения биха били отхвърлени
   - **Корекция:** Променено на "1-5/day" навсякъде

2. **ЛИПСВАЩИ МИНИМАЛНИ КАЛОРИИ** ❌→✅
   - Валидацията проверява: MIN_DAILY_CALORIES = 800 kcal
   - Промптът: Не споменаваше минимум
   - **Корекция:** Добавено "minimum 800 kcal/day" в критичните изисквания

3. **НЕПЪЛЕН СПИСЪК С LOW-GI ХРАНИ** ❌→✅
   - Промптът казваше: "yogurt 150ml, nuts 30-40g, berries 50-100g, avocado half, seeds 1-2tbsp"
   - Валидацията проверява: Пълен LOW_GI_FOODS списък с 23 храни на български и английски
   - **Корекция:** Разширен списък с всички LOW-GI храни на български и английски

4. **НЕДОСТАТЪЧНО ЯСНИ ИЗИСКВАНИЯ ЗА ОБОСНОВКИ** ❌→✅
   - Валидацията изисква:
     - planJustification ≥100 символа
     - welcomeMessage ≥100 символа
     - mealCountJustification ≥20 символа
     - afterDinnerMealJustification ≥20 символа ИЛИ "Не са необходими"
   - Промптовете: Споменаваха полетата, но не минималните дължини
   - **Корекция:** Добавени MANDATORY секции с точни минимални дължини

5. **ЛИПСВАЩИ КРИТИЧНИ МЕДИЦИНСКИ ПРАВИЛА** ❌→✅
   - Валидацията проверява специфични медицински правила:
     - Диабет → НЕ "високовъглехидратно"
     - PCOS → избягвай "високовъглехидратно"/"балансирано"
     - IBS/IBD → ТРЯБВА "щадящ/gentle"
     - Анемия + Вегетарианство → ЗАДЪЛЖИТЕЛНО желязо
     - Warfarin + Vitamin K → ОПАСНА интеракция
   - Промптовете: Споменаваха общи медицински фактори, но не конкретните правила
   - **Корекция:** Добавена секция "CRITICAL MEDICAL RULES" със всички правила

6. **ЛИПСВАЩ ТОЛЕРАНС ЗА МАКРОСИ** ❌→✅
   - Валидацията проверява: P×4 + C×4 + F×9 в рамките на ±10% или ±50 kcal
   - Промптът казваше: "PRECISE CALORIES: protein×4 + carbs×4 + fats×9"
   - **Корекция:** Добавено "(calculated must match declared within ±10% or ±50 kcal tolerance)"

7. **ЛИПСВАЩИ ЛИМИТИ НА ПОРЦИИ** ❌→✅
   - Валидацията предупреждава: <50g или >800g порции
   - Промптът: Споменаваше 50g инкременти, но не максимум
   - **Корекция:** Добавено "practical portion sizes (typically 50-800g per component)"

8. **ЛИПСВАЩ МИНИМУМ ЗА recommendations/forbidden** ❌→✅
   - Валидацията изисква: ≥3 елемента във всеки списък
   - Промптовете: Не споменаваха минимум
   - **Корекция:** Добавено "MINIMUM 3-5 specific food types" за двата списъка

9. **НЕДОСТАТЪЧНО ЯСНО ЗА "Normal" SEVERITY** ❌→✅
   - Валидацията изисква: САМО Borderline/Risky/Critical - НИКОГА "Normal"
   - Анализ промптът казваше: "(Borderline/Risky/Critical only)"
   - **Корекция:** Добавено "(CRITICAL: ONLY Borderline/Risky/Critical severity - NEVER "Normal" severity)"

---

## Извършени промени

### 1. generateAnalysisPrompt() (worker.js ~ред 1813)

**ДОБАВЕНО:**
```
TASK:
...
3. Identify 3-6 key problems (CRITICAL: ONLY Borderline/Risky/Critical severity - NEVER "Normal" severity)
...
5. Ensure minimum field lengths: metabolicProfile ≥50 chars, psychologicalProfile ≥50 chars, each reasoning field ≥20 chars
```

**ПРИЧИНА:** Валидацията филтрира Normal severity проблеми и проверява дължини на полета

---

### 2. generateStrategyPrompt() (worker.js ~ред 1954)

**ДОБАВЕНО:**

```
TASKS - MANDATORY OUTPUTS:
...
3. MANDATORY JUSTIFICATIONS (specific character minimums enforced):
   - mealCountJustification: Justify meal count (1-5/day) based on THIS client's specific needs (minimum 20 characters)
   - afterDinnerMealJustification: If meals after dinner (like late snack), explain why (minimum 20 characters) OR set to "Не са необходими"
   - planJustification: Detailed explanation why this plan is unique for THIS client (minimum 100 characters)
   - welcomeMessage: Personalized greeting (150-250 words) referencing THIS client's specific factors, goals, challenges
4. Individualize supplements: EACH must be justified by specific deficiency/need from analysis + EXACT dosage (not ranges) + general timing + interaction checks for THIS client

CRITICAL MEDICAL RULES - MUST FOLLOW:
- Diabetes + медикаменти → NEVER "високовъглехидратно" modifier (use Low-carb or Balanced with carb control)
- PCOS/СПКЯ → AVOID "високовъглехидратно" and standard "балансирано" (prefer Low-carb or moderate carb with focus on low GI)
- IBS/IBD → MUST include "щадящ/gentle" in modifier or modifierReasoning (gentle on stomach)
- Anemia + Vegetarian/Vegan → MANDATORY iron supplement with vitamin C for absorption
- Warfarin (blood thinner) + Vitamin K → DANGEROUS INTERACTION - DO NOT recommend Vitamin K
- Antibiotics + Calcium/Magnesium → Note timing separation required (2+ hours apart)
- Antacids + Iron → Note timing separation required (2+ hours apart)
```

```
OUTPUT (JSON, STRICTLY NO GENERIC CONTENT) - ALL FIELDS REQUIRED:
USER-FACING FIELDS IN BULGARIAN:
- welcomeMessage: 150-250 WORDS personalized greeting referencing specific client factors (MINIMUM 100 characters enforced)
- planJustification: Detailed explanation why THIS plan is individualized for THIS client (MINIMUM 100 characters enforced)
...
- mealCountJustification: Specific reasoning for chosen meal count (1-5/day) for THIS client (MINIMUM 20 characters enforced)
- afterDinnerMealJustification: If late snacks/meals after dinner, explain medical/lifestyle reason (MINIMUM 20 characters) OR "Не са необходими" if none
...

REQUIREMENTS FOR LISTS:
- recommendations: minimum 3 specific food types
- forbidden: minimum 3 specific foods to avoid
- psychologicalSupport: minimum 3 tips
- supplementRecommendations: individualized with exact dosages, not generic multivitamin list
```

**ПРИЧИНА:** Валидацията проверява всички тези полета и минимални дължини, и има специфични медицински правила

---

### 3. generateMealPlanChunkPrompt() (worker.js ~ред 2273)

**ПРОМЕНЕНО:**

```
CRITICAL:
1. MANDATORY MACROS: protein, carbs, fats, fiber (grams) for each meal
2. PRECISE CALORIES: protein×4 + carbs×4 + fats×9 (calculated must match declared within ±10% or ±50 kcal tolerance)
3. TARGET DAILY: ~${recommendedCalories} kcal/day (±${DAILY_CALORIE_TOLERANCE} acceptable, minimum 800 kcal/day)
4. MEAL COUNT: 1-5/day per strategy (NEVER add meals just to hit calories!)  ← ПРОМЕНЕНО от 1-6
   - 1 meal (OMAD): clear IF strategy only
   - 2 meals: IF strategy (16:8, 18:6)
   - 3 meals: Breakfast, Lunch, Dinner (standard)
   - 4 meals: +Afternoon snack
   - 5 meals: +Late snack (rare, justified only - requires afterDinnerMealJustification in strategy)  ← ПРОМЕНЕНО
   ← ПРЕМАХНАТ РЕД ЗА 6 ХРАНЕНИЯ
5. VARIETY: Each day different - avoid repetition across week
6. Realistic Bulgarian/Mediterranean dishes with practical portion sizes (typically 50-800g per component)  ← ДОБАВЕНО
```

```
LATE SNACK ("Късна закуска") STRICT RULES - CRITICAL:  ← РАЗШИРЕНО
Allowed ONLY if: Long gap dinner-sleep (>4h), sleep issues from hunger, type 2 diabetes, evening workouts, shift work
Conditions: ONLY after "Вечеря", max 1/day, max ${MAX_LATE_SNACK_CALORIES} kcal
LOW GI FOODS ONLY (<55 GI): кисело мляко/yogurt (150ml), кефир, ядки/nuts (30-40g: бадеми/almonds, орехи/walnuts, кашу/cashews, лешници/hazelnuts), ягоди/berries (50-100g: боровинки/blueberries, малини/raspberries, черници/blackberries), ябълка/apple, круша/pear, авокадо/avocado (half), семена/seeds (1-2 tbsp: чиа/chia, ленено/flax, тиквени/pumpkin), краставица/cucumber, домат/tomato, хумус/hummus
MANDATORY: If using late snack, explain justification in strategy.afterDinnerMealJustification (minimum 20 characters)
DO NOT use if not justified!
```

**ПРИЧИНА:** 
- Критично несъответствие в броя хранения (6 срещу 5)
- Валидацията очаква пълния LOW_GI_FOODS списък
- Толеранс на макросите и минимални калории
- Практични лимити на порциите

---

### 4. generateMealPlanSummaryPrompt() (worker.js ~ред 2495)

**ДОБАВЕНО:**

```
REQUIRED OUTPUT (JSON):
- summary: {bmr, dailyCalories, macros} - numeric values only
- recommendations: Array of MINIMUM 3-5 specific food types recommended for THIS client's goal (NOT general advice)
- forbidden: Array of MINIMUM 3-5 specific foods THIS client should avoid (NOT general advice)
...

CRITICAL: recommendations and forbidden must contain specific foods for goal ${data.goal}, NOT general nutritional advice like "eat vegetables" or "avoid sugar". Be specific: "риба (омега-3)", "зелени листни зеленчуци (магнезий)", "преработени месни изделия", "газирани напитки". All user-visible text in Bulgarian.
```

**ПРИЧИНА:** Валидацията изисква минимум 3 елемента в тези списъци

---

### 5. generateCorrectionPrompt() (worker.js ~ред 1528)

**АКТУАЛИЗИРАНО:**

```
2. БРОЙ ХРАНЕНИЯ: 1-5 на ден (НЕ 6!)  ← ДОБАВЕНО уточнение
   - ЗАДЪЛЖИТЕЛНО обоснови избора в strategy.mealCountJustification (минимум 20 символа)  ← ДОБАВЕНО минимум

3. ХРАНЕНИЯ СЛЕД ВЕЧЕРЯ - разрешени С ОБОСНОВКА:
   - Физиологична причина (диабет, дълъг период до сън >4ч, проблеми със съня)  ← ДОБАВЕНО >4ч
   ...
   - ДОБАВИ обосновката в strategy.afterDinnerMealJustification (минимум 20 символа)!  ← ДОБАВЕНО минимум
   - Предпочитай ниско-гликемични храни (<55 GI): кисело мляко/кефир, ядки, ягоди/боровинки, ябълка/круша, авокадо, семена  ← РАЗШИРЕНО
   - Максимум ${MAX_LATE_SNACK_CALORIES} kcal ако няма обосновка  ← ДОБАВЕНО

5. МЕДИЦИНСКИ ИЗИСКВАНИЯ (КРИТИЧНИ):  ← РАЗШИРЕНО
   - При диабет: НЕ "високовъглехидратно" (използвай Low-carb или Balanced с контрол)
   - При анемия + вегетарианство/веганство: добавка с желязо ЗАДЪЛЖИТЕЛНА
   - При PCOS/СПКЯ: избягвай "високовъглехидратно" и стандартно "балансирано"
   - При IBS/IBD: ТРЯБВА "щадящ/gentle" в modifier
   - При Warfarin: НЕ Витамин K добавки (ОПАСНА интеракция!)  ← ДОБАВЕНО
   ...

═══ ТВОЯТА ЗАДАЧА ═══
Коригирай проблемните части и ДОБАВИ ЗАДЪЛЖИТЕЛНИ ОБОСНОВКИ в strategy полетата:
- strategy.planJustification - обща обосновка на плана (минимум 100 символа)  ← ДОБАВЕНО минимум
- strategy.welcomeMessage - персонализирано приветствие (150-250 думи, минимум 100 символа)  ← ДОБАВЕНО
- strategy.mealCountJustification - защо този брой хранения (минимум 20 символа)  ← ДОБАВЕНО минимум
- strategy.afterDinnerMealJustification - защо хранения след вечеря (минимум 20 символа) ИЛИ "Не са необходими"  ← ДОБАВЕНО минимум
...

ЗАДЪЛЖИТЕЛНО ВКЛЮЧИ recommendations (минимум 3-5 храни) и forbidden (минимум 3-5 храни) списъци!  ← ДОБАВЕНО
```

**ПРИЧИНА:** Коригиращият промпт трябва да познава същите правила като генериращите промпти

---

## Резултат

### Всички критични пропуски са коригирани:

✅ Брой хранения: 1-5 (не 6)  
✅ Минимални калории: 800 kcal/ден  
✅ Пълен LOW-GI списък за късни закуски  
✅ Всички задължителни обосновки с минимални дължини  
✅ Критични медицински правила експлицитно изброени  
✅ Толеранс за макро изчисления  
✅ Практични лимити на порциите  
✅ Минимум елементи за recommendations/forbidden  
✅ Експлицитна забрана за "Normal" severity  

### Запазени компоненти (без промяна):

✅ Всички ADLE v8 правила (R0-R12)  
✅ Hard bans списък  
✅ Protein whitelists  
✅ Forbidden combinations (peas+fish)  
✅ CRITICAL QUALITY STANDARDS  
✅ IMPORTANT FORMATTING RULES  
✅ CORRELATIONAL THINKING  
✅ Meal templates (A/B/C/D)  

---

## Тестване

След тези промени, промптовете трябва да генерират планове, които:

1. ✅ Имат 1-5 хранения на ден (не 6)
2. ✅ Имат минимум 800 kcal дневно
3. ✅ Включват само Borderline/Risky/Critical проблеми (не Normal)
4. ✅ Имат всички задължителни обосновки с достатъчна дължина
5. ✅ Спазват критичните медицински правила
6. ✅ Имат точни макроси (в рамките на толеранса)
7. ✅ Имат реалистични порции (50-800g)
8. ✅ Имат минимум 3 препоръчителни и забранени храни
9. ✅ Използват правилни LOW-GI храни за късни закуски

---

## Заключение

Всички критични несъответствия между промптовете и validatePlan() функцията са идентифицирани и коригирани. Промптовете сега експлицитно налагат всички изисквания, които планът коректор проверява. Това трябва драстично да намали броя грешки, които се хващат от валидацията.

**Статус:** ✅ ЗАВЪРШЕНО  
**Дата:** 2026-02-05  
**Променени файлове:** worker.js (5 функции актуализирани)  
**Commits:** 2  

---

*Този документ обобщава всички промени, направени за възстановяване на пропуснатите изисквания в промптовете след PR#145.*
