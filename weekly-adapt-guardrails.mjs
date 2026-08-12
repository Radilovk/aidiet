/**
 * Code guardrails for weekly adaptation levels — shared with worker + tests.
 * AI decides first; these rules only clamp obvious over/under-adaptation.
 */

/** Minimum recorded days before adherence/score floors apply (sample size guard). */
export const MIN_DAYS_FOR_GAMING_FLOOR = 4;

export function hasWeeklyStrategyRegenTriggers(strategyChanges) {
  const sc = strategyChanges || {};
  if (Number(sc.calorieAdjust)) return true;
  if (sc.freeDayNumber != null && sc.freeDayNumber !== '') return true;
  if (String(sc.weeklySchemeNotes || '').trim()) return true;
  return false;
}

/**
 * @param {number|string} rawLevel
 * @param {object|null} analytics
 * @param {string[]} modifications
 * @param {object} strategyChanges
 */
export function clampAdaptationLevel(rawLevel, analytics, modifications, strategyChanges) {
  let level = Math.min(3, Math.max(0, parseInt(String(rawLevel), 10) || 0));

  if (analytics?.status === 'active') {
    const junk7 = analytics.junk7 || 0;
    const avg = Number(analytics.avgScore) || 0;
    const adh = Number(analytics.adherence) || 0;
    const days = Number(analytics.daysRecorded) || 0;
    const sampleOk = days >= MIN_DAYS_FOR_GAMING_FLOOR;

    if (junk7 <= 1 && avg >= 3.5 && adh >= 45) {
      level = Math.min(level, 0);
    }
    if (junk7 >= 5) {
      level = Math.max(level, 1);
    }
    if (sampleOk && adh < 35) {
      level = Math.max(level, 1);
    }
    if (sampleOk && avg > 0 && avg < 2.5) {
      level = Math.max(level, 1);
    }
  }

  const hollowLevel1 =
    level === 1
    && !(modifications?.length)
    && !hasWeeklyStrategyRegenTriggers(strategyChanges);
  const gamingStruggle = analytics?.status === 'active' && (
    (analytics.junk7 || 0) >= 5
    || ((Number(analytics.daysRecorded) || 0) >= MIN_DAYS_FOR_GAMING_FLOOR && (
      (Number(analytics.adherence) || 0) < 35
      || ((Number(analytics.avgScore) || 0) > 0 && (Number(analytics.avgScore) || 0) < 2.5)
    ))
  );
  if (hollowLevel1 && !gamingStruggle) {
    level = 0;
  }

  return level;
}
