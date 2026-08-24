/**
 * Избор на един каноничен запис на група дубликати/варианти.
 */
import { normalizeText } from './normalize.js';

/** @typedef {{ id: string, name?: string, displayName?: string, nameBg?: string, equipment?: string, target?: string, excluded?: boolean, instructionsEn?: string, instructions?: string, diff?: number, gf?: number, gm?: number }} CatalogItem */

export function baseEnName(name) {
  return normalizeText(name)
    .replace(/\bv\s*\d+\b/g, '')
    .replace(/\bback pov\b|\bside pov\b/g, '')
    .replace(/\bwith arm blaster\b/g, '')
    .replace(/\bon knees\b/g, '')
    .replace(/\bmale\b|\bfemale\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function instructionKey(item) {
  const en = item.instructionsEn || item.instructions || '';
  return normalizeText(String(en).slice(0, 400));
}

export function displayKey(item) {
  return normalizeText(item.displayName || item.nameBg || item.name || '');
}

/** По-висок score → по-подходящ каноничен запис. */
export function canonicalScore(item) {
  const name = String(item.name || '');
  const n = name.toLowerCase();
  let score = 0;

  if (/\((male|female)\)/i.test(name)) score -= 120;
  if (/\bpov\b/i.test(name)) score -= 90;
  if (/\bv\.?\s*\d+\b/i.test(name)) score -= 70;
  if (/arm blaster/i.test(name)) score -= 55;
  if (/on knees/i.test(name)) score -= 45;
  if (/\(with /i.test(name)) score -= 35;
  if (/,\s*variant/i.test(name)) score -= 30;
  if (/^assisted /i.test(name)) score -= 15;

  // По-кратко EN име = по-близо до „основен“ вариант
  score -= name.length * 0.15;

  // Вече активен в AI — леко предпочитание
  if (!item.excluded) score += 25;

  // Ясно BG име
  const display = item.displayName || item.nameBg || '';
  if (display && display !== 'Упражнение' && display.length >= 4) score += 10;

  // По-ниско id ≈ по-ранен/основен запис в dataset
  const idNum = Number.parseInt(item.id, 10);
  if (Number.isFinite(idNum)) score -= idNum * 0.002;

  // Без gender в EN името
  if (!/\bmale\b|\bfemale\b/i.test(n)) score += 5;

  return score;
}

class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }

  find(id) {
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }

  groups() {
    const map = new Map();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      if (!map.has(root)) map.set(root, []);
      map.get(root).push(id);
    }
    return map;
  }
}

/**
 * Групира упражнения по: еднакви инструкции, еднакво BG име, общ EN вариант.
 * @param {CatalogItem[]} items
 * @returns {Map<string, CatalogItem[]>} clusterRootId -> members
 */
export function buildDuplicateClusters(items) {
  const byId = new Map(items.map((x) => [String(x.id), x]));
  const uf = new UnionFind(items.map((x) => String(x.id)));

  function linkBy(map) {
    for (const group of map.values()) {
      if (group.length < 2) continue;
      const first = String(group[0].id);
      for (let i = 1; i < group.length; i += 1) {
        uf.union(first, String(group[i].id));
      }
    }
  }

  const byInstr = new Map();
  const byDisplay = new Map();
  const byVariant = new Map();

  for (const item of items) {
    const id = String(item.id);
    const ik = instructionKey(item);
    if (ik) {
      if (!byInstr.has(ik)) byInstr.set(ik, []);
      byInstr.get(ik).push(item);
    }
    const dk = displayKey(item);
    if (dk) {
      if (!byDisplay.has(dk)) byDisplay.set(dk, []);
      byDisplay.get(dk).push(item);
    }
    const vk = baseEnName(item.name);
    if (vk) {
      if (!byVariant.has(vk)) byVariant.set(vk, []);
      byVariant.get(vk).push(item);
    }
  }

  linkBy(byInstr);
  linkBy(byDisplay);
  linkBy(byVariant);

  const rawGroups = uf.groups();
  const clusters = new Map();
  for (const memberIds of rawGroups.values()) {
    if (memberIds.length < 2) continue;
    const members = memberIds.map((id) => byId.get(id)).filter(Boolean);
    if (members.length < 2) continue;
    members.sort((a, b) => canonicalScore(b) - canonicalScore(a));
    const rootId = String(members[0].id);
    clusters.set(rootId, members);
  }
  return clusters;
}

/**
 * @param {CatalogItem[]} items
 * @returns {{
 *   clusters: Map<string, CatalogItem[]>,
 *   canonical: CatalogItem[],
 *   toExclude: CatalogItem[],
 *   keepIds: Set<string>,
 *   excludeIds: Set<string>,
 * }}
 */
export function pickCanonicalExercises(items) {
  const clusters = buildDuplicateClusters(items);
  const keepIds = new Set();
  const excludeIds = new Set();
  const canonical = [];
  const toExclude = [];

  for (const members of clusters.values()) {
    const winner = members[0];
    keepIds.add(String(winner.id));
    canonical.push(winner);
    for (let i = 1; i < members.length; i += 1) {
      const loser = members[i];
      excludeIds.add(String(loser.id));
      toExclude.push(loser);
    }
  }

  // Упражнения извън cluster-и — не ги пипаме (остават както са)
  return { clusters, canonical, toExclude, keepIds, excludeIds };
}

/**
 * План за canonicalize: маркира non-canonical като excluded, canonical като active.
 * @param {CatalogItem[]} items
 * @param {{ onlyDuplicates?: boolean }} [opts]
 */
export function buildCanonicalizePlan(items, opts = {}) {
  const { keepIds, excludeIds, clusters, canonical, toExclude } = pickCanonicalExercises(items);
  const patches = [];

  for (const item of toExclude) {
    patches.push({
      id: String(item.id),
      excluded: true,
      diff: item.diff ?? 2,
      gf: item.gf ?? 70,
      gm: item.gm ?? 70,
      reason: 'duplicate_variant',
    });
  }

  if (!opts.onlyDuplicates) {
    for (const item of canonical) {
      if (item.excluded) {
        patches.push({
          id: String(item.id),
          excluded: false,
          diff: item.diff ?? 2,
          gf: item.gf ?? 70,
          gm: item.gm ?? 70,
          reason: 'canonical_winner',
        });
      }
    }
  }

  return {
    clusterCount: clusters.size,
    canonicalCount: canonical.length,
    excludeCount: toExclude.length,
    patchCount: patches.length,
    patches,
    clusters: [...clusters.entries()].map(([rootId, members]) => ({
      rootId,
      winner: {
        id: members[0].id,
        name: members[0].name,
        displayName: members[0].displayName || members[0].nameBg,
      },
      dropped: members.slice(1).map((m) => ({
        id: m.id,
        name: m.name,
        displayName: m.displayName || m.nameBg,
        score: canonicalScore(m),
      })),
    })),
  };
}
