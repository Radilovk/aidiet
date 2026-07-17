/// <reference types="@cloudflare/workers-types" />

/** Разширения за custom грешки в worker.js */
interface WorkerError extends Error {
  truncated?: boolean;
  validationFailed?: boolean;
  validationErrors?: unknown;
}

/** Gemini generationConfig */
interface GeminiThinkingConfig {
  thinkingBudget?: number;
}

interface GeminiGenerationConfig {
  responseMimeType?: string;
  responseSchema?: unknown;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  thinkingConfig?: GeminiThinkingConfig;
}

interface PlanEditLockArgs {
  clientId?: string;
  userId?: string;
  email?: string;
}

/** Cloudflare Workers cache API */
interface CacheStorage {
  readonly default: Cache;
}

/** ECDH deriveBits — `public` е валидно в Workers runtime */
interface EcdhDeriveBitsParams extends EcdhKeyDeriveParams {
  public: CryptoKey;
}

/** JSON импорти */
declare module '*.json' {
  const value: Record<string, unknown>;
  export default value;
}

declare module './data/exercise-translations-bg.json' {
  const value: Record<string, { nameBg?: string; instructionsBg?: string }>;
  export default value;
}

/** Минимален Env */
interface Env {
  page_content?: KVNamespace;
  FITNESS_KV?: KVNamespace;
  PEP_DB?: D1Database;
  PLAN_QUEUE?: Queue;
  ADMIN_SECRET?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_MODEL?: string;
  VAPID_EMAIL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  [key: string]: unknown;
}
