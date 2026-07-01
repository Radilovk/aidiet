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

    /**
     * @param {object} rec - gameData day record
     * @param {string} [todayKey] - YYYY-MM-DD for deficit timing (defaults to today)
     */
    function calcDayScore(rec, todayKey) {
        if (!rec) return emptyDayScore();
        todayKey = todayKey || dateKey(new Date());

        var meals = Object.keys(rec.meals || {});
        var mealPts = 0;
        var mealMax = meals.length * 10;

        meals.forEach(function (m) {
            if (rec.meals[m] === true) mealPts += 10;
        });

        var junkCount = 0;
        var extraCalSum = 0;
        var freeMealCalSum = 0;
        (rec.extraMeals || []).forEach(function (em) {
            var isConsumed = !em.isAddedToPlan || em.countCalories !== false;
            if (em.isJunk && isConsumed && !em.isFreeMealReplacement) junkCount++;
            if (em.isFreeMealReplacement) {
                freeMealCalSum += (em.calories || 0);
            } else if (em.isAddedToPlan && !em.countCalories) {
                // added to plan but unchecked — calories excluded
            } else {
                extraCalSum += (em.calories || 0);
            }
        });

        var mealCalMap = rec.mealCalories || {};
        var completedPlanCals = 0;
        Object.keys(rec.meals || {}).forEach(function (mt) {
            if (rec.meals[mt] === true && mealCalMap[mt]) {
                completedPlanCals += mealCalMap[mt];
            }
        });
        var totalConsumed = completedPlanCals + extraCalSum + freeMealCalSum;
        var planned = rec.plannedCalories ? (rec.plannedCalories + freeMealCalSum) : null;
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

        var done = meals.filter(function (m) { return rec.meals[m] === true; }).length;
        var mealEngPct = meals.length > 0 ? done / meals.length * 50 : 0;
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
            if (score !== null && score > 3 && (junkCount > 0 || excessCalories)) score = 3;
            if (score !== null && score > 2 && junkCount > 0 && excessCalories) score = 2;
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

        var extraCalsWeight = Math.max(0, 100 - Math.round((m.totalExtraCals || 0) / 700 * 100));
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

    global.GameScoring = {
        JUNK_MAX_POINTS: JUNK_MAX_POINTS,
        JUNK_PENALTY_PER_MEAL: JUNK_PENALTY_PER_MEAL,
        HEALTH_WEIGHTS: HEALTH_WEIGHTS,
        dateKey: dateKey,
        calcDayScore: calcDayScore,
        computeHealthIndex: computeHealthIndex,
        buildLast7Days: buildLast7Days,
        countDaysWithRecords: countDaysWithRecords
    };
}(typeof window !== 'undefined' ? window : this));
