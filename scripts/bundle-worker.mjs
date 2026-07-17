#!/usr/bin/env node
/**
 * Bundle worker.js + всички import-и в един файл за Cloudflare.
 * Wrangler deploy прави същото автоматично; този скрипт е за проверка и ръчен upload.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
const outfile = join(outDir, 'worker.bundled.js');

mkdirSync(outDir, { recursive: true });

const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  bin,
  [
    'esbuild',
    'worker.js',
    '--bundle',
    '--format=esm',
    '--platform=neutral',
    '--target=es2022',
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

console.log(`✅ Bundled → dist/worker.bundled.js`);
if (out) console.log(out);
