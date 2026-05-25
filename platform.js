/**
 * NutriPlan Platform Utility
 * Централизирано засичане на платформа (APK / PWA / Web) и адаптери за
 * ключови cross-platform операции.
 *
 * Използване:
 *   NutriPlanPlatform.platform   // 'apk' | 'pwa' | 'web'
 *   NutriPlanPlatform.isAPK      // true когато Capacitor native
 *   NutriPlanPlatform.isPWA      // true когато инсталиран standalone
 *   NutriPlanPlatform.isWeb      // true когато обикновен браузър
 *   NutriPlanPlatform.on('apk', fn)            // изпълни fn само в APK
 *   NutriPlanPlatform.on(['pwa','web'], fn)     // изпълни fn в PWA и Web
 *   NutriPlanPlatform.vibrate({ style: 'LIGHT' | 'MEDIUM' | 'HEAVY', duration: ms })
 *   NutriPlanPlatform.navigate(url)             // навигация (пробва shell-а)
 */
(function (global) {
    'use strict';

    // ── 1. Platform detection ──────────────────────────────────────────────
    var isAPK = !!(
        global.Capacitor &&
        typeof global.Capacitor.isNativePlatform === 'function' &&
        global.Capacitor.isNativePlatform()
    );

    var isPWA = !isAPK && (
        (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) ||
        global.navigator.standalone === true
    );

    var isWeb = !isAPK && !isPWA;
    var platform = isAPK ? 'apk' : (isPWA ? 'pwa' : 'web');

    // Маркираме <html> с data-platform за CSS условна визуализация
    if (document.documentElement) {
        document.documentElement.setAttribute('data-platform', platform);
    }

    // ── 2. on(platforms, fn) ───────────────────────────────────────────────
    function on(platforms, fn) {
        var list = Array.isArray(platforms) ? platforms : [platforms];
        if (list.indexOf(platform) !== -1) {
            fn(platform);
        }
    }

    // ── 3. vibrate(options) ───────────────────────────────────────────────
    // options: { style: 'LIGHT'|'MEDIUM'|'HEAVY', duration: <ms> }
    function vibrate(options) {
        options = options || {};
        if (isAPK) {
            var Haptics = global.Capacitor &&
                global.Capacitor.Plugins &&
                global.Capacitor.Plugins.Haptics;
            if (Haptics && typeof Haptics.impact === 'function') {
                Haptics.impact({ style: options.style || 'MEDIUM' }).catch(function () {});
                return;
            }
        }
        var duration = typeof options.duration === 'number' ? options.duration : 30;
        if (global.navigator && global.navigator.vibrate) {
            global.navigator.vibrate(duration);
        }
    }

    // ── 4. navigate(url) ──────────────────────────────────────────────────
    // В iframe shell изпраща NUTRIPLAN_NAVIGATE; иначе директна навигация.
    function navigate(url) {
        if (global.parent && global.parent !== global) {
            global.parent.postMessage(
                { type: 'NUTRIPLAN_NAVIGATE', url: url },
                global.location.origin
            );
            return;
        }
        global.location.href = url;
    }

    // ── Public API ─────────────────────────────────────────────────────────
    global.NutriPlanPlatform = {
        platform: platform,
        isAPK: isAPK,
        isPWA: isPWA,
        isWeb: isWeb,
        on: on,
        vibrate: vibrate,
        navigate: navigate
    };

}(window));
