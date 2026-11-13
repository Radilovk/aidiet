/**
 * Дневна активност без часовник и гривна: крачкомерът на телефона и вечерният
 * въпрос за тренировка, пресметнати по профила от въпросника.
 *
 * Няма настройки — всичко идва от профила:
 *   ръст и пол → дължина на крачката; тегло → разход на крачка;
 *   вид и продължителност на тренировките → разход на тренировката (MET).
 *
 * Вечерта (20:00) за всеки ден се знаят два отделни факта (needs):
 *   движението  — от крачките (крачкомер, Health Connect, облак, Play services);
 *                 ден без измерени крачки → „Колко се движи днес?“;
 *   тренировката — от записана от устройство тренировка, иначе по въпросника:
 *       тренира → „Тренира ли днес?“ (до обяд / следобед / не);
 *       не тренира → не се пита, докато профилът не се промени;
 *       устройството е записало тренировка без час → „Кога тренира днес?“
 *       (и при човек, отбелязал, че не тренира); с час — без въпрос.
 * Активността на деня = крачките (или отговорът за движението) + тренировката.
 * Режимът (mode): 'ask' — липсва движението, 'training' — „Тренира ли днес?“,
 * 'when' — „Кога?“, 'steps' — нищо не липсва.
 *
 * Източникът на крачки — най-евтиният наличен, без наша постоянна услуга:
 *   1. Health Connect: гривна/часовник или (Android 14+) вграденото броене на
 *      системата, което тръгва само щом приложение има право да чете крачки;
 *   2. облачна връзка (Huawei Health, Fitbit, Oura, Withings) — по дни от сървъра;
 *   3. Google Play services (Recording API, Android 10+ с Google): записва сам
 *      до 10 дни, четем часовете по местни дни (NutriStepsRecording.java);
 *   4. хардуерният брояч на телефона (TYPE_STEP_COUNTER брои в сензорния чип):
 *      NutriStepsPlugin.java го чете при отваряне, а NutriStepsReceiver.java —
 *      веднъж малко след полунощ (границата на деня) и при изключване. Когато
 *      друг източник дава крачките, нощното показание се изключва.
 * Каквото и да дойде по-късно, отива в деня, в който е направено. Изключение:
 * ден, за който въпросът „Колко се движи?“ е зададен (до часа му нямаше данни)
 * и отговорен — за него важи само отговорът, и на телефона, и на сървъра
 * (факт activity_check; крачките на този ден не влизат в сметките).
 * Разликата между две показания се разпределя по
 * часовете между тях според личната дневна крива (наученa от кратките
 * интервали, свита към типичната крива с псевдо-наблюдения), а рестартът се
 * разпознава по смяната на момента на включване. Празнина без показания през
 * активните часове на два или повече дни прави тези дни непълни: показват се
 * като прогноза, но не отиват към сървъра като измерени.
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
    var MAX_SPREAD_MS = KEEP_DAYS * DAY_MS;
    // Празнина без показания, която обхваща активни часове на два или повече дни
    // (над 20% от обичайния ден от всяка страна), при над 500 крачки разлика: колко
    // от крачките са в кой ден не се знае — тези дни са прогноза, не факт. Празнина
    // в един ден (показание малко след полунощ до следващото) е точна.
    var GUESS_SHARE = 0.2;
    var GUESS_MIN_DELTA = 500;
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
        var age = num(data.age);
        if (!(age >= 12 && age <= 100)) age = 40;
        return {
            sex: sex,
            age: age,
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
     * @param {{ steps?: number|null, assumedSteps?: number|null, trained?: 'am'|'pm'|'no'|null, minutes?: number|null, baselineSteps?: number|null }} day
     * @returns {{ steps: number, measured: boolean, stepsKcal: number, trainingKcal: number, activeKcal: number, equivSteps: number, level: 1|2|3, source: string }}
     */
    function estimateDay(p, day) {
        day = day || {};
        var measured = day.steps != null && isFinite(day.steps);
        // Без измерване: отговорът „Колко се движи?“ (assumedSteps), иначе обичайното от профила.
        var steps = measured ? Math.round(day.steps) : (day.assumedSteps > 0 ? day.assumedSteps : p.typicalSteps);
        var perStep = kcalPerStep(p);
        var stepsKcal = Math.round(steps * perStep);
        var trained = day.trained === 'am' || day.trained === 'pm';
        var base = day.baselineSteps != null ? day.baselineSteps : p.typicalSteps;
        var tk = trained ? trainingKcal(p, day.minutes > 0 ? day.minutes : p.sessionMinutes, measured ? steps - base : null) : 0;
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
     * Колко от обичайния ден (по теглата на часовете) покрива интервалът [t0, t1], по дни.
     * @returns {Record<string, number>} дял 0–1
     */
    function coveredShare(t0, t1, weights) {
        var out = {};
        if (!(t1 > t0)) return out;
        if (t1 - t0 > MAX_SPREAD_MS) t0 = t1 - MAX_SPREAD_MS;
        var total = sum(weights);
        if (!(total > 0)) return out;
        var t = t0;
        while (t < t1) {
            var d = new Date(t);
            var hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
            var end = Math.min(hourEnd, t1);
            var k = dayKey(t);
            out[k] = (out[k] || 0) + weights[d.getHours()] * (end - t) / HOUR_MS / total;
            t = end;
        }
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
                // Дълга празнина (приложението и фоновото четене не са записвали): дните,
                // чиито активни часове са предимно в нея, са прогноза, не измерване.
                if (delta >= GUESS_MIN_DELTA) {
                    var cov = coveredShare(last.t, r.t, weights);
                    var big = Object.keys(cov).filter(function (k) { return cov[k] > GUESS_SHARE; });
                    if (big.length >= 2) big.forEach(function (k) { mark(days, k, 0, true); });
                }
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
        // Health Connect на телефона: правото да чете крачки пуска вграденото броене на
        // системата (Android 14+) и крачките от здравните приложения — тогава нощното
        // показание на брояча не е нужно. Без Health Connect (или при отказ) — само броячът.
        var HS = global.NutriPlanHealth;
        if (HS && typeof HS.connect === 'function') {
            try {
                var hc = HS.state ? HS.state() : {};
                // Целият достъп наведнъж: сънят, теглото и тренировките също спестяват въпроси.
                if (!hc.connected && (await HS.isAvailable()).available) await HS.connect();
            } catch (_) {}
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

    /**
     * Историята по дни от Google Play services (Recording API) → дните. Точни по
     * ден, независимо кога е отворено приложението: денят на абонамента е
     * непълен, по-старите дни от историята не се пипат. Броячът спира да добавя
     * (last = null): ако историята изчезне, първото му показание е „начало“.
     * @param {object} st състоянието
     * @param {{ since?: number, days?: Record<string, number> }} hist
     * @param {number} [now]
     */
    function applyHistory(st, hist, now) {
        now = now || Date.now();
        var days = Object.assign({}, st.days || {});
        var sinceDay = hist.since ? dayKey(hist.since) : null;
        var today = dayKey(now);
        Object.keys(hist.days || {}).forEach(function (k) {
            if (k > today) return;
            var n = Math.round(Number(hist.days[k]) || 0);
            if (sinceDay && k < sinceDay) return;
            days[k] = { s: n, src: 'rec' };
            if (sinceDay && k === sinceDay) days[k].part = true;
        });
        var cutoff = dayKey(now - KEEP_DAYS * DAY_MS);
        Object.keys(days).forEach(function (k) { if (k < cutoff) delete days[k]; });
        return { days: days, last: null, rec: true };
    }

    /** Чете историята по дни (Play services), иначе брояча и дневника му, и обновява дните. */
    async function refresh() {
        var st = readState();
        var P = plugin();
        if (!st.enabled || !P || typeof P.read !== 'function') return st;
        if (typeof P.history === 'function') {
            var hist = null;
            try { hist = await P.history({ days: 10 }); } catch (_) {}
            if (hist && hist.available && hist.days) {
                var h = applyHistory(st, hist);
                var before = JSON.stringify(st.days || {});
                st = writeState({ days: h.days, last: null, rec: true, readAt: Date.now() });
                // Нови дни от историята — към сървъра скоро, не след 6 часа.
                if (JSON.stringify(h.days) !== before) scheduleSync();
                // Историята е в Play services — нощното показание на брояча не е нужно.
                if (st.bg !== false && typeof P.setBackground === 'function') {
                    try { await P.setBackground({ enabled: false }); st = writeState({ bg: false }); } catch (_) {}
                }
                fillFromSteps();
                return st;
            }
            if (st.rec) st = writeState({ rec: false });
        }
        var res;
        try { res = await P.read({ since: st.last ? st.last.t : 0 }); } catch (_) { return st; }
        if (!res || !res.available) return st;
        var boot = Number(res.bootTime) || 0;
        var readings = (res.log || []).map(function (x) { return { t: Number(x.t), c: Number(x.c), boot: Number(x.boot) || boot }; });
        if (res.counter != null) readings.push({ t: Number(res.now) || Date.now(), c: Number(res.counter), boot: boot });
        var next = ingest(st, readings, profileOf(userData()).typicalSteps);
        st = writeState({ last: next.last, days: next.days, hours: next.hours, readAt: Date.now() });
        // Нощното показание — само когато няма друг източник (Health Connect, облак, Play services).
        var bg = !externalStepsFlowing();
        if (st.bg !== bg && typeof P.setBackground === 'function') {
            try { await P.setBackground({ enabled: bg }); st = writeState({ bg: bg }); } catch (_) {}
        }
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

    /**
     * Ден с ръчен отговор „Колко се движи?“ (зададен, защото до часа на въпроса
     * нямаше измерване): за него важи само отговорът — крачки, дошли по-късно, не
     * влизат нито в деня, нито в сметките (медиани, факти към сървъра).
     */
    function isAnswered(ec) {
        if (!ec) return false;
        if (ec.moveLevel != null || ec.activitySource === 'answer') return true;
        // Стари записи: ниво без източник и без тренировка — отговорът „Колко се движи?“.
        return ec.activityLevel != null && !ec.activitySource && !ec.trained;
    }

    /** Отговорът „Колко се движи?“ за деня (1–3) или null. */
    function moveLevelOf(ec) {
        if (!ec) return null;
        if (ec.moveLevel != null) return ec.moveLevel;
        return isAnswered(ec) ? ec.activityLevel : null;
    }

    // Отговорът за движението → крачки за сметката на деня (границите на нивата: 5000 / 10 000).
    var MOVE_STEPS = { 1: 3500, 2: 7500, 3: 11500 };

    // ── Интензитет: кое, записано от устройство, е тренировка ────────────

    // Пулсови зони (ACSM): умерено 64–76% от максималния пулс, високо — от 77%.
    var HR_MODERATE = 0.64;
    var HR_VIGOROUS = 0.77;
    // Метаболитни еквиваленти (Compendium): умерено от 4 (бързо ходене), високо от 6.
    var MET_MODERATE = 4;
    var MET_VIGOROUS = 6;
    // Пулс, задържан над 70% от максималния поне 10 минути без запис на тренировка.
    var BOUT_HR = 0.70;
    var BOUT_MIN = 10;
    var BOUT_GAP_MIN = 10;
    var WALK_TYPES = { walking: 1, wheelchairWalkPace: 1, stairs: 0 };
    var NOT_EXERCISE = { guidedBreathing: 1, meditation: 1, transition: 1, fishing: 1, hunting: 1, sailing: 1, mindAndBody: 0 };

    /** Максимален пулс по възрастта (Tanaka: 208 − 0,7 × години). */
    function hrMaxOf(p) {
        return 208 - 0.7 * (p && p.age ? p.age : 40);
    }

    /**
     * Запис на тренировка от устройство → тренировка ли е и с какъв интензитет.
     *   пусната ръчно на часовника (или въведена) — тренировка (намерението е ясно);
     *   разпозната автоматично (или неизвестно) — по интензитета: пулсът спрямо
     *     максималния за възрастта, или калориите за минута спрямо теглото (MET);
     *     високо — от 10 мин, умерено — от 20 мин (ходене) / 10 мин (друго); без
     *     пулс и калории — ходенето не е тренировка, другото от 20 мин е.
     * Леката разходка остава движение (крачките), не тренировка.
     * @param {{ type?: string, minutes: number, kcal?: number, avgHr?: number, maxHr?: number, method?: number }} w
     *   method: 1 — пусната ръчно, 2 — автоматично, 3 — въведена ръчно (Health Connect)
     * @param {object} [p] профил
     * @returns {{ training: boolean, intensity: 'vigorous'|'moderate'|'light'|null, manual: boolean }}
     */
    function classifyWorkout(w, p) {
        p = p || profileOf(userData());
        var minutes = Number(w && w.minutes) || 0;
        var manual = w && (w.method === 1 || w.method === 3);
        if (minutes < 10 || (w && NOT_EXERCISE[w.type])) return { training: false, intensity: null, manual: !!manual };
        var hrMax = hrMaxOf(p);
        var hrPct = w.avgHr > 0 ? w.avgHr / hrMax : null;
        var met = w.kcal > 0 ? w.kcal / (p.weightKg * minutes / 60) + 1 : null;
        var intensity = null;
        if ((hrPct != null && hrPct >= HR_VIGOROUS) || (met != null && met >= MET_VIGOROUS)) intensity = 'vigorous';
        else if ((hrPct != null && hrPct >= HR_MODERATE) || (met != null && met >= MET_MODERATE)) intensity = 'moderate';
        else if (hrPct != null || met != null) intensity = 'light';
        if (manual) return { training: true, intensity: intensity, manual: true };
        var walk = !!(w && WALK_TYPES[w.type]);
        var training;
        if (intensity === 'vigorous') training = true;
        else if (intensity === 'moderate') training = minutes >= (walk ? 20 : 10);
        else if (intensity === 'light') training = false;
        else training = !walk && minutes >= 20;
        return { training: training, intensity: intensity, manual: false };
    }

    /**
     * Интензивни периоди без запис на тренировка: пулс над 70% от максималния,
     * задържан поне 10 минути (пробите на не повече от 10 мин една от друга).
     * Така високата активност се взима предвид, дори да не е отбелязана.
     * @param {{ t: number, bpm: number }[]} samples по време
     * @param {object} [p] профил
     * @param {{ from: number, to: number }[]} [skip] времето на записаните тренировки
     * @returns {Record<string, { min: number, slot: 'am'|'pm', avgHr: number }>} по дни
     */
    function hrBouts(samples, p, skip) {
        p = p || profileOf(userData());
        var limit = hrMaxOf(p) * BOUT_HR;
        var out = {};
        var list = (samples || []).filter(function (x) {
            return x && x.t > 0 && x.bpm > 0 && !(skip || []).some(function (r) { return x.t >= r.from && x.t <= r.to; });
        }).sort(function (a, b) { return a.t - b.t; });
        var start = null;
        var prev = null;
        var sumBpm = 0;
        var n = 0;
        var close = function () {
            if (start == null) return;
            var mins = (prev.t - start.t) / 60000;
            if (mins >= BOUT_MIN) {
                var k = dayKey(start.t);
                var o = out[k] || { min: 0, slot: new Date(start.t).getHours() < 12 ? 'am' : 'pm', avgHr: 0, _n: 0 };
                o.avgHr = Math.round((o.avgHr * o._n + sumBpm) / (o._n + n));
                o._n += n;
                o.min += Math.round(mins);
                out[k] = o;
            }
            start = null;
            sumBpm = 0;
            n = 0;
        };
        list.forEach(function (x) {
            var hot = x.bpm >= limit;
            if (hot && start != null && (x.t - prev.t) / 60000 > BOUT_GAP_MIN) close();
            if (hot) {
                if (start == null) start = x;
                sumBpm += x.bpm;
                n++;
                prev = x;
            } else {
                close();
            }
        });
        close();
        Object.keys(out).forEach(function (k) { delete out[k]._n; });
        return out;
    }

    /**
     * Тренировки, записани от устройство (Health Connect, облачна връзка), по дни:
     * { 'YYYY-MM-DD': { min, slot } } — за тези дни „Тренира ли днес?“ не се пита.
     * @param {Record<string, { min?: number, slot?: string|null }>} byDay
     */
    function setWorkouts(byDay) {
        if (!byDay) return;
        var st = readState();
        var cutoff = dayKey(Date.now() - KEEP_DAYS * DAY_MS);
        var w = Object.assign({}, st.workouts || {});
        Object.keys(byDay).forEach(function (k) {
            var x = byDay[k] || {};
            if (!(Number(x.min) >= 10)) return;
            w[k] = {
                min: Math.round(Number(x.min)),
                slot: x.slot === 'am' || x.slot === 'pm' ? x.slot : (w[k] && w[k].slot) || null,
                intensity: x.intensity || (w[k] && w[k].intensity) || null,
                src: x.src || (w[k] && w[k].src) || null
            };
        });
        Object.keys(w).forEach(function (k) { if (k < cutoff) delete w[k]; });
        writeState({ workouts: w });
        fillFromSteps();
    }

    function workoutFor(key) {
        var w = readState().workouts;
        return w && w[key] ? w[key] : null;
    }

    /**
     * Какво още трябва да се попита за деня. Движението и тренировката са два
     * отделни факта: движението идва от крачките (иначе — въпрос), тренировката —
     * от записана от устройство тренировка или от въпроса (trainNeed). Отговорът
     * на въпрос е окончателен.
     * @param {string} key ден YYYY-MM-DD
     * @param {object} [ec] eveningCheck на деня
     * @returns {{ move: boolean, train: boolean }}
     */
    function needs(key, ec) {
        ec = ec || ((gameData()[key] || {}).eveningCheck) || {};
        return { move: !isAnswered(ec) && !dayMeasured(key), train: trainNeed(key, ec) };
    }

    /**
     * Въпросът за тренировка за деня:
     *   тренира по въпросника, без тренировка от устройство → 'did' („Тренира ли
     *     днес?“ — до обяд / следобед / не: и дали, и кога с едно докосване);
     *   устройството е записало тренировка (трениращ или не) без час → 'when'
     *     („Кога тренира днес?“); с час (Health Connect) → нищо;
     *   не тренира по въпросника и няма записана тренировка → нищо, докато
     *     профилът не се промени.
     * @returns {false|'did'|'when'}
     */
    function trainNeed(key, ec) {
        if (ec && ec.trained) return false;
        var wo = workoutFor(key);
        if (wo) return wo.slot ? false : 'when';
        return profileOf(userData()).trainer ? 'did' : false;
    }

    /**
     * Активността на деня от каквото се знае: крачките (или отговора за движението)
     * плюс тренировката (отговор или устройство). Записва нивото, разхода и източника.
     */
    function recompute(ec, key) {
        var p = profileOf(userData());
        var mv = moveLevelOf(ec);
        var steps = null;
        if (mv == null) {
            var m = stepsFor(key, { project: true });
            if (m && !(m.partial && !m.projected) && m.steps >= MIN_REAL_DAY) steps = m.steps;
        }
        var wo = workoutFor(key);
        // Тренировка от устройство: с час — попълва деня; без час — влиза в разхода,
        // а часът се допитва („Кога тренира днес?“).
        // Тренировката от устройство (ръчно пусната или с интензитет на тренировка)
        // се взима предвид и при отговор „не“ — измерването е по-сигурно от спомена.
        if (wo && ec.trained !== 'am' && ec.trained !== 'pm' && (wo.slot || ec.trained === 'no')) {
            ec.trained = wo.slot || 'pm';
            ec.trainSource = 'device';
        }
        var trained = ec.trained || (wo ? 'pm' : null);
        var est = estimateDay(p, {
            steps: steps,
            assumedSteps: mv != null ? MOVE_STEPS[mv] : null,
            trained: trained,
            // Минутите от устройството, щом е записало тренировката (и при отговорен час).
            minutes: wo && trained !== 'no' ? wo.min : null,
            baselineSteps: baselineSteps()
        });
        if (mv != null) {
            ec.moveLevel = mv;
            // Отговорът е нивото; тренировката може само да го вдигне.
            ec.activityLevel = Math.max(mv, trained === 'am' || trained === 'pm' ? est.level : 1);
            ec.activitySource = 'answer';
        } else {
            ec.activityLevel = est.level;
            ec.activitySource = est.source;
        }
        ec.activeKcal = est.activeKcal;
        ec.trainingKcal = est.trainingKcal;
        if (est.measured) markMeasured(ec, est, p);
        return ec;
    }

    /** Дните с ръчен отговор за движението (YYYY-MM-DD → true). */
    function answeredDays() {
        var gd = gameData();
        var out = {};
        Object.keys(gd).forEach(function (k) { if (gd[k] && isAnswered(gd[k].eveningCheck)) out[k] = true; });
        return out;
    }

    /** Обичайните крачки в ден без тренировка — медиана от последните дни. */
    function baselineSteps() {
        var st = readState();
        var gd = gameData();
        var vals = Object.keys(st.days || {}).filter(function (k) {
            var d = st.days[k];
            var ec = gd[k] && gd[k].eveningCheck;
            if (isAnswered(ec)) return false;
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

    /**
     * Измереното в деня: крачки, еквивалент с тренировката, целта към този ден и
     * разходът на крачките над обичайните (extraKcal). Обичайните са тези, с
     * които е сметнат планът: медианата на дните без тренировка, иначе нивото от
     * въпросника; а под целта не се брои нищо — денят е „над нормата“ само над нея.
     * Показва се като по-голям разход за деня (game-scoring.js, extraBurnKcal).
     */
    function markMeasured(ec, est, p) {
        ec.steps = est.steps;
        ec.equivSteps = est.equivSteps;
        var t = stepTarget();
        if (t) ec.stepTarget = t;
        var base = baselineSteps();
        var ref = Math.max(base != null ? base : (p ? p.typicalSteps : 7000), t || 0);
        var over = est.steps - ref;
        ec.extraKcal = over > 0 && p ? Math.round(over * kcalPerStep(p)) : 0;
    }

    // ── Режим на вечерния въпрос ─────────────────────────────────────────

    /** Има ли измерване на крачките: крачкомерът, Health Connect или облачна връзка с крачки. */
    function hasStepSource() {
        var st = readState();
        if (st.enabled && st.readAt && Date.now() - st.readAt < 3 * DAY_MS) return true;
        // Крачки от който и да е източник през последните 3 дни (облак: Huawei, Fitbit…).
        for (var i = 0; i <= 3; i++) if (st.ext && st.ext[dayKey(Date.now() - i * DAY_MS)] >= MIN_REAL_DAY) return true;
        try {
            var hc = JSON.parse(localStorage.getItem('np_health_state') || '{}') || {};
            if (hc.connected && (!hc.granted || hc.granted.indexOf('steps') !== -1)) return true;
        } catch (_) {}
        return false;
    }



    /**
     * Има ли измерени крачки за деня. Минал ден — Health Connect или пълен ден от
     * брояча; днес — Health Connect (днешното показание) или брояч, прочетен
     * днес, без празнина в деня.
     * @param {string} key ден YYYY-MM-DD
     */
    function dayMeasured(key, now) {
        now = now || Date.now();
        var st = readState();
        if (st.ext && st.ext[key] >= MIN_REAL_DAY) return true;
        if (!st.enabled) return false;
        var d = st.days && st.days[key];
        if (!d || d.part) return false;
        if (key < dayKey(now)) return d.s >= MIN_REAL_DAY;
        // Днес: броячът е четен днес (брои непрекъснато; при отваряне се дочита).
        return key === dayKey(now) && !!st.readAt && st.readAt >= startOfDay(now);
    }

    /**
     * Без ден — режимът за графика на известията: 'training' (има измерване на
     * крачките — вечерното известие пита за тренировката) или 'ask' (няма —
     * пита за движението; тренировката се допитва в приложението). С ден — какво
     * още трябва за деня (needs): 'ask' — движението, 'training' — тренировката,
     * 'steps' — нищо (крачките и тренировката са известни или отговорени).
     * @param {string} [key] ден YYYY-MM-DD
     * @returns {'training'|'steps'|'ask'}
     */
    function mode(key) {
        if (!key) {
            // Графикът на известията: трениращият — „Тренира ли днес?“; иначе — за
            // движението само без измерване. „Кога?“ е само в приложението.
            if (profileOf(userData()).trainer) return 'training';
            return hasStepSource() ? 'steps' : 'ask';
        }
        var n = needs(key);
        if (n.move) return 'ask';
        if (n.train === 'did') return 'training';
        return n.train === 'when' ? 'when' : 'steps';
    }

    /** Днешните крачки от Health Connect (за въпроса довечера); завършените дни идват от fillFromSteps. */
    function setExternalToday(steps) {
        var n = Math.round(Number(steps) || 0);
        if (!(n > 0)) return readState();
        var st = readState();
        var ext = Object.assign({}, st.ext || {});
        ext[dayKey(Date.now())] = n;
        return writeState({ ext: ext, extTodayAt: Date.now() });
    }

    /**
     * Крачките и сънят по дни от облачните връзки (/api/enrichment/get → daily):
     * завършените дни — като от Health Connect, днешният — като днешно показание.
     * @param {{ steps?: Record<string, number>, sleep?: Record<string, number> }} daily
     */
    function applyCloudDaily(daily) {
        if (!daily) return;
        var today = dayKey(Date.now());
        var steps = daily.steps || {};
        if (daily.workouts) {
            var wk = {};
            Object.keys(daily.workouts).forEach(function (k) {
                var w = daily.workouts[k];
                wk[k] = typeof w === 'object' && w ? { min: w.min, slot: w.slot || null } : { min: w, slot: null };
            });
            setWorkouts(wk);
        }
        var done = {};
        Object.keys(steps).forEach(function (k) { if (k < today) done[k] = steps[k]; });
        if (steps[today] > 0) setExternalToday(steps[today]);
        if (Object.keys(done).length) fillFromSteps(done);
        var HS = global.NutriPlanHealth;
        if (daily.sleep && HS && typeof HS.rememberCloudSleep === 'function') HS.rememberCloudSleep(daily.sleep);
    }

    /**
     * Друг източник (Health Connect или облачна връзка) дава ли крачките (поне 2 от
     * последните 3 завършени дни) — тогава нощното показание на брояча е излишно.
     */
    function externalStepsFlowing(now) {
        now = now || Date.now();
        var st = readState();
        var n = 0;
        for (var i = 1; i <= 3; i++) if (st.ext && st.ext[dayKey(now - i * DAY_MS)] >= MIN_REAL_DAY) n++;
        return n >= 2;
    }

    var TRAINING_QUESTION = 'Тренира ли днес?';
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
        if (value === 'am' || value === 'pm' || value === 'no') {
            ec.trained = value;
            // Отговорът на „Кога?“ за тренировка от устройство — тренировката остава от устройството.
            ec.trainSource = workoutFor(key) && value !== 'no' ? 'device' : 'answer';
        } else {
            var lv = Math.round(Number(value));
            if (!(lv >= 1 && lv <= 3)) return ec;
            ec.moveLevel = lv;
        }
        recompute(ec, key);
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
            // Крачките от Health Connect (и облака) — по дни, за въпроса за движението и сметките.
            var st = readState();
            var cutoff = dayKey(Date.now() - KEEP_DAYS * DAY_MS);
            var ext = Object.assign({}, st.ext || {});
            Object.keys(stepsByDay).forEach(function (k) { if (Number(stepsByDay[k]) > 0) ext[k] = Math.round(Number(stepsByDay[k])); });
            Object.keys(ext).forEach(function (k) { if (k < cutoff) delete ext[k]; });
            writeState({ ext: ext });
        }
        var gd = gameData();
        var today = dayKey(Date.now());
        var p = profileOf(userData());
        var changed = [];
        Object.keys(gd).forEach(function (key) {
            var rec = gd[key];
            if (!rec || typeof rec !== 'object') return;
            var ec = rec.eveningCheck || {};
            if (key === today && new Date().getHours() < 20) return;
            // Тренировка, записана от устройство, в ден без отговор за тренировка.
            var wo = ec.trained !== 'am' && ec.trained !== 'pm' && workoutFor(key) && ec.woMin !== workoutFor(key).min;
            // Ден с ръчен отговор за движението (до часа на въпроса нямаше измерване):
            // важи само отговорът — крачки, дошли след това, не го пипат.
            var stepsNew = false;
            if (!isAnswered(ec)) {
                var s = stepsByDay && stepsByDay[key] != null ? { steps: stepsByDay[key], partial: false } : stepsFor(key, { project: key === today });
                if (s && !(s.partial && !s.projected) && s.steps >= MIN_REAL_DAY) {
                    var had = ec.activitySource === 'steps' || ec.activitySource === 'training' && ec.steps != null;
                    // Същото число (или прогноза върху вече измерен ден) — без промяна.
                    stepsNew = !(had && (s.projected || Math.abs(s.steps - (Number(ec.steps) || 0)) < Math.max(50, 0.01 * s.steps)));
                }
            }
            if (!stepsNew && !wo) return;
            var next = Object.assign({ activityLevel: null, emotionalBalance: null, waterIntake: null, ts: null }, ec);
            recompute(next, key);
            if (wo) next.woMin = workoutFor(key).min;
            if (next.activitySource === 'steps' && key === today) next.activitySource = 'steps_projected';
            rec.eveningCheck = next;
            changed.push(key);
        });
        if (!changed.length) return 0;
        try {
            localStorage.setItem('gameData', JSON.stringify(gd));
        } catch (_) {}
        notifyBackfill(changed);
        return changed.length;
    }

    /**
     * Дни, променени със закъснение (крачки, дошли след деня): планът ги поема
     * наведнъж — изчиства кеша си (иначе следващият му запис би върнал старото),
     * преизчислява оценката на всеки ден (и заключените минали) и праща дните на
     * сървъра. Без отворен план — ключовете чакат в np_backfill_keys.
     * @param {string[]} keys
     */
    function notifyBackfill(keys) {
        if (!keys || !keys.length) return;
        try {
            // Ревизията влиза в подписа на синхронизацията: промяна в минал ден също се праща.
            localStorage.setItem('np_gamedata_rev', String((Number(localStorage.getItem('np_gamedata_rev')) || 0) + 1));
            var pending = JSON.parse(localStorage.getItem('np_backfill_keys') || '[]') || [];
            keys.forEach(function (k) { if (pending.indexOf(k) === -1) pending.push(k); });
            localStorage.setItem('np_backfill_keys', JSON.stringify(pending));
        } catch (_) {}
        var gm = null;
        try {
            gm = global.gameModule;
            if (!gm && global.document) {
                var frame = global.document.querySelector('[data-tab-view="plan"]');
                gm = frame && frame.contentWindow && frame.contentWindow.gameModule;
            }
        } catch (_) { gm = null; }
        if (gm && typeof gm.applyBackfill === 'function') {
            try { gm.applyBackfill(); } catch (_) {}
        }
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
        var ans = answeredDays();
        if (st.enabled && (!E || E.hasConsent('device'))) {
            Object.keys(st.days || {}).sort().forEach(function (k) {
                var d = st.days[k];
                if (k >= today || k < cutoff || d.part || d.s < MIN_REAL_DAY || ans[k]) return;
                facts.push({ kind: 'steps', value: Math.round(d.s), at: at(k), source: 'phone' });
            });
        }
        if (!E || E.hasConsent('checkin')) {
            var p = profileOf(userData());
            var gd = gameData();
            Object.keys(gd).sort().forEach(function (k) {
                var ec = gd[k] && gd[k].eveningCheck;
                if (!ec || k < cutoff || k > today) return;
                // Ръчният отговор за деня: сървърът маха крачките на този ден от сметките
                // (и от гривна/облак, дошли по-късно) — важи само отговорът.
                var mv = moveLevelOf(ec);
                if (mv >= 1 && mv <= 3) facts.push({ kind: 'activity_check', value: mv, at: at(k), source: 'checkin' });
                // Тренировка от устройство: минутите вече са факт (workout); тук — частта
                // от деня (сървърът я слага към тренировката на устройството, не я брои втори път).
                if (ec.trained !== 'am' && ec.trained !== 'pm' && ec.trained !== 'no') return;
                var yes = ec.trained !== 'no';
                facts.push({
                    kind: 'train_check', slot: yes ? ec.trained : null, value: yes ? 1 : 0,
                    minutes: yes ? (ec.trainSource === 'device' && workoutFor(k) ? workoutFor(k).min : p.sessionMinutes) : 0,
                    kcal: yes ? Math.round(ec.trainingKcal || 0) : 0,
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

    /**
     * Всички източници наново, преди седмичния преглед: броячът/историята,
     * днешното от Health Connect, Health Connect към сървъра, облачните връзки
     * (свалят се, ако са стари) и фактите на телефона — решението да не тръгне
     * без закъснелите дни. Всеки източник се пропуска тихо при грешка.
     */
    async function refreshAll() {
        try { await refresh(); } catch (_) {}
        var HS = global.NutriPlanHealth;
        if (HS) {
            try { var n = await HS.todaySteps(); if (n != null) setExternalToday(n); } catch (_) {}
            try { if (HS.state().connected) await HS.sync({ force: true }); } catch (_) {}
        }
        var E = global.NutriPlanEnrichment;
        if (E && E.hasPlanProfile()) {
            try { if (typeof E.syncLinks === 'function') await E.syncLinks(false); } catch (_) {}
            try { var g = await E.get(); applyCloudDaily(g && g.daily); } catch (_) {}
        }
        try { await sync({ force: true }); } catch (_) {}
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
        coveredShare: coveredShare,
        dayMeasured: dayMeasured,
        applyCloudDaily: applyCloudDaily,
        applyHistory: applyHistory,
        needs: needs,
        classifyWorkout: classifyWorkout,
        hrBouts: hrBouts,
        setWorkouts: setWorkouts,
        recompute: recompute,
        refreshAll: refreshAll,
        answeredDays: answeredDays,
        isAnswered: isAnswered,
        notifyBackfill: notifyBackfill,
        setExternalToday: setExternalToday,
        externalStepsFlowing: externalStepsFlowing,
        ingest: ingest,
        dayShareUntil: dayShareUntil,
        mode: mode,
        hasStepSource: hasStepSource,
        stepTarget: stepTarget,
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
                refresh().then(function () {
                    // Днешните крачки от Health Connect — за въпроса довечера (една заявка).
                    var HS = global.NutriPlanHealth;
                    if (!HS || typeof HS.todaySteps !== 'function') return null;
                    return HS.todaySteps().then(function (n) { if (n != null) setExternalToday(n); }).catch(function () {});
                }).then(function () {
                    // Облачните връзки (Huawei, Fitbit, Oura, Withings): крачки и сън по дни.
                    var E = global.NutriPlanEnrichment;
                    if (!E || typeof E.getCached !== 'function' || !E.hasPlanProfile()) return null;
                    return E.getCached().then(function (res) { applyCloudDaily(res && res.daily); }).catch(function () {});
                }).then(function () { return sync(); }).catch(function () {});
            };
            setTimeout(tick, 5000);
            global.document.addEventListener('visibilitychange', function () {
                if (global.document.visibilityState === 'visible') tick();
            });
        }
    } catch (_) {}
}(typeof window !== 'undefined' ? window : globalThis));
