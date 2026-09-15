# AIVA / KASY — Bot Task: Maskable Adaptive APK Icon (Variant A)

> **Repo:** https://github.com/Radilovk/aiva  
> **Branch:** `cursor/adaptive-maskable-icon-e318`  
> **Base:** `main`  
> **Reference commit (if available):** `6c9617c`

---

## Bot prompt (copy-paste to start)

```
Implement Variant A — maskable adaptive APK icon pipeline for KASY (Radilovk/aiva).

Follow AIVA_APK_ICON_BOT_TASK.md in the repo root exactly:
1. Replace circular legacy-only icon scripts with maskable adaptive pipeline (NutriPlan-style).
2. Regenerate frontend/icons and android-res assets.
3. Update build-apk.yml CI verify steps.
4. Add Icon.md and docs/APK_ICON_GUIDE.md.
5. Run verify script, commit all files together, push, open PR to main.

Do NOT commit only PNG binaries. Do NOT keep renderApkCircle() or delete adaptive XML.
```

---

## 1. Problem (why previous attempts failed)

| Issue | Detail |
|-------|--------|
| Wrong docs | `Icon.md` was copy-pasted from NutriPlan (`aidiet`) but Aiva code did the opposite |
| Wrong strategy | Old code used `renderApkCircle()` — pre-shaped circular bitmaps, **no adaptive icons** |
| CI conflict | `build-apk.yml` **forbade** `mipmap-anydpi-v26` and required transparent corners |
| Partial PRs | PR #96 only changed PNG binaries; CI scripts regenerated circular icons on next build |

**Goal:** PWA icon = APK icon. Use **maskable adaptive** pipeline like NutriPlan.

---

## 2. Target architecture

```
brand-assets/source/icon1.png   (1024×1024 robot PNG with alpha)
         │
         ├─ process-brand-assets.mjs
         │     └─ frontend/icons/icon-512.png   (512×512 maskable, opaque #050508)
         │
         └─ generate-android-apk-assets.mjs
               ├─ mipmap-*/ic_launcher.png           (48dp legacy, maskable composite)
               ├─ mipmap-*/ic_launcher_foreground.png  (108dp adaptive foreground)
               └─ mipmap-anydpi-v26/ic_launcher.xml    (adaptive icon definition)
```

### Constants (locked)

| Constant | Value | Meaning |
|----------|-------|---------|
| `APK_ICON_BG` | `#050508` | Opaque background (adaptive + maskable) |
| `SAFE_ZONE_FILL` | `2/3` (66.7%) | Google adaptive safe zone (72dp / 108dp) |
| `ADAPTIVE_DP` | `108` | Foreground layer canvas |
| `LEGACY_DP` | `48` | Legacy launcher bitmap |

### Size table (xxxhdpi = scale 4)

| Resource | dp | px @ xxxhdpi |
|----------|-----|--------------|
| `ic_launcher.png` | 48 | 192 |
| `ic_launcher_foreground.png` | 108 | 432 |

---

## 3. Files to change (complete list)

### 3.1 Scripts — REPLACE entire files

| File | Action |
|------|--------|
| `scripts/lib/android-icon.mjs` | Replace with maskable adaptive version (§4.1) |
| `scripts/lib/brand-icon-prep.mjs` | Change `APP_ICON_FILL` from `0.88` to `2/3` (§4.2) |
| `scripts/generate-android-apk-assets.mjs` | Replace — generate adaptive, do NOT delete it (§4.3) |
| `scripts/process-brand-assets.mjs` | Replace — use `renderMaskableSquare` (§4.4) |
| `scripts/verify-apk-icon-preview.mjs` | Replace — check maskable + adaptive (§4.5) |
| `scripts/audit-apk.mjs` | Replace — require adaptive XML in APK (§4.6) |

### 3.2 CI

| File | Action |
|------|--------|
| `.github/workflows/build-apk.yml` | Update `Verify launcher icon resources` step (§4.7) |

### 3.3 Docs — CREATE or REPLACE

