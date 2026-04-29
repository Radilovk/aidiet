/**
 * game-shared.js — Shared gamification core for non-plan pages.
 * Provides: game bubble UI, morning/evening questions, encouragement toast,
 *           day-end modal, retroactive-entry prompts and check-on-open.
 *
 * Data is stored in the same localStorage keys used by plan.html so the two
 * modules share state seamlessly.
 *
 * Loaded by guidelines.html and profile.html.
 * plan.html has its own complete IIFE and does NOT load this file.
 */
(function () {
    'use strict';

    // ── Constants (must match plan.html) ──────────────────────────────────────
    var GAME_ENABLED_KEY     = 'gameEnabled';
    var GAME_DATA_KEY        = 'gameData';
    var FREE_MEAL_MIN_RATING = 4;
    var JUNK_MAX_POINTS      = 20;
    var JUNK_PENALTY_PER_MEAL = 7;

    // ── Date helpers ──────────────────────────────────────────────────────────
    function zp(n) { return n < 10 ? '0' + n : '' + n; }
    function dateKey(d) {
        d = d || new Date();
        return d.getFullYear() + '-' + zp(d.getMonth() + 1) + '-' + zp(d.getDate());
    }
    function getTodayKey() { return dateKey(new Date()); }

    // ── Data storage ──────────────────────────────────────────────────────────
    function isGameEnabled() { return localStorage.getItem(GAME_ENABLED_KEY) === 'true'; }

    function getGameData() {
        try { return JSON.parse(localStorage.getItem(GAME_DATA_KEY) || '{}'); }
        catch (e) { return {}; }
    }
    function saveGameData(d) { localStorage.setItem(GAME_DATA_KEY, JSON.stringify(d)); }

    function emptyRecord(key) {
        return { date: key, meals: {}, extraMeals: [], freeMealRatings: {},
                 morningCheck: null, eveningCheck: null, plannedCalories: null,
                 mealCalories: {}, dailyScore: null, missing: false };
    }
    function getRecord(key)       { var d = getGameData(); return d[key] || emptyRecord(key); }
    function saveRecord(key, rec) { var d = getGameData(); d[key] = rec; saveGameData(d); }

    // ── Score calculation (mirrors plan.html calcDayScore) ────────────────────
    function calcDayScore(rec) {
        if (!rec) return { score: null, stars: '', label: 'Без данни', junkCount: 0,
                           incorrectMeals: 0, excessCalories: false, calorieBalance: 'balanced', engPct: 0 };
        var meals = Object.keys(rec.meals || {});
        var freeMealRatings = rec.freeMealRatings || {};
        var mealPts = 0, mealMax = meals.length * 10, incorrectMeals = 0;
        meals.forEach(function (m) {
            var isFree = (m === 'Свободно хранене');
            if (isFree) {
                var rating = freeMealRatings[m];
                if (rating != null) {
                    if (rating >= FREE_MEAL_MIN_RATING) mealPts += 10;
                    else incorrectMeals++;
                }
            } else {
                if (rec.meals[m] === true) mealPts += 10;
            }
        });

        var junkCount = 0, extraCalSum = 0;
        (rec.extraMeals || []).forEach(function (em) {
            if (em.isJunk) junkCount++;
            if (!em.isFreeMealReplacement) extraCalSum += (em.calories || 0);
        });

        var mealCalMap = rec.mealCalories || {};
        var completedPlanCals = 0;
        Object.keys(rec.meals || {}).forEach(function (mt) {
            if (rec.meals[mt] === true && mealCalMap[mt]) completedPlanCals += mealCalMap[mt];
        });
        var totalConsumed = completedPlanCals + extraCalSum;
        var planned = rec.plannedCalories || null;
        var excessCalories = false, calorieBalance = 'balanced';
        if (totalConsumed > 0 && planned && planned > 0) {
            var excessPct = (totalConsumed - planned) / planned;
            if (excessPct > 0.10)   { excessCalories = true; calorieBalance = 'surplus'; }
            else if (excessPct > 0) { calorieBalance = 'surplus'; }
        } else if (extraCalSum > 0 && (!planned || planned === 0)) {
            if (extraCalSum > 200) { excessCalories = true; calorieBalance = 'surplus'; }
            else                   { calorieBalance = 'surplus'; }
        }

        var sleepPts    = rec.morningCheck ? (rec.morningCheck.sleptWell ? 10 : 0) : null;
        var waterPts    = rec.eveningCheck ? (rec.eveningCheck.waterIntake ? 10 : 0) : null;
        var activityPts = rec.eveningCheck ? ([0, 0, 5, 10][rec.eveningCheck.activityLevel] || 0) : null;
        var balancePts  = rec.eveningCheck ? ([0, 0, 5, 10][rec.eveningCheck.emotionalBalance] || 0) : null;
        var wellnessEarned = (sleepPts || 0) + (waterPts || 0) + (activityPts || 0) + (balancePts || 0);
        var wellnessMax    = 40;

        var allMealsOk = meals.length > 0 && meals.every(function (m) {
            if (m === 'Свободно хранене') { var r = freeMealRatings[m]; return r == null || r >= FREE_MEAL_MIN_RATING; }
            return rec.meals[m] === true;
        });
        var badSleep  = rec.morningCheck && rec.morningCheck.sleptWell === false;
        var badWater  = rec.eveningCheck && rec.eveningCheck.waterIntake === false;
        var lowActivity = rec.eveningCheck && rec.eveningCheck.activityLevel === 1;
        var lowBalance  = rec.eveningCheck && rec.eveningCheck.emotionalBalance === 1;
        var has5StarBlocker = !allMealsOk || incorrectMeals > 0 || excessCalories ||
                              badSleep || badWater || lowActivity || lowBalance || junkCount > 0;

        var done = meals.filter(function (m) {
            if (m === 'Свободно хранене') return (freeMealRatings[m] || 0) >= FREE_MEAL_MIN_RATING;
            return rec.meals[m] === true;
        }).length;
        var mealEngPct = meals.length > 0 ? done / meals.length * 50 : 0;
        var mornEngPct = rec.morningCheck ? 15 : 0;
        var eveEngPct  = rec.eveningCheck ? 15 : 0;
        var junkPct    = Math.max(0, JUNK_MAX_POINTS - (junkCount + incorrectMeals) * JUNK_PENALTY_PER_MEAL);
        var engPct     = Math.round(mealEngPct + mornEngPct + eveEngPct + junkPct);

        var totalMax    = mealMax + wellnessMax;
        var totalEarned = mealPts + wellnessEarned;
        var hasAnyActivity = totalEarned > 0 || meals.length > 0;

        var score = null, stars = '', label = 'Без данни';
        if (totalMax > 0 && hasAnyActivity) {
            var pct = totalEarned / totalMax;
            if      (!has5StarBlocker && pct >= 1.0) { score = 5; stars = '★★★★★'; label = 'Перфектен ден!'; }
            else if (pct >= 0.80)                    { score = 4; stars = '★★★★☆'; label = 'Отличен ден!'; }
            else if (pct >= 0.55)                    { score = 3; stars = '★★★☆☆'; label = 'Добър ден!'; }
            else if (pct >= 0.30)                    { score = 2; stars = '★★☆☆☆'; label = 'Може по-добре'; }
            else if (pct > 0)                        { score = 1; stars = '★☆☆☆☆'; label = 'Нов старт утре!'; }
            else                                     { score = 0; stars = '☆☆☆☆☆'; label = 'Без оценка'; }
        }
        return { score: score, stars: stars, label: label, junkCount: junkCount,
                 incorrectMeals: incorrectMeals, excessCalories: excessCalories,
                 calorieBalance: calorieBalance, engPct: engPct };
    }

    function recalcAndSave(key) {
        key = key || getTodayKey();
        var rec = getRecord(key);
        rec.dailyScore = calcDayScore(rec);
        saveRecord(key, rec);
    }

    // ── User name ─────────────────────────────────────────────────────────────
    function getUserName() {
        try { var p = JSON.parse(localStorage.getItem('userData') || '{}'); return p.name ? p.name.split(' ')[0] : null; }
        catch (e) { return null; }
    }

    // ── Typewriter ────────────────────────────────────────────────────────────
    function typewriter(el, text, speed, cb) {
        el.textContent = '';
        el.classList.add('typing');
        var i = 0;
        function tick() {
            if (i < text.length) { el.textContent += text[i++]; setTimeout(tick, speed || 30); }
            else { el.classList.remove('typing'); if (cb) cb(); }
        }
        tick();
    }

    // ── Confetti ──────────────────────────────────────────────────────────────
    function makeConfetti(container, count) {
        var colors = ['#0D9488', '#fbbf24', '#f87171', '#818cf8', '#34d399', '#fb923c'];
        for (var i = 0; i < count; i++) {
            var s = document.createElement('span');
            var c = colors[Math.floor(Math.random() * colors.length)];
            var sz = 5 + Math.random() * 7;
            s.style.cssText = 'left:' + (Math.random() * 100) + '%;background:' + c +
                ';width:' + sz + 'px;height:' + sz + 'px' +
                ';border-radius:' + (Math.random() > 0.5 ? '50%' : '2px') +
                ';animation-duration:' + (1.4 + Math.random() * 2.2) + 's' +
                ';animation-delay:' + (Math.random() * 0.9) + 's';
            container.appendChild(s);
        }
    }

    // ── Answer button templates ───────────────────────────────────────────────
    var YES_NO = [
        { label: 'Да', icon: '<i class="fas fa-check" style="color:#10b981"></i>', value: true,  cls: 'yes' },
        { label: 'Не', icon: '<i class="fas fa-xmark" style="color:#ef4444"></i>',  value: false, cls: 'no'  }
    ];
    // Reversed: "Не" left, "Да" right (for hydration question)
    var NO_YES = [
        { label: 'Не', icon: '<i class="fas fa-xmark" style="color:#ef4444"></i>',  value: false, cls: 'no'  },
        { label: 'Да', icon: '<i class="fas fa-check" style="color:#10b981"></i>', value: true,  cls: 'yes' }
    ];
    var starI = '<i class="fas fa-star" style="color:#fbbf24;font-size:0.9em"></i>';
    var STARS_1_3 = [
        { label: 'Слабо',   icons: starI,               value: 1, stars: true },
        { label: 'Добре',   icons: starI + starI,        value: 2, stars: true },
        { label: 'Отлично', icons: starI + starI + starI, value: 3, stars: true }
    ];

    // ── FAB lower timer ───────────────────────────────────────────────────────
    var _fabLowerTimer = null;
    var FAB_LOWER_DELAY = 80;

    function removeBubble() {
        var o = document.getElementById('gameBubble');
        if (o) o.remove();
        var fab = document.querySelector('.fab-chat');
        if (fab) {
            if (_fabLowerTimer) clearTimeout(_fabLowerTimer);
            _fabLowerTimer = setTimeout(function () {
                fab.classList.remove('fab-raised');
                _fabLowerTimer = null;
            }, FAB_LOWER_DELAY);
        }
    }

    // ── Bubble UI ─────────────────────────────────────────────────────────────
    function showBubble(question, answers, onAnswer, opts) {
        opts = opts || {};
        if (_fabLowerTimer) { clearTimeout(_fabLowerTimer); _fabLowerTimer = null; }

        var fab = document.querySelector('.fab-chat');
        var wasRaised = fab && fab.classList.contains('fab-raised');
        if (fab) {
            fab.classList.add('fab-raised', 'game-prompt');
            setTimeout(function () { fab.classList.remove('game-prompt'); }, 2600);
        }

        var existing = document.getElementById('gameBubble');

        function fillAnswers(ansWrap) {
            ansWrap.innerHTML = '';
            var isStars = answers.length === 3 && answers[0].stars;
            if (isStars) {
                var starsRow = document.createElement('div');
                starsRow.className = 'game-stars-wrap';
                answers.forEach(function (a) {
                    var btn = document.createElement('button');
                    btn.className = 'game-star-btn';
                    btn.innerHTML = '<span class="star-icons">' + a.icons + '</span><span class="star-label">' + a.label + '</span>';
                    btn.addEventListener('click', function () { onAnswer(a.value); removeBubble(); });
                    starsRow.appendChild(btn);
                });
                ansWrap.appendChild(starsRow);
            } else {
                answers.forEach(function (a) {
                    var btn = document.createElement('button');
                    btn.className = 'game-answer-btn ' + (a.cls || 'yes');
                    btn.innerHTML = (a.icon ? '<span>' + a.icon + '</span>' : '') + '<span>' + a.label + '</span>';
                    btn.addEventListener('click', function () { onAnswer(a.value); removeBubble(); });
                    ansWrap.appendChild(btn);
                });
            }
        }

        // Update bubble in-place if FAB already raised (chained questions — no flicker)
        if (existing && wasRaised) {
            var grEl = existing.querySelector('.game-bubble-greeting');
            var qEl  = existing.querySelector('.game-bubble-q');
            var awEl = existing.querySelector('.game-bubble-answers');
            if (grEl && qEl && awEl) {
                var name = getUserName();
                grEl.textContent = opts.greeting ? opts.greeting :
                                   (opts.showName && name) ? 'Здравейте, ' + name + '!' : 'AI Асистент';
                awEl.classList.remove('visible');
                fillAnswers(awEl);
                typewriter(qEl, question, 32, function () {
                    setTimeout(function () { awEl.classList.add('visible'); }, 120);
                });
                return;
            }
        }

        if (existing) existing.remove();
        var raiseDelay = (!wasRaised && fab) ? 440 : 0;

        setTimeout(function () {
            var bubble = document.createElement('div');
            bubble.id = 'gameBubble';
            bubble.className = 'game-bubble';
            var fabForPos = document.querySelector('.fab-chat');
            if (fabForPos && fabForPos.classList.contains('fab-raised')) {
                bubble.classList.add('game-bubble--top');
            }

            var hdr = document.createElement('div');
            hdr.className = 'game-bubble-header';
            var av = document.createElement('div');
            av.className = 'game-bubble-avatar';
            av.innerHTML = '<i class="fas fa-robot"></i>';
            var gr = document.createElement('div');
            gr.className = 'game-bubble-greeting';
            var name = getUserName();
            gr.textContent = opts.greeting ? opts.greeting :
                             (opts.showName && name) ? 'Здравейте, ' + name + '!' : 'AI Асистент';
            var closeBtn = document.createElement('button');
            closeBtn.className = 'game-bubble-close';
            closeBtn.innerHTML = '\u2715';
            closeBtn.setAttribute('aria-label', 'Затвори');
            closeBtn.onclick = removeBubble;
            hdr.appendChild(av); hdr.appendChild(gr); hdr.appendChild(closeBtn);

            var body = document.createElement('div');
            body.className = 'game-bubble-body';
            var qDiv = document.createElement('div');
            qDiv.className = 'game-bubble-q';
            var ansWrap = document.createElement('div');
            ansWrap.className = 'game-bubble-answers';
            fillAnswers(ansWrap);

            body.appendChild(qDiv);
            body.appendChild(ansWrap);
            bubble.appendChild(hdr);
            bubble.appendChild(body);
            document.body.appendChild(bubble);

            typewriter(qDiv, question, 32, function () {
                setTimeout(function () { ansWrap.classList.add('visible'); }, 120);
            });
        }, raiseDelay);
    }

    // ── Morning / Evening questions ───────────────────────────────────────────
    function showMorningQuestion(force, recordKey, doneCb) {
        recordKey = recordKey || getTodayKey();
        var rec = getRecord(recordKey);
        if (!force && rec.morningCheck) { if (doneCb) doneCb(); return; }
        var isYesterday = recordKey !== getTodayKey();
        showBubble(
            (isYesterday ? '[Вчера] ' : '') + 'Спахте ли добре тази нощ?',
            YES_NO,
            function (val) {
                var r = getRecord(recordKey);
                r.morningCheck = { sleptWell: val, ts: new Date().toISOString() };
                saveRecord(recordKey, r);
                recalcAndSave(recordKey);
                if (doneCb) { setTimeout(doneCb, 350); }
                else { setTimeout(function () { showEncouragement(buildEncouragement(recordKey)); }, 400); }
            },
            { greeting: isYesterday ? 'Въвеждане за вчера' : undefined, showName: !isYesterday }
        );
    }

    function showEveningFlow(force, recordKey, doneCb) {
        recordKey = recordKey || getTodayKey();
        var rec = getRecord(recordKey);
        if (!force && rec.eveningCheck) { if (doneCb) doneCb(); return; }
        var isYesterday = recordKey !== getTodayKey();
        var prefix = isYesterday ? '[Вчера] ' : '';
        var hdrOpts = { greeting: isYesterday ? 'Въвеждане за вчера' : 'Добър вечер!' };
        var eveData = {};

        function q3() {
            showBubble(prefix + 'Изпихте ли поне 2 л вода?', NO_YES, function (v) {
                eveData.waterIntake = v;
                var r = getRecord(recordKey);
                r.eveningCheck = { activityLevel: eveData.activityLevel,
                    emotionalBalance: eveData.emotionalBalance, waterIntake: v, ts: new Date().toISOString() };
                saveRecord(recordKey, r);
                recalcAndSave(recordKey);
                if (doneCb) { setTimeout(doneCb, 350); }
                else {
                    setTimeout(function () {
                        var upd = getRecord(recordKey);
                        showDayEndModal(upd.dailyScore || calcDayScore(upd));
                    }, 500);
                }
            }, hdrOpts);
        }
        function q2() {
            showBubble(prefix + 'Емоционален баланс?', STARS_1_3,
                function (v) { eveData.emotionalBalance = v; setTimeout(q3, 400); }, hdrOpts);
        }
        function q1() {
            showBubble(prefix + 'Ниво на активност?', STARS_1_3,
                function (v) { eveData.activityLevel = v; setTimeout(q2, 400); }, hdrOpts);
        }
        q1();
    }

    // ── Question queue ────────────────────────────────────────────────────────
    function buildDayQueue(recordKey) {
        var rec = getRecord(recordKey);
        var queue = [];
        if (!rec.morningCheck) queue.push(function (next) { showMorningQuestion(true, recordKey, next); });
        var isToday = recordKey === getTodayKey();
        var h = new Date().getHours();
        if (!rec.eveningCheck && (!isToday || h >= 20)) {
            queue.push(function (next) { showEveningFlow(true, recordKey, next); });
        }
        return queue;
    }

    function runQueue(queue, onDone) {
        var idx = 0;
        function next() {
            if (idx < queue.length) { queue[idx++](next); }
            else { recalcAndSave(); if (onDone) onDone(); }
        }
        if (queue.length) next();
        else if (onDone) onDone();
    }

    // ── On-open prompts ───────────────────────────────────────────────────────
    function checkOpenAppPrompts() {
        if (!isGameEnabled()) return;
        var today = getTodayKey();
        var shownKey = 'gameOpenShown_' + today;
        if (localStorage.getItem(shownKey)) return;
        localStorage.setItem(shownKey, '1');
        var queue = buildDayQueue(today);
        if (!queue.length) return;
        setTimeout(function () {
            runQueue(queue, function () {
                setTimeout(function () { showEncouragement(buildEncouragement()); }, 600);
            });
        }, 1800);
    }

    // ── Retroactive entry (last 3 days) ──────────────────────────────────────
    function checkRetroEntry() {
        if (!isGameEnabled()) return;
        for (var offset = 1; offset <= 3; offset++) {
            var pastDate = new Date(); pastDate.setDate(pastDate.getDate() - offset);
            var pKey = dateKey(pastDate);
            var rec  = getRecord(pKey);
            if (rec.missing) continue;
            if (rec.morningCheck && rec.eveningCheck) continue;
            var offerKey = 'gameRetroOffered_' + pKey;
            if (localStorage.getItem(offerKey)) continue;
            localStorage.setItem(offerKey, '1');
            (function (dayKey, daysAgo) {
                var greeting = daysAgo === 1 ? 'Вчерашни данни' : 'Данни от преди ' + daysAgo + ' дни';
                var msg = daysAgo === 1
                    ? 'Вчерашните въпроси не са попълнени. Искате ли да ги попълните сега?'
                    : 'Данните от ' + daysAgo + ' дни назад не са попълнени. Искате ли да ги въведете сега?';
                setTimeout(function () {
                    showBubble(msg, YES_NO, function (yes) {
                        if (!yes) return;
                        var q = buildDayQueue(dayKey);
                        if (q.length) setTimeout(function () { runQueue(q); }, 350);
                    }, { greeting: greeting });
                }, 2800);
            })(pKey, offset);
            break;
        }
    }

    // ── Encouragement toast ───────────────────────────────────────────────────
    var ENC = {
        sleep:    '<i class="fas fa-bed" style="color:#6366f1"></i> Добрият сън е основата. Лягайте по-рано — тялото ви ще ви благодари!',
        water:    '<i class="fas fa-droplet" style="color:#06B6D4"></i> Целта е 2 л вода на ден. Поставете бутилка на видно място!',
        activity: '<i class="fas fa-person-walking" style="color:#0D9488"></i> Дори 15 мин. разходка подобрява метаболизма и настроението!',
        junk:     '<i class="fas fa-leaf" style="color:#10b981"></i> Вредните храни са изкушение, но планът работи. Утре нов старт!',
        perfect:  '<i class="fas fa-trophy" style="color:#fbbf24"></i> Страхотен ден! Спазихте плана отлично. Резултатите идват!',
        good:     '<i class="fas fa-check-circle" style="color:#10b981"></i> Добре се справяте! Малките крачки водят до голямата цел!',
        def:      '<i class="fas fa-dumbbell" style="color:#0D9488"></i> На прав път сте! Последователността е ключът!'
    };
    function buildEncouragement(recordKey) {
        var rec = getRecord(recordKey || getTodayKey());
        var ds  = rec.dailyScore || calcDayScore(rec);
        if (ds.junkCount > 0) return ENC.junk;
        if (rec.morningCheck && !rec.morningCheck.sleptWell) return ENC.sleep;
        if (rec.eveningCheck && !rec.eveningCheck.waterIntake) return ENC.water;
        if (rec.eveningCheck && rec.eveningCheck.activityLevel === 1) return ENC.activity;
        if (ds.score === 5 && !ds.junkCount) return ENC.perfect;
        if (ds.score >= 4) return ENC.good;
        return ENC.def;
    }
    function showEncouragement(text) {
        var t = document.getElementById('gameEncourageToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'gameEncourageToast';
            t.className = 'game-encourage-toast';
            document.body.appendChild(t);
        }
        t.innerHTML = text;
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                t.classList.add('visible');
                setTimeout(function () { t.classList.remove('visible'); }, 4500);
            });
        });
    }

    // ── Day-end modal ─────────────────────────────────────────────────────────
    var DAY_LEVELS = [
        { min: 5, iconClass: 'fas fa-trophy',    iconColor: '#fbbf24', title: 'Перфектен ден!',   color: '#fbbf24',
          msg: 'Изпълнихте плана 100%! Вие сте шампион. Резултатите ще дойдат!', confetti: true  },
        { min: 4, iconClass: 'fas fa-award',     iconColor: '#10b981', title: 'Отличен ден!',     color: '#10b981',
          msg: 'Браво! Почти перфектно. Малко крачки = голям успех!', confetti: true  },
        { min: 3, iconClass: 'fas fa-thumbs-up', iconColor: '#0D9488', title: 'Добър ден!',       color: '#0D9488',
          msg: 'Справихте се добре. Утре може дори по-добре!', confetti: false },
        { min: 2, iconClass: 'fas fa-dumbbell',  iconColor: '#f59e0b', title: 'Може по-добре',    color: '#f59e0b',
          msg: 'Трудно е понякога, но не се отказвайте. Всеки ден е нов шанс!', confetti: false },
        { min: 0, iconClass: 'fas fa-seedling',  iconColor: '#6366f1', title: 'Нов старт утре!',  color: '#6366f1',
          msg: 'Днес беше предизвикателно. Малките промени правят голяма разлика!', confetti: false }
    ];
    function showDayEndModal(ds) {
        var old = document.getElementById('gameDayEndModal'); if (old) old.remove();
        var lv = DAY_LEVELS[DAY_LEVELS.length - 1];
        for (var i = 0; i < DAY_LEVELS.length; i++) {
            if ((ds.score || 0) >= DAY_LEVELS[i].min) { lv = DAY_LEVELS[i]; break; }
        }
        var overlay = document.createElement('div');
        overlay.id = 'gameDayEndModal';
        overlay.className = 'game-modal-overlay';
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
        var modal = document.createElement('div');
        modal.className = 'game-modal';
        if (lv.confetti) {
            var cf = document.createElement('div');
            cf.className = 'game-confetti';
            makeConfetti(cf, 28);
            modal.appendChild(cf);
        }
        var emoEl = document.createElement('span');
        emoEl.className = 'game-modal-emoji';
        emoEl.innerHTML = '<i class="' + lv.iconClass + '" style="color:' + lv.iconColor + '"></i>';
        modal.appendChild(emoEl);
        var titleEl = document.createElement('div');
        titleEl.className = 'game-modal-title';
        titleEl.textContent = lv.title;
        modal.appendChild(titleEl);
        var scoreEl = document.createElement('div');
        scoreEl.className = 'game-modal-score';
        scoreEl.style.cssText = 'background:linear-gradient(135deg,' + lv.color + ',' + lv.color + '99);color:white;';
        scoreEl.innerHTML = 'Оценка: <strong>' + (ds.stars || '') + '</strong>';
        modal.appendChild(scoreEl);
        var msgEl = document.createElement('div');
        msgEl.className = 'game-modal-msg';
        msgEl.textContent = lv.msg;
        modal.appendChild(msgEl);
        var closeBtn = document.createElement('button');
        closeBtn.className = 'game-modal-btn';
        closeBtn.style.cssText = 'background:linear-gradient(135deg,' + lv.color + ',#0F766E);color:white;';
        closeBtn.textContent = '✓ Страхотно, продължавай!';
        closeBtn.onclick = function () { overlay.remove(); };
        modal.appendChild(closeBtn);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    // ── CSS injection ─────────────────────────────────────────────────────────
    // Inject game-bubble CSS if not already present (from plan.html)
    function injectGameCSS() {
        if (document.getElementById('gameSharedCSS')) return;
        var style = document.createElement('style');
        style.id = 'gameSharedCSS';
        style.textContent = [
            /* Game bubble */
            '.game-bubble{position:fixed;bottom:calc(152px + var(--safe-area-inset-bottom,0px));right:calc(18px + var(--safe-area-inset-right,0px));background:#ffffff;border-radius:20px 4px 20px 20px;width:300px;max-width:calc(100vw - 32px);box-shadow:0 12px 44px rgba(0,0,0,0.22),0 4px 12px rgba(13,148,136,0.18);z-index:950;animation:gsIn 0.5s cubic-bezier(0.34,1.56,0.64,1);border:1.5px solid rgba(13,148,136,0.22);overflow:hidden}',
            '[data-theme="dark"] .game-bubble{background:rgb(15,40,40)}',
            '.game-bubble.game-bubble--top{bottom:auto;top:calc(var(--safe-area-inset-top,0px) + 148px);border-radius:20px 4px 20px 20px}',
            '@keyframes gsIn{from{opacity:0;transform:scale(0.6) translateY(30px)}to{opacity:1;transform:scale(1) translateY(0)}}',
            '.game-bubble-header{background:linear-gradient(135deg,#0D9488 0%,#0F766E 100%);padding:10px 38px 10px 14px;display:flex;align-items:center;gap:8px;position:relative}',
            '.game-bubble-avatar{width:30px;height:30px;background:rgba(255,255,255,0.22);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}',
            '.game-bubble-greeting{color:white;font-size:0.77rem;font-weight:600;line-height:1.3;flex:1}',
            '.game-bubble-body{padding:14px 14px 12px}',
            '.game-bubble-q{font-size:0.94rem;font-weight:600;color:var(--text-dark,#0F2F2E);margin-bottom:14px;line-height:1.55;min-height:1.6em}',
            '.game-bubble-q.typing::after{content:"▌";animation:gsBlink 0.75s step-end infinite}',
            '@keyframes gsBlink{0%,100%{opacity:1}50%{opacity:0}}',
            '.game-bubble-answers{display:flex;gap:8px;flex-wrap:wrap;opacity:0;transform:translateY(8px);transition:opacity 0.3s ease,transform 0.3s ease}',
            '.game-bubble-answers.visible{opacity:1;transform:translateY(0)}',
            '.game-answer-btn{flex:1;min-width:80px;padding:10px 12px;border:none;border-radius:12px;font-size:0.88rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;transition:all 0.2s cubic-bezier(0.34,1.56,0.64,1);-webkit-tap-highlight-color:transparent}',
            '.game-answer-btn:active{transform:scale(0.88)}',
            '.game-answer-btn.yes{background:linear-gradient(135deg,#10b981,#059669);color:white;box-shadow:0 4px 12px rgba(16,185,129,0.35)}',
            '.game-answer-btn.no{background:linear-gradient(135deg,#f87171,#ef4444);color:white;box-shadow:0 4px 12px rgba(239,68,68,0.3)}',
            '.game-stars-wrap{display:flex;gap:7px;width:100%}',
            '.game-star-btn{flex:1;padding:9px 5px 8px;border:2px solid rgba(251,191,36,0.35);border-radius:12px;background:var(--card-bg,rgba(255,255,255,0.72));cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;transition:all 0.2s cubic-bezier(0.34,1.56,0.64,1);-webkit-tap-highlight-color:transparent}',
            '.game-star-btn:hover,.game-star-btn:focus{background:rgba(251,191,36,0.14);border-color:#fbbf24;transform:translateY(-3px);box-shadow:0 4px 12px rgba(251,191,36,0.28)}',
            '.game-star-btn:active{transform:scale(0.9)}',
            '.game-star-btn .star-icons{font-size:1rem;line-height:1;letter-spacing:-2px}',
            '.game-star-btn .star-label{font-size:0.68rem;font-weight:600;color:var(--text-light,#6b7280)}',
            '[data-theme="dark"] .game-star-btn{border-color:rgba(251,191,36,0.22)}',
            '.game-bubble-close{position:absolute;top:8px;right:9px;background:rgba(255,255,255,0.18);border:none;color:white;cursor:pointer;font-size:0.68rem;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;line-height:1;transition:background 0.15s}',
            '.game-bubble-close:hover{background:rgba(255,255,255,0.38)}',
            /* FAB raised + bounce */
            '@keyframes gsFabBounce{0%,100%{transform:translateY(0)}18%{transform:translateY(-10px)}36%{transform:translateY(-4px)}54%{transform:translateY(-8px)}72%{transform:translateY(-2px)}}',
            '.fab-chat.game-prompt{animation:gsFabBounce 1.1s ease-in-out 2,fabPulse 3s ease-in-out 2.2s infinite}',
            '.fab-chat.fab-raised{bottom:calc(100vh - var(--safe-area-inset-top,0px) - 80px - 56px)}',
            /* Encouragement toast */
            '.game-encourage-toast{position:fixed;bottom:calc(80px + var(--safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%) translateY(20px);background:var(--card-bg,rgba(255,255,255,0.97));border:1.5px solid var(--glass-border,rgba(13,148,136,0.1));backdrop-filter:blur(20px);border-radius:18px;padding:12px 18px;max-width:88vw;box-shadow:0 8px 28px rgba(0,0,0,0.16);z-index:960;font-size:0.88rem;font-weight:500;color:var(--text-dark,#0F2F2E);text-align:center;line-height:1.5;opacity:0;transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1);pointer-events:none}',
            '.game-encourage-toast.visible{opacity:1;transform:translateX(-50%) translateY(0)}',
            /* Day-end modal */
            '.game-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;animation:gsMFadeIn 0.3s ease}',
            '@keyframes gsMFadeIn{from{opacity:0}to{opacity:1}}',
            '.game-modal{background:var(--card-bg,rgba(255,255,255,0.97));border-radius:24px;padding:28px 22px 22px;max-width:340px;width:100%;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,0.3);animation:gsMPop 0.5s cubic-bezier(0.34,1.56,0.64,1);position:relative;overflow:hidden}',
            '@keyframes gsMPop{from{opacity:0;transform:scale(0.7) translateY(30px)}to{opacity:1;transform:scale(1) translateY(0)}}',
            '.game-modal-emoji{font-size:4.5rem;line-height:1;display:block;margin-bottom:10px;animation:gsMEmoji 0.65s cubic-bezier(0.34,1.56,0.64,1) 0.2s both}',
            '@keyframes gsMEmoji{from{opacity:0;transform:scale(0.3) translateY(20px)}to{opacity:1;transform:scale(1) translateY(0)}}',
            '.game-modal-title{font-size:1.25rem;font-weight:800;color:var(--text-dark,#0F2F2E);margin-bottom:6px}',
            '.game-modal-score{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 16px;font-weight:700;font-size:0.9rem;margin:7px auto}',
            '.game-modal-msg{font-size:0.9rem;color:var(--text-dark,#0F2F2E);opacity:0.82;line-height:1.6;margin:10px 0 18px}',
            '.game-modal-btn{padding:13px;border:none;border-radius:14px;font-size:0.92rem;font-weight:700;cursor:pointer;transition:opacity 0.15s;width:100%}',
            '.game-modal-btn:hover{opacity:0.88}',
            '.game-confetti{position:absolute;inset:0;pointer-events:none;overflow:hidden}',
            '.game-confetti span{position:absolute;top:-10px;animation:gsConfall linear both}',
            '@keyframes gsConfall{to{transform:translateY(110vh) rotate(720deg);opacity:0}}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ── Override FAB click to not navigate while a game bubble is showing ─────
    function hookFabClick() {
        var fab = document.querySelector('.fab-chat');
        if (!fab) return;
        var origOnclick = fab.onclick;
        fab.onclick = function (e) {
            // If a game bubble is open, block navigation
            if (document.getElementById('gameBubble')) return;
            if (origOnclick) origOnclick.call(this, e);
        };
    }

    // ── Initialise on DOMContentLoaded ────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        injectGameCSS();
        hookFabClick();
        if (!isGameEnabled()) return;
        setTimeout(function () {
            checkOpenAppPrompts();
            checkRetroEntry();
        }, 1600);
    });
})();
