/**
 * IrisMap — достъп до Gemini само с „билет за анализ“ (вместо отвореното прокси airis-ai).
 *
 * Модел (docs/FINANCIAL_POLICY.md): анализът е платен — 6,99 € (Stripe → кредит на устройството) или
 * включен в плана на Eatologix (1 на 4 седмици: пропуск от профила → кредит на устройството).
 * Безплатният анализ (1 на 7 дни на устройство) остава само докато плащането не е в реален режим
 * (BILLING_MODE ≠ live) и само за нетестери — за да не спре IrisMap преди Stripe.
 *
 * POST /api/iris/ticket { deviceId, tester?, turnstile? } → { ticket, calls, expiresAt, paid } или
 *   402 { error: 'payment', price } / 429 / 503 с причина. Провален платен анализ (под 13 използвани
 *   заявки) дава нов билет без нов кредит.
 * GET  /api/iris/status?deviceId=&tester= → { credit, payRequired, price }
 * POST /api/iris/pass { userId, idToken } (Eatologix, план) → { url, code } — пропуск за 1 анализ.
 * POST /api/iris/redeem { pass, deviceId } (IrisMap) → кредит на устройството.
 * POST /api/iris/gemini/v1beta/models/<модел>:generateContent   (заглавие X-Iris-Ticket)
 *   → препраща към Gemini с ключа на сървъра; всяка заявка изяжда 1 от билета (24 на анализ —
 *   ~13 нужни + повторни опити) и се брои в дневния разход.
 */
import { budgetOk, noteSpend } from './spend.js';
import { verifyTurnstile, BOT_MESSAGE } from './turnstile.js';
import Pricing from './pricing-config.js';
import { readAccess, normalizeAccess, limitFor, usageWindow, readUsage, addUsage } from './access-control.js';

const TICKET_CALLS = 24;
const USED_ENOUGH = 13;   // толкова заявки = завършен анализ
const TICKET_MS = 40 * 60 * 1000;
const FREE_EVERY_MS = 7 * 24 * 3600 * 1000;
const IP_PER_DAY = 3;
const PASS_MS = 60 * 60 * 1000;
const APP_URL = 'https://irismap.app/app.html';
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
const PRICE = () => Pricing.PRODUCTS.iris_analysis.price;
/** Плаща ли се анализът: в реален режим — за всички; в тестов — само за тестерите. */
const payRequired = (env, tester) => env.BILLING_MODE === 'live' || tester === true || tester === 'true' || tester === '1';
const payMessage = () => `Анализът е ${Pricing.formatPrice(PRICE())} — или включен в плана на Eatologix.`;

async function readJSON(env, key) { return JSON.parse((await env.page_content.get(key)) || 'null'); }
/** Провален ли е анализът с този билет (използвани под 13 заявки). */
async function unfinished(env, ticketId) {
  const t = ticketId ? await readJSON(env, `iris_ticket:${ticketId}`) : null;
  return Boolean(t && TICKET_CALLS - t.calls < USED_ENOUGH);
}

export async function handleIrisTicket(request, env, { respond, now = Date.now() } = /** @type {any} */ ({})) {
  if (!env.page_content) return respond({ error: 'kv' }, 500);
  const body = await request.json().catch(() => ({}));
  const deviceId = String(body.deviceId || '');
  if (!okDevice(deviceId)) return respond({ error: 'bad_request' }, 400);

  const creditKey = `iris_credit:${deviceId}`;
  const credit = Number(await env.page_content.get(creditKey)) || 0;
  const lastPaid = await readJSON(env, `iris_paid_ticket:${deviceId}`);
  let paid = false;

  if (lastPaid?.ticket && await unfinished(env, lastPaid.ticket)) {
    // Платеният анализ се провали по средата — нов опит без нов кредит; старият билет спира.
    const old = await readJSON(env, `iris_ticket:${lastPaid.ticket}`);
    if (old) await env.page_content.put(`iris_ticket:${lastPaid.ticket}`, JSON.stringify({ ...old, calls: 0 }), { expirationTtl: 3600 });
    paid = true;
  } else if (credit > 0) {
    await env.page_content.put(creditKey, String(credit - 1), { expirationTtl: 400 * 86400 });
    paid = true;
  } else if (payRequired(env, body.tester)) {
    return respond({ error: 'payment', price: PRICE(), message: payMessage() }, 402);
  } else {
    // Безплатен (само докато плащането не е в реален режим). Turnstile: само за хора.
    const human = await verifyTurnstile(env, body.turnstile, request);
    if (!human.ok) return respond({ error: 'bot', reason: human.reason, message: BOT_MESSAGE }, 403);
    if (!(await budgetOk(env, 'free', now))) {
      return respond({ error: 'budget', message: 'Безплатните анализи за днес са изчерпани. Опитайте утре.' }, 503);
    }
    const dev = await readJSON(env, `iris_dev:${deviceId}`);
    // Провален анализ не изяжда седмичния безплатен.
    if (dev?.last && now - dev.last < FREE_EVERY_MS && !(await unfinished(env, dev.ticket))) {
      return respond({ error: 'weekly', next: dev.last + FREE_EVERY_MS,
        message: 'Безплатният анализ е веднъж на седмица на устройство.' }, 429);
    }
    const ipKey = `iris_ip:${ipOf(request)}:${day(now)}`;
    const ipCount = Number(await env.page_content.get(ipKey)) || 0;
    if (ipCount >= IP_PER_DAY) return respond({ error: 'ip', message: 'Твърде много анализи от тази мрежа днес. Опитайте утре.' }, 429);
    await env.page_content.put(ipKey, String(ipCount + 1), { expirationTtl: 2 * 86400 });
  }

  const ticket = rand();
  const expiresAt = now + TICKET_MS;
  if (paid) await env.page_content.put(`iris_paid_ticket:${deviceId}`, JSON.stringify({ ticket, at: now }), { expirationTtl: 3600 });
  else await env.page_content.put(`iris_dev:${deviceId}`, JSON.stringify({ last: now, ticket }), { expirationTtl: 8 * 86400 });
  await env.page_content.put(`iris_ticket:${ticket}`, JSON.stringify({ calls: TICKET_CALLS, exp: expiresAt, deviceId, paid }), { expirationTtl: 3600 });
  return respond({ ticket, calls: TICKET_CALLS, expiresAt, paid });
}

