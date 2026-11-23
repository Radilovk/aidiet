#!/usr/bin/env node
/**
 * Снимките за финалната страница на EmoEat (data/emoeat-images.json → brand/emoeat/<тема>.webp).
 *
 *   node scripts/emoeat-images.mjs collect   търси в Pixabay → data/emoeat-image-candidates.json
 *                                            + листове за преглед review/emoeat-images/<тема>.jpg (номер · id)
 *   node scripts/emoeat-images.mjs pick      избраните в манифеста (picks: { тема: { id, focus: "x,y" } }) →
 *                                            сваля снимката, изрязва 900:522 около фокуса (0–1), записва
 *                                            brand/emoeat/<тема>.webp (900×522) и images в манифеста
 *
 * И двете искат PIXABAY_API_KEY (тайна в GitHub) — пуска ги workflow „Reward images“ при промяна на
 * манифеста. Адресите на снимките от Pixabay са временни и важат само за машината, която е търсила,
 * затова свалянето е там. Снимките се пазят при нас (изискване на Pixabay), автор не се изисква.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'data/emoeat-images.json');
const CANDIDATES = path.join(ROOT, 'data/emoeat-image-candidates.json');
const OUT = path.join(ROOT, 'brand/emoeat');
const REVIEW = path.join(ROOT, 'review/emoeat-images');
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const KEY = process.env.PIXABAY_API_KEY;
const cmd = process.argv[2];

async function api(params) {
  if (!KEY) throw new Error('PIXABAY_API_KEY липсва');
  const u = new URL('https://pixabay.com/api/');
  Object.entries({ key: KEY, image_type: 'photo', safesearch: 'true', ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Pixabay ${r.status}`);
  return (await r.json()).hits || [];
}
const bytes = async (url) => Buffer.from(await (await fetch(url)).arrayBuffer());

async function collect() {
  const { default: sharp } = await import('sharp');
  const out = {};
  fs.mkdirSync(REVIEW, { recursive: true });
  for (const [theme, queries] of Object.entries(manifest.themes)) {
    if (manifest.picks?.[theme]) continue;   // вече избрана
    out[theme] = [];
    for (const q of queries) {
      for (const h of await api({ q, per_page: '10', order: 'popular', min_width: '1600' })) {
        if (!out[theme].some((x) => x.id === h.id)) out[theme].push({ id: h.id, q, tags: h.tags, w: h.imageWidth, h: h.imageHeight, page: h.pageURL, preview: h.webformatURL });
      }
    }
    const tiles = [];
    for (let i = 0; i < out[theme].length; i++) {
      const t = await sharp(await bytes(out[theme][i].preview)).resize(240, 240, { fit: 'cover' }).toBuffer();
      const label = Buffer.from(`<svg width="240" height="30"><rect width="240" height="30" fill="black" opacity=".7"/><text x="6" y="21" font-size="18" fill="white" font-family="sans-serif">${out[theme][i].id}</text></svg>`);
      tiles.push(await sharp(t).composite([{ input: label, top: 0, left: 0 }]).toBuffer());
    }
    const cols = 5, rows = Math.ceil(tiles.length / cols) || 1;
    await sharp({ create: { width: cols * 244, height: rows * 244, channels: 3, background: '#ffffff' } })
      .composite(tiles.map((input, i) => ({ input, left: (i % cols) * 244, top: Math.floor(i / cols) * 244 })))
      .jpeg({ quality: 70 }).toFile(path.join(REVIEW, `${theme}.jpg`));
    console.log(theme, out[theme].length);
  }
  fs.writeFileSync(CANDIDATES, JSON.stringify({ at: new Date().toISOString(), themes: out }, null, 1) + '\n');
}

async function pick() {
  const { default: sharp } = await import('sharp');
  fs.mkdirSync(OUT, { recursive: true });
  manifest.images ||= {};
  for (const [theme, p] of Object.entries(manifest.picks || {})) {
    const done = manifest.images[theme];
    if (done && done.id === p.id && done.focus === (p.focus || '0.5,0.5')) continue;
    const [h] = await api({ id: String(p.id) });
    if (!h) throw new Error(`няма снимка ${p.id}`);
    const img = sharp(await bytes(h.largeImageURL));
    const { width, height } = await img.metadata();
    const [fx, fy] = (p.focus || '0.5,0.5').split(',').map(Number);
    // най-голямата широка рамка 900:522, центрирана във фокуса
    let cw = width, ch = Math.round(width * 522 / 900);
    if (ch > height) { ch = height; cw = Math.round(height * 900 / 522); }
    const left = Math.max(0, Math.min(width - cw, Math.round(fx * width - cw / 2)));
    const top = Math.max(0, Math.min(height - ch, Math.round(fy * height - ch / 2)));
    const file = path.join(OUT, `${theme}.webp`);
    await img.extract({ left, top, width: cw, height: ch }).resize(900, 522).webp({ quality: 72 }).toFile(file);
    manifest.images[theme] = { file: `brand/emoeat/${theme}.webp`, id: p.id, focus: p.focus || '0.5,0.5', source: 'Pixabay', page: h.pageURL };
    console.log('✓', theme, Math.round(fs.statSync(file).size / 1024) + ' KB');
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

if (cmd === 'collect') await collect();
else if (cmd === 'pick') await pick();
else console.log('collect | pick');
