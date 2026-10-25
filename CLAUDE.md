# Карта на репото (чети първо това)

Едно репо, няколко проекта, общ плосък корен. GitHub Pages сервира корена като biocode.website,
затова **не местим страници** — адресите и връзките между проектите се чупят.
Правила за работа: `.cursorrules` и `PROJECT_NOTES.md` (промптове само в `KV/prompts/`).

## NutriPlan (PWA + Android APK, `com.biocode.nutriplan`)
- Страници: `index.html` (вход), `questionnaire2.html`, `plan.html`, `profile.html`, `analysis.html`,
  `plan-pending.html`, `plan-book.html`, `game-analytics.html`, `guidelines.html`, `quick-answer.html`,
  `food-picker.html`, `features.html`, `warning.html`, `privacy-policy.html`, `terms.html`.
- Общ фронтенд JS: `app.js`, `app-ui.js`/`app-ui.css`, `design-system.css`, `platform.js`, `platform-compat.js`,
  `session-utils.js`, `auth-guard.js`, `plan-sync.js`, `local-scheduler.js`, `notification-launch.js`,
  `health-sync.js`, `activity-tracker.js` (крачкомер + въпрос за тренировка), `native-backup.js`, `drive-backup.js`, `meal-swaps.js`, `game-scoring.js`, `sw.js`, `manifest.json`.
- APK: `capacitor.config.json` (webDir `capacitor-shell`, генерира се в CI), `android-res/` (Java/gradle/patch-ове),
  `.github/workflows/build-apk.yml` (копира корена в shell с изключения), `publish-apk-release.yml`.
  Нов root файл влиза в APK автоматично, освен ако не е в изключенията на `build-apk.yml`.

## Бекенд (Cloudflare Worker, общ за NutriPlan, fitness, studio)
- Източник: `worker.entry.js` + импортираните модули в корена, `nutrition-engine/`, `fitness/worker.js`, `studio-platform/`.
- **`worker.js` е генериран (4MB) — не го редактирай и не го чети.** Сглобява се с `npm run build:worker`.
- Данни: `data/`, `data/engine/`, `nutrition-library/`, `*-data.js`. Промптове/KV: `KV/`.
- Проверка: `npm run test:worker` (bundle + health); тематични тестове: `npm run test:*` (виж `package.json`, `scripts/`).

## Други проекти (отделни, не пипай при работа по NutriPlan)
- `fitness/` — KA-TRAINER (собствен `package.json`, бекендът е в общия worker).
- `xbody.html` (+ `xbody-*`, `acuity/`), `studio.html` + `studio-platform/`, `emoeat.html`, `kids.html`,
  `longevity.html`, `protocols.html`, `protocol-landing.html`, `pep*.html`, `reta.html`, `aix.html`,
  `lqto2026.html`, `vaprosnikhomeo.html`, `dopamine-test.html`, `health.html`.
- `admin.html` (+ `admin-*`) — админ панел на NutriPlan, не влиза в приложението.
- `viber-sender/`, `workflows/`, `migrations/`, `samples/`, `clients/` — помощни.

## Големи файлове (чети на части, търси с Grep)
`admin.html` ~760KB, `worker.entry.js` ~740KB, `plan.html` ~600KB, `questionnaire2.html` ~370KB,
`profile.html` ~250KB, `index.html` ~220KB.

## Документация
Активна в корена (`README.md`, `ARCHITECTURE.md`, `DOCS.md`, `PROJECT_NOTES.md`, API_*). Старите отчети са в
`docs/archive/` (вкл. `docs/archive/root/`) — история, може да е остаряла; не ги чети без нужда.
Файлът `.ignore` скрива генерирани файлове, дъмпове и архива от търсенето.
