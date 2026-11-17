#!/usr/bin/env node
/**
 * Автоматично прилагане на редакциите от лендингите (wording-editor.js → KV wording:*).
 *
 *   node scripts/wording-apply.mjs --records recs.json --imgdir dir --repo aidiet|airis [--applied out.txt] [--no-ai]
 *
 * recs.json — масив от записите (както ги пази worker-ът); imgdir — качените снимки, именувани
 * <id без „:“>-<n>.<ext> (както ги сваля workflow-ът). Последният запис за едно място печели.
 *
 * Снимки: WebP 640/1280 в brand/photos, ново съдържание на <figure data-slot> (ред, кадър, ефект, рамка),
 *         кратко описание (alt) от Gemini и превод на всички езици.
 * Текст:  заменя се, ако старият текст е точно един текстов възел в HTML; новият минава лека проверка
 *         на правописа (Gemini, без пренаписване) и се превежда на всички езици в речниците.
 *         Текст, който обхваща няколко елемента (напр. заглавие с <em>), не се пипа — остава за ръчно.
 * В --applied се пишат ID-тата на записите, приложени изцяло (те се трият от KV); останалите чакат.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const RECS = JSON.parse(fs.readFileSync(arg('records'), 'utf8'));
const IMGDIR = arg('imgdir', 'wording/inbox-img');
const REPO = arg('repo', 'aidiet');
const APPLIED = arg('applied');
const MODEL = arg('model', 'gemini-3.6-flash');
const KEY = process.argv.includes('--no-ai') ? '' : process.env.GEMINI_API_KEY;

const CFG = REPO === 'airis'
  ? { photos: 'public/brand/photos', src: 'brand/photos/', i18n: 'public/i18n', register: 'formal',
      product: 'IrisMap, an iris-analysis app (part of the Eatologix platform)',
      route: (r) => (/irismap|airis/i.test(r.site + r.page) ? 'index.html' : null) }
  : { photos: 'brand/photos', src: 'brand/photos/', i18n: 'i18n', register: 'informal',
      product: 'Eatologix, a personal nutrition plan app (with the modules EmoEat — emotional eating, and IrisMap — iris analysis)',
      route: (r) => {
        if (/irismap|airis/i.test(r.site)) return null;
        const p = String(r.page || '/').replace(/^\/aidiet/, '');
        if (/emoeat-landing\.html$/.test(p) || (/emoeat\.app$/.test(r.site) && (p === '/' || p === ''))) return 'emoeat-landing.html';
        if (p === '/' || p === '' || p === '/index.html') return 'index.html';
        const f = path.basename(p);
        return /\.html$/.test(f) && fs.existsSync(f) ? f : null;
      } };

const NAMES = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese (Brazilian)', tr: 'Turkish', pl: 'Polish', ro: 'Romanian', ru: 'Russian' };
const LANGS = fs.existsSync(CFG.i18n) ? fs.readdirSync(CFG.i18n).filter((l) => NAMES[l]) : [];
const log = [];
const say = (s) => { log.push(s); console.log(s); };
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (t) => esc(t).replace(/"/g, '&quot;');
const decode = (t) => String(t).replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&amp;/g, '&');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Gemini ─────────────────────────────────────────────────────────────────
async function gemini(parts, json = true) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}), maxOutputTokens: 8192 } })
      });
      if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const d = await r.json();
      const out = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      return json ? JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, '')) : out.trim();
    } catch (e) { console.warn(`  gemini опит ${a + 1}: ${e.message}`); await sleep(2500 * (a + 1)); }
  }
  throw new Error('Gemini не отговаря');
}

/** Лека проверка на правописа: поправя само явни грешки, не пренаписва. */
async function proofread(list) {
  if (!KEY || !list.length) return list;
  try {
    const out = await gemini([{ text: `You are a careful Bulgarian proofreader for ${CFG.product}. For each text below fix ONLY clear spelling, grammar, agreement and punctuation errors (incl. Bulgarian quotes „…“ and dashes —). Do NOT rephrase, shorten, translate or change style, meaning or word choice. If a text is correct, return it unchanged.
Return ONLY a JSON array of exactly ${list.length} strings, same order.

${JSON.stringify(list)}` }]);
    return Array.isArray(out) && out.length === list.length ? out.map((s, i) => (typeof s === 'string' && s.trim() ? s : list[i])) : list;
  } catch { return list; }
}

