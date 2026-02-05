# PWA 404 Fix for Custom Domain - February 2026

## Проблем (Problem)
При инсталация на PWA (Progressive Web App) се получава 404 грешка "file not found" когато се използва персонален домейн `biocode.website`.

**English**: When installing PWA (Progressive Web App), a 404 "file not found" error occurs when using custom domain `biocode.website`.

## Причина (Root Cause)
Репозиторият използва персонален домейн (`biocode.website` в CNAME файла), но PWA конфигурацията (manifest.json и sw.js) беше настроена за GitHub Pages поддиректория (`/aidiet/`).

**Ключова разлика:**
- **GitHub Pages без персонален домейн**: Файловете се обслужват от `/aidiet/` (поддиректория)
  - URL: `https://radilovk.github.io/aidiet/`
- **GitHub Pages с персонален домейн**: Файловете се обслужват от root `/` 
  - URL: `https://biocode.website/`

**English**: The repository uses a custom domain (`biocode.website` in CNAME file), but PWA configuration (manifest.json and sw.js) was configured for GitHub Pages subdirectory (`/aidiet/`).

**Key difference:**
- **GitHub Pages without custom domain**: Files served from `/aidiet/` (subdirectory)
  - URL: `https://radilovk.github.io/aidiet/`
- **GitHub Pages with custom domain**: Files served from root `/`
  - URL: `https://biocode.website/`

## Решение (Solution)

### Променени файлове (Changed files):

#### 1. manifest.json
Променени са всички пътища от `/aidiet/` на `/`:

**English**: All paths changed from `/aidiet/` to `/`:

```json
// ПРЕДИ (BEFORE):
{
  "id": "/aidiet/",
  "start_url": "/aidiet/",
  "scope": "/aidiet/",
  "icons": [
    { "src": "/aidiet/icon-192x192.svg", ... },
    { "src": "/aidiet/icon-192x192.png", ... },
    { "src": "/aidiet/icon-512x512.svg", ... },
    { "src": "/aidiet/icon-512x512.png", ... }
  ]
}

// СЛЕД (AFTER):
{
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "icons": [
    { "src": "/icon-192x192.svg", ... },
    { "src": "/icon-192x192.png", ... },
    { "src": "/icon-512x512.svg", ... },
    { "src": "/icon-512x512.png", ... }
  ]
}
```

**Промени (Changes):**
- `id`: `/aidiet/` → `/`
- `start_url`: `/aidiet/` → `/`
- `scope`: `/aidiet/` → `/`
- 4 icon paths: `/aidiet/icon-*` → `/icon-*`

#### 2. sw.js (Service Worker)
Променена е BASE_PATH константата:

**English**: Changed BASE_PATH constant:

```javascript
// ПРЕДИ (BEFORE):
const BASE_PATH = '/aidiet';
const CACHE_NAME = 'nutriplan-v1';

// СЛЕД (AFTER):
const BASE_PATH = '';
const CACHE_NAME = 'nutriplan-v2';
```

**Защо празен string?** (Why empty string?)
С празен BASE_PATH, template literals като `${BASE_PATH}/index.html` се превръщат в `/index.html` (правилно за root).

**English**: With empty BASE_PATH, template literals like `${BASE_PATH}/index.html` become `/index.html` (correct for root).

**Защо v2?** (Why v2?)
Променен е CACHE_NAME от `nutriplan-v1` на `nutriplan-v2` за да се принуди браузърът да обнови кеша при следващата инсталация.

**English**: Changed CACHE_NAME from `nutriplan-v1` to `nutriplan-v2` to force browser to update cache on next installation.

### HTML файловете остават непроменени (HTML files remain unchanged)
HTML файловете (`index.html`, `plan.html` и др.) използват **относителни пътища** които работят коректно и в двата случая:

**English**: HTML files use **relative paths** that work correctly in both cases:

```html
<link rel="manifest" href="./manifest.json">
<script>
  navigator.serviceWorker.register('./sw.js')
</script>
```

Тези пътища се интерпретират спрямо локацията на HTML файла, независимо дали е на `/aidiet/index.html` или `/index.html`.

**English**: These paths are interpreted relative to HTML file location, whether it's at `/aidiet/index.html` or `/index.html`.

## Как да тествате (How to test)

### Стъпка 1: Деинсталирайте старата PWA (Step 1: Uninstall old PWA)
**Android:**
- Дълго натискане на иконата NutriPlan
- Изберете "Деинсталиране" / "Uninstall"

**iOS:**
- Дълго натискане на иконата NutriPlan
- Изберете "Премахване на приложение" / "Remove App"

### Стъпка 2: Изчистете кеша (Step 2: Clear cache)
**Android Chrome:**
- Настройки → Поверителност и сигурност → Изчистване на данни за сърфиране
- Изберете "Кеширани изображения и файлове"

**iOS Safari:**
- Настройки → Safari → Изчистване на история и данни на уебсайтове

