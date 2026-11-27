# Nutriin в App Store — подаването (за копиране)

Приложението за iPhone е **клиентско**: вход към профил, създаден на сайта (IOS_APP_STORE_PLAN.md, „Клиентският режим“).
Сборката: Actions → „Nutriin — iOS (TestFlight)“. Страниците се обновяват отвътре (publish-ios-web.yml) — нова версия в
App Store е нужна само при промяна на нативната част (плъгини, разрешения, иконата).

Правилата се променят — точно преди „Submit for Review“ прегледай https://developer.apple.com/app-store/review/guidelines/
(3.1.1, 3.1.3, 4.2, 5.1.1, 5.1.2(i), 5.1.3). 100% гаранция за одобрение няма; тук са известните причини за отказ.

## 1. Еднократно в App Store Connect
1. **My Apps → + → New App:** iOS · Name `Nutriin` (ако е заето: `Nutriin – Meal Plan`; името под иконата пак е
   „Nutriin“) · Primary language **English (U.S.)** · Bundle ID `com.biocode.nutriplan` · SKU `nutriin-1` · User Access: Full.
2. **Business → Digital Services Act:** статусът Trader вече е обявен за акаунта (от XB-Studio) — провери, че е активен.
3. **Pricing and Availability:** Free · всички държави (или само ЕС + България за начало).
4. **App Privacy → Privacy Policy URL:** `https://nutriin.app/privacy-policy.html`.

## 2. Страницата (English)
- **Name:** Nutriin
- **Subtitle (≤30):** `Your meal plan, day by day`
- **Category:** Health & Fitness · Secondary: Food & Drink
- **Promotional text (≤170):** `Your personal Nutriin plan in your pocket: today's meals, simple check-offs, gentle reminders and progress — synced with Apple Health.`
- **Description:**
```
Nutriin is the companion app for your Nutriin account. Sign in with your profile to follow your personal meal plan every day.

• Today's meals with recipes, portions and easy swaps
• Check off meals, water and movement in a tap
• Gentle reminders for meals and your evening check-in (works offline)
• Progress over the weeks: consistency, weight trend and the changes that matter for your goal
• Rewards for consistency
• Apple Health: steps, sleep, weight and heart rate from your iPhone and Apple Watch keep your daily goals realistic (optional, read-only)
• Ask the assistant about your plan or snap a photo of your plate (with your permission; powered by AI)
• Save your plan as a PDF

An account is required. Nutriin provides general nutrition and lifestyle guidance. It is not a medical service and does not diagnose or treat any condition — talk to your doctor before changing your diet if you have a health condition, are pregnant or take medication.

The app is available in English, Bulgarian, German, Spanish and Russian.
```
- **Keywords (≤100):** `meal plan,nutrition,healthy eating,habits,food diary,meal reminders,recipes,wellness,apple health`
- **Support URL:** `https://nutriin.app/help.html` · **Marketing URL:** `https://nutriin.app/`
- **Copyright:** `2026 Biocode` (или твоето име, както е в акаунта)
- **Version / What's New:** `First version.`
- Без цени, „premium“, „plan for 4/12 weeks“, Android/Google Play, имена на заболявания, „detox“, „clinical“.

## 3. App Privacy (въпросникът)
*Do you or your third-party partners collect data from this app?* **Yes.** За всеки тип: **App Functionality**, **Linked to
the user: Yes**, **Used for tracking: No**.

| Категория → тип | Защо |
|---|---|
| Contact Info → Name, Email Address | профилът и входът |
| Health & Fitness → Health, Fitness | профилът за плана; Apple Health (по избор) |
| User Content → Photos or Videos | снимка на чинията (по избор) |
| User Content → Other User Content | въпросите към асистента, отметките, дневника |
| Identifiers → User ID | профилът |

Не се събират: местоположение, контакти, история на браузване/търсене, покупки, финансови данни, диагностика,
реклама. **Tracking: No** (няма реклама и проследяване; не е нужен App Tracking Transparency).

## 4. Възрастова оценка (въпросникът от 2025 г.)
Отговори честно: насилие, хазарт, секс, нецензурни думи — **None**. *Medical or Treatment Information* — **Infrequent**
(общи хранителни насоки, не лечение). *Health or Wellness Topics* — **Yes**. *Unrestricted Web Access* — **No**.
*User-Generated Content / Messaging* — **No** (асистентът е AI, не други хора). Резултатът обикновено е 13+.
Ако `terms.html` иска 18+, избери и в App Store по-високата възраст (Age Rating → Override).

