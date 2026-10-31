#!/usr/bin/env node
/**
 * Изтриване на собствения профил (POST /api/user/delete-account) срещу бандъла.
 * Подписва Firebase ID токен с локален ключ (JWKS се подменя), пуска worker.js
 * върху KV в паметта и проверява: изтрива се всичко на потребителя, чуждо не се
 * пипа, без валиден токен — 401. Плюс: админското изтриване остава строго.
 *
 *   npm run test:account-deletion   (след npm run build:worker)
 */
import { webcrypto as crypto } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const PROJECT = 'nutriplan-test';
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
async function token(uid, email) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ sub: uid, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, iat: now - 5, exp: now + 3600, email }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
const calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push(u);
  if (u.includes('securetoken@system.gserviceaccount.com')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  return new Response('blocked', { status: 599 });
};
function kv(seed) {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    m,
    async get(k, o) { const v = m.get(k); if (v == null) return null; const t = typeof o === 'string' ? o : o?.type; return t === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    async list() { return { keys: [...m.keys()].map(name => ({ name })), list_complete: true }; },
  };
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { default: worker } = await import(pathToFileURL(join(root, 'worker.js')).href);
const seed = () => ({
  clients_list: ['c1', 'c2', 'c3'],
  'client:c1': { userId: 'fb_uid123', answers: { email: 'a@b.c' } },
  'client:c2': { userId: 'fb_other', answers: { email: 'x@y.z' } },
  'client:c3': { userId: 'anon_1', answers: { email: 'a@b.c' } },
  'user_profile:fb_uid123': { userId: 'fb_uid123', clientId: 'c1' },
  'user_profile:fb_other': { userId: 'fb_other', clientId: 'c2' },
  'email_index:a@b.c': { clientId: 'c1', userId: 'fb_uid123' },
  'game_state:fb_uid123': { x: 1 },
  'link:fb_uid123:fitbit': { t: 1 },
  'push_subscription_fb_uid123': { e: 1 },
  'notification_preferences_fb_uid123': { a: 1 },
  'auth:uid123': { u: 1 },
  push_subscriptions_list: ['fb_uid123', 'fb_other'],
});
const ctx = { waitUntil() {}, passThroughOnException() {} };
let fails = 0;
const ok = (c, msg) => { console.log((c ? '✅ ' : '❌ ') + msg); if (!c) fails++; };
const req = (t) => new Request('https://w.test/api/user/delete-account', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: '{}' });

// 1. собственият профил
{
  const env = { page_content: kv(seed()), FIREBASE_PROJECT_ID: PROJECT };
  const res = await worker.fetch(req(await token('uid123', 'a@b.c')), env, ctx);
  const body = await res.json();
  const m = env.page_content.m;
  ok(res.status === 200 && body.success, `собствен профил → 200 (${res.status} ${JSON.stringify(body)})`);
  ok(!m.has('client:c1') && !m.has('user_profile:fb_uid123'), 'клиентът и профилът са изтрити');
  ok(!m.has('game_state:fb_uid123') && !m.has('link:fb_uid123:fitbit') && !m.has('auth:uid123'), 'игра, връзка с устройство и вход са изтрити');
  ok(!m.has('push_subscription_fb_uid123') && !m.has('notification_preferences_fb_uid123'), 'известията са изтрити');
  ok(!m.has('email_index:a@b.c'), 'имейл индексът е изтрит');
  ok(JSON.parse(m.get('clients_list')).join() === 'c2,c3', 'clients_list без c1');
  ok(JSON.parse(m.get('push_subscriptions_list')).join() === 'fb_other', 'push списъкът без потребителя');
  ok(m.has('client:c2') && m.has('user_profile:fb_other') && m.has('client:c3'), 'чуждите записи са непокътнати');
  ok(body.deletedFirebaseAuth === false, 'без сервизен акаунт входът се трие от клиента (deletedFirebaseAuth=false)');
}
// 2. друг потребител със същия имейл не трие чуждия запис
{
  const env = { page_content: kv(seed()), FIREBASE_PROJECT_ID: PROJECT };
  const res = await worker.fetch(req(await token('evil', 'a@b.c')), env, ctx);
  const m = env.page_content.m;
  ok(res.status === 200, 'чужд токен със същия имейл → 200 (трие само своето)');
  ok(m.has('client:c1') && m.has('user_profile:fb_uid123') && m.has('email_index:a@b.c'), 'записите на fb_uid123 са непокътнати');
}
// 3. без токен / с невалиден токен
{
  const env = { page_content: kv(seed()), FIREBASE_PROJECT_ID: PROJECT };
  const r1 = await worker.fetch(req(null), env, ctx);
  const r2 = await worker.fetch(req('a.b.c'), env, ctx);
  ok(r1.status === 401 && r2.status === 401, `без токен / невалиден → 401 (${r1.status}, ${r2.status})`);
  ok(env.page_content.m.has('client:c1'), 'нищо не е изтрито');
}
// 4. GET не е маршрут за изтриване
{
  const env = { page_content: kv(seed()), FIREBASE_PROJECT_ID: PROJECT };
  const r = await worker.fetch(new Request('https://w.test/api/user/delete-account'), env, ctx);
  ok(r.status !== 200 || env.page_content.m.has('client:c1'), `GET не трие (${r.status})`);
}
// 5. админското изтриване: без сервизен акаунт спира, без да трие
{
  const env = { page_content: kv(seed()), FIREBASE_PROJECT_ID: PROJECT, ADMIN_SECRET: 's3cret' };
  const r = await worker.fetch(new Request('https://w.test/api/admin/delete-clients', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 's3cret' }, body: JSON.stringify({ clientIds: ['c2'] }) }), env, ctx);
  ok(r.status === 500 && env.page_content.m.has('client:c2'), `админ без сервизен акаунт → 500 и нищо изтрито (${r.status})`);
}
// 6. админското изтриване на анонимен клиент (без вход)
{
  const env = { page_content: kv(seed()), FIREBASE_PROJECT_ID: PROJECT, ADMIN_SECRET: 's3cret' };
  const r = await worker.fetch(new Request('https://w.test/api/admin/delete-clients', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 's3cret' }, body: JSON.stringify({ clientIds: ['c3'] }) }), env, ctx);
  const body = await r.json();
  const m = env.page_content.m;
  ok(r.status === 200 && body.deletedClientCount === 1 && !m.has('client:c3'), `админ трие анонимен клиент (${r.status})`);
  ok(m.has('email_index:a@b.c') && m.has('client:c1'), 'имейл индексът на друг клиент със същия имейл остава');
}
console.log(fails ? `\n${fails} неуспешни` : '\nВсички проверки минаха');
process.exit(fails ? 1 : 0);
