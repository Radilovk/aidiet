/**
 * Batch AI класификация на упражнения (EFP).
 */
import { contentHash, fetchExerciseDataset, chunkBatches } from './exercise-translate-batch.js';
import { pickInstructionsEn } from './exercise-translations.js';
import { heuristicClassification } from './exercise-metadata.js';
import { normalizeText } from './normalize.js';

export const EXERCISE_METADATA_KV_KEY = 'exercise:metadata:v1';
export const DEFAULT_CLASSIFY_MODEL = 'gemini-2.5-flash';
export const CLASSIFY_BATCH_SIZE = 25;
export const WORKER_CLASSIFY_BATCH_SIZE = 12;

export const CLASSIFY_SYSTEM_PROMPT = `Ти си S&C експерт. Класифицираш упражнения за автоматичен избор в тренировъчни планове.

За всяко упражнение върни:
- diff: 1 (начинаещ) | 2 (среден) | 3 (напреднал/технично/тежко)
- gf: 0–100 колко подходящо за женски план (дупе/стягане/постура = високо; тежък мъжки press обем = ниско)
- gm: 0–100 колко подходящо за мъжки план
- flags: кратък масив от: compound, isolation, barbell, machine, bodyweight, cardio, glute, press, olympic

Повечето упражнения са 50–80 и за двата пола. Крайности само при ясен акцент.
Връщай САМО JSON без markdown.`;

export function classifyContentHash(name, equipment, instructionsEn) {
  return contentHash(`${name}\n${equipment}`, instructionsEn);
}

export function needsClassification(ex, existing, force = false) {
  if (force) return true;
  const id = String(ex.id);
  const cur = existing[id];
  if (!cur) return true;
  const en = pickInstructionsEn(ex.instructions);
  return cur.sourceHash !== classifyContentHash(ex.name || '', ex.equipment || '', en);
}

export function buildClassifyUserPayload(batch) {
  const items = batch.map((ex) => {
    const h = heuristicClassification(ex);
    return {
      id: String(ex.id),
      name: ex.name || '',
      equipment: ex.equipment || '',
      target: ex.target || ex.muscle_group || '',
      hint: { diff: h.diff, gf: h.gf, gm: h.gm },
    };
  });
  return `Класифицирай ${items.length} упражнения. hint е евристика — коригирай при нужда.

Формат:
{"classifications":[{"id":"...","diff":1,"gf":85,"gm":70,"flags":["machine"]}]}

${JSON.stringify({ exercises: items })}`;
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
    const fallback = heuristicClassification(ex);
    out[id] = {
      diff: clampDiff(row?.diff ?? fallback.diff),
      gf: clampScore(row?.gf ?? fallback.gf),
      gm: clampScore(row?.gm ?? fallback.gm),
      flags: Array.isArray(row?.flags) ? row.flags.slice(0, 6) : fallback.flags,
      sourceHash: hash,
      classifiedAt: new Date().toISOString(),
    };
  }
  return out;
}

function clampDiff(n) {
  const v = Number(n);
  return v >= 1 && v <= 3 ? v : 2;
}

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 70;
  return Math.max(0, Math.min(100, Math.round(v)));
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
        temperature: 0.1,
        maxOutputTokens: 8192,
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
    return normalizeClassifyResult(parsed, batch);
  } catch (e) {
    const msg = String(e.message || e);
    if (batch.length <= 1) {
      const ex = batch[0];
      const en = pickInstructionsEn(ex.instructions);
      const h = heuristicClassification(ex);
      return {
        [String(ex.id)]: {
          ...h,
          sourceHash: classifyContentHash(ex.name || '', ex.equipment || '', en),
          classifiedAt: new Date().toISOString(),
          heuristicFallback: true,
        },
      };
    }
    if (!/MAX_TOKENS|JSON|празен/i.test(msg)) throw e;
    const mid = Math.ceil(batch.length / 2);
    const left = await classifyBatchResilient(apiKey, batch.slice(0, mid), model);
    const right = await classifyBatchResilient(apiKey, batch.slice(mid), model);
    return { ...left, ...right };
  }
}

export function classificationStats(all, existing) {
  const total = all.length;
  const done = all.filter((ex) => !needsClassification(ex, existing, false)).length;
  return { total, done, remaining: total - done, stored: Object.keys(existing).length };
}

export { fetchExerciseDataset, chunkBatches };
