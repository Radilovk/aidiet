/**
 * Deterministic meal gram solver — improves kcal + P + C + F simultaneously.
 * Replaces uniform scaling, bulk caps, protein nudges, and weight trim chain.
 */

export const GRAM_STEP_SMALL = 10;
export const GRAM_STEP_LARGE = 50;
export const GRAM_LARGE_THRESHOLD = 50;

/** kcal is the hard constraint; macros are soft. */
const W_KCAL = 3;
const W_PROTEIN = 1.5;
const W_CARBS = 1;
const W_FATS = 1;
const MAX_ITERATIONS = 500;

export function totalsFor(items, grams) {
  let p = 0;
  let c = 0;
  let f = 0;
  for (let i = 0; i < items.length; i++) {
    const q = grams[i] / 100;
    const pr = items[i].profile;
    p += pr.p * q;
    c += pr.c * q;
    f += pr.f * q;
  }
  return { kcal: p * 4 + c * 4 + f * 9, p, c, f, grams: grams.reduce((a, b) => a + b, 0) };
}

function cost(items, grams, target, maxTotalGrams) {
  const t = totalsFor(items, grams);
  let e = W_KCAL * Math.abs(t.kcal - target.kcal) / Math.max(target.kcal, 1);
  if (target.p > 0) e += W_PROTEIN * Math.abs(t.p - target.p) / target.p;
  if (target.c > 0) e += W_CARBS * Math.abs(t.c - target.c) / target.c;
  if (target.f > 0) e += W_FATS * Math.abs(t.f - target.f) / target.f;
  if (t.grams > maxTotalGrams) e += 5 * (t.grams - maxTotalGrams) / maxTotalGrams;
  return e;
}

function kcalOnlyCost(items, grams, target, maxTotalGrams) {
  const t = totalsFor(items, grams);
  let e = Math.abs(t.kcal - target.kcal) / Math.max(target.kcal, 1);
  if (t.grams > maxTotalGrams) e += 5 * (t.grams - maxTotalGrams) / maxTotalGrams;
  return e;
}

function refineGrams(items, grams, bounds, target, maxTotalGrams, costFn) {
  let best = costFn(items, grams, target, maxTotalGrams);
  const inBounds = (cand, i) => cand[i] >= bounds[i].min && cand[i] <= bounds[i].max;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let move = null;

    for (let i = 0; i < items.length; i++) {
      for (const st of [GRAM_STEP_SMALL, GRAM_STEP_LARGE]) {
        for (const dir of [1, -1]) {
          const cand = grams.slice();
          cand[i] += st * dir;
          if (!inBounds(cand, i)) continue;
          const e = costFn(items, cand, target, maxTotalGrams);
          if (e < best - 1e-9) { best = e; move = cand; }
        }
      }
    }

    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        for (const st of [GRAM_STEP_SMALL, GRAM_STEP_LARGE]) {
          const cand = grams.slice();
          cand[i] += st;
          cand[j] -= st;
          if (!inBounds(cand, i) || !inBounds(cand, j)) continue;
          const e = costFn(items, cand, target, maxTotalGrams);
          if (e < best - 1e-9) { best = e; move = cand; }
        }
      }
    }

    if (!move) break;
    grams = move;
  }
  return { grams, best };
}

/**
 * @param {Array<{name:string, profile:{p:number,c:number,f:number}, grams:number}>} items
 * @param {{kcal:number,p:number,c:number,f:number}} target
 * @param {Array<{min:number,max:number}>} bounds
 * @param {number} maxTotalGrams
 */
export function solveMealGrams(items, target, bounds, maxTotalGrams = 900) {
  if (!items.length || !(target.kcal > 0)) {
    return { grams: items.map(i => i.grams), feasible: false, reason: 'липсва цел или продукти' };
  }

  let grams = items.map((it, i) =>
    Math.min(bounds[i].max, Math.max(bounds[i].min, Math.round(it.grams / 10) * 10)));
  ({ grams } = refineGrams(items, grams, bounds, target, maxTotalGrams, cost));
  let best = cost(items, grams, target, maxTotalGrams);

  const snapped = grams.map(g =>
    g > GRAM_LARGE_THRESHOLD ? Math.round(g / 50) * 50 : Math.round(g / 10) * 10);
  if (snapped.every((g, i) => g >= bounds[i].min && g <= bounds[i].max)
      && cost(items, snapped, target, maxTotalGrams) <= best + 0.02) {
    grams = snapped;
  }

  let t = totalsFor(items, grams);
  let kcalOk = Math.abs(t.kcal - target.kcal) <= Math.max(30, target.kcal * 0.10);
  if (!kcalOk) {
    const expanded = bounds.map(b => ({
      min: b.min,
      max: Math.min(650, Math.round(b.max * 1.2)),
    }));
    ({ grams } = refineGrams(items, grams, expanded, target, maxTotalGrams, kcalOnlyCost));
    t = totalsFor(items, grams);
    kcalOk = Math.abs(t.kcal - target.kcal) <= Math.max(30, target.kcal * 0.10);
  }

  const residual = {
    kcal: t.kcal - target.kcal,
    p: t.p - target.p,
    c: t.c - target.c,
    f: t.f - target.f,
  };
  const weightOk = t.grams <= maxTotalGrams;

  return {
    grams,
    totals: t,
    residual,
    feasible: kcalOk && weightOk,
    reason: !kcalOk ? 'калориите не се постигат с тази композиция'
      : !weightOk ? 'тегло над тавана'
        : '',
  };
}
