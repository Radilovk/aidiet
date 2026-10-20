/**
 * Продукти от BIOCODE (biocode-bg.com) към добавките в плана.
 *
 * Под всяка препоръчана добавка — до 2 налични продукта със снимка, марка,
 * цена и линк към продукта. Изборът е на сървъра (/api/supplement-products):
 * съвпадение по вещество и форма, без противопоказаните от лекарствата и само
 * налични към последната синхронизация (на 6 часа). Без съвпадение — без
 * продукт. Отговорът се пази в sessionStorage за 1 час.
 */
(function (global) {
    'use strict';
    if (global.NutriPlanSupplementShop) return;

    var API = 'https://aidiet.radilov-k.workers.dev/api/supplement-products';
    var CACHE_KEY = 'np_supplement_products';
    var CACHE_MS = 60 * 60 * 1000;

    function injectStyles() {
        if (document.getElementById('np-shop-styles')) return;
        var css = '' +
            '.np-shop{margin-top:14px;display:grid;gap:12px;}' +
            '.np-shop-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}' +
            '.np-shop-title{font-size:.8125rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ds-text-soft,#52514e);}' +
            '.np-shop-brand{font-size:.8125rem;font-weight:700;color:var(--ds-accent-text,#0F766E);text-decoration:none;}' +
            '.np-shop-group-name{font-weight:700;font-size:.9375rem;margin:0 0 6px;color:var(--text-dark,var(--ds-text-primary));}' +
            '.np-shop-row{display:grid;gap:8px;}' +
            '@media(min-width:560px){.np-shop-row{grid-template-columns:1fr 1fr;}}' +
            '.np-shop-card{display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:center;padding:10px;border-radius:14px;background:var(--ds-bg-card,rgba(255,255,255,.72));border:1px solid var(--ds-border-primary,rgba(13,148,136,.12));text-decoration:none;color:inherit;min-height:84px;}' +
            '.np-shop-card:active{transform:scale(var(--ds-press-scale,.98));}' +
            '.np-shop-img{width:64px;height:64px;border-radius:10px;background:#fff;object-fit:contain;}' +
            '.np-shop-name,.np-shop-meta,.np-shop-cta{display:block;}' +
            '.np-shop-name{font-weight:600;font-size:.9rem;line-height:1.3;color:var(--text-dark,var(--ds-text-primary));display:-webkit-box !important;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}' +
            '.np-shop-meta{font-size:.8125rem;color:var(--ds-text-soft,#52514e);margin-top:2px;}' +
            '.np-shop-price{font-weight:800;color:var(--text-dark,var(--ds-text-primary));font-variant-numeric:tabular-nums;}' +
            '.np-shop-promo{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:.75rem;font-weight:700;background:var(--ds-warning-bg,#fff7e6);color:var(--ds-warning-text,#8a5300);}' +
            '.np-shop-cta{font-size:.8125rem;font-weight:700;color:var(--ds-accent-text,#0F766E);margin-top:4px;}' +
            '.np-shop-note{font-size:.8125rem;color:var(--ds-text-soft,#52514e);margin:0;}';
        var style = document.createElement('style');
        style.id = 'np-shop-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }

    function price(v) {
        return v ? (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' €' : '';
    }

    function readCache(key) {
        try {
            var c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
            return c && c.key === key && Date.now() - c.at < CACHE_MS ? c.data : null;
        } catch (_) { return null; }
    }

    function writeCache(key, data) {
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ key: key, at: Date.now(), data: data })); } catch (_) {}
    }

    /** Името на добавката: обект { name } или текст „Магнезий 300 mg — вечер“. */
    function nameOf(s) {
        if (s && typeof s === 'object') return String(s.name || '');
        return String(s || '').split(/[—–:(]| - /)[0].trim();
    }

    function card(p) {
        return '<a class="np-shop-card" href="' + esc(p.url) + '" target="_blank" rel="noopener sponsored">' +
            (p.image ? '<img class="np-shop-img" src="' + esc(p.image) + '" alt="" loading="lazy" decoding="async">' : '<span class="np-shop-img"></span>') +
            '<span><span class="np-shop-name">' + esc(p.name) + '</span>' +
            '<span class="np-shop-meta">' + esc(p.brand) + (p.packs && p.packs[0] ? ' · ' + esc(p.packs[0]) : '') + '</span>' +
            '<span class="np-shop-meta"><span class="np-shop-price">' + (p.price ? 'от ' + price(p.price) : '') + '</span>' + (p.promo ? '<span class="np-shop-promo">Промо</span>' : '') + '</span>' +
            '<span class="np-shop-cta">Виж в BIOCODE →</span></span></a>';
    }

    /**
     * @param {HTMLElement} container — където да се добавят картите (след списъка с добавки)
     * @param {Array} supplements — добавките от плана
     * @param {{ userData?: object, from?: string }} [opts]
     */
    async function render(container, supplements, opts) {
        if (!container || !Array.isArray(supplements) || !supplements.length) return;
        var o = opts || {};
        var u = o.userData || {};
        var names = supplements.map(nameOf).filter(Boolean).slice(0, 8);
        if (!names.length) return;
        var diet = [].concat(u.dietPreference || []).join(' ');
        var body = {
            supplements: names.map(function (n) { return { name: n }; }),
            medications: u.medications || '',
            medicationsDetails: u.medicationsDetails || '',
            vegan: /веган/i.test(diet),
            from: o.from || 'nutriplan'
        };
        var key = JSON.stringify(body);
        var data = readCache(key);
        if (!data) {
            try {
                var res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key });
                data = await res.json();
                if (!res.ok || !data.success) return;
                writeCache(key, data);
            } catch (_) { return; }
        }
        var groups = (data.items || []).filter(function (g) { return g.products && g.products.length; });
        if (!groups.length) return;
        injectStyles();
        var old = container.querySelector('.np-shop');
        if (old) old.remove();
        var box = document.createElement('div');
        box.className = 'np-shop';
        box.innerHTML = '<div class="np-shop-head"><span class="np-shop-title">Налични продукти</span>' +
            '<a class="np-shop-brand" href="https://biocode-bg.com/?utm_source=' + esc(body.from) + '&utm_medium=supplements" target="_blank" rel="noopener sponsored">BIOCODE · biocode-bg.com</a></div>' +
            groups.map(function (g) {
                return '<div><p class="np-shop-group-name">' + esc(g.supplement) + '</p><div class="np-shop-row">' + g.products.map(card).join('') + '</div></div>';
            }).join('') +
            '<p class="np-shop-note">Подбрани от каталога на BIOCODE по съставка и форма; наличността се обновява на 6 часа. Продукт, неподходящ при вашите лекарства, не се показва.</p>';
        container.appendChild(box);
        // Отворен акордеон е измерил височината си преди картите — премерва се.
        var acc = container.closest && container.closest('.acc-content');
        if (acc && acc.style.maxHeight && acc.style.maxHeight !== '0px' && acc.style.maxHeight !== '0') {
            acc.style.maxHeight = acc.scrollHeight + 'px';
        }
    }

    global.NutriPlanSupplementShop = { render: render, nameOf: nameOf };
}(window));
