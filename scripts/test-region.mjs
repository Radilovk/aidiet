#!/usr/bin/env node
/**
 * Къде е клиентът (nutrition-engine/region.js): сезонът по полукълбото,
 * тропиците без сезон и кухнята — българските ястия са у дома за Балканите
 * и за българоговорящите, за другите идват по-рядко, но не изчезват.
 */
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';
import { calculateBMR, calculateSafeDeficit, calculateActivityTDEE } from '../energy.js';
import { computeIntakeTarget } from '../step1-deterministic.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { buildNutritionPlan } from '../nutrition-engine/index.js';
import { regionOf, seasonFor } from '../nutrition-engine/region.js';
import { DISHES_BY_ID } from '../nutrition-engine/knowledge.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

// ── Регионът ──
ok(JSON.stringify(regionOf({})) === JSON.stringify({ country: '', lang: 'bg', climate: 'north', localCuisine: true }), 'без данни: България, български');
ok(regionOf({ country: 'au', lang: 'en' }).climate === 'south' && !regionOf({ country: 'AU', lang: 'en' }).localCuisine, 'Австралия: южно полукълбо, друга кухня');
ok(regionOf({ country: 'DE', lang: 'bg' }).localCuisine, 'българин в Германия: българската кухня остава');
ok(regionOf({ country: 'BG', lang: 'en' }).localCuisine, 'чужденец в България: местната кухня');
ok(regionOf({ country: 'GR', lang: 'de' }).localCuisine, 'Балканите: кухнята е позната');
ok(regionOf({ country: 'SG' }).climate === 'tropical', 'Сингапур: тропици');
const jan = new Date(2027, 0, 15);
const jul = new Date(2027, 6, 15);
ok(seasonFor(jan, 'north') === 'winter' && seasonFor(jul, 'north') === 'summer', 'север: януари зима, юли лято');
ok(seasonFor(jan, 'south') === 'summer' && seasonFor(jul, 'south') === 'winter', 'юг: януари лято, юли зима');
ok(seasonFor(jan, 'tropical') === null, 'тропици: без сезон');

// ── Менюто ──
function intakeOf(data) {
  const { tdee } = calculateActivityTDEE(calculateBMR(data), data);
  const min = data.gender === 'Мъж' ? 1500 : 1200;
  return Math.max(min, computeIntakeTarget(tdee, data.goal, calculateSafeDeficit(tdee, data)) || tdee);
}
function plan(profile, extra, seed, date) {
  const data = structuredClone({ ...profile, ...extra });
  enrichUserDataEngineContext(data);
  return buildNutritionPlan(data, { kcal: intakeOf(data), seed, date });
}
const dishIds = res => Object.values(res.weekPlan).flatMap(d => d.meals).map(m => m.dishId).filter(Boolean);
const bgCount = res => dishIds(res).filter(id => DISHES_BY_ID.get(id)?.cuisine === 'bg').length;
const DISTANT = new Set(['asia', 'latam', 'india', 'mideast']);
const distantCount = res => dishIds(res).filter(id => DISTANT.has(DISHES_BY_ID.get(id)?.cuisine)).length;

let home = 0;
let abroad = 0;
let distantHome = 0;
let distantAbroad = 0;
let mealsAbroad = 0;
for (const profile of PROFILES) {
  for (const seed of ['a', 'b', 'c']) {
    const bg = plan(profile, {}, `${profile.id}:${seed}`, jul);
    const de = plan(profile, { lang: 'de', country: 'DE' }, `${profile.id}:${seed}`, jul);
    home += bgCount(bg);
    abroad += bgCount(de);
    distantHome += distantCount(bg);
    distantAbroad += distantCount(de);
    mealsAbroad += dishIds(de).length;
    const kcalOff = Object.values(de.weekPlan).filter(d => d.energy && Math.abs(d.dailyTotals.calories - d.energy.kcal) > d.energy.kcal * 0.1
      && d.meals.every(m => m.type !== 'Свободно хранене'));
    ok(kcalOff.length === 0, `${profile.id}/${seed} (DE): калориите са в целта`);
  }
}
console.log(`Българска кухня: у дома ${home}, в Германия ${abroad} (от ${mealsAbroad} хранения)`);
ok(abroad < home * 0.6, `извън дома ѝ българските ястия са по-редки (${abroad} < 60% от ${home})`);
ok(abroad > 0, 'и не изчезват');
console.log(`Далечни кухни: у дома ${distantHome}, в Германия ${distantAbroad}`);
ok(distantHome < distantAbroad, `у дома далечните кухни са по-редки (${distantHome} < ${distantAbroad})`);
ok(distantHome > 0, 'и пак ги има — за разнообразие');
ok(home >= 30, `у дома българската кухня не е изместена от разширения каталог (${home})`);

// Сезонът: юли в Австралия е зима — няма само-летни ястия (таратор, шопска).
{
  const summerOnly = id => (DISHES_BY_ID.get(id)?.seasonsOnly || []).length && !DISHES_BY_ID.get(id).seasonsOnly.includes('winter');
  let auSummer = 0;
  for (const profile of PROFILES) {
    const au = plan(profile, { lang: 'en', country: 'AU' }, profile.id, jul);
    ok(au.policy.season === 'winter', `${profile.id}: юли в Австралия е зима`);
    auSummer += dishIds(au).filter(summerOnly).length;
  }
  ok(auSummer === 0, `австралийската зима — без летни ястия (${auSummer})`);
  const sg = plan(PROFILES[0], { lang: 'en', country: 'SG' }, 'sg', jan);
  ok(sg.policy.season === null && Object.keys(sg.weekPlan).length === 7, 'тропици: планът се сглобява без сезон');
}

console.log(`\n=== region: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
