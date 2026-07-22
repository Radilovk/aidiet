/** Shared constants aligned with worker.entry.js / analysis.html */
export const MIN_HEALTH_SCORE = 15;
export const MAX_HEALTH_SCORE = 100;
export const HEALTH_STATUS_UNDERESTIMATE_PERCENT = 10;
export const MIN_FAT_GRAMS_PER_KG = 0.7;
export const MIN_RECOMMENDED_CALORIES_MALE = 1500;
export const MIN_RECOMMENDED_CALORIES_FEMALE = 1200;
export const MAX_LATE_SNACK_CALORIES = 250;
export const CANONICAL_MEAL_TYPES = [
  'Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5', 'Свободно хранене',
];
export const KEY_PROBLEM_SEVERITY_RANGES = {
  Borderline: [45, 59],
  Risky: [60, 79],
  Critical: [80, 95],
};
export const MEAL3_ALLOWED = [
  'плод', 'ябълка', 'круша', 'портокал', 'банан', 'ягод', 'боровинк', 'малин',
  'ядки', 'бадем', 'орех', 'кашу', 'лешник', 'шамфъстък',
  'скир', 'кисело мляко', 'кефир',
];
export const MEAL3_FORBIDDEN = [
  'пилешк', 'говежд', 'свинск', 'риба', 'треска', 'ориз', 'хляб', 'паста', 'картоф',
];
