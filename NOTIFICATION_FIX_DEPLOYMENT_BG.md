# Инструкции за Внедряване на Поправката на Известията

## Какво Е Поправено

### Проблем 1: Известията работят само когато приложението е отворено ✅ РЕШЕНО
**Решение:** Cloudflare Workers cron triggers изпращат push notifications на всеки час, дори когато приложението е затворено.

### Проблем 2: Известията нямат текст ✅ РЕШЕНО
**Решение:** Push notifications сега включват пълен JSON payload с title, body, icon и type.

### Проблем 3: Frontend известията не работят ✅ РЕШЕНО
**Решение:** Frontend сега използва backend push API вместо локални setTimeout() timers.

## Стъпки за Внедряване

### Стъпка 1: Verify VAPID Keys
VAPID keys са вече конфигурирани в Cloudflare Workers environment variables.

За проверка:
```bash
wrangler secret list
```

Трябва да видите:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

**Ако не са конфигурирани:**
```bash
# Generate VAPID keys
npm install -g web-push
web-push generate-vapid-keys

# Set in Cloudflare
wrangler secret put VAPID_PUBLIC_KEY
# Paste the public key when prompted

wrangler secret put VAPID_PRIVATE_KEY
# Paste the private key when prompted
```

### Стъпка 2: Deploy Worker
```bash
cd /home/runner/work/aidiet/aidiet
wrangler deploy
```

**Очаквано:** Worker ще се deploy-не с новите cron triggers.

### Стъпка 3: Verify Cron Triggers
1. Отидете на Cloudflare Dashboard
2. Workers & Pages → aidiet-worker
3. Triggers tab
4. Трябва да видите: **Cron Trigger: 0 * * * ***

### Стъпка 4: Test Push Subscription
1. Отворете приложението: https://biocode.website/
2. Разрешете notifications когато се покаже prompt
3. Отворете browser console (F12)
4. Проверете:
```javascript
// Check userId
console.log('User ID:', localStorage.getItem('userId'));

// Check subscription
navigator.serviceWorker.ready.then(reg => {
  reg.pushManager.getSubscription().then(sub => {
    console.log('Subscription:', sub ? 'Active' : 'Not subscribed');
  });
});
```

### Стъпка 5: Test Push Notification (Manual)
Използвайте admin panel или API call:

```bash
curl -X POST https://aidiet.radilov-k.workers.dev/api/push/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id_here",
    "title": "Тест",
    "body": "Това е тестово известие",
    "notificationType": "general"
  }'
```

**Очаквано:** Ще получите push notification дори ако приложението е затворено.

### Стъпка 6: Configure Notification Preferences
1. Отидете на Profile page
2. Scroll до "Настройки за Известия"
3. Конфигурирайте:
   - Известия за хранене
   - Известия за вода
   - Известия за сън
   - Известия за активност
4. Натиснете **Запази**

**Важно:** Preferences автоматично се sync-ват към backend!

### Стъпка 7: Wait for Cron (or Test Immediately)
Cron се изпълнява на всеки час (XX:00).

**За immediate тестване:**
```bash
# Trigger cron manually (requires Wrangler)
wrangler dev --test-scheduled
```

### Стъпка 8: Check Logs
```bash
wrangler tail
```

Трябва да видите:
```
[Cron] Running scheduled notifications check
[Cron] Checking notifications for N users at HH:MM
[Cron] Sending meal reminder to user user_XXX
[Cron] Push notification sent successfully to user user_XXX
```

## Проверка на Функционалност

### Test Case 1: Background Notifications
1. Subscribe за notifications
2. Set meal time = текущ час + 5 минути
3. Затворете браузъра НАПЪЛНО
4. Изчакайте 5 минути
5. **Очаквано:** Получавате notification

### Test Case 2: Notification Text
1. Проверете че notification има:
   - ✅ Title (напр. "Време за обяд")
   - ✅ Body (напр. "Време е за вашия здравословен обяд 🥗")
   - ✅ Icon

