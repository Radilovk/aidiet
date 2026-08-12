/**
 * Food catalog query engine — filter by slot/timing/diet, format for prompts, validate AI output.
 */

import {
  MEAL_TYPE_TIMING,
  DEFAULT_MIN_UNIVERSALITY,
  CATALOG_PROMPT_LIMIT_PER_SLOT,
  CLINICAL_PROTOCOL_EXCLUSIONS,
} from './food-catalog-data.js';
import { FOOD_NUTRITION_PER_100G } from './food-nutrition-data.js';
import { normalizeFoodKey } from './food-utils.js';
import { buildRegistryIndex, getCatalogEntries } from './food-registry.js';
import { passesDietRegistry, resolveCatalogDietProfile } from './diet-registry.js';
import { rankCatalogCandidates } from './candidate-ranking.js';
import { maxSlotKcalInChunk, buildHighKcalCreationHint } from './step3-creation-hints.js';
import { READY_MEAL_PARTS } from './ready-meal-parts.js';

const SLOT_LABELS = {
  PRO: 'белтъчини [PRO]',
  ENG: 'въглехидрати [ENG]',
  VOL: 'зеленчуци [VOL]',
  FAT: 'мазнини/ядки [FAT]',
};

const MIN_CANDIDATES_PER_ROLE = 4;
const MACRO_FILTER_FAT_MARGIN = 0.25;
const MACRO_FILTER_CARB_MARGIN = 0.25;

/** High-fat H5 staples — must survive macro filter when Хранене 5 is in the chunk. */
const LATE_SNACK_NUTRITION_KEYS = new Set([
  'кисело мляко', 'скир', 'кефир', 'извара', 'кашкавал',
  'ядки', 'бадеми', 'орехи', 'кашу', 'лешници', 'шамфъстък', 'пекани', 'макадамия',
]);

export function fatShareOfKcal(nutritionKey) {
  const a = FOOD_NUTRITION_PER_100G[nutritionKey];
  if (!a) return 0;
  const kcal = a[1] * 4 + a[2] * 4 + a[3] * 9;
  return kcal > 0 ? (a[3] * 9) / kcal : 0;
}

export function carbShareOfKcal(nutritionKey) {
  const a = FOOD_NUTRITION_PER_100G[nutritionKey];
  if (!a) return 0;
  const kcal = a[1] * 4 + a[2] * 4 + a[3] * 9;
  return kcal > 0 ? (a[2] * 4) / kcal : 0;
}

function nutritionArrayToProfile(arr) {
  if (!arr || arr.length < 4) return null;
  return { kcal: arr[0], p: arr[1], c: arr[2], f: arr[3] };
}

/** Per-100g nutrition for a catalog entry */
export function getCatalogEntryNutrition(entry) {
  if (!entry) return null;
  const key = normalizeFoodKey(entry.nutritionKey);
  const raw = FOOD_NUTRITION_PER_100G[entry.nutritionKey] || FOOD_NUTRITION_PER_100G[key];
  return nutritionArrayToProfile(raw);
}

/** Compact label for Step 3 prompt. */
export function formatCatalogEntryLabel(entry) {
  if (entry.fixedNutrition?.kcal) {
    const f = entry.fixedNutrition;
    return `${entry.name} (фиксирана порция ${Math.round(f.kcal)}kcal P${Math.round(f.p)}/C${Math.round(f.c)}/F${Math.round(f.f)})`;
  }
  const n = getCatalogEntryNutrition(entry);
  if (!n) return entry.name;
  return `${entry.name} (${Math.round(n.kcal)}kcal P${Math.round(n.p)}/C${Math.round(n.c)}/F${Math.round(n.f)} на 100g)`;
}

function buildCatalogIndex() {
  return buildRegistryIndex();
}

