#!/usr/bin/env node
/**
 * EFP v3 — детерминистична класификация на целия dataset (без AI).
 *
 *   node fitness/scripts/rule-classify-exercises.mjs [--dataset=path/to/exercises.json] [--report]
 *
 * Ръчните корекции (manual/manualEdit) в data/exercise-metadata.json се запазват.
 * --report печата разлики спрямо предишната класификация (diff/gf/gm).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchExerciseDataset } from '../exercise-classify-batch.js';
import { classifyExercise, findFlagContradictions, CLASSIFIER_VERSION } from '../exercise-classifier.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'data', 'exercise-metadata.json');

const datasetArg = process.argv.find((a) => a.startsWith('--dataset='));
const report = process.argv.includes('--report');

let all;
if (datasetArg) {
  const data = JSON.parse(readFileSync(datasetArg.split('=')[1], 'utf8'));
  all = Array.isArray(data) ? data : (data.exercises || data.data || []);
} else {
  all = await fetchExerciseDataset();
}

let existing = {};
try {
  existing = JSON.parse(readFileSync(outFile, 'utf8'));
} catch { /* първи run */ }

const classifiedAt = new Date().toISOString();
const next = {};
const changes = { diff: 0, gf: 0, gm: 0, kept: 0 };
const contradictions = [];

for (const raw of all) {
  const id = String(raw.id);
  const prev = existing[id];
  if (prev && (prev.manual === true || prev.manualEdit === true)) {
    next[id] = prev;
    changes.kept++;
    continue;
  }
  const c = classifyExercise(raw);
  const row = {
    diff: c.diff,
    gf: c.gf,
    gm: c.gm,
    flags: c.flags,
    gear: c.gear,
    effectiveEquipNorm: c.effectiveEquipNorm,
    excluded: c.excluded,
    pattern: c.pattern,
    category: c.category,
    mechanic: c.mechanic,
    reasons: c.reasons,
    ruleClassified: true,
    efpVersion: CLASSIFIER_VERSION,
    classifiedAt,
  };
  const bad = findFlagContradictions(row);
  if (bad.length) contradictions.push(`${id} ${raw.name}: ${bad.join(', ')}`);
  if (prev) {
    if (prev.diff !== row.diff) changes.diff++;
    if (prev.gf !== row.gf) changes.gf++;
    if (prev.gm !== row.gm) changes.gm++;
    if (report && prev.diff !== row.diff) {
      console.log(`d${prev.diff}→d${row.diff}  ${raw.name}  [${row.pattern}] ${row.reasons.slice(1).join('; ')}`);
    }
  }
  next[id] = row;
}

writeFileSync(outFile, JSON.stringify(next));

const count = (key) => Object.values(next).reduce((m, r) => { m[r[key]] = (m[r[key]] || 0) + 1; return m; }, {});
console.log(`EFP v${CLASSIFIER_VERSION}: ${Object.keys(next).length} упражнения → ${outFile}`);
console.log('diff:', count('diff'));
console.log('category:', count('category'));
console.log(`промени спрямо предишното: diff ${changes.diff}, gf ${changes.gf}, gm ${changes.gm}; запазени ръчни: ${changes.kept}`);
if (contradictions.length) {
  console.error(`Противоречия (${contradictions.length}):\n${contradictions.join('\n')}`);
  process.exit(1);
}
