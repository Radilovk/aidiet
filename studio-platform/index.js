/**
 * Studio platform API: many studios on one worker, each with its own subdomain, schedule, hour length, buffer, prices,
 * brand, codes, limits, Google Calendar and (optional) Stripe. Bookings live in D1 (env.STUDIO_DB); Viber messages go
 * through the same outbox as XBODY (viber-sender/ on the PC).
 *
 *   handleStudioApi(request, env, ctx, { rateLimit }) → a Response for /api/s/…, or null for any other path.
 *
 * The studio comes from ?studio= / the body's `studio`, else from the subdomain (burgas.<STUDIO_ROOT_DOMAIN>).
 * Traffic: the app keeps the settings (version), the month's free hours are cached (studio:rev bumps on every
 * change, Google's busy times 5 min in KV), and only "Запази" checks Google and the database live.
 */
import { normalizeSettings, publicSettings } from './settings.js';
import { slotsForMonth, zonedMs, zonedParts, isOfferedStart, inWindow, isFree } from './slots.js';
import { busyTimes, addEvent, moveEvent, deleteEvent, checkCalendar, serviceAccountEmail } from './google.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Master-Key',
  'Content-Type': 'application/json',
};
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...extra } });
const err = (error, status = 400) => json({ error }, status);

const MAX_TIMES = 8;
const ADMIN_SESSION_MS = 12 * 3600e3;
const BUSY_TTL = 300;        // s: Google's busy times kept in KV
const AVAIL_TTL = 300;       // s: a month's free hours, cached per change

/* ── small helpers ── */
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
function randomToken(bytes = 24) { return hex(crypto.getRandomValues(new Uint8Array(bytes))); }
function newId() { return randomToken(10); }

async function pinHash(pin, salt = randomToken(8)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return `${salt}:${hex(bits)}`;
}
async function pinOk(pin, stored) {
  const salt = String(stored || '').split(':')[0];
  if (!salt) return false;
  const got = await pinHash(pin, salt);
  let diff = got.length ^ stored.length;
  for (let i = 0; i < Math.min(got.length, stored.length); i++) diff |= got.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}

/* the studio's Stripe secret key, sealed with STUDIO_SECRET_KEY (32 bytes, base64 or base64url) */
async function sealKey(env) {
  let raw = null;
  try {
    const b64 = String(env.STUDIO_SECRET_KEY || '').replace(/-/g, '+').replace(/_/g, '/');
    raw = b64 ? Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)) : null;
  } catch (_) { raw = null; }
  if (!raw || raw.length !== 32) return null;
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, text) {
  const key = await sealKey(env);
  if (!key) throw new Error('no STUDIO_SECRET_KEY');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(ct)))}`;
}
async function unseal(env, sealed) {
  const key = await sealKey(env);
  const [iv, ct] = String(sealed || '').split('.');
  if (!key || !iv || !ct) return '';
  try {
    const bytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, key, bytes(ct)));
  } catch (_) {
    return '';
  }
}

/** a phone as Viber takes it: +359…, or '' */
export function normPhone(phone) {
  const d = String(phone || '').replace(/[^\d+]/g, '');
  if (/^\+\d{9,15}$/.test(d)) return d;
  if (/^00\d{9,15}$/.test(d)) return '+' + d.slice(2);
  if (/^0\d{8,9}$/.test(d)) return '+359' + d.slice(1);
  if (/^359\d{8,9}$/.test(d)) return '+' + d;
  return '';
}

async function readBody(request, max = 8192) {
  const raw = await request.text();
  if (raw.length > max) return null;
  try { const b = JSON.parse(raw); return b && typeof b === 'object' ? b : null; } catch (_) { return null; }
}

/* ── the studio ── */
const studioMemo = new Map();   // id → { at, row } (30 s: a settings change shows within that on every isolate)

function slugFrom(env, url, body) {
  const given = String((body && body.studio) || url.searchParams.get('studio') || '').toLowerCase();
  if (/^[a-z0-9-]{2,40}$/.test(given)) return given;
  const root = String(env.STUDIO_ROOT_DOMAIN || '').toLowerCase();
  const host = url.hostname.toLowerCase();
  if (root && host.endsWith('.' + root)) {
    const sub = host.slice(0, -(root.length + 1));
    if (/^[a-z0-9-]{2,40}$/.test(sub)) return sub;
  }
  return '';
}

async function loadStudio(env, id, fresh = false) {
  const m = studioMemo.get(id);
  if (!fresh && m && Date.now() - m.at < 30e3) return m.row;
  const row = await env.STUDIO_DB.prepare('SELECT id, settings, secrets, pin_hash, version FROM studios WHERE id = ?').bind(id).first();
  const out = row ? {
    id: row.id, version: row.version, pinHash: row.pin_hash,
    settings: normalizeSettings(JSON.parse(row.settings || '{}')), secrets: JSON.parse(row.secrets || '{}'),
  } : null;
  studioMemo.set(id, { at: Date.now(), row: out });
  return out;
}

function hasStripe(studio) { return Boolean(studio.secrets.pk && studio.secrets.sk); }
/** what a booking needs: 'card' | 'card_or_code' | 'none' (no Stripe: a card cannot be taken, so none) */
function guaranteeOf(studio) { return hasStripe(studio) ? studio.settings.guarantee : 'none'; }

async function bumpRev(env, id) {
  if (!env.page_content) return;
  try { await env.page_content.put(`studio:rev:${id}`, String(Date.now())); } catch (_) {}
}

/* ── Stripe (the studio's own account) ── */
async function stripe(env, studio, method, path, params) {
  const sk = await unseal(env, studio.secrets.sk);
  if (!sk) throw new Error('stripe: no key');
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') form.append(k, String(v));
  let url = `https://api.stripe.com/v1/${path}`;
  const init = { method, headers: { Authorization: `Bearer ${sk}` } };
  if (method === 'GET') { if (params) url += '?' + form; } else { init.body = form.toString(); init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const resp = await fetch(url, init);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`stripe ${path.split('/')[0]} ${resp.status} ${(data.error && data.error.code) || ''}`);
  return data;
}
function cardLive(c) {
  const now = new Date();
  return c && !(c.exp_year < now.getUTCFullYear() || (c.exp_year === now.getUTCFullYear() && c.exp_month < now.getUTCMonth() + 1));
}

