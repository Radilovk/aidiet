# PWA Installation Fix - December 2025 Update

## Latest Problem (December 28, 2025)
The PWA installation was still failing on GitHub Pages deployment at `https://radilovk.github.io/aidiet/` despite previous fixes. The debug output showed:

```
PWA Debug: beforeinstallprompt has not fired yet
PWA Debug: Checking installability criteria:
- Service Worker: Supported
- HTTPS: Yes
- Manifest link: Found
- Already installed: No
- Possible reasons:
  1. Manifest.json not valid or not accessible
  2. Icons not loading properly
  3. Service worker not registered successfully
  4. PWA criteria not fully met
  5. Browser does not support install prompts
```

## Root Cause of December 2025 Issue
After previous fixes where manifest.json and sw.js used absolute paths with `/aidiet/` prefix, the HTML files were still using **relative paths** (`./manifest.json` and `./sw.js`). These relative paths were NOT resolving correctly in the GitHub Pages subdirectory deployment.

### Why Relative Paths Failed:
When deploying to `https://radilovk.github.io/aidiet/`:
- **Relative path in HTML**: `<link rel="manifest" href="./manifest.json">`
- **Browser attempted resolution**: Could fail depending on page URL variations
- **Service worker scope**: Not explicitly set, causing potential scope mismatches
- **Result**: Manifest and service worker not loading reliably ❌

## Solution (December 28, 2025)
Changed ALL paths in HTML files from relative to absolute, including explicit service worker scope.

### Files Changed:
- index.html
- questionnaire.html  
- plan.html
- profile.html
- admin.html

### Changes Made in Each HTML File:

#### 1. Manifest Link
```diff
- <link rel="manifest" href="./manifest.json">
+ <link rel="manifest" href="/aidiet/manifest.json">
```

#### 2. Apple Touch Icon
```diff
- <link rel="apple-touch-icon" href="./icon-192x192.png">
+ <link rel="apple-touch-icon" href="/aidiet/icon-192x192.png">
```

#### 3. Service Worker Registration with Explicit Scope
```diff
- navigator.serviceWorker.register('./sw.js')
+ navigator.serviceWorker.register('/aidiet/sw.js', { scope: '/aidiet/' })
```

## Previous Fix History

### Original Problem
The PWA installation was failing on GitHub Pages deployment at `https://radilovk.github.io/aidiet/` with the following debug output:

```
PWA Debug: beforeinstallprompt has not fired yet
PWA Debug: Checking installability criteria:
- Service Worker: Supported
- HTTPS: Yes
- Manifest link: Found
- Already installed: No
- Possible reasons:
  1. Manifest.json not valid or not accessible
  2. Icons not loading properly
  3. Service worker not registered successfully
  4. PWA criteria not fully met
  5. Browser does not support install prompts
```

## Root Cause
The application is deployed to a subdirectory (`/aidiet/`) on GitHub Pages, but the manifest.json and service worker were using absolute paths starting with `/` which resolved to the root domain instead of the subdirectory.

### Example of the Issue:
- **Intended URL**: `https://radilovk.github.io/aidiet/icon-192x192.png`
- **Actual URL with old path**: `https://radilovk.github.io/icon-192x192.png` ❌
- **Fixed URL with new path**: `https://radilovk.github.io/aidiet/icon-192x192.png` ✅

## Solution
Updated all absolute paths in manifest.json and sw.js to include the `/aidiet/` prefix.

### Files Changed:

#### 1. manifest.json
```diff
- "start_url": "/",
+ "start_url": "/aidiet/",

- "scope": "/",
+ "scope": "/aidiet/",

- "src": "/icon-192x192.png",
+ "src": "/aidiet/icon-192x192.png",

- "src": "/icon-512x512.png",
+ "src": "/aidiet/icon-512x512.png",
```

#### 2. sw.js
```diff
- './index.html',
+ '/aidiet/index.html',

- './icon-192x192.png',
+ '/aidiet/icon-192x192.png',

- icon: './icon-192x192.png',
+ icon: '/aidiet/icon-192x192.png',

- clients.openWindow('./index.html')
+ clients.openWindow('/aidiet/index.html')
```

