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

function runTsc(project) {
  return spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '-p', project, '--pretty', 'false'],
    { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
}

const checks = [
  { label: 'worker.entry.js + модули', project: 'tsconfig.worker.json' },
  { label: 'worker.js bundle', project: 'tsconfig.worker-bundle.json' },
];

const sections = [];
let totalErrors = 0;
let totalWarnings = 0;

for (const { label, project } of checks) {
  const result = runTsc(project);
  const out = `${result.stdout || ''}${result.stderr || ''}`.trim();
  const lines = out ? out.split('\n') : [];
  const errorLines = lines.filter((l) => /error TS\d+/.test(l));
  const warningLines = lines.filter((l) => /warning TS\d+/.test(l));
  totalErrors += errorLines.length;
  totalWarnings += warningLines.length;
  sections.push(
    `=== ${label} (${project}) ===`,
    `Errors: ${errorLines.length}`,
    `Warnings: ${warningLines.length}`,
    '',
    ...lines,
    '',
  );
}

writeFileSync(
  reportPath,
  [
    `Worker typecheck — ${new Date().toISOString()}`,
    `Total errors: ${totalErrors}`,
    `Total warnings: ${totalWarnings}`,
    '',
    ...sections,
  ].join('\n'),
  'utf8',
);

if (totalErrors) {
  const preview = sections.join('\n').split('\n').filter((l) => /error TS\d+/.test(l)).slice(0, 15).join('\n');
  const more = totalErrors > 15
    ? `\n… и още ${totalErrors - 15} грешки (виж typecheck-worker-report.txt)`
    : '';
  console.error(`❌ ${totalErrors} TypeScript грешки в worker:\n${preview}${more}`);
  process.exit(1);
}

console.log(`✅ Worker typecheck OK (${totalWarnings} предупреждения)`);
process.exit(0);
