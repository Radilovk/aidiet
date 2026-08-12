/**
 * Protocol engine — deterministic menu generation (orchestrator pipeline).
 * AI-free core: profile → safety → targets → filter → templates → build → validate.
 */

import { MEAL_TYPE_TIMING } from './food-catalog-data.js';
import { resolveCatalogDietProfile } from './diet-registry.js';
import {
  LIBRARY_ORCHESTRATOR,
  LIBRARY_PROTOCOL_RULES,
  filterLibraryFoodsByDiet,
  resolveLibraryFoodById,
} from './nutrition-library-bridge.js';
import {
  slotTargetsFromTemplate,
  pickReadyMealsForSlot,
  foodsForSlotAssembly,
  getMealDistribution,
  getExchangeMap,
} from './meal-template-engine.js';

const SLOT_ORDER = ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5'];

/** Map NutriPlan client signals → library diet profile id */
export function resolveLibraryDietProfile(ctx = {}) {
  const text = [
    ctx.dietaryModifier,
    ...(Array.isArray(ctx.dietPreference) ? ctx.dietPreference : ctx.dietPreference ? [ctx.dietPreference] : []),
    ctx.dietDislike,
  ].filter(Boolean).join(' ').toLowerCase();

  const flags = resolveCatalogDietProfile(ctx);
  if (flags.vegan) return 'vegan';
  if (flags.vegetarian) return 'vegetarian';
  if (flags.pescatarian) return 'pescatarian';
  if (flags.keto) return 'keto';
  if (/dash|хипертон|кръвно/i.test(text)) return 'dash';
  if (/paleo|палео/i.test(text)) return 'paleo';
  if (/fodmap|ibs|подуване/i.test(text)) return 'low_fodmap';
  if (/висок\s*протеин|high protein/i.test(text)) return 'high_protein';
  if (/без\s*глутен|gluten/i.test(text)) return 'gluten_free';
  if (/без\s*млеч|dairy.?free|лактоз/i.test(text)) return 'dairy_free';
  if (/средиземномор|mediterr/i.test(text)) return 'mediterranean';
  if (/нисковъглехидрат|low carb/i.test(text)) return 'low_carb';
  if (/противовъзпалител|anti.?inflam/i.test(text)) return 'anti_inflammatory';
  return 'balanced';
}

/** Mifflin-St Jeor BMR + activity → daily kcal target */
export function deriveEnergyTargets(profile = {}) {
  const weight = Number(profile.weightKg || profile.weight_kg || 70);
  const height = Number(profile.heightCm || profile.height_cm || 170);
  const age = Number(profile.age || 35);
  const sex = String(profile.sex || 'female').toLowerCase();
  const activity = String(profile.activityLevel || profile.activity_level || 'moderate').toLowerCase();

  const bmr = sex.startsWith('m')
    ? 10 * weight + 6.25 * height - 5 * age + 5
    : 10 * weight + 6.25 * height - 5 * age - 161;

  const mult = {
    sedentary: 1.2, light: 1.375, moderate: 1.55,
    active: 1.725, very_active: 1.9, athlete: 2.0,
  }[activity] || 1.55;

  let tdee = Math.round(bmr * mult);
  const goal = String(profile.goal || profile.goal_id || 'maintenance').toLowerCase();
  if (/loss|отслаб|deficit|слаб/i.test(goal)) tdee = Math.round(tdee * 0.85);
  if (/gain|muscle|набир|surplus|хипертроф/i.test(goal)) tdee = Math.round(tdee * 1.12);

  const proteinG = Math.round(weight * (/high_protein|muscle|athlete/i.test(goal) ? 1.8 : 1.4));
  const fatG = Math.round((tdee * 0.28) / 9);
  const carbG = Math.max(0, Math.round((tdee - proteinG * 4 - fatG * 9) / 4));

  return { kcal: tdee, protein_g: proteinG, carbs_g: carbG, fat_g: fatG, bmr: Math.round(bmr), tdee: Math.round(bmr * mult) };
}

function scaleSlotTargets(baseTargets, dailyKcal, slotKcal) {
  if (!baseTargets || !slotKcal) return baseTargets;
  const ratio = slotKcal / (baseTargets.kcal || 1);
  return {
    kcal: Math.round(slotKcal),
    protein: Math.round((baseTargets.protein || 0) * ratio),
    carbs: Math.round((baseTargets.carbs || 0) * ratio),
    fats: Math.round((baseTargets.fats || 0) * ratio),
  };
}

function mealFromReady(ready, slotLabel) {
  const lines = (ready.ingredients || []).map(ing => {
    const food = resolveLibraryFoodById(ing.food_id);
    const name = food?.name_bg || ing.food_id;
    return { name, grams: ing.grams, food_id: ing.food_id };
  });
  return {
    slot: slotLabel,
    name: ready.name_bg,
    source: 'ready_meal',
    meal_id: ready.id,
    kcal: ready.kcal,
    protein_g: ready.protein_g,
    carbs_g: ready.carbs_g,
    fat_g: ready.fat_g,
    items: lines,
  };
}

