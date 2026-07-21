# Plan adequacy tests

Автоматични проверки за качеството на генерирания план — от промптове до frontend projection.

## Команди

```bash
# Offline (бързо, без AI) — пуска се на всеки PR
npm run test:plan-adequacy

# Live E2E срещу production (бавно, AI quota)
npm run test:plan-adequacy:live
npm run test:plan-adequacy:live -- --profiles=all
npm run test:plan-adequacy:live -- --base=https://aidiet.radilov-k.workers.dev
```

## Какво покриват offline тестовете

| Слой | Проверки |
|------|----------|
| **Prompt contracts** | Задължителни секции в KV промптове (macros, health score, snack rules) |
| **Analysis** | Final_Calories, macroRatios/Grams баланс, currentHealthStatus, keyProblems severityValue |
| **Strategy** | weeklyScheme, meal types, mealCountJustification |
| **Meal plan** | Хранене 3 = snack, грамажи, каталог |
| **Frontend projection** | macrosVizContainer логика, single-score-container health % |

## Live тестове

10 разнообразни профила (отслабване, лактация, диабет, веган, bulking...).  
В CI: `workflow_dispatch` → `run_live: true` (3 профила, ~30–60 мин).

## KV auto-upload

При merge в `main` с промени в `KV/**` → workflow `deploy-kv.yml` качва всички `.txt` ключове автоматично.