/* ── clients (by phone) and their device tokens ── */
async function getClient(env, studioId, phone) {
  return env.STUDIO_DB.prepare('SELECT * FROM clients WHERE studio_id = ? AND phone = ?').bind(studioId, phone).first();
}
async function tokenOk(client, token) {
  if (!client || !token) return false;
  const list = JSON.parse(client.token_hash || '[]');
  return Array.isArray(list) && list.includes(await sha256(String(token)));
}
/** a new device token for this client (the last 5 devices keep theirs) */
async function issueToken(env, studioId, phone) {
  const token = randomToken();
  const c = await getClient(env, studioId, phone);
  const list = JSON.parse((c && c.token_hash) || '[]');
  const next = [...(Array.isArray(list) ? list : []), await sha256(token)].slice(-5);
  await env.STUDIO_DB.prepare('UPDATE clients SET token_hash = ? WHERE studio_id = ? AND phone = ?').bind(JSON.stringify(next), studioId, phone).run();
  return token;
}
async function upsertClient(env, studioId, phone, fields) {
  await env.STUDIO_DB.prepare(
    `INSERT INTO clients (studio_id, phone, name, email, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (studio_id, phone) DO UPDATE SET name = excluded.name, email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE clients.email END`,
  ).bind(studioId, phone, fields.name || '', fields.email || '', Date.now()).run();
}

/* ── codes ── */
async function findCode(env, studioId, code, phone, count, now = Date.now()) {
  const c = await env.STUDIO_DB.prepare('SELECT * FROM codes WHERE studio_id = ? AND code = ? AND active = 1').bind(studioId, code).first();
  if (!c || (c.valid_to && c.valid_to < now)) return { error: 'code' };
  if (c.uses_left !== null && c.uses_left < count) return { error: 'code_used' };
  if (c.per_client !== null) {
    const used = await env.STUDIO_DB.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE studio_id = ? AND phone = ? AND code = ? AND (status <> 'canceled' OR late_cancel = 1)",
    ).bind(studioId, phone, c.code).first();
    if ((used ? used.n : 0) + count > c.per_client) return { error: 'code_used' };
  }
  return { code: c };
}
function codeOut(c) { return { code: c.code, label: c.label, expires: c.valid_to || null, usesLeft: c.uses_left }; }

/* ── Viber (the shared outbox) ── */
const BG_DAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];
function whenText(ms, tz) {
  const { ymd, hm } = zonedParts(ms, tz);
  const [y, m, d] = ymd.split('-').map(Number);
  return { day: `${BG_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${ymd.slice(8)}.${ymd.slice(5, 7)}`, hm, ymd };
}
const outKey = (at, id, kind) => `xbody:out:${String(Math.floor(at)).padStart(13, '0')}:${id}:${kind}`;
function viberOn(env, studio) { return Boolean(env.page_content) && studio.settings.viber && env.STUDIO_VIBER !== 'off'; }

/** a booking's messages: now, the evening before (19:00) and 2 h before (only 08:00–21:00); old reminders go */
async function viberBooking(env, studio, event, b, now = Date.now()) {
  if (!viberOn(env, studio)) return;
  const kv = env.page_content;
  const st = studio.settings;
  const id = `s${b.id}`;
  const w = whenText(b.start_ms, st.timezone);
  const first = String(b.name || '').trim().split(/\s+/)[0];
  const hi = first ? `Здравейте, ${first}!` : 'Здравейте!';
  const at = `${w.day} от ${w.hm} ч.`;
  const where = st.address ? ` (${st.address})` : '';
  const sign = `\n— ${st.brand.name}`;
  const free = st.rules.freeCancelHours;
  const msgs = [];
  if (event === 'canceled') msgs.push({ kind: 'canceled', at: now, text: `${hi} Часът Ви в ${st.brand.name} за ${at} е отказан.${sign}` });
  else {
    msgs.push({ kind: event === 'moved' ? 'moved' : 'booked', at: now, text: event === 'moved'
      ? `${hi} Часът Ви в ${st.brand.name}${where} е преместен за ${at}${sign}`
      : `${hi} Вашият час в ${st.brand.name}${where} е запазен: ${at}${free ? ` Промяна или отказ — безплатно до ${free} ч преди часа, в приложението.` : ''}${sign}` });
    const prev = zonedMs(new Date(Date.parse(`${w.ymd}T12:00:00Z`) - 864e5).toISOString().slice(0, 10), '19:00', st.timezone);
    if (prev > now + 30 * 60e3 && b.start_ms - prev > 6 * 3600e3) {
      msgs.push({ kind: 'eve', at: prev, text: `${hi} Напомняне: утре (${at}) Ви очакваме в ${st.brand.name}${where}.${sign}` });
    }
    const soon = b.start_ms - 2 * 3600e3;
    const h = Number(zonedParts(soon, st.timezone).hm.slice(0, 2));
    if (soon > now + 15 * 60e3 && h >= 8 && h < 21) {
      msgs.push({ kind: 'soon', at: soon, text: `${hi} Напомняне: днес от ${w.hm} ч. е Вашият час в ${st.brand.name}.${sign}` });
    }
  }
  try {
    const old = JSON.parse((await kv.get(`xbody:outidx:${id}`)) || '[]');
    await Promise.all((Array.isArray(old) ? old : []).map((k) => kv.delete(k)));
    const keep = [];
    for (const m of msgs) {
      const key = outKey(m.at, id, m.kind);
      await kv.put(key, JSON.stringify({ to: b.phone, text: m.text, tries: 0 }), { expirationTtl: Math.max(86400, Math.ceil((m.at - now) / 1000) + 3 * 86400) });
      if (m.kind === 'eve' || m.kind === 'soon') keep.push(key);
    }
    if (keep.length) await kv.put(`xbody:outidx:${id}`, JSON.stringify(keep), { expirationTtl: 400 * 86400 });
    else await kv.delete(`xbody:outidx:${id}`);
  } catch (e) {
    console.warn('[studio-viber] queue failed:', e.message);
  }
}

/* ── availability ── */
async function busyForMonth(env, studio, ym) {
  const cal = studio.settings.google.calendarId;
  if (!cal) return [];
  const key = `studio:busy:${studio.id}:${ym}`;
  if (env.page_content) {
    const hit = await env.page_content.get(key).catch(() => null);
    if (hit) return JSON.parse(hit);
  }
  const tz = studio.settings.timezone;
  const [y, m] = ym.split('-').map(Number);
  const from = zonedMs(`${ym}-01`, '00:00', tz);
  const to = zonedMs(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), '00:00', tz);
  const busy = await busyTimes(env, cal, from, to, tz);
  if (env.page_content) await env.page_content.put(key, JSON.stringify(busy), { expirationTtl: BUSY_TTL }).catch(() => {});
  return busy;
}

