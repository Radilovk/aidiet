# Корекция на изискванията за специфичност

## Проблем

Предишните промени направиха изискванията прекалено специфични и задължаващи:

**Проблемни изисквания (ПРЕМАХНАТИ):**
- "Specific foods, precise dosages, exact timing"
- "Специфични храни, прецизни дози, точно време"

**Защо беше проблем:**
1. **Специфични храни** → Прекалено задължаващо, не базирано на групи храни
2. **Прецизни дози** → Дозите трябва да са приблизителни, не точни
3. **Точно време** → Времето не трябва да е точно определено

## Решение

### Нови изисквания (КОРИГИРАНИ):

```
APPROPRIATE DETAILS: 
- Food groups from whitelist (групи храни от whitelist)
- Approximate dosages (приблизителни дози)
- Flexible timing (гъвкаво време)
```

### Ключови принципи:

1. **Групи храни, не специфични храни**
   - Базираме се на **групи храни**
   - Базираме се на **тип продукти**
   - Базираме се на **близки стойности при макроси**
   - Най-важно: **Разпространеност, достъпност, наличност в Whitelist**

2. **Приблизителни дози, не прецизни**
   - Дозите са **приблизителни**, не точни
   - Примери: "300-400mg", "около 2.5-3л", "30-40g"

3. **Гъвкаво време, не точно**
   - Часовете са **приблизителни**, не точни
   - Примери: "около 12:00-13:00", "вечер", "сутрин"

## Примери за промени

### 1. Добавки (Supplements)

❌ **Прекалено специфично (СТАРО):**
```
"Магнезий 400mg вечер преди лягане в 22:00"
```

✅ **Правилно (НОВО):**
```
"Магнезий 300-400mg вечер (заради ниския сън и стрес)"
```

### 2. Вода (Hydration)

❌ **Прекалено специфично (СТАРО):**
```
"2.8л вода дневно (85kg × 33ml/kg)"
```

✅ **Правилно (НОВО):**
```
"Около 2.5-3л вода дневно (85kg, висока активност)"
```

### 3. Хранения (Meals)

❌ **Прекалено специфично (СТАРО):**
```
"2 хранения дневно (12:00, 19:00)"
"180g sea bass with 200g broccoli and 15ml olive oil"
```

✅ **Правилно (НОВО):**
```
"2 хранения дневно около 12:00-13:00 и 19:00-20:00"
"Риба със зеленчуци" или "Fish with vegetables"
```

### 4. Калорийно разпределение

❌ **Прекалено специфично (СТАРО):**
```
"По-обилна вечеря (35% от дневните калории)"
```

✅ **Правилно (НОВО):**
```
"По-обилна вечеря (около 35% калории)"
```

## Промени в кода

### worker.js - Strategy Prompt (линия ~1995)

**Преди:**
```javascript
5. CONCRETE DETAILS: Specific foods, precise dosages, exact timing - not vague suggestions
```

**След:**
```javascript
5. APPROPRIATE DETAILS: Food groups from whitelist, approximate dosages, flexible timing - not overly constraining
```

### worker.js - Forbidden Approaches (линия ~2024)

**Преди:**
```javascript
- "Drink 2L water" - calculate based on weight, activity, climate for THIS client
```

**След:**
```javascript
- "Drink 2L water" - approximate based on weight, activity, climate for THIS client
```

### worker.js - Tasks (линия ~2020)

**Преди:**
```javascript
4. Individualize supplements: EACH must be justified by specific deficiency/need from analysis + personalized dosage + timing + interaction checks
```

**След:**
```javascript
4. Individualize supplements: EACH must be justified by specific deficiency/need from analysis + appropriate dosage range + general timing + interaction checks
```

### worker.js - Meal Plan Quality Standards (линия ~2591)

**Преди:**
```javascript
6. SPECIFICITY: "Grilled chicken with vegetables" NOT "170g chicken breast with 200g broccoli and 15g olive oil"
```

**След:**
```javascript
6. FLEXIBILITY: Use food groups and types from whitelist (e.g. "fish with vegetables", "chicken with rice"), NOT overly specific (NOT "170g chicken breast with 200g broccoli")
7. WHITELIST PRIORITY: Focus on availability, accessibility, and close macro values within allowed food groups
```

### worker.js - Chunk Prompt Quality Standards (линия ~2335)

**Преди:**
```javascript
5. AVOID OVERLY SPECIFIC: "fish with vegetables" NOT "180g sea bass with 200g steamed broccoli" - allow client flexibility
6. STRATEGIC THINKING: Consider chronotype for meal timing/size, psychology for sustainability
```

**След:**
```javascript
5. FOOD GROUPS & FLEXIBILITY: Use food groups and types from whitelist (e.g. "fish with vegetables", "meat with salad"), NOT overly specific quantities (NOT "180g sea bass with 200g steamed broccoli")
6. WHITELIST FOCUS: Prioritize availability, accessibility, and close macro values within allowed food groups
7. STRATEGIC THINKING: Consider chronotype for meal timing/size, psychology for sustainability
```

## Whitelist приоритети

Системата сега акцентира върху:

1. **Разпространеност** - Храни които са лесно достъпни
2. **Достъпност** - Храни които клиентът може да намери
3. **Наличност в Whitelist** - Използване на разрешените групи храни
4. **Близки макро стойности** - Подобни хранителни профили

## Резултат

### ✅ Запазени качества:
- Индивидуализация (все още за ТОЗИ конкретен клиент)
- Избягване на generic подходи (все още забранено)
- Модерни методи (IF, циклично хранене, chronotype optimization)
- Стратегическо мислене (2-3 дневен хоризонт)

### ✅ Коригирани изисквания:
- От "specific foods" към "food groups"
- От "precise dosages" към "approximate dosages"
- От "exact timing" към "flexible timing"
- Добавен акцент върху whitelist наличност

### ✅ Баланс:
- Индивидуализация **БЕЗ** прекалена специфичност
- Конкретика **БЕЗ** твърде стриктни изисквания
- Гъвкавост **В РАМКИТЕ НА** whitelist

## Документация

Актуализирани файлове:
- `worker.js` - Коригирани AI prompts
- `QUALITY_STANDARDS_BG.md` - Актуализирани стандарти и примери
- `FINAL_QUALITY_REVIEW_BG.md` - Актуализиран преглед
- `CORRECTION_FLEXIBILITY.md` - Този документ

---

*Дата на корекция: 2026-02-04*
*Причина: Прекалено специфични изисквания*
*Статус: ✅ Коригирано*
