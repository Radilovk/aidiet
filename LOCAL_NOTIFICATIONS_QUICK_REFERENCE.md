# 🔔 Local Notifications - Quick Reference

## TL;DR
**Offline-first notifications** с IndexedDB + Notification Triggers API.  
**99% по-малко server calls** - данни се sync-ват седмично, не всеки час.

---

## ⚡ Как Работи (3 стъпки)

### 1. Schedule Generation
```javascript
// При отваряне на app или промяна на preferences
const prefs = {
  meals: { enabled: true },
  water: { enabled: true },
  sleep: { enabled: true, time: '22:00' }
};

await LocalNotificationScheduler.init();
await LocalNotificationScheduler.scheduleAll(prefs);
// ✅ Generates 7-day schedule (~150 notifications)
// ✅ Stores in IndexedDB
// ✅ Schedules with best available API
```

### 2. Background Execution
```javascript
// Chrome Android: Notification Triggers API
// - OS scheduler activates at exact time
// - Service Worker shows notification
// - Zero battery drain

// Other browsers: Periodic Background Sync
// - Browser wakes SW every ~12h
// - SW checks IndexedDB for due notifications
// - Shows all pending
```

### 3. Display
```javascript
// Service Worker (runs in background)
await checkAndShowDueNotifications();
// ✅ Reads from IndexedDB (no network!)
// ✅ Shows notifications
// ✅ Marks as shown
```

---

## 🔧 API Detection

```javascript
const capabilities = await LocalNotificationScheduler.init();

console.log(capabilities);
// {
//   supportsShowTrigger: boolean,     // Notification Triggers
//   supportsPeriodicSync: boolean     // Periodic Background Sync
// }
```

**Best to Worst:**
1. ✅ **Notification Triggers** - Exact timing, zero battery
2. ⚠️ **Periodic Sync** - Good timing (~12h checks), minimal battery
3. ❌ **Fallback** - Only when app visible

---

## 📊 IndexedDB Schema

```javascript
// Notifications store
{
  id: 1,
  type: 'meal',
  title: 'Време за обяд',
  body: 'Време е за вашия здравословен обяд 🥗',
  icon: '/icon-192x192.png',
  scheduledTime: 1708178400000,  // timestamp
  data: { url: '/plan.html' },
  status: 'pending',  // or 'shown', 'cancelled'
  createdAt: 1708092000000,
  shownAt: null
}
```

**Operations:**
```javascript
// Add single
await NotificationDB.addNotification({
  type: 'water',
  title: 'Време за вода',
  body: 'Не забравяйте да пиете вода! 💧',
  scheduledTime: Date.now() + 3600000  // 1 hour from now
});

// Add batch (efficient)
await NotificationDB.addBatch(notifications);

// Get pending
const pending = await NotificationDB.getPendingNotifications();

// Get due (within 5 min window)
const due = await NotificationDB.getDueNotifications(5);

// Mark shown
await NotificationDB.markAsShown(id);
```

---

## 🌍 Platform Support

| Platform | API Used | Timing | Battery |
|----------|----------|--------|---------|
| Chrome Android | Triggers API | ⏱️ Exact | 🔋 Zero |
| Edge Android | Triggers API | ⏱️ Exact | 🔋 Zero |
| Chrome Desktop | Periodic Sync | ⏱️ ±6h | 🔋 Low |
| Firefox Android | Fallback | ⏱️ App open only | 🔋 Minimal |
| Safari iOS | Calendar Export | ⏱️ Native | 🔋 Zero |
| Huawei (no GMS) | Calendar Export | ⏱️ Native | 🔋 Zero |

---

## 🧪 Testing

### Check Capabilities
```javascript
// Browser console
const caps = await LocalNotificationScheduler.init();
console.log('Triggers:', caps.supportsShowTrigger);
console.log('Periodic Sync:', caps.supportsPeriodicSync);
```

