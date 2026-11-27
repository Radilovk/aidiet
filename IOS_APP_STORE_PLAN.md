# Nutriin за iOS — план за адаптация и подаване в App Store

> Изготвен на 27.11.2026 по реалното състояние на кода (Capacitor 8, `capacitor.config.json`, `build-apk.yml`,
> `access.js`, `billing.js`, `health-sync.js`, `activity-tracker.js`, `android-res/java/*`) и по правилата на Apple.
> Готовият шаблон за iOS в репото е `studio-app/` (`studio-app-ios.yml`, `ios-extra/`, `APP-STORE-SUBMISSION.md`) —
> там вече работят качването в TestFlight с API ключ, `PrivacyInfo.xcprivacy` и декларацията за криптиране.
> Правилата на Apple и таксите в ЕС се промениха през 2025–2026 г. — преди подаване се сверяват с актуалния текст
> (раздел 9).

---

## 0. Главните решения (накратко)

| Въпрос | Решение |
|---|---|
| Как без процент за Apple? | iOS приложението е **безплатно придружаващо приложение** към акаунта в Nutriin: **никакви покупки, цени, бутони или връзки към плащане** в приложението, в описанието и в снимките. Който вече има план от сайта, влиза и го ползва. Няма IAP → няма комисиона. |
| Какво остава като риск? | Правило **3.1.3(b)** казва, че купено другаде може да се ползва в приложението, „ако се предлага и като In-App Purchase“. Apple не го прилага последователно, но е възможно връщане по **3.1.1**. Затова има подготвен **резервен план Б** (раздел 1.4) — няма да се губи време, ако дойде отказ. **100% гаранция за одобрение няма** — ревюто е от хора. |
| Кой подава? | **Фирмен (Organization) акаунт** на Biocode, не личен: приложението събира здравни данни (заболявания, лекарства, тегло, HealthKit) — правило **5.1.1(ix)**. Нужен е D-U-N-S номер (безплатен, 1–2 седмици). |
| Кои телефони? | **Само iPhone** (iPad не се обявява), **iOS 16+** (iPhone 8/X и по-нови — над 97% от активните iPhone). Само вертикално. Пълна поддръжка на всички размери от SE до Pro Max / Air, с и без Dynamic Island. |
| Какво махаме от iOS версията? | APK обновяването, бутона „Свали APK“, `pricing.html`, всички цени, ирисовия анализ (IrisMap), страниците на другите проекти. |
| Какво добавяме? | Sign in with Apple, HealthKit (крачки, сън, тегло), Swift аналози на 4-те Java плъгина, изрично съгласие за AI, Universal Links, iOS дизайн слой (safe area, клавиатура, жестове, Liquid Glass съвместимост). |

---

## 1. Плащанията — как да мине без комисиона и без конфликт

### 1.1 Какво казват правилата (към ноември 2026)
- **3.1.1** — дигитално съдържание и функции в приложението се отключват само с In-App Purchase. AI план, асистент,
  снимки на чинията са дигитална услуга → тук е рискът.
- **3.1.3(b) Multiplatform** — може да се ползва купено на сайта, но формално „ако се предлага и като IAP“.
- **3.1.3(f) Free stand-alone apps** — безплатно приложение-придружител на платен уеб инструмент не трябва да ползва
  IAP, **ако в приложението няма покупки и няма призиви за покупка извън него**. Това е линията, по която минаваме.
- **ЕС (DMA):** от 1.10.2026 г. Apple мина на единен модел (Attachment 14 към лицензното споразумение). Връзка към
  плащане извън приложението вече е разрешена, но **с такса към Apple** (по публикации — около 10–15%). Т.е. връзката
  към сайта **не** спестява комисионата в ЕС → не я ползваме.
- **САЩ:** таксата върху външни връзки още се решава в съда (Epic v. Apple, април 2026) — не разчитаме на нея.

