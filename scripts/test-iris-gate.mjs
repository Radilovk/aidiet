#!/usr/bin/env node
/** Защитата на IrisMap (iris-gate.js) и предпазителят на разхода (spend.js) — без мрежа. */
import assert from 'node:assert/strict';
import { handleIrisTicket, handleIrisGemini } from '../iris-gate.js';
import { costUsd, addSpend, dailySpend, budgetOk, BUDGET_KEY } from '../spend.js';

const kv = new Map();
const env = {
  GEMINI_API_KEY: 'k',
  page_content: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => kv.delete(k) },
};
const respond = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
const ticketReq = (deviceId, ip = '1.1.1.1') => new Request('https://w/api/iris/ticket', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify({ deviceId }) });
let geminiCalls = 0;
globalThis.fetch = async () => { geminiCalls++; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }], usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 1000, thoughtsTokenCount: 500 } })); };
const gem = (ticket, model = 'gemini-3.8-flash') => handleIrisGemini(new Request(`https://w/api/iris/gemini/v1beta/models/${model}:generateContent`, { method: 'POST', headers: ticket ? { 'X-Iris-Ticket': ticket } : {}, body: '{}' }), env, new URL(`https://w/api/iris/gemini/v1beta/models/${model}:generateContent`));

const ok = [];
const check = async (n, f) => { await f(); ok.push(n); console.log('✅', n); };

await check('без билет → отказ, нищо не стига до Gemini', async () => {
  const r = await gem(''); assert.equal(r.status, 403); assert.equal(geminiCalls, 0);
  const r2 = await gem('abcdefghijklmnopqrstuvwx'); assert.equal(r2.status, 403);
});
let ticket;
await check('първи анализ на устройството → билет за 24 заявки', async () => {
  const d = await (await handleIrisTicket(ticketReq('dev_aaaaaaaa'), env, { respond })).json();
  assert.ok(d.ticket); assert.equal(d.calls, 24); ticket = d.ticket;
});
await check('билетът пропуска до 24 заявки, после спира', async () => {
  for (let i = 0; i < 24; i++) assert.equal((await gem(ticket)).status, 200);
  assert.equal((await gem(ticket)).status, 403);
  assert.equal(geminiCalls, 24);
});
await check('непозволен модел → отказ', async () => {
  const d = await (await handleIrisTicket(ticketReq('dev_cccccccc', '9.9.9.9'), env, { respond })).json();
  assert.equal((await gem(d.ticket, 'gemini-3.1-pro-preview')).status, 404);
});
await check('същото устройство до 7 дни → отказ „веднъж на седмица“', async () => {
  const r = await handleIrisTicket(ticketReq('dev_aaaaaaaa'), env, { respond });
  assert.equal(r.status, 429); assert.equal((await r.json()).error, 'weekly');
});
await check('провален анализ (малко използвани заявки) → нов опит без да губи седмицата', async () => {
  const d1 = await (await handleIrisTicket(ticketReq('dev_failfail', '5.5.5.5'), env, { respond })).json();
  await gem(d1.ticket); await gem(d1.ticket);   // 2 заявки и грешка
  assert.equal((await handleIrisTicket(ticketReq('dev_failfail', '5.5.5.5'), env, { respond })).status, 200);
});
await check('от един IP — до 3 безплатни анализа на ден', async () => {
  const ip = '2.2.2.2';
  for (const d of ['dev_x1xxxxxx', 'dev_x2xxxxxx', 'dev_x3xxxxxx']) assert.equal((await handleIrisTicket(ticketReq(d, ip), env, { respond })).status, 200);
  const r = await handleIrisTicket(ticketReq('dev_x4xxxxxx', ip), env, { respond });
  assert.equal(r.status, 429); assert.equal((await r.json()).error, 'ip');
});
await check('платен кредит (контролно разчитане) минава покрай седмичния лимит', async () => {
  kv.set('iris_credit:dev_aaaaaaaa', '1');
  assert.equal((await handleIrisTicket(ticketReq('dev_aaaaaaaa', '3.3.3.3'), env, { respond })).status, 200);
  assert.equal(kv.get('iris_credit:dev_aaaaaaaa'), '0');
});
await check('разходът се брои по токените от отговора', async () => {
  const spent = await dailySpend(env, Date.now() + 60_000);
  const one = costUsd('gemini-3.8-flash', { promptTokenCount: 4000, candidatesTokenCount: 1000, thoughtsTokenCount: 500 });
  assert.ok(Math.abs(spent - one * geminiCalls) < 1e-6, `${spent} vs ${one * geminiCalls}`);
});
await check('над дневния таван: безплатният анализ спира, известие при 50% и 100%', async () => {
  kv.set(BUDGET_KEY, '1');
  const msgs = [];
  await addSpend(env, 2, { notify: async (t) => msgs.push(t), now: Date.now() + 120_000 });
  assert.equal(await budgetOk(env, 'free', Date.now() + 120_000), false);
  assert.equal(await budgetOk(env, 'paid'), true);
  assert.equal(msgs.length, 2);
  const r = await handleIrisTicket(ticketReq('dev_newnewne', '4.4.4.4'), env, { respond, now: Date.now() + 120_000 });
  assert.equal(r.status, 503); assert.equal((await r.json()).error, 'budget');
});
console.log(`\nВсички ${ok.length} проверки минаха`);
