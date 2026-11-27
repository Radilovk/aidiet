#!/usr/bin/env node
/**
 * Signing for the App Store without any registered device (the "automatic" way needs one): a distribution certificate
 * and an App Store provisioning profile are made through the App Store Connect API for THIS run, installed into a
 * temporary keychain, and deleted again at the end — nothing is kept and no private key is stored anywhere.
 * Run on the macOS runner of studio-app-ios.yml:
 *
 *   node scripts/apple-signing.mjs prepare    certificate + profile; writes PROFILE_NAME, PROFILE_UUID to $GITHUB_ENV
 *   node scripts/apple-signing.mjs cleanup    deletes the certificate and the profile of a run that did not upload; after a
 *                                             successful upload (KEEP_CERT=1) they stay — Apple re-checks the signature
 *                                             minutes later and a revoked certificate makes the build Invalid (ITMS-90035)
 *
 * Env: APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_KEY_P8, APPLE_TEAM_ID. The key needs the Admin role.
 */
import { createPrivateKey, sign, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { APPSTORE_KEY_ID: KEY_ID, APPSTORE_ISSUER_ID: ISSUER, APPSTORE_KEY_P8: P8, APPLE_TEAM_ID: TEAM } = process.env;
// APP_CONFIG: Capacitor конфигурацията на приложението, от корена на репото (по подразбиране — студиото; Nutriin:
// capacitor.config.json). Профилите са с името на приложението, за да чисти всяко само своите.
const cfg = JSON.parse(readFileSync(new URL(`../${process.env.APP_CONFIG || 'studio-app/capacitor.config.json'}`, import.meta.url), 'utf8'));
const BUNDLE = cfg.appId;
const LABEL = cfg.appName;                      // XB-Studio | Nutriin
const PREFIX = `${LABEL} AppStore `;
const TMP = process.env.RUNNER_TEMP || '/tmp';
const STATE = join(TMP, 'apple-signing.json');
const KEYCHAIN = join(TMP, `${LABEL.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-build.keychain-db`);

const fail = (m) => { console.error(`::error::${m}`); process.exit(1); };
if (!KEY_ID || !ISSUER || !P8 || !TEAM) fail('Липсват секрети: APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_KEY_P8, APPLE_TEAM_ID.');

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

const [action] = process.argv.slice(2);
try {
  if (action === 'prepare') {
    const dir = join(TMP, 'signing'); mkdirSync(dir, { recursive: true });
    // 0. certificates/profiles kept by earlier successful uploads are no longer needed (those builds are processed)
    // Акаунтът има един сертификат за разпространение наведнъж, а двете приложения (XB-Studio и Nutriin) го правят
    // тук през CI: на всяко пускане се чистят сертификатите от CI на ДВЕТЕ. Чуждият — само ако е по-стар от час
    // (дотогава Apple е обработила качването му; сертификатът е за една година → възрастта е от expirationDate).
    const CI_PROFILE = /^(XB-Studio|Nutriin) AppStore /;
    const HOUR = 3600 * 1000;
    const profs = await api('GET', '/v1/profiles?filter[profileType]=IOS_APP_STORE&limit=100');
    for (const pr of profs.data.filter((x) => CI_PROFILE.test(x.attributes.name))) {
      const own = pr.attributes.name.startsWith(PREFIX);
      let certs = [];
      try { certs = (await api('GET', `/v1/profiles/${pr.id}/certificates`)).data; } catch (_) { /* profile without certificates */ }
      if (!own) {
        const ages = certs.map((c) => Date.now() - (Date.parse(c.attributes.expirationDate) - 365 * 24 * HOUR));
        if (ages.some((a) => !(a > HOUR))) { console.log(`… „${pr.attributes.name}“ е от последния час — остава`); continue; }
      }
      try { await api('DELETE', `/v1/profiles/${pr.id}`); } catch (e) { console.log(`! профил ${pr.id}: ${e.message.slice(0, 150)}`); }
      for (const c of certs) { try { await api('DELETE', `/v1/certificates/${c.id}`); console.log(`✓ изтрит стар сертификат ${c.id}${own ? '' : ' (от другото приложение)'}`); } catch (e) { console.log(`! ${c.id}: ${e.message.slice(0, 150)}`); } }
    }
    const left = (await api('GET', '/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50')).data.length;
    if (left >= 3) fail(`В акаунта вече има ${left} дистрибуционни сертификата (границата е 3). Виж ги с Apple → certs и изтрий излишните.`);
    // 1. a key and a signing request (the key never leaves this runner)
    run('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'req.csr'),
      '-subj', `/CN=${LABEL} CI/O=${LABEL}/C=BG`]);
    // 2. the distribution certificate
    let cert;
    try {
      cert = await api('POST', '/v1/certificates', { data: { type: 'certificates', attributes: {
        certificateType: 'DISTRIBUTION', csrContent: readFileSync(join(dir, 'req.csr'), 'utf8') } } });
    } catch (e) {
      if (!/409/.test(e.message)) throw e;
      const all = (await api('GET', '/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50')).data;
      fail('В акаунта вече има сертификат за разпространение, който CI не е правил (или е от последния час): '
        + all.map((c) => `${c.id} (${c.attributes.displayName || c.attributes.name}, до ${c.attributes.expirationDate})`).join('; ')
        + '. Пусни пак след час, или го изтрий с Apple → delete-cert (приложенията в App Store не се засягат).');
    }
    writeFileSync(STATE, JSON.stringify({ certId: cert.data.id }));   // from now on a failure still cleans up the certificate
    writeFileSync(join(dir, 'cert.cer'), Buffer.from(cert.data.attributes.certificateContent, 'base64'));
    run('openssl', ['x509', '-inform', 'der', '-in', join(dir, 'cert.cer'), '-out', join(dir, 'cert.pem')]);
    const pw = randomBytes(12).toString('hex');
    // an old, widely readable format (OpenSSL 3's default one fails in macOS "security import": MAC verification failed)
    run('openssl', ['pkcs12', '-export', '-inkey', join(dir, 'key.pem'), '-in', join(dir, 'cert.pem'), '-out', join(dir, 'cert.p12'),
      '-passout', `pass:${pw}`, '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1']);
    // 3. a temporary keychain with it
    run('security', ['create-keychain', '-p', pw, KEYCHAIN]);
    run('security', ['set-keychain-settings', '-lut', '7200', KEYCHAIN]);
    run('security', ['unlock-keychain', '-p', pw, KEYCHAIN]);
    run('security', ['import', join(dir, 'cert.p12'), '-k', KEYCHAIN, '-P', pw, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
    run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', pw, KEYCHAIN]);
    const list = run('security', ['list-keychains', '-d', 'user']).split('\n').map((l) => l.trim().replace(/"/g, '')).filter(Boolean);
    run('security', ['list-keychains', '-d', 'user', '-s', KEYCHAIN, ...list]);
    // 4. the App Store profile of this app
    const bid = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE)}&limit=5`);
    const bundle = bid.data.find((b) => b.attributes.identifier === BUNDLE);
    if (!bundle) fail(`Няма Bundle ID ${BUNDLE} (пусни Apple → bundle-id).`);
    const name = `${PREFIX}${process.env.GITHUB_RUN_ID || Date.now()}`;
    let prof;
    prof = await api('POST', '/v1/profiles', { data: { type: 'profiles', attributes: { name, profileType: 'IOS_APP_STORE' },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } }, certificates: { data: [{ type: 'certificates', id: cert.data.id }] } } } });
    const pdir = join(homedir(), 'Library/MobileDevice/Provisioning Profiles'); mkdirSync(pdir, { recursive: true });
    const uuid = prof.data.attributes.uuid;
    writeFileSync(join(pdir, `${uuid}.mobileprovision`), Buffer.from(prof.data.attributes.profileContent, 'base64'));
    writeFileSync(STATE, JSON.stringify({ certId: cert.data.id, profileId: prof.data.id }));
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `PROFILE_NAME=${name}\nPROFILE_UUID=${uuid}\nSIGN_KEYCHAIN=${KEYCHAIN}\n`);
    console.log(`✓ сертификат ${cert.data.attributes.displayName || cert.data.id} и профил „${name}“ (${uuid})`);
  } else if (action === 'cleanup') {
    if (!existsSync(STATE)) { console.log('Няма какво да се чисти.'); process.exit(0); }
    if (process.env.KEEP_CERT) { console.log('Качването мина: сертификатът и профилът остават, докато Apple обработи build-а; следващото пускане ги чисти.'); process.exit(0); }
    const st = JSON.parse(readFileSync(STATE, 'utf8'));
    for (const [what, path] of [['профил', st.profileId && `/v1/profiles/${st.profileId}`], ['сертификат', st.certId && `/v1/certificates/${st.certId}`]].filter((x) => x[1])) {
      try { await api('DELETE', path); console.log(`✓ изтрит ${what}`); } catch (e) { console.log(`! ${what} не се изтри: ${e.message}`); }
    }
  } else {
    fail('действие: prepare | cleanup');
  }
} catch (e) {
  fail(String(e.message).slice(0, 700));
}
