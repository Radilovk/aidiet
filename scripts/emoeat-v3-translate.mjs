#!/usr/bin/env node
/**
 * Преводите на EmoEat v3 (въпросите и резултата) — i18n/<език>/emoeat.json.
 *
 * Изходната версия е английската: en се превежда от българския, а всички други езици — от
 * английския (с българския до него само за справка). Преводът е адаптация, не дословен: всеки
 * въпрос е сцена от обикновен ден, която трябва да звучи естествено за човек от тази култура.
 * След превода друг модел превежда обратно на английски и сравнява смисъла; където смисълът се е
 * изместил, низът се превежда наново с бележката. Вече преведеното не се пипа.
 *
 *   OPENAI_API_KEY=… node scripts/emoeat-v3-translate.mjs --lang en|de|es|ru|fr|it|pt|tr|pl|ro|all
 *        [--model gpt-5.5] [--check-model gpt-5.4] [--only "bg текст"]
 *
 * Списъкът идва от scripts/emoeat-v3-strings.mjs (само липсващите в речника на езика).
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const LANGS = { en: 'English', de: 'German', es: 'Spanish (Spain)', ru: 'Russian', fr: 'French', it: 'Italian', pt: 'Portuguese (Brazilian)', tr: 'Turkish', pl: 'Polish', ro: 'Romanian' };
const which = arg('lang');
const MODEL = arg('model', 'gpt-5.5');
const CHECK = arg('check-model', 'gpt-5.4');
const KEY = process.env.OPENAI_API_KEY || 'sk-dummy';
if (!which || (which !== 'all' && !LANGS[which])) { console.error('--lang ' + Object.keys(LANGS).join('|') + '|all'); process.exit(2); }
const dictPath = (l) => new URL(`../i18n/${l}/emoeat.json`, import.meta.url);
const load = (l) => JSON.parse(fs.readFileSync(dictPath(l), 'utf8'));
const save = (l, d) => fs.writeFileSync(dictPath(l), JSON.stringify(d, null, 2) + '\n');
const missing = (l) => JSON.parse(execFileSync('node', [new URL('./emoeat-v3-strings.mjs', import.meta.url).pathname, '--missing', dictPath(l).pathname], { encoding: 'utf8' }))
  .filter(s => !/[<>]/.test(s));

const ABOUT = `EmoEat is a short psychological test inside a nutrition app. Its key idea: the questions never mention food, eating, weight or guilt. They are small scenes from ordinary days (an unpleasant message before sleep, an empty Sunday afternoon, a mistake at work, a friend who goes quiet, childhood memories). From the answers the app infers personality traits that research links to emotional eating, and only the RESULT screen talks about food.
How the text must sound:
- Like a friend who knows you, asking across the table. Conversational, warm, concrete. Never like a survey, a psychologist, a corporate app or a translation.
- Answer options are lines a person would actually say out loud. Keep their different lengths and their small humour ("Pure torture").
- Use the everyday words a native speaker would use. No calques, no therapy jargon ("process emotions", "self-care", "space", "triggers", "mindful"), no AI tells (em dashes everywhere, "not just X but Y", triads, exclamation marks).
- Address the reader informally (du / tú / ты / tu / sen / ty / você).
- The source avoids gendered forms; keep it gender-neutral where the language allows it naturally (rephrase rather than use slashes). Strings that contain "/а" or "/на" are generic texts for both genders: use a natural neutral form.
- Scenes may be adapted to local life if a literal detail would sound foreign, but the situation and what each answer reveals must stay the same.
- Keep numbers, ranges (6–7), "116 111", "ADHD", "AI", "SOS", "Nutriin", "EmoEat", curly quotes converted to the language's usual quotation marks.
- Never add words about food to a question where the source has none.`;

async function chat(model, system, user) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' } })
    });
    if (r.ok) {
      const d = await r.json();
      try { return JSON.parse(d.choices[0].message.content); } catch (e) { /* опитай пак */ }
    } else console.error(`  ${model}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
  }
  throw new Error('OpenAI: no answer');
}

async function translateBatch(lang, items, notes) {
  const name = LANGS[lang];
  const fromEn = lang !== 'en';
  const list = items.map((it, i) => ({ i, source: fromEn ? it.en : it.bg, ...(fromEn ? { bg_reference: it.bg } : {}), ...(notes && notes[i] ? { fix: notes[i] } : {}) }));
  const sys = `You are a native ${name} writer adapting the copy of a psychological test.\n${ABOUT}`;
  const user = `Translate each "source" (${fromEn ? 'English' : 'Bulgarian'}) into natural ${name}.${fromEn ? ' "bg_reference" is the Bulgarian original, only for checking meaning.' : ''} Items with "fix" were translated before and the meaning drifted: follow the note.
Return JSON {"t": {"<i>": "<translation>", ...}} with every i.

${JSON.stringify(list)}`;
  const out = await chat(MODEL, sys, user);
  return items.map((_, i) => (out.t || {})[i]);
}

async function check(lang, items, translated) {
  if (lang === 'en') return {};
  const list = items.map((it, i) => ({ i, english_source: it.en, translation: translated[i] }));
  const sys = `You check ${LANGS[lang]} translations of a psychological test for meaning, not style. ${ABOUT}`;
  const user = `For each item, translate "translation" back into English in your head and compare with "english_source". Flag ONLY items where the meaning changed in a way that matters for the test (a different situation, a different feeling, a stronger or weaker answer, a food word added, a lost nuance that changes what the answer reveals), or where it sounds unnatural/robotic to a native speaker. Return JSON {"bad": {"<i>": "short note what is wrong and how to fix"}}; an empty object if all are fine.

${JSON.stringify(list)}`;
  const out = await chat(CHECK, sys, user);
  return out.bad || {};
}

async function run(lang) {
  const dict = load(lang);
  dict.strings = dict.strings || {};
  const en = lang === 'en' ? null : load('en').strings;
  const todo = missing(lang).map(bg => ({ bg, en: en ? en[bg] : null })).filter(it => lang === 'en' || it.en);
  console.log(`${lang}: ${todo.length} низа`);
  for (let s = 0; s < todo.length; s += 50) {
    const batch = todo.slice(s, s + 50);
    let t = await translateBatch(lang, batch);
    const bad = await check(lang, batch, t);
    const idx = Object.keys(bad).map(Number).filter(i => batch[i]);
    if (idx.length) {
      console.log(`  ${lang} ${s}: поправка на ${idx.length}`);
      const sub = idx.map(i => batch[i]);
      const notes = Object.fromEntries(idx.map((i, k) => [k, bad[i]]));
      const fixed = await translateBatch(lang, sub, notes);
      idx.forEach((i, k) => { if (fixed[k]) t[i] = fixed[k]; });
    }
    batch.forEach((it, i) => {
      const v = (t[i] || '').trim();
      if (!v) return;
      if (lang !== 'ru' && /[Ѐ-ӿ]/.test(v)) return;   // недовършен превод — остава за следващото пускане
      dict.strings[it.bg] = v;
    });
    save(lang, dict);
  }
}

const langs = which === 'all' ? Object.keys(LANGS) : [which];
if (which === 'all' && langs[0] !== 'en') langs.unshift('en');
for (const l of langs) await run(l);
