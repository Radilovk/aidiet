# Готови ястия

Планът избира от два източника (+ опционален KV overlay за admin):

1. **`data/plate-formulas.json`** — формули на чинии: основа + изрично разрешени варианти
   (гарнитура, зеленчук, мазнина…). Разгъват се при зареждане в ~1200 ястия
   (`plate-formulas.js`). Тук се добавят нови ястия на едро.
2. **`data/meal-dishes.json`** — ръчно курирани ястия (единични рецепти).

## Формула (plate-formulas.json)

```json
{
  "id": "grill_chicken", "base": "Пилешко филе на скара", "timing": ["main"],
  "core": [["пилешко месо", 150]], "extra": [["зехтин", 10]],
  "choices": [{ "set": "garnish" }, { "set": "veg_side" }]
}
```

- `core` / `extra` — винаги в ястието; `choices` — всяка комбинация е отделно ястие.
- Вариант: `{ "key", "label", "products" }`; `label` влиза в името („… с ориз и броколи“),
  празен `label` = „без“. С `"key"` на избора и `{key}` в `base` вариантът дава заглавие (`title`).
- `sets` — общи списъци с варианти (гарнитури, зеленчуци…).
- Веган/вегетарианско, универсалност и основният протеин се извеждат от продуктите.
- Най-много 4 продукта; продуктите — от каталога.

Проверка: `node scripts/test-meal-dishes.mjs` и `npm run test:catalog-zones`
(всяка диета × хранене трябва да има поне 7 ястия в макро зоната си).

## Формат на едно ястие

```json
{
  "id": "meal_chicken_rice",
  "name": "Пиле с ориз",
  "products": [
    { "name": "пилешко месо", "grams": 150 },
    { "name": "ориз", "grams": 80 },
    { "name": "Зеленчуци", "grams": 100 }
  ],
  "timing": ["main"],
  "universality": 5,
  "vegetarian": false,
  "tags": []
}
```

| Поле | Правило |
|------|---------|
| `id` | Уникален, стабилен — не го сменяй след като ястието е в план |
| `products` | 2–4 продукта; имената от `food-catalog-data.js` |
| `grams` | Референтна порция; engine-ът мащабира пропорционално |
| `timing` | `breakfast`, `main`, `snack`, `late_snack` |
| `tags` | по избор: `low_carb`, `sweet_slot`, `liquid_breakfast`… |

След промяна:

```bash
node scripts/test-meal-dishes.mjs
node scripts/test-catalog-coverage.mjs
npm run build:worker
```
