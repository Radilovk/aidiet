/**
 * Съгласие за AI — App Store 5.1.2(i): преди лични данни да стигнат до AI доставчик, човекът го разрешава изрично.
 *
 * Зарежда се само в приложението за iPhone (i18n.js го добавя при html.platform-ios). Заявките към AI адресите на
 * API-то (AI_PATHS) чакат съгласието: без него се показва листът „Как Nutriin използва AI“; „Съгласен съм“ пуска
 * заявката, „Не сега“ я отказва (функцията казва, че не е успяла) — останалото в приложението работи.
 * Листът се показва и веднъж на сесия при отваряне, ако човекът е влязъл и още не е отговорил — за да не го
 * изненада, когато отвори асистента.
 *
 * Съгласие има, ако: np_ai_consent (дата) в localStorage, или consentAi във въпросника (questionnaire2.html пита
 * за AI заедно със здравните данни). Отказът не се помни — ще се пита пак при следваща AI функция.
 *
 * API: window.NutriinAiConsent = { has(), ensure() → Promise<boolean>, revoke() }
 */
(function (global) {
    'use strict';
    if (global.NutriinAiConsent) return;
    var doc = global.document;
    var KEY = 'np_ai_consent';
    var SESSION_KEY = 'np_ai_consent_asked';
    // AI заявки с лични данни (worker.entry.js): план, асистент, снимки, изследвания, документи, седмичната корекция.
    var AI_PATHS = /\/api\/(generate-plan-async|generate-plan|validate-questionnaire|chat|analyze-food-image|enrichment|enrichment\/(extract-labs|extract-device|assess-document)|weekly\/(generate-questions|adapt-plan))(\?|$)/;

    function get(k) { try { return global.localStorage.getItem(k); } catch (_) { return null; } }

    function has() {
        if (get(KEY)) return true;
        try {
            var a = JSON.parse(get('questionnaireAnswers') || 'null');
            return !!(a && a.consentAi);
        } catch (_) { return false; }
    }

    function revoke() { try { global.localStorage.removeItem(KEY); } catch (_) {} }

    var pending = null;
    function ensure() {
        if (has()) return Promise.resolve(true);
        if (pending) return pending;
        pending = new Promise(function (resolve) {
            function show() {
                var dark = doc.documentElement.getAttribute('data-theme') === 'dark';
                var c = dark
                    ? { bg: '#0F2120', text: '#EAF4F3', sub: '#BFD0CE', line: 'rgba(45,212,191,.25)', acc: '#14B8A6', on: '#04211F' }
                    : { bg: '#fff', text: '#0F2F2E', sub: '#4B5F5D', line: '#cbd5e1', acc: '#03939C', on: '#fff' };
                var ov = doc.createElement('div');
                ov.id = 'npAiConsent';
                ov.setAttribute('role', 'dialog');
                ov.setAttribute('aria-modal', 'true');
                ov.setAttribute('aria-labelledby', 'npAiConsentTitle');
                ov.style.cssText = 'position:fixed;inset:0;z-index:20050;background:rgba(10,26,26,.6);display:flex;align-items:flex-end;justify-content:center;' +
                    'padding:16px 16px max(16px,env(safe-area-inset-bottom));';
                ov.innerHTML =
                    '<div style="background:' + c.bg + ';color:' + c.text + ';border-radius:20px;padding:22px 20px;max-width:440px;width:100%;' +
                    'box-shadow:0 20px 60px rgba(0,0,0,.3);font-size:.93rem;line-height:1.55">' +
                    '<h2 id="npAiConsentTitle" style="margin:0 0 10px;font-size:1.1rem">Как Nutriin използва AI</h2>' +
                    '<p style="margin:0 0 10px">За плана, асистента, снимките на храната и разчитането на изследвания Nutriin изпраща нужните данни — профила, храненето, снимките и документите, които добавиш — на доставчици на изкуствен интелект: Google (Gemini), OpenAI и Anthropic.</p>' +
                    '<p style="margin:0 0 12px;color:' + c.sub + '">Изпращат се само за конкретната заявка и не се използват за обучение на модели. Планът се преглежда от специалист.</p>' +
                    '<p style="margin:0 0 16px"><a href="privacy-policy.html" style="color:' + c.acc + ';font-weight:600">Политика за поверителност</a></p>' +
                    '<div style="display:flex;gap:10px">' +
                    '<button type="button" data-ai="no" style="flex:1;min-height:48px;border-radius:14px;border:1.5px solid ' + c.line + ';background:transparent;color:' + c.text + ';font:inherit;font-weight:600">Не сега</button>' +
                    '<button type="button" data-ai="yes" style="flex:1;min-height:48px;border-radius:14px;border:none;background:' + c.acc + ';color:' + c.on + ';font:inherit;font-weight:700">Съгласен съм</button>' +
                    '</div></div>';
                doc.body.appendChild(ov);
                ov.addEventListener('click', function (e) {
                    var b = e.target.closest('[data-ai]');
                    if (!b) return;
                    var yes = b.getAttribute('data-ai') === 'yes';
                    if (yes) { try { global.localStorage.setItem(KEY, new Date().toISOString()); } catch (_) {} }
                    try { global.sessionStorage.setItem(SESSION_KEY, '1'); } catch (_) {}
                    ov.remove();
                    pending = null;
                    resolve(yes);
                });
                var first = ov.querySelector('[data-ai="yes"]');
                if (first) first.focus();
            }
            if (doc.body) show(); else doc.addEventListener('DOMContentLoaded', show, { once: true });
        });
        return pending;
    }

    function note(text) {
        if (!doc.body) return;
        var el = doc.createElement('div');
        el.setAttribute('role', 'status');
        el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:max(24px,env(safe-area-inset-bottom));z-index:20060;margin:0 auto;max-width:420px;' +
            'background:#0F2F2E;color:#fff;border-radius:14px;padding:12px 16px;font-size:.9rem;line-height:1.45;box-shadow:0 8px 30px rgba(0,0,0,.25)';
        el.textContent = text;
        doc.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 4500);
    }

    // Заявките към AI чакат съгласието.
    if (global.fetch) {
        var origFetch = global.fetch;
        global.fetch = function (input, init) {
            var self = this, args = arguments;
            var url = '';
            try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) {}
            var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
            var path = url.replace(/^https?:\/\/[^/]+/, '').split('#')[0];
            if (method !== 'POST' || !AI_PATHS.test(path) || has()) return origFetch.apply(self, args);
            return ensure().then(function (ok) {
                if (ok) return origFetch.apply(self, args);
                note('Тази функция използва AI. Ще те попитаме пак, когато я отвориш.');
                throw new Error('ai_consent_declined');
            });
        };
    }

    // Веднъж на сесия при отваряне — само за влязъл човек и не във въпросника (той пита сам).
    function askOnOpen() {
        if (has() || /questionnaire/.test(global.location.pathname)) return;
        try { if (global.sessionStorage.getItem(SESSION_KEY)) return; } catch (_) {}
        if (!get('userId')) return;
        try { if (global.top !== global) return; } catch (_) { return; }
        setTimeout(function () { if (!has() && !doc.getElementById('npAiConsent')) ensure(); }, 1200);
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', askOnOpen, { once: true }); else askOnOpen();

    global.NutriinAiConsent = { has: has, ensure: ensure, revoke: revoke };
})(window);
