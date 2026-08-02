/**
 * Редактируем каталог на упражнения — споделена логика за API и админ UI.
 */
import { normalizeText } from './normalize.js';
import { localizeExerciseDisplayName, localizeEquipment, localizeTarget } from './exercise-labels-bg.js';
import { inferExerciseTraits } from './exercise-tags.js';
import { pickInstructionsEn } from './exercise-translations.js';
import { contentHash } from './exercise-translate-batch.js';
import { classifyContentHash } from './exercise-classify-batch.js';

export const KNOWN_FLAGS = [
  'compound', 'isolation', 'barbell', 'machine', 'bodyweight', 'true_bodyweight',
  'mislabeled_bw', 'cardio', 'glute', 'press', 'olympic', 'gymnastics', 'suspension',
  'rings', 'pull_bar', 'parallel_bars', 'beginner_safe', 'home_friendly', 'advanced',
  'gender_variant',
  'excluded',
];

export const KNOWN_GEAR = [
  'floor', 'mat', 'wall', 'step', 'bench', 'chair', 'pull_bar', 'parallel_bars',
  'rings', 'suspension', 'dumbbell', 'kettlebell', 'band', 'barbell', 'cable',
  'machine', 'ball', 'cardio_machine', 'assisted', 'weighted', 'rope',
];

function clampDiff(n) {
  const v = Number(n);
  return v >= 1 && v <= 3 ? v : 2;
}

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 70;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function parseCsvList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function uniqueList(items) {
  return [...new Set(items.filter(Boolean))];
}

/**
 * @param {object} entry - запис от buildCompactIndex
 * @param {object} [raw] - суров dataset запис
 * @param {object} [bundledMeta]
 * @param {object} [kvMeta]
 * @param {object} [bundledTr]
 * @param {object} [kvTr]
 */
export function buildCatalogRecord(entry, raw = null, bundledMeta = {}, kvMeta = {}, bundledTr = {}, kvTr = {}) {
  const id = String(entry?.id ?? '');
  const kvMetaRow = kvMeta[id] || null;
  const bundledMetaRow = bundledMeta[id] || null;
  const kvTrRow = kvTr[id] || null;
  const bundledTrRow = bundledTr[id] || null;
  const traits = entry?.traits || inferExerciseTraits(entry?.name, entry?.equipment);
  const autoNameBg = localizeExerciseDisplayName(entry?.name || '', '', entry?.equipment || '');
  const nameBg = entry?.nameBg || kvTrRow?.nameBg || bundledTrRow?.nameBg || '';
  const instructionsBg = kvTrRow?.instructionsBg || bundledTrRow?.instructionsBg || '';
  const instructionsEn = pickInstructionsEn(raw?.instructions || entry?.instructions);

  return {
    id,
    name: entry?.name || '',
    nameBg,
    displayName: nameBg || autoNameBg,
    autoNameBg,
    equipment: entry?.equipment || '',
    equipNorm: entry?.equipNorm || normalizeText(entry?.equipment),
    effectiveEquipNorm: entry?.effectiveEquipNorm || entry?.equipNorm || normalizeText(entry?.equipment),
    target: entry?.target || '',
    targetNorm: entry?.targetNorm || normalizeText(entry?.target),
    bodyPart: entry?.bodyPart || '',
    bodyNorm: entry?.bodyNorm || '',
    secondary: Array.isArray(entry?.secondary) ? entry.secondary : [],
    diff: entry?.diff ?? 2,
    gf: entry?.gf ?? 70,
    gm: entry?.gm ?? 70,
    flags: Array.isArray(entry?.flags) ? [...entry.flags] : [],
    gear: Array.isArray(entry?.gear) ? [...entry.gear] : [],
    traits,
    excluded: Boolean(entry?.excluded || (entry?.flags || []).includes('excluded')),
    instructions: entry?.instructions || instructionsEn || '',
    instructionsBg,
    instructionsEn,
    instructionsLang: entry?.instructionsLang || (instructionsBg ? 'bg' : (instructionsEn ? 'en' : '')),
    image: entry?.image || '',
    gif: entry?.gif || '',
    equipLabelBg: localizeEquipment(entry?.equipment),
    targetLabelBg: localizeTarget(entry?.target),
    sourceHash: kvMetaRow?.sourceHash || bundledMetaRow?.sourceHash || null,
    classifiedAt: kvMetaRow?.classifiedAt || bundledMetaRow?.classifiedAt || null,
    heuristicOnly: kvMetaRow?.heuristicOnly ?? bundledMetaRow?.heuristicOnly ?? null,
    overridden: {
      metadata: Boolean(kvMetaRow),
      translation: Boolean(kvTrRow),
    },
  };
}

export function buildCatalogFromIndex(index, rawById = {}, bundledMeta = {}, kvMeta = {}, bundledTr = {}, kvTr = {}) {
  return (index || []).map((entry) => buildCatalogRecord(
    entry,
    rawById[String(entry.id)] || null,
    bundledMeta,
    kvMeta,
    bundledTr,
    kvTr,
  ));
}

export function filterCatalogRecords(records, opts = {}) {
  const q = normalizeText(opts.q || '');
  const diff = opts.diff ? Number(opts.diff) : null;
  const equip = normalizeText(opts.equipment || '');
  const excluded = opts.excluded;
  const overridden = opts.overridden;

  return (records || []).filter((row) => {
    if (diff && row.diff !== diff) return false;
    if (equip && row.equipNorm !== equip && row.effectiveEquipNorm !== equip) return false;
    if (excluded === 'yes' && !row.excluded) return false;
    if (excluded === 'no' && row.excluded) return false;
    if (overridden === 'metadata' && !row.overridden?.metadata) return false;
    if (overridden === 'translation' && !row.overridden?.translation) return false;
    if (!q) return true;

    const hay = [
      row.id,
      row.name,
      row.nameBg,
      row.displayName,
      row.equipment,
      row.target,
      row.bodyPart,
      ...(row.flags || []),
      ...(row.gear || []),
    ].join(' ');
    return normalizeText(hay).includes(q);
  });
}

