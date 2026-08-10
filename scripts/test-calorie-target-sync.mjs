#!/usr/bin/env node
/**
 * Calorie semantics: intake target flows to Step 2/3 AI, maintenance TDEE stays reference.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeAnalysisForStep } from '../context-compression.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerSrc = readFileSync(join(root, 'worker.entry.js'), 'utf8');
const strategyPrompt = readFileSync(join(root, 'KV/prompts/admin_strategy_prompt.txt'), 'utf8');
const analysisPrompt = readFileSync(join(root, 'KV/prompts/admin_analysis_prompt.txt'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(strategyPrompt.includes('{finalCalories}'), 'strategy prompt uses intake target variable');
assert(strategyPrompt.includes('Maintenance TDEE: {realTDEE}'), 'strategy prompt keeps TDEE as reference only');
assert(!strategyPrompt.includes('Final calories: {realTDEE}'), 'strategy must not label TDEE as final calories');
assert(!analysisPrompt.includes('realTDEE=Final_Calories'), 'step1 must not conflate TDEE with intake');
assert(workerSrc.includes('finalCalories,'), 'generateStrategyPrompt passes finalCalories');
assert(!workerSrc.includes('function enforceWeekPlanCalorieTargets'), 'no post-hoc calorie enforce patch');
assert(workerSrc.includes('Final_Calories: intake'), 'buildCompactAnalysis includes intake for step2 cache');

const step2Block = serializeAnalysisForStep({
  bmi: 32,
  correctedMetabolism: { realBMR: 1999, realTDEE: 3445 },
  Final_Calories: 2774,
  macroRatios: { protein: 30, carbs: 40, fats: 30 },
  macroGrams: { protein: 208, carbs: 277, fats: 93 },
  psychoProfile: { temperament: 'Холерик', probability: 80 },
}, 2);
assert(step2Block.includes('tdee=3445'), 'step2 block has maintenance tdee');
assert(step2Block.includes('cal=2774'), 'step2 block has intake cal');

console.log('✅ test-calorie-target-sync.mjs');
