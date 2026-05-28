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
    const PLAN_KEYS = (typeof window !== 'undefined' &&
        window.NutriPlanSession &&
        typeof window.NutriPlanSession.getManagedStorageKeys === 'function'
        ? window.NutriPlanSession.getManagedStorageKeys()
        : [
        'dietPlan',
        'userId',
        'userData',
        'pendingClientId',
        'planJobId',
        'planJobSource',
        'pendingPlanPayload',
        'questionnaireAnswers',
        'warningData',
        'canProceedWithWarning',
        'validationSource',
        'planHistory',
        'planJustification',
        'longTermStrategy',
        'modifierReasoning',
        'hydrationStrategy',
        'mealCountJustification',
        'afterDinnerMealJustification',
        'planSource',
        'hasSeenPlanJustification',
        'authKvSynced',
        'np_profile_synced',
        'np_profile_sync_sig',
        'planSyncPending',
        'theme',
        'colorScheme',
        'profileAvatar',
        'profilePhotoURL',
        'profilePhotoUid',
        'gameEnabled',
        'gameData',
        'gameWeeklyAI',
        'gameNotifierConfig',
    ]).slice();
    const PRIMARY_KEYS = [
        'dietPlan',
        'pendingClientId',
        'planJobId'
    ];
    /* Identity key that must also be present before we consider localStorage
     * complete.  Without this guard, a stale 'dietPlan' entry (left behind after
     * a web-only logout that cleared userId but not dietPlan) would cause
     * _hasPrimaryData() to return true and skip restoring userId/userData from
     * Capacitor Preferences — leaving the profile page with no session data. */
    const IDENTITY_KEY = 'userId';
    const KEYS_TIMEOUT_MS = 400;
    const GET_TIMEOUT_MS = 250;
    const TOTAL_RESTORE_TIMEOUT_MS = 1800;

    // Префикс на динамичните ключове за добавени храни по дати
    const ADDED_MEALS_PREFIX = 'addedMeals_';

    // Оригиналните методи – запазени преди евентуален hooking
    const _origSet = localStorage.setItem.bind(localStorage);
    const _origRemove = localStorage.removeItem.bind(localStorage);

    let _prefs = null;
    let _hooked = false;
    let _restorePromise = null;
    let _initPromise = null;

    function _getCap() {
        /* Works in both top-level window and embedded iframes (tab frames). */
        return (typeof window !== 'undefined' &&
            (window.Capacitor || (window.top && window.top !== window && window.top.Capacitor))) || null;
    }

    function _isNative() {
        try {
            const cap = _getCap();
            return !!(cap &&
                typeof cap.isNativePlatform === 'function' &&
                cap.isNativePlatform());
        } catch (_) { return false; }
    }

    function _getPlugin() {
        if (_prefs) return _prefs;
        if (!_isNative()) return null;
        try {
            const cap = _getCap();
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
        /* Require BOTH a user identity key AND at least one plan key to be
         * present.  If only plan data is here (e.g. stale dietPlan from a
         * web-only logout that cleared userId) we must still run the restore
         * loop so that userId/userData are recovered from Capacitor Preferences. */
        if (localStorage.getItem(IDENTITY_KEY) === null) return false;
        return PRIMARY_KEYS.some(function (key) {
            return localStorage.getItem(key) !== null;
        });
    }

    function _withTimeout(promise, timeoutMs, fallbackValue) {
        return Promise.race([
            Promise.resolve(promise).catch(function () { return fallbackValue; }),
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
    async function restore(options) {
        options = options || {};
        if (_restorePromise) return _restorePromise;
        const prefs = _getPlugin();
        if (!prefs) return false;
        if (!options.force && _hasPrimaryData()) {
            if (window.NutriPlanDiagnostics) {
                window.NutriPlanDiagnostics.info('native-backup', 'restore-skip', 'Primary keys already present');
            }
            return false;
        }
        if (window.NutriPlanDiagnostics) {
            window.NutriPlanDiagnostics.info('native-backup', 'restore-start', options.force ? 'force' : 'auto');
        }

        _restorePromise = (async function () {
            const timedWork = (async function () {
                // Събери пълния списък с ключове: фиксирани + запазени addedMeals_*
                const allKeys = PLAN_KEYS.slice();
                const result = await _withTimeout(
                    prefs.keys ? prefs.keys() : null,
                    KEYS_TIMEOUT_MS,
                    null
                );
                if (result && result.keys) {
                    result.keys
                        .filter(function (k) { return k.startsWith(ADDED_MEALS_PREFIX); })
                        .forEach(function (k) { if (!allKeys.includes(k)) allKeys.push(k); });
                }

                for (let i = 0; i < allKeys.length; i++) {
                    const key = allKeys[i];
                    if (localStorage.getItem(key) !== null) continue;
                    const item = await _withTimeout(
                        prefs.get ? prefs.get({ key: key }) : null,
                        GET_TIMEOUT_MS,
                        null
                    );
                    if (item && item.value !== null && item.value !== undefined) {
                        // Използваме оригиналния setItem, за да не предизвикаме излишно prefs.set
                        _origSet(key, item.value);
                    }
                }
                return true;
            })();

            return _withTimeout(timedWork, TOTAL_RESTORE_TIMEOUT_MS, false);
        })();

        try {
            const restored = await _restorePromise;
            if (window.NutriPlanDiagnostics) {
                window.NutriPlanDiagnostics[restored ? 'ok' : 'info']('native-backup', 'restore-finish', restored ? 'Restore completed' : 'No values restored');
            }
            return restored;
        } finally {
            _restorePromise = null;
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
        if (_initPromise) return _initPromise;
        if (!_isNative()) return Promise.resolve(false);
        _installHook();
        if (window.NutriPlanDiagnostics) {
            window.NutriPlanDiagnostics.info('native-backup', 'init-start', 'Native platform detected');
        }
        _initPromise = (async function () {
            const prefs = _getPlugin();
            if (prefs && typeof prefs.remove === 'function') {
                await prefs.remove({ key: 'sessionOwnerId' }).catch(function () {});
            }
            await restore();
            return true;
        })();
        try {
            const ready = await _initPromise;
            if (window.NutriPlanDiagnostics) {
                window.NutriPlanDiagnostics.ok('native-backup', 'init-finish', ready ? 'ready' : 'skipped');
            }
            return ready;
        } finally {
            _initPromise = null;
        }
    }

    return { init: init, restore: restore };
})();
