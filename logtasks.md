# Log Tasks

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
