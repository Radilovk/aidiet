/**
 * Дневна активност без часовник и гривна: крачкомерът на телефона и вечерният
 * въпрос за тренировка, пресметнати по профила от въпросника.
 *
 * Няма настройки — всичко идва от профила:
 *   ръст и пол → дължина на крачката; тегло → разход на крачка;
 *   вид и продължителност на тренировките → разход на тренировката (MET).
 *
 * Режимът на вечерния въпрос (20:00) следва профила:
 *   'training' — тренира (спортна активност над 0 дни): „Тренирахте ли днес?“
 *                (до обяд / следобед / не); активността за деня се смята от
 *                крачките (или профила) плюс тренировката;
 *   'steps'    — не тренира, но има измерване (крачкомер или Health Connect):
 *                без въпрос, нивото се попълва от крачките. Изключение: в
 *                ден с крачки много над обичайните „Тренирахте ли днес?“ се
 *                появява в приложението (без известие) — само днес, само в
 *                такъв ден, и спира след 2 отговора „не“ без нито едно „да“;
 *   'ask'      — не тренира и няма измерване: старият въпрос „Колко се движихте?“.
 *
 * Крачкомерът (APK, NutriStepsPlugin.java) дава хардуерния брояч от рестарта
 * и дневник от показания. Разликата между две показания се разпределя по
 * часовете между тях според личната дневна крива (наученa от кратките
 * интервали, свита към типичната крива с псевдо-наблюдения), а рестартът се
 * разпознава по смяната на момента на включване.
 *
 * Към сървъра отиват само дневни факти: крачки за завършени дни (източник
 * „phone“) и отговорите за тренировка (вид „train_check“) — оттам моделът на
 * тренировъчните дни влиза в плана (health-essence.js).
 */
