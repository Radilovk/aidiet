/**
 * Step 3 deterministic builder — protocol-engine + catalog/solver pipeline.
 * Primary path: frozen weeklyScheme → catalog products → backend gram solver.
 * AI fallback only when validation/sync fails.
 */

import { MEAL_TYPE_TIMING } from './food-catalog-data.js';
import { getCatalogCandidatesForChunk, resolveCatalogEntry } from './food-catalog.js';
import { rankCatalogCandidates } from './candidate-ranking.js';
import { passesDietRegistry } from './diet-registry.js';
import { isVeganUser, userSkipsBreakfast } from './plan-normalize.js';
import { normalizeFoodKey } from './food-utils.js';
import { parseMealDescription } from './food-nutrition.js';

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const MEAL3_PRESETS = [
  { name: 'Кисело мляко с бадеми', description: '• Кисело мляко\n• Бадеми' },
  { name: 'Ябълка с бадеми', description: '• Ябълка\n• Бадеми' },
  { name: 'Банан с орехи', description: '• Банан\n• Орехи' },
];

const MEAL3_VEGAN_PRESETS = [
  { name: 'Банан с бадеми', description: '• Банан\n• Бадеми' },
  { name: 'Ябълка с орехи', description: '• Ябълка\n• Орехи' },
];

const MEAL5_PRESETS = [
  { name: 'Скир с бадеми', description: '• Скир\n• Бадеми' },
  { name: 'Кисело мляко с орехи', description: '• Кисело мляко\n• Орехи' },
  { name: 'Извара с бадеми', description: '• Извара\n• Бадеми' },
];

const MEAL5_VEGAN_PRESETS = [
  { name: 'Бадеми и орехи', description: '• Бадеми\n• Орехи' },
  { name: 'Кашу с бадеми', description: '• Кашу\n• Бадеми' },
];

/** Default on — set env DETERMINISTIC_STEP3=0 to force AI-first Step 3. */
export function deterministicStep3Enabled(env = {}) {
  const v = env?.DETERMINISTIC_STEP3;
  if (v === '0' || v === 'false' || v === false) return false;
  return true;
}

function inferRolesFromTarget(target = {}) {
  if (target.type === 'Хранене 3' || target.type === 'Хранене 5') {
    return ['PRO', 'FAT'];
  }
  const p = Number(target.protein) || 0;
  const c = Number(target.carbs) || 0;
  const f = Number(target.fats) || 0;
  const roles = ['VOL'];
  if (p >= 12) roles.push('PRO');
  if (c >= 15) roles.push('ENG');
  if (f >= 8) roles.push('FAT');
  if (!roles.includes('PRO') && !roles.includes('ENG')) {
    roles.push('PRO', 'ENG');
  }
  return [...new Set(roles)];
}

function catalogName(name) {
  const { entry, unknown } = resolveCatalogEntry(name);
  return unknown ? null : entry.name;
}

function dietContext(strategy, userData) {
  return {
    dietaryModifier: strategy?.dietaryModifier || 'Балансирано',
    dietPreference: userData?.dietPreference ?? null,
    dietDislike: userData?.dietDislike || '',
  };
}

function filterDiet(pool, dietCtx) {
  if (!pool.length) return pool;
  return pool.filter(e => passesDietRegistry(e, dietCtx));
}

function isBlockedByTerms(name, blockedTerms = []) {
  const nameLower = String(name || '').toLowerCase();
  for (const term of blockedTerms) {
    const t = String(term || '').toLowerCase().trim();
    if (t.length < 3) continue;
    if (nameLower.includes(t) || t.includes(nameLower)) return true;
  }
  return false;
}

