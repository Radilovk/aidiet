# Карта на репото (чети първо това)

Едно репо, няколко проекта, общ плосък корен. GitHub Pages сервира корена като biocode.website — това е само
източникът; **публичният адрес на Nutriin е nutriin.app** (EmoEat — emoeat.app), през worker-а (`app-domain.js`).
В страниците, sitemap и canonical се пише nutriin.app, не biocode.website. Писмата към клиенти се пишат с връзки от
biocode.website (`PLAN_APP_BASE_URL`); при изпращане `email-domain.js` ги сменя с потвърдения домейн на пощата
(nutriin.app, преходно eatologix.com), а без потвърден домейн остават `info@biocode.online` и biocode.website. **Не местим страници** — адресите се чупят.
Правила за работа: `.cursorrules` и `PROJECT_NOTES.md` (промптове само в `KV/prompts/`).

## Nutriin (PWA + Android APK, `com.biocode.nutriplan`)
- Страници: `index.html` (вход), `questionnaire2.html`, `plan.html`, `profile.html`, `analysis.html`,
  `plan-pending.html`, `plan-book.html`, `game-analytics.html`, `guidelines.html`, `quick-answer.html`,
  `food-picker.html`, `features.html`, `warning.html`, `privacy-policy.html`, `terms.html`, `help.html` (въпроси и отговори),
  `delete-account.html` (изтриване на профил — адресът за Google Play; в приложението: Профил → „Изтрий профила“, `/api/user/delete-account`).
- Публични страници извън приложението: `protocol-landing.html` + `protocol-<slug>.html`, `sitemap.xml` и общият футър
  (`site-footer.css`, между маркерите `site-footer:start/end`) се генерират от `protocol-states.js` със
  `npm run build:protocol-pages` (проверка: `test:protocol-pages`). Стил: `protocol-page.css`. Футърът не се редактира на ръка.
- Общ фронтенд JS: `app.js`, `app-ui.js`/`app-ui.css`, `design-system.css`, `platform.js`, `platform-compat.js`,
  `session-utils.js`, `auth-guard.js`, `plan-sync.js`, `local-scheduler.js`, `notification-launch.js`,
  `health-sync.js`, `widget-layout.js`/`.css` (картите в таб: подредба с влачене и скриване, като бързите настройки на телефона; памет `np_widgets_<таб>`; засега в Напредък), `progress-index.js` („Резултат“ в Напредък: мерими промени по водещите за целта показатели от `goal-model.js` — без старанието; история `np_checkins` от седмичния преглед; тест `test:progress-index`), `weight-log.js` (теглото — без поле на екрана: пита се в седмичния преглед, сменя се от Профил; планът се настройва при прегледа), `daily-thoughts.js` + `thoughts/<език>.js` (мисъл за деня: тих ред в плана, известие само при отсъствие; преводите — ръчни, по един файл на език), `activity-tracker.js` (крачкомер + въпрос за тренировка; дневните цели — `nutrition-engine/metabolic.js`), `native-backup.js`, `drive-backup.js`, `meal-swaps.js`, `game-scoring.js`, `rewards-engine.js` + `rewards-ui.js`/`.css` (награди за постоянство, седмица, месечно предизвикателство; сървърът — `rewards.js`, лендинг за поканени — `invite-welcome.js`, админ — `admin-rewards.js`; виж PROJECT_NOTES), `sw.js`, `manifest.json`.
- Марка **Nutriin** (nutri + **in** — вътре, отвътре; преди Eatologix, още преди NutriPlan): знакът е ябълка, нарисувана
  с една линия, която вътре изписва „in“, + листо. Лого/икони в `brand/nutriin-*` + `icon-*.png|svg`, `favicon.svg` —
  генерират се с `npm run build:brand` (`scripts/build-brand.mjs`; източници `brand/nutriin-mark.json` и
  `brand/nutriin-wordmark-glyphs.json`; не рисувай на ръка). Надписът „nutri“ лек + „in“ плътен зелен. `brand/eatologix-*` са
  копия на новите (за изпратени писма и стари версии). Цветове: токени `--brand-*` в `design-system.css`, класове `.ex-logo` / `.ex-mark`.
  Вътрешните имена остават старите: `window.EatologixI18n`, `EatologixBotCheck`, `EatologixPricing`, `__EATOLOGIX_BETA_UNLOCK`.
- **Визуален език „Светлина · Стъкло · Спокойствие“:** `ambient-glass.css` + `ambient-glass.js` (във всяка страница на
  приложението, в края на `<head>`; `?ui=classic` връща стария вид). Публичните страници — `html.ui-glass` в `protocol-page.css`.
- **Дизайн: `DESIGN_PRINCIPLES.md`** — ролите на цветовете (60-30-10), структурата на екрана (хиро без кутия →
  обобщение → разгъващи се секции/карти), разделенията, думите за нивата. Всяка промяна по вида — оттам и с токените. Идентификаторите остават старите: `window.NutriPlan*`, `com.biocode.nutriplan`,
  `NutriPlan-v*.apk` (по тях старите версии намират обновления), ключове в localStorage.
