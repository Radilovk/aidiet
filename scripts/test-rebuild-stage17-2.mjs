#!/usr/bin/env node
/** Stage 1.7 + Stage 2 contracts — composition repair, product #PD, weekly variety. */
import { readFileSync } from 'node:fs';
import {
  extractCompositionRepairTargets,
  isCompositionRepairableError,
  buildCompositionRepairPrompt,
  applyCompositionRepairPatch,
} from '../composition-repair.js';
import {
  serializePreviousDaysProducts,
  validateWeeklyVariety,
  MAX_REPEATED_DISH_NAMES,
} from '../weekly-variety.js';

const worker = readFileSync('worker.entry.js', 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(isCompositionRepairableError('Ден 2 Хранене 4: калории 400 ≠ цел 550'), 'composition error detected');
ok(!isCompositionRepairableError('Ден 2 Хранене 1: не е в mealBreakdown'), 'structural error excluded');

const targets = extractCompositionRepairTargets(
  ['Ден 3 Хранене 2: калории 400 ≠ цел 600 — смени продуктите'],
  [{ day: 3, type: 'Хранене 4', reason: 'неосъществим слот' }],
);
ok(targets.length === 2, 'extract repair targets from errors + infeasible');

const weekPlan = {
  day3: {
    meals: [
      { type: 'Хранене 2', name: 'Старо', description: '• домати' },
      { type: 'Хранене 4', name: 'X', description: '• зеленчук' },
    ],
  },
};
const strategy = {
  weeklyScheme: {
    wednesday: {
      mealBreakdown: [
        { type: 'Хранене 2', calories: 600, protein: 40, carbs: 50, fats: 15 },
        { type: 'Хранене 4', calories: 500, protein: 35, carbs: 45, fats: 14 },
      ],
    },
  },
};
const prompt = buildCompositionRepairPrompt({
  targets: [targets[0]],
  weekPlan,
  strategy,
  catalogSection: 'PRO: • пилешко месо',
  dayNumberToKey: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
});
ok(prompt.includes('COMPOSITION REPAIR') && prompt.includes('Хранене 2'), 'repair prompt scoped to slot');

const applied = applyCompositionRepairPatch(weekPlan, {
  repairs: [{ day: 3, type: 'Хранене 2', name: 'Ново', description: '• пилешко месо\n• ориз' }],
}, [targets[0]]);
ok(applied === 1 && weekPlan.day3.meals[0].description.includes('пилешко'), 'repair patch applied');

const pd = serializePreviousDaysProducts([
  { day: 1, meals: [{ description: '• пилешко месо\n• ориз' }] },
  { day: 2, meals: [{ description: '• риба\n• салата' }] },
]);
ok(pd.startsWith('#PD v2') && pd.includes('пилешко') && pd.includes('риба'), 'product #PD v2');

const variety = validateWeeklyVariety({
  day1: { meals: [{ type: 'Хранене 2', name: 'A', description: '• ориз' }] },
  day2: { meals: [{ type: 'Хранене 2', name: 'A', description: '• ориз' }] },
  day3: { meals: [{ type: 'Хранене 2', name: 'B', description: '• ориз' }] },
  day4: { meals: [{ type: 'Хранене 2', name: 'C', description: '• ориз' }] },
  day5: { meals: [{ type: 'Хранене 2', name: 'D', description: '• ориз' }] },
  day6: { meals: [{ type: 'Хранене 2', name: 'E', description: '• ориз' }] },
  day7: { meals: [{ type: 'Хранене 2', name: 'F', description: '• ориз' }] },
});
ok(variety.warnings.length === 0, 'variety ok with 6 unique dish names');

const monotonous = validateWeeklyVariety({
  day1: { meals: [{ type: 'Хранене 2', name: 'A', description: '• ориз' }, { type: 'Хранене 4', name: 'B', description: '• ориз' }] },
  day2: { meals: [{ type: 'Хранене 2', name: 'A', description: '• ориз' }, { type: 'Хранене 4', name: 'C', description: '• ориз' }] },
  day3: { meals: [{ type: 'Хранене 2', name: 'D', description: '• ориз' }, { type: 'Хранене 4', name: 'D', description: '• ориз' }] },
  day4: { meals: [{ type: 'Хранене 2', name: 'E', description: '• ориз' }, { type: 'Хранене 4', name: 'E', description: '• ориз' }] },
  day5: { meals: [{ type: 'Хранене 2', name: 'F', description: '• ориз' }, { type: 'Хранене 4', name: 'F', description: '• ориз' }] },
  day6: { meals: [{ type: 'Хранене 2', name: 'G', description: '• ориз' }, { type: 'Хранене 4', name: 'G', description: '• ориз' }] },
  day7: { meals: [{ type: 'Хранене 2', name: 'H', description: '• ориз' }, { type: 'Хранене 4', name: 'H', description: '• ориз' }] },
});
ok(monotonous.warnings.some(w => w.includes('Повтарящи се ястия')), 'variety warns on dish repetition');

ok(worker.includes('COMPOSITION_REPAIR_MAX_PER_CHUNK = 0'), 'worker disables AI composition repair');
ok(worker.includes('buildInfeasibilityRetryHints'), 'worker uses deterministic infeasibility hints');
ok(worker.includes('serializePreviousDaysProducts'), 'worker product #PD');
ok(worker.includes('validateWeeklyVariety'), 'worker weekly variety');

console.log(`\n=== rebuild stage 1.7+2: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