async function bookedBetween(env, studioId, from, to, exceptId = '') {
  const r = await env.STUDIO_DB.prepare(
    "SELECT id, start_ms AS start, end_ms AS end FROM bookings WHERE studio_id = ? AND status = 'booked' AND start_ms < ? AND end_ms > ? AND id <> ?",
  ).bind(studioId, to, from, exceptId).all();
  return r.results || [];
}

async function handleAvailability(env, ctx, studio, url) {
  const ym = String(url.searchParams.get('month') || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return err('month');
  const rev = env.page_content ? (await env.page_content.get(`studio:rev:${studio.id}`).catch(() => '')) || '0' : '0';
  const cacheKey = new Request(`https://studio-cache.invalid/${studio.id}/${ym}/${studio.version}/${rev}`);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) return new Response(hit.body, { status: 200, headers: { ...CORS, 'Cache-Control': 'public, max-age=30' } });
  }
  const st = studio.settings;
  const [y, m] = ym.split('-').map(Number);
  const from = zonedMs(`${ym}-01`, '00:00', st.timezone) - 864e5;
  const to = zonedMs(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), '00:00', st.timezone) + 864e5;
  let busy = [];
  let calendarOk = true;
  try { busy = await busyForMonth(env, studio, ym); } catch (e) { calendarOk = false; console.warn('[studio] google busy failed:', e.message); }
  const taken = [...(await bookedBetween(env, studio.id, from, to)), ...busy];
  const body = JSON.stringify({ month: ym, days: calendarOk ? slotsForMonth(st, ym, taken) : {}, calendarOk, at: Date.now() });
  const resp = new Response(body, { status: 200, headers: { ...CORS, 'Cache-Control': 'public, max-age=30' } });
  if (cache && calendarOk) ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'Cache-Control': `public, max-age=${AVAIL_TTL}` } })).catch(() => {}));
  return resp;
}

/* ── booking ── */
/** 'YYYY-MM-DD HH:MM' (the studio's clock) → ms of an hour the studio offers and a client may book now, or null */
function startOf(st, t, now) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(String(t || ''));
  if (!m) return null;
  const ms = zonedMs(m[1], m[2], st.timezone);
  return isOfferedStart(st, ms) && inWindow(st, ms, now) ? ms : null;
}

function readWho(b) {
  return {
    phone: normPhone(b.phone),
    name: String(b.name || '').trim().slice(0, 80),
    email: String(b.email || '').trim().toLowerCase().slice(0, 120),
    token: String(b.token || '').slice(0, 64),
  };
}

/** POST /api/s/guarantee — the card for these hours: the saved one (this device's), else a new SetupIntent */
async function handleGuarantee(env, studio, b) {
  if (!hasStripe(studio)) return err('no_stripe', 503);
  const who = readWho(b);
  if (!who.phone || !who.name) return err('who');
  const times = (Array.isArray(b.times) ? b.times : []).slice(0, MAX_TIMES).map(String);
  if (!times.length) return err('times');
  const client = await getClient(env, studio.id, who.phone);
  if (!b.newCard && client && client.card_pm && (await tokenOk(client, who.token))) {
    try {
      const pm = await stripe(env, studio, 'GET', `payment_methods/${client.card_pm}`, {});
      if (pm.customer === client.stripe_customer && cardLive(pm.card)) {
        return json({ saved: { brand: pm.card.brand, last4: pm.card.last4 }, price: studio.settings.price });
      }
    } catch (e) { console.warn('[studio] saved card check failed:', e.message); }
  }
  try {
    let customer = client && client.stripe_customer;
    if (!customer) {
      const c = await stripe(env, studio, 'POST', 'customers', { name: who.name, phone: who.phone, email: who.email || undefined, 'metadata[studio]': studio.id });
      customer = c.id;
    }
    const si = await stripe(env, studio, 'POST', 'setup_intents', {
      customer, usage: 'off_session', 'payment_method_types[]': 'card',
      description: `${studio.settings.brand.name} — гаранция за ${times.length} ч.`,
      'metadata[studio]': studio.id, 'metadata[phone]': who.phone, 'metadata[times]': times.join(','),
    });
    return json({ clientSecret: si.client_secret, publishableKey: studio.secrets.pk, price: studio.settings.price });
  } catch (e) {
    console.error('[studio] guarantee failed:', e.message);
    return err('stripe', 502);
  }
}

