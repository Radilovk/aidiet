# 🔔 Notifications Troubleshooting - Решаване на Проблеми

## 🚨 Често Срещани Проблеми

### 1. Notifications Не Се Показват

#### ✅ Checklist
```javascript
// 1. Permission granted?
console.log(Notification.permission)  // "granted"

// 2. Service Worker active?
navigator.serviceWorker.ready.then(reg =>
  console.log('SW:', reg.active ? '✅' : '❌')
)

// 3. Push subscription exists?
navigator.serviceWorker.ready.then(reg =>
  reg.pushManager.getSubscription().then(sub =>
    console.log('Subscription:', sub ? '✅' : '❌')
  )
)

// 4. User ID exists?
console.log('User ID:', localStorage.getItem('userId'))
```

#### 🔧 Решения
| Проблем | Решение |
|---------|---------|
| Permission = "default" | Презаредете страницата, разрешете when prompted |
| Permission = "denied" | Browser settings → Site settings → Notifications → Allow |
| No Service Worker | Проверете console за errors, регистрирайте SW отново |
| No subscription | Викнете `subscribeToPushNotifications()` |
| No user ID | Generate нов: `localStorage.setItem('userId', 'user_' + Date.now())` |

---

### 2. Background Notifications Не Работят

#### Причини
- ❌ Cron trigger не е активен
- ❌ VAPID keys липсват/грешни
- ❌ User preferences не са sync-нати
- ❌ Service Worker не работи в background

#### Решения

**A. Проверка на Cron**
```bash
# 1. Check Cloudflare Dashboard
# Workers → aidiet-worker → Triggers → Cron

# 2. Check logs
wrangler tail

# Трябва да видите на всеки час:
# [Cron] Running scheduled notifications check
```

**B. Проверка на VAPID**
```bash
wrangler secret list
# Трябва да показва:
# - VAPID_PUBLIC_KEY
# - VAPID_PRIVATE_KEY
```

**C. Force Sync Preferences**
```javascript
// Browser console
const userId = localStorage.getItem('userId');
const prefs = JSON.parse(localStorage.getItem('notificationPreferences'));

fetch('https://aidiet.radilov-k.workers.dev/api/user/notification-preferences', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({userId, preferences: prefs})
}).then(r => r.json()).then(console.log)
```

---

### 3. Notifications Нямат Текст

#### Симптоми
- Title се показва ✅
- Body е празен ❌

#### Причини & Решения

**Проблем:** Service Worker не извлича body от payload
```javascript
// sw.js - проверете:
const notificationData = await event.data.json();
console.log('Notification data:', notificationData);
// Трябва да има: {title, body, icon, notificationType}
```

**Решение:**
```javascript
// Уверете се че showNotification използва правилно body:
self.registration.showNotification(title, {
  body: notificationData.body || 'Default body',  // ✅
  icon: notificationData.icon,
  // ...
})
```

---

### 4. Huawei Devices - Notifications Не Работят

#### Проверка за microG

**Test 1: Google Services**
```
Settings → Apps → microG Settings
  → Google device registration: ✅ Should be ON
  → Cloud Messaging: ✅ Should be ON
```

**Test 2: Battery Optimization**
```
Settings → Battery → App launch
  → Browser (Chrome/Firefox): Manual manage
  → Disable: Auto-launch, Secondary launch, Run in background
```

**Test 3: Push Service**
```javascript
// Browser console
navigator.serviceWorker.ready.then(reg =>
  reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: /* VAPID key */
  }).then(
    sub => console.log('✅ Push works!'),
    err => console.log('❌ Push failed:', err)
  )
)
```

#### Ако microG Не Работи

**Fallback 1: Calendar Export**
1. Отворете приложението
2. Кликнете "Експортирай в Календар"
3. Import `.ics` в Huawei Calendar
4. ✅ Calendar reminders ще работят

**Fallback 2: Manual Alarms**
```
Clock App → Create Alarms:
- 08:00 - Закуска 🍳
- 10:00 - Вода 💧
- 12:00 - Вода 💧
- 13:00 - Обяд 🥗
- 14:00 - Вода 💧
- 16:00 - Вода 💧
- 18:00 - Вода 💧
- 19:00 - Вечеря 🍽️
- 20:00 - Вода 💧
- 22:00 - Сън 😴
```

---

### 5. iOS Safari - Notifications Не Работят

#### Изисквания за iOS
- ✅ PWA трябва да е инсталирано (Add to Home Screen)
- ✅ Само Safari (не Chrome/Firefox)
- ✅ iOS 16.4+ за Web Push support
- ✅ Отворено от Home Screen

#### Стъпки за iOS

**1. Инсталирай като PWA**
```
Safari → Share (квадрат със стрелка)
  → Add to Home Screen
  → Add
```

**2. Отвори от Home Screen**
```
Home Screen → NutriPlan icon
  → NOT from Safari!
```

**3. Разреши Notifications**
```
When prompted: Allow
```