### Стъпка 3: Отворете приложението (Step 3: Open application)
Отидете на:
- **Персонален домейн**: https://biocode.website/
- **GitHub Pages**: https://radilovk.github.io/aidiet/ (ако домейнът не работи)

**English**: Go to:
- **Custom domain**: https://biocode.website/
- **GitHub Pages**: https://radilovk.github.io/aidiet/ (if domain doesn't work)

### Стъпка 4: Проверете Service Worker (Step 4: Check Service Worker)
Отворете Developer Tools (F12) → Application/Приложение → Service Workers
- Трябва да видите че `sw.js` е регистриран
- Status трябва да е "activated and is running"

### Стъпка 5: Инсталирайте PWA (Step 5: Install PWA)
**Android Chrome:**
- Меню (⋮) → "Инсталиране на приложение" / "Install app"
- Или икона "+" в адресната лента

**iOS Safari:**
- Бутон Споделяне (⬆️) → "Добави към началния екран" / "Add to Home Screen"

### Стъпка 6: Отворете от началния екран (Step 6: Open from home screen)
- Натиснете иконата на NutriPlan
- **Очакван резултат**: Приложението се отваря без 404 грешка
- **Проверете**: URL в адресната лента трябва да е `https://biocode.website/` (или съответния домейн)

**English**: 
- Tap NutriPlan icon
- **Expected result**: App opens without 404 error
- **Check**: URL should be `https://biocode.website/` (or respective domain)

## Валидация (Validation)
Създаден е validation script който проверява конфигурацията:

**English**: Created validation script that checks configuration:

```bash
cd /home/runner/work/aidiet/aidiet
node /tmp/validate-pwa.js
```

**Очаквани резултати (Expected results):**
```
✅ Validation Results:
  - Manifest configured for root: ✅ PASS
  - Service Worker configured for root: ✅ PASS
  - No old /aidiet/ paths: ✅ PASS

🎉 All checks passed! PWA is configured for custom domain.
```

## Важно! За бъдещи промени (Important! For future changes)

### Ако искате да върнете на GitHub Pages без персонален домейн:
**English**: If you want to revert to GitHub Pages without custom domain:

1. Изтрийте `CNAME` файла / Delete `CNAME` file
2. Променете в `manifest.json`:
   - `id`, `start_url`, `scope`: `/` → `/aidiet/`
   - Всички икони: `/icon-*` → `/aidiet/icon-*`
3. Променете в `sw.js`:
   - `BASE_PATH`: `''` → `'/aidiet'`
   - `CACHE_NAME`: increment версията (напр. v3)

### Ако персоналният домейн не работи:
**English**: If custom domain doesn't work:

GitHub Pages URL все още трябва да работи: https://radilovk.github.io/aidiet/

**НО** с текущата конфигурация ще получите 404, защото файловете са конфигурирани за root `/`.

**English**: BUT with current configuration you'll get 404, because files are configured for root `/`.

**Решение**: Използвайте validation script-а и го модифицирайте да проверява за `/aidiet/` вместо `/`.

**English**: Solution: Use the validation script and modify it to check for `/aidiet/` instead of `/`.

## Технически детайли (Technical details)

### Защо работят празни stringove в JavaScript?
**English**: Why do empty strings work in JavaScript?

```javascript
const BASE_PATH = '';
console.log(`${BASE_PATH}/index.html`);  // Output: "/index.html"
```

JavaScript template literals автоматично конкатенират празния string с останалата част на пътя.

**English**: JavaScript template literals automatically concatenate empty string with rest of path.

### Защо service worker има специален BASE_PATH?
**English**: Why does service worker have special BASE_PATH?

Service worker работи в **отделен контекст** от HTML файловете. Когато се зарежда:
1. HTML се зарежда от правилната локация (напр. `/aidiet/index.html`)
2. Service worker се регистрира от тази локация
3. **НО** service worker кодът се изпълнява в **global scope**
4. Относителните пътища в service worker се интерпретират спрямо **root domain**, не спрямо локацията на HTML

**English**: Service worker runs in **separate context** from HTML files. When loaded:
1. HTML loads from correct location (e.g. `/aidiet/index.html`)
2. Service worker registers from that location
3. **BUT** service worker code executes in **global scope**
4. Relative paths in service worker are interpreted relative to **root domain**, not HTML location

Затова трябва да използваме **абсолютни пътища** в service worker!

**English**: That's why we must use **absolute paths** in service worker!

## Свързани документи (Related documents)
- `PWA_404_FIX_2026.md` - Предишна поправка (преди персонален домейн)
- `PWA_FIX_2025_ICON_AND_URL.md` - PWA икони и URL поправки
- `CNAME` - Конфигурация на персонален домейн

## Статус (Status)
✅ **Завършено и готово за деплой** / **Completed and ready for deployment**

## Дата (Date)
**2 февруари 2026** / **February 2, 2026**

## Автор (Author)
GitHub Copilot Workspace Agent
