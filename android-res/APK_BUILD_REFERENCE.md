# APK Build Reference — NutriPlan (com.biocode.nutriplan)

> **ВАЖНО ЗА ВСИЧКИ АГЕНТИ И РАЗРАБОТЧИЦИ**
> Този файл описва пълното „замразено" (locked) състояние на APK билда.
> **Не променяйте нищо от изброеното по-долу, освен ако не е изрично поискано.**
> При получена задача, модифицирайте САМО конкретно споменатите елементи и не пипайте останалото.

---

## 1. Файлове на конфигурацията (НЕ ПРОМЕНЯЙТЕ без изрична задача)

| Файл | Роля | Заключено |
|------|------|-----------|
| `.github/workflows/build-apk.yml` | CI пайплайн — главен скрипт на билда | ✅ |
| `capacitor.config.json` | Capacitor настройки (appId, appName, webDir, server, plugins) | ✅ |
| `android-res/build-overrides.gradle` | Gradle допълнение: подписване, versionCode/versionName | ✅ |
| `twa-manifest.json` | Само `appVersion` и `versionCode` се четат за билда | ✅ |

---

## 2. Идентификация на приложението (НЕПРОМЕНИМИ)

```
appId / packageId : com.biocode.nutriplan
appName           : NutriPlan
webDir            : capacitor-shell        ← директорията с frontend файловете
```

Тези стойности са заключени — промяната им разваля Play Store записа и подписването.

---

## 3. Server конфигурация в capacitor.config.json (НЕПРОМЕНИМА)

```json
"server": {
  "androidScheme": "https",
  "hostname": "localhost"
}
```

**Защо е заключено:** `server.url` НЕ трябва да се добавя. Ако се постави реален URL,
Android WebView блокира cross-origin API заявките (`/api/*`) към Cloudflare Worker.
Само `hostname: "localhost"` позволява коректна работа.

---

## 4. Иконa на приложението (ЗАКЛЮЧЕНО ПОВЕДЕНИЕ)

- **Изходен файл:** `icon-512x512.png` (PWA maskable иконата от `manifest.json`), fallback: `icon-512.png`
- **Legacy launcher icons** (`ic_launcher.png`, `ic_launcher_round.png` в mipmap-*):
  директен resize на `icon-512x512.png` — БЕЗ добавяне на цветен фон отгоре
- **Adaptive foreground** (`ic_launcher_foreground.png`):
  иконата центрирана в 66% safe zone на прозрачно платно
- **Adaptive background:** `ic_launcher_background` = `#042F2E` (тъмно тюркоазено)

> **Правило:** Иконата на APK файла и иконата в приложението ТРЯБВА да са идентични
> на иконата, използвана за PWA (Progressive Web App) инсталацията.
> НЕ добавяйте бели кръгове, рамки или фонове върху иконата.

---

## 5. Splash screen (ЗАКЛЮЧЕНО)

| Елемент | Стойност |
|---------|----------|
| Лого файл | `drawable-nodpi/nutriplan_splash_logo.png` (256×256, директен resize на PWA иконата) |
| Фон | `#042F2E` (тъмно тюркоазено) — drawable/splash.xml и drawable-night/splash.xml |
| Тема | `AppTheme.NoActionBarLaunch` → `parent="Theme.SplashScreen"` |
| Анимирана икона | `@drawable/nutriplan_splash_logo` |
| Post-splash тема | `@style/AppTheme.NoActionBar` |

> **Правило:** Splash screen е еднакъв за светъл и тъмен режим — тъмен фон `#042F2E`.
> НЕ добавяйте бяло, рамки или overlay ефекти върху логото.

---

## 6. Навигационна лента (navigation bar) — ЗАКЛЮЧЕНО ПОВЕДЕНИЕ

| Режим | Файл | Цвят на лентата | Иконки |
|-------|------|-----------------|--------|
| Светъл (light) | `values/styles.xml` → `AppTheme.NoActionBar` | `@android:color/white` (бяло) | тъмни (`windowLightNavigationBar=true`) |
| Тъмен (night/dark) | `values-night/styles.xml` → `AppTheme.NoActionBar` | `#042F2E` (тъмно тюркоазено) | светли (`windowLightNavigationBar=false`) |

> **Правило:** Навигационната лента ТРЯБВА да се синхронизира с темата на системата.
> НЕ задавайте хардкодиран бял цвят без съответния night вариант.

---

## 7. Нотификации (LocalNotifications) — ЗАКЛЮЧЕНО

