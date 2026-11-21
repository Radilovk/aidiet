#!/usr/bin/env node
/**
 * Превежда речниците i18n/<език>/*.json на нов език с Gemini (за GitHub Actions; ключът е в GEMINI_API_KEY).
 * Изходният текст е българският (ключовете в "strings"); "keys" и шаблоните в "patterns" се превеждат
 * от английския речник. Преведеното вече не се пипа — пуска се многократно, довършва само липсващото.
 *
 *   node scripts/i18n-translate-dicts.mjs --lang fr [--dir i18n] [--ref en] [--model gemini-3.6-flash]
 *        [--product "Nutriin, a nutrition app"] [--register informal|formal]
 *        [--keys path/to/keys.json --out name]   (отделен списък с български текстове → <dir>/<lang>/<name>.json)
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const LANG = arg('lang');
const DIR = arg('dir', 'i18n');
const REF = arg('ref', 'en');
const MODEL = arg('model', 'gemini-3.6-flash');
const PRODUCT = arg('product', 'Nutriin, a nutrition app (with the modules EmoEat — emotional eating, and IrisMap — iris analysis)');
const REGISTER = arg('register', 'informal');
const KEYS = arg('keys'), OUT = arg('out');
const KEY = process.env.GEMINI_API_KEY;
const NAMES = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese (Brazilian)', tr: 'Turkish', pl: 'Polish', ro: 'Romanian', ru: 'Russian' };
const CYR = /[Ѐ-ӿ]/;
if (!LANG || !NAMES[LANG]) { console.error('--lang: ' + Object.keys(NAMES).join(', ')); process.exit(2); }
if (!KEY) { console.error('GEMINI_API_KEY липсва'); process.exit(2); }
const name = NAMES[LANG];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prompt(srcName, list) {
  const reg = REGISTER === 'formal'
    ? `Address the reader politely/formally, as the source does (Bulgarian "вие"; German "Sie", French "vous", Spanish "usted", Italian "Lei", Portuguese "você", Turkish "siz", Polish "Pan/Pani" forms or impersonal, Romanian "dumneavoastră", Russian "вы").`
    : `Address the reader informally, as the source does (Bulgarian "ти"; German "du", French "tu", Spanish "tú", Italian "tu", Portuguese "você", Turkish "sen", Polish "ty", Romanian "tu", Russian "ты").`;
  return `You are a professional localizer. Translate the user interface and content of ${PRODUCT} from ${srcName} into ${name}.
Rules:
- Natural, idiomatic, concise ${name} as a native app would use it — never word-for-word. Health and nutrition terms as a ${name}-speaking doctor or dietitian would write them.
- ${reg}
- Keep unchanged: numbers, units (g, kcal, ml, kg, cm), emoji, punctuation at the edges, placeholders like $1 $2 and {name}, HTML entities, product names (Nutriin, EmoEat, IrisMap, BIOCODE).
- Short UI labels stay short (buttons, tabs, chips). Bulgarian gendered forms like "уморен/а" → the natural neutral or inclusive ${name} form.
- Food names: the usual ${name} name; a Bulgarian dish with no equivalent keeps its name in Latin letters.
- Translate fully into ${name}; do not leave any ${srcName} words. Do not add quotes, notes or explanations.
Return ONLY a JSON array of exactly ${list.length} strings, in the same order.

${JSON.stringify(list)}`;
}

async function gemini(text) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 32768 } })
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const out = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

const placeholders = (s) => (String(s).match(/\$\d|\{[^}]+\}/g) || []).sort().join(',');
function ok(src, tr) {
  if (typeof tr !== 'string' || !tr.trim()) return false;
  if (LANG !== 'ru' && CYR.test(tr)) return false;
  return placeholders(src) === placeholders(tr);
}

/** Превежда списък (на партиди, по няколко едновременно); връща { src: превод }. */
async function translateAll(srcName, list, label) {
  const res = {};
  const batches = [];
  for (let i = 0; i < list.length; i += 50) batches.push(list.slice(i, i + 50));
  let done = 0;
  const worker = async () => {
    while (batches.length) {
      const b = batches.shift();
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const arr = await gemini(prompt(srcName, b));
          if (!Array.isArray(arr) || arr.length !== b.length) throw new Error(`дължина ${arr?.length} ≠ ${b.length}`);
          b.forEach((s, j) => { if (ok(s, arr[j])) res[s] = arr[j].trim(); });
          break;
        } catch (e) {
          console.warn(`  ${label}: опит ${attempt + 1}: ${e.message}`);
          await sleep(3000 * (attempt + 1));
        }
      }
      done += b.length;
      if (done % 500 < 50) console.log(`  ${label}: ${done}/${list.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return res;
}

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const write = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 1) + '\n'); };

const jobs = KEYS
  ? [{ file: `${OUT}.json`, ref: { _comment: `Автоматичен превод (${MODEL}).`, strings: Object.fromEntries(JSON.parse(fs.readFileSync(KEYS, 'utf8')).map((k) => [k, k])) } }]
  : fs.readdirSync(path.join(DIR, REF)).filter((f) => f.endsWith('.json')).map((file) => ({ file, ref: read(path.join(DIR, REF, file)) }));

let total = 0, missing = 0;
for (const { file, ref } of jobs) {
  const dest = path.join(DIR, LANG, file);
  const cur = read(dest) || {};
  const out = { _comment: (ref._comment || '') + (KEYS ? '' : ` [${name}: автоматичен превод, ${MODEL}]`), strings: {}, ...(ref.keys ? { keys: {} } : {}), ...(ref.patterns ? { patterns: [] } : {}) };
  // strings: българският ключ е изходният текст
  const sKeys = Object.keys(ref.strings || {});
  const todo = sKeys.filter((k) => !(cur.strings && cur.strings[k]));
  const tr = todo.length ? await translateAll('Bulgarian', todo, `${file}`) : {};
  for (const k of sKeys) { const v = cur.strings?.[k] || tr[k]; if (v) out.strings[k] = v; else missing++; }
  // keys и patterns — от английския речник
  if (ref.keys) {
    const ks = Object.keys(ref.keys).filter((k) => !(cur.keys && cur.keys[k]));
    const enList = [...new Set(ks.map((k) => ref.keys[k]))];
    const t2 = enList.length ? await translateAll('English', enList, `${file}/keys`) : {};
    for (const k of Object.keys(ref.keys)) { const v = cur.keys?.[k] || t2[ref.keys[k]]; if (v) out.keys[k] = v; }
  }
  if (ref.patterns) {
    const have = new Map((cur.patterns || []).map(([re, rep]) => [re, rep]));
    const need = ref.patterns.filter(([re]) => !have.has(re)).map(([, rep]) => rep);
    const t3 = need.length ? await translateAll('English', [...new Set(need)], `${file}/patterns`) : {};
    for (const [re, rep] of ref.patterns) { const v = have.get(re) || t3[rep]; if (v) out.patterns.push([re, v]); }
  }
  total += Object.keys(out.strings).length;
  write(dest, out);
  console.log(`${LANG}/${file}: ${Object.keys(out.strings).length}/${sKeys.length}`);
}
console.log(`${LANG}: ${total} превода, липсват ${missing} (ще ги поеме резервният превод)`);
