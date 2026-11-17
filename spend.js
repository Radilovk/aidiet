/**
 * Предпазител на AI разхода — общ дневен таван за целия сървър.
 *
 * Всяка AI заявка се оценява по реалните токени от отговора (usageMetadata) и се добавя към
 * дневния брояч. При 50% от тавана — едно известие до админа на ден; при 100% — безплатните
 * AI функции спират до полунощ (UTC), платените продължават (budgetOk(env, 'paid') е винаги true).
 *
 * Таванът: KV `admin_daily_budget_usd` → променлива DAILY_AI_BUDGET_USD → 22 ($ ≈ 20 €).
 * Брояч: KV `spend:<ден>:<0-7>` — разделен на 8 ключа, защото KV приема около 1 запис в секунда
 * на ключ; при сблъсък броенето е приблизително (за предпазител е достатъчно).
 * Цените са консервативни (по-високите известни) — USD за 1M токена [вход, изход].
 */
const PRICES = {
  'gemini-3.8-flash': [2, 10],
  'gemini-3.6-flash': [1.5, 7.5],
  'gemini-3.5-flash-lite': [0.3, 2.5],
  'gemini-3.1-pro-preview': [2.5, 15],
  'gemini-2.5-flash': [0.3, 2.5],
};
const DEFAULT_PRICE = [2, 10];
const SHARDS = 8;
const TTL_SEC = 3 * 24 * 3600;
export const BUDGET_KEY = 'admin_daily_budget_usd';

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Оценка в USD от usageMetadata на Gemini (мисленето се таксува като изход). */
export function costUsd(model, usage) {
  if (!usage) return 0;
  const [pin, pout] = PRICES[String(model || '').replace(/^models\//, '')] || DEFAULT_PRICE;
  const input = Number(usage.promptTokenCount) || 0;
  const output = (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0);
  return (input * pin + output * pout) / 1e6;
}

let memo = { day: '', at: 0, usd: 0 };

export async function dailySpend(env, now = Date.now()) {
  const day = today(now);
  if (memo.day === day && now - memo.at < 30_000) return memo.usd;
  if (!env.page_content) return 0;
  const vals = await Promise.all([...Array(SHARDS)].map((_, i) => env.page_content.get(`spend:${day}:${i}`).catch(() => null)));
  const usd = vals.reduce((s, v) => s + (Number(v) || 0), 0);
  memo = { day, at: now, usd };
  return usd;
}

export async function budgetLimit(env) {
  try {
    const v = Number(await env.page_content?.get(BUDGET_KEY));
    if (v > 0) return v;
  } catch (_) { /* по подразбиране */ }
  return Number(env.DAILY_AI_BUDGET_USD) > 0 ? Number(env.DAILY_AI_BUDGET_USD) : 22;
}

/** Може ли AI заявка: платените винаги; безплатните — докато дневният разход е под тавана. */
export async function budgetOk(env, kind = 'free', now = Date.now()) {
  if (kind === 'paid') return true;
  return (await dailySpend(env, now)) < (await budgetLimit(env));
}

/**
 * Добавя разхода на една заявка. notify(text) — известие до админа (по веднъж на ден при 50% и 100%).
 */
export async function addSpend(env, usd, { notify, now = Date.now() } = /** @type {any} */ ({})) {
  if (!(usd > 0) || !env.page_content) return;
  const day = today(now);
  const key = `spend:${day}:${Math.floor(Math.random() * SHARDS)}`;
  try {
    const cur = Number(await env.page_content.get(key)) || 0;
    await env.page_content.put(key, String(Math.round((cur + usd) * 1e6) / 1e6), { expirationTtl: TTL_SEC });
  } catch (_) { /* лимит на запис в KV — броенето е приблизително */ }
  if (memo.day === day) memo.usd += usd;
  if (!notify) return;
  const limit = await budgetLimit(env);
  const spent = await dailySpend(env, now);
  for (const pct of [50, 100]) {
    if (spent < limit * pct / 100) continue;
    const flag = `spend_alert:${day}:${pct}`;
    if (await env.page_content.get(flag)) continue;
    await env.page_content.put(flag, '1', { expirationTtl: TTL_SEC });
    await notify(pct === 100
      ? `⛔ AI разход днес: $${spent.toFixed(2)} — таванът $${limit} е достигнат. Безплатните AI функции са спрени до полунощ (UTC); платените работят.`
      : `⚠️ AI разход днес: $${spent.toFixed(2)} — половината от тавана $${limit}.`).catch(() => {});
  }
}

/** Удобно за обработчиците: оценка + запис. */
export function noteSpend(env, model, usage, opts) {
  return addSpend(env, costUsd(model, usage), opts).catch(() => {});
}