/** POST /api/s/book { phone, name, email?, times[], code?, setupIntent?, useSaved?, token?, terms? } */
async function handleBook(env, ctx, studio, b) {
  const st = studio.settings;
  const now = Date.now();
  const who = readWho(b);
  if (!who.phone || !who.name) return err('who');
  const raw = (Array.isArray(b.times) ? b.times : []).slice(0, MAX_TIMES).map(String);
  if (!raw.length) return err('times');
  const starts = raw.map((t) => ({ t, ms: startOf(st, t, now) }));
  let client = await getClient(env, studio.id, who.phone);
  if (!client && !b.terms) return err('terms', 403);
  const ok = starts.filter((x) => x.ms);
  const failed = starts.filter((x) => !x.ms).map((x) => ({ time: x.t, error: 'not_offered' }));
  if (!ok.length) return json({ booked: [], failed }, 409);

  // the client's limits: hours ahead, hours a day
  const mine = (await env.STUDIO_DB.prepare("SELECT start_ms FROM bookings WHERE studio_id = ? AND phone = ? AND status = 'booked' AND start_ms > ?")
    .bind(studio.id, who.phone, now).all()).results || [];
  if (mine.length + ok.length > st.rules.maxUpcoming) return json({ error: 'max_upcoming', max: st.rules.maxUpcoming }, 409);
  const perDay = {};
  for (const x of [...mine.map((r) => r.start_ms), ...ok.map((x) => x.ms)]) {
    const d = zonedParts(x, st.timezone).ymd;
    perDay[d] = (perDay[d] || 0) + 1;
    if (perDay[d] > st.rules.maxPerDay) return json({ error: 'max_per_day', max: st.rules.maxPerDay, day: d }, 409);
  }

  // the code (the studio's own), then the card
  let code = null;
  if (b.code) {
    const r = await findCode(env, studio.id, String(b.code).trim().slice(0, 40), who.phone, ok.length, now);
    if (r.error) return json({ error: r.error }, 400);
    code = r.code;
  }
  const need = guaranteeOf(studio);
  let card = null;
  if (need === 'card' || (need === 'card_or_code' && !code)) {
    if (b.useSaved && client && client.card_pm && (await tokenOk(client, who.token))) {
      card = { pm: client.card_pm, last4: client.card_last4, brand: client.card_brand, customer: client.stripe_customer };
    } else if (/^seti_\w+$/.test(String(b.setupIntent || ''))) {
      try {
        const si = await stripe(env, studio, 'GET', `setup_intents/${b.setupIntent}`, { 'expand[]': 'payment_method' });
        const chosen = String((si.metadata && si.metadata.times) || '').split(',');
        const good = si.status === 'succeeded' && si.metadata && si.metadata.studio === studio.id && si.metadata.phone === who.phone &&
          !si.metadata.used && ok.every((x) => chosen.includes(x.t)) && now / 1000 - (si.created || 0) < 3600;
        const pm = si.payment_method;
        if (good && pm && pm.card) card = { pm: pm.id, last4: pm.card.last4, brand: pm.card.brand, customer: si.customer, si: si.id };
      } catch (e) {
        console.error('[studio] setup intent check failed:', e.message);
        return err('stripe', 502);
      }
    }
    if (!card) return err('card_required', 402);
  }

  // Google: the hours checked live (a busy calendar never lets a booking through)
  let busy = [];
  if (st.google.calendarId) {
    try {
      busy = await busyTimes(env, st.google.calendarId, Math.min(...ok.map((x) => x.ms)) - 864e5, Math.max(...ok.map((x) => x.ms)) + 864e5, st.timezone);
    } catch (e) {
      console.error('[studio] google check failed:', e.message);
      return err('calendar', 503);
    }
  }

  // each hour: inserted only when nothing overlaps it (with the buffer) — one statement, so two phones cannot both win
  const pad = st.slot.buffer * 60000;
  const len = st.slot.minutes * 60000;
  const booked = [];
  for (const x of ok) {
    if (!isFree(st, x.ms, busy)) { failed.push({ time: x.t, error: 'taken' }); continue; }
    if (code && code.uses_left !== null) {   // one use of the code, taken before the hour (given back if the hour fails)
      const u = await env.STUDIO_DB.prepare('UPDATE codes SET uses_left = uses_left - 1 WHERE studio_id = ? AND code = ? AND uses_left > 0')
        .bind(studio.id, code.code).run();
      if (!u.meta || !u.meta.changes) { failed.push({ time: x.t, error: 'code_used' }); continue; }
    }
    const id = newId();
    const r = await env.STUDIO_DB.prepare(
      `INSERT INTO bookings (id, studio_id, start_ms, end_ms, status, phone, name, code, card_pm, card_last4, stripe_customer, source, created_at, changed_at)
       SELECT ?, ?, ?, ?, 'booked', ?, ?, ?, ?, ?, ?, 'app', ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE studio_id = ? AND status = 'booked' AND start_ms < ? AND end_ms > ?)`,
    ).bind(id, studio.id, x.ms, x.ms + len, who.phone, who.name, code ? code.code : '', card ? card.pm : '', card ? card.last4 : '',
      card ? card.customer : '', now, now, studio.id, x.ms + len + pad, x.ms - pad).run();
    if (r.meta && r.meta.changes) {
      booked.push({ id, time: x.t, start_ms: x.ms, end_ms: x.ms + len, phone: who.phone, name: who.name, code: code ? code.code : '', card_last4: card ? card.last4 : '' });
    } else {
      failed.push({ time: x.t, error: 'taken' });
      if (code && code.uses_left !== null) await env.STUDIO_DB.prepare('UPDATE codes SET uses_left = uses_left + 1 WHERE studio_id = ? AND code = ?').bind(studio.id, code.code).run();
    }
  }

  // the client: kept (name, card, code); a device token on the first booking
  await upsertClient(env, studio.id, who.phone, who);
  if (card && booked.length) {
    await env.STUDIO_DB.prepare('UPDATE clients SET stripe_customer = ?, card_pm = ?, card_brand = ?, card_last4 = ? WHERE studio_id = ? AND phone = ?')
      .bind(card.customer, card.pm, card.brand, card.last4, studio.id, who.phone).run();
    if (card.si) await stripe(env, studio, 'POST', `setup_intents/${card.si}`, { 'metadata[used]': '1' }).catch(() => {});
  }
  if (code && booked.length) await env.STUDIO_DB.prepare('UPDATE clients SET code = ? WHERE studio_id = ? AND phone = ?').bind(code.code, studio.id, who.phone).run();
  client = await getClient(env, studio.id, who.phone);
  let token;
  if (booked.length && !(await tokenOk(client, who.token)) && JSON.parse(client.token_hash || '[]').length === 0) {
    token = await issueToken(env, studio.id, who.phone);   // a new client: this device is theirs
  }

  if (booked.length) {
    await bumpRev(env, studio.id);
    ctx.waitUntil((async () => {
      for (const bk of booked) {
        await viberBooking(env, studio, 'booked', bk);
        if (st.google.calendarId) {
          try {
            const ev = await addEvent(env, st.google.calendarId, bk, st.brand.name);
            await env.STUDIO_DB.prepare('UPDATE bookings SET gcal_event = ? WHERE id = ?').bind(ev, bk.id).run();
          } catch (e) { console.warn('[studio] google event failed:', e.message); }
        }
      }
    })());
  }
  return json({
    booked: booked.map((x) => ({ id: x.id, time: x.time })),
    failed,
    token,
    card: card && booked.length ? { brand: card.brand, last4: card.last4 } : undefined,
    code: code && booked.length ? codeOut({ ...code, uses_left: code.uses_left === null ? null : code.uses_left - booked.length }) : undefined,
  }, booked.length || !failed.length ? 200 : 409);
}

/** POST /api/s/code { phone, code } — is this code good here? */
async function handleCode(env, studio, b) {
  const phone = normPhone(b.phone);
  const code = String(b.code || '').trim().slice(0, 40);
  if (!phone || !/^[\p{L}\p{N}_-]{2,40}$/u.test(code)) return err('code');
  const r = await findCode(env, studio.id, code, phone, 1);
  return r.error ? err(r.error) : json({ ok: true, ...codeOut(r.code) });
}

/* ── the client's own hours (this device's token) ── */
async function ownClient(env, studio, b) {
  const who = readWho(b);
  const client = who.phone ? await getClient(env, studio.id, who.phone) : null;
  return (await tokenOk(client, who.token)) ? client : null;
}

