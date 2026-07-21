/**
 * KA-TRAINER — самостоятелен Cloudflare Worker за AI тренировъчни планове.
 *
 * Проектиран за максимална икономичност:
 *   - 1 AI заявка = 1 цял седмичен план (с прекомпютнати алтернативи за всяко
 *     упражнение, така че смяната на упражнение е 0 заявки към бекенда).
 *   - Upgrade/downgrade на сложност = детерминистични правила в клиента (0 заявки).
 *   - Базата с упражнения се тегли еднократно, компактира се и се кешира в KV +
 *     в паметта на isolate-а — matching-ът е изцяло локален, без външни API.
 *   - Медията (GIF/thumbnail) се сервира директно от CDN, не минава през Worker-а.
 *   - AI треньорът (чат) праща само компактен контекст (~600 токена) + последните
 *     няколко съобщения, с дневен лимит в KV.
 *   - Mini-RAG: харкодирани експертни насоки, извличани по тагове от профила —
 *     в промпта влизат само релевантните, не всички.
 *
 * Endpoints:
 *   GET  /api/health           — статус
 *   POST /api/plan/generate    — генерира план от отговорите на въпросника (1 AI заявка)
 *   GET  /api/plan/:id         — връща съхранен план (с актуални преводи от индекса)
 *   POST /api/plan/refresh-exercises — обновява match/алтернативи от KV индекса
 *   POST /api/coach            — AI персонален треньор (чат)
 *   GET  /api/exercises/search — локално търсене в базата (debug/бъдеща употреба)
 *   GET  /api/admin/fitplan/guidelines — админ: зарежда насоки за mini-RAG
 *   POST /api/admin/fitplan/guidelines — админ: записва насоки в KV
 *   POST /api/fitplan/consultation — скрит въпросник (консултация)
 *   GET  /api/admin/fitplan/consultations — админ: списък консултации
 *   GET  /api/admin/fitplan/consult-config — админ: линк с токен
 *   GET/POST /api/admin/fitplan/client-programs — админ: клиентски програми
 *   POST /api/admin/fitplan/translate-exercises — партида превод + KV индекс (resilient batches)
 *
 * Bindings / vars (wrangler.toml + secrets):
 *   FITNESS_KV            — KV namespace (кеш на индекса, планове, rate limits)
 *   GEMINI_API_KEY        — secret, основен доставчик
 *   OPENAI_API_KEY        — secret, fallback
 *   GEMINI_MODEL          — по избор (default gemini-2.5-flash)
 *   OPENAI_MODEL          — по избор (default gpt-4o-mini)
 *   EXERCISE_DATASET_URL  — по избор, override на URL на базата
 *   MEDIA_BASE_URL        — по избор, override на CDN базата за медия
 *   GEN_DAILY_LIMIT       — по избор (default 3 генерации/ден/IP)
 *   CHAT_DAILY_LIMIT      — по избор (default 30 съобщения/ден/план)
 */

import { localizeExerciseDisplayName, sanitizeBgText, sanitizePlanBulgarian } from './exercise-labels-bg.js';
import {
  buildPlanSystemInstruction,
  COMPACT_PLAN_RETRY_HINT,
  GENDER_FIT_RETRY_HINT,
  PLAN_RESPONSE_SCHEMA,
  PLAN_SYSTEM_ASSEMBLY,
  STRICT_ASSEMBLY_RETRY_HINT,
} from './plan-prompts.js';
import { mergeExerciseTranslation } from './exercise-translations.js';
import {
  EXERCISE_TRANSLATIONS_KV_KEY,
  DEFAULT_BATCH_SIZE,
  DEFAULT_TRANSLATE_MODEL,
  WORKER_BATCH_SIZE,
  buildTranslateUserPayload,
  chunkBatches,
  fetchExerciseDataset,
  listPendingExercises,
  normalizeBatchResult,
  translationStats,
  translateBatchResilient,
} from './exercise-translate-batch.js';
import { normalizeText, tokenize } from './normalize.js';
import { buildProfileSummary } from './profile-summary.js';
import {
  GUIDELINE_CHUNKS,
  MAX_FOUNDATION_CHARS,
  MAX_GUIDELINE_ITEMS,
  MAX_GUIDELINE_CHARS,
  MAX_ARCHITECTURE_ITEMS,
  MAX_ARCHITECTURE_CHARS,
  buildTagsFromAnswers,
  extractTagsFromText,
  resolveGuidelineLayers,
  capGuidelineTexts,
  selectGuidelines,
  selectGuidelinesFromBrief,
  buildAdminPlanUserPrompt,
  buildBriefIdentityBlock,
  preparePlanGeneration,
  parseAdminBriefConstraints,
  allowedEquipmentFromBrief,
  auditPlanGenderFit,
  buildTrainerSystemAddon,
  parseChunkTags,
  shouldIncludeAdminChunk,
  expandEquipmentAnswers,
  equipmentHintTokensFromText,
  constraintsFromAnswers,
  hasClientScheme,
  mergeAllowedEquipment,
  isStrictAssembly,
} from './plan-generation.js';

export {
  normalizeText,
  tokenize,
  buildProfileSummary,
  GUIDELINE_CHUNKS,
  MAX_FOUNDATION_CHARS,
  MAX_GUIDELINE_ITEMS,
  MAX_GUIDELINE_CHARS,
  MAX_ARCHITECTURE_ITEMS,
  MAX_ARCHITECTURE_CHARS,
  buildTagsFromAnswers,
  extractTagsFromText,
  resolveGuidelineLayers,
  capGuidelineTexts,
  selectGuidelines,
  selectGuidelinesFromBrief,
  buildAdminPlanUserPrompt,
  buildBriefIdentityBlock,
  preparePlanGeneration,
  parseAdminBriefConstraints,
  allowedEquipmentFromBrief,
  auditPlanGenderFit,
  GENDER_FIT_RETRY_HINT,
  buildTrainerSystemAddon,
  parseChunkTags,
  shouldIncludeAdminChunk,
  constraintsFromAnswers,
  hasClientScheme,
  mergeAllowedEquipment,
  isStrictAssembly,
};

// ============================================================================
// Константи
// ============================================================================

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

// hasaneyldrm/exercises-dataset — 1324 упражнения (GIF + thumbnail).
// jsDelivr кешира агресивно => безплатен CDN трафик, нула натоварване на Worker-а.
const DEFAULT_MEDIA_BASE = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/';
const DATASET_URL_CANDIDATES = [
  'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/exercises.json',
  'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/exercises.json',
  'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/data/exercises.json',
  'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json',
];

const EXERCISE_INDEX_KV_KEY = 'exidx:v1';
const EXERCISE_INDEX_TTL = 60 * 60 * 24 * 30; // 30 дни; при промяна на схемата — нов ключ
const PLAN_TTL = 60 * 60 * 24 * 90;           // планът живее 90 дни в KV
const MATCH_THRESHOLD = 0.35;                 // под този score → fallback по категория
const MAX_ALTERNATIVES = 3;
const MAX_CHAT_HISTORY = 6;                   // последните 3 разменени реплики
const MAX_CHAT_MESSAGE_CHARS = 600;
const MAX_INSTRUCTION_CHARS = 1200;

// Admin mini-RAG: foundation + tagged chunks в KV (не в system prompt)
export const ADMIN_GUIDELINES_KV_KEY = 'admin:guidelines';
export const CONSULT_CONFIG_KV_KEY = 'admin:fitplan-consult';
export const CONSULTATIONS_LIST_KV_KEY = 'fitplan_consultations_list';
export const CLIENT_PROGRAMS_LIST_KV_KEY = 'fitplan_client_programs_list';
export const MAX_CONSULTATIONS = 200;
export const MAX_CLIENT_PROGRAMS = 100;
export const MAX_CLIENT_PROFILE_CHARS = 8000;
export const MAX_EXAMPLE_SCHEME_CHARS = 10000;
export const MAX_ADMIN_CHUNKS = 24;
const ADMIN_GUIDELINES_CACHE_TTL = 5 * 60 * 1000;

