/**
 * NutriPlan — plan sync: login fetch + admin-update fetch (push-flagged only).
 * No backend requests on tab switch, app resume, or normal reopen.
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

        var resp = await fetch(url.toString(), { headers: headers, cache: 'no-store' });
        if ((resp.status === 401 || resp.status === 403) && headers.Authorization) {
            resp = await fetch(url.toString(), { cache: 'no-store' });
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

        var data = await fetchUserProfile(userId, Object.assign({}, options, { includeLocalPlanAt: false }));
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
        return { updated: updated || !!(data.plan), unchanged: !!data.unchanged, data: data };
        })().finally(function () {
            _adminRefreshInFlight = null;
        });

        return _adminRefreshInFlight;
    }

    function syncShellAppDataFromStorage() {
        try {
            if (!global.NutriPlanAppData || !global.localStorage) return;
            var planStr = global.localStorage.getItem('dietPlan');
            var userStr = global.localStorage.getItem('userData');
            if (planStr) {
                global.NutriPlanAppData.raw.dietPlan = planStr;
                global.NutriPlanAppData.parsed.dietPlan = JSON.parse(planStr);
            }
            if (userStr) {
                global.NutriPlanAppData.raw.userData = userStr;
                global.NutriPlanAppData.parsed.userData = JSON.parse(userStr);
            }
        } catch (_) {}
    }

    function notifyPlanReload() {
        syncShellAppDataFromStorage();

        try {
            if (typeof global.forceReloadDietPlanFromStorage === 'function') {
                global.forceReloadDietPlanFromStorage();
            } else if (typeof global.loadDietData === 'function') {
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

        // SPA shell: reload plan iframe and refresh shared app data
        try {
            if (global.NutriPlanSPA && global.document) {
                var planFrame = global.document.querySelector('[data-tab-view="plan"]');
                if (planFrame && planFrame.contentWindow) {
                    planFrame.contentWindow.postMessage(
                        { type: 'NUTRIPLAN_PLAN_RELOADED' },
                        global.location.origin
                    );
                }
                global.dispatchEvent(new CustomEvent('NUTRIPLAN_SHELL_PLAN_RELOADED'));
            }
        } catch (_) {}
    }

    function handleAdminPlanUpdatedMessage(planUpdatedAt) {
        markAdminPlanPending(planUpdatedAt);
        refreshAdminPlanIfPending().then(function (result) {
            if (result.updated || (result.data && result.data.plan)) {
                notifyPlanReload();
            }
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

    function normalizeEmail(value) {
        return String(value || '').trim().toLowerCase();
    }

    async function checkAccountRequiresAuth(email) {
        var normalized = normalizeEmail(email);
        if (!normalized) return { requiresAuth: false };
        try {
            var resp = await fetch(WORKER_URL + '/api/user/check-account?email=' + encodeURIComponent(normalized));
            if (!resp.ok) return { requiresAuth: false };
            return resp.json();
        } catch (_) {
            return { requiresAuth: false };
        }
    }

    async function hasExistingPlanForEmail(email) {
        try {
            var plan = JSON.parse(localStorage.getItem('dietPlan') || 'null');
            if (plan && !plan._partial) return true;
        } catch (_) {}
        var check = await checkAccountRequiresAuth(email);
        return !!(check && (check.requiresAuth || check.hasPlan || check.hasActivatedPlan));
    }

    function ensurePlanReplaceModal() {
        if (document.getElementById('npPlanReplaceOverlay')) return;
        var overlay = document.createElement('div');
        overlay.id = 'npPlanReplaceOverlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(4px);z-index:5000;display:none;align-items:center;justify-content:center;padding:20px;';
        overlay.innerHTML = [
            '<div style="background:var(--card-bg,#fff);border-radius:20px;padding:24px 20px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.25);">',
            '<h3 id="npPlanReplaceTitle" style="margin:0 0 8px;font-size:1.05rem;color:var(--text-dark,#111);">Потвърдете новия план</h3>',
            '<p id="npPlanReplaceMessage" style="margin:0 0 16px;font-size:.85rem;color:var(--text-light,#6b7280);line-height:1.5;"></p>',
            '<input id="npPlanReplaceEmail" type="email" readonly aria-label="Имейл" style="width:100%;padding:12px 14px;border:1.5px solid rgba(13,148,136,.25);border-radius:12px;font-size:.9rem;margin-bottom:10px;box-sizing:border-box;background:rgba(13,148,136,.06);color:var(--text-light,#6b7280);">',
            '<input id="npPlanReplacePassword" type="password" placeholder="Парола" autocomplete="current-password" aria-label="Парола" style="width:100%;padding:12px 14px;border:1.5px solid rgba(13,148,136,.25);border-radius:12px;font-size:.9rem;margin-bottom:10px;box-sizing:border-box;">',
            '<p id="npPlanReplaceError" style="color:#dc2626;font-size:.8rem;min-height:1.2em;margin:0 0 8px;"></p>',
            '<div style="display:flex;gap:10px;">',
            '<button type="button" id="npPlanReplaceCancel" style="flex:1;padding:12px;border-radius:12px;font-weight:700;border:1.5px solid rgba(13,148,136,.3);background:transparent;cursor:pointer;">Отказ</button>',
            '<button type="button" id="npPlanReplaceConfirm" style="flex:1;padding:12px;border-radius:12px;font-weight:700;border:none;background:linear-gradient(135deg,#0D9488,#0F766E);color:#fff;cursor:pointer;">Потвърди</button>',
            '</div></div>'
        ].join('');
        document.body.appendChild(overlay);
    }

    function confirmPlanReplacement(email, message) {
        ensurePlanReplaceModal();
        return new Promise(function (resolve, reject) {
            var overlay = document.getElementById('npPlanReplaceOverlay');
            var emailEl = document.getElementById('npPlanReplaceEmail');
            var pwEl = document.getElementById('npPlanReplacePassword');
            var errEl = document.getElementById('npPlanReplaceError');
            var msgEl = document.getElementById('npPlanReplaceMessage');
            var confirmBtn = document.getElementById('npPlanReplaceConfirm');
            var cancelBtn = document.getElementById('npPlanReplaceCancel');
            var auth = global.NutriPlanPlanReplaceAuth;

            emailEl.value = email;
            pwEl.value = '';
            errEl.textContent = '';
            if (message) msgEl.textContent = message;

            function cleanup() {
                overlay.style.display = 'none';
                confirmBtn.removeEventListener('click', onConfirm);
                cancelBtn.removeEventListener('click', onCancel);
                overlay.removeEventListener('click', onOverlay);
                pwEl.removeEventListener('keydown', onKeydown);
            }

            function onCancel() {
                cleanup();
                reject(new Error('cancelled'));
            }

            function onOverlay(e) {
                if (e.target === overlay) onCancel();
            }

            function onKeydown(e) {
                if (e.key === 'Enter') onConfirm();
                if (e.key === 'Escape') onCancel();
            }

            async function onConfirm() {
                var password = pwEl.value || '';
                if (password.length < 6) {
                    errEl.textContent = 'Паролата трябва да е поне 6 символа.';
                    return;
                }
                if (!auth || typeof auth.signIn !== 'function') {
                    errEl.textContent = 'Автентикацията не е налична. Презаредете страницата.';
                    return;
                }
                confirmBtn.disabled = true;
                errEl.textContent = '';
                try {
                    resolve(await auth.signIn(email, password));
                    cleanup();
                } catch (err) {
                    var code = err && err.code;
                    errEl.textContent = (
                        code === 'auth/wrong-password' || code === 'auth/invalid-credential'
                    ) ? 'Грешна парола.' : (
                        code === 'auth/user-not-found'
                    ) ? 'Няма акаунт с този имейл.' : (
                        code === 'auth/too-many-requests'
                    ) ? 'Твърде много опити. Изчакайте.' : (err.message || 'Грешка при вход.');
                } finally {
                    confirmBtn.disabled = false;
                }
            }

            confirmBtn.addEventListener('click', onConfirm);
            cancelBtn.addEventListener('click', onCancel);
            overlay.addEventListener('click', onOverlay);
            pwEl.addEventListener('keydown', onKeydown);
            overlay.style.display = 'flex';
            setTimeout(function () { pwEl.focus(); }, 100);
        });
    }

    async function ensureReplacementAuth(email, message) {
        var normalized = normalizeEmail(email);
        if (!normalized) return { requireApproval: false, authContext: null };

        var check = await checkAccountRequiresAuth(normalized);
        if (!check.requiresAuth) return { requireApproval: false, authContext: null };

        var auth = global.NutriPlanPlanReplaceAuth;
        var authContext = null;
        if (auth && typeof auth.getSession === 'function') {
            authContext = await auth.getSession(normalized);
        }
        if (!authContext) {
            authContext = await confirmPlanReplacement(normalized, message);
        }

        try { localStorage.setItem('planReplacePending', '1'); } catch (_) {}
        return { requireApproval: true, authContext: authContext };
    }

    async function syncClientAnswers(userData, clientIdHint) {
        var email = normalizeEmail(userData && userData.email);
        if (!email) return clientIdHint || null;
        var clientId = clientIdHint;
        try { clientId = clientId || localStorage.getItem('pendingClientId'); } catch (_) {}
        clientId = clientId || ('client_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10));
        try {
            var resp = await fetch(WORKER_URL + '/api/save-client-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: clientId,
                    timestamp: new Date().toISOString(),
                    answers: userData,
                    files: []
                })
            });
            if (resp.ok) {
                var result = await resp.json();
                if (result.clientId) {
                    try { localStorage.setItem('pendingClientId', result.clientId); } catch (_) {}
                    return result.clientId;
                }
            }
        } catch (_) {}
        return clientId;
    }

    function saveUserProfile(userId, plan, userData, planSource, idToken, clientId) {
        document.cookie = 'np_uid=' + encodeURIComponent(userId) + ';path=/;max-age=' + (365 * 24 * 60 * 60) + ';SameSite=Lax;Secure';
        return fetch(WORKER_URL + '/api/user/save-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                plan: plan,
                userData: userData,
                planSource: planSource || '',
                idToken: idToken || undefined,
                clientId: clientId || undefined
            })
        }).catch(function () {});
    }

    /**
     * Check whether a questionnaire-2 plan awaiting approval has been activated.
     * Clears local pending flags when the server reports activation.
     * @returns {Promise<{activated: boolean, data?: object}>}
     */
    async function syncPendingPlanActivation() {
        var clientId = '';
        try { clientId = localStorage.getItem('pendingClientId') || ''; } catch (_) {}
        if (!clientId) return { activated: false };

        var planSource = '';
        try { planSource = localStorage.getItem('planSource') || ''; } catch (_) {}
        if (planSource !== 'questionnaire2') return { activated: false };

        try {
            var resp = await fetch(WORKER_URL + '/api/client-plan-status?clientId=' + encodeURIComponent(clientId));
            if (!resp.ok) return { activated: false };
            var data = await resp.json();
            if (!data.success || data.planStatus !== 'activated') return { activated: false };

            if (data.plan) {
                localStorage.setItem('dietPlan', JSON.stringify(data.plan));
            }
            if (data.planUpdatedAt) {
                setLocalPlanUpdatedAt(data.planUpdatedAt);
            } else if (data.activatedAt) {
                setLocalPlanUpdatedAt(data.activatedAt);
            }
            localStorage.removeItem('planSource');
            localStorage.removeItem('pendingClientId');
            localStorage.removeItem('planJobId');
            localStorage.removeItem('planJobSource');
            localStorage.removeItem('planReplacePending');
            localStorage.removeItem('npPlanReviewSource');
            clearAdminPlanPending();

            var userId = '';
            try { userId = localStorage.getItem('userId') || ''; } catch (_) {}
            if (userId) {
                var planPayload = data.plan;
                if (!planPayload) {
                    try { planPayload = JSON.parse(localStorage.getItem('dietPlan') || 'null'); } catch (_) {}
                }
                var userData = {};
                try { userData = JSON.parse(localStorage.getItem('userData') || '{}'); } catch (_) {}
                if (planPayload) {
                    saveUserProfile(userId, planPayload, userData, '', null, clientId);
                }
            }
            return { activated: true, data: data };
        } catch (_) {
            return { activated: false };
        }
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
        isApplyingServerPlan: function () { return _applyingServerPlan; },
        checkAccountRequiresAuth: checkAccountRequiresAuth,
        hasExistingPlanForEmail: hasExistingPlanForEmail,
        ensureReplacementAuth: ensureReplacementAuth,
        syncClientAnswers: syncClientAnswers,
        saveUserProfile: saveUserProfile,
        syncPendingPlanActivation: syncPendingPlanActivation
    };

    bindPlanUpdateBridge();
}(window));
