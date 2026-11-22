#!/usr/bin/env node
/**
 * Снимките на ястията: търсене → преглед → избор → обработка (docs/DISH_IMAGES.md).
 *
 *   node scripts/dish-images.mjs status                       колко ястия имат снимка, кои нямат
 *   node scripts/dish-images.mjs search <id…> | --next <n> [--from <id>]
 *                                                              кандидати → лист за преглед (.cache/dish-images/sheet-*.png)
 *   node scripts/dish-images.mjs pick <id> <кандидат> [--focus x,y] [--zoom z]
 *                                                              сваля избрания, изрязва квадрат, записва WebP и манифеста
 *   node scripts/dish-images.mjs skip <id> [причина]           няма подходяща снимка — отбелязва
 *   node scripts/dish-images.mjs review [--all]                общ лист на избраните (.cache/dish-images/review-*.png)
 *
 * Източници (условията са проверени на 22.11.2026):
 *  - Pixabay API (ключ в PIXABAY_API_KEY): снимките се свалят при нас — изискване на Pixabay (без постоянно
 *    зареждане от техните адреси); отговорите на търсенето се пазят 24 часа; без масово сваляне — сваля се
 *    само избраната снимка. Посочване на автора не се изисква; в „За приложението“ пише откъде са снимките.
 *  - Foodiesfeed (лиценз, равен на CC0; търсене през /s/<дума>, разрешено в robots.txt). AI-генерираните
 *    им снимки (папка /generated/) се пропускат.
 *  - Unsplash не се ползва: изисква снимките да се зареждат от техния сървър и автор под всяка.
 *
 *   node scripts/dish-images.mjs collect <файл> / load <файл>   кандидатите се събират в CI (ключът е в GitHub Secrets)
 *                                                              и се зареждат тук; после search --cached и pick
 *   node scripts/dish-images.mjs auto [--limit n]               нови ястия без снимка: Gemini Flash избира строго (CI)
 *
 * Изходът: brand/dishes/<id>.webp (16:10, 720×450 — за прозореца на храненето), data/engine/dish-images.json.
 * Снимката показва основното ястие без сменяемата гарнитура.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache/dish-images');
const OUT_DIR = path.join(ROOT, 'brand/dishes');
const MANIFEST = path.join(ROOT, 'data/engine/dish-images.json');
const DISHES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/engine/dishes.json'), 'utf8')).dishes;
const QUERIES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/engine/dish-image-queries.json'), 'utf8')).queries;
const UA = 'Mozilla/5.0 (compatible; NutriinDishImages/1.0)';
const DAY = 24 * 3600 * 1000;
/** Снимката е за прозореца на храненето: 16:10, 720×450 (≈2× за телефон). */
const OUT_W = 720;
const OUT_H = 450;
const PER_SOURCE = 8;

fs.mkdirSync(CACHE, { recursive: true });
const dishById = new Map(DISHES.map(d => [d.id, d]));

function readManifest() {
  if (!fs.existsSync(MANIFEST)) return { about: '', images: {}, skipped: {} };
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  m.images ||= {}; m.skipped ||= {};
  return m;
}
function writeManifest(m) {
  const sort = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
  fs.writeFileSync(MANIFEST, JSON.stringify({ about: m.about, images: sort(m.images), skipped: sort(m.skipped) }, null, 2) + '\n');
}

/** GET с кеш (24 часа — изискването на Pixabay; същото и за Foodiesfeed). */
async function cachedGet(url, kind) {
  const file = path.join(CACHE, kind, crypto.createHash('sha1').update(url).digest('hex'));
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < DAY) return fs.readFileSync(file, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${kind}: HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

async function pixabay(query) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const p = new URLSearchParams({ key, q: query, image_type: 'photo', category: 'food', orientation: 'horizontal',
    min_width: '1000', safesearch: 'true', per_page: String(PER_SOURCE * 2) });
  const data = JSON.parse(await cachedGet(`https://pixabay.com/api/?${p}`, 'pixabay'));
  return (data.hits || []).slice(0, PER_SOURCE).map(h => ({
    source: 'pixabay', id: String(h.id), preview: h.webformatURL, full: h.largeImageURL,
    page: h.pageURL, author: h.user, title: h.tags, width: h.imageWidth, height: h.imageHeight,
  }));
}

