#!/usr/bin/env node
/** Stage 3 — food ledger + admin catalog overlay contracts. */
import {
  validateOverlayEntry,
  normalizeOverlayEntry,
  serializeOverlayDocument,
  parseOverlayDocument,
  isBaseCatalogId,
} from '../admin-food-catalog.js';
import {
  buildFoodLedger,
  buildAdherenceRatio,
  serializeFoodLedger,
  planDayIndex,
  planSliceForLedgerSync,
  analyticsSyncSignature,
  LEDGER_VERSION,
} from '../food-ledger.js';
import { rankCatalogCandidates } from '../candidate-ranking.js';
import { readFileSync } from 'node:fs';

const worker = readFileSync('worker.entry.js', 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const atomic = normalizeOverlayEntry({
  id: 'menu_test',
  name: 'Тест ястие',
  nutritionKey: 'тест ястие',
  group: 'ready_meal',
  slots: ['PRO', 'ENG'],
  timing: ['main'],
  universality: 4,
  scalingMode: 'atomic_fixed',
  fixedNutrition: { kcal: 500, p: 40, c: 35, f: 15, weightGrams: 380 },
});
ok(validateOverlayEntry(atomic).length === 0, 'overlay entry validates');
ok(!isBaseCatalogId('menu_test'), 'overlay id not base');

const doc = serializeOverlayDocument([atomic], 'test');
ok(parseOverlayDocument(JSON.stringify(doc)).entries.length === 1, 'overlay round-trip');

const weekPlan = {
  day1: { meals: [{ type: 'Хранене 2', description: '• пилешко месо\n• ориз' }] },
  day2: { meals: [{ type: 'Хранене 4', description: '• риба\n• зеленчук' }] },
};
const gameData = {
  '2026-08-11': { meals: { 'Хранене 2': true } },
};
ok(planDayIndex('2026-08-11', '2026-08-11') === 1, 'plan day index');
const ledger = buildFoodLedger(weekPlan, gameData, { dietStartDate: '2026-08-11' });
const ratio = buildAdherenceRatio(ledger);
ok(ratio.get('пилешко месо') === 1, 'eaten/prescribed for checked meal');
ok(ratio.get('ориз') === 1, 'all products in checked meal count as eaten');
ok(!ratio.has('риба') || ratio.get('риба') === 0, 'uneaten day products');

const ratioBoost = new Map([['пилешко месо', 1], ['ориз', 0.2]]);
const ranked = rankCatalogCandidates(
  [
    { name: 'Ориз', nutritionKey: 'ориз', universality: 5, group: 'carb' },
    { name: 'Пилешко', nutritionKey: 'пилешко месо', universality: 5, group: 'protein' },
  ],
  { adherenceRatio: ratioBoost, limit: 2 },
);
ok(ranked[0]?.nutritionKey === 'пилешко месо', 'ranking boosts high-adherence product');

ok(worker.includes('persistFoodLedger'), 'worker persists ledger');
ok(worker.includes('loadAdherenceRatioForGeneration'), 'worker loads adherence');
ok(worker.includes('handleGetFoodCatalogOverlay'), 'worker admin food catalog');
ok(worker.includes('adherenceRatio: data._adherenceRatio'), 'catalog uses adherence');
ok(readFileSync('plan-source-meta.js', 'utf8').includes('ledgerVersion'), 'source meta ledger');

const slice = planSliceForLedgerSync({ weekPlan: { day1: {} }, sourceMeta: { catalogVersion: 'cat_x' } });
ok(slice?.weekPlan?.day1 && slice.sourceMeta.catalogVersion === 'cat_x', 'plan slice for sync');
ok(analyticsSyncSignature('u1', { '2026-01-01': { dailyScore: 80 } }, slice).includes('cat_x'), 'sync signature includes catalog');

console.log(`\n=== stage3 food ledger+admin: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
