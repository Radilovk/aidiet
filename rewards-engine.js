/**
 * Награди за постоянство — едно ядро за телефона (rewards-ui.js) и сървъра (rewards.js).
 *
 * Всичко се смята наново от историята на дните (gameData) — без брояч, който да се разминава
 * между устройствата: стъпалата, жокерите, поредицата, рекордите, точките и етапите.
 * Ангажираността на деня е engPct от calcDayScore (game-scoring.js на телефона,
 * analytics-compression.js на сървъра — едни и същи формули, test:analytics-parity).
 *
 * Правила (психологията — в PROJECT_NOTES.md, „Награди“):
 *  - добър ден: ангажираност ≥ 60%; поредица = поредни добри дни (пропуск, покрит от жокер, не я къса);
 *  - жокер: 1 на всеки 14 добри дни, най-много 2; пази поредицата в минал ден под прага — със слаб запис
 *    или без никакъв (иначе честно отбелязаният слаб ден би бил по-лош от неотбелязания);
 *  - стъпало: средната ангажираност за последните N дни ≥ прага (дните без отметки — 0, с жокер — не се броят);
 *    достигнатото се пази; ако 14 поредни дни е под него — слиза с едно (предупреждение през тези дни);
 *  - точки: 10 за добър ден, +5 при ≥ 80%, +5 при крачки на целта (до 20 на ден) + бонуси за етапи;
 *  - отслабване: етапи 3/5/7/10% от началното тегло; при сваляне над 1% на седмица — без поздрав;
 *  - седмицата (Пн–Нд) за неделния преглед; месечното предизвикателство (по избор, 10 дни от приемането);
 *  - влизанията в приложението (openStats) — за часа на напомнянията и „добре дошъл обратно“.
 *
 *   RewardsEngine.compute({ gameData, calcDayScore, todayKey, weightLog?, startKg?, goalDirection? })
 */
