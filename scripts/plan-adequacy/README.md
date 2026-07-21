# Plan adequacy tests

Автоматични проверки за качеството на генерирания план — от промптове до frontend projection.

## Команди

```bash
# Offline (бързо, без AI) — пуска се на всеки PR
npm run test:plan-adequacy

# Допълнителни offline pipeline тестове (включени и в CI)
node test-meal-scaling.mjs
node test-universality-stress.mjs

# Live (ръчно, с реални AI заявки — САМО при изрична заявка, НЕ в CI)
npm run test:plan-adequacy:live -- --confirm
npm run test:plan-adequacy:live -- --confirm --profiles=all
npm run test:plan-adequacy:live -- --confirm --base=https://aidiet.radilov-k.workers.dev
```

`--confirm` (или `AIDIET_LIVE_TESTS=1`) е задължителен — без него скриптът отказва, за да не се пуска случайно.

## Live vs offline

| | Offline | Live |
|---|---------|------|
| AI заявки | Не | Да (production worker) |
| CI / PR | Да | **Не** |
| Скорост | ~1 сек | ~10–20 мин (3 профила) |
| Пускане | автоматично | **само с `--confirm`** |

## Какво покриват offline тестовете

| Слой | Проверки |
|------|----------|
| **Prompt contracts** | Задължителни секции в KV промптове (macros, health score, snack rules) |
| **Analysis** | Final_Calories, macroRatios/Grams баланс, currentHealthStatus, keyProblems severityValue |
| **Strategy** | weeklyScheme, meal types, mealCountJustification |
| **Meal plan** | Хранене 3 = snack, грамажи, каталог |
| **Nutrition** | P×4+C×4+F×9, грамажи ↔ макроси, калории vs схема, реалистични порции/тегло |
| **Foods** | Продукти извън каталога, прекалено конкретни/рядки храни (универсалност) |
| **Combinations** | Множество въглехидрати, бобови+ориз, грах+риба, нелогични двойки |
| **Frontend projection** | macrosVizContainer логика, single-score-container health % |
| **Meal scaling** | Backend мащабиране на грамажи към калорийна цел (test-meal-scaling.mjs) |
| **Catalog pools** | Празни/течащи candidate pools при различни диети (test-universality-stress.mjs) |

## KV auto-upload

При merge в `main` с промени в `KV/**` → workflow `deploy-kv.yml` качва всички `.txt` ключове автоматично.
