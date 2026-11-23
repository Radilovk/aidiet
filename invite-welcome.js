/**
 * Лендинг за поканените (index.html): дошъл е по връзка nutriin.app/?invite=DUO482 → в началото
 * на страницата — „Покана от приятел · −15% за първия ти план“. Кодът го пази partner-ref.js
 * (60 дни) и се прилага сам при плащането (pricing.html → billing.js); въпросникът го праща
 * към сървъра за отчета (invite_signup).
 *
 * Не се показва в приложението (там няма цени — правилата на магазините) и при влязъл човек.
 * Текстовете се сменят от админ панела (Награди → inviteLandingTitle / inviteLandingText).
 */
(function () {
    'use strict';
    var WORKER = 'https://aidiet.radilov-k.workers.dev';
    var SEEN = 'np_invite_seen';

    function inApp() {
        try {
            if (new URLSearchParams(location.search).get('app') === '1') return true;
            return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        } catch (_) { return false; }
    }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function fill(t, vars) { return String(t).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; }); }

    function show(code, pct, texts) {
        var box = document.getElementById('lpInvite');
        if (!box) return;
        var title = texts.inviteLandingTitle || 'Покана от приятел';
        var text = fill(texts.inviteLandingText || '−{pct}% за първия ти план. Отстъпката се прилага сама при плащането.', { pct: pct, code: code });
        box.innerHTML = '<i class="fas fa-gift" aria-hidden="true"></i><span><b>' + esc(title) + '</b> · ' + esc(text) + '</span>';
        box.hidden = false;
    }

    function run() {
        if (inApp()) return;
        try { if (String(localStorage.getItem('userId') || '').indexOf('fb_') === 0 && localStorage.getItem('dietPlan')) return; } catch (_) { /* частен режим */ }
        var code = window.NutriPlanPartnerRef && NutriPlanPartnerRef.invite ? NutriPlanPartnerRef.invite() : '';
        if (!code) return;
        Promise.all([
            fetch(WORKER + '/api/rewards/invite?code=' + encodeURIComponent(code)).then(function (r) { return r.json(); }),
            fetch(WORKER + '/api/rewards/content').then(function (r) { return r.json(); }).catch(function () { return {}; })
        ]).then(function (res) {
            var st = res[0] || {};
            if (!st.valid) { try { localStorage.removeItem('np_invite'); } catch (_) {} return; }
            show(code, st.pct, ((res[1] || {}).content || {}).texts || {});
            // Посещение от покана — веднъж на устройство за код (за отчета, без лични данни).
            var seen = '';
            try { seen = localStorage.getItem(SEEN) || ''; } catch (_) {}
            if (seen !== code) {
                try { localStorage.setItem(SEEN, code); } catch (_) {}
                fetch(WORKER + '/api/rewards/event', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'invite_visit' }) }).catch(function () {});
            }
        }).catch(function () { /* без връзка — без банер */ });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
}());
