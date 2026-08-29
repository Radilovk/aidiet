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
import { parseMealDescription, compositionCapacity } from './food-nutrition.js';
import { READY_MEAL_PARTS } from './ready-meal-parts.js';
import { checkProductCompatibility } from './meal-compatibility.js';

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MAIN_MEAL_SLOTS = new Set(['Хранене 1', 'Хранене 2', 'Хранене 4']);
/**
 * A dish is at most this many products — beyond that it reads as a buffet.
 * Larger slots get one more: an 800 kcal dinner genuinely needs four or five
 * components once every portion is capped at a realistic serving.
 */
function maxProductsForSlot(slotTarget) {
  return (Number(slotTarget?.calories) || 0) >= 650 ? 5 : 4;
}
/** Lunch and dinner are plated and must carry a vegetable; breakfast need not. */
const PLATED_MEAL_SLOTS = new Set(['Хранене 2', 'Хранене 4']);

/**
 * Light-snack presets. Each carries the diets it suits, so a keto client is not
 * handed a third of a banana and a vegan is not handed skyr — the solver used
 * to shrink the wrong preset into an absurd portion instead of picking another.
 */
const LIGHT_SNACK_PRESETS = {
  'Хранене 3': [
    { name: 'Кисело мляко с бадеми', products: ['Кисело мляко', 'Бадеми'], vegan: false, keto: true },
    { name: 'Ябълка с бадеми', products: ['Ябълка', 'Бадеми'], vegan: true, keto: false },
    { name: 'Банан с орехи', products: ['Банан', 'Орехи'], vegan: true, keto: false },
    { name: 'Извара с орехи', products: ['Извара', 'Орехи'], vegan: false, keto: true },
    { name: 'Портокал с кашу', products: ['Портокал', 'Кашу'], vegan: true, keto: false },
    { name: 'Хумус с моркови', products: ['Хумус', 'Морков'], vegan: true, keto: false },
    { name: 'Бадеми и тиквени семки', products: ['Бадеми', 'Тиквени семки'], vegan: true, keto: true },
    { name: 'Авокадо с орехи', products: ['Авокадо', 'Орехи'], vegan: true, keto: true },
  ],
  'Хранене 5': [
    { name: 'Скир с бадеми', products: ['Скир', 'Бадеми'], vegan: false, keto: true },
    { name: 'Кисело мляко с орехи', products: ['Кисело мляко', 'Орехи'], vegan: false, keto: true },
    { name: 'Извара с бадеми', products: ['Извара', 'Бадеми'], vegan: false, keto: true },
    { name: 'Бадеми и орехи', products: ['Бадеми', 'Орехи'], vegan: true, keto: true },
    { name: 'Кашу с бадеми', products: ['Кашу', 'Бадеми'], vegan: true, keto: true },
    { name: 'Тиквени семки с лешници', products: ['Тиквени семки', 'Лешници'], vegan: true, keto: true },
  ],
};

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
    e => e.timing?.includes(timing) || e.group === 'vegetable' || e.group === 'fruit',
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

/**
 * Pick the least-used eligible entry, breaking ties by rank and a per-slot
 * rotation offset. The old rule ("skip anything used 3 times, else take the
 * first") collapsed to a handful of foods once the pool was exhausted; ranking
 * by usage keeps the whole pool in play all week.
 */
function pickFromPool(pool, ctx, roleKey, { exclude = null } = {}) {
  let filtered = filterDiet(pool, ctx.dietCtx);
  if (exclude?.size) {
    const withoutExcluded = filtered.filter(e => !exclude.has(normalizeFoodKey(e.name)));
    if (withoutExcluded.length) filtered = withoutExcluded;
  }
  if (!filtered.length) return null;
  const { usedProducts, seed, dayNum, slotIndex, loveSet } = ctx;
  const ranked = rankCatalogCandidates(filtered, {
    role: roleKey === 'READY' ? undefined : roleKey,
    slotTarget: ctx.slotTarget,
    maxSlotKcal: Number(ctx.slotTarget?.calories) || 0,
    loveSet,
    adherenceRatio: ctx.adherenceRatio,
    limit: Math.min(filtered.length, 32),
  });
  if (!ranked.length) return null;

  const start = (seed + dayNum * 13 + slotIndex * 7 + roleKey.charCodeAt(0)) % ranked.length;
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < ranked.length; i++) {
    const entry = ranked[(start + i) % ranked.length];
    const key = normalizeFoodKey(entry.name);
    const uses = usedProducts.get(key) || 0;
    // A favourite may recur once more often than the rest before it is passed over.
    const score = uses - (loveSet?.has(key) ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = entry;
      if (bestScore <= 0) break;
    }
  }
  return best;
}

