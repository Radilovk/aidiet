#!/usr/bin/env node
/**
 * EATOLOGIX — генерира логото и иконите от един източник (вектор).
 * Знакът е прерисуван по концепцията (ябълка + отметка, кръстосани в долната част);
 * надписът е Montserrat 600 в контури (brand/wordmark-glyphs.json), за да не зависи от шрифт.
 *   node scripts/build-brand.mjs           → SVG файловете
 *   node scripts/build-brand.mjs --png     → + PNG иконите (нужен е Playwright/Chromium)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (rel, s) => { fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), s); };

// Палитра (от логото с прозрачност): ляво циан → тъмен тюркоаз, дясно лайм → зелено.
export const BRAND = {
  ink: '#034E5C',       // тъмен тюркоаз — EATO и текст
  teal: '#03909C',
  cyan: '#00E0DC',
  mint: '#08D29A',
  green: '#10CC50',
  lime: '#A0F500',
  leafDark: '#027A0A',
  night: '#04181C'      // тъмен фон на иконата
};

// ── Знакът: ябълка-безкрайност с отметка-лист ───────────────────────────────────────
// Една линия в две огледални нишки (безкрайност = постоянство; силуетът = ябълка), които се
// кръстосват в средата: нишка А минава отгоре, с мека сянка само върху нишка Б. Отгоре —
// отметка („логичен избор“), чийто връх е във вдлъбнатината като дръжка, а дългото рамо е лист.
// Координати 1254×1254; рамката на знака — MARK_BOX.
const MARK_BOX = { x: 100, y: 96, w: 1054, h: 944 };
const SW = 92;                         // дебелина на линията
const AXIS = 627;                      // ос на симетрия
// Нишка А: дъно вляво → кръстопът → дясна половина → дъно вдясно (централна линия).
const HALF = [[440, 985], [520, 930], [582, 780], [627, 615], [672, 450], [765, 322], [905, 268], [1045, 330],
  [1100, 505], [1052, 705], [942, 905], [815, 985]];
const RING = [...HALF, ...HALF.map(([x, y]) => [2 * AXIS - x, y]).slice(1, -1)]; // затворен контур
function ringSeg(i) {
  const n = RING.length, p0 = RING[(i - 1 + n) % n], p1 = RING[i % n], p2 = RING[(i + 1) % n], p3 = RING[(i + 2) % n];
  const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
  return ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
}
const iSplit = HALF.length - 1;
let STRAND_A = `M${RING[0][0]},${RING[0][1]}`; for (let i = 0; i < iSplit; i++) STRAND_A += ringSeg(i);
let STRAND_B = `M${RING[iSplit][0]},${RING[iSplit][1]}`; for (let i = iSplit; i < RING.length; i++) STRAND_B += ringSeg(i);
const CROSS_SHADOW = 'M575,800 C598,720 612,670 627,615 C642,560 656,510 680,440';
// Отметката: къса дъга (главичка) + лист (дългото рамо, изтънява към върха), с жилка.
const CHECK_ARM = 'M578,250 L627,300';
const CHECK_V = [627, 300];             // върхът на отметката — над вдлъбнатината, като дръжка
// Листът тръгва от върха с основа, широка колкото рамото (точките лежат на кръга около върха).
const LEAF = 'M609.3,278.3 C668,196 760,128 864,104 C848,186 770,262 644.7,321.7 Z';
const LEAF_VEIN = 'M646,286 C712,218 780,160 846,118';

function markDefs(id) {
  return `
    <linearGradient id="${id}g" gradientUnits="userSpaceOnUse" x1="108" y1="0" x2="1146" y2="0">
      <stop offset="0" stop-color="#00D4E6"/><stop offset=".4" stop-color="#03E0C8"/><stop offset=".6" stop-color="#12DC8C"/>
      <stop offset=".84" stop-color="#3CDC4A"/><stop offset="1" stop-color="#7AEF3E"/>
    </linearGradient>
    <linearGradient id="${id}l" gradientUnits="userSpaceOnUse" x1="612" y1="320" x2="864" y2="104">
      <stop offset="0" stop-color="#0FD69C"/><stop offset=".5" stop-color="#34DA52"/><stop offset="1" stop-color="#8CF23C"/>
    </linearGradient>
    <filter id="${id}s" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="9"/></filter>
    <mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="1254" height="1254">
      <path d="${STRAND_B}" fill="none" stroke="#fff" stroke-width="${SW}" stroke-linecap="round"/>
    </mask>`;
}
function markBody(id) {
  return `
    <path d="${STRAND_B}" fill="none" stroke="url(#${id}g)" stroke-width="${SW}" stroke-linecap="round"/>
    <g mask="url(#${id}m)"><path d="${CROSS_SHADOW}" fill="none" stroke="#00141A" stroke-opacity=".22" stroke-width="${SW + 26}" filter="url(#${id}s)"/></g>
    <path d="${STRAND_A}" fill="none" stroke="url(#${id}g)" stroke-width="${SW}" stroke-linecap="round"/>
    <path d="${CHECK_ARM}" fill="none" stroke="url(#${id}g)" stroke-width="56" stroke-linecap="round"/>
    <circle cx="${CHECK_V[0]}" cy="${CHECK_V[1]}" r="28" fill="url(#${id}l)"/>
    <path d="${LEAF}" fill="url(#${id}l)"/>
    <path d="${LEAF_VEIN}" fill="none" stroke="#06703A" stroke-opacity=".32" stroke-width="5" stroke-linecap="round"/>`;
}
/** Знакът, вписан в правоъгълник (запазва пропорциите, центриран). */
function placeMark(id, box) {
  const k = Math.min(box.w / MARK_BOX.w, box.h / MARK_BOX.h);
  const tx = box.x + (box.w - MARK_BOX.w * k) / 2 - MARK_BOX.x * k, ty = box.y + (box.h - MARK_BOX.h * k) / 2 - MARK_BOX.y * k;
  return `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(5)})">${markBody(id)}</g>`;
}