async function foodiesfeed(query) {
  const html = await cachedGet(`https://www.foodiesfeed.com/s/${encodeURIComponent(query.replace(/\s+/g, '-'))}`, 'foodiesfeed');
  const out = [];
  const re = /<a href="\/free-food-photo\/([^"]+)"[^>]*>[\s\S]{0,400}?<img src="(https:\/\/pub-[^"]+\/thumbnails\/[^"]+\.webp)"(?:[^>]*alt="([^"]*)")?/g;
  for (const m of html.matchAll(re)) {
    const [, slug, thumb, alt] = m;
    if (thumb.includes('/generated/')) continue;          // AI-генерирани — пропускат се
    if (out.some(c => c.id === slug)) continue;
    out.push({ source: 'foodiesfeed', id: slug, preview: thumb, full: thumb.replace('/thumbnails/', '/webp/'),
      page: `https://www.foodiesfeed.com/free-food-photo/${slug}`, author: 'Foodiesfeed', title: alt || slug });
    if (out.length >= PER_SOURCE) break;
  }
  return out;
}

function nameOf(d) {
  return d.name.replace(/\{[A-Z]+\d?\}/g, '…');
}

async function candidatesFor(id) {
  const q = QUERIES[id];
  if (!q) throw new Error(`Няма заявка за ${id} в data/engine/dish-image-queries.json`);
  let list = [...await pixabay(q.q), ...await foodiesfeed(q.q)];
  if (list.length < 6 && q.alt) list = [...list, ...await pixabay(q.alt), ...await foodiesfeed(q.alt)];
  const seen = new Set();
  list = list.filter(c => !seen.has(c.source + c.id) && seen.add(c.source + c.id));
  const keyed = list.map((c, i) => ({ ...c, key: `${c.source === 'pixabay' ? 'P' : 'F'}${i + 1}` }));
  fs.mkdirSync(path.join(CACHE, 'candidates'), { recursive: true });
  fs.writeFileSync(path.join(CACHE, 'candidates', `${id}.json`), JSON.stringify(keyed, null, 2));
  return keyed;
}

async function renderSheet(rows, file, cols = 6, cw = 166) {
  const ch = Math.round(cw * 0.75);
  // Playwright е глобален в средата (require го намира от всяка папка).
  const { chromium } = createRequire(import.meta.url)('playwright');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<html><body style="margin:0;padding:12px;font:13px system-ui;background:#f4f6f5;width:${cols * (cw + 4) + 24}px">` +
    rows.map(r => `<div style="margin:0 0 14px"><div style="font-weight:700;margin:0 0 6px">${esc(r.title)}</div>` +
      `<div style="display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:4px">` +
      r.items.map(c => `<div style="position:relative"><img src="${esc(c.preview)}" style="width:${cw}px;height:${ch}px;object-fit:cover;border-radius:6px;display:block">` +
        `<b style="position:absolute;left:4px;top:4px;background:#000c;color:#fff;padding:1px 5px;border-radius:4px">${esc(c.key)}</b></div>`).join('') +
      '</div></div>').join('') + '</body></html>';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: cols * (cw + 4) + 24, height: 600 } });
  await p.setContent(html, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await p.screenshot({ path: file, fullPage: true });
  await b.close();
}

async function cmdSearch(args) {
  const m = readManifest();
  let ids = args.filter(a => !a.startsWith('--'));
  const n = args.includes('--next') ? Number(args[args.indexOf('--next') + 1]) || 4 : 0;
  const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
  if (n) {
    const all = DISHES.map(d => d.id);
    const start = from ? Math.max(0, all.indexOf(from)) : 0;
    ids = all.slice(start).filter(id => !m.images[id] && !m.skipped[id]).slice(0, n);
  }
  if (!ids.length) { console.log('Няма ястия за търсене.'); return; }
  if (!process.env.PIXABAY_API_KEY && !args.includes('--cached')) console.log('PIXABAY_API_KEY липсва — само Foodiesfeed.');
  const rows = [];
  for (const id of ids) {
    const d = dishById.get(id);
    if (!d) { console.log(`${id}: няма такова ястие`); continue; }
    const cachedFile = path.join(CACHE, 'candidates', `${id}.json`);
    const items = args.includes('--cached') && fs.existsSync(cachedFile) ? JSON.parse(fs.readFileSync(cachedFile, 'utf8')) : await candidatesFor(id);
    rows.push({ title: `${id} — ${nameOf(d)}`, items });
    console.log(`${id}: ${items.length} кандидата (${items.map(c => c.key).join(' ')})`);
  }
  const file = path.join(CACHE, `sheet-${ids[0]}.png`);
  await renderSheet(rows, file);
  console.log(`Лист: ${file}`);
}

/** Едър изглед на избрани кандидати: view <id> <ключ…> */
async function cmdView(args) {
  const [id, ...keys] = args;
  const cands = JSON.parse(fs.readFileSync(path.join(CACHE, 'candidates', `${id}.json`), 'utf8')).filter(c => !keys.length || keys.includes(c.key));
  const file = path.join(CACHE, `view-${id}.png`);
  await renderSheet([{ title: id, items: cands }], file, Math.min(3, cands.length), 330);
  console.log(`Лист: ${file}`);
}

async function download(url, kind) {
  const file = path.join(CACHE, kind, crypto.createHash('sha1').update(url).digest('hex'));
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`сваляне: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}

