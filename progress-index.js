/**
 * Напредък — колко се е приближил човекът до целта си. Не колко старание е вложил:
 * старанието са звездите (ангажираност), тук са само мерими промени и усещането.
 *
 * Показателите са водещите за целта от модела на целта (goal-model.js → lead), в техния ред:
 * отслабване — тегло, талия, състав; стягане — състав, тренировки, талия; здраве — енергия, сън,
 * храносмилане; метаболитни цели — талия, захар, кръвно… Така индексът работи и за цел, която
 * човекът сам напише (свободният текст минава през същия модел).
 *
 * Всеки показател дава 0–100:
 *  - резултат с посока (тегло, талия, мускули): каква част от пътя до целта на фазата е извървяна —
 *    от началната стойност към целевата (целевото тегло е от модела; талията — до границата на риска);
 *    при „задържане“ — колко стабилна е стойността;
 *  - състояние (енергия, сън, захар, кръвно, храносмилане, вода): колко близо е до доброто ниво;
 *  - тренировки: изпълнените спрямо целта за седмицата (за целите, при които те са водещи).
 * Индексът е среднопретеглен по реда на показателите (0,4 · 0,3 · 0,2 · 0,1), като се броят само
 * наличните. Енергията от седмичния преглед влиза винаги (0,1) — тя е усещането за резултата.
 * Без поне един измерен резултат (тегло, талия, състав, захар, кръвно, енергия, храносмилане)
 * индекс няма: казва се какво да се измери.
 *
 *   NutriPlanProgress.compute({ profile, userData, weightLog, checkins, metrics, checks, planStart, now })
 */
