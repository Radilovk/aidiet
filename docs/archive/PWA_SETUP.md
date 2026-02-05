# NutriPlan PWA Setup Guide

## PWA Features

This application is now a Progressive Web App (PWA) with the following features:

### ✅ Implemented Features

1. **App Manifest** (`manifest.json`)
   - App name: NutriPlan
   - Icons: 192x192px and 512x512px
   - Display mode: standalone
   - Theme color: #10b981 (green)

2. **Service Worker** (`sw.js`)
   - Offline functionality
   - Cache static resources
   - Network-first strategy for HTML
   - Cache-first strategy for assets

3. **Push Notifications**
   - "Enable Notifications" button on home page
   - Shows only when permission not yet requested
   - Requests notification permission
   - Subscribes to push notifications via Web Push API

4. **Platform Support**
   - **Android**: Install banner appears automatically
   - **iOS**: Manual installation via Safari (Share → Add to Home Screen)

## Installation

### For Android Users

1. Open the website in Chrome/Edge
2. A banner will appear: "Add NutriPlan to Home screen"
3. Tap "Add" or "Install"
4. The app icon will appear on your home screen

### For iOS Users

1. Open the website in Safari
2. Tap the Share button (square with arrow)
3. Scroll down and tap "Add to Home Screen"
4. Tap "Add" in the top right
5. The app icon will appear on your home screen

## Configuring Push Notifications (For Developers)

To enable full push notification support, you need to configure VAPID keys:

### Step 1: Generate VAPID Keys

You can generate VAPID keys using:

**Option A: Using web-push npm package**
```bash
npm install -g web-push
web-push generate-vapid-keys
```

**Option B: Using online generator**
- Visit: https://vapidkeys.com/

This will generate:
- Public Key (used in client-side code)
- Private Key (used in server-side code - keep secret!)

### Step 2: Configure Environment Variables

Add the VAPID keys to your Cloudflare Worker environment:

```bash
# Using wrangler CLI
wrangler secret put VAPID_PUBLIC_KEY
# Paste your public key when prompted

wrangler secret put VAPID_PRIVATE_KEY
# Paste your private key when prompted
```

Or add them through the Cloudflare dashboard:
1. Go to Workers & Pages
2. Select your worker
3. Go to Settings → Variables
4. Add environment variables:
   - `VAPID_PUBLIC_KEY`: Your public key
   - `VAPID_PRIVATE_KEY`: Your private key (encrypted)

### Step 3: Update Worker Configuration

The worker is already configured to use these environment variables.
No code changes needed - just deploy:

```bash
wrangler deploy
```

## Testing PWA Features

### Test Service Worker
1. Open DevTools (F12)
2. Go to Application → Service Workers
3. Verify service worker is registered and activated

### Test Offline Mode
1. Open DevTools (F12)
2. Go to Network tab
3. Enable "Offline" mode
4. Navigate through the app - cached pages should load

### Test Install Prompt (Android)
1. Open in Chrome on Android
2. Wait for install banner
3. Or use menu → "Install app"

### Test Notifications
1. Click "Enable Notifications" button
2. Grant permission when prompted
3. Check browser notifications settings

## API Endpoints

### Push Notification Endpoints

**Get VAPID Public Key**
```
GET /api/push/vapid-public-key
Response: { "success": true, "publicKey": "..." }
```

**Subscribe to Push Notifications**
```
POST /api/push/subscribe
Body: { "userId": "...", "subscription": {...} }
Response: { "success": true, "message": "Subscription saved successfully" }
```

**Send Push Notification**
```
POST /api/push/send
Body: { "userId": "...", "title": "...", "body": "...", "url": "..." }
Response: { "success": true, "message": "Push notification sent" }
```

## File Structure

```
aidiet/
├── manifest.json           # PWA manifest file
├── sw.js                   # Service worker
├── icon-192x192.png        # App icon (192x192)
├── icon-512x512.png        # App icon (512x512)
├── index.html             # Updated with PWA support
├── plan.html              # Updated with PWA support (export-btn removed)
├── questionnaire.html     # Updated with PWA support
├── profile.html           # Updated with PWA support
├── admin.html             # Updated with PWA support
├── worker.js              # Cloudflare Worker with push API
└── PWA_SETUP.md           # This file
```

## Troubleshooting

### Service Worker Not Registering
- Check browser console for errors
- Ensure HTTPS is being used (required for service workers)
- Clear browser cache and reload

### Install Prompt Not Showing
- Ensure all PWA requirements are met (HTTPS, manifest, service worker)
- Check if app is already installed
- Try clearing browser data

### Push Notifications Not Working
- Verify VAPID keys are configured correctly
- Check notification permission status
- Ensure service worker is active
- Check browser console for errors

### iOS Install Issues
- Safari is required (Chrome/Firefox on iOS won't work)
- Ensure manifest is properly linked
- Icons must be the correct size

## Browser Support

| Feature | Chrome/Edge | Safari | Firefox |
|---------|-------------|--------|---------|
| Service Worker | ✅ | ✅ | ✅ |
| Install Prompt | ✅ | Manual | ✅ |
| Push Notifications | ✅ | ✅ (iOS 16.4+) | ✅ |
| Offline Mode | ✅ | ✅ | ✅ |

## Security Considerations

1. **VAPID Keys**: Keep private key secure - never commit to repository
2. **HTTPS**: Required for PWA features to work
3. **Permissions**: Always request permissions at appropriate times
4. **Data Storage**: User data is stored locally in browser (localStorage)

## Next Steps

1. Replace placeholder icons with custom-designed icons
2. Configure VAPID keys for production push notifications
3. Test on real devices (Android and iOS)
4. Monitor service worker updates and cache invalidation
5. Consider adding background sync for offline data submission

## Resources

- [MDN: Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [Web.dev: PWA Checklist](https://web.dev/pwa-checklist/)
- [Web Push Protocol](https://web.dev/push-notifications-overview/)
- [VAPID Keys](https://blog.mozilla.org/services/2016/08/23/sending-vapid-identified-webpush-notifications-via-mozillas-push-service/)
