/**
 * Плащанията през Stripe (Checkout) — само ЕДНОКРАТНИ покупки, без абонаменти.
 *
 * Продукти (цените са само в pricing-config.js, Stripe ги получава в поръчката):
 *   - Eatologix: план за 4 седмици, за 12 седмици, продължение 4 седмици → нивото core със срок и
 *     лимити в KV `access:<userId>` (продължение при активен план добавя срок и лимити към остатъка);
 *   - IrisMap: анализ (6,99 €) → кредит за един анализ на устройството + ваучер: платеното се
 *     приспада от първия план в Eatologix до 30 дни (KV iris_voucher:<код>);
 *   - EmoEat: личен анализ (2,99 €) → кредит за един анализ на устройството/акаунта.
 *
 * Режим: BILLING_MODE = 'test' (по подразбиране) → STRIPE_TEST_SECRET_KEY; 'live' → STRIPE_SECRET_KEY
 * (същата сметка, с която работи гаранцията за XBODY). Без ключ → 503 { error: 'no_stripe' }.
 * Покупката се записва от два пътя — webhook (POST /api/billing/webhook, checkout.session.completed)
 * и връщането от Stripe (?paid=cs_… → /api/billing/confirm); който дойде пръв. Записът е еднократен
 * (KV billing:done:<id>; планът пази и id-тата на сесиите си — двата пътя едновременно не дават двойно).
 * Webhook подпис: STRIPE_TEST_WEBHOOK_SECRET (тест) / STRIPE_WEBHOOK_SECRET (реален режим), whsec_….
 * Правото на отказ (ЕС, цифрово съдържание): поръчката изисква съгласие за незабавна доставка.
 */
import Pricing from './pricing-config.js';
import { readAccess, writeAccess, normalizeAccess } from './access-control.js';
import { planDiscount, applyPlanDiscount } from './rewards.js';

