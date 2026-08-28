/** Shared gram snapping: <50g → 5g steps; ≥50g → 50g steps (50, 100, 150…). */

export const GRAM_STEP_SMALL = 5;
export const GRAM_STEP_LARGE = 50;
export const GRAM_LARGE_MIN = 50;

export function gramRoundStep(grams) {
  return (Number(grams) || 0) >= GRAM_LARGE_MIN ? GRAM_STEP_LARGE : GRAM_STEP_SMALL;
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
