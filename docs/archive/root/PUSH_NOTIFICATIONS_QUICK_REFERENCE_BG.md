# 🔔 Push Notifications - Бърза Справка

## 📋 Какво Е Поправено

✅ **Background notifications** - Работят дори при затворено приложение  
✅ **Notification текст** - Пълен title + body съдържание  
✅ **Надеждна доставка** - Чрез Cloudflare Workers cron triggers  

---

## ⚡ Бързо Внедряване (5 минути)

### 1. Проверка на VAPID Keys
```bash
wrangler secret list
```

Трябва да видите: `VAPID_PUBLIC_KEY` и `VAPID_PRIVATE_KEY`

**Ако липсват:**
```bash
npm install -g web-push
web-push generate-vapid-keys
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
```

### 2. Deploy Worker
```bash
wrangler deploy
```

### 3. Провери Cron Triggers
**Cloudflare Dashboard** → Workers → aidiet-worker → Triggers  
Очаквано: `0 * * * *` (всеки час)

---

## 🧪 Тестване

### Test 1: Subscription
```javascript
// Browser console (F12)
localStorage.getItem('userId')  // Трябва да връща user ID

navigator.serviceWorker.ready.then(reg => {
  reg.pushManager.getSubscription().then(sub => 
    console.log(sub ? '✅ Subscribed' : '❌ Not subscribed')
  )
})
```

### Test 2: Manual Push
```bash
curl -X POST https://aidiet.radilov-k.workers.dev/api/push/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "title": "Тест",
    "body": "Тестово известие",
    "notificationType": "general"
  }'
```

### Test 3: Check Logs
```bash
wrangler tail
```

Очаквано:
```
[Cron] Running scheduled notifications check
[Cron] Sending meal reminder to user user_XXX
[Cron] Push notification sent successfully
```

---

## 📱 Видове Notifications

| Тип | Timing | Пример |
|-----|--------|--------|
| 🍳 Закуска | 08:00 | "Започнете деня със здравословна закуска" |
| 🥗 Обяд | 13:00 | "Време е за вашия здравословен обяд" |
| 🍽️ Вечеря | 19:00 | "Не забравяйте вечерята си" |
| 💧 Вода | Всеки 2h (8-22) | "Не забравяйте да пиете вода!" |
| 😴 Сън | 22:00 | "Подгответе се за почивка" |
| 🏃 Активност | 07:00, 15:00 | "Започнете деня с активност!" |

---

## 🔧 Конфигурация

### User Preferences (profile.html)
Настройките автоматично се sync-ват към backend при запазване.

### Global Settings (admin panel)
- Meal times: breakfast, lunch, dinner
- Water frequency: hours between reminders
- Supplement times: custom times array

### Файлове в KV Storage
```
push_subscription_${userId}           → Push subscription
push_subscriptions_list               → Array of subscribed users
notification_preferences_${userId}    → User preferences
global_notification_settings          → Admin settings
notification_templates                → Message templates
```

---

## 🚨 Troubleshooting

### Notifications не се получават?

**1. Permission?**
```javascript
Notification.permission  // Should be: "granted"
```

**2. Subscription active?**
```javascript
navigator.serviceWorker.ready.then(reg =>
  reg.pushManager.getSubscription()
)  // Should return object
```

**3. VAPID keys?**
```bash
wrangler secret list  // Should show both keys
```

**4. Cron работи?**
```bash
wrangler tail  # Check for [Cron] logs
```

---

## 📱 Huawei P60 Pro (microG)

### ⚠️ Важно
Huawei устройства БЕЗ Google Play Services нямат пълна поддръжка за Web Push.

### 🔧 Решения:

**1. Calendar Export (Препоръчително)**
- Приложение → Warning message → "Експортирай в Календар"
- Import `.ics` файл в Huawei Calendar
- Ще получавате calendar reminders

**2. Manual Alarms**
- Задайте будилници в Clock app
- 08:00 (Закуска), 13:00 (Обяд), 19:00 (Вечеря)
- Всеки 2 часа за вода

**3. microG Troubleshooting**
```
Settings → Apps → microG
 → Google Cloud Messaging ✅ enabled

Settings → Battery → Browser
 → Disable all optimizations
```

---

## 🏗️ Архитектура (Кратко)

```
┌─────────────────────────────┐
│ Cloudflare Workers (24/7)   │
│                              │
│ Cron (hourly) → Check KV    │ ✅ Винаги активен
│              → Send Push     │
└──────────────┬───────────────┘
               │
               ↓ Web Push API
               │
┌──────────────┴───────────────┐
│ User Device                  │
│                              │
│ Service Worker → Notification│ ✅ Дори при затворен app
└──────────────────────────────┘
```

---

## 📊 Data Flow

1. User запазва preferences → `localStorage` + Backend KV
2. Cron trigger (hourly) → Чете KV за scheduled times
3. Time match → Web Push → Service Worker → Display
4. Работи в background без активен browser

---

## ⚙️ Environment Variables

### Задължителни:
- `VAPID_PUBLIC_KEY` - Public VAPID key
- `VAPID_PRIVATE_KEY` - Private VAPID key (encrypted)

### Опционални:
- `OPENAI_API_KEY` - За AI функционалност
- `GEMINI_API_KEY` - Алтернативен AI provider

---

## 🔒 Security

✅ CodeQL scan: 0 vulnerabilities  
✅ VAPID keys encrypted в Cloudflare  
✅ Push subscriptions secure в KV  
✅ No sensitive data в notifications  
✅ All communications HTTPS  

---

## 📚 Пълна Документация

Детайлна информация:
- `NOTIFICATION_SYSTEM_FIX_2026-02-17.md` - Technical details
- `NOTIFICATION_FIX_DEPLOYMENT_BG.md` - Deployment guide
- `РЕЗЮМЕ_ПОПРАВКА_ИЗВЕСТИЯ_BG.md` - Comprehensive summary

---

## 🎯 Next Steps

1. ✅ Deploy worker: `wrangler deploy`
2. ✅ Verify VAPID keys configured
3. ✅ Test subscription в browser
4. ✅ Test manual push
5. ✅ Wait for cron (or test immediately)
6. ✅ Monitor logs: `wrangler tail`

**Готово! Push notifications работят в background! 🎉**
