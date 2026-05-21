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
    const INIT_TIMEOUT_MS = 1200;
    const PREFS_CALL_TIMEOUT_MS = 350;
    const PRIMARY_KEYS = ['dietPlan', 'userData', 'userId', 'planSource', 'planHistory'];

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

    // Оригиналните методи – запазени преди евентуален hooking
    const _origSet = localStorage.setItem.bind(localStorage);
    const _origRemove = localStorage.removeItem.bind(localStorage);

    let _prefs = null;
    let _hooked = false;
    let _initPromise = null;

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
        for (let i = 0; i < PRIMARY_KEYS.length; i++) {
            if (localStorage.getItem(PRIMARY_KEYS[i]) !== null) return true;
        }
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(ADDED_MEALS_PREFIX)) return true;
        }
        return false;
    }

    function _withTimeout(promise, timeoutMs) {
        let timerId = null;
        return Promise.race([
            Promise.resolve(promise),
            new Promise(function (resolve) {
                timerId = setTimeout(function () { resolve(null); }, timeoutMs);
            })
        ]).finally(function () {
            if (timerId !== null) clearTimeout(timerId);
        });
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

        // Събери пълния списък с ключове: фиксирани + запазени addedMeals_*
        const allKeys = PLAN_KEYS.slice();
        try {
            const result = await _withTimeout(prefs.keys(), PREFS_CALL_TIMEOUT_MS);
            if (result && result.keys) {
                result.keys
                    .filter(function (k) { return k.startsWith(ADDED_MEALS_PREFIX); })
                    .forEach(function (k) { if (!allKeys.includes(k)) allKeys.push(k); });
            }
        } catch (_) {}

        for (let i = 0; i < allKeys.length; i++) {
            const key = allKeys[i];
            if (localStorage.getItem(key) !== null) continue;
            try {
                const result = await _withTimeout(prefs.get({ key: key }), PREFS_CALL_TIMEOUT_MS);
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
        if (_hasPrimaryData()) return;
        if (!_initPromise) {
            _initPromise = _withTimeout(restore(), INIT_TIMEOUT_MS);
        }
        await _initPromise;
    }

    return { init: init, restore: restore };
})();
