# Plan adequacy tests

Автоматични проверки за качеството на генерирания план — от промптове до frontend projection.

## Команди

```bash
# Offline (бързо, без AI) — CI на всеки PR
npm run test:plan-adequacy

# Adequacy contract — регресии на tolerance/caps/profile rules
npm run test:plan-adequacy:contract

# Live benchmark — трудни профили срещу production (ръчно)
npm run test:plan-adequacy:benchmark -- --confirm --profiles=hard
npm run test:plan-adequacy:benchmark -- --confirm --only=vegan_active

# Live quick — 3 стандартни профила (ръчно)
npm run test:plan-adequacy:live -- --confirm --profiles=quick
```

`--confirm` е задължителен за live/benchmark — без него скриптът отказва.

## Критерии за адекватност

### A. Анализ (Step 1)

| Критерий | Праг |
|----------|------|
| `Final_Calories` | 800–5000 kcal; ≥ минимум по пол (М 1500 / Ж 1200) |
| `macroRatios` | Сума ~100% (±3%) |
| `macroGrams` | P×4+C×4+F×9 ≈ Final_Calories (±25 kcal) |
| Минимални мазнини | ≥ 0.7 g/kg телесно тегло |
| `currentHealthStatus.score` | 15–100 |
| `currentHealthStatus.description` | ≥ 40 символа; отразява ниски score-ове |
| `keyProblems` | 3–6 броя; без `Normal` severity |
| `severityValue` | В band-а на severity (Borderline 45–59, Risky 60–79, Critical 80–95) |
| Нормализация | Filter Normal → pad от hinderingFactors / healthRisks / nutritionalNeeds |

### B. Стратегия (Step 2)

| Критерий | Праг |
|----------|------|
| `weeklyScheme` | 7 дни; всеки с `mealBreakdown` |
| `meals` vs slots | `meals` === `mealBreakdown.length` |
| Типове хранения | Само канонични (`Хранене 1`–`5`, `Свободно хранене`) |
| `mealCountJustification` | ≥ 20 символа |
| H3 slot (схема) | ≤ 350 kcal (+10% толеранс) |
| H2/H4 slot (схема) | Fair-share ceiling при висок TDEE |
| H5 slot (схема) | Fail само при **над** 200 kcal (under-cap OK) |

### C. Седмичен план (Step 3)

| Критерий | Праг |
|----------|------|
| Структура | 7 дни × meals с `description` + грамажи |
| Хранене 3 | Само snack: плод/ядки/млечни; без готвено месо/ориз |
| Хранене 5 | Fats+protein; ≤ 200 kcal (±10%); без плодове/въглехидрати |
| Калории/слот | `isMealCaloriesAdequate` — ±10% от scheme target |
| Дневни калории | Сума meals ≈ scheme (±2× calorieTolerance) |
| Тегло | Сума грамове от `description` ≤ 800g; ≥ min по slot |
| Макро аритметика | `meal.calories` = P×4+C×4+F×9 (±2) |
| Макро от грамажи | Written macros ≈ изчислени от DB профили |

### D. Храни и комбинации

| Критерий | Праг |
|----------|------|
| Каталог | Всички продукти в `food-catalog` |
| Универсалност | universality ≥ праг; без рядки/нишови продукти |
| Въглехидрати | Макс. 1 energy source на хранене |
| Бобови | Не комбинират с множество въглехидрати |
| Забрани | Без мед/захар/сиропи; без грах+риба; без weird pairs |
| Ready meals | Без „омлет“, „ориз с пиле“ и др. в description |

### E. Профилни правила (benchmark)

| Профил | Правило |
|--------|---------|
| „Не закусвам“ | Без `Хранене 1` във всички дни |
| Без sweet craving | Без `dessert: true` |
| `includeDessert: false` | Без dessert |

### F. Frontend projection

| Критерий | Праг |
|----------|------|
| macrosViz | Калории/макроси от analysis или summary |
| Health score UI | Процент в допустим диапазон |

### G. Backend pipeline (worker)

| Критерий | Праг |
|----------|------|
| Nutrition sync | Грамажи мащабирани към target; trim ≤ 800g |
| `enforceFixedSlotCaps` | H3 ≤ 350, H5 ≤ 200 в scheme |
| `reconcileAchievedSlotCalories` | Align scheme към achieved в ±10% |
| Plan AI sampling | temp 0.2, topP 0.85 (ако admin KV не override-ва) |

## Тестови слоеве

| Скрипт | Какво покрива |
|--------|---------------|
| `run-offline.mjs` | Prompts, golden analysis, nutrition pipeline, full synthetic plan, bad cases |
| `test-plan-adequacy-contract.mjs` | Tolerance, caps, H3/H5, weight, normalize, profile rules, hard profiles |
| `test-meal-scaling.mjs` | Backend scaling/trim pipeline |
| `test-plan-normalize.mjs` | Scheme rebalance, enforceFixedSlotCaps, analysis normalize |
| `run-benchmark.mjs` | 6 hard профила live срещу production |
| `run-live.mjs` | 3–10 стандартни профила live |

## KV auto-upload

При merge в `main` с промени в `KV/**` → workflow `deploy-kv.yml` качва `.txt` ключовете автоматично.