function descriptionFromReadyMeal(entry) {
  const parts = READY_MEAL_PARTS[entry.id];
  if (parts?.length) {
    const lines = parts
      .map(p => {
        const n = catalogName(p.name);
        return n ? `• ${n}` : null;
      })
      .filter(Boolean);
    if (lines.length) return lines.join('\n');
  }
  const single = catalogName(entry.name);
  return single ? `• ${single}` : `• ${entry.name}`;
}

function readyMealFitsSlot(entry, slotType) {
  const slots = entry.slots || [];
  if (slotType === 'Хранене 2' || slotType === 'Хранене 4') {
    return slots.includes('PRO') || slots.includes('ENG');
  }
  if (slotType === 'Хранене 1') return !!entry.timing?.includes('breakfast');
  return true;
}

function pickReadyMeal(slotType, candidatesBySlot, ctx) {
  const ready = candidatesBySlot.get('READY') || [];
  let pool = ready.filter(e => readyMealFitsSlot(e, slotType));
  if (!pool.length && slotType === 'Хранене 1') {
    pool = ready.filter(e => e.timing?.includes('main'));
  }
  pool = filterByTiming(pool, slotType);
  pool = filterDiet(pool, ctx.dietCtx);
  if (ctx.blockedTerms?.length) {
    pool = pool.filter(e => !readyMealBlocked(e, ctx.blockedTerms));
  }
  pool = pool.filter(e => !checkProductCompatibility(
    (READY_MEAL_PARTS[e.id] || []).map(part => part.name),
  ).length);
  if (!pool.length) return null;
  // Never the same dish twice in one day, however short the pool.
  return pickFromPool(pool, ctx, 'READY', { exclude: ctx.dishesToday });
}

/** A ready meal is blocked when any of its parts is. */
function readyMealBlocked(entry, blockedTerms) {
  if (isBlockedByTerms(entry.name, blockedTerms)) return true;
  const parts = READY_MEAL_PARTS[entry.id] || [];
  return parts.some(p => isBlockedByTerms(p.name, blockedTerms));
}

function filterEngPoolForSlot(pool, slotType) {
  if (slotType === 'Хранене 2' || slotType === 'Хранене 4') {
    return pool.filter(e => e.group !== 'fruit');
  }
  return pool;
}

function isVolEntry(entry) {
  return entry?.slots?.includes('VOL') || entry?.group === 'vegetable';
}

function isProEntry(entry) {
  return entry?.slots?.includes('PRO') || ['protein', 'dairy', 'legume'].includes(entry?.group);
}

function isEngEntry(entry) {
  return entry?.slots?.includes('ENG') || entry?.group === 'carb';
}

/**
 * At most one protein and one starch, always keeping the vegetable.
 * The vegetable is selected first rather than re-inserted afterwards — the old
 * `unshift` put back an entry the protein/starch pass had deliberately dropped.
 */
function consolidateComposition(entries) {
  if (entries.length <= 1) return entries;
  const veg = entries.find(e => isVolEntry(e) && !isProEntry(e) && !isEngEntry(e));
  const out = veg ? [veg] : [];
  let hasPro = false;
  let hasEng = false;
  for (const e of entries) {
    if (e === veg) continue;
    if (isProEntry(e)) {
      if (hasPro) continue;
      hasPro = true;
    } else if (isEngEntry(e)) {
      if (hasEng) continue;
      hasEng = true;
    } else if (isVolEntry(e) && veg) {
      continue;
    }
    out.push(e);
  }
  return out.length ? out.slice(0, 4) : entries.slice(0, 3);
}

/**
 * Pick a candidate that does not clash with what is already on the plate.
 * Compatibility is checked while composing, not only afterwards — a validator
 * that runs at the end can reject a meal but cannot build a better one.
 */
function pickCompatible(pool, ctx, role, seen, picked) {
  const chosenNames = picked.map(e => e.name);
  const rejected = new Set(seen);
  for (let attempt = 0; attempt < 6; attempt++) {
    const entry = pickFromPool(pool, ctx, role, { exclude: rejected });
    if (!entry) return null;
    const issues = checkProductCompatibility([...chosenNames, entry.name], {
      allowSweetener: ctx.slotTarget?.type === 'Хранене 3' || ctx.slotTarget?.type === 'Хранене 5',
    });
    if (!issues.length) return entry;
    rejected.add(normalizeFoodKey(entry.name));
  }
  return null;
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
    if (role === 'ENG') pool = filterEngPoolForSlot(pool, slotType);
    if (!pool.length) pool = candidatesBySlot.get(role) || [];
    if (role === 'ENG') pool = filterEngPoolForSlot(pool, slotType);
    pool = filterDiet(pool, ctx.dietCtx);
    if (ctx.blockedTerms?.length) {
      const allowed = pool.filter(e => !isBlockedByTerms(e.name, ctx.blockedTerms));
      if (allowed.length) pool = allowed;
    }
    const entry = pickCompatible(pool, { ...ctx, slotTarget }, role, seen, picked);
    if (!entry) continue;
    const k = normalizeFoodKey(entry.name);
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(entry);
  }
  return consolidateComposition(picked);
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

