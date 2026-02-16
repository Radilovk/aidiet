# Push Notifications Setup Guide

## Overview

This guide explains how to set up and configure push notifications for the NutriPlan PWA application.

## Features

The notification system supports:
1. **Chat Messages** - Automatic notifications when AI assistant sends messages
2. **Water Reminders** - Configurable reminders to drink water
3. **Meal Reminders** - Notifications for breakfast, lunch, dinner, and snacks
4. **Custom Notifications** - Admin-triggered notifications

## Prerequisites

- Cloudflare Workers account
- Web Push VAPID keys
- Modern browser with Push API support

## Step 1: Generate VAPID Keys

VAPID (Voluntary Application Server Identification) keys are required for secure push notifications.

### Option A: Using web-push npm package (Recommended)

```bash
# Install web-push globally
npm install -g web-push

# Generate VAPID keys
web-push generate-vapid-keys
```

This will output something like:
```
=======================================
Public Key:
BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBrYhQzj_0sS5kVwfg3A

Private Key:
p6YrrFQXH8DvZvVvZBvLYQrZvEq2hZvPOzVXZQQZQQQ
=======================================

Application Server Keys (VAPID keys) should be safe from MITM attack.
```

### Option B: Using online generator

Visit: https://vapidkeys.com/

## Step 2: Configure Cloudflare Worker Environment Variables

Add the VAPID keys to your Cloudflare Worker:

### Via Cloudflare Dashboard:

1. Go to your Cloudflare Workers dashboard
2. Select your worker (e.g., `aidiet`)
3. Go to Settings → Variables
4. Add two environment variables:
   - **Name:** `VAPID_PUBLIC_KEY`
     **Value:** `[Your public key]`
   - **Name:** `VAPID_PRIVATE_KEY`
     **Value:** `[Your private key]`
     **Type:** ✓ Encrypted (recommended)

### Via wrangler.toml:

```toml
# wrangler.toml
name = "aidiet"
main = "worker.js"

[vars]
VAPID_PUBLIC_KEY = "BEl62iUYgUivxIkv69yViEuiBIa..."

# For private key, use wrangler secret command instead:
# wrangler secret put VAPID_PRIVATE_KEY
```

### Via Wrangler CLI:

```bash
# Set VAPID public key
wrangler secret put VAPID_PUBLIC_KEY
# Enter your public key when prompted

# Set VAPID private key (encrypted)
wrangler secret put VAPID_PRIVATE_KEY
# Enter your private key when prompted
```

## Step 3: Deploy the Worker

```bash
wrangler deploy
```

## Step 4: Configure Notification Settings

1. Log in to the Admin Panel (`/admin.html`)
2. Scroll to the "Push Notifications Management" section
3. Configure settings:
   - Enable/disable notification system
   - Configure chat message notifications
   - Set water reminder schedule (frequency, start/end hours)
   - Set meal reminder times (breakfast, lunch, dinner)
   - Enable snack reminders if needed
4. Click "Save Settings"

## Step 5: Test Notifications

### From Admin Panel:

1. Click "Test Notification" button in the admin panel
2. Check browser for notification

### From Browser Console:

```javascript
// Send test notification
fetch('https://aidiet.radilov-k.workers.dev/api/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        userId: 'your-user-id',
        title: 'Test Notification',
        body: 'This is a test',
        url: '/',
        notificationType: 'general'
    })
})
.then(r => r.json())
.then(console.log);
```

## User Subscription Flow

### Automatic Subscription:

When users visit the site:
1. After page load (5 seconds delay), they see a custom prompt
2. If they agree, browser permission dialog appears
3. Upon granting permission, subscription is saved to Cloudflare KV
4. User ID is generated and stored in localStorage

### Manual Testing:

Open browser console and run:
```javascript
// Check subscription status
navigator.serviceWorker.ready.then(registration => {
    registration.pushManager.getSubscription().then(subscription => {
        console.log('Subscription:', subscription);
    });
});
```

## Notification Types

### Available Types:

1. **general** - General notifications
   - Standard vibration: [200, 100, 200]
   
2. **chat** - Chat messages
   - Light vibration: [100, 50, 100]
   - Tag: `nutriplan-chat`
   