/** @returns {{ entry: object|null, unknown: boolean }} */
export function resolveCatalogEntry(name) {
  const index = buildCatalogIndex();
  const normalized = normalizeFoodKey(name);
  if (!normalized) return { entry: null, unknown: true };

  if (index.byKey.has(normalized)) {
    return { entry: index.byKey.get(normalized), unknown: false };
  }

  let best = null;
  let bestLen = 0;
  for (const [key, entry] of index.byKey) {
    if (key.length < 4) continue;
    if (normalized.includes(key) || key.includes(normalized)) {
      if (key.length > bestLen) {
        bestLen = key.length;
        best = entry;
      }
    }
  }
  if (best) return { entry: best, unknown: false };
  return { entry: null, unknown: true };
}

export { getCatalogEntries };

function normalizeDietModifier(modifier = '') {
  return resolveCatalogDietProfile({ dietaryModifier: modifier });
}

function buildDietContext(options = {}) {
  return {
    dietaryModifier: options.dietaryModifier || 'Балансирано',
    dietPreference: options.dietPreference ?? null,
    dietDislike: options.dietDislike || '',
  };
}

const GLUTEN_KEYS = new Set([
  'хляб', 'хляб пълнозърнест', 'ръжен хляб', 'паста', 'макарони', 'тортила', 'крекери',
  'овесени ядки', 'овес', 'сандвич пиле',
]);

function isDietCompatible(entry, diet) {
  if (diet.vegan && !entry.vegan) return false;
  if (diet.vegetarian && !entry.vegetarian && !entry.vegan) return false;
  if (diet.pescatarian && entry.group === 'protein' && !entry.vegan && !entry.vegetarian) {
    const fishKeys = new Set(['риба', 'сьомга', 'риба тон', 'треска', 'скумрия', 'тилапия', 'скариди']);
    if (!fishKeys.has(entry.nutritionKey)) return false;
  }
  if (diet.glutenFree && GLUTEN_KEYS.has(entry.nutritionKey)) return false;
  // Keto: token match so composite ready meals (Ориз с пиле, Риба с картофи,
  // Сандвич с пиле) are excluded along with the plain grain/starch items.
  if (diet.keto && (entry.group === 'carb' || entry.group === 'ready_meal')) {
    const highCarbTokens = ['ориз', 'хляб', 'паста', 'макарони', 'картофи', 'киноа',
      'булгур', 'овес', 'каша', 'сандвич', 'тортила', 'просо', 'елда', 'царевица'];
    const key = normalizeFoodKey(entry.nutritionKey);
    if (highCarbTokens.some(t => key.includes(t))) return false;
  }
  return true;
}

/** True if a clinical protocol's food-group elimination excludes this catalog entry. */
function isExcludedByProtocol(entry, clinicalProtocolId) {
  const rule = clinicalProtocolId && CLINICAL_PROTOCOL_EXCLUSIONS[clinicalProtocolId];
  if (!rule) return false;
  if (rule.excludeGroups?.includes(entry.group)) return true;
  if (rule.excludeNutritionKeys?.includes(entry.nutritionKey)) return true;
  const nameLower = String(entry.name || '').toLowerCase();
  const keyLower = String(entry.nutritionKey || '').toLowerCase();
  for (const key of rule.excludeNutritionKeys || []) {
    const k = String(key).toLowerCase();
    if (k.length < 3) continue;
    const nk = normalizeFoodKey(k);
    if (nameLower.includes(k) || keyLower.includes(k)
      || normalizeFoodKey(nameLower).includes(nk) || normalizeFoodKey(keyLower).includes(nk)) {
      return true;
    }
  }
  return false;
}

/** Ready meals: exclude when name or decomposed parts hit clinical protocol keys/groups. */
function readyMealViolatesProtocol(entry, clinicalProtocolId) {
  if (!clinicalProtocolId || !entry || entry.group !== 'ready_meal') return false;
  if (isExcludedByProtocol(entry, clinicalProtocolId)) return true;
  const rule = CLINICAL_PROTOCOL_EXCLUSIONS[clinicalProtocolId];
  if (!rule) return false;

  const nameLower = String(entry.name || '').toLowerCase();
  const keys = rule.excludeNutritionKeys || [];
  for (const key of keys) {
    const k = String(key).toLowerCase();
    if (k.length >= 3 && (nameLower.includes(k) || normalizeFoodKey(nameLower).includes(normalizeFoodKey(k)))) {
      return true;
    }
  }

  const parts = READY_MEAL_PARTS[entry.id];
  if (parts?.length) {
    for (const part of parts) {
      const pk = normalizeFoodKey(part.name);
      if (keys.some(k => pk.includes(normalizeFoodKey(k)) || normalizeFoodKey(k).includes(pk))) return true;
      if (rule.excludeGroups?.length) {
        const { entry: partEntry } = resolveCatalogEntry(part.name);
        if (partEntry && rule.excludeGroups.includes(partEntry.group)) return true;
      }
    }
  }
  return false;
}