function isKetoContext(ctx) {
  return /кето|keto/i.test(String(ctx?.dietCtx?.dietaryModifier || ''));
}

function buildLightSnack(slotType, userData, ctx) {
  const all = LIGHT_SNACK_PRESETS[slotType] || LIGHT_SNACK_PRESETS['Хранене 3'];
  const vegan = isVeganUser(userData);
  const keto = isKetoContext(ctx);

  let presets = all.filter(preset => (!vegan || preset.vegan) && (!keto || preset.keto));
  if (!presets.length) presets = all.filter(preset => !vegan || preset.vegan);
  if (!presets.length) presets = all;

  if (ctx.blockedTerms?.length) {
    const allowed = presets.filter(
      preset => !preset.products.some(name => isBlockedByTerms(name, ctx.blockedTerms)),
    );
    if (allowed.length) presets = allowed;
  }
  // Every product must exist in the catalog, or the slot fails validation later.
  const resolvable = presets.filter(preset => preset.products.every(name => catalogName(name)));
  if (resolvable.length) presets = resolvable;

  // Rotate by least-used, so a week never repeats one snack seven times.
  const start = (ctx.seed + ctx.dayNum * 7 + ctx.slotIndex * 11) % presets.length;
  let chosen = presets[start];
  let bestUses = Infinity;
  for (let i = 0; i < presets.length; i++) {
    const preset = presets[(start + i) % presets.length];
    const uses = preset.products.reduce(
      (sum, name) => sum + (ctx.usedProducts.get(normalizeFoodKey(name)) || 0), 0,
    );
    if (uses < bestUses) {
      bestUses = uses;
      chosen = preset;
      if (bestUses === 0) break;
    }
  }

  const resolved = chosen.products.map(name => catalogName(name) || name);
  for (const name of resolved) {
    const k = normalizeFoodKey(name);
    ctx.usedProducts.set(k, (ctx.usedProducts.get(k) || 0) + 1);
  }
  return { name: chosen.name, description: resolved.map(n => `• ${n}`).join('\n') };
}

/**
 * Record a ready meal as its component products, not as one opaque dish name.
 * Usage accounting has to speak the same language everywhere, or a week of
 * "Ориз с пиле" and "Пилешки гърди с ориз" reads as two unrelated choices.
 */
function recordReadyMealUse(entry, ctx) {
  ctx.usedProducts.set(
    normalizeFoodKey(entry.name),
    (ctx.usedProducts.get(normalizeFoodKey(entry.name)) || 0) + 1,
  );
  for (const part of READY_MEAL_PARTS[entry.id] || []) {
    const k = normalizeFoodKey(catalogName(part.name) || part.name);
    ctx.usedProducts.set(k, (ctx.usedProducts.get(k) || 0) + 1);
  }
  ctx.dishesToday.add(normalizeFoodKey(entry.name));
}

/**
 * A plated main meal must carry a vegetable. Ready meals that are a single
 * ingredient (an omelette, porridge) get one added from the VOL pool so a week
 * of main meals is not seven plates of protein on their own.
 */
function ensureVegetableInMain(slotType, description, candidatesBySlot, ctx) {
  if (!PLATED_MEAL_SLOTS.has(slotType)) return description;
  const items = parseMealDescription(description);
  if (items.length >= maxProductsForSlot(ctx.slotTarget)) return description;
  if (items.some(item => isVolEntry(resolveCatalogEntry(item.name).entry))) return description;

  let pool = filterByTiming(candidatesBySlot.get('VOL') || [], slotType);
  if (!pool.length) pool = candidatesBySlot.get('VOL') || [];
  pool = filterDiet(pool, ctx.dietCtx).filter(e => e.group !== 'ready_meal');
  if (ctx.blockedTerms?.length) {
    const allowed = pool.filter(e => !isBlockedByTerms(e.name, ctx.blockedTerms));
    if (allowed.length) pool = allowed;
  }
  const existing = items.map(i => i.name);
  const veg = pickCompatible(pool, ctx, 'VOL', new Set(existing.map(normalizeFoodKey)),
    existing.map(name => ({ name })));
  if (!veg) return description;

  const name = catalogName(veg.name);
  if (!name) return description;
  ctx.usedProducts.set(normalizeFoodKey(name), (ctx.usedProducts.get(normalizeFoodKey(name)) || 0) + 1);
  return `${description}\n• ${name}`;
}

