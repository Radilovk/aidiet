# Съвместимост на Известията с Различни Платформи

## Обобщение

Системата за известия на NutriPlan използва Web Notification API и Service Workers. Поддръжката варира значително между различни платформи и операционни системи.

## Таблица на Съвместимост

| Платформа | Push Notifications | Local Notifications | PWA Изискване | Статус | Бележки |
|-----------|-------------------|---------------------|---------------|--------|---------|
| **Android Chrome** | ✅ Пълна поддръжка | ✅ Работи | ❌ Не | ✅ **РАБОТИ** | Най-добра поддръжка |
| **Android Firefox** | ✅ Пълна поддръжка | ✅ Работи | ❌ Не | ✅ **РАБОТИ** | Отлична поддръжка |
| **Android Samsung Internet** | ✅ Пълна поддръжка | ✅ Работи | ❌ Не | ✅ **РАБОТИ** | Пълна поддръжка |
| **iOS Safari 16.4+** | ⚠️ Ограничена | ⚠️ Ограничена | ✅ ДА | ⚠️ **ОГРАНИЧЕНА** | Само като PWA |
| **iOS Chrome/Firefox** | ❌ Не работи | ❌ Не работи | N/A | ❌ **НЕ РАБОТИ** | Използва Safari engine |
| **Huawei (нови модели)** | ❌ Няма поддръжка | ❌ Няма поддръжка | N/A | ❌ **НЕ РАБОТИ** | Няма Google Services |
| **Desktop Chrome** | ✅ Пълна поддръжка | ✅ Работи | ❌ Не | ✅ **РАБОТИ** | Отлична поддръжка |
| **Desktop Firefox** | ✅ Пълна поддръжка | ✅ Работи | ❌ Не | ✅ **РАБОТИ** | Отлична поддръжка |
| **Desktop Safari** | ⚠️ Ограничена | ⚠️ Ограничена | ❌ Не | ⚠️ **ОГРАНИЧЕНА** | От Safari 16+ |
| **Desktop Edge** | ✅ Пълна поддръжка | ✅ Работи | ❌ Не | ✅ **РАБОТИ** | Chromium-based |

## Детайлна Информация по Платформи

### Android

#### ✅ Chrome (Препоръчително)
- **Статус:** Напълно функционални
- **Версия:** Chrome 42+
- **Функции:**
  - ✅ Push notifications от сървъра
  - ✅ Локални известия
  - ✅ Background notifications
  - ✅ Vibration API
  - ✅ Notification actions
- **Забележки:** Най-добрата платформа за известия

#### ✅ Firefox
- **Статус:** Напълно функционални
- **Версия:** Firefox 44+
- **Функции:** Същите като Chrome
- **Забележки:** Отлична алтернатива

#### ✅ Samsung Internet
- **Статус:** Напълно функционални
- **Версия:** Samsung Internet 4.0+
- **Функции:** Пълна поддръжка
- **Забележки:** Предварително инсталиран на Samsung устройства

### iOS

#### ⚠️ Safari 16.4+ (Ограничена Поддръжка)
- **Статус:** Работи САМО като PWA
- **Версия:** iOS 16.4+ (Април 2023)
- **Изисквания:**
  1. Трябва да се добави към Home Screen
  2. Отваря се от Home Screen (не от Safari)
  3. Permissions се дават след добавяне
  
**Как да инсталирате PWA на iOS:**
```
1. Отворете сайта в Safari
2. Натиснете бутона Share (квадратче със стрелка)
3. Scroll down и изберете "Add to Home Screen"
4. Дайте име и натиснете "Add"
5. Отворете приложението от Home Screen
6. Разрешете известия когато се покаже prompt
```

**Ограничения на iOS:**
- ❌ Не работи в Safari browser (само PWA)
- ❌ Не работи в Chrome/Firefox на iOS (използват Safari engine)
- ⚠️ Background notifications ограничени
- ⚠️ setTimeout може да спре в background
- ⚠️ Notification permissions важат само за PWA

**Workarounds за iOS:**
1. Инсталирайте като PWA (единственият начин)
2. Използвайте iOS Calendar за напомняния
3. Добавете manual reminders в iOS Reminders app

#### ❌ Chrome/Firefox на iOS
- **Статус:** НЕ РАБОТИ
- **Причина:** Apple изисква всички браузъри да използват Safari rendering engine
- **Решение:** Използвайте Safari и инсталирайте като PWA

### Huawei

#### ❌ Нови модели (без Google Services)
- **Статус:** НЕ РАБОТИ
- **Причина:** 
  - Няма Google Play Services
  - Няма стандартен Web Push
  - HMS (Huawei Mobile Services) не поддържа Web Push
- **Засегнати модели:** 
  - Huawei P40/P50/Mate 40+ серии
  - Honor 30+ серии (някои модели)
  - Устройства с HarmonyOS

**Алтернативни Решения за Huawei:**
1. **Използвайте Calendar App**
   - Създайте напомняния в Huawei Calendar
   - Задайте повтарящи се събития
   
