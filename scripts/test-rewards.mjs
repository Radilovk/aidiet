#!/usr/bin/env node
/**
 * Награди за постоянство: правилата (rewards-engine.js) и сървърът (rewards.js + отстъпката в billing.js).
 * Без мрежа: KV и Stripe са подменени.
 *   node scripts/test-rewards.mjs
 */
import assert from 'node:assert/strict';
import RE from '../rewards-engine.js';
import { calcDayScore } from '../analytics-compression.js';
import { handleRewards, handleRewardsRedeem, handleRewardCodeStatus, handleInviteStatus, handlePartnerVerify, handleAdminRewardsContent, handleAdminRewardsImage, handleRewardsImage, handleRewardsContent, percentileOf, INVITE_PCT, INVITER_PCT, INVITE_POINTS } from '../rewards.js';
import { handleBillingCheckout, handleBillingConfirm } from '../billing.js';

const DAY = 86400000;
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log('✅', name); };

const key = (ms) => new Date(ms).toISOString().slice(0, 10);
// Историята свършва днес: плащането (billing.js) проверява срока на кодовете с часовника.
const T0 = Math.floor(Date.now() / DAY) * DAY - 40 * DAY;
const SLOTS = ['Закуска', 'Обяд', 'Вечеря'];
/** Ден с n отметнати хранения (0–3) и вечерен въпрос; steps — крачките спрямо цел 8000. */
const day = (n, steps = 0) => ({
  meals: Object.fromEntries(SLOTS.map((s, i) => [s, i < n])), mealSlots: SLOTS,
  morningCheck: { sleptWell: true },
  eveningCheck: { waterIntake: true, activityLevel: 3, emotionalBalance: 3, ...(steps ? { steps, equivSteps: steps, stepTarget: 8000 } : {}) },
});
/** История: pattern(i) → ден или null; последният индекс е днес. */
function history(len, pattern) {
  const g = {};
  for (let i = 0; i < len; i++) { const d = pattern(i); if (d) g[key(T0 + i * DAY)] = d; }
  return { gameData: g, todayKey: key(T0 + (len - 1) * DAY) };
}
const run = (h, extra = {}) => RE.compute({ ...h, calcDayScore, ...extra });

await check('ангажираността на пълен ден е 100%, на празен — под прага', async () => {
  assert.equal(calcDayScore(day(3), key(T0)).engPct, 100);
  assert.ok(calcDayScore(day(0), key(T0)).engPct < RE.GOOD);
});

await check('стъпалата: 14 добри дни → „Начало“, 30 → „Стабилност“; бонус веднъж', async () => {
  let r = run(history(14, () => day(3)));
  assert.equal(r.tier.id, 'start');
  assert.equal(r.next.id, 'steady');
  r = run(history(30, () => day(3)));
  assert.equal(r.tier.id, 'steady');
  assert.deepEqual(r.milestones.filter((m) => m.kind === 'tier').map((m) => m.tier), ['start', 'steady']);
  assert.equal(r.points.bonus, 100 + 200 + 30 + 70);   // две стъпала + поредици 7 и 21
});

await check('жокер: 1 на 14 добри дни; покрива ден без отметки и поредицата продължава', async () => {
  const r = run(history(20, (i) => (i === 16 ? null : day(3))));
  assert.equal(r.shields.used.length, 1);
  assert.equal(r.streak, 19);
  assert.equal(r.shields.held, 0);
  // без жокер (пропуск на 5-ия ден) поредицата се къса
  const r2 = run(history(10, (i) => (i === 5 ? null : day(3))));
  assert.equal(r2.streak, 4);
  assert.ok(r2.milestones.every((m) => m.kind !== 'shield'));
});

await check('слаб ден със записи къса поредицата (жокерът е само за ден без отметки)', async () => {
  const r = run(history(20, (i) => (i === 16 ? day(0) : day(3))));
  assert.equal(r.streak, 3);
  assert.equal(r.shields.held, 1);
});

await check('стъпалото се пази 14 дни под прага, после слиза с едно (с предупреждение преди това)', async () => {
  // 40 добри дни → „Стабилност“, после слаби дни (само въпросите, без хранения: 50%)
  const weak = (n) => run(history(40 + n, (i) => (i < 40 ? day(3) : day(0))));
  assert.equal(weak(5).warning, null);                 // средното за 14 дни още е над 60%
  const at15 = weak(15);
  assert.equal(at15.tier.id, 'steady');
  assert.ok(at15.warning && at15.warning.daysLeft > 0);
  assert.equal(weak(30).tier.id, 'start');             // 14 дни под прага → едно стъпало надолу
  assert.equal(weak(45).tier, null);
});

