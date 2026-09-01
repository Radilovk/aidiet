# Catalog lists (JSON)

Ръчно редактируеми списъци за Plan Engine v2. Източникът на истина в runtime остават JS файловете; JSON е удобен формат за редакция и diff.

| Файл | JS източник | Редактор |
|------|-------------|----------|
| `meal-dishes.json` | `meal-dishes.js` | [lists/meal-dishes.html](../lists/meal-dishes.html) |
| `food-catalog.json` | `food-catalog-data.js` | [lists/food-catalog.html](../lists/food-catalog.html) |
| `food-nutrition.json` | `food-nutrition-data.js` | [lists/food-nutrition.html](../lists/food-nutrition.html) |
| `portion-limits.json` | `portion-limits.js` | [lists/portion-limits.html](../lists/portion-limits.html) |

## Команди

```bash
npm run lists:export    # JS → JSON
npm run lists:validate  # проверка на JSON
npm run lists:import    # JSON → JS
```

След `lists:import` пусни тестовете от `docs/CATALOG_EDITING.md`.

## UI

Отвори [lists-hub.html](../lists-hub.html) (или линк от админ панела).

**Забележка:** `lists:import` презаписва масивите в JS файловете. Секционните коментари в `meal-dishes.js` може да изчезнат — за големи промени предпочитай директно JS или commit преди import.
