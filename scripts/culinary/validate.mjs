/**
 * Проверка на рецептите (data/engine/recipes.json) спрямо ястията: места
 * {PRO}… само за съществуващи части, без грамове, без продукти извън ястието,
 * пазачът на текстовете. Изход 1 при проблем — ползва се в теста и в генератора.
 *
 *   node scripts/culinary/validate.mjs [път/до/recipes.json]
 */
import { readFileSync } from 'node:fs';
import { DISHES, food } from '../../nutrition-engine/knowledge.js';
import { recipeIssues } from '../../nutrition-engine/recipes.js';
import foodsJson from '../../data/engine/foods.json' with { type: 'json' };

export const FOOD_LABELS = {
  labelOf: (id) => food(id).label,
  allLabels: [...new Set(Object.values(/** @type {any} */ (foodsJson).foods).map((f) => f.label))],
};

/** @returns {Record<string, string[]>} проблемите по ястие (празно — всичко е наред) */
export function validateRecipes(recipes) {
  const out = {};
  for (const dish of DISHES) {
    const issues = recipeIssues(dish, recipes[dish.id], FOOD_LABELS);
    if (issues.length) out[dish.id] = issues;
  }
  for (const id of Object.keys(recipes)) if (!DISHES.some((d) => d.id === id)) out[id] = ['няма такова ястие'];
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] || new URL('../../data/engine/recipes.json', import.meta.url).pathname;
  const recipes = JSON.parse(readFileSync(path, 'utf8')).recipes || {};
  const bad = validateRecipes(recipes);
  for (const [id, issues] of Object.entries(bad)) console.log(`${id}: ${issues.join(' | ')}`);
  console.log(`\nрецепти: ${Object.keys(recipes).length}, с проблем: ${Object.keys(bad).length}`);
  process.exit(Object.keys(bad).length ? 1 : 0);
}