3. **water** - Water reminders
   - Single vibration: [200]
   - Tag: `nutriplan-water`
   
4. **meal** - Meal reminders
   - Strong vibration: [300, 100, 300]
   - Tag: `nutriplan-meal`
   - Requires interaction: true
   
5. **snack** - Snack reminders
   - Medium vibration: [150]
   - Tag: `nutriplan-snack`

## API Endpoints

### Subscribe User:
```http
POST /api/push/subscribe
Content-Type: application/json

{
  "userId": "user123",
  "subscription": {
    "endpoint": "https://...",
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  }
}
```

### Send Notification:
```http
POST /api/push/send
Content-Type: application/json

{
  "userId": "user123",
  "title": "Време за обяд!",
  "body": "Не забравяйте да се храните според плана си",
  "url": "/plan.html",
  "icon": "/icon-192x192.png",
  "notificationType": "meal"
}
```

### Get Notification Settings (Admin):
```http
GET /api/admin/notification-settings
```

### Save Notification Settings (Admin):
```http
POST /api/admin/notification-settings
Content-Type: application/json

{
  "enabled": true,
  "chatMessages": true,
  "waterReminders": {
    "enabled": true,
    "frequency": 2,
    "startHour": 8,
    "endHour": 22
  },
  "mealReminders": {
    "enabled": true,
    "breakfast": "08:00",
    "lunch": "13:00",
    "dinner": "19:00",
    "snacks": false
  }
}
```

## Troubleshooting

### VAPID keys not configured:

**Symptom:** Admin panel shows "✗ Not configured"

**Solution:**
1. Verify keys are set in Cloudflare Worker environment variables
2. Redeploy the worker: `wrangler deploy`
3. Refresh admin panel

### Notifications not received:

**Possible causes:**
1. User hasn't granted notification permission
2. Service worker not registered
3. Subscription not saved to KV
4. VAPID keys mismatch
5. Push service endpoint unreachable

**Debug steps:**
```javascript
// 1. Check notification permission
console.log('Permission:', Notification.permission);

// 2. Check service worker
navigator.serviceWorker.getRegistrations().then(console.log);

// 3. Check subscription
navigator.serviceWorker.ready.then(registration => {
    registration.pushManager.getSubscription().then(console.log);
});

// 4. Check localStorage
console.log('User ID:', localStorage.getItem('userId'));
console.log('Subscribed:', localStorage.getItem('pushSubscribed'));
```

### Browser compatibility:

- ✅ Chrome/Edge 50+
- ✅ Firefox 44+
- ✅ Opera 37+
- ❌ Safari (iOS/macOS) - Limited support
- ❌ Internet Explorer - Not supported

## Security Notes

1. **VAPID Private Key:** Always keep encrypted. Never commit to version control.
2. **User IDs:** Randomly generated and stored in localStorage
3. **Subscription Storage:** Stored in Cloudflare KV with key pattern: `push_subscription_{userId}`
4. **HTTPS Required:** Push notifications only work over HTTPS

## Implementation Details

### Web Push Protocol:

The implementation uses the Web Push protocol with:
- ECDSA P-256 curve for signing
- JWT (JSON Web Token) for VAPID authentication
- Base64url encoding for keys
- 12-hour token expiration

### Service Worker:

Location: `/sw.js`
- Handles `push` events
- Shows notifications with custom options
- Handles `notificationclick` events
- Routes to appropriate pages based on notification type

### Subscription Keys:

Stored in Cloudflare KV:
- Key pattern: `push_subscription_{userId}`
- Value: JSON string of subscription object
- Contains: endpoint, p256dh key, auth key

## Future Enhancements

Potential improvements:
1. Scheduled notification sending (cron triggers)
2. User-specific notification preferences
3. Notification history/logs
4. Analytics (delivery rate, click-through rate)
5. A/B testing for notification content
6. Rich notifications with actions/buttons
7. Notification categories with custom sounds

## Support

For issues or questions:
- Check browser console for errors
- Verify VAPID configuration in admin panel
- Review Cloudflare Worker logs
- Test with different browsers/devices
