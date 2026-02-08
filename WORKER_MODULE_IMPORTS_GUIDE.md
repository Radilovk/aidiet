# Worker.js Module Import Guidelines

## Проблем (Problem)
След последните промени в worker.js се появиха TypeScript грешки при деплой заради неправилни module imports:
- `Cannot find module './config/adle-rules.js'`
- `Cannot find module './config/meal-formats.js'`
- `Cannot find module './utils/helpers.js'`

## Решение (Solution)
**ВАЖНО:** При import на локални модули в worker.js, **НЕ използвай** `.js` разширение!

### ❌ ГРЕШНО (WRONG):
```javascript
import { ADLE_V8_HARD_BANS } from './config/adle-rules.js';
import { MEAL_NAME_FORMAT_INSTRUCTIONS } from './config/meal-formats.js';
import { estimateTokenCount } from './utils/helpers.js';
```

### ✅ ПРАВИЛНО (CORRECT):
```javascript
import { ADLE_V8_HARD_BANS } from './config/adle-rules';
import { MEAL_NAME_FORMAT_INSTRUCTIONS } from './config/meal-formats';
import { estimateTokenCount } from './utils/helpers';
```

## Обяснение (Explanation)

### Защо без `.js`? (Why without `.js`?)
1. **TypeScript Type Checking**: По време на deploy, TypeScript проверява кода и не може да резолве модулите с `.js` extension без специална конфигурация
2. **Cloudflare Workers ES Modules**: Cloudflare Workers поддържа ES modules и автоматично резолва правилните файлове без нужда от extension
3. **Standard Practice**: За JavaScript модули в Node.js и Cloudflare Workers, стандартната практика е да се пропуска file extension при относителни imports

### Структура на модулите (Module Structure)
```
/aidiet
├── worker.js (main Cloudflare Worker)
├── config/
│   ├── adle-rules.js (food rules and constraints)
│   └── meal-formats.js (meal formatting instructions)
└── utils/
    └── helpers.js (utility functions)
```

## Правила за Import в worker.js (Import Rules for worker.js)

1. **Локални модули** (Local modules): БЕЗ `.js` extension
   ```javascript
   import { something } from './config/module';
   import { helper } from './utils/helper';
   ```

2. **NPM packages**: Използвай package name директно
   ```javascript
   import express from 'express';
   ```

3. **Cloudflare Workers APIs**: Използвай глобални обекти
   ```javascript
   // No imports needed - use env, ctx directly
   export default {
     async fetch(request, env, ctx) {
       // ...
     }
   }
   ```

## Checklist за бъдещи промени (Future Changes Checklist)

Преди да commit промени в worker.js:
- [ ] Провери че всички imports са БЕЗ `.js` extension
- [ ] Провери syntax с: `node --check worker.js`
- [ ] Провери че модулите съществуват в config/ или utils/
- [ ] Test локално с `wrangler dev` ако е възможно

## Допълнителни бележки (Additional Notes)

### Export формат в модулите (Export Format in Modules)
Всички модули трябва да използват **ES6 named exports**:

```javascript
// config/adle-rules.js
export const ADLE_V8_HARD_BANS = [...];
export const DEFAULT_FOOD_WHITELIST = [...];

// OR at the end of file:
export {
  ADLE_V8_HARD_BANS,
  DEFAULT_FOOD_WHITELIST
};
```

### Забранени практики (Forbidden Practices)
- ❌ НЕ използвай CommonJS (`require()`, `module.exports`)
- ❌ НЕ добавяй `.js` extension в относителни imports
- ❌ НЕ създавай циклични dependencies между модулите
- ❌ НЕ импортвай worker.js в други модули (той е entry point)

## История на проблема (Problem History)

**Дата:** 2026-02-08  
**Проблем:** TypeScript TS2792 errors при deploy  
**Причина:** Import statements с `.js` extensions  
**Решение:** Премахване на `.js` extensions от всички imports  
**Засегнати редове:** 74, 76, 85 в worker.js  

## Свързани документи (Related Documents)
- `CLOUDFLARE_BACKEND.md` - Архитектура на Cloudflare Worker
- `ARCHITECTURE.md` - Обща архитектура на приложението
- `wrangler.toml` - Конфигурация на Cloudflare Worker