let adminGuidelinesCache = null;
let adminGuidelinesCacheTime = 0;

// Кеш в паметта на isolate-а — живее между заявките в рамките на един worker
// instance. Първата заявка след cold start чете от KV; всички следващи са безплатни.
let memoryIndex = null;

// ============================================================================
// Помощни: CORS / JSON отговори
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extraHeaders },
  });
}

function errorResponse(message, status = 400, code = 'error') {
  return jsonResponse({ success: false, code, message }, status);
}

// ============================================================================
// Нормализация и token matching (Част 2 от спецификацията)
// ============================================================================

/**
 * Token overlap score:
 *   score = брой съвпадащи думи / max(думи в заявката, думи в кандидата)
 */
export function tokenOverlapScore(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const candidateSet = new Set(candidateTokens);
  let overlap = 0;
  for (const token of new Set(queryTokens)) {
    if (candidateSet.has(token)) overlap++;
  }
  return overlap / Math.max(new Set(queryTokens).size, candidateSet.size);
}

/**
 * Намира най-добрия запис в индекса за подадено canonicalName + hints.
 * Bonus от hints разграничава близки имена (Bench Press с щанга vs с дъмбели).
 * Връща { entry, score, usedFallback } или null ако базата е празна.
 */
export function matchExercise(index, { canonicalName, equipmentHint, bodyPart }) {
  if (!index || !index.length) return null;

  const queryTokens = tokenize(canonicalName);
  const equipNorm = normalizeText(equipmentHint);
  const bodyNorm = normalizeText(bodyPart);

  let best = null;
  let bestScore = 0;

  for (const entry of index) {
    let score = tokenOverlapScore(queryTokens, entry.tokens);
    if (score === 0) continue;
    // Bonus от hints — само върху кандидати с текстово покритие.
    if (equipNorm && entry.equipNorm && (entry.equipNorm.includes(equipNorm) || equipNorm.includes(entry.equipNorm))) {
      score += 0.15;
    }
    if (bodyNorm && (entry.targetNorm === bodyNorm || entry.bodyNorm === bodyNorm)) {
      score += 0.1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  if (best && bestScore >= MATCH_THRESHOLD) {
    return { entry: best, score: Math.min(1, Number(bestScore.toFixed(3))), usedFallback: false };
  }

  // Fallback по категория: първи запис със същото equipment/target,
  // за да не остане празно поле в програмата.
  const fallback = index.find((e) =>
    (bodyNorm && (e.targetNorm === bodyNorm || e.bodyNorm === bodyNorm)) &&
    (!equipNorm || e.equipNorm === equipNorm)
  ) || index.find((e) => bodyNorm && (e.targetNorm === bodyNorm || e.bodyNorm === bodyNorm));

  if (fallback) return { entry: fallback, score: 0, usedFallback: true };
  return best ? { entry: best, score: Math.min(1, Number(bestScore.toFixed(3))), usedFallback: true } : null;
}

/**
 * Алтернативи за замяна: същата целева мускулна група, само с наличното
 * оборудване, различно упражнение. Връща до `limit` записа, като предпочита
 * разнообразие в оборудването (за да има смислен избор при замяна).
 */
export function findAlternatives(index, matchedEntry, { allowedEquipment = null, limit = MAX_ALTERNATIVES, excludeIds = [] } = {}) {
  if (!index || !matchedEntry) return [];
  const exclude = new Set([matchedEntry.id, ...excludeIds]);
  const target = matchedEntry.targetNorm;
  const body = matchedEntry.bodyNorm;

  const candidates = [];
  for (const entry of index) {
    if (exclude.has(entry.id)) continue;
    if (entry.nameNorm === matchedEntry.nameNorm) continue;
    const sameTarget = target && entry.targetNorm === target;
    const sameBody = body && entry.bodyNorm === body;
    if (!sameTarget && !sameBody) continue;
    if (allowedEquipment && !allowedEquipment.has(entry.equipNorm)) continue;
    candidates.push({ entry, rank: (sameTarget ? 2 : 0) + (entry.equipNorm === matchedEntry.equipNorm ? 1 : 0) });
  }

  candidates.sort((a, b) => b.rank - a.rank);

  // Разнообразие: макс 2 с едно и също оборудване.
  const picked = [];
  const equipCount = {};
  for (const { entry } of candidates) {
    if (picked.length >= limit) break;
    const eq = entry.equipNorm || '?';
    if ((equipCount[eq] || 0) >= 2) continue;
    equipCount[eq] = (equipCount[eq] || 0) + 1;
    picked.push(entry);
  }
  return picked;
}

// ============================================================================
// Компактен индекс на базата с упражнения
// ============================================================================

/**
 * Свежда суров запис от базата до компактен индексен запис.
 * Пази само необходимото за matching + рендериране (≈120 байта/запис без инструкции).
 * @param {object[]} rawList
 * @param {Record<string, {nameBg?: string, instructionsBg?: string}>} [translations]
 */
export function buildCompactIndex(rawList, translations = {}) {
  const index = [];
  for (const raw of rawList || []) {
    const name = raw.name || '';
    if (!name) continue;
    const entry = mergeExerciseTranslation({
      id: String(raw.id ?? index.length),
      name,
      nameNorm: normalizeText(name),
      tokens: tokenize(name),
      equipment: raw.equipment || '',
      equipNorm: normalizeText(raw.equipment),
      target: raw.target || raw.muscle_group || '',
      targetNorm: normalizeText(raw.target || raw.muscle_group),
      bodyPart: raw.body_part || raw.bodyPart || '',
      bodyNorm: normalizeText(raw.body_part || raw.bodyPart),
      secondary: Array.isArray(raw.secondary_muscles) ? raw.secondary_muscles.slice(0, 4) : [],
      image: raw.image || '',
      gif: raw.gif_url || raw.gifUrl || '',
    }, raw, translations, MAX_INSTRUCTION_CHARS);
    index.push(entry);
  }
  return index;
}

let bundledTranslations = null;

/** Build-time преводи: KV → bundled JSON fallback. */
export async function loadExerciseTranslations(env) {
  if (env?.FITNESS_KV) {
    try {
      const kv = await env.FITNESS_KV.get(EXERCISE_TRANSLATIONS_KV_KEY, { type: 'json' });
      if (kv && typeof kv === 'object' && Object.keys(kv).length) {
        bundledTranslations = kv;
        return kv;
      }
    } catch (e) {
      console.error('KV read за exercise translations пропадна:', e.message);
    }
  }
  return loadBundledTranslations();
}

/** Build-time преводи (data/exercise-translations-bg.json), ако са налични в bundle-а. */
export async function loadBundledTranslations() {
  if (bundledTranslations !== null) return bundledTranslations;
  try {
    const mod = await import('./data/exercise-translations-bg.json', { with: { type: 'json' } });
    bundledTranslations = mod.default || mod;
  } catch {
    bundledTranslations = {};
  }
  return bundledTranslations;
}

/**
 * Зарежда индекса: памет → KV → отдалечен fetch (еднократно).
 * Ако всичко пропадне, връща null — планът пак се генерира, само без медия.
 */
async function loadExerciseIndex(env, ctx) {
  if (memoryIndex) return memoryIndex;

  // 1. KV кеш
  if (env.FITNESS_KV) {
    try {
      const cached = await env.FITNESS_KV.get(EXERCISE_INDEX_KV_KEY, { type: 'json' });
      if (cached && Array.isArray(cached) && cached.length) {
        memoryIndex = cached;
        return memoryIndex;
      }
    } catch (e) {
      console.error('KV read за exercise index пропадна:', e.message);
    }
  }

  // 2. Отдалечен fetch — само при празен кеш (реално: веднъж на 30 дни)
  const urls = env.EXERCISE_DATASET_URL
    ? [env.EXERCISE_DATASET_URL, ...DATASET_URL_CANDIDATES]
    : DATASET_URL_CANDIDATES;

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'aidiet-fitness-worker' } });
      if (!res.ok) continue;
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.exercises || data.data || []);
      const translations = await loadExerciseTranslations(env);
      const index = buildCompactIndex(list, translations);
      if (index.length > 50) {
        memoryIndex = index;
        if (env.FITNESS_KV) {
          const save = env.FITNESS_KV.put(EXERCISE_INDEX_KV_KEY, JSON.stringify(index), { expirationTtl: EXERCISE_INDEX_TTL });
          if (ctx) ctx.waitUntil(save); else await save;
        }
        return memoryIndex;
      }
    } catch (e) {
      console.error(`Dataset fetch пропадна за ${url}:`, e.message);
    }
  }
  return null;
}