/** Кратко описание на снимка (alt) на български. */
async function describe(buf, mime) {
  if (!KEY) return '';
  try {
    const t = await gemini([{ inlineData: { mimeType: mime, data: buf.toString('base64') } },
      { text: 'Write a short Bulgarian alt text for this photo on a health/nutrition website: 4–10 words, plain description of what is visible (people, action, setting). No "Снимка на", no quotes, no final period. Return only the text.' }], false);
    return norm(t).replace(/^["„“]|["“”]$/g, '').replace(/\.$/, '').slice(0, 140);
  } catch { return ''; }
}

/** Превод на списък български текстове на един език; ref — стар превод за последователност. */
async function translate(lang, items) {
  if (!KEY || !items.length) return {};
  const reg = CFG.register === 'formal'
    ? 'Address the reader politely/formally (German "Sie", French "vous", Spanish "usted", Italian "Lei", Russian "вы", Polish formal or impersonal, Romanian "dumneavoastră", Turkish "siz").'
    : 'Address the reader informally (German "du", French "tu", Spanish "tú", Italian "tu", Russian "ты", Polish "ty", Romanian "tu", Turkish "sen").';
  const res = {};
  try {
    const out = await gemini([{ text: `You are a professional localizer of ${CFG.product}. Translate each Bulgarian text into ${NAMES[lang]}.
Rules: natural, idiomatic marketing/UI ${NAMES[lang]} as a native copywriter would write it — never word-for-word, keep the meaning and every concrete fact. ${reg}
Keep numbers, units, emoji, product names (Eatologix, EmoEat, IrisMap) unchanged. Where "previous" is given, it is the earlier version of the same place and its translation — keep terminology consistent with it.
Return ONLY a JSON array of exactly ${items.length} strings, same order.

${JSON.stringify(items.map((x) => (x.prev ? { bg: x.bg, previous: x.prev } : { bg: x.bg })))}` }]);
    if (Array.isArray(out) && out.length === items.length) items.forEach((x, i) => {
      const v = out[i];
      if (typeof v === 'string' && v.trim() && (lang === 'ru' || !/[Ѐ-ӿ]/.test(v))) res[x.bg] = v.trim();
    });
  } catch (e) { console.warn(`  превод ${lang}: ${e.message}`); }
  return res;
}

// ── Снимки ─────────────────────────────────────────────────────────────────
let sharp = null;
async function loadSharp() { if (!sharp) sharp = (await import('sharp')).default; return sharp; }
function imgFile(key) {
  const base = key.replace(/^wording-img:/, '').replace(/:/g, '-');
  for (const ext of ['webp', 'jpg', 'png']) { const f = path.join(IMGDIR, `${base}.${ext}`); if (fs.existsSync(f)) return f; }
  return null;
}
async function savePhoto(file, stem) {
  const sh = await loadSharp();
  const buf = fs.readFileSync(file);
  const meta = await sh(buf).metadata();
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
  const widths = [640, 1280].filter((w) => w <= meta.width);
  if (!widths.length) widths.push(meta.width);
  fs.mkdirSync(CFG.photos, { recursive: true });
  const out = [];
  for (const w of widths) {
    const name = `${stem}-${hash}-${w}.webp`;
    const info = await sh(buf).rotate().resize({ width: w }).webp({ quality: 82 }).toFile(path.join(CFG.photos, name));
    out.push({ src: CFG.src + name, w: info.width, h: info.height });
  }
  return { out, buf, mime: meta.format === 'png' ? 'image/png' : meta.format === 'jpeg' ? 'image/jpeg' : 'image/webp' };
}
const frameAttrs = (it) => ((it.x !== 50 || it.y !== 50 || it.z !== 1)
  ? ` data-x="${+(+it.x).toFixed(1)}" data-y="${+(+it.y).toFixed(1)}" data-z="${+(+it.z).toFixed(2)}"` : '')
  + (['mobile', 'desktop'].includes(it.only) ? ` data-only="${it.only}"` : ''); // само телефон / само компютър
const stripFrame = (tag) => tag.replace(/\s+data-(?:[xyz]|only)="[^"]*"/g, '');
function setAttr(tag, name, v) {
  const re = new RegExp(`\\s${name}="[^"]*"`);
  tag = tag.replace(re, '');
  return v ? tag.replace(/>$/, ` ${name}="${escAttr(v)}">`) : tag;
}

// ── Главно ─────────────────────────────────────────────────────────────────
const files = {};       // file → { html, dict, changed }
const newStrings = {};  // dict → [{ bg, prev }]
const dropStrings = {}; // dict → Set(стари текстове)
const applied = [];
const recs = [...RECS].sort((a, b) => String(a.id).localeCompare(String(b.id)));

