#!/usr/bin/env node
/**
 * Studio platform: the API end to end on a real SQLite (node:sqlite as D1), with Google Calendar and Stripe faked.
 *   node scripts/test-studio-platform.mjs
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { strict as assert } from 'node:assert';
import { handleStudioApi } from '../studio-platform/index.js';
import { slotsForMonth, zonedMs, zonedParts, tzOffset } from '../studio-platform/slots.js';
import { normalizeSettings } from '../studio-platform/settings.js';

/* ── D1 on node:sqlite ── */
function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => { db.exec('BEGIN'); try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../studio-platform/schema.sql', import.meta.url), 'utf8'));

const store = new Map();
const kv = {
  get: async (k) => (store.has(k) ? store.get(k) : null),
  put: async (k, v) => { store.set(k, v); },
  delete: async (k) => { store.delete(k); },
};
const sa = (() => {   // a throwaway RSA key, so the service account's JWT really signs
  const { generateKeyPairSync } = globalThis.process.getBuiltinModule('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({ client_email: 'sa@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
})();
const env = {
  STUDIO_DB: d1(db), page_content: kv, STUDIO_MASTER_KEY: 'm'.repeat(20), GOOGLE_SERVICE_ACCOUNT: sa,
  STUDIO_SECRET_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };

/* ── Google + Stripe, faked ── */
let googleBusy = [];   // [{ start, end }] ISO
const events = new Map();
const setupIntents = new Map();
let piCount = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || 'GET';
  const ok = (o) => new Response(JSON.stringify(o), { status: 200 });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return ok({ access_token: 'g', expires_in: 3600 });
  if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/')) {
    if (method === 'GET') return ok({ items: [...googleBusy.map((b) => ({ start: { dateTime: b.start }, end: { dateTime: b.end } })),
      ...[...events.values()].map((e) => ({ ...e, extendedProperties: { private: { studioBooking: 'x' } } }))] });
    if (method === 'POST') { const id = `ev${events.size + 1}`; events.set(id, JSON.parse(init.body)); return ok({ id }); }
    if (method === 'DELETE') { events.delete(decodeURIComponent(url.split('/').pop())); return new Response(null, { status: 204 }); }
    return ok({});
  }
  if (url.startsWith('https://api.stripe.com/v1/')) {
    const path = url.slice('https://api.stripe.com/v1/'.length).split('?')[0];
    const form = new URLSearchParams(init.body || '');
    if (path === 'customers' && method === 'GET') return ok({ data: [] });
    if (path === 'customers') return ok({ id: 'cus_1' });
    if (path === 'setup_intents' && method === 'POST') {
      const id = `seti_${setupIntents.size + 1}`;
      setupIntents.set(id, { id, status: 'succeeded', customer: form.get('customer'), created: Math.floor(Date.now() / 1000),
        metadata: { studio: form.get('metadata[studio]'), phone: form.get('metadata[phone]'), times: form.get('metadata[times]') },
        payment_method: { id: 'pm_1', card: { brand: 'visa', last4: '4242', exp_year: 2031, exp_month: 1 } } });
      return ok({ client_secret: `${id}_secret` });
    }
    if (path.startsWith('setup_intents/') && method === 'GET') return ok(setupIntents.get(path.split('/')[1]));
    if (path.startsWith('setup_intents/')) { setupIntents.get(path.split('/')[1]).metadata.used = '1'; return ok({}); }
    if (path.startsWith('payment_methods/')) return ok({ id: 'pm_1', customer: 'cus_1', card: { brand: 'visa', last4: '4242', exp_year: 2031, exp_month: 1 } });
    if (path === 'payment_intents') { piCount++; return ok({ status: 'succeeded' }); }
  }
  return new Response('{}', { status: 404 });
};