(function (global) {
    'use strict';

    var DAY = 86400000;
    var WEIGHTS = [0.4, 0.3, 0.2, 0.1];
    var FEELING = 0.1;
    var OUTCOME = { weight: 1, waist: 1, composition: 1, glucose: 1, bp: 1, energy: 1, digestion: 1 };
    var WORKOUT_TARGET = { lose: 2, lose_soft: 1, gain: 3, tone: 3, health: 2 };
    var LABEL = {
        weight: 'Тегло', waist: 'Талия', composition: 'Мускули', workouts: 'Тренировки', energy: 'Енергия',
        sleep: 'Сън', glucose: 'Захар', bp: 'Кръвно', digestion: 'Храносмилане', water: 'Вода'
    };
    var NEEDS = {
        weight: 'Запиши теглото си — в седмичния преглед или в Профил.',
        waist: 'Измери талията — пита се в седмичния преглед.',
        composition: 'Мускулите се виждат с везна, която мери състава (Профил → устройства).',
        glucose: 'Нужни са измервания на захарта (Профил → устройства).',
        bp: 'Нужни са измервания на кръвното (Профил → устройства).',
        energy: 'Енергията се пита в седмичния преглед.',
        digestion: 'Храносмилането се пита в седмичния преглед.'
    };

    function clamp01(v) { return Math.max(0, Math.min(1, v)); }
    function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
    function fmt(n, d) { return String(Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).replace('.', ','); }
    function signed(n, d) { return (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n), d); }
    function curve(x, pts) {
        if (x <= pts[0][0]) return pts[0][1];
        for (var i = 1; i < pts.length; i++) {
            if (x <= pts[i][0]) { var a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
        }
        return pts[pts.length - 1][1];
    }
    /** Каква част от пътя start → target е извървяна (0–1); обратната посока — 0. */
    function along(start, cur, target) {
        var dist = target - start;
        if (!dist) return null;
        return clamp01((cur - start) / dist);
    }
    function dirOf(profile) {
        var d = profile && profile.direction;
        return d === 'lose' || d === 'gain' || d === 'recomp' ? d : 'maintain';
    }

    // ── Показателите ─────────────────────────────────────────────────────────
    var SCORE = {
        /** Тегло: част от пътя до целевото тегло на фазата; при задържане/смяна на състава — стабилност. */
        weight: function (c) {
            var pts = c.weightSeries;
            if (pts.length < 2 || pts[pts.length - 1].at - pts[0].at < 7 * DAY) return null;
            var start = pts[0].kg, cur = pts[pts.length - 1].kg, delta = cur - start;
            var d = dirOf(c.profile);
            if (d === 'lose' || d === 'gain') {
                var phase = c.profile.model && c.profile.model.phases && c.profile.model.phases[0];
                var target = phase && phase.until && phase.until.metric === 'weight' ? phase.until.value : null;
                if (!target || (d === 'lose' ? target >= start : target <= start)) target = start * (d === 'lose' ? 0.95 : 1.04);
                return { score: 100 * along(start, cur, target), text: signed(delta, 1) + ' кг от ' + fmt(Math.abs(target - start), 1) };
            }
            return { score: curve(Math.abs(delta) / start, [[0.01, 100], [0.03, 60], [0.06, 15]]), text: signed(delta, 1) + ' кг' };
        },
        /** Талия: до границата на риска (94/80 см) или −3 см, ако вече е под нея; при покачване — да не расте. */
        waist: function (c) {
            var pts = c.waistSeries;
            if (pts.length < 2) return null;
            var start = pts[0].cm, cur = pts[pts.length - 1].cm, delta = cur - start;
            var d = dirOf(c.profile);
            if (d === 'gain' || d === 'maintain') return { score: curve(delta, [[1, 100], [3, 50], [5, 10]]), text: signed(delta, 1) + ' см' };
            var limit = c.male ? 94 : 80;
            var target = start - limit > 3 ? Math.max(limit, start - 12) : start - 3;
            return { score: 100 * along(start, cur, target), text: signed(delta, 1) + ' см от ' + fmt(start - target, 0) };
        },
        /** Мускули (везна със състав): при покачване/стягане — към +1,5 кг; при сваляне — да се запазят. */
        composition: function (c) {
            var comp = c.metrics.composition;
            if (!comp || !isFinite(comp.leanChangeKg)) return null;
            var lean = comp.leanChangeKg, d = dirOf(c.profile);
            var score = d === 'lose' ? curve(lean, [[-1.5, 0], [-0.3, 100]]) : 100 * clamp01(lean / 1.5);
            return { score: score, text: signed(lean, 1) + ' кг мускули' };
        },
        workouts: function (c) {
            var per = c.metrics.workouts ? c.metrics.workouts.perWeek : c.checks.workouts7;
            if (per == null) return null;
            var t = WORKOUT_TARGET[c.profile.group] || 2;
            return { score: 100 * clamp01(per / t), text: fmt(per, 0) + ' от ' + t + ' за седмица' };
        },
        /** Енергия — от последните два седмични прегледа (Добра / Средна / Ниска). */
        energy: function (c) {
            var e = c.checkins.filter(function (x) { return x.energy; }).slice(-2);
            if (!e.length) return null;
            var avg = e.reduce(function (s, x) { return s + x.energy; }, 0) / e.length;
            return { score: curve(avg, [[1, 100], [2, 60], [3, 20]]), text: avg <= 1.5 ? 'Добра' : avg <= 2.5 ? 'Средна' : 'Ниска' };
        },
        sleep: function (c) {
            var m = c.metrics.sleep;
            if (m && isFinite(m.avg7)) return { score: curve(m.avg7, [[5, 20], [6, 55], [7, 90], [8, 100]]), text: fmt(m.avg7, 1) + ' ч' };
            if (c.checks.sleepPct == null) return null;
            return { score: c.checks.sleepPct, text: c.checks.sleepPct >= 70 ? 'Добър' : c.checks.sleepPct >= 40 ? 'Среден' : 'Лош' };
        },
        glucose: function (c) {
            var g = c.metrics.glucose;
            if (!g || g.morning == null) return null;
            return { score: curve(g.morning, [[5.6, 100], [6.1, 70], [7, 30], [8, 5]]), text: fmt(g.morning, 1) + ' mmol/L' };
        },
        bp: function (c) {
            var b = c.metrics.bp;
            if (!b || !b.sys) return null;
            return { score: curve(Math.max(b.sys - 120, (b.dia - 80) * 2), [[0, 100], [10, 70], [20, 35], [40, 0]]), text: b.sys + '/' + b.dia };
        },
        digestion: function (c) {
            var last = c.checkins.filter(function (x) { return x.digestion != null; }).slice(-1)[0];
            if (!last) return null;
            return { score: last.digestion ? 35 : 100, text: last.digestion ? 'Иска внимание' : 'Наред' };
        },
        water: function (c) {
            if (c.checks.waterPct == null) return null;
            return { score: c.checks.waterPct, text: c.checks.waterPct >= 70 ? 'Добра' : c.checks.waterPct >= 40 ? 'Средна' : 'Ниска' };
        }
    };

    /**
     * @param {{ profile: object, userData?: object, weightLog?: Array<{at:number,kg:number}>,
     *   checkins?: Array<{at:number, weightKg?:number, waistCm?:number, energy?:number, digestion?:boolean}>,
     *   metrics?: object, checks?: object, planStart?: number|null, now?: number }} input
     * @returns {{ value: number|null, parts: Array<{key:string,label:string,score:number,text:string}>, needs: {key:string,label:string,text:string}|null }}
     */
    function compute(input) {
        var inp = input || {};
        var profile = inp.profile || {};
        var ud = inp.userData || {};
        var now = inp.now || Date.now();
        var start = inp.planStart || null;
        var checkins = (inp.checkins || []).slice().sort(function (a, b) { return a.at - b.at; });

        // Тегло: началното (от въпросника) в началото на плана + дневникът + прегледите.
        var weightSeries = [];
        var startKg = num(ud.startWeight) || num(ud.weight);
        var log = (inp.weightLog || []).filter(function (x) { return x && x.kg > 0; });
        if (startKg && start && (!log.length || log[0].at > start)) weightSeries.push({ at: start, kg: startKg });
        log.forEach(function (x) { weightSeries.push({ at: x.at, kg: x.kg }); });
        checkins.forEach(function (x) {
            if (x.weightKg > 0 && !weightSeries.some(function (w) { return Math.abs(w.at - x.at) < DAY / 2; })) weightSeries.push({ at: x.at, kg: x.weightKg });
        });
        weightSeries.sort(function (a, b) { return a.at - b.at; });

        // Талия: от въпросника (начало) + прегледите.
        var waistSeries = [];
        var w0 = num(ud.waistCircumference);
        if (w0 && start) waistSeries.push({ at: start, cm: w0 });
        checkins.forEach(function (x) { if (x.waistCm > 0) waistSeries.push({ at: x.at, cm: x.waistCm }); });

        var ctx = {
            profile: profile, metrics: inp.metrics || {}, checks: inp.checks || {}, checkins: checkins,
            weightSeries: weightSeries, waistSeries: waistSeries, male: ud.gender === 'Мъж', now: now
        };

        var lead = (profile.lead && profile.lead.length ? profile.lead : ['weight', 'energy', 'sleep']).slice(0, 4);
        var parts = [], wsum = 0, total = 0, hasOutcome = false, needs = null;
        lead.forEach(function (key, i) {
            var f = SCORE[key];
            var r = f ? f(ctx) : null;
            if (!r || !isFinite(r.score)) {
                if (!needs && OUTCOME[key] && NEEDS[key]) needs = { key: key, label: LABEL[key], text: NEEDS[key] };
                return;
            }
            if (OUTCOME[key]) hasOutcome = true;
            parts.push({ key: key, label: LABEL[key], score: Math.round(r.score), text: r.text });
            wsum += WEIGHTS[i]; total += WEIGHTS[i] * r.score;
        });
        // Усещането — винаги, когато го има (ако не е сред водещите).
        if (lead.indexOf('energy') < 0) {
            var e = SCORE.energy(ctx);
            if (e) {
                hasOutcome = true;
                parts.push({ key: 'energy', label: LABEL.energy, score: Math.round(e.score), text: e.text });
                wsum += FEELING; total += FEELING * e.score;
            }
        }
        if (!hasOutcome || !wsum) return { value: null, parts: parts, needs: needs || { key: 'weight', label: LABEL.weight, text: NEEDS.weight } };
        return { value: Math.round(total / wsum), parts: parts, needs: needs };
    }

    var api = { compute: compute, LABEL: LABEL };
    global.NutriPlanProgress = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
