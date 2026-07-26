/**
 * Каталог на конкретни уреди/станции — генериран от exercise-index.json.
 */
import { normalizeText, tokenize, tokenOverlapScore } from './normalize.js';
import { expandSearchTokens } from './exercise-synonyms.js';
import { localizeTarget } from './exercise-labels-bg.js';
import catalogData from './data/equipment-apparatus-catalog.json' with { type: 'json' };

export const APPARATUS_CATEGORIES = [
  { id: 'all', label: 'Всички типове' },
  { id: 'machine', label: 'Силови машини' },
  { id: 'cable', label: 'Кабел / скрипец' },
  { id: 'bench', label: 'Лежанки' },
  { id: 'rack', label: 'Стойки' },
  { id: 'cardio', label: 'Кардио' },
];

/** Зони за филтър и групиране — краката е разделен на предно/задно бедро и прасци. */
export const APPARATUS_ZONES = [
  { id: 'all', label: 'Всички зони' },
  { id: 'chest', label: 'Гърди' },
  { id: 'back', label: 'Гръб' },
  { id: 'quads', label: 'Предно бедро' },
  { id: 'hamstrings', label: 'Задно бедро' },
  { id: 'calves', label: 'Прасци' },
  { id: 'glutes', label: 'Седалищни' },
  { id: 'adductors', label: 'Привеждащи' },
  { id: 'abductors', label: 'Отвеждащи' },
  { id: 'shoulders', label: 'Рамене' },
  { id: 'arms', label: 'Ръце' },
  { id: 'core', label: 'Корем / гръбнак' },
  { id: 'cardio', label: 'Кардио' },
  { id: 'general', label: 'Многоцелеви' },
];

/** @deprecated използвай APPARATUS_ZONES */
export const APPARATUS_MUSCLES = APPARATUS_ZONES;

export const APPARATUS_EQUIP_TYPES = [
  { id: 'all', label: 'Всички уреди' },
  { id: 'leverage machine', label: 'Силова машина' },
  { id: 'cable', label: 'Кабел / скрипец' },
  { id: 'smith machine', label: 'Смит' },
  { id: 'sled machine', label: 'Преса / шейна' },
  { id: 'assisted', label: 'С асистенция' },
  { id: 'bench', label: 'Лежанки' },
  { id: 'rack', label: 'Стойки' },
  { id: 'cardio', label: 'Кардио тренажор' },
];

const ZONE_BY_ID = new Map(APPARATUS_ZONES.map((z) => [z.id, z]));
const CATEGORY_BY_ID = new Map(APPARATUS_CATEGORIES.map((c) => [c.id, c.label]));

/** @type {typeof catalogData} */
export const GYM_APPARATUS = catalogData;

const BY_ID = new Map(GYM_APPARATUS.map((a) => [a.id, a]));

const MATCH_STOPWORDS = new Set(['male', 'female', 'pov', 'back', 'side', 'front', 'one', 'two', 'alternate', 'alternating']);

const TARGET_ZONE = {
  quads: 'quads',
  hamstrings: 'hamstrings',
  calves: 'calves',
  adductors: 'adductors',
  abductors: 'abductors',
  glutes: 'glutes',
};

function coreTokens(tokens = []) {
  return tokens.filter((t) => t.length > 1 && !MATCH_STOPWORDS.has(t));
}

export function zoneForItem(item) {
  if (item?.targetNorm && TARGET_ZONE[item.targetNorm]) return TARGET_ZONE[item.targetNorm];
  if (item?.muscle === 'legs') return 'quads';
  return item?.muscle || 'general';
}

function matchesEquipFilter(item, equip) {
  if (!equip || equip === 'all') return true;
  if (equip === 'cardio') return item.category === 'cardio';
  if (equip === 'bench') return item.category === 'bench';
  if (equip === 'rack') return item.category === 'rack';
  return item.equipNorm === equip;
}

function matchesZoneFilter(item, zone) {
  if (!zone || zone === 'all') return true;
  return zoneForItem(item) === zone;
}

function searchHaystack(item) {
  return tokenize([
    item.label,
    item.subtitle,
    item.targetLabel,
    item.name,
    item.nameNorm,
    item.equipLabel,
    item.equipNorm,
    ZONE_BY_ID.get(zoneForItem(item))?.label,
    CATEGORY_BY_ID.get(item.category),
  ].filter(Boolean).join(' '));
}

export function apparatusLabel(id) {
  return BY_ID.get(id)?.label || id;
}

export function muscleLabel(id) {
  return ZONE_BY_ID.get(id)?.label || id;
}

export function zoneLabel(id) {
  return ZONE_BY_ID.get(id)?.label || id;
}

export function targetLabelFor(item) {
  return item?.targetLabel || localizeTarget(item?.targetNorm) || zoneLabel(zoneForItem(item));
}

export function categoryLabel(id) {
  return CATEGORY_BY_ID.get(id) || id;
}

export function searchApparatus({
  query = '',
  category = 'all',
  muscle = 'all',
  zone = muscle,
  equip = 'all',
} = {}) {
  const tokens = expandSearchTokens(query);
  return GYM_APPARATUS.filter((a) => {
    if (category && category !== 'all' && a.category !== category) return false;
    if (!matchesZoneFilter(a, zone)) return false;
    if (!matchesEquipFilter(a, equip)) return false;
    if (!tokens.length) return true;
    return tokenOverlapScore(tokens, searchHaystack(a)) > 0;
  });
}

export function computeApparatusFacets(items = GYM_APPARATUS) {
  const category = new Map();
  const zone = new Map();
  const equip = new Map();

  for (const item of items) {
    category.set(item.category, (category.get(item.category) || 0) + 1);
    const z = zoneForItem(item);
    zone.set(z, (zone.get(z) || 0) + 1);
    let equipKey = item.equipNorm;
    if (item.category === 'cardio') equipKey = 'cardio';
    else if (item.category === 'bench') equipKey = 'bench';
    else if (item.category === 'rack') equipKey = 'rack';
    equip.set(equipKey, (equip.get(equipKey) || 0) + 1);
  }

  return { category, muscle: zone, zone, equip };
}

export function groupApparatusByMuscle(items) {
  return groupApparatusByZone(items);
}

export function groupApparatusByZone(items) {
  const order = APPARATUS_ZONES.filter((z) => z.id !== 'all').map((z) => z.id);
  const groups = new Map();
  for (const item of items) {
    const id = zoneForItem(item);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(item);
  }
  return order
    .filter((id) => groups.has(id))
    .map((id) => ({ id, label: ZONE_BY_ID.get(id)?.label, items: groups.get(id) }));
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

  if (item.station) {
    const eq = normalizeText(entry?.equipNorm || entry?.equipment);
    const hints = (item.equipHints || []).map(normalizeText);
    if (hints.length && !hints.includes(eq)) return false;
    const name = String(entry?.name || entry?.nameNorm || '');
    if (item.excludeRe && new RegExp(item.excludeRe, 'i').test(name)) return false;
    if (item.matchRe && new RegExp(item.matchRe, 'i').test(name)) return true;
    return false;
  }

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
    if (item.station && item.equipHints?.length) {
      for (const h of item.equipHints) equipHints.add(normalizeText(h));
    } else if (item.equipNorm && item.equipNorm !== 'station') {
      equipHints.add(item.equipNorm);
    }
  }
  return { equipHints, labels };
}

export function apparatusById(id) {
  return BY_ID.get(id) || null;
}
