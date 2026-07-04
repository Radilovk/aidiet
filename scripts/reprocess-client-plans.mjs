#!/usr/bin/env node
/**
 * Reprocess stored client plans with fixed gram allocation logic.
 * Usage: node scripts/reprocess-client-plans.mjs
 */

const WORKER_URL = process.env.WORKER_URL || 'https://aidiet.radilov-k.workers.dev';

const TARGET_CLIENTS = [
  { id: 'client_1782913756358_awvofd', name: 'Алекс' },
  { id: 'client_1783078163805_gkdo7', name: 'Валентин' },
  { id: 'client_1782999217236_7zvae9', name: 'Мария Башева' },
  { id: 'client_1781620013349_axcjro', name: 'Виктор' },
  { id: 'client_1781138769382_8b8mu', name: 'Kamen' },
];

const DAY_NUMBER_TO_KEY = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const FIXED_DESSERT_WEIGHT_GRAMS = 30;
const MEAL_TYPE_ALIASES = {
  'Закуска': 'Хранене 1', 'Обяд': 'Хранене 2', 'Следобедна закуска': 'Хранене 3',
  'Вечеря': 'Хранене 4', 'Късна закуска': 'Хранене 5', 'Междинно': 'Хранене 3',
  'Снак': 'Хранене 3', 'Снек': 'Хранене 3', 'Десерт': 'Хранене 3',
};

const GRAM_ALLOC_DENSITY = {
  PRO: { protein: 22, carbs: 0, fats: 5 },
  ENG: { protein: 3, carbs: 25, fats: 1 },
  FAT: { protein: 0, carbs: 0, fats: 100 },
  VOL: { protein: 1, carbs: 4, fats: 0 },
  FRUIT: { protein: 0.5, carbs: 12, fats: 0.2 },
  SWEET: { protein: 0, carbs: 80, fats: 0 },
  MIXED: { protein: 12, carbs: 15, fats: 8 },
};

function macrosToCalories(macros) {
  if (!macros) return 0;
  return Math.round((Number(macros.protein) || 0) * 4 + (Number(macros.carbs) || 0) * 4 + (Number(macros.fats) || 0) * 9);
}

function classifyProductRole(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return 'SEASON';
  if (/черен пипер|бял пипер|канела|стевия|сол\b|подправ|риган|копър|магданоз|сумак|куркума|джинджифил|чесън на прах|босилек/.test(n)) return 'SEASON';
  if (/^лимон|^лайм|лимонов сок/.test(n)) return 'SEASON';
  if (/мед|захар|мелас|сироп/.test(n)) return 'SWEET';
  if (/ябълк|боровин|ягод|малин|портокал|грозде|круша|череш|слива|манго|ананас|плод|нектарин|киви|диня|пъпеш/.test(n)) return 'FRUIT';
  if (/протеин|суроват/.test(n)) return 'PRO_SUP';
  if (/ориз|киноа|овес|паста|хляб|картоф|леща|боб|нахут|мюсли|каша|елда|булгур|гриз|макарон|пълнозърнест|тортила|батат|сладък картоф/.test(n)) return 'ENG';
  if (/зехтин|масло|авокадо|бадем|орех|кашу|лешник|фъстък|семе|чия|тахан|маслин|олио|шамфъстък|макадамия|пекан|ядк/.test(n)) return 'FAT';
  if (/салат|домат|крастав|чушк|броколи|тиквич|морков|зеленч|маруля|спанак|гъби|карфиол|тиква|зеле|лук|чесън|праз|еринги|айсберг|репич/.test(n)) return 'VOL';
  if (/пиле|пилеш|гърди|месо|риба|сьомга|треска|яйц|сирен|извара|мляко|скир|тофу|кисело мляко|свин|говед|кайма|пъстърва|тон|пуеш|кашкавал/.test(n)) return 'PRO';
  return 'MIXED';
}

function getSeasoningGrams(name) {
  const n = String(name || '').toLowerCase();
  if (/пипер|канела|стевия/.test(n)) return 2;
  if (/лимон|лайм/.test(n)) return 15;
  return 3;
}