### 1.2 Какво се прави в кода (iOS сборката)
Добра новина: `access.js` вече крие цените в нативното приложение (`isNativeApp()` → без бутон „Виж плановете“).
Това трябва да се затегне за iOS:
1. **Заключените функции не се показват с катинар на iOS.** Сегашният текст „Част от плана. Ако вече имаш план, влез
   със същия акаунт“ е косвен призив към покупка извън приложението. На iOS: функцията или не се показва, или се показва
   неутрално („Не е включено в профила ти“) — без думите „план за 4/12 седмици“, „продължи“, „купи“, „отключи“.
   Ново: `Access.isStoreRestricted()` = `Capacitor.getPlatform() === 'ios'` и всички места в `lockCard`/`showLock`
   минават през него.
2. **Безплатната част трябва да е пълноценна сама по себе си** (иначе — отказ по 4.2 / 3.1.3(f)): въпросник, първият
   ден от менюто, дневник, спазване на деня, крачкомер, тегло, известия, награди, помощ. Ревюиращият с безплатен акаунт
   трябва да види завършено приложение, не „ограничена версия“.
3. **Почистване на текстовете в пакета** — `help.html`, `features.html`, `terms.html`, `rewards-ui.js`,
   `invite-welcome.js`, EmoEat анализа (2,99 €) и всичко с „€“, „Stripe“, „pricing“, „плати“, „купи“, „абонамент“.
   За iOS: варианти на текстовете без цени (или скриване на абзаците с `data-store-hide`).
4. **Автоматична проверка в CI** `scripts/test-ios-store-safe.mjs`: обхожда сглобения `ios-shell/` и проваля
   сборката при `€`, `EUR`, `pricing.html`, `checkout`, `stripe`, `apk`, `Google Play`, `Android`, `beta` и др.
   (с бял списък за технически имена). Така никоя бъдеща промяна не вкарва случайно цена.
5. **Сървърът** не се променя: правата идват от акаунта (`access-control.js`), независимо откъде е платено.
6. **Имейлите** (`email-i18n.js`) не се пипат: писмата са извън приложението и комуникацията с потребители, дали
   съгласие, е разрешена. Единствено без текст от вида „купи в приложението“.

### 1.3 Бележка към ревюиращия (английски, честна — не крием нищо)
> Nutriin is a free companion app for the user's Nutriin account. No digital goods, subscriptions or upgrades are sold
> or advertised in the app, and the app contains no links or calls to action to purchase elsewhere (Guideline
> 3.1.3(f)). All features shown in the app work for a free account. A demo account is provided below.

### 1.4 План Б — ако Apple върне по 3.1.1
Подготвя се паралелно, без да се включва:
- IAP продукти **Non-Renewing Subscription** „План 4 седмици“ и „План 12 седмици“ (съвпада с модела без абонаменти)
  през `StoreKit 2` (плъгин напр. `@capgo/native-purchases`), валидация на сървъра (App Store Server API) → същият
  запис на правата като `billing.js`.
- **App Store Small Business Program** (оборот < 1 млн. $) → по-ниска комисиона (15% за САЩ; за ЕС — по актуалния
  Attachment 14). Цената в iOS може да е по-висока от сайта — разрешено е.
- В приложението пак **няма** връзка към сайта; сайтът си продава отделно.

---

## 2. Съответствие с останалите правила (одит по точки)

