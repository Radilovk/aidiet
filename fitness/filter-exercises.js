/**
 * Филтър за упражнения — извлича всички АКТИВНИ упражнения
 * (без стречинг, асистирани, машини)
 * 
 * Употреба:
 *   node filter-exercises.js > active-exercises.json
 */

import { normalizeText } from './normalize.js';
import { inferExerciseTraits } from './exercise-tags.js';
import { inferExerciseModality } from './exercise-metadata.js';

// Упражнения за ИЗКЛЮЧВАНЕ
const EXCLUDE_PATTERNS = {
  // СТРЕЧИНГ и мобилност
  stretch: /\b(stretch|yoga|mobility|pilates|flexibility|foam roll|trigger point|myofascial|breathing exercise|relaxation)\b/i,
  
  // АСИСТИРАНИ (машини с помощ)
  assisted: /\b(assisted|band assisted|machine assisted|gravity assisted)\b/i,
  
  // ФИТНЕС МАШИНИ (leverage, smith, тренажори)
  machine: /\b(leverage machine|smith machine|leg press|hack squat|chest press|lat pulldown|cable machine|sled machine|leg curl|leg extension|preacher|v-squad|nautilus)\b/i,
  
  // КАРДИО машини
  cardio_machine: /\b(treadmill|stationary bike|elliptical|rowing machine|assault bike|air bike|stepmill|stairmaster|stepper|skierg)\b/i,
  
  // БАЛАНСНИ упражнения (лесни, не за тренировка)
  balance: /\b(balance|stability training|bosu|wobble|equilibrium)\b/i,
};

const EXCLUDE_EQUIPMENT = new Set([
  'assisted',
  'machine',
  'leverage machine',
  'smith machine',
  'cable machine',
  'elliptical machine',
  'stationary bike',
  'rowing machine',
  'treadmill',
  'sled machine',
]);

export function shouldExcludeExercise(entry) {
  if (!entry) return true;
  
  const name = entry.name || '';
  const equipment = entry.equipment || '';
  const flags = entry.flags || [];
  
  // Проверка по флагове
  if (flags.includes('stretch') || flags.includes('mobility') || flags.includes('excluded') || flags.includes('unclassified')) {
    return true;
  }
  
  // Проверка по модалност
  const modality = inferExerciseModality(entry);
  if (modality === 'mobility') return true;
  
  // Проверка по име
  for (const [key, pattern] of Object.entries(EXCLUDE_PATTERNS)) {
    if (pattern.test(name)) return true;
  }
  
  // Проверка по оборудване
  const equipNorm = normalizeText(equipment);
  if (EXCLUDE_EQUIPMENT.has(equipNorm)) return true;
  if (equipNorm.includes('machine') || equipNorm.includes('lever')) return true;
  if (equipNorm === 'assisted') return true;
  
  // Проверка по traits (ако има)
  if (entry.traits) {
    if (entry.traits.stretch || entry.traits.assisted) return true;
  }
  
  return false;
}

export function filterActiveExercises(exercises) {
  if (!Array.isArray(exercises)) return [];
  return exercises.filter(ex => !shouldExcludeExercise(ex));
}

/**
 * Групиране по категория
 */
export function groupExercisesByCategory(exercises) {
  const groups = {
    bodyweight: [],
    dumbbell: [],
    kettlebell: [],
    barbell: [],
    band: [],
    cable: [],
    rings: [],
    suspension: [],
    ball: [],
    other: [],
  };
  
  for (const ex of exercises) {
    const equip = normalizeText(ex.equipment || '');
    
    if (equip.includes('dumbbell')) groups.dumbbell.push(ex);
    else if (equip.includes('kettlebell')) groups.kettlebell.push(ex);
    else if (equip.includes('barbell')) groups.barbell.push(ex);
    else if (equip.includes('band') || equip.includes('resistance')) groups.band.push(ex);
    else if (equip.includes('cable')) groups.cable.push(ex);
    else if (equip.includes('ring')) groups.rings.push(ex);
    else if (equip.includes('suspension') || equip.includes('trx')) groups.suspension.push(ex);
    else if (equip.includes('ball')) groups.ball.push(ex);
    else if (equip === 'body weight' || equip === '') groups.bodyweight.push(ex);
    else groups.other.push(ex);
  }
  
  return groups;
}

/**
 * Статистика за филтриране
 */
export function getFilterStats(allExercises, activeExercises) {
  const excluded = allExercises.length - activeExercises.length;
  const excludedByType = {
    stretch: 0,
    assisted: 0,
    machine: 0,
    cardio_machine: 0,
    other: 0,
  };
  
  for (const ex of allExercises) {
    if (activeExercises.includes(ex)) continue;
    
    const name = ex.name || '';
    
    if (EXCLUDE_PATTERNS.stretch.test(name)) excludedByType.stretch++;
    else if (EXCLUDE_PATTERNS.assisted.test(name)) excludedByType.assisted++;
    else if (EXCLUDE_PATTERNS.machine.test(name)) excludedByType.machine++;
    else if (EXCLUDE_PATTERNS.cardio_machine.test(name)) excludedByType.cardio_machine++;
    else excludedByType.other++;
  }
  
  return {
    total: allExercises.length,
    active: activeExercises.length,
    excluded,
    excludedByType,
    excludedPercent: ((excluded / allExercises.length) * 100).toFixed(1),
  };
}

// Ако се стартира директно
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Филтър за упражнения готов.');
  console.log('Употреба: import { filterActiveExercises } from "./filter-exercises.js"');
}