**4. Провери**
```javascript
// В PWA (opened from Home Screen)
console.log('Standalone:', window.navigator.standalone)  // true
console.log('Permission:', Notification.permission)      // granted
```

---

### 6. Cron Timing Issues

#### Проблем: Notification идва в грешно време

**Причина:** Time zone mismatch

**Check Server Time:**
```javascript
// worker.js logs show:
const now = new Date();
console.log('Server time:', now.toISOString());
// Server е в UTC!
```

**Решение:**
```javascript
// Adjust meal times for UTC
// Ако искате notification в 08:00 Sofia time (UTC+2):
// Set meal time = 06:00 (UTC)
```

**Алтернатива:** Преобразувайте в user's timezone на frontend:
```javascript
const localTime = new Date().toLocaleTimeString('bg-BG', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Sofia'
})
```

---

### 7. Too Many/Too Few Notifications

#### Проблем: Дубликати

**Причина:** Multiple subscriptions за same user

**Check:**
```javascript
// Browser console
navigator.serviceWorker.ready.then(reg =>
  reg.pushManager.getSubscription().then(sub => {
    console.log('Endpoint:', sub.endpoint)
    // Трябва да има само 1 subscription per device
  })
)
```

**Решение:**
```javascript
// Unsubscribe и re-subscribe
navigator.serviceWorker.ready.then(reg =>
  reg.pushManager.getSubscription().then(sub =>
    sub.unsubscribe()
  ).then(() =>
    // Re-subscribe...
  )
)
```

#### Проблем: Липсващи notifications

**Check Preferences:**
```javascript
const prefs = JSON.parse(localStorage.getItem('notificationPreferences'))
console.log('Enabled:', prefs.enabled)          // true?
console.log('Meals:', prefs.meals.enabled)      // true?
console.log('Water:', prefs.water.enabled)      // true?
```

**Sync to Backend:**
```javascript
// Force sync
await fetch('/api/user/notification-preferences', {
  method: 'POST',
  body: JSON.stringify({
    userId: localStorage.getItem('userId'),
    preferences: prefs
  })
})
```

---

## 🔍 Debug Commands

### Frontend Debugging
```javascript
// 1. Check all notification state
console.log({
  permission: Notification.permission,
  userId: localStorage.getItem('userId'),
  preferences: localStorage.getItem('notificationPreferences'),
  swRegistration: await navigator.serviceWorker.ready,
  subscription: await (await navigator.serviceWorker.ready)
    .pushManager.getSubscription()
})

// 2. Test local notification
new Notification('Test', {
  body: 'Local notification test',
  icon: '/icon-192x192.png'
})

// 3. Test SW notification
navigator.serviceWorker.ready.then(reg =>
  reg.showNotification('SW Test', {
    body: 'Service Worker notification test'
  })
)
```

### Backend Debugging
```bash
# 1. Check logs
wrangler tail

# 2. Check KV data
wrangler kv:key get --binding=page_content "push_subscriptions_list"
wrangler kv:key get --binding=page_content "notification_preferences_USER_ID"
wrangler kv:key get --binding=page_content "global_notification_settings"

# 3. Manual trigger cron (requires wrangler dev)
wrangler dev --test-scheduled
```

---

## 📊 Diagnostic Logs

### Expected Logs (Success)

**Browser Console:**
```
[Notifications] Initializing client-side notification scheduler
[Notifications] Platform: Android
[Notifications] Support: Yes
[Notifications] Permission granted, scheduling notifications...
[Notifications] Meal notifications scheduled
[Notifications] Water notifications scheduled
[Notifications] Scheduled 15 notifications
[Notifications] Preferences synced to backend successfully
```

**Cloudflare Logs (wrangler tail):**
```
[Cron] Running scheduled notifications check
[Cron] Checking notifications for 5 users at 08:00
[Cron] Sending breakfast reminder to user user_123
[Cron] Push notification sent successfully to user user_123
[Cron] Scheduled notifications check completed
```

---

## ⚡ Quick Fixes

| Issue | Quick Fix |
|-------|-----------|
| "Permission denied" | Clear site data, reload, allow when prompted |
| "No subscription" | Run `subscribeToPushNotifications()` in console |
| "VAPID not configured" | `wrangler secret put VAPID_PUBLIC_KEY` |
| "Cron not running" | Check Cloudflare Dashboard → Triggers |
| "iOS не работи" | Install as PWA, open from Home Screen |
| "Huawei не работи" | Use Calendar export (.ics) |
| "Wrong time" | Check timezone, adjust meal times for UTC |

---

## 📞 Support Resources

- **Technical Docs:** `NOTIFICATION_SYSTEM_FIX_2026-02-17.md`
- **Deployment:** `NOTIFICATION_FIX_DEPLOYMENT_BG.md`
- **Quick Ref:** `PUSH_NOTIFICATIONS_QUICK_REFERENCE_BG.md`
- **Summary:** `РЕЗЮМЕ_ПОПРАВКА_ИЗВЕСТИЯ_BG.md`

---

**Последна актуализация:** 2026-02-17  
**Статус:** ✅ Production Ready
