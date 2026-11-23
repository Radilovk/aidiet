#!/usr/bin/env node
/**
 * Снимките за наградите (data/reward-images.json → brand/rewards/<тема>.webp).
 *
 *   node scripts/reward-images.mjs collect          търси в Pixabay (PIXABAY_API_KEY) → data/reward-image-candidates.json
 *   node scripts/reward-images.mjs pick <тема> <id> [--focus x,y]
 *                                                    сваля избраната (largeImageURL), изрязва 4:5 около фокуса (0–1),
 *                                                    записва brand/rewards/<тема>.webp (1080×1350) и манифеста
 *
 * Pixabay: снимките се свалят при нас (без постоянно зареждане от техните адреси), посочване на автор
 * не се изисква; търсенето е само на избраните теми. Ключът е тайна в GitHub — collect се пуска от
 * workflow „Reward images“; pick работи и без ключ (CDN адресите от кандидатите).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'data/reward-images.json');
const CANDIDATES = path.join(ROOT, 'data/reward-image-candidates.json');
const OUT = path.join(ROOT, 'brand/rewards');
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const [cmd, ...args] = process.argv.slice(2);

async function collect() {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw new Error('PIXABAY_API_KEY липсва');
  const out = {};
  for (const [theme, queries] of Object.entries(manifest.themes)) {
    out[theme] = [];
    for (const q of queries) {
      const u = new URL('https://pixabay.com/api/');
      Object.entries({ key, q, image_type: 'photo', safesearch: 'true', per_page: '10', order: 'popular', min_width: '1600' })
        .forEach(([k, v]) => u.searchParams.set(k, v));
      const r = await fetch(u);
      if (!r.ok) throw new Error(`Pixabay ${r.status} за „${q}“`);
      const d = await r.json();
      for (const h of d.hits || []) {
        out[theme].push({ id: h.id, q, tags: h.tags, w: h.imageWidth, h: h.imageHeight, page: h.pageURL, preview: h.webformatURL, large: h.largeImageURL });
      }
    }
    console.log(theme, out[theme].length);
  }
  fs.writeFileSync(CANDIDATES, JSON.stringify({ at: new Date().toISOString(), themes: out }, null, 1) + '\n');
}

async function pick(theme, id, focus) {
  const cands = JSON.parse(fs.readFileSync(CANDIDATES, 'utf8')).themes[theme] || [];
  const c = cands.find((x) => String(x.id) === String(id));
  if (!c) throw new Error(`няма кандидат ${id} за ${theme}`);
  const { default: sharp } = await import('sharp');
  const buf = Buffer.from(await (await fetch(c.large)).arrayBuffer());
  const img = sharp(buf);
  const { width, height } = await img.metadata();
  const [fx, fy] = (focus || '0.5,0.5').split(',').map(Number);
  // най-голямата рамка 4:5 в снимката, центрирана във фокуса
  let cw = width, ch = Math.round(width * 5 / 4);
  if (ch > height) { ch = height; cw = Math.round(height * 4 / 5); }
  const left = Math.max(0, Math.min(width - cw, Math.round(fx * width - cw / 2)));
  const top = Math.max(0, Math.min(height - ch, Math.round(fy * height - ch / 2)));
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${theme}.webp`);
  await img.extract({ left, top, width: cw, height: ch }).resize(1080, 1350).modulate({ brightness: 1.02 }).webp({ quality: 74 }).toFile(file);
  manifest.images[theme] = { file: `brand/rewards/${theme}.webp`, source: 'Pixabay', id: c.id, page: c.page };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log('✓', file, Math.round(fs.statSync(file).size / 1024) + ' KB');
}

if (cmd === 'collect') await collect();
else if (cmd === 'pick') await pick(args[0], args[1], args.includes('--focus') ? args[args.indexOf('--focus') + 1] : '');
else console.log('collect | pick <тема> <id> [--focus x,y]');