/** Изрязва 16:10 около фокуса (0–1; по подразбиране центъра), уеднаквява и записва. */
async function processPick(id, c, focus = [0.5, 0.5], zoom = 1) {
  const sharp = (await import('sharp')).default;
  const buf = await download(c.full, 'originals');
  const meta = await sharp(buf).metadata();
  const ratio = OUT_W / OUT_H;
  let w = meta.width, h = Math.round(w / ratio);
  if (h > meta.height) { h = meta.height; w = Math.round(h * ratio); }
  w = Math.round(w / Math.max(1, zoom)); h = Math.round(h / Math.max(1, zoom));
  const left = Math.round(Math.min(Math.max(focus[0] * meta.width - w / 2, 0), meta.width - w));
  const top = Math.round(Math.min(Math.max(focus[1] * meta.height - h / 2, 0), meta.height - h));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await sharp(buf).extract({ left, top, width: w, height: h }).resize(OUT_W, OUT_H)
    // Еднаква серия: леко изравняване на светлината и наситеността, без да се променя храната.
    .modulate({ brightness: 1.02, saturation: 1.04 }).sharpen({ sigma: 0.6 })
    .webp({ quality: 66, effort: 6, smartSubsample: true }).toFile(path.join(OUT_DIR, `${id}.webp`));
  for (const old of [`${id}-480.webp`, `${id}-160.webp`]) fs.rmSync(path.join(OUT_DIR, old), { force: true });
  const m = readManifest();
  m.images[id] = { src: `brand/dishes/${id}.webp`, source: c.source, page: c.page, author: c.author, picked: new Date().toISOString().slice(0, 10) };
  delete m.skipped[id];
  writeManifest(m);
  console.log(`${id}: ${c.source} ${c.id} → brand/dishes/${id}.webp`);
}

async function cmdPick(args) {
  const [id, key] = args;
  const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const cands = JSON.parse(fs.readFileSync(path.join(CACHE, 'candidates', `${id}.json`), 'utf8'));
  const c = cands.find(x => x.key === key);
  if (!c) throw new Error(`${id}: няма кандидат ${key}`);
  await processPick(id, c, (opt('--focus') || '0.5,0.5').split(',').map(Number), Number(opt('--zoom')) || 1);
}

/* ─── Автоматично за нови ястия (GitHub Actions, .github/workflows/dish-images.yml) ───
 * Най-евтиният път: само ястията без снимка; една заявка на източник; оценката е от Gemini Flash
 * (малки превюта, един отговор на ястие — части от цента). Строго: снимка се приема само при висока
 * увереност и без продукти, които ги няма в ястието; иначе ястието остава без снимка (skipped) и
 * отива за ръчен преглед. Резултатът е в отделен клон за преглед — нищо не стига до клиент без човек. */
const GEMINI_MODEL = process.env.DISH_IMAGES_MODEL || 'gemini-3.6-flash';

function ingredientsOf(d) {
  const foods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/engine/foods.json'), 'utf8')).foods;
  const label = id => foods[id]?.label || id;
  const core = d.parts.filter(p => p.range[0] > 0 && !p.onlyStyles && !p.onlyPatterns)
    .map(p => p.options.map(o => [].concat(o).map(label).join(' + ')).join(' / '));
  const optional = d.parts.filter(p => !(p.range[0] > 0) && !p.onlyStyles && !p.onlyPatterns)
    .map(p => p.options.map(o => [].concat(o).map(label).join(' + ')).join(' / '));
  return { core, optional, fixed: (d.fixed || []).map(([id]) => label(id)) };
}

