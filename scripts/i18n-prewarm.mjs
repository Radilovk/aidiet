#!/usr/bin/env node
/**
 * Предварителен превод: праща статичния български текст на страниците към /api/i18n/translate,
 * за да е в KV, преди първият клиент на чужд език да отвори страницата. Пуска се след деплой:
 *   node scripts/i18n-prewarm.mjs [en,de,es,ru] [--api https://aidiet.radilov-k.workers.dev]
 * Безопасно е да се пуска многократно — преведеното вече не струва нищо.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const apiIdx = args.indexOf('--api');
const API = apiIdx >= 0 ? args[apiIdx + 1] : 'https://aidiet.radilov-k.workers.dev';
const langs = (args.find(a => /^[a-z]{2}(,[a-z]{2})*$/.test(a)) || 'en,de,es,ru').split(',');
const PAGES = ['index', 'questionnaire2', 'plan', 'profile', 'analysis', 'analysis-loading', 'plan-pending', 'guidelines',
  'quick-answer', 'game-analytics', 'features', 'help', 'privacy-policy', 'terms', 'delete-account', 'warning',
  'food-picker', 'protocol-landing', 'longevity'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

for (const lang of langs) {
  const all = new Set();
  for (const p of PAGES) {
    if (!fs.existsSync(`${p}.html`)) continue;
    const dictFile = `i18n/${lang}/${p}.json`;
    const list = JSON.parse(execFileSync('python3', ['scripts/i18n-extract.py', `${p}.html`, '--missing', dictFile], { encoding: 'utf8' }));
    list.filter(s => s.length <= 700).forEach(s => all.add(s));
  }
  const strings = [...all];
  let done = 0;
  for (let i = 0; i < strings.length; i += 40) {
    const batch = strings.slice(i, i + 40);
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(`${API}/api/i18n/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, strings: batch }) });
      const d = r.ok ? await r.json() : null;
      if (d && !d.partial) { done += Object.keys(d.translations || {}).length; break; }
      await sleep(2000 * (attempt + 1));
    }
    await sleep(1600); // под тавана от 40 заявки в минута
  }
  console.log(`${lang}: ${done}/${strings.length} низа в кеша`);
}
