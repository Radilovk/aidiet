#!/usr/bin/env node
/**
 * NUTRIIN — генерира логото и иконите от един източник (вектор).
 *   node scripts/build-brand.mjs           → SVG файловете
 *   node scripts/build-brand.mjs --png     → + PNG иконите (нужен е Playwright/Chromium)
 *
 * Знакът (brand/nutriin-mark.json): формата на собственика (концепцията от 21.11.2026) — ябълка с ЕДНА линия,
 * която вътре изписва „in“, + листо. Реконструирана прецизно: оста е напасната с минимум гладки криви
 * (непрекъсната кривина), „i“ и стъблото на „n“ са строго прави, дебелината е плавният профил на рисунката
 * (по-тънка във вдлъбнатината, опашката изтънява до острие). Пълни форми: тяло + листо (със сърповидна жилка).
 * Цветът следва „Светлина · Стъкло · Спокойствие“ (DESIGN_PRINCIPLES 2а): вътре (долу вляво, при „in“)
 * — дълбок тюркоазено-зелен; навън (горе вдясно) — свежо зелено; листото е най-светлото. Без лайм и жълто.
 *
 * Надписът (brand/nutriin-wordmark-glyphs.json — Outfit, OFL, в контури, за да не зависи от шрифт):
 * „nutri“ лек (350) в мастилен цвят + „in“ плътен (650) в зелено — „in“ е смислово отделено:
 * вътре, вътрешно, отвътре.
 *
 * Оптични размери: основната форма (лого, икони, сплаш) и по-плътна (bodySmall/leafSmall) за 16–48 px
 * (фавикон, малки икони), за да не изчезват тънките места.
 *
 * Старите имена (brand/eatologix-*) се пишат като копия на новите — за писмата, които вече са
 * изпратени, за старите версии на приложението и за модулите в други репа.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (rel, s) => { fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), s); };

export const BRAND = {
  ink: '#0E2A27',        // мастило — „nutri“, текст
  inkDark: '#EAF6F2',    // „nutri“ на тъмен фон
  green: '#12935A',      // „in“ на светъл фон (4.6:1 върху бяло)
  greenDark: '#4ADE80',  // „in“ на тъмен фон
  night: '#050F0E'       // дълбокият фон на иконата (като фона на приложението)
};
// Знакът: тон по тон, по диагонала от вътрешното (долу вляво) към светлината (горе вдясно).
const PAL = {
  light: { a: '#0A6B66', b: '#14935A', c: '#22B35E', leafA: '#1FA85A', leafB: '#3CCB6E' },
  dark: { a: '#1FB8A4', b: '#2CCB82', c: '#56DE86', leafA: '#4ADE80', leafB: '#86EFAC' }
};

const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand/nutriin-mark.json'), 'utf8'));
const MB = M.box;
const LABEL = ' role="img" aria-label="Nutriin"';

function markDefs(id, theme = 'light') {
  const c = PAL[theme];
  return `
    <linearGradient id="${id}s" gradientUnits="userSpaceOnUse" x1="300" y1="1120" x2="1020" y2="420">
      <stop offset="0" stop-color="${c.a}"/><stop offset=".55" stop-color="${c.b}"/><stop offset="1" stop-color="${c.c}"/>
    </linearGradient>
    <linearGradient id="${id}l" gradientUnits="userSpaceOnUse" x1="600" y1="450" x2="985" y2="110">
      <stop offset="0" stop-color="${c.leafA}"/><stop offset="1" stop-color="${c.leafB}"/>
    </linearGradient>`;
}
// size: 'small' → по-плътната форма (16–48 px); иначе основната.
function markBody(id, size = 'main') {
  const small = size === 'small';
  return `
    <path d="${small ? M.bodySmall : M.body}" fill="url(#${id}s)"/>
    <path d="${small ? M.leafSmall : M.leaf}" fill="url(#${id}l)"/>`;
}
/** Знакът, вписан в правоъгълник (запазва пропорциите, центриран). */
function placeMark(id, box, size = 'main') {
  const k = Math.min(box.w / MB.w, box.h / MB.h);
  const tx = box.x + (box.w - MB.w * k) / 2 - MB.x * k, ty = box.y + (box.h - MB.h * k) / 2 - MB.y * k;
  return `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(5)})">${markBody(id, size)}</g>`;
}

