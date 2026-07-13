#!/usr/bin/env node
/**
 * Build-time превод на упражнения чрез Gemini 2.5 Flash.
 *
 *   GEMINI_API_KEY=... node scripts/translate-exercises.mjs
 *   node scripts/translate-exercises.mjs --limit 80
 *   node scripts/translate-exercises.mjs --force
 *
 * Резултат: data/exercise-translations-bg.json
 * След това: npm run build:index
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_TRANSLATE_MODEL,
  buildTranslateUserPayload,
  callGeminiTranslate,
  chunkBatches,
  fetchExerciseDataset,
  listPendingExercises,
  normalizeBatchResult,
  translationStats,
} from '../exercise-translate-batch.js';

const MODEL = process.env.GEMINI_MODEL || DEFAULT_TRANSLATE_MODEL;
const BATCH_SIZE = Number(process.env.TRANSLATE_BATCH_SIZE) || DEFAULT_BATCH_SIZE;
const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY) || 4;
const OUT_PATH = new URL('../data/exercise-translations-bg.json', import.meta.url);
const CHECKPOINT_PATH = new URL('../data/.translate-checkpoint.json', import.meta.url);

function parseArgs(argv) {
  const opts = { limit: 0, force: false, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--limit') opts.limit = Number(argv[++i]) || 0;
    else if (argv[i] === '--force') opts.force = true;
    else if (argv[i] === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

async function loadJson(path, fallback) {
  try {
    await access(path);
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function mapPool(items, concurrency, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  const opts = parseArgs(process.argv);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !opts.dryRun) {
    console.error('Липсва GEMINI_API_KEY. Задай: GEMINI_API_KEY=... node scripts/translate-exercises.mjs');
    process.exit(1);
  }

  const existing = await loadJson(OUT_PATH, {});
  const checkpoint = await loadJson(CHECKPOINT_PATH, {});
  const merged = { ...existing, ...checkpoint };

  console.log('Теглене на dataset…');
  const all = await fetchExerciseDataset();
  const pending = listPendingExercises(all, merged, { force: opts.force, limit: opts.limit });
  const stats = translationStats(all, merged);

  console.log(`Общо: ${stats.total} | За превод: ${pending.length} | Готови: ${stats.done}`);

  if (!pending.length) {
    console.log('Няма нови упражнения за превод.');
    return;
  }

  const batches = chunkBatches(pending, BATCH_SIZE);

  if (opts.dryRun) {
    console.log(`Dry-run: ${batches.length} партиди × ~${BATCH_SIZE} (concurrency ${CONCURRENCY})`);
    return;
  }

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });

  const batchResults = await mapPool(batches, CONCURRENCY, async (batch, batchIdx) => {
    process.stdout.write(`Партида ${batchIdx + 1}/${batches.length} (${batch.length} упр.)… `);
    try {
      const parsed = await callGeminiTranslate(apiKey, buildTranslateUserPayload(batch), MODEL);
      const chunk = normalizeBatchResult(parsed, batch);
      Object.assign(merged, chunk);
      await writeFile(OUT_PATH, JSON.stringify(merged, null, 0));
      await writeFile(CHECKPOINT_PATH, JSON.stringify(merged));
      console.log(`OK (+${Object.keys(chunk).length})`);
      return chunk;
    } catch (e) {
      console.log(`ГРЕШКА: ${e.message}`);
      throw e;
    }
  });

  const added = batchResults.reduce((n, c) => n + Object.keys(c || {}).length, 0);
  console.log(`\nГотово. Нови/обновени: ${added}. Файл: ${OUT_PATH.pathname}`);
  console.log('Следващо: npm run build:index');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
