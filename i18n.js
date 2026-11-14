/**
 * Eatologix — преводи на интерфейса.
 *
 * Страниците са писани на български. Модулът превежда видимия текст, без да пипа HTML-а:
 *  1. Речник (ръчен, с предимство): i18n/<език>/common.json + i18n/<език>/<страница>.json
 *     - "strings": точен български текст → превод (текстови възли и aria-label, placeholder,
 *       title, alt, meta content, <title>, бутони);
 *     - "keys": елементи с data-i18n="ключ" (един и същ текст с различен превод, напр. „П“);
 *     - "patterns": [regex, замяна] за текст с числа.
 *  2. Резервен превод: каквото остане на кирилица (динамичен текст, планът, храните, отговори на AI)
 *     отива към POST /api/i18n/translate — AI превод, пазен в KV завинаги и общ за всички;
 *     тук се пази и в localStorage, за да не се иска пак.
 *  Новият текст в DOM-а (модали, динамично съдържание) се хваща от MutationObserver.
 *  Всяка JSON заявка към API-то получава lang (и userData.lang) — AI пише на езика на клиента.
 *
 * Езикът: ?lang= → изричен избор (localStorage ex_lang) → български.
 * Чужд език на браузъра не сменя езика сам — показва се тиха покана („Read in English?“).
 * На български модулът не прави нищо освен избора на език — нулев разход за сегашните потребители.
 *
 * API: window.EatologixI18n = { lang, supported, names, setLang(code), t(bgText), apply(root), ready }.
 *      Елементи <select data-lang-picker> (или data-lang-picker="short") стават избор на език.
 *      data-i18n-skip — поддървото не се превежда (имена, въведен текст и т.н.).
 */
