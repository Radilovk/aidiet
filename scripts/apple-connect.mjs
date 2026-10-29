#!/usr/bin/env node
/**
 * App Store Connect API from GitHub Actions (studio-app-apple.yml), with the owner's API key kept in GitHub secrets.
 *
 *   node scripts/apple-connect.mjs check       is the key valid? lists the apps of the account
 *   node scripts/apple-connect.mjs bundle-id   registers the app's Bundle ID (appId in studio-app/capacitor.config.json)
 *   node scripts/apple-connect.mjs status      the app, its versions and builds (state of each)
 *
 * Env: APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_KEY_P8 (the text of AuthKey_XXXX.p8). Nothing secret is printed.
 */
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const { APPSTORE_KEY_ID: KEY_ID, APPSTORE_ISSUER_ID: ISSUER, APPSTORE_KEY_P8: P8 } = process.env;
const cfg = JSON.parse(readFileSync(new URL('../studio-app/capacitor.config.json', import.meta.url), 'utf8'));
const BUNDLE = cfg.appId;
const APP_NAME = cfg.appName;

function fail(msg) { console.error(`::error::${msg}`); process.exit(1); }
if (!KEY_ID || !ISSUER || !P8) fail('Липсват GitHub секрети: APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_KEY_P8 (виж studio-app/README.md, стъпка 3).');

const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  const key = createPrivateKey({ key: P8.replace(/\\n/g, '\n'), format: 'pem' });
  return `${head}.${body}.${b64u(sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }))}`;
}

async function api(method, path, body) {
  const resp = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text.slice(0, 300) }; }
  if (!resp.ok) {
    const why = (data.errors || []).map((e) => `${e.code || ''} ${e.title || ''}: ${e.detail || ''}`.trim()).join(' | ') || data.raw || '';
    const err = new Error(`${method} ${path} → ${resp.status} ${why}`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

const [action] = process.argv.slice(2);
try {
  if (action === 'check') {
    const r = await api('GET', '/v1/apps?limit=20&fields[apps]=name,bundleId,sku');
    console.log('✓ Ключът работи.');
    console.log(r.data.length ? r.data.map((a) => `  • ${a.attributes.name} (${a.attributes.bundleId})`).join('\n') : '  (още няма приложения в акаунта)');
  } else if (action === 'bundle-id') {
    const found = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE)}&limit=5`);
    const hit = found.data.find((b) => b.attributes.identifier === BUNDLE);
    if (hit) {
      console.log(`✓ Bundle ID ${BUNDLE} вече е регистриран (${hit.attributes.name}).`);
    } else {
      const made = await api('POST', '/v1/bundleIds', { data: { type: 'bundleIds', attributes: { identifier: BUNDLE, name: 'XB Studio', platform: 'IOS' } } });
      console.log(`✓ Регистрирах Bundle ID ${made.data.attributes.identifier}.`);
    }
    console.log(`\nСледваща стъпка (само ти): App Store Connect → My Apps → + → New App: платформа iOS, име „${APP_NAME}“, език Bulgarian, Bundle ID ${BUNDLE}, SKU xb-studio-1.`);
  } else if (action === 'status') {
    const apps = await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`);
    const app = apps.data[0];
    if (!app) { console.log(`Още няма приложение с Bundle ID ${BUNDLE} (направи „New App“ в App Store Connect).`); process.exit(0); }
    console.log(`Приложение: ${app.attributes.name} (id ${app.id})`);
    const vers = await api('GET', `/v1/apps/${app.id}/appStoreVersions?limit=10`);
    for (const v of vers.data) console.log(`  версия ${v.attributes.versionString} — ${v.attributes.appStoreState || v.attributes.appVersionState}`);
    const builds = await api('GET', `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=5`);
    for (const b of builds.data) console.log(`  build ${b.attributes.version} — ${b.attributes.processingState}${b.attributes.expired ? ' (изтекъл)' : ''}`);
    if (!builds.data.length) console.log('  (още няма качен build)');
  } else {
    fail('действие: check | bundle-id | status');
  }
} catch (e) {
  fail(String(e.message).slice(0, 600));
}
