#!/usr/bin/env node
/**
 * The studio platform from GitHub Actions (studio.yml), with the repo's Cloudflare token — nothing typed by hand.
 *
 *   node scripts/studio-admin.mjs ensure-db                 the D1 database "studios" (made if missing) + its tables;
 *                                                           prints its id (deploy-worker.yml binds it as STUDIO_DB)
 *   node scripts/studio-admin.mjs create <id> <name> <phone>  a studio + its subdomain; a random 5-digit admin code
 *                                                           goes by Viber to <phone> (never into the public log)
 *   node scripts/studio-admin.mjs reset-pin <id> <phone>     a new admin code, by Viber
 *   node scripts/studio-admin.mjs domain <id>                <id>.<STUDIO_ROOT_DOMAIN> → this worker (custom domain)
 *   node scripts/studio-admin.mjs list                       the studios
 *
 * Env: STUDIO_PIN (optional: the admin code, 5 digits, from a private GitHub secret), CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (D1:Edit, Workers KV:Edit, Workers Scripts:Edit; for `domain`
 * also Zone:Read + Workers Routes/Custom Domains:Edit on the zone).
 */
import { execFileSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';

const DB = 'studios';
const KV_ID = '81fc0991b2764918b682f9ca170abd4b';   // page_content (production): the Viber outbox
const WORKER = 'aidiet';
const ROOT = (readFileSync('wrangler.toml', 'utf8').match(/STUDIO_ROOT_DOMAIN\s*=\s*"([^"]+)"/) || [])[1] || 'biocode-bg.com';

function wrangler(args, input) {
  return execFileSync('npx', ['--yes', 'wrangler', ...args], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 24 });
}
function sql(command) {
  const out = wrangler(['d1', 'execute', DB, '--remote', '--json', '--command', command]);
  const data = JSON.parse(out.slice(out.indexOf('[')));
  return (data[0] && data[0].results) || [];
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const fail = (msg) => { console.error(`::error::${msg}`); process.exit(1); };

function phoneOf(p) {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (/^\+\d{9,15}$/.test(d)) return d;
  if (/^0\d{8,9}$/.test(d)) return '+359' + d.slice(1);
  if (/^359\d{8,9}$/.test(d)) return '+' + d;
  return '';
}

/** the same PBKDF2 as the worker (studio-platform/index.js: pinHash) */
function pinHash(pin) {
  const salt = randomBytes(8).toString('hex');
  return `${salt}:${pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex')}`;
}

/** the code by Viber (the shared outbox; viber-sender on the PC sends it) */
function viberPin(phone, studioName, pin) {
  const key = `xbody:out:${String(Date.now()).padStart(13, '0')}:p${randomBytes(4).toString('hex')}:pin`;
  const text = `Admin код за ${studioName}: ${pin}\nВход: 7 пъти върху логото на страницата на студиото. Пазете го в тайна.`;
  wrangler(['kv', 'key', 'put', `--namespace-id=${KV_ID}`, key, JSON.stringify({ to: phone, text, tries: 0 }), '--remote', '--ttl', '86400']);
}

async function cf(method, path, body) {
  const resp = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!data.success) throw new Error(`${method} ${path}: ${JSON.stringify(data.errors || resp.status)}`);
  return data.result;
}

async function domain(id) {
  const host = `${id}.${ROOT}`;
  const zones = await cf('GET', `zones?name=${encodeURIComponent(ROOT)}`);
  if (!zones.length) fail(`Домейнът ${ROOT} не е в този Cloudflare акаунт.`);
  await cf('PUT', `accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/domains`, {
    environment: 'production', hostname: host, service: WORKER, zone_id: zones[0].id,
  });
  console.log(`✓ https://${host} → worker ${WORKER}`);
}

