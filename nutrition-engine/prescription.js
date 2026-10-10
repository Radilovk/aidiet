/**
 * Предписание: калории и макроси → обменни порции за деня → порции по хранене.
 *
 * Това е класическото изчисление на хранителна схема с обменни листи
 * (Mahan, Krause's Food & the Nutrition Care Process; ADA/AND Choose Your
 * Foods): първо се задават зеленчуците, плодовете и млечните по
 * препоръките на модела, после зърнените покриват оставащите въглехидрати,
 * белтъчните — оставащия белтък, мазнините — оставащите мазнини. Накрая
 * порциите се разпределят по храненията на клиента.
 */

import { GROUPS, KCAL_LEVELS, DISTRIBUTIONS, MEAL_BOUNDS } from './knowledge.js';

export const PLANNED_GROUPS = ['STA', 'FRU', 'MLK', 'VEG', 'PRO', 'FAT', 'SWT'];
const MACROS = ['protein', 'carbs', 'fats'];

const roundHalf = x => Math.round(x * 2) / 2;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function interpolate(values, kcal) {
  const levels = KCAL_LEVELS;
  if (kcal <= levels[0]) return values[0];
  for (let i = 1; i < levels.length; i++) {
    if (kcal <= levels[i]) {
      const t = (kcal - levels[i - 1]) / (levels[i] - levels[i - 1]);
      return values[i - 1] + t * (values[i] - values[i - 1]);
    }
  }
  // Над последното ниво — продължава със същия наклон.
  const n = levels.length - 1;
  const slope = (values[n] - values[n - 1]) / (levels[n] - levels[n - 1]);
  return values[n] + slope * (kcal - levels[n]);
}

function standardSum(daily, key) {
  return Object.entries(daily).reduce((sum, [g, n]) => sum + n * (GROUPS[g]?.standard?.[key] || 0), 0);
}

/**
 * Дневни обменни порции.
 * @param {{ kcal: number, macros: { protein: number, carbs: number, fats: number }, extraVeg?: number }} target
 * @param {ReturnType<typeof import('./policy.js').buildFoodPolicy>} policy
 */
export function dailyExchanges(target, policy) {
  const { kcal, macros } = target;
  const s = policy.styleDef;
  const bound = (g) => s.bounds?.[g] || [0, 99];

  /** @type {Record<string, number>} */
  const daily = {
    VEG: roundHalf(interpolate(s.anchors.VEG, kcal)) + (Number(target.extraVeg) || 0),
    FRU: policy.hasAllowed('FRU') ? roundHalf(interpolate(s.anchors.FRU, kcal)) : 0,
    MLK: policy.hasAllowed('MLK')
      ? roundHalf(interpolate(s.anchors.MLK, kcal) + (s.anchors.MLK.some(v => v > 0) ? (policy.extraServings.MLK || 0) : 0))
      : 0,
    SWT: 0, // десертът е отделен от схемата — планировчикът го добавя към обяда
  };

  // Когато зеленчуците и плодовете сами надхвърлят въглехидратите (кето),
  // първо отпадат плодовете, после млечните; зеленчуците остават поне 2.
  while (standardSum(daily, 'carbs') > macros.carbs && (daily.FRU > 0 || daily.MLK > 0 || daily.VEG > 2)) {
    if (daily.FRU > 0) daily.FRU -= 0.5;
    else if (daily.MLK > 0) daily.MLK -= 0.5;
    else daily.VEG -= 0.5;
  }

  const [staMin, staMax] = bound('STA');
  daily.STA = policy.hasAllowed('STA')
    ? clamp(roundHalf((macros.carbs - standardSum(daily, 'carbs')) / GROUPS.STA.standard.carbs), staMin, staMax)
    : 0;
  const [proMin, proMax] = bound('PRO');
  daily.PRO = clamp(roundHalf((macros.protein - standardSum(daily, 'protein')) / GROUPS.PRO.standard.protein), proMin, proMax);
  const [fatMin, fatMax] = bound('FAT');
  daily.FAT = clamp(roundHalf((macros.fats - standardSum(daily, 'fats')) / GROUPS.FAT.standard.fats), fatMin, fatMax);
  return daily;
}

/**
 * Разпределя total между храненията по тегла, в границите им, на стъпка 0.5.
 * @returns {{ amounts: number[], overflow: number }}
 */
function allocate(total, weights, bounds) {
  const n = weights.length;
  let w = weights.map((x, i) => (bounds[i][1] > 0 ? Math.max(0, x) : 0));
  if (w.reduce((a, b) => a + b, 0) <= 0) w = bounds.map(b => b[1]);
  const amounts = bounds.map(b => b[0]);
  let left = total - amounts.reduce((a, b) => a + b, 0);
  for (let pass = 0; pass < 12 && left > 1e-9; pass++) {
    const open = [...Array(n).keys()].filter(i => amounts[i] < bounds[i][1] - 1e-9);
    if (!open.length) break;
    let wsum = open.reduce((a, i) => a + w[i], 0);
    const weightOf = i => (wsum > 0 ? w[i] / wsum : 1 / open.length);
    let used = 0;
    for (const i of open) {
      const give = Math.min(bounds[i][1] - amounts[i], left * weightOf(i));
      amounts[i] += give;
      used += give;
    }
    left -= used;
    if (wsum <= 0) wsum = 1;
  }
  // Към стъпка 0.5: надолу, после остатъкът по най-големите остатъци.
  const floored = amounts.map(a => Math.floor(a * 2 + 1e-9) / 2);
  const target = roundHalf(Math.min(total, amounts.reduce((a, b) => a + b, 0)));
  let halves = Math.round((target - floored.reduce((a, b) => a + b, 0)) * 2);
  const order = [...Array(n).keys()].sort((a, b) => (amounts[b] - floored[b]) - (amounts[a] - floored[a]));
  for (const i of order) {
    if (halves <= 0) break;
    if (floored[i] + 0.5 <= bounds[i][1] + 1e-9) { floored[i] += 0.5; halves--; }
  }
  return { amounts: floored, overflow: Math.max(0, roundHalf(left)) };
}