function isBlockedByTerms(entry, blockedTerms = []) {
  const nameLower = entry.name.toLowerCase();
  const keyLower = entry.nutritionKey.toLowerCase();
  for (const term of blockedTerms) {
    const t = String(term || '').toLowerCase().trim();
    if (t.length < 3) continue;
    if (nameLower.includes(t) || t.includes(nameLower) || keyLower.includes(t) || t.includes(keyLower)) {
      return true;
    }
  }
  return false;
}

function mealTypeToTiming(mealType) {
  return MEAL_TYPE_TIMING[mealType] || 'main';
}

function inferSlotsFromTarget(target = {}) {
  const p = Number(target.protein) || 0;
  const c = Number(target.carbs) || 0;
  const f = Number(target.fats) || 0;
  const slots = new Set(['VOL']);
  if (p >= 12) slots.add('PRO');
  if (c >= 15) slots.add('ENG');
  if (f >= 8) slots.add('FAT');
  if (!slots.has('PRO') && !slots.has('ENG')) {
    slots.add('PRO');
    slots.add('ENG');
  }
  return [...slots];
}

function mealTargetFatShare(meal) {
  const kcal = Number(meal.calories) || 0;
  const f = Number(meal.fats) || 0;
  if (kcal <= 0) return 1;
  return (f * 9) / kcal;
}

function mealTargetCarbShare(meal) {
  const kcal = Number(meal.calories) || 0;
  const c = Number(meal.carbs) || 0;
  if (kcal <= 0) return 1;
  return (c * 4) / kcal;
}

function applyMacroRoleFilter(list, { maxFatShare, maxCarbShare, isKeto }) {
  if (!list.length) return list;
  const filtered = list.filter(entry => {
    if (entry.group === 'condiment') return true;
    const key = entry.nutritionKey || entry.name;
    if (fatShareOfKcal(key) > maxFatShare) return false;
    if (isKeto && carbShareOfKcal(key) > maxCarbShare) return false;
    return true;
  });
  return filtered.length >= MIN_CANDIDATES_PER_ROLE ? filtered : list;
}

function injectLateSnackCandidates(list, index, blockedTerms = []) {
  const present = new Set(list.map(e => e.nutritionKey || e.name));
  const extras = [];
  for (const entry of index.all) {
    const key = entry.nutritionKey || entry.name;
    if (!LATE_SNACK_NUTRITION_KEYS.has(key) || present.has(key)) continue;
    if (isBlockedByTerms(entry, blockedTerms)) continue;
    extras.push(entry);
    present.add(key);
  }
  if (!extras.length) return list;
  return [...list, ...extras].slice(0, CATALOG_PROMPT_LIMIT_PER_SLOT);
}

/**
 * Collect catalog candidates for a chunk of days.
 * @returns {Map<string, object[]>} slot → entries
 */
