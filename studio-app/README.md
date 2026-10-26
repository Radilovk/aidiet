# Приложение „Студио записване“ (iPhone и Android)

Една обвивка за **всички студиа**. Показва живата страница за записване (`https://biocode.website/studio.html`), затова
новите функции стигат до клиентите **без нова версия от магазина**. Клиентът избира студио (или въвежда неговия код),
записва час и **телефонът сам му напомня 4 часа преди часа** (локално известие — без сървър, без интернет в момента).
Студиото може да покаже съобщение на клиентите си от admin → Настройки → Известие.

Не се ползват push известия, затова **не са нужни** Firebase, APNs ключове и сертификати за известия.

## Какво се прави веднъж (iPhone)

### 1. Apple Developer Program — $99 на година
1. https://developer.apple.com/programs/enroll — влез с Apple акаунт.
2. **Индивидуален** (проверката през приложението „Apple Developer“ отнема 1–2 дни; в магазина се вижда името ти) или
   **Фирмен** (иска D-U-N-S номер, отнема седмици; в магазина се вижда името на фирмата). Фирма е по-подходящо за
   платформа, която обслужва чужди студиа.

### 2. Име и Bundle ID — реши ги ПРЕДИ следващата стъпка (Bundle ID не се сменя)
Сега са: **Bundle ID `com.biocode.studios`**, име **„Студио записване“** (`studio-app/capacitor.config.json`:
`appId`, `appName`). Ако искаш други — смени ги там сега.

### 3. App Store Connect
1. developer.apple.com → Certificates, Identifiers & Profiles → **Identifiers → +** → App IDs → App →
   Description „Studio“, Bundle ID (Explicit) `com.biocode.studios`. Без никакви Capabilities (не са нужни).
2. https://appstoreconnect.apple.com → My Apps → **+ New App**: платформа iOS, име, език **Bulgarian**,
   Bundle ID — избираш регистрирания, SKU — каквото и да е (напр. `studio-1`).
3. Users and Access → **Integrations → App Store Connect API → +**: име „GitHub“, роля **Admin**. Изтегли
   `AuthKey_XXXX.p8` (дава се само веднъж!). Запиши **Key ID** и **Issuer ID** (най-горе на страницата).
4. GitHub → Settings → Secrets and variables → Actions → 4 нови секрета:
   | Секрет | Стойност |
   |---|---|
   | `APPLE_TEAM_ID` | developer.apple.com → Membership details → Team ID |
   | `APPSTORE_KEY_ID` | Key ID от стъпка 3 |
   | `APPSTORE_ISSUER_ID` | Issuer ID от стъпка 3 |
   | `APPSTORE_KEY_P8` | целият текст на `.p8` файла (с `-----BEGIN PRIVATE KEY-----`) |

### 4. Компилиране и качване — без Mac
Actions → **„Студио приложение — iOS (TestFlight)“** → Run workflow. Работи на облачен Mac на GitHub (безплатно за
публично репо), Xcode сам прави сертификата и профила чрез API ключа (без ръчно теглене на файлове). След 10–30
минути билдът е в App Store Connect → TestFlight. Добави себе си като вътрешен тестер и го инсталирай през
приложението TestFlight.

> Това не е изпробвано на истински Mac (тази среда е Linux). При първото пускане е възможна една-две дребни
> поправки в процеса — изпрати ми червения лог и ги оправям.

### 5. Подаване за ревю (App Store)
В App Store Connect попълни:
- **Privacy Policy URL:** `https://biocode.website/studio-privacy.html` · **Support URL:** същият адрес или страница на студио.
- **App Privacy** (въпросникът): *Contact Info* (име, телефон; по желание имейл) и *Payment Info* (картата минава през
  Stripe) — и двете „App Functionality“, **без** „Tracking“. Не се събират местоположение, контакти, снимки.
- **Категория:** Health & Fitness (или Lifestyle). **Възраст:** 4+. **Цена:** безплатно.
- **Скрийншоти:** iPhone 6.9" (и 6.5"). Снимай от TestFlight версията на телефона.
- **App Review Information → Notes** (препоръчан текст):
  > The app has no accounts or logins. Open the app, pick the studio "demo" from the list (or type the code "demo"),
  > choose any free hour and tap "Запази" with a made-up name and phone to see the full booking flow. The booking is for a
  > physical, on-site service (EMS training at a studio) and is paid in person; a payment card, if a studio asks for
  > one, is only a guarantee entered into Stripe — nothing is charged in the app (Guideline 3.1.3(e)).
  > Reminders are local notifications set on the device. In-app data deletion: "Моите часове" → "Изтрий данните ми".
- Преди подаване направи студио **`demo`** (Actions → „Студиа“ → create), с работно време всеки ден, **без Stripe** и без
  изискване за карта (admin → Настройки → Гаранция: „Без гаранция“) и го остави в списъка.

Ревюто отнема обикновено 1–2 дни.

### Правила на Apple, които това приложение покрива
- **4.2 (минимална функционалност):** приложението не е „просто сайт“ — има нативни локални известия (напомняния),
  haptic обратна връзка и системен екран за старт; страницата е изцяло разработена за телефон.
- **3.1.3(e) (стоки и услуги извън приложението):** физически услуги на място — плащането е със Stripe/на място, не с
  In-App Purchase.
- **5.1.1(v) (изтриване на данни):** бутон „Изтрий данните ми“ в приложението.
- **5.1.1 (поверителност):** публична страница с политика и точни декларации.

## Android
- Actions → **„Студио приложение — Android“** → Run workflow → от Artifacts свали `studio-app-apk` и го инсталирай на
  Android (разрешаваш „инсталиране от неизвестен източник“) — това е за пробване.
- **Google Play** (по желание, $25 еднократно): направи ключ веднъж и сложи 4 секрета:
  ```
  keytool -genkeypair -v -keystore studio.keystore -alias studio -keyalg RSA -keysize 2048 -validity 10000
  base64 -w0 studio.keystore    # → секрет STUDIO_KEYSTORE_BASE64
  ```
  Още: `STUDIO_KEYSTORE_PASSWORD`, `STUDIO_KEY_ALIAS` (= `studio`), `STUDIO_KEY_PASSWORD`. Пази файла на сигурно място.
  Workflow-ът дава и подписан `studio-app-aab` за качване в Play Console. (Play Console изисква и политика за
  поверителност — същият адрес.)

## Как работи (за разработка)
- `capacitor.config.json` — идентичност, адресът на страницата (`server.url`), плъгини. `www/` е само началният и
  офлайн екранът.
- `scripts/patch-ios.py`, `scripts/patch-android.py` — малките поправки върху генерирания проект (идемпотентни).
- `assets/icon.png`, `assets/splash.png` — **временна** икона и старт екран; замени ги с твои (икона 1024×1024 без
  прозрачност, старт 2732×2732) и пусни процеса пак.
- Проектите `ios/` и `android/` не се пазят в репото — правят се наново при всяко пускане.
- Локално (на Mac): `cd studio-app && npm ci && npx cap add ios && python3 scripts/patch-ios.py && npx cap open ios`.
