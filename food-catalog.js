/**
 * Food catalog query engine — filter by slot/timing/diet, format for prompts, validate AI output.
 */

import {
  FOOD_CATALOG,
  MEAL_TYPE_TIMING,
  DEFAULT_MIN_UNIVERSALITY,
  CATALOG_PROMPT_LIMIT_PER_SLOT,
  CLINICAL_PROTOCOL_EXCLUSIONS,
} from './food-catalog-data.js';
import { FOOD_NUTRITION_PER_100G } from './food-nutrition-data.js';
import { normalizeFoodKey } from './food-utils.js';

const SLOT_LABELS = {
  PRO: 'белтъчини [PRO]',
  ENG: 'въглехидрати [ENG]',
  VOL: 'зеленчуци [VOL]',
  FAT: 'мазнини/ядки [FAT]',
};

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

/** Compact label for Step 3: "Име (165kcal P31/C0/F4 на 100g)" */
export function formatCatalogEntryLabel(entry) {
  const n = getCatalogEntryNutrition(entry);
  if (!n) return entry.name;
  return `${entry.name} (${Math.round(n.kcal)}kcal P${Math.round(n.p)}/C${Math.round(n.c)}/F${Math.round(n.f)} на 100g)`;
}

let catalogIndexCache = null;

function buildCatalogIndex() {
  if (catalogIndexCache) return catalogIndexCache;

  const byId = new Map();
  const byKey = new Map();

  for (const entry of FOOD_CATALOG) {
    byId.set(entry.id, entry);
    const keys = new Set([
      normalizeFoodKey(entry.name),
      normalizeFoodKey(entry.nutritionKey),
      ...entry.aliases.map(normalizeFoodKey),
    ]);
    for (const key of keys) {
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, entry);
    }
  }

  catalogIndexCache = { byId, byKey, all: FOOD_CATALOG };
  return catalogIndexCache;
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