await check('днес: още неотметнат ден не сваля средното (оценява се до вчера)', async () => {
  const h = history(15, (i) => (i === 14 ? day(0) : day(3)));
  const r = run(h);
  assert.equal(r.tier.id, 'start');
  assert.equal(r.streak, 14);
});

await check('точки: 10 за добър ден, +5 при ≥80%, +5 при крачки на целта, до 20', async () => {
  const r = run(history(3, () => day(3, 9000)));
  assert.deepEqual(Object.values(r.points.days), [20, 20, 20]);
  const r2 = run(history(3, () => day(3, 4000)));
  assert.deepEqual(Object.values(r2.points.days), [15, 15, 15]);
  assert.equal(r2.records.maxSteps.steps, 4000);
});

await check('66 дни поред → нов навик', async () => {
  const r = run(history(66, () => day(3)));
  assert.ok(r.milestones.some((m) => m.id === 'streak:66' && m.kind === 'habit' && m.big));
});

await check('тегло: етапи 3/5%; твърде бързо (над 1%/седмица) → без поздрав', async () => {
  const slow = [{ at: T0, kg: 100 }, { at: T0 + 30 * DAY, kg: 97.5 }, { at: T0 + 50 * DAY, kg: 96 }, { at: T0 + 70 * DAY, kg: 94.8 }];
  let r = run(history(3, () => day(3)), { weightLog: slow, startKg: 100, goalDirection: 'lose' });
  assert.deepEqual(r.weight.reached.map((x) => x.pct), [3, 5]);
  assert.equal(r.weight.tooFast, false);
  assert.ok(r.milestones.some((m) => m.id === 'weight:lose:5' && m.big));
  const fast = [{ at: T0, kg: 100 }, { at: T0 + 21 * DAY, kg: 94 }];
  r = run(history(3, () => day(3)), { weightLog: fast, startKg: 100, goalDirection: 'lose' });
  assert.equal(r.weight.tooFast, true);
  assert.ok(!r.milestones.some((m) => m.kind === 'weight'));
  // цел без килограми → без етапи
  assert.equal(run(history(3, () => day(3)), { weightLog: slow, startKg: 100, goalDirection: 'maintain' }).weight, null);
});

await check('сравнение: под 200 души — няма; иначе делът с по-ниско постоянство', async () => {
  const c = new Array(101).fill(0);
  c[50] = 150; c[90] = 49; c[95] = 1;
  assert.equal(percentileOf({ n: 200, c }, 90), 75);
  assert.equal(percentileOf({ n: 199, c }, 90), null);
});

// ── Сървърът ────────────────────────────────────────────────────────────────
const kv = new Map();
const meta = new Map();
const env = {
  STRIPE_TEST_SECRET_KEY: 'sk_test_x',
  REWARDS_PARTNER_KEY: 'partner-secret',
  page_content: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    getWithMetadata: async (k) => (kv.has(k) ? { value: kv.get(k), metadata: meta.get(k) || null } : null),
    put: async (k, v, o) => { kv.set(k, v); if (o?.metadata) meta.set(k, o.metadata); },
    delete: async (k) => { kv.delete(k); },
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })), list_complete: true }),
  },
};
const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const checkOwner = async (userId, idToken) => (idToken === 'ok' ? null : respond({ error: 'auth' }, 401));
const req = (body, { country, headers } = {}) => {
  const r = new Request('https://w/x', { method: 'POST', body: JSON.stringify(body), headers: { ...(headers || {}), ...(country ? { 'CF-IPCountry': country } : {}) } });
  return r;
};
const deps = (now) => ({ respond, checkOwner, now });
const A = 'fb_userAAAAAA', B = 'fb_userBBBBBB';
const NOW = T0 + 40 * DAY + 12 * 3600000;
const { gameData: g40, todayKey: today40 } = history(41, () => day(3, 9000));
kv.set(`game_state:${A}`, JSON.stringify({ gameData: g40 }));
const rewards = async (userId, opts = {}) => (await handleRewards(req({ userId, idToken: 'ok', todayKey: today40 }, opts), env, deps(NOW))).json();

