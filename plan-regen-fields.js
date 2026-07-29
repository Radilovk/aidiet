/**
 * Полета, чиито промяна изисква регенерация на хранителен план.
 * Синхронизирано с data-diet-related="true" в profile.html.
 */
export const DIET_RELATED_PROFILE_FIELDS = [
  'gender', 'height', 'weight', 'goal', 'lossKg',
  'sleepHours', 'sleepInterrupt', 'chronotype', 'dailyActivityLevel',
  'stressLevel', 'sportActivity', 'waterIntake', 'drinksSweet', 'drinksAlcohol',
  'weightChange', 'weightChangeDetails',
  'dietHistory', 'dietType', 'dietResult', 'overeatingFrequency',
  'foodCravings', 'foodTriggers', 'eatingHabits', 'compensationMethods',
  'socialComparison', 'dietPreference', 'dietDislike', 'dietLove',
  'medicalConditions', 'medications', 'medicationsDetails', 'additionalNotes',
];

const ARRAY_FIELDS = new Set([
  'foodCravings', 'foodTriggers', 'eatingHabits', 'compensationMethods',
  'dietPreference', 'medicalConditions',
]);

export function normalizeProfileFieldValue(field, value) {
  if (ARRAY_FIELDS.has(field)) {
    if (Array.isArray(value)) return value.map(s => String(s).trim()).filter(Boolean).join(', ');
    return String(value || '').split(',').map(s => s.trim()).filter(Boolean).join(', ');
  }
  return String(value ?? '').trim();
}

/** @returns {string[]} changed diet-related field names */
export function classifyDietRelatedProfileChanges(prev = {}, next = {}) {
  const changed = [];
  for (const field of DIET_RELATED_PROFILE_FIELDS) {
    const a = normalizeProfileFieldValue(field, prev[field]);
    const b = normalizeProfileFieldValue(field, next[field]);
    if (a !== b) changed.push(field);
  }
  return changed;
}

export function hasDietRelatedProfileChanges(prev = {}, next = {}) {
  return classifyDietRelatedProfileChanges(prev, next).length > 0;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NutriPlanRegenFields = {
    DIET_RELATED_PROFILE_FIELDS,
    classifyDietRelatedProfileChanges,
    hasDietRelatedProfileChanges,
    normalizeProfileFieldValue,
  };
}
