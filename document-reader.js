/**
 * Разчитане на изследвания и медицински документи с Claude (Anthropic API, secret ANTHROPIC_API_KEY).
 *
 * Защо Claude: документите са PDF или снимки на бланки с таблици, единици и референтни граници.
 * Claude Opus 5.5 чете PDF директно (без „снимай страницата“), а структурираният изход (JSON Schema)
 * гарантира валиден JSON с точните полета — без поправяне на отговора. Праговете и решенията за плана
 * остават в кода (enrichment-labs.js, enrichment-documents.js); моделът само разчита и преценява.
 *
 * Без ключ или при грешка извикващият минава на досегашния път (Gemini) — нищо не спира.
 */
import Anthropic from '@anthropic-ai/sdk';

export const READER_MODEL = 'claude-opus-5-5';
/** $ за 1M токена (вход, изход) — за дневния таван на AI разхода. */
const PRICE = { in: 4, out: 20 };

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const LAB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['date', 'markers'],
  properties: {
    date: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Датата на вземане на пробата, YYYY-MM-DD, или null' },
    markers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'printedName', 'value', 'unit', 'refLow', 'refHigh', 'confidence'],
        properties: {
          key: { type: 'string' },
          printedName: { type: 'string' },
          value: { type: 'number' },
          unit: { type: 'string' },
          refLow: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          refHigh: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          confidence: { type: 'number' },
        },
      },
    },
  },
};

const strArr = { type: 'array', items: { type: 'string' } };
// Полетата на admin_document_assessment_prompt (normalizeDocumentValue ги проверява след това).
const DOCUMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['relevant', 'docType', 'isLabReport', 'title', 'date', 'summary', 'findings', 'clinical', 'exclusions', 'medications', 'cautions', 'impact', 'planChanges'],
  properties: {
    relevant: { type: 'boolean' },
    docType: { type: 'string', enum: ['epicrisis', 'doctor_note', 'prescription', 'imaging', 'lab', 'allergy', 'own_note', 'other'] },
    isLabReport: { type: 'boolean' },
    title: { type: 'string' },
    date: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    summary: { type: 'string' },
    findings: strArr,
    clinical: strArr,
    exclusions: strArr,
    medications: strArr,
    cautions: strArr,
    impact: { type: 'string', enum: ['none', 'context', 'menu', 'strategy'] },
    planChanges: strArr,
  },
};

const SYSTEM = `Разчиташ медицински документи на клиенти на Nutriin (хранителни планове). Точността е по-важна от пълнотата:
- Пренасяш числата и единиците точно както са отпечатани; не ги закръгляш и не ги преобразуваш.
- Ако цифра, единица или ред не се чете сигурно, даваш ниска увереност (под 0.7) — не гадаеш.
- Не поставяш диагнози и не даваш медицински съвети; решенията за плана се взимат в кода и от специалист.`;

function fileBlock(base64, mimeType) {
  if (mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  }
  return { type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES.has(mimeType) ? mimeType : 'image/jpeg', data: base64 } };
}

/**
 * Едно извикване: файл (по избор) + указанията → JSON по схемата.
 * @returns {Promise<{ result: any, usd: number }>}
 */
async function read(env, { prompt, base64, mimeType, schema, effort, client }) {
  const api = client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const content = [];
  if (base64) content.push(fileBlock(base64, mimeType));
  content.push({ type: 'text', text: prompt });
  const message = await api.beta.messages.stream({
    model: READER_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema } },
    // При отказ по правилата за безопасност същата заявка минава на резервен модел.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  }).finalMessage();
  const u = message.usage || {};
  const usd = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out) / 1e6;
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
    throw new Error(`Claude: ${message.stop_reason}`);
  }
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { result: JSON.parse(text), usd };
}

export const claudeReaderAvailable = (env) => Boolean(env.ANTHROPIC_API_KEY);

/** Изследване (снимка или PDF) → { date, markers } — high: числата влизат в правилата на плана. */
export function readLabsWithClaude(env, { prompt, base64, mimeType, client }) {
  return read(env, { prompt, base64, mimeType, schema: LAB_SCHEMA, effort: 'high', client });
}

/** Документ (снимка, PDF или текст) → преценка дали и как засяга плана. */
export function assessDocumentWithClaude(env, { prompt, base64, mimeType, client }) {
  return read(env, { prompt, base64, mimeType, schema: DOCUMENT_SCHEMA, effort: 'high', client });
}