await check('без токен → 401; без акаунт → 400', async () => {
  assert.equal((await handleRewards(req({ userId: A }), env, deps(NOW))).status, 401);
  assert.equal((await handleRewards(req({ userId: 'local_123' }), env, deps(NOW))).status, 400);
});

let first;
await check('стъпалата дават кодове веднъж; точките са от дните + бонусите; има код за покана', async () => {
  first = await rewards(A, { country: 'BG' });
  assert.equal(first.status.tier, 'steady');
  assert.deepEqual(first.fresh.map((c) => `${c.kind}${c.pct}`), ['supplement5', 'supplement10']);
  assert.ok(first.wallet.balance > 41 * 15);
  assert.match(first.invite.code, /^(DUO|PAL)\d{3}$/);
  assert.deepEqual(first.fresh.map((c) => c.code), ['BOLD5', 'GRIT10']);
  const again = await rewards(A, { country: 'BG' });
  assert.equal(again.fresh.length, 0);
  assert.equal(again.codes.length, 2);
  assert.equal(again.invite.code, first.invite.code);
  assert.equal(again.wallet.earned, first.wallet.earned);
});

await check('точките остават, когато старите дни изчезнат от gameData (пази се най-високото)', async () => {
  const trimmed = Object.fromEntries(Object.entries(g40).slice(-10));
  kv.set(`game_state:${A}`, JSON.stringify({ gameData: trimmed }));
  const r = await rewards(A, { country: 'BG' });
  assert.equal(r.wallet.earned, first.wallet.earned);
  kv.set(`game_state:${A}`, JSON.stringify({ gameData: g40 }));
});

await check('добавки — само за България: от друга държава няма код и оферта за тях', async () => {
  const C = 'fb_userCCCCCC';
  kv.set(`game_state:${C}`, JSON.stringify({ gameData: g40 }));
  const r = await rewards(C, { country: 'DE' });
  assert.equal(r.fresh.length, 0);
  assert.equal(r.supplements, false);
  assert.ok(r.offers.every((o) => o.kind !== 'supplement'));
});

await check('точки → код; недостатъчно точки → отказ; партньорът проверява и маркира кода', async () => {
  const redeem = async (offer, country = 'BG') => (await handleRewardsRedeem(req({ userId: A, idToken: 'ok', offer }, { country }), env, deps(NOW))).json();
  const d = await redeem('supp10');
  assert.equal(d.success, true);
  assert.equal(d.code.kind, 'supplement');
  assert.equal(d.code.code, 'WIN10');
  assert.equal(d.balance, first.wallet.balance - RE.offerById('supp10').cost);
  const poor = await redeem('plan10');
  assert.equal(poor.error, 'points');
  const verify = async (body, key = 'partner-secret') => (await handlePartnerVerify(req(body, { headers: { 'X-Partner-Key': key } }), env, deps(NOW))).json();
  kv.set('email_index:a@example.com', JSON.stringify({ userId: A }));
  kv.set('email_index:b@example.com', JSON.stringify({ userId: B }));
  assert.equal((await verify({ code: d.code.code, email: 'a@example.com' }, 'wrong')).error, 'unauthorized');
  assert.equal((await verify({ code: d.code.code, email: 'A@example.com ' })).valid, true);
  // кодът е еднакъв за всички, но важи само за спечелилия го
  assert.equal((await verify({ code: d.code.code, email: 'b@example.com' })).valid, false);
  assert.equal((await verify({ code: 'GRIT10', email: 'a@example.com' })).valid, true);
  // въведен на ръка: малки букви и интервали вместо тирета
  assert.equal((await verify({ code: 'win 10', email: 'a@example.com' })).valid, true);
  assert.equal((await verify({ code: d.code.code, email: 'a@example.com', redeem: true, order: 'BC-1' })).redeemed, true);
  assert.equal((await verify({ code: d.code.code, email: 'a@example.com' })).valid, false);
});

