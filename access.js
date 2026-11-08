/**
 * Достъп по ниво — клиентска част. Нужен е pricing-config.js преди него.
 *
 *   await NutriPlanAccess.load()        // чете /api/user/access за текущия акаунт
 *   NutriPlanAccess.can('chat')         // true, ако функцията е отключена
 *   NutriPlanAccess.showLock('chat')    // прозорец „част от абонамента“
 *   NutriPlanAccess.lockCard('full_week', html) // HTML карта за вграждане
 *   await NutriPlanAccess.authFields()  // { userId, idToken } за платените заявки
 *   NutriPlanAccess.handleLocked(resp, data) // true, ако сървърът е върнал 402
 *
 * Стената е изключена, докато админът не я включи: тогава can() е винаги true
 * и нищо не се показва. В приложението (APK / iOS) няма цени и бутони за
 * плащане — правилата на магазините; плащането е само в сайта.
 */
(function (global) {
    'use strict';
    var WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
    var CACHE_KEY = 'np_access';
    var CACHE_MS = 10 * 60 * 1000;
    var Pricing = global.NutriPlanPricing;
    var state = { paywall: false, tier: 'start', features: {}, quotas: {} };
    var loading = null;

    function userId() {
        try { return localStorage.getItem('userId') || ''; } catch (_) { return ''; }
    }

    function isNativeApp() {
        try {
            if (global.NutriPlanPlatform && typeof global.NutriPlanPlatform.isAPK === 'function') return global.NutriPlanPlatform.isAPK();
            var cap = global.Capacitor;
            return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
        } catch (_) { return false; }
    }

    function readCache() {
        try {
            var saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
            if (saved && saved.userId === userId() && Date.now() - saved.at < CACHE_MS) return saved.state;
        } catch (_) { /* без кеш */ }
        return null;
    }

    function load(force) {
        var cached = !force && readCache();
        if (cached) { state = cached; return Promise.resolve(state); }
        if (loading) return loading;
        var id = userId();
        loading = fetch(WORKER_URL + '/api/user/access?userId=' + encodeURIComponent(id))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (data && typeof data.paywall === 'boolean') {
                    state = { paywall: data.paywall, tier: data.tier || 'start', until: data.until || null, features: data.features || {}, quotas: data.quotas || {} };
                    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ userId: id, at: Date.now(), state: state })); } catch (_) {}
                }
                return state;
            })
            .catch(function () { return state; }) // без мрежа — без заключване
            .then(function (s) { loading = null; return s; });
        return loading;
    }

    function quotaOf(feature) {
        var q = state.quotas && state.quotas[feature];
        return q && typeof q.limit === 'number' ? q : null;
    }

    function exhausted(feature) {
        var q = quotaOf(feature);
        return !!(q && q.used >= q.limit);
    }

    function can(feature) {
        if (!state.paywall) return true;
        if (exhausted(feature)) return false;
        if (Object.prototype.hasOwnProperty.call(state.features, feature)) return state.features[feature] !== false;
        return Pricing ? Pricing.allows(state.tier, feature) : true;
    }

    /** Колко остават до края на месеца (или null — без таван). */
    function remaining(feature) {
        var q = quotaOf(feature);
        return q ? Math.max(0, q.limit - q.used) : null;
    }

    /** Отбелязва успешно използване (сървърът брои сам; това е за показването). */
    function noteUse(feature) {
        var q = quotaOf(feature);
        if (q) q.used += 1;
    }

    function label(feature) {
        return (Pricing && Pricing.FEATURE_LABEL[feature]) || 'Тази функция';
    }

    function needPlan(feature) {
        var need = Pricing && Pricing.FEATURE_MIN_TIER[feature];
        return (need && Pricing.plan(need)) || null;
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /** HTML на заключената карта. В приложението — без цена и без линк към плащане. */
    function lockCard(feature, extraHtml) {
        var plan = needPlan(feature);
        var hasAccount = userId().indexOf('fb_') === 0;
        var body;
        var q = quotaOf(feature);
        if (q && q.used >= q.limit) {
            var upgrade = Pricing && Pricing.upgradeFor(state.tier, feature);
            var upPlan = upgrade && Pricing.plan(upgrade);
            body = '<p class="np-lock-text">Лимитът от ' + escapeHtml(Pricing ? Pricing.quotaText(q.limit, feature) : q.limit) + ' за месеца е изчерпан. Нови — от 1-во число.</p>' +
                (!isNativeApp() && upPlan
                    ? '<a class="np-lock-btn" href="pricing.html?feature=' + encodeURIComponent(feature) + '" target="_top">Повече в ' + escapeHtml(upPlan.name) + '</a>'
                    : '');
        } else if (isNativeApp()) {
            body = '<p class="np-lock-text">Част от абонамента' + (plan ? ' ' + escapeHtml(plan.name) : '') + '.' +
                (hasAccount ? ' Ако вече имаш абонамент, излез и влез отново със същия акаунт.' : ' Ако вече имаш абонамент, влез със същия акаунт.') + '</p>';
        } else {
            var href = 'pricing.html?feature=' + encodeURIComponent(feature);
            body = '<p class="np-lock-text">Отключва се с ' + (plan ? 'ниво ' + escapeHtml(plan.name) : 'абонамент') + '.</p>' +
                '<a class="np-lock-btn" href="' + href + '" target="_top">Виж нивата</a>';
        }
        return '<div class="np-lock" role="note"><div class="np-lock-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>' +
            '<div class="np-lock-title">' + escapeHtml(label(feature)) + '</div>' + body + (extraHtml || '') + '</div>';
    }

    function closeLock() {
        var el = document.getElementById('npLockModal');
        if (el) el.remove();
    }

    function showLock(feature) {
        closeLock();
        var wrap = document.createElement('div');
        wrap.id = 'npLockModal';
        wrap.className = 'np-lock-modal';
        wrap.innerHTML = '<div class="np-lock-sheet" role="dialog" aria-modal="true">' +
            '<button class="np-lock-close" type="button" aria-label="Затвори">&times;</button>' +
            lockCard(feature) + '</div>';
        wrap.addEventListener('click', function (e) {
            if (e.target === wrap || e.target.closest('.np-lock-close')) closeLock();
        });
        document.body.appendChild(wrap);
    }

    /** Полетата, с които сървърът проверява акаунта, когато стената е включена. */
    function authFields() {
        if (!state.paywall) return Promise.resolve({});
        var id = userId();
        if (id.indexOf('fb_') !== 0) return Promise.resolve({ userId: id });
        var sync = global.NutriPlanPlanSync || global.PlanSync;
        var getToken = sync && typeof sync.getFirebaseIdToken === 'function'
            ? sync.getFirebaseIdToken(id)
            : Promise.resolve(null);
        return Promise.resolve(getToken).then(function (token) {
            return token ? { userId: id, idToken: token } : { userId: id };
        }).catch(function () { return { userId: id }; });
    }

    /** Отказ 402 от сървъра → прозорецът за заключване. */
    function handleLocked(response, data) {
        if (!response || response.status !== 402) return false;
        var feature = (data && data.feature) || 'chat';
        state.paywall = true;
        if (data && data.reason === 'quota' && typeof data.limit === 'number') {
            state.quotas[feature] = { used: data.used, limit: data.limit };
        } else {
            state.features[feature] = false;
        }
        if (data && data.tier) state.tier = data.tier;
        showLock(feature);
        return true;
    }

    (function injectStyles() {
        if (document.getElementById('npLockStyles')) return;
        var css = '' +
            '.np-lock{--np-l-bg:#fff;--np-l-text:#0F2F2E;--np-l-sub:#4B5F5D;--np-l-line:rgba(15,118,110,.18);--np-l-acc:#0F766E;--np-l-tint:rgba(15,118,110,.12);' +
            'display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:24px 20px;border-radius:18px;' +
            'background:var(--np-l-bg);border:1px solid var(--np-l-line);color:var(--np-l-text)}' +
            '[data-theme="dark"] .np-lock{--np-l-bg:#0F2120;--np-l-text:#EAF4F3;--np-l-sub:#BFD0CE;--np-l-line:rgba(45,212,191,.2);--np-l-acc:#14B8A6;--np-l-tint:rgba(45,212,191,.16)}' +
            '.np-lock-ico{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:var(--np-l-tint);color:var(--np-l-acc)}' +
            '.np-lock-title{font-weight:700;font-size:1.05rem}' +
            '.np-lock-text{margin:0;font-size:.92rem;line-height:1.5;color:var(--np-l-sub);max-width:320px}' +
            '.np-lock-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 22px;border-radius:999px;' +
            'background:var(--np-l-acc);color:#fff;font-weight:600;text-decoration:none;margin-top:4px}' +
            '.np-lock-link{border:0;background:none;color:var(--np-l-acc);font-weight:600;font-size:.9rem;cursor:pointer;padding:6px}' +
            '.np-lock-modal{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px}' +
            '.np-lock-sheet{position:relative;width:100%;max-width:420px;margin-bottom:max(16px,env(safe-area-inset-bottom))}' +
            '.np-lock-close{position:absolute;top:10px;right:10px;width:36px;height:36px;border:0;border-radius:50%;background:transparent;color:inherit;font-size:22px;line-height:1;opacity:.6;cursor:pointer;z-index:1}' +
            '[data-theme="dark"] .np-lock-close{color:#EAF4F3}' +
            '@media(min-width:600px){.np-lock-modal{align-items:center}}';
        var style = document.createElement('style');
        style.id = 'npLockStyles';
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    })();

    global.NutriPlanAccess = {
        load: load,
        can: can,
        remaining: remaining,
        noteUse: noteUse,
        state: function () { return state; },
        isNativeApp: isNativeApp,
        lockCard: lockCard,
        showLock: showLock,
        authFields: authFields,
        handleLocked: handleLocked
    };
})(window);
