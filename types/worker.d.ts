/// <reference types="@cloudflare/workers-types" />

/** Разширения за custom грешки в worker.js */
interface WorkerError extends Error {
  truncated?: boolean;
  validationFailed?: boolean;
}

/** Gemini generationConfig — thinkingBudget (нов API) */
interface GeminiThinkingConfig {
  thinkingBudget?: number;
}

interface GeminiGenerationConfig {
  responseMimeType?: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingConfig?: GeminiThinkingConfig;
}

/** JSON импорти */
declare module '*.json' {
  const value: Record<string, unknown>;
  export default value;
}

declare module './data/exercise-translations-bg.json' {
  const value: Record<string, string>;
  export default value;
}

/** Cloudflare Workers cache API */
interface CacheStorage {
  readonly default: Cache;
}

interface PlanEditLockArgs {
  clientId?: string;
  userId?: string;
  email?: string;
}

interface Env {
  page_content?: KVNamespace;
  FITNESS_KV?: KVNamespace;
  PEP_DB?: D1Database;
  PLAN_QUEUE?: Queue;
  ADMIN_SECRET?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  VAPID_EMAIL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  [key: string]: unknown;
}
