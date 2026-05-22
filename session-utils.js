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
        'planSyncPending',
        'theme',
        'colorScheme',
        'profileAvatar',
        'profilePhotoURL',
        'profilePhotoUid',
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
        'planSyncPending',
        'profileAvatar',
        'profilePhotoURL',
        'profilePhotoUid',
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
        'demoFoodPickerPlanCount',
        'demoProfileRegenCount'
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

    function getDynamicPrefixes() {
        return DYNAMIC_KEY_PREFIXES.slice();
    }

    function getPreferencesPlugin() {
        try {
            var cap = global.Capacitor;
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

    async function clearUserSessionData(options) {
        options = options || {};
        var preserveKeys = Array.isArray(options.preserveKeys) ? options.preserveKeys : [];
        var baseKeys = getUserSessionKeys().filter(function (key) {
            return preserveKeys.indexOf(key) === -1;
        });
        var localDynamicKeys = getDynamicKeysFromStorage(localStorage);
        var allKeys = unique(baseKeys.concat(localDynamicKeys));

        allKeys.forEach(removeLocalKey);

        var prefs = getPreferencesPlugin();
        if (!prefs) return true;

        var preferenceDynamicKeys = await getDynamicKeysFromPreferences(prefs);
        var preferenceKeys = unique(allKeys.concat(preferenceDynamicKeys));
        await Promise.all(preferenceKeys.map(function (key) {
            return removePreferenceKey(prefs, key);
        }));
        return true;
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
        if (switched) {
            await clearUserSessionData();
        }

        try {
            localStorage.setItem('sessionOwnerId', nextUserId);
            localStorage.setItem('userId', nextUserId);
        } catch (_) {}

        var prefs = getPreferencesPlugin();
        await writePreferenceKey(prefs, 'userId', nextUserId);

        return {
            userId: nextUserId,
            previousOwner: previousOwner || null,
            switched: switched
        };
    }

    global.NutriPlanSession = {
        getManagedStorageKeys: getManagedStorageKeys,
        getUserSessionKeys: getUserSessionKeys,
        getDynamicPrefixes: getDynamicPrefixes,
        clearUserSessionData: clearUserSessionData,
        ensureAuthenticatedUser: ensureAuthenticatedUser
    };
}(window));