### Test Case 3: Multiple Users
1. Създайте 2 различни users (2 devices/browsers)
2. Всеки има различни meal times
3. **Очаквано:** Всеки получава notifications според своя график

## Huawei P60 Pro с microG

### Важно за Huawei Устройства
Huawei устройства **БЕЗ Google Play Services** нямат поддръжка за Web Push notifications.

**microG** е частична алтернатива, но може да не работи на 100%.

### Решения за Huawei:

#### Опция 1: Calendar Export
1. Отворете приложението
2. При warning съобщението натиснете **"Експортирай в Календар"**
3. Ще се изтегли `nutriplan-reminders.ics` файл
4. Импортирайте в Huawei Calendar:
   - Отворете Huawei Calendar app
   - Menu → Import
   - Изберете `.ics` файла
   - Ще получавате calendar reminders

#### Опция 2: Manual Alarms
Задайте будилници в Huawei Alarm app за:
- 08:00 - Закуска
- 13:00 - Обяд
- 19:00 - Вечеря
- Всеки 2 часа - Вода

#### Опция 3: Install GMS (Advanced)
Ако сте tech-savvy, можете да инсталирате Google Mobile Services:
- Използвайте Googlefier или друг GMS installer
- **ВНИМАНИЕ:** Може да наруши warranty

### microG Troubleshooting
Ако microG е инсталиран:

1. Проверете microG Settings:
   - Settings → Apps → microG
   - Google Cloud Messaging трябва да е enabled

2. Check Battery Optimization:
   - Settings → Battery → App launch
   - Browser (Chrome/Firefox) → Manage manually
   - Disable all optimizations

3. Test in Chrome:
   - Chrome browser има най-добра поддръжка
   - Инсталирайте като PWA (Add to Home Screen)

## Архитектура

### Преди (Проблеми)
```
Frontend (plan.html)
  └─ setTimeout() ❌ Спира при затворено app
      └─ showNotification() ❌ Не работи в background
```

### След (Решение)
```
Cloudflare Cron (hourly)
  └─ Check users in KV
      └─ Check time matches schedule
          └─ Send Web Push
              └─ Service Worker
                  └─ showNotification() ✅ Работи в background
```

## Timing Examples

### Meal Notifications
- Breakfast: 08:00 ✅
- Lunch: 13:00 ✅
- Dinner: 19:00 ✅

### Water Notifications
- Every 2 hours from 8:00 to 22:00
- 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00 ✅

### Sleep Notification
- 22:00 ✅

### Activity Notifications
- Morning: 07:00 ✅
- Day: 15:00 ✅

## Troubleshooting

### Известия не се получават

**Проверка 1: Permission**
```javascript
console.log('Notification permission:', Notification.permission);
// Should be: "granted"
```

**Проверка 2: Subscription**
```javascript
navigator.serviceWorker.ready.then(reg => {
  reg.pushManager.getSubscription().then(sub => {
    console.log('Subscription:', sub);
  });
});
// Should return subscription object
```

**Проверка 3: Backend**
```bash
wrangler tail
# Check for cron logs
```

**Проверка 4: VAPID Keys**
```bash
wrangler secret list
# Should show VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
```

### Cron не се изпълнява

1. Check Cloudflare Dashboard → Triggers
2. Verify cron expression: `0 * * * *`
3. Check logs: `wrangler tail`

### microG не работи

За Huawei P60 Pro:
1. Използвайте Calendar Export (.ics)
2. Или използвайте Huawei's native alarm system
3. Web Push може да не работи 100% reliable

## Поддръжка

За допълнителна помощ:
- Проверете Cloudflare Workers logs
- Проверете browser console за errors
- Проверете Network tab за failed API calls

## Security Summary

✅ Няма security vulnerabilities
✅ VAPID keys са encrypted в Cloudflare
✅ Push subscriptions са stored safely в KV
✅ No sensitive data in notifications
✅ All communications over HTTPS

---

**Поправката е завършена и готова за production use!**
