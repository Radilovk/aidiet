/**
 * Компактна рамка за сесия — само това, което моделът често пропуска или обърква в този продукт.
 * dayFocus = акцент на exercises; warmup/cooldown са отделни (моделът ги знае — не обясняваме).
 */
import { normalizeText } from './normalize.js';

/** Минути по фази — единственото числово, което spec не носи явно. */
export function sessionPhaseBudget(durationMin = 45) {
  const total = Math.max(20, durationMin);
  const warmup = Math.max(5, Math.round(total * 0.12));
  const cooldown = Math.max(5, Math.round(total * 0.12));
  const main = Math.max(10, total - warmup - cooldown);
  return { warmup, main, cooldown, total };
}

/** Неочевидни правила само за активните dayFocus типове в седмицата. */
const FOCUS_DELTA = {
  mobility: 'mobility exercises: без bench/squat/deadlift/leg press',
  hiit: 'hiit exercises: ≤25min работа; без щанга',
  cardio: 'cardio exercises: zone2/темпо; без тежки силови серии в exercises',
};

/** 1–3 реда за program_spec — не учебник по тренировки. */
export function formatSessionFrame(spec = {}) {
  if (!spec) return '';
  const { warmup, main, cooldown } = sessionPhaseBudget(spec.durationMin);
  const lines = [`warmup(3)→exercises(dayFocus)→cooldown(3) ~${warmup}+${main}+${cooldown}min`];

  const focuses = [...new Set((spec.dayTypes || [])
    .map((d) => d.type)
    .filter((t) => t && t !== 'rest'))];
  for (const f of focuses) {
    if (FOCUS_DELTA[f]) lines.push(FOCUS_DELTA[f]);
  }
  return lines.join(' | ');
}

/** @deprecated */
export function buildSessionPrinciples(spec = {}) {
  return { frame: formatSessionFrame(spec), budget: sessionPhaseBudget(spec.durationMin) };
}

/** @deprecated */
export function formatSessionPrinciplesBlock(spec) {
  return formatSessionFrame(spec);
}