const glyphs = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand/wordmark-glyphs.json'), 'utf8'));
// Надписът: EATO (тъмен тюркоаз) | LOGIX — всяка буква със свой цвят, точно по логото.
// Смисловото разделяне EATO / LOGIX е част от марката — не се заменя с преливане.
export const LETTER_COLORS = { E: '#034953', A: '#034953', T: '#034953', O1: '#034953', L: '#08B5B9', O2: '#06C3AA', G: '#07CF61', I: '#14D428', X: '#44CA0A' };
const ORDER = ['E', 'A', 'T', 'O1', 'L', 'O2', 'G', 'I', 'X'];
function wordmark(id, { scale, x0, baseline, dark }) {
  const body = glyphs.glyphs.map((g, i) => {
    let c = LETTER_COLORS[ORDER[i]];
    if (dark && i < 4) c = '#E4FBF8'; // на тъмен фон EATO е светъл, LOGIX остава в цветовете си
    return `<path d="${g.d}" fill="${c}"/>`;
  }).join('');
  return { defs: '', body: `<g transform="translate(${x0},${baseline}) scale(${scale})">${body}</g>` };
}

const svg = (vb, defs, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${extra}><defs>${defs}</defs>${body}</svg>\n`;

// 1) Само знакът.
const mb = MARK_BOX;
const markSvg = svg(`${mb.x} ${mb.y} ${mb.w} ${mb.h}`, markDefs('m'), markBody('m'), ' role="img" aria-label="EATOLOGIX"');
out('brand/eatologix-mark.svg', markSvg);

// 2) Пълно лого (знак над надписа), светло и тъмно.
function fullLogo(dark) {
  const wmW = 1162; const scale = wmW / glyphs.width; const x0 = 188; const baseline = 938;
  const wm = wordmark('f', { scale, x0, baseline, dark });
  return svg('170 40 1196 920', markDefs('f') + wm.defs, placeMark('f', { x: 300, y: 58, w: 936, h: 700 }) + wm.body, ' role="img" aria-label="EATOLOGIX"');
}
out('brand/eatologix-logo.svg', fullLogo(false));
out('brand/eatologix-logo-dark.svg', fullLogo(true));

// 3) Хоризонтално: знак + надпис на един ред (за горни ленти).
function horizontal(dark) {
  const cap = mb.h * 0.40; const scale = cap / glyphs.cap; // главните букви ≈ 40% от височината на знака
  const gap = 90; const x0 = mb.x + mb.w + gap; const baseline = mb.y + mb.h / 2 + cap / 2 + mb.h * 0.04;
  const wm = wordmark('h', { scale, x0, baseline, dark });
  const w = Math.ceil(mb.w + gap + glyphs.width * scale + 20);
  return svg(`${mb.x} ${mb.y} ${w} ${mb.h}`, markDefs('h') + wm.defs, markBody('h') + wm.body, ' role="img" aria-label="EATOLOGIX"');
}
out('brand/eatologix-horizontal.svg', horizontal(false));
out('brand/eatologix-horizontal-dark.svg', horizontal(true));

// 3б) Само надписът.
function wordOnly(dark) {
  const cap = glyphs.cap; const pad = 20;
  const wm = wordmark('w', { scale: 1, x0: pad, baseline: cap + pad, dark });
  return svg(`0 0 ${Math.ceil(glyphs.width + 2 * pad)} ${cap + 2 * pad}`, wm.defs, wm.body, ' role="img" aria-label="EATOLOGIX"');
}
out('brand/eatologix-wordmark.svg', wordOnly(false));
out('brand/eatologix-wordmark-dark.svg', wordOnly(true));

// 4) Иконата на приложението: знакът върху тъмен фон със сияние (от тъмната концепция).
function appIcon({ maskable = false, pad: padIn, square = false } = {}) {
  const S = 1024; const pad = padIn != null ? padIn : (maskable ? 0.26 : 0.17); // maskable: безопасната зона е 80%
  const inner = S * (1 - 2 * pad); const k = inner / Math.max(mb.w, mb.h);
  const tx = (S - mb.w * k) / 2 - mb.x * k; const ty = (S - mb.h * k) / 2 - mb.y * k + S * 0.01;
  const r = (maskable || square) ? 0 : 224;
  const defs = markDefs('i') + `
    <radialGradient id="iBg" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#0A2E33"/><stop offset=".6" stop-color="${BRAND.night}"/><stop offset="1" stop-color="#020C0E"/></radialGradient>
    <radialGradient id="iGlowL" cx=".36" cy=".46" r=".42"><stop offset="0" stop-color="${BRAND.cyan}" stop-opacity=".30"/><stop offset="1" stop-color="${BRAND.cyan}" stop-opacity="0"/></radialGradient>
    <radialGradient id="iGlowR" cx=".66" cy=".36" r=".42"><stop offset="0" stop-color="${BRAND.lime}" stop-opacity=".26"/><stop offset="1" stop-color="${BRAND.lime}" stop-opacity="0"/></radialGradient>
    <filter id="iSoft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${18 / k}"/></filter>`;
  const body = `<rect width="${S}" height="${S}" rx="${r}" fill="url(#iBg)"/>
    <rect width="${S}" height="${S}" rx="${r}" fill="url(#iGlowL)"/><rect width="${S}" height="${S}" rx="${r}" fill="url(#iGlowR)"/>
    <g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(5)})"><g opacity=".55" filter="url(#iSoft)">${markBody('i')}</g>${markBody('i')}</g>`;
  return svg(`0 0 ${S} ${S}`, defs, body);
}
// Иконите на PWA (icon-192/512): знакът с прозрачност, ~78% от квадрата — както беше при NutriPlan.
// Плътният тъмен фон е само там, където системата иска непрозрачна икона (iPhone, maskable).
function alphaIcon(fill) {
  const S = 1024; const k = (S * fill) / Math.max(mb.w, mb.h);
  const tx = (S - mb.w * k) / 2 - mb.x * k; const ty = (S - mb.h * k) / 2 - mb.y * k;
  return svg(`0 0 ${S} ${S}`, markDefs('a'), `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(5)})">${markBody('a')}</g>`, ' role="img" aria-label="EATOLOGIX"');
}
const pwaIcon = alphaIcon(0.78);
out('icon-512x512.svg', pwaIcon);
out('icon-192x192.svg', pwaIcon);
out('brand/eatologix-icon.svg', appIcon());               // плътна (тъмен фон) — App Store/Play графики
out('brand/eatologix-icon-maskable.svg', appIcon({ maskable: true }));
out('brand/eatologix-icon-ios.svg', appIcon({ pad: 0.15, square: true })); // iPhone: плътен квадрат, iOS сам заобля
// Фавикон (раздела на браузъра): знакът почти до ръба, прозрачен.
out('favicon.svg', alphaIcon(0.96));