function mediaUrl(env, relativePath) {
  if (!relativePath) return '';
  if (/^https?:\/\//.test(relativePath)) return relativePath;
  const base = env.MEDIA_BASE_URL || DEFAULT_MEDIA_BASE;
  return base.replace(/\/+$/, '/') + String(relativePath).replace(/^\/+/, '');
}

// ============================================================================
// Оборудване: mapping BG (въпросник) → EN (база)
// ============================================================================

export const EQUIPMENT_MAP = {
  'пълно оборудване на зала': null, // null = без филтър
  'собствено тегло': ['body weight'],
  'дъмбели': ['dumbbell'],
  'щанга и дискове': ['barbell', 'ez barbell', 'olympic barbell'],
  'гира': ['kettlebell'],
  'ластици': ['band', 'resistance band'],
  'стабилизираща топка': ['stability ball'],
  'trx / окачени ремъци': ['body weight'],
};

/**
 * Връща Set от позволени equipment стойности (EN, нормализирани) или null,
 * ако клиентът има пълна зала (без филтър).
 */
export function allowedEquipmentSet(equipmentAnswers) {
  const set = new Set(['body weight']);
  const items = expandEquipmentAnswers(equipmentAnswers);
  for (const answer of items) {
    const key = normalizeText(answer);
    if (EQUIPMENT_MAP[key] === null || key.includes('зала') || key.includes('gym')) {
      return null;
    }
    if (key in EQUIPMENT_MAP) {
      for (const eq of EQUIPMENT_MAP[key] || []) set.add(normalizeText(eq));
      continue;
    }
    for (const hint of equipmentHintTokensFromText(answer)) set.add(hint);
  }
  return set;
}

// ============================================================================
// Mini-RAG: админ насоки в KV + зареждане (логиката е в plan-generation.js)
// ============================================================================

function normalizeAdminGuidelines(raw) {
  const foundation = String(raw?.foundation || '').trim().slice(0, MAX_FOUNDATION_CHARS);
  const chunks = (Array.isArray(raw?.chunks) ? raw.chunks : [])
    .slice(0, MAX_ADMIN_CHUNKS)
    .map((chunk) => {
      const tags = parseChunkTags(chunk?.tags);
      const text = String(chunk?.text || '').trim().slice(0, 500);
      return text ? { tags, text } : null;
    })
    .filter(Boolean);
  return { foundation, chunks, updatedAt: raw?.updatedAt || null };
}

export async function loadAdminGuidelines(env) {
  if (!env?.FITNESS_KV) return { foundation: '', chunks: [] };
  const now = Date.now();
  if (adminGuidelinesCache && (now - adminGuidelinesCacheTime) < ADMIN_GUIDELINES_CACHE_TTL) {
    return adminGuidelinesCache;
  }
  const raw = await env.FITNESS_KV.get(ADMIN_GUIDELINES_KV_KEY);
  if (!raw) {
    adminGuidelinesCache = { foundation: '', chunks: [] };
    adminGuidelinesCacheTime = now;
    return adminGuidelinesCache;
  }
  try {
    adminGuidelinesCache = normalizeAdminGuidelines(JSON.parse(raw));
    adminGuidelinesCacheTime = now;
    return adminGuidelinesCache;
  } catch {
    return { foundation: '', chunks: [] };
  }
}

function checkAdminSecret(request, env) {
  const secret = env.ADMIN_SECRET;
  if (!secret) return true;
  const provided = request.headers.get('X-Admin-Secret') || '';
  return provided === secret;
}

// ============================================================================
// AI доставчици: Gemini (основен) + OpenAI (fallback)
// ============================================================================

async function callGemini(env, { system, user, temperature = 0.4, maxOutputTokens = 8192, jsonMode = true }) {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const generationConfig = /** @type {GeminiGenerationConfig} */ ({
    temperature,
    maxOutputTokens,
    ...(jsonMode ? {
      responseMimeType: 'application/json',
      responseSchema: PLAN_RESPONSE_SCHEMA,
    } : {}),
  });
  // Gemini 2.5 Flash/Pro: thinking по подразбиране изяжда maxOutputTokens → отрязан JSON.
  if (/gemini-2\.5/i.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  const finishReason = candidate?.finishReason || '';
  const parts = candidate?.content?.parts || [];
  const text = parts
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join('') || parts.map((p) => p.text).filter(Boolean).join('');
  if (!text) {
    throw new Error(`Gemini: празен отговор${finishReason ? ` (${finishReason})` : ''}`);
  }
  if (finishReason === 'MAX_TOKENS') {
    const err = /** @type {WorkerError} */ (new Error('Gemini: отговорът е отрязан (MAX_TOKENS)'));
    err.truncated = true;
    throw err;
  }
  return text;
}

async function callOpenAI(env, { system, user, temperature = 0.4, maxOutputTokens = 8192, jsonMode = true }) {
  const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxOutputTokens,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content || '';
  const finishReason = choice?.finish_reason || '';
  if (!text) throw new Error('OpenAI: празен отговор');
  if (finishReason === 'length') {
    const err = /** @type {WorkerError} */ (new Error('OpenAI: отговорът е отрязан (length)'));
    err.truncated = true;
    throw err;
  }
  return text;
}

/** Един AI call с fallback между доставчиците. */
async function callAI(env, opts) {
  const errors = [];
  if (env.GEMINI_API_KEY) {
    try { return await callGemini(env, opts); } catch (e) { errors.push(e.message); }
  }
  if (env.OPENAI_API_KEY) {
    try { return await callOpenAI(env, opts); } catch (e) { errors.push(e.message); }
  }
  throw new Error(`Всички AI доставчици отказаха: ${errors.join(' | ') || 'липсват API ключове'}`);
}

/** Издръжлив JSON parse: сваля markdown огради и изрязва до най-външните скоби. */
export function parseAiJson(text) {
  let t = String(text || '').trim();
  if (!t) throw new Error('AI отговорът е празен');
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* опит с изрязване */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* пада долу */ }
  }
  if (start >= 0 && end <= start) {
    throw new Error('AI отговорът е отрязан преди края на JSON');
  }
  throw new Error('AI отговорът не е валиден JSON');
}

function isPlanParseError(err) {
  return /JSON|Планът|дни|отрязан|MAX_TOKENS/i.test(String(err?.message || '')) || Boolean(err?.truncated);
}

// ============================================================================
// Валидация и нормализация на плана от AI
// ============================================================================

const DAY_NAMES = ['Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота', 'Неделя'];

