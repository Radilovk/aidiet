#!/usr/bin/env node
/**
 * Fix specific client plans: parse products, assign sensible grams, round to 10g.
 */

const WORKER_URL = process.env.WORKER_URL || 'https://aidiet.radilov-k.workers.dev';

const CLIENTS = [
  { id: 'client_1782913756358_awvofd', name: 'Алекс' },
  { id: 'client_1783078163805_gkdo7', name: 'Валентин' },
  { id: 'client_1782999217236_7zvae9', name: 'Мария Башева' },
  { id: 'client_1781620013349_axcjro', name: 'Виктор' },
  { id: 'client_1781138769382_8b8mu', name: 'Kamen' },
];

const DESSERT_GRAMS = 30;

function round10(g) {
  if (g == null) return null;
  return Math.max(10, Math.round(g / 10) * 10);
}

function parseProducts(description) {
  const products = [];
  const seen = new Set();
  for (const line of String(description || '').split('\n')) {
    let raw = line.replace(/^[•\-\*]\s*/, '').trim();
    if (!raw || /десерт\s*:/i.test(raw)) continue;

    let name = raw
      .replace(/\s+\d+(?:[.,]\d+)?\s*(?:g|г)\b.*$/i, '')
      .replace(/\s*\(\d+\s*бр\.?[^)]*\)/gi, '')
      .replace(/\([^)]*(?:по желание|включена в макрос)[^)]*\)/gi, '')
      .replace(/\s*[—\-].*$/, '')
      .replace(/,\s*(?:приготв|наряз|печен|варен|на пара|задуш|запеч|маринов|овкус|сварен|без|или\s+).*/i, '')
      .replace(/^една супена лъжица\s+/i, '')
      .replace(/\.\s*$/, '')
      .trim();

    if (!name || /^десерт/i.test(name)) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      products.push(name);
    }
  }
  return products;
}

function isSeasoning(name) {
  const n = name.toLowerCase();
  return /черен пипер|бял пипер|канела|стевия|сол\b|подправ|риган|копър|босилек|сумак/.test(n);
}

function inferGrams(name, mealType, macros) {
  const n = name.toLowerCase();
  const p = Number(macros?.protein) || 0;
  const c = Number(macros?.carbs) || 0;
  const f = Number(macros?.fats) || 0;
  const isSnack = mealType === 'Хранене 3' || mealType === 'Хранене 5';
  const isBreakfast = mealType === 'Хранене 1';
  const isMain = mealType === 'Хранене 2' || mealType === 'Хранене 4';

  if (isSeasoning(n)) return null;
  if (/^лимон|^лайм/.test(n)) return 10;

  if (/протеин|суроват/.test(n)) return 30;

  if (/овес/.test(n)) return 80;

  if (/зехтин|олио/.test(n)) return f >= 25 ? 20 : 10;
  if (/фъстъчено масло|масло/.test(n)) return 20;
  if (/бадем|орех|кашу|чия|семе|фъстък|лешник/.test(n) || (n.includes('ядк') && !n.includes('овес'))) return isSnack ? 30 : 20;

  if (/мед/.test(n)) return 10;

  if (/ябълк|боровин|ягод|портокал|бanana|банан|плод|грозде|круша|череш/.test(n)) return 100;

  if (isSnack || isBreakfast) {
    if (/извара|кисело мляко|скир/.test(n)) return 200;
    if (/кашкавал|сирен/.test(n) && !/салат/.test(n)) return 50;
    if (/^мляко\b|^мляко /.test(n) || (n.includes('мляко') && !n.includes('кисело'))) return 200;
  }

  if (isBreakfast) {
    if (/хляб|тортила/.test(n)) return 50;
    if (/яйц/.test(n)) return 120;
  }

  if (/пиле|пилеш|свин|говед|месо|риба|сьомга|тон|пуеш|яйц|яйца|кайма|пържол|шишч/.test(n)) {
    if (p >= 95) return 200;
    if (p >= 70) return 180;
    if (p >= 50) return 170;
    if (p >= 35) return 150;
    return 120;
  }

  if (/ориз|картоф|батат|сладък|нахут|киноа|булгур|макарон|паста|елда|боб|леща/.test(n)) {
    if (c >= 95) return 200;
    if (c >= 75) return 180;
    if (c >= 55) return 150;
    return 120;
  }

  if (/хляб|тортила/.test(n)) return 50;

  if (/салат|домат|крастав|чушк|броколи|морков|спанак|тиквич|лук|айсберг|зеле|асперж|гъби|тиква|карфиол|репич|маруля/.test(n)) {
    return 100;
  }

  if (/авокадо/.test(n)) return 80;

  if (/кисело мляко|скир|извара/.test(n)) return 150;
  if (/мляко/.test(n)) return 200;

  return 100;
}