async function api(method, path, body, headers = {}) {
  const r = await handleStudioApi(new Request(`https://w.test/api/s/${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  }), env, ctx);
  await Promise.all(waits.splice(0));
  return { status: r.status, d: await r.json().catch(() => null) };
}

let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('✓', name); }

/* ── pure: time zones and slots ── */
await t('time zone: Sofia summer / winter, DST day', () => {
  assert.equal(tzOffset('Europe/Sofia', Date.parse('2026-07-01T12:00:00Z')), 180);
  assert.equal(tzOffset('Europe/Sofia', Date.parse('2026-12-01T12:00:00Z')), 120);
  assert.equal(new Date(zonedMs('2026-10-25', '10:00', 'Europe/Sofia')).toISOString(), '2026-10-25T08:00:00.000Z');   // after the change
  assert.equal(new Date(zonedMs('2026-10-24', '10:00', 'Europe/Sofia')).toISOString(), '2026-10-24T07:00:00.000Z');
  assert.deepEqual(zonedParts(Date.parse('2026-10-24T07:00:00Z'), 'Europe/Sofia'), { ymd: '2026-10-24', hm: '10:00' });
});

await t('slots: hour length, buffer, step, closed day, notice, taken', () => {
  const st = normalizeSettings({ slot: { minutes: 20, buffer: 10 }, hours: { mon: [['10:00', '11:30']] }, closed: ['2026-11-09'],
    rules: { minNoticeMin: 60, daysAhead: 60 } });
  const now = Date.parse('2026-11-01T00:00:00Z');
  const s = slotsForMonth(st, '2026-11', [], now);
  assert.deepEqual(s['2026-11-02'], ['10:00', '10:30', '11:00']);
  assert.equal(s['2026-11-09'], undefined);   // closed
  const taken = [{ start: zonedMs('2026-11-02', '10:35', 'Europe/Sofia'), end: zonedMs('2026-11-02', '10:50', 'Europe/Sofia') }];
  assert.deepEqual(slotsForMonth(st, '2026-11', taken, now)['2026-11-02'], ['10:00', '11:00']);   // 10:30 overlaps; 11:00 has its 10 min after 10:50
  const near = [{ start: zonedMs('2026-11-02', '10:35', 'Europe/Sofia'), end: zonedMs('2026-11-02', '10:55', 'Europe/Sofia') }];
  assert.deepEqual(slotsForMonth(st, '2026-11', near, now)['2026-11-02'], ['10:00']);   // 10:55 + 10 min buffer > 11:00
});

/* ── a studio ── */
const H = (tok) => ({ Authorization: `Bearer ${tok}` });
await t('master makes a studio; wrong master key refused', async () => {
  assert.equal((await api('POST', 'master/studio', { id: 'burgas', pin: '12345' }, { 'X-Master-Key': 'nope' })).status, 401);
  const r = await api('POST', 'master/studio', { id: 'burgas', name: 'XBODY Burgas', pin: '12345' }, { 'X-Master-Key': 'm'.repeat(20) });
  assert.equal(r.d.created, true);
  await api('POST', 'master/studio', { id: 'sofia', name: 'EMS Sofia', pin: '54321' }, { 'X-Master-Key': 'm'.repeat(20) });
});

let admin = '';
await t('admin: wrong code, lock after 5, right code', async () => {
  assert.equal((await api('POST', 'admin/login', { studio: 'sofia', pin: '00000' })).status, 401);
  const r = await api('POST', 'admin/login', { studio: 'burgas', pin: '12345' });
  assert.ok(/^[0-9a-f]{48}$/.test(r.d.token));
  admin = r.d.token;
  for (let i = 0; i < 5; i++) await api('POST', 'admin/login', { studio: 'sofia', pin: '11111' });
  assert.equal((await api('POST', 'admin/login', { studio: 'sofia', pin: '54321' })).status, 429);   // locked, even the right code
  assert.equal((await api('GET', 'admin/state?studio=sofia', null, H(admin))).status, 401);   // burgas' session, not sofia's
});

const day = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
const next = new Date(Date.parse(`${day}T12:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10);   // the same weekday
const wd = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${day}T12:00:00Z`).getUTCDay()];
await t('admin: settings, Stripe keys, codes', async () => {
  const r = await api('POST', 'admin/settings', { studio: 'burgas', settings: {
    brand: { name: 'XBODY Burgas', color: '#112233' }, address: 'ул. Тест 1', price: 25,
    slot: { minutes: 30, buffer: 0 }, hours: { [wd]: [['09:00', '12:00']] }, rules: { minNoticeMin: 60, daysAhead: 30, maxPerDay: 1, maxUpcoming: 3 },
    guarantee: 'card_or_code', viber: true, google: { calendarId: 'studio@group.calendar.google.com' } } }, H(admin));
  assert.equal(r.d.settings.brand.name, 'XBODY Burgas');
  assert.equal((await api('POST', 'admin/stripe', { studio: 'burgas', publishableKey: 'pk_test_a', secretKey: 'sk_live_b' }, H(admin))).status, 400);   // mixed modes
  assert.equal((await api('POST', 'admin/stripe', { studio: 'burgas', publishableKey: 'pk_test_a', secretKey: 'sk_test_b' }, H(admin))).d.set, true);
  await api('POST', 'admin/code', { studio: 'burgas', code: 'FULLPASS', label: 'Fullpass', usesLeft: 2, perClient: 1, validTo: Date.now() + 30 * 864e5 }, H(admin));
  const cfg = await api('GET', 'config?studio=burgas');
  assert.equal(cfg.d.card, true);
  assert.equal(cfg.d.google, undefined);   // the calendar id stays on the server
});

await t('availability: own schedule, Google busy taken out', async () => {
  googleBusy = [{ start: new Date(zonedMs(day, '10:00', 'Europe/Sofia')).toISOString(), end: new Date(zonedMs(day, '10:30', 'Europe/Sofia')).toISOString() }];
  const r = await api('GET', `availability?studio=burgas&month=${day.slice(0, 7)}`);
  assert.deepEqual(r.d.days[day], ['09:00', '09:30', '10:30', '11:00', '11:30']);
});

const who = { studio: 'burgas', phone: '0888 111 222', name: 'Иван Петров', terms: true };
let token = '';
await t('booking: card required; with the card it books, Google event + Viber queued', async () => {
  assert.equal((await api('POST', 'book', { ...who, times: [`${day} 09:00`] })).status, 402);
  const g = await api('POST', 'guarantee', { ...who, times: [`${day} 09:00`] });
  const si = g.d.clientSecret.split('_secret')[0];
  const r = await api('POST', 'book', { ...who, times: [`${day} 09:00`], setupIntent: si });
  assert.equal(r.d.booked.length, 1);
  assert.equal(r.d.card.last4, '4242');
  token = r.d.token;
  assert.ok(token);
  assert.equal(events.size, 1);
  assert.ok([...store.keys()].some((k) => k.startsWith('xbody:out:') && k.endsWith(':booked')));
  db.exec("UPDATE studios SET settings = json_set(settings, '$.rules.maxPerDay', 5) WHERE id = 'burgas'");
  await api('POST', 'admin/settings', { studio: 'burgas', settings: { ...JSON.parse(db.prepare("SELECT settings FROM studios WHERE id = 'burgas'").get().settings) } }, H(admin));
  assert.equal((await api('POST', 'book', { ...who, times: [`${day} 09:30`], setupIntent: si })).status, 402);   // a used guarantee (and not for 09:30)
  const s2 = JSON.parse(db.prepare("SELECT settings FROM studios WHERE id = 'burgas'").get().settings);
  s2.rules.maxPerDay = 1;
  await api('POST', 'admin/settings', { studio: 'burgas', settings: s2 }, H(admin));
});

await t('booking: limits (one a day), taken hour, Google-busy hour, not offered', async () => {
  const other = { studio: 'burgas', phone: '0899 333 444', name: 'Мария', terms: true, code: 'FULLPASS' };
  assert.equal((await api('POST', 'book', { ...who, times: [`${day} 11:00`], useSaved: true, token })).d.error, 'max_per_day');
  const taken = await api('POST', 'book', { ...other, times: [`${day} 09:00`] });
  assert.equal(taken.d.failed[0].error, 'taken');
  assert.equal((await api('POST', 'book', { ...other, times: [`${day} 10:00`] })).d.failed[0].error, 'taken');   // Google
  assert.equal((await api('POST', 'book', { ...other, times: [`${day} 09:10`] })).d.failed[0].error, 'not_offered');
});

await t('code: books without a card; per client and uses counted; given back on a cancel in time', async () => {
  const other = { studio: 'burgas', phone: '0899 333 444', name: 'Мария', terms: true, code: 'fullpass' };
  const r = await api('POST', 'book', { ...other, times: [`${day} 11:30`] });
  assert.equal(r.d.booked.length, 1);
  assert.equal(r.d.code.usesLeft, 1);
  const again = await api('POST', 'book', { ...other, times: [`${next} 11:00`] });
  assert.equal(again.d.error, 'code_used');   // one per client
  const mine = await api('POST', 'mine', { ...other, token: r.d.token });
  assert.equal(mine.d.code.code, 'FULLPASS');
  const c = await api('POST', 'cancel', { ...other, token: r.d.token, id: r.d.booked[0].id });
  assert.equal(c.d.late, false);
  assert.equal(db.prepare("SELECT uses_left FROM codes WHERE code = 'FULLPASS'").get().uses_left, 2);
});

await t('two phones, the same hour, at once: only one wins', async () => {
  await api('POST', 'admin/code', { studio: 'burgas', code: 'FREE', label: 'free' }, H(admin));
  const a = api('POST', 'book', { studio: 'burgas', phone: '0877000001', name: 'A', terms: true, code: 'FREE', times: [`${day} 11:00`] });
  const b = api('POST', 'book', { studio: 'burgas', phone: '0877000002', name: 'B', terms: true, code: 'FREE', times: [`${day} 11:00`] });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.d.booked.length + rb.d.booked.length, 1);
});

await t('my hours need this device; a new device gets in with the Viber code', async () => {
  assert.equal((await api('POST', 'mine', { ...who })).status, 401);
  assert.equal((await api('POST', 'mine', { ...who, token })).d.hours.length, 1);
  await api('POST', 'verify/start', { ...who });
  const msg = [...store.entries()].find(([k]) => k.endsWith(':pin'));
  const pin = JSON.parse(msg[1]).text.match(/\d{4}/)[0];
  assert.equal((await api('POST', 'verify/finish', { ...who, pin: pin === '0000' ? '1111' : '0000' })).status, 400);
  const v = await api('POST', 'verify/finish', { ...who, pin });
  assert.ok(v.d.token);
  assert.equal((await api('POST', 'mine', { ...who, token: v.d.token })).d.card.last4, '4242');
});

await t('move, then the saved card books without asking (another day)', async () => {
  const id = (await api('POST', 'mine', { ...who, token })).d.hours[0].id;
  assert.equal((await api('POST', 'move', { ...who, token, id, time: `${day} 10:30` })).d.ok, true);
  const g = await api('POST', 'guarantee', { ...who, token, times: [`${next} 09:00`] });
  assert.equal(g.d.saved.last4, '4242');
  const r = await api('POST', 'book', { ...who, token, useSaved: true, times: [`${next} 09:00`] });
  assert.equal(r.d.booked.length, 1);
});

await t('admin: bookings, no-show, charge from the card', async () => {
  const list = (await api('GET', `admin/bookings?studio=burgas`, null, H(admin))).d.bookings;
  const withCard = list.find((x) => x.card_pm && x.status === 'booked');
  assert.equal((await api('POST', 'admin/charge', { studio: 'burgas', id: withCard.id, amount: 25 }, H(admin))).d.error, 'not_chargeable');
  await api('POST', 'admin/booking', { studio: 'burgas', id: withCard.id, action: 'noshow' }, H(admin));
  assert.equal((await api('POST', 'admin/charge', { studio: 'burgas', id: withCard.id, amount: 25 }, H(admin))).d.ok, true);
  assert.equal(piCount, 1);
});

await t('another studio is separate (its own hours, nothing of burgas)', async () => {
  const r = await api('GET', `availability?studio=sofia&month=${day.slice(0, 7)}`);
  assert.equal(r.status, 200);
  assert.equal((await api('POST', 'mine', { studio: 'sofia', phone: who.phone, token })).status, 401);
  assert.equal((await api('GET', 'config?studio=nope')).status, 404);
});

await t('admin: a client who called (no card), overlap refused, clients list', async () => {
  const r = await api('POST', 'admin/book', { studio: 'burgas', time: `${next} 11:30`, name: 'По телефона', phone: '0877 555 666' }, H(admin));
  assert.equal(r.d.ok, true);
  assert.equal((await api('POST', 'admin/book', { studio: 'burgas', time: `${next} 11:40`, name: 'X', phone: '0877 555 667' }, H(admin))).status, 409);
  const c = (await api('GET', 'admin/clients?studio=burgas', null, H(admin))).d.clients;
  assert.ok(c.some((x) => x.name === 'По телефона' && x.ahead === 1));
});

await t('defaults: no Viber, reminder 4 h before; the list of studios shows only listed ones', async () => {
  const sofia = (await api('GET', 'config?studio=sofia')).d;
  assert.equal(sofia.listed, false);   // invite-only by default: a studio is found with its code, not in a public list
  assert.equal((await api('GET', 'list')).d.studios.filter((x) => x.id === 'sofia').length, 0);
  db.exec("UPDATE studios SET settings = json_set(settings, '$.listed', json('true')) WHERE id IN ('burgas', 'sofia')");
  assert.equal(sofia.viber, false);
  assert.equal(sofia.rules.reminderHours, 4);
  assert.equal(sofia.notice, null);
  const tok2 = (await api('POST', 'master/studio', { id: 'hidden', name: 'Скрито', pin: '11122' }, { 'X-Master-Key': 'm'.repeat(20) })).d.id;
  db.exec("UPDATE studios SET settings = json_set(settings, '$.listed', json('false')) WHERE id = 'hidden'");
  const list = (await api('GET', 'list')).d.studios.map((x) => x.id);
  assert.ok(list.includes('burgas') && list.includes('sofia') && !list.includes(tok2));
});

await t('studio notice: shown while live, gone after its end', async () => {
  const set = async (notice) => {
    const cur = JSON.parse(db.prepare("SELECT settings FROM studios WHERE id = 'burgas'").get().settings);
    return api('POST', 'admin/settings', { studio: 'burgas', settings: { ...cur, notice } }, H(admin));
  };
  await set({ id: 1800000001, text: 'Утре сме затворени', until: Date.now() + 864e5 });
  let cfg = (await api('GET', 'config?studio=burgas')).d;
  assert.equal(cfg.notice.text, 'Утре сме затворени');
  assert.equal(cfg.notice.id, 1800000001);
  await set({ id: 1800000002, text: 'Старо', until: Date.now() - 1000 });
  cfg = (await api('GET', 'config?studio=burgas')).d;
  assert.equal(cfg.notice, null);
});

await t('delete my data: hours released, code use back, records scrubbed, only with the device token', async () => {
  const who2 = { studio: 'burgas', phone: '0866 777 888', name: 'За изтриване', terms: true, code: 'FREE' };
  const r = await api('POST', 'book', { ...who2, times: [`${next} 10:00`] });
  assert.equal(r.d.booked.length, 1);
  const tk = r.d.token;
  assert.equal((await api('POST', 'forget', { ...who2, token: 'x'.repeat(48) })).status, 401);
  const f = await api('POST', 'forget', { ...who2, token: tk });
  assert.equal(f.d.released, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM clients WHERE phone = '+359866777888'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE name = 'За изтриване' OR phone = '+359866777888'").get().n, 0);
  assert.equal((await api('POST', 'mine', { ...who2, token: tk })).status, 401);
  const free = (await api('GET', `availability?studio=burgas&month=${next.slice(0, 7)}`)).d.days[next] || [];
  assert.ok(free.includes('10:00'));   // the hour is free again
});

await t('a code made by scripts/studio-admin.mjs (Node PBKDF2) opens the admin (WebCrypto)', async () => {
  const { pbkdf2Sync } = await import('node:crypto');
  const salt = 'a1b2c3d4e5f60718';
  const hash = `${salt}:${pbkdf2Sync('24680', salt, 100000, 32, 'sha256').toString('hex')}`;
  db.prepare("INSERT INTO studios (id, settings, secrets, pin_hash, version, created_at) VALUES ('plovdiv', '{}', '{}', ?, 1, 0)").run(hash);
  assert.ok((await api('POST', 'admin/login', { studio: 'plovdiv', pin: '24680' })).d.token);
});

await t('STUDIO_SECRET_KEY as base64url (cf-bridge secret-generate) seals the Stripe key', async () => {
  env.STUDIO_SECRET_KEY = Buffer.alloc(32, 250).toString('base64url');
  const tok = (await api('POST', 'admin/login', { studio: 'plovdiv', pin: '24680' })).d.token;
  assert.equal((await api('POST', 'admin/stripe', { studio: 'plovdiv', publishableKey: 'pk_test_x', secretKey: 'sk_test_y' }, H(tok))).d.set, true);
  assert.ok(!db.prepare("SELECT secrets FROM studios WHERE id = 'plovdiv'").get().secrets.includes('sk_test_y'));
});

console.log(`\n${passed} проверки минаха`);
