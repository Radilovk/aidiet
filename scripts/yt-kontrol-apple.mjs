#!/usr/bin/env node
/**
 * YT Контрол – подписване и App Store Connect за TestFlight (копие на подхода от scripts/apple-signing.mjs на „Студио“,
 * но за отделно приложение и без да пипа нищо от „Студио“). Слага се в репото aidiet като scripts/yt-kontrol-apple.mjs
 * и се пуска от .github/workflows/yt-kontrol-ios.yml.
 *
 *   node scripts/yt-kontrol-apple.mjs bundle    регистрира Bundle ID (ако го няма) и проверява, че има приложение в App Store Connect
 *   node scripts/yt-kontrol-apple.mjs prepare   сертификат + App Store профил само за това пускане (временен keychain)
 *   node scripts/yt-kontrol-apple.mjs cleanup   изтрива ги, ако качването не е минало (след успешно – остават до следващото)
 *
 * Env: APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_KEY_P8, APPLE_TEAM_ID, BUNDLE_ID (по подразбиране com.biocode.ytkontrol).
 */
import { createPrivateKey, sign, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { APPSTORE_KEY_ID: KEY_ID, APPSTORE_ISSUER_ID: ISSUER, APPSTORE_KEY_P8: P8, APPLE_TEAM_ID: TEAM } = process.env;
const BUNDLE = process.env.BUNDLE_ID || 'com.biocode.ytkontrol';
const PREFIX = 'YTK AppStore ';            // отделно име – чистенето на „Студио“ (XB-Studio …) не ги пипа и обратно
const TMP = process.env.RUNNER_TEMP || '/tmp';
const STATE = join(TMP, 'ytk-signing.json');
const KEYCHAIN = join(TMP, 'ytk-build.keychain-db');

const fail = (m) => { console.error(`::error::${m}`); process.exit(1); };
if (!KEY_ID || !ISSUER || !P8) fail('Липсват секрети: APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_KEY_P8.');

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
    method, headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text.slice(0, 300) }; }
  if (!resp.ok) {
    const why = (data.errors || []).map((e) => `${e.code || ''} ${e.title || ''}: ${e.detail || ''}`.trim()).join(' | ') || data.raw || '';
    throw new Error(`${method} ${path} → ${resp.status} ${why}`);
  }
  return data;
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });
const summary = (t) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, t + '\n'); console.log(t); };

