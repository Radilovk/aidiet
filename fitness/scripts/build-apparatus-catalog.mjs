#!/usr/bin/env node
/**
 * Генерира каталог на уреди от exercise-index.json (машини, кабели, кардио).
 *   node scripts/build-apparatus-catalog.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeText } from '../normalize.js';
import { localizeExerciseDisplayName } from '../exercise-labels-bg.js';
import {
  CARDIO_TRAINER_NORMS,
  STRENGTH_MACHINE_NORMS,
} from '../equipment-groups.js';

const INDEX_PATH = new URL('../data/exercise-index.json', import.meta.url);
const OUT_PATH = new URL('../data/equipment-apparatus-catalog.json', import.meta.url);

const CARDIO_LEVERAGE_NAME_RE = /treadmill|elliptical|cross trainer|stationary bike|cycle cross|stepmill|skierg|ergometer|rowing machine/i;

const APPARATUS_EQUIP_NORMS = new Set([
  'cable',
  'assisted',
  ...STRENGTH_MACHINE_NORMS,
  ...CARDIO_TRAINER_NORMS,
]);

const TARGET_TO_MUSCLE = {
  pectorals: 'chest',
  lats: 'back',
  'upper back': 'back',
  traps: 'back',
  delts: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  quads: 'legs',
  hamstrings: 'legs',
  calves: 'legs',
  glutes: 'glutes',
  abductors: 'glutes',
  adductors: 'legs',
  abs: 'core',
  spine: 'core',
  'serratus anterior': 'chest',
  'cardiovascular system': 'cardio',
};

function categoryForEntry(entry) {
  const equip = entry.equipNorm;
  if (equip === 'cable') return 'cable';
  if (CARDIO_TRAINER_NORMS.includes(equip)) return 'cardio';
  if (equip === 'leverage machine' && CARDIO_LEVERAGE_NAME_RE.test(entry.name || '')) return 'cardio';
  return 'machine';
}

function muscleForTarget(targetNorm) {
  return TARGET_TO_MUSCLE[targetNorm] || 'general';
}

function isApparatusExercise(entry) {
  const equip = entry?.equipNorm;
  if (!equip || !APPARATUS_EQUIP_NORMS.has(equip)) return false;
  return true;
}

async function main() {
  const index = JSON.parse(await readFile(INDEX_PATH, 'utf8'));
  if (!Array.isArray(index)) {
    console.error('exercise-index.json трябва да е масив');
    process.exit(1);
  }

  const catalog = index
    .filter(isApparatusExercise)
    .map((entry) => ({
      id: String(entry.id),
      name: entry.name,
      nameNorm: entry.nameNorm || normalizeText(entry.name),
      label: (entry.nameBg && entry.nameBg.trim())
        ? entry.nameBg.trim()
        : localizeExerciseDisplayName(entry.name, '', entry.equipment),
      equipNorm: entry.equipNorm,
      targetNorm: entry.targetNorm || '',
      category: categoryForEntry(entry),
      muscle: muscleForTarget(entry.targetNorm),
      tokens: entry.tokens || [],
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'bg'));

  await writeFile(OUT_PATH, JSON.stringify(catalog));

  const byCategory = {};
  for (const item of catalog) byCategory[item.category] = (byCategory[item.category] || 0) + 1;

  console.log(`Каталог: ${catalog.length} уреда`);
  for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${cat}`);
  }
  console.log(`Записан: ${OUT_PATH.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
