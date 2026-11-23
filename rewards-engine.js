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
 *  - жокер: 1 на всеки 14 добри дни, най-много 2; покрива сам ден без отметки;
 *  - стъпало: средната ангажираност за последните N дни ≥ прага (дните без отметки — 0, с жокер — не се броят);
 *    достигнатото се пази; ако 14 поредни дни е под него — слиза с едно (предупреждение през тези дни);
 *  - точки: 10 за добър ден, +5 при ≥ 80%, +5 при крачки на целта (до 20 на ден) + бонуси за етапи;
 *  - отслабване: етапи 3/5/7/10% от началното тегло; при сваляне над 1% на седмица — без поздрав.
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
        { id: 'start', title: 'Решимост', days: 14, minEng: 60, bonus: 100, image: 'resolve', word: 'BOLD', rewards: [{ kind: 'supplement', pct: 5 }],
          moment: 'Показа решимост', text: '14 дни, в които думата, дадена на себе си, удържа. Така започва всяка истинска промяна.', share: 'Дадох си дума — и я удържах.' },
        { id: 'steady', title: 'Упоритост', days: 30, minEng: 70, bonus: 200, image: 'persist', word: 'GRIT', rewards: [{ kind: 'supplement', pct: 10 }],
          moment: 'Упоритостта ти личи', text: '30 дни избираш плана си отново и отново — и в лесните, и в трудните дни.', share: 'Избирам себе си — ден след ден.' },
        { id: 'habit', title: 'Постоянство', days: 60, minEng: 75, bonus: 300, image: 'consistency', word: 'FLOW', rewards: [{ kind: 'supplement', pct: 15 }, { kind: 'plan', pct: 10 }],
          moment: 'Създаде постоянство', text: '60 дни. Това вече не е опит, а твоят ритъм.', share: 'Създадох постоянство.' },
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
        section: 'Постоянство',
        empty: 'Всеки отметнат ден е стъпка. От първия започва поредицата ти, а с нея — решимост, упоритост, постоянство и наградите за тях.',
        levelLabel: 'Твоето ниво', firstLevel: 'Първа крачка',
        towards: 'Към „{title}“ · {have} от {days} дни · средно {avg}% (нужни {min}%)',
        top: 'Вътрешна сила — пазиш я с всеки ден.',
        onTrack: 'Още {n} {daysWord} в този ритъм — и ще покажеш {titleLower}.',
        rewardLine: 'Наградата: {gifts}.',
        behind: '„{title}“ иска средно {min}% — сега си на {avg}%. Всеки отметнат ден те приближава.',
        atTop: 'Промяната вече е отвътре. Пазиш я с всеки ден, а точките ти продължават да растат.',
        warn: 'Пази своята {titleLower}: след още {n} {daysWord} под прага нивото слиза с едно. Един добър ден връща отброяването.',
        comparison: 'Постоянството ти е по-високо от това на {p}% от хората в Nutriin.',
        newLevel: 'Ново ниво', giftReady: '— кодът те чака в Напредък',
        shield: 'Спечели жокер: един ден без отметки няма да прекъсне поредицата ти.',
        weightLose: 'По-леко с {pct}%. Заслужено.', weightGain: 'С {pct}% по-близо до целта',
        weightText: 'С ежедневни решения, не с крайности.',
        weightShareLose: 'По-леко. Отвътре навън.', weightShareGain: 'По-близо до целта. Ден след ден.',
        codesTitle: 'Твоите отстъпки', codesEmpty: 'Първата награда идва с „Решимост“ — 14 дни средно над 60%.',
        pointsTitle: 'Плодът на труда ти',
        pointsText: 'Точки за всеки добър ден (10, +5 над 80%, +5 при крачки на целта) и бонуси за нивата и поредиците. Обърни ги в отстъпка.',
        pathTitle: 'Пътят на постоянството',
        pathNote: 'Изграденото остава твое: нивото слиза с едно само след 14 поредни дни под прага.',
        inviteTitle: 'Покани приятел',
        inviteText: 'Приятелят получава −{pct}% за първия си план, а ти — код −{reward}% и 300 точки, щом започне.',
        inviteShare: 'Ела с мен — храненето, видяно отвътре',
        redeemTitle: 'Заслужено. Отстъпката е твоя.',
        shareTagline: 'Започва отвътре. Личи навън.',
        shareInvite: 'Код {code} → −15% за първия план'
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
     *   texts: { ключ: текст }, images: { тема: адрес }, words: { offer, thanks } }
     */
    var DEFAULTS = null;
    function applyContent(c) {
        if (!DEFAULTS) DEFAULTS = JSON.stringify({ t: TIERS, s: STREAKS, o: OFFERS, x: TEXTS, w: WORDS });
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
            out.push({ key: k, shielded: false, rec: !!rec, eng: eng, steps: ec && ec.steps > 0 ? ec.steps : 0, onTarget: stepsOnTarget(rec) });
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
     *           startKg?: number, goalDirection?: string }} input
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
            milestones: milestones, weight: null
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
                // Ден без нито една отметка — жокерът го покрива и поредицата продължава.
                if (!d.rec && held > 0 && streak > 0) {
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
        applyContent: applyContent, imageFor: imageFor
    };
    /** @type {any} */ (global).RewardsEngine = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
