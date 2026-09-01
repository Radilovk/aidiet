# Редактиране на каталога — справочник за ястия, продукти и диети

Този документ описва **кои файлове редактираш ръчно**, кога, и какво **не** дублираш.

---

## Принцип (Plan Engine v2)

```
Анкета → Step 1 (калории) → Step 2 (схема/слотове) → Step 3 (ястие от каталог) → solver (грамаж)
```

| Слой | Източник на истина | Роля |
|------|-------------------|------|
| **Ястия** | `meal-dishes.js` | Готови комбинации — единствен списък за Step 3 |
| **Продукти** | `food-catalog-data.js` | Сурови храни + макро роли (PRO/ENG/VOL/FAT) |
| **Хранителност** | `food-nutrition-data.js` | kcal и макроси на 100 g |
| **Admin KV** | Cloudflare KV (`food_catalog_overlay`) | Допълнителни продукти/ястия, изключване на base ястия |

**Не** пиши ястия в AI промптове. **Не** дублирай списъците в SQL или отделни JSON бази.

---

## 1. Ястия (главен файл за разширяване)

### `meal-dishes.js`

Единственият ръчен списък с готови ястия. Планът избира **само оттук** (+ admin overlay).

```js
dish(id, 'Име', [['продукт', грамове], ...], ['breakfast'|'main'|'snack'|'late_snack'], {
  vegan, vegetarian, universality: 1–5,
  tags: ['low_carb', 'gluten_free', 'liquid_breakfast', 'sweet_slot'],
})
```

| Поле | Правило |
|------|---------|
| `id` | Уникален, стабилен — **не го сменяй** след като ястието е в план |
| продукти | 2–4 продукта; имената **трябва** да съществуват в `food-catalog-data.js` |
| грамажи | Реална порция; файлът ги подравнява към мрежа 5 g / 50 g |
| `timing` | Кога може да се предлага (закуска, обяд, междинно, късна закуска) |
| `tags` | По избор; останалите се **извеждат** в `dish-tags.js` |

**Секции в файла (ред на добавяне):**
- Закуски
- Течна закуска (`liquid_breakfast`)
- Пиле / риба / месо / веган
- Кето / IR (`low_carb`)
- Междинни (Хранене 3)
- Контролирано сладко (`sweet_slot`)
- Късна закуска (Хранене 5)

**Свързани (не редактирай ръчно за ястия):**
- `ready-meal-parts.js` — декомпозиция за solver-а (генерира се от `meal-dishes.js`)
- `food-registry.js` — сглобява каталога за Step 3

### `dish-tags.js`

Логика за тагове и филтри от анкета/диета — **не е списък с ястия**. Променяш само ако добавяш нов тип таг или правило за филтър.

---

## 2. Продукти (сурови храни)

### `food-catalog-data.js`

Всички **отделни продукти**, които могат да влязат в ястие или в solver.

Полета: `id`, `name`, `nutritionKey`, `group`, `slots`, `timing`, `universality`, `vegan`/`vegetarian`.

**Преди нов продукт в ястие** — добави го тук (и в `food-nutrition-data.js`).

### `food-nutrition-data.js`

Макроси и калории на 100 g по `nutritionKey`. Без ред тук → solver не може да мащабира.

### `portion-limits.js`

Реалистични тавани на порция (напр. горчица, ядки). Рядко се пипа.

### `gram-rounding.js`

Мрежа 5 g / 50 g за грамажи. Не пипай освен при промяна на правилото.

---

## 3. Диети, анкета, филтри

### `diet-registry.js`

Правила за стесняване: кето, веган, без млечни, blocked terms. Добавяш нов **тип диета** тук.

### `questionnaire-engine-map.js`

Анкета → блокирани храни, clinical protocol hints, фази на адаптация.

### `meal-compatibility.js`

Кои продукти не се комбинират (напр. сладко + солено в едно ястие).

---

## 4. Admin / KV overlay (без fork на базата)

### `admin-food-catalog.js`

API за admin панела: добавяне на продукти и ястия в KV, изключване на base ястия.

| KV ключ | Съдържание |
|---------|------------|
| `food_catalog_overlay` | `entries[]` (продукти), `dishes[]` (ястия), `disabledDishes[]` |

**Правила:**
- Base ястия остават в `meal-dishes.js`
- Overlay **добавя** или **изключва** — не замества файла
- Overlay ястия поддържат `tags`, `timing`, `products` като base

### `food-registry.js`

Runtime merge: `FOOD_CATALOG` + `meal-dishes` + library overlay + KV. Не редактираш за ново ястие.

### `nutrition-library-bridge.js`

Merge с външна библиотека (сурови храни). Ястията **не** минават през него.

---

## 5. Двигател на плана (код, не данни)

| Файл | Роля |
|------|------|
| `plan-engine.js` | `PLAN_ENGINE=v2` (default), telemetry `_meta.engine` |
| `step1-deterministic.js` | Калории / TDEE |
| `step2-deterministic.js` | Седмична схема, слотове |
| `step3-deterministic.js` | Избор на ястие, ротация |
| `step3-slot-repair.js` | AI repair при catalog gap (max 2 calls) |
| `meal-solver.js` | Мащабиране на грамажи |
| `worker.entry.js` | Оркестрация (редактираш → `npm run build:worker`) |

Активиране: `PLAN_ENGINE=v2` (default) или `PLAN_ENGINE=v1` за legacy.

---

## 6. Типов workflow: ново ястие

1. Провери дали продуктите са в `food-catalog-data.js` + `food-nutrition-data.js`
2. Добави ред в `meal-dishes.js` с уникален `id`
3. По нужда добави `tags` (или остави `dish-tags.js` да ги изведе)
4. Пусни тестовете:

```bash
node scripts/test-meal-dishes.mjs
node scripts/test-catalog-coverage.mjs
node scripts/test-step3-engine-quality.mjs
npm run build:worker
```

5. Commit — **не** пипай `worker.js` ръчно

---

## 7. Типов workflow: нов продукт

1. `food-nutrition-data.js` — макроси на 100 g
2. `food-catalog-data.js` — `item(...)` с group, slots, timing
3. После го ползвай в `meal-dishes.js`

---

## 8. Тестове и инвентар

| Команда | Какво проверява |
|---------|-----------------|
| `node scripts/list-catalog-sources.mjs` | Брой ястия/продукти, пътища до файловете |
| `node scripts/test-meal-dishes.mjs` | Валидност на всички ястия |
| `node scripts/test-catalog-coverage.mjs` | 14 профила → пълен 7-дневен план |
| `node scripts/test-dish-tags.mjs` | Тагове и филтри |
| `node scripts/verify-worker.mjs` | Пълен worker contract |

---

## 9. Фитнес (отделно от хранителните планове)

| Файл | Роля |
|------|------|
| `fitness/exercise-catalog.js` | Упражнения |
| `fitness/data/equipment-apparatus-catalog.json` | Уреди |

Не се смесват с `meal-dishes.js`.

---

## 10. Какво НЕ правим

- SQL / отделна DB за ястия
- Дублиране на ястия в AI промптове (ADLE v8 за Step 3)
- Ръчно edit на `worker.js` (само `worker.entry.js` + build)
- Нов orchestrator / `protocol-engine` wire в main flow

---

*Виж също: `docs/PLAN_ENGINE_V2_ROADMAP.md`*
