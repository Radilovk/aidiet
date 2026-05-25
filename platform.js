/**
 * NutriPlan Cross-Platform Adapter
 * ---------------------------------
 * Централизирано разпознаване на платформата (APK / PWA / Web) и
 * еднотипен механизъм за адаптиране на функционалност между тях.
 *
 * Употреба:
 *   NutriPlanPlatform.getMode()         → 'apk' | 'pwa' | 'web'
 *   NutriPlanPlatform.apply({
 *       apk: () => { ... },   // само в Capacitor APK
 *       pwa: () => { ... },   // само в инсталирано PWA
 *       web: () => { ... },   // само в обикновен браузър
 *       // или:
 *       all: () => { ... }    // на всички платформи
 *   });
 */
(function (global) {
    'use strict';

    // ── Основно разпознаване ───────────────────────────────────────────────

    /** Връща Capacitor обекта — от текущия прозорец или от top (при iframe). */
    function getCap() {
        return global.Capacitor || (global.top && global.top.Capacitor) || null;
    }

    function isAPK() {
        try {
            var cap = getCap();
            return !!(cap &&
                typeof cap.isNativePlatform === 'function' &&
                cap.isNativePlatform());
        } catch (_) { return false; }
    }

    function isPWA() {
        try {
            return (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) ||
                   global.navigator.standalone === true;
        } catch (_) { return false; }
    }

    function isWeb() {
        return !isAPK() && !isPWA();
    }

    // ── Устройство ─────────────────────────────────────────────────────────

    function isIOS() {
        return /iPhone|iPad|iPod/i.test(navigator.userAgent);
    }

    function isAndroid() {
        return /Android/i.test(navigator.userAgent);
    }

    function isHuawei() {
        return /huawei/i.test(navigator.userAgent) || /harmony/i.test(navigator.userAgent);
    }

    // ── Лейбъл и mode ──────────────────────────────────────────────────────

    /** Връща 'apk' | 'pwa' | 'web' */
    function getMode() {
        if (isAPK()) return 'apk';
        if (isPWA()) return 'pwa';
        return 'web';
    }

    // ── Безопасен достъп до Capacitor плъгин ───────────────────────────────

    /** Връща Capacitor плъгин по име или null ако не съществува.
     *  Ако плъгинът не е регистриран (dist/plugin.js не е зареден), го регистрира
     *  lazily така че native bridge да продължи да работи — работи и от iframe контекст
     *  чрез window.top.Capacitor. */
    function getPlugin(name) {
        try {
            var cap = getCap();
            if (!cap) return null;
            if (!cap.Plugins[name] && typeof cap.registerPlugin === 'function') {
                cap.registerPlugin(name, {});
            }
            return cap.Plugins[name] || null;
        } catch (_) { return null; }
    }

    // ── Навигационна лента (APK-only) ──────────────────────────────────────

    /**
     * Задава цвят на системната навигационна лента.
     * На APK използва Capacitor NavigationBar плъгин; на PWA/Web — no-op.
     *
     * @param {string} color   HEX цвят, напр. '#F0FDFA'
     * @param {boolean} [isDark=false]  true = тъмни бутони (светла лента)
     */
    function setNavBar(color, isDark) {
        if (!isAPK()) return;
        try {
            var navBar = getPlugin('NavigationBar');
            if (navBar && typeof navBar.setNavigationBarColor === 'function') {
                navBar.setNavigationBarColor({ color: color, darkButtons: isDark !== false });
            }
        } catch (_) {}
    }

    // ── Вибрация / хаптика ─────────────────────────────────────────────────

    /**
     * Вибрира устройството.
     * На APK — Capacitor Haptics (ако е наличен), иначе navigator.vibrate.
     * На PWA/Web — navigator.vibrate.
     *
     * @param {number} [ms=50]  Продължителност в мс (за navigator.vibrate)
     */
    function vibrate(ms) {
        try {
            var haptics = isAPK() ? getPlugin('Haptics') : null;
            if (haptics && typeof haptics.vibrate === 'function') {
                haptics.vibrate({ duration: ms || 50 });
            } else if (navigator.vibrate) {
                navigator.vibrate(ms || 50);
            }
        } catch (_) {}
    }

    // ── Основна функция: apply ─────────────────────────────────────────────

    /**
     * Изпълнява handler-а, съответстващ на текущата платформа.
     *
     * @param {Object} handlers  Обект с ключове 'apk', 'pwa', 'web' и/или 'all'.
     *                           'all' се използва само когато няма специфичен ключ за платформата.
     * @param {*}      [context] Опционален this контекст за извикване на handler-а.
     */
    function apply(handlers, context) {
        if (!handlers || typeof handlers !== 'object') return;
        var mode = getMode();
        var fn = handlers[mode];
        if (typeof fn !== 'function') fn = handlers.all;
        if (typeof fn === 'function') fn.call(context || null, mode);
    }

    // ── Публично API ────────────────────────────────────────────────────────

    global.NutriPlanPlatform = {
        isAPK: isAPK,
        isPWA: isPWA,
        isWeb: isWeb,
        isIOS: isIOS,
        isAndroid: isAndroid,
        isHuawei: isHuawei,
        getMode: getMode,
        getPlugin: getPlugin,
        setNavBar: setNavBar,
        vibrate: vibrate,
        apply: apply
    };

}(typeof window !== 'undefined' ? window : this));