export function paginateCatalogRecords(records, page = 1, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const safePage = Math.max(1, Number(page) || 1);
  const total = records.length;
  const pages = Math.max(1, Math.ceil(total / safeLimit));
  const start = (safePage - 1) * safeLimit;
  return {
    items: records.slice(start, start + safeLimit),
    page: safePage,
    limit: safeLimit,
    total,
    pages,
  };
}

/**
 * Нормализира PATCH от админ UI към metadata + translation записи.
 * @returns {{ metadata: object|null, translation: object|null, errors: string[] }}
 */
export function normalizeCatalogPatch(patch = {}, raw = null) {
  const errors = [];
  const metadata = {};
  const translation = {};

  if ('diff' in patch) metadata.diff = clampDiff(patch.diff);
  if ('gf' in patch) metadata.gf = clampScore(patch.gf);
  if ('gm' in patch) metadata.gm = clampScore(patch.gm);

  if ('flags' in patch) {
    const flags = uniqueList(parseCsvList(patch.flags)).filter((f) => KNOWN_FLAGS.includes(f) || /^needs_/.test(f));
    metadata.flags = flags.slice(0, 12);
  }

  if ('gear' in patch) {
    const gear = uniqueList(parseCsvList(patch.gear)).filter((g) => KNOWN_GEAR.includes(g));
    metadata.gear = gear.slice(0, 10);
  }

  if ('effectiveEquipNorm' in patch) {
    const eq = normalizeText(patch.effectiveEquipNorm);
    if (eq) metadata.effectiveEquipNorm = eq;
  }

  if ('excluded' in patch) {
    metadata.excluded = Boolean(patch.excluded);
    const baseFlags = 'flags' in patch
      ? uniqueList(parseCsvList(patch.flags))
      : (Array.isArray(metadata.flags) ? metadata.flags : []);
    const flags = new Set(baseFlags);
    if (metadata.excluded) flags.add('excluded');
    else flags.delete('excluded');
    metadata.flags = [...flags].slice(0, 12);
  }

  if ('nameBg' in patch) {
    translation.nameBg = String(patch.nameBg || '').trim();
  }
  if ('instructionsBg' in patch) {
    translation.instructionsBg = String(patch.instructionsBg || '').trim();
  }

  const hasMeta = Object.keys(metadata).length > 0;
  const hasTr = Object.keys(translation).length > 0;
  if (!hasMeta && !hasTr) errors.push('Няма полета за запис');

  if (raw && hasMeta) {
    const en = pickInstructionsEn(raw.instructions);
    metadata.sourceHash = classifyContentHash(raw.name || '', raw.equipment || '', en);
    metadata.classifiedAt = new Date().toISOString();
    metadata.manualEdit = true;
    metadata.manual = true;
  }
  if (raw && hasTr) {
    translation.sourceHash = contentHash(raw.name || '', pickInstructionsEn(raw.instructions));
    translation.updatedAt = new Date().toISOString();
    translation.manualEdit = true;
  }

  return {
    metadata: hasMeta ? metadata : null,
    translation: hasTr ? translation : null,
    errors,
  };
}

export function applyCatalogPatchToStores(id, patchResult, metadataStore = {}, translationStore = {}) {
  const key = String(id);
  const nextMeta = { ...metadataStore };
  const nextTr = { ...translationStore };

  if (patchResult.metadata) {
    nextMeta[key] = { ...(nextMeta[key] || {}), ...patchResult.metadata };
  }
  if (patchResult.translation) {
    nextTr[key] = { ...(nextTr[key] || {}), ...patchResult.translation };
  }

  return { metadata: nextMeta, translations: nextTr };
}

export function exportCatalogPayload(records) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    count: records.length,
    exercises: records.map((row) => ({
      id: row.id,
      name: row.name,
      equipment: row.equipment,
      target: row.target,
      bodyPart: row.bodyPart,
      metadata: {
        diff: row.diff,
        gf: row.gf,
        gm: row.gm,
        flags: row.flags,
        gear: row.gear,
        effectiveEquipNorm: row.effectiveEquipNorm,
        excluded: row.excluded,
      },
      translation: {
        nameBg: row.nameBg,
        instructionsBg: row.instructionsBg,
      },
    })),
  };
}

export function importCatalogPayload(payload = {}, metadataStore = {}, translationStore = {}) {
  const rows = Array.isArray(payload?.exercises) ? payload.exercises : [];
  let updated = 0;
  let metadata = { ...metadataStore };
  let translations = { ...translationStore };

  for (const row of rows) {
    const id = String(row?.id ?? '');
    if (!id) continue;
    const patch = normalizeCatalogPatch({
      diff: row?.metadata?.diff,
      gf: row?.metadata?.gf,
      gm: row?.metadata?.gm,
      flags: row?.metadata?.flags,
      gear: row?.metadata?.gear,
      effectiveEquipNorm: row?.metadata?.effectiveEquipNorm,
      excluded: row?.metadata?.excluded,
      nameBg: row?.translation?.nameBg,
      instructionsBg: row?.translation?.instructionsBg,
    });
    if (patch.errors.length && !patch.metadata && !patch.translation) continue;
    const applied = applyCatalogPatchToStores(id, patch, metadata, translations);
    metadata = applied.metadata;
    translations = applied.translations;
    updated += 1;
  }

  return { metadata, translations, updated };
}