const API = 'https://api.stripe.com/v1/';
const DAY_MS = 24 * 3600 * 1000;
const ALLOWED_RETURN = /^https:\/\/(nutriin\.app|www\.nutriin\.app|nutriin\.eu|www\.nutriin\.eu|eatologix\.com|www\.eatologix\.com|biocode\.website|emoeat\.app|irismap\.app|www\.irismap\.app|radilovk\.github\.io)(\/|$)/;

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
function randomCode(n = 16) {
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return [...b].map((x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
}
const okReturn = (u) => (typeof u === 'string' && ALLOWED_RETURN.test(u) ? u : null);
const withParam = (u, k, v) => u + (u.includes('?') ? '&' : '?') + `${k}=${v}`;
const okUser = (id) => /^fb_[A-Za-z0-9_-]{6,128}$/.test(String(id || ''));
const okDevice = (id) => /^[A-Za-z0-9_-]{8,64}$/.test(String(id || ''));

/** Плановете (за показване) и дали плащането е включено. */
export function billingStatus(env) {
  return { ready: billingReady(env), mode: stripeMode(env), products: Pricing.PRODUCTS };
}

const okVoucher = (c) => /^[a-z0-9]{10,32}$/.test(String(c || ''));
/** Ваучерът от IrisMap: годен ли е за план → { amount, until } или null. */
export async function readVoucher(env, code, now = Date.now()) {
  if (!okVoucher(code)) return null;
  const v = JSON.parse((await env.page_content.get(`iris_voucher:${code}`)) || 'null');
  return v && !v.usedBy && v.until > now ? v : null;
}
/** GET /api/billing/voucher?code= → { valid, amount, until } */
export async function handleVoucherStatus(url, env, { respond }) {
  const v = await readVoucher(env, url.searchParams.get('code'));
  return respond(v ? { valid: true, amount: v.amount, until: v.until } : { valid: false });
}

/** POST /api/billing/checkout { product, userId?, deviceId?, returnUrl?, voucher?, ref?, reward?, invite? } → { url } */
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
      // Ваучер от IrisMap: платеното за анализа се приспада от плана (не от продължението).
      const v = !P.requiresPlan ? await readVoucher(env, b.voucher) : null;
      if (v) { meta.voucher = b.voucher; P = { ...P, price: Math.max(0.5, Math.round((P.price - v.amount) * 100) / 100), description: `С приспаднати ${Pricing.formatPrice(v.amount)} от анализа в IrisMap` }; }
      // Награда за постоянство или покана от приятел — по-голямата от двете, след ваучера.
      const d = await planDiscount(env, b.userId, { reward: b.reward, invite: P.requiresPlan ? '' : b.invite });
      if (d) {
        if (d.reward) meta.reward = d.reward;
        if (d.invite) meta.invite = d.invite;
        P = { ...P, price: Math.max(0.5, Math.round(P.price * (100 - d.pct)) / 100), description: [P.description, d.label].filter(Boolean).join(' · ') };
      }
      const site = /^https:\/\/(nutriin\.app|eatologix\.com|biocode\.website)$/.test(origin) ? origin : 'https://nutriin.app';
      back = `${site}/pricing.html`;
    } else if (P.kind === 'iris') {
      back = okReturn(b.returnUrl);
      if (!back || !okDevice(b.deviceId)) return respond({ error: 'bad_request' }, 400);
      meta.deviceId = b.deviceId;
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
  const record = await readAccess(env, userId);
  const sessions = Array.isArray(record?.stripe?.sessions) ? record.stripe.sessions : [];
  if (sessions.includes(sessionId)) return record;   // вече записана (webhook и връщане едновременно)
  const current = normalizeAccess(record, now);
  const active = current.tier === 'core' && current.until && current.until > now;
  const quota = { ...add };
  if (active && current.quota) for (const k of Object.keys(add)) quota[k] = (Number(current.quota[k]) || 0) + add[k];
  return writeAccess(env, userId, {
    tier: 'core',
    periodStart: active && current.periodStart ? current.periodStart : now,
    until: new Date((active ? current.until : now) + P.days * DAY_MS).toISOString(),
    quota, source: 'stripe',
    note: `${P.name} · ${Pricing.formatPrice(P.price)} · Stripe ${stripeMode(env)}`,
    stripe: { mode: stripeMode(env), session: sessionId, sessions: [...sessions, sessionId].slice(-20) },
  }, now);
}

/** Записва платена сесия (веднъж). → { ok, ... } или { ok: false, status }. */
async function applySession(env, s, now) {
  const doneKey = `billing:done:${s.id}`;
  const done = await env.page_content.get(doneKey);
  if (done) return { ok: true, repeat: true, ...JSON.parse(done) };
  if (s.payment_status !== 'paid') return { ok: false, status: s.payment_status || s.status };
  const m = s.metadata || {};
  const P = Pricing.product(m.product);
  if (!P) return { ok: false, status: 'unknown' };   // чуждо плащане от същата сметка (напр. XBODY)
  let result = { product: m.product };
  if (P.kind === 'plan') {
    const rec = await grantPlan(env, m.userId, m.product, s.id, now);
    result = { ...result, userId: m.userId, tier: rec.tier, until: rec.until };
    if (okVoucher(m.voucher)) {
      const vk = `iris_voucher:${m.voucher}`;
      const v = JSON.parse((await env.page_content.get(vk)) || 'null');
      if (v) await env.page_content.put(vk, JSON.stringify({ ...v, usedBy: m.userId, usedAt: now }), { expirationTtl: 60 * 86400 });
    }
    if (m.reward || m.invite) await applyPlanDiscount(env, m.userId, m, now);
  } else if (P.kind === 'iris') {
    // Кредит за един анализ на устройството (iris-gate.js го изразходва при билета) + ваучер за плана.
    const ck = `iris_credit:${m.deviceId}`;
    await env.page_content.put(ck, String((Number(await env.page_content.get(ck)) || 0) + 1), { expirationTtl: 400 * 86400 });
    const voucher = randomCode();
    const until = now + Pricing.IRIS_DISCOUNT_DAYS * DAY_MS;
    await env.page_content.put(`iris_voucher:${voucher}`, JSON.stringify({ amount: P.price, until, deviceId: m.deviceId, session: s.id }), { expirationTtl: (Pricing.IRIS_DISCOUNT_DAYS + 30) * 86400 });
    result = { ...result, deviceId: m.deviceId, voucher, voucherUntil: until, amount: P.price };
  } else if (P.kind === 'emoeat') {
    const k = `emoeat_credit:${m.holder}`;
    await env.page_content.put(k, String((Number(await env.page_content.get(k)) || 0) + 1), { expirationTtl: 400 * 86400 });
    result = { ...result, holder: m.holder };
  }
  await env.page_content.put(doneKey, JSON.stringify(result), { expirationTtl: 400 * 86400 });
  return { ok: true, ...result };
}

/** POST /api/billing/confirm { sessionId } — след връщане от Stripe: записва покупката (ако webhook още не е). */
export async function handleBillingConfirm(request, env, { respond, now = Date.now() } = /** @type {any} */ ({})) {
  if (!billingReady(env)) return respond({ error: 'no_stripe' }, 503);
  const { sessionId } = await request.json().catch(() => ({}));
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(String(sessionId || ''))) return respond({ error: 'bad_request' }, 400);
  const done = await env.page_content.get(`billing:done:${sessionId}`);
  if (done) return respond({ ok: true, repeat: true, ...JSON.parse(done) });
  try {
    const s = await stripe(env, 'GET', `checkout/sessions/${sessionId}`);
    return respond(await applySession(env, { ...s, id: sessionId }, now));
  } catch (e) {
    return respond({ error: 'stripe', message: e.message }, 502);
  }
}

const webhookSecret = (env) => (stripeMode(env) === 'live' ? env.STRIPE_WEBHOOK_SECRET : env.STRIPE_TEST_WEBHOOK_SECRET);

/** Подписът на Stripe: заглавие „t=…,v1=…“, HMAC-SHA256(„t.тяло“) с whsec_…; до 5 минути разлика. */
export async function verifyStripeSignature(payload, header, secret, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = String(header).split(',').map((x) => x.split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((sig) => {
    if (sig.length !== hex.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
  });
}

/**
 * POST /api/billing/webhook — събития от Stripe (Workbench → Webhooks → адрес …/api/billing/webhook,
 * събития checkout.session.completed и checkout.session.async_payment_succeeded).
 * Отговор 200 = прието (и за чужди/непознати събития); 400 = невалиден подпис; 500 → Stripe опитва пак.
 */
export async function handleBillingWebhook(request, env, { respond, now = Date.now() } = /** @type {any} */ ({})) {
  const secret = webhookSecret(env);
  if (!secret) return respond({ error: 'no_webhook_secret' }, 503);
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), secret, now))) {
    return respond({ error: 'bad_signature' }, 400);
  }
  let event;
  try { event = JSON.parse(payload); } catch (_) { return respond({ error: 'bad_json' }, 400); }
  if (Boolean(event.livemode) !== (stripeMode(env) === 'live')) return respond({ received: true, ignored: 'mode' });
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    return respond({ received: true, ignored: event.type });
  }
  const s = event.data?.object;
  if (!s?.id || s.mode !== 'payment') return respond({ received: true, ignored: 'not_payment' });
  try {
    const r = await applySession(env, s, now);
    return respond({ received: true, ...r });
  } catch (e) {
    return respond({ error: 'apply_failed', message: e.message }, 500);   // Stripe ще опита пак
  }
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
