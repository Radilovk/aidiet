#!/usr/bin/env node
/** Обновяването отвътре на iPhone (app-bundle.js): избор на пакет по версия на приложението, спиране, кеш. Без мрежа. */
import assert from 'node:assert/strict';
import { handleWebBundle, bundlesFromReleases, versionAtLeast } from '../app-bundle.js';

const sha = 'a'.repeat(64);
const rel = (v, min, extra = {}) => ({ tag_name: `ios-web-${v}`, prerelease: true, body: JSON.stringify({ version: String(v), sha256: sha, minAppVersion: min }), assets: [{ name: `nutriin-web-${v}.zip`, browser_download_url: `https://x/${v}.zip` }], ...extra });
const releases = [rel(300, '1.1.0'), rel(200, '1.0.0'), rel(100, '1.0.0'), { tag_name: 'v-build926-abc', body: 'APK', assets: [{ name: 'NutriPlan.apk' }] }, rel(400, '1.0.0', { draft: true }), { tag_name: 'ios-web-500', body: 'не е JSON', assets: [] }];

let ok = 0;
const check = async (name, fn) => { await fn(); ok++; console.log('✅', name); };
const respond = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
let fetched = 0;
globalThis.fetch = async () => { fetched++; return new Response(JSON.stringify(releases)); };
const kv = new Map();
const env = { page_content: { get: async (k) => kv.get(k) ?? null } };
const ask = async (q) => (await handleWebBundle(new Request(`https://w/api/app/web-bundle?${q}`), env, { respond })).json();

await check('версии: 1.1.0 ≥ 1.0.0, 1.0 ≥ 1.0.0, 1.0.9 < 1.1', async () => {
  assert.ok(versionAtLeast('1.1.0', '1.0.0')); assert.ok(versionAtLeast('1.0', '1.0.0')); assert.ok(!versionAtLeast('1.0.9', '1.1'));
});
await check('само ios-web издания с валидно тяло и zip; без чернови; най-новото първо', async () => {
  assert.deepEqual(bundlesFromReleases(releases).map((b) => b.version), ['300', '200', '100']);
});
await check('приложение 1.0.0 → най-новият съвместим (200); 1.1.0 → 300', async () => {
  assert.equal((await ask('platform=ios&app=1.0.0')).version, '200');
  assert.equal((await ask('platform=ios&app=1.1.0')).version, '300');
  assert.equal((await ask('platform=ios&app=1.1.0')).sha256, sha);
});
await check('Android / без платформа → нищо', async () => {
  assert.deepEqual(await ask('platform=android&app=1.0.0'), {});
});
await check('спрени обновявания (KV app_web_bundle_paused) → нищо', async () => {
  kv.set('app_web_bundle_paused', '1');
  assert.deepEqual(await ask('platform=ios&app=1.0.0'), {});
  kv.delete('app_web_bundle_paused');
});
console.log(`\nВсички ${ok} проверки минаха (заявки към GitHub: ${fetched})`);