function cleanExtractedProductName(raw) {
  const trimmed = String(raw || '').trim();
  const withoutBullet = trimmed.replace(/^[•\-\*]\s*/, '');
  if (/^десерт\s*:/i.test(withoutBullet) || /десерт\s*:\s*\d+\s*ккал/i.test(withoutBullet)) return '';
  return trimmed
    .replace(/^[•\-\*]\s*/, '')
    .replace(/\s+\d+(?:[.,]\d+)?\s*(?:g|г)\b.*$/i, '')
    .replace(/\s+\d+(?:[.,]\d+)?\s*(?:g|г)\s*$/i, '')
    .replace(/\s*\(\d+\s*бр\.?[^)]*\)/gi, '')
    .replace(/\([^)]*\d+\s*(?:g|г)[^)]*\)/gi, '')
    .replace(/\([^)]*(?:по желание|включена в макрос)[^)]*\)/gi, '')
    .replace(/\s*\(\d+\s*%\s*[^)]*\)/gi, '')
    .replace(/\s*[—\-].*$/, '')
    .replace(/,\s*(?:приготв|наряз|печен|варен|на пара|задуш|запеч|маринов|овкус|сварен|без|с\s+(?:малко|лек)|или\s+).*/i, '')
    .replace(/^една супена лъжица\s+/i, '')
    .replace(/\.\s*$/, '')
    .replace(/^хляб:\s*/i, 'хляб ')
    .trim();
}

function extractMealProductNames(meal) {
  const names = [];
  const seen = new Set();
  const add = (raw) => {
    const name = cleanExtractedProductName(raw);
    if (name.length > 1 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      names.push(name);
    }
  };
  const desc = meal.description || '';
  if (desc) desc.split(/[\n;]+/).forEach(part => add(part));
  if (!names.length && meal.name) String(meal.name).split(/\n+/).forEach(line => add(line));
  return names;
}

function macroContribFromGrams(grams, density) {
  return {
    protein: grams * density.protein / 100,
    carbs: grams * density.carbs / 100,
    fats: grams * density.fats / 100,
  };
}

function sumMacroContrib(items) {
  return items.reduce((acc, item) => {
    const d = GRAM_ALLOC_DENSITY[item.role] || GRAM_ALLOC_DENSITY.MIXED;
    const m = macroContribFromGrams(item.grams, d);
    acc.protein += m.protein;
    acc.carbs += m.carbs;
    acc.fats += m.fats;
    return acc;
  }, { protein: 0, carbs: 0, fats: 0 });
}

function getAllocatableMacros(meal) {
  const m = {
    protein: Number(meal.macros?.protein) || 0,
    carbs: Number(meal.macros?.carbs) || 0,
    fats: Number(meal.macros?.fats) || 0,
  };
  if (meal.dessert && typeof meal.dessert === 'object' && meal.dessert.macros) {
    m.protein = Math.max(0, m.protein - (Number(meal.dessert.macros.protein) || 0));
    m.carbs = Math.max(0, m.carbs - (Number(meal.dessert.macros.carbs) || 0));
    m.fats = Math.max(0, m.fats - (Number(meal.dessert.macros.fats) || 0));
  }
  return m;
}

