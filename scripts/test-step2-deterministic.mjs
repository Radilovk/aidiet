#!/usr/bin/env node
/** Step 2 deterministic builder — profile → weeklyScheme + validation. */
import {
  buildDeterministicStrategy,
  buildAndValidateDeterministicStrategy,
  deterministicStep2Enabled,
} from '../step2-deterministic.js';
import { validateProtocolStrategy } from '../protocol-validate.js';
import { userSkipsBreakfast } from '../plan-normalize.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(deterministicStep2Enabled({}), 'deterministic Step2 enabled by default');
ok(!deterministicStep2Enabled({ DETERMINISTIC_STEP2: '0' }), 'opt-out via DETERMINISTIC_STEP2=0');

const analysis = {
  Final_Calories: 2100,
  macroGrams: { protein: 140, carbs: 210, fats: 70 },
};

const userData = {
  name: 'Тест',
  weight: 75,
  dietPreference: ['Балансирано'],
  eatingHabits: ['5 хранения на ден'],
  foodCravings: [],
};

const strategy = buildDeterministicStrategy({ userData, analysis });
ok(strategy.weeklyScheme?.monday?.mealBreakdown?.length >= 3, 'weeklyScheme has mealBreakdown');
ok(strategy.libraryDietProfile === 'balanced', 'balanced profile resolved');
ok(strategy.dietaryModifier === 'Балансирано', 'dietaryModifier label set');
ok(strategy.mealTiming?.pattern, 'mealTiming.pattern present');
ok(Object.keys(strategy.weeklyScheme).length === 7, '7 days in weeklyScheme');

const validation = validateProtocolStrategy(strategy, analysis, userData);
ok(validation.status === 'VALID' || validation.status === 'REVIEW', `validation ${validation.status}`);
ok(!validation.blocking.length, 'no blocking errors for balanced profile');

const { strategy: validated, validation: bundled } = buildAndValidateDeterministicStrategy({ userData, analysis });
ok(validated._deterministicCore === true, 'deterministic core flag');
ok(bundled.status !== 'REJECT', 'bundled validation not REJECT');

// Keto profile caps carbs
const ketoUser = {
  ...userData,
  dietPreference: ['Кетогенна диета'],
  weight: 80,
};
const ketoAnalysis = {
  Final_Calories: 2000,
  macroGrams: { protein: 120, carbs: 200, fats: 80 },
};
const ketoStrategy = buildDeterministicStrategy({ userData: ketoUser, analysis: ketoAnalysis });
const ketoValidation = validateProtocolStrategy(ketoStrategy, ketoAnalysis, ketoUser);
ok(ketoStrategy.libraryDietProfile === 'keto', 'keto profile resolved');
ok(ketoValidation.status !== 'REJECT', 'keto strategy passes validation');

// Skip breakfast — no Хранене 1 (canonical habit: "Не закусвам")
const skipUser = {
  ...userData,
  eatingHabits: ['Не закусвам', '4 хранения'],
};
const skipStrategy = buildDeterministicStrategy({ userData: skipUser, analysis });
const mondaySlots = skipStrategy.weeklyScheme.monday.mealBreakdown.map(m => m.type);
ok(!mondaySlots.includes('Хранене 1'), 'no breakfast slot when user skips breakfast');
ok(userSkipsBreakfast(skipUser), 'userSkipsBreakfast helper agrees');

// Free day Sunday
ok(skipStrategy.freeDayNumber === 7, 'free day defaults to Sunday');
const sundaySlots = skipStrategy.weeklyScheme.sunday.mealBreakdown.map(m => m.type);
ok(sundaySlots.includes('Свободно хранене'), 'Sunday has free meal slot');

console.log('');
if (fail) {
  console.error(`FAILED: ${fail} test(s)`);
  process.exit(1);
}
console.log(`PASSED: ${pass} test(s)`);