const GL = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand/nutriin-wordmark-glyphs.json'), 'utf8'));
// Надписът в единиците на шрифта: базова линия y=0, горе до точката на „i“ / „t“ (≈ −740).
const W_TOP = -745, W_BOTTOM = 14;
const W_WIDTH = GL.nutri.width + GL.in.width;
function wordmark({ scale, x0, baseline, dark }) {
  const ink = dark ? BRAND.inkDark : BRAND.ink, green = dark ? BRAND.greenDark : BRAND.green;
  return `<g transform="translate(${x0},${baseline}) scale(${scale})"><path d="${GL.nutri.d}" fill="${ink}"/>` +
    `<g transform="translate(${GL.nutri.width},0)"><path d="${GL.in.d}" fill="${green}"/></g></g>`;
}

const svg = (vb, defs, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${extra}><defs>${defs}</defs>${body}</svg>\n`;
const vbMark = `${MB.x} ${MB.y} ${MB.w} ${MB.h}`;

// 1) Само знакът (светла и тъмна тема; за иконите — оптичният размер „mid“ в тъмната палитра).
const files = {};
const put = (rel, s) => { files[rel] = s; out(rel, s); };
put('brand/nutriin-mark.svg', svg(vbMark, markDefs('m'), markBody('m'), LABEL));
put('brand/nutriin-mark-dark.svg', svg(vbMark, markDefs('d', 'dark'), markBody('d'), LABEL));
put('brand/nutriin-mark-icon.svg', svg(vbMark, markDefs('n', 'dark'), markBody('n'), LABEL));
put('brand/nutriin-mark-big.svg', svg(vbMark, markDefs('t', 'dark'), markBody('t'), LABEL));

// 2) Пълно лого: знакът над надписа.
function fullLogo(dark) {
  const wmW = 1100, scale = wmW / W_WIDTH, x0 = 50, baseline = 1060 + -W_TOP * scale;
  const markBox = { x: 50 + (wmW - 760) / 2, y: 0, w: 760, h: 836 };
  const H = Math.ceil(baseline + W_BOTTOM * scale + 10);
  return svg(`0 0 1200 ${H}`, markDefs('f', dark ? 'dark' : 'light'), placeMark('f', markBox) + wordmark({ scale, x0, baseline, dark }), LABEL);
}
put('brand/nutriin-logo.svg', fullLogo(false));
put('brand/nutriin-logo-dark.svg', fullLogo(true));

// 3) Хоризонтално: знак + надпис на един ред (горни ленти, имейли).
const H_H = 1000;                                  // височина на реда
const H_SCALE = (H_H * 0.62) / (-W_TOP);           // надписът ≈ 62% от височината на знака
const H_GAP = 120, H_MARKW = MB.w * (H_H / MB.h);
export const HORIZONTAL_RATIO = (H_MARKW + H_GAP + W_WIDTH * H_SCALE + 10) / H_H;
function horizontal(dark) {
  const W = Math.ceil(H_MARKW + H_GAP + W_WIDTH * H_SCALE + 10);
  const baseline = H_H * 0.5 + (-W_TOP * H_SCALE) * 0.5 - 10;
  return svg(`0 0 ${W} ${H_H}`, markDefs('h', dark ? 'dark' : 'light'),
    placeMark('h', { x: 0, y: 0, w: H_MARKW, h: H_H }, 'small') + wordmark({ scale: H_SCALE, x0: H_MARKW + H_GAP, baseline, dark }), LABEL);
}
put('brand/nutriin-horizontal.svg', horizontal(false));
put('brand/nutriin-horizontal-dark.svg', horizontal(true));

// 3б) Само надписът.
function wordOnly(dark) {
  const pad = 20, h = -W_TOP + W_BOTTOM;
  return svg(`0 0 ${Math.ceil(W_WIDTH + 2 * pad)} ${h + 2 * pad}`, '', wordmark({ scale: 1, x0: pad, baseline: -W_TOP + pad, dark }), LABEL);
}
export const WORDMARK_RATIO = (W_WIDTH + 40) / (-W_TOP + W_BOTTOM + 40);
put('brand/nutriin-wordmark.svg', wordOnly(false));
put('brand/nutriin-wordmark-dark.svg', wordOnly(true));

// 4) Иконата на приложението: знакът върху дълбокия фон със светлина отзад (като фона на приложението).
function appIcon({ maskable = false, pad: padIn, square = false } = {}) {
  const S = 1024, pad = padIn != null ? padIn : (maskable ? 0.25 : 0.17); // maskable: безопасната зона е 80%
  const inner = S * (1 - 2 * pad), k = inner / Math.max(MB.w, MB.h);
  const tx = (S - MB.w * k) / 2 - MB.x * k, ty = (S - MB.h * k) / 2 - MB.y * k;
  const r = (maskable || square) ? 0 : 224;
  const defs = markDefs('i', 'dark') + `
    <radialGradient id="iA" cx=".28" cy=".2" r=".7"><stop offset="0" stop-color="#0A8C96" stop-opacity=".62"/><stop offset="1" stop-color="#0A8C96" stop-opacity="0"/></radialGradient>
    <radialGradient id="iB" cx=".85" cy=".88" r=".6"><stop offset="0" stop-color="#0E9F5B" stop-opacity=".42"/><stop offset="1" stop-color="#0E9F5B" stop-opacity="0"/></radialGradient>
    <linearGradient id="iHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  const body = `<rect width="${S}" height="${S}" rx="${r}" fill="${BRAND.night}"/>
    <rect width="${S}" height="${S}" rx="${r}" fill="url(#iA)"/><rect width="${S}" height="${S}" rx="${r}" fill="url(#iB)"/>
    <rect width="${S}" height="${S}" rx="${r}" fill="url(#iHi)"/>
    <g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(5)})">${markBody('i')}</g>`;
  return svg(`0 0 ${S} ${S}`, defs, body);
}
// Знакът с прозрачност (PWA икони, фавикон); фавиконът сменя палитрата по темата на системата.
function alphaIcon(fill, size = 'main', { adaptive = false } = {}) {
  const S = 1024, k = (S * fill) / Math.max(MB.w, MB.h);
  const tx = (S - MB.w * k) / 2 - MB.x * k, ty = (S - MB.h * k) / 2 - MB.y * k;
  const g = (id) => `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(5)})">${markBody(id, size)}</g>`;
  if (!adaptive) return svg(`0 0 ${S} ${S}`, markDefs('a'), g('a'), LABEL);
  return svg(`0 0 ${S} ${S}`, markDefs('a') + markDefs('b', 'dark') +
    `<style>.dk{display:none}@media (prefers-color-scheme: dark){.lt{display:none}.dk{display:inline}}</style>`,
    `<g class="lt">${g('a')}</g><g class="dk">${g('b')}</g>`, LABEL);
}
const pwaIcon = alphaIcon(0.8);
put('icon-512x512.svg', pwaIcon);
put('icon-192x192.svg', pwaIcon);
put('brand/nutriin-icon.svg', appIcon());               // плътна — App Store / Play графики
put('brand/nutriin-icon-maskable.svg', appIcon({ maskable: true }));
put('brand/nutriin-icon-ios.svg', appIcon({ pad: 0.15, square: true })); // iPhone: плътен квадрат, iOS сам заобля
put('favicon.svg', alphaIcon(0.96, 'small', { adaptive: true }));