| File | Action |
|------|--------|
| `Icon.md` | Replace NutriPlan copy with Aiva spec (§4.8) |
| `docs/APK_ICON_GUIDE.md` | Create AI playbook (§4.9) |

### 3.4 Generated assets — REGENERATE and commit

```bash
npm install --prefix workers
node scripts/process-brand-assets.mjs
node scripts/generate-android-apk-assets.mjs android-res
node scripts/verify-apk-icon-preview.mjs
```

Commit these outputs together with scripts:

- `frontend/icons/icon-192.png`
- `frontend/icons/icon-512.png`
- `frontend/icons/icon-512.webp`
- `frontend/icons/apple-touch-icon.png`
- `frontend/icons/ic-stat-notification.png`
- `android-res/mipmap-*/ic_launcher.png`
- `android-res/mipmap-*/ic_launcher_round.png`
- `android-res/mipmap-*/ic_launcher_foreground.png` **(NEW)**
- `android-res/mipmap-anydpi-v26/ic_launcher.xml` **(NEW)**
- `android-res/mipmap-anydpi-v26/ic_launcher_round.xml` **(NEW)**
- `android-res/drawable-*/ic_stat_aiva.png`
- `android-res/values/colors.xml`

### 3.5 Do NOT change (unless broken)

- `android-res/patch-local-notifications.py` — already sets `roundIcon` and removes Capacitor vector fg
- `capacitor.config.json` — `smallIcon: ic_stat_aiva`, `iconColor: #ff3b5c`
- `frontend/manifest.json` — keep `"purpose": "any maskable"` on icon-512.png

---

## 4. File contents

### 4.1 `scripts/lib/android-icon.mjs`

Replace entire file. Key exports:

- `renderMaskableSquare()` — opaque `#050508` + art at 66.7%
- `renderAdaptiveForeground()` — transparent canvas + art at 66.7%
- `renderLegacyLauncher()` — alias for maskable square
- `resolveMasterIcon()` — checks `icon1.png` → `icon-512.png` → `PSX_*.png`
- **Remove:** `renderApkCircle()`, `glowDiscSvg()`, `APK_CIRCLE_FILL`

```javascript
/**
 * Android launcher icon — maskable adaptive pipeline (NutriPlan-style).
 */
import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimAlphaArt } from './brand-icon-prep.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

export const APP_WINDOW_BG = '#050508';
export const APK_ICON_BG = '#050508';
export const SAFE_ZONE_FILL = 2 / 3;
export const ADAPTIVE_DP = 108;
export const LEGACY_DP = 48;

export const DENSITY_SCALES = [
  ['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4],
];

export const MASTER_ICON_CANDIDATES = [
  join(ROOT, 'brand-assets', 'source', 'icon1.png'),
  join(ROOT, 'brand-assets', 'source', 'icon-512.png'),
  join(ROOT, 'PSX_20260805_210455.png'),
  join(ROOT, 'brand-assets', 'source', 'PSX_20260805_210455.png'),
];

// ... implement parseBg, fitArtOnCanvas, renderMaskableSquare,
// renderAdaptiveForeground, renderLegacyLauncher, resolveMasterIcon
// (full 108-line file — see reference implementation)
```

> **Bot:** Copy the complete file from reference branch `cursor/adaptive-maskable-icon-e318` or regenerate from §4.1 structure.

---

### 4.2 `scripts/lib/brand-icon-prep.mjs`

**One-line change:**

```diff
- export const APP_ICON_FILL = 0.88;
+ /** Google adaptive / maskable safe zone (72dp of 108dp). */
+ export const APP_ICON_FILL = 2 / 3;
```

---

### 4.3 `scripts/generate-android-apk-assets.mjs`

**Remove:**
- `renderApkCircle` import
- `removeAdaptiveIconResources()` function and its calls
- Circular icon log messages

**Add:**
- `writeAdaptiveForeground()` — 108dp × scale per density
- `writeAdaptiveXml()` — creates `mipmap-anydpi-v26/ic_launcher.xml`
- `mirrorToAndroidRes()` — includes foreground PNGs + adaptive XML