export function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('Планът липсва');
  const days = Array.isArray(plan.days) ? plan.days : [];
  if (!days.length) throw new Error('Планът няма дни');

  const normDays = days.slice(0, 7).map((d, i) => ({
    day: String(d.day || DAY_NAMES[i] || `Ден ${i + 1}`),
    focus: String(d.focus || ''),
    type: String(d.type || 'strength'),
    durationMin: Number(d.durationMin) || null,
    warmup: Array.isArray(d.warmup) ? d.warmup.map(String).slice(0, 8) : [],
    cooldown: Array.isArray(d.cooldown) ? d.cooldown.map(String).slice(0, 8) : [],
    exercises: (Array.isArray(d.exercises) ? d.exercises : []).slice(0, 12).map((ex) => ({
      displayName: localizeExerciseDisplayName(
        String(ex.canonicalName || ex.displayName || ''),
        String(ex.displayName || ex.canonicalName || ''),
        String(ex.equipmentHint || ''),
      ),
      canonicalName: String(ex.canonicalName || ex.displayName || ''),
      equipmentHint: String(ex.equipmentHint || ''),
      bodyPart: String(ex.bodyPart || ''),
      sets: Math.min(10, Math.max(1, Number(ex.sets) || 3)),
      reps: String(ex.reps || '10'),
      restSeconds: Math.min(300, Math.max(15, Number(ex.restSeconds) || 60)),
      tempo: String(ex.tempo || ''),
      rpe: String(ex.rpe || ''),
      notes: String(ex.notes || ''),
    })),
  }));

  // Допълни до 7 дни с почивки, ако AI е върнал по-малко.
  while (normDays.length < 7) {
    normDays.push({
      day: DAY_NAMES[normDays.length], focus: 'Почивка и възстановяване', type: 'rest',
      durationMin: null, warmup: [], cooldown: [], exercises: [],
    });
  }

  return {
    title: String(plan.title || 'Твоят седмичен тренировъчен план'),
    summary: String(plan.summary || ''),
    weeklySplit: String(plan.weeklySplit || ''),
    safetyNotes: Array.isArray(plan.safetyNotes) ? plan.safetyNotes.map(String).slice(0, 6) : [],
    days: normDays,
    guidelines: {
      progression: String(plan.guidelines?.progression || ''),
      recovery: String(plan.guidelines?.recovery || ''),
      nutrition: String(plan.guidelines?.nutrition || ''),
      adaptation: String(plan.guidelines?.adaptation || ''),
    },
  };
}

// ============================================================================
// Обогатяване: локален matching + медия + прекомпютнати алтернативи
// ============================================================================

function entryToClientExercise(env, entry) {
  const displayName = entry.nameBg || localizeExerciseDisplayName(entry.name, '', entry.equipment);
  return {
    id: entry.id,
    name: entry.name,
    displayName,
    nameBg: entry.nameBg || '',
    equipment: entry.equipment,
    target: entry.target,
    bodyPart: entry.bodyPart,
    imageUrl: mediaUrl(env, entry.image),
    gifUrl: mediaUrl(env, entry.gif),
    instructions: entry.instructions || '',
    instructionsLang: entry.instructionsLang || '',
  };
}

export function enrichPlanWithExercises(plan, index, { allowedEquipment = null, env = {} } = {}) {
  if (!index) return plan; // без база: планът остава валиден, само без медия

  for (const day of plan.days) {
    const usedIds = [];
    for (const ex of day.exercises) {
      const result = matchExercise(index, {
        canonicalName: ex.canonicalName,
        equipmentHint: ex.equipmentHint,
        bodyPart: ex.bodyPart,
      });
      if (result && result.entry) {
        ex.match = entryToClientExercise(env, result.entry);
        ex.matchScore = result.score;
        ex.matchFallback = result.usedFallback;
        usedIds.push(result.entry.id);
        // Прекомпютнати алтернативи → смяната на упражнение е 0 заявки към бекенда.
        ex.alternatives = findAlternatives(index, result.entry, {
          allowedEquipment,
          excludeIds: usedIds,
          limit: MAX_ALTERNATIVES,
        }).map((alt) => entryToClientExercise(env, alt));
        usedIds.push(...ex.alternatives.map((a) => a.id));
      } else {
        ex.match = null;
        ex.alternatives = [];
      }
      ex.displayName = ex.match?.displayName
        || localizeExerciseDisplayName(ex.canonicalName, ex.displayName, ex.equipmentHint);
    }
  }
  return plan;
}

// ============================================================================
// Компактен контекст за AI треньора (пази се с плана в KV)
// ============================================================================

export function buildCoachContext(profileSummary, plan) {
  const daysBrief = plan.days
    .map((d) => `${d.day.slice(0, 3)}: ${d.type === 'rest' ? 'почивка' : `${d.focus} (${d.exercises.length} упр.)`}`)
    .join('; ');
  const context = [
    'ПРОФИЛ:', profileSummary,
    '', `ПЛАН "${plan.title}" — ${plan.weeklySplit}`,
    daysBrief,
    plan.safetyNotes.length ? `Бележки за безопасност: ${plan.safetyNotes.join('; ')}` : '',
  ].filter(Boolean).join('\n');
  // Твърд таван (~800 токена), за да е предвидим разходът на чат заявка.
  return context.slice(0, 3200);
}

const COACH_SYSTEM_PROMPT = `Ти си личният AI треньор на клиента — подкрепящ, конкретен, на български. Отговаряй кратко (до 150 думи), практично и само по темите тренировки, техника, възстановяване, мотивация и обща активност.

Правила:
- Имаш контекста на плана и профила на клиента по-долу — позовавай се на тях.
- Медицински въпроси/болка: препоръчай преглед при специалист, не диагностицирай.
- Подробни хранителни планове не съставяш (отделна услуга) — само общи насоки.
- Ако клиентът иска промяна на плана, обясни как да ползва бутоните за замяна, олекотяване и утежняване в приложението, или дай конкретна устна корекция.`;

// ============================================================================
// Rate limiting (KV дневни броячи)
// ============================================================================

function todayStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function secondsToMidnightUTC() {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(60, Math.floor((midnight.getTime() - now.getTime()) / 1000));
}

/** Връща {allowed, remaining}. При липса на KV — always allow (dev режим). */
async function checkDailyLimit(env, bucket, id, max) {
  if (!env.FITNESS_KV) return { allowed: true, remaining: max };
  const key = `rl:${bucket}:${id}:${todayStamp()}`;
  const current = Number(await env.FITNESS_KV.get(key)) || 0;
  if (current >= max) return { allowed: false, remaining: 0 };
  await env.FITNESS_KV.put(key, String(current + 1), { expirationTtl: secondsToMidnightUTC() + 3600 });
  return { allowed: true, remaining: max - current - 1 };
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

// ============================================================================
// Handlers
// ============================================================================

async function executePlanGeneration(env, ctx, {
  userPrompt, coachProfileText, allowedEquipment = null, clientTags = null,
  adminConfig = null, guidelineLayers = null, hasScheme = false, strictAssembly = false,
}) {
  const indexPromise = loadExerciseIndex(env, ctx);
  const tagSet = clientTags instanceof Set ? clientTags : new Set(clientTags || []);
  const trainerAddon = strictAssembly
    ? ''
    : buildTrainerSystemAddon(adminConfig, tagSet, guidelineLayers, { schemeMode: hasScheme, strictAssembly });
  const system = strictAssembly ? PLAN_SYSTEM_ASSEMBLY : buildPlanSystemInstruction(trainerAddon);
  let plan;
  let rawText;
  const maxAttempts = 3;
  let lastFailure = 'parse';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let user = userPrompt;
    if (attempt > 0) {
      user += strictAssembly
        ? STRICT_ASSEMBLY_RETRY_HINT
        : (hasScheme
          ? COMPACT_PLAN_RETRY_HINT
          : (lastFailure === 'gender' ? GENDER_FIT_RETRY_HINT : COMPACT_PLAN_RETRY_HINT));
    }
    const aiOpts = {
      system,
      user,
      temperature: attempt === 0 ? 0.4 : 0.25,
      maxOutputTokens: 8192,
      jsonMode: true,
    };
    try {
      rawText = await callAI(env, aiOpts);
      plan = normalizePlan(parseAiJson(rawText));
      if (!hasScheme && !strictAssembly) {
        const genderAudit = auditPlanGenderFit(plan, clientTags);
        if (!genderAudit.ok && attempt < maxAttempts - 1) {
          lastFailure = 'gender';
          console.warn('Gender audit failed, retry:', genderAudit.issues.join('; '));
          continue;
        }
      }
      break;
    } catch (e) {
      const isLast = attempt === maxAttempts - 1;
      console.error(
        `AI план опит ${attempt + 1}/${maxAttempts} пропадна:`,
        e.message,
        `rawLen=${rawText?.length || 0}`,
        rawText ? `tail=${JSON.stringify(rawText.slice(-120))}` : '',
      );
      if (isLast) throw e;
      if (!isPlanParseError(e)) throw e;
      lastFailure = 'parse';
    }
  }

  const index = await indexPromise;
  enrichPlanWithExercises(plan, index, { allowedEquipment, env });
  sanitizePlanBulgarian(plan);
  const coachContext = buildCoachContext(coachProfileText, plan);
  return { plan, coachContext };
}

