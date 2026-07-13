/**
 * FitPlan AI — самостоятелен Cloudflare Worker за AI тренировъчни планове.
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
 *   GET  /api/admin/fitplan/translate-exercises — статус на BG превод
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
export const MAX_FOUNDATION_CHARS = 800;
export const MAX_GUIDELINE_ITEMS = 8;
export const MAX_GUIDELINE_CHARS = 2400;
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

/** Долен регистър, без диакритика и пунктуация. */
export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-я\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Разбива нормализиран текст на множество от думи (tokens). */
export function tokenize(text) {
  const norm = normalizeText(text);
  return norm ? norm.split(' ') : [];
}

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
  const set = new Set(['body weight']); // собственото тегло е винаги налично
  for (const answer of equipmentAnswers || []) {
    const key = normalizeText(answer);
    if (key in EQUIPMENT_MAP || EQUIPMENT_MAP[key] === null) {
      if (EQUIPMENT_MAP[key] === null) return null;
      for (const eq of EQUIPMENT_MAP[key] || []) set.add(normalizeText(eq));
    } else if (key.includes('зала') || key.includes('gym')) {
      return null;
    }
  }
  return set;
}

// ============================================================================
// Mini-RAG: харкодирани експертни насоки, извличани по тагове
// ============================================================================
// Вместо векторна база: всяка "порция" знание е тагната. От профила на клиента
// се извличат тагове и в промпта влизат САМО съвпадащите порции. Това е
// икономичният еквивалент на RAG за домейн с краен, добре познат корпус.

export const GUIDELINE_CHUNKS = [
  {
    tags: ['goal:отслабване'],
    text: 'Отслабване: комбинирай съпротивителен тренинг (запазва мускулна маса) с кардио. Приоритет — многоставни движения с умерени тежести, 2-3 сек контролирана негативна фаза. Кардио зони: LISS 60-70% от макс. пулс или интервали според опита. Дефицитът идва от храненето — тренировката пази мускула.',
  },
  {
    tags: ['goal:покачване на мускулна маса'],
    text: 'Хипертрофия: 10-20 работни серии на мускулна група седмично, 6-12 повторения при 65-80% 1RM, почивка 60-120 сек, близо до отказ (RIR 1-3). Прогресия: първо повторения в диапазона, после тежест. Всяка група 2x седмично е по-ефективно от 1x.',
  },
  {
    tags: ['goal:силови показатели'],
    text: 'Сила: акцент върху основни движения (клек, тяга, преси) при 75-90% 1RM, 3-6 повторения, пълна почивка 2-4 мин. Обемът на помощните упражнения умерен. Техниката е с абсолютен приоритет пред тежестта.',
  },
  {
    tags: ['goal:издръжливост'],
    text: 'Издръжливост: 60-70% обем в зона 2, 1-2 интервални сесии седмично. Силова поддръжка 2x седмично с 15-20 повторения или кръгов формат за мускулна издръжливост.',
  },
  {
    tags: ['goal:рекомпозиция'],
    text: 'Рекомпозиция: тренирай като за хипертрофия (обемът строи мускул), добави 1-2 кратки кардио/HIIT сесии. Реалистично темпо — бавна видима промяна, затова заложи измерими силови прогресии за мотивация.',
  },
  {
    tags: ['goal:обща кондиция'],
    text: 'Обща кондиция: балансиран микс — 2 дни цялостен силов тренинг, 1-2 дни кардио/функционален, 1 ден мобилност/активно възстановяване. Разнообразието поддържа придържането.',
  },
  {
    tags: ['goal:рехабилитация след травма'],
    text: 'Рехабилитация: работи само в безболезнен диапазон, изокинетичен контрол, ниска тежест/високи повторения (12-20), едностранни упражнения за балансиране на асиметрии. Изрично напомняй, че планът не замества физиотерапевт.',
  },
  {
    tags: ['level:начинаещ'],
    text: 'Начинаещи (0-6 мес): 2-3 тренировки за цяло тяло седмично, 8-12 серии на група седмично стигат. Машини и собствено тегло преди свободни тежести за сложните движения. Първите 4-6 седмици фокус върху техника, RIR 3-4.',
  },
  {
    tags: ['level:среден'],
    text: 'Среден опит (2–5 г): горна/долна част или push/pull/крака, 10–16 серии на група седмично, периодизация на интензитета (тежка/лека седмица или вълнообразна в рамките на седмицата).',
  },
  {
    tags: ['level:напреднал'],
    text: 'Напреднали (5+ г): специализация по приоритетни групи, 14-20+ серии за приоритетните, поддръжка за останалите. Интензификационни техники (drop sets, rest-pause, cluster) пестеливо — 1-2 на тренировка.',
  },
  {
    tags: ['health:хипертония', 'health:сърдечно-съдово'],
    text: 'ВАЖНО (сърдечно-съдов риск): избягвай продължителни изометрични задържания и Валсалва маньовър, без максимални единични опити. Дишането е непрекъснато, интензитет умерен (RPE ≤7), по-дълги почивки. Препоръчай медицинско одобрение преди старт.',
  },
  {
    tags: ['health:диабет'],
    text: 'Диабет/преддиабет: редовността е по-важна от интензитета. Комбинация сила + кардио подобрява инсулиновата чувствителност. Внимание при хипогликемия — тренировка след хранене, не на празен стомах.',
  },
  {
    tags: ['health:бременност'],
    text: 'КРИТИЧНО (бременност): планът трябва да е одобрен от лекар. Без упражнения по гръб след 1-ви триместър, без коремни кранчове, без задържане на дъха, без риск от падане/удар. Умерен интензитет ("можеш да говориш"). Тазово дъно и дишане с приоритет.',
  },
  {
    tags: ['health:следродилен'],
    text: 'Следродилен период: постепенно връщане — първо тазово дъно и дълбоки коремни, после базови движения. Внимание за диастаза — без класически коремни преси преди проверка. Интензитетът се вдига едва след 3+ месеца при добро възстановяване.',
  },
  {
    tags: ['health:менопауза'],
    text: 'Менопауза: приоритизирай съпротивителен тренинг с по-високи тежести (костна плътност) и балансови елементи. Възстановяването е по-бавно — минимум 48ч между тежки сесии за същите групи.',
  },
  {
    tags: ['sleep:лошо', 'stress:висок'],
    text: 'Лош сън/висок стрес: намали обема с ~20% спрямо стандартната препоръка, избягвай тренировки до отказ, добави дихателни упражнения в cooldown. Възстановяването е лимитиращият фактор — не добавяй HIIT повече от 1x седмично.',
  },
  {
    tags: ['equipment:ограничено'],
    text: 'Ограничено оборудване: използвай tempo манипулация (3-1-3), unilateral варианти, mechanical drop sets и по-къси почивки за прогресивно натоварване без повече тежести.',
  },
  {
    tags: ['time:сутрин'],
    text: 'Сутрешни тренировки: удължи загрявката с 5 минути (ставна мобилност + постепенно вдигане на пулса) — тялото е по-сковано и вероятно на гладно. Тежките максимални опити са по-рискови рано сутрин.',
  },
  {
    tags: ['age:50+'],
    text: 'Възраст 50+: удължена загрявка, приоритет на контролирано темпо пред тежест, задължителни балансови и мобилност елементи, 48-72ч възстановяване между тежки сесии.',
  },
];

