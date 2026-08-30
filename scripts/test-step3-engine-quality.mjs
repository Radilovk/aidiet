#!/usr/bin/env node
/**
 * Integration quality checks for deterministic Step 3 engine output.
 * Guards catalog pools, solver gram caps, and preserved product features:
 * dessert on lunch, free meal on weekend, skip breakfast.
 */
import { getCatalogCandidatesForChunk } from '../food-catalog.js';
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { syncWeekPlanNutritionFromDatabase } from '../meal-day-sync.js';
import { parseMealDescription } from '../food-nutrition.js';
import {
  userSkipsBreakfast,
  isVeganUser,
  rebalanceMealBreakdownSlots,
  enforceFixedSlotCaps,
  syncSchemeDayMetadata,
} from '../plan-normalize.js';
import {
  validateWeekPlanCombinations,
  validateWeekPlanDayCoherence,
  validateWeeklyDishVariety,
} from '../meal-combinations.js';
import { resolveCatalogEntry } from '../food-catalog.js';
import { READY_MEAL_PARTS } from '../ready-meal-parts.js';
import { normalizeFoodKey } from '../food-utils.js';
import { maxPortionGrams } from '../portion-limits.js';
import { isValidGramStep } from '../gram-rounding.js';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';
import { buildGoldenAnalysis } from './plan-adequacy/fixtures/golden-analysis.mjs';

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

let pass = 0;
let fail = 0;
const CONDIMENT_MAX = 15;

