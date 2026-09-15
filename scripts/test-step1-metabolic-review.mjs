#!/usr/bin/env node
/** Step 1 bounded metabolic review — AI + structured hints on backend baseline. */
import {
  applyDeterministicEnergyContract,
  buildEnergyContract,
  applyBoundedMetabolicReview,
  computeBoundedReviewPercent,
  deriveStructuredMetabolicHints,
  mergeAdjustmentPercent,
  clampPercent,
  metabolicReviewEnabled,
} from '../step1-deterministic.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(metabolicReviewEnabled({}), 'metabolic review enabled by default');
ok(!metabolicReviewEnabled({ METABOLIC_REVIEW: '0' }), 'opt-out via METABOLIC_REVIEW=0');

ok(mergeAdjustmentPercent(0, -5) === -5, 'structured downward beats AI zero');
ok(mergeAdjustmentPercent(-3, -5) === -5, 'structured downward beats weaker AI');
ok(mergeAdjustmentPercent(2, 3) === 3, 'structured upward beats lower AI');
ok(clampPercent(-20, -12, 5) === -12, 'clinical floor clamp');

const lactationLoss = computeBoundedReviewPercent(
  { clinicalAdjustmentPercent: -8, metabolicAdjustmentPercent: -4, goalAdjustmentPercent: -15 },
  { goal: 'Отслабване', isLactation: true },
);
ok(lactationLoss.total === -5, 'lactation+loss capped at -5%');
ok(lactationLoss.goalIgnored, 'goal percent ignored under deterministic');

const muscle = computeBoundedReviewPercent(
  { clinicalAdjustmentPercent: 0, metabolicAdjustmentPercent: 6 },
  { goal: 'Мускулна маса', isLactation: false },
);
ok(muscle.total === 5, 'muscle gain review capped at +5%');

const hypothyroid = deriveStructuredMetabolicHints({
  medicalConditions: ['Хипотиреоидизъм'],
});
ok(hypothyroid.clinical === -5, 'hypothyroid structured -5%');

const poorSleep = deriveStructuredMetabolicHints({ sleepHours: 4.5 });
ok(poorSleep.metabolic === -5, 'sleep <5h structured -5%');

const contract = buildEnergyContract({
  bmr: 1600,
  tdee: 2200,
  deficitData: { targetCalories: 1800 },
  macros: { protein: 30, carbs: 40, fats: 30 },
  goal: 'Отслабване',
  minFatG: 49,
});

const analysis = {
  correctedMetabolism: {
    clinicalAdjustmentPercent: -6,
    metabolicAdjustmentPercent: -4,
    goalAdjustmentPercent: -12,
    realBMR: 999,
    realTDEE: 999,
  },
  macroRatios: { protein: 30, carbs: 40, fats: 30 },
  keyProblems: [],
};
applyDeterministicEnergyContract(analysis, contract);
ok(analysis.Final_Calories === 1800, 'baseline 1800 before review');

applyBoundedMetabolicReview(analysis, {
  userData: { goal: 'Отслабване', sleepHours: 7 },
});
ok(analysis.Final_Calories === Math.round(1800 * 0.9), 'AI -10% applied to baseline');
ok(analysis.correctedMetabolism.goalAdjustmentPercent === 0, 'goal zeroed after review');
ok(analysis.correctedMetabolism._goalAdjustmentIgnored, 'goal ignore flagged');
ok(analysis.tdee === 2200, 'TDEE unchanged by review');
ok(analysis.correctedMetabolism.realTDEE === 2200, 'maintenance TDEE preserved');

// Structured-only when AI sends zeros
const analysis2 = {
  correctedMetabolism: { clinicalAdjustmentPercent: 0, metabolicAdjustmentPercent: 0 },
  macroRatios: { protein: 30, carbs: 40, fats: 30 },
};
applyDeterministicEnergyContract(analysis2, contract);
applyBoundedMetabolicReview(analysis2, {
  userData: { goal: 'Отслабване', medicalConditions: ['Хипотиреоидизъм'] },
});
ok(analysis2.Final_Calories === Math.round(1800 * 0.95), 'hypothyroid -5% without AI');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
