/** Shared gram snapping: <50g → 5g steps; ≥50g → 50g steps (50, 100, 150…). */

export const GRAM_STEP_SMALL = 5;
export const GRAM_STEP_LARGE = 50;
export const GRAM_LARGE_MIN = 50;

export function gramRoundStep(grams) {
  return (Number(grams) || 0) >= GRAM_LARGE_MIN ? GRAM_STEP_LARGE : GRAM_STEP_SMALL;
}

/**
 * Step size for one item, from how large a serving of it can be.
 * A flat 50 g grid is one quantum of ~190 kcal for oats, so a slot that needed
 * 85 g could only be served 50 g or 100 g and read as unreachable. Dense foods
 * with small servings get a finer grid; bulky ones keep the round numbers.
 */
export function gramStepForMax(maxGrams) {
  const max = Number(maxGrams) || 0;
  if (max <= 60) return 5;
  if (max <= 150) return 10;
  if (max <= 300) return 25;
  return GRAM_STEP_LARGE;
}

/** Snap to a specific grid, clamped into [min,max]. */
export function snapToStepWithinBounds(grams, step, min, max) {
  const lo = Number(min) || 0;
  const hi = Number(max) || lo;
  const g = Math.max(lo, Math.min(hi, Number(grams) || 0));
  const candidates = [Math.floor(g / step) * step, Math.ceil(g / step) * step]
    .filter(c => c >= lo && c <= hi);
  if (!candidates.length) return Math.round(g);
  return candidates.reduce((best, c) => (Math.abs(c - g) < Math.abs(best - g) ? c : best));
}

export function snapGrams(grams) {
  const g = Number(grams) || 0;
  if (g <= 0) return 0;
  const step = gramRoundStep(g);
  return Math.max(step, Math.round(g / step) * step);
}

/** Snap to grid then clamp to [min,max], keeping valid step alignment when possible. */
export function snapGramsWithinBounds(grams, min, max) {
  const lo = Number(min) || 0;
  const hi = Number(max) || grams;
  let snapped = snapGrams(grams);
  snapped = Math.max(lo, Math.min(hi, snapped));
  const step = gramRoundStep(snapped);
  if (snapped % step !== 0) {
    const down = Math.floor(snapped / step) * step;
    const up = Math.ceil(snapped / step) * step;
    if (down >= lo && down <= hi) snapped = down;
    else if (up >= lo && up <= hi) snapped = up;
  }
  return Math.max(lo, Math.min(hi, snapped));
}
