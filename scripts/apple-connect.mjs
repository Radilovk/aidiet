#!/usr/bin/env node
/**
 * App Store Connect API from GitHub Actions (studio-app-apple.yml), with the owner's API key kept in GitHub secrets.
 *
 *   node scripts/apple-connect.mjs check       is the key valid? lists the apps of the account
 *   node scripts/apple-connect.mjs bundle-id   registers the app's Bundle ID (appId in studio-app/capacitor.config.json)
 *   node scripts/apple-connect.mjs status      the app, its versions and builds (state of each)
 *   node scripts/apple-connect.mjs certs       the distribution certificates and App Store profiles of the account
 *   node scripts/apple-connect.mjs metadata    fills the store page (texts, URLs, category, age rating, free price, review notes, newest build)
 *   node scripts/apple-connect.mjs screenshots uploads studio-app/store/*.png (1290x2796) as the iPhone screenshots of version 1.0
 *   node scripts/apple-connect.mjs delete-cert <id>   deletes one certificate (e.g. a leftover of a failed run)
 *
 * Env: APPSTORE_KEY_ID, APPSTORE_ISSUER_ID, APPSTORE_KEY_P8 (the text of AuthKey_XXXX.p8). Nothing secret is printed.
 */
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

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
    // why a build is invalid: the upload record and the build's own state
    try {
      const ups = await api('GET', `/v1/apps/${app.id}/buildUploads?limit=5`);
      for (const u of ups.data) {
        console.log(`  качване ${u.attributes.cfBundleShortVersionString}(${u.attributes.cfBundleVersion}) — ${JSON.stringify(u.attributes.state)}`);
      }
    } catch (e) { console.log(`  (качванията не се четат: ${String(e.message).slice(0, 200)})`); }
    for (const b of builds.data.slice(0, 2)) {
      try {
        const d = await api('GET', `/v1/builds/${b.id}?include=buildBundles,buildBetaDetail`);
        for (const x of d.included || []) console.log(`  build ${b.attributes.version} · ${x.type} ${JSON.stringify(x.attributes).slice(0, 500)}`);
      } catch (e) { console.log(`  (build ${b.attributes.version}: ${String(e.message).slice(0, 200)})`); }
    }
  } else if (action === 'certs') {
    const certs = await api('GET', '/v1/certificates?limit=50&fields[certificates]=name,certificateType,displayName,serialNumber,expirationDate');
    console.log(certs.data.length ? 'Сертификати:' : 'Няма сертификати.');
    for (const c of certs.data) console.log(`  • ${c.id} · ${c.attributes.certificateType} · ${c.attributes.displayName || c.attributes.name} · до ${c.attributes.expirationDate}`);
    const profs = await api('GET', '/v1/profiles?limit=50&fields[profiles]=name,profileType,profileState,expirationDate');
    console.log(profs.data.length ? 'Профили:' : 'Няма профили.');
    for (const p of profs.data) console.log(`  • ${p.id} · ${p.attributes.profileType} · ${p.attributes.name} · ${p.attributes.profileState}`);
  } else if (action === 'metadata') {
    const app = (await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`)).data[0];
    if (!app) fail('Няма приложение в App Store Connect (направи „New App“).');
    const locale = app.attributes.primaryLocale || 'en-US';
    const step = async (name, fn) => { try { const r = await fn(); console.log(`✓ ${name}${r ? ` — ${r}` : ''}`); } catch (e) { console.log(`✗ ${name}: ${String(e.message).slice(0, 400)}`); } };
    const T = {
      subtitle: 'Appointments and reminders',
      promo: 'Book your studio appointment in seconds and get a reminder on your phone.',
      description: 'Book an appointment at your studio in seconds. Enter the code your studio gave you and you will see only your studio: its free days and hours — only really free hours are shown. The app reminds you a few hours before your appointment with a notification on your phone (works offline), and in “My appointments” you can move or cancel it. The app is in Bulgarian. You can delete your data at any time.',
      keywords: 'booking,appointment,studio,training,fitness,reservation,reminder,schedule',
      support: 'https://biocode.website/studio-support.html',
      privacy: 'https://biocode.website/studio-privacy.html',
      notes: [
        'The app has no accounts or logins. It is a booking utility for fitness/EMS studios: studios are added by the operator;',
        'a client picks a studio and books an appointment that takes place ON SITE at the studio (a physical service — payment is',
        'made in person, Guideline 3.1.3(e); no In-App Purchase is used and nothing digital is sold).',
        '',
        'How to test (all labels are in Bulgarian):',
        '1. Open the app. Choose "Demo Studio" in the list (or type the code "demo" and tap "Отвори").',
        '2. Tap any day marked with a dot, then tap one or more free hours (e.g. 10:00). A bar at the bottom appears: tap "Запази".',
        '3. Enter any name and phone number (e.g. "Test User", "0888123456"), tick the terms checkbox, tap "Запази ... час".',
        '4. The app asks to allow notifications (the app is fully usable if you decline). Allow them.',
        '   The appointment now shows under "Моите часове". The app schedules ONE local reminder on the device a few hours',
        '   before the appointment (not a push notification; no data leaves the device for this). This is a native capability',
        '   a website cannot provide.',
        '5. "Моите часове" -> "Промени" -> "Премести в друг час" / "Откажи часа" to move or cancel.',
        '6. "Моите часове" -> "Изтрий данните ми" deletes the user\'s data (Guideline 5.1.1(v)).',
        'Privacy policy and support: links at the bottom of the main screen ("Помощ и контакт", "Поверителност").',
        'No tracking, no ads, no analytics. The only notifications are reminders for the user\'s own booked appointments.',
        'The studios\' own admin tools are web-only and are not part of this app.',
        'Contact: radilov.k@gmail.com',
      ].join('\n'),
    };
    await step('съдържание от трети страни (права)', async () => { await api('PATCH', `/v1/apps/${app.id}`, { data: { type: 'apps', id: app.id, attributes: { contentRightsDeclaration: 'USES_THIRD_PARTY_CONTENT' } } }); });
    // app info: categories, subtitle, privacy URL, age rating
    const infos = (await api('GET', `/v1/apps/${app.id}/appInfos`)).data;
    const info = infos.find((i) => !/READY_FOR_SALE|REMOVED/.test(i.attributes.appStoreState || '')) || infos[0];
    await step('категории', async () => { await api('PATCH', `/v1/appInfos/${info.id}`, { data: { type: 'appInfos', id: info.id, relationships: {
      primaryCategory: { data: { type: 'appCategories', id: 'HEALTH_AND_FITNESS' } }, secondaryCategory: { data: { type: 'appCategories', id: 'LIFESTYLE' } } } } }); });
    await step('подзаглавие и политика за поверителност', async () => {
      const locs = (await api('GET', `/v1/appInfos/${info.id}/appInfoLocalizations`)).data;
      const loc = locs.find((l) => l.attributes.locale === locale) || locs[0];
      await api('PATCH', `/v1/appInfoLocalizations/${loc.id}`, { data: { type: 'appInfoLocalizations', id: loc.id, attributes: { subtitle: T.subtitle, privacyPolicyUrl: T.privacy } } });
    });
    await step('възрастов рейтинг (всичко „няма“)', async () => {
      const ar = (await api('GET', `/v1/appInfos/${info.id}/ageRatingDeclaration`)).data;
      const none = ['alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gamblingSimulated', 'horrorOrFearThemes', 'matureOrSuggestiveThemes', 'medicalOrTreatmentInformation',
        'profanityOrCrudeHumor', 'sexualContentGraphicAndNudity', 'sexualContentOrNudity', 'violenceCartoonOrFantasy', 'violenceRealistic', 'violenceRealisticProlongedGraphicOrSadistic'];
      const no = ['gambling', 'unrestrictedWebAccess', 'lootBox', 'messagingAndChat', 'parentalControls', 'ageAssurance', 'advertising', 'userGeneratedContent', 'healthOrWellnessTopics'];
      const attributes = {}; none.forEach((k) => { attributes[k] = 'NONE'; }); no.forEach((k) => { attributes[k] = false; });
      // Apple adds required questions over time: whatever it reports as missing is answered "no"
      for (let i = 0; i < 12; i++) {
        try { await api('PATCH', `/v1/ageRatingDeclarations/${ar.id}`, { data: { type: 'ageRatingDeclarations', id: ar.id, attributes } }); return; }
        catch (e) {
          const named = [...String(e.message).matchAll(/attribute '(\w+)'/g)].map((m) => m[1]);
          if (!named.length) throw e;
          let changed = false;
          for (const k of named) {   // new question -> "no"; a question that wants a level instead of yes/no -> "NONE"
            const next = k in attributes ? (typeof attributes[k] === 'boolean' ? 'NONE' : attributes[k]) : false;
            if (next !== attributes[k]) { attributes[k] = next; changed = true; }
          }
          if (!changed) throw e;
        }
      }
    });
    await step('цена: безплатно', async () => {
      const pts = (await api('GET', `/v1/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=200`)).data;
      const free = pts.find((p) => Number(p.attributes.customerPrice) === 0);
      if (!free) throw new Error('няма безплатна ценова точка');
      await api('POST', '/v1/appPriceSchedules', { data: { type: 'appPriceSchedules', relationships: {
        app: { data: { type: 'apps', id: app.id } }, baseTerritory: { data: { type: 'territories', id: 'USA' } }, manualPrices: { data: [{ type: 'appPrices', id: '${p1}' }] } } },
        included: [{ type: 'appPrices', id: '${p1}', attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: 'appPricePoints', id: free.id } } } }] });
    });
    // version: texts, build, review notes
    const vers = (await api('GET', `/v1/apps/${app.id}/appStoreVersions?limit=10`)).data;
    const ver = vers.find((v) => /PREPARE_FOR_SUBMISSION|DEVELOPER_REJECTED|REJECTED/.test(v.attributes.appStoreState || v.attributes.appVersionState || '')) || vers[0];
    if (!ver) fail('Няма версия за подготвяне.');
    console.log(`Версия ${ver.attributes.versionString} (${ver.attributes.appStoreState || ver.attributes.appVersionState})`);
    await step('описание, ключови думи, поддръжка', async () => {
      const locs = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)).data;
      const loc = locs.find((l) => l.attributes.locale === locale) || locs[0];
      await api('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, { data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: {
        description: T.description, keywords: T.keywords, promotionalText: T.promo, supportUrl: T.support, marketingUrl: 'https://biocode.website/studio-support.html' } } });
    });
    await step('най-новият готов build към версията', async () => {
      const builds = (await api('GET', `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=5`)).data;
      const b = builds.find((x) => x.attributes.processingState === 'VALID' && !x.attributes.expired);
      if (!b) throw new Error('още няма обработен build (изчакай обработката в Apple)');
      await api('PATCH', `/v1/appStoreVersions/${ver.id}/relationships/build`, { data: { type: 'builds', id: b.id } });
      return `build ${b.attributes.version}`;
    });
    await step('бележки за ревюиращия', async () => {
      let rd; try { rd = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`)).data; } catch (_) { rd = null; }
      // contact of the person Apple may call: GitHub secret REVIEW_CONTACT = "First|Last|+359...|email" (the repo is public)
      const [cf, cl, cp, ce] = String(process.env.REVIEW_CONTACT || '').split('|').map((x) => x.trim());
      const contact = cf && cl && cp && ce ? { contactFirstName: cf, contactLastName: cl, contactPhone: cp, contactEmail: ce } : {};
      if (!contact.contactEmail && rd && !rd.attributes.contactEmail) throw new Error('липсва секрет REVIEW_CONTACT (Име|Фамилия|телефон|имейл)');
      if (rd) await api('PATCH', `/v1/appStoreReviewDetails/${rd.id}`, { data: { type: 'appStoreReviewDetails', id: rd.id, attributes: { notes: T.notes, demoAccountRequired: false, ...contact } } });
      else await api('POST', '/v1/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes: { notes: T.notes, demoAccountRequired: false, ...contact },
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } } } });
    });
    console.log('\nОстава (само ти, в App Store Connect): App Privacy въпросник, DSA (не съм търговец), контакт за ревюто (име, телефон), скрийншоти.');
  } else if (action === 'testflight') {
    // an internal TestFlight group with every team member who may test (their Apple ID gets the TestFlight invitation)
    const app = (await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`)).data[0];
    if (!app) fail('Няма приложение в App Store Connect.');
    const groups = (await api('GET', `/v1/apps/${app.id}/betaGroups?limit=50`)).data;
    let g = groups.find((x) => x.attributes.isInternalGroup);
    if (!g) {
      g = (await api('POST', '/v1/betaGroups', { data: { type: 'betaGroups', attributes: { name: 'Вътрешни тестери', isInternalGroup: true, hasAccessToAllBuilds: true },
        relationships: { app: { data: { type: 'apps', id: app.id } } } } })).data;
      console.log('✓ вътрешна група „Вътрешни тестери“ (всички build-ове)');
    } else console.log(`✓ групата „${g.attributes.name}“ вече има`);
    const users = (await api('GET', '/v1/users?limit=50')).data.filter((u) => (u.attributes.roles || []).some((r) => ['ADMIN', 'ACCOUNT_HOLDER', 'APP_MANAGER', 'DEVELOPER'].includes(r)));
    for (const u of users) {
      const em = u.attributes.username;
      try {
        await api('POST', '/v1/betaTesters', { data: { type: 'betaTesters', attributes: { email: em, firstName: u.attributes.firstName, lastName: u.attributes.lastName },
          relationships: { betaGroups: { data: [{ type: 'betaGroups', id: g.id }] } } } });
        console.log(`✓ тестер: ${u.attributes.firstName} ${u.attributes.lastName} (${em.replace(/^(.).*(@.*)$/, '$1***$2')})`);
      } catch (e) { console.log(`• ${em.replace(/^(.).*(@.*)$/, '$1***$2')}: ${String(e.message).slice(0, 160)}`); }
    }
  } else if (action === 'screenshots') {
    const app = (await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`)).data[0];
    if (!app) fail('Няма приложение в App Store Connect.');
    const vers = (await api('GET', `/v1/apps/${app.id}/appStoreVersions?limit=10`)).data;
    const ver = vers.find((v) => /PREPARE_FOR_SUBMISSION|DEVELOPER_REJECTED|REJECTED/.test(v.attributes.appStoreState || '')) || vers[0];
    const locs = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)).data;
    const loc = locs.find((l) => l.attributes.locale === (app.attributes.primaryLocale || 'en-US')) || locs[0];
    const type = 'APP_IPHONE_67';
    const sets = (await api('GET', `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data;
    let set = sets.find((x) => x.attributes.screenshotDisplayType === type);
    if (!set) set = (await api('POST', '/v1/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: type },
      relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } } } })).data;
    for (const old of (await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots`)).data) await api('DELETE', `/v1/appScreenshots/${old.id}`);
    const dir = new URL('../studio-app/store/', import.meta.url);
    const files = readdirSync(dir).filter((f) => /^\d.*\.png$/.test(f)).sort();
    for (const f of files) {
      const buf = readFileSync(new URL(f, dir));
      const sh = await api('POST', '/v1/appScreenshots', { data: { type: 'appScreenshots', attributes: { fileName: f, fileSize: buf.length },
        relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } } });
      for (const op of sh.data.attributes.uploadOperations) {
        const resp = await fetch(op.url, { method: op.method, headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])), body: buf.subarray(op.offset, op.offset + op.length) });
        if (!resp.ok) throw new Error(`качване на ${f}: ${resp.status}`);
      }
      await api('PATCH', `/v1/appScreenshots/${sh.data.id}`, { data: { type: 'appScreenshots', id: sh.data.id, attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(buf).digest('hex') } } });
      console.log(`✓ ${f}`);
    }
    console.log(`Качени ${files.length} скрийншота (${type}).`);
  } else if (action === 'delete-cert') {
    const id = String(process.argv[3] || '').trim();
    if (!/^[A-Z0-9]{6,20}$/.test(id)) fail('Дай id на сертификат (от действието certs).');
    await api('DELETE', `/v1/certificates/${id}`);
    console.log(`✓ Изтрит сертификат ${id}`);
  } else {
    fail('действие: check | bundle-id | status | certs | metadata | testflight | screenshots | delete-cert');
  }
} catch (e) {
  fail(String(e.message).slice(0, 600));
}
