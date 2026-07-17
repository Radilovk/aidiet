#!/usr/bin/env node
/**
 * Bundle worker.js + всички import-и в ЕДИН файл.
 *
 * Ръчен Cloudflare dashboard upload:
 *   npm run build:worker
 *   → копирай СЪДЪРЖАНИЕТО на worker.deploy.js в Quick edit
 *   → НЕ качвай source worker.js (има import-и → "No such module")
 *
 * Автоматичен deploy: npx wrangler deploy --env production
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
const outfile = join(outDir, 'worker.bundled.js');
const deployFile = join(root, 'worker.deploy.js');

const BANNER = `/**
 * DEPLOY ФАЙЛ — единен bundle за Cloudflare dashboard.
 * Генериран от: npm run build:worker
 * НЕ редактирай ръчно. За разработка ползвай source worker.js + wrangler deploy.
 */
`;

mkdirSync(outDir, { recursive: true });

const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  bin,
  [
    'esbuild',
    'worker.js',
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--target=es2022',
    '--conditions=worker',
    `--outfile=${outfile}`,
    '--log-level=warning',
  ],
  { cwd: root, encoding: 'utf8', stdio: 'pipe' },
);

const out = `${result.stdout || ''}${result.stderr || ''}`.trim();
if (result.status !== 0) {
  console.error('❌ Worker bundle failed:\n', out || result.error?.message);
  process.exit(result.status ?? 1);
}

let bundled = readFileSync(outfile, 'utf8');
if (/^import\s+/m.test(bundled)) {
  console.error('❌ Bundle still contains external imports — не е готов за ръчен upload');
  process.exit(1);
}

writeFileSync(deployFile, BANNER + bundled, 'utf8');
writeFileSync(outfile, bundled, 'utf8');

console.log('✅ worker.deploy.js — качи ТОЗИ файл в Cloudflare dashboard');
console.log('✅ dist/worker.bundled.js — същото съдържание');
if (out) console.log(out);
