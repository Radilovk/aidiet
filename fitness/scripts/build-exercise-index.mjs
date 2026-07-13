#!/usr/bin/env node
/**
 * Изгражда компактния индекс на упражненията офлайн и го записва като JSON.
 *
 * По подразбиране Worker-ът сам тегли и кешира базата при първа заявка.
 * Този скрипт е за случаите, когато искаш да заредиш индекса в KV
 * предварително (нулев cold-start fetch) или да provision-неш нов namespace:
 *
 *   node scripts/build-exercise-index.mjs
 *   npx wrangler kv key put exidx:v1 --path data/exercise-index.json \
 *       --binding FITNESS_KV --env production --remote
 *
 * Източникът може да се override-не:
 *   node scripts/build-exercise-index.mjs https://example.com/exercises.json
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { buildCompactIndex } from '../worker.js';

const CANDIDATES = process.argv[2]
  ? [process.argv[2]]
  : [
      'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/exercises.json',
      'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/exercises.json',
      'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/data/exercises.json',
      'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json',
    ];

const OUT_PATH = new URL('../data/exercise-index.json', import.meta.url);

async function main() {
  let raw = null;
  let sourceUrl = null;

  for (const url of CANDIDATES) {
    process.stdout.write(`Опит: ${url} … `);
    try {
      const res = await fetch(url);
      if (!res.ok) { console.log(`HTTP ${res.status}`); continue; }
      const data = await res.json();
      raw = Array.isArray(data) ? data : (data.exercises || data.data || null);
      if (raw && raw.length) { sourceUrl = url; console.log(`OK (${raw.length} записа)`); break; }
      console.log('неочакван формат');
    } catch (e) {
      console.log(e.message);
    }
  }

  if (!raw) {
    console.error('\nНе успях да изтегля базата от нито един източник.');
    console.error('Подай URL ръчно: node scripts/build-exercise-index.mjs <url>');
    process.exit(1);
  }

  const index = buildCompactIndex(raw);
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(index));

  const sizeKb = Math.round(JSON.stringify(index).length / 1024);
  console.log(`\nИндекс: ${index.length} упражнения, ~${sizeKb} KB`);
  console.log(`Записан в: ${OUT_PATH.pathname}`);
  console.log(`Източник:  ${sourceUrl}`);

  // Кратка статистика по оборудване — полезна за проверка срещу спецификацията.
  const byEquipment = {};
  for (const e of index) byEquipment[e.equipment] = (byEquipment[e.equipment] || 0) + 1;
  console.log('\nПо оборудване:');
  for (const [eq, count] of Object.entries(byEquipment).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(count).padStart(5)}  ${eq || '(празно)'}`);
  }
}

main();
