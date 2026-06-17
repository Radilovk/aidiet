/**
 * NutriPlan — lightweight server plan sync (web + APK).
 * One conditional GET on app open; full plan body only when admin updated it.
 */
(function (global) {
    'use strict';

    var WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
    var LOCAL_PLAN_AT_KEY = 'planUpdatedAt';
    var SESSION_CHECK_KEY = 'np_plan_refresh_done';
    var _applyingServerPlan = false;

    function getLocalPlanUpdatedAt() {
        try {
            return localStorage.getItem(LOCAL_PLAN_AT_KEY) || '';
        } catch (_) {
            return '';
        }
    }

    function setLocalPlanUpdatedAt(ts) {
        if (!ts) return;
        try {
            localStorage.setItem(LOCAL_PLAN_AT_KEY, ts);
        } catch (_) {}
    }

    function markPlanSavedLocally(planUpdatedAt) {
        setLocalPlanUpdatedAt(planUpdatedAt || new Date().toISOString());
    }

    function resolveCandidateEmail(options) {
        if (options && options.email) return String(options.email).trim().toLowerCase();
        try {
            var userData = JSON.parse(localStorage.getItem('userData') || '{}');
            return (userData.email || '').trim().toLowerCase();
        } catch (_) {
            return '';
        }
    }

    function applyServerPlanData(data) {
        if (!data || !data.found) return false;

        _applyingServerPlan = true;
        try {
            if (data.unchanged) {
                if (data.planUpdatedAt) setLocalPlanUpdatedAt(data.planUpdatedAt);
                return false;
            }

            var updated = false;
            if (data.plan) {
                localStorage.setItem('dietPlan', JSON.stringify(data.plan));
                updated = true;
            }
            if (data.userData) {
                localStorage.setItem('userData', JSON.stringify(data.userData));
            }
            if (data.planSource) {
                localStorage.setItem('planSource', data.planSource);
            } else {
                localStorage.removeItem('planSource');
            }
            if (data.clientId && data.planSource === 'questionnaire2') {
                localStorage.setItem('pendingClientId', data.clientId);
            } else if (data.planSource !== 'questionnaire2') {
                localStorage.removeItem('pendingClientId');
            }
            if (data.planUpdatedAt) {
                setLocalPlanUpdatedAt(data.planUpdatedAt);
            } else if (data.plan) {
                markPlanSavedLocally();
            }
            if (updated) {
                localStorage.removeItem('np_profile_sync_sig');
                localStorage.removeItem('np_profile_synced');
            }
            return updated;
        } finally {
            _applyingServerPlan = false;
        }
    }

    function buildProfileUrl(userId, email) {
        var url = new URL(WORKER_URL + '/api/user/profile');
        url.searchParams.set('userId', userId);
        var localAt = getLocalPlanUpdatedAt();
        if (localAt) url.searchParams.set('localPlanAt', localAt);
        if (email) url.searchParams.set('email', email);
        return url;
    }

    async function fetchUserProfile(userId, options) {
        options = options || {};
        var email = resolveCandidateEmail(options);
        var url = buildProfileUrl(userId, email);
        var headers = {};
        if (typeof options.getIdToken === 'function' && userId.indexOf('fb_') === 0) {
            var idToken = await options.getIdToken().catch(function () { return null; });
            if (idToken) headers.Authorization = 'Bearer ' + idToken;
        }

        var resp = await fetch(url.toString(), { headers: headers });
        if ((resp.status === 401 || resp.status === 403) && headers.Authorization) {
            resp = await fetch(url.toString(), {});
        }
        if (!resp.ok) return null;
        return resp.json().catch(function () { return null; });
    }

    async function refreshIfStale(options) {
        options = options || {};
        if (options.skipSessionGuard !== true) {
            try {
                if (sessionStorage.getItem(SESSION_CHECK_KEY) === '1') {
                    return { updated: false, reason: 'already-checked' };
                }
            } catch (_) {}
        }

        var userId = options.userId || '';
        if (!userId) {
            try {
                userId = localStorage.getItem('userId') || '';
            } catch (_) {
                userId = '';
            }
        }
        if (!userId) return { updated: false, reason: 'no-user' };

        try {
            if (localStorage.getItem('planSource') === 'questionnaire2') {
                return { updated: false, reason: 'pending' };
            }
        } catch (_) {}

        var hasLocalPlan = false;
        try {
            hasLocalPlan = !!localStorage.getItem('dietPlan');
        } catch (_) {}

        if (!hasLocalPlan && options.onlyIfLocalPlan) {
            return { updated: false, reason: 'no-local-plan' };
        }

        var data = await fetchUserProfile(userId, options);
        if (!data) return { updated: false, reason: 'request-failed' };

        if (options.skipSessionGuard !== true) {
            try {
                sessionStorage.setItem(SESSION_CHECK_KEY, '1');
            } catch (_) {}
        }

        var updated = applyServerPlanData(data);
        if (global.NutriPlanDiagnostics) {
            global.NutriPlanDiagnostics.ok(
                'plan-sync',
                updated ? 'plan-refreshed' : (data.unchanged ? 'plan-unchanged' : 'plan-checked'),
                userId
            );
        }
        return { updated: updated, unchanged: !!data.unchanged, data: data };
    }

    async function loadUserPlanFromServer(userId, options) {
        options = options || {};
        var savedLocalAt = getLocalPlanUpdatedAt();
        try {
            if (savedLocalAt) localStorage.removeItem(LOCAL_PLAN_AT_KEY);
        } catch (_) {}

        var data = await fetchUserProfile(userId, options);
        if (savedLocalAt) setLocalPlanUpdatedAt(savedLocalAt);

        if (!data || !data.found) return false;
        if (!(data.plan || data.planSource === 'questionnaire2' || data.clientId)) return false;
        applyServerPlanData(data);
        return true;
    }

    global.NutriPlanPlanSync = {
        WORKER_URL: WORKER_URL,
        LOCAL_PLAN_AT_KEY: LOCAL_PLAN_AT_KEY,
        getLocalPlanUpdatedAt: getLocalPlanUpdatedAt,
        setLocalPlanUpdatedAt: setLocalPlanUpdatedAt,
        markPlanSavedLocally: markPlanSavedLocally,
        applyServerPlanData: applyServerPlanData,
        refreshIfStale: refreshIfStale,
        loadUserPlanFromServer: loadUserPlanFromServer,
        isApplyingServerPlan: function () { return _applyingServerPlan; }
    };
}(window));
