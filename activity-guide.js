/*
 * Движение и активност — насоките в „Насоки“ (guidelines.html, секция data-guide="activity").
 *
 * Правилата са тук, в кода — като останалите насоки: целите идват от goal-focus.js (същите крачки
 * и групи като в „Напредък“), съветите — от признатите препоръки:
 *  - СЗО 2020 (Bull et al., Br J Sports Med 2020): 150–300 мин умерено или 75–150 мин интензивно
 *    седмично + силови ≥ 2 дни; 65+ — и баланс ≥ 3 дни; всяко движение се брои, седенето се прекъсва.
 *  - ACSM (Garber 2011; Progression models 2009; Schoenfeld 2017): силови 2–3 серии × 8–12 повторения,
 *    1–3 повторения „в резерв“; за мускулна маса ≥ 10 серии на мускулна група седмично; прогресия.
 *  - ADA 2016 (Colberg et al.): ходене след хранене; при инсулин — глюкоза преди, бърза захар подръка.
 *  - AHA 2023 (изометрични упражнения при хипертония), ACOG 2020 (бременност, след раждане),
 *    Royal Osteoporosis Society 2019 (сила + удар, без натоварено сгъване напред).
 * Кратко, колкото другите секции: целите в един ред, 4 съвета (+ до 2 лични от AI — plan_voice →
 * plan.personalActivity) и предупрежденията само за състоянията на човека.
 */
