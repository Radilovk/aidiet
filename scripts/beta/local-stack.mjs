/**
 * Локален стек за бета-теста: страниците от корена + истинският worker (worker.entry.js) в Node.
 * База (KV) и опашка в паметта, тестови Firebase токени (собствен RSA ключ вместо Google), всяка
 * външна заявка на сървъра е спряна — без AI, имейли, плащания и без живата среда.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PROJECT_ID = 'nutriplan-c460a';
export const ADMIN_SECRET = 'beta-admin-secret';
const KID = 'beta-test-key';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml' };

/** KV в паметта (get/put/delete/list като Cloudflare). */
export function memoryKV() {
  const store = new Map();
  return {
    store,
    async get(k, t) {
      const e = store.get(k); if (!e) return null;
      if (e.exp && e.exp < Date.now()) { store.delete(k); return null; }
      const type = typeof t === 'string' ? t : t?.type;
      return type === 'json' ? JSON.parse(e.v) : e.v;
    },
    async getWithMetadata(k, t) { return { value: await this.get(k, t), metadata: store.get(k)?.meta ?? null }; },
    async put(k, v, o = {}) { store.set(k, { v: typeof v === 'string' ? v : JSON.stringify(v), meta: o.metadata, exp: o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 }); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name, metadata: store.get(name)?.meta }));
      return { keys, list_complete: true, cursor: '' };
    },
  };
}

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }

export async function startStack({ port = 0 } = {}) {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  const blocked = [];

  // Сървърът не излиза навън: JWKS → нашият ключ, всичко друго → 503 (записва се за отчета).
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/securetoken')) {
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) return realFetch(input, init);
    blocked.push(url.split('?')[0]);
    return new Response(JSON.stringify({ error: 'beta: външните заявки са спрени' }), { status: 503, headers: { 'content-type': 'application/json' } });
  };

  // Cache API на Cloudflare — в паметта (worker-ът кешира дневниците и JWKS там).
  if (!globalThis.caches) {
    const mem = new Map();
    const cache = { async match(r) { const v = mem.get(typeof r === 'string' ? r : r.url); return v ? v.clone() : undefined; },
      async put(r, resp) { mem.set(typeof r === 'string' ? r : r.url, resp.clone()); }, async delete(r) { return mem.delete(typeof r === 'string' ? r : r.url); } };
    globalThis.caches = { default: cache, async open() { return cache; } };
  }
  // Заключването „планът е в редакция“ (PLAN_EDITING_LOCK_ENABLED) пуска само един клиент — тестът го заобикаля.
  globalThis.__EATOLOGIX_BETA_UNLOCK = true;
  const worker = (await import(path.join(ROOT, 'worker.entry.js'))).default;
  const kv = memoryKV();
  const pending = [];
  const env = {
    page_content: kv, FIREBASE_PROJECT_ID: PROJECT_ID, ADMIN_SECRET,
    PLAN_QUEUE: {
      async send(body) {
        // Опашката: задачата тръгва веднага след отговора, както в Cloudflare.
        const job = (async () => {
          await new Promise((r) => setTimeout(r, 30));
          const msg = { body, id: String(Math.random()), attempts: 1, ack() {}, retry() {} };
          try { await worker.queue({ messages: [msg], queue: 'beta' }, env, ctx); } catch (e) { console.error('[beta queue]', e?.message); }
        })();
        pending.push(job);
      },
    },
  };
  const ctx = { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };

  async function signToken({ uid, email, name = 'Beta Tester' }) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
    const body = b64url(JSON.stringify({ sub: uid, user_id: uid, email, name, aud: PROJECT_ID, iss: `https://securetoken.google.com/${PROJECT_ID}`, iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'password' } }));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(sig)}`;
  }

  // Заглавки до 128 KB — като Cloudflare (бисквитките на приложението стигат ~32 KB, виж отчета).
  const server = http.createServer({ maxHeaderSize: 131072 }, async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/__beta/token') {
        const tok = await signToken({ uid: url.searchParams.get('uid'), email: url.searchParams.get('email') });
        res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end(tok); return;
      }
      if (url.pathname.startsWith('/__worker/')) {
        const chunks = []; for await (const c of req) chunks.push(c);
        const target = 'https://aidiet.radilov-k.workers.dev/' + url.pathname.slice('/__worker/'.length) + url.search;
        const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && k !== 'host') headers.set(k, v);
        if (!headers.get('cf-connecting-ip')) headers.set('cf-connecting-ip', '10.0.0.' + (1 + Math.floor(Math.random() * 250)));
        if (process.env.BETA_DEBUG && /auth\/social/.test(target)) console.log('[beta debug]', req.method, req.headers['content-type'], Buffer.concat(chunks).toString().slice(0, 80));
        const r = await worker.fetch(new Request(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env, ctx);
        const out = Buffer.from(await r.arrayBuffer());
        if (process.env.BETA_DEBUG) console.log('[beta api]', req.method, url.pathname.slice(9) + url.search.slice(0, 60), headers.get('authorization') ? 'auth' : 'noauth', r.status, out.toString().slice(0, 160).replace(/\s+/g, ' '));
        const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
        res.writeHead(r.status, h); res.end(out); return;
      }
      let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await readFile(file));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e?.stack || e));
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, env, kv, worker, blocked, signToken,
    async idle() { while (pending.length) await pending.shift(); },
    async admin(pathname, body) {
      const r = await worker.fetch(new Request('https://aidiet.radilov-k.workers.dev' + pathname, {
        method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET, 'cf-connecting-ip': '10.0.1.1' }, body: body ? JSON.stringify(body) : undefined,
      }), env, ctx);
      return { status: r.status, data: await r.json().catch(() => null) };
    },
    close() { globalThis.fetch = realFetch; return new Promise((r) => server.close(r)); },
  };
}
