#!/usr/bin/env node
/**
 * Validate data/lists/*.json without writing JS files.
 */
import { LIST_IDS, readListJson, validateList } from './lists-lib.mjs';

let fail = 0;
for (const id of LIST_IDS) {
  try {
    const doc = readListJson(id);
    const errors = validateList(id, doc);
    if (errors.length) {
      fail++;
      console.error(`✗ ${id}: ${errors.length} error(s)`);
      for (const e of errors.slice(0, 8)) console.error(`    - ${e}`);
      if (errors.length > 8) console.error(`    … +${errors.length - 8} more`);
    } else {
      let count = doc.count ?? doc.dishes?.length ?? doc.items?.length;
      if (count == null && doc.entries) count = Object.keys(doc.entries).length;
      if (count == null && id === 'portion-limits') {
        count = Object.keys(doc.itemMax || {}).length;
      }
      console.log(`✓ ${id} (${count ?? '—'} entries)`);
    }
  } catch (e) {
    fail++;
    console.error(`✗ ${id}: ${e.message}`);
  }
}
process.exit(fail ? 1 : 0);
