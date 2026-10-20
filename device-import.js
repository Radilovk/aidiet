/**
 * Файл с измервания (CSV или JSON експорт от приложение на везна, часовник,
 * апарат за кръвно, глюкомер) → дневни факти за обогатяването.
 *
 * Колоните се разпознават по заглавието (английски или български) и
 * единицата в него — напр. „Weight(lb)“, „Тегло, кг“, „Body Fat %“,
 * „Systolic“, „Glucose mg/dL“. Няколко записа за един ден се обединяват
 * (средно; за крачки и калории — най-голямото). Нищо не се изпраща, преди
 * клиентът да види какво е разпознато.
 */
(function (global) {
    'use strict';

    var MAX_DAYS = 120;

    /** Редът има значение: по-конкретното първо (висцерални преди мазнини, мускулна маса преди тегло). */
    var COLUMNS = [
        ['date', /^(date|дата|day|ден|time|време|timestamp|measured|start)/i],
        ['visceral_fat', /visceral|висцер/i],
        ['muscle_mass', /muscle|мускул|skeletal/i],
        ['body_water', /body\s*water|вода\s*в\s*тялото|tbw|hydration\s*%|water\s*%/i],
        ['body_fat', /body\s*fat|fat\s*%|мазнин|bf\s*%|^fat$/i],
        ['bp', /systol|систол|sys\b|горн|^sbp/i],
        ['bp2', /diastol|диастол|dia\b|долн|^dbp/i],
        ['resting_hr', /resting|в\s*покой|rhr/i],
        ['hrv', /hrv|variability|вариаб/i],
        ['glucose', /glucose|глюкоз|кръвна\s*захар|blood\s*sugar/i],
        ['steps', /steps?\b|крачк/i],
        ['sleep', /sleep|сън/i],
        ['active_kcal', /active\s*(cal|kcal|energy)|активни\s*кал/i],
        ['intake', /(calories?\s*(in|consumed|eaten|intake))|energy\s*consumed|приет|изяден|consumed/i],
        ['water', /water|вода/i],
        ['weight', /weight|тегло|^mass|маса/i],
    ];

    function detectDelimiter(line) {
        var counts = [',', ';', '\t'].map(function (d) { return [d, line.split(d).length]; });
        counts.sort(function (a, b) { return b[1] - a[1]; });
        return counts[0][0];
    }

    function splitLine(line, d) {
        var out = [];
        var cur = '';
        var q = false;
        for (var i = 0; i < line.length; i++) {
            var c = line[i];
            if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
            else if (c === d && !q) { out.push(cur); cur = ''; }
            else cur += c;
        }
        out.push(cur);
        return out.map(function (s) { return s.trim(); });
    }

    function num(v) {
        if (v == null) return NaN;
        var s = String(v).trim().replace(/\s/g, '');
        // „1.234,5“ и „1,234.5“ → 1234.5; „72,4“ → 72.4
        if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
        else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
        else s = s.replace(',', '.');
        var m = s.match(/-?\d+(\.\d+)?/);
        return m ? Number(m[0]) : NaN;
    }

    /** „7:30“, „7 ч 30 мин“, „7h 30m“ → часове. */
    function hoursOf(v) {
        var s = String(v || '');
        var hm = s.match(/(\d+)\s*[:hч]\s*(\d+)/i);
        if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
        return num(s);
    }

    function pad(n) { return n < 10 ? '0' + n : String(n); }

    /** Дата → YYYY-MM-DD. При „04/05/2026“ денят е първи, освен ако второто число е над 12. */
    function dayOf(v) {
        var s = String(v || '').trim();
        var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
        m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
        if (m) {
            var a = +m[1];
            var b = +m[2];
            var day = b > 12 ? b : a;
            var month = b > 12 ? a : b;
            if (month > 12) return null;
            return m[3] + '-' + pad(month) + '-' + pad(day);
        }
        var t = Date.parse(s);
        if (Number.isFinite(t)) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
        if (/^\d{10,13}$/.test(s)) { var e = new Date(Number(s) * (s.length === 10 ? 1000 : 1)); return e.getFullYear() + '-' + pad(e.getMonth() + 1) + '-' + pad(e.getDate()); }
        return null;
    }

    function unitOf(header) {
        var h = String(header).toLowerCase();
        if (/\blbs?\b|\(lb/.test(h)) return 'lb';
        if (/mg\/dl/.test(h)) return 'mg/dl';
        if (/mmol/.test(h)) return 'mmol/l';
        if (/\bml\b/.test(h)) return 'ml';
        if (/\bmin|мин/.test(h)) return 'min';
        return '';
    }

    function mapColumns(headers) {
        var map = {};
        var used = {};
        headers.forEach(function (h, i) {
            // „Fat-free Body Weight“, „Lean mass“ не са тегло; „Skeletal Muscle(%)“ не е маса в кг.
            if (/fat[-\s]*free|lean|чиста\s*маса|bone|кост|bmi|bmr|protein|белтък|subcutan|подкож|\bage\b|възраст/i.test(h)) return;
            for (var k = 0; k < COLUMNS.length; k++) {
                var kind = COLUMNS[k][0];
                if (used[kind] || !COLUMNS[k][1].test(h)) continue;
                if ((kind === 'muscle_mass' || kind === 'weight') && /%/.test(h)) continue;
                map[i] = { kind: kind, unit: unitOf(h), header: h };
                used[kind] = true;
                return;
            }
        });
        return map;
    }

    function rowsFromText(text, name) {
        var t = String(text || '').replace(/^﻿/, '').trim();
        if (/\.json$/i.test(name || '') || /^[[{]/.test(t)) {
            var data = JSON.parse(t);
            var list = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : Array.isArray(data.measurements) ? data.measurements : []);
            var headers = [];
            list.forEach(function (o) { Object.keys(o || {}).forEach(function (k) { if (headers.indexOf(k) === -1) headers.push(k); }); });
            return { headers: headers, rows: list.map(function (o) { return headers.map(function (h) { return o[h]; }); }) };
        }
        var lines = t.split(/\r?\n/).filter(function (l) { return l.trim(); });
        if (lines.length < 2) return { headers: [], rows: [] };
        var d = detectDelimiter(lines[0]);
        return { headers: splitLine(lines[0], d), rows: lines.slice(1).map(function (l) { return splitLine(l, d); }) };
    }

    var SUM_LIKE = { steps: true, active_kcal: true, intake: true, water: true };

    /**
     * @param {string} text
     * @param {string} [name]
     * @param {Date} [now]
     * @returns {{ facts: object[], found: Object<string, number>, unmatched: string[], from: string|null, to: string|null }}
     */
    function parse(text, name, now) {
        var parsed = rowsFromText(text, name);
        var map = mapColumns(parsed.headers);
        var dateCol = Object.keys(map).find(function (i) { return map[i].kind === 'date'; });
        var unmatched = parsed.headers.filter(function (h, i) { return !map[i]; });
        if (dateCol == null) return { facts: [], found: {}, unmatched: unmatched, from: null, to: null, error: 'Не е открита колона с дата.' };
        var cutoff = new Date((now || new Date()).getTime() - MAX_DAYS * 86400000).toISOString().slice(0, 10);
        var byKey = {};
        parsed.rows.forEach(function (row) {
            var day = dayOf(row[dateCol]);
            if (!day || day < cutoff) return;
            var sys = null;
            var dia = null;
            Object.keys(map).forEach(function (i) {
                var c = map[i];
                if (c.kind === 'date') return;
                var raw = row[i];
                if (raw == null || String(raw).trim() === '') return;
                var v = c.kind === 'sleep' && !c.unit ? hoursOf(raw) : num(raw);
                if (!Number.isFinite(v)) return;
                if (c.kind === 'bp') { sys = v; return; }
                if (c.kind === 'bp2') { dia = v; return; }
                var key = c.kind + '|' + day;
                (byKey[key] = byKey[key] || { kind: c.kind, day: day, unit: c.unit, values: [] }).values.push(v);
            });
            if (sys != null && dia != null) {
                var k = 'bp|' + day;
                (byKey[k] = byKey[k] || { kind: 'bp', day: day, unit: '', values: [], values2: [] }).values.push(sys);
                byKey[k].values2.push(dia);
            }
        });
        var avg = function (xs) { return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length; };
        var facts = [];
        var found = {};
        var days = [];
        Object.keys(byKey).forEach(function (k) {
            var g = byKey[k];
            // Дневни суми: повече от 3 реда за ден са интервали (час, чаша вода) — сбор;
            // иначе са повторени дневни стойности — най-голямата.
            var value = !SUM_LIKE[g.kind] ? avg(g.values)
                : (g.kind === 'water' || g.values.length > 3) ? g.values.reduce(function (a, b) { return a + b; }, 0)
                    : Math.max.apply(null, g.values);
            var fact = { kind: g.kind, value: Math.round(value * 100) / 100, unit: g.unit, at: g.day + 'T12:00:00.000Z', source: 'file' };
            if (g.kind === 'bp') fact.value2 = Math.round(avg(g.values2));
            if (g.kind === 'glucose') fact.key = 'any';
            facts.push(fact);
            found[g.kind] = (found[g.kind] || 0) + 1;
            days.push(g.day);
        });
        days.sort();
        return { facts: facts, found: found, unmatched: unmatched, from: days[0] || null, to: days[days.length - 1] || null };
    }

    var api = { parse: parse, _dayOf: dayOf, _num: num };
    global.NutriPlanDeviceImport = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
