#!/usr/bin/env node
/**
 * Генерира fitness/data/exercise-difficulty-ref.json от open-source референции.
 * node fitness/scripts/build-classification-ref.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchExerciseDataset } from '../exercise-translate-batch.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'data', 'exercise-difficulty-ref.json');

const YUHONAS_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const HARSH_URL = 'https://raw.githubusercontent.com/harshvishu/free-exercise-db-with-videos/main/data/exercises.json';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);

function tokenScore(a, b) {
  const at = new Set(tokens(a));
  const bt = new Set(tokens(b));
  if (!at.size || !bt.size) return 0;
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter++;
  return inter / Math.max(at.size, bt.size);
}

function buildPoolEntry(e, source) {
  const names = [e.name, ...(e.aliases || [])];
  const level = e.level || e.difficulty;
  return { names, level, source, mechanic: e.mechanic, category: e.category };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const [ours, yuhonasRaw, harshRaw] = await Promise.all([
  fetchExerciseDataset(),
  fetchJson(YUHONAS_URL),
  fetchJson(HARSH_URL),
]);

const harshData = harshRaw.data || harshRaw;
const pool = [
  ...yuhonasRaw.map((e) => buildPoolEntry(e, 'yuhonas')),
  ...harshData.map((e) => buildPoolEntry(e, 'harshvishu')),
];

const exactMap = new Map();
for (const entry of pool) {
  for (const n of entry.names) exactMap.set(norm(n), entry);
}

function findMatch(name) {
  const base = name.replace(/\([^)]*\)/g, '').trim();
  const exact = exactMap.get(norm(base)) || exactMap.get(norm(name));
  if (exact) return { ...exact, match: 'exact' };

  let best = null;
  let bestScore = 0;
  for (const entry of pool) {
    for (const n of entry.names) {
      const score = tokenScore(base, n);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
  }
  if (bestScore >= 0.88) return { ...best, match: 'fuzzy', score: bestScore };
  return null;
}

const out = {};
let exact = 0;
let fuzzy = 0;
for (const ex of ours) {
  const hit = findMatch(ex.name || '');
  if (!hit?.level) continue;
  const id = String(ex.id);
  out[id] = {
    level: hit.level,
    source: hit.source,
    match: hit.match,
    ...(hit.score ? { score: Math.round(hit.score * 100) / 100 } : {}),
  };
  if (hit.match === 'exact') exact++;
  else fuzzy++;
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(out, null, 0)}\n`);

console.log('Wrote', outFile);
console.log({
  exercises: ours.length,
  matched: Object.keys(out).length,
  exact,
  fuzzy,
  unmatched: ours.length - Object.keys(out).length,
});
