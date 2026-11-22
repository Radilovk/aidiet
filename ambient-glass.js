/*
 * Визуалният език „Светлина · Стъкло · Спокойствие“ (ambient-glass.css) — по подразбиране навсякъде.
 * Старият вид остава достъпен за сравнение: ?ui=classic (помни се), обратно — ?ui=glass.
 * ?ui=glass-lite — без замъгляване (както на слабите телефони).
 *
 *  - html[data-ui="glass"] + стиловете (през document.write, за да няма мигане на стария вид);
 *  - html[data-daypart] — светлината на фона следва часа (сутрин / ден / вечер / нощ);
 *  - --ag-lift (0…1) — колко от деня е изпълнен; светлината леко се усилва (тиха обратна връзка);
 *  - html[data-ui-lite] — слаби устройства: без замъгляване;
 *  - в обвивката (index.html) подава долния безопасен отстъп на вградените раздели.
 */
(function () {
    'use strict';
    var KEY = 'uiPreview';
    var d = document.documentElement;
    var q = null;
    try { q = new URLSearchParams(location.search).get('ui'); } catch (e) {}
    try {
        if (q === 'classic' || q === 'glass-lite') localStorage.setItem(KEY, q);
        else if (q === 'glass') localStorage.removeItem(KEY);
    } catch (e) {}
    var mode = null;
    try { mode = localStorage.getItem(KEY); } catch (e) {}
    if (mode === 'classic') return;

    d.setAttribute('data-ui', 'glass');
    document.write('<link rel="stylesheet" href="./ambient-glass.css?v=3" id="ambientGlassCss">');

    var mem = navigator.deviceMemory || 8;
    var cores = navigator.hardwareConcurrency || 8;
    if (mode === 'glass-lite' || mem <= 3 || cores <= 4) d.setAttribute('data-ui-lite', '1');

    function daypart() {
        var h = new Date().getHours();
        var p = h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'day' : h >= 17 && h < 22 ? 'evening' : 'night';
        if (d.getAttribute('data-daypart') !== p) d.setAttribute('data-daypart', p);
    }
    daypart();
    setInterval(daypart, 5 * 60 * 1000);

    function setLift(v) {
        v = Math.max(0, Math.min(1, v || 0));
        d.style.setProperty('--ag-lift', v.toFixed(2));
        try {
            if (window.parent && window.parent !== window) window.parent.document.documentElement.style.setProperty('--ag-lift', v.toFixed(2));
        } catch (e) {}
    }

    function themeColor() {
        var dark = d.getAttribute('data-theme') === 'dark';
        var c = dark ? '#050F0E' : '#EEF4F2';
        document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', c); });
    }

    function init() {
        if (!document.querySelector('.ag-aura') && d.getAttribute('data-shell-chat') !== '1') {
            var a = document.createElement('div');
            a.className = 'ag-aura';
            a.setAttribute('aria-hidden', 'true');
            a.innerHTML = '<i class="ag-a"></i><i class="ag-b"></i><i class="ag-c"></i>';
            document.body.insertBefore(a, document.body.firstChild);
        }
        themeColor();
        new MutationObserver(themeColor).observe(d, { attributes: true, attributeFilter: ['data-theme'] });

        /* Напредъкът на деня: лентата в картата на деня (plan.html) */
        var card = document.getElementById('dailyScoreCard');
        if (card) {
            var read = function () {
                var segs = card.querySelectorAll('.dc-seg');
                if (!segs.length) return;
                var done = card.querySelectorAll('.dc-seg--done').length + card.querySelectorAll('.dc-seg--partial').length * 0.5;
                setLift(done / segs.length);
            };
            read();
            new MutationObserver(read).observe(card, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
        }

        /* Обвивката: разделите стигат до долу (под плаващата навигация) — подаваме им безопасния отстъп */
        var frames = document.querySelectorAll('.spa-tab-view');
        if (frames.length) {
            var probe = document.createElement('div');
            probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);width:0;visibility:hidden;pointer-events:none';
            document.body.appendChild(probe);
            var pass = function (f) {
                try {
                    var sb = probe.getBoundingClientRect().height || 0;
                    var fd = f.contentDocument && f.contentDocument.documentElement;
                    if (fd) fd.style.setProperty('--ag-safe-b', sb + 'px');
                } catch (e) {}
            };
            frames.forEach(function (f) { f.addEventListener('load', function () { pass(f); }); pass(f); });
            window.addEventListener('resize', function () { frames.forEach(pass); });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