## Verification Steps

After deployment to GitHub Pages, verify the fix by:

### 1. Check Manifest Accessibility
Open in browser: `https://radilovk.github.io/aidiet/manifest.json`
- Should return valid JSON with correct paths

### 2. Check Icon Accessibility
Open in browser:
- `https://radilovk.github.io/aidiet/icon-192x192.png`
- `https://radilovk.github.io/aidiet/icon-512x512.png`
- Both should display the app icon

### 3. Check Developer Tools
1. Open `https://radilovk.github.io/aidiet/` in Chrome/Edge
2. Open DevTools (F12)
3. Go to **Application** tab
4. Check **Manifest** section:
   - Should show manifest with correct start_url and icons
   - All icons should have green checkmarks
5. Check **Service Workers** section:
   - Should show registered service worker with scope `/aidiet/`
   - Status should be "activated and running"

### 4. Test PWA Installation
On **Android Chrome/Edge**:
1. Visit `https://radilovk.github.io/aidiet/`
2. Wait 30 seconds for engagement criteria
3. Look for install banner at bottom of screen
4. Or tap menu (⋮) → "Install app" or "Add to Home screen"
5. Confirm installation
6. Check home screen for NutriPlan icon

On **iOS Safari**:
1. Visit `https://radilovk.github.io/aidiet/`
2. Tap Share button (square with arrow)
3. Scroll down and tap "Add to Home Screen"
4. Tap "Add" in top right
5. Check home screen for NutriPlan icon

### 5. Test Offline Functionality
1. Install the PWA
2. Open the installed app
3. Turn on airplane mode
4. Navigate between pages
5. Pages should load from cache

## Technical Details

### Current Path Strategy (After December 2025 Fix)
ALL paths now use absolute paths with `/aidiet/` prefix:

**HTML files** (index.html, questionnaire.html, etc.):
```html
<link rel="manifest" href="/aidiet/manifest.json">
<link rel="apple-touch-icon" href="/aidiet/icon-192x192.png">
```
```javascript
navigator.serviceWorker.register('/aidiet/sw.js', { scope: '/aidiet/' })
```

**manifest.json**:
```json
{
  "start_url": "/aidiet/",
  "scope": "/aidiet/",
  "icons": [
    { "src": "/aidiet/icon-192x192.png", ... },
    { "src": "/aidiet/icon-512x512.png", ... }
  ]
}
```

**sw.js**:
```javascript
const STATIC_CACHE = [
  '/aidiet/index.html',
  '/aidiet/questionnaire.html',
  '/aidiet/icon-192x192.png',
  '/aidiet/icon-512x512.png',
  '/aidiet/manifest.json',
  // ...
];
```

### Why All Absolute Paths Are Necessary
1. **Consistent resolution**: Absolute paths resolve the same way regardless of current page URL
2. **Service worker scope**: Must match exactly with registration scope
3. **PWA criteria**: Browsers validate manifest accessibility using absolute URLs
4. **GitHub Pages subdirectory**: Relative paths can fail in `/aidiet/` subdirectory context
5. **Reliability**: Eliminates path resolution ambiguity across different page states

## Expected Results

After this fix:
- ✅ Manifest will be accessible at correct URL
- ✅ Icons will load and display properly
- ✅ Service worker will cache resources correctly
- ✅ `beforeinstallprompt` event will fire on Android Chrome/Edge
- ✅ PWA installation will work properly
- ✅ App will appear in home screen with correct icon
- ✅ Offline functionality will work

## Security & Quality Checks

- ✅ JSON syntax validation passed
- ✅ JavaScript syntax validation passed
- ✅ Code review: 0 issues found
- ✅ CodeQL security scan: 0 vulnerabilities
- ✅ No breaking changes to existing functionality

## Rollback Plan

If issues occur, revert by changing paths back:
- `/aidiet/` → `/`

However, this would break the PWA on GitHub Pages deployment.

## Additional Notes

- This fix is specific to GitHub Pages subdirectory deployment
- If deploying to root domain, paths should be `/` (not `/aidiet/`)
- For local testing with `python -m http.server`, use paths starting with `/`
- The fix maintains backward compatibility with all browsers