| Правило | Риск за Nutriin | Какво се прави |
|---|---|---|
| **1.4.1** Здравни твърдения | AI план при заболявания; IrisMap (ирисова диагностика) ще бъде **отхвърлен** като непроверен медицински метод | IrisMap **изцяло извън iOS сборката**. Без думи „лекува“, „диагноза“, „терапия“ в приложението и метаданните. `warning.html` като ясен отказ от отговорност при първо влизане + в Профил. Препоръка „консултирай се с лекар“ при заболявания/бременност. Източници на насоките (`guidelines.html`) видими. |
| **1.4 / възраст** | Хранене и тегло — чувствителна тема за непълнолетни | Възрастов праг в въпросника съвпадащ с `terms.html` (18+ или 16+); Age Rating въпросникът — честно (Medical/Treatment Information: Infrequent) → вероятно 16+/18+. Без съдържание за отслабване под норма (проверка в двигателя вече има минимум калории). |
| **2.1** Пълнота | Бекендът и AI трябва да отговарят по време на ревюто | Демо акаунт с готов план, история 14 дни, тегло, награди. Наблюдение на Worker-а и квотите на AI в дните на ревюто. |
| **2.3.1** Скрити функции | `__EATOLOGIX_BETA_UNLOCK` (в `plan-sync.js`), админ жестове | Изключени в iOS (`if (isIOS) return`). |
| **2.5.2** Изтеглен код | `app-update.js` тегли APK от GitHub; Firebase SDK се зарежда от `gstatic.com` | `app-update.js` **не влиза** в iOS пакета. Firebase SDK — вграден локално (по-бърз старт, работи без мрежа). Страниците са в пакета (`webDir`), не от сайта. |
| **2.5.4 / изход** | `patch-app-exit.py` — Android „Изход“ | На iOS няма програмен изход — бутоните за изход се скриват. |
| **3.1.x** | виж раздел 1 | |
| **4.2** Минимална функционалност | „Сайт в рамка“ | Нативни неща, видими още в първите минути: HealthKit, локални известия с действия, крачки, haptics, Sign in with Apple, нативен печат/PDF, споделяне, камера. |
| **4.8** Вход | Има вход с Google → **задължително** еквивалент с поверителност | **Sign in with Apple** (вкл. скрит имейл `privaterelay.appleid.com` — писмата през Resend трябва да стигат: регистрира се домейнът за изпращане в Apple → Services → Sign in with Apple for Email Communication). |
| **5.1.1(i) / 5.1.2(i)** AI | Данните отиват при **Google Gemini, OpenAI и Anthropic** (по кода на worker-а) — от ноември 2025 Apple иска **изрично съгласие**, не само политика | Нов екран „Как работи AI“ преди първата AI заявка: кои данни (профил, хранене, снимки, документи), до кои доставчици (поименно), за какво; бутони „Съгласен съм“ / „Не сега“ (без AI функциите приложението пак работи). Запис на съгласието на сървъра + оттегляне от Профил. Същото в политиката. |
| **5.1.1(v)** Изтриване | Има (`delete-account.html`, Профил → „Изтрий профила“) | + **отмяна на токена на Sign in with Apple** при изтриване (изискване на Apple, Firebase `revokeAccessToken`). Тест `test:account-deletion` се разширява. |
| **5.1.1(ix)** Регулирана област | Здравни данни | Organization акаунт (раздел 0). |
| **5.1.3** HealthKit | Данните от Health не се ползват за реклама, не се записват в iCloud, ясно в политиката | Само четене на нужните типове; не се пазят в Drive/iCloud резервните копия; изричен раздел в политиката; ако се пращат към AI — покрити от съгласието по 5.1.2(i). |
| **5.1.2** Проследяване | Няма реклама/аналитика за проследяване | Не е нужен ATT. Проверка в CI, че няма скриптове на трети страни за аналитика в пакета. App Privacy: **Tracking: No**. |
| **Privacy manifest** | Задължителен | `ios-res/PrivacyInfo.xcprivacy` (по шаблона от `studio-app/ios-extra/`): UserDefaults `CA92.1`, FileTimestamp `C617.1`, SystemBootTime `35F9.1`, DiskSpace `E174.1` + декларираните типове данни. |
| **Export compliance** | | `ITSAppUsesNonExemptEncryption = false`. |
| **5.2** Марки | Иконата/името са собствени | В снимките и описанието — без Google, Android, Health Connect, други марки. |
| **ЕС DSA** | | В App Store Connect — статус **Trader**, публичен адрес/телефон/имейл на фирмата. |

---

## 3. Техническа адаптация

### 3.1 Проект и сборка
- Пакети: `@capacitor/ios@^8`, `@capacitor/keyboard`, `@capacitor-firebase/authentication` (Google + Apple нативно —
  замества `@codetrix-studio/capacitor-google-auth`, който е без поддръжка за iOS 17+), `@capgo/capacitor-health`
  (вече е в зависимостите — поддържа HealthKit).
- **Bundle ID:** `com.biocode.nutriplan` (същият като Android — по него се свързват акаунтите и Universal Links;
  в App Store името е Nutriin).
- `capacitor.config.json` → секция `ios`:
  `contentInset: "never"`, `scrollEnabled: true`, `backgroundColor: "#032E36"`, `preferredContentMode: "mobile"`,
  `limitsNavigationsToAppBoundDomains: false`, `webContentsDebuggingEnabled: false`;
  `StatusBar.overlaysWebView: true` **само за iOS** (страниците сами пазят safe area); `Keyboard.resize: "native"`,
  `Keyboard.resizeOnFullScreen: true`.
