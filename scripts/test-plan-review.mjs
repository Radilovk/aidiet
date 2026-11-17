#!/usr/bin/env node
/** Прегледът на новите планове от Claude (plan-review.js): опашка, присъда, промени с „преди/след“, прилагане. Без мрежа. */
import assert from 'node:assert/strict';
import { handleReviewGet, handleReviewApply, maybeFireReview, reviewOnPending, runPlanReview, REVIEW_MODEL, GUIDE } from '../plan-review.js';

const kv = new Map();
const queue = [];
const env = {
  ANTHROPIC_API_KEY: 'test',
  PLAN_QUEUE: { send: async (m) => { queue.push(m); } },
  page_content: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => kv.delete(k) },
};
const respond = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
const post = (b) => new Request('https://w/x', { method: 'POST', body: JSON.stringify(b) });
const json = async (r) => ({ status: r.status, d: await r.json() });
const plan = () => ({ analysis: { targetCalories: 1800 }, weekPlan: { day1: { meals: [{ name: 'Овесена каша', calories: 400 }, { name: 'Скариди с ориз', calories: 600 }] } }, _meta: { x: 1 } });
const client = (id, at, status = 'pending', extra = {}) => ({ id, answers: { name: id, allergies: 'ракообразни' }, plan: plan(), planStatus: status, planUpdatedAt: at, ...extra });
const put = (c) => kv.set(`client:${c.id}`, JSON.stringify(c));
const review = (id) => JSON.parse(kv.get(`plan_review:${id}`) || 'null');

/** Фалшив Claude: връща подадените отговори по ред и пази заявките. */
function fakeClaude(...answers) {
  const calls = [];
  return {
    calls,
    beta: { messages: { stream: (req) => {
      calls.push(req);
      const a = answers.shift();
      const message = typeof a === 'string'
        ? { model: REVIEW_MODEL, stop_reason: a, content: [], usage: { input_tokens: 10, output_tokens: 0 } }
        : { model: REVIEW_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(a) }], usage: { input_tokens: 20000, output_tokens: 5000, cache_read_input_tokens: 1000 } };
      return { finalMessage: async () => message };
    } } },
  };
}
const fixMeal = { op: 'replace', path: '/plan/weekPlan/day1/meals/1', value_json: JSON.stringify({ name: 'Пилешко с ориз', calories: 600 }), reason: 'Скариди при алергия към ракообразни.' };
const deps = (c, spent) => ({ client: c, reconcile: async (p) => { p.summary = { recomputed: true }; }, addSpend: async (usd) => spent.push(usd) });

const ok = [];
const check = async (n, f) => { await f(); ok.push(n); console.log('✅', n); };

