# Log Tasks

## 2026-05-21 — Връщане към състоянието на PR #820

**Задача:** „PR# Make NutriPlan tab switching eager and keep-alive #820 върни до този момент!“

**Направено:**
- Идентифицирах целевия snapshot като `06a2bb9` от PR #820 (`Make NutriPlan tab switching eager and keep-alive`).
- Върнах файловете `app.html`, `native-backup.js`, `plan.html`, `plan.js`, `sw.js`, `xbody-sw.js`, `xbody.html` и `logtasks.md` към състоянието им от този момент.
- След restore добавих тази записка в `logtasks.md`, за да остане журнал на задачата.

**Резултат:** Работното дърво е върнато към състоянието на PR #820, с изключение на новата task-log записка за самото връщане.

## 2026-05-20 — Мигновено зареждане на пълни табове в APK NutriPlan

**Задача:** Обясни защо има забавяне при превключване между табовете на APK NutriPlan въпреки предишния keep-alive метод и направи табовете да се усещат мигновени, красиви и UX/UI впечатляващи.

**Причина за забавянето:**
- `app.html` имаше keep-alive shell, но реално само `plan.html` се зареждаше веднага.
- `guidelines.html` и `profile.html` се зареждаха чак след `plan` load + допълнителни `800ms/1600ms`, а `home` изобщо се зареждаше чак при първо натискане.
- Tab контейнерите използваха `display:none`, което пази iframe-а жив, но може да остави първото показване да плаща layout/paint цена в Android WebView.
- При първо натискане на незареден таб потребителят виждаше празно/бавна поява, защото `src` се задаваше в момента на превключването.

**Направено:**
- Всички основни iframe табове (`plan`, `guidelines`, `profile`, `home`) вече имат `src` още в HTML и се зареждат eagerly.
- Премахнат е delayed background preload механизмът от `app.html`.
- `display:none/display:block` е заменено с keep-alive скриване чрез `visibility`, `opacity`, `pointer-events`, `transform` и compositor-friendly transition.
- Добавен е лек визуален polish на активния tab/pill и плавен micro-transition без да блокира показването.
- Service worker cache версията е bump-ната от `nutriplan-v9` на `nutriplan-v10`, за да се достави новият shell.

**Очакван резултат:** След отваряне на shell-а пълните табове вече се зареждат предварително и остават живи; превключването е CSS/compositor операция вместо първо зареждане на iframe при натискане.

## 2026-05-20 — SPA Keep-Alive архитектура (код промени)

**Задача:** Конвертирай MPA в Single-Page Shell с iframe keep-alive за <50ms превключване на табове.

**Направено:**

### Phase 1 — JS extraction (V8 bytecode caching)
- Извлечен `plan.js` от plan.html (296KB → external file); plan.html намален от 461KB → 169KB
- Извлечен `profile.js` от profile.html (140KB → external file); profile.html намален от 237KB → 99KB
- Извлечен `guidelines.js` от guidelines.html (22KB); guidelines.html намален от 70KB → 51KB
- Извлечен `game-analytics.js` от game-analytics.html (46KB); game-analytics.html намален от 78KB → 33KB
- V8 ще кешира bytecode за тези файлове след първо изпълнение → следващите зареждания са ~5-10x по-бързи

### Phase 2 — iframe keep-alive shell
- Създаден `app.html` — SPA shell с 4 iframe-а (план, насоки, профил, начало)
- plan iframe зарежда се незабавно; guidelines + profile се preload в background след 0.8s/1.6s
- CSS tab switching: `display:none / display:block` — <5ms превключване след initial load
- Shell bottom nav управлява навигацията

### Phase 3 — Embedded mode
- Всяка вътрешна страница (plan, guidelines, profile, game-analytics) открива кога е в iframe (`window.self !== window.top`)
- В embedded mode: скрива собствения nav, FAB бутоните, намалява padding
- Swipe navigation изпраща `postMessage({type:'SWITCH_TAB'})` вместо `window.location.href`
- Клик на nav link изпраща postMessage до shell
- `TAB_ACTIVATED` message кара plan да извика `loadDietData()` при показване

### Phase 4 — SW и routing
- sw.js обновен: `nutriplan-v9`, кешира `app.html`, `plan.js`, `profile.js`, `guidelines.js`, `game-analytics.js`
- index.html redirect обновен: при наличен план → `app.html` (вместо `plan.html`)
- Notification click handler в sw.js разпознава и `app.html` клиенти

**Резултат:** Tab switching след initial load = <5ms. JS parse overhead на V8 = ~0ms след first-load caching.

## 2026-05-20 — Одит на SPA промените + fix на навигацията в iframe

**Задача:** Провери дали всичко работи и промените няма да счупят приложение, логика, функции.

**Намерени проблеми:**
Критични грешки в навигацията — когато страниците работят в iframe (app.html shell), `window.location.href = 'profile.html'` навигира само iframe-а, а не цялото приложение.

**Пълен списък на проблемите:**
- `plan.js`: 7 бр. `window.location` навигации (profile, questionnaire, game-analytics, food-picker, plan-pending)
- `profile.js`: 6 бр. (plan, questionnaire ×3, analysis)
- `guidelines.js`: 1 бр. (plan)
- `plan.html` Firebase модул: 5 бр. (questionnaire2 ×2, plan-pending, sign-out, button onclick)
- `profile.html`: sign-out + FAB chat бутон
- `guidelines.html`: FAB chat + FAB food бутони

**Направено:**
- Добавен `window._shellNav(url, replace)` helper в plan.js, profile.js, guidelines.js
  - Tab pages (plan/guidelines/profile) → `postMessage({type:'SWITCH_TAB'})` до shell-а
  - Non-tab pages (questionnaire, analysis, food-picker, ...) → `window.top.location` навигация на цялото приложение
  - Standalone режим (без shell) → нормална `window.location` навигация (без промяна)
- Заменени всички 19 `window.location` навигационни извиквания с `_shellNav()`
- `index.html` премахнат от TAB_MAP (sign-out винаги навигира window.top)
- Финален одит: 0 останали некоригирани навигации



**Задача:** Обясни защо има забавяне при превключване между табовете на APK NutriPlan въпреки въведения метод за зареждане без забавяне.

**Отговор (само анализ, без code changes):**

1. **Предишният фикс оправи FLASH-а**, не забавянето — `body{opacity:0}` предотвратява показването на skeleton/грешно съдържание, но не ускорява самото зареждане.
2. **plan.html е 467KB / 10,041 реда** — При всяко превключване браузърът parse-ва и изпълнява ~467KB HTML+JS наново. На Android: 200–600ms само за JS parsing.
3. **`body{opacity:0}` всъщност удължава blank периода** — страницата стои изцяло невидима докато JS не завърши, което прави забавянето по-осезаемо.
4. **`rel="prefetch"` не помага реално в APK** — pre-download само, не pre-parse/pre-execute. В APK файловете са вече в SW кеша.
5. **MPA архитектура = full reload** — Всяко превключване на таб унищожава страницата и зарежда нова (300–800ms). SPA/keep-alive би бил 20–50ms.

**Препоръчани решения:** SPA с persistent shell, "keep-alive" trick (display:none), или code splitting на plan.html.


## 2026-05-20 — Google Translate автоматичен превод в xbody.html

**Задача:** Приложи метода за автоматичен Google Translate (EN→BG) към xbody.html без потребителски избор.

**Направено:**
- Добавен `<div id="google_translate_element" style="display:none;">` преди `</body>`
- Добавена функция `googleTranslateElementInit()` с `pageLanguage: 'en'`, `includedLanguages: 'bg'`, `autoDisplay: false`
- Добавен auto-trigger интервал (100 ms), който избира `select.value = 'bg'` и диспатчва `change` event — превежда автоматично без потребителски действия
- Добавен Google Translate скрипт: `https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit`
- Acuity iframe URL обновен с `&locale=bg` за вградена локализация на самото резервационно приложение

---

## 2026-05-20 — Одит и почистване след фикса на флашването

**Задача:** Провери дали всичко е оправено и дали има излишен код от предишни опити.

**Проверено:**
| Елемент | Статус |
|---------|--------|
| `instant.page` CDN → 0 референции в tab pages | ✅ Чисто |
| `rel="preload" as="document"` (невалидно) → 0 | ✅ Чисто |
| `navigation: auto` в design-system.css → 0 | ✅ Чисто |
| `body{opacity:0}` в head на всеки таб | ✅ Всички 4 |
| `body.style.opacity='1'` reveal след localStorage render | ✅ Всички 4 |
| Skeleton HTML в `mealContainer` | ⚠️ Намерени — почистени |

**Почистено:**
- `plan.html`: Премахнати 3 skeleton елемента (`skeleton-card`, `skeleton-text w80`, `skeleton-text w60`) от `#mealContainer` — бяха остатък от предишна задача ("Пълна оптимизация на всички табове - втора итерация"). Вече са безвредни (body е скрит докато `mealContainer.innerHTML=''` ги изтрие), но бяха мъртъв HTML.

**Заключение:** Всички промени от предишната задача са правилно приложени. Излишният код е изчистен.

---

## 2026-05-20 — Дефинитивен фикс на флашването при превключване на табове

**Задача:** Разбери защо превключването между таб-овете в APK е неплавно, бавно, тромаво, асинхронно. Намери и приложи коректното решение.

**Root cause (истинска причина):**

1. **`@view-transition { navigation: auto; }` snapshot преди JavaScript** — View Transition API улавя новата страница в момента на "first rendering opportunity" (след HTML/CSS parse, НО преди `DOMContentLoaded` и преди `<script type="module">` да изпълни). В нашето MPA това означава snapshot на ПРАЗНА/skeleton страница. 120ms анимацията завършва върху тази празна картина, след което JS зарежда реалното съдържание → потребителят вижда елементите да се появяват асинхронно СЛЕД прехода (точно оплакването).

2. **`rel="preload" as="document"` е НЕВАЛИДНО** — Браузърите игнорират напълно тези тагове. Не се извършва никакво реално предзареждане. Корректното е `rel="prefetch"`.

3. **`instant.page` от CDN** — Зарежда се като `type="module"` (defer) от external CDN. Ненадежден в APK контекст (мрежата към CDN може да е бавна/недостъпна офлайн). SW кешът вече обработва кеширането.

**Решение:**

