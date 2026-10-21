/**
 * Фокус по цел: кои показатели са важни за клиента и в какъв ред.
 *
 * Една и съща седмица от устройствата значи различно при различна цел:
 * при отслабване водят темпът на теглото и калориите, при мускулна маса —
 * растежът без загуба на мускули и тренировките, при здраве — сънят,
 * движението и кръвното/захарта. Тук са правилата: група по цел, ред на
 * показателите, оценка (добре / внимание / проблем) с едно изречение и
 * изводите за първия екран. Без мрежа и DOM — ползват го „Анализ“ и „Насоки“.
 */
(function (global) {
    'use strict';

    var GOAL_GROUP = {
        'Отслабване': 'lose', 'Изчистване на коремните мазнини': 'lose', 'Антицелулитна програма': 'lose',
        'Възстановяване на тялото след бременност': 'lose_soft',
        'Мускулна маса': 'gain', 'Покачване на мускулна маса': 'gain',
        'Стягане и оформяне на тялото': 'tone',
        'Подобряване на здравето': 'health', 'Антиейджинг': 'health', 'Детокс и прочистване': 'health', 'Поддържане': 'health'
    };

    var GROUP_LABEL = { lose: 'отслабване', lose_soft: 'възстановяване след бременност', gain: 'мускулна маса', tone: 'стягане', health: 'здраве и енергия' };

    /** Показателите от устройствата — по важност за групата. */
    var DEVICE_ORDER = {
        lose: ['weight', 'composition', 'intake', 'steps', 'sleep', 'workouts', 'activeKcal', 'restingHr', 'hrv', 'bp', 'glucose', 'water'],
        lose_soft: ['weight', 'sleep', 'steps', 'intake', 'composition', 'restingHr', 'hrv', 'workouts', 'bp', 'glucose', 'water', 'activeKcal'],
        gain: ['weight', 'composition', 'workouts', 'intake', 'sleep', 'hrv', 'restingHr', 'steps', 'activeKcal', 'bp', 'glucose', 'water'],
        tone: ['composition', 'workouts', 'weight', 'sleep', 'intake', 'hrv', 'steps', 'restingHr', 'activeKcal', 'bp', 'glucose', 'water'],
        health: ['sleep', 'steps', 'bp', 'glucose', 'restingHr', 'hrv', 'weight', 'workouts', 'water', 'intake', 'composition', 'activeKcal']
    };

    /** Самооценките в „Анализ“ (ред на показателите). */
    var CHECK_ORDER = {
        lose: ['calories', 'engagement', 'activity', 'sleep', 'stress', 'water'],
        lose_soft: ['engagement', 'sleep', 'stress', 'calories', 'water', 'activity'],
        gain: ['engagement', 'calories', 'activity', 'sleep', 'water', 'stress'],
        tone: ['engagement', 'activity', 'calories', 'sleep', 'water', 'stress'],
        health: ['engagement', 'sleep', 'stress', 'activity', 'water', 'calories']
    };

    /** Секциите в „Насоки“. */
    var GUIDE_ORDER = {
        lose: ['limit', 'foods', 'swaps', 'hacks', 'psychology', 'supplements'],
        lose_soft: ['foods', 'supplements', 'limit', 'psychology', 'swaps', 'hacks'],
        gain: ['foods', 'hacks', 'supplements', 'swaps', 'limit', 'psychology'],
        tone: ['foods', 'limit', 'hacks', 'swaps', 'supplements', 'psychology'],
        health: ['foods', 'supplements', 'limit', 'psychology', 'swaps', 'hacks']
    };

    var STEP_TARGET = { lose: 8000, lose_soft: 6000, gain: 6000, tone: 7000, health: 7000 };
    var WORKOUT_TARGET = { lose: 2, lose_soft: 1, gain: 3, tone: 3, health: 2 };

    function list(v) {
        return Array.isArray(v) ? v : (v == null ? [] : String(v).split(','));
    }

    /** Групата по цел и важните състояния (кръвно, захар, стрес) от отговорите. */
    function profileOf(userData) {
        var ud = userData || {};
        var conditions = list(ud.medicalConditions).concat(list(ud.medicalConditions_other)).join(' ').toLowerCase();
        return {
            group: GOAL_GROUP[String(ud.goal || '').trim()] || 'health',
            goal: String(ud.goal || '').trim(),
            bp: /кръвно|хипертон/.test(conditions),
            glucose: /диабет|инсулин/.test(conditions),
            stress: /високо|много/i.test(String(ud.stressLevel || '')) || /тревож|депрес/.test(conditions) ||
                /често|винаги|почти всеки/i.test(String(ud.overeatingFrequency || ''))
        };
    }

    function deviceOrder(p) {
        var order = DEVICE_ORDER[p.group].slice();
        // Здравословно състояние води пред целта.
        ['glucose', 'bp'].forEach(function (k) {
            if (p[k]) { order.splice(order.indexOf(k), 1); order.unshift(k); }
        });
        return order;
    }

    function checkOrder(p) {
        var order = CHECK_ORDER[p.group].slice();
        if (p.stress) { order.splice(order.indexOf('stress'), 1); order.splice(1, 0, 'stress'); }
        return order;
    }

    function guideOrder(p) {
        var order = GUIDE_ORDER[p.group].slice();
        if (p.stress) { order.splice(order.indexOf('psychology'), 1); order.splice(1, 0, 'psychology'); }
        if (p.bp || p.glucose) { order.splice(order.indexOf('limit'), 1); order.unshift('limit'); }
        return order;
    }

    function fmt(v, digits) {
        var n = Math.round(Number(v) * Math.pow(10, digits || 0)) / Math.pow(10, digits || 0);
        return String(n).replace('.', ',');
    }
    function signed(v, digits) { return (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), digits); }
    function grade(tone, note) { return { tone: tone, note: note }; }

    /**
     * Оценка на един показател спрямо целта.
     * @returns {{ key, icon, label, value, tone: 'good'|'warn'|'bad'|'neutral', note }|null}
     */
    function evaluate(key, m, p, planKcal) {
        var g = p.group;
        var lose = g === 'lose' || g === 'lose_soft';
        var x = m[key];
        if (x == null) return null;
        var r;
        switch (key) {
            case 'weight': {
                var t = Number(x.trendKgWeek);
                if (!isFinite(t) || (x.days || 0) < 4) {
                    return { key: key, icon: 'fa-weight-scale', label: 'Тегло', value: fmt(x.last, 1) + ' кг', tone: 'neutral', note: 'Още малко измервания за темпа.' };
                }
                var fast = g === 'lose_soft' ? -0.5 : -1.0;
                if (lose) r = t > -0.1 ? grade('bad', 'Теглото не спада — калориите се коригират при седмичния преглед.')
                    : t > -0.25 ? grade('warn', 'Теглото спада бавно — в рамките на нормалното, следим още седмица.')
                    : t < fast ? grade('warn', 'Теглото спада твърде бързо — рискът е загуба на мускули.')
                    : grade('good', 'Теглото спада с правилния темп.');
                else if (g === 'gain') r = t < 0.1 ? grade('bad', 'Теглото не расте — няма от какво да се градят мускули.')
                    : t > 0.6 ? grade('warn', 'Теглото расте бързо — част от наддаването са мазнини.')
                    : grade('good', 'Теглото расте с правилния темп.');
                else r = Math.abs(t) <= 0.25 ? grade('good', 'Теглото е стабилно.') : grade('warn', t > 0 ? 'Теглото се покачва.' : 'Теглото спада.');
                return { key: key, icon: 'fa-weight-scale', label: 'Тегло', value: signed(t, 2) + ' кг/седм.', tone: r.tone, note: r.note };
            }
            case 'composition': {
                var lean = Number(x.leanChangeKg);
                if (!isFinite(lean)) return null;
                r = lean <= -0.5 ? grade('bad', 'Губиш мускулна маса — белтъкът и силовите тренировки са приоритет.')
                    : (g === 'gain' || g === 'tone') && lean >= 0.3 ? grade('good', 'Мускулната маса расте.')
                    : grade('good', 'Мускулната маса се запазва.');
                return { key: key, icon: 'fa-dumbbell', label: 'Мускулна маса', value: signed(lean, 1) + ' кг за ' + x.days + ' дни', tone: r.tone, note: r.note };
            }
            case 'intake': {
                if (!planKcal) return { key: key, icon: 'fa-utensils', label: 'Приети калории', value: x.avg7 + ' kcal', tone: 'neutral', note: 'Средно на ден по приложението за хранене.' };
                var d = (x.avg7 - planKcal) / planKcal;
                if (g === 'gain') r = d < -0.1 ? grade('bad', 'Приемът е под плана — за растеж трябва целият.') : grade('good', 'Приемът стига за растеж.');
                else r = d > 0.1 ? grade(lose ? 'bad' : 'warn', 'Приемът е над плана с ~' + Math.round(d * 100) + '%.')
                    : d < -0.25 ? grade('warn', 'Приемът е много под плана — рискът е глад и загуба на мускули.')
                    : grade('good', 'Приемът е близо до плана.');
                return { key: key, icon: 'fa-utensils', label: 'Приети калории', value: x.avg7 + ' / ' + planKcal + ' kcal', tone: r.tone, note: r.note };
            }
            case 'steps': {
                var target = STEP_TARGET[g];
                r = x.avg7 >= target ? grade('good', 'Крачките са над целта от ' + target + '.')
                    : x.avg7 >= target * 0.7 ? grade('warn', 'Крачките са под целта от ' + target + ' — по 10 минути ходене след хранене стигат.')
                    : grade('bad', 'Малко движение — целта е ' + target + ' крачки на ден.');
                return { key: key, icon: 'fa-shoe-prints', label: 'Крачки', value: fmt(x.avg7) + ' на ден', tone: r.tone, note: r.note };
            }
            case 'sleep': {
                r = x.avg7 >= 7 ? grade('good', 'Сънят стига за възстановяване и апетит.')
                    : x.avg7 >= 6 ? grade('warn', 'Сънят е под 7 часа — на следващия ден апетитът за сладко е по-силен.')
                    : grade('bad', 'Сънят е под 6 часа — забавя резултата и вдига апетита.');
                return { key: key, icon: 'fa-bed', label: 'Сън', value: fmt(x.avg7, 1) + ' ч', tone: r.tone, note: r.note };
            }
            case 'workouts': {
                var wt = WORKOUT_TARGET[g];
                r = x.perWeek >= wt ? grade('good', 'Тренировките са в целта (' + wt + '+ седмично).')
                    : x.perWeek >= wt - 1 ? grade('warn', 'Тренировките са малко под целта от ' + wt + ' седмично.')
                    : grade(g === 'gain' || g === 'tone' ? 'bad' : 'warn', 'Тренировките са малко — целта е ' + wt + ' седмично.');
                return { key: key, icon: 'fa-person-running', label: 'Тренировки', value: fmt(x.perWeek, 1) + ' седмично', tone: r.tone, note: r.note };
            }
            case 'restingHr': {
                var up = x.avg7 - x.base;
                r = up >= 5 ? grade('warn', 'Пулсът в покой е +' + up + ' над обичайния — тялото не се възстановява (сън, стрес, болест).') : grade('good', 'Пулсът в покой е в обичайните граници.');
                return { key: key, icon: 'fa-heart-pulse', label: 'Пулс в покой', value: x.avg7 + ' уд/мин', tone: r.tone, note: r.note };
            }
            case 'hrv': {
                r = x.avg7 < x.base * 0.85 ? grade('warn', 'Вариабилността на пулса е под обичайното — по-лек ден и повече сън помагат.') : grade('good', 'Добро възстановяване.');
                return { key: key, icon: 'fa-wave-square', label: 'Вариабилност на пулса', value: x.avg7 + ' ms', tone: r.tone, note: r.note };
            }
            case 'bp': {
                r = x.sys >= 140 || x.dia >= 90 ? grade('bad', 'Кръвното е високо — солта и алкохолът са ограничени в плана; лекарят да е в течение.')
                    : x.sys >= 130 || x.dia >= 85 ? grade('warn', 'Кръвното е гранично високо.')
                    : grade('good', 'Кръвното е нормално.');
                return { key: key, icon: 'fa-stethoscope', label: 'Кръвно', value: x.sys + '/' + x.dia, tone: r.tone, note: r.note };
            }
            case 'glucose': {
                if (x.morning == null) return null;
                r = x.morning >= 7 ? grade('bad', 'Сутрешната захар е висока — за лекар.')
                    : x.morning >= 5.6 ? grade('warn', 'Сутрешната захар е гранична — въглехидратите вечер са ограничени.')
                    : grade('good', 'Сутрешната захар е нормална.');
                return { key: key, icon: 'fa-droplet', label: 'Захар сутрин', value: fmt(x.morning, 1) + ' mmol/L', tone: r.tone, note: r.note };
            }
            case 'water': {
                r = x.avg7 >= 1.8 ? grade('good', 'Водата е достатъчно.') : grade('warn', 'Водата е под 1,8 л на ден.');
                return { key: key, icon: 'fa-glass-water', label: 'Вода', value: fmt(x.avg7, 1) + ' л', tone: r.tone, note: r.note };
            }
            case 'activeKcal':
                return { key: key, icon: 'fa-fire', label: 'Активни калории', value: x + ' kcal на ден', tone: 'neutral', note: 'Изгорени с движение (без основната обмяна).' };
        }
        return null;
    }

    /**
     * Изгледът за „Анализ“: подредените карти и до 3 извода.
     * @param {object} metrics essence.metrics
     * @param {object} userData
     * @param {{ planKcal?: number, signals?: object[], coachNote?: string, top?: number }} [opts]
     */
    function deviceView(metrics, userData, opts) {
        var o = opts || {};
        var p = profileOf(userData);
        var m = metrics || {};
        var cards = deviceOrder(p).map(function (k) { return evaluate(k, m, p, o.planKcal); }).filter(Boolean);
        var rank = { bad: 0, warn: 1, good: 2, neutral: 3 };
        // Изводите: първо проблемите по важност за целта, после сигналите от данните, после добрата новина.
        var issues = cards.filter(function (c) { return c.tone === 'bad' || c.tone === 'warn'; })
            .sort(function (a, b) { return rank[a.tone] - rank[b.tone]; });
        var conclusions = issues.slice(0, 2).map(function (c) { c.inConclusions = true; return { tone: c.tone, text: c.note }; });
        (o.signals || []).forEach(function (s) {
            if (conclusions.length < 3 && s && s.text && !conclusions.some(function (c) { return c.text.indexOf(s.text) !== -1; })) {
                conclusions.push({ tone: s.level === 'warn' ? 'warn' : 'neutral', text: s.text });
            }
        });
        var lead = cards[0];
        if (conclusions.length < 3 && lead && lead.tone === 'good') { lead.inConclusions = true; conclusions.push({ tone: 'good', text: lead.note }); }
        if (o.coachNote && conclusions.length < 3) conclusions.push({ tone: 'neutral', text: o.coachNote });
        var top = o.top || 4;
        return {
            group: p.group,
            goalLabel: GROUP_LABEL[p.group],
            cards: cards.slice(0, top),
            more: cards.slice(top),
            conclusions: conclusions.slice(0, 3)
        };
    }

    var api = {
        profileOf: profileOf,
        deviceOrder: deviceOrder,
        checkOrder: checkOrder,
        guideOrder: guideOrder,
        evaluate: evaluate,
        deviceView: deviceView,
        GROUP_LABEL: GROUP_LABEL
    };
    global.NutriPlanGoalFocus = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
