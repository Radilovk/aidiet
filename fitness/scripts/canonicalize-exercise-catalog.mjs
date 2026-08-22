/**
 * Канонизиране на каталога: по 1 универсален запис на група дубликати.
 *
 * Usage:
 *   node scripts/canonicalize-exercise-catalog.mjs [--dry-run] [--json-out plan.json]
 *   node scripts/canonicalize-exercise-catalog.mjs --apply --worker URL --secret PASS
 */
import { writeFileSync } from 'node:fs';
import { buildCanonicalizePlan } from '../exercise-canonical.js';

const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const jsonOut = args.includes('--json-out') ? args[args.indexOf('--json-out') + 1] : null;
const workerIdx = args.indexOf('--worker');
const secretIdx = args.indexOf('--secret');
const WORKER = workerIdx >= 0 ? args[workerIdx + 1] : process.env.FITPLAN_WORKER_URL || 'https://aidiet.radilov-k.workers.dev';
const SECRET = secretIdx >= 0 ? args[secretIdx + 1] : process.env.ADMIN_SECRET || 'nutriplan2024';

async function fetchAllCatalog() {
  const headers = { 'X-Admin-Secret': SECRET, 'Content-Type': 'application/json' };
  const items = [];
  let page = 1;
  let pages = 1;
  while (page <= pages) {
    const q = new URLSearchParams({ page: String(page), limit: '200' });
    const res = await fetch(`${WORKER}/api/admin/fitplan/exercise-catalog?${q}`, { headers });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    items.push(...(data.items || []));
    pages = data.pages || 1;
    page += 1;
  }
  return items;
}

async function applyPatches(patches) {
  const headers = { 'X-Admin-Secret': SECRET, 'Content-Type': 'application/json' };
  const chunkSize = 100;
  let updated = 0;
  for (let i = 0; i < patches.length; i += chunkSize) {
    const chunk = patches.slice(i, i + chunkSize).map(({ id, excluded, diff, gf, gm }) => ({
      id, excluded, diff, gf, gm,
    }));
    const res = await fetch(`${WORKER}/api/admin/fitplan/exercise-catalog/save`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: chunk }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || data.error || 'save failed');
    updated += data.updated || chunk.length;
    process.stderr.write(`  записани ${updated}/${patches.length}\n`);
  }
  return updated;
}

console.log('Зареждане на каталог…');
const catalog = await fetchAllCatalog();
const plan = buildCanonicalizePlan(catalog, { onlyDuplicates: true });

console.log('\n=== КАНОНИЗИРАНЕ ===');
console.log(`Кластери дубликати: ${plan.clusterCount}`);
console.log(`Канонични (остават/активират): ${plan.canonicalCount}`);
console.log(`Варианти за изключване: ${plan.excludeCount}`);
console.log(`Общо промени: ${plan.patchCount}`);

console.log('\n--- Примерни кластери (топ 12) ---\n');
for (const c of plan.clusters.slice(0, 12)) {
  console.log(`✓ [${c.winner.id}] ${c.winner.displayName || c.winner.name}`);
  console.log(`  EN: ${c.winner.name}`);
  for (const d of c.dropped.slice(0, 4)) {
    console.log(`  ✕ [${d.id}] ${d.displayName || d.name}`);
  }
  if (c.dropped.length > 4) console.log(`  … +${c.dropped.length - 4} още`);
  console.log('');
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ ...plan, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`JSON план: ${jsonOut}`);
}

if (dryRun) {
  console.log('\n[dry-run] Няма запис. Добави --apply за production запис.');
} else {
  console.log('\nПрилагане…');
  const updated = await applyPatches(plan.patches);
  console.log(`Готово — обновени ${updated} записа.`);
}