**Adaptive XML template:**

```xml
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
```

**`writeBrandColors()` must write both:**

```xml
<!-- values/colors.xml -->
<color name="app_background">#050508</color>
<color name="ic_launcher_background">#050508</color>
```

---

### 4.4 `scripts/process-brand-assets.mjs`

**Remove:**
- `renderApkLegacy` (circular) imports and usage
- Log: "circular neon disc, transparent corners"

**Add:**
- Import `renderMaskableSquare`, `renderLegacyLauncher`, `SAFE_ZONE_FILL`, `resolveMasterIcon`
- Add `icon1.png` to `ICON_512_CANDIDATES` (first priority)
- Generate PWA icons via `renderMaskableSquare(masterForApk, size)`
- `apple-touch-icon.png` via `renderLegacyLauncher(masterForApk, 180)`

---

### 4.5 `scripts/verify-apk-icon-preview.mjs`

**Old checks (DELETE):**
- `corners transparent (round icon)`
- `disc opaque at center`

**New checks (ADD):**
- Legacy 192×192, **corners opaque** (maskable tile)
- Foreground 432×432, **corners transparent**
- Foreground has artwork in center region (`hasOpaqueCenter()` — art may not cover exact pixel center)

---

### 4.6 `scripts/audit-apk.mjs`

**Old checks (DELETE):**
- `launcher icon is round (transparent corners)`
- `no adaptive icon XML`

**New checks (ADD):**
- `adaptive foreground is 432×432`
- `adaptive icon XML present`
- `adaptive background uses @color`
- Legacy corners **opaque** (not transparent)

---

### 4.7 `.github/workflows/build-apk.yml`

Replace the `Verify launcher icon resources` step:

```yaml
      - name: Verify launcher icon resources
        run: |
          grep -q '#050508' android/app/src/main/res/values/colors.xml
          test -f android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
          test -f android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png
          test -f android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png
          test -f android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
          grep -q 'android:windowBackground">@color/app_background' android/app/src/main/res/values/styles.xml
          ! test -f android/app/src/main/res/drawable/splash.xml
          ! test -f android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml
          node scripts/verify-apk-icon-preview.mjs
```

**OLD step to remove (do NOT keep):**

```yaml
          ! test -e android/app/src/main/res/mipmap-anydpi-v26        # WRONG — forbids adaptive
          ! test -f .../ic_launcher_foreground.png                     # WRONG — forbids foreground
          grep -q '#050508' .../ic_launcher_background.xml             # OK but prefer colors.xml
```

---

### 4.8 `Icon.md`

Create/replace with Aiva-specific spec. Must state:

- Master: `brand-assets/source/icon1.png`
- Strategy: maskable adaptive (NOT circular legacy)
- Safe zone: 66.7%
- Scripts run order
- What NOT to do

(See §7 for minimal version to commit.)

---

### 4.9 `docs/APK_ICON_GUIDE.md`

Create AI playbook with:

- Diagnosis checklist
- Common failure table
- 6-step fix procedure
- Anti-patterns list
- Success criteria checklist

---

## 5. Execution steps for the bot

```bash
# 1. Branch
git checkout main && git pull
git checkout -b cursor/adaptive-maskable-icon-e318

# 2. Apply all script + CI + doc changes (§3, §4)

# 3. Regenerate assets
npm install --prefix workers
node scripts/process-brand-assets.mjs
node scripts/generate-android-apk-assets.mjs android-res
node scripts/verify-apk-icon-preview.mjs
# Expected: 6/6 checks pass

# 4. Commit EVERYTHING together
git add scripts/ .github/ Icon.md docs/APK_ICON_GUIDE.md \
        frontend/icons/icon-*.png frontend/icons/apple-touch-icon.png \
        frontend/icons/ic-stat-notification.png frontend/icons/icon-512.webp \
        android-res/mipmap-* android-res/drawable-* android-res/values/colors.xml
git commit -m "Adopt maskable adaptive icon pipeline (NutriPlan-style)"

# 5. Push + PR
git push -u origin cursor/adaptive-maskable-icon-e318
# Open PR to main
```

