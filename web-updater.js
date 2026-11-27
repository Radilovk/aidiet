/**
 * iPhone: обновяване на страниците отвътре (app-bundle.js на сървъра, @capgo/capacitor-updater в приложението).
 *
 * Зарежда го i18n.js само в приложението за iPhone (и само в горния прозорец). Най-много веднъж на час пита
 * /api/app/web-bundle за последния пакет, съвместим с версията на приложението; ако е по-нов от текущия
 * (web-bundle.json в пакета), го тегли във фона (проверка по sha256) и го слага за следващото отваряне —
 * без да прекъсва човека. Ако новият пакет не тръгне, плъгинът се връща на предишния сам (notifyAppReady в i18n.js).
 */
(function (global) {
    'use strict';
    if (global.__nutriinWebUpdater) return;
    global.__nutriinWebUpdater = true;
    var API = 'https://aidiet.radilov-k.workers.dev/api/app/web-bundle';
    var KEY = 'np_web_update_checked_at';
    var EVERY_MS = 60 * 60 * 1000;

    function cap() { return global.Capacitor || null; }
    function plugin(name) {
        var c = cap();
        return (c && c.Plugins && c.Plugins[name]) || null;
    }
    function get(k) { try { return global.localStorage.getItem(k); } catch (_) { return null; } }
    function set(k, v) { try { global.localStorage.setItem(k, v); } catch (_) {} }

    async function currentVersion() {
        try {
            var r = await fetch('./web-bundle.json', { cache: 'no-store' });
            var j = await r.json();
            return String(j.version || '0');
        } catch (_) { return '0'; }
    }

    async function check() {
        var U = plugin('CapacitorUpdater');
        var App = plugin('App');
        if (!U || !App || typeof U.download !== 'function') return;
        var last = Number(get(KEY) || 0);
        if (Date.now() - last < EVERY_MS) return;
        set(KEY, String(Date.now()));

        var info = await App.getInfo();
        var res = await fetch(API + '?platform=ios&app=' + encodeURIComponent(info.version || '0'));
        if (!res.ok) return;
        var b = await res.json();
        if (!b || !b.version || !b.url || !b.sha256) return;
        if (Number(b.version) <= Number(await currentVersion())) return;

        var list = (await U.list()).bundles || [];
        var have = list.filter(function (x) { return x.version === String(b.version) && x.status !== 'error'; })[0];
        var bundle = have || await U.download({ url: b.url, version: String(b.version), checksum: b.sha256 });
        await U.next({ id: bundle.id });
    }

    function start() {
        try { if (global.top !== global) return; } catch (_) { return; }
        // След като страницата се е заредила — не пречи на първото рисуване.
        setTimeout(function () { check().catch(function () { /* следващия път */ }); }, 4000);
    }
    if (global.document.readyState === 'complete') start(); else global.addEventListener('load', start, { once: true });
})(window);
