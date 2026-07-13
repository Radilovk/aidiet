/**
 * Споделена логика за batch превод на упражнения (Node скрипт + Cloudflare Worker).
 */
import { pickInstructionsEn } from './exercise-translations.js';
import { localizeExerciseDisplayName } from './exercise-labels-bg.js';

export const EXERCISE_DATASET_URL = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/data/exercises.json';
export const EXERCISE_TRANSLATIONS_KV_KEY = 'exercise:translations:bg';
export const DEFAULT_TRANSLATE_MODEL = 'gemini-2.5-flash';
export const DEFAULT_BATCH_SIZE = 50;

export const TRANSLATE_SYSTEM_PROMPT = `Ти си експерт по спортна медицина, кинезиология и професионален фитнес треньор.
Превеждай на анатомично точен, професионален и четивен български език.
Не превеждай буквално жаргона — използвай утвърдени български термини:
- bench press → избутване от лежанка (НЕ „лег преса“ за bench)
- leg press → преса за крака
- hip hinge → сгъване в тазобедрените стави
- core bracing → стягане на коремния корсет
Запази HTML тагове, ако има. Връщай САМО валиден JSON без markdown.`;

/** Портативен hash за промяна на източника (Worker + Node). */
export function contentHash(name, instructionsEn) {
  const s = `${name}\n${instructionsEn}`;
  let h1 = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 16777619);
  }
  let h2 = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h2 = Math.imul(h2, 33) ^ s.charCodeAt(i);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function needsTranslation(ex, existing, force = false) {
  if (force) return true;
  const id = String(ex.id);
  const cur = existing[id];
  if (!cur) return true;
  const en = pickInstructionsEn(ex.instructions);
  return cur.sourceHash !== contentHash(ex.name, en);
}

export function buildTranslateUserPayload(batch) {
  const items = batch.map((ex) => ({
    id: String(ex.id),
    nameEn: ex.name || '',
    equipment: ex.equipment || '',
    instructionsEn: pickInstructionsEn(ex.instructions).slice(0, 900),
    suggestedNameBg: localizeExerciseDisplayName(ex.name, '', ex.equipment),
  }));
  return `Преведи следните ${items.length} упражнения. За всяко върни nameBg (кратко българско име) и instructionsBg (пълен превод на инструкциите).

Формат на отговора (строго):
{"translations":[{"id":"...","nameBg":"...","instructionsBg":"..."}]}

${JSON.stringify({ exercises: items })}`;
}

export function normalizeBatchResult(parsed, batch) {
  const list = parsed?.translations || parsed?.exercises || (Array.isArray(parsed) ? parsed : []);
  const byId = new Map(list.map((row) => [String(row.id), row]));
  const out = {};
  for (const ex of batch) {
    const id = String(ex.id);
    const row = byId.get(id);
    if (!row?.nameBg && !row?.instructionsBg) continue;
    const en = pickInstructionsEn(ex.instructions);
    out[id] = {
      nameBg: String(row.nameBg || '').trim(),
      instructionsBg: String(row.instructionsBg || '').trim(),
      sourceHash: contentHash(ex.name, en),
      translatedAt: new Date().toISOString(),
    };
  }
  return out;
}

export async function fetchExerciseDataset(url = EXERCISE_DATASET_URL) {
  const res = await fetch(url, { headers: { 'User-Agent': 'aidiet-fitness-translate' } });
  if (!res.ok) throw new Error(`Dataset HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.exercises || data.data || []);
}

export async function callGeminiTranslate(apiKey, user, model = DEFAULT_TRANSLATE_MODEL) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: TRANSLATE_SYSTEM_PROMPT }] },
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

export function listPendingExercises(all, existing, { force = false, limit = 0 } = {}) {
  let pending = all.filter((ex) => needsTranslation(ex, existing, force));
  if (limit > 0) pending = pending.slice(0, limit);
  return pending;
}

export function chunkBatches(items, batchSize = DEFAULT_BATCH_SIZE) {
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

export function translationStats(all, existing) {
  const total = all.length;
  const done = all.filter((ex) => !needsTranslation(ex, existing, false)).length;
  return { total, done, remaining: total - done, stored: Object.keys(existing).length };
}