function allocateMealGramsFromMacros(meal) {
  if (!meal?.macros || meal.type === 'Свободно хранене' || meal.type === 'Напитка') return;

  const names = extractMealProductNames(meal);
  if (!names.length) return;

  const target = getAllocatableMacros(meal);
  const items = names.map(name => ({ name, role: classifyProductRole(name), grams: 0 }));

  const season = items.filter(i => i.role === 'SEASON');
  const proSup = items.filter(i => i.role === 'PRO_SUP');
  const vol = items.filter(i => i.role === 'VOL');
  const pro = items.filter(i => i.role === 'PRO');
  const eng = items.filter(i => i.role === 'ENG');
  const fat = items.filter(i => i.role === 'FAT');
  const fruit = items.filter(i => i.role === 'FRUIT');
  const sweet = items.filter(i => i.role === 'SWEET');
  const mixed = items.filter(i => i.role === 'MIXED');

  let remP = target.protein;
  let remC = target.carbs;
  let remF = target.fats;

  season.forEach(i => { i.grams = getSeasoningGrams(i.name); });

  proSup.forEach(i => {
    i.grams = 30;
    const m = macroContribFromGrams(i.grams, GRAM_ALLOC_DENSITY.PRO);
    remP = Math.max(0, remP - m.protein);
    remC = Math.max(0, remC - m.carbs);
    remF = Math.max(0, remF - m.fats);
  });

  if (vol.length && remC > 0) {
    const volCarbBudget = remC * 0.35;
    const gPer = Math.min(100, Math.max(60, Math.round((volCarbBudget / vol.length) / (GRAM_ALLOC_DENSITY.VOL.carbs / 100)) || 80));
    vol.forEach(i => { i.grams = gPer; });
    const used = sumMacroContrib(vol);
    remP = Math.max(0, remP - used.protein);
    remC = Math.max(0, remC - used.carbs);
    remF = Math.max(0, remF - used.fats);
  }

  if (pro.length && remP > 0) {
    const gPer = Math.round((remP / pro.length) / (GRAM_ALLOC_DENSITY.PRO.protein / 100));
    const grams = Math.min(250, Math.max(80, gPer || 120));
    pro.forEach(i => { i.grams = grams; });
    const used = sumMacroContrib(pro);
    remP = Math.max(0, remP - used.protein);
    remC = Math.max(0, remC - used.carbs);
    remF = Math.max(0, remF - used.fats);
  }

  if (eng.length && remC > 0) {
    const gPer = Math.round((remC / eng.length) / (GRAM_ALLOC_DENSITY.ENG.carbs / 100));
    const grams = Math.min(250, Math.max(40, gPer || 100));
    eng.forEach(i => { i.grams = grams; });
    const used = sumMacroContrib(eng);
    remP = Math.max(0, remP - used.protein);
    remC = Math.max(0, remC - used.carbs);
    remF = Math.max(0, remF - used.fats);
  }

  if (fruit.length && remC > 0) {
    const gPer = Math.round((remC / fruit.length) / (GRAM_ALLOC_DENSITY.FRUIT.carbs / 100));
    const grams = Math.min(120, Math.max(40, gPer || 80));
    fruit.forEach(i => { i.grams = grams; });
    const used = sumMacroContrib(fruit);
    remP = Math.max(0, remP - used.protein);
    remC = Math.max(0, remC - used.carbs);
    remF = Math.max(0, remF - used.fats);
  }

  if (sweet.length && remC > 0) {
    sweet.forEach(i => {
      i.grams = Math.min(15, Math.max(5, Math.round(remC / sweet.length / (GRAM_ALLOC_DENSITY.SWEET.carbs / 100)) || 10));
    });
    remC = Math.max(0, remC - sumMacroContrib(sweet).carbs);
  }

  if (fat.length && remF > 2) {
    fat.forEach(i => {
      const isOil = /зехтин|масло|олио/.test(i.name.toLowerCase());
      const maxG = isOil ? 20 : 30;
      const gPer = Math.round((remF / fat.length) / (GRAM_ALLOC_DENSITY.FAT.fats / 100));
      i.grams = Math.min(maxG, Math.max(5, gPer || 10));
    });
  } else if (remF > 5 && !fat.length) {
    items.push({ name: 'зехтин', role: 'FAT', grams: Math.min(15, Math.round(remF)) });
  }

  if (mixed.length) {
    if (remP > 5) {
      const gPer = Math.round((remP / mixed.length) / (GRAM_ALLOC_DENSITY.MIXED.protein / 100));
      mixed.forEach(i => { i.grams = Math.min(150, Math.max(40, gPer || 80)); });
    } else if (remC > 5) {
      const gPer = Math.round((remC / mixed.length) / (GRAM_ALLOC_DENSITY.MIXED.carbs / 100));
      mixed.forEach(i => { i.grams = Math.min(150, Math.max(40, gPer || 80)); });
    } else {
      mixed.forEach(i => { i.grams = 50; });
    }
  }

  const allocated = items.filter(i => i.grams > 0);
  if (!allocated.length) return;

  const scaleItems = allocated.filter(i => i.role !== 'SEASON');
  const targetCal = macrosToCalories(target);
  if (targetCal > 0 && scaleItems.length) {
    let actualCal = macrosToCalories(sumMacroContrib(scaleItems));
    if (actualCal > 0) {
      const factor = targetCal / actualCal;
      scaleItems.forEach(i => {
        const isOil = /зехтин|масло|олио/.test(i.name.toLowerCase());
        const minG = i.role === 'FAT' ? 5 : (i.role === 'SWEET' ? 5 : 15);
        const maxG = i.role === 'FAT' && isOil ? 25 : i.role === 'FAT' ? 35 : i.role === 'PRO' ? 280 : i.role === 'SWEET' ? 15 : 280;
        i.grams = Math.min(maxG, Math.max(minG, Math.round(i.grams * factor)));
      });
    }
  }

  meal.description = allocated.map(i => `• ${i.name} ${i.grams}g`).join('\n');
  let totalGrams = allocated.reduce((s, i) => s + i.grams, 0);
  if (meal.dessert && typeof meal.dessert === 'object' && FIXED_DESSERT_WEIGHT_GRAMS > 0) {
    totalGrams += FIXED_DESSERT_WEIGHT_GRAMS;
  }
  if (totalGrams > 0) meal.weight = `${totalGrams}г`;
}

