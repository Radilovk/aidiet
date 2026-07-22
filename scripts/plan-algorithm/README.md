# Plan algorithm tests

Пълно покритие на AI алгоритъма за хранителни програми — диетологична логика, синхронизация, регенерации.

## Offline (CI / всеки PR)

```bash
npm run test:plan-algorithm
```

| Suite | Какво гарантира |
|-------|-----------------|
| **metabolism** | BMR, TDEE, макроси, 25% дефицит, gender floor, fats ≥0.7g/kg, lactation exception |
| **scheme-sync** | freeDay уикенд, includeDessert, meal aliases, weeklyScheme sums, FIXED_DESSERT inject, free-meal dailyTotals |
| **meal-validation** | грамажи, catalog, AIP protocol, calorie vs scheme, substitutions |
| **blocked-terms** | dietDislike/алергии/exclude_food → catalog candidates |
| **profile-regen** | diet-related полета, requireApproval, async payload `_requireApproval` |
| **food-picker** | exclusion (≥60%) vs inclusion, blacklist/mainlist payloads |
| **source-sync** | worker импортира `plan-pipeline-pure.js`; profile/food-picker HTML договори |

Свързани offline (вече в CI): `test:plan-adequacy`, `test-meal-scaling.mjs`, `test-universality-stress.mjs`.

## Live (само при изрична заявка)

```bash
npm run test:plan-algorithm:live -- --confirm
npm run test:plan-algorithm:live -- --confirm --scenario=full
npm run test:plan-algorithm:live -- --confirm --scenario=sweets
npm run test:plan-algorithm:live -- --confirm --scenario=free-day
npm run test:plan-algorithm:live -- --confirm --scenario=profile-delta
```

## Архитектура

- `plan-pipeline-pure.js` — споделена диетологична логика (worker + тестове)
- `plan-regen-contracts.js` — договори за profile regen и food-picker
- Worker импортира pure модула → една имплементация, без drift

## Допълнителни тестове (препоръчани следващи)

1. Weekly adaptation / `regenerateFromStep`
2. Admin approval E2E с реален Firebase token
3. Food-picker live KV write + generate-plan (admin auth)
4. Chat context consistency след regen
5. Demo limit guards (profile regen count)
