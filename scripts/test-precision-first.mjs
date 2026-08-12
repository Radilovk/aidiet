#!/usr/bin/env node
/** Precision-first Step 3 — no fallback accept, no AI composition repair, deterministic creation hints. */
import { readFileSync } from 'node:fs';
import {
  maxSlotKcalInChunk,
  buildHighKcalCreationHint,
  buildInfeasibilityRetryHints,
} from '../step3-creation-hints.js';
import { rankCatalogCandidates } from '../candidate-ranking.js';
import { buildCatalogPromptSection } from '../food-catalog.js';

const worker = readFileSync('worker.entry.js', 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const strategy = {
  weeklyScheme: {
    monday: { mealBreakdown: [{ type: 'Хранене 2', calories: 1112, protein: 70, carbs: 90, fats: 35 }] },
    tuesday: { mealBreakdown: [{ type: 'Хранене 4', calories: 500, protein: 35, carbs: 45, fats: 14 }] },
  },
};

ok(maxSlotKcalInChunk(strategy, 1, 7, dayKeys) === 1112, 'max slot kcal from frozen scheme');
ok(buildHighKcalCreationHint(500) === '', 'no hint below 600 kcal threshold');
ok(buildHighKcalCreationHint(700).includes('PRO + ENG'), 'medium high-kcal hint');
ok(buildHighKcalCreationHint(1000).includes('900'), 'very high-kcal hint');

const infeasibleHint = buildInfeasibilityRetryHints([
  { day: 2, type: 'Хранене 2', reason: 'неосъществим слот' },
]);
ok(infeasibleHint.includes('INFEASIBLE') && infeasibleHint.includes('Хранене 2'), 'infeasibility retry hint');

const denseRanked = rankCatalogCandidates(
  [
    { name: 'Домати', nutritionKey: 'домати', universality: 5, group: 'vegetable', slots: ['VOL'] },
    { name: 'Ориз', nutritionKey: 'ориз', universality: 5, group: 'carb', slots: ['ENG'] },
    { name: 'Пилешко', nutritionKey: 'пилешко месо', universality: 5, group: 'protein', slots: ['PRO'] },
  ],
  { maxSlotKcal: 1000, limit: 3 },
);
ok(denseRanked[0]?.slots?.includes('PRO') || denseRanked[0]?.slots?.includes('ENG'), 'high-kcal ranking prefers dense PRO/ENG');

const catalog = buildCatalogPromptSection({
  strategy,
  startDay: 1,
  endDay: 1,
  dietaryModifier: 'Балансирано',
});
ok(catalog.includes('1112') || catalog.includes('900') || catalog.includes('600'), 'catalog prompt includes high-kcal creation hint');

ok(worker.includes('COMPOSITION_REPAIR_MAX_PER_CHUNK = 0'), 'AI composition repair disabled');
ok(worker.includes('step3-creation-hints.js'), 'worker imports creation hints');
ok(worker.includes('buildInfeasibilityRetryHints'), 'worker uses infeasibility retry hints');
ok(!worker.includes('bestSnapshot && !hasBlockingNutritionErrors'), 'no partial chunk fallback accept');
ok(!worker.includes('tryCompositionRepair'), 'no AI composition repair call in worker');
ok(worker.includes('Precision-first: each chunk must pass validation cleanly'), 'precision-first chunk policy documented');

console.log(`\n=== precision-first: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
