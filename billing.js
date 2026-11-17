/**
 * Плащанията на Eatologix и модулите през Stripe (Checkout + портал за клиента).
 *
 * Режим: BILLING_MODE = 'test' (по подразбиране) | 'live'.
 *   test → STRIPE_TEST_SECRET_KEY (sk_test_…) — тестови карти, нищо не се таксува;
 *   live → STRIPE_SECRET_KEY (същият ключ, с който работи гаранцията за XBODY).
 * Без ключ за режима всичко отговаря 503 { error: 'no_stripe' } и бутоните казват „Скоро“.
 *
 * Продукти (цените са само в pricing-config.js, Stripe ги получава в поръчката — без ръчни
 * продукти в таблото):
 *   - абонамент Core / Plus — седмица или месец (mode: subscription);
 *   - IrisMap — личен протокол, еднократно (mode: payment); сканирането и анализът са безплатни.
 *
 * Без webhook: достъпът се записва при връщане от плащането (POST /api/billing/confirm) и се
 * подновява сам при проверка на достъпа (refreshStripeAccess), когато платеният период изтича —
 * тогава worker-ът пита Stripe за абонамента. Отказан или неплатен абонамент просто изтича.
 */
import Pricing from './pricing-config.js';
import { readAccess, writeAccess } from './access-control.js';

const API = 'https://api.stripe.com/v1/';
const GRACE_MS = 2 * 60 * 60 * 1000;           // 2 ч след края на периода — докато Stripe таксува подновяването
const REFRESH_BEFORE_MS = 6 * 60 * 60 * 1000;  // проверка в Stripe, когато до края остават под 6 ч
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
function withParam(u, k, v) { return u + (u.includes('?') ? '&' : '?') + `${k}=${v}`; }

async function ensureCustomer(env, userId) {
  const k = `billing:customer:${stripeMode(env)}:${userId}`;
  const known = await env.page_content.get(k);
  if (known) return known;
  const c = await stripe(env, 'POST', 'customers', { metadata: { userId } });
  await env.page_content.put(k, c.id);
  return c.id;
}

/** Периодът на абонамента (новите версии на API-то го държат в елемента, старите — в абонамента). */
function subPeriod(sub) {
  const it = sub?.items?.data?.[0] || {};
  const start = sub?.current_period_start || it.current_period_start;
  const end = sub?.current_period_end || it.current_period_end;
  return { start: start ? start * 1000 : Date.now(), end: end ? end * 1000 : null };
}

async function grantFromSubscription(env, userId, sub, meta = {}) {
  const tier = Pricing.isTier(meta.tier) && meta.tier !== 'start' ? meta.tier : sub?.metadata?.tier;
  const period = (meta.period || sub?.metadata?.period) === 'week' ? 'week' : 'month';
  if (!Pricing.isTier(tier) || tier === 'start') throw new Error('Непознато ниво в абонамента');
  const { start, end } = subPeriod(sub);
  return writeAccess(env, userId, {
    tier, period, periodStart: start, until: end ? new Date(end + GRACE_MS).toISOString() : null, source: 'stripe',
    note: `Stripe ${stripeMode(env)} · ${Pricing.formatPrice(Pricing.price(tier, period))} / ${Pricing.PERIOD_LABEL[period]}`,
    stripe: { mode: stripeMode(env), customer: sub.customer, sub: sub.id },
  });
}

/** POST /api/billing/checkout → { url } — страницата на Stripe за плащане. */
export async function handleBillingCheckout(request, env, { respond }) {
  if (!billingReady(env)) return respond({ error: 'no_stripe', mode: stripeMode(env) }, 503);
  const b = await request.json().catch(() => ({}));
  const origin = (request.headers.get('Origin') || '').replace(/\/$/, '');
  try {
    if (b.product === 'iris_protocol') {
      const P = Pricing.PRODUCTS.iris_protocol;
      const analysisId = String(b.analysisId || '').slice(0, 80);
      const back = okReturn(b.returnUrl);
      if (!analysisId || !back) return respond({ error: 'bad_request' }, 400);
      const s = await stripe(env, 'POST', 'checkout/sessions', {
        mode: 'payment', locale: 'auto', allow_promotion_codes: 'true',
        line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: cents(P.price), product_data: { name: P.name, description: P.description } } }],
        metadata: { product: 'iris_protocol', analysisId },
        payment_intent_data: { metadata: { product: 'iris_protocol', analysisId } },
        success_url: withParam(back, 'paid', '{CHECKOUT_SESSION_ID}'),
        cancel_url: back,
      });
      return respond({ url: s.url, mode: stripeMode(env) });
    }
    // абонамент Core / Plus
    const tier = b.tier, period = b.period === 'week' ? 'week' : 'month';
    const userId = String(b.userId || '');
    const price = Pricing.price(tier, period);
    if (!/^fb_[A-Za-z0-9_-]{6,128}$/.test(userId)) return respond({ error: 'account', message: 'Влез в акаунта си, за да избереш ниво.' }, 400);
    if (!price || tier === 'start') return respond({ error: 'bad_request' }, 400);
    const plan = Pricing.plan(tier);
    const ref = /^[a-z0-9][a-z0-9-]{1,31}$/.test(String(b.ref || '')) ? b.ref : '';
    const site = /^https:\/\/(eatologix\.com|biocode\.website)$/.test(origin) ? origin : 'https://eatologix.com';
    const meta = { userId, tier, period, ...(ref ? { ref } : {}) };
    const s = await stripe(env, 'POST', 'checkout/sessions', {
      mode: 'subscription', locale: 'auto', allow_promotion_codes: 'true',
      customer: await ensureCustomer(env, userId), client_reference_id: userId,
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: cents(price), recurring: { interval: period },
        product_data: { name: `Eatologix ${plan.name}` } } }],
      metadata: meta, subscription_data: { metadata: meta },
      success_url: `${site}/pricing.html?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/pricing.html`,
    });
    return respond({ url: s.url, mode: stripeMode(env) });
  } catch (e) {
    return respond({ error: 'stripe', message: e.message }, 502);
  }
}

