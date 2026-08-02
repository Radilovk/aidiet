#!/usr/bin/env node
/**
 * Пълна AI класификация на 1324 упражнения (EFP v2).
 * GEMINI_API_KEY=... node fitness/scripts/classify-exercises.mjs [--force] [--limit N]
 *
 * Без GEMINI_API_KEY: node fitness/scripts/run-production-classify-loop.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchExerciseDataset,
  classifyBatchResilient,
  classificationStats,
  listPendingClassifications,
  classifyContentHash,
} from '../exercise-classify-batch.js';
import { pickInstructionsEn } from '../exercise-translations.js';
import { EFP_VERSION } from '../exercise-efp-rubric.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'data', 'exercise-metadata.json');

const force = process.argv.includes('--force');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 0;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY липсва. Ползвай: node fitness/scripts/run-production-classify-loop.mjs');
  process.exit(1);
}

const all = await fetchExerciseDataset();
let existing = {};
try {
  const mod = await import('../data/exercise-metadata.json', { with: { type: 'json' } });
  existing = mod.default || mod;
} catch { /* първи run */ }

let pending = listPendingClassifications(all, existing, { force, limit });
console.log(`EFP v${EFP_VERSION} — pending: ${pending.length} / ${all.length}`);

const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
let done = 0;

for (const ex of pending) {
  const id = String(ex.id);
  process.stdout.write(`[${done + 1}/${pending.length}] ${ex.name}… `);
  try {
    const chunk = await classifyBatchResilient(apiKey, [ex], model);
    Object.assign(existing, chunk);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(existing, null, 0));
    console.log(`d${chunk[id]?.diff} gf${chunk[id]?.gf} gm${chunk[id]?.gm}`);
    done++;
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 200));
}

const stats = classificationStats(all, existing);
console.log('Done:', stats, '→', outFile);
