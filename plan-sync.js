/**
 * NutriPlan — plan sync on login only (web + APK).
 * No backend requests on app reopen or tab switch while logged in.
 */
(function (global) {
    'use strict';

    var WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
    var LOCAL_PLAN_AT_KEY = 'planUpdatedAt';
    var LOGIN_FETCH_FLAG = 'np_fetch_plan_on_next_auth';
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

    function markPlanFetchOnNextAuth() {
        try {
            localStorage.setItem(LOGIN_FETCH_FLAG, '1');
        } catch (_) {}
    }

    function consumePlanFetchOnNextAuth() {
        try {
            var pending = localStorage.getItem(LOGIN_FETCH_FLAG) === '1';
            if (pending) localStorage.removeItem(LOGIN_FETCH_FLAG);
            return pending;
        } catch (_) {
            return false;
        }
    }

    function shouldFetchPlanOnAuth(hasLocalPlan) {
        return consumePlanFetchOnNextAuth() || !hasLocalPlan;
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

    async function fetchPlanOnLogin(userId, options) {
        options = options || {};
        if (options.clearLocalPlan !== false &&
            global.NutriPlanSession &&
            typeof global.NutriPlanSession.clearPlanSessionData === 'function') {
            await global.NutriPlanSession.clearPlanSessionData();
        }

        var data = await fetchUserProfile(userId, options);
        if (!data || !data.found) return false;
        if (!(data.plan || data.planSource === 'questionnaire2' || data.clientId)) return false;
        applyServerPlanData(data);
        if (global.NutriPlanDiagnostics) {
            global.NutriPlanDiagnostics.ok('plan-sync', 'fetch-on-login', data.plan ? 'plan loaded' : 'pending state');
        }
        return true;
    }

    global.NutriPlanPlanSync = {
        WORKER_URL: WORKER_URL,
        LOCAL_PLAN_AT_KEY: LOCAL_PLAN_AT_KEY,
        LOGIN_FETCH_FLAG: LOGIN_FETCH_FLAG,
        getLocalPlanUpdatedAt: getLocalPlanUpdatedAt,
        setLocalPlanUpdatedAt: setLocalPlanUpdatedAt,
        markPlanSavedLocally: markPlanSavedLocally,
        markPlanFetchOnNextAuth: markPlanFetchOnNextAuth,
        consumePlanFetchOnNextAuth: consumePlanFetchOnNextAuth,
        shouldFetchPlanOnAuth: shouldFetchPlanOnAuth,
        applyServerPlanData: applyServerPlanData,
        fetchPlanOnLogin: fetchPlanOnLogin,
        loadUserPlanFromServer: fetchPlanOnLogin,
        isApplyingServerPlan: function () { return _applyingServerPlan; }
    };
}(window));
