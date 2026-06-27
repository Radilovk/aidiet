(function (global) {
    'use strict';

    var MANAGED_STORAGE_KEYS = [
        'dietPlan',
        'userId',
        'userData',
        'pendingClientId',
        'planJobId',
        'planJobSource',
        'pendingPlanPayload',
        'planHistory',
        'questionnaireAnswers',
        'warningData',
        'canProceedWithWarning',
        'validationSource',
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
        'planUpdatedAt',
        'planSyncPending',
        'theme',
        'colorScheme',
        'gameEnabled',
        'gameData',
        'gameWeeklyAI',
        'gameNotifierConfig'
    ];

    var USER_SESSION_KEYS = [
        'dietPlan',
        'userId',
        'userData',
        'pendingClientId',
        'planJobId',
        'planJobSource',
        'pendingPlanPayload',
        'planHistory',
        'questionnaireAnswers',
        'warningData',
        'canProceedWithWarning',
        'validationSource',
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
        'planUpdatedAt',
        'planSyncPending',
        'gameEnabled',
        'gameData',
        'gameWeeklyAI',
        'gameNotifierConfig',
        'chatHistory',
        'chatMode',
        'chatDemoLimitUnlocked',
        'pendingPlanUiAction',
        'pushSubscribed',
        'sessionOwnerId',
        'np_plan_refresh_pending',
        'demoFoodPickerPlanCount',
        'demoProfileRegenCount'
    ];

    var PLAN_SESSION_KEYS = [
        'dietPlan',
        'userData',
        'planSource',
        'pendingClientId',
        'planJobId',
        'planJobSource',
        'pendingPlanPayload',
        'planHistory',
        'questionnaireAnswers',
        'planJustification',
        'longTermStrategy',
        'modifierReasoning',
        'hydrationStrategy',
        'mealCountJustification',
        'afterDinnerMealJustification',
        'hasSeenPlanJustification',
        'planUpdatedAt',
        'np_profile_synced',
        'np_profile_sync_sig',
        'planSyncPending',
        'warningData',
        'canProceedWithWarning',
        'validationSource'
    ];

    var ANALYTICS_PRESERVE_KEYS = [
        'gameEnabled',
        'gameData',
        'gameWeeklyAI',
        'gameNotifierConfig',
        'theme',
        'colorScheme',
        'demoFoodPickerPlanCount',
        'demoProfileRegenCount'
    ];

    var ANALYTICS_DYNAMIC_PREFIXES = [
        'addedMeals_',
        'demoChatCount_',
        'demoImageCount_'
    ];

    var DYNAMIC_KEY_PREFIXES = [
        'addedMeals_',
        'demoChatCount_',
        'demoImageCount_'
    ];

    function unique(list) {
        return Array.from(new Set(list));
    }

    function getManagedStorageKeys() {
        return MANAGED_STORAGE_KEYS.slice();
    }

    function getUserSessionKeys() {
        return USER_SESSION_KEYS.slice();
    }

    function getPlanSessionKeys() {
        return PLAN_SESSION_KEYS.slice();
    }

    function getAnalyticsPreserveKeys() {
        return ANALYTICS_PRESERVE_KEYS.slice();
    }

    function getDynamicPrefixes() {
        return DYNAMIC_KEY_PREFIXES.slice();
    }

    function getPreferencesPlugin() {
        try {
            var cap = global.Capacitor || (global.top && global.top !== global && global.top.Capacitor) || null;
            if (!cap) return null;
            if (cap.Plugins && cap.Plugins.Preferences) return cap.Plugins.Preferences;
            if (typeof cap.registerPlugin === 'function') {
                return cap.registerPlugin('Preferences');
            }
        } catch (_) {}
        return null;
    }

    function matchesDynamicPrefix(key) {
        return DYNAMIC_KEY_PREFIXES.some(function (prefix) {
            return key.indexOf(prefix) === 0;
        });
    }

    function matchesPreservedDynamicPrefix(key) {
        return ANALYTICS_DYNAMIC_PREFIXES.some(function (prefix) {
            return key.indexOf(prefix) === 0;
        });
    }

    function getDynamicKeysFromStorage(storage) {
        try {
            return Object.keys(storage || {}).filter(matchesDynamicPrefix);
        } catch (_) {
            return [];
        }
    }

    async function getDynamicKeysFromPreferences(prefs) {
        if (!prefs || typeof prefs.keys !== 'function') return [];
        try {
            var result = await prefs.keys();
            return (result && Array.isArray(result.keys) ? result.keys : []).filter(matchesDynamicPrefix);
        } catch (_) {
            return [];
        }
    }

    function removeLocalKey(key) {
        try {
            localStorage.removeItem(key);
        } catch (_) {}
    }

    async function removePreferenceKey(prefs, key) {
        if (!prefs || typeof prefs.remove !== 'function') return;
        try {
            await prefs.remove({ key: key });
        } catch (_) {}
    }

    async function writePreferenceKey(prefs, key, value) {
        if (!prefs || typeof prefs.set !== 'function') return;
        try {
            await prefs.set({ key: key, value: value });
        } catch (_) {}
    }

    async function removeKeys(keys) {
        var uniqueKeys = unique(keys || []);
        uniqueKeys.forEach(removeLocalKey);

        var prefs = getPreferencesPlugin();
        if (!prefs) return true;

        uniqueKeys.forEach(function (key) {
            removePreferenceKey(prefs, key);
        });
        return true;
    }

    async function clearUserSessionData(options) {
        options = options || {};
        if (global.NutriPlanDiagnostics) {
            global.NutriPlanDiagnostics.info('session', 'clear-user-session-start', 'preserve=' + ((options.preserveKeys || []).length || 0));
        }
        var preserveKeys = Array.isArray(options.preserveKeys) ? options.preserveKeys : [];
        var preserveDynamicPrefixes = Array.isArray(options.preserveDynamicPrefixes)
            ? options.preserveDynamicPrefixes
            : [];
        var baseKeys = getUserSessionKeys().filter(function (key) {
            return preserveKeys.indexOf(key) === -1;
        });
        var localDynamicKeys = getDynamicKeysFromStorage(localStorage).filter(function (key) {
            return !preserveDynamicPrefixes.some(function (prefix) {
                return key.indexOf(prefix) === 0;
            });
        });
        var allKeys = unique(baseKeys.concat(localDynamicKeys));

        allKeys.forEach(removeLocalKey);

        var prefs = getPreferencesPlugin();
        if (prefs) {
            allKeys.forEach(function (key) {
                removePreferenceKey(prefs, key);
            });
            getDynamicKeysFromPreferences(prefs).then(function (preferenceDynamicKeys) {
                preferenceDynamicKeys.filter(function (key) {
                    return !preserveDynamicPrefixes.some(function (prefix) {
                        return key.indexOf(prefix) === 0;
                    });
                }).forEach(function (key) {
                    removePreferenceKey(prefs, key);
                });
            }).catch(function () {});
        }
        if (global.NutriPlanDiagnostics) {
            global.NutriPlanDiagnostics.ok('session', 'clear-user-session-done', allKeys.length + ' keys');
        }
        return true;
    }

    async function clearPlanSessionData() {
        if (global.NutriPlanDiagnostics) {
            global.NutriPlanDiagnostics.info('session', 'clear-plan-session-start', PLAN_SESSION_KEYS.length + ' keys');
        }
        await removeKeys(getPlanSessionKeys());
        if (global.NutriPlanDiagnostics) {
            global.NutriPlanDiagnostics.ok('session', 'clear-plan-session-done', 'analytics preserved');
        }
        return true;
    }

    async function clearAuthSessionKeepingAnalytics() {
        if (global.NutriPlanPlanSync && typeof global.NutriPlanPlanSync.markPlanFetchOnNextAuth === 'function') {
            global.NutriPlanPlanSync.markPlanFetchOnNextAuth();
        }
        return clearUserSessionData({
            preserveKeys: getAnalyticsPreserveKeys(),
            preserveDynamicPrefixes: ANALYTICS_DYNAMIC_PREFIXES.slice()
        });
    }

    async function ensureAuthenticatedUser(userOrUid) {
        var nextUserId = '';
        if (typeof userOrUid === 'string') {
            nextUserId = userOrUid;
        } else if (userOrUid && userOrUid.uid) {
            nextUserId = 'fb_' + userOrUid.uid;
        }
        if (!nextUserId) {
            return { userId: '', previousOwner: null, switched: false };
        }

        var previousOwner = '';
        var existingUserId = '';
        try {
            previousOwner = localStorage.getItem('sessionOwnerId') || '';
            existingUserId = localStorage.getItem('userId') || '';
        } catch (_) {}

        var switched = !!(previousOwner && previousOwner !== nextUserId && existingUserId !== nextUserId);
        if (existingUserId === nextUserId) {
            switched = false;
        }
        if (switched) {
            if (global.NutriPlanDiagnostics) {
                global.NutriPlanDiagnostics.info('session', 'owner-switch-detected', 'Clearing previous session state');
            }
            await clearUserSessionData();
        }

        try {
            localStorage.setItem('sessionOwnerId', nextUserId);
            localStorage.setItem('userId', nextUserId);
        } catch (_) {}

        var prefs = getPreferencesPlugin();
        /* localStorage is the source of truth; never block login on native prefs I/O */
        writePreferenceKey(prefs, 'userId', nextUserId);
        if (global.NutriPlanDiagnostics) {
            global.NutriPlanDiagnostics.ok('session', 'ensure-authenticated-user', switched ? 'owner switched' : 'owner confirmed');
        }

        return {
            userId: nextUserId,
            previousOwner: previousOwner || null,
            switched: switched
        };
    }

    global.NutriPlanSession = {
        getManagedStorageKeys: getManagedStorageKeys,
        getUserSessionKeys: getUserSessionKeys,
        getPlanSessionKeys: getPlanSessionKeys,
        getAnalyticsPreserveKeys: getAnalyticsPreserveKeys,
        getDynamicPrefixes: getDynamicPrefixes,
        clearUserSessionData: clearUserSessionData,
        clearPlanSessionData: clearPlanSessionData,
        clearAuthSessionKeepingAnalytics: clearAuthSessionKeepingAnalytics,
        ensureAuthenticatedUser: ensureAuthenticatedUser
    };
}(window));
