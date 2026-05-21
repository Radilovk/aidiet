/**
 * NativeBackup – запазва ключовите localStorage стойности в Capacitor Preferences
 * (Android SharedPreferences), така че да оцелеят след деинсталация или ъпдейт.
 *
 * Активен само когато приложението работи като нативен Capacitor APK.
 *
 * Употреба (в началото на всяка HTML страница, ПРЕДИ основния скрипт):
 *   <script src="./native-backup.js"></script>
 *
 * След зареждане на страницата, преди четене на план данни:
 *   await NativeBackup.init();
 */
const NativeBackup = (function () {
    // Ключове, които се запазват за оцеляване при деинсталация
    const PLAN_KEYS = [
        'dietPlan',
        'userId',
        'userData',
        'planHistory',
        'planJustification',
        'longTermStrategy',
        'modifierReasoning',
        'hydrationStrategy',
        'mealCountJustification',
        'afterDinnerMealJustification',
        'planSource',
        'hasSeenPlanJustification',
        'gameNotifierConfig',
    ];

    // Префикс на динамичните ключове за добавени храни по дати
    const ADDED_MEALS_PREFIX = 'addedMeals_';
    const PRIMARY_KEYS = ['dietPlan', 'userId', 'userData'];
    const PREFS_KEYS_TIMEOUT_MS = 350;
    const PREFS_GET_TIMEOUT_MS = 120;
    const RESTORE_BUDGET_MS = 1200;

    // Оригиналните методи – запазени преди евентуален hooking
    const _origSet = localStorage.setItem.bind(localStorage);
    const _origRemove = localStorage.removeItem.bind(localStorage);

    let _prefs = null;
    let _hooked = false;

    function _isNative() {
        return !!(
            typeof window !== 'undefined' &&
            window.Capacitor &&
            typeof window.Capacitor.isNativePlatform === 'function' &&
            window.Capacitor.isNativePlatform()
        );
    }

    function _getPlugin() {
        if (_prefs) return _prefs;
        if (!_isNative()) return null;
        try {
            const cap = window.Capacitor;
            const fromPlugins = cap.Plugins && cap.Plugins.Preferences;
            if (fromPlugins) {
                _prefs = fromPlugins;
            } else if (typeof cap.registerPlugin === 'function') {
                const registered = cap.registerPlugin('Preferences');
                if (registered) _prefs = registered;
            }
        } catch (_) {}
        return _prefs;
    }

    function _shouldBackup(key) {
        return PLAN_KEYS.includes(key) || key.startsWith(ADDED_MEALS_PREFIX);
    }

    function _hasPrimaryData() {
        return PRIMARY_KEYS.some(function (key) {
            return localStorage.getItem(key) !== null;
        });
    }

    function _withTimeout(promise, timeoutMs, fallbackValue) {
        return Promise.race([
            promise,
            new Promise(function (resolve) {
                setTimeout(function () { resolve(fallbackValue); }, timeoutMs);
            })
        ]);
    }

    function _installHook() {
        if (_hooked) return;
        _hooked = true;
        localStorage.setItem = function (key, value) {
            _origSet(key, value);
            if (_shouldBackup(key)) {
                const prefs = _getPlugin();
                if (prefs) prefs.set({ key, value }).catch(function () {});
            }
        };
        localStorage.removeItem = function (key) {
            _origRemove(key);
            if (_shouldBackup(key)) {
                const prefs = _getPlugin();
                if (prefs) prefs.remove({ key }).catch(function () {});
            }
        };
    }

    /**
     * Възстановява стойностите от Preferences в localStorage,
     * само ако localStorage вече не съдържа съответния ключ.
     */
    async function restore() {
        const prefs = _getPlugin();
        if (!prefs) return;
        if (_hasPrimaryData()) return;

        // Събери пълния списък с ключове: фиксирани + запазени addedMeals_*
        const allKeys = PLAN_KEYS.slice();
        try {
            const result = await _withTimeout(prefs.keys(), PREFS_KEYS_TIMEOUT_MS, null);
            if (result && result.keys) {
                result.keys
                    .filter(function (k) { return k.startsWith(ADDED_MEALS_PREFIX); })
                    .forEach(function (k) { if (!allKeys.includes(k)) allKeys.push(k); });
            }
        } catch (_) {}

        const startedAt = Date.now();
        for (let i = 0; i < allKeys.length; i++) {
            if (Date.now() - startedAt >= RESTORE_BUDGET_MS) break;
            const key = allKeys[i];
            if (localStorage.getItem(key) !== null) continue;
            try {
                const remaining = Math.max(1, RESTORE_BUDGET_MS - (Date.now() - startedAt));
                const result = await _withTimeout(
                    prefs.get({ key: key }),
                    Math.min(PREFS_GET_TIMEOUT_MS, remaining),
                    null
                );
                if (result && result.value !== null && result.value !== undefined) {
                    // Използваме оригиналния setItem, за да не предизвикаме излишно prefs.set
                    _origSet(key, result.value);
                }
            } catch (_) {}
        }
    }

    /**
     * Инициализира NativeBackup:
     *  1. Инсталира hook върху localStorage.setItem / removeItem.
     *  2. Възстановява запазените стойности в localStorage (ако е празен след преинсталация).
     *
     * Извикай с await в началото на DOMContentLoaded, преди да четеш план данни.
     */
    async function init() {
        if (!_isNative()) return;
        _installHook();
        await restore();
    }

    return { init: init, restore: restore };
})();
