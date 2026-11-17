/**
 * Cloudflare Turnstile — проверка „човек ли е“ пред безплатните AI функции, които ботовете биха
 * източили: безплатният анализ на IrisMap (билетът) и личният анализ на EmoEat.
 *
 * Ключове (Cloudflare → Turnstile → Add widget; режим Invisible или Managed):
 *   TURNSTILE_SITE_KEY   — публичен, страниците го взимат от GET /api/turnstile/config;
 *   TURNSTILE_SECRET_KEY — secret на worker-а, с него сървърът проверява жетона.
 * Без TURNSTILE_SECRET_KEY проверката е изключена (всичко минава) — включва се само с ключа.
 * Ако сървърът на Cloudflare не отговори, заявката минава (не спираме хората заради чужд срив);
 * останалите защити (билет, лимити, дневен таван) важат и тогава.
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const turnstileOn = (env) => Boolean(env.TURNSTILE_SECRET_KEY);
export const turnstileSiteKey = (env) => (env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY) || null;

/** → { ok: true } или { ok: false, reason } */
export async function verifyTurnstile(env, token, request) {
  if (!turnstileOn(env)) return { ok: true, off: true };
  const t = String(token || '');
  if (!t || t.length > 2048) return { ok: false, reason: 'missing' };
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: t });
  const ip = request?.headers?.get('CF-Connecting-IP');
  if (ip) form.set('remoteip', ip);
  try {
    const r = await fetch(VERIFY_URL, { method: 'POST', body: form });
    const d = await r.json();
    return d.success ? { ok: true } : { ok: false, reason: (d['error-codes'] || [])[0] || 'failed' };
  } catch (e) {
    console.warn('turnstile verify unavailable:', e?.message);
    return { ok: true, unavailable: true };
  }
}

/** Отказ за клиента: 403 { error: 'bot' } — клиентът взима нов жетон и опитва веднъж. */
export const BOT_MESSAGE = 'Проверката, че не сте робот, не мина. Презаредете страницата и опитайте пак.';