if (process.argv.includes('--png')) {
  const { chromium } = (await import('node:module')).createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = async (srcRel, size, dest, bg = 'transparent') => {
    const src = fs.readFileSync(path.join(ROOT, srcRel), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:${bg}"><img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}"></body></html>`);
    await page.locator('img').screenshot({ path: path.join(ROOT, dest), omitBackground: bg === 'transparent' });
  };
  for (const [dest, size] of [['icon-192x192.png', 192], ['icon-192.png', 192], ['icon-512x512.png', 512], ['icon-512.png', 512]]) {
    await shot('icon-512x512.svg', size, dest);                      // прозрачни
  }
  await shot('brand/eatologix-icon-ios.svg', 180, 'brand/apple-touch-icon.png'); // iPhone: непрозрачна
  await shot('brand/eatologix-icon.svg', 512, 'brand/icon-solid-512.png');
  for (const size of [32, 48, 192]) await shot('favicon.svg', size, `brand/favicon-${size}.png`);
  await shot('brand/eatologix-icon-maskable.svg', 512, 'brand/icon-maskable-512.png');
  await shot('brand/eatologix-icon-maskable.svg', 192, 'brand/icon-maskable-192.png');
  await shot('favicon.svg', 64, 'favicon-64.png');
  // Android: знакът без фон — предният слой на адаптивната икона, сплаш екранът, иконата за известия.
  await shot('brand/eatologix-mark.svg', 512, 'brand/mark-512.png');
  // Имейлите: пощенските програми не показват SVG — хоризонталното лого като PNG (2× за 240 px ширина).
  {
    const h = fs.readFileSync(path.join(ROOT, 'brand/eatologix-horizontal.svg'), 'utf8');
    const W = 480, H = Math.round(480 * 922 / 4477);
    await page.setViewportSize({ width: W, height: H });
    await page.setContent(`<html><body style="margin:0;background:transparent"><img style="display:block;width:${W}px;height:${H}px" src="data:image/svg+xml;base64,${Buffer.from(h).toString('base64')}"></body></html>`);
    await page.locator('img').screenshot({ path: path.join(ROOT, 'brand/eatologix-email-logo.png'), omitBackground: true });
  }
  // Картинка за споделяне (1200×630): пълното лого върху светъл фон.
  const logo = fs.readFileSync(path.join(ROOT, 'brand/eatologix-logo.svg'), 'utf8');
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<html><body style="margin:0;width:1200px;height:630px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 40%,#FFFFFF,#EAF8F4)"><img style="height:520px" src="data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}"></body></html>`);
  await page.screenshot({ path: path.join(ROOT, 'brand/og-image.png') });
  await browser.close();
}
console.log('brand: ok');
