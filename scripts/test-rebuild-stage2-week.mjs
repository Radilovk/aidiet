#!/usr/bin/env node
/** Stage 2 week-at-once — DAYS_PER_CHUNK=7, dynamic task section, token limits. */
import { readFileSync } from 'node:fs';
import {
  DAYS_PER_CHUNK,
  mealPlanTokenLimitForChunk,
  enrichmentTokenLimitForChunk,
  buildStep3DaysRangeHeader,
  buildStep3ChunkTaskSection,
} from '../step3-chunk.js';
import { getPlanStepResponseSchema } from '../plan-response-schemas.js';

const worker = readFileSync('worker.entry.js', 'utf8');
const prompt = readFileSync('KV/prompts/admin_meal_plan_prompt.txt', 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(DAYS_PER_CHUNK === 7, 'DAYS_PER_CHUNK = 7');
ok(mealPlanTokenLimitForChunk(7) >= 16000, 'week token limit ≥16000');
ok(enrichmentTokenLimitForChunk(7) >= 12000, 'enrichment token limit for week');
ok(buildStep3DaysRangeHeader(1, 7) === 'DAYS 1–7', 'days range header');
ok(buildStep3DaysRangeHeader(3, 3) === 'DAY 3', 'single day header');

const weekTask = buildStep3ChunkTaskSection({ startDay: 1, endDay: 7, userName: 'Test' });
ok(weekTask.includes('day1') && weekTask.includes('day7') && weekTask.includes('Rotate'), 'week task section');
ok(buildStep3ChunkTaskSection({ startDay: 2, endDay: 2, userName: 'X' }).includes('{"day2"'), 'single-day JSON contract');

ok(prompt.includes('{chunkTaskSection}') && prompt.includes('{daysRangeHeader}'), 'KV prompt uses chunk placeholders');
ok(!prompt.includes('Return ONLY JSON for day {startDay}'), 'legacy single-day return removed from KV');

ok(worker.includes("from './step3-chunk.js'"), 'worker imports step3-chunk');
ok(worker.includes('mealPlanTokenLimitForChunk'), 'worker dynamic token limit');
ok(worker.includes('buildStep3ChunkTaskSection'), 'worker injects chunk task');
ok(!worker.includes('const DAYS_PER_CHUNK = 1'), 'DAYS_PER_CHUNK=1 removed');

const step3Schema = getPlanStepResponseSchema('step3_meal_plan_chunk_1');
ok(step3Schema?.required?.length === 7, 'chunk_1 schema requires day1–day7');
ok(step3Schema?.required?.includes('day7'), 'chunk_1 schema includes day7');

console.log(`\n=== rebuild stage2 week-at-once: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
