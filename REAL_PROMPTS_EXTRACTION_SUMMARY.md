# РЕШЕНИЕ: Реални промптове извлечени от worker.js

## Проблем
Промптовете в KV/prompts/ НЕ съответстваха на реалните промптове, използвани в worker.js. 
Това правеше невъзможно да се види какъв е действителният "промпт 3" (meal_plan) и останалите промпти.

## Решение

### 1. Извлечени ВСИЧКИ реални промптове от worker.js

Създадени са 7 файла в `KV/prompts/` с РЕАЛНИТЕ промптове от worker.js:

| Файл | Размер | Описание | Worker.js редове |
|------|--------|----------|------------------|
| `admin_analysis_prompt.txt` | 13KB | Стъпка 1: Холистичен анализ | 3954-4290 |
| `admin_strategy_prompt.txt` | 13KB | Стъпка 2: Диетична стратегия | 4422-4563 |
| **`admin_meal_plan_prompt.txt`** | **12KB** | **Стъпка 3: ADLE meal plan** ⭐ | **1456-1580** |
| `admin_summary_prompt.txt` | 1.4KB | Стъпка 4: Обобщение | 1914-1936 |
| `admin_consultation_prompt.txt` | 1.2KB | Чат консултация | 5034-5047 |
| `admin_modification_prompt.txt` | 5KB | Чат модификация | 5048-5127 |
| `admin_correction_prompt.txt` | 5.2KB | Корекция на грешки | 3252-3344 |

### 2. Актуализирана admin панел функция

Функцията `handleGetDefaultPrompt()` в worker.js е променена:
- **ПРЕДИ**: Връщаше грешка ако промптът не е в KV storage
- **СЕГА**: Връща hardcoded default промпт от worker.js ако няма в KV

### 3. Подробна документация

Създаден е подробен `KV/prompts/README.md` с:
- Размери на файловете
- Редове в worker.js където се намират
- Обяснение на placeholder формата
- Инструкции за upload към KV storage
- История на промените

## Prompt 3 - ПЪЛНО СЪДЪРЖАНИЕ

Промпт 3 (`admin_meal_plan_prompt.txt`) съдържа **12KB** текст с:

### ADLE v5.1 Архитектура
```
[PRO] БЕЛТЪК - Животински, Растителен, Смесен
[ENG] ЕНЕРГИЯ - Зърнени, Кореноплодни, Плодове  
[VOL] ОБЕМ И ФИБРИ - Сурови, Готвени зеленчуци
[FAT] МАЗНИНИ - Олио, ядки, семена
[CMPX] СЪСТАВНИ ЯСТИЯ - Пица, лазаня, яхнии
```

### Структурни шаблони
- Шаблон A: "РАЗДЕЛЕНА ЧИНИЯ" → [PRO] + [ENG] + [VOL]
- Шаблон B: "СМЕСЕНО ЯСТИЕ/КУПА" → Смес от компоненти
- Шаблон C: "ЛЕКО/САНДВИЧ" → [ENG-Хляб] + [PRO] + [FAT]
- Шаблон D: "ЕДИНЕН БЛОК" → [CMPX] + [VOL-Салата]

### Логически лостове
1. ФИЛТРИРАНЕ по модификатор (Веган, Кето, Без глутен)
2. ДЕКОНСТРУКЦИЯ на [CMPX] за съвместимост
3. АКТИВНОСТ НА КАТЕГОРИИТЕ според режим

### Hard bans и ограничения
- HARD BANS: лук, пуешко месо, мед, захар, кетчуп, майонеза, гръцко кисело мляко, грах+риба
- РЯДКО (≤2x/седмица): бекон, пуешка шунка
- WHITELIST/BLACKLIST: Динамични от KV storage

### Формат на имената на ястия
Детайлни инструкции как да се форматират names и descriptions с символи (•, -, *)

## Как да използвате новите промптове

### Вариант 1: Upload към KV storage (ПРЕПОРЪЧИТЕЛНО)

```bash
cd /home/runner/work/aidiet/aidiet
./KV/upload-kv-keys.sh
```

След upload:
- Worker-ът ще чете промптовете от KV storage
- Admin панелът ще показва промптовете от KV
- Промените ще са видими без deploy на worker.js

### Вариант 2: Използвайте embedded defaults

Ако не upload-нете към KV:
- Worker-ът ще използва hardcoded defaults от worker.js
- Admin панелът ще показва съобщение и ще fallback към примери
- След upload на файловете, всичко ще работи нормално

## Проверка

### В admin панел:
1. Отидете на https://aidiet.radilov-k.workers.dev/admin.html
2. Натиснете "View Default Prompt" до промпт 3 (meal_plan)
3. Трябва да видите пълните 12KB с ADLE архитектура

### В файловете:
```bash
# Провери размерите
ls -lh KV/prompts/*.txt

# Провери съдържанието на prompt 3
head -100 KV/prompts/admin_meal_plan_prompt.txt
```

## Важни бележки

⚠️ **КРИТИЧНО**: Промптовете в `KV/prompts/` и в `worker.js` ТРЯБВА да са СЪЩИТЕ!

- При промяна на промпт в worker.js → актуализирай файла в KV/prompts/
- При промяна на файл в KV/prompts/ → upload към KV или актуализирай worker.js
- Използвайте `./KV/upload-kv-keys.sh` за автоматичен upload

## Файлове променени

```
worker.js                               - handleGetDefaultPrompt + generateActualDefaultPrompt
KV/prompts/admin_analysis_prompt.txt    - 13KB реален промпт
KV/prompts/admin_strategy_prompt.txt    - 13KB реален промпт
KV/prompts/admin_meal_plan_prompt.txt   - 12KB реален промпт ⭐
KV/prompts/admin_summary_prompt.txt     - 1.4KB реален промпт
KV/prompts/admin_consultation_prompt.txt- 1.2KB реален промпт
KV/prompts/admin_modification_prompt.txt- 5KB реален промпт
KV/prompts/admin_correction_prompt.txt  - 5.2KB реален промпт
KV/prompts/README.md                    - Подробна документация
```

## Резултат

✅ Prompt 3 сега може да се види ИЗЦЯЛО (12KB)
✅ ВСИЧКИ промпти са реалните от worker.js
✅ Файловете са документирани с редове от worker.js
✅ Admin панелът показва източника (KV или embedded)
✅ README обяснява всичко подробно
