#!/usr/bin/env node
/**
 * Генерира data/exercise-translations-bg.json → nameBg за всяко упражнение (composeExerciseNameBg).
 * Остатъчни сливания (две упражнения с едно BG име) се разграничават с EN името в скоби.
 * Съществуващи ръчни/AI преводи (instructionsBg, manualEdit) в файла се пазят.
 *
 *   node fitness/scripts/build-exercise-names-bg.mjs [--dataset=path]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeExerciseNameBg } from '../exercise-labels-bg.js';
import { neutralExerciseName } from '../exercise-name-bg.js';
import { instructionsBgFor } from '../exercise-instructions-bg.js';
import { classifyExercise } from '../exercise-classifier.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const datasetArg = process.argv.find((a) => a.startsWith('--dataset='));
const all = JSON.parse(readFileSync(datasetArg ? datasetArg.split('=')[1] : join(root, 'data', 'exercise-dataset.json'), 'utf8'));
const outFile = join(root, 'data', 'exercise-translations-bg.json');
let existing = {};
try { existing = JSON.parse(readFileSync(outFile, 'utf8')); } catch { /* празен */ }

const names = new Map();
for (const x of all) {
  const bg = composeExerciseNameBg(x.name, x.equipment, x.target);
  if (!names.has(bg)) names.set(bg, []);
  names.get(bg).push(x);
}

// Само id-та от текущата база (старите записи от предишни бази се изчистват)
const ids = new Set(all.map((x) => String(x.id)));
const out = Object.fromEntries(Object.entries(existing).filter(([id]) => ids.has(id)));
let collisions = 0;
for (const [bg, list] of names) {
  const neutrals = new Set(list.map((x) => neutralExerciseName(x.name).toLowerCase()));
  for (const x of list) {
    const id = String(x.id);
    if (existing[id]?.manualEdit && existing[id]?.nameBg) continue;
    // Дубли по неутрално име ((male)/(female), v. 2) споделят BG името законно
    const nameBg = neutrals.size > 1 ? `${bg} (${neutralExerciseName(x.name)})` : bg;
    if (neutrals.size > 1) collisions++;
    const prev = out[id] || {};
    const instructionsBg = prev.manualEdit && prev.instructionsBg
      ? prev.instructionsBg
      : instructionsBgFor(classifyExercise(x).pattern, x.equipment);
    out[id] = { ...prev, nameBg, instructionsBg, nameSource: 'compose-v1' };
  }
}
writeFileSync(outFile, JSON.stringify(out));
const unique = new Set(Object.values(out).map((r) => r.nameBg)).size;
console.log(`${Object.keys(out).length} имена, ${unique} уникални; ${collisions} с EN уточнение в скоби`);
