#!/usr/bin/env node
import {
  buildSlotRepairPrompt,
  parseSlotRepairResponse,
  isValidSlotRepairPick,
  SLOT_REPAIR_CANDIDATE_COUNT,
  SLOT_REPAIR_MAX_CALLS_PER_PLAN,
} from '../step3-slot-repair.js';
import {
  buildDeterministicWeekPlanChunk,
  listReadyMealCandidates,
} from '../step3-deterministic.js';
import { getCatalogCandidatesForChunk } from '../food-catalog.js';
import { SLOT_REPAIR_MAX_CALLS_PER_PLAN as PLAN_MAX } from '../plan-engine.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(SLOT_REPAIR_CANDIDATE_COUNT === 5, '5 repair candidates');
ok(SLOT_REPAIR_MAX_CALLS_PER_PLAN === 2, 'max 2 repair calls per plan');
ok(PLAN_MAX === 2, 'plan-engine exports same max');

const candidates = [
  { id: 'meal_a', name: 'Ястие А' },
  { id: 'meal_b', name: 'Ястие Б' },
];

const prompt = buildSlotRepairPrompt({
  dayNum: 3,
  slotType: 'Хранене 2',
  slotTarget: { calories: 550 },
  candidates,
  dietaryModifier: 'Кетогенна',
});
ok(prompt.includes('meal_a'), 'prompt lists candidate ids');
ok(prompt.includes('550'), 'prompt includes slot kcal');
ok(!/ADLE|макро-роля/i.test(prompt), 'prompt has no ADLE rules');

const pick = parseSlotRepairResponse('{"dishId":"meal_b"}', candidates);
ok(pick?.id === 'meal_b', 'parses dishId from JSON');
ok(isValidSlotRepairPick(pick, candidates), 'valid pick in candidate set');
ok(!parseSlotRepairResponse('{"dishId":"meal_x"}', candidates), 'rejects unknown dishId');

function makeStrategy() {
  const dailyKcal = 2000;
  const types = ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4'];
  const weights = [0.25, 0.35, 0.15, 0.25];
  const mealBreakdown = types.map((type, i) => ({
    type,
    calories: Math.round(dailyKcal * weights[i]),
    protein: 30,
    carbs: 40,
    fats: 15,
  }));
  const day = { meals: 4, calories: dailyKcal, protein: 120, carbs: 160, fats: 60, mealBreakdown };
  return {
    dietaryModifier: 'Балансирано',
    weeklyScheme: Object.fromEntries(
      ['monday'].map(k => [k, { ...day }]),
    ),
  };
}

const strategy = makeStrategy();
const candidatesBySlot = getCatalogCandidatesForChunk({
  strategy,
  startDay: 1,
  endDay: 1,
  dietaryModifier: strategy.dietaryModifier,
});
const slot = strategy.weeklyScheme.monday.mealBreakdown.find(m => m.type === 'Хранене 2');
const list = listReadyMealCandidates(
  'Хранене 2',
  slot,
  candidatesBySlot,
  {
    seed: 1,
    dayNum: 1,
    slotIndex: 1,
    slotTarget: slot,
    usedProducts: new Map(),
    usedDishes: new Map(),
    slotDishUses: new Map(),
    dishesToday: new Set(),
    achievableCache: new Map(),
    dietCtx: { dietaryModifier: 'Балансирано', dietPreference: null, dietDislike: '' },
    blockedTerms: [],
    loveSet: new Set(),
    adherenceRatio: new Map(),
    relaxed: true,
    tagFilter: null,
  },
);
ok(list.length >= 1 && list.length <= 5, `lists ${list.length} repair candidates`);

let repairCalls = 0;
const chunk = await buildDeterministicWeekPlanChunk({
  strategy,
  userData: { dietPreference: ['Балансирано'] },
  startDay: 1,
  endDay: 1,
  seed: 5,
  relaxed: true,
  repairSlot: async ({ candidates: opts }) => {
    repairCalls += 1;
    return opts[0] || null;
  },
});
ok(chunk.day1?.meals?.length >= 3, 'chunk builds with mock repair callback');
ok(repairCalls === 0, 'mock repair not called when deterministic pick succeeds');

console.log(`\n=== step3 slot repair: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
