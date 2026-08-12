#!/usr/bin/env node
/** Step 1 deterministic energy contract — backend authority for kcal/macros. */
import {
  buildEnergyContract,
  applyDeterministicEnergyContract,
  computeIntakeTarget,
  deterministicStep1Enabled,
  macroGramsFromIntake,
} from '../step1-deterministic.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(deterministicStep1Enabled({}), 'deterministic Step1 enabled by default');
ok(!deterministicStep1Enabled({ DETERMINISTIC_STEP1: '0' }), 'opt-out via DETERMINISTIC_STEP1=0');

const tdee = 2500;
const deficitData = { targetCalories: 2050, deficitPercent: 18, maxDeficitCalories: 1875 };
const macros = { protein: 30, carbs: 40, fats: 30 };

ok(computeIntakeTarget(tdee, 'Отслабване', deficitData) === 2050, 'loss uses deficit target');
ok(computeIntakeTarget(tdee, 'Поддържане', deficitData) === 2500, 'maintenance uses TDEE');
ok(computeIntakeTarget(tdee, 'Мускулна маса', deficitData) === 2750, 'muscle gain +10% TDEE');

const grams = macroGramsFromIntake(2000, macros, 49);
ok(grams.protein === 150, 'protein grams from ratios');
ok(grams.fats >= 49, 'min fat floor respected');
ok(grams.protein * 4 + grams.carbs * 4 + grams.fats * 9 <= 2000 + 12, 'macros sum near intake');

const contract = buildEnergyContract({
  bmr: 1800,
  tdee: 2500,
  deficitData,
  macros,
  activityData: { activityLevel: 'Средна' },
  goal: 'Отслабване',
  minFatG: 49,
});
ok(contract.Final_Calories === 2050, 'contract intake');
ok(contract.correctedMetabolism.realTDEE === 2500, 'contract maintenance TDEE');
ok(contract.macroGrams.protein > 0, 'contract macro grams');

const aiAnalysis = {
  bmr: 9999,
  tdee: 8888,
  Final_Calories: 1111,
  macroGrams: { protein: 1, carbs: 2, fats: 3 },
  keyProblems: [{ title: 'Test', severity: 'Borderline', severityValue: 55 }],
  currentHealthStatus: { score: 60, description: 'Test health narrative from AI.' },
};
applyDeterministicEnergyContract(aiAnalysis, contract);
ok(aiAnalysis._deterministicEnergy === true, 'deterministic flag set');
ok(aiAnalysis.bmr === 1800, 'AI bmr overwritten');
ok(aiAnalysis.Final_Calories === 2050, 'AI intake overwritten');
ok(aiAnalysis.keyProblems.length === 1, 'AI narrative preserved');
ok(aiAnalysis.currentHealthStatus.description.includes('AI'), 'AI health narrative preserved');

console.log('');
if (fail) {
  console.error(`FAILED: ${fail} test(s)`);
  process.exit(1);
}
console.log(`PASSED: ${pass} test(s)`);
