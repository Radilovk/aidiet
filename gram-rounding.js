/**
 * Грамажи: под 50 г → стъпка 5 г; от 50 г нагоре → стъпка 50 г.
 *
 * Това е продуктово правило, не оптимизация: клиентът мери на кухненска
 * везна и 175 г е безсмислена прецизност. Опитът да се даде по-фина мрежа
 * на плътните храни (за да се стигат по-точно калориите) го наруши — целта
 * се постига със състава на ястието, не с грамажи като 175.
 */

export const GRAM_STEP_SMALL = 5;
export const GRAM_STEP_LARGE = 50;
export const GRAM_LARGE_MIN = 50;

export function gramRoundStep(grams) {
  return (Number(grams) || 0) >= GRAM_LARGE_MIN ? GRAM_STEP_LARGE : GRAM_STEP_SMALL;
}

/** Единствената мрежа — не зависи от продукта. */
export function gramStepForMax(maxGrams) {
  return (Number(maxGrams) || 0) >= GRAM_LARGE_MIN ? GRAM_STEP_LARGE : GRAM_STEP_SMALL;
}

export function snapGrams(grams) {
  const g = Number(grams) || 0;
  if (g <= 0) return 0;
  // Стойност точно под 50 се качва на 50, а не на 45 — 50 е валидна стъпка.
  if (g < GRAM_LARGE_MIN) {
    const small = Math.max(GRAM_STEP_SMALL, Math.round(g / GRAM_STEP_SMALL) * GRAM_STEP_SMALL);
    return small > GRAM_LARGE_MIN ? GRAM_LARGE_MIN : small;
  }
  return Math.round(g / GRAM_STEP_LARGE) * GRAM_STEP_LARGE;
}

/** Валиден ли е грамажът спрямо правилото. */
export function isValidGramStep(grams) {
  const g = Number(grams) || 0;
  if (g <= 0) return true;
  return g < GRAM_LARGE_MIN ? g % GRAM_STEP_SMALL === 0 : g % GRAM_STEP_LARGE === 0;
}

/** Най-близката валидна стойност в [min,max]. */
export function snapToStepWithinBounds(grams, step, min, max) {
  const lo = Number(min) || 0;
  const hi = Number(max) || lo;
  const g = Math.max(lo, Math.min(hi, Number(grams) || 0));
  const candidates = [];
  for (let v = GRAM_STEP_SMALL; v < GRAM_LARGE_MIN; v += GRAM_STEP_SMALL) candidates.push(v);
  for (let v = GRAM_LARGE_MIN; v <= Math.max(hi, GRAM_LARGE_MIN); v += GRAM_STEP_LARGE) candidates.push(v);
  const inRange = candidates.filter(c => c >= lo && c <= hi);
  if (!inRange.length) return snapGrams(g);
  return inRange.reduce((best, c) => (Math.abs(c - g) < Math.abs(best - g) ? c : best));
}