// Старите имена → копия на новите (изпратени писма, стари версии на приложението, модули в други репа).
const LEGACY = {
  'brand/eatologix-mark.svg': 'brand/nutriin-mark.svg', 'brand/eatologix-mark-icon.svg': 'brand/nutriin-mark-icon.svg',
  'brand/eatologix-mark-tech.svg': 'brand/nutriin-mark-big.svg', 'brand/eatologix-logo.svg': 'brand/nutriin-logo.svg',
  'brand/eatologix-logo-dark.svg': 'brand/nutriin-logo-dark.svg', 'brand/eatologix-horizontal.svg': 'brand/nutriin-horizontal.svg',
  'brand/eatologix-horizontal-dark.svg': 'brand/nutriin-horizontal-dark.svg', 'brand/eatologix-wordmark.svg': 'brand/nutriin-wordmark.svg',
  'brand/eatologix-wordmark-dark.svg': 'brand/nutriin-wordmark-dark.svg', 'brand/eatologix-icon.svg': 'brand/nutriin-icon.svg',
  'brand/eatologix-icon-maskable.svg': 'brand/nutriin-icon-maskable.svg', 'brand/eatologix-icon-ios.svg': 'brand/nutriin-icon-ios.svg'
};
for (const [oldRel, newRel] of Object.entries(LEGACY)) out(oldRel, files[newRel]);

