/**
 * Plan engine v2 stage 3 — slot-level AI repair when deterministic pick leaves a gap.
 * One focused call per slot: pick 1 dish from up to 5 catalog candidates.
 */

import { normalizeFoodKey } from './food-utils.js';

export const SLOT_REPAIR_CANDIDATE_COUNT = 5;
export const SLOT_REPAIR_MAX_CALLS_PER_PLAN = 2;

/**
 * Minimal repair prompt — no ADLE, only catalog dish ids.
 */
export function buildSlotRepairPrompt({
  dayNum,
  slotType,
  slotTarget,
  candidates = [],
  dietaryModifier = 'Балансирано',
}) {
  const kcal = slotTarget?.calories ?? '?';
  const lines = [
    'Избери ЕДНО ястие от списъка. Върни само JSON с dishId от кандидатите.',
    `Ден ${dayNum}, слот: ${slotType}, цел: ${kcal} kcal`,
    `Диета: ${dietaryModifier}`,
    '',
    'Кандидати:',
    ...candidates.map((c, i) => `${i + 1}. dishId="${c.id}" — ${c.name}`),
    '',
    'Отговор: {"dishId":"<id от списъка>"}',
  ];
  return lines.join('\n');
}

function extractJsonObject(text) {
  if (text == null) return null;
  if (typeof text === 'object') return text;
  const raw = String(text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Parse AI response and validate pick against candidate list.
 * @returns {object|null} catalog entry from candidates
 */
export function parseSlotRepairResponse(response, candidates = []) {
  if (!candidates.length) return null;
  const byId = new Map(candidates.map(c => [c.id, c]));
  const byName = new Map(candidates.map(c => [normalizeFoodKey(c.name), c]));
  const parsed = extractJsonObject(response);
  if (!parsed) return null;

  const dishId = parsed.dishId || parsed.id || parsed.pick;
  if (dishId && byId.has(dishId)) return byId.get(dishId);

  const name = parsed.name || parsed.dishName || parsed.mealName;
  if (name) {
    const hit = byName.get(normalizeFoodKey(name));
    if (hit) return hit;
  }

  return null;
}

/** @returns {boolean} */
export function isValidSlotRepairPick(pick, candidates = []) {
  if (!pick?.id) return false;
  return candidates.some(c => c.id === pick.id);
}
