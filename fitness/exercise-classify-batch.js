/**
 * Batch AI класификация на упражнения (EFP v2) — индивидуален преглед, без евристични hints.
 */
import { contentHash, fetchExerciseDataset, chunkBatches } from './exercise-translate-batch.js';
import { pickInstructionsEn } from './exercise-translations.js';
import { applyMetadataCorrections } from './exercise-tags.js';
import { isGenderSpecificExerciseName } from './exercise-name-bg.js';
import {
  CLASSIFY_RUBRIC,
  CLASSIFY_RESPONSE_SCHEMA,
  EFP_VERSION,
  deriveDiffFromDimensions,
  clampDiff,
  clampScore,
  sanitizeFlags,
} from './exercise-efp-rubric.js';

export const EXERCISE_METADATA_KV_KEY = 'exercise:metadata:v1';
export const DEFAULT_CLASSIFY_MODEL = 'gemini-2.5-flash';
/** По 1 упражнение — пълен индивидуален преглед. */
export const CLASSIFY_BATCH_SIZE = 1;
export const WORKER_CLASSIFY_BATCH_SIZE = 1;

export const CLASSIFY_SYSTEM_PROMPT = CLASSIFY_RUBRIC;

export function classifyContentHash(name, equipment, instructionsEn) {
  return contentHash(`${EFP_VERSION}\n${name}\n${equipment}`, instructionsEn);
}

export function needsClassification(ex, existing, force = false) {
  if (force) return true;
  const id = String(ex.id);
  const cur = existing[id];
  if (!cur) return true;
  if ((cur.efpVersion ?? 0) < EFP_VERSION) return true;
  if (!cur.aiClassified || cur.heuristicOnly) return true;
  const en = pickInstructionsEn(ex.instructions);
  return cur.sourceHash !== classifyContentHash(ex.name || '', ex.equipment || '', en);
}

function exercisePayload(ex) {
  const instructionsEn = pickInstructionsEn(ex.instructions);
  return {
    id: String(ex.id),
    name: ex.name || '',
    equipment: ex.equipment || '',
    target: ex.target || '',
    muscle_group: ex.muscle_group || '',
    body_part: ex.body_part || ex.bodyPart || '',
    secondary_muscles: Array.isArray(ex.secondary_muscles) ? ex.secondary_muscles.slice(0, 6) : [],
    instructions: instructionsEn ? instructionsEn.slice(0, 1200) : '',
  };
}

export function buildClassifyUserPayload(batch) {
  const exercises = batch.map(exercisePayload);
  return `Класифицирай ${exercises.length} упражнение(ния) по рубриката. Без шаблони — прегледай инструкциите.

Формат:
${CLASSIFY_RESPONSE_SCHEMA}

${JSON.stringify({ exercises })}`;
}

export function normalizeClassifyResult(parsed, batch) {
  const list = parsed?.classifications || parsed?.exercises || (Array.isArray(parsed) ? parsed : []);
  const byId = new Map(list.map((row) => [String(row.id), row]));
  const out = {};
  for (const ex of batch) {
    const id = String(ex.id);
    const row = byId.get(id);
    const en = pickInstructionsEn(ex.instructions);
    const hash = classifyContentHash(ex.name || '', ex.equipment || '', en);

    if (!row) continue;

    const motor = clampDiff(row.motor ?? row.diff);
    const coordination = clampDiff(row.coordination ?? row.diff);
    const plyometric = Boolean(row.plyometric);
    const diff = deriveDiffFromDimensions({
      motor,
      coordination,
      plyometric,
      diff: row.diff,
    });

    let flags = sanitizeFlags(row.flags);
    if (plyometric && !flags.includes('plyometric')) flags.push('plyometric');
    if (plyometric && !flags.includes('advanced')) flags.push('advanced');
    if (motor >= 3 || coordination >= 3) {
      if (!flags.includes('advanced')) flags.push('advanced');
    }
    if (isGenderSpecificExerciseName(ex.name)) {
      flags.push('gender_variant', 'excluded');
    }

    const corrected = applyMetadataCorrections(ex, {
      diff,
      gf: clampScore(row.gf),
      gm: clampScore(row.gm),
      flags,
    });

    out[id] = {
      diff: corrected.diff,
      gf: corrected.gf,
      gm: corrected.gm,
      flags: corrected.flags,
      gear: corrected.gear,
      effectiveEquipNorm: corrected.effectiveEquipNorm,
      motor,
      coordination,
      plyometric,
      sourceHash: hash,
      classifiedAt: new Date().toISOString(),
      aiClassified: true,
      efpVersion: EFP_VERSION,
      excluded: flags.includes('excluded'),
    };
  }
  return out;
}

export async function callGeminiClassify(apiKey, user, model = DEFAULT_CLASSIFY_MODEL) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CLASSIFY_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.05,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 400)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.filter((p) => !p.thought)
    ?.map((p) => p.text)
    .join('') || '';
  if (!text) throw new Error('Gemini: празен отговор');
  return JSON.parse(text);
}

export function listPendingClassifications(all, existing, { force = false, limit = 0 } = {}) {
  let pending = all.filter((ex) => needsClassification(ex, existing, force));
  if (limit > 0) pending = pending.slice(0, limit);
  return pending;
}

export async function classifyBatchResilient(apiKey, batch, model = DEFAULT_CLASSIFY_MODEL) {
  if (!batch.length) return {};
  try {
    const parsed = await callGeminiClassify(apiKey, buildClassifyUserPayload(batch), model);
    const out = normalizeClassifyResult(parsed, batch);
    if (Object.keys(out).length === 0 && batch.length === 1) {
      throw new Error('Gemini: липсва класификация за упражнение');
    }
    return out;
  } catch (e) {
    if (batch.length <= 1) throw e;
    const mid = Math.ceil(batch.length / 2);
    const left = await classifyBatchResilient(apiKey, batch.slice(0, mid), model);
    const right = await classifyBatchResilient(apiKey, batch.slice(mid), model);
    return { ...left, ...right };
  }
}

export function classificationStats(all, existing) {
  const total = all.length;
  const curated = all.filter((ex) => {
    const row = existing[String(ex.id)];
    return row?.aiClassified && (row.efpVersion ?? 0) >= EFP_VERSION && !row.heuristicOnly;
  }).length;
  const pending = all.filter((ex) => needsClassification(ex, existing, false)).length;
  return { total, curated, done: curated, remaining: pending, stored: Object.keys(existing).length };
}

export { fetchExerciseDataset, chunkBatches };