function normalizeDietModifier(modifier = '') {
  const m = String(modifier).toLowerCase();
  return {
    vegan: m.includes('веган'),
    vegetarian: m.includes('вегетариан'),
    pescatarian: m.includes('пескетариан'),
    keto: m.includes('кето') || m.includes('нисковъглехидрат'),
    glutenFree: m.includes('без глутен') || m.includes('глутен'),
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
  if (diet.keto && entry.group === 'carb' && entry.universality >= 4 && !['овесени ядки', 'овес'].includes(entry.nutritionKey)) {
    const highCarb = ['ориз', 'ориз бял', 'ориз кафяв', 'хляб', 'паста', 'картофи', 'киноа', 'булгур'];
    if (highCarb.includes(entry.nutritionKey)) return false;
  }
  return true;
}

/** True if a clinical protocol's food-group elimination excludes this catalog entry. */
function isExcludedByProtocol(entry, clinicalProtocolId) {
  const rule = clinicalProtocolId && CLINICAL_PROTOCOL_EXCLUSIONS[clinicalProtocolId];
  if (!rule) return false;
  if (rule.excludeGroups?.includes(entry.group)) return true;
  if (rule.excludeNutritionKeys?.includes(entry.nutritionKey)) return true;
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

/**
 * Collect catalog candidates for a chunk of days.
 * @returns {Map<string, object[]>} slot → entries
 */
export function getCatalogCandidatesForChunk({
  strategy,
  startDay,
  endDay,
  dietaryModifier = 'Балансирано',
  blockedTerms = [],
  minUniversality = DEFAULT_MIN_UNIVERSALITY,
  preferLove = [],
  clinicalProtocolId = null,
}) {
  const index = buildCatalogIndex();
  const diet = normalizeDietModifier(dietaryModifier);
  const loveSet = new Set((preferLove || []).map(s => normalizeFoodKey(s)));
  const timings = new Set();
  const neededSlots = new Set(['VOL']);

  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (let d = startDay; d <= endDay; d++) {
    const dayTarget = strategy?.weeklyScheme?.[dayKeys[d - 1]];
    if (!dayTarget?.mealBreakdown) continue;
    for (const meal of dayTarget.mealBreakdown) {
      if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
      timings.add(mealTypeToTiming(meal.type));
      for (const s of inferSlotsFromTarget(meal)) neededSlots.add(s);
      if (meal.type === 'Хранене 5') {
        neededSlots.add('PRO');
        neededSlots.add('FAT');
        neededSlots.delete('ENG');
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
    if (entry.universality < minUniversality) continue;
    if (!isDietCompatible(entry, diet)) continue;
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
    list.sort((a, b) => {
      const aLove = loveSet.has(normalizeFoodKey(a.name)) ? 1 : 0;
      const bLove = loveSet.has(normalizeFoodKey(b.name)) ? 1 : 0;
      if (bLove !== aLove) return bLove - aLove;
      if (b.universality !== a.universality) return b.universality - a.universality;
      return a.name.localeCompare(b.name, 'bg');
    });
    const seen = new Set();
    const deduped = [];
    for (const e of list) {
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      deduped.push(e);
      if (deduped.length >= CATALOG_PROMPT_LIMIT_PER_SLOT) break;
    }
    bySlot.set(slot, deduped);
  }

  const ready = index.all
    .filter(e => e.group === 'ready_meal')
    .filter(e => e.universality >= minUniversality)
    .filter(e => isDietCompatible(e, diet))
    .filter(e => !isBlockedByTerms(e, blockedTerms))
    .filter(e => !isExcludedByProtocol(e, clinicalProtocolId))
    .filter(e => e.timing.some(t => timings.has(t)))
    .sort((a, b) => b.universality - a.universality || a.name.localeCompare(b.name, 'bg'))
    .slice(0, 12);

  bySlot.set('READY', ready);
  return bySlot;
}

export function formatCatalogSectionForPrompt(candidatesBySlot, { minUniversality = DEFAULT_MIN_UNIVERSALITY } = {}) {
  const lines = [
    `=== КАТАЛОГ ХРАНИ (ЗАДЪЛЖИТЕЛНО — използвай САМО тези имена) ===`,
    `Универсалност ≥${minUniversality}: предпочитай по-общи варианти (Риба, Ориз, Плод) пред конкретни (Лаврак, Киноа, Манго).`,
    `Стойности в скоби = на 100g. Ориентирай грамажите към целите от mealBreakdown. Закръгляй на 10g.`,
    `Готова храна = един ред в description ИЛИ разбий на продукти от каталога.`,
  ];

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
    lines.push(`Готови ястия:`);
    for (const item of ready) {
      lines.push(`  • ${formatCatalogEntryLabel(item)}`);
    }
  }

  lines.push(`НЕ използвай продукти извън каталога. Подправки — макс 10–15g, не като основен макроизточник.`);
  return lines.join('\n');
}

/**
 * Flat, nutrition-attached candidate pool for the backend auto-repair engine
 * (food-nutrition.js repairItemsToTolerance) — distinct from the AI-facing prompt
 * candidates: excludes composite ready meals/condiments AND VOL-only vegetables (all
 * poor "basis vectors" for closing a macro gap — a vegetable can only "close" a gap
 * by ballooning to an absurd portion) and isn't limited to a day range, just one
 * meal's timing.
 */
export function getRepairCandidatesForMeal(mealType, dietaryModifier = 'Балансирано', blockedTerms = [], clinicalProtocolId = null) {
  const index = buildCatalogIndex();
  const diet = normalizeDietModifier(dietaryModifier);
  const timing = mealTypeToTiming(mealType);

  return index.all
    .filter(e => e.group !== 'condiment' && e.group !== 'ready_meal')
    .filter(e => e.slots.some(s => s !== 'VOL'))
    .filter(e => e.timing.includes(timing))
    .filter(e => isDietCompatible(e, diet))
    .filter(e => !isBlockedByTerms(e, blockedTerms))
    .filter(e => !isExcludedByProtocol(e, clinicalProtocolId))
    .map(entry => ({ entry, profile: getCatalogEntryNutrition(entry) }))
    .filter(c => c.profile)
    .sort((a, b) => b.entry.universality - a.entry.universality || a.entry.name.localeCompare(b.entry.name, 'bg'));
}

export function buildCatalogPromptSection(options) {
  const candidates = getCatalogCandidatesForChunk(options);
  return formatCatalogSectionForPrompt(candidates, {
    minUniversality: options.minUniversality ?? DEFAULT_MIN_UNIVERSALITY,
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
