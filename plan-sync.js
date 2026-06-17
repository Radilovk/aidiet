/**
 * NutriPlan — plan sync: login fetch + admin-update fetch (push-flagged only).
 * No backend requests on tab switch or normal app reopen.
 */
(function (global) {
    'use strict';

    var WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
    var LOCAL_PLAN_AT_KEY = 'planUpdatedAt';
    var LOGIN_FETCH_FLAG = 'np_fetch_plan_on_next_auth';
    var ADMIN_REFRESH_PENDING_KEY = 'np_plan_refresh_pending';
    var _applyingServerPlan = false;
    var _bridgeBound = false;
    var _adminRefreshInFlight = null;

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

    function markAdminPlanPending(planUpdatedAt) {
        try {
            localStorage.setItem(ADMIN_REFRESH_PENDING_KEY, planUpdatedAt || '1');
        } catch (_) {}
    }

    function clearAdminPlanPending() {
        try {
            localStorage.removeItem(ADMIN_REFRESH_PENDING_KEY);
        } catch (_) {}
    }

    function hasAdminPlanPending() {
        try {
            return !!localStorage.getItem(ADMIN_REFRESH_PENDING_KEY);
        } catch (_) {
            return false;
        }
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

    function buildProfileUrl(userId, email, includeLocalPlanAt) {
        var url = new URL(WORKER_URL + '/api/user/profile');
        url.searchParams.set('userId', userId);
        if (includeLocalPlanAt !== false) {
            var localAt = getLocalPlanUpdatedAt();
            if (localAt) url.searchParams.set('localPlanAt', localAt);
        }
        if (email) url.searchParams.set('email', email);
        return url;
    }

    async function fetchUserProfile(userId, options) {
        options = options || {};
        var email = resolveCandidateEmail(options);
        var url = buildProfileUrl(userId, email, options.includeLocalPlanAt);
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

        var data = await fetchUserProfile(userId, Object.assign({}, options, { includeLocalPlanAt: false }));
        if (!data || !data.found) return false;
        if (!(data.plan || data.planSource === 'questionnaire2' || data.clientId)) return false;
        applyServerPlanData(data);
        clearAdminPlanPending();
        if (global.NutriPlanDiagnostics) {
            global.NutriPlanDiagnostics.ok('plan-sync', 'fetch-on-login', data.plan ? 'plan loaded' : 'pending state');
        }
        return true;
    }

    async function refreshAdminPlanIfPending(options) {
        if (_adminRefreshInFlight) {
            return _adminRefreshInFlight;
        }
        if (!hasAdminPlanPending()) {
            return { updated: false, reason: 'no-pending' };
        }

        _adminRefreshInFlight = (async function () {
        options = options || {};
        try {
            if (localStorage.getItem('planSource') === 'questionnaire2') {
                return { updated: false, reason: 'pending-questionnaire' };
            }
        } catch (_) {}

        var userId = options.userId || '';
        if (!userId) {
            try {
                userId = localStorage.getItem('userId') || '';
            } catch (_) {
                userId = '';
            }
        }
        if (!userId || userId.indexOf('fb_') !== 0) {
            return { updated: false, reason: 'no-user' };
        }

        var data = await fetchUserProfile(userId, options);
        if (!data) {
            return { updated: false, reason: 'request-failed' };
        }

        var updated = applyServerPlanData(data);
        if (updated || data.unchanged || (data.found && data.plan)) {
            clearAdminPlanPending();
        }

        if (global.NutriPlanDiagnostics) {
            global.NutriPlanDiagnostics.ok(
                'plan-sync',
                updated ? 'admin-plan-refreshed' : 'admin-plan-checked',
                data.unchanged ? 'unchanged' : (updated ? 'updated' : 'no-op')
            );
        }
        return { updated: updated, unchanged: !!data.unchanged, data: data };
        })().finally(function () {
            _adminRefreshInFlight = null;
        });

        return _adminRefreshInFlight;
    }

    function notifyPlanReload() {
        try {
            if (typeof global.loadDietData === 'function') {
                global.loadDietData();
            }
        } catch (_) {}

        try {
            global.dispatchEvent(new CustomEvent('NUTRIPLAN_PLAN_RELOADED'));
        } catch (_) {}

        try {
            if (global.parent && global.parent !== global) {
                global.parent.postMessage({ type: 'NUTRIPLAN_PLAN_RELOADED' }, global.location.origin);
            }
        } catch (_) {}
    }

    function handleAdminPlanUpdatedMessage(planUpdatedAt) {
        markAdminPlanPending(planUpdatedAt);
        refreshAdminPlanIfPending().then(function (result) {
            if (result.updated) notifyPlanReload();
        }).catch(function () {});
    }

    function bindPlanUpdateBridge() {
        if (_bridgeBound) return;
        _bridgeBound = true;

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', function (event) {
                var msg = event.data;
                if (!msg) return;
                if (msg.type === 'NUTRIPLAN_PLAN_UPDATED') {
                    handleAdminPlanUpdatedMessage(msg.planUpdatedAt || '');
                    return;
                }
                if (msg.type === 'PLAN_REFRESH_PENDING' && msg.pending) {
                    handleAdminPlanUpdatedMessage(msg.planUpdatedAt || '');
                }
            });
        }

        global.addEventListener('NUTRIPLAN_PLAN_UPDATED', function (event) {
            var detail = event && event.detail ? event.detail : {};
            handleAdminPlanUpdatedMessage(detail.planUpdatedAt || '');
        });
    }

    function syncPendingFromServiceWorker() {
        if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
            return Promise.resolve(false);
        }
        return new Promise(function (resolve) {
            var channel = new MessageChannel();
            var settled = false;
            channel.port1.onmessage = function (event) {
                if (settled) return;
                settled = true;
                var msg = event.data;
                if (msg && msg.type === 'PLAN_REFRESH_PENDING' && msg.pending) {
                    markAdminPlanPending(msg.planUpdatedAt || '');
                    resolve(true);
                    return;
                }
                resolve(false);
            };
            try {
                navigator.serviceWorker.controller.postMessage(
                    { type: 'GET_PLAN_REFRESH_PENDING' },
                    [channel.port1]
                );
            } catch (_) {
                resolve(false);
                return;
            }
            setTimeout(function () {
                if (!settled) {
                    settled = true;
                    resolve(false);
                }
            }, 1500);
        });
    }

    async function initAdminPlanSync(options) {
        bindPlanUpdateBridge();
        await syncPendingFromServiceWorker();
        return refreshAdminPlanIfPending(options || {});
    }

    global.NutriPlanPlanSync = {
        WORKER_URL: WORKER_URL,
        LOCAL_PLAN_AT_KEY: LOCAL_PLAN_AT_KEY,
        LOGIN_FETCH_FLAG: LOGIN_FETCH_FLAG,
        ADMIN_REFRESH_PENDING_KEY: ADMIN_REFRESH_PENDING_KEY,
        getLocalPlanUpdatedAt: getLocalPlanUpdatedAt,
        setLocalPlanUpdatedAt: setLocalPlanUpdatedAt,
        markPlanSavedLocally: markPlanSavedLocally,
        markPlanFetchOnNextAuth: markPlanFetchOnNextAuth,
        consumePlanFetchOnNextAuth: consumePlanFetchOnNextAuth,
        shouldFetchPlanOnAuth: shouldFetchPlanOnAuth,
        markAdminPlanPending: markAdminPlanPending,
        clearAdminPlanPending: clearAdminPlanPending,
        hasAdminPlanPending: hasAdminPlanPending,
        applyServerPlanData: applyServerPlanData,
        fetchPlanOnLogin: fetchPlanOnLogin,
        loadUserPlanFromServer: fetchPlanOnLogin,
        refreshAdminPlanIfPending: refreshAdminPlanIfPending,
        initAdminPlanSync: initAdminPlanSync,
        notifyPlanReload: notifyPlanReload,
        isApplyingServerPlan: function () { return _applyingServerPlan; }
    };

    bindPlanUpdateBridge();
}(window));