async function judge(d, cands) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY липсва');
  const ing = ingredientsOf(d);
  const parts = [{ text: `You select a photo for a dish in a nutrition app. Be strict: a wrong photo is worse than no photo.
Dish (Bulgarian name): ${nameOf(d)}; search hint: ${QUERIES[d.id]?.q || ''}.
Main ingredients (one option of each line): ${ing.core.join('; ')}.
Optional sides that may be absent: ${ing.optional.join('; ') || 'none'}. Seasoning/minor: ${ing.fixed.join(', ') || 'none'}.
Accept a candidate ONLY if: it clearly shows this dish; no prominent food that is not in the lists above (props like
herbs, lemon, a spoon or a cloth are fine); one serving or one pan/plate; appetizing, natural light, no text, logos,
watermarks or hands; not an obvious AI rendering. If none qualifies, pick null.
Candidates follow, each preceded by its key. Return ONLY JSON:
{"pick": "<key>|null", "confidence": 0-1, "extras": ["foods visible that are not in the dish"], "focus": [x, y], "reason": "<short>"}
focus = centre of the food in the chosen image as fractions 0–1.` }];
  for (const c of cands) {
    const buf = await download(c.preview, 'previews');
    parts.push({ text: `Candidate ${c.key}:` }, { inlineData: { mimeType: c.preview.endsWith('.webp') ? 'image/webp' : 'image/jpeg', data: buf.toString('base64') } });
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 1024 } }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out = (await r.json()).candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '{}';
  return JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

async function cmdAuto(args) {
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
  const m = readManifest();
  const todo = DISHES.filter(d => !m.images[d.id] && !m.skipped[d.id]).slice(0, limit);
  console.log(`Автоматично: ${todo.length} ястия без снимка.`);
  for (const d of todo) {
    try {
      const cands = (await candidatesFor(d.id)).slice(0, 10);
      if (!cands.length) { cmdSkip([d.id, 'auto: няма кандидати']); continue; }
      const v = await judge(d, cands);
      const c = cands.find(x => x.key === v.pick);
      if (c && v.confidence >= 0.85 && !(v.extras || []).length) await processPick(d.id, c, Array.isArray(v.focus) ? v.focus : [0.5, 0.5]);
      else cmdSkip([d.id, `auto: ${v.reason || 'няма сигурна снимка'}`.slice(0, 160)]);
    } catch (e) { console.warn(`${d.id}: ${e.message}`); }
  }
}

/** CI с тайния ключ: кандидатите за всички ястия без снимка → един файл (за преглед другаде). */
async function cmdCollect(args) {
  const out = args[0] || 'dish-image-candidates.json';
  const m = readManifest();
  const all = {};
  for (const d of DISHES) {
    if (m.images[d.id] || m.skipped[d.id]) continue;
    try { all[d.id] = await candidatesFor(d.id); } catch (e) { console.warn(`${d.id}: ${e.message}`); }
  }
  fs.writeFileSync(out, JSON.stringify({ collected: new Date().toISOString(), candidates: all }));
  console.log(`Кандидати за ${Object.keys(all).length} ястия → ${out}`);
}

/** Зарежда файла от collect в кеша — после search --cached и pick работят без ключ. */
function cmdLoad(args) {
  const doc = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  fs.mkdirSync(path.join(CACHE, 'candidates'), { recursive: true });
  for (const [id, list] of Object.entries(doc.candidates || {})) fs.writeFileSync(path.join(CACHE, 'candidates', `${id}.json`), JSON.stringify(list, null, 2));
  console.log(`Заредени кандидати за ${Object.keys(doc.candidates || {}).length} ястия (събрани ${doc.collected}).`);
}

function cmdSkip(args) {
  const [id, ...why] = args;
  if (!dishById.has(id)) throw new Error(`няма такова ястие ${id}`);
  const m = readManifest();
  m.skipped[id] = why.join(' ') || 'няма подходяща снимка';
  writeManifest(m);
  console.log(`${id}: пропуснато`);
}

function cmdStatus() {
  const m = readManifest();
  const todo = DISHES.filter(d => !m.images[d.id] && !m.skipped[d.id]);
  console.log(`Снимки: ${Object.keys(m.images).length}/${DISHES.length}; пропуснати: ${Object.keys(m.skipped).length}; остават: ${todo.length}`);
  if (todo.length) console.log(todo.map(d => d.id).join(' '));
}

async function cmdReview(args) {
  const m = readManifest();
  const ids = Object.keys(m.images);
  const per = args.includes('--all') ? ids.length : 60;
  for (let i = 0; i < ids.length; i += per) {
    const part = ids.slice(i, i + per);
    // Вградени като data: — страница от setContent не чете file://.
    const items = part.map(id => ({ key: id, preview: 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, m.images[id].src)).toString('base64') }));
    const file = path.join(CACHE, `review-${i / per + 1}.png`);
    await renderSheet([{ title: `Избрани ${i + 1}–${i + part.length} от ${ids.length}`, items }], file, 6);
    console.log(`Лист: ${file}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
const run = { status: cmdStatus, search: cmdSearch, pick: cmdPick, skip: cmdSkip, review: cmdReview, auto: cmdAuto, collect: cmdCollect, load: cmdLoad, view: cmdView }[cmd];
if (!run) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(1); }
Promise.resolve(run(args)).catch(e => { console.error(e.message); process.exit(1); });
