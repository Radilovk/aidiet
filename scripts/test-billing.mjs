#!/usr/bin/env node
/**
 * Плащанията (billing.js) и таваните по платен период — без мрежа: Stripe и KV са подменени.
 *   node scripts/test-billing.mjs
 */
import assert from 'node:assert/strict';
import Pricing from '../pricing-config.js';
import { handleBillingCheckout, handleBillingConfirm, refreshStripeAccess, billingReady } from '../billing.js';
import { gateFeature, readAccess, resolveAccess, PAYWALL_KEY } from '../access-control.js';

const kv = new Map();
const env = {
  STRIPE_TEST_SECRET_KEY: 'sk_test_x',
  page_content: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  },
};
const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const call = async (fn, body, headers = {}) => (await fn(new Request('https://w/x', { method: 'POST', body: JSON.stringify(body), headers }), env, { respond })).json();

// подменен Stripe
const DAY = 86400;
let now = Math.floor(Date.now() / 1000);
const calls = [];
const subs = {};
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const path = u.pathname.replace('/v1/', '');
  const body = new URLSearchParams(init.body || '');
  calls.push({ method: init.method, path, body });
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  if (path === 'customers') return ok({ id: 'cus_1' });
  if (path === 'checkout/sessions' && init.method === 'POST') return ok({ id: 'cs_test_1234567890', url: 'https://checkout.stripe.com/c/pay/cs_test_1234567890' });
  if (path.startsWith('checkout/sessions/cs_sub')) {
    subs.sub_1 = { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_start: now, current_period_end: now + 7 * DAY, metadata: { tier: 'core', period: 'week', userId: 'fb_user123' } };
    return ok({ mode: 'subscription', status: 'complete', subscription: subs.sub_1, metadata: { userId: 'fb_user123', tier: 'core', period: 'week' } });
  }
  if (path.startsWith('checkout/sessions/cs_iris')) return ok({ mode: 'payment', payment_status: 'paid', metadata: { product: 'iris_protocol', analysisId: 'an_42' } });
  if (path.startsWith('subscriptions/')) return ok(subs[path.split('/')[1]]);
  return new Response('{}', { status: 404 });
};

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log('✅', name); };

await check('без ключ за режима → no_stripe', async () => {
  assert.equal(billingReady({}), false);
  assert.equal(billingReady({ BILLING_MODE: 'live', STRIPE_TEST_SECRET_KEY: 'x' }), false); // live иска STRIPE_SECRET_KEY
});

await check('абонамент: седмичен Core → поръчка с 2,99 € на седмица', async () => {
  const d = await call(handleBillingCheckout, { tier: 'core', period: 'week', userId: 'fb_user123' }, { Origin: 'https://eatologix.com' });
  assert.match(d.url, /^https:\/\/checkout\.stripe\.com/);
  const c = calls.filter((x) => x.path === 'checkout/sessions').pop().body;
  assert.equal(c.get('mode'), 'subscription');
  assert.equal(c.get('line_items[0][price_data][unit_amount]'), String(Math.round(Pricing.price('core', 'week') * 100)));
  assert.equal(c.get('line_items[0][price_data][recurring][interval]'), 'week');
  assert.equal(c.get('metadata[userId]'), 'fb_user123');
});

await check('абонамент без акаунт → отказ', async () => {
  const d = await call(handleBillingCheckout, { tier: 'core', period: 'month', userId: 'guest' });
  assert.equal(d.error, 'account');
});

await check('няма годишен период', async () => {
  assert.equal(Pricing.price('core', 'year'), null);
  assert.equal(Pricing.price('plus', 'year'), null);
});

await check('IrisMap протокол: еднократно, връщане само към нашите адреси', async () => {
  const d = await call(handleBillingCheckout, { product: 'iris_protocol', analysisId: 'an_42', returnUrl: 'https://irismap.app/app.html' });
  assert.ok(d.url);
  const c = calls.filter((x) => x.path === 'checkout/sessions').pop().body;
  assert.equal(c.get('mode'), 'payment');
  assert.equal(c.get('line_items[0][price_data][unit_amount]'), String(Math.round(Pricing.PRODUCTS.iris_protocol.price * 100)));
  const bad = await call(handleBillingCheckout, { product: 'iris_protocol', analysisId: 'an_42', returnUrl: 'https://evil.example/' });
  assert.equal(bad.error, 'bad_request');
});

await check('потвърждение на абонамента → Core за седмица в KV', async () => {
  const d = await call(handleBillingConfirm, { sessionId: 'cs_sub_000000000001' });
  assert.equal(d.ok, true);
  const rec = await readAccess(env, 'fb_user123');
  assert.equal(rec.tier, 'core');
  assert.equal(rec.period, 'week');
  assert.equal(rec.source, 'stripe');
});

await check('таваните са за платената седмица (меню: 2), после — отказ', async () => {
  kv.set(PAYWALL_KEY, 'true');
  const ownerOk = async () => null;
  const req = () => new Request('https://w/x', { method: 'POST', body: JSON.stringify({ userId: 'fb_user123', idToken: 't' }) });
  for (let i = 0; i < Pricing.quota('core', 'menu_photo', 'week'); i++) {
    const g = await gateFeature(req(), env, 'menu_photo', { checkOwner: ownerOk, respond });
    assert.equal(g.deny, null); await g.commit();
  }
  const g = await gateFeature(req(), env, 'menu_photo', { checkOwner: ownerOk, respond });
  const body = await g.deny.json();
  assert.equal(body.reason, 'quota');
  assert.match(body.message, /седмицата/);
  const a = await resolveAccess(env, 'fb_user123');
  assert.equal(a.period, 'week');
  assert.equal(a.quotas.menu_photo.limit, 2);
});

await check('подновяване без webhook: нов период → таваните отначало', async () => {
  now += 7 * DAY;  // Stripe е таксувал следващата седмица
  subs.sub_1 = { ...subs.sub_1, current_period_start: now, current_period_end: now + 7 * DAY };
  await refreshStripeAccess(env, 'fb_user123', (now - 3600) * 1000);
  const rec = await readAccess(env, 'fb_user123');
  assert.equal(rec.periodStart, now * 1000);
  const a = await resolveAccess(env, 'fb_user123', (now + 60) * 1000);
  assert.equal(a.quotas.menu_photo.used, 0);
});

await check('отказан абонамент → изтича сам', async () => {
  subs.sub_1 = { ...subs.sub_1, status: 'canceled' };
  const rec = await readAccess(env, 'fb_user123');
  await refreshStripeAccess(env, 'fb_user123', rec.until - 1000);
  const a = await resolveAccess(env, 'fb_user123', rec.until + 1000);
  assert.equal(a.tier, 'start');
});

await check('IrisMap протокол: потвърждение → отключен анализ', async () => {
  const d = await call(handleBillingConfirm, { sessionId: 'cs_iris_00000000001' });
  assert.equal(d.ok, true);
  assert.ok(kv.get('iris_unlock:an_42'));
});

console.log(`\nВсички ${checks.length} проверки минаха`);