async function handleMine(env, studio, b) {
  const client = await ownClient(env, studio, b);
  if (!client) return err('token', 401);
  const st = studio.settings;
  const rows = (await env.STUDIO_DB.prepare(
    "SELECT id, start_ms, status FROM bookings WHERE studio_id = ? AND phone = ? AND start_ms > ? ORDER BY start_ms LIMIT 60",
  ).bind(studio.id, client.phone, Date.now() - 60 * 864e5).all()).results || [];
  const now = Date.now();
  let code = null;
  if (client.code) {
    const c = await env.STUDIO_DB.prepare('SELECT * FROM codes WHERE studio_id = ? AND code = ? AND active = 1').bind(studio.id, client.code).first();
    if (c && !(c.valid_to && c.valid_to < now) && c.uses_left !== 0) code = codeOut(c);
  }
  return json({
    name: client.name,
    card: client.card_pm ? { brand: client.card_brand, last4: client.card_last4 } : null,
    code,
    hours: rows.filter((r) => r.status !== 'canceled' || r.start_ms > now).map((r) => {
      const p = zonedParts(r.start_ms, st.timezone);
      return { id: r.id, time: `${p.ymd} ${p.hm}`, status: r.start_ms < now && r.status === 'booked' ? 'done' : r.status,
        late: r.start_ms - now < st.rules.freeCancelHours * 3600e3 };
    }),
  });
}

async function ownBooking(env, studio, b) {
  const client = await ownClient(env, studio, b);
  if (!client) return { error: err('token', 401) };
  const bk = await env.STUDIO_DB.prepare("SELECT * FROM bookings WHERE id = ? AND studio_id = ? AND phone = ? AND status = 'booked'")
    .bind(String(b.id || ''), studio.id, client.phone).first();
  if (!bk || bk.start_ms < Date.now()) return { error: err('not_found', 404) };
  return { client, bk };
}

/** a canceled booking: its code use back (in time), Google's event and the reminders go */
async function afterCancel(env, ctx, studio, bk, late) {
  if (bk.code && !late) await env.STUDIO_DB.prepare('UPDATE codes SET uses_left = uses_left + 1 WHERE studio_id = ? AND code = ? AND uses_left IS NOT NULL').bind(studio.id, bk.code).run();
  await bumpRev(env, studio.id);
  ctx.waitUntil((async () => {
    await viberBooking(env, studio, 'canceled', bk);
    if (bk.gcal_event && studio.settings.google.calendarId) {
      await deleteEvent(env, studio.settings.google.calendarId, bk.gcal_event).catch((e) => console.warn('[studio] google delete failed:', e.message));
    }
  })());
}

async function handleCancel(env, ctx, studio, b) {
  const o = await ownBooking(env, studio, b);
  if (o.error) return o.error;
  const late = o.bk.start_ms - Date.now() < studio.settings.rules.freeCancelHours * 3600e3;
  const r = await env.STUDIO_DB.prepare("UPDATE bookings SET status = 'canceled', late_cancel = ?, changed_at = ? WHERE id = ? AND status = 'booked'")
    .bind(late ? 1 : 0, Date.now(), o.bk.id).run();
  if (!r.meta || !r.meta.changes) return err('not_found', 404);
  await afterCancel(env, ctx, studio, o.bk, late);
  return json({ ok: true, late });
}

async function handleMove(env, ctx, studio, b) {
  const st = studio.settings;
  const o = await ownBooking(env, studio, b);
  if (o.error) return o.error;
  if (o.bk.start_ms - Date.now() < st.rules.freeCancelHours * 3600e3) return err('too_late', 409);
  const ms = startOf(st, b.time, Date.now());
  if (!ms) return err('not_offered', 409);
  if (st.google.calendarId) {
    try {
      if (!isFree(st, ms, await busyTimes(env, st.google.calendarId, ms - 864e5, ms + 864e5, st.timezone))) return err('taken', 409);
    } catch (e) { return err('calendar', 503); }
  }
  const len = st.slot.minutes * 60000;
  const pad = st.slot.buffer * 60000;
  const r = await env.STUDIO_DB.prepare(
    `UPDATE bookings SET start_ms = ?, end_ms = ?, changed_at = ? WHERE id = ? AND status = 'booked'
     AND NOT EXISTS (SELECT 1 FROM bookings WHERE studio_id = ? AND status = 'booked' AND id <> ? AND start_ms < ? AND end_ms > ?)`,
  ).bind(ms, ms + len, Date.now(), o.bk.id, studio.id, o.bk.id, ms + len + pad, ms - pad).run();
  if (!r.meta || !r.meta.changes) return err('taken', 409);
  const moved = { ...o.bk, start_ms: ms, end_ms: ms + len };
  await bumpRev(env, studio.id);
  ctx.waitUntil((async () => {
    await viberBooking(env, studio, 'moved', moved);
    if (o.bk.gcal_event && st.google.calendarId) await moveEvent(env, st.google.calendarId, o.bk.gcal_event, moved).catch(() => {});
  })());
  return json({ ok: true, time: String(b.time) });
}

/* ── "delete my data" (the app store asks for it): the client's own device token deletes them from this studio ── */
async function handleForget(env, ctx, studio, b) {
  const client = await ownClient(env, studio, b);
  if (!client) return err('token', 401);
  const now = Date.now();
  const db = env.STUDIO_DB;
  const upcoming = (await db.prepare("SELECT * FROM bookings WHERE studio_id = ? AND phone = ? AND status = 'booked' AND start_ms > ?")
    .bind(studio.id, client.phone, now).all()).results || [];
  for (const bk of upcoming) {   // the hours still ahead are released (a code's use comes back); nobody is messaged
    await db.prepare("UPDATE bookings SET status = 'canceled', changed_at = ? WHERE id = ?").bind(now, bk.id).run();
    if (bk.code) await db.prepare('UPDATE codes SET uses_left = uses_left + 1 WHERE studio_id = ? AND code = ? AND uses_left IS NOT NULL').bind(studio.id, bk.code).run();
  }
  // what remains of the history (the studio's own records) no longer says who it was
  await db.prepare("UPDATE bookings SET name = '', phone = ?, card_pm = '', card_last4 = '', stripe_customer = '' WHERE studio_id = ? AND phone = ?")
    .bind(`deleted:${newId()}`, studio.id, client.phone).run();
  await db.prepare('DELETE FROM clients WHERE studio_id = ? AND phone = ?').bind(studio.id, client.phone).run();
  await bumpRev(env, studio.id);
  ctx.waitUntil((async () => {
    for (const bk of upcoming) {
      if (bk.gcal_event && studio.settings.google.calendarId) {
        await deleteEvent(env, studio.settings.google.calendarId, bk.gcal_event).catch(() => {});
      }
    }
    if (client.stripe_customer && hasStripe(studio)) await stripe(env, studio, 'DELETE', `customers/${client.stripe_customer}`).catch(() => {});
  })());
  return json({ ok: true, released: upcoming.length });
}