(function (global) {
    'use strict';

    var GF = global.NutriPlanGoalFocus || (typeof require === 'function' ? require('./goal-focus.js') : null);

    function list(v) { return Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]); }
    function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
    function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

    /** Всичко, което клиентът е написал за здравето си — за разпознаване на състоянията. */
    function healthText(ud) {
        var parts = [];
        Object.keys(ud || {}).forEach(function (k) {
            if (/^(medicalConditions|healthConditions)/.test(k)) parts = parts.concat(list(ud[k]).map(String));
        });
        return parts.join(' ').toLowerCase();
    }

    var SPORT_DAYS = { 'Никаква': 0, 'Ниска': 1.5, 'Средна': 3, 'Висока': 6, 'Много висока': 6 };
    function sportDaysOf(label) {
        var s = String(label || '');
        for (var k in SPORT_DAYS) if (s.indexOf(k) === 0) return SPORT_DAYS[k];
        return 0;
    }

    /** Контекстът на човека за движението. */
    function contextOf(ud) {
        ud = ud || {};
        var p = GF ? GF.profileOf(ud) : { group: 'health', stepTarget: 8000, bp: false, glucose: false };
        var h = healthText(ud);
        var kg = num(ud.weight), cm = num(ud.height), age = num(ud.age);
        var bmi = kg && cm ? kg / Math.pow(cm / 100, 2) : null;
        var status = String(ud.postpartumStatus || '');
        var postpartum = ud.clinicalProtocol === 'postpartum_lactation' || /след бременност/.test(h);
        var types = list(ud.sportTypes).map(String);
        return {
            p: p,
            group: p.group,
            age: age,
            bmi: bmi,
            female: ud.gender === 'Жена',
            daily: /^Ниск/.test(String(ud.dailyActivityLevel || '')) ? 1 : /^Висок/.test(String(ud.dailyActivityLevel || '')) ? 3 : 2,
            sportDays: sportDaysOf(ud.sportActivity),
            minutes: String(ud.sportSessionMinutes || ''),
            strength: types.some(function (t) { return /^Силови/.test(t); }),
            cardio: types.some(function (t) { return /^(Кардио|Бързо ходене|Отборен|Бойни|Групови)/.test(t); }),
            mind: types.some(function (t) { return /^Йога/.test(t); }),
            hard: types.some(function (t) { return /^(Бойни|Групови|Отборен)/.test(t); }),
            pregnant: postpartum && /^Бременна/.test(status),
            lactating: postpartum && /^Кърмя/.test(status),
            postpartum: postpartum && !/^Бременна/.test(status),
            bp: p.bp || /хипертон|кръвно/.test(h),
            glucose: p.glucose || /диабет|инсулин|спкя|поликист/.test(h),
            insulin: /инсулин(ова)? терапия|на инсулин|инжекц|тип 1|1 тип/.test(h),
            // Сърцето — по конкретното състояние; само „Сърдечно-съдови“ с хипертония не е сърдечно заболяване.
            heart: /сърдечна недостат|сърце|аритми|предсърдно|инфаркт|стенокард|исхеми|атероскл|коронар|клап|стент|байпас|друго сърдечно/.test(h) ||
                (/сърдечно-съдов/.test(h) && !/хипертон|кръвно|варикоз/.test(h)),
            osteo: /остеопор|остеопен/.test(h),
            joints: /став|артр|артроз|колян|гръб|кръст|дискова|херни|ревмат|фибромиалг|мускулно-скелет|подагр/.test(h),
            anemia: /анеми|желязо/.test(h),
            reflux: /рефлукс|киселин/.test(h),
            sleep: /сън|безсъни/.test(h) || num(ud.sleepHours) != null && num(ud.sleepHours) < 6,
            mood: /депрес|тревож/.test(h) || p.stress,
            meno: /менопауз/.test(h),
            autoimmune: /автоимун|хашимото|щитовид/.test(h)
        };
    }

    /** Целите за седмицата — кратки етикети за реда отгоре (крачките — същите като в „Напредък“). */
    function targetsOf(c) {
        var g = c.group;
        var strength = c.pregnant ? null : g === 'gain' ? '3–4' : g === 'tone' ? '3' : g === 'lose' ? '2–3' : g === 'lose_soft' ? '1–2' : '2';
        var t = [fmt(c.p.stepTarget || 8000) + ' крачки на ден'];
        if (strength) t.push(strength + ' силови седмично');
        t.push((g === 'lose' ? '150–300' : g === 'gain' ? '90–150' : '150') + ' мин умерено движение седмично');
        if (c.age != null && c.age >= 65) t.push('баланс 3 дни седмично');
        return t;
    }

    /** Защо — едно изречение по целта. */
    var FOCUS = {
        lose: 'Основата е ходенето всеки ден. Упражненията за сила пазят мускулите, докато сваляш килограми.',
        lose_soft: 'Сега е важно възстановяването: разходка всеки ден и упражнения за тазовото дъно, силата — постепенно.',
        gain: 'Мускулите растат от упражненията с тежест, когато я увеличаваш постепенно. Кардиото остава леко.',
        tone: 'Стегнатото тяло идва от упражнения за сила за цялото тяло, а ходенето сваля мазнините отгоре.',
        health: 'По-важно е да се движиш малко всеки ден, отколкото рядко и до изтощение.'
    };

    /** Откъде да започне — едно изречение според това, което прави сега. */
    function startOf(c) {
        if (c.pregnant) return 'Ходене или плуване в повечето дни, с темпо, при което можеш да говориш, и леки упражнения с ластик.';
        if (c.postpartum) return 'Разходка всеки ден и тазово дъно; упражнения за сила — след прегледа при лекаря, бягане и коремни — по-късно.';
        if (c.sportDays === 0) return 'Започни с 20–30 минути ходене в 5 дни и 2 кратки тренировки у дома; добавяй по малко всяка седмица.';
        if (!c.strength) return (c.mind ? 'Йогата е добра основа — ' : 'Към това, което правиш, ') + 'добави 2 тренировки за сила седмично.';
        if (c.group === 'gain') return 'Тренирай всяка част на тялото 2 пъти седмично. Тежестта е правилна, когато последните 1–2 повторения са трудни.';
        if (!c.cardio) return 'Към силовите добави 2 пъти седмично по 20–30 минути бързо ходене, колело или плуване.';
        if (c.sportDays >= 5) return 'При 5 и повече тренировки — поне един лек ден или пълна почивка седмично.';
        return 'Тренировките ти покриват основното — пази редовността и увеличавай натоварването постепенно.';
    }

    /** Как — едно практично правило. */
    function howOf(c) {
        if (c.pregnant) return 'Избягвай дълго лежане по гръб след първия триместър, падания и контактни спортове.';
        return 'Упражнения за сила: клекове, напади, лицеви опори (може от стена или маса), вдигане на таза от пода и планк — по 2–3 серии от 8–12 повторения.';
    }

    /** Ежедневното движение — универсални навици, по целта и заетостта. */
    function dailyOf(c) {
        if (c.glucose) return 'След хранене — 10–15 минути спокойно ходене или 10 изправяния от стола преди хранене: помагат на кръвната захар.';
        if (c.daily === 1) return 'Ставай от стола поне веднъж на час за 2–3 минути и избирай стълбите вместо асансьора.';
        if (c.group === 'lose' || c.group === 'health') return 'По-дълга спокойна разходка сутрин или след вечеря — гори мазнини, без да усилва глада.';
        return '10–15 минути ходене след основните хранения — най-лесните крачки за деня.';
    }

    /** Внимание — само за състоянията на човека (до 2), после кратките сигнали за спиране. */
    function safetyOf(c) {
        var out = [];
        if (c.pregnant) out.push('Спри и се обади на лекаря при кървене, контракции, изтичане на течност или замайване.');
        if (c.postpartum) out.push('Тежест в таза, изпускане на урина или издуване по средата на корема — сигнал да намалиш.');
        if (c.heart) out.push('Натоварването се съгласува с кардиолога; без резки максимални усилия.');
        if (c.insulin) out.push('На инсулин: глюкоза преди тренировка и бърза захар подръка.');
        if (c.bp) out.push('Кръвно: издишвай при усилието, без задържане на дъха и без максимални тежести.');
        if (c.osteo) out.push('Кости: без сгъване напред с тежест и рязко усукване на гърба.');
        if (c.joints) out.push('Стави и гръб: движения без удар — плуване, колело, ходене; остра болка — спри.');
        if (c.bmi != null && c.bmi >= 35 && !c.joints) out.push('Започни без удар (ходене, колело, вода) и с кратки отрязъци по 10 мин.');
        if (c.reflux) out.push('Рефлукс: тренирай поне 2 часа след хранене.');
        if (c.anemia) out.push('Докато желязото се възстановява — умерено натоварване.');
        if (c.lactating) out.push('Кърми преди тренировка и пий повече вода.');
        out = out.slice(0, 2);
        out.push('Спри при болка в гърдите, силен задух или замайване.');
        return out;
    }

    /**
     * Насоките за движение — кратко, колкото другите секции в „Насоки“.
     * @param {object} userData  отговорите от въпросника (localStorage userData)
     * @param {object} [plan]    планът (личните съвети от AI — plan.personalActivity)
     * @returns {{ v: 1, group: string, targets: string[], items: string[], cautions: string[], clearance: boolean }}
     */
    function build(userData, plan) {
        var c = contextOf(userData);
        var personal = list(plan && plan.personalActivity).map(String).filter(Boolean).slice(0, 2);
        var items = personal.concat([FOCUS[c.group] || FOCUS.health, startOf(c), howOf(c), dailyOf(c)]);
        return { v: 1, group: c.group, targets: targetsOf(c), items: items, cautions: safetyOf(c), clearance: c.pregnant || c.heart || c.insulin };
    }

    var api = { build: build, contextOf: contextOf };
    global.NutriPlanActivityGuide = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