function open(file) {
  if (!files[file]) {
    const html = fs.readFileSync(file, 'utf8');
    const m = html.match(/<meta\s+name="i18n-page"\s+content="([^"]+)"/);
    const dict = m ? m[1].split(',')[0].trim() : path.basename(file, '.html');
    files[file] = { html, dict, changed: false };
  }
  return files[file];
}

// снимките: последното състояние на всяко място
const slotState = {}; // file|slot → { slot, recId }
for (const r of recs) {
  const file = CFG.route(r); if (!file || !fs.existsSync(file)) continue;
  for (const s of r.slots || []) slotState[`${file}|${s.slot}`] = { file, s, rec: r };
}

const recOk = Object.fromEntries(recs.filter((r) => CFG.route(r)).map((r) => [r.id, true]));

// правописът на всички нови текстове — с една заявка
const allNew = [...new Set(recs.filter((r) => CFG.route(r)).flatMap((r) => (r.edits || []).map((e) => norm(e.new)).filter(Boolean)))];
const proofed = new Map(allNew.map((t, i, a) => [t, t]));
{ const out = await proofread(allNew); allNew.forEach((t, i) => proofed.set(t, out[i])); }

for (const r of recs) {
  const file = CFG.route(r);
  if (!file || !fs.existsSync(file)) continue;
  const F = open(file);
  // текст
  const edits = (r.edits || []).filter((e) => norm(e.old) && norm(e.old) !== norm(e.new));
  const fixed = edits.map((e) => proofed.get(norm(e.new)) || norm(e.new));
  edits.forEach((e, i) => {
    const old = norm(e.old), neu = fixed[i];
    const hits = [];
    F.html.replace(/>([^<>]+)</g, (m, txt, off) => { if (norm(decode(txt)) === old) hits.push({ off: off + 1, txt }); return m; });
    if (!hits.length) { recOk[r.id] = false; say(`✋ ${file}: „${old.slice(0, 60)}“ — не е цял текстов възел (с вътрешни елементи?) — за ръчно`); return; }
    for (const h of hits.reverse()) {
      const lead = h.txt.match(/^\s*/)[0], trail = h.txt.match(/\s*$/)[0];
      F.html = F.html.slice(0, h.off) + lead + esc(neu) + trail + F.html.slice(h.off + h.txt.length);
    }
    F.changed = true;
    (newStrings[F.dict] ||= []).push({ bg: neu, prev: old });
    (dropStrings[F.dict] ||= new Set()).add(old);
    say(`✓ ${file}: „${old.slice(0, 50)}“ → „${neu.slice(0, 60)}“${neu !== norm(e.new) ? ' (поправен правопис)' : ''}`);
  });
}

