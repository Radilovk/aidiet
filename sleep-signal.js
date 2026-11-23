/**
 * Сънят по използването на телефона (Android). Екранът не е светвал дълго през нощта → почивка;
 * кога е последното и първото използване и колко пъти е ползван между тях → проверка на отговора
 * „Спа ли добре?“. Телефонът само СВАЛЯ оценката — тишина не е доказателство за сън (книга, будно
 * лежане), но използване през нощта е доказателство за прекъсване.
 *
 * Данните: плъгинът NutriScreen (android-res/…/NutriScreenPlugin.java) — събитията на системата
 * „екранът се включи/изгасна“ за последните часове; без услуга на заден план, без съдържание от
 * приложенията. Нужен е достъпът „Данни за използване“ (дава се в настройките на телефона).
 *
 * Нощта (analyzeNight): сесиите под 1 мин. се пренебрегват (известие светва екрана); почивка е пауза
 * ≥ 90 мин. между две сесии, в прозорец 21:00–11:00; най-дългата е основната, към нея се
 * прикачат съседни почивки, ако между тях е имало само кратко ползване (< 15 мин.) — това са
 * събужданията. Часовете са сборът на почивките; „последно/първо използване“ — краищата на нощта.
 *
 * Слива се с отговора (refine): добър сън с под 6 ч почивка → лош; с 6–7 ч или поне 3 събуждания →
 * среден. Сън от гривна (source: 'device') не се пипа — тя е по-точна; телефонът само се записва.
 */
