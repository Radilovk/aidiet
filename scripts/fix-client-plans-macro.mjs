#!/usr/bin/env node
/**
 * Macro-aware client plan gram fixer.
 * - Sensible product combinations per meal type
 * - Grams derived from meal macro targets
 * - Rounded to 10g
 */

import { readFile } from 'fs/promises';

const WORKER_URL = process.env.WORKER_URL || 'https://aidiet.radilov-k.workers.dev';
const DESSERT_GRAMS = 30;

const CLIENTS = [
  { id: 'client_1782913756358_awvofd', name: 'Алекс', backup: '/tmp/plan_client_1782913756358_awvofd.json' },
  { id: 'client_1783078163805_gkdo7', name: 'Валентин', backup: '/tmp/plan_client_1783078163805_gkdo7.json' },
  { id: 'client_1782999217236_7zvae9', name: 'Мария Башева', backup: '/tmp/plan_client_1782999217236_7zvae9.json' },
  { id: 'client_1781620013349_axcjro', name: 'Виктор', backup: '/tmp/plan_client_1781620013349_axcjro.json' },
  { id: 'client_1781138769382_8b8mu', name: 'Kamen', backup: '/tmp/plan_client_1781138769382_8b8mu.json' },
];

/** Per 100g: protein, carbs, fats */
const NUTRITION = {
  PRO_MEAT: { p: 22, c: 0, f: 5 },
  PRO_FISH: { p: 20, c: 0, f: 12 },
  PRO_EGG: { p: 13, c: 1, f: 11 },
  PRO_DAIRY: { p: 11, c: 4, f: 3 },
  PRO_CHEESE: { p: 25, c: 2, f: 20 },
  PRO_POWDER: { p: 78, c: 8, f: 5 },
  CARB_GRAIN: { p: 3, c: 26, f: 1 },
  CARB_OATS: { p: 13, c: 66, f: 7 },
  CARB_LEGUME: { p: 8, c: 20, f: 1 },
  CARB_BREAD: { p: 9, c: 48, f: 3 },
  FAT_OIL: { p: 0, c: 0, f: 100 },
  FAT_NUTS: { p: 20, c: 18, f: 52 },
  FAT_PB: { p: 25, c: 20, f: 50 },
  VEG: { p: 1, c: 4, f: 0 },
  FRUIT: { p: 1, c: 12, f: 0 },
  SWEET: { p: 0, c: 82, f: 0 },
  SEASON: { p: 0, c: 3, f: 0 },
};

function round10(g) {
  return Math.max(10, Math.round(g / 10) * 10);
}

function macrosToCalories(m) {
  const p = Number(m?.p ?? m?.protein) || 0;
  const c = Number(m?.c ?? m?.carbs) || 0;
  const f = Number(m?.f ?? m?.fats) || 0;
  return p * 4 + c * 4 + f * 9;
}

function contrib(grams, profile) {
  return {
    p: grams * profile.p / 100,
    c: grams * profile.c / 100,
    f: grams * profile.f / 100,
  };
}

function sumContrib(items) {
  return items.reduce(
    (acc, it) => {
      const m = contrib(it.grams, it.profile);
      acc.p += m.p;
      acc.c += m.c;
      acc.f += m.f;
      return acc;
    },
    { p: 0, c: 0, f: 0 }
  );
}

function cleanName(raw) {
  return String(raw || '')
    .replace(/^[•\-\*]\s*/, '')
    .replace(/\s+\d+(?:[.,]\d+)?\s*(?:g|г)\b.*$/i, '')
    .replace(/\s*\(\d+\s*бр\.?[^)]*\)/gi, '')
    .replace(/\([^)]*(?:по желание|включена в макрос)[^)]*\)/gi, '')
    .replace(/\s*[—\-].*$/, '')
    .replace(/,\s*(?:приготв|наряз|печен|варен|на пара|задуш|запеч|маринов|овкус|сварен|без|или\s+).*/i, '')
    .replace(/^една супена лъжица\s+/i, '')
    .replace(/\.\s*$/, '')
    .trim();
}

