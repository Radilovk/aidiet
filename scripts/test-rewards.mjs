#!/usr/bin/env node
/**
 * Награди за постоянство: правилата (rewards-engine.js) и сървърът (rewards.js + отстъпката в billing.js).
 * Без мрежа: KV и Stripe са подменени.
 *   node scripts/test-rewards.mjs
 */
import assert from 'node:assert/strict';
import RE from '../rewards-engine.js';
import DayAdh from '../day-adherence.js';
import { calcDayScore } from '../analytics-compression.js';
import { handleRewards, handleRewardsRedeem, handleRewardCodeStatus, handleInviteStatus, handlePartnerVerify, handleAdminRewardsContent, handleAdminRewardsImage, handleRewardsImage, handleRewardsContent, handleRewardsChallenge, handleRewardsEvent, handleAdminRewardsReport, noteInviteSignup, percentileOf, INVITE_PCT, INVITER_PCT, INVITE_POINTS } from '../rewards.js';
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

await check('нивата: 10 от 14 дни, които се броят → „Упоритост“, 24 от 30 → „Постоянство“; бонус веднъж', async () => {
  assert.equal(run(history(9, () => day(3))).tier, null);
  let r = run(history(10, () => day(3)));
  assert.equal(r.tier.id, 'start');
  assert.equal(r.next.id, 'steady');
  r = run(history(30, () => day(3)));
  assert.equal(r.tier.id, 'steady');
  assert.deepEqual(r.milestones.filter((m) => m.kind === 'tier').map((m) => m.tier), ['start', 'steady']);
  assert.equal(r.points.bonus, 100 + 200 + 30 + 70 + 30 + 70);   // две стъпала + поредици 7 и 21 + активни дни 7 и 21
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

await check('жокерът пази и честно отбелязан слаб ден; без жокер слабият ден къса поредицата', async () => {
  const r = run(history(20, (i) => (i === 16 ? day(0) : day(3))));
  assert.equal(r.streak, 19);
  assert.equal(r.shields.used.length, 1);
  const r2 = run(history(10, (i) => (i === 5 ? day(0) : day(3))));
  assert.equal(r2.streak, 4);
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

/** Дни по дата: from..to включително, pattern(key) → ден или null. */
function range(from, to, pattern) {
  const g = {};
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += DAY) { const k = key(t); const d = pattern(k); if (d) g[k] = d; }
  return g;
}

await check('седмицата: Пн–Нд, в неделя — текущата; сравнение с предишната', async () => {
  assert.equal(RE.weekEndKey('2026-11-22'), '2026-11-22');   // неделя
  assert.equal(RE.weekEndKey('2026-11-24'), '2026-11-22');   // вторник → миналата неделя
  const g = range('2026-11-09', '2026-11-23', (k) => (k < '2026-11-16' ? day(0) : day(3, 9000)));
  const r = RE.compute({ gameData: g, calcDayScore, todayKey: '2026-11-23' });
  assert.equal(r.week.startKey, '2026-11-16');
  assert.equal(r.week.endKey, '2026-11-22');
  assert.equal(r.week.good, 7);
  assert.equal(r.week.avg, 100);
  assert.equal(r.week.prevAvg, 50);
  assert.equal(r.week.delta, 50);
  assert.equal(r.week.stepsAvg, 9000);
  assert.equal(r.week.points, 7 * 20);
});

await check('месечно предизвикателство: от деня на приемане, 10 дни (не поред), бонус и етап; късно → не се приема', async () => {
  const g = range('2026-11-01', '2026-11-20', (k) => (k === '2026-11-08' ? day(0) : day(3, 9000)));
  const open = RE.compute({ gameData: g, calcDayScore, todayKey: '2026-11-15' });
  assert.equal(open.challenge.canJoin, true);
  assert.equal(open.challenge.joined, null);
  const ch = open.challenge;
  const r = RE.compute({ gameData: g, calcDayScore, todayKey: '2026-11-20', challenge: { id: ch.id, joined: '2026-11-05' } });
  assert.equal(r.challenge.count, 10);            // 5…20 без 8-ми = 15 дни, броят спира на 10
  assert.equal(r.challenge.done, true);
  assert.ok(r.milestones.some((m) => m.id === 'challenge:2026-11' && m.big));
  const late = RE.compute({ gameData: g, calcDayScore, todayKey: '2026-11-25' });
  assert.equal(late.challenge.canJoin, false);    // остават 6 дни < 10
  // приетото през миналия месец не се пренася
  const dec = RE.compute({ gameData: { ...g, '2026-12-02': day(3) }, calcDayScore, todayKey: '2026-12-02', challenge: { id: ch.id, joined: '2026-11-05' } });
  assert.equal(dec.challenge.joined, null);
  // „крачки“ без измерени крачки → „добри дни“
  const stepsMonth = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].find((m) => RE.challengeFor(m, true).id === 'steps');
  assert.equal(RE.challengeFor(stepsMonth, false).id, 'good');
});

await check('влизанията: дни от 14, обичаен и вечерен час, пауза', async () => {
  const hours = new Array(24).fill(0); hours[8] = 5; hours[20] = 3; hours[18] = 1;
  const o = { days: { '2026-11-20': 2, '2026-11-15': 1, '2026-10-01': 1 }, hours, last: Date.parse('2026-11-20T08:00:00Z'), prev: Date.parse('2026-11-15T08:00:00Z') };
  const st = RE.openStats(o, '2026-11-21');
  assert.deepEqual(st, { days14: 2, usualHour: 8, eveningHour: 20, gapDays: 5 });
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

await check('обичайната заявка не пише в KV; дните се банкират преди да изтекат и точките остават', async () => {
  // повторна заявка без промяна → нито един запис
  let puts = 0;
  const realPut = env.page_content.put;
  env.page_content.put = async (...x) => { puts++; return realPut(...x); };
  await rewards(A, { country: 'BG' });
  assert.equal(puts, 0);
  env.page_content.put = realPut;
  // 115 дни история → дните по-стари от 100 се банкират; после сливането ги изтрива (120+ дни) — точките остават
  const U = 'fb_userBANKED1';
  const nowB = Date.UTC(2026, 10, 20, 12);
  const full = range('2026-07-28', '2026-11-20', () => day(3, 9000));
  kv.set(`game_state:${U}`, JSON.stringify({ gameData: full }));
  const call = async () => (await handleRewards(req({ userId: U, idToken: 'ok', todayKey: '2026-11-20' }, { country: 'BG' }), env, deps(nowB))).json();
  const before = await call();
  const rec = JSON.parse(kv.get(`rewards:${U}`));
  assert.ok(Object.keys(rec.days).length >= 14 && Object.keys(rec.days).every((k) => k < '2026-08-12'));
  kv.set(`game_state:${U}`, JSON.stringify({ gameData: range('2026-08-12', '2026-11-20', () => day(3, 9000)) }));
  const after = await call();
  assert.equal(after.wallet.earned, before.wallet.earned);
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
  // разпределението се пази 12 часа (в паметта и в KV) — заявката е след срока
  const r = await (await handleRewards(req({ userId: A, idToken: 'ok', todayKey: today40 }, { country: 'BG' }), env, deps(NOW + 13 * 3600000))).json();
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

await check('предизвикателство на сървъра: приемане, изпълнение, бонус веднъж', async () => {
  const U = 'fb_userCHALL02';
  const nowJ = Date.UTC(2026, 10, 3, 12);
  kv.set(`game_state:${U}`, JSON.stringify({ gameData: range('2026-11-01', '2026-11-03', () => day(3, 9000)) }));
  const j = await (await handleRewardsChallenge(req({ userId: U, idToken: 'ok', todayKey: '2026-11-03' }), env, deps(nowJ))).json();
  assert.equal(j.success, true);
  assert.equal(j.challenge.joined, '2026-11-03');
  const nowD = Date.UTC(2026, 10, 14, 12);
  kv.set(`game_state:${U}`, JSON.stringify({ gameData: range('2026-11-01', '2026-11-14', () => day(3, 9000)) }));
  const r1 = await (await handleRewards(req({ userId: U, idToken: 'ok', todayKey: '2026-11-14' }), env, deps(nowD))).json();
  assert.equal(r1.challenge.done, true);
  const rec = JSON.parse(kv.get(`rewards:${U}`));
  assert.equal(rec.challengeBonus, RE.CHALLENGE_BONUS);
  const r2 = await (await handleRewards(req({ userId: U, idToken: 'ok', todayKey: '2026-11-14' }), env, deps(nowD))).json();
  assert.equal(r2.wallet.earned, r1.wallet.earned);         // бонусът — веднъж
  const all = {};
  for (let i = 0; i < 4; i++) Object.entries(JSON.parse(kv.get(`rev:2026-11-14:${i}`) || '{}')).forEach(([k, v]) => { all[k] = (all[k] || 0) + v; });
  assert.equal(all.challenge_done, 1);
});

await check('събития и отчет: позволените от телефона се броят; отчетът събира дни и хората (без лични данни)', async () => {
  const nowE = Date.UTC(2026, 10, 21, 10);
  const ev = async (type) => (await handleRewardsEvent(req({ type }), env, deps(nowE))).json();
  assert.equal((await ev('share_week')).success, true);
  assert.equal((await ev('invite_visit')).success, true);
  assert.equal((await ev('drop_table')).error, 'type');
  // влизанията — само в резюмето (група 1–3 дни → 1), не в записа
  const U = 'fb_userOPENS1';
  kv.set(`game_state:${U}`, JSON.stringify({ gameData: range('2026-11-01', '2026-11-21', () => day(3)) }));
  const hours = new Array(24).fill(0); hours[21] = 4;
  await handleRewards(req({ userId: U, idToken: 'ok', todayKey: '2026-11-21', opens: { days: { '2026-11-20': 1, '2026-11-21': 2 }, hours, last: nowE, prev: nowE - DAY } }), env, deps(nowE));
  assert.equal(JSON.parse(kv.get(`rewards:${U}`)).opens, undefined);
  assert.equal(meta.get(`rstat:${U}`).h, 21);
  assert.equal(meta.get(`rstat:${U}`).o, 1);
  const rep = await (await handleAdminRewardsReport(new URL('https://w/x?days=7'), env, { respond, now: nowE })).json();
  const last = rep.days[rep.days.length - 1];
  assert.equal(last.day, '2026-11-21');
  assert.equal(last.counts.share_week, 1);
  assert.equal(last.counts.invite_visit, 1);
  assert.ok(rep.people.users >= 1);
  assert.equal(rep.people.tiers.length, 5);
  assert.equal(rep.people.opens['1-3'] >= 1, true);
  assert.ok(!JSON.stringify(rep).includes('fb_'));         // без идентификатори
});

await check('покана във въпросника: само истински код се брои', async () => {
  assert.equal(await noteInviteSignup(env, first.invite.code.toLowerCase()), true);
  assert.equal(await noteInviteSignup(env, 'DUO000'), false);
});

await check('ден, който се брои: всичко спазено — непълни хранения, липсващ въпрос, вредно, преяждане не се броят', async () => {
  const ok = (rec) => RE.dayStatus(rec, calcDayScore(rec, key(T0))).ok;
  assert.equal(ok(day(3)), true);
  assert.equal(ok(day(2)), false);                                         // 2 от 3 хранения
  assert.equal(ok({ ...day(3), morningCheck: undefined }), false);         // без сутрешния въпрос
  assert.equal(ok({ ...day(3), eveningCheck: undefined }), false);         // без вечерния
  assert.equal(ok({ ...day(3), extraMeals: [{ isJunk: true, calories: 250 }] }), false);
  const over = { ...day(3), mealCalories: { 'Закуска': 500, 'Обяд': 700, 'Вечеря': 500 }, plannedCalories: 1700, extraMeals: [{ isJunk: false, calories: 400 }] };
  assert.equal(ok(over), false);                                           // над 110% от калориите
  // старата логика би броила тези дни: ангажираността им е над 60%
  assert.ok(calcDayScore(day(2), key(T0)).engPct >= RE.GOOD);
});

await check('оставащите дни и лентата казват едно и също', async () => {
  const r = run(history(7, () => day(3)));
  assert.equal(r.next.id, 'start');
  assert.equal(r.next.daysNeeded, 3);                    // 7 от нужните 10
  assert.equal(r.next.progress, 70);
});

await check('движение: награда само когато е част от целта; над препоръчаното — предупреждение, не награда', async () => {
  const fit = run(history(21, () => day(3, 9000)), { activity: { reward: true, maxPct: null } });
  assert.equal(fit.activity.days, 21);
  assert.ok(fit.milestones.some((m) => m.id === 'active:21'));
  // кърмене (по-малко движение е целта): 170% → денят не се брои, без точки и етапи за движение
  const nursing = run(history(21, () => day(3, 13600)), { activity: { reward: false, maxPct: 140 } });
  assert.equal(nursing.points.earned, 0);
  assert.equal(nursing.streak, 0);
  assert.ok(nursing.activity.tooMuch.length > 0);
  assert.ok(nursing.milestones.every((m) => m.kind !== 'active'));
  // в нормата — броят се, но без награда за движение
  const calm = run(history(14, () => day(3, 7000)), { activity: { reward: false, maxPct: 140 } });
  assert.equal(calm.tier.id, 'start');
  assert.equal(calm.activity.days, 0);
});

await check('ден, който се брои: лично спазване ≥ 80% (day-adherence.js) + без твърдите нарушения', async () => {
  const T = key(T0);
  const st = (rec, policy) => RE.dayStatus(rec, calcDayScore(rec, T), policy, RE.adherenceOf(DayAdh, rec, T, key(T0 + DAY), policy));
  assert.equal(st(day(3)).ok, true);                                          // всичко спазено — 100%
  // всички хранения, но лош сън, без вода и напрегнат ден: старото правило би го броило
  const weak = { ...day(3), morningCheck: { sleptWell: false, level: 'bad' }, eveningCheck: { waterIntake: false, activityLevel: 3, emotionalBalance: 1 } };
  assert.equal(RE.dayStatus(weak, calcDayScore(weak, T)).ok, true);
  const s1 = st(weak);
  assert.equal(s1.ok, false);
  assert.deepEqual(s1.why, ['plan']);
  assert.ok(s1.plan < RE.ADH_MIN);
  // само лош сън: за обичайния профил минава, за човек с тежест на съня — не
  const sleepy = { ...day(3), morningCheck: { sleptWell: false, level: 'bad' } };
  assert.equal(st(sleepy).ok, true);
  assert.equal(st(sleepy, { weights: { meal: 25, cal: 10, junk: 10, act: 10, sleep: 25, water: 10, mood: 10 } }).ok, false);
  // твърдото нарушение сваля деня и при високо спазване
  const junk = { ...day(3), extraMeals: [{ isJunk: true, calories: 120 }] };
  assert.ok(st(junk).why.includes('junk'));
  // +5 точки за изцяло изпълнен ден — по спазването
  const full = run(history(3, () => day(3)), { adherence: DayAdh });
  assert.equal(full.points.days[full.todayKey], 20);                         // 10 + 5 (изцяло) + 5 (движение)
  const part = run(history(3, () => sleepy), { adherence: DayAdh });
  assert.equal(part.points.days[part.todayKey], 15);                         // под 90% — без +5
});

await check('сървърът: личните тежести от телефона се пазят само ако са смислени', async () => {
  const nowW = Date.UTC(2026, 10, 14, 12);
  const U = 'fb_userWEIGHT1';
  kv.set(`game_state:${U}`, JSON.stringify({ gameData: range('2026-11-01', '2026-11-14', () => day(3)) }));
  const good = { reward: true, maxPct: null, group: 'lose', weights: { meal: 31, cal: 20, junk: 10, act: 10, sleep: 12, water: 7, mood: 10 } };
  await handleRewards(req({ userId: U, idToken: 'ok', todayKey: '2026-11-14', activity: good }), env, deps(nowW));
  const rec = JSON.parse(kv.get(`rewards:${U}`));
  assert.deepEqual(rec.activity.weights, good.weights);
  assert.equal(rec.activity.group, 'lose');
  await handleRewards(req({ userId: U, idToken: 'ok', todayKey: '2026-11-14', activity: { reward: true, maxPct: null, group: 'x', weights: { meal: 500 } } }), env, deps(nowW));
  const rec2 = JSON.parse(kv.get(`rewards:${U}`));
  assert.equal(rec2.activity.weights, undefined);
  assert.equal(rec2.activity.group, undefined);
});

console.log(`\nВсички ${checks.length} проверки минаха`);
