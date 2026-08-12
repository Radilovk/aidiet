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

check('weekly adapt guardrails', () => {
  const r = run('node', ['scripts/test-weekly-adapt-guardrails.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('profile regen field classification', () => {
  const r = run('node', ['scripts/test-plan-regen-fields.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('profile regen HTML sync', () => {
  const r = run('node', ['scripts/test-profile-regen-sync.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('food-picker per-user contract', () => {
  const r = run('node', ['scripts/test-food-picker-contract.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('skip-breakfast contract', () => {
  const r = run('node', ['scripts/test-skip-breakfast.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('plan reconcile paths', () => {
  const r = run('node', ['scripts/test-plan-reconcile.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('late snack mealBreakdown clamp', () => {
  const r = run('node', ['scripts/test-late-snack-normalize.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('ready meal decompose', () => {
  const r = run('node', ['scripts/test-ready-meal-expand.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('plan adequacy contract', () => {
  const r = run('node', ['scripts/test-plan-adequacy-contract.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-12).join('\n'));
});

check('plan adequacy nutrition math', () => {
  const r = run('node', ['scripts/test-plan-adequacy-nutrition.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-12).join('\n'));
});

check('plan adequacy dietetic logic', () => {
  const r = run('node', ['scripts/test-plan-adequacy-dietetic.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-12).join('\n'));
});

check('questionnaire deterministic validation', () => {
  const r = run('node', ['scripts/test-questionnaire-validation.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('plan normalize (scheme + analysis)', () => {
  const r = run('node', ['scripts/test-plan-normalize.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('calorie target vs achieved sync', () => {
  const r = run('node', ['scripts/test-calorie-target-sync.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('diet registry universal', () => {
  const r = run('node', ['scripts/test-diet-registry.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('registry architecture', () => {
  const r = run('node', ['scripts/test-registry-arch.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('precision-first Step 3', () => {
  const r = run('node', ['scripts/test-precision-first.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('rebuild stage 1.7+2', () => {
  const r = run('node', ['scripts/test-rebuild-stage17-2.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('rebuild stage2 week-at-once', () => {
  const r = run('node', ['scripts/test-rebuild-stage2-week.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('stage3 food ledger and admin catalog', () => {
  const r = run('node', ['scripts/test-stage3-food.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('plan analytics sync contract', () => {
  const r = run('node', ['scripts/test-plan-analytics-sync.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('meal solver pipeline', () => {
  const r = run('node', ['scripts/test-solver.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('chunk validation kcal-first split', () => {
  const r = run('node', ['scripts/test-chunk-validation.mjs']);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-10).join('\n'));
});

check('matrix profile fixtures', () => {
  const r = run('node', ['scripts/test-matrix-profiles.mjs']);
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