/** Component assembly when no ready meal — pick top foods per allowed group */
function assembleMealFromFoods(slotLabel, targets, foods, seed = 0) {
  const groups = slotTargetsFromTemplate(slotLabel)?.allowedGroups || [];
  const picked = [];
  const usedGroups = new Set();
  const pool = [...foods].sort((a, b) => {
    const sa = groups.indexOf(a.group_id);
    const sb = groups.indexOf(b.group_id);
    return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
  });

  for (const food of pool) {
    if (!groups.includes(food.group_id)) continue;
    if (usedGroups.has(food.group_id) && !['vegetables', 'fruits'].includes(food.group_id)) continue;
    picked.push({ name: food.name_bg, grams: food.portion_g, food_id: food.id });
    usedGroups.add(food.group_id);
    if (picked.length >= 4) break;
  }

  let kcal = 0; let protein_g = 0; let carbs_g = 0; let fat_g = 0;
  for (const p of picked) {
    const f = resolveLibraryFoodById(p.food_id);
    if (!f) continue;
    const scale = p.grams / f.portion_g;
    kcal += f.kcal * scale;
    protein_g += f.protein_g * scale;
    carbs_g += f.carbs_g * scale;
    fat_g += f.fat_g * scale;
  }

  return {
    slot: slotLabel,
    name: `Ястие ${slotLabel}`,
    source: 'assembled',
    kcal: Math.round(kcal),
    protein_g: Math.round(protein_g * 10) / 10,
    carbs_g: Math.round(carbs_g * 10) / 10,
    fat_g: Math.round(fat_g * 10) / 10,
    items: picked,
    targets,
    seed,
  };
}

function buildMealForSlot(slotLabel, dietProfile, dailyTargets, distributionIdx, activeSlots, seed = 0) {
  const slotShare = activeSlots[distributionIdx] || (1 / activeSlots.length);
  const slotKcal = Math.round(dailyTargets.kcal * slotShare);
  const baseTpl = slotTargetsFromTemplate(slotLabel);
  const targets = scaleSlotTargets(
    { kcal: baseTpl?.kcal, protein: baseTpl?.protein_target_g, carbs: baseTpl?.carb_target_g, fats: baseTpl?.fat_target_g },
    dailyTargets.kcal,
    slotKcal,
  );

  const readyCandidates = pickReadyMealsForSlot(slotLabel, dietProfile, 5);
  if (readyCandidates.length) {
    const idx = seed % readyCandidates.length;
    return mealFromReady(readyCandidates[idx], slotLabel);
  }

  const { foods } = foodsForSlotAssembly(slotLabel, dietProfile);
  return assembleMealFromFoods(slotLabel, targets, foods, seed);
}

function validateDailyMenu(meals, targets) {
  const totals = meals.reduce((a, m) => ({
    kcal: a.kcal + (m.kcal || 0),
    protein_g: a.protein_g + (m.protein_g || 0),
    carbs_g: a.carbs_g + (m.carbs_g || 0),
    fat_g: a.fat_g + (m.fat_g || 0),
  }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

  const warnings = [];
  const kcalDiff = Math.abs(totals.kcal - targets.kcal);
  if (kcalDiff > targets.kcal * 0.2) warnings.push(`kcal_drift:${kcalDiff}`);
  if (totals.protein_g < targets.protein_g * 0.7) warnings.push('protein_low');

  return {
    status: warnings.length ? 'REVIEW' : 'VALID',
    totals: {
      kcal: Math.round(totals.kcal),
      protein_g: Math.round(totals.protein_g),
      carbs_g: Math.round(totals.carbs_g),
      fat_g: Math.round(totals.fat_g),
    },
    warnings,
  };
}

function aggregateShoppingList(meals) {
  const map = new Map();
  for (const meal of meals) {
    for (const item of meal.items || []) {
      const key = item.food_id || item.name;
      const prev = map.get(key) || { name: item.name, grams: 0, food_id: item.food_id };
      prev.grams += item.grams || 0;
      map.set(key, prev);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'bg'));
}

/**
 * Main orchestrator — generate one day protocol (deterministic).
 * @param {object} client — profile + dietPreference + goal + activeSlots[]
 */
export function generateProtocol(client = {}, options = {}) {
  const pipeline = LIBRARY_ORCHESTRATOR?.pipeline || [];
  const dietProfile = options.dietProfile || resolveLibraryDietProfile(client);
  const energy = deriveEnergyTargets(client);
  const rules = LIBRARY_PROTOCOL_RULES.diet_profiles?.[dietProfile] || {};

  if (rules.max_carbs_g_day && energy.carbs_g > rules.max_carbs_g_day) {
    energy.carbs_g = rules.max_carbs_g_day;
    energy.kcal = energy.protein_g * 4 + energy.carbs_g * 4 + energy.fat_g * 9;
  }

  const activeSlots = (client.activeSlots || client.mealSlots || SLOT_ORDER).filter(s => MEAL_TYPE_TIMING[s]);
  const distribution = getMealDistribution(activeSlots.length);
  const slotWeights = activeSlots.map((_, i) => distribution[i] || (1 / activeSlots.length));
  const weightSum = slotWeights.reduce((a, b) => a + b, 0);
  const normWeights = slotWeights.map(w => w / weightSum);

  const seed = Number(options.seed || client.userId || 0);
  const allowedFoods = filterLibraryFoodsByDiet(dietProfile);
  const dailyMeals = activeSlots.map((slot, i) =>
    buildMealForSlot(slot, dietProfile, energy, i, normWeights, seed + i),
  );

  const validation = validateDailyMenu(dailyMeals, energy);
  const shoppingList = aggregateShoppingList(dailyMeals);

  return {
    pipeline,
    dietProfile,
    energyModel: energy,
    exchangeMap: getExchangeMap(),
    allowedFoodCount: allowedFoods.length,
    dailyMenu: dailyMeals,
    validation,
    shoppingList,
    rulesApplied: rules,
  };
}

/** 7-day rotation with deterministic variety */
export function generateWeeklyMenu(client = {}, options = {}) {
  const days = [];
  for (let d = 0; d < 7; d++) {
    days.push({
      day: d + 1,
      ...generateProtocol(client, { ...options, seed: (options.seed || 0) + d * 17 }),
    });
  }
  return { days, shoppingList: aggregateShoppingList(days.flatMap(d => d.dailyMenu)) };
}

export { LIBRARY_ORCHESTRATOR };
