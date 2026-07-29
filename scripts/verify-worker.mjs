#!/usr/bin/env node
/**
 * Пълна верификация на worker преди deploy.
 * npm run test:worker
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', ...opts });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim(), status: r.status ?? 1 };
}

const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`❌ ${name}: ${e.message || e}`);
  }
}

check('worker.entry.js синтаксис', () => {
  const r = run('node', ['--check', 'worker.entry.js']);
  if (!r.ok) throw new Error(r.out);
});

check('fitness/worker.js синтаксис', () => {
  const r = run('node', ['--check', 'fitness/worker.js']);
  if (!r.ok) throw new Error(r.out);
});

check('worker typecheck', () => {
  const r = run('node', ['scripts/typecheck-worker.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(0, 20).join('\n'));
});

check('worker.js bundle (без import-и)', () => {
  const r = run('node', ['scripts/bundle-worker.mjs']);
  if (!r.ok) throw new Error(r.out);
  const workerPath = join(root, 'worker.js');
  const size = statSync(workerPath).size;
  if (size < 500_000) throw new Error(`worker.js твърде малък: ${size} bytes`);
  const text = readFileSync(workerPath, 'utf8');
  if (/^import\s+/m.test(text)) {
    throw new Error('worker.js съдържа import-и — не е готов за Cloudflare dashboard');
  }
  if (!text.startsWith('// @ts-nocheck')) {
    throw new Error('worker.js липсва @ts-nocheck — Cloudflare dashboard ще покаже TS грешки');
  }
  if (!text.includes('/// <reference path="./types/worker.d.ts" />')) {
    throw new Error('worker.js липсва reference към types/worker.d.ts');
  }
});

check('worker.js синтаксис', () => {
  const r = run('node', ['--check', 'worker.js']);
  if (!r.ok) throw new Error(r.out);
});

check('wrangler deploy --dry-run', () => {
  const r = run(bin, ['wrangler', 'deploy', '--dry-run', '--env', 'production']);
  if (!r.ok) throw new Error(r.out);
  if (!/Total Upload:/i.test(r.out)) throw new Error('липсва bundle размер в wrangler output');
});

check('production health endpoint', () => {
  const r = run('curl', ['-sS', '-f', 'https://aidiet.radilov-k.workers.dev/api/health'], { timeout: 15000 });
  if (!r.ok) throw new Error(r.out || 'health check failed');
  const data = JSON.parse(r.out);
  if (!data.success) throw new Error(`health: ${r.out}`);
});

check('plan adequacy (offline)', () => {
  const r = run('node', ['scripts/plan-adequacy/run-offline.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-15).join('\n'));
});

check('plan algorithm (offline)', () => {
  const r = run('node', ['scripts/plan-algorithm/run-offline.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-20).join('\n'));
});

check('meal scaling pipeline', () => {
  const r = run('node', ['test-meal-scaling.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('catalog universality stress', () => {
  const r = run('node', ['test-universality-stress.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('fitness тестове', () => {
  const r = run('npm', ['test'], { cwd: join(root, 'fitness') });
  if (!r.ok) throw new Error(r.out.split('\n').slice(-8).join('\n'));
});

console.log('');
if (failures.length) {
  console.error(`❌ ${failures.length} проверки се провалиха: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('✅ Всички worker проверки минаха успешно');
