#!/usr/bin/env node
/** Прегледът на плановете от Claude (plan-review.js) — опашка, присъда, корекции, прилагане. Без мрежа. */
import assert from 'node:assert/strict';
import { handleReviewQueue, handleReviewSubmit, handleReviewGet, handleReviewApply, maybeFireReview, reviewOnPending } from '../plan-review.js';

const kv = new Map();
const env = { page_content: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => kv.delete(k) } };
const respond = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
const post = (b) => new Request('https://w/x', { method: 'POST', body: JSON.stringify(b) });
const json = async (r) => ({ status: r.status, d: await r.json() });
const plan = () => ({ analysis: { targetCalories: 1800 }, weekPlan: { day1: { meals: [{ name: 'Овесена каша', calories: 400 }, { name: 'Скариди с ориз', calories: 600 }] } } });
const put = (id, c) => kv.set(`client:${id}`, JSON.stringify(c));
kv.set('clients_list', JSON.stringify(['c1', 'c2', 'c3']));
put('c1', { id: 'c1', answers: { name: 'Ана', allergies: 'ракообразни' }, plan: plan(), planStatus: 'pending', planUpdatedAt: '2026-11-17T10:00:00Z' });
put('c2', { id: 'c2', answers: { name: 'Боби' }, plan: plan(), planStatus: 'activated', planUpdatedAt: '2026-11-16T10:00:00Z' });
put('c3', { id: 'c3', answers: { name: 'Вера' }, plan: plan(), planStatus: 'pending', planUpdatedAt: '2026-11-17T11:00:00Z' });

const opts = { respond, reconcile: async (p) => { p.summary = { recomputed: true }; } };
const ok = [];
const check = async (n, f) => { await f(); ok.push(n); console.log('✅', n); };