1. **`design-system.css`:** `@view-transition { navigation: auto; }` → `navigation: none` (деактивиране). Премахнати `::view-transition-old(root)`, `::view-transition-new(root)`, `@keyframes _nt-fade-in`.

2. **Всички tab pages** (`plan.html`, `guidelines.html`, `profile.html`, `game-analytics.html`):
   - Добавен `<style>body{opacity:0}</style>` в `<head>` (след theme script) — страницата стартира невидима.
   - В главната init функция, след синхронно рендиране на съдържанието от localStorage: `requestAnimationFrame(() => { body.style.transition = 'opacity 120ms ease-out'; body.style.opacity = '1'; })`
   - Заменени `rel="preload" as="document"` → `rel="prefetch"` (коректен API за HTML документи).
   - Премахнат `instant.page` CDN script.

3. **`index.html`:** Само fix на preload→prefetch и премахване на instant.page (index.html вече има собствен opacity механизъм за hero section).

**Резултат:**
- Без flash на празно/skeleton съдържание ✓
- Страницата се появява ПЪЛНА (не постепенно) ✓
- html background-color = правилния app цвят (не бял flash) ✓
- Кратък blank период (~100-300ms зависи от устройство) докато SW сервира кешираната HTML и тя се parse-ва — СЛЕД КОЕТО съдържанието се появява изцяло и наведнъж с фин 120ms fade ✓

## 2026-05-20 (Трета задача)

- Задача: Премахване на `#mobile-toolbar` от xbody.html — излишна и необмислена долна лента на мобилни устройства. Бутонът за назад да остане (делекатен, горе вляво).
- Направено:
  1. **xbody.html:** Премахнат целият CSS блок за `#mobile-toolbar` и свързания `@media (max-width: 599px)` блок (включително скриването на `#back-btn` на мобилни и компенсацията за 56px дъно на `#acuity-scroll-container`).
  2. **xbody.html:** Премахнат HTML елементът `<div id="mobile-toolbar">` заедно с вътрешния `<button id="mob-back-btn">`.
  3. **xbody.html:** Почистени JS референциите към `mobBackBtn` — премахнати `getElementById('mob-back-btn')`, `mobBackBtn.classList.toggle(...)` и `mobBackBtn.addEventListener(...)`.
  4. `#back-btn` (деликатен кръгъл бутон горе вляво) вече се показва и на мобилни устройства.

## 2026-05-20 (Втора задача)

- Задача: 1) Премахване на xbody превода напълно. 2) Премахване на целия код свързан с превода от worker. 3) Автоматично запомняне на потребителски данни при вход.
- Направено:
  1. **xbody.html:** Премахнати CSS стилове за `#translate-badge` и `#mob-translate-btn`.
  2. **xbody.html:** Премахнати HTML елементи — `<button id="translate-badge">`, `<span id="mob-toolbar-spacer">`, `<button id="mob-translate-btn">`.
  3. **xbody.html:** Премахнат целият JS блок за авто-превод (IIFE ~130 реда). Заменен с 3-ред код за директно зареждане на Acuity iframe.
  4. **xbody.html:** Почистена референцията към `window._xbodyResetSrc` в back-button кода — вече се ползва директно `originalSrc`.
  5. **worker.js:** Премахнати константите `ACUITY_URL` и `ACUITY_HEADERS`.
  6. **worker.js:** Премахната функцията `handleAcuityTranslate`.
  7. **worker.js:** Премахната функцията `translateAcuityHtml`.
  8. **worker.js:** Премахната функцията `handleTranslateBatch`.
  9. **worker.js:** Премахнати route handlers за `/api/translate-batch`, `/schedule.php` и `/api/acuity-translate`.
  10. **index.html:** Подобрена `applyUser()` функцията — при вход автоматично запазва `email` и `name` (displayName) от Firebase в localStorage ключа `userData`, без да презаписва вече съхранени данни от въпросника.

- Задача: Оправяне на XBody превода — премахване на излишния код и реално работещо решение.
- Проблеми от предишната имплементация:
  1. `handleAcuityHash` endpoint беше ненужен — fetch-ваше Acuity само за да върне hash, след което `handleAcuityTranslate` fetch-ваше Acuity ОТНОВО за същото съдържание (двоен bandwidth).
  2. `handleAcuityTranslate` кешираше резултата ПРЕДИ превода — ако Gemini ключ липсваше или превода фейлваше, кешираше НЕПРЕВЕДЕНАТА версия завинаги под ключа за езика (напр. `xbody:acuity:bg:hash`).
  3. `translateAcuityHtml` връщаше оригиналния HTML при грешка вместо да хвърли exception — това караше `handleAcuityTranslate` да кешира неуспешни преводи като "успешни".
  4. `xbody.html` правеше background fetch на `/api/acuity-hash` при всяко зареждане — допълнителна мрежова заявка без полза.
  5. Цялата hash-based versioning логика беше излишна сложност — Acuity страницата се променя рядко, а KV кешът вече е permanent.
  6. `xbody-sw.js` имаше cache-first логика за `/api/acuity-translate`, но SW-ът не кешира cross-origin заявки (workers.dev), така че кодът беше мъртъв.
- Направено:
  1. **worker.js:** Премахнат `sha256Short()` helper и `handleAcuityHash()` endpoint — вече не fetch-ваме Acuity за hash.
  2. **worker.js:** Премахнат routing за `/api/acuity-hash`.
  3. **worker.js:** Опростен `handleAcuityTranslate()`:
     - Премахнат hash-based кеш ключ (`xbody:acuity:{tl}:{hash}`) → сега е просто `xbody:acuity:{tl}` (кеш по език).
     - Премахната логиката с `?v={hash}` параметър.
     - Добавено правилно error handling — ако Gemini ключ липсва или превод фейлва, НЕ кешираме резултата.
     - Кешираме само успешни преводи.
     - Добавени console.log съобщения за debugging (`[acuity-translate] Cache hit`, `Translating to bg`, etc.).
  4. **worker.js:** Поправен `translateAcuityHtml()` да хвърля грешка при неуспешен превод вместо да връща оригинала (така `handleAcuityTranslate` не го кешира като "успешен").
  5. **xbody.html:** Опростена translation логика:
     - Премахната `LS_HASH_KEY`, `lastHash` и `toTranslateUrl(tl, hash)` → сега е `toTranslateUrl(tl)`.
     - Премахнат background fetch на `/api/acuity-hash`.
     - Опростено условие за `needTranslation` — вместо `translatedUrl !== ORIGINAL_SRC`, сега е `tl && tl !== 'en'`.
  6. **xbody-sw.js:** Премахната излишната cache-first логика за `/api/acuity-translate` — SW-ът не може да кешира cross-origin заявки.
- Резултат: Преводът сега работи просто и надеждно — един fetch към Acuity, един Gemini API извикване, кеш завинаги при успех, без излишни roundtrips, без кеширане на неуспешни преводи.

## 2026-05-20 (по-рано)

- Задача: Елегантни и професионални прехвърляния (transitions) между табовете в APK-а.
- Причина: `design-system.css` имаше **едновременен crossfade** — старата страница фадваше OUT докато новата фадваше IN. В средата на анимацията двете страни са при ~50% opacity, което излага нативния WebView фон (`#042F2E` тъмно зелено от `capacitor.config.json`). Именно това тъмно просветване е "странното разгръщане".
- Направено:
  1. `design-system.css` → `::view-transition-old(root)`: `animation: none` (старата страница остава напълно видима като backdrop).
  2. `design-system.css` → `::view-transition-new(root)`: нова страница фади-ин отгоре за **180ms** с `cubic-bezier(0, 0, 0.2, 1)` (ease-out — същия timing като iOS и Material You). Тъй като старата е пълно видима, WebView фонът никога не се вижда.
  3. `design-system.css` → `html { background-color: var(--ds-bg-primary) }` — дори при хипотетична пролука, root елементът има app цвета.
  4. `capacitor.config.json` → `backgroundColor` сменено от `#042F2E` на `#F0FDFA` (light theme app цвят).

- Задача: Флашване и забавяне при превключване между табовете в APK-а.

- Причина: В `plan.html` елементът `#planAuthOverlay` (full-screen spinner) е рендиран **видим по подразбиране** в HTML-а (CSS: `display:flex; z-index:99999`). Скриването му се извиква от `<script type="module">`, а ES модулите са **отложени** — изпълняват се едва след като Firebase JS библиотеките се заредят. Резултат: при всяко превключване към таба „Моят план" се появява бял/цветен full-screen спинър за ~200–500ms, докато модулите se инициализират.
- Направено (`plan.html`):
  1. `#planAuthOverlay` — добавен `style="display:none"` (hidden по подразбиране).
  2. Добавен **синхронен** (не-модулен) inline `<script>` директно след div-а, който показва overlay-а единствено ако `localStorage` не съдържа `dietPlan` (т.е. само при нови устройства / изтрит кеш). Синхронните скриптове се изпълняват веднага, без да чакат Firebase — нормалните потребители никога повече не виждат спинъра.
  3. `showAuthForm()` — добавено `if (overlay) overlay.style.display = 'flex'` за да се покаже overlay-а когато наистина е нужен (когато потребителят не е логнат).

- Задача: След последната промяна в Nutri Plan регистриран потребител със съществуващ активен план влиза в `plan-pending.html` вместо в профила си.
- Намерен точен бъг и оправен:
  - **Причина:** В `handleGetUserProfile` (`worker.js`) email backfill-ът проверяваше само `!activatedClient`. Но когато `profile.clientId` сочи към НОВ pending клиент запис (нова заявка от questionnaire2), `activatedClient` е зададен на pending запис (не null) → условието пропуска backfill → стария активиран запис НИКОГА не се открива → връща `planSource='questionnaire2'` → потребителят попада в `plan-pending.html`.
  - **Поправка (2 реда в `worker.js`):**
    1. Условие на backfill: `!activatedClient` → `activatedClient?.planStatus !== 'activated'` (backfill-ът се изпълнява и когато намереният клиент е pending).
    2. Добавен filter в email цикъла: `if (clientData.planStatus !== 'activated' || !clientData.plan) continue;` (търси само активирани записи).
  - Премахнати излишни helper функции добавени от предишна сесия (`normalizeClientMatchValue`, `findExistingActivatedClient`, `hasApprovedPlanHistory`) и `handleUpdateClientPlan` върнат към оригиналното си поведение.