### Schedule Test Notification
```javascript
// 1 minute from now
await NotificationDB.addNotification({
  type: 'test',
  title: 'Test',
  body: 'Testing local notifications',
  scheduledTime: Date.now() + 60000,
  icon: '/icon-192x192.png',
  data: { url: '/plan.html' }
});

// If Triggers API supported, it will show at exact time
// Otherwise, check when app becomes visible
```

### Check Queue
```javascript
// View all pending
const pending = await NotificationDB.getPendingNotifications();
console.log(`${pending.length} pending notifications`);
pending.forEach(n => {
  console.log(`${n.type}: ${n.title} at ${new Date(n.scheduledTime)}`);
});

// View due notifications
const due = await NotificationDB.getDueNotifications();
console.log(`${due.length} notifications due now`);
```

---

## 🔄 Sync Workflow

### Initial Setup
```
User opens app
  ↓
LocalNotificationScheduler.init()
  ↓
Generate 7-day schedule
  ↓
Store in IndexedDB (~150 notifications)
  ↓
Schedule with Triggers API or register Periodic Sync
  ↓
✅ Done - No more calls for 7 days!
```

### Weekly Re-sync
```
Day 7: User opens app
  ↓
Check schedule age
  ↓
If > 5 days old, regenerate
  ↓
Clear old notifications
  ↓
Generate new 7-day schedule
  ↓
✅ Refreshed
```

### On Preference Change
```
User changes notification settings
  ↓
Clear pending notifications
  ↓
Regenerate schedule with new settings
  ↓
✅ Updated instantly
```

---

## 📈 Performance Comparison

### Old Approach (Server Cron)
```
Backend calls:  168 per week (hourly)
KV operations:  ~100 per hour
Push messages:  ~50 per day per user
Battery:        Medium drain
Offline:        ❌ Doesn't work
```

### New Approach (Local)
```
Backend calls:  1 per week (sync only)
KV operations:  0 (local IndexedDB)
Push messages:  0 (local scheduling)
Battery:        Minimal/Zero drain
Offline:        ✅ Works perfectly
```

**Result: 99% reduction in server load!**

---

## 🚨 Troubleshooting

### Notifications Not Showing?

**1. Check Permission**
```javascript
console.log(Notification.permission);  // Should be 'granted'
```

**2. Check Capabilities**
```javascript
const caps = await LocalNotificationScheduler.init();
// Shows which APIs are supported
```

**3. Check Queue**
```javascript
const pending = await NotificationDB.getPendingNotifications();
console.log(`Queue: ${pending.length} notifications`);
```

**4. Check Service Worker**
```javascript
navigator.serviceWorker.ready.then(reg => 
  console.log('SW active:', reg.active ? '✅' : '❌')
);
```

### Chrome Android Only
```javascript
// Use Notification Triggers API
if ('showTrigger' in Notification.prototype) {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Test', {
    body: 'Triggers API works!',
    showTrigger: new TimestampTrigger(Date.now() + 5000)
  });
}
```

---

## 🔒 Security & Privacy

✅ **All data stored locally** - No server transmission  
✅ **User owns notification queue** - Stored in browser IndexedDB  
✅ **Can work 100% offline** - No network dependency  
✅ **Automatic cleanup** - Old notifications auto-deleted  

---

## 📚 Related Docs

- **Full Architecture:** `LOCAL_NOTIFICATIONS_ARCHITECTURE_BG.md`
- **Server Approach:** `PUSH_NOTIFICATIONS_QUICK_REFERENCE_BG.md`
- **Troubleshooting:** `NOTIFICATIONS_TROUBLESHOOTING_BG.md`

---

## 🎯 Quick Commands

```javascript
// Initialize
await LocalNotificationScheduler.init();

// Schedule all from preferences
const prefs = JSON.parse(localStorage.getItem('notificationPreferences'));
await LocalNotificationScheduler.scheduleAll(prefs);

// Check what's scheduled
const pending = await NotificationDB.getPendingNotifications();
console.table(pending);

// Cleanup old
await NotificationDB.clearOldNotifications(7);

// Force check now
await LocalNotificationScheduler.checkAndShowDueNotifications();
```

---

**Статус:** ✅ Production Ready  
**Последна актуализация:** 2026-02-17
