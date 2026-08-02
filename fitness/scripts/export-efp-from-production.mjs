#!/usr/bin/env node
/**
 * Експортира EFP от production KV → fitness/data/exercise-metadata.json
 * node fitness/scripts/export-efp-from-production.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = process.env.FITNESS_WORKER_URL || 'https://aidiet.radilov-k.workers.dev';
const SECRET = process.env.ADMIN_SECRET || 'nutriplan2024';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'data', 'exercise-metadata.json');

const res = await fetch(`${WORKER}/api/admin/fitplan/exercise-catalog/export`, {
  headers: { 'X-Admin-Secret': SECRET },
});
const data = await res.json();
if (!data.success) throw new Error(JSON.stringify(data));

const metadata = {};
for (const row of data.exercises || []) {
  const id = String(row.id);
  const m = row.metadata || {};
  metadata[id] = {
    diff: m.diff,
    gf: m.gf,
    gm: m.gm,
    flags: m.flags || [],
    gear: m.gear || [],
    effectiveEquipNorm: m.effectiveEquipNorm,
    excluded: Boolean(m.excluded),
    aiClassified: true,
    efpVersion: 2,
    classifiedAt: new Date().toISOString(),
    exportedFrom: 'production-kv',
  };
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(metadata, null, 0));
console.log(`Exported ${Object.keys(metadata).length} → ${outFile}`);
