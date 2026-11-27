/**
 * Nutriin за iPhone — клиентско приложение (IOS_APP_STORE_PLAN.md, „Клиентският режим“).
 *
 * Профилът, въпросникът, анализът, плащането и модулите са на сайта. Приложението за iPhone е входът към вече
 * съществуващия профил: планът и денят, напредъкът, наградите, напомнянията, данните от телефона и помощта.
 * Зарежда го i18n.js само на iPhone; пренасочването от страниците само за сайта е в i18n.js (преди рисуването).
 *
 *  - крие входовете към страниците само за сайта и редактирането на профила (то пуска нов план);
 *  - index.html без вход → екран само за вход; с вход, но без план → „Планът ти още не е готов“.
 */
(function (global) {
    'use strict';
    if (global.__nutriinCompanion) return;
    global.__nutriinCompanion = true;
    var doc = global.document;

    var css =
        // Връзки към страниците само за сайта и към началната страница за посетители
        'a[href*="questionnaire2.html"],a[href*="analysis.html"],a[href*="features.html"],a[href*="pricing.html"],' +
        'a[href*="index.html?stay=1"],#loginSwitchBtn,#startNowBtn,#heroCTABtn,' +
        // Профил: данните за плана се попълват и променят в сайта (там е и новият план)
        '#cardMeter,#labsSection,#docsSection,#analysisSection,#editBtn,#saveBtn,#saveAndRegenerateBtn,#cancelBtn' +
        '{display:none!important}' +
        '#npCompanion{position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'gap:14px;padding:max(24px,env(safe-area-inset-top)) 28px max(28px,env(safe-area-inset-bottom));text-align:center;' +
        'background:#032E36;color:#EAF4F3;font:16px/1.5 -apple-system,system-ui,sans-serif}' +
        '#npCompanion img{width:96px;height:96px;margin-bottom:6px}' +
        '#npCompanion h1{margin:0;font-size:1.6rem;font-weight:700;letter-spacing:.2px}' +
        '#npCompanion p{margin:0;max-width:340px;color:#BFD0CE}' +
        '#npCompanion .np-c-actions{display:flex;flex-direction:column;gap:10px;width:100%;max-width:320px;margin-top:12px}' +
        '#npCompanion button{min-height:50px;border-radius:14px;font:inherit;font-weight:700;cursor:pointer}' +
        '#npCompanion .np-c-main{border:0;background:#2CCB82;color:#04211F}' +
        '#npCompanion .np-c-alt{border:1.5px solid rgba(234,244,243,.35);background:transparent;color:#EAF4F3;font-weight:600}' +
        '#loginModal{z-index:9500!important}';
    var style = doc.createElement('style');
    style.id = 'np-companion';
    style.textContent = css;
    (doc.head || doc.documentElement).appendChild(style);

    function get(k) { try { return global.localStorage.getItem(k); } catch (_) { return null; } }

    function screen(kind) {
        if (doc.getElementById('npCompanion')) return;
        var guest = kind === 'guest';
        var el = doc.createElement('div');
        el.id = 'npCompanion';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-labelledby', 'npCompanionTitle');
        el.innerHTML =
            '<img src="brand/nutriin-mark-big.svg" alt="">' +
            '<h1 id="npCompanionTitle">' + (guest ? 'Nutriin' : 'Планът ти още не е готов') + '</h1>' +
            '<p>' + (guest
                ? 'Влез с профила си: планът и денят, напредъкът, напомнянията и данните от телефона — на едно място.'
                : 'Ще получиш имейл, когато е готов. Тогава го отвори тук.') + '</p>' +
            '<div class="np-c-actions">' +
            (guest
                ? '<button type="button" class="np-c-main" data-c="login">Вход</button>'
                : '<button type="button" class="np-c-main" data-c="again">Провери пак</button>' +
                  '<button type="button" class="np-c-alt" data-c="out">Изход</button>') +
            '</div>';
        el.addEventListener('click', function (e) {
            var b = e.target.closest('[data-c]');
            if (!b) return;
            var c = b.getAttribute('data-c');
            if (c === 'login') openLogin();
            if (c === 'again') global.location.replace('index.html');
            if (c === 'out' && typeof global.indexSignOut === 'function') global.indexSignOut();
        });
        doc.body.appendChild(el);
        if (guest) openLogin();
    }

    /** Формата за вход идва от модула на Firebase в index.html — изчаква го до 15 секунди. */
    function openLogin(tries) {
        tries = tries || 0;
        if (typeof global.indexOpenLoginModal === 'function') return global.indexOpenLoginModal();
        if (tries < 60) setTimeout(function () { openLogin(tries + 1); }, 250);
    }

    function onIndex() {
        var page = (global.location.pathname.split('/').pop() || 'index.html').toLowerCase();
        if (page !== 'index.html' && page !== '') return;
        var params = new URLSearchParams(global.location.search);
        if (params.has('app')) return;                                 // обвивката на приложението (табовете)
        var user = (get('userId') || '').indexOf('fb_') === 0;
        var plan = !!get('dietPlan');
        if (params.get('companion') === 'noplan' || (user && !plan && !params.has('login'))) return screen('noplan');
        if (!user) return screen('guest');
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', onIndex, { once: true }); else onIndex();

    global.NutriinCompanion = { screen: screen };
})(window);
