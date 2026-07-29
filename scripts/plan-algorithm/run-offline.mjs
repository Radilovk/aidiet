#!/usr/bin/env node
/**
 * Full offline test suite for plan algorithm — dietetic math, sync, regen contracts.
 * npm run test:plan-algorithm
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const suites = [
  'scripts/plan-algorithm/tests/metabolism.mjs',
  'scripts/plan-algorithm/tests/scheme-sync.mjs',
  'scripts/plan-algorithm/tests/meal-validation.mjs',
  'scripts/plan-algorithm/tests/blocked-terms.mjs',
  'scripts/plan-algorithm/tests/profile-regen.mjs',
  'scripts/plan-algorithm/tests/food-picker.mjs',
  'scripts/plan-algorithm/tests/source-sync.mjs',
];

let failed = 0;
console.log('=== Plan algorithm (offline) ===\n');

for (const rel of suites) {
  const r = spawnSync(process.execPath, [join(root, rel)], { cwd: root, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.status === 0) {
    console.log(`✓ ${rel}`);
    for (const line of out.split('\n').filter(l => l.startsWith('  ✓') || l.startsWith('  ✗'))) {
      console.log(line);
    }
  } else {
    failed++;
    console.log(`✗ ${rel}`);
    console.log(out.split('\n').slice(-30).join('\n'));
  }
}

console.log(`\n=== Обобщение: ${suites.length - failed}/${suites.length} suites PASS ===`);
process.exit(failed > 0 ? 1 : 0);
