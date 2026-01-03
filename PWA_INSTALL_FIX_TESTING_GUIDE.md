# PWA Installation Fix - Testing Guide

## Overview
This guide explains how to test the PWA installation fixes that address the issue where `beforeinstallprompt` was not firing on Android Chrome.

## What Was Fixed

### Problem
- The `beforeinstallprompt` event was not firing on Android Chrome
- Users had no fallback method to install the app
- No diagnostic information was available to understand why installation wasn't working

### Solution
- Added comprehensive PWA resource validation (manifest + icons)
- Added fallback install banner that appears after 5 seconds
- Enhanced diagnostic logging to identify installation issues
- Platform-specific installation instructions for all devices

## Testing Instructions

### Test 1: Android Chrome - Fallback Banner

**Purpose**: Verify the fallback install banner appears when `beforeinstallprompt` doesn't fire

**Steps**:
1. Open https://radilovk.github.io/aidiet/ on Android Chrome
2. Open Chrome DevTools Console (desktop remote debugging or use `chrome://inspect`)
3. Wait and observe the console output

**Expected Results**:
- After ~1 second: See "🔍 PWA RESOURCE VALIDATION" section with:
  - Manifest URL and HTTP status
  - Icon validation results (4 icons checked)
  - All icons should show ✅ and file sizes
- After ~3 seconds: See "PWA Debug: beforeinstallprompt has not fired yet"
- After ~5 seconds: See "⚠️ beforeinstallprompt has not fired after 5 seconds"
- **A fallback banner should appear at the bottom of the screen** with:
  - Title: "📱 Инсталирай NutriPlan веднага!"
  - Instructions in Bulgarian
  - "Как точно?" button for detailed instructions

**Manual Installation**:
1. Click the "Как точно?" button
2. Follow the displayed instructions
3. Open Chrome menu (⋮) → "Install app" or "Add to Home screen"
4. Confirm installation

**Verification**:
- App icon appears on home screen
- App opens in standalone mode (no address bar)
- App works offline (thanks to Service Worker)

---

### Test 2: Android Chrome - Automatic Installation (If Supported)

**Purpose**: Verify automatic installation still works if Chrome fires `beforeinstallprompt`

**Prerequisites**: 
- Clear Chrome data or use Incognito mode
- App must not be already installed

**Steps**:
1. Visit https://radilovk.github.io/aidiet/ on Android Chrome
2. Interact with the page (scroll, click buttons)
3. Wait 30+ seconds with interaction
4. Check console and UI

**Expected Results - If beforeinstallprompt fires**:
- Console shows: "✅ PWA Debug: beforeinstallprompt fired successfully!"
- A banner appears saying "🎉 Готово за инсталация!"
- Auto-triggers after 3 seconds with native install dialog

**Expected Results - If beforeinstallprompt doesn't fire**:
- After 5 seconds: Fallback banner appears (same as Test 1)
- After 32 seconds: Extended diagnostics appear in console
- Users can still install manually via fallback instructions

---

### Test 3: iOS Safari - Platform-Specific Instructions

**Purpose**: Verify iOS users get appropriate installation instructions

**Steps**:
1. Open https://radilovk.github.io/aidiet/ on iOS Safari
2. Open Safari Web Inspector (if available) or check UI
3. Wait 3 seconds

**Expected Results**:
- A banner appears with iOS-specific instructions
- Title: "Добави към начален екран"
- Button shows "Инструкции"
- Clicking shows: "Натисни бутона Share (⬆️)..." instructions

---

### Test 4: Desktop Chrome - Install Icon in Address Bar

**Purpose**: Verify desktop users understand installation works via address bar

**Steps**:
1. Open https://radilovk.github.io/aidiet/ on Desktop Chrome
2. Open DevTools Console
3. Wait ~3 seconds

**Expected Results**:
- Console shows: "✓ PWA IS INSTALLABLE!"
- Console explains: "Chrome shows an INSTALL ICON in the address bar"
- Instructions to look for install icon (⊕ or ⬇) in omnibox
- A banner may appear with instructions
- Install icon should be visible in address bar

---

### Test 5: Already Installed - No Banner

**Purpose**: Verify banner doesn't show if app is already installed

**Steps**:
1. Install the app following Test 1 or Test 2
2. Open the installed app
3. Check console and UI

**Expected Results**:
- Console shows: "Already installed: Yes (running as standalone app)"
- NO install banner appears
- App runs in standalone mode

---

### Test 6: PWA Resource Validation

**Purpose**: Verify all PWA resources are accessible and valid

