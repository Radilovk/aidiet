# PROJECT NOTES — Важни правила за управление на проекта

> Моля четете и спазвайте тези правила преди всяка промяна!

---

## 1. Промпти — ЕДИНСТВЕНО местоположение

**Промптовете за отделните стъпки на пайплайна са САМО в `KV/prompts/`.**

| Файл | Стъпка |
|------|--------|
| `KV/prompts/admin_analysis_prompt.txt` | Стъпка 1 — Анализ |
| `KV/prompts/admin_strategy_prompt.txt` | Стъпка 2 — Стратегия |
| `KV/prompts/admin_meal_plan_prompt.txt` | Стъпка 3 — Хранителен план |
| `KV/prompts/admin_modification_prompt.txt` | Модификация на план |
| `KV/prompts/admin_correction_prompt.txt` | Корекция на план |
| `KV/prompts/admin_summary_prompt.txt` | Обобщение |
| `KV/prompts/admin_consultation_prompt.txt` | Консултация / чат |

**Правила:**
- Промени в тези промпти → директно в съответния `.txt` файл в `KV/prompts/`.
- **Не** се пишат промпти inline в `worker.js`, освен за динамично изграждани секции (food lists).
- Динамичните секции (mainlist, whitelist, blacklist) се инжектират чрез placeholder-и като `{dynamicMainlistSection}` в шаблоните.

---

## 2. Минималност на промените в промптите

- **Принцип: минимум промени в промптите**, само когато е строго необходимо.
- Реда на работа: **1) Премахни/поправи проблемното → 2) Добави новото**.
- Не се добавят излишни думи, повторения или прекалено агресивни инструкции.
- Ако даден текст вече казва "ЗАДЪЛЖИТЕЛНО" или "САМО", не се дублира с "АБСОЛЮТНО ЗАДЪЛЖИТЕЛНО — БЕЗ ИЗКЛЮЧЕНИЯ".

---

## 3. KV Storage — ключове и структура

| KV ключ | Съдържание | Тип |
|---------|-----------|-----|
| `food_mainlist` | Основен списък с храни | `JSON string[]` |
| `food_mainlist_enabled` | Дали mainlist е активен | `"true"` / `"false"` |
| `food_mainlist_presets` | Именувани preset-и | `JSON { [name]: string[] }` |
| `food_whitelist` | Бял списък храни | `JSON string[]` |
| `food_blacklist` | Черен списък храни | `JSON (string | BlacklistEntry)[]` |
| `admin_meal_plan_prompt` | Override на Step 3 промпт | `string` (от KV/prompts ако не е override) |
| `ai_logging_enabled` | AI logging вкл/изкл | `"true"` / `"false"` |

---

## 4. Mainlist — как работи

- Когато `food_mainlist_enabled = "true"` И `food_mainlist` не е празен:
  - AI ползва **само** продуктите от списъка.
  - Whitelist-ът се потиска автоматично.
- Когато `food_mainlist_enabled = "false"` ИЛИ `food_mainlist` е празен:
  - AI работи нормално (whitelist/blacklist).
- Кеш: `getDynamicFoodListsSections()` кешира за 1 час. При промяна → `invalidateFoodListsCache()`.

---

## 5. Пайплайн — 4 стъпки

```
Стъпка 1 (Анализ)  →  Стъпка 2 (Стратегия)  →  Стъпка 3 (Хранителен план)  →  Стъпка 4 (Обобщение)
```

- Стъпка 1 → изходни данни: `macroGrams`, `macroRatios`, `nutritionalNeeds`.
- Стъпка 2 може да върне `adjustedMacroGrams` за override на Step 1 macros.
- Промптите за стъпки 1–4 → виж таблицата в т.1 по-горе.
- Динамичните food sections (mainlist/whitelist/blacklist) се инжектират само в Step 3 промпта.

---

## 6. Не се добавят нови markdown файлове

- Репото вече има **много** `.md` файлове (40+). Всяка нова функционалност **не** добавя нов `FEATURE_XYZ.md`.
- Документация → само при изрична заявка от потребителя.
- Съществуващи: `README.md`, `ARCHITECTURE.md`, `API_QUICK_REFERENCE.md`, `DEPLOYMENT_CHECKLIST.md`.

---

## 7. Правила за code review / агент

- Агентът **не** добавя прекалено агресивни промени в промптите без одобрение.
- Агентът **не** добавя нови markdown документационни файлове без изрична заявка.
- При всяка нова функция: **първо** се провери дали вече съществува подобна логика.
- Промените трябва да са **хирургически** — само засегнатите редове, минимален контекст.

---

*Последна актуализация: 2026-03-19*
