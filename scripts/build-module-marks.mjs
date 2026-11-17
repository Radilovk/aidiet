#!/usr/bin/env node
/**
 * Знаците на модулите — IrisMap (око) и EmoEat (личице: тъжно | усмихнато).
 * Езикът е на Eatologix: дясната половина е плътна (резултатът), лявата се разпада на
 * тирета, които изтъняват към най-лявата точка (данните / тъгата, която си отива).
 *
 *   node scripts/build-module-marks.mjs          → SVG-тата
 *   node scripts/build-module-marks.mjs --png    → + PNG (favicon, иконки, споделяне; нужен е Playwright)
 *
 * EmoEat → brand/emoeat-*  (тук). IrisMap → brand/irismap-* (тук, за картата в Eatologix)
 * и, ако до това репо има ../airis1.0, → ../airis1.0/public/brand/ (mark.svg, favicon.svg, иконите).
 * Два оптични размера: big (лендинги, приложение) и small (favicon, 16–48 px — по-дебело, по-малко тирета).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AIRIS = path.resolve(ROOT, '../airis1.0/public/brand');
const f = (v) => v.toFixed(1);

// ── геометрия ───────────────────────────────────────────────────────────
function resample(P) {
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = cum[cum.length - 1];
  const at = (s) => { s = Math.max(0, Math.min(L, s)); let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t]; };
  return { L, at };
}
const line = (A, s0, s1, n = 40) => 'M' + [...Array(n + 1)].map((_, i) => { const p = A.at(s0 + (s1 - s0) * i / n); return f(p[0]) + ',' + f(p[1]); }).join(' L');
const solid = (pts, w) => `<path d="M${pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' L')}" stroke-width="${f(w)}"/>`;
const arc = (cx, cy, rx, ry, a0, a1, n = 160) => [...Array(n + 1)].map((_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });

/** Отворен път от една „става“ до друга: от двата края изтъняващ плътен участък, после тирета към средата. */
function dashed(pts, w, o = {}) {
  const { taper = 0.2, wT = 0.8, wEnd = 0.4, gap = 0.7, l0 = 1.7, l1 = 0.8 } = o;
  const A = resample(pts), half = A.L / 2, tp = taper * half;
  const W = (d) => d < tp ? w * (1 - (1 - wT) * d / tp) : w * (wT - (wT - wEnd) * Math.min(1, (d - tp) / (half - tp)));
  const out = [];
  for (const dir of [1, -1]) {
    const S = (d) => dir > 0 ? d : A.L - d;
    for (let i = 0; i < 14; i++) { const d0 = tp * i / 14, d1 = tp * (i + 1) / 14; out.push(`<path d="${line(A, Math.min(S(d0), S(d1)), Math.max(S(d0), S(d1)), 3)}" stroke-width="${f(W((d0 + d1) / 2))}"/>`); }
    const from = tp + W(tp) / 2, to = half, G = gap * w;
    let best = null;
    for (let k = 2; k <= 10; k++) {
      const bl = [...Array(k)].map((_, i) => l0 + (l1 - l0) * i / (k - 1));
      const sc = ((to - from) - (k + 0.5) * G) / (w * bl.reduce((m, v) => m + v, 0));
      if (sc > 0 && (!best || Math.abs(Math.log(sc)) < Math.abs(Math.log(best.sc)))) best = { sc, bl };
    }
    let d = from;
    for (const v of best.bl) {
      d += G; const len = v * best.sc * w, sw = W(d + len / 2), a = d + sw / 2, b = d + len - sw / 2;
      if (b > a) out.push(`<path d="${line(A, Math.min(S(a), S(b)), Math.max(S(a), S(b)), 12)}" stroke-width="${f(sw)}"/>`);
      else { const p = A.at(S(d + len / 2)); out.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(sw / 2)}" stroke="none"/>`); }
      d += len;
    }
  }
  return out.join('');
}