async function handleGeneratePlan(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('Невалиден JSON', 400); }
  const answers = body.answers;
  if (!answers || typeof answers !== 'object') return errorResponse('Липсват отговори от въпросника', 400);
  if (!answers.gender || !answers.age) return errorResponse('Непълни основни данни', 400);

  const genLimit = Number(env.GEN_DAILY_LIMIT) || 3;
  const rl = await checkDailyLimit(env, 'gen', clientIp(request), genLimit);
  if (!rl.allowed) {
    return errorResponse(`Достигнат е дневният лимит от ${genLimit} генерации. Опитай отново утре.`, 429, 'rate_limited');
  }

  const adminGuidelines = await loadAdminGuidelines(env);
  const { userPrompt, coachProfileText, allowedEquipment, clientTags, guidelineLayers, hasScheme, strictAssembly } = preparePlanGeneration(
    { answers },
    adminGuidelines,
    { buildProfileSummary, allowedEquipmentSet },
  );

  let plan;
  let coachContext;
  try {
    ({ plan, coachContext } = await executePlanGeneration(env, ctx, {
      userPrompt,
      coachProfileText,
      allowedEquipment,
      clientTags,
      adminConfig: adminGuidelines,
      guidelineLayers,
      hasScheme,
      strictAssembly,
    }));
  } catch (e) {
    if (isPlanParseError(e)) {
      return errorResponse('AI върна невалиден план. Опитай отново.', 502, 'ai_invalid');
    }
    return errorResponse('AI услугата е временно недостъпна. Опитай отново след минута.', 502, 'ai_unavailable');
  }

  const planId = crypto.randomUUID();
  const record = { plan, coachContext, createdAt: new Date().toISOString(), clientRef: body.clientRef || null };

  if (env.FITNESS_KV) {
    ctx.waitUntil(env.FITNESS_KV.put(`plan:${planId}`, JSON.stringify(record), { expirationTtl: PLAN_TTL }));
  }

  return jsonResponse({ success: true, planId, plan, coachContext, generationsRemaining: rl.remaining });
}

async function handleGetPlan(planId, env, ctx) {
  if (!env.FITNESS_KV) return errorResponse('Хранилището не е конфигурирано', 500);
  const record = await env.FITNESS_KV.get(`plan:${planId}`, { type: 'json' });
  if (!record) return errorResponse('Планът не е намерен или е изтекъл', 404, 'not_found');

  let plan = record.plan;
  const index = await loadExerciseIndex(env, ctx);
  if (index && plan) {
    plan = enrichPlanWithExercises(JSON.parse(JSON.stringify(plan)), index, { env });
  }

  return jsonResponse({
    success: true,
    planId,
    plan,
    coachContext: record.coachContext,
    createdAt: record.createdAt,
    regeneratedAt: record.regeneratedAt || null,
  }, 200, { 'Cache-Control': 'private, no-cache, no-store, must-revalidate' });
}

async function handleRefreshPlanExercises(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('Невалиден JSON', 400); }
  const plan = body?.plan;
  if (!plan?.days) return errorResponse('Липсва план', 400);

  const index = await loadExerciseIndex(env, ctx);
  if (!index) return jsonResponse({ success: true, plan });

  const allowed = Array.isArray(body.allowedEquipment)
    ? allowedEquipmentSet(body.allowedEquipment)
    : null;
  const refreshed = enrichPlanWithExercises(JSON.parse(JSON.stringify(plan)), index, { allowedEquipment: allowed, env });
  return jsonResponse({ success: true, plan: refreshed });
}

async function handleCoach(request, env) {
  let body;
  try { body = await request.json(); } catch { return errorResponse('Невалиден JSON', 400); }

  const message = String(body.message || '').trim().slice(0, MAX_CHAT_MESSAGE_CHARS);
  if (!message) return errorResponse('Празно съобщение', 400);
  const planId = String(body.planId || '').slice(0, 64);

  const chatLimit = Number(env.CHAT_DAILY_LIMIT) || 30;
  const rlId = planId || clientIp(request);
  const rl = await checkDailyLimit(env, 'chat', rlId, chatLimit);
  if (!rl.allowed) {
    return errorResponse(`Дневният лимит от ${chatLimit} съобщения е достигнат. AI треньорът ще е наличен отново утре.`, 429, 'rate_limited');
  }

  // Контекст: 1 KV read; ако планът е изтекъл, приемаме компактния контекст от клиента.
  let coachContext = '';
  if (planId && env.FITNESS_KV) {
    const record = await env.FITNESS_KV.get(`plan:${planId}`, { type: 'json' });
    if (record?.coachContext) coachContext = record.coachContext;
  }
  if (!coachContext && typeof body.contextFallback === 'string') {
    coachContext = body.contextFallback.slice(0, 3200);
  }

  // Историята се праща от клиента (пази се в localStorage) — 0 KV writes за чата.
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-MAX_CHAT_HISTORY)
    .map((m) => `${m.role === 'assistant' ? 'Треньор' : 'Клиент'}: ${String(m.text || '').slice(0, MAX_CHAT_MESSAGE_CHARS)}`)
    .join('\n');

  const adminGuidelines = await loadAdminGuidelines(env);
  const coachTags = extractTagsFromText(coachContext);
  const trainerGuidelines = buildTrainerSystemAddon(adminGuidelines, coachTags);

  const system = [
    COACH_SYSTEM_PROMPT,
    trainerGuidelines ? `\n${trainerGuidelines}` : '',
    '\n=== КОНТЕКСТ ===',
    coachContext || '(няма зареден план — отговаряй общо)',
  ].filter(Boolean).join('\n');
  const user = history ? `${history}\nКлиент: ${message}` : `Клиент: ${message}`;

  let reply;
  try {
    reply = await callAI(env, { system, user, temperature: 0.6, maxOutputTokens: 1024, jsonMode: false });
  } catch (e) {
    console.error('Coach AI пропадна:', e.message);
    return errorResponse('AI треньорът е временно недостъпен. Опитай пак след минута.', 502, 'ai_unavailable');
  }

  return jsonResponse({ success: true, reply: reply.trim(), messagesRemaining: rl.remaining });
}

async function handleExerciseSearch(url, env, ctx) {
  const index = await loadExerciseIndex(env, ctx);
  if (!index) return errorResponse('Базата с упражнения не е налична', 503);
  const q = url.searchParams.get('q') || '';
  const equipment = url.searchParams.get('equipment') || '';
  const target = url.searchParams.get('target') || '';
  const queryTokens = tokenize(q);
  const equipNorm = normalizeText(equipment);
  const targetNorm = normalizeText(target);

  const results = [];
  for (const entry of index) {
    if (equipNorm && entry.equipNorm !== equipNorm) continue;
    if (targetNorm && entry.targetNorm !== targetNorm && entry.bodyNorm !== targetNorm) continue;
    const score = queryTokens.length ? tokenOverlapScore(queryTokens, entry.tokens) : 0.01;
    if (score > 0) results.push({ score, entry });
  }
  results.sort((a, b) => b.score - a.score);
  return jsonResponse({
    success: true,
    count: results.length,
    results: results.slice(0, 20).map(({ score, entry }) => ({ score, ...entryToClientExercise(env, entry) })),
  }, 200, { 'Cache-Control': 'public, max-age=3600' });
}

