# PWA Deployment Verification Guide

## Changes Summary
This fix resolves PWA installation issues by converting all resource paths from relative to absolute URLs with the `/aidiet/` prefix, ensuring proper path resolution in GitHub Pages subdirectory deployment.

## What Was Changed

### 5 HTML Files Updated
- index.html
- questionnaire.html
- plan.html
- profile.html
- admin.html

### Changes in Each File
1. **Manifest link**: `./manifest.json` → `/aidiet/manifest.json`
2. **Apple touch icon**: `./icon-192x192.png` → `/aidiet/icon-192x192.png`
3. **Service worker registration**: `./sw.js` → `/aidiet/sw.js` with explicit scope `{ scope: '/aidiet/' }`

## Verification Steps After Deployment

### 1. Check Console Logs
After deploying to GitHub Pages, open the site and check browser console:

**Expected Output:**
```
Service Worker registered: ServiceWorkerRegistration {...}
✅ No errors about manifest.json not found
✅ No errors about sw.js not found
✅ No errors about icons not loading
```

### 2. Verify PWA Installation Banner
On Android Chrome/Edge:
- Visit https://radilovk.github.io/aidiet/
- Wait 3-5 seconds
- **Expected**: Install banner should appear (if not previously dismissed)
- **Expected console log**: "PWA Debug: beforeinstallprompt fired successfully"

### 3. Manual Manifest Check
Open browser DevTools → Application → Manifest:
- ✅ **Name**: NutriPlan
- ✅ **Start URL**: /aidiet/
- ✅ **Scope**: /aidiet/
- ✅ **Icons**: Should show 192x192 and 512x512 PNG images
- ✅ **Display**: standalone
- ✅ **No errors or warnings**

### 4. Service Worker Check
Open browser DevTools → Application → Service Workers:
- ✅ **Status**: Activated and running
- ✅ **Scope**: https://radilovk.github.io/aidiet/
- ✅ **No errors**

### 5. Test PWA Installation
**On Android (Chrome/Edge):**
1. Tap the install banner OR
2. Open browser menu → "Install app" or "Add to Home screen"
3. Confirm installation
4. Check home screen for NutriPlan icon
5. Open the installed app
6. Verify it opens in standalone mode (no browser UI)

**On iOS (Safari):**
1. Tap Share button
2. Tap "Add to Home Screen"
3. Tap "Add"
4. Check home screen for NutriPlan icon
5. Open the installed app

### 6. Test Offline Functionality
1. Install the PWA
2. Open the installed app
3. Navigate to different pages (index, questionnaire, plan)
4. Enable airplane mode or disconnect network
5. Navigate between pages again
6. **Expected**: Pages should load from cache without errors

### 7. Check Resource Loading
Open browser DevTools → Network tab:
- Clear cache and reload page
- Verify these resources load with **200 status**:
  - `/aidiet/manifest.json`
  - `/aidiet/sw.js`
  - `/aidiet/icon-192x192.png`
  - `/aidiet/icon-512x512.png`
  - `/aidiet/index.html`

## Troubleshooting

### If Install Banner Doesn't Appear
1. Check console for errors
2. Verify service worker is registered (DevTools → Application → Service Workers)
3. Verify manifest is accessible (DevTools → Application → Manifest)
4. Check if banner was recently dismissed (wait 7 days or clear localStorage)
5. Try in incognito/private mode
6. Ensure HTTPS is being used

### If Manifest Shows Errors
1. Check console for specific error messages
2. Verify manifest.json is accessible: https://radilovk.github.io/aidiet/manifest.json
3. Check manifest syntax: https://manifest-validator.appspot.com/
4. Verify icon files are accessible

### If Service Worker Fails to Register
1. Check console for registration errors
2. Verify sw.js is accessible: https://radilovk.github.io/aidiet/sw.js
3. Check scope matches registration scope
4. Clear browser cache and try again
5. Unregister old service workers (DevTools → Application → Service Workers → Unregister)

### If Icons Don't Load
1. Verify icon files exist and are accessible:
   - https://radilovk.github.io/aidiet/icon-192x192.png
   - https://radilovk.github.io/aidiet/icon-512x512.png
2. Check file sizes (should be small, < 5KB)
3. Verify file formats (must be valid PNG)

## Expected Console Output (After Fix)

```
Notification permission: granted
Service Worker registered: ServiceWorkerRegistration {
  installing: null,
  waiting: null,
  active: ServiceWorker,
  navigationPreload: NavigationPreloadManager,
  scope: 'https://radilovk.github.io/aidiet/'
}
PWA Debug: beforeinstallprompt fired successfully
```

## Success Criteria

✅ All resources load without 404 errors  
✅ Service worker registers successfully  
✅ Manifest loads and validates  
✅ Icons display correctly  
✅ Install banner appears (on supported browsers)  
✅ App can be installed to home screen  
✅ Offline functionality works  
✅ No console errors related to PWA  

## Rollback (If Needed)

If critical issues occur, revert the paths back to relative:
- `/aidiet/manifest.json` → `./manifest.json`
- `/aidiet/sw.js` → `./sw.js`
- `/aidiet/icon-192x192.png` → `./icon-192x192.png`
- Remove `{ scope: '/aidiet/' }` from service worker registration

However, this will bring back the original PWA installation issues.

## Additional Notes

- Changes are minimal and focused only on path resolution
- No functional logic was modified
- All paths are now consistent across the application
- Fix is specific to GitHub Pages subdirectory deployment at `/aidiet/`
- For root domain deployment, paths should use `/` instead of `/aidiet/`