export function getCatalogCandidatesForChunk({
  strategy,
  startDay,
  endDay,
  dietaryModifier = 'Балансирано',
  dietPreference = null,
  dietDislike = '',
  blockedTerms = [],
  minUniversality = DEFAULT_MIN_UNIVERSALITY,
  preferLove = [],
  clinicalProtocolId = null,
  adherenceRatio = null,
}) {
  const index = buildCatalogIndex();
  const dietCtx = buildDietContext({ dietaryModifier, dietPreference, dietDislike });
  const diet = resolveCatalogDietProfile(dietCtx);
  const registryCtx = dietCtx;
  const loveSet = new Set((preferLove || []).map(s => normalizeFoodKey(s)));
  const timings = new Set();
  const neededSlots = new Set(['VOL']);
  let hasLateSnack = false;
  let minFatShare = 1;
  let minCarbShare = 1;
  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const adherenceMap = adherenceRatio instanceof Map
    ? adherenceRatio
    : new Map(Object.entries(adherenceRatio || {}));
  const representativeSlot = strategy?.weeklyScheme?.[dayKeys[startDay - 1]]?.mealBreakdown
    ?.find(m => m.type === 'Хранене 2') || strategy?.weeklyScheme?.monday?.mealBreakdown?.[0];
  const maxSlotKcal = maxSlotKcalInChunk(strategy, startDay, endDay, dayKeys);
  const isKeto = /кето|keto/i.test(String(dietaryModifier || ''));
  for (let d = startDay; d <= endDay; d++) {
    const dayTarget = strategy?.weeklyScheme?.[dayKeys[d - 1]];
    if (!dayTarget?.mealBreakdown) continue;
    for (const meal of dayTarget.mealBreakdown) {
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
      timings.add(mealTypeToTiming(meal.type));
      for (const s of inferSlotsFromTarget(meal)) neededSlots.add(s);
      if (meal.type === 'Хранене 5') {
        hasLateSnack = true;
        neededSlots.add('PRO');
        neededSlots.add('FAT');
        neededSlots.delete('ENG');
      } else {
        minFatShare = Math.min(minFatShare, mealTargetFatShare(meal));
        minCarbShare = Math.min(minCarbShare, mealTargetCarbShare(meal));
      }
    }
  }

  if (!timings.size) {
    timings.add('main');
    timings.add('breakfast');
    timings.add('snack');
  }

  const bySlot = new Map();
  for (const slot of neededSlots) bySlot.set(slot, []);

  for (const entry of index.all) {
    if (entry.group === 'ready_meal') continue;
    if (entry.universality < minUniversality) continue;
    if (!isDietCompatible(entry, diet)) continue;
    if (!passesDietRegistry(entry, registryCtx)) continue;
    if (isBlockedByTerms(entry, blockedTerms)) continue;
    if (isExcludedByProtocol(entry, clinicalProtocolId)) continue;

    const entryTimings = entry.timing;
    const timingMatch = [...timings].some(t => entryTimings.includes(t));
    if (!timingMatch && entry.group !== 'condiment') continue;

    for (const slot of entry.slots) {
      if (!neededSlots.has(slot)) continue;
      const list = bySlot.get(slot);
      if (!list) continue;
      list.push(entry);
    }
  }

  for (const [slot, list] of bySlot) {
    const ranked = rankCatalogCandidates(list, {
      loveSet,
      adherenceRatio: adherenceMap,
      slotTarget: representativeSlot,
      maxSlotKcal,
      limit: CATALOG_PROMPT_LIMIT_PER_SLOT * 3,
    });
    bySlot.set(slot, ranked.slice(0, CATALOG_PROMPT_LIMIT_PER_SLOT));
  }

  const maxFatShare = minFatShare + MACRO_FILTER_FAT_MARGIN;
  const maxCarbShare = minCarbShare + MACRO_FILTER_CARB_MARGIN;
  for (const slot of ['PRO', 'ENG', 'VOL', 'FAT']) {
    if (!bySlot.has(slot)) continue;
    let list = bySlot.get(slot) || [];
    if (slot !== 'VOL') {
      list = applyMacroRoleFilter(list, { maxFatShare, maxCarbShare, isKeto });
    }
    if (hasLateSnack && (slot === 'PRO' || slot === 'FAT')) {
      list = injectLateSnackCandidates(list, index, blockedTerms);
    }
    bySlot.set(slot, list);
  }

  const ready = rankCatalogCandidates(
    index.all
      .filter(e => e.group === 'ready_meal')
      .filter(e => e.universality >= minUniversality)
      .filter(e => isDietCompatible(e, diet))
      .filter(e => passesDietRegistry(e, registryCtx))
      .filter(e => !isBlockedByTerms(e, blockedTerms))
      .filter(e => !isExcludedByProtocol(e, clinicalProtocolId))
      .filter(e => !readyMealViolatesProtocol(e, clinicalProtocolId))
      .filter(e => e.timing.some(t => timings.has(t))),
    { loveSet, adherenceRatio: adherenceMap, slotTarget: representativeSlot, maxSlotKcal, limit: 8 },
  );

  bySlot.set('READY', ready);
  return bySlot;
}

