/**
 * Спазване на плана за деня (0–100) — общият модул за телефона (Напредък, плана, наградите) и сървъра
 * (наградите, обобщението за AI). Целият план, не само отметките: всяко отклонение сваля толкова,
 * колкото тежи ЗА ТОЗИ човек (личните тежести — goal-focus.js → adherenceWeights).
 *
 *   NutriPlanDayAdherence.compute(rec, { todayKey, key, weights?, group?, policy? })
 *     → { pct, parts: [{ k, w, got, text, note, pending }], closed } | null
 *
 * Помощните сметки (слотове, калории, движение) са същите като в game-scoring.js и
 * analytics-compression.js; тестът test:day-adherence ги пази еднакви.
 */
(function (/** @type {any} */ global) {
    'use strict';

    function zp(n) { return n < 10 ? '0' + n : '' + n; }
    function dateKey(d) { d = d || new Date(); return d.getFullYear() + '-' + zp(d.getMonth() + 1) + '-' + zp(d.getDate()); }
    function getMealSlots(rec) { if (rec && rec.mealSlots && rec.mealSlots.length) return rec.mealSlots; return Object.keys((rec && rec.meals) || {}); }
    function planMealSlots(rec) {
        var freeKey = rec && rec.freeMeal && rec.freeMeal.mealKey;
        return getMealSlots(rec).filter(function (m) { return m !== freeKey && !/^Напитка|^Свободно хранене/.test(m); });
    }
    function getPlannedCalories(rec) { if (rec && rec.lockedPlannedCalories > 0) return rec.lockedPlannedCalories; return (rec && rec.plannedCalories) || null; }
    function extraCalsOf(rec) {
        return ((rec && rec.extraMeals) || []).reduce(function (s, em) { if (em.isAddedToPlan && !em.countCalories) return s; return s + (em.calories || 0); }, 0);
    }
    function activityRawPctOf(ec) {
        if (!ec) return null;
        if (ec.equivSteps > 0 && ec.stepTarget > 0) return Math.round(ec.equivSteps / ec.stepTarget * 100);
        return ec.activityLevel != null ? Math.round((ec.activityLevel - 1) / 2 * 100) : null;
    }

    var ADH_WEIGHTS = {
        base:      { meal: 35, cal: 15, junk: 10, act: 12, sleep: 10, water: 10, mood: 8 },
        lose:      { meal: 32, cal: 20, junk: 10, act: 12, sleep: 10, water: 8, mood: 8 },
        gain:      { meal: 40, cal: 12, junk: 8, act: 15, sleep: 10, water: 8, mood: 7 },
        health:    { meal: 30, cal: 10, junk: 10, act: 12, sleep: 15, water: 13, mood: 10 },
        lose_soft: { meal: 40, cal: 10, junk: 8, act: 5, sleep: 12, water: 15, mood: 10 }
    };
    function fmtInt(n) { return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function compute(rec, o) {
        if (!rec) return null;
        o = o || {};
        var todayKey = o.todayKey || dateKey(new Date());
        var key = o.key || rec.date || todayKey;
        // Личните тежести (goal-focus.js → adherenceWeights), иначе — по групата на целта.
        var W = o.weights || ADH_WEIGHTS[o.group] || ADH_WEIGHTS.base;
        var ec = rec.eveningCheck || null, mc = rec.morningCheck || null;
        var isToday = key >= todayKey;
        var eveDone = !!(ec && (ec.activityLevel != null || ec.emotionalBalance != null || ec.waterIntake != null));
        var closed = !isToday || eveDone;
        var parts = [];
        var add = function (k, frac, text, note, pending) { parts.push({ k: k, w: W[k], got: Math.max(0, Math.min(1, frac)) * W[k], text: text || '', note: note || '', pending: !!pending }); };

        // Хранения — по дела от калориите
        var slots = planMealSlots(rec);
        var calMap = rec.mealCalories || {};
        if (slots.length) {
            var tot = slots.reduce(function (sum, m) { return sum + (calMap[m] || 0); }, 0);
            var share = function (m) { return tot > 0 ? (calMap[m] || 0) / tot : 1 / slots.length; };
            var missed = slots.filter(function (m) { return !(rec.meals && rec.meals[m] === true); });
            var lost = missed.reduce(function (sum, m) { return sum + share(m); }, 0);
            add('meal', 1 - lost, missed.length ? (closed ? 'Пропуснато: ' : 'Предстои: ') + missed.join(', ') : '', missed.length && tot > 0 ? Math.round(lost * 100) + '% от калориите за деня' : '', !closed && missed.length > 0);
        }
        // Калории — спрямо плана
        var planned = getPlannedCalories(rec);
        if (planned > 0) {
            var free = (rec.freeMeal && rec.freeMeal.calories > 0) ? rec.freeMeal : null;
            var eaten = getMealSlots(rec).reduce(function (sum, m) {
                if (!(rec.meals && rec.meals[m])) return sum;
                return sum + (free && free.mealKey === m ? free.calories : (calMap[m] || 0));
            }, 0) + extraCalsOf(rec);
            var d = eaten / planned - 1;
            var over = d > 0;
            var fullBand = 0.10, halfBand = (o.group === 'gain' && !over) ? 0.10 : 0.20;
            if (!over && !closed) add('cal', 1, '', '', true);           // днес — „под плана“ още не важи
            else if (Math.abs(d) <= fullBand) add('cal', 1);
            else add('cal', Math.abs(d) <= halfBand ? 0.5 : 0, over ? 'Над калориите' : 'Под калориите',
                (over ? '+' : '−') + fmtInt(eaten - planned) + ' kcal (' + Math.round(eaten / planned * 100) + '% от плана)');
        }
        // Без хранения извън плана
        var junk = ((rec.extraMeals) || []).filter(function (em) { return em.isJunk && (!em.isAddedToPlan || em.countCalories !== false); }).length;
        add('junk', junk === 0 ? 1 : junk === 1 ? 0.5 : 0, junk ? 'Хранене извън плана' : '', junk > 1 ? junk + ' пъти' : '');
        // Движение
        var raw = activityRawPctOf(ec);
        var trained = !!(ec && (ec.trained === 'am' || ec.trained === 'pm'));
        var maxPct = o.policy && o.policy.maxPct;
        if (maxPct && raw != null && raw >= maxPct) add('act', 0, 'Движение над препоръчаното', raw + '% от целта за деня');
        else if (trained) add('act', 1);
        else if (raw == null) add('act', 0, closed ? 'Движение — без отговор' : '', '', !closed);
        else add('act', raw / 100, raw < 100 ? (raw < 60 ? 'Малко движение' : 'Недостатъчно движение') : '',
            ec && ec.equivSteps > 0 && ec.stepTarget > 0 ? fmtInt(ec.steps || ec.equivSteps) + ' от ' + fmtInt(ec.stepTarget) + ' крачки' : '');
        // Сън
        if (!mc || mc.sleptWell == null) add('sleep', 0, 'Сън — без отговор');
        else {
            var lv = mc.level || (mc.sleptWell ? 'good' : 'bad');
            add('sleep', lv === 'good' ? 1 : lv === 'mid' ? 0.5 : 0, lv === 'good' ? '' : lv === 'mid' ? 'Сън — среден' : 'Лош сън', mc.hours ? String(mc.hours).replace('.', ',') + ' ч' : (mc.phone && mc.phone.note) || '');
        }
        // Вода
        if (!ec || ec.waterIntake == null) add('water', 0, closed ? 'Вода — без отговор' : '', '', !closed);
        else add('water', ec.waterIntake === true ? 1 : 0, ec.waterIntake === true ? '' : 'Недостатъчно вода');
        // Емоции
        if (!ec || ec.emotionalBalance == null) add('mood', 0, closed ? 'Емоции — без отговор' : '', '', !closed);
        else { var eb = ec.emotionalBalance; add('mood', eb >= 3 ? 1 : eb === 2 ? 0.75 : 0.25, eb >= 3 ? '' : eb === 2 ? 'Спокойно, без подем' : 'Напрегнат ден'); }

        var wsum = parts.reduce(function (sum, p) { return sum + p.w; }, 0);
        var got = parts.reduce(function (sum, p) { return sum + p.got; }, 0);
        return { pct: wsum ? Math.round(got / wsum * 100) : 0, parts: parts, closed: closed };
    }


    var api = { compute: compute, WEIGHTS: ADH_WEIGHTS };
    global.NutriPlanDayAdherence = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