function ok(cond, msg, detail = '') {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}${detail ? ` — ${detail}` : ''}`); }
}

// Field names must match what step2 reads (Final_Calories / macroGrams);
// `dailyCalories` + `macros` were silently ignored and the test ran on defaults.
const analysis = {
  Final_Calories: 1760,
  recommendedCalories: 1760,
  macroGrams: { protein: 120, carbs: 180, fats: 55 },
};

const baseUser = {
  eatingHabits: [],
  dietPreference: ['Балансирано'],
};

const strategy = buildDeterministicStrategy({ userData: baseUser, analysis });
const candidates = getCatalogCandidatesForChunk({
  strategy,
  startDay: 1,
  endDay: 7,
  dietaryModifier: strategy.dietaryModifier,
});

const engPool = candidates.get('ENG') || [];
const fatPool = candidates.get('FAT') || [];
const engNames = engPool.map(e => (e.nutritionKey || e.name).toLowerCase()).join(' ');
const fatNames = fatPool.map(e => (e.nutritionKey || e.name).toLowerCase()).join(' ');

ok(engPool.length > 0, 'ENG pool present with default 5-meal scheme');
ok(/овес|хляб|ориз|картоф/.test(engNames), 'ENG pool includes starches/grains');
ok(/орех|бадем|зехтин|авокадо/.test(fatNames), 'FAT pool includes nuts/oil (not dairy-only)');

const chunk = buildDeterministicWeekPlanChunk({
  strategy,
  userData: baseUser,
  startDay: 1,
  endDay: 7,
  seed: 1,
});

const weekPlan = JSON.parse(JSON.stringify(chunk));
syncWeekPlanNutritionFromDatabase(weekPlan, strategy, 1, 7);

const h3Names = new Set();
let condimentOverCap = [];
for (let d = 1; d <= 7; d++) {
  const h3 = weekPlan[`day${d}`]?.meals?.find(m => m.type === 'Хранене 3');
  if (h3?.name) h3Names.add(h3.name);
  for (const meal of weekPlan[`day${d}`]?.meals || []) {
    for (const item of parseMealDescription(meal.description || '')) {
      const g = item.grams || 0;
      if (/синап|горчица|босилек|риган|чили|пипер|стевия|оцет/i.test(item.name) && g > CONDIMENT_MAX) {
        condimentOverCap.push(`day${d} ${meal.type}: ${item.name} ${g}g`);
      }
    }
  }
}

ok(h3Names.size >= 2, `H3 snacks rotate across week (${h3Names.size} unique)`);
ok(condimentOverCap.length === 0, `no condiment >${CONDIMENT_MAX}g after solver`);

// Free meal on Sunday (default freeDayNumber=7)
ok(
  strategy.weeklyScheme.sunday?.mealBreakdown?.some(m => m.type === 'Свободно хранене'),
  'Sunday scheme has Свободно хранене slot',
);
const sundayMeals = chunk.day7?.meals || [];
ok(
  sundayMeals.some(m => m.type === 'Свободно хранене'),
  'Sunday plan includes Свободно хранене meal',
);
ok(
  !sundayMeals.some(m => m.type === 'Хранене 2'),
  'Sunday has no duplicate H2 when free meal replaces lunch',
);

// Skip breakfast
const skipUser = { ...baseUser, eatingHabits: ['Не закусвам'] };
const skipStrategy = buildDeterministicStrategy({ userData: skipUser, analysis });
const skipChunk = buildDeterministicWeekPlanChunk({
  strategy: skipStrategy,
  userData: skipUser,
  startDay: 1,
  endDay: 1,
  seed: 3,
});
ok(userSkipsBreakfast(skipUser), 'skip-breakfast user detected');
ok(!skipChunk.day1.meals.some(m => m.type === 'Хранене 1'), 'no H1 when skipping breakfast');

// Fixed dessert on lunch (H2) when sweets craving
const sweetUser = { ...baseUser, foodCravings: ['Сладко'] };
ok(buildDeterministicStrategy({ userData: sweetUser, analysis }).includeDessert === true, 'includeDessert when sweets craving');
const sweetChunk = buildDeterministicWeekPlanChunk({
  strategy: buildDeterministicStrategy({ userData: sweetUser, analysis }),
  userData: sweetUser,
  startDay: 1,
  endDay: 3,
  seed: 5,
  includeDessert: true,
});
let dessertDays = 0;
for (let d = 1; d <= 3; d++) {
  const h2 = sweetChunk[`day${d}`]?.meals?.find(m => m.type === 'Хранене 2');
  if (h2?.dessert === true) dessertDays++;
  if (sweetChunk[`day${d}`]?.meals?.some(m => m.type === 'Свободно хранене')) {
    ok(!h2, `free day ${d} has no H2 (replaced by free meal)`);
  }
}
ok(dessertDays >= 1, 'H2 dessert flag set when includeDessert=true');

// Main meals must be coherent dishes, not random macro piles
const READY_DISH = /ориз с пиле|риба с картофи|пилешка салата|пилешка супа|яхния|омлет|овесена каша|сандвич|на скара|на фурна|купа|извара|скир/i;
let incoherent = [];
for (let d = 1; d <= 7; d++) {
  for (const slotType of ['Хранене 1', 'Хранене 2', 'Хранене 4']) {
    const meal = weekPlan[`day${d}`]?.meals?.find(m => m.type === slotType);
    if (!meal) continue;
    const text = `${meal.name} ${meal.description || ''}`.toLowerCase();
    if (/пилешк.*боб|боб.*пилешк|ябълка.*пилешк|пилешк.*ябълка|мляко.*дomat|дomat.*мляко.*кефир.*мляко/i.test(text)) {
      incoherent.push(`day${d} ${slotType}: ${meal.name}`);
    }
    if (!READY_DISH.test(meal.name) && parseMealDescription(meal.description).length > 4) {
      incoherent.push(`day${d} ${slotType}: too many items (${meal.name})`);
    }
  }
}
ok(incoherent.length === 0, `main meals are coherent dishes (${incoherent.slice(0, 3).join('; ') || 'ok'})`);

let badGramSteps = [];
for (let d = 1; d <= 7; d++) {
  for (const meal of weekPlan[`day${d}`]?.meals || []) {
    for (const item of parseMealDescription(meal.description || '')) {
      const g = item.grams || 0;
      if (g <= 0) continue;
      // Продуктово правило: под 50 г — стъпка 5 г; от 50 г нагоре — 50 г.
      if (!isValidGramStep(g)) badGramSteps.push(`${item.name} ${g}g`);
    }
  }
}
ok(badGramSteps.length === 0, `grams on the 5g/50g grid (${badGramSteps.slice(0, 3).join(', ') || 'ok'})`);

// Saturday free day option
const satStrategy = buildDeterministicStrategy({
  userData: baseUser,
  analysis,
  options: { freeDayNumber: 6 },
});
ok(
  satStrategy.weeklyScheme.saturday?.mealBreakdown?.some(m => m.type === 'Свободно хранене'),
  'Saturday freeDayNumber=6 supported in scheme',
);

// ── Matrix pass: every fixture profile must produce a coherent, varied week ──
const matrixProfiles = PROFILES.map(profile => ({
  profile,
  analysis: buildGoldenAnalysis(profile),
}));

for (const { profile, analysis: golden } of matrixProfiles) {
  const kcal = golden.Final_Calories ?? golden.recommendedCalories;
  const strat = buildDeterministicStrategy({ userData: profile, analysis: golden });
  for (const key of DAY_KEYS) {
    const day = strat.weeklyScheme[key];
    rebalanceMealBreakdownSlots(day, kcal);
    syncSchemeDayMetadata(day);
    enforceFixedSlotCaps(day, kcal);
    syncSchemeDayMetadata(day);
  }
  const week = buildDeterministicWeekPlanChunk({
    strategy: strat,
    userData: profile,
    startDay: 1,
    endDay: 7,
    seed: 42,
    includeDessert: strat.includeDessert,
  });
  syncWeekPlanNutritionFromDatabase(week, strat, 1, 7, profile);

  const label = profile.id;
  ok(validateWeekPlanCombinations(week).length === 0,
    `${label}: no incompatible product combinations`,
    validateWeekPlanCombinations(week).slice(0, 2).join('; '));
  ok(validateWeekPlanDayCoherence(week).length === 0,
    `${label}: days are coherent (no repeated dish, plated meals have vegetables)`,
    validateWeekPlanDayCoherence(week).slice(0, 2).join('; '));

  const variety = validateWeeklyDishVariety(week);
  ok(variety.issues.length === 0,
    `${label}: weekly dish variety (${variety.unique}/${variety.total})`);

  // Day totals must land on the prescribed intake.
  let dayDrift = [];
  for (let d = 1; d <= 7; d++) {
    const kcalDay = (week[`day${d}`]?.meals || [])
      .reduce((sum, m) => sum + (Number(m.calories) || 0), 0);
    const schemeKcal = (strat.weeklyScheme[DAY_KEYS[d - 1]].mealBreakdown || [])
      .filter(m => m.type !== 'Свободно хранене')
      .reduce((sum, m) => sum + (Number(m.calories) || 0), 0);
    if (schemeKcal > 0 && Math.abs(kcalDay - schemeKcal) > schemeKcal * 0.11) {
      dayDrift.push(`д${d} ${Math.round(kcalDay)} vs ${schemeKcal}`);
    }
  }
  ok(dayDrift.length === 0, `${label}: day totals within 11% of scheme`, dayDrift.join(', '));

  // Всеки грамаж в плана трябва да е на мрежата 5/50.
  const offGrid = [];
  for (let d = 1; d <= 7; d++) {
    for (const meal of week[`day${d}`]?.meals || []) {
      for (const item of parseMealDescription(meal.description || '')) {
        if (!isValidGramStep(item.grams)) offGrid.push(`д${d} ${item.name} ${item.grams}g`);
      }
    }
  }
  ok(offGrid.length === 0, `${label}: всички грамажи на мрежата 5/50`, offGrid.slice(0, 3).join(', '));

  // Ястието расте свободно спрямо калориите на клиента, но пази формата си:
  // никой продукт не може да се разрасне повече от останалите. Гарнитура,
  // опряла в собствения си таван, законно изостава — обратното е дефект.
  const outOfShape = [];
  for (let d = 1; d <= 7; d++) {
    for (const meal of week[`day${d}`]?.meals || []) {
      const parts = meal.dishId ? READY_MEAL_PARTS[meal.dishId] : null;
      if (!parts?.length) continue;
      const items = parseMealDescription(meal.description || '');
      const scales = [];
      for (const item of items) {
        const part = parts.find(pt => (
          normalizeFoodKey(pt.name) === normalizeFoodKey(item.name)
          || normalizeFoodKey(resolveCatalogEntry(pt.name).entry?.name || '') === normalizeFoodKey(item.name)
        ));
        if (part?.grams) scales.push({ name: item.name, scale: item.grams / part.grams });
      }
      if (scales.length < 2) continue;
      const median = [...scales].sort((a, b) => a.scale - b.scale)[Math.floor(scales.length / 2)].scale;
      for (const s of scales) {
        if (s.scale > median * 1.6) {
          outOfShape.push(`д${d} ${meal.name}: ${s.name} ×${s.scale.toFixed(1)} срещу ×${median.toFixed(1)}`);
        }
      }
    }
  }
  ok(outOfShape.length === 0, `${label}: продуктите пазят пропорцията на ястието`,
    outOfShape.slice(0, 3).join(' | '));

  if (isVeganUser(profile)) {
    const animal = [];
    for (let d = 1; d <= 7; d++) {
      for (const meal of week[`day${d}`]?.meals || []) {
        for (const item of parseMealDescription(meal.description || '')) {
          const entry = resolveCatalogEntry(item.name).entry;
          if (entry && !entry.vegan) animal.push(item.name);
        }
      }
    }
    ok(animal.length === 0, `${label}: no animal products`, [...new Set(animal)].join(', '));
  }
}

console.log(`\n=== step3 engine quality: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