## 5. Демо акаунт за ревюиращия (задължително)
1. На **сайта** (не в приложението) попълни въпросника с имейл, който четеш, напр. `appreview@nutriin.app`:
   профил **без** заболявания и лекарства, възраст 25–60 (иначе планът чака нутриционист). Задай парола.
2. Изчакай плана (до няколко минути; при рисков профил — активирай го от админа).
3. Админ → Достъп → този профил → ниво **core** с краен срок след 3 месеца (асистентът, снимката и цялата седмица
   да са отключени за ревюто).
4. Влез с него в TestFlight версията, отметни 2–3 хранения, отвори Напредък — да има какво да се види.
5. **Не го пипай, докато приложението е в ревю.**

## 6. App Review Information → Notes (English, copy/paste)
```
Nutriin is the companion app for an existing Nutriin account. Accounts and personal meal plans are created on our
website; the app is where customers follow their plan day to day. No digital goods, subscriptions or upgrades are
sold or advertised in the app, and the app contains no links or calls to action to purchase elsewhere (Guidelines
3.1.1, 3.1.3(f)).

Demo account:  appreview@nutriin.app  /  <password>

How to test:
1. Sign in with the demo account. You land on today's plan.
2. Tap a meal to see the recipe; check it off. Use "Swap" to change a meal.
3. Progress: weekly consistency and trend. Profile: account details, "Devices", "Delete account".
4. Apple Health (optional): Profile → Devices → "Connect Apple Health". Read-only: steps, sleep, weight, heart rate,
   workouts. The data adjusts daily activity and sleep guidance in the plan; it is never used for advertising, never
   written to Health and never stored in iCloud (Guideline 5.1.3).
5. AI features (assistant, plate photo): before any personal data is sent, the app shows "How Nutriin uses AI"
   naming the providers (Google Gemini, OpenAI, Anthropic) and asks for explicit permission; "Not now" keeps the rest
   of the app working (Guideline 5.1.2(i)).
6. Notifications are local reminders for the user's own meals and check-ins; the app works without them.
7. Account deletion: Profile → "Delete account" (Guideline 5.1.1(v)).

Nutriin provides general nutrition guidance, not medical advice; plans for people with health conditions are reviewed
by a nutritionist from our team before they are shown. The interface is in English and Bulgarian (the language
switch is in the menu).
Contact: <твоят имейл>
```
Прикачи и кратко видео (екранен запис 40–60 с: вход → денят → отметка → Напредък → Apple Health → изтриване).

## 7. Снимки (Screenshots)
- **6.9"** (iPhone 16/17 Pro Max) 1320×2868 — задължителни; 5–8 кадъра от TestFlight с демо акаунта:
  денят в плана, рецепта, Напредък, награди, Apple Health в Устройства, асистентът.
- Без чужди марки в рамката, без цени, без медицински твърдения в надписите.
- Ако снимаш на по-малък iPhone: `convert shot.png -resize 1320x -background "#032E36" -gravity center -extent 1320x2868 out.png`.

## 8. Преди „Submit for Review“
- [ ] Сборката от TestFlight е тествана на истински iPhone: вход, денят, отметки, известие, Apple Health, PDF,
      асистентът (листът за AI), изтриване на профила, тъмна тема, iPhone SE (малък екран).
- [ ] `publish-ios-web.yml` е публикувал пакет и приложението го е взело (Профил → долу версията на страниците не е нужна —
      провери, че промяна по текст стига до телефона след второ отваряне).
- [ ] Демо акаунтът работи и е с ниво core.
- [ ] Worker-ът е публикуван (план веднага, `/api/app/web-bundle`).
- [ ] `https://nutriin.app/.well-known/apple-app-site-association` съдържа `com.biocode.nutriplan`.
- [ ] Privacy и Support адресите се отварят.
- [ ] Метаданните са без цени, без Android, без медицински обещания.

## 9. Ако дойде отказ
- **3.1.1 (покупки):** отговор в Resolution Center: „companion app for an existing account; nothing is sold or
  advertised in the app; no links to purchase“. Резерв: покупка в приложението (план Б в IOS_APP_STORE_PLAN.md).
- **4.2 (минимална функционалност):** изброй нативното: Apple Health, локални известия, офлайн план, PDF/печат,
  камера, haptics.
- **5.1.1(v) (вход без регистрация в приложението):** клиентското приложение за услуга, ползвана извън него —
  същото като приложенията на треньори, клиники и фитнеси; профилът се създава при доставчика.
- **5.1.1(ix) (регулирана област):** уелнес/хранене, не здравеопазване; при настояване — прехвърляне към фирмен акаунт.