- Схемата на iOS е `capacitor://localhost` (не `https://localhost` като на Android) → одит на кода за
  `location.protocol === 'https:'`, `localhost` проверки, `sw.js` регистрация (Service Worker не работи в WKWebView на
  `capacitor://` — регистрацията се пропуска нативно). CORS в worker-а е `*` — ако някога се стесни, да включва
  `capacitor://localhost`.
- **Нов workflow `.github/workflows/build-ios.yml`** по модела на `studio-app-ios.yml` (същите секрети
  `APPLE_TEAM_ID`, `APPSTORE_KEY_ID`, `APPSTORE_ISSUER_ID`, `APPSTORE_KEY_P8`; runner macOS, най-новият стабилен Xcode —
  Apple приема само сборки с актуалния SDK):
  1. копира страниците в `ios-shell/` **по бял списък** (само файловете на Nutriin от CLAUDE.md), не по черен като
     APK-то — така pep*/reta/xbody/studio/emoeat-допълненията/IrisMap не попадат случайно в пакета;
  2. `test-ios-store-safe.mjs` (раздел 1.2);
  3. `npx cap add ios && npx cap sync ios`, копира `ios-res/` (Swift плъгини, `Info.plist` ключове, entitlements,
     PrivacyInfo, иконата, LaunchScreen);
  4. `xcodebuild archive` + качване в TestFlight; номер на сборката = `github.run_number`.
- Папка **`ios-res/`** (огледало на `android-res/`): `plugins/*.swift`, `patch-info-plist.py`, `App.entitlements`,
  `PrivacyInfo.xcprivacy`, `LaunchScreen.storyboard`.

### 3.2 Нативни плъгини — Android → iOS
| Android | Какво прави | iOS |
|---|---|---|
| `NutriStepsPlugin/Recording/Receiver` | крачкомер във фон | `NutriSteps.swift` с **CMPedometer** (история 7 дни, без фонов процес) + HealthKit за по-стари дни. Същият JS интерфейс → `activity-tracker.js` махa проверката `!== 'android'`. |
| Health Connect (`patch-health-connect.py`, `health-sync.js`) | сън, тегло, крачки | `@capgo/capacitor-health` → HealthKit, само **четене** на използваните типове. `health-sync.js`: `!== 'android'` → поддържани `android` и `ios`; текстовете „Health Connect“ → „Здраве (Apple Health)“ на iOS. |
| `NutriPrintPlugin` | печат/PDF на книгата на плана | `NutriPrint.swift` с `UIPrintInteractionController` (в него има „Запази във Файлове“ и споделяне). |
| `NutriSystemUiPlugin` | цвят на лентите | на iOS — само стил на статус лентата (светъл/тъмен); навигационна лента няма. |
| `NutriScreenPlugin` (`status`, `openSettings`) | разрешения и настройки | `NutriScreen.swift`: статус на разрешенията + `UIApplication.openSettingsURLString`. |
| `GameNotificationActionReceiver` | действия в известия | категории с действия през `LocalNotifications.registerActionTypes` (поддържа се на iOS). |
| `@capgo/capacitor-navigation-bar`, back бутон | Android | no-op на iOS (`platform.js` вече пази проверка — потвърждава се). |

`Info.plist` ключове (текстове на английски + bg/en/de/es/ru чрез `InfoPlist.strings`, конкретни, не общи):
`NSHealthShareUsageDescription`, `NSMotionUsageDescription`, `NSCameraUsageDescription`,
`NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` (запис на PDF/снимки),
`UISupportedInterfaceOrientations` = само Portrait, `UIRequiresFullScreen = YES`,
`ITSAppUsesNonExemptEncryption = NO`, `CFBundleDevelopmentRegion = bg`, `CFBundleLocalizations` = bg, en, de, es, ru.
Entitlements: HealthKit, Sign in with Apple, Associated Domains (`applinks:nutriin.app`).

