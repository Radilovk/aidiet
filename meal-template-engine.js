/**
 * Meal template engine — connects library meal-templates to NutriPlan slots.
 * Foundation for deterministic Slot Assembler (no AI product pick).
 */

import {
  LIBRARY_MEAL_TEMPLATES,
  LIBRARY_PROTOCOL_RULES,
  LIBRARY_READY_MEALS,
  filterLibraryFoodsByDiet,
  getMealTemplateForSlot,
  LIBRARY_MEAL_TYPE_MAP,
} from './nutrition-library-bridge.js';
import { MEAL_TYPE_TIMING } from './food-catalog-data.js';

/** Map NutriPlan slot label → library template + timing. */
export function resolveSlotTemplate(slotLabel) {
  const tpl = getMealTemplateForSlot(slotLabel);
  const timing = MEAL_TYPE_TIMING[slotLabel] || 'main';
  return { slotLabel, timing, template: tpl };
}

/** Allowed library food groups for a slot (from meal template). */
export function allowedGroupsForSlot(slotLabel) {
  const { template } = resolveSlotTemplate(slotLabel);
  return template?.allowed_groups || [];
}

/** Macro/kcal targets from library template for a slot. */
export function slotTargetsFromTemplate(slotLabel) {
  const { template } = resolveSlotTemplate(slotLabel);
  if (!template) return null;
  return {
    kcal: template.kcal_target,
    protein: template.protein_target_g,
    carbs: template.carb_target_g,
    fats: template.fat_target_g,
    allowedGroups: template.allowed_groups || [],
    mealType: template.meal_type,
  };
}

/** Pick ready meals compatible with slot + diet profile. */
export function pickReadyMealsForSlot(slotLabel, dietProfile = 'balanced', limit = 5) {
  const { timing, template } = resolveSlotTemplate(slotLabel);
  const mealTypes = template?.meal_type ? [template.meal_type] : [];
  const allowedGroups = new Set(template?.allowed_groups || []);

  return LIBRARY_READY_MEALS.filter(meal => {
    const map = LIBRARY_MEAL_TYPE_MAP[meal.meal_type];
    if (map?.timing !== timing && mealTypes.length && !mealTypes.includes(meal.meal_type)) {
      return false;
    }
    if (dietProfile !== 'balanced' && meal.diet_profiles?.length) {
      if (!meal.diet_profiles.includes(dietProfile) && !meal.diet_profiles.includes('balanced')) {
        return false;
      }
    }
    if (allowedGroups.size) {
      const rules = LIBRARY_PROTOCOL_RULES.diet_profiles?.[dietProfile];
      if (rules?.exclude_groups?.some(g => allowedGroups.has(g))) return false;
    }
    return true;
  }).slice(0, limit);
}

/** Filter library foods for slot assembly by diet + allowed groups. */
export function foodsForSlotAssembly(slotLabel, dietProfile = 'balanced') {
  const targets = slotTargetsFromTemplate(slotLabel);
  const allowedGroups = new Set(targets?.allowedGroups || []);
  let foods = filterLibraryFoodsByDiet(dietProfile);
  if (allowedGroups.size) {
    foods = foods.filter(f => allowedGroups.has(f.group_id));
  }
  return { targets, foods };
}

/** Exchange units from protocol rules. */
export function getExchangeMap() {
  return LIBRARY_PROTOCOL_RULES.exchange_map || {
    carb_exchange_g: 15,
    protein_exchange_g: 7,
    fat_exchange_g: 5,
  };
}

/** Meal distribution weights (3/4/5 meals per day). */
export function getMealDistribution(mealsPerDay = 5) {
  const templates = LIBRARY_PROTOCOL_RULES.meal_distribution_templates || {};
  if (mealsPerDay <= 3) return templates['3_meals'] || [0.3, 0.4, 0.3];
  if (mealsPerDay === 4) return templates['4_meals'] || [0.25, 0.35, 0.15, 0.25];
  return templates['5_meals'] || [0.2, 0.25, 0.2, 0.15, 0.2];
}

/** All slot templates aligned to NutriPlan Хранене 1–5. */
export function getAllSlotTemplates() {
  return Object.keys(MEAL_TYPE_TIMING).map(slotLabel => ({
    slotLabel,
    ...resolveSlotTemplate(slotLabel),
    targets: slotTargetsFromTemplate(slotLabel),
  }));
}

export { LIBRARY_MEAL_TEMPLATES };
