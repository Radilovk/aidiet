/**
 * Въпроси за разминаване между източниците (AIRIS, EmoEat, NutriPlan).
 *
 * Сървърът сверява данните и връща отворените въпроси (derived.questions).
 * Тук те се задават един по един в прозорец; отговорът се записва като факт
 * и решава спора. „Не сега“ отлага за 24 часа. Без въпроси прозорецът не се
 * показва изобщо.
 */
(function (global) {
    'use strict';
    if (global.NutriPlanQuestions) return;

    var SNOOZE_KEY = 'np_questions_snooze_until';
    var SOURCE_LABEL = { airis: 'AIRIS · ирисов анализ', emoeat: 'EmoEat · емоционално хранене' };
    var root = null;
    var queue = [];
    var lastFocus = null;

    function injectStyles() {
        if (document.getElementById('npq-styles')) return;
        var css = '' +
            '.npq-backdrop{position:fixed;inset:0;z-index:10050;background:var(--ds-bg-overlay,rgba(0,0,0,.4));display:flex;align-items:flex-end;justify-content:center;padding:16px;padding-bottom:calc(16px + env(safe-area-inset-bottom));}' +
            '@media(min-width:600px){.npq-backdrop{align-items:center;}}' +
            '.npq-card{width:100%;max-width:440px;background:var(--ds-bg-tertiary,#fff);color:var(--ds-text-primary,#0F2F2E);border-radius:20px;padding:20px;box-shadow:var(--ds-shadow-lg);font-family:var(--ds-font-family,inherit);}' +
            '[data-theme="dark"] .npq-card{background:#112B2B;color:#E0F5F0;}' +
            '.npq-badge{display:inline-flex;align-items:center;gap:6px;font-size:.8125rem;font-weight:700;color:var(--ds-accent-text,#0F766E);background:rgba(15,118,110,.08);border-radius:999px;padding:5px 10px;margin-bottom:10px;}' +
            '.npq-title{font-size:1.125rem;font-weight:800;margin:0 0 6px;}' +
            '.npq-text{font-size:1rem;line-height:1.5;margin:0 0 16px;}' +
            '.npq-options{display:grid;gap:8px;}' +
            '.npq-opt{min-height:48px;border-radius:14px;border:1px solid var(--ds-border-accent,rgba(13,148,136,.2));background:transparent;color:inherit;font-size:1rem;font-weight:600;cursor:pointer;padding:10px 14px;text-align:left;}' +
            // Отговорите са равностойни — нито един не е подчертан, за да не подсказва.
            '.npq-opt:hover,.npq-opt:focus-visible{border-color:var(--ds-fill,#0F766E);background:rgba(15,118,110,.06);}' +
            '.npq-opt:disabled{opacity:.6;cursor:default;}' +
            '.npq-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px;}' +
            '.npq-later{min-height:44px;background:none;border:0;color:var(--ds-text-soft,#52514e);font-weight:600;cursor:pointer;padding:0 4px;}' +
            '[data-theme="dark"] .npq-later{color:#c3c2b7;}' +
            '.npq-count{font-size:.8125rem;color:var(--ds-text-soft,#52514e);}' +
            '[data-theme="dark"] .npq-count{color:#c3c2b7;}' +
            '.npq-note{font-size:.875rem;color:var(--ds-text-soft,#52514e);margin:12px 0 0;}' +
            '[data-theme="dark"] .npq-note{color:#c3c2b7;}';
        var style = document.createElement('style');
        style.id = 'npq-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function snoozed() {
        try { return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0); } catch (_) { return false; }
    }

    function snooze() {
        try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 24 * 3600 * 1000)); } catch (_) {}
    }

    function close() {
        if (root) root.remove();
        root = null;
        document.removeEventListener('keydown', onKey);
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    function onKey(e) {
        if (e.key === 'Escape') { snooze(); close(); }
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    function render(message) {
        var q = queue[0];
        if (!root) {
            injectStyles();
            lastFocus = document.activeElement;
            root = el('div', 'npq-backdrop');
            root.addEventListener('click', function (e) { if (e.target === root) { snooze(); close(); } });
            document.body.appendChild(root);
            document.addEventListener('keydown', onKey);
        }
        root.innerHTML = '';
        var card = el('div', 'npq-card');
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-labelledby', 'npqTitle');
        if (!q) {
            card.appendChild(el('h2', 'npq-title', 'Благодарим'));
            card.lastChild.id = 'npqTitle';
            card.appendChild(el('p', 'npq-text', message || 'Отговорите са записани.'));
            var ok = el('button', 'npq-opt', 'Добре');
            ok.type = 'button';
            ok.addEventListener('click', close);
            card.appendChild(ok);
            root.appendChild(card);
            ok.focus();
            return;
        }
        card.appendChild(el('div', 'npq-badge', SOURCE_LABEL[q.source] || 'Уточнение'));
        var title = el('h2', 'npq-title', 'Да уточним: ' + String(q.topic || '').toLowerCase());
        title.id = 'npqTitle';
        card.appendChild(title);
        card.appendChild(el('p', 'npq-text', q.text));
        var opts = el('div', 'npq-options');
        q.options.forEach(function (o) {
            var b = el('button', 'npq-opt', o.label);
            b.type = 'button';
            b.addEventListener('click', function () { answer(q, o.value, opts); });
            opts.appendChild(b);
        });
        card.appendChild(opts);
        var foot = el('div', 'npq-foot');
        var later = el('button', 'npq-later', 'Не сега');
        later.type = 'button';
        later.addEventListener('click', function () { snooze(); close(); });
        foot.appendChild(later);
        if (queue.length > 1) foot.appendChild(el('span', 'npq-count', '1 от ' + queue.length));
        card.appendChild(foot);
        card.appendChild(el('p', 'npq-note', 'Двата източника си противоречат — отговорът ти решава кое влиза в плана.'));
        root.appendChild(card);
        opts.firstChild.focus();
    }

    async function answer(q, value, opts) {
        var E = global.NutriPlanEnrichment;
        Array.prototype.forEach.call(opts.children, function (b) { b.disabled = true; });
        try {
            var res = await E.resolve(q.id, value);
            queue = ((res.derived && res.derived.questions) || []).filter(function (x) { return x.id !== q.id; });
            if (global.NutriPlanHaptic && global.NutriPlanHaptic.notify) global.NutriPlanHaptic.notify('success');
            render(E.describeChange(res));
        } catch (e) {
            // Въпросът вече не е актуален (друго устройство е отговорило) — следващият.
            queue.shift();
            render();
        }
    }

    async function check(options) {
        var E = global.NutriPlanEnrichment;
        if (!E || !E.hasPlanProfile() || root) return;
        if (!(options && options.force) && snoozed()) return;
        try {
            var res = await E.get();
            queue = (res.derived && res.derived.questions) || [];
            if (queue.length) render();
        } catch (_) { /* без връзка — следващия път */ }
    }

    global.NutriPlanQuestions = { check: check };

    // Само на екрана с плана (не в обвивката — иначе би се показал два пъти),
    // няколко секунди след отварянето.
    if (/plan\.html/.test(location.pathname)) {
        setTimeout(function () { check(); }, 5000);
    }
}(window));