---

## 6. Verification checklist

Before opening PR, confirm:

- [ ] `node scripts/verify-apk-icon-preview.mjs` → 0 failures
- [ ] `test -f android-res/mipmap-anydpi-v26/ic_launcher.xml`
- [ ] `test -f android-res/mipmap-xxxhdpi/ic_launcher_foreground.png`
- [ ] `grep -q ic_launcher_background android-res/values/colors.xml`
- [ ] No `renderApkCircle` in any script
- [ ] No `removeAdaptiveIconResources` in generate script
- [ ] `frontend/icons/icon-512.png` corners are opaque (not transparent)
- [ ] PWA manifest: `"purpose": "any maskable"`

Optional full APK test:

```bash
npx cap add android && npx cap sync android
node scripts/generate-android-apk-assets.mjs android/app/src/main/res
python3 android-res/patch-local-notifications.py
cd android && ./gradlew assembleRelease
node scripts/audit-apk.mjs android/app/build/outputs/apk/release/app-release.apk
```

---

## 7. PR description template

```markdown
## Summary

Replaces circular legacy-only launcher icons with maskable adaptive pipeline (NutriPlan-style).

- Opaque `#050508` background, artwork at 66.7% safe zone
- Legacy mipmaps + adaptive foreground (108dp) + mipmap-anydpi-v26 XML
- PWA and APK icons from same master (`brand-assets/source/icon1.png`)
- CI verify/audit updated to require adaptive resources

## Docs

- `Icon.md` — locked Aiva spec
- `docs/APK_ICON_GUIDE.md` — AI assistant playbook

## Testing

- [x] `node scripts/verify-apk-icon-preview.mjs` passes
- [x] Regenerated frontend/icons + android-res assets
```

---

## 8. Anti-patterns (do NOT do)

| ❌ Don't | Why |
|---------|-----|
| Copy NutriPlan `Icon.md` without changing scripts | Docs ≠ code |
| Commit only `android-res/mipmap-*/ic_launcher.png` | CI regenerates from scripts |
| Keep `renderApkCircle()` | Wrong strategy for Variant A |
| Delete `mipmap-anydpi-v26` | Breaks API 26+ launchers |
| CI step `! test -e mipmap-anydpi-v26` | Actively blocks Variant A |
| Use `frontend/icons/*` as generation input | Outputs, not sources |
| White background `#FFFFFF` | Wrong brand color for KASY |

---

## 9. Quick reference: old vs new

| | OLD (broken) | NEW (Variant A) |
|---|-------------|-----------------|
| Render function | `renderApkCircle()` | `renderMaskableSquare()` |
| Icon shape | Circular, transparent corners | Square maskable, opaque corners |
| Adaptive XML | Deleted intentionally | **Required** |
| Safe zone | 88% | **66.7%** |
| Master file | `icon-512.png` only | **`icon1.png` first** |
| CI verify | Forbids adaptive | **Requires adaptive** |

---

## 10. Source files in repo

Ensure these exist before running scripts:

| File | Required |
|------|----------|
| `brand-assets/source/icon1.png` | Preferred (1024×1024) |
| `brand-assets/source/icon-512.png` | Fallback |
| `brand-assets/source/icon-192.png` | For notifications |
| `PSX_20260805_210455.png` | Root fallback |

If `icon1.png` missing, bot should use `icon-512.png` or PSX export — pipeline will still work via `MASTER_ICON_CANDIDATES` fallback chain.

---

## 11. Success criteria

Task is complete when:

1. All files in §3 are updated and committed
2. `verify-apk-icon-preview.mjs` passes locally and in CI
3. APK build workflow `Verify launcher icon resources` passes
4. `audit-apk.mjs` passes on release APK (if full build run)
5. PR merged to `main`
6. New APK release shows correct icon on install screen + home screen

---

*Generated for Radilovk/aiva — maskable adaptive icon migration (Variant A).*