/** Roles to try when a slot needs more energy, most calorie-dense first. */
const ENERGY_FILL_ROLES = ['FAT', 'PRO', 'ENG'];

/**
 * Close an energy gap by adding a component, never by over-serving one.
 * A 470 kcal lunch of chicken and broccoli is reached with a starch or a fat,
 * not with 400 g of chicken — the portion ceilings make that explicit, so the
 * composer has to answer with a product instead.
 */
function fillEnergyGap(slotType, slotTarget, description, candidatesBySlot, ctx) {
  const targetKcal = Number(slotTarget?.calories) || 0;
  if (targetKcal <= 0) return description;

  let current = description;
  for (let added = 0; added < 2; added++) {
    const names = parseMealDescription(current).map(item => item.name);
    if (names.length >= maxProductsForSlot(slotTarget)) break;
    const { maxKcal } = compositionCapacity(names, { kcal: targetKcal });
    if (maxKcal >= targetKcal * 1.02) break;

    const taken = new Set(names.map(normalizeFoodKey));
    let picked = null;
    // Track capacity locally — catalog entries are shared objects and must
    // never be annotated with per-call state.
    let bestCapacity = maxKcal;
    for (const role of ENERGY_FILL_ROLES) {
      let pool = filterByTiming(candidatesBySlot.get(role) || [], slotType);
      if (role === 'ENG') pool = filterEngPoolForSlot(pool, slotType);
      if (!pool.length) pool = candidatesBySlot.get(role) || [];
      pool = filterDiet(pool, ctx.dietCtx);
      if (ctx.blockedTerms?.length) {
        const allowed = pool.filter(e => !isBlockedByTerms(e.name, ctx.blockedTerms));
        if (allowed.length) pool = allowed;
      }
      const candidates = pool.filter(e => e.group !== 'ready_meal');
      const rejected = new Set(taken);
      for (let tries = 0; tries < 4; tries++) {
        const entry = pickCompatible(
          candidates, { ...ctx, slotTarget }, role, rejected, names.map(name => ({ name })),
        );
        if (!entry) break;
        const withEntry = compositionCapacity([...names, entry.name], { kcal: targetKcal });
        if (withEntry.maxKcal > bestCapacity) {
          bestCapacity = withEntry.maxKcal;
          picked = entry;
        }
        if (bestCapacity >= targetKcal * 1.05) break;
        rejected.add(normalizeFoodKey(entry.name));
      }
      if (bestCapacity >= targetKcal * 1.05) break;
    }
    if (!picked) break;

    const name = catalogName(picked.name);
    if (!name) break;
    ctx.usedProducts.set(normalizeFoodKey(name), (ctx.usedProducts.get(normalizeFoodKey(name)) || 0) + 1);
    current = `${current}\n• ${name}`;
  }
  return current;
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


  if (MAIN_MEAL_SLOTS.has(slotType)) {
    const ready = pickReadyMeal(slotType, candidatesBySlot, ctx);
    if (ready) {
      recordReadyMealUse(ready, ctx);
      const meal = {
        type: slotType,
        name: ready.name,
        description: fillEnergyGap(
          slotType, slotTarget,
          ensureVegetableInMain(slotType, descriptionFromReadyMeal(ready), candidatesBySlot, ctx),
          candidatesBySlot, ctx,
        ),
      };
      if (includeDessert && slotType === 'Хранене 2') meal.dessert = true;
      return meal;
    }
  }

  const entries = pickComposition(slotType, slotTarget, candidatesBySlot, ctx);
  if (!entries.length) {
    throw new Error(`No catalog candidates for ${slotType}`);
  }
  for (const e of entries) {
    const k = normalizeFoodKey(e.name);
    ctx.usedProducts.set(k, (ctx.usedProducts.get(k) || 0) + 1);
  }
  const name = mealNameFromEntries(entries, slotType);
  ctx.dishesToday.add(normalizeFoodKey(name));
  const meal = {
    type: slotType,
    name,
    description: fillEnergyGap(
      slotType, slotTarget,
      ensureVegetableInMain(slotType, formatDescription(entries), candidatesBySlot, ctx),
      candidatesBySlot, ctx,
    ),
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
    // Reset per day so a dish can recur across the week but never within a day.
    const dishesToday = new Set();
    for (const slot of dayScheme.mealBreakdown) {
      if (slot.type === 'Хранене 1' && userSkipsBreakfast(userData)) continue;
      if (slot.type === 'Хранене 2' && dayScheme.mealBreakdown.some(m => m.type === 'Свободно хранене')) continue;

      const ctx = {
        seed: Number(seed) || 0,
        dayNum,
        slotIndex,
        slotTarget: slot,
        usedProducts,
        dishesToday,
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
