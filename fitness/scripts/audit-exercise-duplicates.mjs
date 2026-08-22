/**
 * Одит на exercises-dataset: дублирани анимации, почти идентични имена, лоши описания.
 * Usage: node scripts/audit-exercise-duplicates.mjs [--json-out report.json]
 */
import { writeFileSync } from 'node:fs';
import { fetchExerciseDataset } from '../exercise-translate-batch.js';
import { normalizeText, tokenize } from '../normalize.js';
import { pickInstructionsEn } from '../exercise-translations.js';
import { localizeExerciseDisplayName } from '../exercise-labels-bg.js';
import { buildCatalogRecord } from '../exercise-catalog.js';
import { buildCompactIndex } from '../worker.js';
import bundledMeta from '../data/exercise-metadata.json' with { type: 'json' };
import bundledTr from '../data/exercise-translations-bg.json' with { type: 'json' };

function mediaKey(path) {
  if (!path) return '';
  const s = String(path).replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '');
  return s.split('/').pop()?.toLowerCase() || s.toLowerCase();
}

function stripGenderVariant(name) {
  return String(name || '')
    .replace(/\s*\((male|female)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameFingerprint(name) {
  return normalizeText(stripGenderVariant(name))
    .replace(/\b(male|female)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function instructionQuality(text) {
  const t = String(text || '').trim();
  if (!t) return { score: 0, issues: ['empty'] };
  const issues = [];
  if (t.length < 40) issues.push('too_short');
  if (t.length > 4000) issues.push('too_long');
  if (/^step\s*1/i.test(t) === false && t.split(/\.\s+/).length < 2) issues.push('single_sentence');
  if (/\b(lorem|placeholder|todo|fixme)\b/i.test(t)) issues.push('placeholder');
  if (/(male|female)\)/i.test(t) && !/\b(male|female)\b/i.test(t)) issues.push('gender_tag_in_text');
  const score = Math.max(0, 100 - issues.length * 25 - (t.length < 80 ? 20 : 0));
  return { score, issues, len: t.length };
}

function summarizeGroup(items) {
  return items.map((x) => ({
    id: x.id,
    name: x.name,
    nameBg: x.nameBg || x.autoNameBg || '',
    equipment: x.equipment,
    target: x.target,
    excluded: x.excluded,
  }));
}

const args = process.argv.slice(2);
const jsonOut = args.includes('--json-out') ? args[args.indexOf('--json-out') + 1] : null;

console.log('Зареждане на dataset…');
const raw = await fetchExerciseDataset();
const index = buildCompactIndex(raw, bundledTr, bundledMeta);
const rawById = Object.fromEntries(raw.map((r) => [String(r.id), r]));

const records = index.map((entry) => {
  const rawRow = rawById[entry.id] || null;
  const row = buildCatalogRecord(entry, rawRow, bundledMeta, {}, bundledTr, {});
  const instrEn = pickInstructionsEn(rawRow?.instructions || entry.instructions);
  const iq = instructionQuality(instrEn);
  const iqBg = instructionQuality(row.instructionsBg);
  return {
    ...row,
    gifKey: mediaKey(row.gif || rawRow?.gif_url || rawRow?.gifUrl),
    imageKey: mediaKey(row.image || rawRow?.image),
    nameFp: nameFingerprint(row.name),
    tokens: tokenize(stripGenderVariant(row.name)),
    instrEn,
    instrQuality: iq,
    instrBgQuality: iqBg,
  };
});

// 1) Same GIF
const byGif = new Map();
for (const r of records) {
  if (!r.gifKey) continue;
  if (!byGif.has(r.gifKey)) byGif.set(r.gifKey, []);
  byGif.get(r.gifKey).push(r);
}
const dupGifs = [...byGif.entries()]
  .filter(([, items]) => items.length > 1)
  .sort((a, b) => b[1].length - a[1].length);

// 2) Same image (static) but maybe different gif
const byImage = new Map();
for (const r of records) {
  if (!r.imageKey) continue;
  if (!byImage.has(r.imageKey)) byImage.set(r.imageKey, []);
  byImage.get(r.imageKey).push(r);
}
const dupImages = [...byImage.entries()]
  .filter(([, items]) => items.length > 1)
  .sort((a, b) => b[1].length - a[1].length);

// 3) Exact name fingerprint duplicates (different ids)
const byNameFp = new Map();
for (const r of records) {
  if (!r.nameFp) continue;
  if (!byNameFp.has(r.nameFp)) byNameFp.set(r.nameFp, []);
  byNameFp.get(r.nameFp).push(r);
}
const dupNames = [...byNameFp.entries()]
  .filter(([, items]) => items.length > 1)
  .sort((a, b) => b[1].length - a[1].length);

// 4) Near-duplicate names (same equipment + high token overlap, different gif)
const nearNameDupes = [];
for (let i = 0; i < records.length; i += 1) {
  for (let j = i + 1; j < records.length; j += 1) {
    const a = records[i];
    const b = records[j];
    if (a.id === b.id) continue;
    if (a.equipNorm !== b.equipNorm) continue;
    const sim = jaccard(a.tokens, b.tokens);
    if (sim >= 0.85 && a.gifKey !== b.gifKey) {
      nearNameDupes.push({ a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, sim, equipment: a.equipment });
    }
  }
}
nearNameDupes.sort((x, y) => y.sim - x.sim);

// 5) Bad instructions
const badInstr = records.filter((r) =>
  r.instrQuality.issues.length > 0
  || r.instrBgQuality.issues.includes('empty')
  || r.instrBgQuality.issues.includes('too_short'),
);

// 6) Active in AI but duplicate gif with another active
const activeDupGifs = dupGifs.filter(([, items]) => {
  const active = items.filter((x) => !x.excluded);
  return active.length > 1;
});

// 7) Gender variants still active
const genderActive = records.filter((r) => !r.excluded && /\((male|female)\)/i.test(r.name));

const report = {
  generatedAt: new Date().toISOString(),
  total: records.length,
  summary: {
    duplicateGifGroups: dupGifs.length,
    exercisesInDuplicateGifs: dupGifs.reduce((n, [, items]) => n + items.length, 0),
    duplicateImageGroups: dupImages.length,
    duplicateNameGroups: dupNames.length,
    nearNameDifferentGif: nearNameDupes.length,
    badInstructionRecords: badInstr.length,
    activeDuplicateGifGroups: activeDupGifs.length,
    activeGenderVariants: genderActive.length,
    activeInAi: records.filter((r) => !r.excluded).length,
    excludedFromAi: records.filter((r) => r.excluded).length,
  },
  topDuplicateGifs: dupGifs.slice(0, 40).map(([key, items]) => ({
    gif: key,
    count: items.length,
    activeCount: items.filter((x) => !x.excluded).length,
    items: summarizeGroup(items),
  })),
  topDuplicateNames: dupNames.slice(0, 30).map(([key, items]) => ({
    nameKey: key,
    count: items.length,
    items: summarizeGroup(items),
  })),
  activeDuplicateGifGroups: activeDupGifs.slice(0, 30).map(([key, items]) => ({
    gif: key,
    count: items.length,
    items: summarizeGroup(items),
  })),
  nearNameDifferentGif: nearNameDupes.slice(0, 50),
  badInstructionsSample: badInstr.slice(0, 40).map((r) => ({
    id: r.id,
    name: r.name,
    nameBg: r.displayName,
    excluded: r.excluded,
    en: r.instrQuality,
    bg: r.instrBgQuality,
    instrPreview: r.instrEn.slice(0, 120),
  })),
  activeGenderVariants: genderActive.slice(0, 30).map((r) => ({
    id: r.id,
    name: r.name,
    displayName: r.displayName,
  })),
};

console.log('\n=== ОДИТ НА УПРАЖНЕНИЯ ===\n');
console.log(`Общо упражнения: ${report.total}`);
console.log(`Активни в AI: ${report.summary.activeInAi} · Изключени: ${report.summary.excludedFromAi}`);
console.log(`Групи с еднакъв GIF: ${report.summary.duplicateGifGroups} (${report.summary.exercisesInDuplicateGifs} записа)`);
console.log(`Групи с еднакъм GIF, активни в AI: ${report.summary.activeDuplicateGifGroups}`);
console.log(`Групи с еднакво име (нормализирано): ${report.summary.duplicateNameGroups}`);
console.log(`Много близки имена, различен GIF: ${report.summary.nearNameDifferentGif}`);
console.log(`Лоши/липсващи инструкции: ${report.summary.badInstructionRecords}`);
console.log(`Активни gender варианти (male/female): ${report.summary.activeGenderVariants}`);

console.log('\n--- Топ 15 дублирани GIF (същата анимация, различни имена) ---\n');
for (const g of report.topDuplicateGifs.slice(0, 15)) {
  console.log(`GIF ${g.gif} · ${g.count} записа · ${g.activeCount} активни в AI`);
  for (const it of g.items) {
    console.log(`  [${it.id}] ${it.name}${it.nameBg ? ` / ${it.nameBg}` : ''} · ${it.equipment} · ${it.excluded ? 'ИЗКЛ' : 'AI'}`);
  }
  console.log('');
}

console.log('\n--- Топ 10 активни дубли в AI (проблем за модела) ---\n');
for (const g of report.activeDuplicateGifGroups.slice(0, 10)) {
  console.log(`GIF ${g.gif} · ${g.count} активни записа с еднаква анимация:`);
  for (const it of g.items.filter((x) => !x.excluded)) {
    console.log(`  [${it.id}] ${it.name} · ${it.equipment}`);
  }
  console.log('');
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(`\nПълен JSON отчет: ${jsonOut}`);
}