async function handleGetAdminGuidelines(request, env) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  const config = await loadAdminGuidelines(env);
  const builtinTags = [...new Set(GUIDELINE_CHUNKS.flatMap((c) => c.tags))].sort();
  return jsonResponse({
    success: true,
    config,
    limits: {
      foundation: MAX_FOUNDATION_CHARS,
      chunkText: 500,
      maxChunks: MAX_ADMIN_CHUNKS,
      injectedItems: MAX_GUIDELINE_ITEMS,
      injectedChars: MAX_GUIDELINE_CHARS,
    },
    builtinTags,
    builtinChunkCount: GUIDELINE_CHUNKS.length,
  });
}

async function handleSaveAdminGuidelines(request, env) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500);

  let body;
  try { body = await request.json(); } catch { return errorResponse('Невалиден JSON', 400); }

  const config = normalizeAdminGuidelines({
    foundation: body.foundation,
    chunks: body.chunks,
    updatedAt: new Date().toISOString(),
  });

  await env.FITNESS_KV.put(ADMIN_GUIDELINES_KV_KEY, JSON.stringify(config));
  adminGuidelinesCache = config;
  adminGuidelinesCacheTime = Date.now();

  return jsonResponse({ success: true, config });
}

async function saveExerciseTranslations(env, translations) {
  await env.FITNESS_KV.put(EXERCISE_TRANSLATIONS_KV_KEY, JSON.stringify(translations));
  bundledTranslations = translations;
}

async function rebuildExerciseIndexInKv(env, translations) {
  const all = await fetchExerciseDataset(env.EXERCISE_DATASET_URL || undefined);
  const index = buildCompactIndex(all, translations);
  memoryIndex = index;
  await env.FITNESS_KV.put(EXERCISE_INDEX_KV_KEY, JSON.stringify(index), { expirationTtl: EXERCISE_INDEX_TTL });
  return {
    count: index.length,
    withBg: index.filter((e) => e.instructionsLang === 'bg').length,
  };
}

async function handleGetTranslateExercisesStatus(request, env) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');

  const translations = await loadExerciseTranslations(env);
  let all = [];
  try {
    all = await fetchExerciseDataset(env.EXERCISE_DATASET_URL || undefined);
  } catch (e) {
    return errorResponse(`Dataset: ${e.message}`, 502, 'dataset_error');
  }

  const stats = translationStats(all, translations);
  return jsonResponse({
    success: true,
    hasGemini: Boolean(env.GEMINI_API_KEY),
    hasKv: Boolean(env.FITNESS_KV),
    batchSize: WORKER_BATCH_SIZE,
    ...stats,
  });
}

async function handleRunTranslateExercises(request, env) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  if (!env.GEMINI_API_KEY) return errorResponse('Липсва GEMINI_API_KEY в worker', 503, 'no_gemini');
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500, 'no_kv');

  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  const maxBatches = Math.min(Math.max(Number(body.batches) || 1, 1), 2);
  const force = Boolean(body.force);
  const rebuildIndex = body.rebuildIndex !== false;
  const batchSize = WORKER_BATCH_SIZE;

  const translations = await loadExerciseTranslations(env);
  const all = await fetchExerciseDataset(env.EXERCISE_DATASET_URL || undefined);
  const pending = listPendingExercises(all, translations, { force });
  const batches = chunkBatches(pending, batchSize).slice(0, maxBatches);

  let addedThisRun = 0;
  for (const batch of batches) {
    const model = env.GEMINI_MODEL || DEFAULT_TRANSLATE_MODEL;
    const chunk = await translateBatchResilient(env.GEMINI_API_KEY, batch, model);
    Object.assign(translations, chunk);
    addedThisRun += Object.keys(chunk).length;
  }

  if (addedThisRun > 0) await saveExerciseTranslations(env, translations);

  const stats = translationStats(all, translations);
  let indexInfo = null;
  if (rebuildIndex && stats.remaining === 0) {
    indexInfo = await rebuildExerciseIndexInKv(env, translations);
  }

  return jsonResponse({
    success: true,
    addedThisRun,
    batchesProcessed: batches.length,
    complete: stats.remaining === 0,
    indexRebuilt: Boolean(indexInfo),
    index: indexInfo,
    ...stats,
  });
}

function randomConsultToken() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadConsultConfig(env) {
  if (!env.FITNESS_KV) return { token: '' };
  const raw = await env.FITNESS_KV.get(CONSULT_CONFIG_KV_KEY, { type: 'json' });
  return raw && typeof raw === 'object' ? raw : { token: '' };
}

async function ensureConsultToken(env) {
  const config = await loadConsultConfig(env);
  if (config.token) return config;
  const next = { token: randomConsultToken(), createdAt: new Date().toISOString() };
  await env.FITNESS_KV.put(CONSULT_CONFIG_KV_KEY, JSON.stringify(next));
  return next;
}

async function validateConsultAccess(env, accessKey) {
  const config = await ensureConsultToken(env);
  if (!accessKey || String(accessKey) !== config.token) {
    return { ok: false, message: 'Невалиден или изтекъл линк за консултация' };
  }
  return { ok: true };
}

