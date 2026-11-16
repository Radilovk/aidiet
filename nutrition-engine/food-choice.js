/**
 * Изборът от „Избери храни“ (food-picker.html) → точните храни на двигателя.
 *
 * Страницата и двигателят пишат имената различно („Краставица“ / „Краставици“,
 * „Риба тон (консерва)“ / „Риба тон“), а изборът е точен — не текст за търсене.
 * Затова тук няма съвпадение по подниз: „Мляко (2%)“ не е киселото мляко,
 * „Ориз (кафяв)“ не е белият ориз, „Овесени ядки“ не са ядките.
 *
 * Ред на съвпадение за едно име:
 *   1. пълното име (със скобите) или етикетът;
 *   2. основата без скобите — със същото уточнение или общата храна без уточнение
 *      („Ориз (бял)“ → „Ориз (бял)“ и „Ориз“, но не „Ориз (кафяв)“);
 *   3. същото, по корена на думите (единствено/множествено число).
 */

import { FOODS } from './knowledge.js';
import { normalizeFoodKey } from '../food-utils.js';

const lower = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const qualifierOf = s => (String(s || '').match(/\(([^)]*)\)/)?.[1] || '').toLowerCase().trim();
/** Коренът на думата: без крайните гласни (краставица/краставици, домат/домати, морков/моркови). */
const stemOf = key => key.split(' ').map(w => (w.length > 3 ? w.replace(/[аъоуеиюя]+$/u, '') : w)).join(' ');

/** Основната каталожна група на всяка обменна група (PRO → protein, MLK → dairy…). */
export const PRIMARY_CATALOG_GROUP = (() => {
  const counts = {};
  for (const f of FOODS.values()) {
    (counts[f.group] ||= {})[f.catalogGroup] = (counts[f.group][f.catalogGroup] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).map(([g, c]) => [g, Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]]));
})();

const INDEX = [...FOODS.values()].map(f => ({
  f,
  full: [lower(f.name), lower(f.label)],
  base: normalizeFoodKey(f.name),
  label: normalizeFoodKey(f.label),
  qualifier: qualifierOf(f.name),
}));

/** @returns {string[]} id-тата на храните, които означава едно избрано име */
export function resolveChoiceName(name) {
  const full = lower(name);
  if (!full) return [];
  const exact = INDEX.filter(e => e.full.includes(full));
  const base = normalizeFoodKey(name);
  const qualifier = qualifierOf(name);
  const sameBase = (key) => INDEX.filter(e => (key(e.base) === key(base) || key(e.label) === key(base))
    && (!e.qualifier || e.qualifier === qualifier));
  let found = exact.length ? exact : [];
  // Общата храна без уточнение влиза до точната, когато е същият продукт
  // („Ориз“ до „Ориз (бял)“, но не до „Ориз (кафяв)“: белият е рафиниран).
  const sameKind = e => exact.every(x => [...e.f.flags].every(fl => x.f.flags.has(fl)));
  const byBase = sameBase(k => k);
  found = [...found, ...byBase.filter(e => !found.includes(e) && (!exact.length || (!e.qualifier && sameKind(e))))];
  if (!found.length) found = sameBase(stemOf);
  return [...new Set(found.map(e => e.f.id))];
}

/**
 * @param {string[]} names
 * @returns {{ ids: Set<string>, byName: Map<string, string[]>, unresolved: string[] }}
 */
export function resolveFoodChoice(names = []) {
  const ids = new Set();
  const byName = new Map();
  const unresolved = [];
  for (const raw of names) {
    const name = String(raw || '').trim();
    if (!name || byName.has(name)) continue;
    const found = resolveChoiceName(name);
    byName.set(name, found);
    if (!found.length) unresolved.push(name);
    found.forEach(id => ids.add(id));
  }
  return { ids, byName, unresolved };
}

/**
 * Групите, които изборът ограничава: само тези, от чиято основна категория
 * клиентът е избрал нещо. Сиренето (млечно, но в белтъчната група) без нито
 * един избран белтък не прави сиренето единствения белтък на седмицата.
 * @param {Set<string>} ids
 */
export function restrictedGroupsOf(ids) {
  const groups = new Set();
  for (const id of ids) {
    const f = FOODS.get(id);
    if (f && f.group !== 'FREE' && f.catalogGroup === PRIMARY_CATALOG_GROUP[f.group]) groups.add(f.group);
  }
  return groups;
}

/* ─── Собствени продукти с непознато име (друг език, друг запис) ─────────── */

/** Затвореният речник за AI: имената на храните на двигателя. */
export function choiceVocabulary() {
  return [...FOODS.values()].map(f => f.name);
}

/** Имената от „Избери храни“, които двигателят не разпознава сам. */
export function unresolvedChoiceNames(userData = {}) {
  const all = [userData.userFoodList, userData.userFoodExclude].flatMap(l => (Array.isArray(l) ? l.map(String) : []));
  return resolveFoodChoice(all).unresolved;
}

/**
 * Отговорът на AI → { "<име от клиента>": "<храна от двигателя>" }.
 * Приема се само точно име от речника; всичко друго остава непознато.
 */
export function normalizeChoiceNames(raw, names) {
  const map = raw && typeof raw === 'object' ? (raw.foods && typeof raw.foods === 'object' ? raw.foods : raw) : {};
  const vocabulary = new Set(choiceVocabulary());
  const out = {};
  for (const name of names) {
    const value = typeof map[name] === 'string' ? map[name].trim() : '';
    if (vocabulary.has(value)) out[name] = value;
  }
  return out;
}

/** Имената на клиента с превода им към двигателя (където го има). */
export function withChoiceNames(names, map) {
  return (Array.isArray(names) ? names : []).map(String).map(n => (map && map[n]) || n);
}

/**
 * Какво стана с избора — за клиента: кое не е позволено от режима/здравните
 * правила, кое не влезе, с какво е допълнено и кое не е разпознато.
 * @param {{ choice: any, allowed: (id: string) => boolean }} policy
 * @param {Array<{ foods?: Array<{ foods: Array<{ id: string }> }> }>} days
 * @param {{ choice?: { relaxedMeals: number } }} [stats]
 */
export function choiceReport(policy, days, stats = {}) {
  const c = policy.choice;
  if (!c || (!c.byName.size && !c.unresolved.length)) return null;
  const used = new Set(days.flatMap(d => d.foods || []).flatMap(m => m.foods.map(f => f.id)));
  const restricted = new Set(c.restrictedGroups);
  const notAllowed = [];
  const unused = [];
  for (const [name, ids] of c.byName) {
    if (!ids.length) continue;
    if (!ids.some(id => policy.allowed(id))) notAllowed.push(name);
    else if (!ids.some(id => used.has(id)) && ids.some(id => FOODS.get(id).group !== 'FREE')) unused.push(name);
  }
  const added = [...used].filter(id => restricted.has(FOODS.get(id)?.group) && !c.picked.has(id)).map(id => FOODS.get(id).name);
  return {
    picked: [...c.byName.values()].filter(ids => ids.length).length,
    notAllowed,
    unused,
    added,
    unresolved: c.unresolved,
    relaxedMeals: stats.choice?.relaxedMeals || 0,
  };
}
