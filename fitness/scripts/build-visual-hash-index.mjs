/**
 * Генерира visual hash индекс от thumbnail/GIF на упражненията.
 * Usage: node scripts/build-visual-hash-index.mjs [--limit N] [--out path]
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fetchExerciseDataset } from '../exercise-translate-batch.js';
import { dHashFromRgba, buildVisualSimilarityIndex, CLUSTER_THRESHOLD, NEIGHBOR_THRESHOLD } from '../exercise-visual-hash.js';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('Липсва sharp. Инсталирай: npm install --save-dev sharp');
  process.exit(1);
}

const MEDIA_BASE = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/';
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const outIdx = args.indexOf('--out');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : null;
const OUT = outIdx >= 0 ? args[outIdx + 1] : new URL('../data/exercise-visual-hashes.json', import.meta.url).pathname;

function mediaUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return MEDIA_BASE.replace(/\/+$/, '/') + String(path).replace(/^\/+/, '');
}

async function hashRemoteImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ka-trainer-visual-hash' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf)
    .resize(9, 8, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return dHashFromRgba(data, info.width, info.height);
}

console.log('Зареждане на dataset…');
const raw = await fetchExerciseDataset();
const rows = LIMIT ? raw.slice(0, LIMIT) : raw;
console.log(`Хеширане на ${rows.length} изображения…`);

const entries = [];
let failed = 0;
const concurrency = 12;
let i = 0;

async function worker() {
  while (i < rows.length) {
    const idx = i;
    i += 1;
    const row = rows[idx];
    const id = String(row.id);
    const url = mediaUrl(row.image || row.gif_url || row.gifUrl);
    if (!url) { failed += 1; continue; }
    try {
      const hash = await hashRemoteImage(url);
      entries.push({ id, hash, source: row.image ? 'image' : 'gif', target: row.target || row.muscle_group || '' });
      if (entries.length % 50 === 0) process.stderr.write(`  ${entries.length}/${rows.length}\n`);
    } catch (e) {
      failed += 1;
      process.stderr.write(`  fail ${id}: ${e.message}\n`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const { neighbors, clusterGroups, clusterCount } = buildVisualSimilarityIndex(entries);

const neighborMap = Object.fromEntries(
  [...neighbors.entries()].map(([id, list]) => [id, list]),
);

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  algorithm: 'dhash-9x8',
  threshold: CLUSTER_THRESHOLD,
  neighborThreshold: NEIGHBOR_THRESHOLD,
  total: entries.length,
  failed,
  clusterCount,
  hashes: Object.fromEntries(entries.map((e) => [e.id, { hash: e.hash, source: e.source }])),
  neighbors: neighborMap,
  clusters: clusterGroups.map((group) => ({
    size: group.length,
    ids: group.map((g) => g.id),
    hash: group[0].hash,
  })),
};

writeFileSync(OUT, JSON.stringify(payload));
console.log(`\nГотово: ${OUT}`);
console.log(`Хеширани: ${entries.length} · Грешки: ${failed} · Визуални кластери: ${clusterCount}`);