- Домейн nutriin.app: `app-domain.js` във worker-а (страниците от biocode.website, `/api/` същият), `APP_HOSTS` и `MAIN_HOST`
  в `wrangler.toml`. nutriin.eu → 301 към nutriin.app. eatologix.com (старото име) се обслужва, а браузърът пренася паметта
  и препраща към nutriin.app (`i18n.js`, само ако nutriin.app отговаря). Пощата: подател „Nutriin“ от info@nutriin.app, щом
  Resend потвърди домейна (`email-domain.js`, workflow „Domain setup“); дотогава — от вече потвърдения info@eatologix.com.
- Преводи: `i18n.js` + `i18n/<език>/common.json` и `i18n/<език>/<страница>.json` (bg е изходният език; ръчен речник
  „точен български текст → превод“, `data-i18n` за двусмислени текстове, `patterns` за текст с числа). Поддържани: bg, en, de, es, ru (руският е на кирилица — текст с ы/э/ё не се превежда).
  Каквото липсва в речника → резервен AI превод `/api/i18n/translate` (`i18n-server.js`, кеш в KV, общ за всички).
  Езикът стига до сървъра в тялото на заявките (`lang`, `userData.lang`) → AI пише на него (`languageDirective`), пазачът
  `text-guard.js` не маха латиницата при чужд език. Проверка: `npm run test:i18n`; след деплой: `npm run i18n:prewarm`.
  Нова страница на приложението → `<script src="./i18n.js?v=…">` веднага след `<meta charset>`.
- APK: `capacitor.config.json` (webDir `capacitor-shell`, генерира се в CI), `android-res/` (Java/gradle/patch-ове),
  `.github/workflows/build-apk.yml` (копира корена в shell с изключения), `publish-apk-release.yml`.
  Нов root файл влиза в APK автоматично, освен ако не е в изключенията на `build-apk.yml`.

## Бекенд (Cloudflare Worker, общ за Nutriin, fitness, studio)
- Източник: `worker.entry.js` + импортираните модули в корена, `nutrition-engine/`, `fitness/worker.js`, `studio-platform/`.
- **`worker.js` е генериран (4MB) — не го редактирай и не го чети.** Сглобява се с `npm run build:worker`.
- Данни: `data/`, `data/engine/`, `nutrition-library/`, `*-data.js`. Промптове/KV: `KV/`.
- Проверка: `npm run test:worker` (bundle + health); тематични тестове: `npm run test:*` (виж `package.json`, `scripts/`).

## Други проекти (отделни, не пипай при работа по Nutriin)
- **EmoEat** (`emoeat.html`, emoeat.app) — тест за емоционалното хранене, без въпроси за храна. Въпросите, вариантите на
  сцените по човека (пол, възраст, ден, дом, детство, здраве), чертите и тълкуването са в `emoeat-v3.js`; основата и
  решенията — `EMOEAT_PSYCH_REVIEW.md`, `EMOEAT_V3_QUESTIONS.md`, `EMOEAT_V3_CALIBRATION.md`. Проверка: `npm run test:emoeat`.
  Преводите на въпросите са в `i18n/<език>/emoeat.json` (английският е изходът; на живо без AI превод — `data-i18n-dict`);
  липсващите показва `node scripts/emoeat-v3-strings.mjs --missing i18n/<език>/emoeat.json`. `scripts/emoeat-v3-translate.mjs`
  харчи кредити от OpenAI — само по изрично решение.
- `fitness/` — KA-TRAINER (собствен `package.json`, бекендът е в общия worker).
- `xbody.html` (+ `xbody-*`, `acuity/`), `studio.html` + `studio-platform/`, `emoeat.html`, `kids.html`,
  `longevity.html`, `protocols.html`, `protocol-landing.html`, `pep*.html`, `reta.html`, `aix.html`,
  `lqto2026.html`, `vaprosnikhomeo.html`, `dopamine-test.html`, `health.html`.
- `xb-studio.html` (+ `studio-app/landing/`) — публичната страница на приложението XB-Studio (iOS/Android сваляне, студиата от живия списък).
- `admin.html` (+ `admin-*`) — админ панел на Nutriin, не влиза в приложението.
- `viber-sender/`, `workflows/`, `migrations/`, `samples/`, `clients/` — помощни.

## Големи файлове (чети на части, търси с Grep)
`admin.html` ~760KB, `worker.entry.js` ~740KB, `plan.html` ~600KB, `questionnaire2.html` ~370KB,
`profile.html` ~250KB, `index.html` ~220KB.

## Документация
Активна в корена (`README.md`, `ARCHITECTURE.md`, `DOCS.md`, `PROJECT_NOTES.md`, API_*). Старите отчети са в
`docs/archive/` (вкл. `docs/archive/root/`) — история, може да е остаряла; не ги чети без нужда.
Файлът `.ignore` скрива генерирани файлове, дъмпове и архива от търсенето.