/** GET /api/iris/status?deviceId=&tester= — какво чака човека преди анализа. */
export async function handleIrisStatus(url, env, { respond }) {
  const deviceId = url.searchParams.get('deviceId') || '';
  const credit = okDevice(deviceId) ? Number(await env.page_content.get(`iris_credit:${deviceId}`)) || 0 : 0;
  return respond({ credit, payRequired: payRequired(env, url.searchParams.get('tester')), price: PRICE() });
}

/**
 * POST /api/iris/pass { userId, idToken } — от профила в Eatologix: човек с активен план получава
 * пропуск за един анализ (1 на 4 седмици; 12 седмици → 3, пак по един на 4 седмици).
 * checkOwner(userId, idToken, env, request) → Response | null (Firebase, от worker-а).
 */
export async function handleIrisPass(request, env, { respond, checkOwner, now = Date.now() }) {
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '');
  if (!userId.startsWith('fb_')) return respond({ error: 'account', message: 'Влез в акаунта си в Eatologix.' }, 401);
  const ownerErr = await checkOwner(userId, body.idToken, env, request);
  if (ownerErr) return ownerErr;
  const access = normalizeAccess(await readAccess(env, userId), now);
  if (access.tier !== 'core') {
    return respond({ error: 'no_plan', price: PRICE(), message: `Анализът в IrisMap е включен в плана. Без план — ${Pricing.formatPrice(PRICE())}.` }, 402);
  }
  const window = usageWindow(access, now);
  const limit = limitFor(access, 'iris') ?? 0;
  const used = Number((await readUsage(env, userId, now, window)).iris) || 0;
  if (used >= limit) {
    return respond({ error: 'quota', used, limit, message: 'Анализът в IrisMap за плана е използван. Още — с продължение на плана.' }, 402);
  }
  const last = Number(await env.page_content.get(`iris_plan_last:${userId}`)) || 0;
  const every = Pricing.IRIS_EVERY_DAYS * 24 * 3600 * 1000;
  if (last && now - last < every) {
    return respond({ error: 'wait', next: last + every,
      message: `Следващият анализ в IrisMap — от ${new Date(last + every).toLocaleDateString('bg-BG')} (по един на 4 седмици).` }, 429);
  }
  const code = rand();
  await env.page_content.put(`iris_pass:${code}`, JSON.stringify({ userId, window, exp: now + PASS_MS }), { expirationTtl: 2 * 3600 });
  return respond({ code, url: `${APP_URL}?pass=${code}`, left: limit - used });
}

/** POST /api/iris/redeem { pass, deviceId } — IrisMap взима пропуска: кредит за един анализ на устройството. */
export async function handleIrisRedeem(request, env, { respond, now = Date.now() } = /** @type {any} */ ({})) {
  const { pass, deviceId } = await request.json().catch(() => ({}));
  if (!/^[a-z0-9]{24}$/.test(String(pass || '')) || !okDevice(deviceId)) return respond({ error: 'bad_request' }, 400);
  const key = `iris_pass:${pass}`;
  const p = await readJSON(env, key);
  if (!p || p.used || p.exp < now) return respond({ error: 'expired', message: 'Пропускът е изтекъл или вече е използван. Отвори IrisMap отново от профила си в Eatologix.' }, 410);
  await env.page_content.put(key, JSON.stringify({ ...p, used: now, deviceId }), { expirationTtl: 2 * 3600 });
  await addUsage(env, p.userId, 'iris', now, p.window);
  await env.page_content.put(`iris_plan_last:${p.userId}`, String(now), { expirationTtl: 400 * 86400 });
  const ck = `iris_credit:${deviceId}`;
  await env.page_content.put(ck, String((Number(await env.page_content.get(ck)) || 0) + 1), { expirationTtl: 400 * 86400 });
  return respond({ ok: true, credit: true });
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
