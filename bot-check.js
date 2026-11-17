/**
 * Проверка „човек ли е“ (Cloudflare Turnstile) за безплатните AI функции.
 *   EatologixBotCheck.token() → Promise<string>  — жетон за едно изпращане ('' ако е изключено)
 * Ключът идва от сървъра (GET /api/turnstile/config); без ключ — нищо не се зарежда.
 * Обикновено е невидимо; ако Cloudflare поиска действие, долу се показва малко поле с отметка.
 * Жетонът е за еднократна употреба — вземай нов за всяко изпращане.
 */
(function (global) {
    'use strict';
    var WORKER = 'https://aidiet.radilov-k.workers.dev';
    var SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    var configP = null;
    var scriptP = null;

    function config() {
        configP = configP || fetch(WORKER + '/api/turnstile/config')
            .then(function (r) { return r.json(); })
            .then(function (d) { return (d && d.siteKey) || ''; })
            .catch(function () { return ''; });
        return configP;
    }

    function loadScript() {
        scriptP = scriptP || new Promise(function (resolve, reject) {
            if (global.turnstile) return resolve(global.turnstile);
            var s = document.createElement('script');
            s.src = SCRIPT; s.async = true; s.defer = true;
            s.onload = function () { global.turnstile ? resolve(global.turnstile) : reject(new Error('turnstile')); };
            s.onerror = function () { scriptP = null; reject(new Error('turnstile')); };
            document.head.appendChild(s);
        });
        return scriptP;
    }

    function box() {
        var el = document.getElementById('npBotCheck');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'npBotCheck';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Проверка, че не сте робот');
        el.style.cssText = 'position:fixed;left:50%;bottom:max(16px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:10060;display:none';
        document.body.appendChild(el);
        return el;
    }

    function token() {
        return config().then(function (siteKey) {
            if (!siteKey) return '';
            return loadScript().then(function (ts) {
                return new Promise(function (resolve) {
                    var el = box();
                    var holder = document.createElement('div');
                    el.appendChild(holder);
                    var id = null;
                    var done = false;
                    var finish = function (t) {
                        if (done) return;
                        done = true;
                        el.style.display = 'none';
                        try { if (id !== null) ts.remove(id); } catch (e) { /* вече махнат */ }
                        holder.remove();
                        resolve(t || '');
                    };
                    var timer = setTimeout(function () { finish(''); }, 60000);
                    id = ts.render(holder, {
                        sitekey: siteKey,
                        appearance: 'interaction-only',
                        language: (document.documentElement.lang || 'auto').slice(0, 2),
                        callback: function (t) { clearTimeout(timer); finish(t); },
                        'error-callback': function () { clearTimeout(timer); finish(''); return true; },
                        'expired-callback': function () { /* жетонът се взима наново при следващото изпращане */ },
                        'before-interactive-callback': function () { el.style.display = 'block'; },
                        'after-interactive-callback': function () { el.style.display = 'none'; }
                    });
                });
            }).catch(function () { return ''; });
        });
    }

    global.EatologixBotCheck = { token: token };
}(typeof window !== 'undefined' ? window : this));