const GRAD = {
  iris: [[0, '#00D6EA'], [0.38, '#03E2D0'], [0.72, '#10CC50'], [1, '#A0F500']],
  emo: [[0, '#7C3AED'], [0.45, '#A855F7'], [0.8, '#D946EF'], [1, '#F472B6']],
};
const svg = (body, grad, label, vb = '0 0 1000 1000') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${label}"><defs><linearGradient id="g" x1="80" y1="0" x2="920" y2="0" gradientUnits="userSpaceOnUse">${grad.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient></defs><g fill="none" stroke="url(#g)" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;

const SMALL = { taper: 0.24, wT: 0.92, wEnd: 0.72, gap: 1.05, l0: 3.4, l1: 2.6 };

/** IrisMap — око: горният и долният клепач (лявата половина в тирета), ирис и зеница. */
function irisMark(size = 'big') {
  const c = 500, h = 300, sm = size === 'small', lw = sm ? 84 : 64;
  const lid = (up) => [...Array(201)].map((_, i) => { const x = 90 + 820 * i / 200, t = (x - 500) / 410; return [x, c + (up ? -1 : 1) * h * (1 - t * t) * 0.95]; });
  const top = lid(true), bot = lid(false);
  const right = [...top.slice(100), ...bot.slice(100).reverse()];
  const left = [...top.slice(0, 101).reverse(), ...bot.slice(1, 101)];
  return svg(solid(right, lw) + dashed(left, lw, sm ? SMALL : { l0: 1.9, l1: 0.9 }) +
    `<circle cx="${c}" cy="${c}" r="${sm ? 182 : 190}" stroke-width="${sm ? 78 : 58}"/><circle cx="${c}" cy="${c}" r="${sm ? 86 : 78}" fill="url(#g)" stroke="none"/>`, GRAD.iris, 'IrisMap');
}

/**
 * EmoEat — личице, разделено отвесно: отляво тъжно (вежда, око, половин тъжна уста),
 * отдясно усмихнато (усмихнато око, половин усмивка). Всяка половина на устата е половина
 * от естествена уста (дъга от кръг); в средата краищата се разминават и не докосват линията.
 */
function emoMark(size = 'big') {
  const c = 500, r = 360, sm = size === 'small', w = sm ? 86 : 70;
  const g = 34, mw = 200, my = 640, R = 230, k = Math.sqrt(R * R - mw * mw), mwid = sm ? 60 : 46;
  const mouth = (x0, x1, sign) => [...Array(41)].map((_, i) => { const x = x0 + (x1 - x0) * i / 40; return [c + x, my + sign * (Math.sqrt(R * R - x * x) - (R + k) / 2)]; });
  const ey = 420, ex = 150;
  let b = solid(arc(c, c, r, r, -Math.PI / 2, Math.PI / 2), w) + dashed(arc(c, c, r, r, Math.PI / 2, 1.5 * Math.PI), w, sm ? SMALL : { l0: 1.8, l1: 0.9 });
  b += `<path d="M500,${c - r + 64} L500,${c + r - 64}" stroke-width="${sm ? 34 : 24}"/>`;
  b += solid(mouth(g, mw, +1), mwid) + solid(mouth(-mw, -g, -1), mwid);
  b += `<path d="M${c + ex - 50},${ey + 16} Q${c + ex},${ey - 42} ${c + ex + 50},${ey + 16}" stroke-width="${sm ? 52 : 40}"/>`;   // усмихнато око
  b += `<path d="M${c - ex - 56},${ey - 34} L${c - ex + 40},${ey - 6}" stroke-width="${sm ? 46 : 36}"/>`;                         // тъжна вежда
  b += `<circle cx="${c - ex - 6}" cy="${ey + 46}" r="${sm ? 48 : 38}" fill="url(#g)" stroke="none"/>`;                           // тъжно око
  return svg(b, GRAD.emo, 'EmoEat');
}

/** Иконка на приложение: знакът върху тъмния фон на Eatologix (iPhone — плътен квадрат; maskable — в безопасната зона). */
function appIcon(mark, { pad = 0.17, rounded = true } = {}) {
  const inner = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const s = 1024, m = s * pad, z = s - 2 * m;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}"><defs><radialGradient id="bg" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#0A2E33"/><stop offset=".6" stop-color="#04181C"/><stop offset="1" stop-color="#020C0E"/></radialGradient></defs>` +
    `<rect width="${s}" height="${s}" ${rounded ? 'rx="224"' : ''} fill="url(#bg)"/><svg x="${m}" y="${m}" width="${z}" height="${z}" viewBox="0 0 1000 1000">${inner}</svg></svg>`;
}

const out = (file, s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, s); };
const B = (n) => path.join(ROOT, 'brand', n);
const marks = {
  emoeat: { big: emoMark('big'), small: emoMark('small') },
  irismap: { big: irisMark('big'), small: irisMark('small') },
};
for (const [n, m] of Object.entries(marks)) {
  out(B(`${n}-mark.svg`), m.big);
  out(B(`${n}-favicon.svg`), m.small);
  out(B(`${n}-icon-ios.svg`), appIcon(m.big, { pad: 0.16, rounded: false }));
  out(B(`${n}-icon-maskable.svg`), appIcon(m.big, { pad: 0.24, rounded: false }));
}
const hasAiris = fs.existsSync(path.dirname(AIRIS));
if (hasAiris) {
  out(path.join(AIRIS, 'mark.svg'), marks.irismap.big);
  out(path.join(AIRIS, 'favicon.svg'), marks.irismap.small);
}
console.log('SVG: brand/emoeat-*, brand/irismap-*' + (hasAiris ? ' + ../airis1.0/public/brand/' : ''));

if (process.argv.includes('--png')) {
  const { chromium } = (await import('node:module')).createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = async (src, size, dest, bg = 'transparent') => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:${bg}"><img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}"></body></html>`);
    await page.locator('img').screenshot({ path: dest, omitBackground: bg === 'transparent' });
  };
  // Картинка за споделяне 1200×630: знакът и името на светъл фон.
  const og = async (mark, word, tag, dest) => {
    await page.setViewportSize({ width: 1200, height: 630 });
    await page.setContent(`<html><body style="margin:0;width:1200px;height:630px;display:flex;align-items:center;justify-content:center;gap:56px;background:radial-gradient(120% 90% at 30% 20%,#FFFFFF,#ECF8F5 60%,#E2F3EF);font-family:Montserrat,Inter,system-ui,sans-serif">
      <img style="width:300px;height:300px" src="data:image/svg+xml;base64,${Buffer.from(mark).toString('base64')}">
      <div><div style="font-size:96px;font-weight:700;letter-spacing:.01em;color:#0E1B1B">${word}</div><div style="margin-top:14px;font-size:34px;color:#4A5E63;font-family:Inter,system-ui,sans-serif">${tag}</div></div></body></html>`);
    await page.screenshot({ path: dest });
  };
  for (const [n, m] of Object.entries(marks)) {
    for (const z of [16, 32, 48, 192]) await shot(m.small, z, B(`${n}-favicon-${z}.png`));
    await shot(m.big, 512, B(`${n}-mark-512.png`));
    await shot(appIcon(m.big, { pad: 0.16, rounded: false }), 180, B(`${n}-apple-touch-icon.png`));
    await shot(appIcon(m.big, { pad: 0.24, rounded: false }), 512, B(`${n}-icon-maskable-512.png`));
  }
  await og(marks.emoeat.big, 'Emo<span style="background:linear-gradient(120deg,#9B5CF6,#E879F9);-webkit-background-clip:text;color:transparent">Eat</span>', 'Кога храната поема чувствата', B('emoeat-og.png'));
  await og(marks.irismap.big, '<span style="color:#034E5C">IRIS</span><span style="color:#08B5B9">M</span><span style="color:#06C3AA">A</span><span style="color:#07CF61">P</span>', 'Личен протокол по двата ириса', B('irismap-og.png'));
  if (hasAiris) {
    for (const [src, dest] of [['irismap-favicon-32.png', 'favicon-32.png'], ['irismap-apple-touch-icon.png', 'apple-touch-icon.png'], ['irismap-og.png', 'og-image.png'], ['irismap-icon-maskable-512.png', 'icon-maskable-512.png']]) {
      fs.copyFileSync(B(src), path.join(AIRIS, dest));
    }
    await shot(marks.irismap.big, 192, path.join(AIRIS, 'icon-192.png'));
    await shot(marks.irismap.big, 512, path.join(AIRIS, 'icon-512.png'));
  }
  await browser.close();
  console.log('PNG: готово');
}