// подменен Stripe за покупката с покана
const sessions = {};
let seq = 0, lastBody;
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname.replace('/v1/', '');
  const ok = (x) => new Response(JSON.stringify(x), { status: 200 });
  if (path === 'checkout/sessions' && init.method === 'POST') {
    lastBody = new URLSearchParams(init.body || '');
    const id = `cs_test_${String(++seq).padStart(12, '0')}`;
    const metadata = {};
    for (const [k, v] of lastBody) { const m = k.match(/^metadata\[(\w+)\]$/); if (m) metadata[m[1]] = v; }
    sessions[id] = { id, payment_status: 'paid', metadata };
    return ok({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
  }
  if (path.startsWith('checkout/sessions/')) return ok(sessions[path.split('/')[2]] || {});
  return new Response('{}', { status: 404 });
};

await check(`покана: −${INVITE_PCT}% за първия план; поканилият получава код −${INVITER_PCT}% и ${INVITE_POINTS} точки — веднъж`, async () => {
  const inv = first.invite.code;
  assert.equal((await (await handleInviteStatus(new URL(`https://w/x?code=${inv}`), env, deps(NOW))).json()).valid, true);
  const buy = async (userId, extra) => (await handleBillingCheckout(req({ product: 'plan_4w', userId, ...extra }), env, { respond })).json();
  const out = await buy(B, { invite: inv });
  const full = (await import('../pricing-config.js')).default.product('plan_4w').price;
  assert.equal(out.price, Math.round(full * (100 - INVITE_PCT)) / 100);
  assert.equal(lastBody.get('metadata[invite]'), inv);
  const confirm = async (id) => (await handleBillingConfirm(req({ sessionId: id }), env, { respond, now: NOW })).json();
  assert.equal((await confirm(out.url.split('/').pop())).ok, true);
  const after = await rewards(A, { country: 'BG' });
  assert.equal(after.invite.count, 1);
  assert.equal(after.wallet.earned, first.wallet.earned + INVITE_POINTS);
  const planCode = after.codes.find((c) => c.kind === 'plan' && c.source === 'invite');
  assert.equal(planCode.pct, INVITER_PCT);
  // вторият план на поканения — без поканата; собствената покана — също не важи
  const second = await buy(B, { invite: inv });
  assert.equal(second.price, full);
  assert.equal((await buy(A, { invite: inv })).price, full);
  // кодът за план на поканилия: важи само за него и се изразходва при покупката
  assert.equal((await buy(B, { reward: planCode.code })).price, full);
  const own = await buy(A, { reward: planCode.code });
  assert.equal(own.price, Math.round(full * (100 - INVITER_PCT)) / 100);
  await confirm(own.url.split('/').pop());
  assert.equal(planCode.code, 'ALLY20');
  const status = await (await handleRewardCodeStatus(new URL(`https://w/x?code=${planCode.code}&userId=${A}`), env, deps(NOW))).json();
  assert.equal(status.valid, false);
});

await check('сравнението се появява при поне 200 активни', async () => {
  for (let i = 0; i < 210; i++) { const k = `rstat:fb_x${i}`; kv.set(k, ''); meta.set(k, { c: i % 100, s: 1 }); }
  kv.delete('rewards_hist');
  const r = await rewards(A, { country: 'BG' });
  assert.ok(r.percentile >= 90, `percentile ${r.percentile}`);
  assert.ok(r.cohort >= 200);
});

await check('админ панел: текстове и дума на кода се сменят; снимка за тема се качва и сервира', async () => {
  const save = async (content) => (await handleAdminRewardsContent(req({ content }), env, { respond })).json();
  assert.equal((await save({ tiers: { steady: { title: 'Упорство', word: 'push' } }, texts: { section: 'Сила' } })).success, true);
  const C = 'fb_userDDDDDD';
  kv.set(`game_state:${C}`, JSON.stringify({ gameData: g40 }));
  const r = await (await handleRewards(req({ userId: C, idToken: 'ok', todayKey: today40 }, { country: 'BG' }), env, deps(NOW + 120000))).json();
  assert.deepEqual(r.fresh.map((c) => c.code), ['BOLD5', 'PUSH10']);
  const png = 'data:image/png;base64,' + Buffer.from('fake').toString('base64');
  const up = await (await handleAdminRewardsImage(req({ theme: 'persist', data: png }), env, { respond, now: NOW })).json();
  assert.match(up.url, /\/api\/rewards\/image\/persist\?v=/);
  const img = await handleRewardsImage('persist', env);
  assert.equal(img.headers.get('Content-Type'), 'image/png');
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), 'fake');
  const content = (await (await handleRewardsContent(env, { respond })).json()).content;
  assert.equal(content.tiers.steady.title, 'Упорство');
  assert.ok(content.images.persist);
  assert.equal((await (await handleAdminRewardsImage(req({ theme: 'nope', data: png }), env, { respond })).json()).error, 'theme');
  await save({});
  RE.applyContent(null);
});

console.log(`\nВсички ${checks.length} проверки минаха`);
