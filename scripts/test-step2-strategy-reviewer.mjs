#!/usr/bin/env node
/** Step 2 Strategy Reviewer — parse/apply bounded adjustments. */
import {
  strategyReviewerEnabled,
  buildStrategyReviewPacket,
  parseStrategyReviewerResponse,
  applyStrategyReviewAdjustments,
  ALLOWED_DIET_PROFILES,
} from '../step2-strategy-reviewer.js';
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { extractQuestionnaireBlockedTerms } from '../questionnaire-engine-map.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(strategyReviewerEnabled({}), 'strategy reviewer enabled by default');
ok(!strategyReviewerEnabled({ STRATEGY_REVIEWER: '0' }), 'opt-out via STRATEGY_REVIEWER=0');

const analysis = {
  Final_Calories: 2100,
  macroGrams: { protein: 140, carbs: 210, fats: 70 },
};

const userData = {
  name: 'Мария',
  goal: 'Отслабване',
  dietPreference: ['Балансирано'],
  eatingHabits: ['3 хранения'],
  additionalNotes: 'Имам IBS и подуване — избягвам лук, чесън, боб. Предпочитам лесно смилаеми храни.',
  dq_gi_triggers: 'лук, чесън, боб, зеле',
  _dq_text_map: { dq_gi_triggers: 'Храносмилателни тригери' },
};

const strategy = buildDeterministicStrategy({ userData, analysis });
const packet = buildStrategyReviewPacket({ strategy, analysis, userData });
ok(packet.includes('additionalNotes'), 'packet includes free-text notes');
ok(packet.includes('IBS'), 'packet includes IBS from notes');
ok(packet.includes('libraryDietProfile'), 'packet includes algorithm proposal');

const mockReview = parseStrategyReviewerResponse({
  verdict: 'ADJUST',
  libraryDietProfile: 'low_fodmap',
  dietaryModifier: 'Low-FODMAP',
  modifierReasoning: 'Клиентът описва IBS и типични FODMAP тригери в свободния текст.',
  foodsToInclude: ['ориз', 'картофи', 'яйца', 'риба'],
  foodsToAvoid: ['лук', 'чесън', 'боб', 'зеле', 'пшеница'],
  includeDessert: false,
  reviewNotes: ['Алгоритъмът е дал balanced, но свободният текст изисква low_fodmap'],
});

ok(mockReview.verdict === 'ADJUST', 'parsed ADJUST verdict');
ok(mockReview.libraryDietProfile === 'low_fodmap', 'parsed diet profile');
ok(!parseStrategyReviewerResponse({ libraryDietProfile: 'invalid_diet' }).libraryDietProfile,
  'rejects unknown diet profile');

const mandatoryBlocked = extractQuestionnaireBlockedTerms(userData);
applyStrategyReviewAdjustments(strategy, mockReview, { mandatoryBlocked });
ok(strategy.libraryDietProfile === 'low_fodmap', 'applied diet profile');
ok(strategy.foodsToAvoid.some(f => /лук/i.test(f)), 'foodsToAvoid includes onion');
ok(strategy.includeDessert === false, 'applied dessert flag');
ok(strategy._strategyReview?.verdict === 'ADJUST', 'review metadata stored');

ok(ALLOWED_DIET_PROFILES.includes('low_fodmap'), 'low_fodmap in allowlist');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
