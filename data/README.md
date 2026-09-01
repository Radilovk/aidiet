# Готови ястия

**Един файл за ръчна редакция:** `data/meal-dishes.json`

Планът избира само от този списък (+ опционален KV overlay за admin).

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
