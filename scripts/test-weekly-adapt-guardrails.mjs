#!/usr/bin/env node
import { buildAnalyticsSummary } from '../analytics-compression.js';
import { buildGameData } from './plan-adequacy/fixtures/game-scenarios.mjs';
import { clampAdaptationLevel, hasWeeklyStrategyRegenTriggers } from '../weekly-adapt-guardrails.mjs';

const plan = {
  analysis: { Final_Calories: '2000 kcal/ден' },
  weekPlan: { day1: { meals: [{ type: 'Закуска', calories: 400 }, { type: 'Обяд', calories: 600 }] } },
};

function check(label, ok) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`ok ${label}`);
}

const strong = buildAnalyticsSummary(buildGameData(plan, 'strong_week').gameData, {});
check('strong week junk7', strong.junk7 <= 1);
check('strong cap → 0', clampAdaptationLevel(1, strong, ['simplify_meals'], {}) === 0);

const struggling = buildAnalyticsSummary(buildGameData(plan, 'struggling_week').gameData, {});
check('struggling floor ≥1', clampAdaptationLevel(0, struggling, [], {}) >= 1);

check('hollow L1 mild week → 0', clampAdaptationLevel(1, { status: 'active', junk7: 2, avgScore: 2, adherence: 40 }, [], {}) === 0);
check('hollow L1 junk week stays 1', clampAdaptationLevel(1, struggling, [], {}) === 1);
check('L1 + calorieAdjust', clampAdaptationLevel(1, struggling, [], { calorieAdjust: 200 }) === 1);
check('strategy trigger', hasWeeklyStrategyRegenTriggers({ weeklySchemeNotes: 'more protein' }));

console.log('weekly-adapt-guardrails: all passed');