if (process.argv.includes('--png')) {
  const { chromium } = (await import('node:module')).createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shotSvg = async (svgText, w, h, dest, bg = 'transparent') => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;background:${bg}"><img style="display:block;width:${w}px;height:${h}px" src="data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}"></body></html>`);
    await page.locator('img').screenshot({ path: path.join(ROOT, dest), omitBackground: bg === 'transparent' });
  };
  const shot = (srcRel, size, dest, bg) => shotSvg(fs.readFileSync(path.join(ROOT, srcRel), 'utf8'), size, size, dest, bg);
  // Фавиконът в PNG — светлата палитра (PNG не следва темата; тъмният тюркоаз се вижда и на тъмно).
  const favPng = alphaIcon(0.96, 'small');
  for (const [dest, size] of [['icon-192x192.png', 192], ['icon-192.png', 192], ['icon-512x512.png', 512], ['icon-512.png', 512]]) {
    await shot('icon-512x512.svg', size, dest);
  }
  await shot('brand/nutriin-icon-ios.svg', 180, 'brand/apple-touch-icon.png');
  await shot('brand/nutriin-icon-ios.svg', 512, 'brand/icon-launcher-512.png');  // Android, старата (не адаптивна) икона
  await shot('brand/nutriin-icon.svg', 512, 'brand/icon-solid-512.png');
  for (const size of [32, 48, 192]) await shotSvg(favPng, size, size, `brand/favicon-${size}.png`);
  await shot('brand/nutriin-icon-maskable.svg', 512, 'brand/icon-maskable-512.png');
  await shot('brand/nutriin-icon-maskable.svg', 192, 'brand/icon-maskable-192.png');
  await shotSvg(favPng, 64, 64, 'favicon-64.png');
  await shotSvg(favPng, 16, 16, 'brand/favicon-16.png');
  {
    const imgs = [['brand/favicon-16.png', 16], ['brand/favicon-32.png', 32], ['brand/favicon-48.png', 48], ['favicon-64.png', 64]]
      .map(([f, z]) => ({ z, data: fs.readFileSync(path.join(ROOT, f)) }));
    const head = Buffer.alloc(6 + 16 * imgs.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
    let off = head.length;
    imgs.forEach((im, i) => { const o = 6 + 16 * i; head[o] = im.z; head[o + 1] = im.z; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
      head.writeUInt32LE(im.data.length, o + 8); head.writeUInt32LE(off, o + 12); off += im.data.length; });
    fs.writeFileSync(path.join(ROOT, 'favicon.ico'), Buffer.concat([head, ...imgs.map((im) => im.data)]));
  }
  // Android: знакът без фон — предният слой на адаптивната икона, сплаш екранът.
  await shot('brand/nutriin-mark-icon.svg', 512, 'brand/mark-512.png');
  await shot('brand/nutriin-mark-big.svg', 512, 'brand/splash-512.png');
  // Имейлите (пощенските програми не показват SVG): хоризонталното лого, 2× за 240 px ширина.
  {
    const h = fs.readFileSync(path.join(ROOT, 'brand/nutriin-horizontal.svg'), 'utf8');
    const W = 480, Hh = Math.round(480 / HORIZONTAL_RATIO);
    await shotSvg(h, W, Hh, 'brand/nutriin-email-logo.png');
    fs.copyFileSync(path.join(ROOT, 'brand/nutriin-email-logo.png'), path.join(ROOT, 'brand/eatologix-email-logo.png'));
  }
  // Картинка за споделяне (1200×630): пълното лого върху светлия фон със светлина.
  const logo = fs.readFileSync(path.join(ROOT, 'brand/nutriin-logo.svg'), 'utf8');
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<html><body style="margin:0;width:1200px;height:630px;display:flex;align-items:center;justify-content:center;background:radial-gradient(60% 70% at 18% 12%,rgba(111,216,210,.55),transparent 70%),radial-gradient(50% 60% at 92% 80%,rgba(147,230,182,.45),transparent 70%),#EEF4F2"><img style="height:500px" src="data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}"></body></html>`);
  await page.screenshot({ path: path.join(ROOT, 'brand/og-image.png') });
  await browser.close();
}
console.log(`brand: ok (хоризонтално ${HORIZONTAL_RATIO.toFixed(3)}:1, надпис ${WORDMARK_RATIO.toFixed(3)}:1)`);
