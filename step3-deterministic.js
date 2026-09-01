/**
 * Step 3 — изграждане на седмицата от списъка с ястия.
 *
 * За всеки слот от замразената схема се избира ястие от meal-dishes.js, а
 * бекендът мащабира порцията му до целта на слота. Списъкът е универсален —
 * различава се порцията, не ястието.
 *
 * Тук няма сглобяване по макро-роля: измерено, 0 от ~330 хранения минаваха
 * през него, а поддържаше паралелен двигател с правила за съчетаване.
 */

import { getCatalogCandidatesForChunk, resolveCatalogEntry } from './food-catalog.js';
import { rankCatalogCandidates } from './candidate-ranking.js';
import { passesDietRegistry } from './diet-registry.js';
import { normalizeFoodKey } from './food-utils.js';
import { parseMealDescription, achievableKcal } from './food-nutrition.js';
import { isMealCaloriesAdequate } from './plan-normalize.js';
import { READY_MEAL_PARTS } from './ready-meal-parts.js';

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MAIN_MEAL_SLOTS = new Set(['Хранене 1', 'Хранене 2', 'Хранене 4']);
/** Lunch and dinner are plated and must carry a vegetable; breakfast need not. */
const PLATED_MEAL_SLOTS = new Set(['Хранене 2', 'Хранене 4']);

/** Default on — set env DETERMINISTIC_STEP3=0 to force AI-first Step 3. */
export function deterministicStep3Enabled(env = {}) {
  const v = env?.DETERMINISTIC_STEP3;
  if (v === '0' || v === 'false' || v === false) return false;
  return true;
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
  if (slotType === 'Хранене 3') return !!entry.timing?.includes('snack');
  if (slotType === 'Хранене 5') return !!entry.timing?.includes('late_snack');
  return true;
}

/** Products a catalog dish actually puts on the plate. */
function readyMealProducts(entry) {
  const parts = READY_MEAL_PARTS[entry.id] || [];
  return parts.length
    ? parts.map(part => ({ name: part.name, grams: part.grams }))
    : [{ name: entry.name }];
}

/**
 * Избор на ястие за слот.
 *
 * Всяко хранене е ястие от списъка — един и същ универсален списък за всички
 * клиенти. Индивидуалните калории определят само порцията, затова тук се търси
 * ястие, чиято порция може да стигне целта, а не ястие „за този калораж“.
 */
function pickReadyMeal(slotType, slotTarget, candidatesBySlot, ctx) {
  const ready = candidatesBySlot.get('READY') || [];
  let pool = ready.filter(e => readyMealFitsSlot(e, slotType));
  if (!pool.length && slotType === 'Хранене 1') {
    pool = ready.filter(e => e.timing?.includes('main'));
  }
  pool = filterDiet(pool, ctx.dietCtx);
  if (ctx.blockedTerms?.length) {
    pool = pool.filter(e => !readyMealBlocked(e, ctx.blockedTerms));
  }
  if (!pool.length) return null;

  // Предпочитанията стесняват избора, но никога не го изпразват: ако нищо не
  // отговаря, по-добре най-близкото ястие, отколкото никакво.
  // relaxed (plan engine v2): skip energy/veg/no-repeat narrows — still honors diet + blocks.
  const preferred = ctx.relaxed ? [] : [
    p => narrowByEnergyFit(p, slotTarget, ctx.achievableCache),
    p => (PLATED_MEAL_SLOTS.has(slotType)
      ? p.filter(e => readyMealProducts(e).some(x => isVegetableName(x.name)))
      : p),
    p => p.filter(e => !ctx.dishesToday.has(normalizeFoodKey(e.name))),
  ];
  for (const narrow of preferred) {
    const next = narrow(pool);
    if (next.length) pool = next;
  }
  return pickFromPool(pool, ctx, 'READY');
}

/**
 * Ястия, чиято порция наистина улучва слота.
 *
 * Прозорецът на ястието не стига като критерий: „Сандвич с пиле“ носи
 * най-малко 314 kcal и попадаше в следобедна закуска за 154, а овесената каша
 * скача от 339 на 543 kcal, защото 50 г овесени ядки са 195 kcal — целта от
 * 442 просто няма грамаж. Затова изборът пита решателя какво може да достигне.
 *
 * Когато нищо не улучва, връща най-близките: слотът пак трябва да получи
 * ястие, но да е това, което най-малко се разминава, а не произволно.
 */
function narrowByEnergyFit(pool, slotTarget, cache) {
  const targetKcal = Number(slotTarget?.calories) || 0;
  if (targetKcal <= 0) return pool;
  const scored = pool.map(e => ({ e, kcal: dishAchievableKcal(e, targetKcal, cache) }));
  const fits = scored.filter(x => isMealCaloriesAdequate(x.kcal, targetKcal));
  // Първо ястията, които стигат целта. Допускът от 18% значи, че ястие с
  // таван 600 kcal „пасва“ на слот от 722 — три такива слота в един ден и
  // денят излиза 320 kcal по-малко, без нито един слот да е сгрешил.
  // Но само докато остават достатъчно за седмица без повторения: при веган
  // само две ястия стигат обяда и седмицата ставаше от две ястия.
  const carries = fits.filter(x => x.kcal >= targetKcal);
  if (carries.length >= MIN_DISHES_FOR_ENERGY_PREFERENCE) return carries.map(x => x.e);
  if (fits.length) return fits.map(x => x.e);
  return scored
    .sort((a, b) => Math.abs(a.kcal - targetKcal) - Math.abs(b.kcal - targetKcal))
    .slice(0, CLOSEST_DISH_FALLBACK)
    .map(x => x.e);
}

