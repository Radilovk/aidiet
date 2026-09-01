#!/usr/bin/env node
/**
 * Import data/lists/*.json → JS source files.
 */
import { importAllLists } from './lists-lib.mjs';

try {
  const counts = importAllLists();
  console.log('Imported catalog lists:\n');
  for (const [id, count] of Object.entries(counts)) {
    console.log(`  ${id.padEnd(18)} ${count} entries`);
  }
  console.log('\nRun tests:');
  console.log('  node scripts/test-meal-dishes.mjs');
  console.log('  node scripts/test-catalog-coverage.mjs');
  console.log('  npm run build:worker');
} catch (e) {
  console.error('Import failed:', e.message);
  process.exit(1);
}
