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

    var GM = global.NutriPlanGoalModel || (typeof require === 'function' ? require('./goal-model.js') : null);

    /** Посоката от модела на целта → групата на екрана (смяната на състава е „стягане“). */
    function groupOf(model, lactating) {
        if (model.direction === 'lose') return lactating || model.primary === 'PP' ? 'lose_soft' : 'lose';
        if (model.direction === 'gain') return 'gain';
        if (model.direction === 'recomp') return 'tone';
        return 'health';
    }

    function sportDaysOf(label) {
        var s = String(label || '');
        return /Висока|атлет/i.test(s) ? 6 : /Средна/i.test(s) ? 3 : /Ниска/i.test(s) ? 1.5 : 0;
    }

    /**
     * Групата по целта В КОНТЕКСТА на профила (goal-model.js: всички отметки,
     * свободният текст, клиничната карта, ИТМ/талия, възраст) и важните състояния.
     */
    function profileOf(userData) {
        var ud = userData || {};
        var conditions = list(ud.medicalConditions).concat(list(ud.medicalConditions_other)).join(' ').toLowerCase();
        var bp = /кръвно|хипертон/.test(conditions);
        var glucose = /диабет|инсулин/.test(conditions);
        var status = String(ud.postpartumStatus || '');
        var postpartum = ud.clinicalProtocol === 'postpartum_lactation';
        var lactating = postpartum && /^Кърмя/.test(status);
        var model = GM ? GM.resolve({
            goal: ud.goal,
            goalOther: ud.goal_other,
            sex: ud.gender === 'Мъж' ? 'M' : ud.gender === 'Жена' ? 'F' : 'X',
            age: parseFloat(ud.age) || null,
            heightCm: parseFloat(ud.height) || null,
            weightKg: parseFloat(String(ud.weight || '').replace(',', '.')) || null,
            lossKg: parseFloat(ud.lossKg) || null,
            waistCm: parseFloat(ud.waistCircumference || ud._lastWaistCm) || null,
            clinical: [].concat(bp ? ['HTN'] : [], glucose ? ['IR'] : []),
            protocol: ud.clinicalProtocol || null,
            pregnant: postpartum && /^Бременна/.test(status),
            lactating: lactating,
            sportDays: sportDaysOf(ud.sportActivity)
        }) : null;
        var goalText = list(ud.goal).map(function (g) { return String(g).trim(); }).filter(Boolean).join(', ');
        return {
            group: model ? groupOf(model, lactating) : (GOAL_GROUP[goalText] || 'health'),
            goal: goalText,
            lead: model ? model.lead : [],
            direction: model ? model.direction : null,
            bp: bp,
            glucose: glucose,
            stress: /високо|много/i.test(String(ud.stressLevel || '')) || /тревож|депрес/.test(conditions) ||
                /често|винаги|почти всеки/i.test(String(ud.overeatingFrequency || ''))
        };
    }

    function deviceOrder(p) {
        var order = DEVICE_ORDER[p.group].slice();
        // Водещите показатели на целта — отпред, в техния ред.
        (p.lead || []).slice().reverse().forEach(function (k) {
            var i = order.indexOf(k);
            if (i > 0) { order.splice(i, 1); order.unshift(k); }
        });
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

    /* ─── Обединени индекси: свързаните показатели в един, по целта ─── */

    function clamp01(v) { return Math.max(0, Math.min(1, v)); }
    /** Линейно между точки [[x, y], …] (x нарастващо), y в 0–100. */
    function curve(x, pts) {
        if (x <= pts[0][0]) return pts[0][1];
        for (var i = 1; i < pts.length; i++) {
            if (x <= pts[i][0]) {
                var a = pts[i - 1], b = pts[i];
                return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
            }
        }
        return pts[pts.length - 1][1];
    }

    /** Отделните съставки (0–100) от устройствата и самооценките. */
    function components(m, checks, p, planKcal) {
        var g = p.group;
        var lose = g === 'lose' || g === 'lose_soft';
        var c = {};
        var ck = checks || {};
        if (m.sleep) c.sleep = { v: curve(m.sleep.avg7, [[4.5, 5], [5, 25], [6, 55], [7, 85], [8, 100]]), label: 'сън', text: fmt(m.sleep.avg7, 1) + ' ч' };
        else if (ck.sleepPct != null) c.sleep = { v: ck.sleepPct, label: 'сън', text: ck.sleepPct + '% добри нощи' };
        if (m.hrv && m.hrv.base) c.hrv = { v: curve(m.hrv.avg7 / m.hrv.base, [[0.7, 20], [0.85, 60], [1, 100]]), label: 'вариабилност на пулса', text: m.hrv.avg7 + ' ms' };
        if (m.restingHr && m.restingHr.base) c.rhr = { v: curve(m.restingHr.avg7 - m.restingHr.base, [[0, 100], [5, 55], [10, 15]]), label: 'пулс в покой', text: m.restingHr.avg7 + ' уд/мин' };
        if (m.weight && isFinite(m.weight.trendKgWeek) && (m.weight.days || 0) >= 4) {
            var t = m.weight.trendKgWeek;
            var pts = lose ? [[-1.4, 45], [-1.0, 85], [-0.25, 100], [-0.1, 55], [0.1, 15], [0.4, 0]]
                : g === 'gain' ? [[-0.2, 0], [0, 30], [0.1, 85], [0.5, 100], [0.8, 55]]
                : [[-0.6, 30], [-0.25, 90], [0, 100], [0.25, 90], [0.6, 30]];
            if (g === 'lose_soft') pts = [[-1.0, 30], [-0.5, 85], [-0.2, 100], [-0.05, 55], [0.2, 15]];
            c.weight = { v: curve(t, pts), label: 'темп на теглото', text: signed(t, 2) + ' кг/седм.' };
        }
        if (m.intake && planKcal) {
            var d = (m.intake.avg7 - planKcal) / planKcal;
            c.intake = { v: g === 'gain' ? curve(d, [[-0.3, 10], [-0.1, 60], [0, 100], [0.2, 85]]) : curve(Math.abs(d), [[0.05, 100], [0.1, 90], [0.2, 60], [0.35, 20]]), label: 'прием спрямо плана', text: m.intake.avg7 + ' / ' + planKcal + ' kcal' };
        }
        if (ck.calAdherence != null) c.calAdherence = { v: ck.calAdherence, label: 'калории по плана', text: ck.calAdherence + '%' };
        if (ck.mealAdherence != null) c.meals = { v: ck.mealAdherence, label: 'спазени хранения', text: ck.mealAdherence + '%' };
        if (ck.engagementPct != null) c.engagement = { v: ck.engagementPct, label: 'ангажираност', text: ck.engagementPct + '%' };
        if (m.composition && isFinite(m.composition.leanChangeKg)) c.lean = { v: curve(m.composition.leanChangeKg, [[-1, 5], [-0.5, 25], [0, 75], [0.3, 100]]), label: 'мускулна маса', text: signed(m.composition.leanChangeKg, 1) + ' кг' };
        if (m.workouts) c.workouts = { v: 100 * clamp01(m.workouts.perWeek / WORKOUT_TARGET[g]), label: 'тренировки', text: fmt(m.workouts.perWeek, 1) + ' седмично' };
        if (m.steps) c.steps = { v: 100 * clamp01(m.steps.avg7 / STEP_TARGET[g]), label: 'крачки', text: fmt(m.steps.avg7) + ' на ден' };
        else if (ck.actPct != null) c.steps = { v: ck.actPct, label: 'активност', text: ck.actPct + '%' };
        if (ck.balancePct != null) c.balance = { v: ck.balancePct, label: 'емоционален баланс', text: ck.balancePct + '%' };
        if (ck.junkCount != null) c.junk = { v: curve(ck.junkCount, [[0, 100], [2, 70], [4, 35], [6, 10]]), label: 'хранения извън плана', text: ck.junkCount + ' за 7 дни' };
        if (m.bp) c.bp = { v: curve(Math.max(m.bp.sys - 120, (m.bp.dia - 80) * 2), [[0, 100], [10, 70], [20, 35], [40, 0]]), label: 'кръвно', text: m.bp.sys + '/' + m.bp.dia };
        if (m.glucose && m.glucose.morning != null) c.glucose = { v: curve(m.glucose.morning, [[5, 100], [5.6, 70], [7, 25], [8, 5]]), label: 'захар сутрин', text: fmt(m.glucose.morning, 1) + ' mmol/L' };
        return c;
    }

    var INDEX_DEFS = {
        pace: { name: 'Темп към целта', icon: 'fa-flag-checkered', parts: { weight: 0.45, intake: 0.25, calAdherence: 0.15, meals: 0.15 } },
        muscle: { name: 'Мускулен баланс', icon: 'fa-dumbbell', parts: { lean: 0.4, workouts: 0.35, intake: 0.25 } },
        recovery: { name: 'Възстановяване', icon: 'fa-battery-three-quarters', parts: { sleep: 0.5, hrv: 0.25, rhr: 0.25 } },
        movement: { name: 'Движение', icon: 'fa-person-walking', parts: { steps: 0.6, workouts: 0.4 } },
        consistency: { name: 'Постоянство', icon: 'fa-calendar-check', parts: { meals: 0.6, engagement: 0.4 } },
        emotional: { name: 'Емоционален контрол', icon: 'fa-heart-pulse', parts: { balance: 0.5, junk: 0.5 } },
        metabolic: { name: 'Метаболитно здраве', icon: 'fa-stethoscope', parts: { bp: 0.35, glucose: 0.35, steps: 0.15, weight: 0.15 }, requireAny: ['bp', 'glucose'] }
    };

    var INDEX_ORDER = {
        lose: ['pace', 'consistency', 'emotional', 'movement', 'recovery', 'metabolic'],
        lose_soft: ['recovery', 'pace', 'consistency', 'emotional', 'movement', 'metabolic'],
        gain: ['muscle', 'pace', 'recovery', 'consistency', 'movement', 'emotional'],
        tone: ['muscle', 'movement', 'recovery', 'consistency', 'pace', 'emotional'],
        health: ['metabolic', 'recovery', 'movement', 'consistency', 'emotional', 'pace']
    };

    /**
     * Обединените индекси за целта: стойност 0–100, съставките и слабото звено.
     * Индекс се показва само с поне 2 съставки — една не е „индекс“.
     * @param {{ planKcal?: number, persona?: object }} [opts]
     */
    function indices(metrics, checks, userData, opts) {
        var o = opts || {};
        var p = profileOf(userData);
        var comp = components(metrics || {}, checks, p, o.planKcal);
        var order = INDEX_ORDER[p.group].slice();
        if (p.bp || p.glucose) { order.splice(order.indexOf('metabolic'), 1); order.unshift('metabolic'); }
        var focus = o.persona && o.persona.indexFocus;
        var list = order.map(function (id) {
            var def = INDEX_DEFS[id];
            var parts = Object.keys(def.parts).filter(function (k) { return comp[k]; });
            if (parts.length < 2) return null;
            if (def.requireAny && !def.requireAny.some(function (k) { return comp[k]; })) return null;
            var wsum = parts.reduce(function (s, k) { return s + def.parts[k]; }, 0);
            var value = Math.round(parts.reduce(function (s, k) { return s + comp[k].v * def.parts[k]; }, 0) / wsum);
            var weakest = parts.slice().sort(function (a, b) { return comp[a].v - comp[b].v; })[0];
            var tone = value >= 75 ? 'good' : value >= 50 ? 'warn' : 'bad';
            return {
                id: id, name: def.name, icon: def.icon, value: value, tone: tone,
                parts: parts.map(function (k) { return { key: k, label: comp[k].label, text: comp[k].text, value: Math.round(comp[k].v) }; }),
                note: comp[weakest].v < 70 ? 'Слабото звено: ' + comp[weakest].label + ' (' + comp[weakest].text + ').' : 'Всички съставки са добре.'
            };
        }).filter(Boolean);
        // Фокусът от персоната — веднага след водещия за целта (след отпадането на непълните).
        var fi = list.findIndex(function (x) { return x.id === focus; });
        if (fi > 1) list.splice(1, 0, list.splice(fi, 1)[0]);
        return list;
    }

    var api = {
        profileOf: profileOf,
        deviceOrder: deviceOrder,
        checkOrder: checkOrder,
        guideOrder: guideOrder,
        evaluate: evaluate,
        deviceView: deviceView,
        indices: indices,
        INDEX_DEFS: INDEX_DEFS,
        GROUP_LABEL: GROUP_LABEL
    };
    global.NutriPlanGoalFocus = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
