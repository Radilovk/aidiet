/**
 * Верификация: по какви сигнали са групирани кластерите (не визуален преглед на GIF).
 */
import { createHash } from 'node:crypto';
import { fetchExerciseDataset } from '../exercise-translate-batch.js';
import { buildCanonicalizePlan } from '../exercise-canonical.js';
import { normalizeText } from '../normalize.js';

const WORKER = process.env.FITPLAN_WORKER_URL || 'https://aidiet.radilov-k.workers.dev';
const SECRET = process.env.ADMIN_SECRET || 'nutriplan2024';

async function fetchAllCatalog() {
  const headers = { 'X-Admin-Secret': SECRET };
  const items = [];
  let page = 1;
  let pages = 1;
  while (page <= pages) {
    const d = await (await fetch(`${WORKER}/api/admin/fitplan/exercise-catalog?page=${page}&limit=200`, { headers })).json();
    items.push(...d.items);
    pages = d.pages;
    page += 1;
  }
  return items;
}

function clusterSignals(members, rawById) {
  const instr = new Set(members.map((m) => normalizeText(String(rawById[m.id]?.instructions?.en || m.instructions || '').slice(0, 400))));
  const gif = new Set(members.map((m) => String(m.gif || '').split('/').pop()));
  const display = new Set(members.map((m) => normalizeText(m.displayName || m.nameBg || m.name)));
  return {
    sameGif: gif.size === 1,
    sameInstr: instr.size === 1 && [...instr][0],
    sameDisplay: display.size === 1,
    gifCount: gif.size,
    instrCount: instr.size,
    displayCount: display.size,
  };
}

const [raw, catalog] = await Promise.all([fetchExerciseDataset(), fetchAllCatalog()]);
const rawById = Object.fromEntries(raw.map((r) => [String(r.id), r]));
const plan = buildCanonicalizePlan(catalog, { onlyDuplicates: true });

let sameGif = 0;
let sameInstr = 0;
let sameDisplay = 0;
let nameVariantOnly = 0;
const examples = { sameInstr: [], sameDisplay: [], nameOnly: [], large: [] };

for (const c of plan.clusters) {
  const members = [c.winner, ...c.dropped.map((d) => catalog.find((x) => x.id === d.id))].filter(Boolean);
  const sig = clusterSignals(members, rawById);
  if (sig.sameGif) sameGif += 1;
  if (sig.sameInstr) {
    sameInstr += 1;
    if (examples.sameInstr.length < 3) examples.sameInstr.push({ c, sig, members });
  }
  if (sig.sameDisplay) {
    sameDisplay += 1;
    if (examples.sameDisplay.length < 3) examples.sameDisplay.push({ c, sig, members });
  }
  const enBase = new Set(members.map((m) => normalizeText(m.name).replace(/\bv\s*\d+\b/g, '').replace(/pov|male|female|arm blaster|on knees/g, '')));
  if (enBase.size === 1 && !sig.sameInstr && !sig.sameDisplay) {
    nameVariantOnly += 1;
    if (examples.nameOnly.length < 3) examples.nameOnly.push({ c, sig, members });
  }
  if (members.length >= 5 && examples.large.length < 2) examples.large.push({ c, sig, members });
}

console.log('=== КАКВО РЕАЛНО АНАЛИЗИРА АЛГОРИТЪМЪТ ===\n');
console.log('НЕ: визуален преглед на GIF анимации (не гледам кадрите)');
console.log('ДА: metadata — EN име, BG displayName, instructions EN текст, gif filename\n');
console.log(`Кластери общо: ${plan.clusterCount}`);
console.log(`  · с еднакви инструкции: ${sameInstr}`);
console.log(`  · с еднакво BG име: ${sameDisplay}`);
console.log(`  · с един и същ GIF файл: ${sameGif}`);
console.log(`  · само EN вариант (риск): ${nameVariantOnly}`);
console.log(`  · варианти за изключване: ${plan.excludeCount}`);

function printCluster(label, { c, sig, members }) {
  console.log(`\n--- ${label} ---`);
  console.log(`WIN [${c.winner.id}] ${c.winner.displayName}`);
  for (const m of members.slice(1, 5)) console.log(`DROP [${m.id}] ${m.displayName || m.name}`);
  console.log('GIF files:', [...new Set(members.map((m) => (m.gif || '').split('/').pop()))].join(', '));
  console.log('Signals:', sig);
}

for (const x of examples.sameInstr) printCluster('еднакви инструкции', x);
for (const x of examples.sameDisplay) printCluster('еднакво BG име', x);
for (const x of examples.nameOnly) printCluster('РИСК: само EN вариант', x);
for (const x of examples.large) printCluster('голям кластер', x);

// Quick GIF byte-hash on subset
const base = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/';
const sampleIds = new Set();
for (const c of plan.clusters.slice(0, 15)) {
  sampleIds.add(c.winner.id);
  c.dropped.slice(0, 2).forEach((d) => sampleIds.add(d.id));
}
const byHash = new Map();
let hashed = 0;
for (const id of sampleIds) {
  const row = catalog.find((x) => x.id === id);
  const path = row?.gif;
  if (!path) continue;
  const url = base + String(path).replace(/^\/+/, '');
  const res = await fetch(url);
  if (!res.ok) continue;
  const h = createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex').slice(0, 12);
  hashed += 1;
  if (!byHash.has(h)) byHash.set(h, []);
  byHash.get(h).push({ id, name: row.name, display: row.displayName });
}
const visualDupes = [...byHash.entries()].filter(([, a]) => a.length > 1);
console.log(`\n=== GIF BYTE HASH (мостра ${hashed} от кластери) ===`);
console.log(`Идентични GIF файлове: ${visualDupes.length} групи`);
for (const [, items] of visualDupes) {
  items.forEach((x) => console.log(`  [${x.id}] ${x.display}`));
}