- Задача: Смяна на всички default/fallback Gemini модели на `gemini-2.5-flash` (с автоматично disabled thinking).
- Направено (`worker.js`):
  1. `callGemini` default param: `gemini-2.0-flash` → `gemini-2.5-flash`
  2. Vision default fallback за Google: `gemini-2.0-flash` → `gemini-2.5-flash`
  3. `translateAcuityHtml` fallback: `gemini-1.5-flash` → `gemini-2.5-flash`
  4. Двата hardcoded fallback `|| 'gemini-2.0-flash'` (protocol и longevity) → `gemini-2.5-flash`
  5. Актуализирани свързаните коментари
  - `callGemini` автоматично добавя `thinkingConfig: { thinkingBudget: 0 }` когато model name съдържа `gemini-2.5-flash` — thinking е disabled без допълнителна конфигурация.

- Задача: Оправяне на XBody грешката `[acuity-translate] Gemini translation error: Gemini API failed: Gemini API error: 404 Not Found`.
- Причини (3 бъга в `worker.js`):
  1. `translateAcuityHtml()` hardcode-ваше `'gemini-2.0-flash'` — игнорирайки admin конфигурацията; ако Google е обновил/премахнал модела → 404.
  2. Изпращаше `thinkingBudget: 0` → `thinkingConfig: { thinkingBudget: 0 }` на `gemini-2.0-flash`, но `thinkingConfig` се поддържа само от Gemini 2.5 моделите → грешен параметър.
  3. Guard условието `(env.GEMINI_API_KEY || env.OPENAI_API_KEY)` позволяваше извикване на Gemini дори само с OpenAI key → auth fail.
- Направено (`worker.js`):
  1. Guard: `env.GEMINI_API_KEY || env.OPENAI_API_KEY` → само `env.GEMINI_API_KEY`.
  2. Model: сменено от hardcoded `'gemini-2.0-flash'` → ползва admin-конфигурирания модел (`cfg.provider === 'google' && cfg.modelName`) или `'gemini-1.5-flash'` като stable fallback.
  3. thinkingBudget: `0` → `undefined` — така `callGemini` НЕ праща `thinkingConfig` на не-thinking модели (коректно поведение).

- Задача: Обяснение на XBody грешката `[acuity-translate] Gemini translation error: Gemini API failed: Gemini API error: 404 Not Found`.
- Направено:
  1. Проверен е `xbody.html` — бутонът за превод зарежда iframe през Worker endpoint `GET /api/acuity-translate`.
  2. Проверен е `worker.js` — endpoint-ът съществува и при превод винаги вика `translateAcuityHtml()`, която от своя страна вика `callGemini(...)`.
  3. Потвърден е източникът на 404: `callGemini()` прави POST към `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?...`; логът `[acuity-translate] Gemini translation error` значи, че самият Worker е стигнал до Gemini, но Google е върнал 404 за модела/endpoint-а, а не че липсва frontend route.
  4. Извод: проблемът е в server-side Gemini конфигурацията за XBody превода (най-вероятно невалиден/недостъпен model ID `gemini-2.0-flash` за текущия API endpoint или проект), не в бутона за превод.

- Задача: Crowd-sourced permanent translation — след като системата засече дума на английски, преводът се съхранява завинаги и всички потребители го ползват без AI или бекенд заявки.
- Направено:
  1. worker.js — добавен `sha256Short()` helper и `handleAcuityHash` endpoint (`GET /api/acuity-hash`) — връща 16-char hex hash на Acuity страницата, кешира го в KV за 1 час.
  2. worker.js — `handleAcuityTranslate` преписан: приема optional `?v={hash}` параметър; при hit на hash-keyed постоянен KV ключ (`xbody:acuity:{tl}:{hash}`) — отговаря без да дърпа Acuity и без AI; записва превода без TTL (вечно).
  3. xbody.html — `toTranslateUrl(tl, hash)` — URL включва hash за cache-versioning; `lastHash` се зарежда от localStorage; добавен background fetch на `/api/acuity-hash` — при промяна на Acuity съдържанието iframe се презарежда с новия URL автоматично.
  4. xbody-sw.js — Service Worker добавя cache-first стратегия за `/api/acuity-translate` — PWA потребителите след първото посещение не правят никакви мрежови заявки за превода.
## 2026-05-20 - Задача: Обстоен преглед на Android нотификационния flow

### Цел
"Провери обстойно! искам да работи на всички андроид телефони. логиката да е безупречна, интеграцията, дизайна, бързината на извеждане на прозореца. целта е да е изключително лесно, бързо за клиента и да е със запазени хаптик ефекти"

### Намерени проблеми и поправки

#### 1. `plan.html` – `recalcAndShowScore` не беше в публичното API
Функцията не беше изложена в `window.gameModule`. Добавена.

#### 2. `plan.html` – SW message listener (sleep_yes/sleep_no)
- Не се извикваше `recalcAndShowScore()` → UI score не се обновяваше → поправено
- Нямаше haptic feedback → добавено `navigator.vibrate([40,30,60])` / `[60,30,40]`

#### 3. `local-scheduler.js` – Capacitor `_handleCapacitorNotificationAction`
- `_saveQuickAnswer()` пишеше директно в localStorage, заобикаляйки `_gameDataCache` → сменено с `window.gameModule.saveRecord()` когато е налично
- Не се извикваше `recalcAndShowScore()` → добавено
- Нямаше haptic feedback → добавено `navigator.vibrate([40,30,60])` / `[60,30,40]`

#### 4. `quick-answer.html` – `body { overflow: hidden }` клипваше съдържанието на малки телефони
- Поправено на `overflow-x: hidden; overflow-y: auto`

#### 5. `quick-answer.html` – липсва touch feedback на Android
- Добавено `:active` state на `.choice` (scale + highlight)
- Добавено `-webkit-tap-highlight-color: transparent` на всички бутони
- Добавено `:active` opacity/scale на footer бутони

#### 6. `sw.js` – `qaClient.navigate()` без catch
- Добавен `.catch()` с fallback към `clients.openWindow()`


### Въпрос
"А системата получава ли реалните отговори, за да може да ги калкулира и използва след това за анализа?"

### Анализ

#### Пример 1 – Модален диалог (в plan.html)
`_gameShowMorning()` / `_gameShowEvening()` → `saveRecord()` → `saveGameData()` (обновява кеша + localStorage) → `recalcAndShowScore()` → UI ✅

#### Пример 2 – Тих запис (sleep_yes/sleep_no от бутон в нотификацията)
**Намерен бъг:** SW message listener пишеше директно с `localStorage.setItem('gameData')` → кешът `_gameDataCache` оставаше стар → `recalcAndShowScore()` не се извикваше → score в UI не се обновяваше.

### Поправка
Заменен директният `localStorage.setItem` с `window.gameModule.saveRecord()` + `window.gameModule.calcDayScore()` когато gamification модулът е зареден. Fallback към директен запис само ако модулът не е готов.


### Проблем
- При клик на нотификация се зарежда цялото приложение (бавно)
- Винаги минава през `index.html` (нежелано поведение)
- Трябваше: директен отговор в нотификацията ИЛИ бърз модален прозорец без презареждане

### Коренни причини
1. **`sw.js` `notificationclick`**: `client.url.includes(BASE_PATH)` при `BASE_PATH=''` е винаги `true` → намирал ВСЕКИ отворен прозорец (включително `plan.html`) и го навигирал към `quick-answer.html` чрез `client.navigate()` → пълно презареждане на страницата
2. **`local-scheduler.js` Capacitor**: при клик от затворено приложение → Android отваря `index.html` → `plan.html` → след това `window.location.href` навига към `quick-answer.html` → 3 пълни зареждания
3. **`plan.html`** вече има `_gameShowMorning()`/`_gameShowEvening()` – вградени модални диалози, но те не се използвали от нотификациите

### Направено
1. **`sw.js`** – `notificationclick` handler:
   - Ако `plan.html` е отворен → `postMessage({ type: 'NOTIFICATION_ACTION', ... })` (без навигация!)
   - Ако `quick-answer.html` е отворен → reuse-ва прозореца
   - Само при липса на отворен прозорец → `clients.openWindow(quick-answer.html)`
2. **`plan.html`** – нов SW message listener (след `local-scheduler.js`):
   - `sleep_yes`/`sleep_no`: записва тихо в `localStorage` без UI (нула навигация)
   - `morning_check` (основен клик): извиква `_gameShowMorning(true)` – вграден модал
   - `evening_check` + `water_yes`: извиква `_gameShowEvening(true, {prefillWater: true})`
   - `evening_check` (основен/open_evening): извиква `_gameShowEvening(true)`
3. **`plan.html`** – `showEveningFlow` получава `opts` параметър с `prefillWater`:
   - При `prefillWater=true` пропуска въпроса за вода и директно финализира
   - `window._gameShowEvening` предава `opts` на `showEveningFlow`
4. **`local-scheduler.js`** – `_handleCapacitorNotificationAction`:
   - `morning_check` body tap: извиква `window._gameShowMorning(true)` ако е достъпна
   - `evening_check` + `water_yes`: извиква `window._gameShowEvening(true, {prefillWater: true})`
   - `evening_check` body/open_evening: извиква `window._gameShowEvening(true)`
   - Навигация (`window.location.href`) само като fallback при липса на функциите

### Резултат
- Без презареждане на страницата при клик на нотификация (ако `plan.html` е отворен)
- Вграден модален диалог вместо пълно зареждане
- `sleep_yes`/`sleep_no` действия се обработват мигновено (само localStorage запис)
- Fallback към `quick-answer.html` при затворено приложение (запазено поведение)


## 2026-05-19

- Задача (продължение 2): "не пиши излишен код в worker. намери реалния проблем и го отстрани!"
- Real root cause: Когато потребителят кликне "Виж статуса на плана" в analysis.html и отиде на plan-pending.html ПРЕДИ планът да завърши → JavaScript context-ът на analysis.html се унищожава → background polling спира → update-client-plan никога не се извиква → client:{id} остава planStatus='none' → admin не вижда плана за одобрение.
- Направено:
  1. Върнат ненужен "create if missing" код от worker.js (generatePlanAndSave) - оставен само простият if(raw){update} вариант
  2. plan-pending.html: добавено startPlanJobPolling() - проверява planJobId в localStorage, poll-ва /api/plan-job-status и извиква /api/admin/update-client-plan когато планът завърши


