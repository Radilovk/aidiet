/**
 * Perceptual hash (dHash) за визуално групиране на упражнения.
 * Работи в Node (sharp pipeline) и браузър (ImageData).
 */

export const CLUSTER_THRESHOLD = 4;
export const NEIGHBOR_THRESHOLD = 10;
export const DEFAULT_VISUAL_THRESHOLD = CLUSTER_THRESHOLD;
export const DHASH_BITS = 64;

/** @param {Uint8ClampedArray|number[]} rgba - 9×8 RGBA pixels */
export function dHashFromRgba(rgba, width = 9, height = 8) {
  const gray = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      gray.push((rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114));
    }
  }
  let hash = 0n;
  let bit = 0n;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const left = gray[y * width + x];
      const right = gray[y * width + x + 1];
      if (left > right) hash |= (1n << bit);
      bit += 1n;
    }
  }
  return hash.toString(16).padStart(16, '0');
}

export function parseHash(hex) {
  return BigInt(`0x${hex}`);
}

export function hammingDistanceHex(a, b) {
  if (!a || !b) return DHASH_BITS;
  let x = parseHash(a) ^ parseHash(b);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/**
 * @param {{ id: string, hash: string, target?: string }[]} entries
 * @param {number} [clusterThreshold]
 * @param {number} [neighborThreshold]
 */
export function buildVisualSimilarityIndex(entries, clusterThreshold = CLUSTER_THRESHOLD, neighborThreshold = NEIGHBOR_THRESHOLD) {
  const parent = new Map(entries.map((e) => [String(e.id), String(e.id)]));
  const targetOf = new Map(entries.map((e) => [String(e.id), String(e.target || '').toLowerCase()]));

  function find(id) {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = id;
    while (parent.get(c) !== r) {
      const n = parent.get(c);
      parent.set(c, r);
      c = n;
    }
    return r;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  const neighbors = new Map();
  for (const a of entries) {
    const list = [];
    for (const b of entries) {
      if (a.id === b.id) continue;
      const dist = hammingDistanceHex(a.hash, b.hash);
      if (dist <= neighborThreshold) list.push({ id: b.id, distance: dist });
      const sameTarget = targetOf.get(String(a.id)) && targetOf.get(String(a.id)) === targetOf.get(String(b.id));
      if (dist <= clusterThreshold && sameTarget) union(String(a.id), String(b.id));
    }
    list.sort((x, y) => x.distance - y.distance);
    neighbors.set(String(a.id), list);
  }

  const clusters = new Map();
  for (const e of entries) {
    const root = find(String(e.id));
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(e);
  }

  const clusterGroups = [...clusters.values()].filter((g) => g.length > 1);
  return { neighbors, clusterGroups, clusterCount: clusterGroups.length, clusterThreshold, neighborThreshold };
}

/**
 * @param {string} id
 * @param {Map<string, { id: string, distance: number }[]>} neighbors
 * @param {number} [limit]
 */
export function topVisualNeighbors(id, neighbors, limit = 6) {
  return (neighbors.get(String(id)) || []).slice(0, limit);
}
