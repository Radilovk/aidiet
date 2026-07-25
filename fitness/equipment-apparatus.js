/**
 * Каталог на конкретни уреди/станции — генериран от exercise-index.json.
 */
import { normalizeText, tokenize, tokenOverlapScore } from './normalize.js';
import { expandSearchTokens } from './exercise-synonyms.js';
import catalogData from './data/equipment-apparatus-catalog.json' with { type: 'json' };

export const APPARATUS_CATEGORIES = [
  { id: 'all', label: 'Всички типове' },
  { id: 'machine', label: 'Силови машини' },
  { id: 'cable', label: 'Кабел / скрипец' },
  { id: 'cardio', label: 'Кардио' },
];

export const APPARATUS_MUSCLES = [
  { id: 'all', label: 'Всички зони' },
  { id: 'chest', label: 'Гърди' },
  { id: 'back', label: 'Гръб' },
  { id: 'legs', label: 'Крака' },
  { id: 'glutes', label: 'Седалищни' },
  { id: 'shoulders', label: 'Рамене' },
  { id: 'arms', label: 'Ръце' },
  { id: 'core', label: 'Корем / гръбнак' },
  { id: 'cardio', label: 'Кардио' },
  { id: 'general', label: 'Многоцелеви' },
];

export const APPARATUS_EQUIP_TYPES = [
  { id: 'all', label: 'Всички уреди' },
  { id: 'leverage machine', label: 'Силова машина' },
  { id: 'cable', label: 'Кабел / скрипец' },
  { id: 'smith machine', label: 'Смит' },
  { id: 'sled machine', label: 'Преса / шейна' },
  { id: 'assisted', label: 'С асистенция' },
  { id: 'cardio', label: 'Кардио тренажор' },
];

const MUSCLE_BY_ID = new Map(APPARATUS_MUSCLES.map((m) => [m.id, m.label]));
const CATEGORY_BY_ID = new Map(APPARATUS_CATEGORIES.map((c) => [c.id, c.label]));

/** @type {typeof catalogData} */
export const GYM_APPARATUS = catalogData;

const BY_ID = new Map(GYM_APPARATUS.map((a) => [a.id, a]));

const MATCH_STOPWORDS = new Set(['male', 'female', 'pov', 'back', 'side', 'front', 'one', 'two', 'alternate', 'alternating']);

function coreTokens(tokens = []) {
  return tokens.filter((t) => t.length > 1 && !MATCH_STOPWORDS.has(t));
}

function matchesEquipFilter(item, equip) {
  if (!equip || equip === 'all') return true;
  if (equip === 'cardio') return item.category === 'cardio';
  return item.equipNorm === equip;
}

function searchHaystack(item) {
  return tokenize([
    item.label,
    item.subtitle,
    item.name,
    item.nameNorm,
    item.equipLabel,
    item.equipNorm,
    MUSCLE_BY_ID.get(item.muscle),
    CATEGORY_BY_ID.get(item.category),
  ].filter(Boolean).join(' '));
}

export function apparatusLabel(id) {
  return BY_ID.get(id)?.label || id;
}

export function muscleLabel(id) {
  return MUSCLE_BY_ID.get(id) || id;
}

export function categoryLabel(id) {
  return CATEGORY_BY_ID.get(id) || id;
}

export function searchApparatus({
  query = '',
  category = 'all',
  muscle = 'all',
  equip = 'all',
} = {}) {
  const tokens = expandSearchTokens(query);
  return GYM_APPARATUS.filter((a) => {
    if (category && category !== 'all' && a.category !== category) return false;
    if (muscle && muscle !== 'all' && a.muscle !== muscle) return false;
    if (!matchesEquipFilter(a, equip)) return false;
    if (!tokens.length) return true;
    return tokenOverlapScore(tokens, searchHaystack(a)) > 0;
  });
}

export function computeApparatusFacets(items = GYM_APPARATUS) {
  const category = new Map();
  const muscle = new Map();
  const equip = new Map();

  for (const item of items) {
    category.set(item.category, (category.get(item.category) || 0) + 1);
    muscle.set(item.muscle, (muscle.get(item.muscle) || 0) + 1);
    const equipKey = item.category === 'cardio' ? 'cardio' : item.equipNorm;
    equip.set(equipKey, (equip.get(equipKey) || 0) + 1);
  }

  return { category, muscle, equip };
}

export function groupApparatusByMuscle(items) {
  const order = APPARATUS_MUSCLES.filter((m) => m.id !== 'all').map((m) => m.id);
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.muscle)) groups.set(item.muscle, []);
    groups.get(item.muscle).push(item);
  }
  return order
    .filter((id) => groups.has(id))
    .map((id) => ({ id, label: MUSCLE_BY_ID.get(id), items: groups.get(id) }));
}

export function groupApparatusByCategory(items) {
  const order = APPARATUS_CATEGORIES.filter((c) => c.id !== 'all').map((c) => c.id);
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  }
  return order
    .filter((id) => groups.has(id))
    .map((id) => ({ id, label: CATEGORY_BY_ID.get(id), items: groups.get(id) }));
}

export function exerciseMatchesApparatus(entry, apparatusId) {
  const item = BY_ID.get(apparatusId);
  if (!item) return false;
  if (entry?.id != null && String(entry.id) === String(apparatusId)) return true;

  const eq = normalizeText(entry?.equipNorm || entry?.equipment);
  if (item.equipNorm && eq !== item.equipNorm) return false;

  const name = normalizeText(entry?.nameNorm || entry?.name || '');
  const itemName = item.nameNorm || normalizeText(item.name || '');
  if (!name || !itemName) return false;
  if (name === itemName || name.includes(itemName) || itemName.includes(name)) return true;

  const entryTokens = coreTokens(entry?.tokens || tokenize(name));
  const itemTokens = coreTokens(item.tokens || tokenize(itemName));
  return tokenOverlapScore(itemTokens, entryTokens) >= 0.55;
}

export function passesApparatusFilter(entry, pickedIds) {
  if (!pickedIds?.length) return true;
  return pickedIds.some((id) => exerciseMatchesApparatus(entry, id));
}

export function expandApparatusIds(pickedIds) {
  const equipHints = new Set(['body weight']);
  const labels = [];
  for (const id of pickedIds || []) {
    const item = BY_ID.get(id);
    if (!item) continue;
    labels.push(item.subtitle ? `${item.label} (${item.subtitle})` : item.label);
    if (item.equipNorm) equipHints.add(item.equipNorm);
  }
  return { equipHints, labels };
}

export function apparatusById(id) {
  return BY_ID.get(id) || null;
}