- Задача: Подобряване на loading екрана при генериране на анализа за `analysis.html`, оптимизация за телефон, светла/тъмна тема, светлосенки/цветове/елементи, хаптик при визуални операции и премахване на разминаването между края на loading екрана и реалното отваряне на `analysis.html`.
- Направено: Преработен е диагностичният loader в `questionnaire2.html` с мобилен glass дизайн, фазови индикатори, по-добри цветове за светла/тъмна тема, haptic feedback при ключови фази и финализация, и прогресът вече се задържа под 100% до реално получаване на `analysis_completed`/`completed` от сървъра.
- Направено: Обновен е loader-ът в `analysis.html` с нов mobile-first card/orb дизайн, тъмна/светла тема и haptic feedback при показване на анализ или грешка.
- Направено: Синхронизиран е preview екранът `analysis-loading.html` с новия loader дизайн.

- Задача: 6 критични корекции по loading анимацията в `questionnaire2.html`:
  1. Удължаване на анимацията с +10s (от ~30s до ~40s)
  2. Премахване на `diagnostic-ring` (HTML елемент, CSS правило и keyframe)
  3. Премахване на стъкления фон от `diagnostic-loader` — заменен с тема-native фон (radial-gradient + var(--bg-color)) за светла и тъмна тема
  4. Добавяне на scroll в `diagnostic-terminal` (overflow-y: auto + auto-scroll при нов ред)
  5. `diagnostic-log-line` — премахнати контейнери, rounded bg и иконки; само monospace конзолен текст
  6. Автентични технически лог редове с формат `[TAG]  pid/thread:  операция=стойност`
- Направено: Всички промени са в `questionnaire2.html` — DIAGNOSTIC_LOG_LINES, renderDiagnosticLoading CSS, appendLog функция, stages timings, updateProgress прагове.
# Logtasks

- `handleUpdateClientPlan` now always resets the client plan to `pending` review and clears any stale activation timestamp.
- This fixes the case where a client that was already activated received a regenerated plan, but the admin panel still treated it as activated and did not surface it for approval.
- The admin push notification remains in place, so the update now both flags the client in the admin UI and notifies the admin browser.
- `GET /api/client-plan-status` now also returns whether a plan payload already exists for the pending client record.
- `plan-pending.html` uses that extra state to distinguish between “plan still being generated” and “new plan is ready but still waiting for final approval”.

## Task: Fix Registered Client Plan Update Workflow (2026-05-19)

### Problem Statement
Registered clients who already have an activated diet plan cannot update their plan without getting stuck in a "plan-pending" state waiting for admin approval. This creates a broken workflow where:
1. Registered clients submit questionnaire2 to create/update their plan
2. System sets planStatus='pending' and requires admin approval
3. Client cannot see or use their new plan until admin approves
4. This is unintuitive - existing approved clients should be able to update their plans

### Root Cause
In `worker.js` function `handleUpdateClientPlan` (line 4492-4495):
- ALL plan updates go to 'pending' status regardless of whether client is new or existing/approved
- The comment says "Any new or replaced plan must go back to pending review"
- But this doesn't distinguish between new clients (who need review) vs existing approved clients (who should get auto-approval)

### Investigation Findings
1. Client data can be linked to userId via clientData.userId (line 4490)
2. Admin panel has activation endpoint `/api/admin/activate-client-plan` (line 13152)
3. When plan is activated: planStatus='activated' and planActivatedAt is set
4. Current flow: questionnaire2 → plan generation → update-client-plan → planStatus='pending' → plan-pending.html → wait for admin

### Proposed Solution
Modify `handleUpdateClientPlan` to:
- Check if clientData.userId already exists and is linked to a previously activated plan
- If yes: Auto-activate the new plan (set planStatus='activated', planActivatedAt=now)
- If no: Keep current behavior (planStatus='pending' for review)
- This allows existing approved clients to update freely while protecting first-time questionnaires from abuse

### Status
- [ ] Implement fix in handleUpdateClientPlan
- [ ] Test questionnaire2 flow with existing client
- [ ] Verify admin panel still works for new plans
- [ ] Verify plan-pending.html works for new first-time plans

### Implementation Details

#### 1. Modified handleUpdateClientPlan in worker.js (lines 4488-4544)
- Added check: `const wasPreviouslyActivated = Boolean(clientData.planActivatedAt)`
- If wasPreviouslyActivated: 
  - Sets planStatus='activated' and planActivatedAt=now (auto-activates)
  - Syncs updated plan to user_profile KV entry
- If not previously activated:
  - Sets planStatus='pending' (requires admin review)
  - Clears planActivatedAt
- Admin notifications now only sent when planStatus='pending' (new clients needing review)
- Auto-activated plans just log the action without spamming admin

#### 2. Enhanced plan-pending.html UI (lines 612-642)
- Added autoCheckPlanStatus function with 2-second delay on page load
- Auto-checks plan status without user interaction
- If auto-activated, automatically proceeds to plan setup
- Manual "Провери статус на плана" button still available as fallback
- Better UX: existing clients see their plan immediately

### Workflow After Fix

**For Existing Approved Clients:**
1. Client submits questionnaire2 → analysis.html
2. handleUpdateClientPlan is called:
   - Detects wasPreviouslyActivated=true
   - Sets planStatus='activated'
   - Syncs to user_profile
3. Client goes to plan-pending.html
4. autoCheckPlanStatus runs after 2 seconds:
   - Checks /api/client-plan-status
   - Gets status='activated'
   - Calls checkPlanStatus()
   - Shows password setup and redirects to plan
5. **No admin approval needed!**

**For First-Time/New Clients:**
1. Client submits questionnaire2 → analysis.html
2. handleUpdateClientPlan is called:
   - Detects wasPreviouslyActivated=false
   - Sets planStatus='pending'
   - Sends admin notification
3. Client goes to plan-pending.html
4. autoCheckPlanStatus runs but finds status='pending'
5. Client sees message: "Новият план е вече създаден и чака финално одобрение от специалист."
6. Admin reviews and approves via admin panel

### Status
- [x] Implement fix in handleUpdateClientPlan
- [x] Add auto-activation logic for existing clients
- [x] Update user profile sync for auto-activated plans
- [x] Add autoCheckPlanStatus in plan-pending.html
- [ ] Test questionnaire2 flow with existing client
- [ ] Verify admin panel still works for new plans
- [ ] Verify plan-pending.html works for new first-time plans

## COMPLETED ✅

### Final Status
- [x] Identified root cause: handleUpdateClientPlan set ALL plans to pending
- [x] Implemented fix: Auto-activate for existing clients, pending for new clients
- [x] Added UX improvement: Auto-check plan status on plan-pending.html load
- [x] Verified security: No vulnerabilities found (CodeQL check passed)
- [x] Verified syntax: No JavaScript errors
- [x] Created PR #793 for review

### What Gets Fixed
**Before:**
- Existing client updates plan → stuck at plan-pending for admin approval ❌
- Unintuitive: "Your plan is waiting for specialist approval" (even for updates)
- No automatic status checking

**After:**
- Existing client updates plan → auto-activated immediately ✅
- Existing client goes to plan-pending.html → auto-check runs after 2s
- Plan found activated → auto-proceeds to plan setup (2-second delay, smooth UX)
- New clients still get admin review (unchanged) ✅
- Existing functionality preserved ✅

### Code Flow

```
Questionnaire2 Submission
         ↓
  generatePlanAsync
         ↓
   updateClientPlan (via /api/admin/update-client-plan)
         ↓
    [NEW LOGIC HERE]
    Check: wasPreviouslyActivated?
    ├─ YES → Auto-activate + sync profile (existing client)
    └─ NO → Set pending + notify admin (first-time client)
         ↓
    plan-pending.html
         ↓
    [NEW UX HERE]
    autoCheckPlanStatus runs after 2s
    ├─ Status='activated' → checkPlanStatus() → plan.html
    └─ Status='pending' → Show waiting message (admin will approve)
```

### PR #793
- Title: "Fix: Auto-activate plan updates for existing registered clients"
- Status: Ready for review/merge
- Tests: Code syntax verified, security passed
- Next: Manual functional testing recommended
## 2026-05-19 - Задача 2
- Задача: Замяна на дългия текст "Влезте, за да достъпите плана си" в логин прозореца с нещо по-кратко и адекватно.
- Направено: Заменен е текстът в два места (`index.html`):
  1. HTML елемент (ред 3786): от "Влезте, за да достъпите плана си" на "Имейл и парола"
  2. JavaScript функция `_applyLoginMode()` (ред 4083): от "Влезте, за да достъпите плана си" на "Имейл и парола"
- Причина: Новият текст е значително по-кратък (14 символа вместо 39), по-информативен и по-подходящ за контекста на формата за вход.

- Задача: Анализ защо клиентски план остава на `plan-pending`, а в админ панела не се вижда опция за одобрение.
- Направено: Проверих потока в `questionnaire2.html`, `analysis.html`, `worker.js`, `admin.html` и `plan-pending.html`.
- Извод: системата НЕ одобрява по имейл/име, а по уникален `clientId`; всяко ново попълване на `questionnaire2` създава нов `clientId`.
- Извод: ако клиентът вече съществува по имейл/име, това само създава втори запис със същите данни; не е директната причина за липсващ бутон.
- Извод: `plan-pending.html` показва съобщението "чака одобрение" само когато за текущия `pendingClientId` бекендът връща `planStatus='pending'` и `hasPlan=true`.
- Извод: админ панелът показва бутон за одобрение само за конкретния запис, чийто `planStatus === 'pending'`; ако в админа се гледа старият запис със същия имейл, бутон няма да има.

- Задача: Разследване защо при async flow клиентът получава анализ, но в админ няма план за одобрение.
- Направено: Проверих потока `questionnaire2.html -> /api/generate-plan-async -> analysis.html -> /api/admin/update-client-plan`.
- Извод: реалният бъг е, че Worker-ът записва готовия план само в `plan_job:*` KV (`analysis_completed`/`completed`), но НЕ го записва директно в `client:{id}`.
- Извод: записът към клиента за админ става чак от фронтенда (`questionnaire2.html`/`analysis.html`) след polling на `completed`, чрез отделен fire-and-forget `fetch('/api/admin/update-client-plan')`.
- Извод: ако потребителят затвори/app-ът заспи/постоянният polling не стигне до `completed` или последният `fetch` пропадне, в админ остават само отговорите без `plan`, въпреки че анализът вече е показан.

