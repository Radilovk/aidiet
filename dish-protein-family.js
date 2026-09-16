/**
 * Protein-family tags for dietitian-style weekly rotation.
 * One main protein source per plated meal; no duplicate family at lunch + dinner.
 */

import { normalizeFoodKey } from './food-utils.js';
import { READY_MEAL_PARTS } from './ready-meal-parts.js';

const FAMILY_RULES = [
  { family: 'chicken', terms: ['пилешк', 'пиле ', 'пилешко'] },
  { family: 'beef', terms: ['говежд', 'телешк', 'кайма'] },
  { family: 'pork', terms: ['свинск'] },
  { family: 'fish', terms: ['риба', 'сьомга', 'скумри', 'треска', 'тон', 'херинга', 'пъстърва'] },
  { family: 'eggs', terms: ['яйца', 'яйце', 'омлет'] },
  { family: 'dairy', terms: ['извара', 'скир', 'кисело мляко', 'кефир', 'сирене', 'моцарела'] },
  { family: 'legume', terms: ['боб', 'леща', 'нахут', 'соя', 'темпе', 'тофу'] },
  { family: 'turkey', terms: ['пуешк', 'пуйка'] },
];

function textFromDish(entry) {
  const parts = entry?.id ? READY_MEAL_PARTS[entry.id] : entry?.products;
  const names = (parts || []).map(p => p.name).join(' ');
  return normalizeFoodKey(`${entry?.name || ''} ${names}`);
}

/**
 * @returns {string} protein family id or 'other'
 */
export function inferDishProteinFamily(entry) {
  const text = textFromDish(entry);
  for (const { family, terms } of FAMILY_RULES) {
    if (terms.some(t => text.includes(normalizeFoodKey(t)))) return family;
  }
  return 'other';
}

/** Fruit presence — at most one fruit-forward dish per day. */
export function dishHasFruit(entry) {
  const text = textFromDish(entry);
  return /банан|ябълк|круш|портокал|ягод|боровинк|малин|плод/.test(text);
}

/** Major starch (rice, pasta, potato, bread as main) — track per day. */
export function dishHasMajorStarch(entry) {
  const parts = entry?.id ? READY_MEAL_PARTS[entry.id] : entry?.products;
  if (!parts?.length) return false;
  return parts.some(p => {
    const g = Number(p.grams) || 0;
    const n = normalizeFoodKey(p.name);
    return g >= 80 && /ориз|паста|картоф|хляб|макарон|киноа|овес/.test(n);
  });
}
