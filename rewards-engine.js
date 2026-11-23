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

    // Стъпалата на постоянството и наградата при първото достигане.
    // kind: supplement — добавки (само за България), plan — план в сайта.
    var TIERS = [
        { id: 'start', title: 'Начало', days: 14, minEng: 60, bonus: 100, rewards: [{ kind: 'supplement', pct: 5 }] },
        { id: 'steady', title: 'Стабилност', days: 30, minEng: 70, bonus: 200, rewards: [{ kind: 'supplement', pct: 10 }] },
        { id: 'habit', title: 'Навик', days: 60, minEng: 75, bonus: 300, rewards: [{ kind: 'supplement', pct: 15 }, { kind: 'plan', pct: 10 }] },
        { id: 'lifestyle', title: 'Начин на живот', days: 90, minEng: 80, bonus: 500, rewards: [{ kind: 'supplement', pct: 20 }, { kind: 'plan', pct: 20 }] }
    ];

    // Поредица от добри дни: бонус точки и момент. 66 дни — медианата до автоматичен навик (Lally 2010).
    var STREAKS = [
        { days: 7, bonus: 30, big: false },
        { days: 21, bonus: 70, big: true },
        { days: 66, bonus: 200, big: true, habit: true },
        { days: 100, bonus: 300, big: true }
    ];

    var WEIGHT_STEPS = [3, 5, 7, 10];
    var WEIGHT_BIG = { 5: true, 10: true };

    // Точки → отстъпка. Партньорските оферти се добавят тук (kind: 'partner', partner: '<id>').
    var OFFERS = [
        { id: 'plan10', kind: 'plan', pct: 10, cost: 1500, title: '−10% за план' },
        { id: 'supp10', kind: 'supplement', pct: 10, cost: 1000, title: '−10% за добавки', region: 'BG' }
    ];

    // Само проверени факти — показват се, когато сравнение с потребителите още няма.
    var FACTS = {
        habit: 'В изследване на University College London (Lally и колеги, 2010) един нов навик става автоматичен средно за 66 дни — и един пропуснат ден не го разваля.',
        streak21: 'Три седмици подред — повечето хора спират преди това. Ти минаваш през най-трудната част.',
        weight5: 'Около 5% по-малко тегло вече подобрява чувствителността към инсулина, кръвното и мазнините в кръвта (Magkos и колеги, Cell Metabolism, 2016).',
        weight7: 'В голямото изследване DPP (NEJM, 2002) 7% по-малко тегло и 150 минути движение седмично намаляват риска от диабет тип 2 с 58%.',
        steps: 'Голям анализ на 15 изследвания (Paluch и колеги, Lancet Public Health, 2022): повече крачки на ден — по-нисък риск, до около 8–10 хиляди при възрастните под 60 г.',
        consistency: 'Редовното отбелязване е най-сигурният предвестник на успеха при промяната на храненето (Burke и колеги, 2011).'
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

    function tierById(id) { for (var i = 0; i < TIERS.length; i++) if (TIERS[i].id === id) return TIERS[i]; return null; }
    function offerById(id) { for (var i = 0; i < OFFERS.length; i++) if (OFFERS[i].id === id) return OFFERS[i]; return null; }

    var api = {
        GOOD: GOOD, SHIELD_EVERY: SHIELD_EVERY, SHIELD_MAX: SHIELD_MAX, GRACE_DAYS: GRACE_DAYS,
        TIERS: TIERS, STREAKS: STREAKS, WEIGHT_STEPS: WEIGHT_STEPS, OFFERS: OFFERS, FACTS: FACTS,
        compute: compute, tierById: tierById, offerById: offerById, weightProgress: weightProgress
    };
    /** @type {any} */ (global).RewardsEngine = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
