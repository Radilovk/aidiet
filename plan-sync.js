/**
 * NutriPlan — login plan restore, plan replacement auth, pending activation.
 */
(function (global) {
    'use strict';

    var WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
    var LOCAL_PLAN_AT_KEY = 'planUpdatedAt';
    var LOGIN_FETCH_FLAG = 'np_fetch_plan_on_next_auth';
    var PLAN_UPDATE_PENDING_KEY = 'np_plan_refresh_pending';
    var PLAN_VERSION_CHECK_DATE_KEY = 'np_plan_version_check_date';
    var _pendingBridgeBound = false;
    var _planUpdateApplyInFlight = null;
    var _planUpdatePromptVisible = false;
    var _planUpdatePromptShownSession = false;

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

    function markPlanUpdatePending(planUpdatedAt) {
        if (!planUpdatedAt || planUpdatedAt === '1') return;
        var localAt = '';
        try { localAt = localStorage.getItem(LOCAL_PLAN_AT_KEY) || ''; } catch (_) {}
        if (localAt && planUpdatedAt <= localAt) {
            clearPlanUpdatePending();
            return;
        }
        try {
            localStorage.setItem(PLAN_UPDATE_PENDING_KEY, planUpdatedAt);
        } catch (_) {}
        try {
            global.dispatchEvent(new CustomEvent('NUTRIPLAN_PLAN_UPDATE_PENDING', {
                detail: { planUpdatedAt: planUpdatedAt }
            }));
        } catch (_) {}
    }

    function clearPlanUpdatePending() {
        try {
            localStorage.removeItem(PLAN_UPDATE_PENDING_KEY);
        } catch (_) {}
    }

    function hasPlanUpdatePending() {
        try {
            return !!localStorage.getItem(PLAN_UPDATE_PENDING_KEY);
        } catch (_) {
            return false;
        }
    }

    function planHasRenderableMeals(plan) {
        if (!plan || !plan.weekPlan || typeof plan.weekPlan !== 'object') return false;
        return Object.keys(plan.weekPlan).some(function (key) {
            var day = plan.weekPlan[key];
            return day && Array.isArray(day.meals) && day.meals.length > 0;
        });
    }

    function bindPlanUpdatePendingBridge() {
        if (_pendingBridgeBound) return;
        _pendingBridgeBound = true;

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', function (event) {
                var msg = event.data;
                if (!msg || msg.type !== 'NUTRIPLAN_PLAN_UPDATE_PENDING') return;
                markPlanUpdatePending(msg.planUpdatedAt || '');
            });
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

    function applyServerPlanData(data, userId) {
        if (!data || !data.found) return false;

        var updated = false;
        if (data.plan) {
            var localPlan = null;
            try { localPlan = JSON.parse(localStorage.getItem('dietPlan') || 'null'); } catch (_) {}
            var serverOk = planHasRenderableMeals(data.plan);
            var localOk = planHasRenderableMeals(localPlan);
            if (serverOk || !localOk) {
                localStorage.setItem('dietPlan', JSON.stringify(data.plan));
                updated = true;
            }
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
        if (userId) {
            localStorage.setItem('userId', userId);
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
    }

    function refreshUidCookie(userId) {
        if (!userId) return;
        document.cookie = 'np_uid=' + encodeURIComponent(userId) +
            ';path=/;max-age=' + (365 * 24 * 60 * 60) + ';SameSite=Lax;Secure';
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

        var resp = await fetch(url.toString(), { headers: headers, cache: 'no-store' });
        if ((resp.status === 401 || resp.status === 403) && headers.Authorization) {
            resp = await fetch(url.toString(), { cache: 'no-store' });
        }
        if (!resp.ok) return null;
        return resp.json().catch(function () { return null; });
    }

    async function restoreProfileFromServer(userId, options) {
        var data = await fetchUserProfile(userId, options);
        if (!data || !data.found) return false;
        if (!(data.plan || data.planSource === 'questionnaire2' || data.clientId)) return false;
        applyServerPlanData(data, userId);
        refreshUidCookie(userId);
        return true;
    }

    async function fetchPlanOnLogin(userId, options) {
        options = options || {};
        if (options.clearLocalPlan === true &&
            global.NutriPlanSession &&
            typeof global.NutriPlanSession.clearPlanSessionData === 'function') {
            await global.NutriPlanSession.clearPlanSessionData();
        }

        var data = await fetchUserProfile(userId, options);
        if (!data || !data.found) return false;
        if (!(data.plan || data.planSource === 'questionnaire2' || data.clientId)) return false;
        applyServerPlanData(data, userId);
        refreshUidCookie(userId);
        if (global.NutriPlanDiagnostics) {
            global.NutriPlanDiagnostics.ok('plan-sync', 'fetch-on-login', data.plan ? 'plan loaded' : 'pending state');
        }
        return true;
    }

    async function restoreUserPlanFromServer(userId, options, retries) {
        if (retries === undefined) retries = 2;
        options = options || {};
        try {
            var loaded = await fetchPlanOnLogin(userId, options);
            if (loaded) return true;
            if (global.NutriPlanDiagnostics) {
                global.NutriPlanDiagnostics.info('auth', 'restore-user-plan', 'No profile found');
            }
        } catch (e) {
            console.warn('[plan-restore] Failed to load plan from server:', e);
            if (global.NutriPlanDiagnostics) {
                global.NutriPlanDiagnostics.fail('auth', 'restore-user-plan', e.message || 'request failed');
            }
            if (retries > 0) {
                await new Promise(function (r) { setTimeout(r, 1500); });
                return restoreUserPlanFromServer(userId, options, retries - 1);
            }
        }
        return false;
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
        refreshUidCookie(userId);
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

    function buildPlanSyncOptions(options) {
        options = options || {};
        if (typeof options.getIdToken === 'function') return options;
        var auth = global.__npPlanAuth;
        if (auth && auth.currentUser && options.userId && String(options.userId).indexOf('fb_') === 0) {
            return Object.assign({}, options, {
                getIdToken: function () { return auth.currentUser.getIdToken(); }
            });
        }
        return options;
    }

    function reconcilePlanUpdatePending() {
        try {
            var pending = localStorage.getItem(PLAN_UPDATE_PENDING_KEY);
            if (!pending || pending === '1') {
                clearPlanUpdatePending();
                return;
            }
            var localAt = localStorage.getItem(LOCAL_PLAN_AT_KEY) || '';
            if (localAt && pending <= localAt) clearPlanUpdatePending();
        } catch (_) {}
    }

    async function applyPendingPlanUpdate(userId, options) {
        options = buildPlanSyncOptions(options || {});
        var uid = userId || options.userId || '';
        if (!uid) {
            try { uid = localStorage.getItem('userId') || ''; } catch (_) {}
        }
        if (!uid || uid.indexOf('fb_') !== 0) {
            return { updated: false, reason: 'no-user' };
        }
        if (!hasPlanUpdatePending()) {
            return { updated: false, reason: 'no-pending' };
        }
        if (_planUpdateApplyInFlight) return _planUpdateApplyInFlight;
        _planUpdateApplyInFlight = pullServerPlanIfNewer(uid, options).finally(function () {
            _planUpdateApplyInFlight = null;
        });
        return _planUpdateApplyInFlight;
    }

    async function pullServerPlanIfNewer(userId, options) {
        options = options || {};
        if (!userId) return { updated: false, reason: 'no-user' };
        if (!hasPlanUpdatePending()) return { updated: false, reason: 'no-pending' };
        var localAt = '';
        try { localAt = localStorage.getItem(LOCAL_PLAN_AT_KEY) || ''; } catch (_) {}
        var data = await fetchUserProfile(userId, options);
        if (!data || !data.found || !data.plan) {
            return { updated: false, reason: 'no-plan' };
        }
        var serverAt = data.planUpdatedAt || '';
        if (localAt && serverAt && serverAt <= localAt) {
            clearPlanUpdatePending();
            return { updated: false, reason: 'current' };
        }
        applyServerPlanData(data, userId);
        refreshUidCookie(userId);
        clearPlanUpdatePending();
        return { updated: true, data: data };
    }

    function isEmbeddedPlanView() {
        try {
            if (document.documentElement.getAttribute('data-embedded-tab') === '1') return true;
            return window.parent !== window && !!window.parent.NutriPlanSPA;
        } catch (_) {
            return false;
        }
    }

    function localCalendarDate() {
        var d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    async function fetchPlanVersion(userId, options) {
        options = buildPlanSyncOptions(options || {});
        if (!userId) return null;
        var localAt = '';
        try { localAt = localStorage.getItem(LOCAL_PLAN_AT_KEY) || ''; } catch (_) {}
        var url = new URL(WORKER_URL + '/api/user/plan-version');
        url.searchParams.set('userId', userId);
        if (localAt) url.searchParams.set('v', localAt);
        var headers = {};
        if (typeof options.getIdToken === 'function' && userId.indexOf('fb_') === 0) {
            var idToken = await options.getIdToken().catch(function () { return null; });
            if (idToken) headers.Authorization = 'Bearer ' + idToken;
        }
        try {
            var resp = await fetch(url.toString(), { headers: headers, cache: 'no-store' });
            if ((resp.status === 401 || resp.status === 403) && headers.Authorization) {
                resp = await fetch(url.toString(), { cache: 'no-store' });
            }
            if (!resp.ok) return null;
            return resp.json().catch(function () { return null; });
        } catch (_) {
            return null;
        }
    }

    function weeklyNoticeShownKey(noticeId) {
        return 'np_weekly_notice_' + (noticeId || '');
    }

    function hasWeeklyNoticeBeenShown(notice) {
        if (!notice || !notice.id) return true;
        try { return !!localStorage.getItem(weeklyNoticeShownKey(notice.id)); } catch (_) { return true; }
    }

    function markWeeklyNoticeShown(notice) {
        if (!notice || !notice.id) return;
        try { localStorage.setItem(weeklyNoticeShownKey(notice.id), '1'); } catch (_) {}
    }

    function dispatchWeeklyAdaptReady(notice) {
        try {
            global.dispatchEvent(new CustomEvent('NUTRIPLAN_WEEKLY_ADAPT_READY', { detail: notice }));
        } catch (_) {}
    }

    async function applyWeeklyAdaptIfReady(userId, options) {
        options = buildPlanSyncOptions(options || {});
        if (!userId) return { applied: false, reason: 'no-user' };
        var data = await fetchPlanVersion(userId, options);
        if (!data || !data.found || !data.weeklyAdaptNotice || hasWeeklyNoticeBeenShown(data.weeklyAdaptNotice)) {
            return { applied: false, reason: 'no-notice' };
        }
        var notice = data.weeklyAdaptNotice;
        var planApplied = false;

        if (notice.changed) {
            if (data.planUpdatedAt) markPlanUpdatePending(data.planUpdatedAt);
            var pull = await pullServerPlanIfNewer(userId, options);
            if (pull.updated) {
                planApplied = true;
            } else {
                var profile = await fetchUserProfile(userId, options);
                if (profile && profile.found && profile.plan) {
                    applyServerPlanData(profile, userId);
                    clearPlanUpdatePending();
                    planApplied = true;
                }
            }
        }

        markWeeklyNoticeShown(notice);
        if (planApplied) {
            try {
                global.dispatchEvent(new CustomEvent('NUTRIPLAN_PLAN_SYNCED', { detail: { weekly: true } }));
            } catch (_) {}
        }
        dispatchWeeklyAdaptReady(Object.assign({}, notice, { planApplied: planApplied }));
        return { applied: true, notice: notice, planApplied: planApplied };
    }

    async function maybeCheckWeeklyAdaptNotice(userId, options) {
        if (!userId) return { applied: false };
        if (_weeklyNoticeCheckInFlight) return _weeklyNoticeCheckInFlight;
        _weeklyNoticeCheckInFlight = applyWeeklyAdaptIfReady(userId, options).finally(function () {
            _weeklyNoticeCheckInFlight = null;
        });
        return _weeklyNoticeCheckInFlight;
    }

    var _weeklyNoticeCheckInFlight = null;

    async function maybeDailyPlanVersionCheck(userId, options) {
        if (!userId || userId.indexOf('fb_') !== 0) {
            return { checked: false, reason: 'no-user' };
        }
        var today = localCalendarDate();
        try {
            if (localStorage.getItem(PLAN_VERSION_CHECK_DATE_KEY) === today) {
                return { checked: false, reason: 'already-today' };
            }
            localStorage.setItem(PLAN_VERSION_CHECK_DATE_KEY, today);
        } catch (_) {
            return { checked: false, reason: 'storage' };
        }
        var weeklyResult = await applyWeeklyAdaptIfReady(userId, options);
        if (weeklyResult.applied) {
            return { checked: true, pending: false, weeklyShown: true };
        }
        var data = await fetchPlanVersion(userId, options);
        if (!data || !data.found) return { checked: true, pending: false };
        if (data.upToDate) return { checked: true, pending: false };
        if (data.planUpdatedAt) {
            markPlanUpdatePending(data.planUpdatedAt);
            return { checked: true, pending: true, planUpdatedAt: data.planUpdatedAt };
        }
        return { checked: true, pending: false };
    }

    async function confirmPlanUpdate(userId, options) {
        options = buildPlanSyncOptions(options || {});
        if (!userId) {
            try { userId = localStorage.getItem('userId') || ''; } catch (_) {}
        }
        if (!userId) return { updated: false, reason: 'no-user' };
        if (!hasPlanUpdatePending()) return { updated: false, reason: 'no-pending' };
        if (_planUpdateApplyInFlight) return _planUpdateApplyInFlight;
        _planUpdateApplyInFlight = pullServerPlanIfNewer(userId, options)
            .then(function (result) {
                if (result.updated) {
                    try {
                        global.dispatchEvent(new CustomEvent('NUTRIPLAN_PLAN_SYNCED', { detail: result }));
                    } catch (_) {}
                }
                return result;
            })
            .finally(function () {
                _planUpdateApplyInFlight = null;
            });
        return _planUpdateApplyInFlight;
    }

    function ensurePlanUpdatePromptModal() {
        if (document.getElementById('npPlanUpdateOverlay')) return;
        var overlay = document.createElement('div');
        overlay.id = 'npPlanUpdateOverlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'npPlanUpdateTitle');
        overlay.hidden = true;
        overlay.style.cssText = 'position:fixed;inset:0;z-index:6000;display:flex;align-items:flex-end;justify-content:center;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));background:rgba(15,47,46,.28);backdrop-filter:blur(3px);';
        overlay.innerHTML = [
            '<div style="background:var(--card-bg,#fff);border-radius:18px;padding:18px 16px 14px;max-width:420px;width:100%;box-shadow:0 16px 48px rgba(0,0,0,.18);">',
            '<p id="npPlanUpdateTitle" style="margin:0 0 14px;font-size:.92rem;line-height:1.45;color:var(--text-dark,#0F2F2E);">Има обновение на плана от специалиста.</p>',
            '<p id="npPlanUpdateError" style="display:none;margin:0 0 10px;font-size:.78rem;color:#dc2626;"></p>',
            '<div style="display:flex;gap:10px;">',
            '<button type="button" id="npPlanUpdateLater" style="flex:1;padding:11px 12px;border-radius:12px;font-weight:600;font-size:.86rem;border:1.5px solid rgba(13,148,136,.28);background:transparent;color:var(--text-light,#6b7280);cursor:pointer;">По-късно</button>',
            '<button type="button" id="npPlanUpdateConfirm" style="flex:1;padding:11px 12px;border-radius:12px;font-weight:700;font-size:.86rem;border:none;background:linear-gradient(135deg,#0D9488,#0F766E);color:#fff;cursor:pointer;">Обнови</button>',
            '</div></div>'
        ].join('');
        document.body.appendChild(overlay);
    }

    function showPlanUpdatePrompt(userId, options) {
        if (isEmbeddedPlanView()) return Promise.resolve({ dismissed: true, reason: 'embedded' });
        if (_planUpdatePromptVisible || !hasPlanUpdatePending()) {
            return Promise.resolve({ dismissed: true, reason: 'skip' });
        }
        options = buildPlanSyncOptions(options || {});
        if (!userId) {
            try { userId = localStorage.getItem('userId') || ''; } catch (_) {}
        }
        ensurePlanUpdatePromptModal();
        _planUpdatePromptVisible = true;
        _planUpdatePromptShownSession = true;

        return new Promise(function (resolve) {
            var overlay = document.getElementById('npPlanUpdateOverlay');
            var laterBtn = document.getElementById('npPlanUpdateLater');
            var confirmBtn = document.getElementById('npPlanUpdateConfirm');
            var errEl = document.getElementById('npPlanUpdateError');
            if (!overlay || !laterBtn || !confirmBtn) {
                _planUpdatePromptVisible = false;
                resolve({ dismissed: true, reason: 'missing-ui' });
                return;
            }

            errEl.style.display = 'none';
            errEl.textContent = '';
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Обнови';
            overlay.hidden = false;
            overlay.style.display = 'flex';

            function cleanup() {
                overlay.hidden = true;
                overlay.style.display = 'none';
                _planUpdatePromptVisible = false;
                laterBtn.removeEventListener('click', onLater);
                confirmBtn.removeEventListener('click', onConfirm);
                overlay.removeEventListener('click', onOverlay);
            }

            function onLater() {
                cleanup();
                resolve({ dismissed: true });
            }

            function onOverlay(e) {
                if (e.target === overlay) onLater();
            }

            async function onConfirm() {
                confirmBtn.disabled = true;
                laterBtn.disabled = true;
                confirmBtn.textContent = '…';
                errEl.style.display = 'none';
                try {
                    var result = await confirmPlanUpdate(userId, options);
                    if (result.updated) {
                        cleanup();
                        resolve({ updated: true, result: result });
                        return;
                    }
                    if (result.reason === 'current') {
                        cleanup();
                        resolve({ updated: false, reason: 'current' });
                        return;
                    }
                    errEl.textContent = 'Неуспешно. Опитайте отново.';
                    errEl.style.display = 'block';
                } catch (_) {
                    errEl.textContent = 'Неуспешно. Опитайте отново.';
                    errEl.style.display = 'block';
                } finally {
                    confirmBtn.disabled = false;
                    laterBtn.disabled = false;
                    confirmBtn.textContent = 'Обнови';
                }
            }

            laterBtn.addEventListener('click', onLater);
            confirmBtn.addEventListener('click', onConfirm);
            overlay.addEventListener('click', onOverlay);
        });
    }

    function maybePromptPendingPlanUpdate(userId, options) {
        if (!hasPlanUpdatePending() || _planUpdatePromptShownSession) {
            return Promise.resolve({ dismissed: true, reason: 'skip' });
        }
        return showPlanUpdatePrompt(userId, options);
    }

    async function claimPlanFromToken(token) {
        if (!token) return { ok: false, reason: 'no-token' };
        try {
            var url = WORKER_URL + '/api/plan/claim?t=' + encodeURIComponent(token);
            var resp = await fetch(url, { cache: 'no-store' });
            var data = await resp.json().catch(function () { return null; });
            if (!resp.ok || !data || !data.found) {
                return { ok: false, reason: (data && data.error) || 'claim-failed' };
            }
            var userId = data.userId || '';
            applyServerPlanData(data, userId);
            refreshUidCookie(userId);
            clearPlanUpdatePending();
            if (global.NutriPlanDiagnostics) {
                global.NutriPlanDiagnostics.ok('plan-sync', 'claim-token', 'plan applied');
            }
            return { ok: true, data: data };
        } catch (e) {
            return { ok: false, reason: e.message || 'network' };
        }
    }

    global.NutriPlanPlanSync = {
        WORKER_URL: WORKER_URL,
        LOCAL_PLAN_AT_KEY: LOCAL_PLAN_AT_KEY,
        setLocalPlanUpdatedAt: setLocalPlanUpdatedAt,
        markPlanSavedLocally: markPlanSavedLocally,
        markPlanFetchOnNextAuth: markPlanFetchOnNextAuth,
        consumePlanFetchOnNextAuth: consumePlanFetchOnNextAuth,
        applyServerPlanData: applyServerPlanData,
        refreshUidCookie: refreshUidCookie,
        fetchPlanOnLogin: fetchPlanOnLogin,
        loadUserPlanFromServer: fetchPlanOnLogin,
        restoreUserPlanFromServer: restoreUserPlanFromServer,
        restoreProfileFromServer: restoreProfileFromServer,
        checkAccountRequiresAuth: checkAccountRequiresAuth,
        hasExistingPlanForEmail: hasExistingPlanForEmail,
        ensureReplacementAuth: ensureReplacementAuth,
        syncClientAnswers: syncClientAnswers,
        saveUserProfile: saveUserProfile,
        syncPendingPlanActivation: syncPendingPlanActivation,
        claimPlanFromToken: claimPlanFromToken,
        markPlanUpdatePending: markPlanUpdatePending,
        clearPlanUpdatePending: clearPlanUpdatePending,
        hasPlanUpdatePending: hasPlanUpdatePending,
        planHasRenderableMeals: planHasRenderableMeals,
        reconcilePlanUpdatePending: reconcilePlanUpdatePending,
        applyPendingPlanUpdate: applyPendingPlanUpdate,
        pullServerPlanIfNewer: pullServerPlanIfNewer,
        fetchPlanVersion: fetchPlanVersion,
        maybeDailyPlanVersionCheck: maybeDailyPlanVersionCheck,
        applyWeeklyAdaptIfReady: applyWeeklyAdaptIfReady,
        maybeCheckWeeklyAdaptNotice: maybeCheckWeeklyAdaptNotice,
        confirmPlanUpdate: confirmPlanUpdate,
        showPlanUpdatePrompt: showPlanUpdatePrompt,
        maybePromptPendingPlanUpdate: maybePromptPendingPlanUpdate
    };

    bindPlanUpdatePendingBridge();
    reconcilePlanUpdatePending();
}(window));
