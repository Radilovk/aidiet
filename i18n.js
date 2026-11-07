/**
 * NutriDeus — преводи на интерфейса.
 *
 * Страниците са писани на български. Този модул превежда видимия текст по речник
 * (i18n/<език>.json), без да се пипа HTML-ът на всяка страница:
 *  - "strings": точен български текст → превод (текстови възли и атрибутите
 *    aria-label, placeholder, title, alt, meta content, <title>);
 *  - "keys": елементи с data-i18n="ключ" (когато един и същ български текст
 *    трябва да се преведе различно, напр. „П“ = понеделник/петък);
 *  - "patterns": [regex, замяна] за текстове с числа („Свали APK v1.0.806“).
 * Нов текст в DOM-а (модали, динамично съдържание) се превежда през MutationObserver.
 *
 * Езикът: ?lang= → изричен избор (localStorage) → вече ползвал приложението
 * (има данни) → bg → първият поддържан език на браузъра → en.
 * На български модулът не прави нищо — нулев разход за сегашните потребители.
 *
 * API: window.NutriI18n.{lang, supported, setLang(code), t(bgText), apply(root)}.
 */
(function () {
    'use strict';
    var SUPPORTED = ['bg', 'en', 'de', 'es'];
    var NAMES = { bg: 'Български', en: 'English', de: 'Deutsch', es: 'Español' };
    var STORE_KEY = 'nd_lang';
    var DEFAULT_FOREIGN = 'en';

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
        // Сегашните клиенти (често с английски език на телефона) остават на български.
        if (safeGet('userId') || safeGet('userData') || safeGet('dietPlan')) return 'bg';
        var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
        for (var i = 0; i < langs.length; i++) { if (norm(langs[i]) === 'bg') return 'bg'; }
        for (var j = 0; j < langs.length; j++) { var c = norm(langs[j]); if (c) return c; }
        return DEFAULT_FOREIGN;
    }

    var lang = detect();
    var dict = null;
    var root = document.documentElement;
    root.setAttribute('lang', lang);

    var api = {
        lang: lang,
        supported: SUPPORTED.slice(),
        names: NAMES,
        t: function (s) { return lang === 'bg' ? s : translate(s); },
        setLang: function (code) {
            code = norm(code) || 'bg';
            safeSet(STORE_KEY, code);
            try {
                var u = new URL(location.href);
                if (u.searchParams.has('lang')) { u.searchParams.set('lang', code); location.replace(u.toString()); return; }
            } catch (e) { /* ignore */ }
            location.reload();
        },
        apply: function (node) { if (dict) walk(node || document.documentElement); },
        ready: null
    };
    window.NutriI18n = api;

    function translate(s) {
        if (!dict || !s) return s;
        var core = s.replace(/\s+/g, ' ').trim();
        if (!core) return s;
        var hit = dict.strings[core];
        if (hit == null) {
            for (var i = 0; i < dict.patterns.length; i++) {
                var p = dict.patterns[i];
                if (p[0].test(core)) { hit = core.replace(p[0], p[1]); break; }
            }
        }
        if (hit == null) return s;
        var lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
        return lead + hit + trail;
    }

    var ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
    var META_NAMES = /^(description|apple-mobile-web-app-title|twitter:title|twitter:description|og:title|og:description)$/;
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };

    function doElement(el) {
        var key = el.getAttribute('data-i18n');
        if (key && dict.keys[key] != null) { el.textContent = dict.keys[key]; return; }
        for (var i = 0; i < ATTRS.length; i++) {
            var v = el.getAttribute(ATTRS[i]);
            if (v) { var t = translate(v); if (t !== v) el.setAttribute(ATTRS[i], t); }
        }
        if (el.tagName === 'META' && META_NAMES.test(el.getAttribute('name') || el.getAttribute('property') || '')) {
            var c = el.getAttribute('content'); var tc = translate(c);
            if (tc !== c) el.setAttribute('content', tc);
        }
        if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button') && el.value) {
            var tv = translate(el.value); if (tv !== el.value) el.value = tv;
        }
    }

    function walk(node) {
        if (!node) return;
        if (node.nodeType === 3) {
            var p = node.parentNode;
            if (p && SKIP[p.nodeName]) return;
            var t = translate(node.nodeValue);
            if (t !== node.nodeValue) node.nodeValue = t;
            return;
        }
        if (node.nodeType !== 1 || SKIP[node.nodeName] || node.hasAttribute('data-i18n-skip')) return;
        doElement(node);
        if (node.hasAttribute('data-i18n') && dict.keys[node.getAttribute('data-i18n')] != null) return;
        for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
    }

    function observe() {
        if (!window.MutationObserver) return;
        new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                var m = muts[i];
                if (m.type === 'characterData') { walk(m.target); continue; }
                if (m.type === 'attributes') { if (m.target.nodeType === 1) doElement(m.target); continue; }
                for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
            }
        }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }

    function reveal() { root.classList.remove('i18n-pending'); }

    // Езиков избор: всеки <select data-lang-picker> се попълва и сменя езика.
    function wirePickers() {
        var sels = document.querySelectorAll('select[data-lang-picker]');
        for (var i = 0; i < sels.length; i++) {
            var sel = sels[i];
            if (sel.__ndWired) continue;
            sel.__ndWired = true;
            sel.innerHTML = '';
            for (var k = 0; k < SUPPORTED.length; k++) {
                var o = document.createElement('option');
                o.value = SUPPORTED[k];
                o.textContent = sel.getAttribute('data-lang-picker') === 'short'
                    ? SUPPORTED[k].toUpperCase()
                    : NAMES[SUPPORTED[k]];
                if (SUPPORTED[k] === lang) o.selected = true;
                sel.appendChild(o);
            }
            sel.setAttribute('data-i18n-skip', '');
            sel.addEventListener('change', function (e) { api.setLang(e.target.value); });
        }
    }
    function onReady(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }
    onReady(wirePickers);

    if (lang === 'bg') { api.ready = Promise.resolve(); return; }

    // Скрий текста, докато речникът се зареди (до 1.5 s), за да няма мигане на български.
    root.classList.add('i18n-pending');
    var style = document.createElement('style');
    style.textContent = 'html.i18n-pending body{visibility:hidden}';
    (document.head || root).appendChild(style);
    var failSafe = setTimeout(reveal, 1500);

    var base = (function () {
        var s = document.currentScript && document.currentScript.src;
        return s ? s.replace(/[^/]*$/, '') : './';
    })();

    api.ready = fetch(base + 'i18n/' + lang + '.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
            dict = {
                strings: data.strings || {},
                keys: data.keys || {},
                patterns: (data.patterns || []).map(function (p) { return [new RegExp(p[0]), p[1]]; })
            };
            return new Promise(function (res) {
                onReady(function () {
                    if (dict.strings[document.title]) document.title = dict.strings[document.title];
                    walk(document.documentElement);
                    observe();
                    clearTimeout(failSafe);
                    reveal();
                    res();
                });
            });
        })
        .catch(function (e) {
            if (window.console) console.warn('[i18n] речникът не се зареди:', e);
            clearTimeout(failSafe);
            reveal();
        });
})();
