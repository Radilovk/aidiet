/**
 * Плащанията през Stripe (Checkout) — само ЕДНОКРАТНИ покупки, без абонаменти.
 *
 * Продукти (цените са само в pricing-config.js, Stripe ги получава в поръчката):
 *   - Eatologix: план за 4 седмици, за 12 седмици, продължение 4 седмици → нивото core със срок и
 *     лимити в KV `access:<userId>` (продължение при активен план добавя срок и лимити към остатъка);
 *   - IrisMap: личен протокол за анализ (9,99 €); контролно разчитане (6,99 €) — за устройство, което
 *     вече е взело протокол (цената се решава тук, на сървъра);
 *   - EmoEat: личен анализ (2,99 €) → кредит за един анализ на устройството/акаунта.
 *
 * Режим: BILLING_MODE = 'test' (по подразбиране) → STRIPE_TEST_SECRET_KEY; 'live' → STRIPE_SECRET_KEY
 * (същата сметка, с която работи гаранцията за XBODY). Без ключ → 503 { error: 'no_stripe' }.
 * Потвърждението е идемпотентно: една поръчка се записва само веднъж (KV billing:done:<id>).
 * Правото на отказ (ЕС, цифрово съдържание): поръчката изисква съгласие за незабавна доставка.
 */
import Pricing from './pricing-config.js';
import { readAccess, writeAccess, normalizeAccess } from './access-control.js';

const API = 'https://api.stripe.com/v1/';
const DAY_MS = 24 * 3600 * 1000;
const ALLOWED_RETURN = /^https:\/\/(eatologix\.com|www\.eatologix\.com|biocode\.website|emoeat\.app|irismap\.app|www\.irismap\.app|radilovk\.github\.io)(\/|$)/;

export const stripeMode = (env) => (env.BILLING_MODE === 'live' ? 'live' : 'test');
const stripeKey = (env) => (stripeMode(env) === 'live' ? env.STRIPE_SECRET_KEY : env.STRIPE_TEST_SECRET_KEY);
export const billingReady = (env) => Boolean(stripeKey(env));

/** { a: { b: 1 }, c: [ { d: 2 } ] } → a[b]=1&c[0][d]=2 (формата на Stripe) */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, name, out);
    else out.append(name, String(v));
  }
  return out;
}

