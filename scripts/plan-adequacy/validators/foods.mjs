import { resolveCatalogEntry, validateProductNamesInCatalog } from '../../../food-catalog.js';
import { DEFAULT_MIN_UNIVERSALITY } from '../../../food-catalog-data.js';
import { parseMealDescription } from '../../../food-nutrition.js';

const MIN_UNIVERSALITY = DEFAULT_MIN_UNIVERSALITY;

/** Рядки/нишови продукти — валидни в каталога, но не за рутинен план */
const NICHE_PATTERNS = [
  /лаврак|патеш|заеш|агнеш|дивеч/i,
  /амарант|темпе|tempeh/i,
];

export function validateMealCatalog(meal) {
  const issues = [];
  if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') return issues;

  const names = parseMealDescription(meal.description || '').map(i => i.name);
  const unknown = validateProductNamesInCatalog(names);
  if (unknown.length) {
    issues.push(`"${meal.name}": продукти извън каталога: ${unknown.join(', ')}`);
  }
  return issues;
}

export function validateMealFoodUniversality(meal) {
  const issues = [];
  if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') return issues;

  const names = parseMealDescription(meal.description || '').map(i => i.name);
  for (const name of names) {
    const { entry, unknown } = resolveCatalogEntry(name);
    if (unknown) continue;

    if (entry.universality < MIN_UNIVERSALITY) {
      issues.push(
        `"${meal.name}": прекалено конкретен продукт "${name}" (универсалност ${entry.universality} < ${MIN_UNIVERSALITY})`
      );
    }
    for (const pat of NICHE_PATTERNS) {
      if (pat.test(name)) {
        issues.push(`"${meal.name}": неуниверсален/рядък продукт "${name}"`);
      }
    }
  }
  return issues;
}

export function validateWeekPlanFoods(weekPlan) {
  const issues = [];
  for (let d = 1; d <= 7; d++) {
    const day = weekPlan[`day${d}`];
    if (!day?.meals) continue;
    for (const meal of day.meals) {
      issues.push(...validateMealCatalog(meal), ...validateMealFoodUniversality(meal));
    }
  }
  return issues;
}