/** Колко ястия остават в играта, когато нито едно не улучва слота. */
const CLOSEST_DISH_FALLBACK = 5;

/**
 * Един слот се появява 7 пъти в седмицата, а договорът за разнообразие иска
 * поне половината хранения да са различни ястия — под четири ястия в избора
 * по-важно е разнообразието, отколкото последните 10% от целта.
 */
const MIN_DISHES_FOR_ENERGY_PREFERENCE = 4;

/**
 * Мащабирането е едно и също за едно ястие и една цел — а се пита за всеки ден
 * от седмицата. Запомня се за една седмица, не в модула: админът може да смени
 * грамажите на ястие през KV и модулен кеш би върнал стари стойности.
 */
function dishAchievableKcal(entry, targetKcal, cache) {
  const key = `${entry.id || entry.name}|${targetKcal}`;
  let kcal = cache?.get(key);
  if (kcal === undefined) {
    kcal = achievableKcal(readyMealProducts(entry), targetKcal);
    cache?.set(key, kcal);
  }
  return kcal;
}

/** A ready meal is blocked when any of its parts is. */
function readyMealBlocked(entry, blockedTerms) {
  if (isBlockedByTerms(entry.name, blockedTerms)) return true;
  const parts = READY_MEAL_PARTS[entry.id] || [];
  return parts.some(p => isBlockedByTerms(p.name, blockedTerms));
}

function isVegetableName(name) {
  return resolveCatalogEntry(name).entry?.group === 'vegetable';
}

/**
 * Record a dish as its component products, not as one opaque name, so usage
 * accounting speaks the same language everywhere.
 */
function recordReadyMealUse(entry, ctx) {
  const dishKey = normalizeFoodKey(entry.name);
  ctx.usedProducts.set(dishKey, (ctx.usedProducts.get(dishKey) || 0) + 1);
  for (const part of READY_MEAL_PARTS[entry.id] || []) {
    const k = normalizeFoodKey(catalogName(part.name) || part.name);
    ctx.usedProducts.set(k, (ctx.usedProducts.get(k) || 0) + 1);
  }
  ctx.dishesToday.add(dishKey);
}


/**
 * Всяко хранене идва от списъка с ястия. Няма втори път за „сглобяване по
 * макро-роля“: измерено, 0 от ~330 хранения минаваха през него, а поддържаше
 * цял паралелен двигател с правила за съчетаване. Ако за някой слот няма
 * подходящо ястие, това е дупка в списъка — тя се съобщава, вместо да се
 * запълва с произволна комбинация продукти.
 */
function buildMealForSchemeSlot({ slotType, slotTarget, candidatesBySlot, ctx, includeDessert = false }) {
  if (slotType === 'Свободно хранене') {
    return { type: slotType, name: 'Свободно хранене' };
  }
  if (slotType === 'Напитка') {
    const drink = catalogName('Зелен чай') || 'Зелен чай';
    return { type: slotType, name: drink, description: `• ${drink}` };
  }

  const dish = pickReadyMeal(slotType, slotTarget, candidatesBySlot, ctx);
  if (!dish) throw new Error(`Няма подходящо ястие за ${slotType}`);
  recordReadyMealUse(dish, ctx);

  const meal = {
    type: slotType,
    name: dish.name,
    // Кое ястие е това: описанието е разгънато на продукти, а бекендът има
    // нужда от декларираната порция, за да мащабира ястието като цяло.
    dishId: dish.id,
    description: descriptionFromReadyMeal(dish),
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
  /** Softer dish filters when strict pick leaves catalog gaps (plan engine v2). */
  relaxed = false,
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
  const achievableCache = new Map();
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
      // Схемата е договорът: тя вече е махнала закуската на клиент, който не
      // закусва. Второ, сляпо махане тук изтриваше и лекото първо хранене,
      // върнато само защото денят не се събира без него.
      if (slot.type === 'Хранене 2' && dayScheme.mealBreakdown.some(m => m.type === 'Свободно хранене')) continue;

      const ctx = {
        seed: Number(seed) || 0,
        dayNum,
        slotIndex,
        slotTarget: slot,
        usedProducts,
        dishesToday,
        achievableCache,
        dietCtx,
        blockedTerms,
        loveSet,
        adherenceRatio,
        relaxed: !!relaxed,
      };

      meals.push(buildMealForSchemeSlot({
        slotType: slot.type,
        slotTarget: slot,
        candidatesBySlot,
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
