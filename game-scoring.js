/**
 * Shared gamification scoring — single source of truth for plan.html and game-analytics.html.
 */
(function (global) {
    'use strict';

    var JUNK_MAX_POINTS = 20;
    var JUNK_PENALTY_PER_MEAL = 7;

    var HEALTH_WEIGHTS = {
        engagement: 0.30,
        sleep: 0.22,
        balance: 0.18,
        activity: 0.18,
        water: 0.10,
        extraCals: 0.05
    };

    function zp(n) { return n < 10 ? '0' + n : '' + n; }

    function dateKey(d) {
        d = d || new Date();
        return d.getFullYear() + '-' + zp(d.getMonth() + 1) + '-' + zp(d.getDate());
    }

    function emptyDayScore() {
        return {
            score: null, stars: '', label: 'Без данни', junkCount: 0,
            excessCalories: false, calorieBalance: 'balanced', engPct: 0, calorieDelta: 0
        };
    }

    /** Meal slots fixed when the calendar day ends — stops a new plan from rewriting history. */
    function getMealSlots(rec) {
        if (rec && rec.mealSlots && rec.mealSlots.length) return rec.mealSlots;
        return Object.keys(rec.meals || {});
    }

    function getPlannedCalories(rec) {
        if (rec && rec.lockedPlannedCalories > 0) return rec.lockedPlannedCalories;
        return rec.plannedCalories || null;
    }

    /**
     * @param {object} rec - gameData day record
     * @param {string} [todayKey] - YYYY-MM-DD for deficit timing (defaults to today)
     */
    function calcDayScore(rec, todayKey) {
        if (!rec) return emptyDayScore();
        todayKey = todayKey || dateKey(new Date());

        var meals = getMealSlots(rec);
        var mealPts = 0;
        var mealMax = meals.length * 10;

        meals.forEach(function (m) {
            if (rec.meals[m] === true) mealPts += 10;
        });

        var junkCount = 0;
        var extraCalSum = 0;
        (rec.extraMeals || []).forEach(function (em) {
            var isConsumed = !em.isAddedToPlan || em.countCalories !== false;
            if (em.isJunk && isConsumed) junkCount++;
            if (em.isAddedToPlan && !em.countCalories) {
                // added to plan but unchecked — calories excluded
            } else {
                extraCalSum += (em.calories || 0);
            }
        });

        var mealCalMap = rec.mealCalories || {};
        // A described free meal replaces the plan's estimate for its slot. The estimate stays
        // in plannedCalories, so the difference surfaces as honest surplus instead of
        // cancelling itself out — the free meal is bounded, not exempt.
        var freeMeal = (rec.freeMeal && rec.freeMeal.calories > 0) ? rec.freeMeal : null;
        var completedPlanCals = 0;
        meals.forEach(function (mt) {
            if (rec.meals[mt] !== true) return;
            if (freeMeal && freeMeal.mealKey === mt) { completedPlanCals += freeMeal.calories; return; }
            if (mealCalMap[mt]) completedPlanCals += mealCalMap[mt];
        });
        var totalConsumed = completedPlanCals + extraCalSum;
        var planned = getPlannedCalories(rec);
        var excessCalories = false;
        var calorieBalance = 'balanced';
        var calorieDelta = 0;

        if (totalConsumed > 0 && planned && planned > 0) {
            var excessPct = (totalConsumed - planned) / planned;
            calorieDelta = Math.round(totalConsumed - planned);
            if (excessPct > 0.10) { excessCalories = true; calorieBalance = 'surplus'; }
            else if (excessPct > 0) { calorieBalance = 'surplus'; }
            else if (excessPct < -0.10 && completedPlanCals > 0 && (rec.morningCheck || rec.eveningCheck)) {
                var recDate = rec.date || todayKey;
                var dayIsDone = recDate < todayKey || new Date().getHours() >= 20;
                if (dayIsDone) calorieBalance = 'deficit';
            }
        } else if (extraCalSum > 0 && (!planned || planned === 0)) {
            calorieDelta = extraCalSum;
            if (extraCalSum > 200) { excessCalories = true; calorieBalance = 'surplus'; }
            else if (extraCalSum > 50) { calorieBalance = 'surplus'; }
        }

        var sleepPts = rec.morningCheck ? (rec.morningCheck.sleptWell ? 10 : 0) : null;
        var waterPts = rec.eveningCheck && rec.eveningCheck.waterIntake != null
            ? (rec.eveningCheck.waterIntake ? 10 : 0) : null;
        var activityPts = rec.eveningCheck && rec.eveningCheck.activityLevel != null
            ? ([0, 0, 5, 10][rec.eveningCheck.activityLevel] || 0) : null;
        var balancePts = rec.eveningCheck && rec.eveningCheck.emotionalBalance != null
            ? ([0, 0, 5, 10][rec.eveningCheck.emotionalBalance] || 0) : null;

        var wellnessEarned = (sleepPts || 0) + (waterPts || 0) + (activityPts || 0) + (balancePts || 0);
        var wellnessMax = 40;

        var allMealsOk = meals.length > 0 && meals.every(function (m) { return rec.meals[m] === true; });
        var badSleep = rec.morningCheck && rec.morningCheck.sleptWell === false;
        var badWater = rec.eveningCheck && rec.eveningCheck.waterIntake === false;
        var lowActivity = rec.eveningCheck && rec.eveningCheck.activityLevel === 1;
        var lowBalance = rec.eveningCheck && rec.eveningCheck.emotionalBalance === 1;
        var has5StarBlocker = !allMealsOk || excessCalories ||
            badSleep || badWater || lowActivity || lowBalance || junkCount > 0;

        // Половината от ангажираността са спазените хранения от плана (без
        // свободното и сутрешната напитка) — същото число, по което се коригира планът.
        var planMeals = planMealSlots(rec);
        var done = planMeals.filter(function (m) { return rec.meals[m] === true; }).length;
        var mealEngPct = planMeals.length > 0 ? done / planMeals.length * 50 : 0;
        var mornEngPct = rec.morningCheck ? 15 : 0;
        var eveEngPct = (rec.eveningCheck && (
            rec.eveningCheck.activityLevel != null ||
            rec.eveningCheck.emotionalBalance != null ||
            rec.eveningCheck.waterIntake != null
        )) ? 15 : 0;
        var hasAnyEngagement = mealEngPct > 0 || mornEngPct > 0 || eveEngPct > 0 || junkCount > 0;
        var junkPct = hasAnyEngagement
            ? Math.max(0, JUNK_MAX_POINTS - junkCount * JUNK_PENALTY_PER_MEAL) : 0;
        var engPct = Math.round(mealEngPct + mornEngPct + eveEngPct + junkPct);

        var totalMax = mealMax + wellnessMax;
        var totalEarned = mealPts + wellnessEarned;
        var hasAnyActivity = totalEarned > 0 || meals.length > 0;
        var score = null;

        if (totalMax > 0 && hasAnyActivity) {
            var pct = totalEarned / totalMax;
            if (pct >= 1.00 && !has5StarBlocker) score = 5;
            else if (pct >= 0.80) score = 4;
            else if (pct >= 0.55) score = 3;
            else if (pct >= 0.30) score = 2;
            else if (pct > 0) score = 1;
            if (score === 5 && has5StarBlocker) score = 4;
            // A single slip already costs the top tier via has5StarBlocker. Only a compound,
            // repeated deviation drops further: when one biscuit scores the same as a collapsed
            // day, there is no reason left to stop at one biscuit.
            if (score !== null && score > 3 && junkCount > 1 && excessCalories) score = 3;
        }

        var starIcon = '<i class="fas fa-star" style="color:#fbbf24;font-size:0.85em"></i>';
        var stars = '';
        for (var s = 0; s < (score || 0); s++) stars += starIcon;

        var label = '';
        if (score === null) {
            label = meals.length ? 'Без отбелязана активност' : 'Без данни';
        } else if (score === 5) { label = 'Отличен резултат!'; }
        else if (score === 4) { label = 'Много добре!'; }
        else if (score === 3) { label = 'Добре'; }
        else if (score === 2) { label = 'Може по-добре'; }
        else { label = 'Подобри се утре'; }

        if (junkCount > 0) label += ' (' + junkCount + ' вредни)';
        if (calorieBalance === 'surplus' && excessCalories) label += ' — излишни кал.';
        if (calorieBalance === 'deficit') label += ' — кал. дефицит';

        return {
            score: score, stars: stars, label: label, junkCount: junkCount,
            excessCalories: excessCalories, calorieBalance: calorieBalance,
            engPct: engPct, calorieDelta: calorieDelta
        };
    }

    /**
     * Composite health index (0–100) with dynamic weight normalization.
     * @param {object} m - { engagementPct, sleepPct, balancePct, actPct, waterPct, totalExtraCals }
     */
    function computeHealthIndex(m) {
        var healthScore = 0;
        var totalWeight = HEALTH_WEIGHTS.engagement;
        healthScore += (m.engagementPct || 0) * HEALTH_WEIGHTS.engagement;

        if (m.sleepPct != null) {
            healthScore += m.sleepPct * HEALTH_WEIGHTS.sleep;
            totalWeight += HEALTH_WEIGHTS.sleep;
        }
        if (m.balancePct != null) {
            healthScore += m.balancePct * HEALTH_WEIGHTS.balance;
            totalWeight += HEALTH_WEIGHTS.balance;
        }
        if (m.actPct != null) {
            healthScore += m.actPct * HEALTH_WEIGHTS.activity;
            totalWeight += HEALTH_WEIGHTS.activity;
        }
        if (m.waterPct != null) {
            healthScore += m.waterPct * HEALTH_WEIGHTS.water;
            totalWeight += HEALTH_WEIGHTS.water;
        }

        // Извънплановите калории на ден (средно за записаните дни): 0 → 100, 350+ kcal/ден → 0.
        var perDay = m.extraCalsPerDay != null ? m.extraCalsPerDay : (m.totalExtraCals || 0) / 7;
        var extraCalsWeight = Math.max(0, 100 - Math.round(perDay / 350 * 100));
        healthScore += extraCalsWeight * HEALTH_WEIGHTS.extraCals;
        totalWeight += HEALTH_WEIGHTS.extraCals;

        return Math.round(Math.max(0, Math.min(100, healthScore / totalWeight)));
    }

    /** Build last-7-days array (today − 6 … today). */
    function buildLast7Days(allData, todayKey) {
        todayKey = todayKey || dateKey(new Date());
        var days = [];
        for (var i = 6; i >= 0; i--) {
            var dd = new Date();
            dd.setDate(dd.getDate() - i);
            var key = dateKey(dd);
            if (key <= todayKey) {
                days.push({ key: key, rec: (allData || {})[key] || null });
            }
        }
        return days;
    }

    function countDaysWithRecords(days) {
        return days.filter(function (d) { return !!d.rec; }).length;
    }

    /* ── Седмично обобщение — СЪЩИТЕ формули като на сървъра ──────────────
     * (analytics-compression.js buildAnalyticsSummary). Клиентът и сървърът
     * показват едни и същи числа; scripts/test-analytics-parity.mjs го проверява. */

    function avg(values) {
        var v = values.filter(function (x) { return x != null; });
        return v.length ? Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length) : null;
    }

    function extraCalsOf(rec) {
        return ((rec && rec.extraMeals) || []).reduce(function (s, em) {
            if (em.isAddedToPlan && !em.countCalories) return s;
            return s + (em.calories || 0);
        }, 0);
    }

    /** Слотовете, които се броят за спазване: без свободното хранене и напитката. */
    function planMealSlots(rec) {
        var freeKey = rec && rec.freeMeal && rec.freeMeal.mealKey;
        return getMealSlots(rec).filter(function (m) {
            return m !== freeKey && !/^Напитка|^Свободно хранене/.test(m);
        });
    }

    /** Спазени хранения за деня (без свободното и напитката); null за ден само отворен. */
    function dayMealAdherence(rec) {
        if (!rec) return null;
        var slots = planMealSlots(rec);
        if (!slots.length) return null;
        var ticked = slots.filter(function (m) { return rec.meals && rec.meals[m] === true; }).length;
        var touched = ticked > 0 || rec.morningCheck || rec.eveningCheck || ((rec.extraMeals || []).length > 0);
        return touched ? Math.round(ticked / slots.length * 100) : null;
    }

    /** Колко близо до плана са калориите: 100 = точно; 10% над или под = 90. */
    function dayCalCloseness(rec) {
        if (!rec) return null;
        var mealCalMap = rec.mealCalories || {};
        var free = (rec.freeMeal && rec.freeMeal.calories > 0) ? rec.freeMeal : null;
        var consumed = getMealSlots(rec).reduce(function (sum, mt) {
            if (!rec.meals || !rec.meals[mt]) return sum;
            if (free && free.mealKey === mt) return sum + free.calories;
            return sum + (mealCalMap[mt] || 0);
        }, 0);
        var total = consumed + extraCalsOf(rec);
        var plan = getPlannedCalories(rec);
        if (!(total > 0) || !plan) return null;
        return Math.max(0, 100 - Math.round(Math.abs(total / plan - 1) * 100));
    }

    /** Поредни дни с поне 4 звезди назад от днес (днес се прескача, ако още няма оценка). */
    function streakOf(allData, todayKey, windowDays) {
        windowDays = windowDays || 7;
        var streak = 0;
        var todayRec = (allData || {})[todayKey];
        var start = (!todayRec || calcDayScore(todayRec, todayKey).score == null) ? 1 : 0;
        for (var i = start; i < windowDays; i++) {
            var d = new Date();
            d.setDate(d.getDate() - i);
            var rec = (allData || {})[dateKey(d)];
            var sc = rec ? calcDayScore(rec, todayKey).score : null;
            if (sc != null && sc >= 4) streak++;
            else break;
        }
        return streak;
    }

    function weekSummary(allData, todayKey) {
        todayKey = todayKey || dateKey(new Date());
        var days = buildLast7Days(allData, todayKey);
        var recorded = days.filter(function (d) { return !!d.rec; });
        var scores = days.map(function (d) { return d.rec ? calcDayScore(d.rec, todayKey) : null; });
        var valid = scores.filter(function (s) { return s && s.score != null; });
        var avgScore = valid.length
            ? Math.round(valid.reduce(function (a, s) { return a + s.score; }, 0) / valid.length * 10) / 10
            : null;
        var engagementPct = avg(recorded.map(function (d) { return calcDayScore(d.rec, todayKey).engPct; })) || 0;
        var mealAdh = days.map(function (d) { return dayMealAdherence(d.rec); }).filter(function (v) { return v != null; });
        var totalExtraCals = days.reduce(function (s, d) { return s + extraCalsOf(d.rec); }, 0);
        // Днешният ден още не е изяден — нетният баланс е само за завършените дни.
        var netCalBalance = days.reduce(function (s, d) {
            return s + (d.rec && d.key < todayKey ? calcDayScore(d.rec, todayKey).calorieDelta : 0);
        }, 0);
        var sleep = days.map(function (d) { var m = d.rec && d.rec.morningCheck; return m && m.sleptWell != null ? (m.sleptWell ? 100 : 0) : null; });
        var bal = days.map(function (d) { var e = d.rec && d.rec.eveningCheck; return e && e.emotionalBalance != null ? Math.round((e.emotionalBalance - 1) / 2 * 100) : null; });
        var act = days.map(function (d) { var e = d.rec && d.rec.eveningCheck; return e && e.activityLevel != null ? Math.round((e.activityLevel - 1) / 2 * 100) : null; });
        var water = days.map(function (d) { var e = d.rec && d.rec.eveningCheck; return e && e.waterIntake != null ? (e.waterIntake ? 100 : 0) : null; });
        var junk7 = 0;
        days.forEach(function (d) {
            ((d.rec && d.rec.extraMeals) || []).forEach(function (em) {
                if (em.isJunk && (!em.isAddedToPlan || em.countCalories !== false)) junk7++;
            });
        });
        var past = scores.slice(0, -1);
        var first = past.slice(0, Math.floor(past.length / 2)).filter(function (x) { return x && x.score != null; });
        var last = past.slice(Math.ceil(past.length / 2)).filter(function (x) { return x && x.score != null; });
        var trend = 'flat';
        if (first.length && last.length) {
            var fh = first.reduce(function (a, x) { return a + x.score; }, 0) / first.length;
            var lh = last.reduce(function (a, x) { return a + x.score; }, 0) / last.length;
            if (lh > fh + 0.3) trend = 'up';
            else if (fh > lh + 0.3) trend = 'down';
        }
        var dims = { eng: engagementPct, slp: avg(sleep), bal: avg(bal), act: avg(act), wtr: avg(water) };
        return {
            days: days,
            daysRecorded: recorded.length,
            avgScore: avgScore,
            engagementPct: engagementPct,
            mealAdherence: mealAdh.length ? Math.round(mealAdh.reduce(function (a, b) { return a + b; }, 0) / mealAdh.length) : null,
            mealDays: mealAdh.length,
            calAdherence: avg(days.map(function (d) { return dayCalCloseness(d.rec); })),
            netCalBalance: netCalBalance,
            totalExtraCals: totalExtraCals,
            junk7: junk7,
            trend: trend,
            streak: streakOf(allData, todayKey, 7),
            dimensions: dims,
            healthIndex: computeHealthIndex({
                engagementPct: engagementPct,
                sleepPct: dims.slp, balancePct: dims.bal, actPct: dims.act, waterPct: dims.wtr,
                totalExtraCals: totalExtraCals,
                extraCalsPerDay: totalExtraCals / Math.max(1, recorded.length)
            })
        };
    }

    global.GameScoring = {
        JUNK_MAX_POINTS: JUNK_MAX_POINTS,
        JUNK_PENALTY_PER_MEAL: JUNK_PENALTY_PER_MEAL,
        HEALTH_WEIGHTS: HEALTH_WEIGHTS,
        dateKey: dateKey,
        getMealSlots: getMealSlots,
        getPlannedCalories: getPlannedCalories,
        calcDayScore: calcDayScore,
        computeHealthIndex: computeHealthIndex,
        buildLast7Days: buildLast7Days,
        countDaysWithRecords: countDaysWithRecords,
        dayMealAdherence: dayMealAdherence,
        dayCalCloseness: dayCalCloseness,
        streakOf: streakOf,
        weekSummary: weekSummary
    };
}(typeof window !== 'undefined' ? window : this));
