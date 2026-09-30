#!/usr/bin/env node
/**
 * Еднократно генериране на ясни инструкции BG + EN за всяко упражнение (Gemini) →
 * data/exercise-instructions.json. Приложението само чете файла (0 AI токена при работа).
 * Вече генерираните се пропускат (--force за всички).
 *
 *   GEMINI_API_KEY=... node fitness/scripts/generate-exercise-instructions.mjs [--force]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'data', 'exercise-instructions.json');
const all = JSON.parse(readFileSync(join(root, 'data', 'exercise-dataset.json'), 'utf8'));
const names = JSON.parse(readFileSync(join(root, 'data', 'exercise-translations-bg.json'), 'utf8'));
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
if (!key) { console.error('GEMINI_API_KEY липсва'); process.exit(1); }

let out = {};
try { out = JSON.parse(readFileSync(outFile, 'utf8')); } catch { /* първи run */ }
const force = process.argv.includes('--force');
const pending = all.filter((x) => force || !out[x.id]?.bg || !out[x.id]?.en);
console.log(`чакащи: ${pending.length} / ${all.length}`);

const SYSTEM = `Ти си сертифициран треньор по силова подготовка. За всяко упражнение напиши ясни инструкции за изпълнение
на английски (en) и на естествен, професионален български (bg). Използвай утвърдени български фитнес термини.
Формат на всеки език: 4–6 кратки изречения в ред — начална позиция, изпълнение, дишане/темпо, ключова грешка за избягване.
Без номерация, без markdown. Ако е дадено "source" — следвай го по смисъл, но го направи по-ясно.
Отговор САМО JSON: {"items":[{"id":"...","en":"...","bg":"..."}]}`;

async function gen(batch) {
  const user = JSON.stringify(batch.map((x) => ({
    id: x.id, name: x.name, nameBg: names[x.id]?.nameBg || '', equipment: x.equipment, target: x.target,
    ...(x.instructions?.en ? { source: x.instructions.en.slice(0, 700) } : {}),
  })));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return JSON.parse(text).items || [];
}

const BATCH = 10;
for (let i = 0; i < pending.length; i += BATCH) {
  const batch = pending.slice(i, i + BATCH);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      for (const it of await gen(batch)) {
        if (it?.id && it.bg && it.en) out[it.id] = { en: String(it.en).trim(), bg: String(it.bg).trim() };
      }
      break;
    } catch (e) {
      console.error(`партида ${i / BATCH + 1}, опит ${attempt}: ${e.message}`);
      if (attempt === 3) console.error('пропусната — ще се довърши при следващо пускане');
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  writeFileSync(outFile, JSON.stringify(out));
  console.log(`${Math.min(i + BATCH, pending.length)} / ${pending.length}`);
}
const done = all.filter((x) => out[x.id]?.bg && out[x.id]?.en).length;
console.log(`готови: ${done} / ${all.length}`);
if (done < all.length) process.exitCode = 1;
