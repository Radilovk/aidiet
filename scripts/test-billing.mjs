#!/usr/bin/env node
/**
 * Плащанията (billing.js) — еднократни покупки, без мрежа: Stripe и KV са подменени.
 * Проверява: план 4/12 седмици, продължение, лимити на покупката + дневен таван, IrisMap протокол
 * и контролно разчитане (цената по устройство), EmoEat кредит, идемпотентно потвърждение.
 *   node scripts/test-billing.mjs
 */
import assert from 'node:assert/strict';
import Pricing from '../pricing-config.js';
import { handleBillingCheckout, handleBillingConfirm, handleBillingWebhook, verifyStripeSignature, billingReady, emoeatCredit, useEmoeatCredit } from '../billing.js';
import { createHmac } from 'node:crypto';
import { gateFeature, readAccess, normalizeAccess, resolveAccess, PAYWALL_KEY } from '../access-control.js';

const kv = new Map();
const env = {
  STRIPE_TEST_SECRET_KEY: 'sk_test_x',
  STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test_abc',
  page_content: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  },
};
const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const req = (body, headers = {}) => new Request('https://w/x', { method: 'POST', body: JSON.stringify(body), headers });
const checkout = async (body, headers) => (await handleBillingCheckout(req(body, headers), env, { respond })).json();
const confirm = async (sessionId, now) => (await handleBillingConfirm(req({ sessionId }), env, { respond, now })).json();

// подменен Stripe: сесиите се помнят по id с метаданните от поръчката
const sessions = {};
let seq = 0;
let lastBody;
let gets = 0;
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname.replace('/v1/', '');
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  if (path === 'checkout/sessions' && init.method === 'POST') {
    lastBody = new URLSearchParams(init.body || '');
    const id = `cs_test_${String(++seq).padStart(12, '0')}`;
    const metadata = {};
    for (const [k, v] of lastBody) { const m = k.match(/^metadata\[(\w+)\]$/); if (m) metadata[m[1]] = v; }
    sessions[id] = { id, mode: 'payment', payment_status: 'paid', metadata };
    return ok({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
  }
  if (path.startsWith('checkout/sessions/')) { gets++; return ok(sessions[path.split('/')[2]] || {}); }
  return new Response('{}', { status: 404 });
};
const sid = (url) => url.split('/').pop();

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log('✅', name); };
const DAY = 86400000;
const t0 = Date.now();

await check('без ключ за режима → no_stripe', async () => {
  assert.equal(billingReady({}), false);
  assert.equal(billingReady({ BILLING_MODE: 'live', STRIPE_TEST_SECRET_KEY: 'x' }), false); // live иска STRIPE_SECRET_KEY
});

await check('план без акаунт → отказ; продължение без план → отказ', async () => {
  assert.equal((await checkout({ product: 'plan_4w', userId: 'guest' })).error, 'account');
  assert.equal((await checkout({ product: 'plan_continue', userId: 'fb_user123' })).error, 'no_plan');
  assert.equal((await checkout({ product: 'nope', userId: 'fb_user123' })).error, 'bad_request');
});

let s4;
await check('план за 4 седмици → еднократно 14,99 €, без абонамент', async () => {
  const d = await checkout({ product: 'plan_4w', userId: 'fb_user123' }, { Origin: 'https://eatologix.com' });
  assert.match(d.url, /^https:\/\/checkout\.stripe\.com/);
  assert.equal(lastBody.get('mode'), 'payment');
  assert.equal(lastBody.get('line_items[0][price_data][unit_amount]'), '1499');
  assert.equal(lastBody.get('line_items[0][price_data][recurring][interval]'), null);
  assert.match(lastBody.get('success_url'), /^https:\/\/eatologix\.com\/pricing\.html\?paid=/);
  s4 = sid(d.url);
});

await check('потвърждение → core за 28 дни с лимитите на плана', async () => {
  const d = await confirm(s4, t0);
  assert.equal(d.ok, true); assert.equal(d.tier, 'core');
  const a = normalizeAccess(await readAccess(env, 'fb_user123'), t0);
  assert.equal(a.tier, 'core');
  assert.ok(Math.abs(a.until - (t0 + 28 * DAY)) < 2000);
  assert.deepEqual(a.quota, Pricing.planQuota('plan_4w'));
});

await check('повторно потвърждение на същата поръчка не дава втори път', async () => {
  const before = await readAccess(env, 'fb_user123');
  const n = gets;
  const d = await confirm(s4, t0 + 1000);
  assert.equal(d.repeat, true);
  assert.equal(gets, n);   // без нова заявка към Stripe
  assert.deepEqual(await readAccess(env, 'fb_user123'), before);
});