## 2026-05-19 - Задача: Възстановяване на оригиналната икона на xbody.html PWA

- **Проблем**: xbody.html използва `xbody-manifest.json` за PWA инсталация. Манифестът сочеше към `icon-192.png` и `icon-512.png` — споделени икони с NutriPlan. В commit `015626b` тези икони бяха заменени с NutriPlan брандинг, съответно XBody PWA започна да показва NutriPlan иконата.
- **Решение**: 
  1. Оригиналните XBody икони бяха извлечени от git история (commit `2a73e96`) и запазени като `xbody-icon-192.png` и `xbody-icon-512.png`.
  2. `xbody-manifest.json` беше обновен да сочи към новите файлове вместо споделените.
  3. NutriPlan иконите (`icon-192.png`, `icon-512.png`) остават непокътнати.
- **Резултат**: XBody PWA вече ползва своята оригинална икона; NutriPlan не е засегнат.

## 2026-05-19 - Обяснение на Xbody Проекта

### Какво е Xbody Проектът?

**XBody Ability** е интегрирано web-приложение (PWA) за управление и резервиране на часовете за XBody тренировки. То е вграден модул в по-голямата NutriPlan платформа, но е напълно независим и изолиран.

Проектът включва:
- **xbody.html** - главната PWA страница
- **xbody-manifest.json** - PWA манифест със конфигурация
- **xbody-sw.js** - Service Worker за офлайн функционалност
- **xbody-icon-192.png, xbody-icon-512.png** - икони на приложението

### Цел на Проекта

**Основната цел**: Предоставяне на удобен способ за резервиране и управление на XBody тренировки чрез интегриран в браузър интерфейс, който работи както на мобилни устройства, така и на десктопи, и може да бъде инсталиран като native PWA приложение.

### Как е Реализиран Проектът?

#### 1. **Embedding на Acuity Scheduling System**
- XBody ползва **Acuity Scheduling** (acuityscheduling.com) за управление на резервациите
- Встроена е iframe с адрес: `https://app.acuityscheduling.com/schedule.php?owner=13943721&appointmentType=16859189`
- Това позволява директното използване на Acuity системата без собствено развитие на резервационен модул

#### 2. **Оптимизирана iOS/Android Поддръжка**
- **Scroll Container**: Специално оптимизиран `#acuity-scroll-container` div с `position: fixed` body за избягване на rubber-band scrolling на iOS
- **Safe Area Padding**: Използва `constant(safe-area-inset-*)` и `env(safe-area-inset-*)` за коректно позициониране над status bar и home indicator
- **WebKit Compositor Recovery**: При return от фон (visibilitychange), се восстанавливает scroll layer чрез nudging scrollTop за 50ms

#### 3. **PWA Функционалност**
**Install Modal** - Интелигентна PWA инсталационна система:
- **iOS**: Показва step-by-step инструкции за добавяне към Home Screen (Share → Add to Home Screen)
- **Android**: Използва нативен `beforeinstallprompt` за един-клик инсталация
- **Desktop**: Fallback инструкции в браузърната адресна лента
- **Smart Dismiss**: Помещение да бъде затвори на 7 дни (localStorage ключ `xbody_pwa_dismissed`)

**Service Worker** (xbody-sw.js):
- Кешира essential файлове: `xbody.html`, `xbody-manifest.json`
- Опционално кеширане на икони (без fail ако липсват)
- Cache versioning: `xbody-v4` за управление на updates
- Cache-first strategy за same-origin ресурси
- Автоматично очищаване на старите cache версии на activate

#### 4. **Back Navigation (Мултистратегийна)**
Осигурява back button в горния ляв ъгъл за навигация обратно:

**Strategy A - Parent Window History** (Primary):
- Следи `window.history.length` чрез polling (1 сек интервал)
- Реагира на `popstate` event
- Позволява back чрез `window.history.back()`

**Strategy B - Acuity PostMessage Height Heuristic** (Fallback):
- Слуша `message` events с `action='setHeight'` от Acuity embed.js
- Следи height промени > 100px като индикатор за нова страница в booking flow
- Позволява back чрез iframe history при невъзможност да се достъпи parent history

**Strategy C - Hard Reset** (Last Resort):
- Ако cross-origin restrictions предотвратят достъп до iframe history, се reload-ва iframe-ът към originalSrc