function collectUsedProducts(previousDays = []) {
  const counts = new Map();
  for (const day of previousDays) {
    for (const meal of day.meals || []) {
      for (const item of parseMealDescription(meal.description)) {
        const k = normalizeFoodKey(item.name);
        if (k) counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
  }
  return counts;
}

function filterByTiming(entries, mealType) {
  const timing = MEAL_TYPE_TIMING[mealType] || 'main';
  return entries.filter(
    e => e.timing?.includes(timing) || e.group === 'condiment' || e.group === 'vegetable' || e.group === 'fruit',
  );
}

function parsePreferLove(userData) {
  return new Set(
    String(userData?.dietLove || '')
      .split(/[,;]/)
      .map(s => normalizeFoodKey(s.trim()))
      .filter(Boolean),
  );
}

function pickFromPool(pool, ctx, roleKey) {
  let filtered = filterDiet(pool, ctx.dietCtx);
  if (!filtered.length) return null;
  const { usedProducts, seed, dayNum, slotIndex, loveSet } = ctx;
  const ranked = rankCatalogCandidates(filtered, {
    slotTarget: ctx.slotTarget,
    maxSlotKcal: Number(ctx.slotTarget?.calories) || 0,
    loveSet,
    adherenceRatio: ctx.adherenceRatio,
    limit: Math.min(filtered.length, 32),
  });
  if (!ranked.length) return null;
  const rotated = [];
  const start = (seed + dayNum * 13 + slotIndex * 7 + roleKey.charCodeAt(0)) % ranked.length;
  for (let i = 0; i < ranked.length; i++) {
    rotated.push(ranked[(start + i) % ranked.length]);
  }
  for (const entry of rotated) {
    const k = normalizeFoodKey(entry.name);
    const uses = usedProducts.get(k) || 0;
    const isLove = loveSet?.has(k);
    const maxUses = isLove ? 4 : 3;
    if (uses < maxUses) return entry;
  }
  return rotated[0];
}

function pickComposition(slotType, slotTarget, candidatesBySlot, ctx) {
  const roles = inferRolesFromTarget({ ...slotTarget, type: slotType });
  const slotKcal = Number(slotTarget.calories) || 0;
  if (slotKcal >= 700 && !roles.includes('FAT')) roles.push('FAT');
  if (slotKcal >= 900 && roles.filter(r => r === 'PRO' || r === 'ENG').length < 2) {
    if (!roles.includes('ENG')) roles.push('ENG');
  }

  const picked = [];
  const seen = new Set();

  for (const role of roles) {
    let pool = filterByTiming(candidatesBySlot.get(role) || [], slotType);
    if (!pool.length) pool = candidatesBySlot.get(role) || [];
    pool = filterDiet(pool, ctx.dietCtx);
    const entry = pickFromPool(pool, { ...ctx, slotTarget }, role);
    if (!entry) continue;
    const k = normalizeFoodKey(entry.name);
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(entry);
  }
  return picked;
}

function mealNameFromEntries(entries, slotType) {
  if (!entries.length) return `Ястие ${slotType}`;
  if (entries.length === 1) return entries[0].name;
  const main = entries.find(e => e.slots?.includes('PRO')) || entries[0];
  const side = entries.find(e => e !== main && (e.slots?.includes('ENG') || e.group === 'vegetable' || e.group === 'carb'));
  if (main && side) return `${main.name} с ${side.name.charAt(0).toLowerCase()}${side.name.slice(1)}`;
  return `${main.name} — ${slotType.replace('Хранене ', 'H')}`;
}

function formatDescription(entries) {
  const lines = [];
  for (const e of entries) {
    const name = catalogName(e.name);
    if (name) lines.push(`• ${name}`);
  }
  return lines.join('\n');
}

function buildLightSnack(slotType, userData, ctx) {
  let presets = slotType === 'Хранене 5'
    ? (isVeganUser(userData) ? MEAL5_VEGAN_PRESETS : MEAL5_PRESETS)
    : (isVeganUser(userData) ? MEAL3_VEGAN_PRESETS : MEAL3_PRESETS);
  if (ctx.blockedTerms?.length) {
    const allowed = presets.filter((preset) => {
      const items = parseMealDescription(preset.description);
      return !items.some((item) => isBlockedByTerms(item.name, ctx.blockedTerms));
    });
    if (allowed.length) presets = allowed;
  }
  // dayNum*3 % 3 === 0 always rotated to the same preset — use coprime multipliers.
  const idx = (ctx.seed + ctx.dayNum * 7 + ctx.slotIndex * 11) % presets.length;
  const preset = presets[idx];
  const desc = preset.description.split('\n')
    .map(line => {
      const raw = line.replace(/^•\s*/, '').trim();
      const resolved = catalogName(raw);
      return resolved ? `• ${resolved}` : line;
    })
    .join('\n');
  return { name: preset.name, description: desc };
}

function buildMealForSchemeSlot({
  slotType,
  slotTarget,
  candidatesBySlot,
  userData,
  ctx,
  includeDessert = false,
}) {
  if (slotType === 'Свободно хранене') {
    return { type: slotType, name: 'Свободно хранене' };
  }
  if (slotType === 'Напитка') {
    const drink = catalogName('Зелен чай') || 'Зелен чай';
    return { type: slotType, name: drink, description: `• ${drink}` };
  }
  if (slotType === 'Хранене 3' || slotType === 'Хранене 5') {
    const light = buildLightSnack(slotType, userData, ctx);
    return { type: slotType, name: light.name, description: light.description };
  }

  const entries = pickComposition(slotType, slotTarget, candidatesBySlot, ctx);
  if (!entries.length) {
    throw new Error(`No catalog candidates for ${slotType}`);
  }
  for (const e of entries) {
    const k = normalizeFoodKey(e.name);
    ctx.usedProducts.set(k, (ctx.usedProducts.get(k) || 0) + 1);
  }
  const meal = {
    type: slotType,
    name: mealNameFromEntries(entries, slotType),
    description: formatDescription(entries),
  };
  if (includeDessert && slotType === 'Хранене 2') meal.dessert = true;
  return meal;
}

/**
 * Build weekPlan chunk from frozen strategy (composition-only — grams via backend solver).
 * @returns {Record<string, { meals: object[] }>}
 */
export function buildDeterministicWeekPlanChunk({
  strategy,
  userData = null,
  startDay = 1,
  endDay = 7,
  previousDays = [],
  seed = 0,
  includeDessert = false,
  clinicalProtocolId = null,
  blockedTerms = [],
}) {
  if (!strategy?.weeklyScheme) {
    throw new Error('Missing strategy.weeklyScheme');
  }

  const dietCtx = dietContext(strategy, userData);
  const loveSet = parsePreferLove(userData);
  const adherenceRatio = userData?._adherenceRatio instanceof Map
    ? userData._adherenceRatio
    : new Map(Object.entries(userData?._adherenceRatio || {}));

  const candidatesBySlot = getCatalogCandidatesForChunk({
    strategy,
    startDay,
    endDay,
    dietaryModifier: strategy?.dietaryModifier || 'Балансирано',
    dietPreference: userData?.dietPreference ?? null,
    dietDislike: userData?.dietDislike || '',
    blockedTerms,
    clinicalProtocolId,
    preferLove: [...loveSet],
    adherenceRatio,
  });

  const usedProducts = collectUsedProducts(previousDays);
  /** @type {Record<string, { meals: object[] }>} */
  const out = {};

  for (let dayNum = startDay; dayNum <= endDay; dayNum++) {
    const schemeKey = DAY_KEYS[dayNum - 1];
    const dayScheme = strategy.weeklyScheme[schemeKey];
    if (!dayScheme?.mealBreakdown?.length) {
      throw new Error(`Missing mealBreakdown for ${schemeKey}`);
    }

    const meals = [];
    let slotIndex = 0;
    for (const slot of dayScheme.mealBreakdown) {
      if (slot.type === 'Хранене 1' && userSkipsBreakfast(userData)) continue;
      if (slot.type === 'Хранене 2' && dayScheme.mealBreakdown.some(m => m.type === 'Свободно хранене')) continue;

      const ctx = {
        seed: Number(seed) || 0,
        dayNum,
        slotIndex,
        slotTarget: slot,
        usedProducts,
        dietCtx,
        blockedTerms,
        loveSet,
        adherenceRatio,
      };

      meals.push(buildMealForSchemeSlot({
        slotType: slot.type,
        slotTarget: slot,
        candidatesBySlot,
        userData,
        ctx,
        includeDessert,
      }));
      slotIndex++;
    }

    meals.sort((a, b) => {
      const order = { 'Напитка': 0, 'Хранене 1': 0, 'Хранене 2': 1, 'Свободно хранене': 1, 'Хранене 3': 2, 'Хранене 4': 3, 'Хранене 5': 4 };
      return (order[a.type] ?? 9) - (order[b.type] ?? 9);
    });

    out[`day${dayNum}`] = { meals };
  }

  return out;
}