async function handleSubmitConsultation(request, env) {
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500);

  let body;
  try { body = await request.json(); } catch { return errorResponse('Невалиден JSON', 400); }

  const access = await validateConsultAccess(env, body.accessKey);
  if (!access.ok) return errorResponse(access.message, 403, 'forbidden');

  const answers = body.answers;
  if (!answers || typeof answers !== 'object') return errorResponse('Липсват отговори', 400);
  if (!answers.gender || !answers.age) return errorResponse('Непълни основни данни', 400);

  const client = body.client || {};
  const name = String(client.name || '').trim();
  const contact = String(client.contact || '').trim();
  if (!name || !contact) return errorResponse('Липсват данни за контакт', 400);

  const id = `fc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const record = {
    id,
    clientName: name,
    clientContact: contact,
    answers,
    summary: buildProfileSummary(answers),
    status: 'new',
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get('User-Agent') || '',
  };

  await env.FITNESS_KV.put(`fitplan_consultation:${id}`, JSON.stringify(record));

  const listRaw = await env.FITNESS_KV.get(CONSULTATIONS_LIST_KV_KEY);
  const list = listRaw ? JSON.parse(listRaw) : [];
  list.unshift(id);
  if (list.length > MAX_CONSULTATIONS) list.length = MAX_CONSULTATIONS;
  await env.FITNESS_KV.put(CONSULTATIONS_LIST_KV_KEY, JSON.stringify(list));

  return jsonResponse({ success: true, id });
}

async function handleGetConsultations(request, env) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500);

  const listRaw = await env.FITNESS_KV.get(CONSULTATIONS_LIST_KV_KEY);
  const ids = listRaw ? JSON.parse(listRaw) : [];
  const items = [];
  for (const id of ids) {
    const raw = await env.FITNESS_KV.get(`fitplan_consultation:${id}`);
    if (raw) items.push(JSON.parse(raw));
  }
  return jsonResponse({ success: true, consultations: items });
}

async function handleGetConsultConfig(request, env) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500);

  const config = await ensureConsultToken(env);
  return jsonResponse({
    success: true,
    token: config.token,
    path: `fitness/consultation.html?k=${config.token}`,
    createdAt: config.createdAt || null,
  });
}

async function handleRegenerateConsultToken(request, env) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500);

  const config = { token: randomConsultToken(), createdAt: new Date().toISOString() };
  await env.FITNESS_KV.put(CONSULT_CONFIG_KV_KEY, JSON.stringify(config));
  return jsonResponse({
    success: true,
    token: config.token,
    path: `fitness/consultation.html?k=${config.token}`,
  });
}

async function handleMarkConsultationRead(request, env, id) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500);

  const raw = await env.FITNESS_KV.get(`fitplan_consultation:${id}`);
  if (!raw) return errorResponse('Консултацията не е намерена', 404, 'not_found');
  const record = JSON.parse(raw);
  record.status = 'read';
  record.readAt = new Date().toISOString();
  await env.FITNESS_KV.put(`fitplan_consultation:${id}`, JSON.stringify(record));
  return jsonResponse({ success: true });
}

// ============================================================================
// Админ: клиентски програми (бриф → AI → одобрение → линк)
// ============================================================================

function clientProgramKvKey(id) {
  return `fitplan_client_program:${id}`;
}

function trimClientProgramFields(body = {}) {
  const exampleScheme = String(body.exampleScheme || '').trim();
  const strictScheme = Boolean(body.strictScheme);
  const clientAnswers = body.clientAnswers && typeof body.clientAnswers === 'object' ? body.clientAnswers : null;
  const clientFormState = body.clientFormState && typeof body.clientFormState === 'object' ? body.clientFormState : null;
  const clientProfile = clientAnswers?.gender && clientAnswers?.age
    ? buildProfileSummary(clientAnswers).slice(0, MAX_CLIENT_PROFILE_CHARS)
    : '';
  return {
    clientName: String(body.clientName || '').trim().slice(0, 120),
    clientContact: String(body.clientContact || '').trim().slice(0, 200),
    clientProfile,
    clientAnswers,
    clientFormState,
    exampleScheme: exampleScheme.slice(0, MAX_EXAMPLE_SCHEME_CHARS),
    strictScheme,
    consultationId: String(body.consultationId || '').trim().slice(0, 80) || null,
  };
}

async function loadClientProgram(env, id) {
  const raw = await env.FITNESS_KV.get(clientProgramKvKey(id));
  return raw ? JSON.parse(raw) : null;
}

async function saveClientProgram(env, record) {
  await env.FITNESS_KV.put(clientProgramKvKey(record.id), JSON.stringify(record));
  const listRaw = await env.FITNESS_KV.get(CLIENT_PROGRAMS_LIST_KV_KEY);
  const list = listRaw ? JSON.parse(listRaw) : [];
  if (!list.includes(record.id)) {
    list.unshift(record.id);
    if (list.length > MAX_CLIENT_PROGRAMS) list.length = MAX_CLIENT_PROGRAMS;
    await env.FITNESS_KV.put(CLIENT_PROGRAMS_LIST_KV_KEY, JSON.stringify(list));
  }
}

function clientProgramPublicView(record) {
  const planId = record.planId || null;
  return {
    id: record.id,
    clientName: record.clientName,
    clientContact: record.clientContact,
    clientProfile: record.clientProfile,
    clientAnswers: record.clientAnswers || null,
    clientFormState: record.clientFormState || null,
    hasStructuredProfile: Boolean(record.clientAnswers?.gender),
    exampleScheme: record.exampleScheme,
    strictScheme: Boolean(record.strictScheme),
    consultationId: record.consultationId,
    status: record.status === 'approved' ? 'approved' : 'draft',
    planId,
    planTitle: record.planTitle || null,
    hasPlan: Boolean(planId),
    clientLinkPath: record.status === 'approved' && planId ? `fitness/app.html?plan=${planId}` : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    approvedAt: record.approvedAt || null,
  };
}

async function handleListClientPrograms(request, env) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500);

  const listRaw = await env.FITNESS_KV.get(CLIENT_PROGRAMS_LIST_KV_KEY);
  const ids = listRaw ? JSON.parse(listRaw) : [];
  const items = [];
  for (const id of ids) {
    const record = await loadClientProgram(env, id);
    if (record) items.push(clientProgramPublicView(record));
  }
  return jsonResponse({ success: true, programs: items });
}

async function handleSaveClientProgram(request, env) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500);

  let body;
  try { body = await request.json(); } catch { return errorResponse('Невалиден JSON', 400); }

  if (body?.action === 'delete') {
    const id = String(body.id || '').trim();
    if (!id) return errorResponse('Липсва ID на програмата', 400);
    return deleteClientProgramRecord(env, id);
  }

  const fields = trimClientProgramFields(body);
  if (!fields.clientName) return errorResponse('Моля, въведи име на клиента', 400);
  if (fields.strictScheme) {
    if (!fields.exampleScheme) {
      return errorResponse('При „Само сглобяване“ попълни пълната програма в схемата', 400);
    }
  } else if (!fields.clientAnswers?.gender) {
    return errorResponse('Попълни въпросника (поне пол и основни данни)', 400);
  }

  const now = new Date().toISOString();
  let record = body.id ? await loadClientProgram(env, body.id) : null;

  if (record && record.status === 'approved') {
    return errorResponse('Одобрената програма не може да се редактира. Създай нова.', 400, 'locked');
  }

  if (!record) {
    record = {
      id: `fcp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      status: 'draft',
      planId: null,
      planTitle: null,
      createdAt: now,
      approvedAt: null,
    };
  } else {
    const briefChanged = fields.clientProfile !== record.clientProfile
      || fields.exampleScheme !== record.exampleScheme
      || Boolean(fields.strictScheme) !== Boolean(record.strictScheme)
      || JSON.stringify(fields.clientAnswers || null) !== JSON.stringify(record.clientAnswers || null)
      || JSON.stringify(fields.clientFormState || null) !== JSON.stringify(record.clientFormState || null);
    if (briefChanged && record.planId) {
      await env.FITNESS_KV.delete(`plan:${record.planId}`);
      record.planId = null;
      record.planTitle = null;
    }
  }

  Object.assign(record, fields, { status: 'draft', updatedAt: now });
  await saveClientProgram(env, record);
  return jsonResponse({ success: true, program: clientProgramPublicView(record) });
}

async function handleGenerateClientProgram(request, env, ctx, id) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500);

  const record = await loadClientProgram(env, id);
  if (!record) return errorResponse('Програмата не е намерена', 404, 'not_found');
  if (record.status === 'approved') return errorResponse('Програмата вече е одобрена', 400, 'locked');
  if (!record.strictScheme && !record.clientAnswers?.gender) {
    return errorResponse('Попълни въпросника преди генерация', 400);
  }
  if (record.strictScheme && !record.exampleScheme?.trim()) {
    return errorResponse('Попълни схемата с пълната програма', 400);
  }

  const adminGuidelines = await loadAdminGuidelines(env);
  const genSource = {
    clientAnswers: record.clientAnswers || {},
    exampleScheme: record.exampleScheme,
    strictScheme: record.strictScheme,
    clientName: record.clientName,
    clientContact: record.clientContact,
  };
  const { userPrompt, coachProfileText, allowedEquipment, clientTags, guidelineLayers, hasScheme, strictAssembly } = preparePlanGeneration(
    genSource,
    adminGuidelines,
    { buildProfileSummary, allowedEquipmentSet },
  );

  let plan;
  let coachContext;
  try {
    ({ plan, coachContext } = await executePlanGeneration(env, ctx, {
      userPrompt,
      coachProfileText,
      allowedEquipment,
      clientTags,
      adminConfig: adminGuidelines,
      guidelineLayers,
      hasScheme,
      strictAssembly,
    }));
  } catch (e) {
    if (isPlanParseError(e)) {
      return errorResponse('AI върна невалиден план. Опитай отново или редактирай брифа.', 502, 'ai_invalid');
    }
    return errorResponse('AI услугата е временно недостъпна. Опитай отново след минута.', 502, 'ai_unavailable');
  }

  const oldPlanId = record.planId || null;
  const planId = crypto.randomUUID();
  const now = new Date().toISOString();

  if (oldPlanId && oldPlanId !== planId) {
    await env.FITNESS_KV.delete(`plan:${oldPlanId}`);
  }

  await env.FITNESS_KV.put(`plan:${planId}`, JSON.stringify({
    plan,
    coachContext,
    createdAt: now,
    regeneratedAt: now,
    status: 'draft',
    clientProgramId: record.id,
    clientName: record.clientName,
  }), { expirationTtl: PLAN_TTL });

  record.planId = planId;
  record.planTitle = plan.title || null;
  record.status = 'draft';
  record.updatedAt = now;
  record.approvedAt = null;
  await saveClientProgram(env, record);

  return jsonResponse({
    success: true,
    program: clientProgramPublicView(record),
    planId,
    replacedPlanId: oldPlanId,
  });
}