(function (global) {
    'use strict';

    var STORE = 'np_sleep_signal';
    var MIN_SESSION_MS = 60 * 1000;
    var MIN_REST_MS = 90 * 60 * 1000;
    var GLANCE_MS = 15 * 60 * 1000;
    var GOOD_H = 7, SHORT_H = 6, MANY_WAKEUPS = 3;

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function dayStart(key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 0, 0, 0, 0).getTime(); }
    function hhmm(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function round1(h) { return Math.round(h * 10) / 10; }

    /** Прозорецът на нощта преди деня `key`: от 21:00 вчера до 11:00 днес (местно време). */
    function windowFor(key) {
        var d0 = dayStart(key);
        var prev = new Date(d0); prev.setDate(prev.getDate() - 1);
        var from = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate(), 21, 0, 0, 0).getTime();
        return { from: from, to: d0 + 11 * 3600000, query: from - 3 * 3600000 };
    }

    /**
     * @param {Array<[number, number]>} sessions екранът включен [начало, край] в мс
     * @param {string} key денят на събуждане (YYYY-MM-DD)
     * @returns {null | { quietH, wakeups, lastUse, firstUse }} null — няма ясна нощ
     */
    function analyzeNight(sessions, key) {
        var w = windowFor(key);
        var s = (sessions || []).filter(function (x) { return x && x[1] - x[0] >= MIN_SESSION_MS; })
            .sort(function (a, b) { return a[0] - b[0]; });
        var gaps = [];
        for (var i = 0; i + 1 < s.length; i++) {
            var a = s[i][1], b = s[i + 1][0];
            var ca = Math.max(a, w.from), cb = Math.min(b, w.to);
            if (cb - ca >= MIN_REST_MS) gaps.push({ i: i, from: a, to: b, len: cb - ca });
        }
        if (!gaps.length) return null;
        var main = 0;
        gaps.forEach(function (g, k) { if (g.len > gaps[main].len) main = k; });
        var lo = main, hi = main;
        // Съседни почивки през кратко ползване — същата нощ (събуждания).
        while (lo > 0 && gaps[lo].i - gaps[lo - 1].i === 1 && s[gaps[lo].i][1] - s[gaps[lo].i][0] < GLANCE_MS) lo--;
        while (hi < gaps.length - 1 && gaps[hi + 1].i - gaps[hi].i === 1 && s[gaps[hi + 1].i][1] - s[gaps[hi + 1].i][0] < GLANCE_MS) hi++;
        var total = 0;
        for (var k = lo; k <= hi; k++) total += gaps[k].len;
        return { quietH: round1(total / 3600000), wakeups: hi - lo, lastUse: gaps[lo].from, firstUse: gaps[hi].to };
    }

    /** Нивото по телефона: добро / средно / лошо. */
    function levelOf(n) {
        if (!n) return null;
        if (n.quietH < SHORT_H) return 'bad';
        if (n.quietH < GOOD_H || n.wakeups >= MANY_WAKEUPS) return 'mid';
        return 'good';
    }
    var RANK = { bad: 0, mid: 1, good: 2 };

    /** Кратко за ден: „без използване 00:10–06:40 (6,5 ч), 2 събуждания“. */
    function noteOf(n) {
        if (!n) return '';
        var w = n.wakeups === 0 ? '' : ', ' + n.wakeups + (n.wakeups === 1 ? ' събуждане' : ' събуждания');
        return 'телефон: без използване ' + hhmm(n.lastUse) + '–' + hhmm(n.firstUse) + ' (' + String(n.quietH).replace('.', ',') + ' ч)' + w;
    }

    /**
     * Сливане на нощта с отговора.
     * @param {{ sleptWell?: boolean, level?: string, source?: string }} mc записаният отговор
     * @returns {{ level: string, sleptWell: boolean, changed: boolean }}
     */
    function merge(mc, night) {
        var own = (mc && (mc.level || (mc.sleptWell ? 'good' : 'bad'))) || 'good';
        var phone = levelOf(night);
        if (!phone || (mc && mc.source === 'device') || RANK[phone] >= RANK[own]) {
            return { level: own, sleptWell: own !== 'bad', changed: false };
        }
        return { level: phone, sleptWell: phone !== 'bad', changed: true };
    }

    // ── Устройството ───────────────────────────────────────────────────────
    function readState() { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) { return {}; } }
    function writeState(patch) {
        try { localStorage.setItem(STORE, JSON.stringify(Object.assign(readState(), patch))); } catch (_) {}
    }

    function bridge() {
        try {
            if (global.top && global.top !== global && global.top.Capacitor) return global.top.Capacitor;
            if (global.Capacitor) return global.Capacitor;
        } catch (_) {}
        return null;
    }

    function plugin() {
        var cap = bridge();
        if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
        if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'android') return null;
        var p = cap.Plugins && cap.Plugins.NutriScreen;
        if (!p && typeof cap.registerPlugin === 'function') { try { p = cap.registerPlugin('NutriScreen'); } catch (_) {} }
        return p || null;
    }

    /** { available, granted } — достъпът се помни от момента, в който е даден (преди това няма данни). */
    async function status() {
        var P = plugin();
        if (!P || typeof P.status !== 'function') return { available: false, granted: false };
        try {
            var st = await P.status();
            if (st && st.granted && !readState().since) writeState({ since: Date.now() });
            if (st && !st.granted && readState().since) writeState({ since: 0 });
            return { available: !!(st && st.available), granted: !!(st && st.granted) };
        } catch (_) { return { available: false, granted: false }; }
    }

    /** Отваря настройките, където човекът включва достъпа за Nutriin. */
    async function enable() {
        var P = plugin();
        if (!P) throw new Error('Работи в приложението за Android.');
        await P.openSettings();
    }

    /** Нощта преди деня `key` по екрана на телефона (или null) — резултатът се помни за деня. */
    async function nightFor(key) {
        var st = readState();
        if (st.nights && st.nights[key] !== undefined) return st.nights[key];
        var P = plugin();
        if (!P) return null;
        var s = await status();
        if (!s.granted) return null;
        var w = windowFor(key);
        var since = readState().since || 0;
        // Преди даването на достъп няма данни — „тишината“ там не е сън.
        if (!since || since > w.query) return null;
        var res;
        try { res = await P.sessions({ from: w.query, to: Math.min(Date.now(), w.to + 3 * 3600000) }); } catch (_) { return null; }
        if (!res || !res.granted) return null;
        var night = analyzeNight(res.sessions || [], key);
        var nights = Object.assign({}, readState().nights || {});
        nights[key] = night;
        var cut = Object.keys(nights).sort().slice(-14);
        var keep = {};
        cut.forEach(function (k) { keep[k] = nights[k]; });
        writeState({ nights: keep });
        return night;
    }

    /**
     * След записан отговор: сверява го с телефона. io = { getRecord(key), saveRecord(key, rec) }.
     * @returns {Promise<boolean>} променен ли е записът
     */
    async function refine(key, io) {
        try {
            if (!plugin()) return false;
            var rec0 = io.getRecord(key);
            if (!rec0 || !rec0.morningCheck || typeof rec0.morningCheck.sleptWell !== 'boolean') return false;
            if (rec0.morningCheck.phone) return false;
            var night = await nightFor(key);
            if (!night) return false;
            var rec = io.getRecord(key);
            var mc = rec && rec.morningCheck;
            if (!mc || typeof mc.sleptWell !== 'boolean') return false;
            var m = merge(mc, night);
            mc.phone = { quietH: night.quietH, wakeups: night.wakeups, lastUse: night.lastUse, firstUse: night.firstUse, note: noteOf(night) };
            if (m.changed) { mc.ownLevel = mc.level || (mc.sleptWell ? 'good' : 'bad'); mc.level = m.level; mc.sleptWell = m.sleptWell; }
            io.saveRecord(key, rec);
            return true;
        } catch (_) { return false; }
    }

    global.NutriPlanSleepSignal = {
        status: status, enable: enable, nightFor: nightFor, refine: refine,
        state: readState, supported: function () { return !!plugin(); },
        analyzeNight: analyzeNight, levelOf: levelOf, merge: merge, noteOf: noteOf, windowFor: windowFor
    };

    // Обвивката отбелязва кога е даден достъпът (преди това няма данни).
    try { if (global.top === global && plugin()) setTimeout(function () { status(); }, 3000); } catch (_) {}
})(typeof window !== 'undefined' ? window : globalThis);
