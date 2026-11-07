/**
 * Push notifications of the studio app (iOS, Apple's APNs, straight from the worker — no Firebase, no other service).
 *
 * Only for what the client must know at once and could not learn otherwise: the studio booked, canceled an hour for them,
 * or sends a word to the clients who have hours ahead (closed tomorrow, …). Never marketing (App Store 4.5.4).
 * The reminders of booked hours stay local on the phone (studio.html) — they work without the internet.
 *
 * Worker secrets (put by the deploy from the GitHub secrets of the same name, see deploy-worker.yml):
 *   APNS_KEY_P8  — the .p8 key from developer.apple.com → Keys → "Apple Push Notifications service (APNs)"
 *   APNS_KEY_ID  — its Key ID (10 characters)
 *   APNS_TEAM_ID — the Team ID
 * Without them nothing is sent and nothing breaks.
 */
const TOPIC = 'com.biocode.studios';
const HOST = 'https://api.push.apple.com';
export const PUSH_SOUND = 'studio.wav';   // in the app since 1.2; a phone without the file plays the default sound

export const pushReady = (env) => Boolean(env && env.APNS_KEY_P8 && env.APNS_KEY_ID && env.APNS_TEAM_ID);

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

let jwtMemo = { kid: '', at: 0, jwt: '' };
async function providerToken(env) {   // ES256, kept 50 min (Apple: refresh between 20 and 60 min)
  const now = Math.floor(Date.now() / 1000);
  if (jwtMemo.jwt && jwtMemo.kid === env.APNS_KEY_ID && now - jwtMemo.at < 3000) return jwtMemo.jwt;
  const pem = String(env.APNS_KEY_P8).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64urlText(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID }));
  const body = b64urlText(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`));
  jwtMemo = { kid: env.APNS_KEY_ID, at: now, jwt: `${head}.${body}.${b64url(sig)}` };
  return jwtMemo.jwt;
}

/** a device of a client: kept per studio + phone; one device may serve several studios */
export async function savePushToken(env, studioId, phone, token, on) {
  const t = String(token || '').toLowerCase();
  if (!/^[0-9a-f]{32,200}$/.test(t)) return false;
  if (on === false) {
    await env.STUDIO_DB.prepare('DELETE FROM push_tokens WHERE studio_id = ? AND token = ?').bind(studioId, t).run();
    return true;
  }
  await env.STUDIO_DB.prepare(
    `INSERT INTO push_tokens (studio_id, phone, token, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (studio_id, token) DO UPDATE SET phone = excluded.phone, created_at = excluded.created_at`,
  ).bind(studioId, phone, t, Date.now()).run();
  return true;
}

export async function forgetPushTokens(env, studioId, phone) {
  await env.STUDIO_DB.prepare('DELETE FROM push_tokens WHERE studio_id = ? AND phone = ?').bind(studioId, phone).run();
}

async function sendOne(env, token, payload) {
  const r = await fetch(`${HOST}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${await providerToken(env)}`, 'apns-topic': TOPIC, 'apns-push-type': 'alert', 'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 2 * 86400), 'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (r.status === 200) return 'ok';
  const why = await r.json().then((o) => o.reason).catch(() => '');
  return r.status === 410 || why === 'BadDeviceToken' || why === 'Unregistered' || why === 'DeviceTokenNotForTopic' ? 'gone' : `fail ${r.status} ${why}`;
}

/**
 * to the devices of these phones in this studio: { title, body, extra } — returns how many devices got it
 * (a device that is no more is forgotten)
 */
/** @param {{ title?: string, body: string, extra?: object }} msg */
export async function pushTo(env, studio, phones, msg) {
  const { title = '', body, extra = {} } = msg;
  if (!pushReady(env) || !phones.length) return 0;
  const list = [...new Set(phones)].slice(0, 500);
  const rows = [];
  for (let i = 0; i < list.length; i += 50) {
    const part = list.slice(i, i + 50);
    rows.push(...(((await env.STUDIO_DB.prepare(`SELECT token FROM push_tokens WHERE studio_id = ? AND phone IN (${part.map(() => '?').join(',')})`)
      .bind(studio.id, ...part).all()).results) || []));
  }
  const payload = { aps: { alert: { title: title || studio.settings.brand.name, body }, sound: PUSH_SOUND, 'thread-id': studio.id }, studio: studio.id, ...extra };
  let sent = 0;
  for (const { token } of rows) {
    try {
      const r = await sendOne(env, token, payload);
      if (r === 'ok') sent++;
      else if (r === 'gone') await env.STUDIO_DB.prepare('DELETE FROM push_tokens WHERE studio_id = ? AND token = ?').bind(studio.id, token).run();
      else console.warn('[studio] push:', r);
    } catch (e) { console.warn('[studio] push failed:', e.message); }
  }
  return sent;
}
