#!/usr/bin/env node
/** Chunk validation — kcal-first: daily macro grams are soft when daily kcal matches scheme. */
import { readFileSync } from 'node:fs';
import { isCompositionRepairableError } from '../composition-repair.js';

const worker = readFileSync('worker.entry.js', 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(worker.includes('CHUNK_NUTRITION_BLOCKING_PATTERNS'), 'blocking nutrition patterns defined');
ok(worker.includes('return { blocking, warnings }'), 'validateWeekPlanChunkAgainstScheme returns split');
ok(worker.includes('if (dayKcalOk) warnings.push(msg)'), 'daily macro soft when kcal ok');
ok(!worker.includes('композицията не носи/i,'), 'broad composition regex removed from hasBlockingNutritionErrors');

const dailyMacroSoft =
  'Ден 2: протеин 150g ≠ цел 180g — композицията не носи този макро профил, смени продукти';
const slotKcal =
  'Ден 2 Хранене 4: калории 698 ≠ цел 1112 — смени продуктите или състава';

ok(isCompositionRepairableError(slotKcal), 'slot kcal error is repairable');
ok(!isCompositionRepairableError(dailyMacroSoft), 'daily macro drift is not composition-repairable');

console.log(`\n=== chunk validation contracts: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
