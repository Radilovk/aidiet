/**
 * Google Calendar of each studio, through one service account of the platform: the studio shares its calendar with
 * the account's e-mail ("Make changes to events") and puts the calendar's id in its admin page. No OAuth per studio.
 * Secret: GOOGLE_SERVICE_ACCOUNT (JSON; FIREBASE_SERVICE_ACCOUNT is used when that one is not set — Calendar API must
 * be on in its Google Cloud project).
 */
import { zonedMs } from './slots.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
let tokenMemo = null;

function account(env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    return sa.private_key && sa.client_email ? sa : null;
  } catch (_) {
    return null;
  }
}

export function serviceAccountEmail(env) {
  const sa = account(env);
  return sa ? sa.client_email : '';
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const b64json = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function accessToken(env) {
  if (tokenMemo && tokenMemo.exp > Date.now() + 60e3) return tokenMemo.token;
  const sa = account(env);
  if (!sa) throw new Error('google: no service account');
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64json({ alg: 'RS256', typ: 'JWT' })}.${b64json({
    iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) throw new Error(`google token ${resp.status}`);
  tokenMemo = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return tokenMemo.token;
}

async function gcal(env, method, path, body) {
  const resp = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(env)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 204 || resp.status === 410) return {};
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`google ${method} ${resp.status} ${(data.error && data.error.message) || ''}`.trim());
  return data;
}

const cal = (id) => `calendars/${encodeURIComponent(id)}/events`;

/**
 * The calendar's busy times between two instants: [{ start, end }] (ms). Events marked free ("transparent"), declined
 * or canceled ones, and the platform's own bookings (counted from the database) are left out.
 */
export async function busyTimes(env, calendarId, fromMs, toMs, tz) {
  const out = [];
  let page = '';
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({
      timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(), singleEvents: 'true',
      maxResults: '500', fields: 'nextPageToken,items(status,transparency,start,end,extendedProperties/private)',
    });
    if (page) q.set('pageToken', page);
    const data = await gcal(env, 'GET', `${cal(calendarId)}?${q}`);
    for (const ev of data.items || []) {
      if (ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
      if (ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.studioBooking) continue;
      // an all-day event (a day off) covers that date on the studio's own clock
      const at = (x) => (x && x.dateTime ? Date.parse(x.dateTime) : x && x.date ? zonedMs(x.date, '00:00', tz) : NaN);
      const start = at(ev.start);
      const end = at(ev.end);
      if (Number.isFinite(start) && Number.isFinite(end)) out.push({ start, end });
    }
    page = data.nextPageToken || '';
    if (!page) break;
  }
  return out;
}

/** a booking as an event in the studio's calendar → the event id */
export async function addEvent(env, calendarId, b, studioName) {
  const ev = await gcal(env, 'POST', cal(calendarId), {
    summary: `${studioName}: ${b.name || b.phone}`,
    description: `Тел.: ${b.phone}${b.code ? `\nКод: ${b.code}` : ''}${b.card_last4 ? `\nКарта (гаранция): •••• ${b.card_last4}` : ''}\nЗаписано в приложението.`,
    start: { dateTime: new Date(b.start_ms).toISOString() },
    end: { dateTime: new Date(b.end_ms).toISOString() },
    extendedProperties: { private: { studioBooking: b.id } },
  });
  return ev.id || '';
}

export async function moveEvent(env, calendarId, eventId, b) {
  await gcal(env, 'PATCH', `${cal(calendarId)}/${encodeURIComponent(eventId)}`, {
    start: { dateTime: new Date(b.start_ms).toISOString() }, end: { dateTime: new Date(b.end_ms).toISOString() },
  });
}

export async function deleteEvent(env, calendarId, eventId) {
  await gcal(env, 'DELETE', `${cal(calendarId)}/${encodeURIComponent(eventId)}`);
}

/** can the platform read and write this calendar? → '' or the reason */
export async function checkCalendar(env, calendarId) {
  try {
    const now = Date.now();
    await busyTimes(env, calendarId, now, now + 864e5, 'UTC');
    return '';
  } catch (err) {
    return err.message;
  }
}
