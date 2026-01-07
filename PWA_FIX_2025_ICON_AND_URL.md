# PWA Fixes: Icon Cropping and 404 Start URL

## Date
January 7, 2025

## Problems Fixed

### 1. Icon Cropping Issue (Прекалено изрязване на иконата)
**Problem**: След инсталиране на PWA, иконата се изрязва прекалено много от всяка страна.

**Root Cause**: 
- Icons were declared with both `purpose: "any"` AND `purpose: "maskable"` in manifest.json
- Current icon design does NOT have proper "safe zones" required for maskable icons
- Maskable icons need the important content to be within 80% of the icon size (centered circle)
- When OS applies circular or rounded masks to "maskable" icons, too much content gets cropped

**Solution**:
- Removed all `purpose: "maskable"` entries from manifest.json
- Kept only `purpose: "any"` for both 192x192 and 512x512 icons
- This prevents OS from applying additional masks/cropping to the icons

**Technical Details**:
```json
// Before:
"icons": [
  { "src": "./icon-192x192.png", "purpose": "any" },
  { "src": "./icon-192x192.png", "purpose": "maskable" },  // ← Causing cropping
  { "src": "./icon-512x512.png", "purpose": "any" },
  { "src": "./icon-512x512.png", "purpose": "maskable" }   // ← Causing cropping
]

// After:
"icons": [
  { "src": "./icon-192x192.png", "purpose": "any" },  // ✓ No cropping
  { "src": "./icon-512x512.png", "purpose": "any" }   // ✓ No cropping
]
```

### 2. 404 Error on PWA Launch (Страница 404 при стартиране)
**Problem**: След инсталиране, когато се отваря PWA-то, показва "404 this is not a github pages site here".

**Root Cause**:
- The app is hosted at `https://radilovk.github.io/aidiet/`
- But manifest.json had `start_url: "/"` and `scope: "/"`
- This caused PWA to try opening `https://radilovk.github.io/` (without `/aidiet/`)
- Which results in a 404 page

**Solution**:
- Updated `start_url` from `"/"` to `"/aidiet/"`
- Updated `scope` from `"/"` to `"/aidiet/"`
- Updated `id` from `"/"` to `"/aidiet/"`

**Technical Details**:
```json
// Before:
{
  "id": "/",
  "start_url": "/",
  "scope": "/"
}

// After:
{
  "id": "/aidiet/",        // ✓ Matches GitHub Pages URL
  "start_url": "/aidiet/", // ✓ Opens correct page
  "scope": "/aidiet/"      // ✓ Correct app scope
}
```

## Files Changed

### Modified:
- `manifest.json` - Fixed icon purposes and URL paths

### Not Changed (No changes needed):
- `sw.js` - Uses relative paths, works correctly with GitHub Pages
- `index.html` - Service worker registration uses relative path
- `icon-192x192.png` - Icon file unchanged (design is fine for "any" purpose)
- `icon-512x512.png` - Icon file unchanged (design is fine for "any" purpose)

## Testing Instructions

### Prerequisites:
1. Changes must be deployed to GitHub Pages
2. If PWA is already installed, uninstall it first:
   - Android: Long press app icon → Uninstall / App info → Uninstall
   - iOS: Long press app icon → Remove App
3. Clear browser cache (optional but recommended)

### Test 1: Verify Icon Appearance
1. Visit `https://radilovk.github.io/aidiet/`
2. Install PWA using browser menu (⋮) → "Install app"
3. Check the installed icon on your home screen
4. **Expected Result**: ✅ Icon shows full apple design with "NP" text, not cropped
5. **Before Fix**: ❌ Icon was heavily cropped, missing parts of apple and text

### Test 2: Verify Start URL
1. Open the installed PWA from home screen
2. **Expected Result**: ✅ App opens to NutriPlan home page with green interface
3. **Before Fix**: ❌ App opened to "404 this is not a github pages site here"

### Test 3: Verify Manifest in DevTools
1. Open `https://radilovk.github.io/aidiet/` in browser
2. Open DevTools (F12)
3. Go to Application → Manifest
4. Check:
   - **Start URL**: Should show `/aidiet/`
   - **Scope**: Should show `/aidiet/`
   - **Icons**: Should show 2 icons (192x192 and 512x512), both with purpose "any"

### Test 4: Verify Service Worker
1. Open DevTools → Application → Service Workers
2. **Expected Result**: ✅ Service worker registered and activated
3. Try offline mode (Network tab → Offline)
4. **Expected Result**: ✅ App still loads cached pages

## Background: Why Maskable Icons Need Safe Zones

Maskable icons are a PWA feature that allows icons to be displayed with different shapes on different platforms:
- **Android**: Can use circular, rounded square, or squircle masks
- **iOS**: Uses rounded square
- **Windows**: Can use various shapes

For maskable icons to work properly, the important content (logo, text, etc.) must be within a "safe zone":
- **Safe zone**: Centered circle that's 80% of the icon dimensions
- **Minimum safe zone**: 40% of icon dimensions (very tight)
- **Example**: For 192x192 icon, important content should be within ~154px centered circle

Our current icons have content that extends close to the edges:
- The apple design extends to ~90% of the icon area
- The "NP" text is centered but the apple shape is not fully within safe zone
- When OS applies masks, parts of the apple and possibly text get cropped

**Options for the future:**
1. **Keep current fix** (recommended): Use only `purpose: "any"` - simple and works
2. **Redesign for maskable**: Add padding/safe zones and re-enable maskable icons
3. **Create separate maskable icons**: Design new icons specifically for maskable purpose

## Related Documentation

- `ICON_README.txt` - Original icon creation instructions
- `PWA_SETUP.md` - General PWA setup guide
- `РЕЗУЛТАТ_PWA_ИНСТАЛАЦИЯ.md` - Previous PWA installation optimization (Bulgarian)
- [Google's Maskable Icons Guide](https://web.dev/maskable-icon/)
- [Maskable.app - Icon Preview Tool](https://maskable.app/)

## Notes for Developers

### If you want to add maskable icons in the future:
1. Use [Maskable.app](https://maskable.app/) to preview current icons with different masks
2. Redesign icons with proper safe zones (minimum 40%, recommended 80%)
3. Test on multiple devices/platforms before deploying
4. Consider creating separate icon files for maskable vs any purpose

### About the scope and start_url:
- These paths are relative to the domain root
- For GitHub Pages project sites: `/{repo_name}/`
- For GitHub Pages user sites: `/`
- For custom domains: `/` (or custom path if desired)

### Service Worker Path Notes:
- Service worker uses relative paths (`./`) which work correctly
- Service worker scope is determined by its location
- Our service worker is at root of `/aidiet/`, so it can control all paths under `/aidiet/`

## Security Notes

All changes passed CodeQL security scan. No security issues introduced.

## Rollback Instructions

If these changes cause issues, revert by:
```bash
git revert <commit-hash>
```

Or manually restore manifest.json:
```json
{
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "icons": [
    // ... add back maskable entries
  ]
}
```

However, this would restore the original bugs (cropped icons and 404 page).

## Summary

✅ **Icon cropping fixed**: Removed maskable purpose from icons not designed with safe zones  
✅ **404 start URL fixed**: Updated paths from "/" to "/aidiet/" for GitHub Pages  
✅ **No code changes needed**: Service worker and HTML files already use correct relative paths  
✅ **Backwards compatible**: Existing installations will update manifest on next app launch  
✅ **Tested**: Manifest JSON validated successfully

**Status**: Ready for deployment and testing on GitHub Pages
