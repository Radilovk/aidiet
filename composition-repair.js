/**
 * Stage 1.7 — targeted composition repair for infeasible solver slots.
 * One focused AI call per repair batch; full chunk retry remains fallback.
 */

import { parseMealDescription } from './food-nutrition.js';

const COMPOSITION_ERROR_PATTERNS = [
  /калории \d+ ≠ цел/i,
  /смени продуктите/i,
  /неосъществим слот/i,
  /липсват продукти/i,
  /атомарната порция/i,
  /weight \d+g > /i,
  /weight \d+g < /i,
];

const STRUCTURAL_ERROR_PATTERNS = [
  /не е в mealBreakdown/i,
  /извън каталога/i,
  /забранени при клиничния протокол/i,
  /НЕ ЗАКУСВА/i,
  /липсва .*day/i,
  /Invalid response/i,
];

export function isCompositionRepairableError(message = '') {
  const msg = String(message);
  if (STRUCTURAL_ERROR_PATTERNS.some(p => p.test(msg))) return false;
  return COMPOSITION_ERROR_PATTERNS.some(p => p.test(msg));
}

/**
 * @param {string[]} validationErrors
 * @param {Array<{day?: number, type: string, reason?: string}>} infeasibleSlots
 */
export function extractCompositionRepairTargets(validationErrors = [], infeasibleSlots = []) {
  const byKey = new Map();

  for (const err of validationErrors) {
    if (!isCompositionRepairableError(err)) continue;
    const m = String(err).match(/Ден (\d+) ([^:]+):\s*(.+)/);
    if (!m) continue;
    const day = Number(m[1]);
    const type = m[2].trim();
    const reason = m[3].trim();
    byKey.set(`${day}|${type}`, { day, type, reason });
  }

  for (const slot of infeasibleSlots || []) {
    const day = Number(slot.day);
    const type = slot.type;
    if (!day || !type) continue;
    const reason = slot.reason || 'неосъществим слот';
    const key = `${day}|${type}`;
    if (!byKey.has(key)) byKey.set(key, { day, type, reason });
  }

  return [...byKey.values()];
}

function slotTargetFromScheme(strategy, day, mealType, dayNumberToKey) {
  const schemeKey = dayNumberToKey[day - 1];
  const breakdown = strategy?.weeklyScheme?.[schemeKey]?.mealBreakdown || [];
  return breakdown.find(m => m.type === mealType) || null;
}

function currentMealFromPlan(weekPlan, day, mealType) {
  const dayPlan = weekPlan?.[`day${day}`];
  return dayPlan?.meals?.find(m => m.type === mealType) || null;
}

/**
 * Compact repair prompt — only failing slots, frozen scheme targets, catalog excerpt.
 */
export function buildCompositionRepairPrompt({
  targets,
  weekPlan,
  strategy,
  catalogSection = '',
  dietaryModifier = 'Балансирано',
  dayNumberToKey,
}) {
  const lines = [
    '═══ COMPOSITION REPAIR (само посочените слотове) ═══',
    `Диета: ${dietaryModifier}`,
    'Промени САМО description (+ name ако е нужно). Без grams/kcal/macros/weight.',
    'Продукти САМО от каталога — един продукт на ред: "• {име}"',
    '',
    'СЛОТОВЕ ЗА ПОПРАВКА:',
  ];

  for (const t of targets) {
    const target = slotTargetFromScheme(strategy, t.day, t.type, dayNumberToKey);
    const meal = currentMealFromPlan(weekPlan, t.day, t.type);
    const products = parseMealDescription(meal?.description || '').map(i => i.name).join(', ') || '(празно)';
    lines.push(
      `- Ден ${t.day} ${t.type}: цел ${target?.calories || '?'}kcal P${target?.protein || '?'}/C${target?.carbs || '?'}/F${target?.fats || '?'}`,
      `  Проблем: ${t.reason}`,
      `  Сега: name="${meal?.name || ''}" | products: ${products}`,
    );
  }

  if (catalogSection) {
    lines.push('', '=== КАТАЛОГ (релевантен) ===', catalogSection.slice(0, 3500));
  }

  lines.push(
    '',
    '=== ОТГОВОР (JSON) ===',
    '{"repairs":[{"day":1,"type":"Хранене 2","name":"...","description":"• продукт1\\n• продукт2"}]}',
    'Върни repairs[] само за слотовете по-горе.',
  );

  return lines.join('\n');
}

/** Apply repair patch from AI — non-destructive for other meals. */
export function applyCompositionRepairPatch(weekPlan, patch, targets) {
  const repairs = patch?.repairs;
  if (!Array.isArray(repairs) || !repairs.length) return 0;

  const allowed = new Set(targets.map(t => `${t.day}|${t.type}`));
  let applied = 0;

  for (const fix of repairs) {
    const day = Number(fix.day);
    const type = fix.type;
    if (!day || !type || !allowed.has(`${day}|${type}`)) continue;
    const meal = currentMealFromPlan(weekPlan, day, type);
    if (!meal) continue;
    if (typeof fix.description === 'string' && fix.description.trim()) {
      meal.description = fix.description.trim();
      applied++;
    }
    if (typeof fix.name === 'string' && fix.name.trim()) {
      meal.name = fix.name.trim();
    }
  }
  return applied;
}
