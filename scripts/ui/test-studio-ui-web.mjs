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
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{}', { status: 404 });   // no Google, no Stripe here
const call = async (method, path, body, headers = {}) => {
  const r = await handleStudioApi(new Request('https://w/api/s/' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  return r.json();
};
await call('POST', 'master/studio', { id: 'burgas', name: 'XBODY Бургас', pin: '12345' }, { 'X-Master-Key': 'm'.repeat(20) });
const tok = (await call('POST', 'admin/login', { studio: 'burgas', pin: '12345' })).token;
const all = (h) => ({ mon: h, tue: h, wed: h, thu: h, fri: h, sat: h, sun: h });   // every day open: the test must not depend on today's date
await call('POST', 'admin/settings', { studio: 'burgas', settings: { brand: { name: 'XBODY Бургас', tagline: 'EMS тренировки · 20 минути', color: '#d32f2f' },
  address: 'бул. Демокрация 15, Бургас', phone: '0888 123 456', price: 25, texts: { hero: '20 минути EMS = 90 минути класическа тренировка.', message: 'Носете удобни дрехи и вода.' },
  slot: { minutes: 30, buffer: 0 }, hours: all([['08:00', '12:00'], ['15:00', '20:00']]), rules: { minNoticeMin: 60, daysAhead: 30, maxPerDay: 2, maxUpcoming: 6, freeCancelHours: 24 },
  guarantee: 'card_or_code' } }, { Authorization: 'Bearer ' + tok });

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.route('https://aidiet.radilov-k.workers.dev/**', async (route) => {
  const rq = route.request();
  const r = await handleStudioApi(new Request(rq.url(), { method: rq.method(), headers: rq.headers(), body: ['GET', 'HEAD'].includes(rq.method()) ? undefined : rq.postData() }), env, { waitUntil() {} });
  const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
  await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
});
let fails = 0;
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { fails++; console.log('✗', name, e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_')}.png` }); } };

await page.goto(PAGE + '?s=burgas');
await step('studio shown', async () => { await page.waitForSelector('text=XBODY Бургас'); await page.waitForSelector('.slot'); });
await page.screenshot({ path: `${OUT}/1-client.png`, fullPage: true });
await step('pick 2 hours, book (no Stripe → no card)', async () => {
  let days = page.locator('.day.has');
  if ((await days.count()) < 4) { await page.click('#next'); await page.waitForTimeout(700); days = page.locator('.day.has'); }   // end of the month
  await days.nth(Math.min(3, (await days.count()) - 1)).click();
  const slots = page.locator('[data-slot]');
  await slots.nth(0).click(); await slots.nth(1).click();
  await page.waitForSelector('#bar:not(.hidden)');
  await page.click('#bar-go');
  await page.fill('#b-name', 'Иван Петров'); await page.fill('#b-phone', '0888 111 222');
  await page.check('#b-terms');
  await page.screenshot({ path: `${OUT}/2-book.png` });
  await page.click('[data-go=book]');
  await page.waitForSelector('text=Записани ✓');
  await page.screenshot({ path: `${OUT}/3-done.png` });
  await page.click('.sheet [data-close]');
});
await step('my hours after reload; nothing asked again', async () => {
  await page.reload();
  await page.waitForSelector('#mine li .when');
  if ((await page.locator('#mine li .when').count()) !== 2) throw new Error('not 2 hours');
  if (await page.isVisible('#old-client')) throw new Error('login link still shown');
});
await step('move one hour', async () => {
  await page.locator('#mine [data-own]').first().click();
  await page.click('[data-go=move]');
  await page.waitForSelector('#move-banner:not(.hidden)');
  await page.locator('[data-slot]').last().click();
  await page.screenshot({ path: `${OUT}/3b-move.png` });
  await page.click('.sheet [data-go=ok]');
  await page.waitForSelector('text=Часът е преместен ✓');
});
await step('cancel one hour (asks twice)', async () => {
  await page.locator('#mine [data-own]').first().click();
  await page.click('[data-go=cancel]'); await page.click('[data-go=cancel]');
  await page.waitForSelector('text=Часът е отказан ✓');
  await page.waitForFunction(() => document.querySelectorAll('#mine li .when').length === 1);
});
await step('admin: 7 taps, wrong code, right code', async () => {
  for (let i = 0; i < 7; i++) await page.click('#logo');
  await page.waitForSelector('.pin input');
  await page.keyboard.type('11111');
  await page.waitForSelector('text=Грешен код.');
  await page.keyboard.type('12345');
  await page.waitForSelector('#adm .stats');
  await page.screenshot({ path: `${OUT}/4-admin.png` });
});
await step('admin: book a client who called', async () => {
  await page.locator('.days button').nth(3).click();
  await page.click('[data-a=add]');
  await page.fill('#n-name', 'Мария'); await page.fill('#n-phone', '0899 333 444');
  await page.click('.sheet [data-go=save]');
  await page.waitForSelector('text=Записан ✓');
});
await step('admin: clients list', async () => {
  await page.click('[data-tab=clients]');
  await page.waitForSelector('text=Мария');
  await page.waitForSelector('text=Иван Петров');
});
await step('admin: new code', async () => {
  await page.click('[data-tab=codes]');
  await page.click('#k-new');
  await page.fill('#k-label', 'Пакет 10'); await page.fill('#k-per', '10');
  await page.click('.sheet [data-go=save]');
  await page.waitForSelector('text=Пакет 10');
});
await step('admin: settings — rename, change hour length, save', async () => {
  await page.click('[data-tab=settings]');
  await page.screenshot({ path: `${OUT}/5-settings.png`, fullPage: true });
  await page.fill('#s-min', '20');
  await page.click('summary:has-text("Студио")');
  await page.fill('#b-name2', 'XBODY Бургас Център');
  await page.click('#s-save');
  await page.waitForSelector('text=Запазено ✓');
  const st = JSON.parse(db.prepare("SELECT settings FROM studios WHERE id='burgas'").get().settings);
  if (st.slot.minutes !== 20 || st.brand.name !== 'XBODY Бургас Център') throw new Error('not saved ' + JSON.stringify(st.slot));
});
await step('admin: the invitation (code, link, message) for the clients', async () => {
  await page.click('summary:has-text("Покана на клиенти")');
  const link = await page.textContent('#inv-link');
  if (!link.includes('studio.html?s=burgas')) throw new Error('link: ' + link);
  const msg = await page.inputValue('#inv-msg');
  if (!msg.includes('код: burgas') || !msg.includes('Център')) throw new Error('message: ' + msg);   // the studio's current name
  await page.screenshot({ path: `${OUT}/5b-invite.png` });
});
await step('admin: close a day', async () => {
  await page.click('[data-tab=today]');
  await page.click('[data-a=close-day]');
  await page.waitForSelector('text=Почивен ден');
});
await step('back to the client: new name, new hour length', async () => {
  await page.click('#a-out');
  await page.waitForSelector('text=XBODY Бургас Център');
  await page.waitForSelector('text=20 мин');
});
await page.screenshot({ path: `${OUT}/6-client-after.png`, fullPage: true });
console.log('page errors:', errors.length ? errors : 'none');
const rows = db.prepare("SELECT status, source, name FROM bookings").all();
console.log('bookings:', JSON.stringify(rows));
await browser.close();
process.exit(fails ? 1 : 0);
