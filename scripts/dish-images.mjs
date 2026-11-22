#!/usr/bin/env node
/**
 * Снимките на ястията: търсене → преглед → избор → обработка (docs/DISH_IMAGES.md).
 *
 *   node scripts/dish-images.mjs status                       колко ястия имат снимка, кои нямат
 *   node scripts/dish-images.mjs search <id…> | --next <n>     кандидати → лист за преглед (.cache/dish-images/sheet-*.png)
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
 * Изходът: brand/dishes/<id>-480.webp и -160.webp (квадрат), data/engine/dish-images.json.
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
const SIZES = [480, 160];
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

async function renderSheet(rows, file, cols = 6) {
  // Playwright е глобален в средата (require го намира от всяка папка).
  const { chromium } = createRequire(import.meta.url)('playwright');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<html><body style="margin:0;padding:12px;font:13px system-ui;background:#f4f6f5;width:${cols * 170 + 24}px">` +
    rows.map(r => `<div style="margin:0 0 14px"><div style="font-weight:700;margin:0 0 6px">${esc(r.title)}</div>` +
      `<div style="display:grid;grid-template-columns:repeat(${cols},166px);gap:4px">` +
      r.items.map(c => `<div style="position:relative"><img src="${esc(c.preview)}" style="width:166px;height:124px;object-fit:cover;border-radius:6px;display:block">` +
        `<b style="position:absolute;left:4px;top:4px;background:#000c;color:#fff;padding:1px 5px;border-radius:4px">${esc(c.key)}</b></div>`).join('') +
      '</div></div>').join('') + '</body></html>';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: cols * 170 + 24, height: 600 } });
  await p.setContent(html, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await p.screenshot({ path: file, fullPage: true });
  await b.close();
}

async function cmdSearch(args) {
  const m = readManifest();
  let ids = args.filter(a => !a.startsWith('--'));
  const n = args.includes('--next') ? Number(args[args.indexOf('--next') + 1]) || 4 : 0;
  if (n) ids = DISHES.map(d => d.id).filter(id => !m.images[id] && !m.skipped[id]).slice(0, n);
  if (!ids.length) { console.log('Няма ястия за търсене.'); return; }
  if (!process.env.PIXABAY_API_KEY) console.log('PIXABAY_API_KEY липсва — само Foodiesfeed.');
  const rows = [];
  for (const id of ids) {
    const d = dishById.get(id);
    if (!d) { console.log(`${id}: няма такова ястие`); continue; }
    const items = await candidatesFor(id);
    rows.push({ title: `${id} — ${nameOf(d)}`, items });
    console.log(`${id}: ${items.length} кандидата (${items.map(c => c.key).join(' ')})`);
  }
  const file = path.join(CACHE, `sheet-${ids[0]}.png`);
  await renderSheet(rows, file);
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

async function cmdPick(args) {
  const [id, key] = args;
  const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const cands = JSON.parse(fs.readFileSync(path.join(CACHE, 'candidates', `${id}.json`), 'utf8'));
  const c = cands.find(x => x.key === key);
  if (!c) throw new Error(`${id}: няма кандидат ${key}`);
  const sharp = (await import('sharp')).default;
  const buf = await download(c.full, 'originals');
  const meta = await sharp(buf).metadata();
  // Квадрат около фокуса (0–1 по ширина/височина; по подразбиране центъра), --zoom >1 приближава.
  const [fx, fy] = (opt('--focus') || '0.5,0.5').split(',').map(Number);
  const zoom = Math.max(1, Number(opt('--zoom')) || 1);
  const side = Math.round(Math.min(meta.width, meta.height) / zoom);
  const left = Math.round(Math.min(Math.max(fx * meta.width - side / 2, 0), meta.width - side));
  const top = Math.round(Math.min(Math.max(fy * meta.height - side / 2, 0), meta.height - side));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    await sharp(buf).extract({ left, top, width: side, height: side }).resize(size, size)
      // Еднаква серия: леко изравняване на светлината и наситеността, без да се променя храната.
      .modulate({ brightness: 1.02, saturation: 1.04 }).sharpen({ sigma: 0.6 })
      .webp({ quality: size > 200 ? 68 : 70, effort: 6, smartSubsample: true }).toFile(path.join(OUT_DIR, `${id}-${size}.webp`));
  }
  const m = readManifest();
  m.images[id] = { src: `brand/dishes/${id}`, source: c.source, page: c.page, author: c.author, picked: new Date().toISOString().slice(0, 10) };
  delete m.skipped[id];
  writeManifest(m);
  console.log(`${id}: ${c.source} ${c.id} → brand/dishes/${id}-{${SIZES.join(',')}}.webp`);
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
    const items = part.map(id => ({ key: id, preview: 'file://' + path.join(OUT_DIR, `${id}-480.webp`) }));
    const file = path.join(CACHE, `review-${i / per + 1}.png`);
    await renderSheet([{ title: `Избрани ${i + 1}–${i + part.length} от ${ids.length}`, items }], file, 6);
    console.log(`Лист: ${file}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
const run = { status: cmdStatus, search: cmdSearch, pick: cmdPick, skip: cmdSkip, review: cmdReview }[cmd];
if (!run) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(1); }
Promise.resolve(run(args)).catch(e => { console.error(e.message); process.exit(1); });