### 3.3 Вход и данни
- Sign in with Apple + Google + имейл; бутонът на Apple — **пръв или равен** по размер и вид (Human Interface Guidelines).
- Firebase: включва се доставчикът Apple (Service ID, ключ). `auth-guard.js` — нативен вход през плъгина, после
  `signInWithCredential`.
- Резервно копие: на iOS — `native-backup.js` (Preferences) + сървърната синхронизация `plan-sync.js`. Google Drive
  копието (`drive.appdata`) не е нужно в първата версия на iOS.
- **Universal Links:** worker-ът (`app-domain.js`) сервира `https://nutriin.app/.well-known/apple-app-site-association`
  (`appID: <TEAMID>.com.biocode.nutriplan`, пътища за покани и писма) → връзките от писмата отварят приложението.

### 3.4 IrisMap, EmoEat, другите проекти
- IrisMap — не влиза (1.4.1). Входовете към него в `index.html`, `plan.html`, `profile.html` се скриват на iOS.
- EmoEat анализът (ако е достъпен от Nutriin) — остава само безплатната част, без цената 2,99 €.

---

## 4. Дизайн — „перфектно на iPhone“

Целта: да изглежда и да се усеща като родно iOS приложение, без да се губи „Светлина · Стъкло · Спокойствие“
(`DESIGN_PRINCIPLES.md`). Добра новина: визуалният език на iOS 26 (**Liquid Glass**) е много близо до нашия
`ambient-glass.css` — приложението ще изглежда „на място“ в системата.

### 4.1 Нов слой `ios.css` + клас `html.platform-ios`
Слага се от `platform.js` (по `Capacitor.getPlatform()`), зарежда се само там; токените остават в `design-system.css`.

1. **Safe area навсякъде.** Всички страници вече имат `viewport-fit=cover` и `env(safe-area-inset-*)` се ползва —
   одит екран по екран: горните ленти под Dynamic Island / прореза, долните ленти и листове над Home Indicator
   (`padding-bottom: max(16px, env(safe-area-inset-bottom))`), плаващите бутони, модалите (`np-lock-modal`,
   листовете в `app-ui.css`), `game-analytics`, `food-picker`, `plan-book`.
2. **Височина:** `100vh` → `100dvh`/`-webkit-fill-available` (на iOS `100vh` излиза под лентите).
3. **Клавиатура:** `@capacitor/keyboard` — полетата в чата и въпросника се превъртат над клавиатурата; лентата
   „Готово“ над клавиатурата (`Keyboard.setAccessoryBarVisible`). Всички полета ≥ **16px** шрифт — иначе Safari
   увеличава страницата при фокус.
4. **Жестове вместо „Назад“ на Android:** на iOS няма хардуерен бутон (`platform.js → backButton` не идва). Всеки екран
   и лист трябва да има видим бутон „Назад“/„Затвори“ горе вляво/вдясно; листовете се затварят и с плъзгане надолу;
   плъзгане от левия ръб за назад между страниците (`allowsBackForwardNavigationGestures` в нашия ViewController или
   собствен жест).
5. **Скрол и докосване:** без „ластик“ на целия екран там, където има фиксирани ленти (`overscroll-behavior: none` на
   `html`, ластик само в списъците); `-webkit-tap-highlight-color: transparent`; `-webkit-touch-callout: none` и
   `user-select: none` върху бутони/карти (не върху текст); минимална зона за докосване **44×44 pt** (HIG).
6. **Шрифт:** марковият шрифт остава; резервен `-apple-system, "SF Pro Text"`. Поддръжка на увеличен текст:
   размерите в `rem`, проверка при Настройки → Достъпност → По-голям текст (поне до XL без счупени карти).
7. **Стъкло и производителност:** `backdrop-filter` е тежък на iPhone XR/11/SE — `@supports` + по-малко слоеве в
   `html.platform-ios.low-power`; `@media (prefers-reduced-transparency: reduce)` → плътни повърхности;
   `prefers-reduced-motion` → без движения на фона.
8. **Тъмен режим:** следва системата (`prefers-color-scheme`), статус лентата сменя стила заедно с темата (вече има
   логика в `app.js` — пренася се към `StatusBar.setStyle` на iOS).
