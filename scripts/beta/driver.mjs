/** Браузърът за бета-теста: телефон (Pixel 7), подменен Firebase, сървърът — локалният стек. Записва грешките. */
import { createRequire } from 'node:module';
import { FIREBASE_APP, FIREBASE_AUTH } from './firebase-stub.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ALLOWED_EXTERNAL = /^https:\/\/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com)\//;
const APP_HOSTS = /^https:\/\/(biocode\.website|www\.biocode\.website|nutriin\.app|www\.nutriin\.app|eatologix\.com|www\.eatologix\.com)\//;

export async function openBrowser() { return pw.chromium.launch(); }

/** Нов „телефон“ за една персона. log — масив, в който се трупат проблемите. */
export async function newPhone(browser, stack, { log, device = 'Pixel 7', locale = 'bg-BG' } = {}) {
  // Service worker-ът е изключен: заявките му минават покрай подмените на теста.
  const ctx = await browser.newContext({ ...pw.devices[device], locale, timezoneId: 'Europe/Sofia', serviceWorkers: 'block' });
  // Playwright: последно добавеното правило се проверява първо — общото спиране е най-отдолу.
  await ctx.route(/^https?:\/\//, (route) => {
    const u = route.request().url();
    if (u.startsWith(stack.base) || ALLOWED_EXTERNAL.test(u)) return route.continue();
    if (log) log.push({ kind: 'external', url: u.split('?')[0] });
    return route.abort();
  });
  await ctx.route('https://www.gstatic.com/firebasejs/**', (route) => {
    const u = route.request().url();
    const body = u.endsWith('firebase-auth.js') ? FIREBASE_AUTH : u.endsWith('firebase-app.js') ? FIREBASE_APP : 'export {};';
    return route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
  await ctx.route('https://aidiet.radilov-k.workers.dev/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    try {
      const resp = await route.fetch({ url: stack.base + '/__worker' + u.pathname + u.search });
      if (resp.status() >= 400 && log) log.push({ kind: 'api', status: resp.status(), path: req.method() + ' ' + u.pathname });
      return route.fulfill({ response: resp });
    } catch (e) { return route.abort(); }
  });
  await ctx.route(APP_HOSTS, (route) => {
    const u = new URL(route.request().url());
    return route.continue({ url: stack.base + u.pathname + u.search });
  });
  // Заключването „планът е в редакция“ — изключено и в приложението (само в този тест).
  await ctx.addInitScript(() => { window.__EATOLOGIX_BETA_UNLOCK = true; });
  ctx.on('page', (page) => watch(page, log));
  return ctx;
}

function watch(page, log) {
  if (!log) return;
  const where = () => { try { return new URL(page.url()).pathname; } catch { return '?'; } };
  page.on('pageerror', (e) => log.push({ kind: 'js', page: where(), msg: String(e.message).slice(0, 300) }));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/ERR_FAILED|net::|Failed to load resource/.test(t)) return;   // спрените външни заявки
    log.push({ kind: 'console', page: where(), msg: t.slice(0, 300) });
  });
}
