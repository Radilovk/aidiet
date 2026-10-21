#!/usr/bin/env node
/**
 * Включване на профилите в облака (Fitbit, Oura, Withings, Strava) от терминала.
 *
 *   npm run links:setup            # пита за всеки доставчик; празно = пропусни
 *   npm run links:setup -- oura    # само един
 *
 * За всеки: адресът на конзолата, адресът за връщане и достъпът, после
 * CLIENT_ID и SECRET → `wrangler secret put … --env production`.
 */
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { PROVIDERS } from '../device-links.js';

const WORKER = process.env.WORKER_URL || 'https://aidiet.radilov-k.workers.dev';
const only = process.argv.slice(2);
const rl = createInterface({ input: process.stdin, output: process.stdout });

function putSecret(name, value) {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name, '--env', 'production'], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  return r.status === 0;
}

for (const [id, p] of Object.entries(PROVIDERS)) {
  if (only.length && !only.includes(id)) continue;
  console.log(`\n── ${p.name} ──`);
  console.log(`1. Създайте приложение: ${p.console}`);
  console.log(`   Адрес за връщане: ${WORKER}/api/links/callback/${id}`);
  console.log(`   Достъп (scope): ${p.scope}`);
  const clientId = (await rl.question(`2. ${p.env}_CLIENT_ID (празно = пропусни): `)).trim();
  if (!clientId) continue;
  const secret = (await rl.question(`   ${p.env}_CLIENT_SECRET: `)).trim();
  if (!secret) { console.log('   Пропуснато — няма SECRET.'); continue; }
  const ok = putSecret(`${p.env}_CLIENT_ID`, clientId) && putSecret(`${p.env}_CLIENT_SECRET`, secret);
  console.log(ok ? `   ✓ ${p.name} е включен.` : `   ✗ wrangler не записа ключовете (вход: npx wrangler login).`);
}
rl.close();
console.log(`\nПроверка: Админ → Мониторинг → „Гривни, часовници, пръстени“.`);
