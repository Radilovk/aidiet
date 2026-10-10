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

    /** Връща Capacitor плъгин по име или null ако не съществува. */
    function getPlugin(name) {
        try {
            var cap = getCap();
            if (!cap) return null;
            var plugin = cap.Plugins && cap.Plugins[name];
            if (!plugin && typeof cap.registerPlugin === 'function') {
                try { plugin = cap.registerPlugin(name); } catch (_) {}
            }
            return plugin || null;
        } catch (_) { return null; }
    }

    /**
     * Fully close native APK after notification/quick-answer flows.
     * Uses finishAndRemoveTask (patched App plugin) — never leaves a background task.
     */
    function exitNativeApp() {
        if (!isAPK()) return false;
        try {
            if (document.documentElement) {
                document.documentElement.style.visibility = 'hidden';
                document.documentElement.style.background = '#0A1A1A';
            }
            var app = getPlugin('App');
            if (app && typeof app.exitApp === 'function') {
                app.exitApp().catch(function () {});
                return true;
            }
        } catch (_) {}
        return false;
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

    // ── Notification catch-up (PWA / web / embedded tabs) ─────────────────

    function shouldLoadNotificationCatchUp() {
        try {
            if (!localStorage.getItem('dietPlan')) return false;
        } catch (_) {
            return false;
        }
        var path = (global.location && global.location.pathname) || '';
        if (path.indexOf('quick-answer') !== -1) return false;
        if (/admin|notifications-test|questionnaire/i.test(path)) return false;
        return true;
    }

    function runNotificationCatchUpIfReady() {
        if (!shouldLoadNotificationCatchUp()) return Promise.resolve(false);
        if (global.GameNotifier && typeof global.GameNotifier.runOpenAppCatchUpFlow === 'function') {
            return global.GameNotifier.runOpenAppCatchUpFlow();
        }
        return new Promise(function (resolve) {
            function runWhenReady() {
                resolve(global.GameNotifier && global.GameNotifier.runOpenAppCatchUpFlow
                    ? global.GameNotifier.runOpenAppCatchUpFlow()
                    : false);
            }
            if (global.GameNotifier) {
                runWhenReady();
                return;
            }
            var tagged = document.querySelector('script[data-np-local-scheduler]');
            var pending = document.querySelector('script[src*="local-scheduler.js"]');
            var existing = tagged || pending;
            if (existing) {
                existing.addEventListener('load', runWhenReady, { once: true });
                return;
            }
            var script = document.createElement('script');
            script.src = './local-scheduler.js';
            script.async = true;
            script.setAttribute('data-np-local-scheduler', '1');
            script.onload = runWhenReady;
            script.onerror = function () { resolve(false); };
            (document.head || document.documentElement).appendChild(script);
        });
    }

    function bindNotificationCatchUpBootstrap() {
        if (global.__nutriplanPlatformCatchUpBound) return;
        global.__nutriplanPlatformCatchUpBound = true;
        function schedule() { runNotificationCatchUpIfReady(); }
        global.addEventListener('visibilitychange', function () {
            if (global.document.visibilityState === 'visible') schedule();
        });
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', schedule, { once: true });
        } else {
            setTimeout(schedule, 80);
        }
    }

    bindNotificationCatchUpBootstrap();

    // ── Бутон „Назад“ на Android (APK) ──────────────────────────────────────
    // Без собствен слушател Capacitor затваря приложението, ако няма история —
    // клиентът губи отворения прозорец. Редът: страницата затваря свой прозорец
    // (NutriPlanHandleBack), обвивката връща към плана (NutriPlanShellBack),
    // иначе предишната страница; накрая приложението само се минимизира.
    function handleHardwareBack(event) {
        try {
            if (typeof global.NutriPlanShellBack === 'function' && global.NutriPlanShellBack()) return;
            if (typeof global.NutriPlanHandleBack === 'function' && global.NutriPlanHandleBack()) return;
        } catch (_) {}
        if ((event && event.canGoBack) || global.history.length > 1) {
            global.history.back();
            return;
        }
        var app = getPlugin('App');
        if (app && typeof app.minimizeApp === 'function') {
            app.minimizeApp().catch(function () {});
        } else if (app && typeof app.exitApp === 'function') {
            app.exitApp().catch(function () {});
        }
    }

    function bindHardwareBack() {
        if (global.top !== global || global.__nutriplanBackBound || !isAPK()) return;
        var app = getPlugin('App');
        if (!app || typeof app.addListener !== 'function') return;
        global.__nutriplanBackBound = true;
        try { app.addListener('backButton', handleHardwareBack); } catch (_) {}
    }

    bindHardwareBack();

    // ── Лента „Без връзка“ ─────────────────────────────────────────────────
    // Само в горния прозорец (обвивката или самостоятелна страница), за да не
    // се дублира във всеки таб. Планът е записан локално и продължава да работи.
    function bindOfflineBar() {
        if (global.top !== global || global.__nutriplanOfflineBound || !global.document) return;
        global.__nutriplanOfflineBound = true;
        var bar = null;
        function show() {
            if (bar || !global.document.body) return;
            bar = global.document.createElement('div');
            bar.id = 'npOfflineBar';
            bar.setAttribute('role', 'status');
            bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:10050;' +
                'padding:calc(6px + env(safe-area-inset-top,0px)) 16px 6px;' +
                'background:#334155;color:#fff;font:600 13px/1.4 system-ui,sans-serif;text-align:center;';
            bar.textContent = 'Без връзка — показваме последно запазения план. Отметките се пазят на телефона.';
            global.document.body.appendChild(bar);
        }
        function hide() {
            if (bar) { bar.remove(); bar = null; }
        }
        global.addEventListener('offline', show);
        global.addEventListener('online', hide);
        function initial() { if (global.navigator && global.navigator.onLine === false) show(); }
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', initial, { once: true });
        } else {
            initial();
        }
    }

    bindOfflineBar();

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
        exitNativeApp: exitNativeApp,
        setNavBar: setNavBar,
        vibrate: vibrate,
        apply: apply,
        runNotificationCatchUpIfReady: runNotificationCatchUpIfReady
    };

}(typeof window !== 'undefined' ? window : this));