/** GET /api/s/list — the studios that show themselves in the app (name, place, color, logo), cached at the edge */
async function handleList(env) {
  const rows = (await env.STUDIO_DB.prepare('SELECT id, settings FROM studios ORDER BY created_at LIMIT 500').all()).results || [];
  const studios = [];
  for (const r of rows) {
    const st = normalizeSettings(JSON.parse(r.settings || '{}'));
    if (st.listed) studios.push({ id: r.id, name: st.brand.name, tagline: st.brand.tagline, address: st.address, color: st.brand.color, logo: st.brand.logo });
  }
  return json({ studios }, 200, { 'Cache-Control': 'public, max-age=300' });
}

/* ── a new device: a 4-digit code by Viber gives it the client's token ── */
async function handleVerifyStart(env, studio, b) {
  const phone = normPhone(b.phone);
  if (!phone || !env.page_content) return err('who');
  const client = await getClient(env, studio.id, phone);
  if (!client) return json({ ok: true });   // nothing said about who is a client
  const key = `studio:verify:${studio.id}:${phone}`;
  const prev = JSON.parse((await env.page_content.get(key)) || 'null');
  if (prev && Date.now() - prev.at < 60e3) return err('wait', 429);
  const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
  await env.page_content.put(key, JSON.stringify({ h: await sha256(`${phone}:${pin}`), tries: 0, at: Date.now() }), { expirationTtl: 900 });
  await env.page_content.put(outKey(Date.now(), `v${randomToken(6)}`, 'pin'),
    JSON.stringify({ to: phone, text: `Код за вход в ${studio.settings.brand.name}: ${pin}\nВажи 15 минути.`, tries: 0 }), { expirationTtl: 3600 });
  return json({ ok: true });
}

async function handleVerifyFinish(env, studio, b) {
  const phone = normPhone(b.phone);
  const pin = String(b.pin || '');
  if (!phone || !/^\d{4}$/.test(pin) || !env.page_content) return err('pin');
  const key = `studio:verify:${studio.id}:${phone}`;
  const v = JSON.parse((await env.page_content.get(key)) || 'null');
  if (!v || v.tries >= 5) return err('pin');
  if (v.h !== (await sha256(`${phone}:${pin}`))) {
    await env.page_content.put(key, JSON.stringify({ ...v, tries: v.tries + 1 }), { expirationTtl: 900 });
    return err('pin');
  }
  await env.page_content.delete(key);
  return json({ ok: true, token: await issueToken(env, studio.id, phone) });
}

/* ── admin (7 taps on the logo → the 5-digit code) ── */
async function adminStudio(env, request, studio) {
  const token = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!/^[0-9a-f]{48}$/.test(token)) return false;
  const s = await env.STUDIO_DB.prepare('SELECT studio_id, expires_ms FROM admin_sessions WHERE token_hash = ?').bind(await sha256(token)).first();
  return Boolean(s && s.studio_id === studio.id && s.expires_ms > Date.now());
}

async function handleLogin(env, studio, b) {
  const pin = String(b.pin || '');
  if (!/^\d{5}$/.test(pin)) return err('pin');
  const failKey = `studio:pinfail:${studio.id}`;
  const fails = env.page_content ? Number((await env.page_content.get(failKey)) || 0) : 0;
  if (fails >= 5) return err('locked', 429);   // 5 wrong codes: 15 minutes for everybody
  if (!(await pinOk(pin, studio.pinHash))) {
    if (env.page_content) await env.page_content.put(failKey, String(fails + 1), { expirationTtl: 900 });
    return err('pin', 401);
  }
  if (env.page_content && fails) await env.page_content.delete(failKey);
  const token = randomToken();
  await env.STUDIO_DB.batch([
    env.STUDIO_DB.prepare('DELETE FROM admin_sessions WHERE expires_ms < ?').bind(Date.now()),
    env.STUDIO_DB.prepare('INSERT INTO admin_sessions (token_hash, studio_id, expires_ms) VALUES (?, ?, ?)').bind(await sha256(token), studio.id, Date.now() + ADMIN_SESSION_MS),
  ]);
  return json({ token, expires: Date.now() + ADMIN_SESSION_MS });
}

async function adminState(env, studio) {
  const codes = (await env.STUDIO_DB.prepare('SELECT * FROM codes WHERE studio_id = ? ORDER BY created_at DESC LIMIT 200').bind(studio.id).all()).results || [];
  const cal = studio.settings.google.calendarId;
  return json({
    settings: studio.settings,
    version: studio.version,
    stripe: { set: hasStripe(studio), pk: studio.secrets.pk || '' },
    google: { serviceAccount: serviceAccountEmail(env), calendarError: cal ? await checkCalendar(env, cal) : 'none' },
    codes,
  });
}

async function saveSettings(env, studio, next) {
  const st = normalizeSettings(next);
  await env.STUDIO_DB.prepare('UPDATE studios SET settings = ?, version = version + 1 WHERE id = ?').bind(JSON.stringify(st), studio.id).run();
  studioMemo.delete(studio.id);
  if (env.page_content) {   // Google's cache of this studio: another calendar maybe
    const now = new Date();
    for (let i = 0; i < 13; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)).toISOString().slice(0, 7);
      await env.page_content.delete(`studio:busy:${studio.id}:${d}`).catch(() => {});
    }
  }
  await bumpRev(env, studio.id);
  return st;
}

