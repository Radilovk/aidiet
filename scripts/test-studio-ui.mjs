#!/usr/bin/env node
/**
 * The studio page (studio.html) in a real browser against the real API code (SQLite instead of D1, no Google/Stripe):
 * the web flow (client + admin) and the phone-app flow (a fake Capacitor: picker, reminders, notice, delete data).
 * This is the gate before any change to studio.html goes live — the store app loads that page.
 *
 *   npm i --no-save playwright && npx playwright install chromium     (once)
 *   node scripts/test-studio-ui.mjs
 * Locally with a browser already installed: PLAYWRIGHT_MODULES=<folder with node_modules/playwright> PLAYWRIGHT_CHROMIUM=<chrome>
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let failed = 0;
for (const name of ['test-studio-ui-web.mjs', 'test-studio-ui-app.mjs']) {
  console.log(`\n── ${name}`);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(`./ui/${name}`, import.meta.url))], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n❌ ${failed} от 2 набора паднаха` : '\n✅ Страницата за студиа: всички проверки в браузър минаха');
process.exit(failed ? 1 : 0);
