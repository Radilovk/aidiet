/**
 * Universality stress test — offline, deterministic, no AI/network.
 * Probes the catalog candidate pools (the AI-facing product lists in Step 3 prompts)
 * against diverse diets, allergy combinations, and clinical protocols to find where
 * the architecture breaks: empty candidate pools, forbidden-food leakage.
 * (Gram/calorie arithmetic is covered separately in test-meal-scaling.mjs.)
 */
import { getCatalogCandidatesForChunk } from './food-catalog.js';

const results = [];

function strategyFor(target, mealType = 'Хранене 2') {
  return {
    weeklyScheme: {
      monday: { mealBreakdown: [{ type: mealType, ...target }] },
    },
  };
}

function runScenario(name, { mealType = 'Хранене 2', dietaryModifier = 'Балансирано', target, blockedTerms = [], clinicalProtocolId = null, forbiddenNames = [] }) {
  const bySlot = getCatalogCandidatesForChunk({
    strategy: strategyFor(target, mealType),
    startDay: 1,
    endDay: 1,
    dietaryModifier,
    blockedTerms,
    clinicalProtocolId,
  });

  const allNames = [...bySlot.values()].flat().map(e => e.name);
  const emptySlots = [...bySlot.entries()]
    .filter(([slot, list]) => slot !== 'READY' && !list.length)
    .map(([slot]) => slot);
  const leakedBlocked = allNames.filter(n => blockedTerms.some(t => n.toLowerCase().includes(t.toLowerCase())));
  const leakedForbidden = allNames.filter(n => forbiddenNames.some(f => n.toLowerCase().includes(f.toLowerCase())));

  const pass = !emptySlots.length && !leakedBlocked.length && !leakedForbidden.length;
  console.log(`\n${pass ? '✓' : '✗'} ${name}`);
  console.log(`  target: ${target.calories}kcal P${target.protein}/C${target.carbs}/F${target.fats} | кандидати общо: ${allNames.length}`);
  if (emptySlots.length) console.log(`  ⚠ ПРАЗНИ СЛОТОВЕ: ${emptySlots.join(', ')} — AI няма от какво да избира!`);
  if (leakedBlocked.length) console.log(`  ⚠ ТЕЧ НА БЛОКИРАНИ: ${[...new Set(leakedBlocked)].join(', ')}`);
  if (leakedForbidden.length) console.log(`  ⚠ ТЕЧ НА ЗАБРАНЕНИ: ${[...new Set(leakedForbidden)].join(', ')}`);
  results.push(pass);
}

console.log('=== Universality stress test (каталожни пулове за Step 3) ===');

runScenario('Кето — обяд с висок процент мазнини', {
  dietaryModifier: 'Кетогенна диета',
  target: { calories: 700, protein: 40, carbs: 12, fats: 58 },
  forbiddenNames: ['Ориз', 'Картофи', 'Паста'],
});

runScenario('Веган + без глутен — вечеря', {
  mealType: 'Хранене 4',
  dietaryModifier: 'Веган без глутен',
  target: { calories: 550, protein: 30, carbs: 60, fats: 18 },
  forbiddenNames: ['Пилешко', 'Говеждо', 'Риба', 'Яйца', 'Сирене', 'Кисело мляко', 'Хляб', 'Паста'],
});

runScenario('Алергия към ядки — Хранене 5', {
  mealType: 'Хранене 5',
  target: { calories: 180, protein: 12, carbs: 8, fats: 12 },
  blockedTerms: ['ядки', 'бадеми', 'орехи', 'кашу', 'лешници', 'фъстъци', 'шамфъстък', 'тиквени семки', 'слънчогледови семки'],
});

runScenario('AIP клиничен протокол — закуска (без яйца/млечни/зърнени/ядки/нощни)', {
  mealType: 'Хранене 1',
  dietaryModifier: 'Автоимунен протокол',
  target: { calories: 450, protein: 30, carbs: 35, fats: 20 },
  clinicalProtocolId: 'autoimmune_aip',
  forbiddenNames: ['Яйца', 'Кисело мляко', 'Сирене', 'Извара', 'Скир', 'Хляб', 'Овесени',
    'Ориз', 'Киноа', 'Ядки', 'Бадеми', 'Орехи', 'Домат', 'Чушка', 'Картофи', 'Тофу', 'Леща', 'Нахут'],
});

runScenario('Пескетарианец + без млечни — обяд', {
  dietaryModifier: 'Пескетарианска диета',
  target: { calories: 600, protein: 45, carbs: 50, fats: 22 },
  blockedTerms: ['мляко', 'кисело мляко', 'сирене', 'кашкавал', 'извара', 'скир', 'кефир', 'рикота'],
  forbiddenNames: ['Пилешко', 'Пилешки', 'Говеждо', 'Свинско', 'Пуешко', 'Кайма'],
});

runScenario('Много висока калорийна цел — вечеря (bulking)', {
  mealType: 'Хранене 4',
  target: { calories: 780, protein: 65, carbs: 75, fats: 24 },
});

runScenario('Много ниска калорийна цел — закуска', {
  mealType: 'Хранене 1',
  target: { calories: 220, protein: 18, carbs: 20, fats: 7 },
});

const passed = results.filter(Boolean).length;
console.log(`\n=== Обобщение: ${passed}/${results.length} PASS (без празни пулове / теч на забранени храни) ===`);
process.exit(passed === results.length ? 0 : 1);
