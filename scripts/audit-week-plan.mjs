#!/usr/bin/env node
/**
 * Dietitian-style week plan audit — run while editing meal-dishes.json.
 *
 * Usage:
 *   node scripts/audit-week-plan.mjs --profile=kamen_benchmark
 *   node scripts/audit-week-plan.mjs --profile=skip_breakfast_athlete --seed=7
 *   node scripts/audit-week-plan.mjs --kcal=1760 --meals=5
 *
 * Checks what a dietitian would look at: day energy, protein rotation,
 * plated vegetables, portion realism, slot vs day contract.
 */
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { syncWeekPlanNutritionFromDatabase } from '../meal-day-sync.js';
import { parseMealDescription } from '../food-nutrition.js';
import {
  isDayCaloriesAdequate,
  isMealCaloriesAdequate,
  dayCalorieTolerance,
  slotCalorieTolerance,
  classifyInfeasibleSlots,
} from '../plan-normalize.js';
import { inferDishProteinFamily, dishHasFruit, dishHasMajorStarch } from '../dish-protein-family.js';
import {
  validateWeekPlanDayCoherence,
  validateWeekPlanCombinations,
} from '../meal-combinations.js';
import { HARD_PROFILES } from './plan-adequacy/fixtures/hard-profiles.mjs';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';
import { buildGoldenAnalysis } from './plan-adequacy/fixtures/golden-analysis.mjs';

const args = process.argv.slice(2);
const profileId = args.find(a => a.startsWith('--profile='))?.split('=')[1] || 'kamen_benchmark';
const seed = Number(args.find(a => a.startsWith('--seed='))?.split('=')[1] || 11);
const customKcal = Number(args.find(a => a.startsWith('--kcal='))?.split('=')[1] || 0);

const ANALYSIS_OVERRIDES = {
  kamen_benchmark: {
    Final_Calories: 3088,
    recommendedCalories: 3088,
    macroGrams: { protein: 204, carbs: 334, fats: 97 },
  },
  skip_breakfast_athlete: {
    Final_Calories: 2991,
    recommendedCalories: 2991,
    macroGrams: { protein: 198, carbs: 325, fats: 88 },
  },
};

const profile = [...HARD_PROFILES, ...PROFILES].find(p => p.id === profileId);
if (!profile) {
  console.error(`Unknown profile: ${profileId}`);
  process.exit(2);
}

const analysis = customKcal > 0
  ? { ...buildGoldenAnalysis(profile), Final_Calories: customKcal, recommendedCalories: customKcal }
  : (ANALYSIS_OVERRIDES[profileId] || buildGoldenAnalysis(profile));

const strategy = buildDeterministicStrategy({ userData: profile, analysis });
const chunk = await buildDeterministicWeekPlanChunk({
  strategy,
  userData: profile,
  startDay: 1,
  endDay: 7,
  seed,
});
syncWeekPlanNutritionFromDatabase(chunk, strategy, 1, 7, profile);

const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const schemeKcal = Number(strategy.weeklyScheme?.monday?.calories) || Number(analysis.Final_Calories);

console.log('═══════════════════════════════════════════════════');
console.log(`AUDIT: ${profile.name || profileId} | ${schemeKcal} kcal/day | seed ${seed}`);
console.log('═══════════════════════════════════════════════════\n');

let pass = 0;
let warn = 0;
let fail = 0;

function mark(ok, msg) {
  if (ok) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
}
function note(msg) {
  warn++;
  console.log(`  ⚠ ${msg}`);
}

for (let d = 1; d <= 7; d++) {
  const day = chunk[`day${d}`];
  const dayTarget = strategy.weeklyScheme[dayKeys[d - 1]];
  if (!day?.meals?.length) continue;

  const dayKcal = day.meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
  const targetKcal = (dayTarget?.mealBreakdown || [])
    .reduce((s, m) => s + (Number(m.calories) || 0), 0) || schemeKcal;
  const dayOk = isDayCaloriesAdequate(dayKcal, targetKcal);
  const dayTol = dayCalorieTolerance(targetKcal);

  console.log(`── Ден ${d} ── ${dayKcal} / ${targetKcal} kcal (${dayOk ? 'OK' : 'FAIL'}, допуск ±${dayTol})`);

  const plated = day.meals.filter(m => m.type === 'Хранене 2' || m.type === 'Хранене 4');
  const families = plated.map(m => inferDishProteinFamily({ id: m.dishId }));
  if (families.length === 2 && families[0] === families[1] && families[0] !== 'other') {
    note(`обяд+вечеря: един и същ протеин (${families[0]})`);
  } else {
    mark(true, `протеин ротация: ${families.join(' → ') || '—'}`);
  }

  let fruitCount = 0;
  let starchCount = 0;
  for (const meal of day.meals) {
    if (dishHasFruit({ id: meal.dishId })) fruitCount++;
    if (dishHasMajorStarch({ id: meal.dishId })) starchCount++;
  }
  if (fruitCount > 1) note(`${fruitCount} плодови ястия в един ден`);
  if (starchCount > 3) note(`${starchCount} нишестени ястия в един ден`);

  for (const meal of day.meals) {
    if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
    const slot = dayTarget?.mealBreakdown?.find(m => m.type === meal.type);
    const targetCal = Number(meal.targetCalories) || Number(slot?.calories) || 0;
    const mealCal = Number(meal.calories) || 0;
    const slotOk = !targetCal || isMealCaloriesAdequate(mealCal, targetCal);
    const items = parseMealDescription(meal.description || '');
    const gramsLine = items.map(i => `${i.name} ${i.grams}g`).join(', ');
    const flag = slotOk || dayOk ? '' : ' ← слот';
    console.log(`  ${meal.type} | ${meal.name} | ${mealCal} kcal (цел ${targetCal})${flag}`);
    if (gramsLine) console.log(`    ${gramsLine}`);
    for (const item of items) {
      if (item.grams > 350 && !/ориз|картоф|боб|зеленчук|салата|морков/i.test(item.name)) {
        note(`голяма порция: ${item.name} ${item.grams}g (ден ${d})`);
      }
    }
  }
  console.log('');
}

const combo = validateWeekPlanCombinations(chunk);
const coherence = validateWeekPlanDayCoherence(chunk);
const infeasible = classifyInfeasibleSlots(chunk, strategy, []);

console.log('── Седмица ──');
mark(combo.length === 0, `комбинации продукти (${combo.length} проблема)`);
mark(coherence.length === 0, `когерентност ден (${coherence.length} проблема)`);
mark(infeasible.blocking.length === 0, `блокиращи слотове (${infeasible.blocking.length})`);
if (infeasible.warnings.length) {
  for (const w of infeasible.warnings.slice(0, 5)) note(w);
}

const dishIds = new Set();
let variety = 0;
for (let d = 1; d <= 7; d++) {
  for (const meal of chunk[`day${d}`]?.meals || []) {
    if (meal.dishId && !dishIds.has(meal.dishId)) {
      dishIds.add(meal.dishId);
      variety++;
    }
  }
}
mark(variety >= 12, `разнообразие ястия: ${variety}/~20`);

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`Резултат: ${pass} OK, ${warn} предупреждения, ${fail} FAIL`);
console.log('Референция: Mediterranean ~3000 kcal — 5 приема, протеин+нишесте+зеленчук, ротация.');
console.log('═══════════════════════════════════════════════════\n');

process.exit(fail > 0 ? 1 : 0);
