#!/usr/bin/env node
/** Пощата на Nutriin (email-domain.js): мостът с еднократен код, регистрацията в Resend и смяната на подателя. Без мрежа. */
import assert from 'node:assert/strict';
import { handleEmailDomain, emailEnvelope, EMAIL_FROM_OLD, EMAIL_FROM_NEW, EMAIL_FROM_PREV } from '../email-domain.js';

const kv = new Map();
const env = { RESEND_API_KEY: 'test', page_content: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v), delete: async (k) => kv.delete(k) } };
const respond = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
const domains = [];
let verifiedAfter = 2;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const m = init.method || 'GET';
  const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  if (u.pathname === '/domains' && m === 'GET') return j({ data: domains });
  if (u.pathname === '/domains' && m === 'POST') { const d = { id: 'dom1', name: JSON.parse(init.body).name, status: 'not_started' }; domains.push(d); return j(d); }
  if (u.pathname === '/domains/dom1/verify') { if (--verifiedAfter <= 0) domains[0].status = 'verified'; return j({ object: 'domain' }); }
  if (u.pathname === '/domains/dom1') return j({ ...domains[0], records: [
    { record: 'DKIM', type: 'TXT', name: 'resend._domainkey', value: 'p=ABC', status: 'pending' },
    { record: 'SPF', type: 'MX', name: 'send', value: 'feedback-smtp.eu-west-1.amazonses.com', priority: 10, status: 'pending' },
    { record: 'SPF', type: 'TXT', name: 'send', value: 'v=spf1 include:amazonses.com ~all', status: 'pending' }] });
  return j({}, 404);
};
const call = (action, nonce) => handleEmailDomain(new Request('https://w/api/system/email-domain', { method: 'POST', headers: nonce ? { 'X-Bridge-Nonce': nonce } : {}, body: JSON.stringify({ action }) }), env, { respond });

let n = 0; const ok = async (name, f) => { await f(); n++; console.log('✅', name); };
await ok('без код или с грешен код → отказ', async () => {
  assert.equal((await call('setup')).status, 403);
  kv.set('bridge_nonce:email_domain', 'abc');
  assert.equal((await call('setup', 'xyz')).status, 403);
});
await ok('setup: регистрира домейна веднъж и връща DNS записите', async () => {
  const r = await (await call('setup', 'abc')).json();
  assert.equal(r.id, 'dom1'); assert.equal(r.records.length, 3);
  assert.equal(domains.length, 1); assert.equal(domains[0].name, 'nutriin.app');
  await call('setup', 'abc'); assert.equal(domains.length, 1);
});
await ok('докато не е потвърден — подателят и връзките са старите', async () => {
  const e = await emailEnvelope(env, '<a href="https://biocode.website/plan.html">x</a>');
  assert.equal(e.from, EMAIL_FROM_OLD); assert.match(e.html, /biocode\.website/);
});
await ok('преход: потвърден е само eatologix.com — пощата е оттам, с подател Nutriin', async () => {
  kv.set('email_domain_verified', JSON.stringify({ domain: 'eatologix.com', at: '2026-11-18T02:13:00Z' }));
  const { emailDomainVerified } = await import('../email-domain.js');
  await emailDomainVerified(env, Date.now() + 700000);   // изчиства кеша
  const e = await emailEnvelope(env, '<a href="https://biocode.website/plan.html">x</a>');
  assert.equal(e.from, EMAIL_FROM_PREV); assert.match(e.from, /^Nutriin </); assert.match(e.html, /https:\/\/eatologix\.com\/plan\.html/);
  kv.delete('email_domain_verified'); await emailDomainVerified(env, Date.now() + 1400000);
});
await ok('verify: след потвърждение — флаг в KV, подателят и връзките минават на nutriin.app', async () => {
  assert.equal((await (await call('verify', 'abc')).json()).status, 'not_started');
  assert.equal((await (await call('verify', 'abc')).json()).status, 'verified');
  assert.ok(kv.get('email_domain_verified'));
  const e = await emailEnvelope(env, '<img src="https://biocode.website/brand/x.png"><a href="https://biocode.website/plan.html">x</a>');
  const { emailDomainVerified } = await import('../email-domain.js'); await emailDomainVerified(env, Date.now() + 2100000);
  const e2 = await emailEnvelope(env, '<img src="https://biocode.website/brand/x.png"><a href="https://biocode.website/plan.html">x</a>');
  assert.equal(e2.from, EMAIL_FROM_NEW); assert.doesNotMatch(e2.html, /biocode\.website/); assert.match(e2.html, /https:\/\/nutriin\.app\/plan\.html/);
});
console.log(`\nВсички ${n} проверки минаха`);
