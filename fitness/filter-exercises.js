/**
 * ФИЛТЪР НА УПРАЖНЕНИЯ — ПРОИЗВОДСТВЕНА ВЕРСИЯ
 *
 * Обосновка:
 * - Ясна, лесно тестируема логика без магически строки
 * - Използва вече съществуващите traits & effective equipment от exercise-tags.js
 * - Безопасна за администратора: не модифицира суровия каталог
 * - Изключа само:
 *   1. Стречинг, йога, мобилност
 *   2. Асистирани упражнения (машини с помощ)
 *   3. Фитнес машини (leverage, smith, cardio machines)
 * - Остават: body weight, dumbbell, barbell, kettlebell, band, cable, rings, suspension, etc.
 */

import { normalizeText } from './normalize.js';
import { inferRequiredGear, resolveEffectiveEquipNorm } from './exercise-tags.js';
import { inferExerciseModality } from './exercise-metadata.js';

// === Категории за изключване ===

/**
 * Упражнение е СТРЕЧИНГ ако:
 * - Модалността е 'mobility' (detectedException по имената)
 * - Или името експлицитно съдържа stretch/yoga/pilates/flexibility
 */
export function isStretchingExercise(entry) {
  const name = String(entry?.name || '').toLowerCase();
  const modality = inferExerciseModality(entry);

  // Модалност: мобилност е изключена
  if (modality === 'mobility') return true;

  // Явни имена за стречинг
  if (
    /\b(stretch|yoga|pilates|mobility|flexibility|foam roll|foam roller|self[- ]?massage|myofascial|breathing exercise|relaxation|cooldown walk)\b/i
      .test(name)
  ) {
    return true;
  }

  // Флагове в entry
  if (entry?.flags?.includes('stretch') || entry?.flags?.includes('mobility')) {
    return true;
  }

  return false;
}

/**
 * Упражнение е АСИСТИРАНО ако:
 * - Името експлицитно съдържа "assisted"
 * - Или реално изискваното gear е "assisted"
 * - Не се счита за асистирано само защото използва cable или band
 */
export function isAssistedExercise(entry) {
  const name = String(entry?.name || '').toLowerCase();

  // Явен indicator в названието
  if (/\bassisted\b|\bband assisted\b|\bmachine assisted\b|\bgravity assisted\b/i.test(name)) {
    return true;
  }

  // Проверка на реално изискваното gear
  const gear = inferRequiredGear(entry?.name, entry?.equipment);
  if (gear.includes('assisted')) {
    return true;
  }

  // Traits на entry
  if (entry?.traits?.assisted === true) {
    return true;
  }

  return false;
}

/**
 * Упражнение е МАШИННО ако:
 * - Ефективното оборудване е leverage/smith/machine/cardio
 * - Или името явно указва машина
 */
export function isMachineExercise(entry) {
  const name = String(entry?.name || '').toLowerCase();
  const equipment = String(entry?.equipment || '').toLowerCase();
  const effectiveEquip = String(entry?.effectiveEquipNorm || entry?.equipNorm || '').toLowerCase();

  // Явни машинни названия
  if (
    /\b(leg press|hack squat|smith machine|v[- ]?squat|sled machine|leverage machine|lat pulldown|chest press|cable machine|preacher curl|seated row|leg extension|leg curl|adduction|abduction)\b/i
      .test(name)
  ) {
    return true;
  }

  // Ефективно оборудване (по-надежда проверка)
  if (
    effectiveEquip.includes('machine')
    || effectiveEquip.includes('leverage')
    || effectiveEquip.includes('smith')
    || effectiveEquip.includes('sled')
    || effectiveEquip === 'elliptical machine'
    || effectiveEquip === 'stationary bike'
    || effectiveEquip === 'rowing machine'
    || effectiveEquip === 'treadmill'
    || effectiveEquip === 'stepmill machine'
  ) {
    return true;
  }

  // Проверка на tags в entry (от bundled metadata)
  if (entry?.flags?.includes('machine')) {
    return true;
  }

  // Особлив случай: body weight, което реално е машина
  if (equipment === 'body weight' && entry?.traits?.effectiveEquipNorm) {
    const realEquip = entry.traits.effectiveEquipNorm.toLowerCase();
    if (
      realEquip.includes('machine')
      || realEquip.includes('leverage')
      || realEquip.includes('smith')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Главна функция: проверя дали упражнението трябва да се изключи
 */
export function shouldExcludeExercise(entry) {
  if (!entry) return true;

  // Вече маркирано като изключено
  if (entry.excluded === true || (entry.flags || []).includes('excluded')) {
    return true;
  }

  // Неклассифицирано упражнение — не го пипаме, приемаме като изключено по предмет
  if ((entry.flags || []).includes('unclassified')) {
    return true;
  }

  // Основни категории за изключване
  if (isStretchingExercise(entry)) return true;
  if (isAssistedExercise(entry)) return true;
  if (isMachineExercise(entry)) return true;

  // Специален случай: неправилно маркирано body weight
  // Ако са казали, че е body weight, но traits показва че изисква машина
  if (normalizeText(entry.equipment) === 'body weight' && entry.traits?.effectiveEquipNorm) {
    const realEq = normalizeText(entry.traits.effectiveEquipNorm);
    if (
      realEq.includes('machine')
      || realEq.includes('leverage')
      || realEq.includes('smith')
      || realEq.includes('sled')
      || realEq.includes('cable machine')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Филтрира списък упражнения — връща само активни
 */
export function filterActiveExercises(exercises) {
  if (!Array.isArray(exercises)) return [];
  return exercises.filter((ex) => !shouldExcludeExercise(ex));
}

/**
 * Групиране по категория (за статистика/преглед)
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

  for (const ex of exercises || []) {
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
    other: 0,
  };

  for (const ex of allExercises) {
    if (activeExercises.includes(ex)) continue;

    if (isStretchingExercise(ex)) excludedByType.stretch++;
    else if (isAssistedExercise(ex)) excludedByType.assisted++;
    else if (isMachineExercise(ex)) excludedByType.machine++;
    else excludedByType.other++;
  }

  const activePercent = allExercises.length > 0
    ? ((activeExercises.length / allExercises.length) * 100).toFixed(1)
    : '0';

  return {
    total: allExercises.length,
    active: activeExercises.length,
    excluded,
    excludedByType,
    activePercent,
  };
}
