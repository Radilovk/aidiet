#!/usr/bin/env node
/**
 * Build-time превод на упражнения чрез Gemini 2.5 Flash.
 *
 *   GEMINI_API_KEY=... node scripts/translate-exercises.mjs
 *   node scripts/translate-exercises.mjs --limit 80        # тестова партида
 *   node scripts/translate-exercises.mjs --force           # презапис на всички
 *
 * Резултат: data/exercise-translations-bg.json
 * След това: npm run build:index && wrangler kv key put ...
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pickInstructionsEn } from '../exercise-translations.js';
import { localizeExerciseDisplayName } from '../exercise-labels-bg.js';

const DATASET_URL = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/data/exercises.json';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const BATCH_SIZE = Number(process.env.TRANSLATE_BATCH_SIZE) || 50;
const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY) || 4;
const OUT_PATH = new URL('../data/exercise-translations-bg.json', import.meta.url);
const CHECKPOINT_PATH = new URL('../data/.translate-checkpoint.json', import.meta.url);

const SYSTEM_PROMPT = `Ти си експерт по спортна медицина, кинезиология и професионален фитнес треньор.
Превеждай на анатомично точен, професионален и четивен български език.
Не превеждай буквално жаргона — използвай утвърдени български термини:
- bench press → избутване от лежанка (НЕ „лег преса“ за bench)
- leg press → преса за крака
- hip hinge → сгъване в тазобедрените стави
- core bracing → стягане на коремния корсет
Запази HTML тагове, ако има. Връщай САМО валиден JSON без markdown.`;

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

async function fetchDataset() {
  const res = await fetch(DATASET_URL);
  if (!res.ok) throw new Error(`Dataset HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.exercises || data.data || []);
}

function needsTranslation(ex, existing, force) {
  if (force) return true;
  const id = String(ex.id);
  const cur = existing[id];
  if (!cur) return true;
  const en = pickInstructionsEn(ex.instructions);
  const hash = contentHash(ex.name, en);
  return cur.sourceHash !== hash;
}

function contentHash(name, instructionsEn) {
  return createHash('sha256').update(`${name}\n${instructionsEn}`).digest('hex').slice(0, 16);
}

function buildUserPayload(batch) {
  const items = batch.map((ex) => ({
    id: String(ex.id),
    nameEn: ex.name || '',
    equipment: ex.equipment || '',
    instructionsEn: pickInstructionsEn(ex.instructions).slice(0, 900),
    suggestedNameBg: localizeExerciseDisplayName(ex.name, '', ex.equipment),
  }));
  return `Преведи следните ${items.length} упражнения. За всяко върни nameBg (кратко българско име) и instructionsBg (пълен превод на инструкциите).

Формат на отговора (строго):
{"translations":[{"id":"...","nameBg":"...","instructionsBg":"..."}]}

${JSON.stringify({ exercises: items })}`;
}

async function callGemini(apiKey, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 400)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.filter((p) => !p.thought)
    ?.map((p) => p.text)
    .join('') || '';
  if (!text) throw new Error('Gemini: празен отговор');
  return JSON.parse(text);
}

function normalizeBatchResult(parsed, batch) {
  const list = parsed?.translations || parsed?.exercises || (Array.isArray(parsed) ? parsed : []);
  const byId = new Map(list.map((row) => [String(row.id), row]));
  const out = {};
  for (const ex of batch) {
    const id = String(ex.id);
    const row = byId.get(id);
    if (!row?.nameBg && !row?.instructionsBg) continue;
    const en = pickInstructionsEn(ex.instructions);
    out[id] = {
      nameBg: String(row.nameBg || '').trim(),
      instructionsBg: String(row.instructionsBg || '').trim(),
      sourceHash: contentHash(ex.name, en),
      translatedAt: new Date().toISOString(),
    };
  }
  return out;
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
  const all = await fetchDataset();
  let pending = all.filter((ex) => needsTranslation(ex, merged, opts.force));
  if (opts.limit > 0) pending = pending.slice(0, opts.limit);

  console.log(`Общо: ${all.length} | За превод: ${pending.length} | Вече готови: ${Object.keys(merged).length}`);

  if (!pending.length) {
    console.log('Няма нови упражнения за превод.');
    return;
  }

  const batches = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    batches.push(pending.slice(i, i + BATCH_SIZE));
  }

  if (opts.dryRun) {
    console.log(`Dry-run: ${batches.length} партиди × ~${BATCH_SIZE} (concurrency ${CONCURRENCY})`);
    return;
  }

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });

  const batchResults = await mapPool(batches, CONCURRENCY, async (batch, batchIdx) => {
    process.stdout.write(`Партида ${batchIdx + 1}/${batches.length} (${batch.length} упр.)… `);
    try {
      const parsed = await callGemini(apiKey, buildUserPayload(batch));
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
