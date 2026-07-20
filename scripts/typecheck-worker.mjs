#!/usr/bin/env node
/**
 * Typecheck на worker.entry.js + backend модули.
 * npm run typecheck:worker
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = join(root, 'typecheck-worker-report.txt');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '-p', 'tsconfig.worker.json', '--pretty', 'false'],
  { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
);

const out = `${result.stdout || ''}${result.stderr || ''}`.trim();
const lines = out ? out.split('\n') : [];
const errorLines = lines.filter((l) => /error TS\d+/.test(l));
const warningLines = lines.filter((l) => /warning TS\d+/.test(l));

writeFileSync(
  reportPath,
  [
    `Worker typecheck — ${new Date().toISOString()}`,
    `Errors: ${errorLines.length}`,
    `Warnings: ${warningLines.length}`,
    '',
    ...lines,
    '',
  ].join('\n'),
  'utf8',
);

if (errorLines.length) {
  const preview = errorLines.slice(0, 15).join('\n');
  const more = errorLines.length > 15
    ? `\n… и още ${errorLines.length - 15} грешки (виж typecheck-worker-report.txt)`
    : '';
  console.error(`❌ ${errorLines.length} TypeScript грешки в worker:\n${preview}${more}`);
  process.exit(result.status ?? 1);
}

console.log(`✅ Worker typecheck OK (${warningLines.length} предупреждения)`);
process.exit(0);
