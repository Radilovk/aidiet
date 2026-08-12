/**
 * Unified protocol validation — deterministic authority layer.
 * Returns VALID | REVIEW | REJECT for strategy/protocol objects.
 */

import { LIBRARY_PROTOCOL_RULES } from './nutrition-library-bridge.js';
import { calorieTolerance } from './food-nutrition.js';
import { isKetoUser, userSkipsBreakfast } from './plan-normalize.js';
import { resolveLibraryDietProfile } from './protocol-engine.js';

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const CANONICAL_MEAL_TYPES = [
  'Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5', 'Свободно хранене', 'Напитка',
];

function sumField(breakdown, field) {
  return (breakdown || []).reduce((s, m) => s + (Number(m[field]) || 0), 0);
}

function parseDailyKcal(analysis) {
  const raw = analysis?.Final_Calories ?? analysis?.recommendedCalories;
  if (typeof raw === 'number' && raw > 0) return Math.round(raw);
  const m = String(raw || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/**
 * Validate frozen strategy.weeklyScheme against analysis contract + diet rules.
 * @returns {{ status: 'VALID'|'REVIEW'|'REJECT', blocking: string[], warnings: string[], dietProfile: string }}
 */
export function validateProtocolStrategy(strategy, analysis = null, userData = null) {
  const blocking = [];
  const warnings = [];

  if (!strategy?.weeklyScheme) {
    return { status: 'REJECT', blocking: ['липсва weeklyScheme'], warnings, dietProfile: 'balanced' };
  }

  const dietProfile = strategy.libraryDietProfile
    || resolveLibraryDietProfile({
      dietaryModifier: strategy?.dietaryModifier,
      dietPreference: userData?.dietPreference,
      dietDislike: userData?.dietDislike || '',
    });

  const rules = LIBRARY_PROTOCOL_RULES.diet_profiles?.[dietProfile] || {};
  const targetKcal = parseDailyKcal(analysis);

  if (!strategy.dietaryModifier && !strategy.dietType) {
    blocking.push('липсва dietaryModifier/dietType');
  }
  if (!strategy.mealTiming?.pattern) {
    blocking.push('липсва mealTiming.pattern');
  }
  if (strategy.mealCountJustification && strategy.mealCountJustification.length < 20) {
    blocking.push('mealCountJustification твърде кратко');
  }

  for (const dayKey of DAY_KEYS) {
    const day = strategy.weeklyScheme[dayKey];
    if (!day) {
      blocking.push(`weeklyScheme.${dayKey} липсва`);
      continue;
    }
    if (!day.mealBreakdown?.length) {
      blocking.push(`${dayKey}: празен mealBreakdown`);
      continue;
    }
    if (day.meals !== day.mealBreakdown.length) {
      blocking.push(`${dayKey}: meals != mealBreakdown.length`);
    }

    for (const slot of day.mealBreakdown) {
      if (!CANONICAL_MEAL_TYPES.includes(slot.type)) {
        blocking.push(`${dayKey}: невалиден slot "${slot.type}"`);
      }
    }

    if (userSkipsBreakfast(userData) && day.mealBreakdown.some(m => m.type === 'Хранене 1')) {
      blocking.push(`${dayKey}: Хранене 1 при клиент без закуска`);
    }

    const dayKcal = sumField(day.mealBreakdown, 'calories');
    if (targetKcal > 0 && dayKcal > 0) {
      const tol = calorieTolerance(targetKcal);
      if (Math.abs(dayKcal - targetKcal) > tol * 2) {
        blocking.push(`${dayKey}: ${dayKcal} kcal ≠ цел ${targetKcal}`);
      }
    }

    const dayCarbs = sumField(day.mealBreakdown, 'carbs');
    if (rules.max_carbs_g_day && dayCarbs > rules.max_carbs_g_day + 5) {
      if (isKetoUser(userData) || dietProfile === 'keto' || dietProfile === 'low_carb') {
        blocking.push(`${dayKey}: въглехидрати ${dayCarbs}g > лимит ${rules.max_carbs_g_day}g (${dietProfile})`);
      } else {
        warnings.push(`${dayKey}: въглехидрати ${dayCarbs}g над профилен лимит ${rules.max_carbs_g_day}g`);
      }
    }
  }

  const freeDay = Number(strategy.freeDayNumber);
  if (freeDay >= 1 && freeDay <= 7) {
    const freeScheme = strategy.weeklyScheme[DAY_KEYS[freeDay - 1]];
    const hasFree = freeScheme?.mealBreakdown?.some(m => m.type === 'Свободно хранене');
    if (!hasFree) {
      warnings.push(`freeDayNumber=${freeDay} но липсва Свободно хранене в mealBreakdown`);
    }
  }

  const status = blocking.length ? 'REJECT' : warnings.length ? 'REVIEW' : 'VALID';
  return { status, blocking, warnings, dietProfile };
}

/** Merge deterministic + optional AI strategy — engine wins on structural fields. */
export function mergeStrategyConsensus(deterministic, aiOverlay = null) {
  if (!deterministic) return aiOverlay;
  if (!aiOverlay) return deterministic;

  return {
    ...aiOverlay,
    dietaryModifier: deterministic.dietaryModifier,
    dietType: deterministic.dietType,
    weeklyScheme: deterministic.weeklyScheme,
    freeDayNumber: deterministic.freeDayNumber,
    includeDessert: deterministic.includeDessert,
    libraryDietProfile: deterministic.libraryDietProfile,
    _deterministicCore: true,
    welcomeMessage: aiOverlay.welcomeMessage || deterministic.welcomeMessage,
    planJustification: aiOverlay.planJustification || deterministic.planJustification,
    mealCountJustification: aiOverlay.mealCountJustification || deterministic.mealCountJustification,
    modifierReasoning: aiOverlay.modifierReasoning || deterministic.modifierReasoning,
    longTermStrategy: aiOverlay.longTermStrategy || deterministic.longTermStrategy,
    keyPrinciples: aiOverlay.keyPrinciples?.length ? aiOverlay.keyPrinciples : deterministic.keyPrinciples,
    mealTiming: {
      ...deterministic.mealTiming,
      ...(aiOverlay.mealTiming || {}),
      pattern: deterministic.mealTiming?.pattern || aiOverlay.mealTiming?.pattern,
    },
  };
}
