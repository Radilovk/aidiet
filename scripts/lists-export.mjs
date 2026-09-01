#!/usr/bin/env node
/**
 * Export JS catalog sources → data/lists/*.json for manual editing.
 */
import { exportAllLists, LIST_IDS } from './lists-lib.mjs';

const paths = exportAllLists();
console.log('Exported catalog lists:\n');
for (const id of LIST_IDS) {
  const p = paths[LIST_IDS.indexOf(id)];
  console.log(`  ${id.padEnd(18)} → ${p}`);
}
console.log('\nEdit via lists-hub.html or JSON files, then: npm run lists:import');
