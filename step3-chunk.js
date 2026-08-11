/**
 * Step 3 chunk configuration — week-at-once generation (Stage 2).
 */

export const DAYS_PER_CHUNK = 7;

export function mealPlanTokenLimitForChunk(daysInChunk) {
  const n = Number(daysInChunk) || 1;
  if (n <= 1) return 8000;
  if (n <= 3) return 12000;
  return 16000;
}

export function enrichmentTokenLimitForChunk(daysInChunk) {
  const n = Number(daysInChunk) || 1;
  if (n <= 1) return 4000;
  if (n <= 3) return 8000;
  return 12000;
}

export function buildStep3DaysRangeHeader(startDay, endDay) {
  const s = Number(startDay) || 1;
  const e = Number(endDay) || s;
  return s === e ? `DAY ${s}` : `DAYS ${s}–${e}`;
}

/**
 * Task + JSON return contract — single source for single-day and week-at-once.
 */
export function buildStep3ChunkTaskSection({ startDay, endDay, userName = 'клиента' }) {
  const s = Number(startDay) || 1;
  const e = Number(endDay) || s;
  const daysInChunk = e - s + 1;
  const name = String(userName || 'клиента').trim() || 'клиента';

  const sharedRules = [
    '• meals[].type MUST match that day\'s mealBreakdown in #WK — no extra/missing slots',
    '• name — dish title (Bulgarian)',
    '• description — catalog raw ingredients only, one per line: "• {product}"',
    '• Catalog products only; exact catalog names. Do NOT write grams, calories, macros, weight, or benefits',
    '• Choose products whose macro profile can carry slot P/C/F from mealBreakdown',
    '• Prefer catalog group names (зеленчук, плод, риба, ядки) when a specific product is not required',
  ].join('\n');

  if (daysInChunk <= 1) {
    return `=== TASK (Day ${s}) ===
Fill day ${s} for ${name}.
${sharedRules}

Return ONLY JSON: {"day${s}":{"meals":[...]}}.`;
  }

  const dayKeys = Array.from({ length: daysInChunk }, (_, i) => `day${s + i}`).join(', ');
  return `=== TASK (Days ${s}–${e}) ===
Fill days ${s} through ${e} for ${name} in ONE response.
${sharedRules}
• Rotate proteins and sides across the week — max 5 repeated dish names; vary catalog products day to day.

Return ONLY JSON with keys ${dayKeys}. Each value: {"meals":[...]}.
Example: {"day${s}":{"meals":[...]},"day${s + 1}":{"meals":[...]},...}`;
}