function fixMealDescription(meal) {
  if (!meal?.description || meal.type === 'Свободно хранене' || meal.type === 'Напитка') {
    return false;
  }

  const products = parseProducts(meal.description);
  if (!products.length) return false;

  const macros = meal.macros || {};
  const items = [];
  for (const name of products) {
    const grams = round10(inferGrams(name, meal.type, macros));
    if (grams != null) items.push({ name, grams });
  }

  if (!items.length) return false;

  meal.description = items.map(i => `• ${i.name} ${i.grams}g`).join('\n');
  let total = items.reduce((s, i) => s + i.grams, 0);
  if (meal.dessert && FIXED_DESSERT_CHECK(meal)) total += DESSERT_GRAMS;
  meal.weight = `${total}г`;
  return true;
}

function FIXED_DESSERT_CHECK(meal) {
  return meal.dessert === true || (typeof meal.dessert === 'object' && meal.dessert);
}

function fixPlan(plan) {
  let count = 0;
  for (const day of Object.values(plan.weekPlan || {})) {
    for (const meal of day.meals || []) {
      if (fixMealDescription(meal)) count++;
    }
  }
  return count;
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
}

function validatePlan(plan, name) {
  const bad = [];
  for (const [dk, day] of Object.entries(plan.weekPlan || {})) {
    for (const meal of day.meals || []) {
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
      for (const line of (meal.description || '').split('\n')) {
        const m = line.match(/(\d+)\s*g\b/i);
        if (!m) continue;
        const g = parseInt(m[1], 10);
        if (g % 10 !== 0) bad.push(`${name} ${dk} ${meal.type}: ${line.trim()} (${g} not round 10)`);
        if (g > 50 && /пипер|канела|стевия/.test(line.toLowerCase())) bad.push(`${name}: spice ${line}`);
      }
    }
  }
  return bad;
}

async function main() {
  console.log('Fixing client plans — round to 10g\n');
  for (const { id, name } of CLIENTS) {
    try {
      const client = await fetchClient(id);
      if (!client.plan) {
        console.log(`⚠ ${name}: no plan`);
        continue;
      }
      const before = parseProducts(client.plan.weekPlan?.day1?.meals?.find(m => m.type === 'Хранене 2')?.description || '');
      const n = fixPlan(client.plan);
      const issues = validatePlan(client.plan, name);
      await updatePlan(id, client.plan);
      const sampleMeal = client.plan.weekPlan?.day1?.meals?.find(m => m.type === 'Хранене 2');
      console.log(`✓ ${name}: ${n} meals fixed`);
      if (sampleMeal) {
        console.log(`  Sample Хранене 2 (${sampleMeal.weight}):`);
        for (const line of (sampleMeal.description || '').split('\n')) console.log(`    ${line}`);
      }
      if (issues.length) {
        console.log(`  ⚠ ${issues.length} validation notes:`);
        issues.slice(0, 3).forEach(i => console.log(`    ${i}`));
      }
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
