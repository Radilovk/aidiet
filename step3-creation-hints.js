/**
 * Precision-first Step 3 — deterministic hints for the initial AI call and regen retries.
 * No profile ids; derived only from frozen scheme slot targets.
 */

const HIGH_KCAL_THRESHOLD = 600;
const VERY_HIGH_KCAL_THRESHOLD = 900;

export function maxSlotKcalInChunk(strategy, startDay, endDay, dayNumberToKey) {
  let max = 0;
  for (let d = startDay; d <= endDay; d++) {
    const schemeKey = dayNumberToKey[d - 1];
    const breakdown = strategy?.weeklyScheme?.[schemeKey]?.mealBreakdown || [];
    for (const slot of breakdown) {
      if (slot.type === 'Свободно хранене' || slot.type === 'Напитка') continue;
      max = Math.max(max, Number(slot.calories) || 0);
    }
  }
  return max;
}

/** One compact line injected into catalog/task when scheme has high-kcal slots. */
export function buildHighKcalCreationHint(maxSlotKcal) {
  if (maxSlotKcal < HIGH_KCAL_THRESHOLD) return '';
  if (maxSlotKcal >= VERY_HIGH_KCAL_THRESHOLD) {
    return `Slot ≥${VERY_HIGH_KCAL_THRESHOLD} kcal: използвай калоричен PRO (месо/риба/тофу) + ENG (ориз/картоф/масло/ядки) — салата/зеленчук само VOL, не като основен източник.`;
  }
  return `Slot ≥${HIGH_KCAL_THRESHOLD} kcal: включи PRO + ENG с достатъчна kcal/g; не разчитай само на зеленчук.`;
}

/** Deterministic regen hint from solver infeasible slots (no extra AI repair call). */
export function buildInfeasibilityRetryHints(infeasibleSlots = []) {
  if (!infeasibleSlots?.length) return '';
  const lines = infeasibleSlots.slice(0, 6).map(
    s => `- Ден ${s.day} ${s.type}: ${s.reason || 'неосъществим'} → смени PRO/ENG продуктите от каталога`,
  );
  const tail = infeasibleSlots.length > 6 ? `\n(+ ${infeasibleSlots.length - 6} още слота)` : '';
  return `INFEASIBLE (пълна regen — без partial plate):\n${lines.join('\n')}${tail}`;
}