function normalizeMealBreakdownTypes(strategy) {
  if (!strategy?.weeklyScheme) return;
  for (const day of Object.values(strategy.weeklyScheme)) {
    if (!day?.mealBreakdown?.length) continue;
    for (const entry of day.mealBreakdown) {
      if (entry?.type && MEAL_TYPE_ALIASES[entry.type]) entry.type = MEAL_TYPE_ALIASES[entry.type];
    }
  }
}

function normalizeMealTypesInWeekPlan(weekPlan) {
  if (!weekPlan) return;
  for (const day of Object.values(weekPlan)) {
    if (!day?.meals?.length) continue;
    for (const meal of day.meals) {
      if (meal?.type && MEAL_TYPE_ALIASES[meal.type]) meal.type = MEAL_TYPE_ALIASES[meal.type];
    }
  }
}

function alignMealsToBreakdown(dayPlan, dayTarget) {
  if (!dayPlan?.meals?.length || !dayTarget?.mealBreakdown) return;
  for (const meal of dayPlan.meals) {
    if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
    const target = dayTarget.mealBreakdown.find(m => m.type === meal.type);
    if (!target) continue;
    meal.macros = {
      protein: Math.round(Number(target.protein) || 0),
      carbs: Math.round(Number(target.carbs) || 0),
      fats: Math.round(Number(target.fats) || 0),
    };
    meal.calories = macrosToCalories(meal.macros);
    allocateMealGramsFromMacros(meal);
  }
}

function finalizeWeekPlanDays(weekPlan, strategy, startDay, endDay) {
  if (!weekPlan) return;
  normalizeMealBreakdownTypes(strategy);
  normalizeMealTypesInWeekPlan(weekPlan);
  if (strategy?.weeklyScheme) {
    for (let d = startDay; d <= endDay; d++) {
      const dayPlan = weekPlan[`day${d}`];
      const dayTarget = strategy.weeklyScheme[DAY_NUMBER_TO_KEY[d - 1]];
      if (dayPlan && dayTarget) alignMealsToBreakdown(dayPlan, dayTarget);
    }
  }
}

function reprocessPlanGramAllocation(plan) {
  if (!plan?.weekPlan) return plan;
  finalizeWeekPlanDays(plan.weekPlan, plan.strategy || {}, 1, 7);
  return plan;
}

function sampleMeals(plan, limit = 2) {
  const samples = [];
  for (let d = 1; d <= 7 && samples.length < limit; d++) {
    const day = plan.weekPlan?.[`day${d}`];
    if (!day?.meals) continue;
    for (const meal of day.meals) {
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
      samples.push({ day: d, type: meal.type, weight: meal.weight, desc: (meal.description || '').split('\n').slice(0, 4).join(' | ') });
      if (samples.length >= limit) break;
    }
  }
  return samples;
}

async function fetchClient(clientId) {
  const res = await fetch(`${WORKER_URL}/api/admin/get-client-data?clientId=${clientId}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'fetch failed');
  return data.client;
}

async function updatePlan(clientId, plan) {
  const res = await fetch(`${WORKER_URL}/api/admin/update-client-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, plan }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'update failed');
  return data;
}

async function main() {
  console.log('Reprocessing client plans...\n');
  for (const { id, name } of TARGET_CLIENTS) {
    try {
      const client = await fetchClient(id);
      if (!client.plan) {
        console.log(`⚠ ${name}: no plan`);
        continue;
      }
      const before = sampleMeals(client.plan);
      reprocessPlanGramAllocation(client.plan);
      const after = sampleMeals(client.plan);
      await updatePlan(id, client.plan);
      console.log(`✓ ${name} (${id})`);
      console.log('  before:', before.map(s => `${s.type} ${s.weight}`).join('; '));
      console.log('  after: ', after.map(s => `${s.type} ${s.weight}`).join('; '));
      console.log('  sample:', after[0]?.desc || '—');
      console.log('');
    } catch (err) {
      console.error(`✗ ${name}: ${err.message}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
