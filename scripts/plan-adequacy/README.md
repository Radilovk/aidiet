# Plan adequacy tests

Автоматични проверки за качеството на генерирания план — от промптове до frontend projection.

## Команди

```bash
# Offline (бързо, без AI) — CI на всеки PR
npm run test:plan-adequacy

# Adequacy contract — tolerance, caps, profile rules
npm run test:plan-adequacy:contract

# Priority #1 — calories, grams, macros math
npm run test:plan-adequacy:nutrition

# Priority #2 — dietetic / clinical logic
npm run test:plan-adequacy:dietetic

# Live benchmark — hard (6) | extended (6) | clinical (5) | all
npm run test:plan-adequacy:benchmark -- --confirm --profiles=hard
npm run test:plan-adequacy:benchmark -- --confirm --profiles=extended
npm run test:plan-adequacy:benchmark -- --confirm --profiles=clinical
npm run test:plan-adequacy:benchmark -- --confirm --only=aip_autoimmune

# Live quick — 3 стандартни профила (ръчно)
npm run test:plan-adequacy:live -- --confirm --profiles=quick
```

`--confirm` е задължителен за live/benchmark — без него скриптът отказва.

## Критерии за адекватност (приоритет)

### Приоритет 1 — Математика (калории, грамажи, макроси)

| Критерий | Праг | Тест |
|----------|------|------|
| `meal.calories` = P×4+C×4+F×9 | ±2 kcal | `nutrition.mjs`, `test-plan-adequacy-nutrition` |
| Written macros = DB грамажи | macroTolerance | `validateMealMacrosFromGrams` |
| Слот калории vs scheme | ±10% (`isMealCaloriesAdequate`) | `nutrition.mjs`, contract |
| Дневна сума vs scheme | ±2× calorieTolerance | `validateWeekPlanNutrition` |
| Грамажи в description | парсируеми, 10–600g/item | `validateMealGramsAndWeight` |
| Общо тегло | ≤800g, ≥min по slot | `mealWeightGramsFromDescription` |
| Pipeline sync | scale + trim към target | `test-meal-scaling`, nutrition tests |

### Приоритет 2 — Диетологична / медицинска логика

| Критерий | Праг | Тест |
|----------|------|------|
| Лактация | kcal ≥ min+300; без агресивен дефицит | `dietetic.mjs` |
| Кето | carbs ≤15% от kcal | `dietetic.mjs` |
| Диабет/IR | carbs ≤45%; без десерт+нишестени на обяд | `dietetic.mjs` |
| Мускулна маса | protein ≥1.4g/kg | `dietetic.mjs` |
| Веган | без животински продукти | `dietetic.mjs` |
| AIP протокол | без забранени храни (каталог) | `validateProductNamesAgainstProtocol` |
| H3 slot | snack only — плод/ядки/млечни | `plan.mjs`, `dietetic.mjs` |
| H5 slot | fats+protein; без въглехидрати/плодове | `plan.mjs`, `dietetic.mjs` |
| Skip breakfast | без H1 | `profile-rules.mjs` |
| Комбинации | 1 carb source; без weird pairs | `combinations.mjs` |

### Приоритет 3 — Структура, храни, UX

| Слой | Проверки |
|------|----------|
| Analysis | Final_Calories, macros, health score, keyProblems |
| Strategy | weeklyScheme, slot caps, mealCountJustification |
| Foods | каталог, универсалност |
| Frontend | macrosViz, health % |
| Profile rules | dessert, ready_meals, H5 scheme |

## Benchmark профили

| Режим | Профили |
|-------|---------|
| `hard` (6) | kamen, skip_breakfast, diabetes, emotional, lactation, vegan |
| `extended` (6) | AIP, keto, menopause, IR protocol, GI, ultra-active |
| `clinical` (5) | extended с clinicalProtocol |
| `all` | hard + extended + стандартни |

## Тестови слоеве

| Скрипт | Какво покрива |
|--------|---------------|
| `run-offline.mjs` | Prompts, golden analysis, nutrition pipeline, full synthetic plan, bad cases |
| `test-plan-adequacy-nutrition.mjs` | **P1** — kcal/grams/macros math (26 checks) |
| `test-plan-adequacy-dietetic.mjs` | **P2** — clinical/dietetic logic (20 checks) |
| `test-plan-adequacy-contract.mjs` | Tolerance, caps, weight, normalize, profile rules |
| `test-meal-scaling.mjs` | Backend scaling/trim pipeline |
| `test-plan-normalize.mjs` | Scheme rebalance, enforceFixedSlotCaps |
| `run-benchmark.mjs` | hard / extended / clinical live vs production |
| `run-live.mjs` | 3–10 стандартни профила live |

### Детайлни прагове (P3)

**Analysis:** Final_Calories 800–5000; macroRatios ~100%; keyProblems 3–6; health score 15–100.

**Strategy:** weeklyScheme 7 дни; H3≤350; H5 over-cap only; mealCountJustification ≥20 chars.

**Foods/Combinations:** каталог; universality; 1 carb source; no weird pairs.

**Backend:** nutrition sync, enforceFixedSlotCaps, reconcile, AI temp 0.2.

## KV auto-upload

При merge в `main` с промени в `KV/**` → workflow `deploy-kv.yml` качва `.txt` ключовете автоматично.
