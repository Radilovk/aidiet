import { readFileSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PAGE = pathToFileURL(join(ROOT, 'studio.html')).href;
// Playwright: from node_modules (CI: npm i --no-save playwright) or from PLAYWRIGHT_MODULES (a folder with node_modules)
const { chromium } = createRequire(process.env.PLAYWRIGHT_MODULES ? process.env.PLAYWRIGHT_MODULES + '/' : import.meta.url)('playwright');
const launch = () => chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, timeout: 60000 });
const { handleStudioApi } = await import('../../studio-platform/index.js');
const { zonedMs, zonedParts } = await import('../../studio-platform/slots.js');
const OUT = process.env.UI_SHOTS || join(tmpdir(), 'studio-ui-shots');
mkdirSync(OUT, { recursive: true });

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(join(ROOT, 'studio-platform/schema.sql'), 'utf8'));
const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } }) });
const store = new Map();
const env = { STUDIO_DB: { prepare: (s) => stmt(s), batch: async (l) => { for (const s of l) await s.run(); } },
  page_content: { get: async (k) => store.get(k) ?? null, put: async (k, v) => store.set(k, v), delete: async (k) => store.delete(k) },
  STUDIO_MASTER_KEY: 'm'.repeat(20) };
globalThis.fetch = async () => new Response('{}', { status: 404 });
const call = async (method, path, body, headers = {}) => {
  const r = await handleStudioApi(new Request('https://w/api/s/' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  return r.json();
};
const M = { 'X-Master-Key': 'm'.repeat(20) };
await call('POST', 'master/studio', { id: 'burgas', name: 'XBODY Бургас', pin: '12345' }, M);
await call('POST', 'master/studio', { id: 'plovdiv', name: 'EMS Пловдив', pin: '54321' }, M);
const tok = (await call('POST', 'admin/login', { studio: 'burgas', pin: '12345' })).token;
const h = [['08:00', '12:00'], ['15:00', '20:00']];
await call('POST', 'admin/settings', { studio: 'burgas', settings: { brand: { name: 'XBODY Бургас', color: '#d32f2f' }, address: 'бул. Демокрация 15', price: 25,
  slot: { minutes: 30 }, hours: { mon: h, tue: h, wed: h, thu: h, fri: h, sat: h, sun: h }, rules: { minNoticeMin: 60, daysAhead: 30, maxPerDay: 3, maxUpcoming: 6, freeCancelHours: 24, reminderHours: 4 }, guarantee: 'none' } }, { Authorization: 'Bearer ' + tok });
const A = { Authorization: 'Bearer ' + tok };

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
// a fake phone: Capacitor + LocalNotifications that remember what was asked
await ctx.addInitScript(() => {
  const st = JSON.parse(localStorage.getItem('__ln') || '{"perm":"prompt","pending":[],"asked":0,"log":[]}');
  const save = () => localStorage.setItem('__ln', JSON.stringify(st));
  if (!localStorage.getItem('__ln')) save();
  window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
    checkPermissions: async () => ({ display: st.perm }),
    requestPermissions: async () => { st.asked++; st.perm = 'granted'; save(); return { display: 'granted' }; },
    getPending: async () => ({ notifications: st.pending.map((n) => ({ id: n.id })) }),
    cancel: async ({ notifications }) => { st.pending = st.pending.filter((p) => !notifications.some((n) => n.id === p.id)); st.log.push('cancel:' + notifications.length); save(); },
    schedule: async ({ notifications }) => { notifications.forEach((n) => { st.pending.push({ id: n.id, at: new Date(n.schedule.at).getTime(), body: n.body, title: n.title }); }); st.log.push('schedule:' + notifications.length); save(); },
  } } };
});
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('https://aidiet.radilov-k.workers.dev/**', async (route) => {
  const rq = route.request();
  const r = await handleStudioApi(new Request(rq.url(), { method: rq.method(), headers: rq.headers(), body: ['GET', 'HEAD'].includes(rq.method()) ? undefined : rq.postData() }), env, { waitUntil() {} });
  const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
  await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
});
const ln = () => page.evaluate(() => JSON.parse(localStorage.getItem('__ln')));
let fails = 0;
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { fails++; console.log('✗', name, '—', e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/app-fail-${name.replace(/\W+/g, '_')}.png` }); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${a} ≠ ${b}`); };

await page.goto(PAGE);
await step('app, no studio: the picker lists the studios; a click opens one', async () => {
  await page.waitForSelector('#pick-card:not(.hidden) [data-pick]');
  eq(await page.locator('[data-pick]').count(), 2, 'studios');
  await page.screenshot({ path: `${OUT}/app-1-picker.png` });
  await page.click('[data-pick=burgas]');
  await page.waitForSelector('.slot');
  eq(await page.evaluate(() => localStorage.getItem('studio:current')), 'burgas', 'remembered');
});
await step('a wrong studio code is refused', async () => {
  await page.evaluate(() => localStorage.removeItem('studio:current'));
  await page.goto(PAGE);
  await page.waitForSelector('#pick-code');
  await page.fill('#pick-code', 'nope'); await page.click('#pick-go');
  await page.waitForSelector('text=Няма такова студио.');
  await page.fill('#pick-code', 'plovdiv'); await page.click('#pick-go');
  await page.waitForSelector('#s-name:has-text("EMS Пловдив")');
  await page.evaluate(() => localStorage.setItem('studio:current', 'burgas'));
  await page.goto(PAGE);   // opens the last one without any address
  await page.waitForSelector('#s-name:has-text("XBODY Бургас")');
});

