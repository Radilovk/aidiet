/**
 * Client-side contracts for profile regen + food-picker modes.
 * Mirrors profile.html / food-picker.html decision logic for offline tests.
 */

/** Fields that must trigger full plan regeneration when changed. */
export const DIET_RELATED_PROFILE_FIELDS = [
  'gender', 'height', 'weight', 'goal', 'lossKg',
  'sleepHours', 'sleepInterrupt', 'chronotype', 'dailyActivityLevel', 'stressLevel', 'sportActivity',
  'waterIntake', 'drinksSweet', 'drinksAlcohol',
  'weightChange', 'weightChangeDetails', 'dietHistory', 'dietType', 'dietResult',
  'overeatingFrequency', 'foodCravings', 'foodTriggers', 'eatingHabits', 'compensationMethods', 'socialComparison',
  'dietPreference', 'dietDislike', 'dietLove',
  'medicalConditions', 'medications', 'medicationsDetails', 'additionalNotes',
];

export const NON_DIET_PROFILE_FIELDS = ['name', 'email', 'age'];

export const FOOD_PICKER_EXCLUSION_THRESHOLD = 0.6;
export const FOOD_PICKER_MIN_SELECTED = 8;
export const FOOD_PICKER_MIN_CATEGORIES = 3;

/**
 * Classify profile edits: whether save-only or full regen is required.
 * @param {Record<string, {old: any, new: any, dietRelated: boolean}>} changes
 */
export function classifyProfileChanges(changes) {
  const changedKeys = Object.keys(changes || {}).filter(k => {
    const c = changes[k];
    return String(c.old ?? '') !== String(c.new ?? '');
  });
  const dietRelated = changedKeys.filter(k => changes[k].dietRelated === true);
  const nonDiet = changedKeys.filter(k => changes[k].dietRelated !== true);
  return {
    changedKeys,
    dietRelatedKeys: dietRelated,
    nonDietKeys: nonDiet,
    requiresRegen: dietRelated.length > 0,
    saveOnly: changedKeys.length > 0 && dietRelated.length === 0,
  };
}

/** Profile regen always requires admin approval when replacing an existing plan. */
export function shouldRequireApprovalForProfileRegen(hasExistingPlanForEmail) {
  return !!hasExistingPlanForEmail;
}

/**
 * Build async generate-plan payload for profile regeneration.
 */
export function buildProfileRegenRequest({ userData, jobId, requireApproval, userId = null, idToken = null, clientId = null }) {
  const body = {
    ...userData,
    _jobId: jobId,
  };
  if (clientId) body._clientId = clientId;
  if (requireApproval) {
    body._requireApproval = true;
    if (userId) body._userId = userId;
    if (idToken) body._idToken = idToken;
  }
  return body;
}

export function expectedPlanJobSource(requireApproval) {
  return requireApproval ? 'profile-regen' : 'questionnaire';
}

/**
 * Food-picker mode: exclusion when user selected ≥ threshold of catalog.
 */
export function resolveFoodPickerMode(selectedCount, totalVisible, threshold = FOOD_PICKER_EXCLUSION_THRESHOLD) {
  if (totalVisible <= 0) return 'inclusion';
  return selectedCount >= threshold * totalVisible ? 'exclusion' : 'inclusion';
}

/**
 * Build KV list payloads for food-picker save.
 * @returns {{ mode: string, blacklist: string[], mainlist: string[], mainlistEnabled: boolean }}
 */
export function buildFoodPickerListPayload({ selected, catalogVisible, blockedTerms = [] }) {
  const blocked = new Set(blockedTerms.map(t => t.toLowerCase()));
  const filteredSelected = selected.filter(n => !blocked.has(String(n).toLowerCase()));
  const visible = catalogVisible.filter(n => !blocked.has(String(n).toLowerCase()));
  const mode = resolveFoodPickerMode(filteredSelected.length, visible.length);
  if (mode === 'exclusion') {
    const selectedSet = new Set(filteredSelected.map(n => String(n).toLowerCase()));
    const unselected = visible.filter(n => !selectedSet.has(String(n).toLowerCase()));
    return {
      mode,
      blacklist: unselected,
      mainlist: [],
      mainlistEnabled: false,
      selectedCount: filteredSelected.length,
      totalVisible: visible.length,
    };
  }
  return {
    mode,
    blacklist: [],
    mainlist: filteredSelected,
    mainlistEnabled: true,
    selectedCount: filteredSelected.length,
    totalVisible: visible.length,
  };
}

export function validateFoodPickerSelection({ selectedCount, categoryCount, minSelected = FOOD_PICKER_MIN_SELECTED, minCategories = FOOD_PICKER_MIN_CATEGORIES }) {
  const issues = [];
  if (selectedCount < minSelected) {
    issues.push(`избрани ${selectedCount} < минимум ${minSelected}`);
  }
  if (categoryCount < minCategories) {
    issues.push(`категории ${categoryCount} < минимум ${minCategories}`);
  }
  return issues;
}

/** After food-picker lists are saved, plan regen uses sync generate-plan (no approval). */
export function buildFoodPickerRegenRequest(userData) {
  return { ...userData };
}