async function handleAdmin(env, ctx, studio, request, path, b, url) {
  if (path === 'state') return adminState(env, studio);
  if (path === 'settings') return json({ settings: await saveSettings(env, studio, b.settings) });
  if (path === 'logo') {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
    if (!m || m[2].length > 560000) return err('logo');   // ≈ 400 KB; no SVG (it could carry a script)
    await env.page_content.put(`studio:logo:${studio.id}`, JSON.stringify({ type: m[1], b64: m[2] }));
    const st = { ...studio.settings, brand: { ...studio.settings.brand, logo: Date.now() % 1e9 } };
    return json({ settings: await saveSettings(env, studio, st) });
  }
  if (path === 'stripe') {
    const pk = String(b.publishableKey || '').trim();
    const sk = String(b.secretKey || '').trim();
    let secrets = {};
    if (pk || sk) {
      if (!/^pk_(live|test)_\w+$/.test(pk) || !/^(sk|rk)_(live|test)_\w+$/.test(sk) || pk.split('_')[1] !== sk.split('_')[1]) return err('stripe_keys');
      try { secrets = { pk, sk: await seal(env, sk) }; } catch (e) { return err('no_secret_key', 503); }
      try { await stripe(env, { secrets }, 'GET', 'customers', { limit: 1 }); } catch (e) { return err('stripe_refused'); }
    }
    await env.STUDIO_DB.prepare('UPDATE studios SET secrets = ?, version = version + 1 WHERE id = ?').bind(JSON.stringify(secrets), studio.id).run();
    studioMemo.delete(studio.id);
    return json({ ok: true, set: Boolean(pk) });
  }
  if (path === 'pin') {
    if (!/^\d{5}$/.test(String(b.newPin || '')) || !(await pinOk(String(b.pin || ''), studio.pinHash))) return err('pin');
    await env.STUDIO_DB.prepare('UPDATE studios SET pin_hash = ? WHERE id = ?').bind(await pinHash(String(b.newPin)), studio.id).run();
    studioMemo.delete(studio.id);
    return json({ ok: true });
  }
  if (path === 'bookings') {
    const from = Number(url.searchParams.get('from')) || Date.now() - 7 * 864e5;
    const to = Number(url.searchParams.get('to')) || Date.now() + 60 * 864e5;
    const rows = (await env.STUDIO_DB.prepare(
      'SELECT id, start_ms, end_ms, status, phone, name, code, card_last4, stripe_customer, card_pm, late_cancel, source FROM bookings WHERE studio_id = ? AND start_ms >= ? AND start_ms < ? ORDER BY start_ms LIMIT 1000',
    ).bind(studio.id, from, to).all()).results || [];
    return json({ bookings: rows });
  }
  if (path === 'booking') {   // { id, action: cancel | noshow | restore }
    const bk = await env.STUDIO_DB.prepare('SELECT * FROM bookings WHERE id = ? AND studio_id = ?').bind(String(b.id || ''), studio.id).first();
    if (!bk) return err('not_found', 404);
    if (b.action === 'cancel' && bk.status === 'booked') {
      await env.STUDIO_DB.prepare("UPDATE bookings SET status = 'canceled', changed_at = ? WHERE id = ?").bind(Date.now(), bk.id).run();
      await afterCancel(env, ctx, studio, bk, false);
    } else if (b.action === 'noshow' && bk.status === 'booked') {
      await env.STUDIO_DB.prepare("UPDATE bookings SET status = 'noshow', changed_at = ? WHERE id = ?").bind(Date.now(), bk.id).run();
    } else if (b.action === 'restore' && bk.status === 'noshow') {
      await env.STUDIO_DB.prepare("UPDATE bookings SET status = 'booked', changed_at = ? WHERE id = ?").bind(Date.now(), bk.id).run();
    } else return err('action');
    return json({ ok: true });
  }
  if (path === 'charge') {   // { id, amount } — the studio charges a no-show / late cancel from the saved card
    const bk = await env.STUDIO_DB.prepare('SELECT * FROM bookings WHERE id = ? AND studio_id = ?').bind(String(b.id || ''), studio.id).first();
    const amount = Math.round(Number(b.amount) * 100);
    if (!bk || !bk.card_pm || !bk.stripe_customer || !(amount >= 50)) return err('charge');
    if (!(bk.status === 'noshow' || (bk.status === 'canceled' && bk.late_cancel))) return err('not_chargeable');
    try {
      const pi = await stripe(env, studio, 'POST', 'payment_intents', {
        amount, currency: studio.settings.currency.toLowerCase(), customer: bk.stripe_customer, payment_method: bk.card_pm,
        off_session: 'true', confirm: 'true', description: `${studio.settings.brand.name} — ${bk.status === 'noshow' ? 'неявяване' : 'късен отказ'}`,
        'metadata[booking]': bk.id,
      });
      return json({ ok: pi.status === 'succeeded', status: pi.status });
    } catch (e) {
      return json({ error: 'stripe', detail: e.message }, 402);
    }
  }
  if (path === 'book') {   // { phone, name, time } — a client who called: any free time, no card / code asked
    const st = studio.settings;
    const phone = normPhone(b.phone);
    const name = String(b.name || '').trim().slice(0, 80);
    const m = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/.exec(String(b.time || ''));
    if (!phone || !name || !m) return err('who');
    const ms = zonedMs(m[1], `${m[2]}:${m[3]}`, st.timezone);
    if (ms < Date.now() - 3600e3) return err('past');
    const len = st.slot.minutes * 60000;
    const pad = st.slot.buffer * 60000;
    const id = newId();
    const now = Date.now();
    const r = await env.STUDIO_DB.prepare(
      `INSERT INTO bookings (id, studio_id, start_ms, end_ms, status, phone, name, source, created_at, changed_at)
       SELECT ?, ?, ?, ?, 'booked', ?, ?, 'admin', ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE studio_id = ? AND status = 'booked' AND start_ms < ? AND end_ms > ?)`,
    ).bind(id, studio.id, ms, ms + len, phone, name, now, now, studio.id, ms + len + pad, ms - pad).run();
    if (!r.meta || !r.meta.changes) return err('taken', 409);
    await upsertClient(env, studio.id, phone, { name });
    await bumpRev(env, studio.id);
    const bk = { id, start_ms: ms, end_ms: ms + len, phone, name };
    ctx.waitUntil((async () => {
      if (b.viber !== false) await viberBooking(env, studio, 'booked', bk);
      if (st.google.calendarId) {
        try {
          const ev = await addEvent(env, st.google.calendarId, bk, st.brand.name);
          await env.STUDIO_DB.prepare('UPDATE bookings SET gcal_event = ? WHERE id = ?').bind(ev, id).run();
        } catch (e) { console.warn('[studio] google event failed:', e.message); }
      }
    })());
    return json({ ok: true, id });
  }
  if (path === 'clients') {   // the studio's clients, newest first, with their hours
    const rows = (await env.STUDIO_DB.prepare(
      `SELECT c.phone, c.name, c.email, c.card_last4, c.code, c.created_at,
         (SELECT COUNT(*) FROM bookings x WHERE x.studio_id = c.studio_id AND x.phone = c.phone AND x.status = 'booked' AND x.start_ms < ?) AS done,
         (SELECT COUNT(*) FROM bookings x WHERE x.studio_id = c.studio_id AND x.phone = c.phone AND x.status = 'booked' AND x.start_ms >= ?) AS ahead,
         (SELECT COUNT(*) FROM bookings x WHERE x.studio_id = c.studio_id AND x.phone = c.phone AND (x.status = 'noshow' OR x.late_cancel = 1)) AS missed
       FROM clients c WHERE c.studio_id = ? ORDER BY c.created_at DESC LIMIT 1000`,
    ).bind(Date.now(), Date.now(), studio.id).all()).results || [];
    return json({ clients: rows });
  }
  if (path === 'code') {   // upsert { code, label, usesLeft, perClient, validTo, active }
    const code = String(b.code || '').trim();
    if (!/^[\p{L}\p{N}_-]{2,40}$/u.test(code)) return err('code');
    const n = (v) => (v === null || v === undefined || v === '' ? null : Math.max(0, Math.round(Number(v))));
    await env.STUDIO_DB.prepare(
      `INSERT INTO codes (studio_id, code, label, uses_left, per_client, valid_to, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (studio_id, code) DO UPDATE SET label = excluded.label, uses_left = excluded.uses_left, per_client = excluded.per_client,
       valid_to = excluded.valid_to, active = excluded.active`,
    ).bind(studio.id, code, String(b.label || '').slice(0, 80), n(b.usesLeft), n(b.perClient), n(b.validTo), b.active === false ? 0 : 1, Date.now()).run();
    return json({ ok: true });
  }
  return err('not_found', 404);
}

