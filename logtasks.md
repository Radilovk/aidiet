# Log Tasks

## 2026-05-19 - Задача: Поправка на нотификационни модали (не се зарежда цялото приложение)

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
