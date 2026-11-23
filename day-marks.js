/**
 * Дните — общият знак за деня (Напредък и картата на деня в плана): кръгче с процент, ябълка или кръгче
 * с личице (np_day_view; задържане → избор), цвят сиво → червено → оранжево → жълто → зеленото на марката,
 * и прозорецът „какво свали деня“. Процентът — NutriPlanDayAdherence (day-adherence.js) с личните тежести.
 *
 *   NutriPlanDayMarks.dayOf(rec, key, todayKey)  → { key, label, today, adh, soft }
 *   NutriPlanDayMarks.mark(x, view, size)        → SVG
 *   NutriPlanDayMarks.pop(btn, x)                → прозорецът над/под бутона
 */
(function (global) {
    'use strict';
    var doc = global.document;
    var DAY_VIEWS = [{ id: 'pct', name: 'Кръгчета с процент' }, { id: 'apple', name: 'Ябълки' }, { id: 'face', name: 'Кръгчета с личица' }];
    // По подразбиране — процентът (най-ясно); старият избор „кръгчета“ (с датата) → с процент.
    function view() { try { var v = localStorage.getItem('np_day_view'); return v === 'apple' || v === 'face' ? v : 'pct'; } catch (_) { return 'pct'; } }
    // Личицето по процента: под 35 — тъжно, 35–59 — неутрално, 60–84 — усмивка, от 85 — широка усмивка.
    // Мекият режим — без тъжно лице. Днес, докато денят тече — неутрално и бледо.
    function face(x, h, col, R) {
        var v = x.adh ? x.adh.pct : null, open = x.today && x.adh && !x.adh.closed;
        if (v == null || v <= 0) return '';
        var mood = open ? 1 : v >= 85 ? 3 : v >= 60 ? 2 : v >= 35 ? 1 : (x.soft ? 1 : 0);
        // Пропорциите на емотикон спрямо вътрешния радиус R: очите — 0,36 R встрани и 0,3 R нагоре
        // (леко овални), устата — широка 1,1 R и под центъра.
        var f = function (n) { return (Math.round(n * 100) / 100); };
        var ex = R * 0.36, ey = h - R * 0.3, erx = R * 0.1, ery = R * 0.13, sw = Math.max(1.4, R * 0.11);
        var eyes = '<ellipse cx="' + f(h - ex) + '" cy="' + f(ey) + '" rx="' + f(erx) + '" ry="' + f(ery) + '" fill="' + col + '"/>' +
            '<ellipse cx="' + f(h + ex) + '" cy="' + f(ey) + '" rx="' + f(erx) + '" ry="' + f(ery) + '" fill="' + col + '"/>';
        var mx = R * 0.55, my = h + R * 0.22;
        var mouth = mood === 3
            ? '<path d="M' + f(h - mx) + ' ' + f(my) + 'Q' + h + ' ' + f(my + R * 0.75) + ' ' + f(h + mx) + ' ' + f(my) + 'Z" fill="' + col + '"/>'
            : mood === 2 ? '<path d="M' + f(h - mx) + ' ' + f(my + R * 0.04) + 'Q' + h + ' ' + f(my + R * 0.5) + ' ' + f(h + mx) + ' ' + f(my + R * 0.04) + '" fill="none" stroke="' + col + '" stroke-width="' + f(sw) + '" stroke-linecap="round"/>'
            : mood === 1 ? '<path d="M' + f(h - mx * 0.8) + ' ' + f(my + R * 0.2) + 'L' + f(h + mx * 0.8) + ' ' + f(my + R * 0.2) + '" fill="none" stroke="' + col + '" stroke-width="' + f(sw) + '" stroke-linecap="round"/>'
            : '<path d="M' + f(h - mx) + ' ' + f(my + R * 0.42) + 'Q' + h + ' ' + f(my - R * 0.05) + ' ' + f(h + mx) + ' ' + f(my + R * 0.42) + '" fill="none" stroke="' + col + '" stroke-width="' + f(sw) + '" stroke-linecap="round"/>';
        return '<g' + (open ? ' opacity=".5"' : '') + '>' + eyes + mouth + '</g>';
    }
    // Скалата: сиво (няма) → червено → оранжево → жълто → зеленото на марката (оптимално).
    function color(x) {
        if (!x.adh || x.adh.pct <= 0) return 'var(--ga-d-none)';
        if (x.today && !x.adh.closed) return 'var(--ga-d-open)';
        var v = x.adh.pct;
        if (x.soft) return v >= 85 ? 'var(--ga-d-best)' : 'var(--ga-d-good)';   // мекият режим — без червено
        return v >= 85 ? 'var(--ga-d-best)' : v >= 60 ? 'var(--ga-d-good)' : v >= 35 ? 'var(--ga-d-mid)' : 'var(--ga-d-low)';
    }
    // Ябълката: тяло от два заоблени дяла с вдлъбнатина горе и долу, дръжка и листо.
    var APPLE_BODY = 'M12 7.6C13.7 6.1 17.6 5.6 19.4 8.6C21.1 11.6 20.1 16.5 17.7 19.4C16.5 20.9 15.1 21.7 13.9 21.1C12.6 20.5 11.4 20.5 10.1 21.1C8.9 21.7 7.5 20.9 6.3 19.4C3.9 16.5 2.9 11.6 4.6 8.6C6.4 5.6 10.3 6.1 12 7.6Z';
    var APPLE_STEM = 'M12 7.6C11.9 5.9 12.4 4.4 13.3 3.3';
    var APPLE_LEAF = 'M12.9 5.4C13.5 3.4 15.6 2.4 17.7 2.8C17.1 4.8 15 5.9 12.9 5.4Z';
    var uid = 0;
    function mark(x, view, size) {
        var c = color(x), f = x.adh ? Math.max(0, Math.min(1, x.adh.pct / 100)) : 0, id = 'gad' + (uid++);
        var best = x.adh && x.adh.pct >= 85 && !(x.today && !x.adh.closed);
        if (view === 'pct' || view === 'face') {
            // вътре — процентът (или личице); без отметки — празно кръгче
            var st = 3.5, r = (size - st) / 2, C = 2 * Math.PI * r, h = size / 2;
            var inner = view === 'face' ? face(x, h, 'var(--dm-ink, var(--text-dark))', r - st / 2 - 0.6)
                : (x.adh && x.adh.pct > 0 ? '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" class="ga-day-n' + (x.today && !x.adh.closed ? ' is-open' : '') + '">' + x.adh.pct + '<tspan class="u">%</tspan></text>' : '');
            return '<svg width="' + size + '" height="' + size + '" aria-hidden="true">' + inner + '<circle cx="' + h + '" cy="' + h + '" r="' + r + '" fill="none" stroke="var(--ga-d-track)" stroke-width="' + st + '"' + (x.today ? ' stroke-dasharray="2 3"' : '') + '/>' +
                (f > 0 ? '<circle cx="' + h + '" cy="' + h + '" r="' + r + '" fill="none" stroke="' + c + '" stroke-width="' + st + '" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - f)).toFixed(1) + '" transform="rotate(-90 ' + h + ' ' + h + ')"/>' : '') + '</svg>';
        }
        // ябълка: пълни се отдолу (тялото е между y 6,1 и 21,7)
        var y = 21.7 - 15.6 * f;
        return '<svg width="' + size + '" height="' + size + '" viewBox="2.6 2.2 18.8 20" aria-hidden="true"><defs><clipPath id="' + id + '"><path d="' + APPLE_BODY + '"/></clipPath></defs>' +
            (f > 0 ? '<rect x="0" y="' + y.toFixed(2) + '" width="24" height="24" fill="' + c + '" clip-path="url(#' + id + ')"/>' : '') +
            '<path d="' + APPLE_BODY + '" fill="none" stroke="' + (x.today ? 'var(--ds-green-text, #03939C)' : 'var(--ga-d-line)') + '" stroke-width="1.15" stroke-linejoin="round"/>' +
            '<path d="' + APPLE_STEM + '" fill="none" stroke="var(--ga-d-line)" stroke-width="1.15" stroke-linecap="round"/>' +
            '<path d="' + APPLE_LEAF + '" fill="' + (best ? 'var(--ga-d-best)' : 'var(--ga-d-line)') + '"/></svg>';
    }

    // Личните тежести и правилото за движение — веднъж на отваряне (goal-focus.js).
    var ctx = null;
    function context() {
        if (ctx) return ctx;
        ctx = { weights: null, policy: null, group: 'base', soft: false };
        try {
            var ud = JSON.parse(global.localStorage.getItem('userData') || '{}') || {};
            var GF = global.NutriPlanGoalFocus;
            var gd = JSON.parse(global.localStorage.getItem('gameData') || '{}') || {};
            if (GF) { ctx.group = GF.profileOf(ud).group; ctx.policy = GF.activityPolicy(ud); if (GF.adherenceWeights) var t = new Date(), z = function (/** @type {number} */ n) { return n < 10 ? '0' + n : '' + n; }; ctx.weights = GF.adherenceWeights(ud, gd, t.getFullYear() + '-' + z(t.getMonth() + 1) + '-' + z(t.getDate())).weights; }
        } catch (_) {}
        try { ctx.soft = !!(global.NutriPlanPersona && global.NutriPlanPersona.current().noScores); } catch (_) {}
        return ctx;
    }
    var DAY_SHORT = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    function dayOf(rec, key, todayKey) {
        var c = context(), DA = global.NutriPlanDayAdherence;
        var dt = new Date(key + 'T12:00:00');
        return { key: key, label: DAY_SHORT[dt.getDay()], today: key === todayKey,
            adh: rec && DA ? DA.compute(rec, { todayKey: todayKey, key: key, group: c.group, policy: c.policy, weights: c.weights }) : null, soft: c.soft };
    }

    var COL = { meal: '#14B8A6', cal: '#F59E0B', junk: '#E879F9', act: 'var(--ds-metric-activity, #F97316)', sleep: 'var(--ds-metric-sleep, #A78BFA)', water: 'var(--ds-metric-water, #38BDF8)', mood: 'var(--ds-metric-mood, #34D399)' };
    var NAMES = { meal: 'храненията', cal: 'калориите', act: 'движението', water: 'водата', mood: 'емоциите' };
    /** Само това, което е свалило деня, и с колко; изпълненото не се изрежда. */
    function popHtml(x) {
        if (!x.adh) return '<div class="t"><b>' + x.label + '</b></div><p>Няма отбелязване за деня.</p>';
        var lost = x.adh.parts.filter(function (p) { return p.text && p.got < p.w - 0.05 && !p.pending; });
        var pend = x.adh.parts.filter(function (p) { return p.pending; });
        return '<div class="t"><b>' + x.label + (x.today && !x.adh.closed ? ' · денят тече' : '') + '</b><span>' + x.adh.pct + '%</span></div>' +
            (lost.length ? '<ul>' + lost.map(function (p) { return '<li><i style="background:' + COL[p.k] + '"></i><div>' + p.text + (p.note ? '<small>' + p.note + '</small>' : '') + '</div><em>−' + Math.round(p.w - p.got) + '</em></li>'; }).join('') + '</ul>'
                : '<p>' + (pend.length ? 'Дотук — всичко по плана.' : 'Всичко по плана.') + '</p>') +
            (pend.length ? '<p class="pend">Предстои: ' + pend.map(function (p) { return NAMES[p.k] || ''; }).filter(Boolean).join(', ') + '</p>' : '');
    }
    /** Главната причина за деня (за картата в плана): най-голямото отклонение или „Всичко по плана“. */
    function mainReason(x) {
        if (!x || !x.adh) return '';
        var lost = x.adh.parts.filter(function (p) { return p.text && p.got < p.w - 0.05 && !p.pending; }).sort(function (a, b) { return (b.w - b.got) - (a.w - a.got); });
        return lost.length ? lost[0].text : (x.adh.closed ? 'Всичко по плана' : 'Дотук — по плана');
    }
    function closePop() {
        var p = doc.getElementById('dmPop'); if (p) p.remove();
        doc.querySelectorAll('.dm-open').forEach(function (b) { b.classList.remove('dm-open'); });
    }
    function pop(btn, x) {
        var old = doc.getElementById('dmPop'), same = old && old._for === btn;
        closePop();
        if (same) return;
        var el = doc.createElement('div');
        el.id = 'dmPop'; el.className = 'ga-day-pop'; el.setAttribute('role', 'status'); el._for = btn;
        el.innerHTML = popHtml(x);
        doc.body.appendChild(el);
        btn.classList.add('dm-open');
        var r = btn.getBoundingClientRect(), w = el.offsetWidth, hgt = el.offsetHeight;
        var left = Math.max(8, Math.min(global.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
        var top = r.top - hgt - 10, below = top < 8;
        if (below) top = r.bottom + 10;
        el.style.left = left + 'px'; el.style.top = top + 'px';
        el.style.setProperty('--arrow-x', (r.left + r.width / 2 - left) + 'px');
        if (below) el.classList.add('is-below');
    }
    if (doc && !global.__dmBound) {
        global.__dmBound = true;
        doc.addEventListener('click', function (e) { if (!e.target.closest('.dm-open') && !e.target.closest('#dmPop')) closePop(); });
        global.addEventListener('scroll', closePop, { passive: true });
    }

    global.NutriPlanDayMarks = { VIEWS: DAY_VIEWS, view: view, color: color, mark: mark, dayOf: dayOf, pop: pop, popHtml: popHtml, mainReason: mainReason, closePop: closePop,
        setView: function (v) { try { global.localStorage.setItem('np_day_view', v); } catch (_) {} } };
}(window));
