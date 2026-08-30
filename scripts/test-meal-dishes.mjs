#!/usr/bin/env node
/**
 * Проверка на списъка с ястия (meal-dishes.js).
 *
 * Списъкът е предвиден за ръчно редактиране, затова се проверява като данни:
 * всеки продукт трябва да съществува в каталога, грамажите да са реалистични,
 * а ястието да спазва същите правила, по които се съди готовият план — иначе
 * дефектът стига до клиента през курирано ястие, което никой не е проверил.
 */
import { MEAL_DISHES } from '../meal-dishes.js';
import { resolveCatalogEntry } from '../food-catalog.js';
import { checkProductCompatibility } from '../meal-compatibility.js';
import { maxPortionGrams, minPortionGrams } from '../portion-limits.js';

let pass = 0;
let fail = 0;
function ok(cond, msg, detail = '') {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}${detail ? ` — ${detail}` : ''}`); }
}

const PLATED_TIMINGS = new Set(['main']);
const VEGETABLE_GROUPS = new Set(['vegetable']);

const ids = new Set();
const duplicateIds = [];
const unknownProducts = [];
const badPortions = [];
const incompatible = [];
const noVegetable = [];
const badProductCount = [];
const latinNames = [];
const missingTiming = [];

for (const d of MEAL_DISHES) {
  if (ids.has(d.id)) duplicateIds.push(d.id);
  ids.add(d.id);

  if (/[A-Za-z]/.test(d.name)) latinNames.push(d.name);
  if (!d.timing?.length) missingTiming.push(d.id);
  if (d.products.length < 2 || d.products.length > 4) {
    badProductCount.push(`${d.name}: ${d.products.length} продукта`);
  }

  const names = [];
  for (const p of d.products) {
    const { entry, unknown } = resolveCatalogEntry(p.name);
    if (unknown) { unknownProducts.push(`${d.id} → ${p.name}`); continue; }
    names.push(p.name);
    const descriptor = {
      name: p.name, nutritionKey: entry.nutritionKey, group: entry.group,
      maxPortionG: entry.maxPortionG,
    };
    const max = maxPortionGrams(descriptor);
    const min = minPortionGrams(descriptor);
    if (p.grams > max) badPortions.push(`${d.name}: ${p.name} ${p.grams}g > ${max}g`);
    if (p.grams < Math.min(min, 5)) badPortions.push(`${d.name}: ${p.name} ${p.grams}g твърде малко`);
  }

  const issues = checkProductCompatibility(names, { allowSweetener: !d.timing.includes('main') });
  for (const issue of issues) incompatible.push(`${d.name}: ${issue}`);

  if (d.timing.some(t => PLATED_TIMINGS.has(t))) {
    const hasVeg = d.products.some(p => VEGETABLE_GROUPS.has(resolveCatalogEntry(p.name).entry?.group));
    if (!hasVeg) noVegetable.push(d.name);
  }
}

ok(MEAL_DISHES.length >= 40, `списъкът има достатъчно ястия (${MEAL_DISHES.length})`);
ok(duplicateIds.length === 0, 'няма повтарящи се id', duplicateIds.join(', '));
ok(unknownProducts.length === 0, 'всички продукти съществуват в каталога', unknownProducts.slice(0, 3).join('; '));
ok(badProductCount.length === 0, 'всяко ястие има 2–4 продукта', badProductCount.slice(0, 3).join('; '));
ok(missingTiming.length === 0, 'всяко ястие има поне едно време', missingTiming.join(', '));
ok(latinNames.length === 0, 'имената са само на кирилица', latinNames.join(', '));
ok(badPortions.length === 0, 'грамажите са в реалистични граници', badPortions.slice(0, 3).join('; '));
ok(incompatible.length === 0, 'ястията спазват правилата за състав', incompatible.slice(0, 3).join('; '));
ok(noVegetable.length === 0, 'обяд/вечеря ястията имат зеленчук', noVegetable.slice(0, 5).join(', '));

const vegan = MEAL_DISHES.filter(d => d.vegan);
ok(vegan.length >= 15, `достатъчно веган ястия (${vegan.length})`);
ok(MEAL_DISHES.filter(d => d.timing.includes('breakfast')).length >= 10,
  `достатъчно закуски (${MEAL_DISHES.filter(d => d.timing.includes('breakfast')).length})`);
ok(MEAL_DISHES.filter(d => d.timing.includes('late_snack')).length >= 4,
  `достатъчно късни закуски (${MEAL_DISHES.filter(d => d.timing.includes('late_snack')).length})`);

console.log(`\n=== meal dishes: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