**Steps**:
1. Open https://radilovk.github.io/aidiet/ on any browser
2. Open DevTools Console
3. Wait ~1 second for validation to run

**Expected Results**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 PWA RESOURCE VALIDATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 Manifest URL: https://radilovk.github.io/aidiet/manifest.json
   - HTTP Status: 200 OK
   - Content-Type: application/json (or application/manifest+json)
   - ✅ Manifest loaded successfully
   - Name: NutriPlan
   - Start URL: /aidiet/
   - Display: standalone
   - Icons count: 4

🖼️  Validating Icons:
   - Icon: /aidiet/icon-192x192.png (192x192, any)
     ✅ Accessible (X.XX KB, image/png)
   - Icon: /aidiet/icon-192x192.png (192x192, maskable)
     ✅ Accessible (X.XX KB, image/png)
   - Icon: /aidiet/icon-512x512.png (512x512, any)
     ✅ Accessible (X.XX KB, image/png)
   - Icon: /aidiet/icon-512x512.png (512x512, maskable)
     ✅ Accessible (X.XX KB, image/png)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**If any icon fails**:
- Shows ❌ with error message
- Indicates why `beforeinstallprompt` might not fire

---

## Common Issues and Solutions

### Issue: Banner doesn't appear
**Possible Causes**:
1. App is already installed → Check console for "Already installed: Yes"
2. Banner was dismissed recently → Check localStorage: `installBannerDismissed`
3. Running in standalone mode → Check console

**Solution**: 
- Uninstall the app and clear browser data
- Or wait 7 days for banner to reappear

---

### Issue: Icons fail to load
**Symptoms**: Console shows "❌ Failed" for icon validation

**Possible Causes**:
1. Icons not accessible via HTTPS
2. CORS issues
3. Wrong file paths

**Solution**: 
- Check network tab in DevTools
- Verify icon URLs are correct
- Check server serves icons with proper MIME type

---

### Issue: Manifest fails to load
**Symptoms**: Console shows "❌ Failed to load manifest"

**Possible Causes**:
1. Manifest not accessible
2. Invalid JSON in manifest
3. Wrong Content-Type header

**Solution**:
- Check manifest.json is accessible
- Validate JSON syntax
- Check server serves manifest with `application/json` or `application/manifest+json`

---

## Debug Mode

All diagnostic features are controlled by `PWA_DEBUG` flag in index.html:
```javascript
const PWA_DEBUG = true; // Set to false to disable debug logging
```

When `PWA_DEBUG = false`:
- Resource validation doesn't run
- Extended diagnostic logging is suppressed
- Fallback banner still works (user-facing feature)

---

## Timeline of Events

```
Time     | Event
---------|----------------------------------------------------------
0s       | Page loads
1s       | PWA resource validation runs (if PWA_DEBUG = true)
2s       | First check if beforeinstallprompt fired
3s       | Console shows installability criteria
3s       | iOS/non-Android mobile: Show fallback banner
5s       | Android Chrome: Show fallback banner (if no prompt)
32s      | Extended diagnostics (if user interacted)
```

---

## Success Criteria

✅ **Test passes if**:
1. PWA resource validation shows all green ✅
2. Fallback banner appears within 5 seconds on Android
3. Banner provides clear installation instructions
4. Users can successfully install via fallback method
5. No banner appears when app is already installed
6. Different platforms get appropriate instructions

❌ **Test fails if**:
1. No banner appears and beforeinstallprompt doesn't fire
2. Banner appears when app is already installed
3. Icons or manifest fail validation without good reason
4. Console errors appear
5. Banner doesn't disappear after dismissal

---

## Automated Testing

Currently, there is no automated test suite for PWA features. Future improvements:
- Add Puppeteer/Playwright tests for PWA installation flow
- Add Jest tests for validation logic
- Add E2E tests for different platforms

---

## Related Files

- `index.html` - Main page with PWA installation logic
- `manifest.json` - PWA manifest file
- `sw.js` - Service Worker
- `icon-192x192.png` - App icon (192x192)
- `icon-512x512.png` - App icon (512x512)

---

## Rollback Plan

If issues are discovered after deployment:
1. Revert commit: `git revert f0da77c`
2. Or disable fallback: Comment out `showPlatformInstallGuidance()` call at line ~1199
3. Or disable validation: Set `PWA_DEBUG = false`

---

## Contact

For questions or issues with this fix, refer to:
- PR: copilot/debug-pwa-install-prompt
- Commits: 8b6abe5, f0da77c
- Issue: beforeinstallprompt not firing on Android Chrome