export function formatCatalogSectionForPrompt(candidatesBySlot, { minUniversality = DEFAULT_MIN_UNIVERSALITY, creationHint = '' } = {}) {
  const lines = [
    `=== КАТАЛОГ (само тези имена; без грамове в description) ===`,
    `Универсалност ≥${minUniversality} — предпочитай общи имена (Риба, Ориз) пред конкретни.`,
  ];
  if (creationHint) lines.push(creationHint);

  for (const slot of ['PRO', 'ENG', 'VOL', 'FAT']) {
    const items = candidatesBySlot.get(slot) || [];
    if (!items.length) continue;
    lines.push(`${SLOT_LABELS[slot]}:`);
    for (const item of items) {
      lines.push(`  • ${formatCatalogEntryLabel(item)}`);
    }
  }

  const ready = candidatesBySlot.get('READY') || [];
  if (ready.length) {
    lines.push(`Готови ястия (backend разбива на сурови продукти при синхрон):`);
    for (const item of ready) {
      lines.push(`  • ${formatCatalogEntryLabel(item)}`);
    }
  }

  lines.push(`Без продукти извън каталога.`);
  return lines.join('\n');
}

/** Defense-in-depth: catalog entry flags + registry narrowing for parsed meal products. */
export function validateProductNamesAgainstDiet(names, dietCtx = {}) {
  const diet = resolveCatalogDietProfile(dietCtx);
  const registryCtx = buildDietContext(dietCtx);
  const violations = [];
  for (const name of names) {
    const { entry } = resolveCatalogEntry(name);
    if (!entry) continue;
    if (!isDietCompatible(entry, diet)) violations.push(name);
    else if (!passesDietRegistry(entry, registryCtx)) violations.push(name);
  }
  return [...new Set(violations)];
}

export function buildCatalogPromptSection(options) {
  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const maxSlotKcal = maxSlotKcalInChunk(options.strategy, options.startDay, options.endDay, dayKeys);
  const candidates = getCatalogCandidatesForChunk(options);
  return formatCatalogSectionForPrompt(candidates, {
    minUniversality: options.minUniversality ?? DEFAULT_MIN_UNIVERSALITY,
    creationHint: buildHighKcalCreationHint(maxSlotKcal),
  });
}

export function validateProductNamesInCatalog(names) {
  const unknown = [];
  for (const name of names) {
    const { unknown: isUnknown } = resolveCatalogEntry(name);
    if (isUnknown) unknown.push(name);
  }
  return [...new Set(unknown)];
}

/**
 * Defense-in-depth: even though the prompt/repair candidate pools already exclude
 * clinical-protocol-forbidden foods, a validation-layer check catches any AI slip
 * (e.g. it ignores the catalog and writes a forbidden item by name anyway) so it's
 * flagged as an error and retried, rather than silently reaching the client.
 */
export function validateProductNamesAgainstProtocol(names, clinicalProtocolId) {
  if (!clinicalProtocolId || !CLINICAL_PROTOCOL_EXCLUSIONS[clinicalProtocolId]) return [];
  const violations = [];
  for (const name of names) {
    const { entry } = resolveCatalogEntry(name);
    if (entry && isExcludedByProtocol(entry, clinicalProtocolId)) violations.push(name);
  }
  return [...new Set(violations)];
}

export function getCatalogNutritionKey(name) {
  const { entry } = resolveCatalogEntry(name);
  return entry?.nutritionKey || null;
}

export function getAllCatalogNames() {
  return buildCatalogIndex().all.map(e => e.name);
}