const [action, a1, a2, a3] = process.argv.slice(2);
const summary = [];
try {
  if (action === 'ensure-db') {
    const dbs = () => { const out = wrangler(['d1', 'list', '--json']); return JSON.parse(out.slice(out.indexOf('['))); };
    let db = dbs().find((x) => x.name === DB);
    if (!db) {
      wrangler(['d1', 'create', DB]);
      db = dbs().find((x) => x.name === DB);
      console.error(`✓ създадена база ${DB}`);
    }
    if (!db) fail('Базата не можа да се създаде (токенът има ли D1:Edit?).');
    wrangler(['d1', 'execute', DB, '--remote', '--yes', '--file', 'studio-platform/schema.sql']);
    console.error('✓ таблиците са на място');
    process.stdout.write(db.uuid);
  } else if (action === 'create' || action === 'reset-pin') {
    const id = String(a1 || '').toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(id)) fail('id: малки латински букви, цифри и тире (напр. burgas)');
    // the admin code: from the owner's private GitHub secret (STUDIO_PIN_<ID> or STUDIO_DEFAULT_PIN) — it never appears in
    // the public log; else a random one goes by Viber to the phone (needs viber-sender/ running)
    const fromSecret = /^\d{5}$/.test(String(process.env.STUDIO_PIN || '').trim());
    const phone = phoneOf(action === 'create' ? a3 : a2);
    if (!fromSecret && !phone) {
      fail(`Няма код за вход. Създай GitHub секрет STUDIO_PIN_${id.toUpperCase().replace(/-/g, '_')} (5 цифри; или общ STUDIO_DEFAULT_PIN) ` +
        '(Settings → Secrets and variables → Actions) и пусни отново — или въведи телефон за Viber.');
    }
    const exists = sql(`SELECT id, settings FROM studios WHERE id = ${q(id)}`)[0];
    const pin = fromSecret ? String(process.env.STUDIO_PIN).trim() : String(randomInt(0, 100000)).padStart(5, '0');
    let name = id;
    if (action === 'create') {
      if (exists) fail(`Студио ${id} вече има. За нов код: reset-pin.`);
      name = String(a2 || id).slice(0, 80);
      const settings = JSON.stringify({ brand: { name }, ...(phone ? { phone } : {}) });
      sql(`INSERT INTO studios (id, settings, secrets, pin_hash, version, created_at) VALUES (${q(id)}, ${q(settings)}, '{}', ${q(pinHash(pin))}, 1, ${Date.now()})`);
      summary.push(`✓ студио ${id} („${name}“)`);
      try { await domain(id); summary.push(`✓ адрес https://${id}.${ROOT}`); } catch (e) {
        summary.push(`! поддомейнът не се създаде: ${e.message} — пусни после действие "domain"`);
      }
    } else {
      if (!exists) fail(`Няма студио ${id}.`);
      name = (JSON.parse(exists.settings || '{}').brand || {}).name || id;
      sql(`UPDATE studios SET pin_hash = ${q(pinHash(pin))} WHERE id = ${q(id)}`);
      sql(`DELETE FROM admin_sessions WHERE studio_id = ${q(id)}`);
      summary.push(`✓ нов admin код за ${id}; старите входове са затворени`);
    }
    if (fromSecret) {
      summary.push('✓ кодът за вход е този от твоя GitHub секрет (не се показва тук). Смени го после от Настройки → Сигурност.');
    } else {
      viberPin(phone, name, pin);
      summary.push(`✓ кодът е на опашка за Viber към ${phone.slice(0, 5)}…${phone.slice(-3)} (изпраща го компютърът с viber-sender)`);
    }
  } else if (action === 'domain') {
    await domain(String(a1 || '').toLowerCase());
  } else if (action === 'list') {
    for (const s of sql('SELECT id, settings, version, created_at FROM studios ORDER BY created_at')) {
      summary.push(`${s.id} — ${(JSON.parse(s.settings || '{}').brand || {}).name || ''} · v${s.version} · https://${s.id}.${ROOT}`);
    }
    if (!summary.length) summary.push('(няма студиа)');
  } else {
    fail('действие: ensure-db | create | reset-pin | domain | list');
  }
} catch (e) {
  fail(String(e.stderr || e.message).split('\n').filter(Boolean).slice(-4).join(' | '));
}
if (summary.length) console.log(summary.join('\n'));
