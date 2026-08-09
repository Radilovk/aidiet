#!/usr/bin/env node
/**
 * Calorie semantics: maintenance TDEE vs intake target vs achieved plan.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calorieTolerance } from '../food-nutrition.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'worker.entry.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(src.includes("if (!goalIncludes(goal, 'Отслабване'))"), 'calculateSafeDeficit uses goalIncludes');
assert(!src.includes('cm.realTDEE = fc;'), 'enforceCalorieGuardrails must not set realTDEE to Final_Calories');
assert(!src.includes('function syncAchievedCaloriesToAnalysis'), 'must not lower Final_Calories to achieved meals');
assert(src.includes('function enforceWeekPlanCalorieTargets'), 'reconcile enforces intake target on under-delivery');
assert(src.includes('defaultDailyCalories > 0'), 'normalizeWeeklyScheme prefers Final_Calories contract');
assert(src.includes('intakeTarget = parseFinalCalories'), 'reconcile uses Final_Calories not summary.dailyCalories');

// Kamen-like profile sanity
function bmr() { return 1999; }
const tdeeMaint = Math.round(bmr() * 1.725);
const targetDeficit = Math.round(tdeeMaint * 0.82);
assert(targetDeficit > 2700 && targetDeficit < 2900, `expected ~2774 deficit target, got ${targetDeficit}`);
assert(tdeeMaint > targetDeficit + 500, 'maintenance TDEE must exceed deficit target');

const achieved = 2050;
const tol = calorieTolerance(targetDeficit);
assert(Math.abs(achieved - targetDeficit) > tol, '2050 vs 2774 should exceed tolerance — triggers enforce, not target lowering');

console.log('✅ test-calorie-target-sync.mjs');