let day = '';
await step('book 08:00 and 15:00 (3 days ahead): the notification permission is asked ONCE, after the booking', async () => {
  let days = page.locator('.day.has');
  if ((await days.count()) < 4) { await page.click('#next'); await page.waitForTimeout(700); days = page.locator('.day.has'); }   // end of the month
  await days.nth(Math.min(3, (await days.count()) - 1)).click();
  day = await page.locator('.day.sel').getAttribute('data-day');
  await page.click(`[data-slot="${day} 08:00"]`); await page.click(`[data-slot="${day} 15:00"]`);
  eq((await ln()).asked, 0, 'asked before booking');
  await page.click('#bar-go');
  await page.fill('#b-name', 'Иван Петров'); await page.fill('#b-phone', '0888 111 222'); await page.check('#b-terms');
  await page.click('[data-go=book]');
  await page.waitForSelector('text=Записани ✓');
  eq((await ln()).asked, 1, 'asked');
  await page.screenshot({ path: `${OUT}/app-2-done.png` });
  await page.click('.sheet [data-close]');
});
await step('reminders are 4 h before; 08:00 would be 04:00 → moved to 07:00; no .ics button in the app', async () => {
  const s = await ln();
  eq(s.pending.length, 2, 'pending');
  const at = (hm) => zonedMs(day, hm, 'Europe/Sofia');
  const times = s.pending.map((n) => n.at).sort();
  eq(times[0], at('07:00'), '08:00 hour → 07:00');
  eq(times[1], at('11:00'), '15:00 hour → 11:00');
  if (!/Днес в 08:00/.test(s.pending.find((n) => n.at === at('07:00')).body)) throw new Error('text: ' + JSON.stringify(s.pending.map((n) => n.body)));
  if (await page.locator('a[download]').count()) throw new Error('.ics button shown in the app');
});
await step('move one hour → the reminder follows; cancel → it goes', async () => {
  await page.locator('#mine [data-own]').last().click();
  await page.click('[data-go=move]');
  await page.click(`[data-slot="${day} 16:00"]`);
  await page.click('.sheet [data-go=ok]');
  await page.waitForSelector('text=Часът е преместен ✓');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('__ln')).pending.some((n) => /16:00/.test(n.body)));
  let s = await ln();
  eq(s.pending.length, 2, 'still 2');
  await page.locator('#mine [data-own]').last().click();
  await page.click('[data-go=cancel]'); await page.click('[data-go=cancel]');
  await page.waitForSelector('text=Часът е отказан ✓');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('__ln')).pending.length === 1);
});
await step('a notice from the studio: a banner only (no phone notification); closed → not again', async () => {
  const cur = JSON.parse(db.prepare("SELECT settings FROM studios WHERE id='burgas'").get().settings);
  await call('POST', 'admin/settings', { studio: 'burgas', settings: { ...cur, notice: { id: 1800000009, text: 'Утре сме затворени!', until: Date.now() + 864e5 } } }, A);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('__ln')); s.log = []; localStorage.setItem('__ln', JSON.stringify(s)); });
  await page.goto(PAGE);
  await page.waitForSelector('#notice:not(.hidden)');
  await page.waitForTimeout(800);
  if ((await ln()).pending.some((n) => !(n.id >= 1e9 && n.id < 2e9))) throw new Error('the studio notice became a phone notification');
  await page.screenshot({ path: `${OUT}/app-3-notice.png` });
  await page.click('#notice-x');
  await page.goto(PAGE);
  await page.waitForSelector('.slot');
  if (!(await page.locator('#notice').evaluate((e) => e.classList.contains('hidden')))) throw new Error('shown again');
});
await step('no hidden admin in the app: 7 taps on the logo do nothing', async () => {
  for (let i = 0; i < 8; i++) await page.click('#logo');
  await page.waitForTimeout(400);
  if (await page.locator('.pin input').count()) throw new Error('the admin code form opened in the app');
});
await step('delete my data: server clean, reminders gone, the phone forgets', async () => {
  await page.click('#forget');
  await page.click('.sheet [data-go=yes]');
  await page.waitForSelector('text=Данните са изтрити ✓');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('__ln')).pending.filter((n) => n.id < 2e9 && n.id >= 1e9).length === 0);
  eq(db.prepare("SELECT COUNT(*) n FROM clients WHERE studio_id='burgas'").get().n, 0, 'clients');
  eq(db.prepare("SELECT COUNT(*) n FROM bookings WHERE name = 'Иван Петров'").get().n, 0, 'names');
  await page.waitForFunction(() => !Object.keys(localStorage).some((k) => k.startsWith('st:burgas:me')));
});
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(fails ? 1 : 0);
