#!/usr/bin/env node
/**
 * Пуска AI класификация през production fitness worker (има GEMINI_API_KEY).
 * node fitness/scripts/run-production-classify-loop.mjs [--force]
 */
const WORKER = process.env.FITNESS_WORKER_URL || 'https://aidiet.radilov-k.workers.dev';
const SECRET = process.env.ADMIN_SECRET || 'nutriplan2024';
const FORCE = process.argv.includes('--force');
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS || 200);
const BATCHES_PER_ROUND = Number(process.env.BATCHES_PER_ROUND || 5);

async function status() {
  const res = await fetch(`${WORKER}/api/admin/fitplan/classify-exercises`, {
    headers: { 'X-Admin-Secret': SECRET },
  });
  return res.json();
}

async function runRound() {
  const res = await fetch(`${WORKER}/api/admin/fitplan/classify-exercises`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': SECRET,
    },
    body: JSON.stringify({ force: FORCE, batches: BATCHES_PER_ROUND, rebuildIndex: false }),
  });
  return res.json();
}

let s = await status();
console.log('Start:', s);

for (let i = 0; i < MAX_ROUNDS && s.remaining > 0; i++) {
  const r = await runRound();
  console.log(`Round ${i + 1}: +${r.addedThisRun} remaining=${r.remaining} complete=${r.complete}`);
  if (!r.addedThisRun) break;
  s = await status();
  await new Promise((res) => setTimeout(res, 1500));
}

console.log('Final:', await status());
