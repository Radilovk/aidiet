# Cloudflare Worker Backend - Важна Информация

## Какво е Cloudflare Worker?

**Cloudflare Workers** е serverless платформа за изпълнение на JavaScript код на ръба на мрежата (edge computing). 

### Основни характеристики:

1. **URL на бекенда**: `https://aidiet.radilov-k.workers.dev/`
2. **Входна точка**: `worker.js` - основният файл на Worker-а
3. **Конфигурация**: `wrangler.toml` - Cloudflare Worker конфигурация
4. **Runtime**: V8 JavaScript engine (същият като в Chrome)
5. **Модулна система**: ES6 Modules (import/export syntax)

## Модулна структура

Worker.js използва **ES6 модулна система** с import/export:

```javascript
// Правилен начин за import (С .js extension):
import { function1, function2 } from './path/to/module.js';

// Правилен начин за export:
export { constant1, constant2, function1 };
export function myFunction() { ... }
```

### Важни файлове и модули:

```
worker.js                    # Главен Worker файл
├── config/
│   ├── adle-rules.js       # ADLE v8 правила и ограничения
│   └── meal-formats.js     # Форматиране на храненията
└── utils/
    └── helpers.js          # Помощни функции
```

## Често срещани грешки и как да ги избегнем

### 1. Import С .js extension е ЗАДЪЛЖИТЕЛЕН

✅ **Правилно:**
```javascript
import { something } from './config/module.js';
```

❌ **Грешно:**
```javascript
import { something } from './config/module';
```

**Обяснение:** Cloudflare Workers използват стандартни ES modules, които изискват експлицитно посочване на файловото разширение при относителни imports.

### 2. Имената на функциите трябва да съвпадат

❌ **Грешно:**
```javascript
import { estimateTokenCount } from './utils/helpers.js';
// По-късно в кода:
const tokens = estimateTokens(text); // Грешка! Функцията е estimateTokenCount
```

✅ **Правилно:**
```javascript
import { estimateTokenCount } from './utils/helpers.js';
// По-късно в кода:
const tokens = estimateTokenCount(text); // Правилно!
```

### 3. Export и Import трябва да съвпадат

При експортиране на константи/функции в модул:

```javascript
// config/adle-rules.js
const HARD_BANS = [...];
export { HARD_BANS };
```

При импортиране ги използвайте със същото име:

```javascript
// worker.js
import { HARD_BANS } from './config/adle-rules.js';
```

## Деплоймънт процес

### Локално тестване:
```bash
npm run dev
# или
wrangler dev
```

### Деплоймънт в production:
```bash
npm run deploy
# или
wrangler deploy
```

### TypeScript проверка преди деплой:

Cloudflare използва TypeScript за проверка на типовете дори в JavaScript файлове. 
Грешките от проблемния statement показват TypeScript errors:

```json
{
  "owner": "typescript",
  "code": "2792",
  "message": "Cannot find module './config/adle-rules.js'..."
}
```

Тези грешки означават:
- Модулът не може да бъде намерен
- Неправилно име на функция/константа
- Липсващ export/import

## Решение на проблема от 2026-02-08

### Причина за грешките:

TypeScript TS2792 errors при deploy заради липсващи `.js` extensions в import statements.

### Поправката:

Всички imports на локални модули трябва да включват `.js` extension:

```javascript
// Правилно:
import { ADLE_V8_HARD_BANS } from './config/adle-rules.js';
import { MEAL_NAME_FORMAT_INSTRUCTIONS } from './config/meal-formats.js';
import { estimateTokenCount } from './utils/helpers.js';
```

**Засегнати редове в worker.js:** 74, 76, 85

### История на проблеми:
1. **По-ранна грешка (2026-02-08):** Използване на `estimateTokens()` вместо `estimateTokenCount()` на ред 1984
2. **Текуща грешка (2026-02-08):** Липсващи `.js` extensions в imports

## Проверка преди commit

Винаги проверявайте:

1. ✅ Import statements използват `.js` extension
2. ✅ Всички импортирани имена съществуват в съответния модул
3. ✅ Функциите се извикват с правилното име (същото като в import)
4. ✅ Export statements съдържат всички използвани константи/функции

## KV Storage

Worker използва Cloudflare KV (Key-Value) storage за:
- Admin панел конфигурация
- AI промптове
- Whitelist/Blacklist за храни
- AI комуникационни логове (ограничени)

KV Namespace: `page_content` (ID: 81fc0991b2764918b682f9ca170abd4b)

## API Endpoints

Worker предоставя следните endpoints:

- `POST /api/generate-plan` - Генериране на хранителен план
- `POST /api/chat` - Чат с AI асистент
- Admin панел endpoints за управление на конфигурацията

## Важно за бъдещи промени

1. **НЕ променяйте модулната структура** без да обновите всички import statements
2. **НЕ преименувайте функции** без да обновите всички места където се използват
3. **ВИНАГИ тествайте локално** с `npm run dev` преди деплой
4. **ПРОВЕРЯВАЙТЕ TypeScript errors** - те показват реални проблеми

## Референции

- [Cloudflare Workers документация](https://developers.cloudflare.com/workers/)
- [ES6 Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
