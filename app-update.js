/**
 * APK: известие за нова версия на приложението.
 *
 * Уеб страниците се обновяват сами, а APK-то носи кода, с който е събрано —
 * без обновяване интерфейсът и логиката изостават от уеб версията (иконите на
 * дневната оценка, профилът и пр.). Обвивката сравнява своя build (App.getInfo)
 * с най-новото издание в GitHub (тагът v-build<N>-…, както бутона „Свали APK“
 * в index.html) и предлага изтегляне.
 *
 * Изданията се питат най-много веднъж на 6 часа; „По-късно“ отлага с 2 дни.
 */
(function (global) {
    'use strict';
    var doc = global.document;
    var RELEASES_URL = 'https://api.github.com/repos/Radilovk/aidiet/releases?per_page=30';
    var CACHE_KEY = 'np_apk_latest';
    var STATE_KEY = 'np_apk_update';
    var CACHE_MS = 6 * 3600000;
    var SNOOZE_MS = 2 * 86400000;
    var DELAY_MS = 8000;

    function readJSON(key) {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
    }
    function writeJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    }

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    async function installedBuild() {
        var P = global.NutriPlanPlatform;
        var app = P && P.getPlugin ? P.getPlugin('App') : null;
        if (!app || typeof app.getInfo !== 'function') return 0;
        try {
            var info = await app.getInfo();
            return Number(info && info.build) || 0;
        } catch (_) {
            return 0;
        }
    }

    /** Най-новото издание по номер на build (не „latest“ на GitHub — виж index.html). */
    async function latestRelease() {
        var c = readJSON(CACHE_KEY);
        if (c && c.at && Date.now() - c.at < CACHE_MS) return c.best || null;
        var res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
        if (!res.ok) return c && c.best || null;
        var list = await res.json();
        var best = null;
        (list || []).forEach(function (rel) {
            var m = /^v-build(\d+)-/.exec(rel.tag_name || '');
            if (!m || rel.draft || rel.prerelease) return;
            var asset = (rel.assets || []).filter(function (a) { return /^NutriPlan-v[\d.]+\.apk$/.test(a.name); })[0];
            if (asset && (!best || Number(m[1]) > best.build)) {
                best = { build: Number(m[1]), url: asset.browser_download_url, version: asset.name.replace(/^NutriPlan-v|\.apk$/g, '') };
            }
        });
        writeJSON(CACHE_KEY, { at: Date.now(), best: best });
        return best;
    }

    /** Отворен ли е друг прозорец — тогава не се натрапваме (както health-offer.js). */
    function busy() {
        if (global.NutriPlanHealthOffer && global.NutriPlanHealthOffer.isOpen()) return true;
        var list = doc.querySelectorAll('.modal-overlay.active, .onboarding-overlay.active, [role="dialog"][aria-modal="true"]:not([hidden]), [role="alertdialog"]:not([hidden])');
        return Array.prototype.some.call(list, function (el) {
            if (el.closest('.aup-overlay')) return false;
            var cs = global.getComputedStyle(el);
            var r = el.getBoundingClientRect();
            return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.1 && r.width > 0 && r.height > 0;
        });
    }

    var CSS = '' +
        '.aup-overlay{position:fixed;inset:0;z-index:var(--ds-z-modal,1000);background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .2s ease}' +
        '.aup-overlay.is-open{opacity:1}' +
        '.aup-card{width:100%;max-width:520px;background:var(--bg-color,var(--ds-bg-primary,#fff));color:var(--ds-text-primary,#042F2E);border-radius:24px 24px 0 0;padding:12px 20px calc(20px + env(safe-area-inset-bottom,0px));box-shadow:var(--ds-shadow-xl);transform:translateY(24px);transition:transform .28s var(--ds-ease-standard,ease)}' +
        '.aup-overlay.is-open .aup-card{transform:none}' +
        '.aup-handle{width:40px;height:4px;border-radius:2px;background:var(--ds-border-primary,rgba(0,0,0,.15));margin:0 auto 16px}' +
        '.aup-icon{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:var(--ds-fill-grad);color:var(--ds-on-fill,#fff);font-size:1.4rem;margin-bottom:12px}' +
        '.aup-title{font-size:1.25rem;font-weight:800;margin:0 0 6px;line-height:1.3}' +
        '.aup-text{margin:0 0 16px;color:var(--ds-text-secondary);line-height:1.5;font-size:.975rem}' +
        '.aup-actions{display:grid;gap:8px}' +
        '.aup-btn{min-height:52px;border-radius:14px;border:none;font-size:1rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none}' +
        '.aup-btn:active{transform:scale(var(--ds-press-scale,.98))}' +
        '.aup-primary{background:var(--ds-fill-grad);color:var(--ds-on-fill,#fff)}' +
        '.aup-ghost{background:none;color:var(--ds-text-secondary)}';

    var overlay = null;

    function close() {
        if (!overlay) return;
        var el = overlay;
        overlay = null;
        el.classList.remove('is-open');
        setTimeout(function () { el.remove(); }, 220);
    }

    function show(rel, current) {
        if (!doc.getElementById('aupStyle')) {
            var style = doc.createElement('style');
            style.id = 'aupStyle';
            style.textContent = CSS;
            doc.head.appendChild(style);
        }
        overlay = doc.createElement('div');
        overlay.className = 'aup-overlay';
        overlay.innerHTML = '<div class="aup-card" role="dialog" aria-modal="true" aria-labelledby="aupTitle">' +
            '<div class="aup-handle" aria-hidden="true"></div>' +
            '<div class="aup-icon" aria-hidden="true"><i class="fas fa-arrow-up-from-bracket"></i></div>' +
            '<h2 class="aup-title" id="aupTitle">Има нова версия на приложението</h2>' +
            '<p class="aup-text">Версия ' + esc(rel.version) + ' е готова (сега: build ' + esc(current) + '). ' +
            'Обновете, за да виждате същото като в уеб версията — новите екрани, поправки и данни. Планът и профилът остават.</p>' +
            '<div class="aup-actions">' +
            '<a class="aup-btn aup-primary" href="' + esc(rel.url) + '" data-act="get"><i class="fab fa-android"></i>Изтегли и инсталирай</a>' +
            '<button type="button" class="aup-btn aup-ghost" data-act="later">По-късно</button>' +
            '</div></div>';
        overlay.addEventListener('click', function (e) { if (e.target === overlay) later(); });
        overlay.querySelector('[data-act="get"]').addEventListener('click', function () {
            // Докато се инсталира — без повторно известие при връщане към приложението (1 час).
            writeJSON(STATE_KEY, { build: rel.build, snoozedAt: Date.now() - SNOOZE_MS + 3600000 });
            setTimeout(close, 300);
        });
        overlay.querySelector('[data-act="later"]').addEventListener('click', later);
        doc.body.appendChild(overlay);
        requestAnimationFrame(function () { if (overlay) overlay.classList.add('is-open'); });

        function later() {
            writeJSON(STATE_KEY, { build: rel.build, snoozedAt: Date.now() });
            close();
        }
    }

    async function check() {
        var P = global.NutriPlanPlatform;
        if (!P || !P.isAPK() || overlay) return;
        var current = await installedBuild();
        if (!current) return;
        var rel = await latestRelease();
        if (!rel || rel.build <= current) return;
        var st = readJSON(STATE_KEY);
        if (st && st.build === rel.build && Date.now() - st.snoozedAt < SNOOZE_MS) return;
        if (busy()) return;
        show(rel, current);
    }

    global.NutriPlanAppUpdate = { check: check, close: close };

    // Само обвивката на приложението (горният прозорец), след като се е успокоила.
    try {
        if (global.top === global) {
            var start = function () { setTimeout(function () { check().catch(function () {}); }, DELAY_MS); };
            if (doc.readyState === 'complete') start();
            else global.addEventListener('load', start, { once: true });
            // Приложението стои отворено дни наред — проверка и при връщане към него.
            doc.addEventListener('visibilitychange', function () {
                if (doc.visibilityState === 'visible') check().catch(function () {});
            });
        }
    } catch (_) {}
}(window));