await check('лимит на плана: 60 въпроса, после 402 quota', async () => {
  kv.set(PAYWALL_KEY, 'true');
  const ownerOk = async () => null;
  const ask = (now) => gateFeature(req({ userId: 'fb_user123', idToken: 't' }), env, 'chat', { checkOwner: ownerOk, respond, now });
  // разпределено по дни, за да не удари дневния таван (20)
  for (let i = 0; i < 60; i++) { const g = await ask(t0 + Math.floor(i / 20) * DAY + i); assert.equal(g.deny, null); await g.commit(); }
  const g = await ask(t0 + 4 * DAY);
  assert.equal(g.deny.status, 402);
  const body = await g.deny.json();
  assert.equal(body.reason, 'quota'); assert.equal(body.limit, 60);
});

await check('дневен таван: 10 снимки на ден, утре — пак', async () => {
  const ownerOk = async () => null;
  const shot = (now) => gateFeature(req({ userId: 'fb_user123', idToken: 't' }), env, 'photo', { checkOwner: ownerOk, respond, now });
  const day = t0 + 5 * DAY;
  for (let i = 0; i < 10; i++) { const g = await shot(day + i); assert.equal(g.deny, null); await g.commit(); }
  const g = await shot(day + 100);
  assert.equal((await g.deny.json()).reason, 'daily');
  assert.equal((await shot(day + DAY)).deny, null);
});

await check('продължение при активен план → +28 дни, лимитите се добавят към остатъка', async () => {
  const before = normalizeAccess(await readAccess(env, 'fb_user123'), t0);
  const d = await checkout({ product: 'plan_continue', userId: 'fb_user123' });
  assert.equal(lastBody.get('line_items[0][price_data][unit_amount]'), '1199');
  await confirm(sid(d.url), t0 + 6 * DAY);
  const a = normalizeAccess(await readAccess(env, 'fb_user123'), t0 + 6 * DAY);
  assert.ok(Math.abs(a.until - (before.until + 28 * DAY)) < 2000);
  assert.equal(a.quota.chat, 120);
  assert.equal(a.periodStart, before.periodStart);   // същият прозорец: изразходваното се пази
  const r = await resolveAccess(env, 'fb_user123', t0 + 6 * DAY);
  assert.equal(r.quotas.chat.limit, 120); assert.equal(r.quotas.chat.used, 60);
});

await check('план за 12 седмици → 84 дни и лимити ×3', async () => {
  const d = await checkout({ product: 'plan_12w', userId: 'fb_other99' });
  assert.equal(lastBody.get('line_items[0][price_data][unit_amount]'), '3499');
  await confirm(sid(d.url), t0);
  const a = normalizeAccess(await readAccess(env, 'fb_other99'), t0);
  assert.ok(Math.abs(a.until - (t0 + 84 * DAY)) < 2000);
  assert.equal(a.quota.chat, 180); assert.equal(a.quota.photo, 90);
});

await check('изтекъл план → обратно на безплатното', async () => {
  const a = normalizeAccess(await readAccess(env, 'fb_other99'), t0 + 85 * DAY);
  assert.equal(a.tier, 'start'); assert.equal(a.expired, true);
});

await check('IrisMap: първи протокол 9,99 €, после контролно разчитане 6,99 € (решава сървърът)', async () => {
  const base = { product: 'iris_protocol', deviceId: 'dev_iris_0001', returnUrl: 'https://irismap.app/app.html' };
  const d1 = await checkout({ ...base, analysisId: 'an_1' });
  assert.equal(lastBody.get('line_items[0][price_data][unit_amount]'), '999');
  const c1 = await confirm(sid(d1.url));
  assert.equal(c1.analysisId, 'an_1');
  assert.ok(kv.get('iris_unlock:an_1'));
  const d2 = await checkout({ ...base, analysisId: 'an_2' });
  assert.equal(d2.product, 'iris_recheck');
  assert.equal(lastBody.get('line_items[0][price_data][unit_amount]'), '699');
  // друго устройство → пак пълната цена
  await checkout({ ...base, deviceId: 'dev_iris_0002', analysisId: 'an_3' });
  assert.equal(lastBody.get('line_items[0][price_data][unit_amount]'), '999');
});

await check('IrisMap: връщане само към нашите адреси, нужно е устройство', async () => {
  assert.equal((await checkout({ product: 'iris_protocol', analysisId: 'a', deviceId: 'dev_iris_0001', returnUrl: 'https://evil.example/' })).error, 'bad_request');
  assert.equal((await checkout({ product: 'iris_protocol', analysisId: 'a', returnUrl: 'https://irismap.app/' })).error, 'bad_request');
});

await check('EmoEat: 2,99 € → един кредит за личния анализ', async () => {
  const d = await checkout({ product: 'emoeat_analysis', deviceId: 'em1234567890ab', returnUrl: 'https://emoeat.app/' });
  assert.equal(lastBody.get('line_items[0][price_data][unit_amount]'), '299');
  await confirm(sid(d.url));
  assert.equal(await emoeatCredit(env, 'em1234567890ab'), 1);
  await useEmoeatCredit(env, 'em1234567890ab');
  assert.equal(await emoeatCredit(env, 'em1234567890ab'), 0);
});