await check('без ключ или без опашка → нищо', async () => {
  assert.equal(await reviewOnPending({ page_content: env.page_content, PLAN_QUEUE: env.PLAN_QUEUE }, 'a', client('a', 't')), 'off');
  assert.equal(await reviewOnPending({ ...env, PLAN_QUEUE: undefined }, 'a', client('a', 't')), 'off');
  assert.equal(await reviewOnPending(env, 'a', client('a', 't', 'activated')), 'skip');
});
await check('постъпил план → веднага в опашката; повторен запис на същия вариант — нищо', async () => {
  const t = Date.parse('2026-11-18T09:00:00Z');
  assert.equal(await reviewOnPending(env, 'c1', client('c1', 'v1'), { now: t }), 'queued');
  assert.deepEqual(queue.at(-1), { type: 'plan_review', jobId: 'review_c1', clientId: 'c1', planUpdatedAt: 'v1' });
  assert.equal(await reviewOnPending(env, 'c1', client('c1', 'v1'), { now: t + 60e3 }), 'same');
  assert.equal(queue.length, 1);
});
await check('прегледът: Opus 5.5, високо ниво, структуриран отговор, кеширани указания, резервен модел при отказ', async () => {
  put(client('c1', 'v1'));
  const fake = fakeClaude({ verdict: 'fix', summary: 'Скариди при алергия.', findings: [{ severity: 'critical', where: 'ден 1, обяд', issue: 'Скариди — алерген', fix: 'Пилешко с ориз' }], changes: [fixMeal] });
  const spent = [];
  assert.equal(await runPlanReview(env, { clientId: 'c1', planUpdatedAt: 'v1' }, deps(fake, spent)), 'fix');
  const req = fake.calls[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.output_config.effort, 'high');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.equal(req.fallbacks, 'default');
  assert.equal(req.system[0].text, GUIDE);
  assert.ok(req.system[0].cache_control);
  const input = JSON.parse(req.messages[0].content);
  assert.equal(input.answers.allergies, 'ракообразни');
  assert.equal(input.plan._meta, undefined);
  assert.ok(spent[0] > 0.17 && spent[0] < 0.19, `разход ${spent[0]}`);
});
await check('промените пазят „преди“, „след“ и причината; оригиналът стои; сумите са пресметнати', async () => {
  const r = review('c1');
  assert.equal(r.verdict, 'fix');
  assert.equal(r.changes[0].before.name, 'Скариди с ориз');
  assert.equal(r.changes[0].after.name, 'Пилешко с ориз');
  assert.match(r.changes[0].reason, /алергия/);
  assert.equal(r.correctedPlan.weekPlan.day1.meals[1].name, 'Пилешко с ориз');
  assert.equal(r.correctedPlan.summary.recomputed, true);
  assert.equal(JSON.parse(kv.get('client:c1')).plan.weekPlan.day1.meals[1].name, 'Скариди с ориз');
  assert.equal(r.findings[0].severity, 'critical');
});
await check('същият вариант не се преглежда втори път; сменен план → stale', async () => {
  assert.equal(await runPlanReview(env, { clientId: 'c1', planUpdatedAt: 'v1' }, deps(fakeClaude(), [])), 'reviewed');
  assert.equal(await runPlanReview(env, { clientId: 'c1', planUpdatedAt: 'old' }, deps(fakeClaude(), [])), 'stale');
});
await check('„Приложи корекциите“: коригираният план става текущ, старият остава в прегледа', async () => {
  const r = await json(await handleReviewApply(post({ clientId: 'c1' }), env, { respond, now: Date.parse('2026-11-18T12:00:00Z') }));
  assert.equal(r.status, 200);
  const c = JSON.parse(kv.get('client:c1'));
  assert.equal(c.plan.weekPlan.day1.meals[1].name, 'Пилешко с ориз'); assert.equal(c.planStatus, 'pending');
  const g = await json(await handleReviewGet(new URL('https://w/x?clientId=c1'), env, { respond }));
  assert.equal(g.d.review.applied, true);
  assert.equal(g.d.review.originalPlan.weekPlan.day1.meals[1].name, 'Скариди с ориз');
  assert.equal(await reviewOnPending(env, 'c1', c), 'reviewed');   // приложеното не тръгва на нов преглед
});
await check('грешен път в промените → един опит за поправка с грешката', async () => {
  put(client('c2', 'v1'));
  const bad = { ...fixMeal, path: '/plan/weekPlan/day9/meals/0' };
  const fake = fakeClaude({ verdict: 'fix', summary: 's', findings: [], changes: [bad] }, { verdict: 'fix', summary: 'поправено', findings: [], changes: [fixMeal] });
  assert.equal(await runPlanReview(env, { clientId: 'c2', planUpdatedAt: 'v1' }, deps(fake, [])), 'fix');
  assert.equal(fake.calls.length, 2);
  assert.match(fake.calls[1].messages.at(-1).content, /не се приложиха/);
  assert.equal(review('c2').changes[0].after.name, 'Пилешко с ориз');
});
await check('промени извън /plan или неуспешна поправка → „нужен човек“, без коригиран план', async () => {
  put(client('c3', 'v1'));
  const out = { ...fixMeal, path: '/answers/name' };
  const fake = fakeClaude({ verdict: 'fix', summary: 's', findings: [], changes: [out] }, { verdict: 'fix', summary: 's', findings: [], changes: [out] });
  assert.equal(await runPlanReview(env, { clientId: 'c3', planUpdatedAt: 'v1' }, deps(fake, [])), 'stop');
  assert.equal(review('c3').correctedPlan, null);
  assert.match(review('c3').summary, /не се приложиха/);
});
await check('отказ или прекъснат отговор → „нужен човек“ с обяснение', async () => {
  put(client('c4', 'v1'));
  assert.equal(await runPlanReview(env, { clientId: 'c4', planUpdatedAt: 'v1' }, deps(fakeClaude('refusal'), [])), 'stop');
  assert.match(review('c4').summary, /ръчна проверка/);
});
await check('чист план → „готов за одобрение“, без промени', async () => {
  put(client('c5', 'v1'));
  assert.equal(await runPlanReview(env, { clientId: 'c5', planUpdatedAt: 'v1' }, deps(fakeClaude({ verdict: 'ok', summary: 'Чист план.', findings: [], changes: [] }), [])), 'ok');
  assert.equal(review('c5').changes, null);
  assert.equal((await handleReviewApply(post({ clientId: 'c5' }), env, { respond })).status, 400);
});
await check('таймер (резерва): неразгледан план без пусната задача → в опашката; пуснат — не пак до 3 часа', async () => {
  queue.length = 0;
  put(client('c6', 'v1'));
  kv.set('clients_list', JSON.stringify(['c6', 'c5', 'c1']));
  const t = Date.parse('2026-11-18T13:00:00Z');
  assert.equal(await maybeFireReview(env, { now: t }), 'queued:1');
  assert.equal(queue.at(-1).clientId, 'c6');
  assert.equal(await maybeFireReview(env, { now: t + 30 * 60e3 }), 'same');
  assert.equal(await maybeFireReview(env, { now: t + 4 * 3600e3 }), 'queued:1');
  kv.set('plan_review:c6', JSON.stringify({ planUpdatedAt: 'v1' }));
  assert.equal(await maybeFireReview(env, { now: t + 9 * 3600e3 }), 'none');
});

console.log(`\nВсички ${ok.length} проверки минаха`);