/** Ограничава броя и общата дължина на насоките в user prompt-а. */
export function capGuidelineTexts(texts, maxItems = MAX_GUIDELINE_ITEMS, maxChars = MAX_GUIDELINE_CHARS) {
  const result = [];
  let total = 0;
  for (const text of texts) {
    const t = String(text || '').trim();
    if (!t) continue;
    if (result.length >= maxItems) break;
    const remaining = maxChars - total;
    if (remaining <= 0) break;
    const slice = t.length > remaining ? t.slice(0, remaining) : t;
    result.push(slice);
    total += slice.length;
  }
  return result;
}

function normalizeAdminGuidelines(raw) {
  const foundation = String(raw?.foundation || '').trim().slice(0, MAX_FOUNDATION_CHARS);
  const chunks = (Array.isArray(raw?.chunks) ? raw.chunks : [])
    .slice(0, MAX_ADMIN_CHUNKS)
    .map((chunk) => {
      const tags = (Array.isArray(chunk?.tags) ? chunk.tags : String(chunk?.tags || '').split(','))
        .map((t) => String(t || '').trim().toLowerCase())
        .filter(Boolean);
      const text = String(chunk?.text || '').trim().slice(0, 500);
      return tags.length && text ? { tags, text } : null;
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

/** Извлича таговете от профила и връща само релевантните насоки. */
export function selectGuidelines(profile, adminConfig = null) {
  const tags = new Set();
  const goal = normalizeText(profile.goal?.main);
  if (goal) tags.add(`goal:${goal}`);

  const exp = normalizeText(profile.experience || '');
  if (exp.includes('никакъв') || exp.includes('начинаещ')) tags.add('level:начинаещ');
  else if (exp.includes('напреднал')) tags.add('level:напреднал');
  else if (exp.includes('среден')) tags.add('level:среден');

  const health = (profile.health || []).map(normalizeText).join(' ');
  if (health.includes('хипертония')) tags.add('health:хипертония');
  if (health.includes('сърдечно')) tags.add('health:сърдечно-съдово');
  if (health.includes('диабет')) tags.add('health:диабет');
  const female = (profile.healthFemale || []).map(normalizeText).join(' ');
  if (female.includes('бременна')) tags.add('health:бременност');
  if (female.includes('следродилен')) tags.add('health:следродилен');
  if (female.includes('менопауза')) tags.add('health:менопауза');

  if (normalizeText(profile.sleep || '').includes('лошо') || Number(profile.stress) >= 8) tags.add('sleep:лошо');

  const equipment = profile.equipment || [];
  const hasGym = equipment.some((e) => normalizeText(e).includes('зала'));
  if (!hasGym && equipment.length <= 2) tags.add('equipment:ограничено');

  if (normalizeText(profile.preferences?.timeOfDay || '').includes('сутрин')) tags.add('time:сутрин');
  if (Number(profile.age) >= 50) tags.add('age:50+');

  const allChunks = [...GUIDELINE_CHUNKS];
  if (Array.isArray(adminConfig?.chunks)) {
    allChunks.push(...adminConfig.chunks);
  }

  const selected = [];
  for (const chunk of allChunks) {
    if (chunk.tags.some((t) => tags.has(t))) selected.push(chunk.text);
  }
  return capGuidelineTexts(selected);
}

// ============================================================================
// Компактен профил от отговорите на въпросника
// ============================================================================

function line(label, value) {
  return value ? `${label}: ${value}` : '';
}

/**
 * Свежда 14-те отговора до компактен текстов профил (~250-400 токена),
 * използван и в промпта за генерация, и като контекст на AI треньора.
 */
export function buildProfileSummary(a) {
  const parts = [];
  parts.push(`${a.gender || '?'}, ${a.age || '?'} г., ${a.heightCm || '?'} см, ${a.weightKg || '?'} кг`);

  const health = [...(a.health || []), ...(a.healthFemale || [])].filter((h) => !normalizeText(h).includes('няма'));
  if (a.healthMeds) health.push(`медикаменти: ${a.healthMeds}`);
  if (a.healthOther) health.push(a.healthOther);
  parts.push(line('Здраве', health.join('; ') || 'без установени заболявания'));

  const limits = (a.limitations || []).filter((l) => !normalizeText(l).includes('нямам'));
  parts.push(line('Опорно-двигателни ограничения (ЗАДЪЛЖИТЕЛНО СЪОБРАЗИ)', limits.join('; ')));

  if (a.weightChange && a.weightChange.type && a.weightChange.type !== 'stable') {
    const dir = a.weightChange.type === 'gain' ? 'качил(а)' : 'свалил(а)';
    parts.push(`Тегло последните 6 мес: ${dir} ${a.weightChange.amountKg || '?'} кг (${a.weightChange.reason || 'без посочена причина'})`);
  }

  parts.push(line('Сън', a.sleep));
  parts.push(line('Стрес (1-10)', a.stress));
  parts.push(line('Дневна активност', a.dailyActivity));
  if (a.sportActivity) {
    parts.push(line('Спортна активност', a.sportActivity.status + (a.sportActivity.current ? ` — ${a.sportActivity.current}` : '')));
  }
  parts.push(line('Тренировъчен опит', a.experience));
  if (a.nutrition) {
    parts.push(line('Хранене', `${a.nutrition.type || '?'}${a.nutrition.custom ? ` (${a.nutrition.custom})` : ''}, ${a.nutrition.mealsPerDay || '?'} хранения/ден`));
  }
  if (a.goal) {
    const goalText = a.goal.main === 'друго' ? a.goal.other : a.goal.main;
    parts.push(line('ЦЕЛ', `${goalText || '?'}${a.goal.deadline ? `, срок: ${a.goal.deadline}` : ', без краен срок'}`));
  }
  parts.push(line('Оборудване', [...(a.equipment || []), a.equipmentOther].filter(Boolean).join(', ')));
  if (a.preferences) {
    const p = a.preferences;
    parts.push(line('Предпочитания', [
      (p.types || []).join('/'),
      p.freq ? `${p.freq} трен./седм.` : '',
      p.duration || '',
      p.timeOfDay ? `време: ${p.timeOfDay}` : '',
    ].filter(Boolean).join(', ')));
    parts.push(line('НЕ ЖЕЛАЕ движения', p.avoid));
  }
  parts.push(line('Допълнително от клиента', a.extraInfo));

  return parts.filter(Boolean).join('\n');
}

// ============================================================================
// AI промпт за генерация на план
// ============================================================================

const PLAN_SYSTEM_PROMPT = `Ти си елитен български треньор по силова и кондиционна подготовка (S&C) с 15+ години опит и образование по кинезитерапия. Създаваш индивидуален СЕДМИЧЕН тренировъчен план.

ТВЪРДИ ПРАВИЛА ЗА БЕЗОПАСНОСТ (hard-veto):
1. Ако клиентът е посочил болка/ограничение/операция в става или зона — ИЗКЛЮЧИ всички движения, които я натоварват директно, и предложи безопасни заместители. Не е информативно поле, а забрана.
2. Движенията, които клиентът изрично не желае — не ги включвай.
3. При сърдечно-съдов/метаболитен риск — умерен интензитет, без задържане на дъха, отбележи нуждата от лекарско одобрение в safetyNotes.
4. Използвай САМО оборудването, което клиентът реално има.

ПРАВИЛА ЗА ИМЕНУВАНЕ НА БЪЛГАРСКИ (критично — използвай естествен фитнес жаргон, НЕ буквален превод):
- displayName: името на упражнението НА БЪЛГАРСКИ (вижда го клиентът).
- canonicalName: стандартното АНГЛИЙСКО име от exercise бази (пример: "Barbell Bench Press", "Lat Pulldown"). НЕ превеждай canonicalName.
- equipmentHint: на английски (body weight, dumbbell, barbell, cable, leverage machine, band, kettlebell…).
- bodyPart: на английски (chest, back, shoulders, upper arms, upper legs, lower legs, waist, cardio).

ГЛОСАР — задължителни български термини:
- Bench Press (от лежанка) → „Избутване от лежанка“ / „Избутване с щанга от лежанка“ / „Избутване с дъмбели от лежанка“. НИКОГА „лег преса“ за bench press — „лег преса“ е само за Leg Press (машина за крака).
- Leg Press → „Преса за крака“ (машина), не „лег преса от лежанка“.
- Floor Press → „Избутване от пода“ (само когато canonicalName съдържа Floor).
- Overhead / Shoulder Press → „Раменно избутване“ или „Раменна преса“.
- Squat → „Клек“, Deadlift → „Мъртва тяга“, Row → „Гребане“, Pull-up → „Набирания“, Dip → „Кофички“.
- За адаптация на натоварването пиши „олекоти“ / „утежни“ — думата „затежни“ НЕ се използва в български.

СТРУКТУРА: точно 7 дни (понеделник-неделя). Дните за почивка са type "rest" с празен exercises масив и кратка препоръка в focus. Загрявка и разпускане — кратки текстови стъпки.

КОМПАКТНОСТ (критично за валиден JSON): макс. 5 упражнения на тренировъчен ден; warmup/cooldown по до 3 стъпки; notes до 80 знака; guidelines по 1–2 изречения на поле.

ОТГОВОРИ САМО С ВАЛИДЕН JSON без markdown ограждане, точно по тази схема:
{
  "title": "кратко мотивиращо заглавие на плана",
  "summary": "2-3 изречения защо планът е структуриран така за този клиент",
  "weeklySplit": "кратко описание на split-а, напр. Upper/Lower + кардио",
  "safetyNotes": ["важни предупреждения, ако има"],
  "days": [
    {
      "day": "Понеделник",
      "focus": "напр. Горна част — избутвания",
      "type": "strength|cardio|hiit|mobility|rest|active-recovery",
      "durationMin": 45,
      "warmup": ["стъпка 1", "стъпка 2"],
      "exercises": [
        {
          "displayName": "Избутване с щанга от лежанка",
          "canonicalName": "Barbell Bench Press",
          "equipmentHint": "barbell",
          "bodyPart": "chest",
          "sets": 4,
          "reps": "8-10",
          "restSeconds": 90,
          "tempo": "2-0-2",
          "rpe": "7-8",
          "notes": "кратка техническа бележка на български"
        }
      ],
      "cooldown": ["стъпка 1"]
    }
  ],
  "guidelines": {
    "progression": "как да прогресира седмица след седмица",
    "recovery": "сън, почивка, мобилност",
    "nutrition": "1-2 общи изречения (подробният хранителен режим е отделна услуга)",
    "adaptation": "кога да олекотиш или утежниш тренировката според усещането"
  }
}`;

export function buildPlanUserPrompt(profileSummary, guidelines, foundation = '') {
  const foundationText = String(foundation || '').trim().slice(0, MAX_FOUNDATION_CHARS);
  const foundationBlock = foundationText
    ? `\n\nБАЗОВИ ПРИНЦИПИ (физиология и биомеханика — винаги спазвай):\n${foundationText}`
    : '';
  const guidelineBlock = guidelines.length
    ? `\n\nСПЕЦИФИЧНИ ЕКСПЕРТНИ НАСОКИ ЗА ТОЗИ ПРОФИЛ (спазвай ги):\n- ${guidelines.join('\n- ')}`
    : '';
  return `ПРОФИЛ НА КЛИЕНТА (от въпросник):\n${profileSummary}${foundationBlock}${guidelineBlock}\n\nСъздай седмичния план сега. Отговори САМО с JSON.`;
}

const COMPACT_PLAN_RETRY_HINT = `

ВАЖНО — КОМПАКТЕН ИЗХОД (задължително):
- Макс. 4 упражнения на тренировъчен ден.
- warmup/cooldown: по 2 кратки стъпки.
- notes: до 60 знака.
- guidelines: по 1 кратко изречение на поле.
- Отговори САМО с пълен, валиден JSON без markdown.`;

// ============================================================================
// AI доставчици: Gemini (основен) + OpenAI (fallback)
// ============================================================================

async function callGemini(env, { system, user, temperature = 0.4, maxOutputTokens = 8192, jsonMode = true }) {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const generationConfig = {
    temperature,
    maxOutputTokens,
    ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
  };
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
    const err = new Error('Gemini: отговорът е отрязан (MAX_TOKENS)');
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
    const err = new Error('OpenAI: отговорът е отрязан (length)');
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
  return Math.max(60, Math.floor((midnight - now) / 1000));
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

  // Индексът се зарежда паралелно с AI заявката — не удължава latency.
  const indexPromise = loadExerciseIndex(env, ctx);

  const profileSummary = buildProfileSummary(answers);
  const adminGuidelines = await loadAdminGuidelines(env);
  const guidelines = selectGuidelines(answers, adminGuidelines);
  const baseUserPrompt = buildPlanUserPrompt(profileSummary, guidelines, adminGuidelines.foundation);

  let plan;
  let rawText;
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const userPrompt = attempt === 0 ? baseUserPrompt : `${baseUserPrompt}${COMPACT_PLAN_RETRY_HINT}`;
    const aiOpts = {
      system: PLAN_SYSTEM_PROMPT,
      user: userPrompt,
      temperature: attempt === 0 ? 0.4 : 0.25,
      maxOutputTokens: 8192,
      jsonMode: true,
    };
    try {
      rawText = await callAI(env, aiOpts);
      plan = normalizePlan(parseAiJson(rawText));
      break;
    } catch (e) {
      const isLast = attempt === maxAttempts - 1;
      console.error(
        `AI план опит ${attempt + 1}/${maxAttempts} пропадна:`,
        e.message,
        `rawLen=${rawText?.length || 0}`,
        rawText ? `tail=${JSON.stringify(rawText.slice(-120))}` : '',
      );
      if (isLast) {
        if (isPlanParseError(e)) {
          return errorResponse('AI върна невалиден план. Опитай отново.', 502, 'ai_invalid');
        }
        return errorResponse('AI услугата е временно недостъпна. Опитай отново след минута.', 502, 'ai_unavailable');
      }
      if (!isPlanParseError(e)) {
        return errorResponse('AI услугата е временно недостъпна. Опитай отново след минута.', 502, 'ai_unavailable');
      }
    }
  }

  const index = await indexPromise;
  const allowed = allowedEquipmentSet(answers.equipment);
  enrichPlanWithExercises(plan, index, { allowedEquipment: allowed, env });
  sanitizePlanBulgarian(plan);

  const planId = crypto.randomUUID();
  const coachContext = buildCoachContext(profileSummary, plan);
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
  }, 200, { 'Cache-Control': 'private, max-age=300' });
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

  const system = `${COACH_SYSTEM_PROMPT}\n\n=== КОНТЕКСТ ===\n${coachContext || '(няма зареден план — отговаряй общо)'}`;
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