/* ── the platform owner: studios are made here (X-Master-Key) ── */
async function handleMaster(env, request, b) {
  const want = String(env.STUDIO_MASTER_KEY || '');
  const got = String(request.headers.get('X-Master-Key') || '');
  if (want.length < 16 || got !== want) return err('unauthorized', 401);
  const id = String(b.id || '').toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(id) || !/^\d{5}$/.test(String(b.pin || ''))) return err('id_or_pin');
  const exists = await env.STUDIO_DB.prepare('SELECT id FROM studios WHERE id = ?').bind(id).first();
  if (exists) {
    await env.STUDIO_DB.prepare('UPDATE studios SET pin_hash = ? WHERE id = ?').bind(await pinHash(String(b.pin)), id).run();
  } else {
    const st = normalizeSettings({ ...(b.settings || {}), brand: { name: b.name || id } });
    await env.STUDIO_DB.prepare('INSERT INTO studios (id, settings, secrets, pin_hash, version, created_at) VALUES (?, ?, ?, ?, 1, ?)')
      .bind(id, JSON.stringify(st), '{}', await pinHash(String(b.pin)), Date.now()).run();
  }
  studioMemo.delete(id);
  return json({ ok: true, id, created: !exists });
}

/* ── a studio's own address (burgas.<STUDIO_ROOT_DOMAIN>): its page, from the site (cached at the edge) ── */
export async function handleStudioSite(request, env) {
  const root = String(env.STUDIO_ROOT_DOMAIN || '').toLowerCase();
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (!root || !host.endsWith('.' + root) || url.pathname.startsWith('/api/')) return null;
  if (!/^[a-z0-9-]{2,40}$/.test(host.slice(0, -(root.length + 1)))) return null;
  const page = env.STUDIO_PAGE_URL || 'https://biocode.website/studio.html';
  const resp = await fetch(page, { cf: { cacheTtl: 300, cacheEverything: true } });
  return new Response(resp.body, {
    status: resp.status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  });
}

/* ── the router ── */
export async function handleStudioApi(request, env, ctx, opts = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/s/')) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.STUDIO_DB) return err('not_configured', 503);
  const path = url.pathname.slice('/api/s/'.length);
  const limit = (name) => (opts.rateLimit ? opts.rateLimit(name) : null);
  try {
    const body = request.method === 'GET' ? {} : await readBody(request, path === 'admin/logo' ? 600000 : 8192);
    if (!body) return err('body');
    if (path === 'master/studio' && request.method === 'POST') return await handleMaster(env, request, body);

    if (request.method === 'GET' && path === 'list') return await handleList(env);

    const id = slugFrom(env, url, body);
    const studio = id ? await loadStudio(env, id) : null;
    if (!studio) return err('studio', 404);

    if (request.method === 'GET' && path === 'config') {
      return json(publicSettings(studio.settings, studio.version, hasStripe(studio)), 200, { 'Cache-Control': 'public, max-age=60' });
    }
    if (request.method === 'GET' && path === 'logo') {
      const v = env.page_content ? JSON.parse((await env.page_content.get(`studio:logo:${studio.id}`)) || 'null') : null;
      if (!v) return new Response('', { status: 404, headers: CORS });
      const bytes = Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0));
      return new Response(bytes, { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': v.type, 'Cache-Control': 'public, max-age=31536000, immutable' } });
    }
    if (request.method === 'GET' && path === 'availability') return await handleAvailability(env, ctx, studio, url);

    if (path.startsWith('admin/')) {
      const sub = path.slice(6);
      if (sub === 'login' && request.method === 'POST') return (await limit('STUDIO_LOGIN')) || (await handleLogin(env, studio, body));
      if (!(await adminStudio(env, request, studio))) return err('unauthorized', 401);
      return await handleAdmin(env, ctx, studio, request, sub, body, url);
    }
    if (request.method !== 'POST') return err('not_found', 404);
    const rl = await limit(path === 'book' || path === 'guarantee' ? 'STUDIO_BOOK' : path.startsWith('verify') ? 'STUDIO_VERIFY' : 'STUDIO_MANAGE');
    if (rl) return rl;
    switch (path) {
      case 'guarantee': return await handleGuarantee(env, studio, body);
      case 'book': return await handleBook(env, ctx, studio, body);
      case 'code': return await handleCode(env, studio, body);
      case 'mine': return await handleMine(env, studio, body);
      case 'cancel': return await handleCancel(env, ctx, studio, body);
      case 'move': return await handleMove(env, ctx, studio, body);
      case 'forget': return await handleForget(env, ctx, studio, body);
      case 'verify/start': return await handleVerifyStart(env, studio, body);
      case 'verify/finish': return await handleVerifyFinish(env, studio, body);
      default: return err('not_found', 404);
    }
  } catch (e) {
    console.error('[studio] failed:', path, e && e.message);
    return err('server', 500);
  }
}
