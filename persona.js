/**
 * Персона: как приложението да се държи с конкретния клиент.
 *
 * Сглобява се на устройството от всичко, което вече знаем:
 *  - въпросника (цел, стрес, сън, навици, преяждане);
 *  - EmoEat (архетип, интензитет, двигатели) — кога и защо идва гладът без глад;
 *  - устройствата (сън, възстановяване, движение);
 *  - поведението в приложението (колко редовно отмята, кога, отговаря ли на въпросите).
 *
 * Резултатът насочва (само правила, без AI):
 *  - тона на текстовете и на нотификациите;
 *  - кои въпроси за храненията се задават (всички / основните / нито един);
 *  - рисковия час и подкрепата в него (SOS картата в плана и едно напомняне);
 *  - плътността на анализа (кратко / подробно), оценките (звезди, червено) и кой
 *    обединен индекс води.
 * Записва се в localStorage „np_persona“ и се смята наново при всяко отваряне.
 */
(function (global) {
    'use strict';

    var DAY_MS = 86400000;

    /** EmoEat архетип → поведение на приложението. Часовете са от плана на архетипа в EmoEat. */
    var ARCHETYPES = {
        'Утехата': {
            tone: 'warm', risk: ['19:00', '22:00'], indexFocus: 'emotional',
            focus: 'Вечерта да има друг източник на топлина, освен храната.',
            sos: ['Изчакай 10 минути — импулсът спада сам', 'Напиши на някого две изречения как си', 'Ако още искаш — яж седнал/а, от чиния, без екран'],
            nudge: 'Вечерта е тук. Ако ти липсва някой — първо едно съобщение, после храна.'
        },
        'Редът': {
            tone: 'gentle', noScores: true, flexible: true, mealChecks: 'main', risk: ['20:00', '23:00'], indexFocus: 'consistency',
            focus: 'По-малко забрани, повече редовност.',
            sos: ['Не компенсирай — следващото хранене е обичайното', 'Запиши какво се случи точно преди импулса', 'Излез навън за 5 минути'],
            nudge: 'Едно отклонение не разваля деня. Следващото хранене е обичайното.'
        },
        'Махалото': {
            tone: 'gentle', noScores: true, flexible: true, risk: ['20:00', '23:00'], indexFocus: 'consistency',
            focus: 'Да спре люлеенето — без нови забрани.',
            sos: ['Пусни таймер за 10 минути', 'Сложи порция в чиния, пакета — обратно', 'Яж бавно, седнал/а, без екран'],
            nudge: 'Ако вечерта дръпне към сладко — порция в чиния, седнал/а. Без „от утре“.'
        },
        'Паузата': {
            tone: 'direct', risk: ['15:00', '19:00'], indexFocus: 'emotional',
            focus: 'Друг бутон за пауза, който действа бързо.',
            sos: ['Издишай бавно 6 пъти — по-дълго от вдишването', 'Смени стаята или излез навън', 'Студена вода по лицето и китките'],
            nudge: 'Напрегнат следобед? 6 бавни издишвания или 10 минути ходене свалят напрежението бързо.'
        },
        'Строгият глас': {
            tone: 'gentle', noScores: true, flexible: true, risk: ['20:00', '22:30'], indexFocus: 'emotional',
            focus: 'Да си говориш като на приятел.',
            sos: ['Спри присъдата: „това е едно хранене, не съм аз“', 'Пийни вода и излез за 5 минути', 'Следващото хранене — обичайното, без наказание'],
            nudge: 'Каквото и да е било днес — утре е обичаен ден, без компенсиране.'
        },
        'Искрата': {
            tone: 'playful', risk: ['15:00', '18:00'], indexFocus: 'recovery',
            focus: 'Повече искри през деня, повече сън през нощта.',
            sos: ['Питай се: гладен/на ли съм, или ми е скучно и уморено?', '3 минути движение — стълби или клякания', 'Ако е глад — яж нещо истинско, седнал/а'],
            nudge: 'Следобедният спад идва. Закуска с белтък сега — преди глада, не след него.'
        }
    };

    function read(key) {
        try { return JSON.parse(global.localStorage.getItem(key) || 'null'); } catch (_) { return null; }
    }

    function hhmm(t) {
        var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    }

    /** Поведението в приложението за последните 14 дни (gameData). */
    function behaviorOf(gameData, now) {
        var g = gameData || {};
        var from = now.getTime() - 14 * DAY_MS;
        var days = Object.keys(g).filter(function (k) { return Date.parse(k) >= from && Date.parse(k) < now.getTime(); });
        var planned = 0, ticked = 0, answered = 0, extraEvening = 0, extra = 0;
        days.forEach(function (k) {
            var r = g[k] || {};
            var meals = r.meals || {};
            Object.keys(meals).forEach(function (mk) { planned++; if (meals[mk] === true) ticked++; });
            if (r.morningCheck || r.eveningCheck) answered++;
            (r.extraMeals || []).forEach(function (e) {
                extra++;
                var h = e && e.time ? Number(String(e.time).slice(0, 2)) : (e && e.ts ? new Date(e.ts).getHours() : null);
                if (h != null && h >= 19) extraEvening++;
            });
        });
        return {
            days: days.length,
            mealTickRate: planned ? Math.round(ticked / planned * 100) : null,
            checkinRate: days.length ? Math.round(answered / days.length * 100) : null,
            extraMeals: extra,
            eveningExtraShare: extra ? extraEvening / extra : null
        };
    }

    /**
     * @param {{ userData?: object, emoeat?: object, metrics?: object, gameData?: object, now?: Date }} input
     */
    function build(input) {
        var inp = input || {};
        var ud = inp.userData || {};
        var emo = inp.emoeat || null;
        var now = inp.now || new Date();
        var beh = behaviorOf(inp.gameData, now);
        var arch = emo && emo.archetype ? ARCHETYPES[emo.archetype] : null;
        var emotional = !!(arch && /Осезаемо|Силно/.test(String(emo.intensity || '')));
        var stressHigh = /високо|много/i.test(String(ud.stressLevel || ''));
        var bingeOften = /често|винаги|почти всеки/i.test(String(ud.overeatingFrequency || ''));

        var p = {
            at: now.toISOString(),
            archetype: emo && emo.archetype ? emo.archetype : null,
            emotional: emotional,
            tone: arch ? arch.tone : (stressHigh ? 'warm' : 'direct'),
            noScores: !!(arch && arch.noScores),
            flexible: !!(arch && arch.flexible) || bingeOften,
            mealChecks: (arch && arch.mealChecks) || 'all',
            density: 'detailed',
            indexFocus: arch ? arch.indexFocus : (stressHigh || bingeOften ? 'emotional' : null),
            riskWindow: null,
            sos: arch ? arch.sos : null,
            focus: arch ? arch.focus : null,
            nudge: null,
            behavior: beh,
            reasons: []
        };
        if (p.archetype) p.reasons.push('емоционален профил: ' + p.archetype + (emo.intensity ? ' (' + String(emo.intensity).toLowerCase() + ')' : ''));
        if (stressHigh) p.reasons.push('висок стрес по въпросника');

        // Рисковият час — само при осезаемо емоционално хранене; вечерните хранения
        // извън плана го потвърждават или го местят към вечерта.
        if (emotional) {
            p.riskWindow = { from: hhmm(arch.risk[0]), to: hhmm(arch.risk[1]) };
            if (beh.eveningExtraShare != null && beh.extraMeals >= 3 && beh.eveningExtraShare >= 0.6 && p.riskWindow.from < 19 * 60) {
                p.riskWindow = { from: 19 * 60, to: 22 * 60 };
                p.reasons.push('храненията извън плана са предимно вечер');
            }
            p.nudge = { minute: p.riskWindow.from + 30, title: 'Малко напомняне', body: arch.nudge };
        }

        // Поведение: при слабо отмятане — по-малко въпроси и по-кратък анализ.
        if (beh.days >= 5 && beh.mealTickRate != null && beh.mealTickRate < 35) {
            if (p.mealChecks === 'all') p.mealChecks = 'main';
            p.density = 'minimal';
            p.reasons.push('рядко отмятане — по-малко въпроси, по-кратък анализ');
        }
        if (p.noScores) p.density = 'minimal';

        // Ръчен избор на клиента има предимство.
        var override = read('np_persona_override') || {};
        if (override.mealChecks) p.mealChecks = override.mealChecks;
        if (override.density) p.density = override.density;
        return p;
    }

    /** Текстовете на въпроса след хранене — по тона. */
    function mealQuestion(persona, label) {
        var tone = persona && persona.tone;
        if (tone === 'gentle' || tone === 'warm') return { title: 'Как мина ' + label + '?', yes: 'Изядох го', no: 'Не този път' };
        if (tone === 'playful') return { title: label.charAt(0).toUpperCase() + label.slice(1) + ' — отметнато ли е?', yes: 'Готово ✓', no: 'Не днес' };
        return { title: 'Изядохте ли ' + label + '?', yes: 'Да, изядох', no: 'Пропуснах' };
    }

    /** В рисковия час ли сме (за SOS картата). */
    function inRiskWindow(persona, date) {
        var w = persona && persona.riskWindow;
        if (!w) return false;
        var d = date || new Date();
        var m = d.getHours() * 60 + d.getMinutes();
        return m >= w.from - 30 && m <= w.to;
    }

    /** Смята и записва персоната от данните в localStorage. */
    function refresh() {
        var re = read('np_reanalysis') || {};
        var src = read('np_goal_focus_src') || {};
        var persona = build({
            userData: read('userData') || {},
            emoeat: re.emoeat || null,
            metrics: src.metrics || (re.devices && re.devices.metrics) || null,
            gameData: read('gameData') || {}
        });
        try { global.localStorage.setItem('np_persona', JSON.stringify(persona)); } catch (_) {}
        return persona;
    }

    function current() {
        return read('np_persona') || refresh();
    }

    function describe(persona) {
        var p = persona || current();
        var tone = { warm: 'топъл и подкрепящ', gentle: 'мек, без оценки', direct: 'кратък и по същество', playful: 'лек, с малки предизвикателства' }[p.tone] || 'кратък';
        var checks = { all: 'след всяко хранене', main: 'само за обяда и вечерята', off: 'изключени' }[p.mealChecks];
        var out = ['Тон: ' + tone + '.', 'Въпроси за храненията: ' + checks + '.'];
        if (p.riskWindow) {
            var f = function (m) { return Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2); };
            out.push('Подкрепа в рисковия час: ' + f(p.riskWindow.from) + '–' + f(p.riskWindow.to) + '.');
        }
        out.push('Анализ: ' + (p.density === 'minimal' ? 'само най-важното' : 'подробен') + '.');
        return out;
    }

    var api = { build: build, refresh: refresh, current: current, describe: describe, mealQuestion: mealQuestion, inRiskWindow: inRiskWindow, ARCHETYPES: ARCHETYPES, behaviorOf: behaviorOf };
    global.NutriPlanPersona = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