await check('опашка: само чакащите одобрение, с указанията за прегледа', async () => {
  const { d } = await json(await handleReviewQueue(env, { respond }));
  assert.deepEqual(d.items.map((i) => i.clientId), ['c1', 'c3']);
  assert.match(d.guide, /ПРОВЕРИ ОБСТОЙНО/);
});
await check('присъда „fix“ с корекция: прилага се върху копие, сумите се пресмятат, оригиналът стои', async () => {
  const r = await json(await handleReviewSubmit(post({
    clientId: 'c1', planUpdatedAt: '2026-11-17T10:00:00Z', verdict: 'fix', summary: 'Скариди при алергия към ракообразни.',
    findings: [{ severity: 'critical', where: 'ден 1, обяд', issue: 'Скариди — алерген', fix: 'Пилешко с ориз' }],
    patches: [{ op: 'replace', path: '/plan/weekPlan/day1/meals/1', value: { name: 'Пилешко с ориз', calories: 600 } }],
  }), env, opts));
  assert.equal(r.status, 200); assert.equal(r.d.corrected, true);
  const rev = JSON.parse(kv.get('plan_review:c1'));
  assert.equal(rev.correctedPlan.weekPlan.day1.meals[1].name, 'Пилешко с ориз');
  assert.equal(rev.correctedPlan.summary.recomputed, true);
  assert.equal(JSON.parse(kv.get('client:c1')).plan.weekPlan.day1.meals[1].name, 'Скариди с ориз');
  assert.equal(rev.findings[0].severity, 'critical');   // прегледът е в админа (хъбът за одобрение)
});
await check('прегледаният вариант излиза от опашката', async () => {
  const { d } = await json(await handleReviewQueue(env, { respond }));
  assert.deepEqual(d.items.map((i) => i.clientId), ['c3']);
});
await check('корекции извън /plan и счупени пътища → 400 с обяснение', async () => {
  const base = { clientId: 'c3', planUpdatedAt: '2026-11-17T11:00:00Z', verdict: 'fix', summary: 's' };
  assert.equal((await handleReviewSubmit(post({ ...base, patches: [{ op: 'replace', path: '/answers/name', value: 'x' }] }), env, opts)).status, 400);
  const bad = await json(await handleReviewSubmit(post({ ...base, patches: [{ op: 'replace', path: '/plan/weekPlan/day9/meals/0/name', value: 'x' }] }), env, opts));
  assert.equal(bad.status, 400); assert.match(bad.d.message, /не се приложиха/);
});
await check('сменен план след опашката → 409 stale; невалидна присъда → 400', async () => {
  assert.equal((await handleReviewSubmit(post({ clientId: 'c3', planUpdatedAt: 'old', verdict: 'ok', summary: 's' }), env, opts)).status, 409);
  assert.equal((await handleReviewSubmit(post({ clientId: 'c3', planUpdatedAt: '2026-11-17T11:00:00Z', verdict: 'maybe' }), env, opts)).status, 400);
  assert.equal((await handleReviewSubmit(post({ clientId: 'c2', planUpdatedAt: '2026-11-16T10:00:00Z', verdict: 'ok' }), env, opts)).status, 409);
});
await check('„Приложи корекциите“: коригираният план става текущ, остава за одобрение, не влиза пак в опашката', async () => {
  const r = await json(await handleReviewApply(post({ clientId: 'c1' }), env, { respond, now: Date.parse('2026-11-17T12:00:00Z') }));
  assert.equal(r.status, 200);
  const c = JSON.parse(kv.get('client:c1'));
  assert.equal(c.plan.weekPlan.day1.meals[1].name, 'Пилешко с ориз'); assert.equal(c.planStatus, 'pending');
  const { d } = await json(await handleReviewQueue(env, { respond }));
  assert.ok(!d.items.some((i) => i.clientId === 'c1'));
  const g = await json(await handleReviewGet(new URL('https://w/x?clientId=c1'), env, { respond }));
  assert.equal(g.d.review.applied, true);
});
await check('прилагане без корекции → 400', async () => {
  await handleReviewSubmit(post({ clientId: 'c3', planUpdatedAt: '2026-11-17T11:00:00Z', verdict: 'ok', summary: 'Чист план.' }), env, opts);
  assert.equal((await handleReviewApply(post({ clientId: 'c3' }), env, { respond })).status, 400);
});
// ── Таймерът: пуска прегледа само при неразгледан план ──
const fires = [];
const fakeFetch = async (url, init) => { fires.push({ url, init }); return new Response('{}', { status: 200 }); };
await check('таймер: без токен — нищо; без неразгледан план — без пускане', async () => {
  assert.equal(await maybeFireReview(env, { fetchImpl: fakeFetch }), 'off');
  env.CLAUDE_REVIEW_TOKEN = 'sk-ant-oat01-test';
  assert.equal(await maybeFireReview(env, { fetchImpl: fakeFetch }), 'none');   // c1 и c3 са прегледани
  assert.equal(fires.length, 0);
});
await check('нов план (таймер) → едно пускане с токена и beta заглавието; същият план — не пак', async () => {
  put('c4', { id: 'c4', answers: { name: 'Гери' }, plan: plan(), planStatus: 'pending', planUpdatedAt: '2026-11-17T13:00:00Z' });
  kv.set('clients_list', JSON.stringify(['c4', 'c1', 'c2', 'c3']));
  const t = Date.parse('2026-11-17T13:05:00Z');
  assert.equal(await maybeFireReview(env, { fetchImpl: fakeFetch, now: t }), 'fired');
  assert.match(fires[0].url, /\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/);
  assert.equal(fires[0].init.headers.Authorization, 'Bearer sk-ant-oat01-test');
  assert.equal(fires[0].init.headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
  assert.equal(await maybeFireReview(env, { fetchImpl: fakeFetch, now: t + 30 * 60e3 }), 'same');
  assert.equal(fires.length, 1);
});
await check('неразгледан и след 3 часа → нов опит; прегледан → без пускане', async () => {
  const t = Date.parse('2026-11-17T16:10:00Z');
  assert.equal(await maybeFireReview(env, { fetchImpl: fakeFetch, now: t }), 'fired');
  await handleReviewSubmit(post({ clientId: 'c4', planUpdatedAt: '2026-11-17T13:00:00Z', verdict: 'ok', summary: 'ok' }), env, opts);
  assert.equal(await maybeFireReview(env, { fetchImpl: fakeFetch, now: t + 4 * 3600e3 }), 'none');
});
await check('грешка от API-то → не се отбелязва като пуснато (опит при следващия таймер)', async () => {
  put('c5', { id: 'c5', answers: { name: 'Деси' }, plan: plan(), planStatus: 'pending', planUpdatedAt: '2026-11-17T17:00:00Z' });
  kv.set('clients_list', JSON.stringify(['c5', 'c4']));
  const bad = async () => new Response('{}', { status: 401 });
  const t = Date.parse('2026-11-17T21:00:00Z');
  assert.equal(await maybeFireReview(env, { fetchImpl: bad, now: t }), 'error');
  assert.equal(await maybeFireReview(env, { fetchImpl: fakeFetch, now: t }), 'fired');
});

// ── При запис: всеки план, постъпил за одобрение, отива веднага на преглед ──
const client = (id, at, status = 'pending') => ({ id, answers: { name: id }, plan: plan(), planStatus: status, planUpdatedAt: at });
await check('постъпил план → веднага пускане; повторен запис на същия вариант — нищо', async () => {
  const n = fires.length;
  const t = Date.parse('2026-11-18T09:00:00Z');
  assert.equal(await reviewOnPending(env, 'p1', client('p1', '2026-11-18T08:59:00Z'), { fetchImpl: fakeFetch, now: t }), 'fired');
  assert.equal(fires.length, n + 1);
  assert.equal(await reviewOnPending(env, 'p1', client('p1', '2026-11-18T08:59:00Z'), { fetchImpl: fakeFetch, now: t + 60e3 }), 'same');
  assert.equal(fires.length, n + 1);
});
await check('активиран план или без токен → нищо', async () => {
  assert.equal(await reviewOnPending(env, 'p9', client('p9', 'x', 'activated'), { fetchImpl: fakeFetch }), 'skip');
  assert.equal(await reviewOnPending({ page_content: env.page_content }, 'p9', client('p9', 'x'), { fetchImpl: fakeFetch }), 'off');
});
await check('втори план по време на сесията → изчаква прозореца; таймерът го пуска след него', async () => {
  const n = fires.length;
  const t = Date.parse('2026-11-18T09:05:00Z');
  put('p2', client('p2', '2026-11-18T09:04:00Z'));
  kv.set('clients_list', JSON.stringify(['p2']));
  assert.equal(await reviewOnPending(env, 'p2', client('p2', '2026-11-18T09:04:00Z'), { fetchImpl: fakeFetch, now: t }), 'later');
  assert.equal(await maybeFireReview(env, { fetchImpl: fakeFetch, now: t + 5 * 60e3 }), 'later');
  assert.equal(await maybeFireReview(env, { fetchImpl: fakeFetch, now: t + 16 * 60e3 }), 'fired');
  assert.equal(fires.length, n + 1);
  assert.equal(await reviewOnPending(env, 'p2', client('p2', '2026-11-18T09:04:00Z'), { fetchImpl: fakeFetch, now: t + 20 * 60e3 }), 'same');
});
await check('прегледан вариант → нищо; нов вариант на същия клиент (смяна на плана) → нов преглед', async () => {
  const t = Date.parse('2026-11-18T12:00:00Z');
  kv.set('plan_review:p3', JSON.stringify({ planUpdatedAt: '2026-11-18T11:00:00Z' }));
  assert.equal(await reviewOnPending(env, 'p3', client('p3', '2026-11-18T11:00:00Z'), { fetchImpl: fakeFetch, now: t }), 'reviewed');
  assert.equal(await reviewOnPending(env, 'p3', client('p3', '2026-11-18T11:55:00Z'), { fetchImpl: fakeFetch, now: t }), 'fired');
});

console.log(`\nВсички ${ok.length} проверки минаха`);
