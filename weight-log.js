/**
 * Теглото: дневник сутрин, на гладно (localStorage np_weight_log).
 *
 * Без постоянно поле на екрана. Теглото влиза по два пътя и двата отиват тук:
 *  - седмичният преглед на плана го пита в своя момент (plan.html → sendWeeklyAnswers);
 *  - Профил → „Тегло“ (profile.html → saveChanges), когато човекът сам реши.
 * Записът не пипа плана веднага: следващият седмичен преглед го използва (попълва въпроса
 * с последното число), а адаптацията на плана става там — по правилата в nutrition-engine/monitoring.js.
 *
 * userData.weight е текущото тегло (профилът го показва), userData.startWeight — началното
 * (за етапите на теглото в наградите); задава се веднъж, при първия запис след плана.
 */
(function() {
    var KEY = 'np_weight_log';
    var DAY = 86400000;
    function load() { try { var l = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (_) { return []; } }
    function readUd() { try { return JSON.parse(localStorage.getItem('userData') || '{}') || {}; } catch (_) { return {}; } }
    function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return n >= 30 && n <= 300 ? Math.round(n * 10) / 10 : null; }

    /** Ново тегло: едно число на ден (по-новото замества записа от последните 12 часа). */
    function add(kg) {
        var v = num(kg);
        if (v == null) return false;
        var l = load().filter(function(x) { return Date.now() - x.at > 12 * 3600000; });
        l.push({ at: Date.now(), kg: v });
        try { localStorage.setItem(KEY, JSON.stringify(l.slice(-60))); } catch (_) {}
        var ud = readUd();
        if (Object.keys(ud).length) {
            if (num(ud.startWeight) == null && num(ud.weight) != null) ud.startWeight = String(num(ud.weight));
            ud.weight = String(v);
            try { localStorage.setItem('userData', JSON.stringify(ud)); } catch (_) {}
        }
        return true;
    }

    window.NPWeight = {
        add: add,
        /** Последното тегло, ако е от последните 3 дни (за седмичния преглед). */
        recent: function() { var l = load(); var x = l[l.length - 1]; return x && Date.now() - x.at <= 3 * DAY ? x.kg : null; },
        /** Последният запис { at, kg } или null. */
        last: function() { var l = load(); return l[l.length - 1] || null; },
        /** Началното тегло — за етапите на теглото. */
        startKg: function() { var ud = readUd(); return num(ud.startWeight) || num(ud.weight); },
        /** Последните записи за чата: [{ date, kg }]. */
        log: function() { return load().slice(-6).map(function(x) { return { date: new Date(x.at).toISOString().slice(0, 10), kg: x.kg }; }); }
    };
}());
