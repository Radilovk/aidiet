#!/usr/bin/env node
/**
 * Bundle worker.entry.js + всички import-и → worker.js (един файл).
 *
 * worker.js на main е готов за:
 *   - Cloudflare dashboard Quick edit (копирай целия файл)
 *   - wrangler deploy
 *
 * Редактирай worker.entry.js + модулите, после: npm run build:worker
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'worker.entry.js');
const outDir = join(root, 'dist');
const outfile = join(outDir, 'worker.bundled.js');
const deployFile = join(root, 'worker.js');

const BANNER = `// @ts-nocheck
/// <reference path="./types/worker.d.ts" />
/**
 * AUTO-GENERATED — не редактирай ръчно.
 * Източник: worker.entry.js + модули → npm run build:worker
 * Качва се в Cloudflare dashboard като worker.js (един файл, без import-и).
 *
 * IDE/Cloudflare: @ts-nocheck + types/worker.d.ts (локално) спират TS шума.
 * CI: npm run typecheck:worker проверява източника и bundle-а.
 */
`;

mkdirSync(outDir, { recursive: true });

const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  bin,
  [
    'esbuild',
    'worker.entry.js',
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
  console.error('❌ Bundle still contains external imports');
  process.exit(1);
}

writeFileSync(deployFile, BANNER + bundled, 'utf8');

console.log('✅ worker.js — готов за Cloudflare dashboard и wrangler deploy');
if (out) console.log(out);