async function stripe(env, method, path, params) {
  const init = { method, headers: { Authorization: `Bearer ${stripeKey(env)}`, 'Stripe-Version': '2024-06-20' } };
  let url = API + path;
  if (params && method === 'GET') url += (url.includes('?') ? '&' : '?') + form(params).toString();
  else if (params) { init.body = form(params).toString(); init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Stripe ${r.status}`);
  return data;
}

const cents = (eur) => Math.round(Number(eur) * 100);
const okReturn = (u) => (typeof u === 'string' && ALLOWED_RETURN.test(u) ? u : null);
const withParam = (u, k, v) => u + (u.includes('?') ? '&' : '?') + `${k}=${v}`;
const okUser = (id) => /^fb_[A-Za-z0-9_-]{6,128}$/.test(String(id || ''));
const okDevice = (id) => /^[A-Za-z0-9_-]{8,64}$/.test(String(id || ''));

/** Плановете (за показване) и дали плащането е включено. */
export function billingStatus(env) {
  return { ready: billingReady(env), mode: stripeMode(env), products: Pricing.PRODUCTS };
}

/** POST /api/billing/checkout { product, userId?, deviceId?, analysisId?, returnUrl?, ref? } → { url } */
export async function handleBillingCheckout(request, env, { respond }) {
  if (!billingReady(env)) return respond({ error: 'no_stripe', mode: stripeMode(env) }, 503);
  const b = await request.json().catch(() => ({}));
  const origin = (request.headers.get('Origin') || '').replace(/\/$/, '');
  let id = String(b.product || '');
  let P = Pricing.product(id);
  if (!P) return respond({ error: 'bad_request' }, 400);
  const meta = { product: id };
  let back;
  try {
    if (P.kind === 'plan') {
      if (!okUser(b.userId)) return respond({ error: 'account', message: 'Влез в акаунта си, за да купиш план.' }, 400);
      if (P.requiresPlan) {
        const rec = await readAccess(env, b.userId);
        if (!rec || rec.tier === 'start') return respond({ error: 'no_plan', message: 'Продължението е за вече купен план — избери план за 4 или 12 седмици.' }, 400);
      }
      meta.userId = b.userId;
      if (/^[a-z0-9][a-z0-9-]{1,31}$/.test(String(b.ref || ''))) meta.ref = b.ref;
      const site = /^https:\/\/(eatologix\.com|biocode\.website)$/.test(origin) ? origin : 'https://eatologix.com';
      back = `${site}/pricing.html`;
    } else if (P.kind === 'iris') {
      const analysisId = String(b.analysisId || '').slice(0, 80);
      back = okReturn(b.returnUrl);
      if (!analysisId || !back || !okDevice(b.deviceId)) return respond({ error: 'bad_request' }, 400);
      // Контролно разчитане — по-ниската цена, ако устройството вече е взело протокол.
      id = (await env.page_content.get(`iris_paid_dev:${b.deviceId}`)) ? 'iris_recheck' : 'iris_protocol';
      P = Pricing.product(id);
      Object.assign(meta, { product: id, analysisId, deviceId: b.deviceId });
    } else if (P.kind === 'emoeat') {
      back = okReturn(b.returnUrl);
      const holder = okUser(b.userId) ? b.userId : okDevice(b.deviceId) ? b.deviceId : '';
      if (!holder || !back) return respond({ error: 'bad_request' }, 400);
      meta.holder = holder;
    }
    const s = await stripe(env, 'POST', 'checkout/sessions', {
      mode: 'payment', locale: 'auto', allow_promotion_codes: 'true',
      ...(P.kind === 'plan' ? { client_reference_id: meta.userId } : {}),
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: cents(P.price), product_data: { name: P.name, ...(P.description ? { description: P.description } : {}) } } }],
      metadata: meta, payment_intent_data: { metadata: meta },
      // Право на отказ: съгласието се дава с отметка преди плащането (на нашата страница); тук — напомняне.
      custom_text: { submit: { message: 'Цифрово съдържание, доставено веднага след плащането: с поръчката губиш правото на отказ от 14 дни.' } },
      success_url: withParam(back, 'paid', '{CHECKOUT_SESSION_ID}'),
      cancel_url: back,
    });
    return respond({ url: s.url, mode: stripeMode(env), product: id, price: P.price });
  } catch (e) {
    return respond({ error: 'stripe', message: e.message }, 502);
  }
}

/** Записва купения план: нов срок или добавка към активния. */
async function grantPlan(env, userId, productId, sessionId, now = Date.now()) {
  const P = Pricing.product(productId);
  const add = Pricing.planQuota(productId);
  const current = normalizeAccess(await readAccess(env, userId), now);
  const active = current.tier === 'core' && current.until && current.until > now;
  const quota = { ...add };
  if (active && current.quota) for (const k of Object.keys(add)) quota[k] = (Number(current.quota[k]) || 0) + add[k];
  return writeAccess(env, userId, {
    tier: 'core',
    periodStart: active && current.periodStart ? current.periodStart : now,
    until: new Date((active ? current.until : now) + P.days * DAY_MS).toISOString(),
    quota, source: 'stripe',
    note: `${P.name} · ${Pricing.formatPrice(P.price)} · Stripe ${stripeMode(env)}`,
    stripe: { mode: stripeMode(env), session: sessionId },
  }, now);
}

/** POST /api/billing/confirm { sessionId } — след връщане от Stripe: записва покупката (веднъж). */
export async function handleBillingConfirm(request, env, { respond, now = Date.now() } = /** @type {any} */ ({})) {
  if (!billingReady(env)) return respond({ error: 'no_stripe' }, 503);
  const { sessionId } = await request.json().catch(() => ({}));
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(String(sessionId || ''))) return respond({ error: 'bad_request' }, 400);
  const doneKey = `billing:done:${sessionId}`;
  const done = await env.page_content.get(doneKey);
  if (done) return respond({ ok: true, repeat: true, ...JSON.parse(done) });
  try {
    const s = await stripe(env, 'GET', `checkout/sessions/${sessionId}`);
    if (s.payment_status !== 'paid') return respond({ ok: false, status: s.payment_status || s.status });
    const m = s.metadata || {};
    const P = Pricing.product(m.product);
    if (!P) return respond({ ok: false, status: 'unknown' });
    let result = { product: m.product };
    if (P.kind === 'plan') {
      const rec = await grantPlan(env, m.userId, m.product, sessionId, now);
      result = { ...result, userId: m.userId, tier: rec.tier, until: rec.until };
    } else if (P.kind === 'iris') {
      await env.page_content.put(`iris_unlock:${m.analysisId}`, JSON.stringify({ sessionId, at: now, mode: stripeMode(env) }));
      if (m.deviceId) await env.page_content.put(`iris_paid_dev:${m.deviceId}`, String(now));
      result = { ...result, analysisId: m.analysisId };
    } else if (P.kind === 'emoeat') {
      const k = `emoeat_credit:${m.holder}`;
      await env.page_content.put(k, String((Number(await env.page_content.get(k)) || 0) + 1), { expirationTtl: 400 * 86400 });
      result = { ...result, holder: m.holder };
    }
    await env.page_content.put(doneKey, JSON.stringify(result), { expirationTtl: 400 * 86400 });
    return respond({ ok: true, ...result });
  } catch (e) {
    return respond({ error: 'stripe', message: e.message }, 502);
  }
}

/** GET /api/billing/iris-unlock?analysisId= → { unlocked } (друго устройство или изчистен браузър). */
export async function handleIrisUnlockStatus(url, env, { respond }) {
  const id = String(url.searchParams.get('analysisId') || '').slice(0, 80);
  if (!id) return respond({ unlocked: false });
  return respond({ unlocked: Boolean(await env.page_content.get(`iris_unlock:${id}`)) });
}

/** Кредит за личния анализ на EmoEat: има ли (и изразходване след успешен анализ). */
export async function emoeatCredit(env, holder) {
  if (!holder || !env.page_content) return 0;
  return Number(await env.page_content.get(`emoeat_credit:${holder}`)) || 0;
}
export async function useEmoeatCredit(env, holder) {
  const n = await emoeatCredit(env, holder);
  if (n > 0) await env.page_content.put(`emoeat_credit:${holder}`, String(n - 1), { expirationTtl: 400 * 86400 });
}