for (const { file, s, rec } of Object.values(slotState)) {
  const F = open(file);
  const re = new RegExp(`(<figure\\b[^>]*\\bdata-slot="${s.slot.replace(/[^\w-]/g, '')}"[^>]*>)([\\s\\S]*?)(</figure>)`);
  const m = F.html.match(re);
  if (!m) { recOk[rec.id] = false; say(`✋ ${file}: няма място „${s.slot}“`); continue; }
  let [, open_, inner] = m;
  const oldImgs = inner.match(/<img\b[^>]*>/g) || [];
  const hidden = /aria-hidden="true"/.test(open_);
  const sizes = (oldImgs[0] || '').match(/\ssizes="([^"]*)"/)?.[1] || (hidden ? '100vw' : '(max-width: 899px) 92vw, 560px');
  const stem = `${path.basename(file, '.html')}-${s.slot}`.replace(/[^\w-]/g, '');
  const tags = [];
  let ok = true;
  // всички снимки на мястото — обработка и описание едновременно (по-бързо от една по една)
  const prep = await Promise.all((s.items || []).map(async (it) => {
    const f = it.key && imgFile(it.key);
    if (!f) return null;
    const r = await savePhoto(f, stem);
    r.alt = hidden ? '' : await describe(r.buf, r.mime);
    return r;
  }));
  for (const [i, it] of (s.items || []).entries()) {
    const lazy = i === 0 && s.slot === 'hero' ? ' fetchpriority="high"' : ' loading="lazy"';
    if (it.key) {
      if (!prep[i]) { ok = false; say(`✋ ${file}/${s.slot}: липсва качената снимка ${it.key}`); continue; }
      const { out, alt } = prep[i];
      if (alt) (newStrings[F.dict] ||= []).push({ bg: alt });
      const big = out[out.length - 1];
      const srcset = out.length > 1 ? ` srcset="${out.map((o) => `${o.src} ${o.w}w`).join(', ')}" sizes="${sizes}"` : '';
      tags.push(`<img src="${big.src}"${srcset} alt="${escAttr(alt)}"${hidden ? ' aria-hidden="true"' : ''} width="${big.w}" height="${big.h}"${lazy} decoding="async"${frameAttrs(it)}>`);
    } else {
      const old = oldImgs.find((t) => t.includes(`src="${it.src}"`));
      let tag = old ? stripFrame(old) : `<img src="${escAttr(it.src)}" alt="${escAttr(it.alt || '')}"${lazy} decoding="async">`;
      tag = tag.replace(/\s(?:loading|fetchpriority)="[^"]*"/g, '').replace(/>$/, `${lazy}>`).replace(/>$/, `${frameAttrs(it)}>`);
      tags.push(tag);
    }
  }
  if (!ok) { recOk[rec.id] = false; continue; }
  // старите описания, които отпадат
  for (const t of oldImgs) {
    const alt = decode(t.match(/\salt="([^"]*)"/)?.[1] || '');
    if (alt && !tags.some((n) => n.includes(`alt="${escAttr(alt)}"`))) (dropStrings[F.dict] ||= new Set()).add(alt);
  }
  open_ = setAttr(open_, 'data-fx', s.fx); open_ = setAttr(open_, 'data-every', s.every);
  open_ = setAttr(open_, 'data-ratio', s.ratio); open_ = setAttr(open_, 'data-width', s.width);
  const ind = (inner.match(/^\n(\s*)/) || [])[1];
  const body = tags.length ? (ind != null ? '\n' + tags.map((t) => ind + t).join('\n') + '\n' + ind.slice(4) : tags.join('')) : '';
  F.html = F.html.replace(re, `${open_}${body}</figure>`);
  F.changed = true;
  say(`✓ ${file}: място „${s.slot}“ — ${tags.length} снимки${tags.length > 1 ? `, ефект ${s.fx || 'fade'} през ${s.every || 6} с` : ''}`);
}

// записи, които не касаят тази страница (бележка без нищо друго) — оставят се за ръчно
for (const r of recs) {
  if (!CFG.route(r)) continue;
  if (norm(r.note)) { recOk[r.id] = false; say(`✋ ${r.id}: бележка — за ръчно: „${norm(r.note).slice(0, 120)}“`); }
}

// ── речници ───────────────────────────────────────────────────────────────
for (const [file, F] of Object.entries(files)) if (F.changed) fs.writeFileSync(file, F.html);
const dicts = new Set([...Object.keys(newStrings), ...Object.keys(dropStrings)]);
for (const dict of dicts) {
  const html = Object.values(files).filter((f) => f.dict === dict).map((f) => f.html).join('\n');
  const present = (t) => html.includes(esc(t)) || html.includes(escAttr(t)) || html.includes(t);
  const add = (newStrings[dict] || []).filter((x, i, a) => a.findIndex((y) => y.bg === x.bg) === i);
  // всички езици едновременно
  await Promise.all(LANGS.map(async (lang) => {
    const f = path.join(CFG.i18n, lang, `${dict}.json`);
    if (!fs.existsSync(f)) return;
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    d.strings ||= {};
    const items = add.filter((x) => !d.strings[x.bg]).map((x) => ({ bg: x.bg, prev: x.prev && d.strings[x.prev] ? `${x.prev} → ${d.strings[x.prev]}` : '' }));
    const tr = await translate(lang, items);
    for (const [k, v] of Object.entries(tr)) d.strings[k] = v;
    for (const k of dropStrings[dict] || []) if (d.strings[k] && !present(k)) delete d.strings[k];
    fs.writeFileSync(f, JSON.stringify(d, null, 1) + '\n');
    if (items.length) say(`  ${lang}/${dict}.json: +${Object.keys(tr).length}/${items.length}`);
  }));
}

const done = Object.entries(recOk).filter(([, v]) => v).map(([k]) => k);
applied.push(...done);
if (APPLIED) fs.writeFileSync(APPLIED, applied.join('\n') + (applied.length ? '\n' : ''));
fs.writeFileSync(path.join(process.env.RUNNER_TEMP || '/tmp', 'wording-apply.log'), log.join('\n') + '\n');
console.log(`Приложени записи: ${applied.length}/${Object.keys(recOk).length}; променени файлове: ${Object.values(files).filter((f) => f.changed).length}`);
