/**
 * Minimal RFC 6902 JSON Patch (replace, add, remove) with path allowlist.
 */

const ALLOWED_PREFIXES = ['/answers', '/plan', '/adminNotes'];
const MAX_PATCHES = 25;

/**
 * @param {string} pointer
 */
function parsePointer(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new Error(`Невалиден path: ${pointer}`);
  }
  if (pointer === '/') return [''];
  return pointer.slice(1).split('/').map(seg => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * @param {string} path
 */
function assertAllowedPath(path) {
  if (!ALLOWED_PREFIXES.some(p => path === p || path.startsWith(`${p}/`))) {
    throw new Error(`Забранен path: ${path}`);
  }
}

/**
 * @param {unknown[]} patches
 */
export function validateJsonPatches(patches) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error('Липсва масив patches');
  }
  if (patches.length > MAX_PATCHES) {
    throw new Error(`Максимум ${MAX_PATCHES} patch операции`);
  }
  for (const p of patches) {
    if (!p || typeof p !== 'object') throw new Error('Невалидна patch операция');
    const op = p.op;
    if (!['replace', 'add', 'remove'].includes(op)) {
      throw new Error(`Неподдържана операция: ${op}`);
    }
    assertAllowedPath(p.path);
    if (op !== 'remove' && !Object.prototype.hasOwnProperty.call(p, 'value')) {
      throw new Error(`Липсва value за ${op} ${p.path}`);
    }
  }
  return patches;
}

/**
 * @param {unknown} doc
 * @param {string[]} path
 */
function getAtPath(doc, path) {
  let cur = doc;
  for (const key of path) {
    if (cur == null) throw new Error(`Path not found: /${path.join('/')}`);
    cur = cur[key];
  }
  return cur;
}

/**
 * @param {Record<string, unknown>} doc
 * @param {unknown[]} patches
 * @returns {{ document: Record<string, unknown>, touchedPlan: boolean, touchedAnswers: boolean }}
 */
export function applyJsonPatches(doc, patches) {
  validateJsonPatches(patches);
  const document = JSON.parse(JSON.stringify(doc));
  let touchedPlan = false;
  let touchedAnswers = false;

  for (const patch of patches) {
    if (patch.path.startsWith('/plan')) touchedPlan = true;
    if (patch.path.startsWith('/answers')) touchedAnswers = true;

    const segments = parsePointer(patch.path);
    if (segments.length === 0) throw new Error('Празен path');

    if (patch.op === 'remove') {
      const parentPath = segments.slice(0, -1);
      const key = segments[segments.length - 1];
      const parent = parentPath.length ? getAtPath(document, parentPath) : document;
      if (Array.isArray(parent) && key === '-') throw new Error('remove не поддържа -');
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
      continue;
    }

    const parentPath = segments.slice(0, -1);
    const key = segments[segments.length - 1];
    const parent = parentPath.length ? getAtPath(document, parentPath) : document;

    if (patch.op === 'add') {
      if (Array.isArray(parent)) {
        if (key === '-') parent.push(patch.value);
        else parent.splice(Number(key), 0, patch.value);
      } else {
        parent[key] = patch.value;
      }
      continue;
    }

    // replace
    if (Array.isArray(parent) && key !== '-') {
      parent[Number(key)] = patch.value;
    } else {
      parent[key] = patch.value;
    }
  }

  return { document, touchedPlan, touchedAnswers };
}

/**
 * @param {object} clientData
 */
export function buildPatchDocument(clientData) {
  return {
    answers: clientData.answers || {},
    plan: clientData.plan || null,
    adminNotes: clientData.adminNotes || '',
  };
}

/**
 * @param {object} clientData
 * @param {Record<string, unknown>} patched
 */
export function mergePatchDocument(clientData, patched) {
  clientData.answers = patched.answers || {};
  clientData.plan = patched.plan ?? null;
  if (patched.adminNotes !== undefined) clientData.adminNotes = patched.adminNotes;
  return clientData;
}