(function (global) {
    'use strict';

    var STATE_KEY = 'np_activity_state';
    var DAY_MS = 86400000;
    var HOUR_MS = 3600000;
    var SYNC_EVERY_MS = 6 * HOUR_MS;
    var KEEP_DAYS = 21;
    // Ден с под 300 крачки е брояч, който не е броил (приложението е било спряно), не реален ден.
    var MIN_REAL_DAY = 300;
    var MAX_SPREAD_MS = 3 * DAY_MS;
    // Псевдо-наблюдения на типичната крива за час: личните данни я изместват постепенно.
    var PRIOR_WEIGHT = 5;

    /**
     * Вид тренировка → MET (Compendium of Physical Activities, средно за вида) и
     * крачки в минута, които телефонът брои по време на тренировката (за да не се
     * брои два пъти: крачките вече са в крачкомера).
     */
    var TRAINING_TYPES = [
        { id: 'strength', label: 'Силови (фитнес, тежести)', met: 5.0, cadence: 10 },
        { id: 'cardio', label: 'Кардио (бягане, колело, плуване)', met: 7.5, cadence: 90 },
        { id: 'group', label: 'Групови (аеробика, зумба, кросфит)', met: 6.5, cadence: 50 },
        { id: 'team', label: 'Отборен спорт, тенис', met: 7.0, cadence: 80 },
        { id: 'combat', label: 'Бойни спортове', met: 8.0, cadence: 30 },
        { id: 'mind', label: 'Йога, пилатес, стречинг', met: 3.0, cadence: 0 },
        { id: 'walk', label: 'Бързо ходене, туризъм', met: 4.5, cadence: 110 }
    ];
    var OTHER_TYPE = { id: 'other', label: 'Друго', met: 5.0, cadence: 30 };

    var SESSION_MINUTES = [
        [/^до 30/i, 25], [/^30/, 40], [/^45/, 55], [/^60/, 75], [/^над 90/i, 100]
    ];

    // Типичен ден по нивото на активност от въпросника, когато няма измерване.
    var TYPICAL_STEPS = { 'Ниско': 4000, 'Средно': 7000, 'Високо': 11000 };

    // Типична дневна крива на крачките (дял по часове 0–23), от популационни данни
    // за смартфони: почти нищо нощем, връх около обяд и след работа.
    var DAY_CURVE = [0.2, 0.1, 0.1, 0.1, 0.2, 0.6, 2.2, 4.8, 6.0, 5.6, 5.6, 6.0,
        7.0, 6.4, 5.6, 5.8, 6.6, 7.6, 7.8, 6.6, 4.8, 3.2, 1.6, 0.6];

    function sum(xs) { return xs.reduce(function (a, b) { return a + b; }, 0); }
    var CURVE_SUM = sum(DAY_CURVE);

    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function dayKey(t) {
        var d = new Date(t);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    function startOfDay(t) {
        var d = new Date(t);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }
    function num(v) {
        var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
        return isFinite(n) ? n : null;
    }
    function list(v) {
        if (Array.isArray(v)) return v.map(String);
        return v ? [String(v)] : [];
    }

    // ── Профил ───────────────────────────────────────────────────────────

    /** Спортът от въпросника: 0 дни → не тренира. */
    function trainsPerWeek(sportActivity) {
        var s = String(sportActivity || '');
        if (!s || /^Никаква/.test(s) || /\b0 дни/.test(s)) return 0;
        if (/1–2|1-2/.test(s)) return 1.5;
        if (/2–4|2-4/.test(s)) return 3;
        if (/5–7|5-7|атлет/i.test(s)) return 6;
        return 0;
    }

    /**
     * Профилът за пресмятанията — от отговорите на въпросника.
     * @param {Record<string, any>} data
     */
    function profileOf(data) {
        data = data || {};
        var sex = data.gender === 'Мъж' ? 'M' : data.gender === 'Жена' ? 'F' : 'X';
        var heightCm = num(data.height);
        var weightKg = num(data.weight);
        if (!(heightCm > 120 && heightCm < 230)) heightCm = sex === 'M' ? 177 : sex === 'F' ? 164 : 170;
        if (!(weightKg > 30 && weightKg < 300)) weightKg = sex === 'M' ? 82 : sex === 'F' ? 68 : 75;
        var labels = list(data.sportTypes).concat(list(data.sportTypes_other).length ? ['Друго'] : []);
        var types = [];
        labels.forEach(function (l) {
            var t = TRAINING_TYPES.filter(function (x) { return x.label === l; })[0] || (l === 'Друго' ? OTHER_TYPE : null);
            if (t && types.indexOf(t) === -1) types.push(t);
        });
        var minutes = null;
        var m = String(data.sportSessionMinutes || '');
        for (var i = 0; i < SESSION_MINUTES.length; i++) {
            if (SESSION_MINUTES[i][0].test(m)) { minutes = SESSION_MINUTES[i][1]; break; }
        }
        var perWeek = trainsPerWeek(data.sportActivity);
        return {
            sex: sex,
            heightCm: heightCm,
            weightKg: weightKg,
            trainsPerWeek: perWeek,
            trainer: perWeek > 0,
            types: types.length ? types : (perWeek > 0 ? [OTHER_TYPE] : []),
            // Без отговор във въпросника (не тренира) — типичните 55 мин, ако крачките покажат тренировка.
            sessionMinutes: minutes || 55,
            typicalSteps: TYPICAL_STEPS[data.dailyActivityLevel] || 7000
        };
    }

    // ── Енергия ──────────────────────────────────────────────────────────

    /** Дължина на крачката (м): ~41,5% от ръста при мъже, ~41,3% при жени. */
    function strideM(p) {
        return p.heightCm * (p.sex === 'F' ? 0.413 : 0.415) / 100;
    }

    /** Нетен разход на ходене ≈ 0,5 kcal на кг на км (ACSM, хоризонтално ходене). */
    function kcalPerStep(p) {
        return 0.5 * p.weightKg * strideM(p) / 1000;
    }

    /**
     * Нетен разход на тренировката (над покоя): (MET − 1) × кг × часове, без
     * крачките, които телефонът вече е преброил по време на нея.
     * @param {object} p профил
     * @param {number} minutes
     * @param {number|null} extraSteps крачки над обичайния ден без тренировка
     */
    function trainingKcal(p, minutes, extraSteps) {
        var types = p.types.length ? p.types : [OTHER_TYPE];
        var met = sum(types.map(function (t) { return t.met; })) / types.length;
        var cadence = sum(types.map(function (t) { return t.cadence; })) / types.length;
        var gross = (met - 1) * p.weightKg * minutes / 60;
        var counted = extraSteps != null ? Math.min(Math.max(0, extraSteps), cadence * minutes) * kcalPerStep(p) : 0;
        return Math.max(0, Math.round(gross - counted));
    }

    /**
     * Ниво на деня 1–3 по еквивалентните крачки (Tudor-Locke: под 5000 заседнал,
     * 10 000+ активен) — същите граници като на сървъра (enrichment.js).
     */
    function levelOf(equivSteps) {
        if (equivSteps < 5000) return 1;
        if (equivSteps < 10000) return 2;
        return 3;
    }

    /**
     * Активността за един ден.
     * @param {object} p профил (profileOf)
     * @param {{ steps?: number|null, trained?: 'am'|'pm'|'no'|null, baselineSteps?: number|null }} day
     * @returns {{ steps: number, measured: boolean, stepsKcal: number, trainingKcal: number, activeKcal: number, equivSteps: number, level: 1|2|3, source: string }}
     */
    function estimateDay(p, day) {
        day = day || {};
        var measured = day.steps != null && isFinite(day.steps);
        var steps = measured ? Math.round(day.steps) : p.typicalSteps;
        var perStep = kcalPerStep(p);
        var stepsKcal = Math.round(steps * perStep);
        var trained = day.trained === 'am' || day.trained === 'pm';
        var base = day.baselineSteps != null ? day.baselineSteps : p.typicalSteps;
        var tk = trained ? trainingKcal(p, p.sessionMinutes, measured ? steps - base : null) : 0;
        var equiv = steps + (perStep > 0 ? tk / perStep : 0);
        return {
            steps: steps,
            measured: measured,
            stepsKcal: stepsKcal,
            trainingKcal: tk,
            activeKcal: stepsKcal + tk,
            // Крачките плюс тренировката, превърната в крачки — за индекса спрямо целта.
            equivSteps: Math.round(equiv),
            level: /** @type {1|2|3} */ (levelOf(equiv)),
            source: trained ? 'training' : measured ? 'steps' : 'estimate'
        };
    }

    // ── Крачкомер: разпределяне на брояча по дни ─────────────────────────

    /** Крачки за час по типичната крива, мащабирани към обичайния ден на човека. */
    function priorPerHour(typicalSteps) {
        return DAY_CURVE.map(function (w) { return typicalSteps * w / CURVE_SUM; });
    }

    /** Личната крива: наблюденията за часа, свити към типичната с PRIOR_WEIGHT псевдо-наблюдения. */
    function hourWeights(hours, typicalSteps) {
        var prior = priorPerHour(typicalSteps || 7000);
        return prior.map(function (pr, h) {
            var o = hours && hours[h];
            if (!o || !o.n) return pr;
            return (pr * PRIOR_WEIGHT + o.s * o.n) / (PRIOR_WEIGHT + o.n);
        });
    }

    /**
     * Разликата на брояча за [t0, t1] → крачки по дни, пропорционално на теглото
     * на всеки час в интервала.
     * @returns {Record<string, number>}
     */
    function spread(t0, t1, delta, weights) {
        var out = {};
        if (!(t1 > t0) || !(delta > 0)) return out;
        if (t1 - t0 > MAX_SPREAD_MS) t0 = t1 - MAX_SPREAD_MS;
        var parts = [];
        var t = t0;
        while (t < t1) {
            var d = new Date(t);
            var hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
            var end = Math.min(hourEnd, t1);
            parts.push({ day: dayKey(t), w: weights[d.getHours()] * (end - t) / HOUR_MS });
            t = end;
        }
        var total = sum(parts.map(function (x) { return x.w; }));
        parts.forEach(function (x) {
            var share = total > 0 ? x.w / total : 1 / parts.length;
            out[x.day] = (out[x.day] || 0) + delta * share;
        });
        return out;
    }

    /**
     * Кратките интервали (до 2 ч, в един час или съседни) учат личната крива:
     * крачки/час за часовете, които покриват.
     */
    function learnHours(hours, t0, t1, delta) {
        if (!(t1 > t0) || t1 - t0 > 2 * HOUR_MS || t1 - t0 < 10 * 60000 || delta < 0) return hours;
        hours = hours || [];
        var rate = delta / ((t1 - t0) / HOUR_MS);
        var h0 = new Date(t0).getHours();
        var h1 = new Date(t1 - 1).getHours();
        [h0, h1].filter(function (h, i, a) { return a.indexOf(h) === i; }).forEach(function (h) {
            var o = hours[h] || { s: 0, n: 0 };
            // Плъзгащо средно: старите наблюдения тежат все по-малко (до 30).
            var n = Math.min(o.n + 1, 30);
            hours[h] = { s: o.s + (rate - o.s) / n, n: n };
        });
        return hours;
    }

    /**
     * Нови показания на брояча → обновено състояние (дни, крива, последно показание).
     * @param {{ last?: {t:number,c:number,boot:number}, days?: object, hours?: any[] }} st
     * @param {{t:number,c:number,boot:number}[]} readings по време
     * @param {number} typicalSteps
     */
    function ingest(st, readings, typicalSteps) {
        st = st || {};
        var days = st.days || {};
        var hours = st.hours || [];
        var last = st.last || null;
        (readings || []).slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (r) {
            if (!r || !(r.t > 0) || !(r.c >= 0)) return;
            if (last && r.t <= last.t) return;
            var weights = hourWeights(hours, typicalSteps);
            var rebooted = !last || Math.abs((r.boot || 0) - (last.boot || 0)) > 2 * 60000 || r.c < last.c;
            if (!last) {
                // Първо показание: денят е започнал без брояч — непълен.
                mark(days, dayKey(r.t), 0, true);
            } else if (rebooted) {
                // Рестарт: броячът е от включването; крачките от последното показание до
                // изключването са загубени — дните в празнината са непълни.
                var from = Math.max(r.boot || r.t, last.t);
                for (var t = startOfDay(last.t); t <= from; t += DAY_MS) mark(days, dayKey(t), 0, true);
                addAll(days, spread(from, r.t, r.c, weights));
            } else {
                var delta = r.c - last.c;
                addAll(days, spread(last.t, r.t, delta, weights));
                hours = learnHours(hours, last.t, r.t, delta);
            }
            last = { t: r.t, c: r.c, boot: r.boot || 0 };
        });
        // Пазим само последните KEEP_DAYS дни.
        var cutoff = dayKey(Date.now() - KEEP_DAYS * DAY_MS);
        Object.keys(days).forEach(function (k) { if (k < cutoff) delete days[k]; });
        return { last: last, days: days, hours: hours };
    }

    function mark(days, key, add, partial) {
        var d = days[key] || { s: 0 };
        d.s += add;
        if (partial) d.part = true;
        days[key] = d;
    }

    function addAll(days, byDay) {
        Object.keys(byDay).forEach(function (k) { mark(days, k, byDay[k], false); });
    }

    /** Колко от обичайния ден е минал до този час (по личната крива) — за прогноза на днешния ден. */
    function dayShareUntil(t, weights) {
        var d = new Date(t);
        var h = d.getHours();
        var done = sum(weights.slice(0, h)) + weights[h] * d.getMinutes() / 60;
        var total = sum(weights);
        return total > 0 ? done / total : 1;
    }

    // ── Състояние в localStorage ─────────────────────────────────────────

    function readState() {
        try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {}; } catch (_) { return {}; }
    }
    function writeState(patch) {
        var s = Object.assign(readState(), patch);
        try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) {}
        return s;
    }
    function userData() {
        try { return JSON.parse(localStorage.getItem('userData') || '{}') || {}; } catch (_) { return {}; }
    }
    function gameData() {
        try { return JSON.parse(localStorage.getItem('gameData') || '{}') || {}; } catch (_) { return {}; }
    }

    // ── Нативният брояч (APK) ─────────────────────────────────────────────

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
        var p = cap.Plugins && cap.Plugins.NutriSteps;
        if (!p && typeof cap.registerPlugin === 'function') {
            try { p = cap.registerPlugin('NutriSteps'); } catch (_) {}
        }
        return p || null;
    }

    /** { available, granted } — има ли брояч на крачки и разрешение. */
    async function pedometerStatus() {
        var P = plugin();
        if (!P || typeof P.status !== 'function') return { available: false, granted: false, reason: 'not_native' };
        try { return await P.status(); } catch (e) { return { available: false, granted: false, reason: e && e.message }; }
    }

    /** Включва крачкомера: разрешение „Физическа активност“ и първо показание. */
    async function enablePedometer() {
        var P = plugin();
        if (!P) throw new Error('Крачкомерът работи в приложението за Android.');
        var st = await pedometerStatus();
        if (!st.available) throw new Error('Телефонът няма вграден брояч на крачки.');
        if (!st.granted) {
            var res = await P.requestPermission();
            if (!res || !res.granted) throw new Error('Без разрешение за физическа активност крачките не могат да се броят.');
        }
        var E = global.NutriPlanEnrichment;
        if (E) E.setConsent('device', true);
        writeState({ enabled: true, enabledAt: new Date().toISOString() });
        await refresh();
        return readState();
    }

    function disablePedometer() {
        writeState({ enabled: false, last: null, days: {}, hours: [] });
    }

    /** Чете брояча и дневника му и обновява дните. */
    async function refresh() {
        var st = readState();
        var P = plugin();
        if (!st.enabled || !P || typeof P.read !== 'function') return st;
        var res;
        try { res = await P.read({ since: st.last ? st.last.t : 0 }); } catch (_) { return st; }
        if (!res || !res.available) return st;
        var boot = Number(res.bootTime) || 0;
        var readings = (res.log || []).map(function (x) { return { t: Number(x.t), c: Number(x.c), boot: Number(x.boot) || boot }; });
        if (res.counter != null) readings.push({ t: Number(res.now) || Date.now(), c: Number(res.counter), boot: boot });
        var next = ingest(st, readings, profileOf(userData()).typicalSteps);
        st = writeState({ last: next.last, days: next.days, hours: next.hours, readAt: Date.now() });
        fillFromSteps();
        return st;
    }

    /**
     * Крачките за ден: { steps, partial } или null. Днешният — с прогноза до края на деня.
     * Без крачкомер — от Health Connect (гривна/часовник); днешното там е вечерното показание.
     */
    function stepsFor(key, opts) {
        var st = readState();
        var d = st.days && st.days[key];
        if (!st.enabled || !d) {
            var e = st.ext && st.ext[key];
            if (!(e >= MIN_REAL_DAY)) return null;
            return key === dayKey(Date.now()) ? { steps: e, partial: true, projected: true } : { steps: e, partial: false };
        }
        var today = dayKey(Date.now());
        if (key !== today) return { steps: Math.round(d.s), partial: !!d.part || d.s < MIN_REAL_DAY };
        if (!(opts && opts.project)) return { steps: Math.round(d.s), partial: true };
        // Прогноза: изминатото досега / дела от деня по личната крива (до ×1,6).
        var p = profileOf(userData());
        var share = dayShareUntil(st.readAt || Date.now(), hourWeights(st.hours, p.typicalSteps));
        var factor = share > 0 ? Math.min(1.6, 1 / share) : 1;
        return { steps: Math.round(d.s * factor), partial: true, projected: true };
    }

    /** Обичайните крачки в ден без тренировка — медиана от последните дни. */
    function baselineSteps() {
        var st = readState();
        var gd = gameData();
        var vals = Object.keys(st.days || {}).filter(function (k) {
            var d = st.days[k];
            var ec = gd[k] && gd[k].eveningCheck;
            return !d.part && d.s >= MIN_REAL_DAY && !(ec && (ec.trained === 'am' || ec.trained === 'pm'));
        }).map(function (k) { return st.days[k].s; }).sort(function (a, b) { return a - b; });
        if (vals.length < 3) return null;
        var mid = Math.floor(vals.length / 2);
        return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    }

    /** Целта за крачки по профила и целта (goal-focus.js); без модула — null (индексът остава по нивото). */
    function stepTarget() {
        try {
            var GF = global.NutriPlanGoalFocus || (global.top && global.top.NutriPlanGoalFocus);
            return GF && typeof GF.stepTarget === 'function' ? GF.stepTarget(userData()) : null;
        } catch (_) { return null; }
    }

    /** Измереното в деня: крачки, еквивалент с тренировката и целта към този ден. */
    function markMeasured(ec, est) {
        ec.steps = est.steps;
        ec.equivSteps = est.equivSteps;
        var t = stepTarget();
        if (t) ec.stepTarget = t;
    }

    // ── Режим на вечерния въпрос ─────────────────────────────────────────

    /** Има ли измерване на крачките: крачкомерът или Health Connect с крачки. */
    function hasStepSource() {
        var st = readState();
        if (st.enabled && st.readAt && Date.now() - st.readAt < 3 * DAY_MS) return true;
        try {
            var hc = JSON.parse(localStorage.getItem('np_health_state') || '{}') || {};
            if (hc.connected && (!hc.granted || hc.granted.indexOf('steps') !== -1)) return true;
        } catch (_) {}
        return false;
    }

    // Неотбелязана тренировка: ден с крачки поне ×1,6 и +4000 над обичайното.
    var UNMARKED_FACTOR = 1.6;
    var UNMARKED_EXTRA = 4000;
    // След толкова „не“ (без нито едно „да“) за 28 дни въпросът не се появява.
    var UNMARKED_MUTE_NO = 2;

    /**
     * Дневните крачки от един източник (както на сървъра — не се смесват):
     * Health Connect, ако има поне 7 завършени дни, иначе крачкомерът.
     * @returns {{ done: Record<string, number>, today: number|null }}
     */
    function measuredDays() {
        var st = readState();
        var today = dayKey(Date.now());
        var ext = {};
        Object.keys(st.ext || {}).forEach(function (k) { if (k < today && st.ext[k] >= MIN_REAL_DAY) ext[k] = st.ext[k]; });
        if (Object.keys(ext).length >= 7) return { done: ext, today: st.ext[today] != null ? st.ext[today] : null };
        var out = {};
        if (st.enabled) {
            Object.keys(st.days || {}).forEach(function (k) {
                var d = st.days[k];
                if (k < today && !d.part && d.s >= MIN_REAL_DAY) out[k] = d.s;
            });
        }
        var t = st.enabled && st.days && st.days[today];
        return { done: out, today: t ? t.s : null };
    }

    /**
     * Да се появи ли „Тренирахте ли днес?“ при човек, който по въпросника не
     * тренира. Само за днешния ден, само ако крачките досега са много над
     * обичайните за последните 14 дни (поне 7 дни данни). Не се появява, ако
     * за 28 дни е казал 2 пъти „не“ без нито едно „да“ — това са разходки.
     */
    function askTrainingOn(key) {
        var now = Date.now();
        if (key !== dayKey(now)) return false;
        var from28 = dayKey(now - 28 * DAY_MS);
        var gd = gameData();
        var yes = 0;
        var no = 0;
        Object.keys(gd).forEach(function (k) {
            var ec = gd[k] && gd[k].eveningCheck;
            if (!ec || k < from28 || k === key) return;
            if (ec.trained === 'am' || ec.trained === 'pm') yes++;
            else if (ec.trained === 'no') no++;
        });
        if (!yes && no >= UNMARKED_MUTE_NO) return false;
        var m = measuredDays();
        if (m.today == null) return false;
        var from14 = dayKey(now - 14 * DAY_MS);
        var vals = Object.keys(m.done).filter(function (k) { return k >= from14; })
            .map(function (k) { return m.done[k]; }).sort(function (a, b) { return a - b; });
        if (vals.length < 7) return false;
        var mid = Math.floor(vals.length / 2);
        var med = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
        return m.today >= Math.max(med * UNMARKED_FACTOR, med + UNMARKED_EXTRA);
    }

    /**
     * Без ден — режимът за графика на известията: 'training' (тренира по
     * въпросника), 'steps' (измерване, без въпрос), 'ask'. С ден — за този ден:
     * в 'steps' денят с неотбелязана тренировка става 'training' (само в приложението).
     * @param {string} [key] ден YYYY-MM-DD
     * @returns {'training'|'steps'|'ask'}
     */
    function mode(key) {
        if (profileOf(userData()).trainer) return 'training';
        if (!hasStepSource()) return 'ask';
        return key && askTrainingOn(key) ? 'training' : 'steps';
    }

    var TRAINING_QUESTION = 'Тренирахте ли днес?';
    var TRAINING_ACTIONS = [
        { id: 'train_am', title: 'Да, до обяд', value: 'am' },
        { id: 'train_pm', title: 'Да, следобед', value: 'pm' },
        { id: 'train_no', title: 'Не', value: 'no' }
    ];

    /**
     * Отговорът на вечерния въпрос → полетата на деня. За тренировката: какво е
     * отговорено (trained), нивото 1–3 (за оценката на деня) и оценката на разхода.
     * @param {object} ec eveningCheck на деня (променя се на място)
     * @param {any} value 'am'|'pm'|'no' или 1–3 (старият въпрос)
     * @param {string} key ден YYYY-MM-DD
     */
    function applyAnswer(ec, value, key) {
        if (value !== 'am' && value !== 'pm' && value !== 'no') {
            ec.activityLevel = value;
            return ec;
        }
        var measured = stepsFor(key, { project: true });
        var est = estimateDay(profileOf(userData()), {
            steps: measured && !(measured.partial && !measured.projected) ? measured.steps : null,
            trained: value,
            baselineSteps: baselineSteps()
        });
        ec.trained = value;
        ec.activityLevel = est.level;
        ec.activitySource = est.source;
        ec.activeKcal = est.activeKcal;
        ec.trainingKcal = est.trainingKcal;
        if (est.measured) markMeasured(ec, est);
        try {
            var E = global.NutriPlanEnrichment;
            // Самият отговор е съгласието: той влиза в плана като факт.
            if (E && !E.hasConsent('checkin')) E.setConsent('checkin', true);
        } catch (_) {}
        scheduleSync();
        return ec;
    }

    /**
     * Режим 'steps': нивото на деня се попълва от крачките, без въпрос. Завършените
     * дни — окончателно; днешният — по прогноза след 20:00 (заменя се на другия ден).
     * Пипат се само дни, които вече имат запис в отметките.
     */
    function fillFromSteps(stepsByDay) {
        if (stepsByDay) {
            // Крачките от Health Connect се пазят за въпроса в ден с много крачки (askTrainingOn).
            var st = readState();
            var cutoff = dayKey(Date.now() - KEEP_DAYS * DAY_MS);
            var ext = Object.assign({}, st.ext || {});
            Object.keys(stepsByDay).forEach(function (k) { if (Number(stepsByDay[k]) > 0) ext[k] = Math.round(Number(stepsByDay[k])); });
            Object.keys(ext).forEach(function (k) { if (k < cutoff) delete ext[k]; });
            writeState({ ext: ext });
        }
        if (mode() !== 'steps') return 0;
        var gd = gameData();
        var today = dayKey(Date.now());
        var p = profileOf(userData());
        var changed = [];
        Object.keys(gd).forEach(function (key) {
            var rec = gd[key];
            if (!rec || typeof rec !== 'object') return;
            var ec = rec.eveningCheck || {};
            if (ec.activityLevel != null && ec.activitySource !== 'steps_projected') return;
            var s = stepsByDay && stepsByDay[key] != null ? { steps: stepsByDay[key], partial: false } : null;
            if (!s) {
                if (key === today && new Date().getHours() < 20) return;
                s = stepsFor(key, { project: key === today });
            }
            if (!s || (s.partial && !s.projected) || s.steps < MIN_REAL_DAY) return;
            var est = estimateDay(p, { steps: s.steps });
            rec.eveningCheck = Object.assign({ activityLevel: null, emotionalBalance: null, waterIntake: null, ts: null }, ec, {
                activityLevel: est.level,
                activitySource: s.projected ? 'steps_projected' : 'steps',
                activeKcal: est.activeKcal
            });
            markMeasured(rec.eveningCheck, est);
            changed.push(key);
        });
        if (!changed.length) return 0;
        try {
            localStorage.setItem('gameData', JSON.stringify(gd));
            var GN = global.GameNotifier || (global.top && global.top.GameNotifier);
            changed.forEach(function (k) {
                if (GN && typeof GN.notifyAnswerSaved === 'function') GN.notifyAnswerSaved(k);
                else localStorage.setItem('gameDataDirtyKey', k);
            });
        } catch (_) {}
        return changed.length;
    }

    // ── Факти към сървъра ────────────────────────────────────────────────

    /** Крачките от телефона (завършени, пълни дни) и отговорите за тренировка. */
    function buildFacts(now) {
        now = now || Date.now();
        var st = readState();
        var E = global.NutriPlanEnrichment;
        var facts = [];
        var today = dayKey(now);
        var cutoff = dayKey(now - KEEP_DAYS * DAY_MS);
        var at = function (k) { return k + 'T12:00:00.000Z'; };
        if (st.enabled && (!E || E.hasConsent('device'))) {
            Object.keys(st.days || {}).sort().forEach(function (k) {
                var d = st.days[k];
                if (k >= today || k < cutoff || d.part || d.s < MIN_REAL_DAY) return;
                facts.push({ kind: 'steps', value: Math.round(d.s), at: at(k), source: 'phone' });
            });
        }
        if (!E || E.hasConsent('checkin')) {
            var p = profileOf(userData());
            var gd = gameData();
            Object.keys(gd).sort().forEach(function (k) {
                var ec = gd[k] && gd[k].eveningCheck;
                if (!ec || k < cutoff || k > today) return;
                if (ec.trained !== 'am' && ec.trained !== 'pm' && ec.trained !== 'no') return;
                var yes = ec.trained !== 'no';
                facts.push({
                    kind: 'train_check', slot: yes ? ec.trained : null, value: yes ? 1 : 0,
                    minutes: yes ? p.sessionMinutes : 0, kcal: yes ? Math.round(ec.trainingKcal || 0) : 0,
                    at: at(k), source: 'checkin'
                });
            });
        }
        return facts;
    }

    var _syncTimer = null;
    function scheduleSync() {
        if (_syncTimer) clearTimeout(_syncTimer);
        _syncTimer = setTimeout(function () { _syncTimer = null; sync({ force: true }).catch(function () {}); }, 3000);
    }

    /** Изпраща фактите при промяна; иначе най-много веднъж на 6 часа. */
    async function sync(opts) {
        var E = global.NutriPlanEnrichment;
        if (!E || !E.hasPlanProfile()) return { sent: 0, skipped: 'no_profile' };
        var st = readState();
        if (!(opts && opts.force) && st.sentAt && Date.now() - st.sentAt < SYNC_EVERY_MS) return { sent: 0, skipped: 'recent' };
        var facts = buildFacts();
        if (!facts.length) return { sent: 0, skipped: 'empty' };
        var sig = JSON.stringify(facts);
        if (sig === st.sentSig) { writeState({ sentAt: Date.now() }); return { sent: 0, skipped: 'unchanged' }; }
        // submit проверява съгласието по източник; тук фактите вече са филтрирани по съгласие.
        var source = E.hasConsent('device') ? 'device' : 'checkin';
        var res = await E.submit({ facts: facts }, source);
        writeState({ sentAt: Date.now(), sentSig: sig });
        return { sent: facts.length, level: res && res.level };
    }

    var api = {
        TRAINING_TYPES: TRAINING_TYPES,
        TRAINING_QUESTION: TRAINING_QUESTION,
        TRAINING_ACTIONS: TRAINING_ACTIONS,
        profileOf: profileOf,
        strideM: strideM,
        kcalPerStep: kcalPerStep,
        trainingKcal: trainingKcal,
        estimateDay: estimateDay,
        levelOf: levelOf,
        hourWeights: hourWeights,
        spread: spread,
        ingest: ingest,
        dayShareUntil: dayShareUntil,
        mode: mode,
        hasStepSource: hasStepSource,
        stepTarget: stepTarget,
        askTrainingOn: askTrainingOn,
        applyAnswer: applyAnswer,
        fillFromSteps: fillFromSteps,
        stepsFor: stepsFor,
        buildFacts: buildFacts,
        sync: sync,
        state: readState,
        pedometer: {
            supported: function () { return !!plugin(); },
            status: pedometerStatus,
            enable: enablePedometer,
            disable: disablePedometer,
            refresh: refresh
        }
    };
    global.NutriPlanActivity = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    // Обвивката (горният прозорец) чете брояча и изпраща фактите при отваряне и
    // при връщане в приложението (sync сам пази интервала от 6 часа).
    try {
        if (global.document && global.top === global) {
            var tick = function () {
                refresh().then(function () { return sync(); }).catch(function () {});
            };
            setTimeout(tick, 5000);
            global.document.addEventListener('visibilitychange', function () {
                if (global.document.visibilityState === 'visible') tick();
            });
        }
    } catch (_) {}
}(typeof window !== 'undefined' ? window : globalThis));