9. **Haptics:** леки (`impact light`) при отметка на хранене, успех при завършен ден, без вибрация при всяко докосване.
10. **Иконата и стартът:** `npm run build:brand` генерира и `AppIcon-1024.png` (**без прозрачност** — Apple го отказва),
    плюс варианти за тъмна и „оцветена“ икона (iOS 18+). LaunchScreen в цвета `#032E36` с ябълката — плавно преминава
    в уеб стартовия екран, както на Android.
11. **Системни листове:** споделяне (`@capacitor/share`), избор на снимка, печат — родните на iOS, не уеб имитации.

### 4.2 Размери за тест (точки, ширина × височина)
| Група | Модели | Особеност |
|---|---|---|
| 375 × 667 | iPhone SE 2/3, 8 | бутон Home, **без** прорез, най-малкият екран — най-много счупвания |
| 375 × 812 | 12 mini, 13 mini, X/XS, 11 Pro | прорез |
| 390 × 844 | 12, 13, 14, 16e | прорез |
| 393 × 852 / 402 × 874 | 14 Pro, 15, 16, 16 Pro, 17, 17 Pro | Dynamic Island |
| 420 × 912 | iPhone Air | Dynamic Island, тесен-висок |
| 414 × 896 / 428 × 926 | XR, 11, 11 Pro Max, 12/13 Pro Max, 14 Plus | |
| 430 × 932 / 440 × 956 | 15/16 Plus, 15/16 Pro Max, 17 Pro Max | най-големите |
| iPad (режим iPhone) | ревюиращите понякога пускат на iPad | да не е счупено в увеличен iPhone режим |

Проверка: **автоматични снимки с Playwright (WebKit)** на всички екрани за всяка ширина, светла/тъмна тема и 5-те
езика (`scripts/ios-screens.mjs`) + ръчен тест в Xcode Simulator (SE, 16e, 17 Pro, 17 Pro Max) и на поне 2 истински
iPhone през TestFlight. iOS версии: 16 (най-старата), 18, 26 (текущата) и следващата бета.

---

## 5. Политика за поверителност и условия

`privacy-policy.html` и `terms.html` получават раздели (на всички 5 езика), без да се пипа адресът:
1. **Приложението за iPhone:** какво събира, че не продава нищо в приложението, че плащания не се правят през него.
2. **Apple Health (HealthKit):** кои типове се четат, защо, че не се ползват за реклама, не се дават на трети страни
   освен за изготвяне на плана (AI доставчиците), не се пазят в iCloud; изключване от Настройки → Здраве.
3. **AI доставчици** — поименно: Google (Gemini), OpenAI, Anthropic; какви данни; правно основание (съгласие); срок.
4. **Sign in with Apple** — скрит имейл, отмяна при изтриване.
5. **Изтриване на данните** — пътят в приложението + `delete-account.html`.
6. **Деца** — приложението не е за лица под прага от условията.
7. **Без проследяване и реклами.**
8. **Условия:** собствени условия + задължителните минимални клаузи на Apple за EULA (или стандартният Apple EULA);
   в iOS вариантa — без раздела за цени и плащане (той е за сайта).

**App Privacy (App Store Connect):** Health & Fitness (Health, Fitness), Contact Info (Name, Email), User Content
(Photos, Other — документи и дневник), Sensitive Info (здравни състояния), Identifiers (User ID), Diagnostics — само ако
реално се събират. Всичко — *App Functionality*, *Linked to user*: Yes, *Tracking*: **No**.

---

## 6. App Store Connect — метаданни
- **Име:** Nutriin · **Подзаглавие:** напр. „Personal meal plan & habits“ · **Категория:** Health & Fitness
  (вторична Food & Drink) · **Цена:** Free · **In-App Purchases:** няма.
- **Езици на страницата:** English (основен), German, Spanish, Russian + Bulgarian, ако App Store Connect вече го
  предлага (провери при създаване; ако не — описанието казва, че приложението е и на български).
- Описание, ключови думи и снимки — **без цени, без „premium“, без „план за 4/12 седмици“, без Android/Google Play**.
- **Privacy Policy URL:** `https://nutriin.app/privacy-policy.html` · **Support URL:** `https://nutriin.app/help.html`
  (с работещ имейл за контакт, на който се отговаря).
