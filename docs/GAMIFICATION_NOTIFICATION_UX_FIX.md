# Gamification notification UX — root causes (2026-06)

## Heads-up shows arrows instead of „Да / Не / …”

**Cause:** `android-res/patch-local-notifications.py` replaced Capacitor’s transparent action icon with `android.R.drawable.ic_menu_send` (send arrow). On most Android OEM heads-up layouts, notification actions show **only the icon**, not the label.

**Fix:** Keep `R.drawable.ic_transparent` so the OS renders **text labels** on action buttons. Do not re-introduce visible action icons without per-action distinct icons and labels.

## Quick answer opens empty / without text

**Causes:**

1. **Action button tap** opened `quick-answer.html?auto=…`, which flashed a sub-second silent-save screen (felt empty). **Fix:** Save in place on action tap; open quick-answer only for **body** tap (full question UI).
2. **Card CSS** started at `opacity: 0` waiting for animation; some WebViews never ran the animation → invisible card. **Fix:** Default `opacity: 1`, animate only when motion is allowed.
3. **Cold start** could leave `index.html` with `visibility: hidden` if routing failed. **Fix:** `quick-answer.html` forces visible; body tap clears hidden state before navigate.
4. **Missing fallback copy** if config/scheduler not ready. **Fix:** Inline `FALLBACK_COPY` in `quick-answer.html`.

## APK rebuild note

After pulling these changes, rebuild the Android app so `patch-local-notifications.py` runs and reverts any send-arrow icon in `LocalNotificationManager.java`.