/** POST /api/billing/confirm { sessionId } — след връщане от Stripe: записва достъпа / отключва протокола. */
export async function handleBillingConfirm(request, env, { respond }) {
  if (!billingReady(env)) return respond({ error: 'no_stripe' }, 503);
  const { sessionId } = await request.json().catch(() => ({}));
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(String(sessionId || ''))) return respond({ error: 'bad_request' }, 400);
  try {
    const s = await stripe(env, 'GET', `checkout/sessions/${sessionId}`, { expand: ['subscription'] });
    if (s.mode === 'subscription') {
      if (s.status !== 'complete' || !s.subscription) return respond({ ok: false, status: s.status });
      const userId = s.metadata?.userId || s.client_reference_id;
      const record = await grantFromSubscription(env, userId, s.subscription, s.metadata);
      return respond({ ok: true, product: 'subscription', userId, tier: record.tier, period: record.period, until: record.until });
    }
    if (s.metadata?.product === 'iris_protocol') {
      if (s.payment_status !== 'paid') return respond({ ok: false, status: s.payment_status });
      const analysisId = s.metadata.analysisId;
      await env.page_content.put(`iris_unlock:${analysisId}`, JSON.stringify({ sessionId, at: Date.now(), mode: stripeMode(env) }));
      return respond({ ok: true, product: 'iris_protocol', analysisId });
    }
    return respond({ ok: false, status: 'unknown' });
  } catch (e) {
    return respond({ error: 'stripe', message: e.message }, 502);
  }
}

/** GET /api/billing/iris-unlock?analysisId= → { unlocked } (напр. друго устройство или изчистен браузър). */
export async function handleIrisUnlockStatus(url, env, { respond }) {
  const id = String(url.searchParams.get('analysisId') || '').slice(0, 80);
  if (!id) return respond({ unlocked: false });
  return respond({ unlocked: Boolean(await env.page_content.get(`iris_unlock:${id}`)) });
}

/** POST /api/billing/portal { userId } → { url } — карта, фактури, отказ (порталът на Stripe). */
export async function handleBillingPortal(request, env, { respond }) {
  if (!billingReady(env)) return respond({ error: 'no_stripe' }, 503);
  const { userId, returnUrl } = await request.json().catch(() => ({}));
  const customer = userId && await env.page_content.get(`billing:customer:${stripeMode(env)}:${userId}`);
  if (!customer) return respond({ error: 'no_customer' }, 404);
  try {
    const s = await stripe(env, 'POST', 'billing_portal/sessions', { customer, return_url: okReturn(returnUrl) || 'https://eatologix.com/pricing.html' });
    return respond({ url: s.url });
  } catch (e) {
    return respond({ error: 'stripe', message: e.message }, 502);
  }
}

/**
 * Подновяване без webhook: ако достъпът е от Stripe и периодът изтича, питаме Stripe.
 * Активен (или в пробен период) абонамент → нов период; иначе записът изтича сам.
 */
export async function refreshStripeAccess(env, userId, now = Date.now()) {
  if (!billingReady(env) || !userId) return;
  const rec = await readAccess(env, userId);
  if (rec?.source !== 'stripe' || !rec.stripe?.sub || rec.stripe.mode !== stripeMode(env)) return;
  if (rec.until && rec.until - now > REFRESH_BEFORE_MS) return;
  try {
    const sub = await stripe(env, 'GET', `subscriptions/${rec.stripe.sub}`);
    if (sub.status === 'active' || sub.status === 'trialing') await grantFromSubscription(env, userId, sub, { tier: rec.tier, period: rec.period });
  } catch (e) {
    console.warn('[billing] refresh', e.message);
  }
}

