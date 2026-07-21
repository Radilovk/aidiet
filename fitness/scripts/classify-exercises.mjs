#!/usr/bin/env node
/**
 * Offline batch класификация на упражнения (EFP).
 * GEMINI_API_KEY=... node fitness/scripts/classify-exercises.mjs [--force] [--limit N]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchExerciseDataset,
  chunkBatches,
  classifyBatchResilient,
  classificationStats,
  listPendingClassifications,
  CLASSIFY_BATCH_SIZE,
} from '../exercise-classify-batch.js';
import { heuristicClassification } from '../exercise-metadata.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'data', 'exercise-metadata.json');

const force = process.argv.includes('--force');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 0;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY липсва');
  process.exit(1);
}

const all = await fetchExerciseDataset();
let existing = {};
try {
  const mod = await import('../data/exercise-metadata.json', { with: { type: 'json' } });
  existing = mod.default || mod;
} catch { /* първи run */ }

let pending = listPendingClassifications(all, existing, { force, limit });
console.log(`Pending: ${pending.length} / ${all.length}`);

const batches = chunkBatches(pending, CLASSIFY_BATCH_SIZE);
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  process.stdout.write(`Batch ${i + 1}/${batches.length} (${batch.length})… `);
  const chunk = await classifyBatchResilient(apiKey, batch, model);
  Object.assign(existing, chunk);
  console.log(`+${Object.keys(chunk).length}`);
}

// Heuristic fallback за останалите
for (const ex of all) {
  const id = String(ex.id);
  if (!existing[id]) {
    const h = heuristicClassification(ex);
    existing[id] = { ...h, classifiedAt: new Date().toISOString(), heuristicOnly: true };
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(existing, null, 0));

const stats = classificationStats(all, existing);
console.log('Done:', stats, '→', outFile);
