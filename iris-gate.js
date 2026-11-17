/**
 * IrisMap — достъп до Gemini само с „билет за анализ“ (вместо отвореното прокси airis-ai).
 *
 * POST /api/iris/ticket { deviceId, paid? }
 *   → { ticket, calls, expiresAt } или 429/503 с причина.
 *   Безплатно: 1 анализ на 7 дни на устройство, ≤ 3 на ден от IP, само ако общият дневен разход е
 *   под тавана (spend.js). Платено контролно разчитане (кредит от Stripe) → билет без безплатния лимит.
 * POST /api/iris/gemini/v1beta/models/<модел>:generateContent   (заглавие X-Iris-Ticket)
 *   → препраща към Gemini с ключа на сървъра; всяка заявка изяжда 1 от билета (24 на анализ —
 *   ~13 нужни + повторни опити) и се брои в дневния разход.
 */
import { budgetOk, noteSpend } from './spend.js';
import { verifyTurnstile, BOT_MESSAGE } from './turnstile.js';

const TICKET_CALLS = 24;
const TICKET_MS = 40 * 60 * 1000;
const FREE_EVERY_MS = 7 * 24 * 3600 * 1000;
const IP_PER_DAY = 3;
const MAX_BODY = 12 * 1024 * 1024;
const MODELS = new Set(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest']);
const PATH = /^\/api\/iris\/gemini\/v1beta\/models\/(gemini-[a-z0-9.\-]+):generateContent$/;
export const IRIS_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Iris-Ticket',
  'Access-Control-Max-Age': '86400',
};

const day = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const ipOf = (request) => request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
const okDevice = (id) => /^[A-Za-z0-9_-]{8,64}$/.test(String(id || ''));
function rand(n = 24) {
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return [...b].map((x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
}

export async function handleIrisTicket(request, env, { respond, now = Date.now() } = /** @type {any} */ ({})) {
  if (!env.page_content) return respond({ error: 'kv' }, 500);
  const body = await request.json().catch(() => ({}));
  const deviceId = String(body.deviceId || '');
  if (!okDevice(deviceId)) return respond({ error: 'bad_request' }, 400);

  // Платено контролно разчитане: кредит, записан при плащането (billing.js).
  const creditKey = `iris_credit:${deviceId}`;
  const credit = Number(await env.page_content.get(creditKey)) || 0;
  const paid = credit > 0;

  if (!paid) {
    // Turnstile: безплатният анализ е само за хора (включва се с TURNSTILE_SECRET_KEY).
    const human = await verifyTurnstile(env, body.turnstile, request);
    if (!human.ok) return respond({ error: 'bot', reason: human.reason, message: BOT_MESSAGE }, 403);
    if (!(await budgetOk(env, 'free', now))) {
      return respond({ error: 'budget', message: 'Безплатните анализи за днес са изчерпани. Опитайте утре.' }, 503);
    }
    const dev = JSON.parse((await env.page_content.get(`iris_dev:${deviceId}`)) || 'null');
    // Провален анализ (използвани < 13 заявки от предишния билет) не изяжда седмичния безплатен.
    const prev = dev?.ticket ? JSON.parse((await env.page_content.get(`iris_ticket:${dev.ticket}`)) || 'null') : null;
    const unfinished = prev && TICKET_CALLS - prev.calls < 13;
    if (dev?.last && now - dev.last < FREE_EVERY_MS && !unfinished) {
      return respond({ error: 'weekly', next: dev.last + FREE_EVERY_MS,
        message: 'Безплатният анализ е веднъж на седмица на устройство. Контролно разчитане по-рано — с протокола.' }, 429);
    }
    const ipKey = `iris_ip:${ipOf(request)}:${day(now)}`;
    const ipCount = Number(await env.page_content.get(ipKey)) || 0;
    if (ipCount >= IP_PER_DAY) return respond({ error: 'ip', message: 'Твърде много анализи от тази мрежа днес. Опитайте утре.' }, 429);
    await env.page_content.put(ipKey, String(ipCount + 1), { expirationTtl: 2 * 86400 });
  } else {
    await env.page_content.put(creditKey, String(credit - 1), { expirationTtl: 400 * 86400 });
  }

  const ticket = rand();
  const expiresAt = now + TICKET_MS;
  if (!paid) await env.page_content.put(`iris_dev:${deviceId}`, JSON.stringify({ last: now, ticket }), { expirationTtl: 8 * 86400 });
  await env.page_content.put(`iris_ticket:${ticket}`, JSON.stringify({ calls: TICKET_CALLS, exp: expiresAt, deviceId, paid }), { expirationTtl: 3600 });
  return respond({ ticket, calls: TICKET_CALLS, expiresAt, paid });
}

export async function handleIrisGemini(request, env, url, { notify } = /** @type {any} */ ({})) {
  const json = (status, message) => new Response(JSON.stringify({ error: { code: status, message } }), { status, headers: { 'Content-Type': 'application/json', ...IRIS_CORS } });
  const m = url.pathname.match(PATH);
  if (!m || !MODELS.has(m[1])) return json(404, 'model not allowed');
  if (!env.GEMINI_API_KEY) return json(503, 'GEMINI_API_KEY is not configured');
  const t = String(request.headers.get('X-Iris-Ticket') || '');
  if (!/^[a-z0-9]{24}$/.test(t)) return json(403, 'ticket required');
  const key = `iris_ticket:${t}`;
  const rec = JSON.parse((await env.page_content.get(key)) || 'null');
  if (!rec || rec.exp < Date.now() || rec.calls <= 0) return json(403, 'ticket expired');
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return json(413, 'request too large');
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY) return json(413, 'request too large');
  rec.calls -= 1;
  await env.page_content.put(key, JSON.stringify(rec), { expirationTtl: 3600 });

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m[1]}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body,
  });
  const text = await r.text();
  try { await noteSpend(env, m[1], JSON.parse(text)?.usageMetadata, { notify }); } catch (_) { /* не JSON */ }
  return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json', ...IRIS_CORS } });
}