- **Снимки:** 6.9" (1320 × 2868) — задължителни; 6.5" (1284 × 2778) — по желание. 5–8 кадъра от реалното приложение
  (TestFlight, демо акаунт): денят в плана, напредък, награди, въпросник, крачки/Health, асистент. Без рамки на чужди
  марки. По желание — 15–30 сек. видео.
- **App Review Information:** демо акаунт (имейл + парола, **без** нужда от Apple/Google вход), с готов план и
  отключени функции; бележките от 1.3 + стъпки за тест + кратко видео (интерфейсът е на български — по подразбиране
  приложението може да тръгне на английски за ревюиращия, i18n го поддържа).

---

## 7. Етапи и срокове (ориентировъчно)

| # | Етап | Резултат | ~Време |
|---|---|---|---|
| 0 | Организация: D-U-N-S, Apple Developer (Organization), DSA Trader, App ID, Sign in with Apple, HealthKit, API ключ | акаунт и секрети в GitHub | 1–3 седм. (паралелно) |
| 1 | `build-ios.yml` + бял списък + `ios-res/` + първа празна сборка в TestFlight | приложението се отваря на iPhone | 3–4 дни |
| 2 | Плащания/текстове: `isStoreRestricted`, почистване, `test-ios-store-safe` | нула цени в пакета | 3–4 дни |
| 3 | Вход: Firebase плъгин, Sign in with Apple, отмяна при изтриване | вход и изтриване работят | 3–5 дни |
| 4 | Нативни: NutriSteps, HealthKit, NutriPrint, NutriScreen, известия с действия, Universal Links | функционален паритет с APK | 1–1,5 седм. |
| 5 | Дизайн: `ios.css`, safe area, клавиатура, жестове, икона, LaunchScreen, снимки по всички ширини | визуален одит без забележки | 1,5–2 седм. |
| 6 | Политика: AI съгласие, privacy/terms (5 езика), PrivacyInfo, App Privacy | правна част готова | 3–5 дни |
| 7 | TestFlight с вътрешни тестери (5–10 човека, различни iPhone) + поправки | стабилна версия | 1–2 седм. |
| 8 | Метаданни, снимки, демо акаунт, подаване | в ревю | 2–3 дни |

Общо: **~6–8 седмици работа** + времето за фирмения акаунт. Ревюто обикновено е 1–3 дни.

---

## 8. Проверка преди „Submit for Review“
- [ ] `test-ios-store-safe` зелен; ръчно търсене за „€“ в приложението — няма.
- [ ] Безплатен акаунт: няма катинари, които водят към покупка; всичко видимо работи.
- [ ] Демо акаунтът влиза, планът е готов, AI отговаря.
- [ ] Sign in with Apple работи (вкл. скрит имейл получава писмото за вход/потвърждение).
- [ ] Изтриване на профила от приложението + токенът на Apple се отменя.
- [ ] AI съгласието се пита преди първата AI заявка; „Не сега“ не чупи приложението.
- [ ] HealthKit, движение, камера, снимки, известия — пита се **в момента на нужда**, с ясен текст; отказът не чупи нищо.
- [ ] Няма APK бутон, IrisMap, админ, бета отключване, изход от приложението.
- [ ] Работи без мрежа при старт (страниците и Firebase са в пакета).
- [ ] Снимките на всички ширини (раздел 4.2) — без застъпвания под Dynamic Island / Home Indicator; SE без счупени
      карти; светла и тъмна тема; 5 езика; „По-голям текст“.
- [ ] `PrivacyInfo.xcprivacy` в пакета; `ITSAppUsesNonExemptEncryption = NO`.
- [ ] Privacy/Support URL отварят на nutriin.app; имейлът за поддръжка е реален.
- [ ] Метаданни без цени, без Android, без медицински обещания.

## 9. Какво се сверява точно преди подаване (правилата се движат)
- Актуалните App Review Guidelines (особено 3.1.1, 3.1.3, 5.1.2(i)): https://developer.apple.com/app-store/review/guidelines/
- Условията за ЕС (Attachment 14, от 1.10.2026): https://developer.apple.com/support/communication-and-promotion-of-offers-on-the-app-store-in-the-eu/
- Изискването за версия на Xcode/SDK при качване и минималната iOS версия на Capacitor 8.
- Дали Bulgarian е добавен като език на страницата в App Store.
