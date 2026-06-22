/**
 * Server-side gamification analytics compression for admin client card (#AX v1).
 * Mirrors game-scoring.js logic (plan.html / game-analytics.html).
 */

const HEALTH_WEIGHTS = {
  engagement: 0.30,
  sleep: 0.22,
  balance: 0.18,
  activity: 0.18,
  water: 0.10,
  extraCals: 0.05,
};

const JUNK_MAX_POINTS = 20;
const JUNK_PENALTY_PER_MEAL = 7;

function zp(n) { return n < 10 ? `0${n}` : `${n}`; }

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${zp(d.getMonth() + 1)}-${zp(d.getDate())}`;
}

function emptyDayScore() {
  return { score: null, engPct: 0, junkCount: 0, calorieDelta: 0, calorieBalance: 'balanced' };
}

/**
 * @param {object|null} rec
 * @param {string} todayKey
 */
export function calcDayScore(rec, todayKey) {
  if (!rec) return emptyDayScore();
  const meals = Object.keys(rec.meals || {});
  let mealPts = 0;
  const mealMax = meals.length * 10;

  meals.forEach((m) => {
    if (rec.meals[m] === true) mealPts += 10;
  });

  let junkCount = 0;
  let extraCalSum = 0;
  let freeMealCalSum = 0;
  (rec.extraMeals || []).forEach((em) => {
    const isConsumed = !em.isAddedToPlan || em.countCalories !== false;
    if (em.isJunk && isConsumed && !em.isFreeMealReplacement) junkCount++;
    if (em.isFreeMealReplacement) freeMealCalSum += (em.calories || 0);
    else if (!(em.isAddedToPlan && !em.countCalories)) extraCalSum += (em.calories || 0);
  });

  const mealCalMap = rec.mealCalories || {};
  let completedPlanCals = 0;
  meals.forEach((mt) => {
    if (rec.meals[mt] === true && mealCalMap[mt]) completedPlanCals += mealCalMap[mt];
  });
  const totalConsumed = completedPlanCals + extraCalSum + freeMealCalSum;
  const planned = rec.plannedCalories ? (rec.plannedCalories + freeMealCalSum) : null;
  let excessCalories = false;
  let calorieBalance = 'balanced';
  let calorieDelta = 0;

  if (totalConsumed > 0 && planned && planned > 0) {
    const excessPct = (totalConsumed - planned) / planned;
    calorieDelta = Math.round(totalConsumed - planned);
    if (excessPct > 0.10) { excessCalories = true; calorieBalance = 'surplus'; }
    else if (excessPct > 0) { calorieBalance = 'surplus'; }
    else if (excessPct < -0.10 && completedPlanCals > 0 && (rec.morningCheck || rec.eveningCheck)) {
      const recDate = rec.date || todayKey;
      const dayIsDone = recDate < todayKey || new Date().getHours() >= 20;
      if (dayIsDone) calorieBalance = 'deficit';
    }
  } else if (extraCalSum > 0 && (!planned || planned === 0)) {
    calorieDelta = extraCalSum;
    if (extraCalSum > 200) { excessCalories = true; calorieBalance = 'surplus'; }
    else if (extraCalSum > 50) { calorieBalance = 'surplus'; }
  }

  const sleepPts = rec.morningCheck ? (rec.morningCheck.sleptWell ? 10 : 0) : null;
  const waterPts = rec.eveningCheck?.waterIntake != null ? (rec.eveningCheck.waterIntake ? 10 : 0) : null;
  const activityPts = rec.eveningCheck?.activityLevel != null ? ([0, 0, 5, 10][rec.eveningCheck.activityLevel] || 0) : null;
  const balancePts = rec.eveningCheck?.emotionalBalance != null ? ([0, 0, 5, 10][rec.eveningCheck.emotionalBalance] || 0) : null;
  const wellnessEarned = (sleepPts || 0) + (waterPts || 0) + (activityPts || 0) + (balancePts || 0);
  const wellnessMax = 40;

  const allMealsOk = meals.length > 0 && meals.every((m) => rec.meals[m] === true);
  const has5StarBlocker = !allMealsOk || excessCalories ||
    (rec.morningCheck?.sleptWell === false) ||
    (rec.eveningCheck?.waterIntake === false) ||
    (rec.eveningCheck?.activityLevel === 1) ||
    (rec.eveningCheck?.emotionalBalance === 1) ||
    junkCount > 0;

  const done = meals.filter((m) => rec.meals[m] === true).length;
  const mealEngPct = meals.length > 0 ? (done / meals.length) * 50 : 0;
  const mornEngPct = rec.morningCheck ? 15 : 0;
  const eveEngPct = (rec.eveningCheck && (
    rec.eveningCheck.activityLevel != null ||
    rec.eveningCheck.emotionalBalance != null ||
    rec.eveningCheck.waterIntake != null
  )) ? 15 : 0;
  const hasAnyEngagement = mealEngPct > 0 || mornEngPct > 0 || eveEngPct > 0 || junkCount > 0;
  const junkPct = hasAnyEngagement ? Math.max(0, JUNK_MAX_POINTS - junkCount * JUNK_PENALTY_PER_MEAL) : 0;
  const engPct = Math.round(mealEngPct + mornEngPct + eveEngPct + junkPct);

  const totalMax = mealMax + wellnessMax;
  const totalEarned = mealPts + wellnessEarned;
  const hasAnyActivity = totalEarned > 0 || meals.length > 0;
  let score = null;

  if (totalMax > 0 && hasAnyActivity) {
    const pct = totalEarned / totalMax;
    if (pct >= 1.00 && !has5StarBlocker) score = 5;
    else if (pct >= 0.80) score = 4;
    else if (pct >= 0.55) score = 3;
    else if (pct >= 0.30) score = 2;
    else if (pct > 0) score = 1;
    if (score === 5 && has5StarBlocker) score = 4;
    if (score != null && score > 3 && (junkCount > 0 || excessCalories)) score = 3;
    if (score != null && score > 2 && junkCount > 0 && excessCalories) score = 2;
  }

  return { score, engPct, junkCount, calorieDelta, calorieBalance, excessCalories };
}

export function computeHealthIndex(m) {
  let healthScore = 0;
  let totalWeight = HEALTH_WEIGHTS.engagement;
  healthScore += (m.engagementPct || 0) * HEALTH_WEIGHTS.engagement;

  if (m.sleepPct != null) { healthScore += m.sleepPct * HEALTH_WEIGHTS.sleep; totalWeight += HEALTH_WEIGHTS.sleep; }
  if (m.balancePct != null) { healthScore += m.balancePct * HEALTH_WEIGHTS.balance; totalWeight += HEALTH_WEIGHTS.balance; }
  if (m.actPct != null) { healthScore += m.actPct * HEALTH_WEIGHTS.activity; totalWeight += HEALTH_WEIGHTS.activity; }
  if (m.waterPct != null) { healthScore += m.waterPct * HEALTH_WEIGHTS.water; totalWeight += HEALTH_WEIGHTS.water; }

  const extraCalsWeight = Math.max(0, 100 - Math.round((m.totalExtraCals || 0) / 700 * 100));
  healthScore += extraCalsWeight * HEALTH_WEIGHTS.extraCals;
  totalWeight += HEALTH_WEIGHTS.extraCals;

  return Math.round(Math.max(0, Math.min(100, healthScore / totalWeight)));
}

function buildLast7Days(allData, todayKey) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dd = new Date();
    dd.setDate(dd.getDate() - i);
    const key = dateKey(dd);
    if (key <= todayKey) days.push({ key, rec: allData?.[key] || null });
  }
  return days;
}

function pctAvg(values) {
  const valid = values.filter((v) => v != null);
  return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
}

function calcStreak(days, todayKey) {
  let streak = 0;
  let streakStart = days.length - 1;
  if (streakStart >= 0 && days[streakStart].key === todayKey &&
      (!days[streakStart].rec || calcDayScore(days[streakStart].rec, todayKey).score == null)) {
    streakStart--;
  }
  for (let si = streakStart; si >= 0; si--) {
    const sc = days[si].rec ? calcDayScore(days[si].rec, todayKey).score : null;
    if (sc != null && sc >= 4) streak++;
    else break;
  }
  return streak;
}

function compactDayLine(d, todayKey) {
  if (!d.rec) return `${d.key.slice(5)}:—`;
  const s = calcDayScore(d.rec, todayKey);
  const bal = s.calorieBalance === 'surplus' ? '+' : s.calorieBalance === 'deficit' ? '-' : '=';
  return `${d.key.slice(5)}:${s.score ?? '—'}/${s.engPct}/${s.junkCount}/${bal}${Math.abs(s.calorieDelta)}`;
}

/**
 * Build compact analytics summary from raw gameData.
 * @param {Record<string, object>} gameData
 * @param {object} [gameWeeklyAI]
 */
export function buildAnalyticsSummary(gameData = {}, gameWeeklyAI = {}) {
  const todayKey = dateKey();
  const days = buildLast7Days(gameData, todayKey);
  const weekScores = days.map((d) => (d.rec ? calcDayScore(d.rec, todayKey) : null));
  const validScores = weekScores.filter((s) => s?.score != null);
  const avgScore = validScores.length
    ? Math.round(validScores.reduce((a, s) => a + s.score, 0) / validScores.length * 10) / 10
    : null;

  const engForAvg = days.map((d) => (d.rec ? calcDayScore(d.rec, todayKey).engPct : 0));
  const engagementPct = Math.round(engForAvg.reduce((a, b) => a + b, 0) / days.length);

  const extraCalsByDay = days.map((d) => {
    if (!d.rec?.extraMeals) return 0;
    return d.rec.extraMeals.reduce((s, em) => {
      if (em.isFreeMealReplacement) return s;
      if (em.isAddedToPlan && !em.countCalories) return s;
      return s + (em.calories || 0);
    }, 0);
  });
  const totalExtraCals = extraCalsByDay.reduce((s, v) => s + v, 0);

  const calBalanceByDay = days.map((d) => (d.rec ? calcDayScore(d.rec, todayKey).calorieDelta : 0));
  const netCalBalance = calBalanceByDay.reduce((s, v) => s + v, 0);

  const sleepByDay = days.map((d) => (
    d.rec?.morningCheck?.sleptWell != null ? (d.rec.morningCheck.sleptWell ? 100 : 0) : null
  ));
  const balanceByDay = days.map((d) => (
    d.rec?.eveningCheck?.emotionalBalance != null
      ? Math.round((d.rec.eveningCheck.emotionalBalance - 1) / 2 * 100) : null
  ));
  const actByDay = days.map((d) => (
    d.rec?.eveningCheck?.activityLevel != null
      ? Math.round((d.rec.eveningCheck.activityLevel - 1) / 2 * 100) : null
  ));
  const waterByDay = days.map((d) => (
    d.rec?.eveningCheck?.waterIntake != null ? (d.rec.eveningCheck.waterIntake ? 100 : 0) : null
  ));

  const calAdherencePct = (() => {
    const vals = [];
    days.forEach((d) => {
      if (!d.rec) return;
      const mealCalMap = d.rec.mealCalories || {};
      const consumed = Object.keys(d.rec.meals || {}).reduce((sum, mt) =>
        sum + (d.rec.meals[mt] && mealCalMap[mt] ? mealCalMap[mt] : 0), 0);
      const extra = (d.rec.extraMeals || []).reduce((sum, em) => {
        if (em.isFreeMealReplacement || (em.isAddedToPlan && !em.countCalories)) return sum;
        return sum + (em.calories || 0);
      }, 0);
      const total = consumed + extra;
      const plan = d.rec.plannedCalories;
      if (total > 0 && plan) vals.push(Math.min(100, Math.round(total / plan * 100)));
    });
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  })();

  let junk7 = 0;
  days.forEach((d) => {
    (d.rec?.extraMeals || []).forEach((em) => {
      const isConsumed = !em.isAddedToPlan || em.countCalories !== false;
      if (em.isJunk && isConsumed) junk7++;
    });
  });

  const pastScores = weekScores.slice(0, -1);
  const firstHalf = pastScores.slice(0, Math.floor(pastScores.length / 2)).filter((s) => s?.score != null);
  const lastHalf = pastScores.slice(Math.ceil(pastScores.length / 2)).filter((s) => s?.score != null);
  let trend = 'flat';
  if (lastHalf.length && firstHalf.length) {
    const lh = lastHalf.reduce((a, s) => a + s.score, 0) / lastHalf.length;
    const fh = firstHalf.reduce((a, s) => a + s.score, 0) / firstHalf.length;
    if (lh > fh + 0.3) trend = 'up';
    else if (fh > lh + 0.3) trend = 'down';
  }

  const healthIndex = computeHealthIndex({
    engagementPct,
    sleepPct: pctAvg(sleepByDay),
    balancePct: pctAvg(balanceByDay),
    actPct: pctAvg(actByDay),
    waterPct: pctAvg(waterByDay),
    totalExtraCals,
  });

  const daysWithData = days.filter((d) => d.rec).length;
  if (daysWithData === 0) {
    return {
      status: 'empty',
      daysRecorded: 0,
      syncedAt: new Date().toISOString(),
    };
  }

  return {
    status: 'active',
    healthIndex,
    avgScore,
    streak: calcStreak(days, todayKey),
    adherence: engagementPct,
    calAdherence: calAdherencePct,
    junk7,
    netCalBalance,
    trend,
    daysRecorded: daysWithData,
    dimensions: {
      eng: engagementPct,
      slp: pctAvg(sleepByDay),
      bal: pctAvg(balanceByDay),
      act: pctAvg(actByDay),
      wtr: pctAvg(waterByDay),
    },
    last7: days.map((d) => compactDayLine(d, todayKey)).join('|'),
    weeklyAI: {
      lastRun: gameWeeklyAI.lastRun || null,
      nextDue: gameWeeklyAI.nextDue || null,
      lastSummary: gameWeeklyAI.lastSummary || gameWeeklyAI.summary || null,
    },
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Serialize analytics object to #AX v1 card line block.
 * @param {object|null} analytics
 */
export function serializeAnalyticsBlock(analytics) {
  if (!analytics || analytics.status === 'empty') {
    return '#AX v1 status=empty|note=няма_записани_дни';
  }
  if (analytics.status !== 'active') {
    return '#AX v1 status=pending|note=аналитичен_модул_не_синхронизиран';
  }
  const dim = analytics.dimensions || {};
  const lines = [
    '#AX v1 status=active',
    `hi=${analytics.healthIndex}|avg=${analytics.avgScore ?? '—'}|str=${analytics.streak}|adh=${analytics.adherence}`,
    `cal=${analytics.calAdherence ?? '—'}|junk7=${analytics.junk7}|net=${analytics.netCalBalance}|tr=${analytics.trend}`,
    `dim|eng=${dim.eng ?? '—'}|slp=${dim.slp ?? '—'}|bal=${dim.bal ?? '—'}|act=${dim.act ?? '—'}|wtr=${dim.wtr ?? '—'}`,
    `d7|${analytics.last7}`,
    analytics.syncedAt ? `sync=${analytics.syncedAt.slice(0, 10)}` : '',
  ];
  const wai = analytics.weeklyAI;
  if (wai?.nextDue) lines.push(`revDue=${wai.nextDue.slice(0, 10)}`);
  if (wai?.lastSummary) lines.push(`rev=${String(wai.lastSummary).replace(/\|/g, '/').slice(0, 280)}`);
  return lines.filter(Boolean).join('\n');
}