(function () {
    'use strict';
    if (window.EatologixI18n) return;

    var SUPPORTED = ['bg', 'en', 'de', 'es', 'ru'];
    var NAMES = { bg: 'Български', en: 'English', de: 'Deutsch', es: 'Español', ru: 'Русский' };
    var INVITE = { en: 'Read in English?', de: 'Auf Deutsch lesen?', es: '¿Leer en español?', ru: 'Читать на русском?' };
    var STORE_KEY = 'ex_lang';
    var INVITE_KEY = 'ex_lang_invite_dismissed';
    var API = 'https://aidiet.radilov-k.workers.dev';
    // Страници със собствен речник (останалите ползват common + резервния превод).
    var PAGE_DICTS = ['index', 'questionnaire2', 'plan', 'profile', 'analysis', 'plan-pending', 'guidelines',
        'quick-answer', 'game-analytics', 'features', 'help', 'privacy-policy', 'terms', 'delete-account', 'warning'];
    var CYR = /[Ѐ-ӿ]/;
    // Руският също е на кирилица: текст с ы, э, ё (няма ги в българския) вече е на руски — не се превежда.
    var RU_ONLY = /[ыэёЫЭЁ]/;

    function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
    function norm(code) {
        code = String(code || '').toLowerCase().split('-')[0];
        return SUPPORTED.indexOf(code) >= 0 ? code : null;
    }

    function detect() {
        var fromUrl = null;
        try { fromUrl = norm(new URLSearchParams(location.search).get('lang')); } catch (e) { /* old browser */ }
        if (fromUrl) { safeSet(STORE_KEY, fromUrl); return fromUrl; }
        var saved = norm(safeGet(STORE_KEY));
        if (saved) return saved;
        // Вградена страница (iframe в SPA обвивката) следва родителя.
        try { if (window.parent !== window && window.parent.EatologixI18n) return window.parent.EatologixI18n.lang; } catch (e) { /* cross-origin */ }
        return 'bg';
    }
    function browserForeign() {
        var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
        for (var i = 0; i < langs.length; i++) { if (norm(langs[i]) === 'bg') return null; }
        for (var j = 0; j < langs.length; j++) { var c = norm(langs[j]); if (c && c !== 'bg') return c; }
        return null;
    }

    var lang = detect();
    var root = document.documentElement;
    root.setAttribute('lang', lang);
    var dict = { strings: {}, keys: {}, patterns: [] };
    var hasDict = false;

    var api = {
        lang: lang,
        supported: SUPPORTED.slice(),
        names: NAMES,
        t: function (s) { return lang === 'bg' ? s : translate(s, true); },
        setLang: function (code) {
            code = norm(code) || 'bg';
            safeSet(STORE_KEY, code);
            try {
                var u = new URL(location.href);
                if (u.searchParams.has('lang')) { u.searchParams.set('lang', code); location.replace(u.toString()); return; }
            } catch (e) { /* ignore */ }
            try { if (window.top !== window && window.top.EatologixI18n) { window.top.location.reload(); return; } } catch (e) { /* ignore */ }
            location.reload();
        },
        apply: function (node) { if (lang !== 'bg') walk(node || document.documentElement); },
        ready: null
    };
    window.EatologixI18n = api;

    // ── Език към сървъра: всяка JSON заявка към API-то носи lang ─────────────────────────
    if (lang !== 'bg' && window.fetch) {
        var origFetch = window.fetch;
        window.fetch = function (input, init) {
            try {
                var url = typeof input === 'string' ? input : (input && input.url) || '';
                var isApi = url.indexOf(API) === 0 || /^\/api\//.test(url) || url.indexOf(location.origin + '/api/') === 0;
                if (isApi && init && typeof init.body === 'string' && init.body.charAt(0) === '{' && url.indexOf('/api/i18n/') < 0) {
                    var b = JSON.parse(init.body);
                    if (b && typeof b === 'object' && !Array.isArray(b)) {
                        if (!b.lang) b.lang = lang;
                        if (b.userData && typeof b.userData === 'object' && !b.userData.lang) b.userData.lang = lang;
                        init = Object.assign({}, init, { body: JSON.stringify(b) });
                    }
                }
            } catch (e) { /* не JSON — без промяна */ }
            return origFetch.call(this, input, init);
        };
    }

    // ── Превод по речник ────────────────────────────────────────────────────────────────
    var mem = {};   // резервните преводи (от localStorage и сървъра)
    var MEM_KEY = 'ex_i18n_' + lang;
    function loadMem() {
        try { mem = JSON.parse(safeGet(MEM_KEY) || '{}') || {}; } catch (e) { mem = {}; }
    }
    function saveMem() {
        try {
            var s = JSON.stringify(mem);
            if (s.length > 1500000) { mem = {}; s = '{}'; } // таван ~1.5 MB — после се пълни отново от KV
            localStorage.setItem(MEM_KEY, s);
        } catch (e) { /* пълно хранилище */ }
    }

    var outputs = {}; // готовите преводи — никога не се превеждат повторно
    function lookup(core) {
        if (outputs[core]) return core;
        var hit = dict.strings[core];
        if (hit != null) return hit;
        for (var i = 0; i < dict.patterns.length; i++) {
            var p = dict.patterns[i];
            if (p[0].test(core)) return core.replace(p[0], p[1]);
        }
        hit = mem[core];
        return hit != null ? hit : null;
    }
    function translate(s, queue) {
        if (!s) return s;
        var core = s.replace(/\s+/g, ' ').trim();
        if (!core || !CYR.test(core)) return s;
        if (lang === 'ru' && RU_ONLY.test(core)) return s;
        var hit = lookup(core);
        if (hit == null) { if (queue) want(core); return s; }
        if (hit === core) return s;
        outputs[hit.replace(/\s+/g, ' ').trim()] = 1;
        var lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
        return lead + hit + trail;
    }

    var ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
    var META_NAMES = /^(description|apple-mobile-web-app-title|twitter:title|twitter:description|og:title|og:description)$/;
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, svg: 1, SVG: 1, IFRAME: 1 };

    function doElement(el) {
        var key = el.getAttribute('data-i18n');
        if (key && dict.keys[key] != null) { if (el.textContent !== dict.keys[key]) el.textContent = dict.keys[key]; return; }
        for (var i = 0; i < ATTRS.length; i++) {
            var v = el.getAttribute(ATTRS[i]);
            if (v) { var t = translate(v, true); if (t !== v) el.setAttribute(ATTRS[i], t); }
        }
        if (el.tagName === 'META' && META_NAMES.test(el.getAttribute('name') || el.getAttribute('property') || '')) {
            var c = el.getAttribute('content'); var tc = translate(c, false);
            if (tc !== c) el.setAttribute('content', tc);
        }
        if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button') && el.value) {
            var tv = translate(el.value, true); if (tv !== el.value) el.value = tv;
        }
        if (el.tagName === 'OPTION' && el.parentNode && el.parentNode.hasAttribute && el.parentNode.hasAttribute('data-lang-picker')) return;
    }
    function skipped(el) {
        return SKIP[el.nodeName] || el.isContentEditable || (el.hasAttribute && el.hasAttribute('data-i18n-skip'));
    }
    function walk(node) {
        if (!node) return;
        if (node.nodeType === 3) {
            var p = node.parentNode;
            if (!p || skipped(p)) return;
            var t = translate(node.nodeValue, true);
            if (t !== node.nodeValue) node.nodeValue = t;
            return;
        }
        if (node.nodeType !== 1 || skipped(node)) return;
        doElement(node);
        if (node.hasAttribute('data-i18n') && dict.keys[node.getAttribute('data-i18n')] != null) return;
        for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
    }

    // ── Резервен превод (AI, кеширан) ───────────────────────────────────────────────────
    var pending = {}, pendingCount = 0, inflight = false, timer = null, failures = 0;
    function want(core) {
        if (core.length > 700 || pending[core] || mem[core] != null) return;
        pending[core] = 1; pendingCount++;
        if (!timer) timer = setTimeout(flush, 250);
    }
    function flush() {
        timer = null;
        if (inflight || !pendingCount || failures > 3) return;
        var batch = Object.keys(pending).slice(0, 50);
        batch.forEach(function (k) { delete pending[k]; });
        pendingCount = Object.keys(pending).length;
        inflight = true;
        var f = window.fetch;
        f.call(window, API + '/api/i18n/translate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lang: lang, strings: batch })
        }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
            inflight = false;
            var tr = data && data.translations;
            if (!tr) { failures++; return; }
            var got = 0;
            for (var k in tr) { if (Object.prototype.hasOwnProperty.call(tr, k)) { mem[k] = tr[k]; got++; } }
            if (got) { saveMem(); applySoon(); }
            if (pendingCount) timer = setTimeout(flush, 120);
        }).catch(function () { inflight = false; failures++; });
    }
    var applyTimer = null;
    function applySoon() {
        if (applyTimer) return;
        applyTimer = setTimeout(function () { applyTimer = null; walk(document.documentElement); translateTitle(); }, 30);
    }
    function translateTitle() {
        var t = translate(document.title, true);
        if (t !== document.title) document.title = t;
    }

    function observe() {
        if (!window.MutationObserver) return;
        new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                var m = muts[i];
                if (m.type === 'characterData') { walk(m.target); continue; }
                if (m.type === 'attributes') { if (m.target.nodeType === 1 && !skipped(m.target)) doElement(m.target); continue; }
                for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
            }
        }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }

    // ── Избор на език ───────────────────────────────────────────────────────────────────
    function wirePickers() {
        var sels = document.querySelectorAll('select[data-lang-picker]');
        for (var i = 0; i < sels.length; i++) {
            var sel = sels[i];
            if (sel.__exWired) continue;
            sel.__exWired = true;
            sel.innerHTML = '';
            for (var k = 0; k < SUPPORTED.length; k++) {
                var o = document.createElement('option');
                o.value = SUPPORTED[k];
                o.textContent = sel.getAttribute('data-lang-picker') === 'short' ? SUPPORTED[k].toUpperCase() : NAMES[SUPPORTED[k]];
                if (SUPPORTED[k] === lang) o.selected = true;
                sel.appendChild(o);
            }
            sel.setAttribute('data-i18n-skip', '');
            sel.addEventListener('change', function (e) { api.setLang(e.target.value); });
        }
    }
    // Тиха покана за чужд език на браузъра (само на горната страница, само веднъж).
    function maybeInvite() {
        if (lang !== 'bg' || window.top !== window || safeGet(STORE_KEY) || safeGet(INVITE_KEY)) return;
        if (safeGet('userId') || safeGet('userData') || safeGet('dietPlan')) return; // вече ползва приложението
        var code = browserForeign();
        if (!code || !INVITE[code]) return;
        var bar = document.createElement('div');
        bar.setAttribute('data-i18n-skip', '');
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', 'Language');
        bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;display:flex;gap:8px;align-items:center;' +
            'padding:8px 8px 8px 14px;border-radius:999px;background:#04181C;color:#E4FBF8;font:500 14px/1.2 Inter,system-ui,sans-serif;' +
            'box-shadow:0 10px 30px -10px rgba(0,0,0,.5);max-width:calc(100vw - 32px)';
        var txt = document.createElement('span'); txt.textContent = INVITE[code]; txt.style.whiteSpace = 'nowrap';
        var yes = document.createElement('button'); yes.type = 'button'; yes.textContent = NAMES[code];
        yes.style.cssText = 'white-space:nowrap;flex:none;border:0;border-radius:999px;padding:8px 14px;font:600 14px Inter,system-ui,sans-serif;cursor:pointer;color:#04181C;background:linear-gradient(120deg,#00E0DC,#10CC50 60%,#A0F500)';
        var no = document.createElement('button'); no.type = 'button'; no.textContent = '×'; no.setAttribute('aria-label', 'Close');
        no.style.cssText = 'border:0;background:transparent;color:#9FC9C4;font-size:20px;line-height:1;padding:4px 8px;cursor:pointer';
        yes.onclick = function () { api.setLang(code); };
        no.onclick = function () { safeSet(INVITE_KEY, '1'); bar.remove(); };
        bar.appendChild(txt); bar.appendChild(yes); bar.appendChild(no);
        document.body.appendChild(bar);
    }
    function onReady(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }
    onReady(function () { wirePickers(); setTimeout(maybeInvite, 1200); });

    if (lang === 'bg') { api.ready = Promise.resolve(); return; }

    // ── Зареждане на речниците; текстът е скрит до 1.2 s, за да не мига на български ──────
    loadMem();
    root.classList.add('i18n-pending');
    var style = document.createElement('style');
    style.textContent = 'html.i18n-pending body{visibility:hidden}';
    (document.head || root).appendChild(style);
    function reveal() { root.classList.remove('i18n-pending'); }
    var failSafe = setTimeout(reveal, 1200);

    var base = (function () {
        var s = document.currentScript && document.currentScript.src;
        return s ? s.replace(/[^/]*$/, '') : './';
    })();
    var page = (location.pathname.split('/').pop() || 'index.html').replace(/\.html?$/, '') || 'index';
    var files = ['common'];
    if (PAGE_DICTS.indexOf(page) >= 0) files.push(page);
    var V = '20261114a';

    api.ready = Promise.all(files.map(function (f) {
        return fetch(base + 'i18n/' + lang + '/' + f + '.json?v=' + V)
            .then(function (r) { return r.ok ? r.json() : {}; })
            .catch(function () { return {}; });
    })).then(function (parts) {
        parts.forEach(function (d) {
            var k;
            for (k in (d.strings || {})) dict.strings[k] = d.strings[k];
            for (k in (d.keys || {})) dict.keys[k] = d.keys[k];
            (d.patterns || []).forEach(function (p) { try { dict.patterns.push([new RegExp(p[0]), p[1]]); } catch (e) { /* лош regex */ } });
        });
        hasDict = true;
        return new Promise(function (res) {
            onReady(function () {
                translateTitle();
                walk(document.documentElement);
                observe();
                clearTimeout(failSafe);
                reveal();
                res();
            });
        });
    });
})();
