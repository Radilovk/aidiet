#!/usr/bin/env node
/**
 * Импорт на bryllim/workout-guide (302 упражнения × 3 SVG кадъра, CC BY-SA 4.0)
 * + стъпки за изпълнение от Everkinetic (CC BY-SA 4.0), където има връзка.
 *
 * Изход: data/exercise-dataset.json — същата схема като стария exercises-dataset
 * (id, name, equipment, target, body_part, instructions.en, secondary_muscles) + frames.
 *
 *   node fitness/scripts/import-workout-guide.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Закачено към конкретен commit — CDN адресите на кадрите не се променят под нас.
export const WG_COMMIT = 'aac599224bb9780305239607ef98540b7e0ce389';
const WG_RAW = `https://raw.githubusercontent.com/bryllim/workout-guide/${WG_COMMIT}/packages/workout-guide`;
const EK_RAW = 'https://raw.githubusercontent.com/everkinetic/data/main/dist/exercises.json';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const EQUIPMENT = {
  Bodyweight: 'body weight', Dumbbell: 'dumbbell', Machine: 'leverage machine', Barbell: 'barbell', Cable: 'cable',
  'Resistance Band': 'band', 'Pull-up Bar': 'body weight', Plate: 'weighted', Kettlebell: 'kettlebell',
  'Stability Ball': 'stability ball', Bench: 'body weight', Wall: 'body weight', Chair: 'body weight',
  Doorway: 'body weight', Towel: 'body weight', Box: 'body weight',
};

function cardioEquipment(name) {
  const n = name.toLowerCase();
  if (/treadmill/.test(n)) return 'elliptical machine';
  if (/walk|run|jog|hik|swim/.test(n)) return 'body weight';
  if (/bike|cycl/.test(n)) return 'stationary bike';
  if (/row/.test(n)) return 'skierg machine';
  if (/stair|step/.test(n)) return 'stepmill machine';
  if (/elliptical/.test(n)) return 'elliptical machine';
  if (/rope|jump/.test(n)) return 'rope';
  return 'body weight';
}

const TARGET = {
  Chest: 'pectorals', Shoulders: 'delts', 'Rear Delts': 'delts', 'Upper Back': 'upper back', 'Posterior Chain': 'glutes',
  Hamstrings: 'hamstrings', Back: 'lats', Lats: 'lats', Biceps: 'biceps', Quads: 'quads', Glutes: 'glutes', Calves: 'calves',
  Forearms: 'forearms', Triceps: 'triceps', Core: 'abs', Legs: 'quads', 'Lower Back': 'spine', Adductors: 'adductors',
  Mobility: 'spine', Hips: 'glutes', Cardio: 'cardiovascular system',
};

const BODY_PART = {
  pectorals: 'chest', delts: 'shoulders', 'upper back': 'back', lats: 'back', spine: 'back', biceps: 'upper arms',
  triceps: 'upper arms', forearms: 'lower arms', quads: 'upper legs', hamstrings: 'upper legs', glutes: 'upper legs',
  adductors: 'upper legs', calves: 'lower legs', abs: 'waist', 'cardiovascular system': 'cardio',
};

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

const manifest = await getJson(`${WG_RAW}/manifest.json`);
const everkinetic = await getJson(EK_RAW);
const ekById = new Map((Array.isArray(everkinetic) ? everkinetic : everkinetic.exercises || []).map((e) => [e.id, e]));

const out = manifest.map((x) => {
  const equipment = x.equipment === 'Cardio' ? cardioEquipment(x.name) : (EQUIPMENT[x.equipment] || 'body weight');
  const target = x.isStretch ? 'spine' : (TARGET[x.primaryMuscle] || 'abs');
  const ekIds = new Set();
  for (const f of x.frames || []) {
    for (const m of String(f.attribution?.source?.url || '').matchAll(/\/(\d{4})-/g)) ekIds.add(m[1]);
  }
  for (const m of String(x.attribution?.source?.url || '').matchAll(/\/(\d{4})-/g)) ekIds.add(m[1]);
  const ek = [...ekIds].map((id) => ekById.get(id)).find((e) => e?.steps?.length);
  return {
    id: `wg-${x.slug}`,
    name: x.name,
    equipment,
    equipmentSource: x.equipment,
    target,
    body_part: x.equipment === 'Cardio' ? 'cardio' : (BODY_PART[target] || 'waist'),
    secondary_muscles: (x.secondaryMuscles || []).map((m) => TARGET[m] || m.toLowerCase()),
    exerciseType: x.exerciseType,
    isStretch: Boolean(x.isStretch),
    instructions: ek ? { en: ek.steps.join(' ') } : {},
    frames: (x.frames || []).map((f) => f.path.replace(/^assets\//, '')),
    attribution: 'Everkinetic / Bryl Lim — CC BY-SA 4.0',
  };
});

writeFileSync(join(root, 'data', 'exercise-dataset.json'), JSON.stringify(out));
const withSteps = out.filter((x) => x.instructions.en).length;
console.log(`workout-guide@${WG_COMMIT.slice(0, 7)}: ${out.length} упражнения, ${withSteps} със стъпки от Everkinetic`);
