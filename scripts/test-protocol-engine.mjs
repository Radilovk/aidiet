#!/usr/bin/env node
/** Protocol engine — deterministic daily/weekly menu generation. */
import { generateProtocol, generateWeeklyMenu, resolveLibraryDietProfile } from '../protocol-engine.js';
import { getLibraryMergeStats } from '../nutrition-library-bridge.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const stats = getLibraryMergeStats();
ok(stats.libraryFoods >= 240, `foods >= 240 (${stats.libraryFoods})`);
ok(stats.readyMeals >= 30, `ready meals >= 30 (${stats.readyMeals})`);
ok(stats.mealTemplates >= 5, `templates >= 5 (${stats.mealTemplates})`);
ok(stats.dietProfiles >= 12, `diet profiles >= 12 (${stats.dietProfiles})`);

ok(resolveLibraryDietProfile({ dietPreference: ['Веган'] }) === 'vegan', 'vegan profile');
ok(resolveLibraryDietProfile({ dietaryModifier: 'Кетогенна диета' }) === 'keto', 'keto profile');

const client = {
  sex: 'female', age: 35, weightKg: 70, heightCm: 165,
  activityLevel: 'moderate', goal: 'fat_loss',
  dietPreference: ['Балансирано'],
  activeSlots: ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5'],
};

const protocol = generateProtocol(client, { seed: 42 });
ok(protocol.dailyMenu.length === 5, '5 meals generated');
ok(protocol.dailyMenu.every(m => m.kcal > 0), 'all meals have kcal');
ok(protocol.allowedFoodCount >= 100, `allowed foods >= 100 (${protocol.allowedFoodCount})`);
ok(protocol.validation.totals.kcal > 800, `daily kcal plausible (${protocol.validation.totals.kcal})`);
ok(protocol.shoppingList.length >= 5, `shopping list >= 5 (${protocol.shoppingList.length})`);
ok(['VALID', 'REVIEW'].includes(protocol.validation.status), 'validation status');

const vegan = generateProtocol({ ...client, dietPreference: ['Веган'] }, { seed: 1 });
ok(vegan.dietProfile === 'vegan', 'vegan protocol');
ok(!vegan.dailyMenu.some(m => (m.items || []).some(i => /пилешко|сьомга|кисело мляко/i.test(i.name))), 'vegan no animal items in picked lines');

const week = generateWeeklyMenu(client, { seed: 7 });
ok(week.days.length === 7, '7-day week');
ok(week.shoppingList.length >= 10, 'weekly shopping list');

console.log('\n=== protocol sample ===');
console.log(JSON.stringify({
  diet: protocol.dietProfile,
  kcal: protocol.validation.totals,
  meals: protocol.dailyMenu.map(m => ({ slot: m.slot, name: m.name, kcal: m.kcal, source: m.source })),
}, null, 2));

console.log(`\n=== protocol engine: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
