#!/usr/bin/env node
/**
 * Бета-тест на Eatologix на телефонен екран, изцяло локално (npm run beta).
 * За всяка персона: въпросник → план → одобрение от админа → вход → план (хранене, „Друго ястие“,
 * следващ ден) → Насоки → Напредък → Профил. Записва грешки, проверки и снимки в beta-report/.
 * Без AI, имейли и живата среда. BETA_ONLY=key1,key2 — само тези персони; BETA_THEME=dark.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStack } from './local-stack.mjs';
import { openBrowser, newPhone } from './driver.mjs';
import { fillQuestionnaire } from './questionnaire.mjs';
import { PERSONAS } from './personas.mjs';
import { screenChecks } from './checks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'beta-report');
const only = (process.env.BETA_ONLY || '').split(',').filter(Boolean);
const personas = only.length ? PERSONAS.filter((p) => only.includes(p.key)) : PERSONAS;
const PASS = 'beta-pass-123';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, dir, name) { const f = path.join(dir, name + '.png'); await page.screenshot({ path: f }); return path.relative(OUT, f); }

async function runPersona(browser, stack, p) {
  const dir = path.join(OUT, p.key); await mkdir(dir, { recursive: true });
  const log = []; const steps = []; const shots = []; const checks = {};
  const step = (name, ok, note = '') => steps.push({ name, ok, note });
  const ctx = await newPhone(browser, stack, { log });
  if (process.env.BETA_THEME) await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch (_) {} }, process.env.BETA_THEME);
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    await page.goto(stack.base + '/questionnaire2.html'); await page.waitForTimeout(1200);
    shots.push(await shot(page, dir, '01-questionnaire'));
    const q = await fillQuestionnaire(page, p);
    step('Въпросник', q.done, q.done ? `${q.trail.length} въпроса` : `спря на ${q.stuck?.id || '?'} ${q.endText ? '— ' + q.endText.slice(0, 120) : ''}`);
    if (!q.done) return { p, steps, log, shots, checks };
    await stack.idle(); await page.waitForTimeout(1500);
    shots.push(await shot(page, dir, '02-after-questionnaire'));

    const clients = await Promise.all(JSON.parse((await stack.kv.get('clients_list')) || '[]').map((id) => stack.kv.get(`client:${id}`, 'json')));
    const client = clients.find((c) => c && (c.answers?.email || '').toLowerCase() === p.answers.email);
    step('Планът е създаден (чака одобрение)', !!client?.plan, client ? `статус ${client.planStatus}` : 'няма запис');
    if (!client) return { p, steps, log, shots, checks };
    const act = await stack.admin('/api/admin/activate-client-plan', { clientId: client.id });
    step('Одобрение от админа', act.status === 200 && act.data?.success, act.data?.emailError ? 'писмото не е пратено (локално няма имейл)' : '');
    await stack.idle();

    await page.goto(stack.base + '/index.html?stay=1&login=1');
    await page.waitForFunction(() => typeof window.indexOpenLoginModal === 'function', null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.indexOpenLoginModal());
    await page.fill('#loginEmailInput', p.answers.email);
    await page.fill('#loginPasswordInput', PASS);
    await page.click('#loginPasswordBtn');
    await page.waitForURL(/tab=plan|plan\.html/, { timeout: 30000 }).catch(() => {});
    await stack.idle(); await page.waitForTimeout(3500);
    step('Вход и отваряне на плана', /tab=plan|plan\.html/.test(page.url()), page.url().replace(stack.base, ''));
    shots.push(await shot(page, dir, '03-welcome'));
    // Посрещането („Да започваме“) е в рамката на плана.
    let welcomed = false;
    for (const f of page.frames()) {
      const start = f.locator('button:has-text("Да започваме")');
      if (await start.count().catch(() => 0)) { await start.first().click(); welcomed = true; await page.waitForTimeout(900); break; }
    }
    step('Посрещане „Да започваме“', welcomed);

    const planFrame = page.frames().find((f) => /plan\.html\?embedded/.test(f.url())) || page.mainFrame();
    await planFrame.waitForSelector('.meal-card', { timeout: 15000 }).catch(() => {});
    const cards = await planFrame.$$eval('.meal-card', (els) => els.length);
    step('Картите на храненията се виждат', cards > 0, `${cards} карти`);
    shots.push(await shot(page, dir, '04-plan'));
    checks.plan = await screenChecks(planFrame);

    // Детайлът на храненето.
    const firstMeal = planFrame.locator('.meal-card:not(.day-energy-card):not(.breakfast-note-card)').first();
    if (await firstMeal.count()) {
      await firstMeal.click(); await page.waitForTimeout(700);
      const open = await planFrame.$eval('#infoModal', (m) => m.classList.contains('active')).catch(() => false);
      step('Детайл на храненето', open);
      shots.push(await shot(page, dir, '05-meal-detail'));
      checks.mealDetail = await screenChecks(planFrame);
      await planFrame.evaluate(() => { try { closeModal(); } catch (_) {} }); await page.waitForTimeout(300);
    }
    // „Друго ястие“.
    const swap = planFrame.locator('.meal-card .meal-swap-btn').first();
    if (await swap.count()) {
      await swap.scrollIntoViewIfNeeded(); await swap.click(); await page.waitForTimeout(900);
      let sheet = await planFrame.$('#mealSwapSheet');
      if (!sheet && process.env.BETA_DEBUG) console.log('[swap debug]', p.key, JSON.stringify(await planFrame.evaluate(() => {
        const b = document.querySelector('.meal-card .meal-swap-btn'); const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { r: [r.left, r.top, r.width, r.height], hit: hit && (hit.className || hit.tagName).toString().slice(0, 60), vh: innerHeight };
      })));
      step('„Друго ястие“ показва варианти', !!sheet);
      shots.push(await shot(page, dir, '06-swap'));
      if (sheet) checks.swap = await screenChecks(planFrame);
      await planFrame.evaluate(() => { try { closeMealSwapSheet(); } catch (_) {} });
    } else step('„Друго ястие“ показва варианти', false, 'няма бутон');
    // Следващ ден.
    const next = planFrame.locator('#dayBannerNext');
    if (await next.count()) {
      await next.click(); await page.waitForTimeout(800);
      const c2 = await planFrame.$$eval('.meal-card', (els) => els.length);
      step('Следващ ден', c2 > 0, `${c2} карти`);
      shots.push(await shot(page, dir, '07-next-day'));
    }
    // Табовете.
    for (const [tab, name, re] of [['guidelines', 'Насоки', /guidelines/], ['analytics', 'Напредък', /game-analytics/], ['profile', 'Профил', /profile/]]) {
      const before = log.length;
      await page.click(`.bottom-nav-item[data-tab-target="${tab}"]`).catch(() => {});
      await page.waitForTimeout(2500);
      // Може да има няколко рамки със същия адрес — взима се тази с най-много съдържание.
      let f = null; let text = 0;
      for (const x of page.frames().filter((fr) => re.test(fr.url()))) {
        const n = await x.evaluate(() => document.body.innerText.trim().length).catch(() => 0);
        if (n > text) { text = n; f = x; }
      }
      const errs = log.slice(before).filter((l) => l.kind === 'js').length;
      step(`Таб „${name}“`, text > 50 && errs === 0, `${text} знака текст${errs ? `, ${errs} JS грешки` : ''}`);
      shots.push(await shot(page, dir, `08-${tab}`));
      if (f) checks[tab] = await screenChecks(f);
    }
  } catch (e) {
    step('Неочаквано прекъсване', false, String(e.message).split('\n')[0].slice(0, 200));
    try { shots.push(await shot(page, dir, '99-error')); } catch (_) {}
  } finally {
    await ctx.close();
  }
  return { p, steps, log, shots, checks, seconds: Math.round((Date.now() - t0) / 1000) };
}

function summarize(results, blocked) {
  const lines = ['# Бета-тест — отчет', '', `Дата: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · телефон Pixel 7 · тема ${process.env.BETA_THEME || 'по подразбиране'}`, ''];
  for (const r of results) {
    const ok = r.steps.filter((s) => s.ok).length;
    lines.push(`## ${r.p.label} — ${ok}/${r.steps.length} стъпки${r.seconds ? ` · ${r.seconds} сек` : ''}`, '');
    for (const s of r.steps) lines.push(`- ${s.ok ? '✅' : '❌'} ${s.name}${s.note ? ` — ${s.note}` : ''}`);
    const js = [...new Set(r.log.filter((l) => l.kind === 'js' || l.kind === 'console').map((l) => `${l.page}: ${l.msg.split('\n')[0]}`))];
    const api = [...new Set(r.log.filter((l) => l.kind === 'api').map((l) => `${l.status} ${l.path}`))];
    if (js.length) lines.push('', '**JS грешки:**', ...js.slice(0, 12).map((x) => `- ${x}`));
    if (api.length) lines.push('', '**Отказани заявки към сървъра:**', ...api.map((x) => `- ${x}`));
    for (const [screen, c] of Object.entries(r.checks || {})) {
      const notes = [];
      if (c.overflowX) notes.push('хоризонтален скрол');
      if (c.smallTargets.length) notes.push(`малки цели (<40px): ${c.smallTargets.join('; ')}`);
      if (c.numericCards.length) notes.push(`калории по картите: ${c.numericCards.join('; ')}`);
      if (notes.length) lines.push('', `**${screen}:** ${notes.join(' · ')}`);
    }
    lines.push('');
  }
  const ext = [...new Set(results.flatMap((r) => r.log.filter((l) => l.kind === 'external').map((l) => l.url)))];
  lines.push('## Външни заявки от браузъра (спрени в теста)', '', ...ext.map((u) => `- ${u}`), '', '## Външни заявки от сървъра (спрени)', '', ...[...new Set(blocked)].map((u) => `- ${u}`), '');
  return lines.join('\n');
}

await mkdir(OUT, { recursive: true });
const stack = await startStack();
const browser = await openBrowser();
const results = [];
const parallel = Number(process.env.BETA_PARALLEL || 2);
for (let i = 0; i < personas.length; i += parallel) {
  results.push(...await Promise.all(personas.slice(i, i + parallel).map((p) => runPersona(browser, stack, p))));
}
await browser.close();
const md = summarize(results, stack.blocked);
await writeFile(path.join(OUT, 'report.md'), md);
await writeFile(path.join(OUT, 'report.json'), JSON.stringify(results.map((r) => ({ ...r, p: r.p.key })), null, 2));
await stack.close();
const failed = results.flatMap((r) => r.steps.filter((s) => !s.ok)).length;
console.log(md);
console.log(failed ? `\n${failed} неуспешни стъпки` : '\nВсички стъпки минаха');
process.exit(0);