function parseProducts(description) {
  const names = [];
  const seen = new Set();
  for (const line of String(description || '').split('\n')) {
    const raw = line.trim();
    if (!raw || /десерт\s*:/i.test(raw)) continue;
    const name = cleanName(raw);
    if (!name || /^десерт/i.test(name)) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

function classify(name) {
  const n = name.toLowerCase();
  if (/черен пипер|бял пипер|канела|стевия|сол\b|подправ|риган|копър|босилек/.test(n)) return 'SEASON';
  if (/^лимон|^лайм/.test(n)) return 'SEASON';
  if (/\bмед\b|захар|мелас/.test(n)) return 'SWEET';
  if (/ябълк|боровин|ягод|портокал|бanana|банан|плод|грозде|круша|череш|нектарин/.test(n)) return 'FRUIT';
  if (/протеин|суроват/.test(n)) return 'PRO_POWDER';
  if (/зехтин|олио/.test(n)) return 'FAT_OIL';
  if (/фъстъчено масло/.test(n)) return 'FAT_PB';
  if (/бадем|орех|кашу|чия|семе|фъстък|лешник/.test(n) || (n.includes('ядк') && !n.includes('овес'))) return 'FAT_NUTS';
  if (/овес/.test(n)) return 'CARB_OATS';
  if (/ориз|киноа|булгур|макарон|паста|елда|гриз|тортила|хляб|картоф|батат|сладък/.test(n)) return 'CARB_GRAIN';
  if (/нахут|боб|леща/.test(n)) return 'CARB_LEGUME';
  if (/пиле|пилеш|свин|говед|месо|кайма|пържол|шишч|бутче|пуеш|телеш|постно/.test(n)) return 'PRO_MEAT';
  if (/риба|сьомга|тон|треска|пъстърва/.test(n)) return 'PRO_FISH';
  if (/яйц/.test(n)) return 'PRO_EGG';
  if (/кашкавал|сирен/.test(n) && !/салат/.test(n)) return 'PRO_CHEESE';
  if (/извара|кисело мляко|скир|мляко/.test(n)) return 'PRO_DAIRY';
  if (/салат|домат|крастав|чушк|броколи|морков|спанак|тиквич|лук|айсберг|зеле|асперж|гъби|тиква|карфиол|репич|маруля/.test(n)) return 'VEG';
  return 'PRO_MEAT';
}

function profileFor(role) {
  return NUTRITION[role] || NUTRITION.PRO_MEAT;
}

function isMainMeal(type) {
  return type === 'Хранене 2' || type === 'Хранене 4';
}
function isSnack(type) {
  return type === 'Хранене 3' || type === 'Хранене 5';
}
function isBreakfast(type) {
  return type === 'Хранене 1';
}

/** Keep combinations that make culinary + macro sense */
function curateProducts(names, mealType) {
  let list = [...names];

  if (isMainMeal(mealType)) {
    list = list.filter((n) => {
      const r = classify(n);
      if (r === 'SWEET') return false;
      if (r === 'PRO_DAIRY' || r === 'PRO_POWDER' || r === 'FAT_NUTS' || r === 'FAT_PB') return false;
      return true;
    });
    const hasProtein = list.some((n) => ['PRO_MEAT', 'PRO_FISH', 'PRO_EGG'].includes(classify(n)));
    const hasCarb = list.some((n) =>
      ['CARB_GRAIN', 'CARB_OATS', 'CARB_LEGUME', 'CARB_BREAD', 'FRUIT'].includes(classify(n))
    );
    const hasVeg = list.some((n) => classify(n) === 'VEG');
    const isEggMeal = list.some((n) => /яйц/.test(n.toLowerCase()));

    if (hasProtein && !hasCarb) {
      if (isEggMeal) list.push('ръжен хляб');
      else list.push('ориз (бял)');
    }
    if (hasProtein && !hasVeg) list.push('салата');
    // max 3 veg + 1 protein + 1 carb + oil
    const proteins = list.filter((n) => ['PRO_MEAT', 'PRO_FISH', 'PRO_EGG'].includes(classify(n)));
    const carbs = list.filter((n) => ['CARB_GRAIN', 'CARB_OATS', 'CARB_LEGUME', 'CARB_BREAD', 'FRUIT'].includes(classify(n)));
    const vegs = list.filter((n) => classify(n) === 'VEG');
    const fats = list.filter((n) => ['FAT_OIL', 'SEASON'].includes(classify(n)));
    list = [
      ...proteins.slice(0, 1),
      ...carbs.slice(0, 1),
      ...vegs.slice(0, 3),
      ...(fats.some((n) => classify(n) === 'FAT_OIL') ? fats.filter((n) => classify(n) === 'FAT_OIL').slice(0, 1) : ['зехтин']),
      ...fats.filter((n) => classify(n) === 'SEASON').slice(0, 1),
    ];
  }

  if (isSnack(mealType)) {
    list = list.filter((n) => {
      const r = classify(n);
      return ['PRO_DAIRY', 'PRO_CHEESE', 'PRO_POWDER', 'FAT_NUTS', 'FAT_PB', 'FRUIT', 'SWEET', 'CARB_GRAIN'].includes(r);
    });
    const hasDairy = list.some((n) => ['PRO_DAIRY', 'PRO_CHEESE'].includes(classify(n)));
    const hasProtein = list.some((n) => classify(n) === 'PRO_POWDER');
    const hasNuts = list.some((n) => ['FAT_NUTS', 'FAT_PB'].includes(classify(n)));
    const hasFruit = list.some((n) => classify(n) === 'FRUIT');

    if (!hasDairy && !hasProtein) list.unshift('кисело мляко');
    if (!hasNuts && !hasFruit && !hasProtein) list.push('бадеми');
    // no oil in snacks unless peanut butter
    list = list.filter((n) => classify(n) !== 'FAT_OIL');
    list = list.slice(0, 4);
  }

  if (isBreakfast(mealType)) {
    list = list.filter((n) => {
      const r = classify(n);
      return !['PRO_MEAT', 'PRO_FISH'].includes(r) || classify(n) === 'PRO_EGG' || classify(n) === 'VEG';
    });
    const roles = list.map(classify);
    const hasBase = roles.some((r) => ['CARB_OATS', 'CARB_BREAD', 'PRO_EGG'].includes(r));
    if (!hasBase) list.unshift('овесени ядки');
    if (!list.some((n) => classify(n) === 'FRUIT') && list.some((n) => classify(n) === 'CARB_OATS')) {
      list.push('боровинки');
    }
    list = list.filter((n) => classify(n) !== 'FAT_OIL' || list.filter((x) => classify(x) === 'FAT_OIL').indexOf(n) === 0);
  }

  return [...new Map(list.map((n) => [n.toLowerCase(), n])).values()];
}

function allocateGrams(products, mealType, macros, hasDessert) {
  const target = {
    p: Number(macros?.protein) || 0,
    c: Number(macros?.carbs) || 0,
    f: Number(macros?.fats) || 0,
  };
  if (hasDessert) {
    target.p = Math.max(0, target.p - 2);
    target.c = Math.max(0, target.c - 14);
    target.f = Math.max(0, target.f - 12);
  }

  const items = products.map((name) => ({
    name,
    role: classify(name),
    profile: profileFor(classify(name)),
    grams: 0,
  }));

  let rem = { ...target };

  for (const it of items.filter((i) => i.role === 'SEASON')) {
    it.grams = 10;
    const m = contrib(it.grams, it.profile);
    rem.p = Math.max(0, rem.p - m.p);
    rem.c = Math.max(0, rem.c - m.c);
    rem.f = Math.max(0, rem.f - m.f);
  }

  const vegItems = items.filter((i) => i.role === 'VEG');
  const vegPortion = vegItems.length >= 3 ? 80 : 100;
  for (const it of vegItems) {
    it.grams = vegPortion;
    const m = contrib(it.grams, it.profile);
    rem.p = Math.max(0, rem.p - m.p);
    rem.c = Math.max(0, rem.c - m.c);
    rem.f = Math.max(0, rem.f - m.f);
  }

  for (const it of items.filter((i) => i.role === 'PRO_POWDER')) {
    it.grams = 30;
    const m = contrib(it.grams, it.profile);
    rem.p = Math.max(0, rem.p - m.p);
    rem.c = Math.max(0, rem.c - m.c);
    rem.f = Math.max(0, rem.f - m.f);
  }

  for (const it of items.filter((i) => i.role === 'SWEET')) {
    it.grams = 10;
    rem.c = Math.max(0, rem.c - contrib(it.grams, it.profile).c);
  }

  for (const it of items.filter((i) => i.role === 'FRUIT')) {
    const g = round10(Math.min(120, Math.max(80, rem.c * 0.55 / (it.profile.c / 100))));
    it.grams = g || 100;
    const m = contrib(it.grams, it.profile);
    rem.p = Math.max(0, rem.p - m.p);
    rem.c = Math.max(0, rem.c - m.c);
    rem.f = Math.max(0, rem.f - m.f);
  }

  for (const it of items.filter((i) => i.role === 'PRO_DAIRY' || i.role === 'PRO_CHEESE')) {
    if (isSnack(mealType)) it.grams = it.role === 'PRO_CHEESE' ? 50 : 200;
    else if (isBreakfast(mealType)) it.grams = 200;
    else it.grams = 150;
    const m = contrib(it.grams, it.profile);
    rem.p = Math.max(0, rem.p - m.p);
    rem.c = Math.max(0, rem.c - m.c);
    rem.f = Math.max(0, rem.f - m.f);
  }

  for (const it of items.filter((i) => i.role === 'CARB_OATS')) {
    it.grams = round10(Math.min(100, Math.max(60, rem.c * 0.5 / (it.profile.c / 100))));
    const m = contrib(it.grams, it.profile);
    rem.p = Math.max(0, rem.p - m.p);
    rem.c = Math.max(0, rem.c - m.c);
    rem.f = Math.max(0, rem.f - m.f);
  }

  for (const it of items.filter((i) => i.role === 'CARB_BREAD')) {
    it.grams = 50;
    rem.c = Math.max(0, rem.c - contrib(it.grams, it.profile).c);
  }

  const proItems = items.filter((i) => ['PRO_MEAT', 'PRO_FISH', 'PRO_EGG'].includes(i.role));
  if (proItems.length && rem.p > 0) {
    const gEach = round10((rem.p / proItems.length) / (proItems[0].profile.p / 100));
    const grams = Math.min(250, Math.max(100, gEach || 150));
    for (const it of proItems) {
      it.grams = grams;
      const m = contrib(it.grams, it.profile);
      rem.p = Math.max(0, rem.p - m.p);
      rem.c = Math.max(0, rem.c - m.c);
      rem.f = Math.max(0, rem.f - m.f);
    }
  }

  const carbItems = items.filter((i) => i.role === 'CARB_GRAIN' || i.role === 'CARB_LEGUME');
  if (carbItems.length && rem.c > 0) {
    const gEach = round10((rem.c / carbItems.length) / (carbItems[0].profile.c / 100));
    const grams = Math.min(250, Math.max(80, gEach || 150));
    for (const it of carbItems) {
      it.grams = grams;
      const m = contrib(it.grams, it.profile);
      rem.c = Math.max(0, rem.c - m.c);
      rem.p = Math.max(0, rem.p - m.p);
      rem.f = Math.max(0, rem.f - m.f);
    }
  }

  for (const it of items.filter((i) => i.role === 'FAT_NUTS' || i.role === 'FAT_PB')) {
    const g = Math.min(30, Math.max(10, round10(rem.f / (it.profile.f / 100)) || 20));
    it.grams = g;
    const m = contrib(it.grams, it.profile);
    rem.p = Math.max(0, rem.p - m.p);
    rem.c = Math.max(0, rem.c - m.c);
    rem.f = Math.max(0, rem.f - m.f);
  }

  for (const it of items.filter((i) => i.role === 'FAT_OIL')) {
    let g = round10(Math.max(rem.f, 6) / (it.profile.f / 100));
    if (target.f >= 30 && g < 15) g = 20;
    if (target.f >= 45 && g < 20) g = 20;
    it.grams = Math.min(25, Math.max(10, g || 10));
    rem.f = Math.max(0, rem.f - contrib(it.grams, it.profile).f);
  }

  // Macro fine-tune: bump carbs/protein if short
  let actual = sumContrib(items.filter((i) => i.grams > 0));
  const carbTune = items.filter((i) => ['CARB_GRAIN', 'CARB_LEGUME', 'CARB_OATS'].includes(i.role) && i.grams > 0);
  if (carbTune.length && actual.c < target.c * 0.88) {
    const deficit = target.c - actual.c;
    for (const it of carbTune) {
      it.grams = round10(Math.min(280, it.grams + deficit / carbTune.length / (it.profile.c / 100)));
    }
  }
  actual = sumContrib(items.filter((i) => i.grams > 0));
  const proTune = items.filter((i) => ['PRO_MEAT', 'PRO_FISH', 'PRO_EGG'].includes(i.role) && i.grams > 0);
  if (proTune.length && actual.p < target.p * 0.88) {
    const deficit = target.p - actual.p;
    for (const it of proTune) {
      it.grams = round10(Math.min(280, it.grams + deficit / proTune.length / (it.profile.p / 100)));
    }
  }
  actual = sumContrib(items.filter((i) => i.grams > 0));
  const oilItems = items.filter((i) => i.role === 'FAT_OIL' && i.grams > 0);
  if (oilItems.length && actual.f < target.f * 0.85) {
    const deficit = target.f - actual.f;
    oilItems[0].grams = round10(Math.min(25, oilItems[0].grams + deficit / (oilItems[0].profile.f / 100)));
  }

  // Balance calories by scaling protein + carb portions (keep veg/oil stable)
  const targetKcal = macrosToCalories(target);
  const tunable = items.filter((i) =>
    ['PRO_MEAT', 'PRO_FISH', 'PRO_EGG', 'CARB_GRAIN', 'CARB_LEGUME', 'CARB_OATS', 'PRO_DAIRY', 'PRO_CHEESE'].includes(i.role) && i.grams > 0
  );
  actual = sumContrib(items.filter((i) => i.grams > 0));
  let actualKcal = macrosToCalories(actual);

  if (targetKcal > 0 && actualKcal > 0 && Math.abs(actualKcal - targetKcal) > 35 && tunable.length) {
    const factor = targetKcal / actualKcal;
    for (const it of tunable) {
      const maxG = ['CARB_GRAIN', 'CARB_LEGUME', 'CARB_OATS'].includes(it.role) ? 280 : 260;
      const minG = ['PRO_DAIRY', 'PRO_CHEESE'].includes(it.role) ? 100 : 80;
      it.grams = round10(Math.min(maxG, Math.max(minG, it.grams * factor)));
    }
  }

  for (const it of items) {
    if (it.grams > 0) it.grams = round10(it.grams);
    if (it.role === 'SEASON') it.grams = 10;
  }

  return items.filter((i) => i.grams > 0);
}

function fixMeal(meal) {
  if (!meal?.description || meal.type === 'Свободно хранене' || meal.type === 'Напитка') return false;

  const parsed = parseProducts(meal.description);
  if (!parsed.length) return false;

  const curated = curateProducts(parsed, meal.type);
  const hasDessert = meal.dessert === true || (typeof meal.dessert === 'object' && meal.dessert);
  const items = allocateGrams(curated, meal.type, meal.macros, hasDessert);
  if (!items.length) return false;

  meal.description = items.map((i) => `• ${i.name} ${i.grams}g`).join('\n');
  let total = items.reduce((s, i) => s + i.grams, 0);
  if (hasDessert) total += DESSERT_GRAMS;
  meal.weight = `${total}г`;
  return true;
}

function fixPlan(plan) {
  let n = 0;
  for (const day of Object.values(plan.weekPlan || {})) {
    for (const meal of day.meals || []) {
      if (fixMeal(meal)) n++;
    }
  }
  return n;
}

function analyzePlan(plan, clientName) {
  const rows = [];
  for (const [dk, day] of Object.entries(plan.weekPlan || {})) {
    for (const meal of day.meals || []) {
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
      const items = [];
      for (const line of (meal.description || '').split('\n')) {
        const m = line.match(/^•?\s*(.+?)\s+(\d+)g$/i);
        if (!m) continue;
        const role = classify(m[1]);
        items.push({ name: m[1], grams: +m[2], role });
      }
      const calc = sumContrib(items.map((i) => ({ grams: i.grams, profile: profileFor(i.role) })));
      const target = {
        p: Number(meal.macros?.protein) || 0,
        c: Number(meal.macros?.carbs) || 0,
        f: Number(meal.macros?.fats) || 0,
      };
      const hasDessert = meal.dessert === true || (typeof meal.dessert === 'object' && meal.dessert);
      if (hasDessert && meal.dessert?.macros) {
        target.p = Math.max(0, target.p - (meal.dessert.macros.protein || 0));
        target.c = Math.max(0, target.c - (meal.dessert.macros.carbs || 0));
        target.f = Math.max(0, target.f - (meal.dessert.macros.fats || 0));
      }
      const targetKcal = macrosToCalories(target);
      const calcKcal = macrosToCalories(calc);
      const kcalDiff = Math.abs(calcKcal - targetKcal);
      rows.push({
        clientName, dk, type: meal.type, target, calc, kcalDiff,
        items: items.map((i) => `${i.name} ${i.grams}g`).join(', '),
      });
    }
  }
  return rows;
}

async function restoreOriginalDescriptions(client, backupPath) {
  try {
    const raw = await readFile(backupPath, 'utf8');
    const backup = JSON.parse(raw);
    const origPlan = backup.client?.plan;
    if (!origPlan?.weekPlan) return false;
    for (const [dk, day] of Object.entries(client.plan.weekPlan || {})) {
      const origDay = origPlan.weekPlan[dk];
      if (!origDay?.meals) continue;
      for (const meal of day.meals || []) {
        const origMeal = origDay.meals.find((m) => m.type === meal.type);
        if (origMeal?.description) meal.description = origMeal.description;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function fetchClient(id) {
  const res = await fetch(`${WORKER_URL}/api/admin/get-client-data?clientId=${id}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'fetch failed');
  return data.client;
}

async function updatePlan(id, plan) {
  const res = await fetch(`${WORKER_URL}/api/admin/update-client-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: id, plan }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'update failed');
}

async function main() {
  const report = [];
  for (const { id, name, backup } of CLIENTS) {
    const client = await fetchClient(id);
    if (!client.plan) {
      console.log(`⚠ ${name}: no plan`);
      continue;
    }
    if (backup) await restoreOriginalDescriptions(client, backup);
    const n = fixPlan(client.plan);
    await updatePlan(id, client.plan);
    const rows = analyzePlan(client.plan, name);
    report.push(...rows);
    const sample = client.plan.weekPlan.day1.meals.find((m) => m.type === 'Хранене 2');
    console.log(`✓ ${name}: ${n} meals`);
    if (sample) {
      console.log(`  Обяд: ${sample.description?.replace(/\n/g, ' | ')}`);
      const r = rows.find((x) => x.dk === 'day1' && x.type === 'Хранене 2');
      if (r) {
        console.log(
          `  Макроси: цел P${r.target.p}/C${r.target.c}/F${r.target.f} → изчисл. P${Math.round(r.calc.p)}/C${Math.round(r.calc.c)}/F${Math.round(r.calc.f)} (Δkcal ${Math.round(r.kcalDiff)})`
        );
      }
    }
    console.log('');
  }

  const avgKcalDiff = report.reduce((s, r) => s + r.kcalDiff, 0) / report.length;
  console.log(`Средно отклонение калории: ${Math.round(avgKcalDiff)} kcal (${report.length} ястия)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
