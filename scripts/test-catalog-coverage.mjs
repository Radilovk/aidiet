#!/usr/bin/env node
/**
 * Plan engine v2 stage 4 — catalog coverage across profile matrix.
 * Criterion: <5% profiles fail to build a full 7-day deterministic week.
 */
import { buildDeterministicWeekPlanChunk } from '../step3-deterministic.js';
import { buildDeterministicStrategy } from '../step2-deterministic.js';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';
import { buildGoldenAnalysis } from './plan-adequacy/fixtures/golden-analysis.mjs';
import { inferDishTags } from '../dish-tags.js';
import { MEAL_DISHES } from '../meal-dishes.js';
import {
  rebalanceMealBreakdownSlots,
  enforceFixedSlotCaps,
  syncSchemeDayMetadata,
} from '../plan-normalize.js';

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const EXTRA_PROFILES = [
  {
    id: 'gluten_free',
    gender: 'Жена',
    dietPreference: ['Без глутен'],
    eatingHabits: [],
    medicalConditions: ['Целиакия'],
  },
  {
    id: 'liquid_breakfast',
    gender: 'Мъж',
    eatingHabits: ['Предпочитам течна закуска / смути'],
    dietPreference: ['Балансирано'],
  },
  {
    id: 'insulin_resistance',
    gender: 'Жена',
    clinicalProtocol: 'insulin_resistance',
    medicalConditions: ['Инсулинова резистентност'],
    dietPreference: ['Нисковъглехидратна'],
  },
];

let pass = 0;
let fail = 0;
function ok(cond, msg, detail = '') {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}${detail ? ` — ${detail}` : ''}`); }
}

const liquidBreakfast = MEAL_DISHES.filter(d => inferDishTags(d).includes('liquid_breakfast'));
const lowCarb = MEAL_DISHES.filter(d => inferDishTags(d).includes('low_carb'));
const sweetSlot = MEAL_DISHES.filter(d => inferDishTags(d).includes('sweet_slot'));

ok(MEAL_DISHES.length >= 120, `catalog has 120+ dishes (${MEAL_DISHES.length})`);
ok(liquidBreakfast.length >= 8, `liquid breakfast pool (${liquidBreakfast.length})`);
ok(lowCarb.length >= 12, `low_carb pool (${lowCarb.length})`);
ok(sweetSlot.length >= 10, `sweet_slot pool (${sweetSlot.length})`);

const matrix = [...PROFILES, ...EXTRA_PROFILES];
const failures = [];

for (const profile of matrix) {
  const analysis = buildGoldenAnalysis(profile);
  const kcal = analysis.Final_Calories ?? analysis.recommendedCalories;
  const strategy = buildDeterministicStrategy({ userData: profile, analysis });
  for (const key of DAY_KEYS) {
    const day = strategy.weeklyScheme[key];
    rebalanceMealBreakdownSlots(day, kcal);
    syncSchemeDayMetadata(day);
    enforceFixedSlotCaps(day, kcal);
    syncSchemeDayMetadata(day);
  }
  try {
    const week = await buildDeterministicWeekPlanChunk({
      strategy,
      userData: profile,
      startDay: 1,
      endDay: 7,
      seed: 42,
      relaxed: true,
      includeDessert: strategy.includeDessert,
    });
    const days = Object.keys(week).filter(k => k.startsWith('day')).length;
    if (days !== 7) failures.push(`${profile.id}: ${days}/7 days`);
  } catch (err) {
    failures.push(`${profile.id}: ${err.message}`);
  }
}

const failRate = failures.length / matrix.length;
ok(failures.length === 0, `all ${matrix.length} profiles build 7-day week`, failures.join('; '));
ok(failRate < 0.05, `failure rate <5% (${(failRate * 100).toFixed(1)}%)`);

console.log(`\n=== catalog coverage: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