/** Храненето, което се добавя, когато порциите не се побират в избраните. */
function extraSlot(slots, skipsBreakfast) {
  const order = skipsBreakfast
    ? ['Хранене 3', 'Хранене 5', 'Хранене 1']
    : ['Хранене 3', 'Хранене 1', 'Хранене 5'];
  return order.find(s => !slots.includes(s)) || null;
}

/** Над тези калории таваните на храненията растат пропорционално. */
const BOUNDS_BASE_KCAL = 2400;

const SLOT_ORDER = ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5'];

/**
 * Порции по хранене за деня.
 * @param {Record<string, number>} daily
 * @param {string[]} slots
 * @param {ReturnType<typeof import('./policy.js').buildFoodPolicy>} policy
 * @param {{ skipsBreakfast?: boolean, kcal?: number }} [options]
 */
export function distributeExchanges(daily, slots, policy, options = {}) {
  const dist = DISTRIBUTIONS[policy.distribution] || DISTRIBUTIONS.standard;
  // По-голям енергиен разход — по-големи хранения: таваните растат над 2400 kcal.
  const appetite = Math.max(1, (Number(options.kcal) || 0) / BOUNDS_BASE_KCAL);
  let current = [...slots];
  const added = [];

  for (let attempt = 0; ; attempt++) {
    /** @type {Record<string, Record<string, number>>} */
    const quotas = Object.fromEntries(current.map(s => [s, {}]));
    let overflow = 0;
    for (const g of PLANNED_GROUPS) {
      const total = daily[g] || 0;
      const weights = current.map(s => dist[s]?.[g] ?? 0);
      const bounds = current.map(s => {
        const [lo, base] = MEAL_BOUNDS[s]?.[g] || [0, 0];
        // При кето и нисковъглехидратно мазнините носят енергията — таванът им расте.
        const fatScale = g === 'FAT' ? (policy.styleDef.fatPartScale || 1) : 1;
        const hi = g === 'SWT' ? base : roundHalf(base * appetite * fatScale);
        const cap = g === 'FAT' && policy.mealFatMax[s] != null ? Math.min(hi, policy.mealFatMax[s]) : hi;
        // Долните граници важат само когато групата изобщо е в деня.
        return [total > 0 ? Math.min(lo, cap) : 0, cap];
      });
      const { amounts, overflow: over } = allocate(total, weights, bounds);
      current.forEach((s, i) => { quotas[s][g] = amounts[i]; });
      overflow += over;
    }
    const extra = overflow >= 0.5 ? extraSlot(current, options.skipsBreakfast) : null;
    if (!extra) return { quotas, slots: current, added, overflow };
    current = SLOT_ORDER.filter(s => current.includes(s) || s === extra);
    added.push(extra);
  }
}

/** Целта на храненето от порциите му (стандартните стойности на групите). */
export function quotaTarget(quota) {
  const t = { protein: 0, carbs: 0, fats: 0 };
  for (const [g, n] of Object.entries(quota)) {
    const std = GROUPS[g]?.standard;
    if (!std) continue;
    for (const k of MACROS) t[k] += n * std[k];
  }
  return t;
}

/**
 * Пълното предписание за деня.
 * @param {{ kcal: number, macros: { protein: number, carbs: number, fats: number } }} target
 * @param {string[]} slots
 * @param {ReturnType<typeof import('./policy.js').buildFoodPolicy>} policy
 * @param {{ skipsBreakfast?: boolean, extraVeg?: number }} [options]
 */
export function prescribe(target, slots, policy, options = {}) {
  const daily = dailyExchanges({ ...target, extraVeg: options.extraVeg }, policy);
  const { quotas, slots: finalSlots, added } = distributeExchanges(daily, slots, policy, { ...options, kcal: target.kcal });

  // Целите по хранене идват от порциите, после всеки макрос се мащабира, за
  // да съвпадне денят точно с предписаните грамове.
  const raw = Object.fromEntries(finalSlots.map(s => [s, quotaTarget(quotas[s])]));
  const scale = {};
  for (const k of MACROS) {
    const sum = finalSlots.reduce((a, s) => a + raw[s][k], 0);
    scale[k] = sum > 0 ? target.macros[k] / sum : 0;
  }
  const meals = {};
  for (const s of finalSlots) {
    const t = Object.fromEntries(MACROS.map(k => [k, raw[s][k] * scale[k]]));
    meals[s] = {
      quota: quotas[s],
      target: { ...t, kcal: t.protein * 4 + t.carbs * 4 + t.fats * 9 },
    };
  }
  return { kcal: target.kcal, macros: target.macros, daily, slots: finalSlots, addedSlots: added, meals };
}