2. **Използвайте Clock/Alarm App**
   - Задайте множество alarm-и за деня
   - Наименувайте ги според типа (храна, вода, и т.н.)

3. **Third-party Apps**
   - Google Calendar (ако имате HMS Core)
   - Други reminder apps от AppGallery

### Desktop

#### ✅ Chrome/Edge (Chromium)
- **Статус:** Напълно функционални
- **Версия:** Chrome 42+, Edge 79+
- **Функции:** Всички налични
- **Забележки:** Отлична поддръжка

#### ✅ Firefox
- **Статус:** Напълно функционални
- **Версия:** Firefox 44+
- **Функции:** Всички налични
- **Забележки:** Много добра поддръжка

#### ⚠️ Safari
- **Статус:** Ограничена поддръжка
- **Версия:** Safari 16+ (macOS Ventura+)
- **Функции:** Основни известия работят
- **Ограничения:** Някои advanced функции липсват

## Технически Детайли

### Използвани API-та

1. **Notification API**
   ```javascript
   new Notification(title, options)
   ```
   - Използва се за локални известия
   - Работи на повечето платформи
   - Изисква permission

2. **Service Worker Notifications**
   ```javascript
   registration.showNotification(title, options)
   ```
   - По-добра поддръжка на iOS
   - Background persistence
   - Препоръчително за PWA

3. **Push API**
   ```javascript
   registration.pushManager.subscribe(options)
   ```
   - За server-push notifications
   - VAPID authentication
   - Не работи на iOS Safari/Huawei

### Detection Code

Приложението автоматично засича платформата:

```javascript
const PlatformDetector = {
    isIOS: () => /iPhone|iPad|iPod/i.test(navigator.userAgent),
    isAndroid: () => /Android/i.test(navigator.userAgent),
    isHuawei: () => /huawei|harmony/i.test(navigator.userAgent),
    isPWA: () => window.matchMedia('(display-mode: standalone)').matches,
    supportsNotifications: () => 'Notification' in window && 'serviceWorker' in navigator
};
```

## Препоръки за Потребители

### За Android Потребители
✅ **Просто използвайте приложението**
- Работи директно в браузъра
- Препоръчително: Chrome или Firefox
- Не е нужна инсталация (но можете)

### За iOS Потребители
⚠️ **ВАЖНО: Трябва да инсталирате като PWA**

**Стъпки:**
1. Отворете в Safari (НЕ Chrome/Firefox)
2. Share → Add to Home Screen
3. Отворете от Home Screen
4. Разрешете известия

**Ако не инсталирате:**
- ❌ Известия НЯМА да работят
- ℹ️ Използвайте iOS Calendar вместо това

### За Huawei Потребители
❌ **Уеб известия не са поддържани**

**Алтернативи:**
1. Huawei Calendar - създайте recurring events
2. Alarm app - задайте множество alarms
3. Reminders app - manual reminders

## Troubleshooting

### Известия не се показват

#### На Android
1. Проверете permissions: Settings → Apps → [Browser] → Notifications
2. Уверете се че браузърът има permission
3. Проверете Do Not Disturb mode
4. Try clearing browser cache

#### На iOS
1. Сигурни ли сте че е инсталирано като PWA?
2. Отваряте ли от Home Screen (не Safari)?
3. Settings → [App Name] → Notifications → Allow
4. Проверете Focus/Do Not Disturb

#### На Desktop
1. Проверете browser notification settings
2. Check operating system notification settings
3. Ensure page has notification permission
4. Try re-granting permission

### Background Notifications не работят

#### iOS
- **Нормално:** iOS ограничава background execution
- **Решение:** Отваряйте приложението периодично

#### Android
- **Причини:** Battery optimization, Doze mode
- **Решение:** Settings → Apps → [Browser] → Battery → Unrestricted

## Roadmap

### Планирани Подобрения

- [ ] **iOS Push Notifications**
  - Имплементация на Apple Push Notification Service
  - Изисква native wrapper или PWA bridge

- [ ] **Huawei Push Kit Integration**
  - Специална имплементация за Huawei
  - Изисква HMS Core SDK

- [ ] **Calendar Integration**
  - Export reminders to calendar
  - iCal format support

- [ ] **Alternative Reminder Methods**
  - Email reminders
  - SMS reminders (optional)
  - Telegram bot integration

## Заключение

### Какво Работи Добре
✅ Android (всички major браузъри)
✅ Desktop (Chrome, Firefox, Edge)
⚠️ iOS (само като PWA в Safari)

### Какво НЕ Работи
❌ iOS браузъри (без PWA инсталация)
❌ Huawei нови устройства
❌ Старите браузъри (<2015)

### Обща Препоръка

**Android:** Използвайте Chrome/Firefox - всичко работи
**iOS:** Инсталирайте като PWA в Safari - единственият начин
**Huawei:** Използвайте Huawei Calendar - уеб известия не работят
**Desktop:** Всички модерни браузъри работят отлично

---

*Последна актуализация: Февруари 2026*
*Версия: 1.0*