```json
"LocalNotifications": {
  "smallIcon": "ic_stat_nutriplan",
  "iconColor": "#009A9E"
}
```

- Системен default звук — без custom `.wav` файл
- `ic_stat_nutriplan.png` — монохромно PNG (alpha extract от PWA иконата), генерирано в drawable-* директориите
- `android-res/patch-local-notifications.py` — patch-ва plugin-а след `cap sync`:
  - инсталира `GameNotificationActionReceiver` в `@capacitor/local-notifications` (НЕ в app manifest)
  - регистрира receiver в plugin `AndroidManifest.xml` **вътре в `<application>`**
  - action бутоните → `BroadcastReceiver` (без стартиране на WebView)
- `android-res/patch-app-exit.py` — `App.exitApp()` → `finishAndRemoveTask()` (без фонов процес в recents)
- AndroidManifest.xml (app) получава следните permissions (добавени идемпотентно):
  - `POST_NOTIFICATIONS`
  - `SCHEDULE_EXACT_ALARM`
  - `RECEIVE_BOOT_COMPLETED`
  - `WAKE_LOCK`
  - `VIBRATE`

> **Правило:** НЕ премахвайте нито едно от тези permissions. НЕ променяйте `ic_stat_nutriplan` логиката.

---

## 8. Версии и подписване — ЗАКЛЮЧЕНО

- `versionCode` и `versionName` се четат от `twa-manifest.json` (полета `versionCode` и `appVersion`)
- Gradle подписването е в `android-res/build-overrides.gradle`
- Keystore alias: `nutriplan`
- Env. variables: `ANDROID_KEYSTORE_PATH`, `STORE_PASS`, `KEY_PASS`
- При липса на keystore → debug build; при наличие → release build (подписан)

> **Правило:** НЕ добавяйте inline signingConfig в build.gradle. Използвайте само `build-overrides.gradle`.

---

## 9. Capacitor версии (ЗАКЛЮЧЕНО)

| Пакет | Версия |
|-------|--------|
| `@capacitor/core` | ^8.3.1 |
| `@capacitor/android` | ^8.3.1 |
| `@capacitor/cli` | ^8.3.1 |
| `@capacitor/local-notifications` | ^8.0.2 |
| `@capacitor/motion` | ^8.0.0 |
| Java (JDK) | 21 (Temurin) |
| Node.js | 22 |

> **Правило:** НЕ сменяйте версии на Capacitor без изрична задача. Capacitor 8.x изисква JDK 21.

---

## 10. capacitor-shell — правила за rsync (ЗАКЛЮЧЕНО)

`capacitor-shell/` се попълва с rsync при всеки билд. Изключени са:

- `.git/`, `.github/`, `node_modules/`, `android/`, `android-res/`, `capacitor-shell/`
- `KV/`, `Plan1/`, `Plan2/`, `Protocols/`, `clients/`, `samples/`
- `*.md`, `*.log`, `*.csv`, `*.keystore`, `*.py`
- `package.json`, `package-lock.json`, `twa-manifest.json`, `capacitor.config.json`, `wrangler.toml`, `worker.js`
- Временни/лични файлове: `client___*`, `Errorlist.txt`, `ai_communication.txt`, `aicom.txt`, `dynaquest.txt`, `log1`, `workererrors`
- Включени: `docs/` директорията и `docs/*.png`
- HTML файловете се копират без APK-only минификация или допълнителни runtime трансформации

> **Правило:** НЕ добавяйте `worker.js` в `capacitor-shell/` — той е Cloudflare Worker и не работи в Android.
> НЕ добавяйте `server.url` в `capacitor.config.json`.

---

## 11. Как да правите промени правилно

**При получена задача за APK:**

1. Прочетете този файл изцяло преди да пишете код.
2. Идентифицирайте точно кой елемент от раздели 1-10 се отнася до задачата.
3. Модифицирайте САМО него — нищо друго.
4. Актуализирайте този файл ако добавяте нов заключен елемент.

**Пример за правилно поведение:**
- Задача: „Промени цвета на splash screen"
- Правилна промяна: само `#042F2E` стойностите в раздел 5
- Погрешна промяна: докосване на иконата, Capacitor версии, permissions, signing

---

## 12. Хронология на заключените промени

| Дата | Промяна | Причина |
|------|---------|---------|
| 2026-05-05 | Иконата на APK = PWA иконата (`icon-512x512.png`), без overlay | Иконата трябва да е идентична с PWA |
| 2026-05-05 | Навигационна лента следва темата (values/values-night) | Лентата беше постоянно бяла, сега следва light/dark режима |
