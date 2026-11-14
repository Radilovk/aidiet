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

// Знакът в координатите на оригинала (1536×1024); рамката му: x 405…1112, y 50…775.
const MARK_BOX = { x: 398, y: 46, w: 722, h: 734 };
const SW = 54; // дебелина на линията
function markDefs(id) {
  return `
    <linearGradient id="${id}L" gradientUnits="userSpaceOnUse" x1="0" y1="270" x2="0" y2="770">
      <stop offset="0" stop-color="${BRAND.cyan}"/><stop offset=".45" stop-color="${BRAND.teal}"/><stop offset="1" stop-color="${BRAND.ink}"/>
    </linearGradient>
    <linearGradient id="${id}R" gradientUnits="userSpaceOnUse" x1="640" y1="700" x2="1000" y2="280">
      <stop offset="0" stop-color="${BRAND.cyan}"/><stop offset=".32" stop-color="${BRAND.mint}"/><stop offset=".58" stop-color="${BRAND.green}"/><stop offset="1" stop-color="${BRAND.lime}"/>
    </linearGradient>
    <linearGradient id="${id}B" gradientUnits="userSpaceOnUse" x1="745" y1="700" x2="1010" y2="395">
      <stop offset="0" stop-color="${BRAND.green}"/><stop offset="1" stop-color="${BRAND.lime}"/>
    </linearGradient>
    <linearGradient id="${id}N" gradientUnits="userSpaceOnUse" x1="735" y1="0" x2="815" y2="0">
      <stop offset="0" stop-color="#00DCD6"/><stop offset="1" stop-color="#45DA3A"/>
    </linearGradient>
    <linearGradient id="${id}F" gradientUnits="userSpaceOnUse" x1="760" y1="275" x2="1000" y2="70">
      <stop offset="0" stop-color="${BRAND.leafDark}"/><stop offset=".55" stop-color="#22B80C"/><stop offset="1" stop-color="#7EE80A"/>
    </linearGradient>`;
}
function markBody(id) {
  // Дясна половина: начало (кръгла глава) → кръстопът → долу вдясно → дясна страна → горе → вдлъбнатината.
  const right = 'M628,544 L752,670 C792,712 838,748 882,746 C968,742 1046,622 1070,524 C1092,436 1078,346 1022,302 C962,256 884,266 830,296 C806,309 790,318 775,320';
  // Лява половина: вдлъбнатината → горе вляво → лява страна → долу вляво → кръстопът.
  const left = 'M775,320 C752,321 728,307 700,294 C650,270 600,266 552,284 C474,314 438,386 444,462 C450,560 528,676 592,724 C628,752 668,760 708,734 L752,700';
  // Острието на отметката: изтъняващо от кръстопътя до върха.
  const blade = 'M733,684 C800,610 900,505 1009,398 C930,505 852,612 792,700 C780,716 762,722 752,716 Z';
  const leaf = 'M750,276 C752,198 800,124 878,88 C928,66 972,58 1009,56 C996,124 962,192 902,228 C852,258 800,270 750,276 Z';
  const leafShade = 'M750,276 L1009,56 C996,124 962,192 902,228 C852,258 800,270 750,276 Z';
  return `
    <path d="${left}" fill="none" stroke="url(#${id}L)" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${blade}" fill="url(#${id}B)"/>
    <path d="${right}" fill="none" stroke="url(#${id}R)" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M735,302 C752,312 765,319 775,320 C790,318 803,311 815,305" fill="none" stroke="url(#${id}N)" stroke-width="${SW}" stroke-linecap="butt"/>
    <path d="${leaf}" fill="${BRAND.lime}"/>
    <path d="${leafShade}" fill="url(#${id}F)"/>`;
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
  return svg('170 40 1196 920', markDefs('f') + wm.defs, markBody('f') + wm.body, ' role="img" aria-label="EATOLOGIX"');
}
out('brand/eatologix-logo.svg', fullLogo(false));
out('brand/eatologix-logo-dark.svg', fullLogo(true));

// 3) Хоризонтално: знак + надпис на един ред (за горни ленти).
function horizontal(dark) {
  const h = 734; const scale = 300 / glyphs.cap; // височина на главните букви = 300
  const x0 = mb.x + mb.w + 70; const baseline = mb.y + mb.h / 2 + 150 + 30;
  const wm = wordmark('h', { scale, x0, baseline, dark });
  const w = mb.w + 70 + glyphs.width * scale + 20;
  return svg(`${mb.x} ${mb.y} ${w} ${h}`, markDefs('h') + wm.defs, markBody('h') + wm.body, ' role="img" aria-label="EATOLOGIX"');
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
    const W = 480, H = Math.round(480 * 734 / 3507);
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