(function (global) {
    'use strict';

    var DAY = 86400000;
    var GOOD = 60;            // добър ден, %
    var GREAT = 80;
    var SHIELD_EVERY = 14;    // добри дни за един жокер
    var SHIELD_MAX = 2;
    var GRACE_DAYS = 14;      // дни под стъпалото преди слизане
    var DAY_POINTS_MAX = 20;

    // Нивата на постоянството — качества, не етапи — и наградата при първото достигане.
    // kind: supplement — добавки (само за България), plan — план в сайта. Кодът = word + процент
    // (GRIT10): кратък, на латиница, еднакъв за всички, но важи само за спечелилия го (rewards.js).
    // Текстовете, думите на кодовете и снимките се сменят от админ панела (applyContent).
    var TIERS = [
        { id: 'start', title: 'Упоритост', days: 14, minEng: 60, bonus: 100, image: 'persist', word: 'BOLD', rewards: [{ kind: 'supplement', pct: 5 }],
          moment: 'Показа упоритост', text: '14 дни избираш плана си отново и отново — и в лесните, и в трудните дни.', share: 'Избирам себе си — ден след ден.' },
        { id: 'steady', title: 'Постоянство', days: 30, minEng: 70, bonus: 200, image: 'consistency', word: 'GRIT', rewards: [{ kind: 'supplement', pct: 10 }],
          moment: 'Създаде постоянство', text: '30 дни. Това вече не е опит, а твоят ритъм.', share: 'Създадох постоянство.' },
        { id: 'habit', title: 'Воля', days: 60, minEng: 75, bonus: 300, image: 'resolve', word: 'FLOW', rewards: [{ kind: 'supplement', pct: 15 }, { kind: 'plan', pct: 10 }],
          moment: 'Волята ти удържа', text: '60 дни, в които думата, дадена на себе си, удържа.', share: 'Дадох си дума — и я удържах.' },
        { id: 'lifestyle', title: 'Вътрешна сила', days: 90, minEng: 80, bonus: 500, image: 'inner', word: 'CORE', rewards: [{ kind: 'supplement', pct: 20 }, { kind: 'plan', pct: 20 }],
          moment: 'Промяната вече е отвътре', text: '90 дни постоянство. Вече не те води мотивацията, а това, което изгради.', share: 'Промяната вече е отвътре.' }
    ];

    // Поредица от добри дни: бонус точки и момент. 66 дни — медианата до автоматичен навик (Lally 2010).
    var STREAKS = [
        { days: 7, bonus: 30, big: false, moment: 'Седмица без прекъсване', text: 'Ритъмът се ражда. Продължавай в същия дух.', share: 'Ритъмът се ражда.' },
        { days: 21, bonus: 70, big: true, moment: 'Показа устойчивост', text: '21 дни поред — и в дните, в които беше трудно.', share: 'Показах устойчивост.' },
        { days: 66, bonus: 200, big: true, habit: true, moment: 'Създаде нов навик', text: 'Това вече не е усилие, а част от теб.', share: 'Създадох нов навик.' },
        { days: 100, bonus: 300, big: true, moment: '100 дни упоритост', text: 'Сто дни, в които избра себе си.', share: 'Сто дни, в които избрах себе си.' }
    ];

    var WEIGHT_STEPS = [3, 5, 7, 10];
    var WEIGHT_BIG = { 5: true, 10: true };

    // Точки → отстъпка. Партньорските оферти се добавят тук (kind: 'partner', partner: '<id>').
    var OFFERS = [
        { id: 'plan10', kind: 'plan', pct: 10, cost: 1500, title: '−10% за план', word: 'WIN' },
        { id: 'supp10', kind: 'supplement', pct: 10, cost: 1000, title: '−10% за добавки', word: 'WIN', region: 'BG' }
    ];
    // Думите на другите кодове: благодарност за покана (ALLY20) и личният код за покана (DUO + 3 цифри).
    var WORDS = { thanks: 'ALLY', invite: ['DUO', 'PAL'] };

    /** Кодът: дума + процент — WIN10, GRIT10, CORE20. */
    function codeFor(word, pct) { return String(word || 'WIN').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) + pct; }
    /** Въведеното → кода: латиница, без интервали и тирета („grit 10“ → GRIT10). */
    function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10); }

    // Текстовете на картата и поздравите. {n}, {title}… се попълват. Сменят се от админ панела.
    var TEXTS = {
        section: 'Пътят към успеха',
        empty: 'Всеки отметнат ден е стъпка. От първия започва пътят ти.',
        levelLabel: 'Ниво', firstLevel: 'Начало',
        towards: 'Още {n} {daysWord} до „{title}“',
        top: 'Най-високото ниво. Пазиш го с всеки ден.',
        behind: 'Към „{title}“: {avg}% от {min}%',
        warn: 'Още {n} {daysWord} под прага и нивото слиза. Един добър ден връща отброяването.',
        comparison: 'Постоянството ти е по-високо от това на {p}% от хората в Nutriin.',
        newLevel: 'Ново ниво', giftReady: '— кодът те чака в Напредък',
        shield: 'Спечели жокер: един слаб или пропуснат ден няма да прекъсне поредицата ти.',
        weightLose: 'По-леко с {pct}%. Заслужено.', weightGain: 'С {pct}% по-близо до целта',
        weightText: 'С ежедневни решения, не с крайности.',
        weightShareLose: 'По-леко. Отвътре навън.', weightShareGain: 'По-близо до целта. Ден след ден.',
        codesTitle: 'Твоите отстъпки', codesEmpty: 'Първата идва с „Упоритост“.',
        pointsTitle: 'Точки за отстъпка',
        pathTitle: 'Нивата',
        inviteTitle: 'Покани приятел',
        inviteText: 'Приятелят: −{pct}% за първия план. Ти: −{reward}% и 300 точки.',
        inviteTextApp: 'Приятелят: подарък за начало. Ти: награда и 300 точки.',
        inviteShare: 'Ела с мен — храненето, видяно отвътре',
        redeemTitle: 'Заслужено. Отстъпката е твоя.',
        shareTagline: 'Започва отвътре. Личи навън.',
        shareInvite: 'Код {code} → −15% за първия план',
        weekTitle: 'Твоята седмица',
        weekGood: '{good} от 7 добри дни',
        weekUp: 'С {d}% по-силна от миналата седмица.',
        weekSame: 'Ритъмът от миналата седмица се държи.',
        weekDown: 'По-тиха седмица от миналата. Новата започва в понеделник — на чисто.',
        weekBest: 'Най-силният ти ден: {day} ({eng}%).',
        weekNotifyTitle: 'Твоята седмица е готова',
        weekNotifyBody: 'Виж какво изгради за 7 дни — и откъде продължаваш.',
        challengeTitle: 'Предизвикателството на месеца',
        challengeJoin: 'Приемам',
        challengeJoined: 'Прие го. Брои се от днес — всеки ден, в който успееш.',
        challengeLate: 'За този месец остават по-малко от {target} дни. Новото предизвикателство идва на 1-во число.',
        challengeBehind: 'Още {n} до целта, остават {left} дни — всеки от тях е шанс.',
        challengeDone: 'Изпълни предизвикателството на месеца',
        challengeDoneText: '+{bonus} точки. Новият месец носи ново.',
        challengeNotifyBody: 'Още {n} до „{title}“ — днес може да е един от тях.',
        newMonthNotifyTitle: 'Нов месец — ново начало',
        newMonthNotifyBody: 'Предизвикателството на месеца те чака: „{title}“.',
        comeback: 'Радваме се, че си тук. Днес е добър ден за ново начало.',
        inviteLandingTitle: 'Покана от приятел',
        inviteLandingText: '−{pct}% за първия ти план. Отстъпката се прилага сама при плащането.'
    };
    function text(key, vars) {
        var t = TEXTS[key] == null ? '' : String(TEXTS[key]);
        return t.replace(/\{(\w+)\}/g, function (_, k) { return vars && vars[k] != null ? vars[k] : ''; });
    }

    // Снимките по теми: снимка от админ панела (адрес) или brand/rewards/<тема>.webp.
    var IMAGES = {};
    var THEMES = ['resolve', 'persist', 'consistency', 'inner', 'habit', 'streak', 'weight', 'invite', 'share'];

    /**
     * Промените от админ панела (KV rewards_content) върху стойностите по подразбиране.
     * { tiers: { id: { title, moment, text, share, word, image } }, streaks: { дни: { moment, text, share } },
     *   challenges: { id: { title, text } }, texts: { ключ: текст }, images: { тема: адрес }, words: { offer, thanks } }
     */
    var DEFAULTS = null;
    function applyContent(c) {
        if (!DEFAULTS) DEFAULTS = JSON.stringify({ t: TIERS, s: STREAKS, o: OFFERS, x: TEXTS, w: WORDS, c: CHALLENGES });
        var d = JSON.parse(DEFAULTS);
        var str = function (v, n) { return typeof v === 'string' && v.trim() ? v.trim().slice(0, n || 400) : null; };
        TIERS.forEach(function (t, i) {
            ['title', 'moment', 'text', 'share', 'word', 'image'].forEach(function (k) { t[k] = d.t[i][k]; });
            var o = c && c.tiers && c.tiers[t.id] || {};
            ['title', 'moment', 'text', 'share', 'image'].forEach(function (k) { if (str(o[k])) t[k] = str(o[k]); });
            if (str(o.word)) t.word = o.word.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || t.word;
        });
        STREAKS.forEach(function (s, i) {
            ['moment', 'text', 'share'].forEach(function (k) { s[k] = d.s[i][k]; });
            var o = c && c.streaks && c.streaks[s.days] || {};
            ['moment', 'text', 'share'].forEach(function (k) { if (str(o[k])) s[k] = str(o[k]); });
        });
        CHALLENGES.forEach(function (ch, i) {
            ch.title = d.c[i].title; ch.text = d.c[i].text;
            var o = c && c.challenges && c.challenges[ch.id] || {};
            if (str(o.title)) ch.title = str(o.title);
            if (str(o.text)) ch.text = str(o.text);
        });
        var ow = c && c.words && str(c.words.offer);
        OFFERS.forEach(function (o, i) { o.word = ow ? ow.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || d.o[i].word : d.o[i].word; });
        WORDS.thanks = c && c.words && str(c.words.thanks) ? c.words.thanks.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || d.w.thanks : d.w.thanks;
        Object.keys(TEXTS).forEach(function (k) { TEXTS[k] = d.x[k]; });
        Object.keys((c && c.texts) || {}).forEach(function (k) { if (k in TEXTS && str(c.texts[k], 600)) TEXTS[k] = str(c.texts[k], 600); });
        Object.keys(IMAGES).forEach(function (k) { delete IMAGES[k]; });
        Object.keys((c && c.images) || {}).forEach(function (k) {
            var u = c.images[k];
            if (THEMES.indexOf(k) >= 0 && typeof u === 'string' && /^(https:\/\/|\.\/brand\/)/.test(u)) IMAGES[k] = u;
        });
    }
    function imageFor(theme) { return IMAGES[theme] || './brand/rewards/' + theme + '.webp'; }

    // ── Месечното предизвикателство ───────────────────────────────────────
    // Едно на месец, еднакво за всички (по реда на месеца), по избор. Брои се от деня на приемане —
    // всеки месец е ново начало (fresh start, Dai и колеги 2014). Дни, не поредица: пропуск не нулира.
    var CHALLENGE_TARGET = 10;
    var CHALLENGE_BONUS = 150;
    var CHALLENGES = [
        { id: 'good', title: '10 добри дни', text: 'Десет дни този месец със спазен план над 60%. Не е нужно да са поред.' },
        { id: 'steps', title: '10 дни с крачки на целта', text: 'Десет дни този месец, в които стигаш дневната си цел за крачки.', needsSteps: true },
        { id: 'evening', title: '10 вечери за себе си', text: 'Десет вечери, в които отговаряш на вечерния въпрос — вода, движение, усещане.' },
        { id: 'great', title: '10 силни дни', text: 'Десет дни над 80% — дни, в които планът е изцяло твой.' },
        { id: 'morning', title: '10 добри утрини', text: 'Десет сутрини, в които започваш деня с отговор как е минала нощта.' }
    ];
    var CHALLENGE_TEST = {
        good: function (d) { return d.eng != null && d.eng >= GOOD; },
        steps: function (d) { return d.onTarget; },
        evening: function (d) { return d.eve; },
        great: function (d) { return d.eng != null && d.eng >= GREAT; },
        morning: function (d) { return d.morn; }
    };

    function monthOf(key) { return String(key).slice(0, 7); }
    function daysInMonth(month) { var p = month.split('-'); return new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate(); }

    /** Предизвикателството на месеца; „крачки“ — само при измерени крачки през последните 14 дни. */
    function challengeFor(month, hasSteps) {
        var p = month.split('-');
        var c = CHALLENGES[((+p[0]) * 12 + (+p[1])) % CHALLENGES.length];
        return c.needsSteps && !hasSteps ? CHALLENGES[0] : c;
    }

    /** Седмицата Пн–Нд: в неделя — текущата (днес влиза), в другите дни — завършилата миналата неделя. */
    function weekEndKey(todayKey) {
        var dow = new Date(keyToMs(todayKey)).getUTCDay();
        return msToKey(keyToMs(todayKey) - (dow === 0 ? 0 : dow) * DAY);
    }

    /**
     * Влизанията в приложението (np_opens): { days: { ден: брой }, hours: [24], last, prev }.
     * → колко дни от последните 14 е отварял, обичайния час, обичайния вечерен час и паузата преди последното.
     */
    function openStats(opens, todayKey) {
        var o = opens || {};
        var end = keyToMs(todayKey || localKey(new Date()));
        var days14 = 0;
        Object.keys(o.days || {}).forEach(function (k) { if (isKey(k) && end - keyToMs(k) < 14 * DAY && keyToMs(k) <= end) days14++; });
        var h = Array.isArray(o.hours) && o.hours.length === 24 ? o.hours : null;
        var usual = null, evening = null, best = 0, bestEve = 0;
        if (h) for (var i = 0; i < 24; i++) {
            if (h[i] > best) { best = h[i]; usual = i; }
            if (i >= 17 && i <= 22 && h[i] > bestEve) { bestEve = h[i]; evening = i; }
        }
        var gap = o.last && o.prev ? Math.floor((o.last - o.prev) / DAY) : null;
        return { days14: days14, usualHour: usual, eveningHour: evening, gapDays: gap };
    }

    // Само проверени факти — показват се, когато сравнение с потребителите още няма.
    var FACTS = {
        habit: 'В изследване на University College London (Lally и колеги, 2010) един нов навик става автоматичен средно за 66 дни — и един пропуснат ден не го разваля.',
        weight5: 'Около 5% по-малко тегло вече подобрява чувствителността към инсулина, кръвното и мазнините в кръвта (Magkos и колеги, Cell Metabolism, 2016).',
        weight7: 'В голямото изследване DPP (NEJM, 2002) 7% по-малко тегло и 150 минути движение седмично намаляват риска от диабет тип 2 с 58%.',
        steps: 'Голям анализ на 15 изследвания (Paluch и колеги, Lancet Public Health, 2022): повече крачки на ден — по-нисък риск, до около 8–10 хиляди при възрастните под 60 г.',
        consistency: 'В обзор на 22 изследвания (Burke и колеги, 2011) редовното записване на храненето неизменно върви с по-добрия резултат.'
    };

    function zp(n) { return n < 10 ? '0' + n : '' + n; }
    function keyToMs(k) { var p = String(k).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function msToKey(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + zp(d.getUTCMonth() + 1) + '-' + zp(d.getUTCDate()); }
    function localKey(d) { return d.getFullYear() + '-' + zp(d.getMonth() + 1) + '-' + zp(d.getDate()); }
    function isKey(k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); }

    function stepsOnTarget(rec) {
        var ec = rec && rec.eveningCheck;
        return !!(ec && ec.equivSteps > 0 && ec.stepTarget > 0 && ec.equivSteps >= ec.stepTarget);
    }

    /** Дните от първия запис до днес: [{ key, eng|null, steps, onTarget }]. */
    function timeline(gameData, calcDayScore, todayKey) {
        var keys = Object.keys(gameData || {}).filter(function (k) { return isKey(k) && k <= todayKey; }).sort();
        if (!keys.length) return [];
        var out = [];
        for (var ms = keyToMs(keys[0]), end = keyToMs(todayKey); ms <= end; ms += DAY) {
            var k = msToKey(ms);
            var rec = gameData[k];
            var eng = null;
            if (rec) {
                try { eng = calcDayScore(rec, todayKey).engPct; } catch (_) { eng = null; }
                if (!(eng > 0)) eng = 0;
            }
            var ec = rec && rec.eveningCheck;
            var mc = rec && rec.morningCheck;
            out.push({
                key: k, shielded: false, rec: !!rec, eng: eng, steps: ec && ec.steps > 0 ? ec.steps : 0, onTarget: stepsOnTarget(rec),
                eve: !!(ec && (ec.activityLevel != null || ec.emotionalBalance != null || ec.waterIntake != null)),
                morn: !!(mc && typeof mc.sleptWell === 'boolean')
            });
        }
        return out;
    }

    function dayPoints(d) {
        if (d.eng == null || d.eng < GOOD) return 0;
        var p = 10 + (d.eng >= GREAT ? 5 : 0) + (d.onTarget ? 5 : 0);
        return Math.min(DAY_POINTS_MAX, p);
    }

    /** Средната ангажираност за прозорец от N дни, завършващ на индекс i. null — още няма толкова дни. */
    function windowAvg(tl, i, n) {
        if (i + 1 < n) return null;
        var sum = 0, cnt = 0;
        for (var j = i - n + 1; j <= i; j++) {
            if (tl[j].shielded) continue;
            sum += tl[j].eng || 0;
            cnt++;
        }
        return cnt ? Math.round(sum / cnt) : 0;
    }

    /** Най-високото стъпало, чиито условия държат заедно с всички под него (и скорошното, и дългото). */
    function qualifiedTier(tl, i) {
        var q = -1;
        for (var t = 0; t < TIERS.length; t++) {
            var a = windowAvg(tl, i, TIERS[t].days);
            if (a == null || a < TIERS[t].minEng) break;
            q = t;
        }
        return q;
    }

    /** Етапите при отслабване (или покачване) от записите на теглото. */
    function weightProgress(log, startKg, dir) {
        var list = (Array.isArray(log) ? log : []).filter(function (x) { return x && x.kg > 0 && x.at; });
        if (!(startKg > 0) || (dir !== 'lose' && dir !== 'gain') || !list.length) return null;
        var sign = dir === 'lose' ? 1 : -1;
        var last = list[list.length - 1];
        var pct = Math.round((startKg - last.kg) / startKg * 1000 * sign) / 10;
        // Твърде бързо: над 1% от теглото на седмица за последните 3+ седмици — без поздрав, а проверка.
        var tooFast = false;
        var ref = null;
        for (var i = list.length - 1; i >= 0; i--) { if (last.at - list[i].at >= 21 * DAY) { ref = list[i]; break; } }
        if (dir === 'lose' && ref) {
            var weeks = (last.at - ref.at) / (7 * DAY);
            tooFast = (ref.kg - last.kg) / ref.kg * 100 / weeks > 1;
        }
        var reached = [];
        WEIGHT_STEPS.forEach(function (s) {
            if (pct < s) return;
            // кога за първи път е минат етапът
            var at = null;
            for (var j = 0; j < list.length; j++) {
                if ((startKg - list[j].kg) / startKg * 100 * sign >= s) { at = list[j].at; break; }
            }
            reached.push({ pct: s, at: at });
        });
        var next = WEIGHT_STEPS.filter(function (s) { return pct < s; })[0] || null;
        return {
            dir: dir, startKg: startKg, lastKg: last.kg, pct: pct, tooFast: tooFast, reached: reached, next: next,
            nextKg: next ? Math.round((startKg * (1 - sign * next / 100)) * 10) / 10 : null
        };
    }

    /**
     * @param {{ gameData: object, calcDayScore: function, todayKey?: string, weightLog?: Array,
     *           startKg?: number, goalDirection?: string, challenge?: { id: string, joined: string } }} input
     */
    function compute(input) {
        var inp = /** @type {any} */ (input || {});
        var todayKey = inp.todayKey || localKey(new Date());
        var tl = timeline(inp.gameData, inp.calcDayScore, todayKey);
        var milestones = [];
        var res = {
            todayKey: todayKey, daysTracked: 0, firstKey: tl.length ? tl[0].key : null,
            streak: 0, bestStreak: 0,
            shields: { held: 0, max: SHIELD_MAX, toNext: SHIELD_EVERY, used: [] },
            tier: null, next: null, warning: null,
            consistency: {},
            points: { earned: 0, days: {}, bonus: 0 },
            records: { bestStreak: 0, bestWeek: null, maxSteps: null, stepDays: 0 },
            milestones: milestones, weight: null, week: null, challenge: null
        };
        if (!tl.length) return res;

        var held = 0, goodCount = 0, streak = 0, best = 0;
        var tierIdx = -1, under = 0, firstReach = {};
        var lastIdx = tl.length - 1;
        var todayGood = tl[lastIdx].eng != null && tl[lastIdx].eng >= GOOD;
        // Днешният ден влиза в стъпалата, щом вече е добър; иначе се оценява до вчера.
        var evalEnd = todayGood ? lastIdx : lastIdx - 1;

        for (var i = 0; i <= lastIdx; i++) {
            var d = tl[i];
            var isToday = i === lastIdx;
            if (d.rec) res.daysTracked++;
            var good = d.eng != null && d.eng >= GOOD;
            if (good) {
                goodCount++;
                streak++;
                if (goodCount % SHIELD_EVERY === 0 && held < SHIELD_MAX) {
                    held++;
                    milestones.push({ id: 'shield:' + d.key, kind: 'shield', key: d.key, big: false });
                }
                STREAKS.forEach(function (s) {
                    if (streak === s.days && !firstReach['streak' + s.days]) {
                        firstReach['streak' + s.days] = true;
                        res.points.bonus += s.bonus;
                        milestones.push({ id: 'streak:' + s.days, kind: s.habit ? 'habit' : 'streak', key: d.key, days: s.days, big: s.big, bonus: s.bonus });
                    }
                });
            } else if (!isToday) {
                // Ден под прага (слаб или без отметки) — жокерът го покрива и поредицата продължава.
                if (held > 0 && streak > 0) {
                    held--;
                    d.shielded = true;
                    res.shields.used.push(d.key);
                } else {
                    streak = 0;
                }
            }
            if (streak > best) best = streak;
            var pts = dayPoints(d);
            if (pts) res.points.days[d.key] = pts;

            if (i <= evalEnd) {
                var q = qualifiedTier(tl, i);
                if (q > tierIdx) {
                    for (var t = tierIdx + 1; t <= q; t++) {
                        if (!firstReach['tier' + t]) {
                            firstReach['tier' + t] = true;
                            res.points.bonus += TIERS[t].bonus;
                            milestones.push({ id: 'tier:' + TIERS[t].id, kind: 'tier', key: d.key, tier: TIERS[t].id, big: true, bonus: TIERS[t].bonus });
                        }
                    }
                    tierIdx = q;
                    under = 0;
                } else if (q < tierIdx) {
                    under++;
                    if (under >= GRACE_DAYS) { tierIdx--; under = 0; }
                } else {
                    under = 0;
                }
            }
        }

        res.streak = streak;
        res.bestStreak = best;
        res.records.bestStreak = best;
        res.shields.held = held;
        res.shields.toNext = held >= SHIELD_MAX ? null : SHIELD_EVERY - (goodCount % SHIELD_EVERY);

        [14, 30, 60, 90].forEach(function (n) {
            var end = Math.max(0, evalEnd);
            res.consistency['d' + n] = windowAvg(tl, end, Math.min(n, end + 1));
        });

        if (tierIdx >= 0) res.tier = Object.assign({ index: tierIdx }, TIERS[tierIdx]);
        if (tierIdx >= 0 && under > 0) res.warning = { tier: TIERS[tierIdx].id, daysLeft: GRACE_DAYS - under };
        var nx = TIERS[tierIdx + 1];
        if (nx) {
            var end2 = Math.max(0, evalEnd);
            var have = Math.min(nx.days, end2 + 1);
            res.next = {
                id: nx.id, title: nx.title, days: nx.days, minEng: nx.minEng, rewards: nx.rewards,
                daysHave: have, avg: windowAvg(tl, end2, have),
                progress: Math.min(100, Math.round(have / nx.days * 100))
            };
        }

        // Рекорди: най-добрата седмица (средна ангажираност за 7 дни), най-много крачки.
        for (var w = 6; w <= evalEnd; w++) {
            var a = windowAvg(tl, w, 7);
            if (a != null && (!res.records.bestWeek || a > res.records.bestWeek.avg)) res.records.bestWeek = { avg: a, key: tl[w].key };
        }
        tl.forEach(function (d) {
            if (d.steps > 0 && (!res.records.maxSteps || d.steps > res.records.maxSteps.steps)) res.records.maxSteps = { steps: d.steps, key: d.key };
            if (d.onTarget) res.records.stepDays++;
        });

        var earned = 0;
        Object.keys(res.points.days).forEach(function (k) { earned += res.points.days[k]; });
        res.points.earned = earned + res.points.bonus;

        // Седмицата: Пн–Нд (виж weekEndKey), сравнена с предишната.
        var wEnd = weekEndKey(todayKey);
        var wIdx = -1;
        for (var wi = lastIdx; wi >= 0; wi--) if (tl[wi].key === wEnd) { wIdx = wi; break; }
        if (wIdx >= 0) {
            var from = Math.max(0, wIdx - 6), wk = tl.slice(from, wIdx + 1);
            var tracked = wk.filter(function (x) { return x.rec; });
            var bestDay = /** @type {any} */ (null), stepSum = 0, stepN = 0, wpts = 0;
            wk.forEach(function (x) {
                if (x.eng != null && (!bestDay || x.eng >= bestDay.eng)) bestDay = x;
                if (x.steps > 0) { stepSum += x.steps; stepN++; }
                wpts += res.points.days[x.key] || 0;
            });
            var avgW = tracked.length ? Math.round(wk.reduce(function (a, x) { return a + (x.eng || 0); }, 0) / wk.length) : null;
            var prevAvg = from >= 7 ? windowAvg(tl, from - 1, 7) : null;
            res.week = {
                startKey: wk[0].key, endKey: wEnd, days: wk.length, tracked: tracked.length,
                good: wk.filter(function (x) { return x.eng != null && x.eng >= GOOD; }).length,
                avg: avgW, prevAvg: prevAvg, delta: avgW != null && prevAvg != null ? avgW - prevAvg : null,
                points: wpts, stepsAvg: stepN ? Math.round(stepSum / stepN) : null, stepDays: wk.filter(function (x) { return x.onTarget; }).length,
                best: bestDay && bestDay.eng > 0 ? { key: bestDay.key, eng: bestDay.eng } : null,
                milestones: milestones.filter(function (m) { return m.key >= wk[0].key && m.key <= wEnd && m.kind !== 'shield'; }).map(function (m) { return m.id; })
            };
        }

        // Месечното предизвикателство (по избор): от деня на приемане до днес.
        var month = monthOf(todayKey);
        var hasSteps = tl.slice(-14).some(function (x) { return x.steps > 0; });
        var ch = challengeFor(month, hasSteps);
        var joinKey = inp.challenge && monthOf(inp.challenge.joined || '') === month ? inp.challenge.joined : null;
        if (joinKey && inp.challenge.id && CHALLENGE_TEST[inp.challenge.id]) ch = CHALLENGES.filter(function (c) { return c.id === inp.challenge.id; })[0] || ch;
        var dim = daysInMonth(month), dayNo = +todayKey.slice(8, 10), left = dim - dayNo + 1;
        var count = 0, doneKey = null;
        if (joinKey) tl.forEach(function (x) {
            if (x.key >= joinKey && monthOf(x.key) === month && CHALLENGE_TEST[ch.id](x)) { count++; if (count === CHALLENGE_TARGET) doneKey = x.key; }
        });
        var joinedDay = joinKey ? +joinKey.slice(8, 10) : null;
        res.challenge = {
            month: month, id: ch.id, title: ch.title, text: ch.text, target: CHALLENGE_TARGET, bonus: CHALLENGE_BONUS,
            joined: joinKey, count: Math.min(count, CHALLENGE_TARGET), done: count >= CHALLENGE_TARGET, daysLeft: left,
            canJoin: !joinKey && left >= CHALLENGE_TARGET,
            // темпо: колко би трябвало да има досега, ако целта се разпредели равно до края на месеца
            behind: !!joinKey && count < CHALLENGE_TARGET && left > 0 && (CHALLENGE_TARGET - count) > left * 0.8
        };
        if (doneKey) milestones.push({ id: 'challenge:' + month, kind: 'challenge', key: doneKey, big: true, challenge: ch.id, bonus: CHALLENGE_BONUS });

        var wp = weightProgress(inp.weightLog, Number(inp.startKg) || 0, inp.goalDirection);
        if (wp) {
            res.weight = wp;
            if (!wp.tooFast) wp.reached.forEach(function (r) {
                milestones.push({ id: 'weight:' + wp.dir + ':' + r.pct, kind: 'weight', key: r.at ? localKey(new Date(r.at)) : todayKey, pct: r.pct, dir: wp.dir, big: !!WEIGHT_BIG[r.pct] });
            });
        }
        return res;
    }

    function streakOf(days) { for (var i = 0; i < STREAKS.length; i++) if (STREAKS[i].days === days) return STREAKS[i]; return null; }
    function tierById(id) { for (var i = 0; i < TIERS.length; i++) if (TIERS[i].id === id) return TIERS[i]; return null; }
    function offerById(id) { for (var i = 0; i < OFFERS.length; i++) if (OFFERS[i].id === id) return OFFERS[i]; return null; }

    var api = {
        GOOD: GOOD, SHIELD_EVERY: SHIELD_EVERY, SHIELD_MAX: SHIELD_MAX, GRACE_DAYS: GRACE_DAYS,
        TIERS: TIERS, STREAKS: STREAKS, WEIGHT_STEPS: WEIGHT_STEPS, OFFERS: OFFERS, FACTS: FACTS,
        compute: compute, tierById: tierById, streakOf: streakOf, offerById: offerById, weightProgress: weightProgress,
        WORDS: WORDS, TEXTS: TEXTS, THEMES: THEMES, codeFor: codeFor, normCode: normCode, text: text,
        applyContent: applyContent, imageFor: imageFor,
        CHALLENGES: CHALLENGES, CHALLENGE_TARGET: CHALLENGE_TARGET, CHALLENGE_BONUS: CHALLENGE_BONUS,
        challengeFor: challengeFor, weekEndKey: weekEndKey, openStats: openStats, monthOf: monthOf
    };
    /** @type {any} */ (global).RewardsEngine = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
