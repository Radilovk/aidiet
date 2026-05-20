        // ── Current Analysis Loader ─────────────────────────────────────────────
        (function loadGameAnalytics() {
            var section = document.getElementById('gameAnalyticsSection');
            var body    = document.getElementById('gameAnalyticsBody');
            var badge   = document.getElementById('gameAnalyticsBadge');
            if (!section || !body) return;

            // Always expand the container on this page
            body.style.display = 'block';
            section.classList.add('open');
            var header = section.querySelector('.game-analytics-header');
            if (header) header.setAttribute('aria-expanded', 'true');

            var enabled = localStorage.getItem('gameEnabled') === 'true';
            if (!enabled) {
                body.innerHTML = '<div class="ga-no-data"><i class="fas fa-chart-bar"></i>Анализът не е активиран.<br>Активирайте го от страницата на плана.</div>';
                return;
            }

            // ── Helpers ───────────────────────────────────────────────────────
            function zp(n) { return n < 10 ? '0' + n : '' + n; }
            function dk(d)  { return d.getFullYear()+'-'+zp(d.getMonth()+1)+'-'+zp(d.getDate()); }
            var todayKey = dk(new Date());

            // ── Scoring constants (must match plan.html) ──────────────────────
            var FREE_MEAL_MIN_RATING   = 4;
            var JUNK_MAX_POINTS        = 20;
            var JUNK_PENALTY_PER_MEAL  = 7;

            var allData = {};
            try { allData = JSON.parse(localStorage.getItem('gameData') || '{}'); } catch(e) {}

            // Only past days + today (exclude future)
            var days = [];
            for (var i = 6; i >= 0; i--) {
                var dd = new Date(); dd.setDate(dd.getDate() - i);
                var key = dk(dd);
                if (key <= todayKey) {
                    days.push({ key: key, rec: allData[key] || null });
                }
            }

            // ── calcDayScore ──────────────────────────────────────────────────
            function calcDayScore(rec) {
                if (!rec) return { score:null, stars:'', label:'Без данни', junkCount:0, incorrectMeals:0, excessCalories:false, calorieBalance:'balanced', engPct:0, calorieDelta:0 };
                var meals = Object.keys(rec.meals || {});
                var mealPts = 0, mealMax = meals.length * 10;
                var incorrectMeals = 0;
                meals.forEach(function(m) {
                    // Free meals are treated the same as any other planned meal.
                    if (rec.meals[m] === true) mealPts += 10;
                });
                var junkCount = 0;
                var extraCalSum = 0;
                var freeMealCalSum = 0; // calories from free meal replacements (treated as normal allowed)
                (rec.extraMeals || []).forEach(function(em) {
                    var isConsumed = !em.isAddedToPlan || em.countCalories !== false;
                    if (em.isJunk && isConsumed && !em.isFreeMealReplacement) junkCount++;
                    if (em.isFreeMealReplacement) {
                        // Treat free meal calories as normal allowed (like lunch)
                        freeMealCalSum += (em.calories || 0);
                    } else if (em.isAddedToPlan && !em.countCalories) {
                    } else {
                        extraCalSum += (em.calories || 0);
                    }
                });
                var mealCalMap = rec.mealCalories || {};
                var completedPlanCals = 0;
                Object.keys(rec.meals || {}).forEach(function(mt) {
                    if (rec.meals[mt] && mealCalMap[mt]) completedPlanCals += mealCalMap[mt];
                });
                var totalConsumed = completedPlanCals + extraCalSum + freeMealCalSum;
                // Free meal calories expand the planned target equally so they don't cause surplus.
                var planned = rec.plannedCalories ? (rec.plannedCalories + freeMealCalSum) : null;
                var excessCalories = false, calorieBalance = 'balanced';
                var calorieDelta = 0;
                if (totalConsumed > 0 && planned && planned > 0) {
                    var excessPct = (totalConsumed - planned) / planned;
                    calorieDelta = Math.round(totalConsumed - planned);
                    if (excessPct > 0.10) { excessCalories = true; calorieBalance = 'surplus'; }
                    else if (excessPct > 0) { calorieBalance = 'surplus'; }
                    else if (excessPct < -0.10 && completedPlanCals > 0 && (rec.morningCheck || rec.eveningCheck)) {
                        calorieBalance = 'deficit';
                    }
                } else if (extraCalSum > 0 && (!planned || planned === 0)) {
                    calorieDelta = extraCalSum;
                    if (extraCalSum > 200) { excessCalories = true; calorieBalance = 'surplus'; }
                    else { calorieBalance = 'surplus'; }
                }
                var sleepPts    = rec.morningCheck  ? (rec.morningCheck.sleptWell ? 10 : 0) : null;
                var waterPts    = rec.eveningCheck  ? (rec.eveningCheck.waterIntake ? 10 : 0) : null;
                var activityPts = rec.eveningCheck  ? ([0,0,5,10][rec.eveningCheck.activityLevel] || 0) : null;
                var balancePts  = rec.eveningCheck  ? ([0,0,5,10][rec.eveningCheck.emotionalBalance] || 0) : null;
                var wellnessEarned = (sleepPts||0)+(waterPts||0)+(activityPts||0)+(balancePts||0);
                var allMealsOk = meals.length > 0 && meals.every(function(m) {
                    return rec.meals[m] === true;
                });
                var badSleep = rec.morningCheck && rec.morningCheck.sleptWell === false;
                var badWater = rec.eveningCheck && rec.eveningCheck.waterIntake === false;
                var lowActivity = rec.eveningCheck && rec.eveningCheck.activityLevel === 1;
                var lowBalance  = rec.eveningCheck && rec.eveningCheck.emotionalBalance === 1;
                var has5StarBlocker = !allMealsOk || incorrectMeals>0 || excessCalories || badSleep || badWater || lowActivity || lowBalance || junkCount>0;
                var done = meals.filter(function(m) {
                    return rec.meals[m]===true;
                }).length;
                var mealEngPct = meals.length>0 ? done/meals.length*50 : 0;
                var mornEngPct = rec.morningCheck ? 15 : 0;
                var eveEngPct  = rec.eveningCheck  ? 15 : 0;
                var hasAnyEngagement = mealEngPct > 0 || mornEngPct > 0 || eveEngPct > 0 || junkCount > 0 || incorrectMeals > 0;
                var junkPct    = hasAnyEngagement ? Math.max(0, JUNK_MAX_POINTS-(junkCount+incorrectMeals)*JUNK_PENALTY_PER_MEAL) : 0;
                var engPct     = Math.round(mealEngPct+mornEngPct+eveEngPct+junkPct);
                var totalMax = mealMax + 40;
                var totalEarned = mealPts + wellnessEarned;
                var score = null;
                if (totalMax > 0 && (totalEarned > 0 || meals.length > 0)) {
                    var pct = totalEarned / totalMax;
                    if      (pct >= 1.00 && !has5StarBlocker) score = 5;
                    else if (pct >= 0.80) score = 4;
                    else if (pct >= 0.55) score = 3;
                    else if (pct >= 0.30) score = 2;
                    else if (pct >  0)    score = 1;
                    if (score === 5 && has5StarBlocker) score = 4;
                    if (score !== null && score > 3 && (junkCount > 0 || excessCalories)) score = 3;
                    if (score !== null && score > 2 && junkCount > 0 && excessCalories) score = 2;
                }
                var starIcon='<i class="fas fa-star" style="color:#fbbf24;font-size:0.8em"></i>';
                var stars='';
                for (var _s=0;_s<(score||0);_s++) stars+=starIcon;
                var label='';
                if (score===null) { label=meals.length?'Без отбелязана активност':'Без данни'; }
                else if (score===5) label='Отличен резултат!';
                else if (score===4) label='Много добре!';
                else if (score===3) label='Добре';
                else if (score===2) label='Може по-добре';
                else label='Подобри се утре';
                if (incorrectMeals>0) label+=' ⚠ '+incorrectMeals+' неправилно хранене';
                if (junkCount>0) label+=' ('+junkCount+' вредни)';
                if (calorieBalance==='surplus'&&excessCalories) label+=' — излишни кал.';
                if (calorieBalance==='deficit') label+=' — кал. дефицит';
                return { score:score, stars:stars, label:label, junkCount:junkCount,
                         incorrectMeals:incorrectMeals, excessCalories:excessCalories,
                         calorieBalance:calorieBalance, engPct:engPct, calorieDelta:calorieDelta };
            }

            // ── Core metrics ──────────────────────────────────────────────────
            var weekScores = days.map(function(d){ return d.rec ? calcDayScore(d.rec) : null; });
            var validScores= weekScores.filter(function(s){ return s&&s.score!=null; });
            var avgScore   = days.length>0 ? Math.round(validScores.reduce(function(a,s){return a+s.score;},0)/days.length*10)/10 : 0;

            var engPcts = days.map(function(d){ return d.rec ? calcDayScore(d.rec).engPct : null; });
            var noDataDaysCount = days.filter(function(d){ return !d.rec; }).length;
            var engForAvg = days.map(function(d){ return d.rec ? calcDayScore(d.rec).engPct : 0; });
            var engagementPct = Math.round(engForAvg.reduce(function(a,b){return a+b;},0)/days.length);

            var extraCalsByDay = days.map(function(d){
                if(!d.rec||!d.rec.extraMeals) return null;
                return d.rec.extraMeals.reduce(function(s,em){
                    if (em.isFreeMealReplacement) return s;
                    if (em.isAddedToPlan && !em.countCalories) return s;
                    return s+(em.calories||0);
                },0);
            });
            var totalExtraCals = extraCalsByDay.reduce(function(s,v){return s+(v||0);},0);

            var calBalanceByDay = days.map(function(d){
                if (!d.rec) return null;
                return calcDayScore(d.rec).calorieDelta;
            });
            var netCalBalance = calBalanceByDay.reduce(function(s,v){return s+(v||0);},0);

            var calConsumedByDay = days.map(function(d){
                if (!d.rec) return null;
                var mealCalMap = d.rec.mealCalories || {};
                var completedCals = Object.keys(d.rec.meals || {}).reduce(function(sum, mt){
                    return sum + (d.rec.meals[mt] && mealCalMap[mt] ? mealCalMap[mt] : 0);
                }, 0);
                var extraCals = (d.rec.extraMeals || []).reduce(function(sum, em){
                    if (em.isFreeMealReplacement) return sum; // tracked via plan meals
                    if (em.isAddedToPlan && !em.countCalories) return sum; // added to plan but unchecked
                    return sum + (em.calories || 0);
                }, 0);
                var total = completedCals + extraCals;
                return total > 0 ? total : null;
            });
            var calPlannedByDay = days.map(function(d){
                return d.rec ? (d.rec.plannedCalories || null) : null;
            });
            var calAdherencePct = (function(){
                var vals = [];
                calConsumedByDay.forEach(function(consumed, idx){
                    if (!consumed) return;
                    var plan = calPlannedByDay[idx];
                    if (!plan) return;
                    vals.push(Math.min(100, Math.round(consumed / plan * 100)));
                });
                return vals.length > 0
                    ? Math.round(vals.reduce(function(a,b){return a+b;},0) / vals.length)
                    : null;
            })();

            var incorrectMealsCount7 = 0;
            days.forEach(function(d){
                if (d.rec) {
                    var ds = calcDayScore(d.rec);
                    incorrectMealsCount7 += ds.incorrectMeals || 0;
                }
            });

            var balanceByDay = days.map(function(d){
                if(!d.rec||!d.rec.eveningCheck||d.rec.eveningCheck.emotionalBalance==null) return null;
                return Math.round((d.rec.eveningCheck.emotionalBalance-1)/2*100);
            });
            var balanceValid = balanceByDay.filter(function(v){return v!==null;});
            var balancePct = balanceValid.length>0 ? Math.round(balanceValid.reduce(function(a,b){return a+b;},0)/balanceValid.length) : null;

            var sleepByDay = days.map(function(d){
                if(!d.rec||!d.rec.morningCheck||d.rec.morningCheck.sleptWell==null) return null;
                return d.rec.morningCheck.sleptWell ? 100 : 0;
            });
            var sleepValid = sleepByDay.filter(function(v){return v!==null;});
            var sleepPct = sleepValid.length>0 ? Math.round(sleepValid.reduce(function(a,b){return a+b;},0)/sleepValid.length) : null;

            var actByDay = days.map(function(d){
                if(!d.rec||!d.rec.eveningCheck||d.rec.eveningCheck.activityLevel==null) return null;
                return Math.round((d.rec.eveningCheck.activityLevel-1)/2*100);
            });
            var actValid = actByDay.filter(function(v){return v!==null;});
            var actPct = actValid.length>0 ? Math.round(actValid.reduce(function(a,b){return a+b;},0)/actValid.length) : null;

            var waterByDay = days.map(function(d){
                if(!d.rec||!d.rec.eveningCheck||d.rec.eveningCheck.waterIntake==null) return null;
                return d.rec.eveningCheck.waterIntake===true ? 100 : 0;
            });
            var waterValid = waterByDay.filter(function(v){return v!==null;});
            var waterPct = waterValid.length>0 ? Math.round(waterValid.reduce(function(a,b){return a+b;},0)/waterValid.length) : null;

            var junkCount7=0;
            days.forEach(function(d){ ((d.rec&&d.rec.extraMeals)||[]).forEach(function(em){
                var isConsumed = !em.isAddedToPlan || em.countCalories !== false;
                if(em.isJunk && isConsumed) junkCount7++;
            }); });

            var pastScores = weekScores.slice(0, weekScores.length - 1);
            var firstHalf = pastScores.slice(0,Math.floor(pastScores.length/2)).filter(function(s){ return s&&s.score!=null; });
            var lastHalf  = pastScores.slice(Math.ceil(pastScores.length/2)).filter(function(s){ return s&&s.score!=null; });
            var trendUp   = lastHalf.length>0&&firstHalf.length>0 &&
                (lastHalf.reduce(function(a,s){return a+s.score;},0)/lastHalf.length) >
                (firstHalf.reduce(function(a,s){return a+s.score;},0)/firstHalf.length + 0.3);
            var trendDown = lastHalf.length>0&&firstHalf.length>0 &&
                (firstHalf.reduce(function(a,s){return a+s.score;},0)/firstHalf.length) >
                (lastHalf.reduce(function(a,s){return a+s.score;},0)/lastHalf.length + 0.3);

            var INCORRECT_MEAL_ENG_PENALTY  = 5;
            var INCORRECT_MEAL_CAL_PENALTY  = 10;
            var healthScore = 0;
            var totalWeight = 0.35;
            var adjustedEngPct = Math.max(0, engagementPct - incorrectMealsCount7 * INCORRECT_MEAL_ENG_PENALTY);
            healthScore += adjustedEngPct * 0.35;
            if(sleepPct!=null){ healthScore += sleepPct * 0.25; totalWeight += 0.25; }
            if(balancePct!=null){ healthScore += balancePct * 0.2; totalWeight += 0.2; }
            if(actPct!=null){ healthScore += actPct * 0.2; totalWeight += 0.2; }
            var totalCalsWeight = Math.max(0, 100 - Math.round(totalExtraCals/700*100));
            totalCalsWeight = Math.max(0, totalCalsWeight - incorrectMealsCount7 * INCORRECT_MEAL_CAL_PENALTY);
            healthScore += totalCalsWeight * 0.05; totalWeight += 0.05;
            healthScore = Math.round(Math.max(0, Math.min(100, healthScore / totalWeight)));

            // ── Correlation insights ──────────────────────────────────────────
            var insights = [];
            var sleepGoodEng=[], sleepBadEng=[];
            days.forEach(function(d,i){
                if(sleepByDay[i]!=null&&engPcts[i]!=null){
                    if(sleepByDay[i]===100) sleepGoodEng.push(engPcts[i]);
                    else sleepBadEng.push(engPcts[i]);
                }
            });
            if(sleepGoodEng.length>0&&sleepBadEng.length>0){
                var sgAvg=Math.round(sleepGoodEng.reduce(function(a,b){return a+b;},0)/sleepGoodEng.length);
                var sbAvg=Math.round(sleepBadEng.reduce(function(a,b){return a+b;},0)/sleepBadEng.length);
                if(sgAvg-sbAvg>15) insights.push('<i class="fas fa-bed" style="color:#6366f1"></i> В дните с добър сън ангажираността ви е <strong>'+sgAvg+'%</strong> (vs '+sbAvg+'% без добър сън)');
            }
            var lowBalanceDays  = days.filter(function(d,i){ return balanceByDay[i]!=null&&balanceByDay[i]<=40; });
            var highBalanceDays = days.filter(function(d,i){ return balanceByDay[i]!=null&&balanceByDay[i]>=60; });
            var lbJunk = lowBalanceDays.reduce(function(s,d){return s+((d.rec&&d.rec.extraMeals||[]).filter(function(e){
                var isConsumed = !e.isAddedToPlan || e.countCalories !== false;
                return e.isJunk && isConsumed;
            }).length);},0);
            var hbJunk = highBalanceDays.reduce(function(s,d){return s+((d.rec&&d.rec.extraMeals||[]).filter(function(e){
                var isConsumed = !e.isAddedToPlan || e.countCalories !== false;
                return e.isJunk && isConsumed;
            }).length);},0);
            if(lowBalanceDays.length>0&&hbJunk===0&&lbJunk>0) insights.push('<i class="fas fa-heart-pulse" style="color:#f59e0b"></i> В дните с нисък емоционален баланс се появяват повече вредни хранения — стресът влияе на избора ви');
            else if(lowBalanceDays.length>0&&hbJunk<lbJunk) insights.push('<i class="fas fa-heart-pulse" style="color:#f59e0b"></i> Забелязваме повече вредни хранения в дни с по-нисък емоционален баланс');
            var streak=0, currentStreak=0;
            var streakStart = days.length - 1;
            if (streakStart >= 0 && days[streakStart].key === todayKey &&
                    (!days[streakStart].rec || calcDayScore(days[streakStart].rec).score === null)) {
                streakStart--;
            }
            for(var si=streakStart;si>=0;si--){
                if(days[si].rec&&calcDayScore(days[si].rec).score>=4){ streak++; currentStreak=Math.max(currentStreak,streak); } else break;
            }
            if(currentStreak>=3) insights.push('<i class="fas fa-fire" style="color:#f59e0b"></i> Имате текуща серия от <strong>'+currentStreak+' отлични дни</strong> подред! Продължавайте!');
            else if(currentStreak===2) insights.push('<i class="fas fa-bolt" style="color:#0D9488"></i> Два отлични дни подред — вие сте в страхотен ритъм!');
            var deficitDays = days.filter(function(d,i){
                return calBalanceByDay[i]!==null && calBalanceByDay[i]<-100 && d.rec && (d.rec.morningCheck||d.rec.eveningCheck);
            });
            if(deficitDays.length>=2){
                insights.push('<i class="fas fa-arrow-down" style="color:#3b82f6"></i> '+deficitDays.length+' дни с калориен дефицит — следете дали приемате достатъчно хранителни вещества за постигане на целите си');
            } else if(deficitDays.length===1){
                insights.push('<i class="fas fa-arrow-down" style="color:#3b82f6"></i> 1 ден с калориен дефицит — следете дали приемате достатъчно хранителни вещества');
            }
            if(deficitDays.length>=2){
                var deficitLowAct=deficitDays.filter(function(d){ return d.rec&&d.rec.eveningCheck&&d.rec.eveningCheck.activityLevel===1; }).length;
                if(deficitLowAct>=Math.ceil(deficitDays.length/2)) insights.push('<i class="fas fa-bolt" style="color:#3b82f6"></i> В дните с калориен дефицит активността е по-ниска — ниският калориен прием влияе на енергийните нива');
            }

            // ── Scenario / Prediction ─────────────────────────────────────────
            var scenario = null;
            if(validScores.length>=3){
                var projected = Math.min(5, Math.round((avgScore + (trendUp?0.5:trendDown?-0.3:0))*10)/10);
                if(trendUp && projected>=4) scenario = '<i class="fas fa-chart-line" style="color:#10b981"></i> Ако запазите текущата тенденция, ще достигнете средна оценка <strong>'+projected+'/5</strong> за седмицата — отлично!';
                else if(trendDown) scenario = '<i class="fas fa-chart-line" style="color:#ef4444;transform:rotate(90deg);display:inline-block"></i> Наблюдаваме спад в последните дни. Малко повече внимание към плана ще обърне тенденцията.';
                else if(avgScore>=4) scenario = '<i class="fas fa-star" style="color:#fbbf24"></i> Стабилна и силна седмица! Ако запазите ритъма, ще затвърдите навиците дългосрочно.';
                else if(engagementPct<50) scenario = '<i class="fas fa-lightbulb" style="color:#0D9488"></i> Увеличете ангажираността с 20% (отбелязвайте хранения редовно) и оценката ви ще скочи значително.';
            }

            // ── Alerts ────────────────────────────────────────────────────────
            var alerts = [];
            var missedLast2 = days.slice(-2).filter(function(d){
                if (!d.rec) return true;
                var s = calcDayScore(d.rec);
                return s.score !== null && s.score < 2;
            });
            if(missedLast2.length>=2) alerts.push('<i class="fas fa-triangle-exclamation" style="color:#f59e0b"></i> Последните 2 дни имате ниска ангажираност — проверете дали имате нужда от промяна в плана.');
            if(junkCount7>=4) alerts.push('<i class="fas fa-circle-exclamation" style="color:#ef4444"></i> Открихме '+junkCount7+' вредни хранения за седмицата. Опитайте да намалите до 1-2 максимум.');
            if(incorrectMealsCount7>0) alerts.push('<i class="fas fa-exclamation-circle" style="color:#ef4444"></i> '+incorrectMealsCount7+' неправилно свободно хранене за седмицата — нискокачествените замени снижават здравния ви индекс.');
            if(sleepPct!=null&&sleepPct<30) alerts.push('<i class="fas fa-triangle-exclamation" style="color:#f59e0b"></i> Качеството на съня е ниско тази седмица — това пряко влияе на метаболизма и избора на храна.');

            // ── Encouragement ─────────────────────────────────────────────────
            var leadingCriterion='', encourageText='<i class="fas fa-dumbbell" style="color:#0D9488"></i> Последователността е ключът към успеха!';
            if      (junkCount7>2)                     { leadingCriterion='Вредни храни'; encourageText='<i class="fas fa-leaf" style="color:#10b981"></i> Намалете вредните храни — планът работи когато го следвате!'; }
            else if (sleepPct!=null&&sleepPct<50)      { leadingCriterion='Сън';          encourageText='<i class="fas fa-bed" style="color:#6366f1"></i> Добрият сън е основата. Лягайте по-рано — тялото ви ще ви благодари!'; }
            else if (engagementPct<60)                 { leadingCriterion='';             encourageText='<i class="fas fa-check-circle" style="color:#10b981"></i> Спазвайте храненията по план — резултатите идват!'; }
            else if (balancePct!=null&&balancePct<40)  { leadingCriterion='Баланс';       encourageText='<i class="fas fa-person-walking" style="color:#0D9488"></i> Малко движение прави голяма разлика. Дори 15 минути помагат!'; }
            else if (engagementPct>=90)                { leadingCriterion='Отлично';      encourageText='<i class="fas fa-trophy" style="color:#fbbf24"></i> Страхотно! Продължавайте в същия дух — резултатите идват!'; }
            if (badge) badge.textContent = leadingCriterion || (validScores.length+' дни');

            // ── Explanation modal ─────────────────────────────────────────────
            var EXPLANATIONS = {
                engagement: { title:'Ангажираност към плана',
                    text:'Изчислява се всеки ден от 4 компонента:\n• Спазени хранения (50 т.)\n• Сутрешен чек-ин (15 т.)\n• Вечерен чек-ин (15 т.)\n• Без вредни храни (20 т.)\n\nСедмичният % е средна стойност (дни без данни = 0%).\nЦел: 80%+' },
                calories: { title:'Калориен баланс',
                    text:'Показва приетите калории спрямо дневния ви таргет за последните дни.\n\nВизуализация:\n• Хоризонталната линия = заложен калориен таргет\n• Лента достигаща линията = балансиран ден\n• Лента НАД линията (оранжево/червено) = излишък от калории\n• Лента ПОД линията (синьо) = калориен дефицит\n\nДефицитът се регистрира само когато са отбелязани хранения И е попълнен поне един въпросник (сутрешен или вечерен).' },
                stress: { title:'Емоционален баланс',
                    text:'Изчислява се от вечерния въпрос "Емоционален баланс".\n\n• Баланс Отлично → 100%\n• Баланс Добре → 50%\n• Баланс Слабо → 0%\n\nПо-висок % = по-добре.\nЦел: 70%+\n\nВисок емоционален баланс означава нисък стрес и по-добро самочувствие.' },
                sleep: { title:'Качество на съня',
                    text:'Изчислява се от сутрешния въпрос "Спахте ли добре?".\n\nФормула: брой "Да" ÷ общо отговори × 100%\n\nПо-висок % = по-добре.\nЦел: 70%+' },
                activity: { title:'Активност',
                    text:'Изчислява се от вечерния въпрос "Ниво на активност".\n\n• Слабо → 0%\n• Добре → 50%\n• Отлично → 100%\n\nПо-висок % = по-добре.' },
                health: { title:'Здравен Индекс',
                    text:'Композитна оценка, изчислена от всички ваши данни:\n\n• Ангажираност: 35%\n• Сън: 25%\n• Активност: 20%\n• Емоционален баланс: 20%\n\nЦел: 70+' }
            };
            function showExplanation(key) {
                var info = EXPLANATIONS[key]; if(!info) return;
                var old = document.getElementById('gameExplainOverlay'); if(old) old.remove();
                var overlay = document.createElement('div');
                overlay.id = 'gameExplainOverlay'; overlay.className = 'game-explain-overlay';
                overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.remove(); });
                var box = document.createElement('div'); box.className = 'game-explain-box';
                var t = document.createElement('div'); t.className='game-explain-title'; t.textContent=info.title;
                var tx= document.createElement('div'); tx.className='game-explain-text'; tx.style.whiteSpace='pre-line'; tx.textContent=info.text;
                var cb= document.createElement('button'); cb.className='game-explain-close'; cb.textContent='Разбрах';
                cb.onclick=function(){ overlay.remove(); };
                box.appendChild(t); box.appendChild(tx); box.appendChild(cb);
                overlay.appendChild(box); document.body.appendChild(overlay);
            }

            // ── Render helpers ────────────────────────────────────────────────
            function pBar(pct, color) {
                if (pct==null) return '<span style="font-size:0.75rem;color:var(--text-light)">Няма данни</span>';
                return '<div class="game-index-bar-wrap"><div class="game-index-bar" style="width:0%;background:'+color+'" data-ga-bar="'+Math.min(100,Math.max(0,pct))+'"></div></div>';
            }
            var DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
            var BAR_MIN_H = 4;
            var BAR_MAX_H = 36;
            var LABEL_STYLE = 'font-size:0.6rem;color:var(--text-light)';
            function miniBarCol(barStyle, label, dataAttr) {
                return '<div class="game-day-col">' +
                    '<div class="game-day-dot" style="' + barStyle + '"' + (dataAttr ? ' ' + dataAttr : '') + '></div>' +
                    '<span style="' + LABEL_STYLE + '">' + label + '</span>' +
                    '</div>';
            }
            function miniBarChart(perDayValues, maxVal, color) {
                var cols = perDayValues.map(function(v,idx){
                    var dow   = new Date(days[idx].key).getDay();
                    var label = DAY_NAMES[(dow+6)%7];
                    if(v==null || v===0) return miniBarCol('height:'+BAR_MIN_H+'px;background:rgba(156,163,175,0.25)', label);
                    var pct2 = maxVal>0?Math.min(100,Math.round(v/maxVal*100)):0;
                    var h    = Math.max(BAR_MIN_H, Math.round(pct2*BAR_MAX_H/100));
                    return miniBarCol('height:'+BAR_MIN_H+'px;background:'+color, label, 'data-ga-bar-h="'+h+'px"');
                });
                return '<div class="game-day-dots">'+ cols.join('') +'</div>';
            }
            function calTargetBarChart(perDayConsumed, perDayPlanned, surplusColor, deficitColor) {
                var DEFAULT_SURPLUS_THRESHOLD = 200;
                var LABEL_AREA = 14;
                var planVals = perDayPlanned.filter(function(v){ return v != null && v > 0; });
                var avgPlanned = planVals.length > 0
                    ? Math.round(planVals.reduce(function(a,b){return a+b;},0) / planVals.length)
                    : 2000;
                var TARGET_BAR_PX = Math.round(BAR_MAX_H * 2 / 3);
                var targetLineBottom = LABEL_AREA + TARGET_BAR_PX;
                var cols = perDayConsumed.map(function(v, idx) {
                    var dow   = new Date(days[idx].key).getDay();
                    var label = DAY_NAMES[(dow+6)%7];
                    if (v == null) return miniBarCol('height:'+BAR_MIN_H+'px;background:rgba(156,163,175,0.2)', label);
                    var consumed = v;
                    var dayPlanned = perDayPlanned[idx] || avgPlanned;
                    var isOverTarget = dayPlanned > 0 ? consumed > dayPlanned : consumed > DEFAULT_SURPLUS_THRESHOLD;
                    var color = isOverTarget ? surplusColor : deficitColor;
                    var pct = dayPlanned > 0 ? consumed / dayPlanned : 0;
                    var h = consumed > 0 ? Math.max(BAR_MIN_H, Math.min(BAR_MAX_H, Math.round(pct * TARGET_BAR_PX))) : BAR_MIN_H;
                    return miniBarCol('height:'+BAR_MIN_H+'px;background:'+color, label, 'data-ga-bar-h="'+h+'px"');
                });
                return '<div class="game-day-dots-cal">' +
                    '<div class="game-cal-target-line" style="bottom:'+targetLineBottom+'px"></div>' +
                    cols.join('') +
                '</div>';
            }
            function ringChart(pct, color, r) {
                r = r||26; var circ=2*Math.PI*r;
                var offset = circ - (pct||0)/100*circ;
                return '<svg class="game-ring-svg" width="'+(r*2+8)+'" height="'+(r*2+8)+'" viewBox="0 0 '+(r*2+8)+' '+(r*2+8)+'">' +
                    '<circle class="game-ring-bg" cx="'+(r+4)+'" cy="'+(r+4)+'" r="'+r+'" stroke-width="5"/>' +
                    '<circle class="game-ring-fg" cx="'+(r+4)+'" cy="'+(r+4)+'" r="'+r+'" stroke-width="5" stroke="'+color+'" stroke-dasharray="'+circ+'" stroke-dashoffset="'+circ+'" data-ga-ring-offset="'+offset.toFixed(2)+'"/>' +
                    '<text x="'+(r+4)+'" y="'+(r+4)+'" text-anchor="middle" dominant-baseline="central" style="fill:var(--text-dark);font-size:'+(r>24?'0.9':'0.78')+'rem;font-weight:700;transform:rotate(90deg);transform-origin:'+(r+4)+'px '+(r+4)+'px" data-ga-ring-count="'+(pct!=null?pct:'')+'" data-ga-ring-target="'+(pct!=null?pct:'')+'" >'+(pct!=null?'0%':'?')+'</text>' +
                    '</svg>';
            }

            // ── Build HTML ────────────────────────────────────────────────────
            var html = '';
            var weekIconClass = avgScore>=4.5?'fas fa-trophy':avgScore>=3.5?'fas fa-bullseye':avgScore>=2.5?'fas fa-chart-line':'fas fa-seedling';
            var weekIconColor = avgScore>=4.5?'#fde68a':avgScore>=3.5?'rgba(255,255,255,0.95)':avgScore>=2.5?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.75)';
            var weekStarsHtml = (function() {
                var s = '';
                var full = Math.floor(avgScore);
                var half = (avgScore - full) >= 0.5;
                for (var si = 0; si < full; si++) s += '<i class="fas fa-star" style="color:#fbbf24;font-size:0.9em"></i>';
                if (half) s += '<i class="fas fa-star-half-alt" style="color:#fbbf24;font-size:0.9em"></i>';
                var empty = 5 - full - (half ? 1 : 0);
                for (var si = 0; si < empty; si++) s += '<i class="far fa-star" style="color:rgba(255,255,255,0.45);font-size:0.9em"></i>';
                return s;
            })();

            html += '<div class="game-week-card ga-card-enter" style="animation-delay:0s">' +
                '<div class="game-week-icon"><i class="'+weekIconClass+'" style="color:'+weekIconColor+'"></i></div>' +
                '<div class="game-week-info">' +
                    '<div class="game-week-title">Текуща седмица</div>' +
                    '<div class="game-week-score">'+weekStarsHtml+'</div>' +
                    '<div class="game-week-sub">Ангажираност: '+engagementPct+'% · '+validScores.length+' '+(validScores.length===1?'ден':'дни')+' данни'+(noDataDaysCount>0?' · '+noDataDaysCount+' без данни':'')+' </div>' +
                    '<div class="game-week-dots">' +
                    weekScores.map(function(s){
                        var bg = (s&&s.score!=null)?(s.score>=4?'rgba(255,255,255,0.9)':s.score>=3?'rgba(251,191,36,0.85)':'rgba(248,113,113,0.8)'):'rgba(255,255,255,0.18)';
                        return '<div class="game-week-dot" style="background:'+bg+'" title="'+(s&&s.score!=null?s.label:'Няма данни')+'"></div>';
                    }).join('') +
                    '</div>' +
                '</div>' +
            '</div>';

            html += '<div class="game-health-ring-row ga-card-enter" style="animation-delay:0.1s">' +
                '<div class="game-ring-wrap" data-explain="health" style="cursor:pointer">' + ringChart(healthScore,'#0D9488',22) + '<div class="game-ring-label">Здраве</div></div>' +
                (actPct!=null  ? '<div class="game-ring-wrap" data-explain="activity" style="cursor:pointer">' + ringChart(actPct,'#f59e0b',22) + '<div class="game-ring-label">Активност</div></div>' : '') +
                (sleepPct!=null ? '<div class="game-ring-wrap" data-explain="sleep" style="cursor:pointer">' + ringChart(sleepPct,'#6366f1',22) + '<div class="game-ring-label">Сън</div></div>' : '') +
                (balancePct!=null ? '<div class="game-ring-wrap" data-explain="stress" style="cursor:pointer">' + ringChart(balancePct,'#10b981',22) + '<div class="game-ring-label">Емоции</div></div>' : '') +
            '</div>';

            if(trendUp)   html += '<div class="ga-card-enter" style="text-align:center;font-size:0.78rem;color:#10b981;font-weight:600;margin-bottom:10px;animation-delay:0.18s"><i class="fas fa-chart-line"></i> Тенденцията е нагоре — вие се подобрявате!</div>';
            if(trendDown) html += '<div class="ga-card-enter" style="text-align:center;font-size:0.78rem;color:#ef4444;font-weight:600;margin-bottom:10px;animation-delay:0.18s"><i class="fas fa-chart-line" style="transform:rotate(90deg)"></i> Леко затихване — малко повече фокус ще промени всичко</div>';

            if(alerts.length>0){
                alerts.forEach(function(a, ai){ html += '<div class="game-alert-card ga-card-enter" style="animation-delay:'+(0.22+ai*0.06)+'s">'+a+'</div>'; });
            }

            html += '<div class="game-metrics-toggle ga-card-enter" style="animation-delay:0.28s" id="gameMetricsToggle" onclick="toggleDetailedMetrics()" role="button" tabindex="0" aria-expanded="true" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleDetailedMetrics();}">' +
                '<div class="game-section-title" style="margin:0">Подробни данни</div>' +
                '<i class="fas fa-chevron-down game-metrics-chevron" id="gameMetricsChevron" style="transform:rotate(180deg)"></i>' +
            '</div>';
            html += '<div id="gameMetricsDetails" style="display:block;">';

            html += '<div class="game-index-row" data-explain="engagement">' +
                '<div class="game-index-label"><span><i class="fas fa-utensils" style="color:#0D9488"></i> Ангажираност</span><span>'+engagementPct+'%</span></div>' +
                '<div class="game-index-hint">'+(engagementPct>=80?'<i class="fas fa-check-circle" style="color:#10b981"></i> Отлично':engagementPct>=60?'<i class="fas fa-circle" style="color:#f59e0b"></i> Добре':'<i class="fas fa-circle" style="color:#ef4444"></i> Нисък')+' · Дневен % (хранения + чек-ини) · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(engagementPct,'linear-gradient(90deg,#0D9488,#06B6D4)') + miniBarChart(engPcts,100,'#0D9488') +
            '</div>';

            var hasDeficit = calBalanceByDay.some(function(v){ return v!==null && v<-50; });
            var calBalanceLabel;
            if (netCalBalance === 0 && !hasDeficit) {
                calBalanceLabel = '<i class="fas fa-check-circle" style="color:#10b981"></i> Балансиран';
            } else if (netCalBalance > 0) {
                calBalanceLabel = netCalBalance < 700
                    ? '<i class="fas fa-circle" style="color:#f59e0b"></i> Нетен излишък'
                    : '<i class="fas fa-circle" style="color:#ef4444"></i> Голям излишък';
            } else {
                calBalanceLabel = '<i class="fas fa-arrow-down" style="color:#3b82f6"></i> Нетен дефицит';
            }
            html += '<div class="game-index-row" data-explain="calories">' +
                '<div class="game-index-label"><span><i class="fas fa-scale-balanced" style="color:#f59e0b"></i> Калориен баланс</span><span>'+(netCalBalance>0?'+':'')+netCalBalance+' kcal</span></div>' +
                '<div class="game-index-hint">'+calBalanceLabel+' · Нетен калориен баланс · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(calAdherencePct, netCalBalance>700?'linear-gradient(90deg,#ef4444,#f97316)':netCalBalance>0?'linear-gradient(90deg,#f59e0b,#fbbf24)':'linear-gradient(90deg,#3b82f6,#06B6D4)') +
                calTargetBarChart(calConsumedByDay, calPlannedByDay, netCalBalance>700?'#ef4444':'#f59e0b', '#3b82f6') +
            '</div>';

            if(balancePct!=null) html += '<div class="game-index-row" data-explain="stress">' +
                '<div class="game-index-label"><span><i class="fas fa-heart-pulse" style="color:#10b981"></i> Емоционален баланс</span><span>'+balancePct+'%</span></div>' +
                '<div class="game-index-hint">'+(balancePct>=70?'<i class="fas fa-check-circle" style="color:#10b981"></i> Висок баланс':balancePct>=40?'<i class="fas fa-circle" style="color:#f59e0b"></i> Умерен':'<i class="fas fa-circle" style="color:#ef4444"></i> Нисък баланс')+' · По-висок % = по-добре · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(balancePct,'linear-gradient(90deg,#10b981,#06B6D4)') + miniBarChart(balanceByDay,100,'#10b981') +
            '</div>';

            if(sleepPct!=null) html += '<div class="game-index-row" data-explain="sleep">' +
                '<div class="game-index-label"><span><i class="fas fa-bed" style="color:#6366f1"></i> Сън</span><span>'+sleepPct+'%</span></div>' +
                '<div class="game-index-hint">'+(sleepPct>=70?'<i class="fas fa-check-circle" style="color:#10b981"></i> Добър сън':sleepPct>=40?'<i class="fas fa-circle" style="color:#f59e0b"></i> Умерен':'<i class="fas fa-circle" style="color:#ef4444"></i> Нисък')+' · По-висок % = по-добре · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(sleepPct,'linear-gradient(90deg,#6366f1,#8b5cf6)') + miniBarChart(sleepByDay,100,'#6366f1') +
            '</div>';

            if(actPct!=null) html += '<div class="game-index-row" data-explain="activity">' +
                '<div class="game-index-label"><span><i class="fas fa-person-walking" style="color:#f59e0b"></i> Активност</span><span>'+actPct+'%</span></div>' +
                '<div class="game-index-hint">'+(actPct>=70?'<i class="fas fa-check-circle" style="color:#10b981"></i> Висока':actPct>=40?'<i class="fas fa-circle" style="color:#f59e0b"></i> Умерена':'<i class="fas fa-circle" style="color:#ef4444"></i> Ниска')+' · По-висок % = по-добре · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(actPct,'linear-gradient(90deg,#f59e0b,#fbbf24)') + miniBarChart(actByDay,100,'#f59e0b') +
            '</div>';

            if(waterPct!=null) html += '<div class="game-index-row" data-explain="water">' +
                '<div class="game-index-label"><span><i class="fas fa-droplet" style="color:#06B6D4"></i> Хидратация</span><span>'+waterPct+'%</span></div>' +
                '<div class="game-index-hint">'+(waterPct>=70?'<i class="fas fa-check-circle" style="color:#10b981"></i> Добра':waterPct>=40?'<i class="fas fa-circle" style="color:#f59e0b"></i> Умерена':'<i class="fas fa-circle" style="color:#ef4444"></i> Ниска')+' · Дни с достатъчен прием вода · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(waterPct,'linear-gradient(90deg,#06B6D4,#0284C7)') + miniBarChart(waterByDay,100,'#06B6D4') +
            '</div>';

            if(noDataDaysCount>0) html += '<div class="game-no-data-note"><i class="fas fa-calendar-xmark"></i> ' + noDataDaysCount + ' ' + (noDataDaysCount===1?'ден':'дни') + ' без отбелязана активност (отчетени като 0%)</div>';

            if(insights.length>0){
                html += '<div class="game-section-title">Корелации &amp; открития</div>';
                insights.forEach(function(ins, ii){ html += '<div class="game-insight-card ga-card-enter" style="animation-delay:'+(0.05+ii*0.08)+'s">'+ins+'</div>'; });
            }

            if(scenario){
                html += '<div class="game-section-title">Прогноза</div>';
                html += '<div class="game-scenario-card ga-card-enter" style="animation-delay:0.1s"><div class="game-scenario-label">AI сценарий</div>'+scenario+'</div>';
            }

            html += '<div class="game-encourage-note ga-card-enter" style="animation-delay:0.15s">'+encourageText+'</div>';

            var weeklyInfo={};
            try { weeklyInfo=JSON.parse(localStorage.getItem('gameWeeklyAI')||'{}'); } catch(e) {}
            if(weeklyInfo.nextDue){ var nd=new Date(weeklyInfo.nextDue); html += '<div class="game-weekly-info"><i class="fas fa-robot"></i> Следващ AI анализ: '+nd.toLocaleDateString('bg-BG')+'</div>'; }

            html += '</div>'; // close gameMetricsDetails

            body.innerHTML = html;

            // ── Trigger entrance animations after DOM is painted ─────────────
            var GA_RING_START   = 120;
            var GA_RING_STAGGER = 130;
            var GA_RING_COUNTER = 900;
            var GA_BAR_START    = 350;
            var GA_BAR_STAGGER  = 60;
            var GA_CHART_START  = 400;
            var GA_CHART_STAGGER= 25;
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    body.querySelectorAll('[data-ga-ring-offset]').forEach(function(el, i) {
                        setTimeout(function() {
                            el.style.strokeDashoffset = el.getAttribute('data-ga-ring-offset');
                        }, GA_RING_START + i * GA_RING_STAGGER);
                    });

                    body.querySelectorAll('[data-ga-ring-target]').forEach(function(el, i) {
                        var target = parseInt(el.getAttribute('data-ga-ring-target'), 10);
                        if (isNaN(target)) { el.textContent = '?'; return; }
                        var start = GA_RING_START + i * GA_RING_STAGGER;
                        var duration = GA_RING_COUNTER;
                        var startTime = null;
                        function step(ts) {
                            if (!startTime) startTime = ts;
                            var elapsed = ts - startTime;
                            if (elapsed < 0) { requestAnimationFrame(step); return; }
                            var progress = Math.min(elapsed / duration, 1);
                            var ease = 1 - Math.pow(1 - progress, 3);
                            el.textContent = Math.round(target * ease) + '%';
                            if (progress < 1) requestAnimationFrame(step);
                        }
                        setTimeout(function() { requestAnimationFrame(step); }, start);
                    });

                    body.querySelectorAll('[data-ga-bar]').forEach(function(el, i) {
                        setTimeout(function() {
                            el.style.width = el.getAttribute('data-ga-bar') + '%';
                        }, GA_BAR_START + i * GA_BAR_STAGGER);
                    });

                    body.querySelectorAll('[data-ga-bar-h]').forEach(function(el, i) {
                        setTimeout(function() {
                            el.style.height = el.getAttribute('data-ga-bar-h');
                        }, GA_CHART_START + i * GA_CHART_STAGGER);
                    });

                    body.querySelectorAll('[data-ga-bidir-h]').forEach(function(el, i) {
                        setTimeout(function() {
                            el.style.height = el.getAttribute('data-ga-bidir-h');
                        }, GA_CHART_START + i * GA_CHART_STAGGER);
                    });
                });
            });

            // Attach explain handlers
            body.querySelectorAll('[data-explain]').forEach(function(el){
                el.addEventListener('click', function(){ showExplanation(el.getAttribute('data-explain')); });
            });
        })();
        // ── End Current Analysis Loader ──────────────────────────────────────
        // Reveal the page now that critical content is rendered from localStorage.
        requestAnimationFrame(function() {
            document.body.style.transition = 'opacity 120ms ease-out';
            document.body.style.opacity = '1';
        });