const [action] = process.argv.slice(2);
try {
  if (action === 'bundle') {
    const found = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE)}&limit=5`);
    if (!found.data.find((b) => b.attributes.identifier === BUNDLE)) {
      await api('POST', '/v1/bundleIds', { data: { type: 'bundleIds', attributes: { identifier: BUNDLE, name: 'YT Kontrol', platform: 'IOS' } } });
      console.log(`✓ регистриран Bundle ID ${BUNDLE}`);
    } else console.log(`✓ Bundle ID ${BUNDLE} вече съществува`);
    const apps = await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`);
    if (!apps.data.length) {
      summary(`### Остава една стъпка (само веднъж)\nApp Store Connect → Приложения → **+** → **Ново приложение**: iOS, име „YT Контрол“ (или друго свободно), език Bulgarian, Bundle ID **${BUNDLE}**, SKU \`yt-kontrol-1\`. После пусни този работен процес отново.\n\nДотогава приложението само се сглобява и подписва (проверка), без качване.`);
      if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, 'APP_EXISTS=0\n');
      console.log(`::warning::Няма приложение с Bundle ID ${BUNDLE} в App Store Connect – само сглобяване, без качване.`);
      process.exit(0);
    }
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, 'APP_EXISTS=1\n');
    console.log(`✓ приложение в App Store Connect: ${apps.data[0].attributes.name}`);
  } else if (action === 'prepare') {
    if (!TEAM) fail('Липсва секрет APPLE_TEAM_ID.');
    const dir = join(TMP, 'ytk-signing'); mkdirSync(dir, { recursive: true });
    // 0. сертификатите/профилите от предишни успешни качвания на YT Контрол вече не трябват
    const profs = await api('GET', '/v1/profiles?filter[profileType]=IOS_APP_STORE&limit=100');
    for (const pr of profs.data.filter((x) => x.attributes.name.startsWith(PREFIX))) {
      let certs = [];
      try { certs = (await api('GET', `/v1/profiles/${pr.id}/certificates`)).data; } catch (_) { /* */ }
      try { await api('DELETE', `/v1/profiles/${pr.id}`); } catch (e) { console.log(`! профил ${pr.id}: ${e.message.slice(0, 150)}`); }
      for (const c of certs) { try { await api('DELETE', `/v1/certificates/${c.id}`); console.log(`✓ изтрит стар сертификат ${c.id}`); } catch (e) { console.log(`! ${c.id}: ${e.message.slice(0, 150)}`); } }
    }
    const left = (await api('GET', '/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50')).data.length;
    if (left >= 3) fail(`В акаунта вече има ${left} дистрибуционни сертификата (границата е 3). Изтрий излишен (Apple → certs / delete-cert).`);
    run('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'req.csr'),
      '-subj', '/CN=YT Kontrol CI/O=YT Kontrol/C=BG']);
    const cert = await api('POST', '/v1/certificates', { data: { type: 'certificates', attributes: {
      certificateType: 'DISTRIBUTION', csrContent: readFileSync(join(dir, 'req.csr'), 'utf8') } } });
    writeFileSync(STATE, JSON.stringify({ certId: cert.data.id }));
    writeFileSync(join(dir, 'cert.cer'), Buffer.from(cert.data.attributes.certificateContent, 'base64'));
    run('openssl', ['x509', '-inform', 'der', '-in', join(dir, 'cert.cer'), '-out', join(dir, 'cert.pem')]);
    const pw = randomBytes(12).toString('hex');
    run('openssl', ['pkcs12', '-export', '-inkey', join(dir, 'key.pem'), '-in', join(dir, 'cert.pem'), '-out', join(dir, 'cert.p12'),
      '-passout', `pass:${pw}`, '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1']);
    run('security', ['create-keychain', '-p', pw, KEYCHAIN]);
    run('security', ['set-keychain-settings', '-lut', '7200', KEYCHAIN]);
    run('security', ['unlock-keychain', '-p', pw, KEYCHAIN]);
    run('security', ['import', join(dir, 'cert.p12'), '-k', KEYCHAIN, '-P', pw, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
    run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', pw, KEYCHAIN]);
    const list = run('security', ['list-keychains', '-d', 'user']).split('\n').map((l) => l.trim().replace(/"/g, '')).filter(Boolean);
    run('security', ['list-keychains', '-d', 'user', '-s', KEYCHAIN, ...list]);
    const bid = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE)}&limit=5`);
    const bundle = bid.data.find((b) => b.attributes.identifier === BUNDLE);
    if (!bundle) fail(`Няма Bundle ID ${BUNDLE}.`);
    const name = `${PREFIX}${process.env.GITHUB_RUN_ID || Date.now()}`;
    const prof = await api('POST', '/v1/profiles', { data: { type: 'profiles', attributes: { name, profileType: 'IOS_APP_STORE' },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } }, certificates: { data: [{ type: 'certificates', id: cert.data.id }] } } } });
    const pdir = join(homedir(), 'Library/MobileDevice/Provisioning Profiles'); mkdirSync(pdir, { recursive: true });
    const uuid = prof.data.attributes.uuid;
    writeFileSync(join(pdir, `${uuid}.mobileprovision`), Buffer.from(prof.data.attributes.profileContent, 'base64'));
    writeFileSync(STATE, JSON.stringify({ certId: cert.data.id, profileId: prof.data.id }));
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `PROFILE_NAME=${name}\nPROFILE_UUID=${uuid}\nSIGN_KEYCHAIN=${KEYCHAIN}\n`);
    console.log(`✓ сертификат и профил „${name}“ (${uuid})`);
  } else if (action === 'cleanup') {
    if (!existsSync(STATE)) { console.log('Няма какво да се чисти.'); process.exit(0); }
    if (process.env.KEEP_CERT) { console.log('Качването мина: сертификатът и профилът остават до следващото пускане.'); process.exit(0); }
    const st = JSON.parse(readFileSync(STATE, 'utf8'));
    for (const [what, path] of [['профил', st.profileId && `/v1/profiles/${st.profileId}`], ['сертификат', st.certId && `/v1/certificates/${st.certId}`]].filter((x) => x[1])) {
      try { await api('DELETE', path); console.log(`✓ изтрит ${what}`); } catch (e) { console.log(`! ${what} не се изтри: ${e.message}`); }
    }
  } else {
    fail('действие: bundle | prepare | cleanup');
  }
} catch (e) {
  fail(String(e.message).slice(0, 700));
}
