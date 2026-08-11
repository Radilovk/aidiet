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
  let hasLateSnack = false;
  let minFatShare = 1;
  let minCarbShare = 1;
  const isKeto = /кето|keto/i.test(String(dietaryModifier || ''));

  const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
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
    `Стойности в скоби = на 100g. Бекендът изчислява грамажите — не пиши числа в description.`,
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
    lines.push(`Готови ястия (backend разбива на сурови продукти при синхрон):`);
    for (const item of ready) {
      lines.push(`  • ${formatCatalogEntryLabel(item)}`);
    }
  }

  lines.push(`НЕ използвай продукти извън каталога. Подправки — макс 10–15g, не като основен макроизточник.`);
  return lines.join('\n');
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