await check('неплатена сесия → нищо не се записва', async () => {
  sessions.cs_test_unpaid00000 = { id: 'cs_test_unpaid00000', payment_status: 'unpaid', metadata: { product: 'plan_4w', userId: 'fb_nopay000' } };
  const d = await confirm('cs_test_unpaid00000');
  assert.equal(d.ok, false);
  assert.equal(await readAccess(env, 'fb_nopay000'), null);
});

// ── Webhook ──
const sign = (payload, secret = 'whsec_test_abc', t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
const hook = async (event, sig) => {
  const payload = JSON.stringify(event);
  const r = await handleBillingWebhook(new Request('https://w/api/billing/webhook', { method: 'POST', body: payload, headers: { 'Stripe-Signature': sig ?? sign(payload) } }), env, { respond });
  return { status: r.status, d: await r.json() };
};
const completed = (s) => ({ type: 'checkout.session.completed', livemode: false, data: { object: { mode: 'payment', payment_status: 'paid', ...s } } });

await check('webhook: подписът се проверява (грешен, чужд ключ, стар)', async () => {
  const ev = completed({ id: 'cs_test_wh_bad000001', metadata: { product: 'plan_4w', userId: 'fb_webhook01' } });
  assert.equal((await hook(ev, 'nonsense')).status, 400);
  assert.equal((await hook(ev, sign(JSON.stringify(ev), 'whsec_other'))).status, 400);
  assert.equal((await hook(ev, sign(JSON.stringify(ev), 'whsec_test_abc', Math.floor(Date.now() / 1000) - 3600))).status, 400);
  assert.equal(await readAccess(env, 'fb_webhook01'), null);
  assert.equal(await verifyStripeSignature('x', sign('x'), 'whsec_test_abc'), true);
});

await check('webhook: платен план се записва без връщане от Stripe', async () => {
  const r = await hook(completed({ id: 'cs_test_wh_plan00001', metadata: { product: 'plan_4w', userId: 'fb_webhook01' } }));
  assert.equal(r.status, 200); assert.equal(r.d.ok, true);
  assert.equal(normalizeAccess(await readAccess(env, 'fb_webhook01')).tier, 'core');
});

await check('webhook + връщане за същата поръчка → записва се веднъж', async () => {
  sessions.cs_test_wh_plan00001 = { id: 'cs_test_wh_plan00001', payment_status: 'paid', metadata: { product: 'plan_4w', userId: 'fb_webhook01' } };
  const before = await readAccess(env, 'fb_webhook01');
  assert.equal((await confirm('cs_test_wh_plan00001')).repeat, true);
  assert.equal((await hook(completed({ id: 'cs_test_wh_plan00001', metadata: { product: 'plan_4w', userId: 'fb_webhook01' } }))).d.repeat, true);
  assert.deepEqual(await readAccess(env, 'fb_webhook01'), before);
  // и без маркера billing:done (едновременни пътища) планът не се удвоява
  kv.delete('billing:done:cs_test_wh_plan00001');
  await hook(completed({ id: 'cs_test_wh_plan00001', metadata: { product: 'plan_4w', userId: 'fb_webhook01' } }));
  assert.equal(normalizeAccess(await readAccess(env, 'fb_webhook01')).quota.chat, 60);
});

await check('webhook: чужди плащания, друг режим и неплатени се приемат без запис', async () => {
  assert.equal((await hook(completed({ id: 'cs_test_xbody00001', metadata: { product: 'xbody_guarantee' } }))).d.ok, false);
  assert.equal((await hook({ ...completed({ id: 'cs_live_000000001', metadata: { product: 'plan_4w', userId: 'fb_webhook02' } }), livemode: true })).d.ignored, 'mode');
  assert.equal((await hook({ type: 'invoice.paid', livemode: false, data: { object: {} } })).d.ignored, 'invoice.paid');
  const unpaid = await hook(completed({ id: 'cs_test_wh_unpaid001', payment_status: 'unpaid', metadata: { product: 'plan_4w', userId: 'fb_webhook02' } }));
  assert.equal(unpaid.status, 200); assert.equal(unpaid.d.ok, false);
  assert.equal(await readAccess(env, 'fb_webhook02'), null);
});

await check('webhook без ключ за подписа → 503', async () => {
  const r = await handleBillingWebhook(new Request('https://w', { method: 'POST', body: '{}' }), { ...env, STRIPE_TEST_WEBHOOK_SECRET: '' }, { respond });
  assert.equal(r.status, 503);
});

console.log(`\nВсички ${checks.length} проверки минаха`);
