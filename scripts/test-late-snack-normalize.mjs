/**
 * Contract + behavior for H5 mealBreakdown clamp (logic mirrored from worker.entry.js).
 */
import { readFileSync } from 'node:fs';

const MAX_LATE_SNACK_CALORIES = 200;

function lateSnackMacroTargets(kcal) {
  const k = Math.max(50, Math.round(Number(kcal) || MAX_LATE_SNACK_CALORIES));
  const capped = Math.min(k, MAX_LATE_SNACK_CALORIES);
  const carbs = Math.min(15, Math.round(capped * 0.15 / 4));
  const protein = Math.round(capped * 0.40 / 4);
  const fats = Math.max(0, Math.round((capped - carbs * 4 - protein * 4) / 9));
  return { calories: capped, protein, carbs, fats };
}

function clampLateSnackInMealBreakdown(day) {
  if (!day?.mealBreakdown?.length) return;
  const h5 = day.mealBreakdown.find(m => m.type === 'Хранене 5');
  if (!h5) return;
  const maxKcal = MAX_LATE_SNACK_CALORIES;
  const h5Kcal = Number(h5.calories) || 0;
  const excessKcal = Math.max(0, h5Kcal - maxKcal);
  if (excessKcal > 0) {
    const tgt = lateSnackMacroTargets(maxKcal);
    const excessP = Math.max(0, (Number(h5.protein) || 0) - tgt.protein);
    const excessC = Math.max(0, (Number(h5.carbs) || 0) - tgt.carbs);
    const excessF = Math.max(0, (Number(h5.fats) || 0) - tgt.fats);
    const mains = day.mealBreakdown.filter(m => m.type === 'Хранене 2' || m.type === 'Хранене 4');
    const sumMainKcal = mains.reduce((s, m) => s + (Number(m.calories) || 0), 0) || 1;
    for (const m of mains) {
      const share = (Number(m.calories) || 0) / sumMainKcal;
      m.calories = Math.round((Number(m.calories) || 0) + excessKcal * share);
      m.protein = Math.round((Number(m.protein) || 0) + excessP * share);
      m.carbs = Math.round((Number(m.carbs) || 0) + excessC * share);
      m.fats = Math.round((Number(m.fats) || 0) + excessF * share);
    }
  }
  Object.assign(h5, lateSnackMacroTargets(h5Kcal > maxKcal ? maxKcal : h5Kcal || maxKcal));
}

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const src = readFileSync('worker.entry.js', 'utf8');
assert(src.includes('function clampLateSnackInMealBreakdown'), 'worker has clampLateSnackInMealBreakdown');
assert(src.includes('LATE_SNACK_ALLOWED_FOODS'), 'worker uses LATE_SNACK_ALLOWED_FOODS');
assert(!src.includes('LOW_GI_FOODS'), 'LOW_GI_FOODS bypass removed');

const day = {
  mealBreakdown: [
    { type: 'Хранене 2', calories: 900, protein: 55, carbs: 100, fats: 35 },
    { type: 'Хранене 4', calories: 900, protein: 60, carbs: 100, fats: 30 },
    { type: 'Хранене 5', calories: 674, protein: 43, carbs: 74, fats: 17 },
  ],
};
clampLateSnackInMealBreakdown(day);
const h5 = day.mealBreakdown.find(m => m.type === 'Хранене 5');
assert(h5.calories === 200, `H5 clamped to 200 (got ${h5.calories})`);
assert(h5.carbs <= 15, `H5 low carbs (got ${h5.carbs})`);
const sum = day.mealBreakdown.reduce((s, m) => s + m.calories, 0);
assert(sum === 2474, `daily kcal preserved (got ${sum})`);

console.log(`\n=== late-snack-normalize: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