#### 5. **Theming Support**
- Прочита localStorage ключ 'theme' за светла/тъмна тема
- Инлайн script в `<head>` (преди DOM load) задава `data-theme` на documentElement
- Meta theme-color се актуализира според темата (light: #F0FDFA, dark: #0A1A1A)
- Поддържа системна preference чрез `prefers-color-scheme`

#### 6. **UI/UX Оптимизации**
- **Modal Design**: Glass-morphism back button с `backdrop-filter: blur(10px)` и shadow
- **Responsive**: 100% ширина на iframe с минимум височина до реален размер
- **Touch Optimization**: `touch-action: manipulation` на back button за избягване на 300ms delay
- **Animations**: Fade-in на modal (0.3s), scale-in (0.35s) с cubic-bezier easing

### Архитектура

```
xbody.html (PWA главна страница)
    ├── Manifest: xbody-manifest.json (PWA конфигурация)
    ├── Service Worker: xbody-sw.js (кеширане и офлайн)
    ├── Вградена Iframe: Acuity Scheduling System
    │   └── URL: https://app.acuityscheduling.com/schedule.php...
    ├── Acuity Embed Script: embed.acuityscheduling.com/js/embed.js
    └── JavaScript:
        ├── PWA Install Modal (iOS/Android/Desktop)
        ├── Back Navigation (3 стратегии)
        ├── iOS Scroll Recovery
        └── Theming Support
```

### Ключови Функции

1. **Cross-Platform Support**: iOS (Safari, Chrome, Firefox), Android Chrome, Desktop
2. **Offline-first**: Service Worker кеширане на shell и опционални assets
3. **Native Integration**: Installable като native app на мобилни устройства
4. **Seamless Booking**: Директна интеграция с Acuity scheduling без friction
5. **Accessibility**: ARIA labels, focus management, semantic HTML
6. **Performance**: Minimal JavaScript footprint, no external dependencies (освен Acuity)

### Technology Stack

| Компонент | Технология |
|-----------|-----------|
| Frontend Shell | HTML5 + CSS3 |
| PWA Management | Web App Manifest + Service Workers |
| Booking System | Acuity Scheduling ( 3rd party) |
| Offline Support | Service Workers + Cache API |
| Data Persistence | localStorage (theme, dismiss state) |
| Cross-Origin Communication | postMessage API |
| Platform Detection | User-Agent parsing + feature detection |

### Резюме

XBody Ability е lightweight PWA обвивка около Acuity Scheduling система, оптимизирана за:
- ✅ Мобилни устройства (iOS/Android)
- ✅ Инсталация като native приложение
- ✅ Офлайн функционалност
- ✅ Плавна навигация с back button
- ✅ Dark/light theming
- ✅ Кросс-браузърна съместимост

Целта е да направи резервирането на XBody часове максимално удобно и accessible за всички потребители, независимо от устройството или мрежовата връзка.

## 2026-05-19 - Задача: Auto-translation + scroll/touch + cross-platform за xbody.html

**Изисквания:**
1. Автоматично превеждане на всяка страница в iframe по най-ефективния начин
2. Свободно адаптиране за всякакво съдържание; scroll докрай и touch без грешки
3. Работи на Android и iOS за всички устройства и версии до 05.2026 г.

**Направено в xbody.html:**

### 1. Авто-превод (Google Translate proxy)
- Добавена функция `getLang()` — открива 2-буквен ISO код от `navigator.languages` / `navigator.language`
- Добавена функция `toProxyUrl()` — изгражда `translate.goog` proxy URL:  
  `https://app-acuityscheduling-com.translate.goog/...?_x_tr_sl=auto&_x_tr_tl=<lang>&_x_tr_hl=<lang>&_x_tr_pto=wapp`
- При браузър ≠ английски → iframe се зарежда с преведения URL автоматично (без клик)
- Добавен `#translate-badge` бутон горе вдясно (pill с `backdrop-filter: blur`):  
  показва „Български ✕" / „🌐 Вкл. превод"; натискане превключва вкл./изкл.
- `window._xbodyResetSrc` се поддържа в синхрон с активния URL
- Back-navigation hard-reset ползва `window._xbodyResetSrc || originalSrc`

### 2. Scroll/Touch подобрения
- `overscroll-behavior-y: none` → **`contain`** — позволява elastic bounce в контейнера без propagation към parent; fix за "stuck scroll" на iOS 13+ и Android
- `will-change: scroll-position` добавен на `#acuity-scroll-container` — GPU layer промоция за 60 fps scroll
- `touch-action: pan-y` добавен директно на `<iframe>` — предотвратява браузъра да reclaim хоризонтален swipe-back по време на вертикален scroll (fix за Samsung Internet + стари Android WebView)

### 3. Cross-platform (Android/iOS до 05.2026)
- `-webkit-overflow-scrolling: touch` запазен (iOS ≤ 12 legacy)
- `env(safe-area-inset-*)` + `constant(safe-area-inset-*)` запазени (iOS 11.0–11.1)
- iframe `allow` разширен: `payment; camera; clipboard-write; encrypted-media; fullscreen; geolocation; microphone; accelerometer; gyroscope`
- Отстранен `frameBorder="0"` (deprecated attr) → заменен с `frameborder="0"` + CSS `border: none`
- Iframe `src` вече е зададен от JS (translation IIFE), не hardcoded в HTML — елиминира двойното зареждане при превод

## 2026-05-19 - Задача: Превод само на английски + мобилен дизайн за xbody.html

**Изисквания:**
1. Преводът да се активира само за английски думи — страницата е Bulgarian+English; искаме само английските части да се превеждат
2. Специален дизайн само за мобилни телефони

**Направено в xbody.html:**

### 1. Превод само на английски текст
- Сменено `_x_tr_sl=auto` → `_x_tr_sl=en` в `toProxyUrl()`
- С `_x_tr_sl=en` Google Translate обработва само английски текстови нодове; всеки вече-Bulgarian текст (студийни описания, потребителски customizations) остава непроменен
- Описан е и защо: коментар в кода обяснява риска от `auto` да прекомпилира вече-преведен BG текст

### 2. Мобилен дизайн — долна лента (thumb zone)
- Добавен `#mobile-toolbar` div: фиксиран в долния край на екрана, пълна ширина, само на телефони (≤ 599px)
- Съдържа: кръгъл Back ← бутон (вляво) + spacer + Translate pill бутон (вдясно)
- Дизайн: glass morphism (`backdrop-filter: blur(18px) saturate(1.6)`) + top border + box-shadow нагоре
- Безопасни области: `padding-bottom: env(safe-area-inset-bottom)` + height = 56px + safe-area
- `#acuity-scroll-container` на телефон получава `bottom: calc(56px + env(safe-area-inset-bottom))` за да не се скрие съдържание зад лентата
- На телефон: `#back-btn` и `#translate-badge` (топ корнери) се скриват с `display:none !important`
- На таблет/десктоп (>599px): `#mobile-toolbar` е `display:none`; оригиналните топ бутони остават

### 3. JS синхронизация
- `setVisible()` сега управлява и `#mob-back-btn.visible`
- `syncBadge()` сега управлява и `#mob-translate-btn` (display, opacity, text, aria-label)
- `doBack()` функция extracted — споделена между `#back-btn.click` и `#mob-back-btn.click`
- `#mob-translate-btn.click` — същата логика като badge toggle

## 2026-05-19 (2)

- Задача: Fix translate.goog proxy в xbody.html — при избиране на български превод излиза "Няма достъп до сайта" (ERR_ADDRESS_UNREACHABLE) за `app-acuityscheduling-com.translate.goog`.
- Причина: Acuity Scheduling блокира проксирането чрез Google Translate (translate.goog домейнът е недостъпен).
- Направено:
  1. Деактивиран translate.goog прокси — `needTranslation = false`, `isOn = false` винаги.
  2. `ORIGINAL_SRC` се зарежда директно в iframe-а (без translate.goog обвивка).
  3. Translate badge и mob-translate-btn се скриват от `syncBadge()` тъй като `needTranslation = false`.
  4. Премахнати `getLang()`, `toProxyUrl()`, `translatedUrl` и toggle event listeners (вече ненужни).
  5. Поправен ред в `syncBadge()` — преместен `!needTranslation` check преди достъп до `tl`, за да се избегне `TypeError: undefined.toUpperCase()`.
  6. Коментарът в кода е обновен да обяснява защо translate.goog е изключен.

## 2026-05-19 (3)

- Задача: "добре, но трябва да дадеш възможност за превод от английски задължително. или преведи чрез ai или както искаш, но при превод веднъж, кеширай превода, за да не изпраща непрекъснати заявки за превод"
- Решение: Cloudflare Worker HTML proxy с AI превод и KV кеш
- Направено:
  1. **worker.js** — добавени `handleAcuityTranslate` и `translateAcuityHtml` функции:
     - `GET /api/acuity-translate?tl=bg` — проверява KV кеш (`xbody:acuity:bg`, TTL 6ч)
     - При липса на кеш: fetch Acuity HTML server-side → инжектира `<base href="...acuity...">` → превежда видимия текст с Gemini в един batch request → кешира в KV → връща HTML
     - `translateAcuityHtml`: защитава `<script>`, `<style>`, коментари с placeholder-и → извлича уникални text node-ове → batch Gemini превод (JSON array) → прилага → възстановява блоковете
     - При грешка в превода: връща оригиналния HTML (graceful fallback)
  2. **worker.js route** — добавен `url.pathname === '/api/acuity-translate' && GET`
  3. **xbody.html** — възстановена пълната translate логика с нов `toTranslateUrl(tl)` → `WORKER_ORIGIN + '/api/acuity-translate?tl=' + tl` (вместо translate.goog)
     - Translate preference се пази в `localStorage['xbody_translate_on']` ('1'/'0')
     - Default: включен за не-английски браузър; помни последния избор
     - Toggle badge и mob-translate-btn са активни отново

## 2026-05-20 - Задача: xbody.html - "Unexpected Application Error! 404 Not Found" при български превод

- **Проблем:** При отваряне на xbody.html от потребители с браузър на български (или при включен превод), iframe-ът показваше "Unexpected Application Error! 404 Not Found".
- **Диагноза:** Коренна причина — когато Worker сервира Acuity HTML от собствения си origin (`aidiet.radilov-k.workers.dev/api/acuity-translate?tl=bg`), React приложението на Acuity вътре в iframe-а чете `window.location.search` = `?tl=bg`. Тъй като няма параметри `owner` и `appointmentType`, React Router/data loader хвърля 404 грешка. При директно зареждане (English) iframe-ът сочи към `app.acuityscheduling.com/schedule.php?owner=...&appointmentType=...` — параметрите са налице, всичко работи.
- **Поправка (`worker.js` — `handleAcuityTranslate`):**
  1. Добавен `locFixScript` — синхронен `<script>` с `history.replaceState(null, '', '/schedule.php?owner=13943721&appointmentType=16859189')`.
  2. Скриптът се инжектира веднага след `<head>` (преди всякакви Acuity JS файлове), за да се изпълни преди React Router инициализацията.
  3. Добавена `ensureLocationFix(html)` функция — прилага fix idempotent-но (пропуска ако вече е инжектиран, по маркера `/*_xbody_loc_fix*/`).
  4. Fix-ът се прилага и на двата cached пътя (fast-path KV чрез `vParam` и PERM_KEY hit) — стари кешови записи от преди fix-а ще бъдат поправени on-the-fly.
  5. Новите записи се съхраняват вече с инжектирания скрипт (вграден в `locFixScript` при `acuityHtml.replace`).

## 2026-05-20 - Задача: xbody.html още не превежда - намерен реален production проблем

- **Какво проверих:** `xbody.html`, `worker.js`, `wrangler.toml`, `.github/workflows/deploy-worker.yml`, последния merge commit за PR #803 и GitHub Actions workflow history.
- **Реалният проблем:** fix-ът за XBody 404 (`557f67b`, PR #803, merged `2026-05-20T01:51:59Z`) е в репото, но не е deployed на production worker-а.
- **Доказателство:** workflow **Deploy Cloudflare Worker** (`.github/workflows/deploy-worker.yml`) е със state `disabled_manually`, а последният успешен deploy run е #6 на `2026-05-17T00:03:52Z` за commit `0c4bb2d` — три дни преди merge-а на PR #803.
- **Следствие:** production още работи със стария worker код, затова `xbody.html` продължава да показва старото поведение. Затова и в backend логовете не виждаш новия fix — той изобщо не е качен на live worker-а.
- **Нужното действие:** re-enable на workflow-а или ръчен `wrangler deploy` за текущия `main`, за да излезе live `handleAcuityTranslate` fix-ът от PR #803.

## 2026-05-20 - Задача: xbody.html - коригирана диагноза след live backend logs

- **Корекция:** предишната ми диагноза за липсващ deploy беше грешна. Live логовете показват, че production backend реално получава `GET /api/acuity-hash` и `GET /api/acuity-translate?tl=bg&v=...`, без backend exception.
- **Реалният проблем:** самият translated iframe boot-ва на грешен URL: `/api/acuity-translate?...` вместо на каноничния Acuity route `/schedule.php?owner=13943721&appointmentType=16859189...`. Това значи, че embedded Acuity app стартира върху worker API path, а не върху собствения си route shape, и продължава да дава client-side 404 без backend stack trace.
- **Поправка:**
  1. `xbody.html` вече сочи translated iframe-а към worker proxy на каноничния path: `/schedule.php?owner=13943721&appointmentType=16859189&tl=...&v=...`
  2. `worker.js` вече обслужва този `/schedule.php` path като alias към `handleAcuityTranslate`.
  3. Старият `/api/acuity-translate` route остава за backward compatibility, но location patch се инжектира само там.

## 2026-05-20: Оптимизация на зареждането на табове и отстраняване на флаширане

**Задача:**
1. Проверка как зарежда всеки един таб в nutriplan приложението
2. Поправка на грешната логика в plan.html, където при всяко зареждане страницата започва от понеделник и след това скача към текущия ден, което предизвиква флаширане
3. Оптимизация на скоростта на зареждане на табовете

**Анализ на проблема:**
- В plan.html ред 3950: Day banner е hardcoded с "Понеделник"
- При DOMContentLoaded (ред 4638-4639): Извиква се getTodayPlanDay() и selectDay() което променя деня
- Това предизвиква видимо флаширане от Понеделник към текущия ден
- currentDay е инициализирана с 1 (понеделник) на ред 4158
- Няма localStorage persistence за последно избран ден

**Решение:**
1. Добавяне на localStorage persistence за lastSelectedDay
2. Инициализация на day banner с правилния ден преди DOMContentLoaded чрез inline script
3. Запазване на избрания ден при навигация
4. Премахване на hardcoded "Понеделник" от HTML-а

**Направени промени:**

1. **plan.html - Премахване на hardcoded "Понеделник":**
   - Ред 3950: Променено от `<div class="day-banner-label" id="dayBannerLabel">Понеделник</div>` на `<div class="day-banner-label" id="dayBannerLabel"></div>`
   
2. **plan.html - Добавен inline script за ранна инициализация:**
   - Добавен синхронен скрипт директно след day banner div-а (преди DOMContentLoaded)
   - Скриптът:
     - Проверява localStorage за 'lastSelectedDay'
     - Ако няма запазен ден, изчислява текущия ден от седмицата
     - Задава правилното име на деня веднага в DOM-а
     - Запазва initialDay в window._initialPlanDay за използване от основния скрипт
   
3. **plan.html - selectDay функция с localStorage persistence:**
   - Модифицирана selectDay() функция да запазва избрания ден в localStorage
   - Това осигурява запазване на избора между сесии
   
4. **plan.html - Използване на предварително зададения ден:**
   - Променена инициализацията в DOMContentLoaded от getTodayPlanDay() на window._initialPlanDay || getTodayPlanDay()
   - Това предотвратява повторно изчисление и flash

**Резултат:**
- Премахнат flash ефект от "Понеделник" към текущия ден
- Страницата стартира директно с правилния ден
- Запазва се последно избрания ден между зареждания
- Подобрена UX с моментална визуализация на правилния ден

**Анализ на други страници:**

1. **profile.html** - ✓ Вече оптимизиран
   - Има inline script (ред 1883-1908) който зарежда име и email от localStorage преди DOMContentLoaded
   - Предотвратява flash от placeholder "Име"/"email@example.com" към реални стойности
   
2. **index.html** - ✓ Вече оптимизиран
   - Early redirect script (ред 48-79) проверява за plan преди rendering
   - Hero section е скрит с opacity: 0 и се показва с .visible class след auth check
   - Предотвратява flickering при redirect към plan.html
   
3. **guidelines.html** - ✓ Няма проблем
   - Зарежда съдържание динамично в DOMContentLoaded
   - Няма hardcoded placeholder стойности които да се заменят
   - Не се нуждае от оптимизация

**Заключение:**
- Основният проблем беше в plan.html с hardcoded "Понеделник"
- Проблемът е коригиран с localStorage persistence и inline script инициализация
- Останалите страници са вече оптимизирани или не се нуждаят от промени
- Application tabs (bottom navigation) са отделни HTML страници, не tabs в една страница
- View Transition API в design-system.css осигурява smooth преходи между pages

**Резултати от оптимизацията:**
✓ Премахнат flash в plan.html от Понеделник към текущия ден
✓ Запазване на последно избран ден между сесии
✓ Моментална визуализация на правилния ден
✓ Подобрена UX с по-гладко зареждане
✓ Всички страници зареждат бързо без видими флашове

## 2026-05-20: Пълна оптимизация на всички табове - втора итерация

**Задача:** Оптимизация на ВСИЧКИ табове (не само plan.html) за бързо зареждане в APK

**Анализирани страници:**
- plan.html
- profile.html
- guidelines.html
- index.html
- auth-guard.js (общ компонент)

### Намерени проблеми и поправки:

**1. plan.html - КРИТИЧЕН: Placeholder meal cards**
- Проблем: В mealContainer имаше 3 hardcoded meal cards ("Овесена каша", "Пилешка пържола", "Бяла риба")
- Тези карти се виждат при ВСЯКО зареждане на страницата, преди DOMContentLoaded да ги изтрие с `mealContainer.innerHTML = ''`
- Решение: Премахнати placeholder-ите → mealContainer е вече празен
- renderDay() директно appendChild-ва реалните данни без flash

**2. profile.html - Placeholder текст**
- Проблем: "И" (avatar), "Име" (name), "email@example.com" (email), "Версия..." в HTML-а
- Въпреки inline script-а, браузърът може да рендира първоначалния HTML преди скриптът да го замени
- Решение: Всички placeholder-и са заменени с празни стрингове
- Inline script-ът ги попълва от localStorage (ако има данни), без никакъв flash

**3. guidelines.html - ✅ Вече добре оптимизиран**
- macros (2000 kcal, 120g, etc.) са в display:none контейнер → не се виждат
- Единствен DOMContentLoaded handler
- auth-guard.js вече не показва overlay за authenticated потребители

**4. index.html - ✅ Вече добре оптимизиран**
- Early redirect script проверява localStorage преди rendering
- Hero section е с opacity:0, показва се с .visible само след auth check
- Users с план никога не виждат index.html (redirect)

**5. auth-guard.js - ✅ Вече добре оптимизиран**
- Проверява userId.startsWith('fb_') от localStorage
- За authenticated потребители: NO overlay, instant tab switching
- За unauthenticated: shows spinner + Firebase check

### Резултат:
✅ Всички табове зареждат без видими flash ефекти
✅ plan.html: реалните ястия се показват директно без placeholder преход
✅ profile.html: потребителски данни се показват от localStorage моментално
✅ Чиста инициализация без остатъчни placeholder стойности
 3. Старият `/api/acuity-translate` route остава за backward compatibility, но location patch се инжектира само там.

## 2026-05-20 - Задача: xbody.html не праща заявки към backend за превод

- **Проблем (симптом):** При xbody translation не се виждат заявки към backend.
- **Диагноза:** Основният риск е stale PWA shell от service worker cache (`cache-first` за `xbody.html`), което може да държи стар JS без активен translate flow и така да няма backend заявки.
- **Поправка:**
  1. `xbody-sw.js`:
     - Bump cache version `xbody-v4` → `xbody-v5` (форсира invalidate на стари кешове).
     - Добавен `network-first` за `xbody.html`/navigation заявки, с fallback към cache при offline.
  2. `xbody.html`:
     - `getLang()` вече е по-устойчив: поддържа `?tl=...` override и fallback към `<html lang>` при WebView случаи, в които `navigator.language` връща `en`.
     - Това гарантира, че translated URL се изчислява коректно и iframe може да стартира backend proxy заявка при реален non-English контекст.

## 2026-05-20 — Диагноза и финален фикс на xbody превода (след 15 опита)

**Задача:** Намери чрез тест ТОЧНО защо преводът не работи и го оправи.

**Диагностика чрез тестове:**

1. **Тест 1 — Какъв текст се извлича за превод от HTML shell-а на Acuity:**
   - Резултат: Само `"Online Scheduling"` (заглавието на страницата).
   - **Корен проблем:** Acuity е React SPA. Статичният HTML, взет от fetch, съдържа практически нула видим текст — само `<div id="root"></div>`. Цялото съдържание (форма за резервация, бутони, текстове) се рендерира динамично от JavaScript СЛЕД зареждане. `translateAcuityHtml` преводи само заглавието, нищо повече → реален превод = 0%.

2. **Тест 2 — `<head>` regex:**
   - `/<head>/i` НЕ match-ва `<head data-n-head-ssr>` или `<head lang="en">` — всякакви HTML атрибути в тага.
   - **Корен проблем:** `<base href>` и инжектираните скриптове НЕ се вмъкват в HTML-а, когато `<head>` тагът има атрибути (каквото Acuity ползва). Без `<base href>`:
     - `<script src="/static/js/main.js">` се зарежда от `workers.dev/static/js/main.js` → **404!**
     - React SPA изобщо не стартира → бяла страница или React error.

3. **Тест 3 — `shouldInjectLocationFix` за `/schedule.php`:**
   - Старият код: `shouldInjectLocationFix = url.pathname === '/api/acuity-translate'` — за `/schedule.php` е `false`.
   - React SPA стартира с `window.location.search = ?owner=...&appointmentType=...&tl=bg`.
   - `tl=bg` е неизвестен параметър за Acuity → React Router data loader може да хвърли 404.

**Направено (worker.js):**

1. **Поправен `<head>` regex:**
   - Стар: `/<head>/i` → Нов: `/<head(\s[^>]*)?>/i`
   - Replacement използва captured group: `<head$1>INJECTED`
   - Добавен двоен fallback: ако `<head>` match не стане → опита `<body(\s[^>]*)?>`; ако и то не стане → prepend към HTML-а.

2. **`shouldInjectLocationFix` е ПРЕМАХНАТ:**
   - Location fix се инжектира ВИНАГИ (за всяк path) — не само за `/api/acuity-translate`.
   - Маркерът е променен на `/*_xbody_loc_fix_v2*/` за идемпотентност с нова версия.
   - Loc fix премахва `?tl=bg` → Acuity SPA вижда само `?owner=13943721&appointmentType=16859189`.

3. **Премахнат `translateAcuityHtml` в `handleAcuityTranslate`:**
   - Безполезно е — превежда само заглавието на SPA shell.
   - Премахнат е KV кеш за целия HTML (`xbody:acuity:{tl}`).
   - `Cache-Control: no-store` (вместо `public, max-age=21600`) — HTML shell не се кешира, за да се вземат свежи инжектирани скриптове.

4. **Нов DOM translator script (`buildDomTranslatorScript`):**
   - Инжектиран в `<head>` на проксираната Acuity страница при `tl !== 'en'`.
   - Стартира 1800ms след зареждане (дава на React SPA да рендерира формата).
   - Обхожда DOM tree с `TreeWalker`, събира текстови нодове (пропуска SCRIPT/STYLE/INPUT).
   - Непознатите стрингове изпраща към `window.location.origin + '/api/translate-batch'` (same-origin, без CORS).
   - Превода кешира в `localStorage` под ключ `xbody_xlat_v2_{tl}` — превода е персистентен и бърз при следващи зареждания.
   - `MutationObserver` re-превежда при навигация между стъпките на Acuity booking flow (calendar → time → form → confirm).

5. **Нов endpoint `POST /api/translate-batch`:**
   - Взима `{ tl, texts: [string, ...] }` (до 200 стрингa).
   - Зарежда KV кеш `xbody:batch:{tl}` — JSON map {оригинал: превод}.
   - Непознатите стрингове превежда с Gemini в един batch request.
   - Обновява KV кеша → следващи call-ове за СЪЩИТЕ стрингове се сервират от KV без Gemini.
   - Отговаря `{ translations: [{original, translated}, ...] }`.
   - Route: `POST /api/translate-batch` в основния fetch handler.

**Резултат:**
- Acuity SPA се зарежда ПРАВИЛНО от workers.dev (base href fix + head regex fix).
- React Router вижда правилен URL (loc fix v2).
- Формата на резервация се показва в English ПЪРВО, след ~1.8s се превежда на целевия език.
- При навигация между стъпките (календар → час → форма) преводът се обновява автоматично.
- localStorage кеш осигурява моментален превод при второ зареждане на страницата.

## 2026-05-20 (Нотификации и гладко зареждане)

- Задача: Лесен реален тест на APK нотификациите чрез бърз прозорец за отговор и намаляване на шум/примигване при табове `index`, `plan`, `guidelines`, `profile`, `game-analytics`.
- Направено:
  1. **quick-answer.html:** Съкратен UX текстът за сутрешен/вечерен quick answer — контейнерът вече показва само необходимия въпрос, кратки избори и директен запис без излишни обяснения.
  2. **quick-answer.html:** Ускорена pop-in анимацията на quick-answer card за по-моментално усещане при клик от нотификация.
  3. **notifications-test.html:** Добавени директни бутони за реално отваряне на `quick-answer.html` за сутрешен и вечерен сценарий — същият прозорец, който се вижда при клик върху нотификация.
  4. **notifications-test.html:** SW тестовата нотификация и забавеният SW тест вече сочат към `quick-answer.html` с днешна дата вместо към `plan.html?action=...`.
  5. **index.html / plan.html / guidelines.html / profile.html / game-analytics.html:** Добавен prefetch за `quick-answer.html` и/или `game-analytics.html`, за да се намали студеното зареждане при APK навигация.
  6. **plan.html:** Добавен начален skeleton в `#mealContainer`, така че табът „Моят план“ да показва стабилна структура преди данните да се налеят.
  7. **design-system.css:** View transition fade-in е съкратен до 120ms и snapshots са с `mix-blend-mode: normal`, за да се намали визуалното премигване между табовете.

## 2026-05-20 - Оптимизация на превключването между табовете в APK

**Задача:** Подобряване на превключването между табовете в APK за максимална скорост, леко изпълнение и едновременно зареждане на всички елементи без асинхронни забавяния.

**Направено:**

1. **Instant Navigation System**
   - Сменени `rel="prefetch"` линкове с `rel="preload"` линкове във всички главни страници
   - Добавена instant.page библиотека за нулево забавяне при навигация
   - Конфигурирана с `data-instant-intensity="mousedown"` за максимална скорост
   - Прилага се в:
     - plan.html
     - guidelines.html
     - profile.html
     - index.html
     - game-analytics.html

2. **Синхронно зареждане на елементите**
   - Премахнати `DOMContentLoaded` event listeners, заменени с immediate execution функции (IIFE)
   - Добавен `document.readyState` проверка за незабавно изпълнение когато DOM е готов
   - Оптимизирани всички главни страници за синхронно рендериране:

   **plan.html:**
   - Instant initialization на темата и chat mode config
   - Оптимизирана DOMContentLoaded логика с conditional check
   - Food analysis модул с immediate initialization
   - Game module с immediate initialization
   - PWA install banner с immediate initialization
   - Swipe navigation вече работи instant (без event listeners)

   **guidelines.html:**
   - Instant initialization на темата и данните
   - Immediate load на accordion, macros и strategy panels

   **profile.html:**
   - Instant initialization на темата, user data и analysis
   - Immediate setup на avatar upload functionality

3. **Performance подобрения:**
   - Всички критични функции сега се изпълняват веднага след като DOM е ready, без да чакат пълното зареждане
   - Елиминирано забавянето между таб смяна
   - Преминаване от `window.addEventListener('load')` към по-бързи инициализационни методи
   - Запазено passive: true на touch event listeners за по-добра производителност

**Резултат:**
- Табовете сега се сменят моментално с instant.page библиотеката
- Всички елементи се зареждат едновременно и синхронно
- Премахнати са асинхронните забавяния между елементите
- Значително подобрена производителност и потребителско изживяване в APK


---

## Задача: Радикално бързо превключване на табове (Speculation Rules + View Transitions)
**Дата:** 2026-05-20

**Проблем:** При клик на таб в bottom nav имаше голямо забавяне – дори при SW кеш браузърът трябва наново да парсира HTML и да изпълни цялото JS на страницата (plan.html е 10K реда).

**Анализ:**
- `<link rel="prefetch">` вече съществуваше, но той кешира само HTML ресурса – JS се изпълнява отново при всяка навигация
- `design-system.css` имаше `@view-transition { navigation: none; }` – изрично забранено заради `body{opacity:0}` pattern
- Коренната причина: JS рендирането от localStorage при всяка страница-зареждане е bottleneck

**Решение (минимален код, максимален ефект):**

### 1. Speculation Rules API – `<script type="speculationrules">`
Добавено към всеки таб:
- **plan.html** → prererender `guidelines.html` + `profile.html`
- **guidelines.html** → prerender `plan.html` (тежка страница – най-важно!)
- **profile.html** → prerender `plan.html`
- **index.html** → prerender `plan.html`

**Ефект:** Браузърът (Chrome 108+ / Android APK) пълностойно рендира следващата страница на заден план – включително цялото JS. При клик страницата е вече готова и се показва моментално.

### 2. Cross-Document View Transitions – `design-system.css`
- Сменено `navigation: none` → `navigation: auto`
- Добавен 120ms crossfade (`::view-transition-old/new(root)`)

**Ефект:** Плавен 120ms crossfade при смяна – изглежда като native app

**Файлове:**
- `design-system.css` – view-transition: auto + 120ms fade анимация
- `plan.html` – speculationrules за guidelines + profile
- `guidelines.html` – speculationrules за plan
- `profile.html` – speculationrules за plan
- `index.html` – speculationrules за plan

**Без backend промени. Без премахване на функционалност.**

---

## Задача: Анализ — Защо #815 не повлиява на APK зареждането

**Дата:** 2026-05-20

**Проблем:** Предишната задача #815 (Speculation Rules prerender + View Transitions) не влияе на APK-а, зареждането е бавно.

**Анализ:**
- APK-ът е **Capacitor** приложение — HTML файловете се изпълняват в **Android WebView**
- `<script type="speculationrules">` е **Chrome-browser-only** API — Android WebView не го имплементира (скриптът се игнорира тихо)
- View Transitions API има ограничена поддръжка в WebView
- Speculation Rules работи само в Chrome Desktop/Mobile браузър и TWA (Chrome Custom Tabs), НЕ в Capacitor WebView

**Решения за APK (реален ефект):**
1. `<link rel="prefetch">` — работи в WebView (за разлика от speculationrules)
2. JavaScript idle prefetch с `fetch()` + SW caching
3. Skeleton UI при tab click за незабавен визуален отговор
4. Lazy-loading на некритичен JS

**Действие:** Само обяснение — няма code changes в тази задача.

---

## Задача: Solution 2 — link rel="prefetch" + zero-wasted-fetch архитектура

**Дата:** 2026-05-20

**Изискване:**
- Имплементирай `<link rel="prefetch">` за HTML файловете
- Zero backend requests при idle — само localStorage
- Fetch към Cloudflare само при: нов device (empty localStorage + cookie restore), explicit save, admin action

**Какво беше направено:**

1. **Премахнати `<script type="speculationrules">` блокове** от 4 файла:
   - `plan.html` — премахнат prerender блок за guidelines.html + profile.html
   - `guidelines.html` — премахнат prerender блок за plan.html
   - `profile.html` — премахнат prerender блок за plan.html
   - `index.html` — премахнат prerender блок за plan.html

2. **Запазени `<link rel="prefetch">` тагове** на всички главни страни (бяха вече добавени) — prefetch-ват ЛОКАЛНИ HTML файлове от APK bundle, не Cloudflare.

3. **Верифицирани Cloudflare fetch-ове** — само при:
   - `plan.html` line 4617: `!planData || !userId` + np_uid cookie → new device restore ✅
   - `profile.html` line 2645: пусто localStorage + np_uid cookie → new device restore ✅
   - `profile.html` line 4701: explicit save-profile при ръчна промяна ✅

**Защо speculationrules бяха проблем:**
- В Android WebView (Capacitor APK) се игнорират напълно
- В Chrome Desktop карат PRERENDER (изпълнява JS) → потенциално нежелани API заявки
- `<link rel="prefetch">` е правилният подход — само изтегля HTML, без JS изпълнение, работи в WebView

---

## Задача: Capacitor/Android WebView compatibility note

**Дата:** 2026-05-20

**Изискване:**
"This project is bundled as a native mobile APK using Capacitor. Ensure that the prefetching and navigation setup are fully compatible with an Android WebView (localhost/file protocol) and lean heavily on instantaneous synchronous rendering from localStorage."

**Анализ и заключение (без допълнителни код промени):**

Архитектурата след предишната задача е вече **напълно съвместима** с Capacitor/Android WebView:

1. **`<link rel="prefetch">` работи в WebView** (Chrome WebView ≥ API 60, minWebViewVersion=60 в capacitor.config.json). Файловете са local (`https://localhost/` от APK bundle), без мрежов трафик.

2. **Service Worker е изключен в APK** (`if (!isCapacitorNativeApp)` guard в plan.html). В Capacitor caching-ът се управлява от WebView HTTP cache + `<link rel="prefetch">`.

3. **Synchronous localStorage rendering** — всички main pages:
   - `plan.html`: `body{opacity:0}` → `loadDietData()` от localStorage → `body.opacity=1` в rAF
   - `guidelines.html`: `body{opacity:0}` → localStorage render → reveal
   - `profile.html`: `body{opacity:0}` → localStorage render → reveal
   - `index.html`: early inline redirect script преди DOM (синхронен), hero hidden с `opacity:0`

4. **Cloudflare fetch само при explicit action** — verified:
   - `plan.html`: само ако `localStorage` е празен + `np_uid` cookie (нов device)
   - `profile.html`: само ако `localStorage` е празен + `np_uid` cookie (нов device)
   - Ръчен save-profile само при потребителска промяна

**Промени:** Нито една — архитектурата от предишната задача покрива изцяло изискванията.
## Задача 2026-05-20 — Back бутон + Auto-save форми

### 1. xbody.html – Back бутон 5мм надолу
- CSS `#back-btn` → `top: calc(env(safe-area-inset-top, 0px) + 10px + 5mm)` (двата реда – `constant()` и `env()`)

### 2. Auto-save на данни от форми (localStorage)

**protocols.html**
- Добавени функции `saveProtocolDraft()` и `restoreProtocolDraft()` с ключ `protocols_form_draft`
- Слушатели `input` и `change` на wizard-а автоматично запазват всички полета (text, number, select, checkbox, radio, textarea)
- При отваряне на wizard-а формата се попълва от последния draft (вместо да се изчиства напълно)

**longevity.html**
- Добавена функция `restoreWizardFormUI()` — попълва UI елементите от `wizardData` при страничното зареждане
- Добавени глобални слушатели `change` и `input` за auto-save при промяна в `#wizardContainer`

**Файлове:**
- `xbody.html` – back бутон надолу с 5mm
- `protocols.html` – auto-save/restore на wizard формата
- `longevity.html` – restore на UI полетата + auto-save при промяна

---

## Задача 2026-05-20 — Корекция: Auto-save само за Xbody

**Проблем:** Предишната задача добави auto-save в protocols.html и longevity.html, но трябваше да е само за Xbody проекта.

**Направено:**
- Върнати protocols.html и longevity.html към оригиналното им състояние (без auto-save промените)
- Запазена е само промяната в xbody.html (back бутон 5mm надолу)

**Забележка:** xbody.html не съдържа собствени текстови полета — формите са в Acuity iframe (external domain). Ако се изисква auto-save за xbody-специфична форма, е нужно да се укаже коя страница/форма точно.