async function handleApproveClientProgram(request, env, id) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500);

  const record = await loadClientProgram(env, id);
  if (!record) return errorResponse('Програмата не е намерена', 404, 'not_found');
  if (record.status === 'approved' && record.planId) {
    const path = `fitness/app.html?plan=${record.planId}`;
    return jsonResponse({ success: true, planId: record.planId, path, program: clientProgramPublicView(record) });
  }
  if (!record.planId) return errorResponse('Първо генерирай програмата с AI', 400);

  const planRecord = await env.FITNESS_KV.get(`plan:${record.planId}`, { type: 'json' });
  if (!planRecord?.plan?.days?.length) return errorResponse('Планът не е намерен. Генерирай отново.', 404, 'not_found');

  const now = new Date().toISOString();
  planRecord.status = 'approved';
  planRecord.approvedAt = now;
  await env.FITNESS_KV.put(`plan:${record.planId}`, JSON.stringify(planRecord), { expirationTtl: PLAN_TTL });

  record.status = 'approved';
  record.approvedAt = now;
  record.updatedAt = now;
  await saveClientProgram(env, record);

  const path = `fitness/app.html?plan=${record.planId}`;
  return jsonResponse({ success: true, planId: record.planId, path, program: clientProgramPublicView(record) });
}

async function deleteClientProgramRecord(env, id) {
  const record = await loadClientProgram(env, id);
  if (!record) return errorResponse('Програмата не е намерена', 404, 'not_found');

  if (record.planId) await env.FITNESS_KV.delete(`plan:${record.planId}`);
  await env.FITNESS_KV.delete(clientProgramKvKey(id));
  const listRaw = await env.FITNESS_KV.get(CLIENT_PROGRAMS_LIST_KV_KEY);
  const list = listRaw ? JSON.parse(listRaw) : [];
  await env.FITNESS_KV.put(CLIENT_PROGRAMS_LIST_KV_KEY, JSON.stringify(list.filter((x) => x !== id)));
  return jsonResponse({ success: true });
}

async function handleDeleteClientProgram(request, env, id) {
  if (!checkAdminSecret(request, env)) return errorResponse('Неоторизиран достъп', 401, 'unauthorized');
  if (!env.FITNESS_KV) return errorResponse('KV не е конфигурирано', 500);
  return deleteClientProgramRecord(env, id);
}

// ============================================================================
// Router
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' } });
    }

    try {
      if (request.method === 'GET' && (path === '/' || path === '/api/health')) {
        return jsonResponse({
          success: true,
          service: 'aidiet-fitness',
          version: 1,
          providers: { gemini: Boolean(env.GEMINI_API_KEY), openai: Boolean(env.OPENAI_API_KEY) },
          kv: Boolean(env.FITNESS_KV),
        });
      }
      if (request.method === 'POST' && path === '/api/plan/generate') {
        return await handleGeneratePlan(request, env, ctx);
      }
      const planMatch = path.match(/^\/api\/plan\/([A-Za-z0-9-]{8,64})$/);
      if (request.method === 'GET' && planMatch) {
        return await handleGetPlan(planMatch[1], env, ctx);
      }
      if (request.method === 'POST' && path === '/api/plan/refresh-exercises') {
        return await handleRefreshPlanExercises(request, env, ctx);
      }
      if (request.method === 'POST' && path === '/api/coach') {
        return await handleCoach(request, env);
      }
      if (request.method === 'GET' && path === '/api/exercises/search') {
        return await handleExerciseSearch(url, env, ctx);
      }
      if (request.method === 'GET' && path === '/api/admin/fitplan/guidelines') {
        return await handleGetAdminGuidelines(request, env);
      }
      if (request.method === 'POST' && path === '/api/admin/fitplan/guidelines') {
        return await handleSaveAdminGuidelines(request, env);
      }
      if (request.method === 'GET' && path === '/api/admin/fitplan/translate-exercises') {
        return await handleGetTranslateExercisesStatus(request, env);
      }
      if (request.method === 'POST' && path === '/api/fitplan/consultation') {
        return await handleSubmitConsultation(request, env);
      }
      if (request.method === 'GET' && path === '/api/admin/fitplan/consultations') {
        return await handleGetConsultations(request, env);
      }
      if (request.method === 'GET' && path === '/api/admin/fitplan/consult-config') {
        return await handleGetConsultConfig(request, env);
      }
      if (request.method === 'POST' && path === '/api/admin/fitplan/consult-config') {
        return await handleRegenerateConsultToken(request, env);
      }
      const consultReadMatch = path.match(/^\/api\/admin\/fitplan\/consultations\/([A-Za-z0-9_-]+)\/read$/);
      if (request.method === 'POST' && consultReadMatch) {
        return await handleMarkConsultationRead(request, env, consultReadMatch[1]);
      }
      if (request.method === 'GET' && path === '/api/admin/fitplan/client-programs') {
        return await handleListClientPrograms(request, env);
      }
      if (request.method === 'POST' && path === '/api/admin/fitplan/client-programs') {
        return await handleSaveClientProgram(request, env);
      }
      const clientProgramGenerateMatch = path.match(/^\/api\/admin\/fitplan\/client-programs\/([A-Za-z0-9_-]+)\/generate$/);
      if (request.method === 'POST' && clientProgramGenerateMatch) {
        return await handleGenerateClientProgram(request, env, ctx, clientProgramGenerateMatch[1]);
      }
      const clientProgramApproveMatch = path.match(/^\/api\/admin\/fitplan\/client-programs\/([A-Za-z0-9_-]+)\/approve$/);
      if (request.method === 'POST' && clientProgramApproveMatch) {
        return await handleApproveClientProgram(request, env, clientProgramApproveMatch[1]);
      }
      const clientProgramDeleteMatch = path.match(/^\/api\/admin\/fitplan\/client-programs\/([A-Za-z0-9_-]+)(?:\/delete)?$/);
      if (request.method === 'DELETE' && clientProgramDeleteMatch) {
        return await handleDeleteClientProgram(request, env, clientProgramDeleteMatch[1]);
      }
      const clientProgramDeletePostMatch = path.match(/^\/api\/admin\/fitplan\/client-programs\/([A-Za-z0-9_-]+)\/delete$/);
      if (request.method === 'POST' && clientProgramDeletePostMatch) {
        return await handleDeleteClientProgram(request, env, clientProgramDeletePostMatch[1]);
      }
      if (request.method === 'POST' && path === '/api/admin/fitplan/translate-exercises') {
        try {
          return await handleRunTranslateExercises(request, env);
        } catch (e) {
          console.error('translate-exercises:', e.stack || e.message);
          return errorResponse(e.message || 'Грешка при превод', 500, 'translate_error');
        }
      }
      return errorResponse('Не е намерено', 404, 'not_found');
    } catch (e) {
      console.error('Необработена грешка:', e.stack || e.message);
      return errorResponse('Вътрешна грешка', 500, 'internal');
    }
  },
};
