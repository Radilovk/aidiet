# Worker.js Module Import Guidelines

## Проблем (Problem)
След последните промени в worker.js се появиха TypeScript грешки при деплой заради липсващи `.js` разширения в module imports:
- `Cannot find module './config/adle-rules'. Did you mean to set the 'moduleResolution' option to 'nodenext'?`
- `Cannot find module './config/meal-formats'. Did you mean to set the 'moduleResolution' option to 'nodenext'?`
- `Cannot find module './utils/helpers'. Did you mean to set the 'moduleResolution' option to 'nodenext'?`

## Решение (Solution)
**ВАЖНО:** При import на локални модули в worker.js, **ВИНАГИ използвай** `.js` разширение!

### ✅ ПРАВИЛНО (CORRECT):
```javascript
import { ADLE_V8_HARD_BANS } from './config/adle-rules.js';
import { MEAL_NAME_FORMAT_INSTRUCTIONS } from './config/meal-formats.js';
import { estimateTokenCount } from './utils/helpers.js';
```

### ❌ ГРЕШНО (WRONG):
```javascript
import { ADLE_V8_HARD_BANS } from './config/adle-rules';
import { MEAL_NAME_FORMAT_INSTRUCTIONS } from './config/meal-formats';
import { estimateTokenCount } from './utils/helpers';
```

## Обяснение (Explanation)

### Защо С `.js`? (Why WITH `.js`?)
1. **ES Modules Standard**: Cloudflare Workers използват стандартни ES modules, които изискват пълно име на файла включително разширението
2. **TypeScript Type Checking**: TypeScript проверява кода и очаква `.js` extension за да резолве модулите правилно
3. **Browser-Compatible ES Modules**: Cloudflare Workers следват browser стандарта за ES modules, където трябва да се посочва разширението
4. **Modern JavaScript Practice**: Съвременният JavaScript (ES2015+) изисква експлицитно посочване на файловото разширение при относителни imports

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

1. **Локални модули** (Local modules): С `.js` extension
   ```javascript
   import { something } from './config/module.js';
   import { helper } from './utils/helper.js';
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
- [ ] Провери че всички imports имат `.js` extension
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
- ❌ НЕ пропускай `.js` extension в относителни imports
- ❌ НЕ създавай циклични dependencies между модулите
- ❌ НЕ импортвай worker.js в други модули (той е entry point)

## История на проблема (Problem History)

**Дата:** 2026-02-08  
**Проблем:** TypeScript TS2792 errors при deploy  
**Причина:** Import statements БЕЗ `.js` extensions  
**Решение:** Добавяне на `.js` extensions към всички imports  
**Засегнати редове:** 74, 76, 85 в worker.js  

**Предишна грешка (2026-02-08 по-рано):**
- Проблем: Използване на `estimateTokens()` вместо `estimateTokenCount()`
- Решение: Коригиране на името на функцията  

## Свързани документи (Related Documents)
- `CLOUDFLARE_BACKEND.md` - Архитектура на Cloudflare Worker
- `ARCHITECTURE.md` - Обща архитектура на приложението
- `wrangler.toml` - Конфигурация на Cloudflare Worker
