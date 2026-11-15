/**
 * EATOLOGIX — знакът „с тирета“ (за големите размери: пълното лого, сплаш).
 *
 * Идеята: в средата е плътен, симетричен Х (X-ът на LOGIX — логиката), дясната половина и
 * отметката са плътни (резултатът, „Логичен избор“), а левият контур излиза от раменете на Х,
 * изтънява и се разпада на тирета, които изтъняват и се скъсяват към най-лявата точка (данните).
 * Иконите и малките размери ползват плътния знак (brand/mark-trace.json) — тиретата под ~48 px са шум.
 *
 * Геометрията е от центровата линия на трасираната примка (brand/mark-center.json,
 * scripts/trace-center.py) — в същите координати като mark-trace.json.
 */
import fs from 'node:fs';

export function techMark(centerPath, opt = {}) {
  const C = JSON.parse(fs.readFileSync(centerPath, 'utf8'));
  const P = C.pts, N = P.length, w = C.width;
  const o = { arm: 330, taper: 0.18, wT: 0.75, wEnd: 0.34, gap: 0.62, l0: 1.6, l1: 0.8, ...opt };

  const cum = [0];
  for (let i = 1; i <= N; i++) { const a = P[i - 1], b = P[i % N]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const LEN = cum[N];
  const at = (s) => {
    s = ((s % LEN) + LEN) % LEN; let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const t = (s - cum[lo]) / (cum[lo + 1] - cum[lo]); const a = P[lo], b = P[(lo + 1) % N];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const f = (v) => v.toFixed(1);
  const seg = (s0, s1) => { const pts = []; const step = LEN / N; for (let s = s0; s < s1; s += step) pts.push(at(s)); pts.push(at(s1)); return 'M' + pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' L'); };
  const nrm = (s) => { const a = at(s - 2), b = at(s + 2), l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; };
  const band = (s0, s1, wf) => {
    const L = [], R = []; const n = Math.max(2, Math.ceil((s1 - s0) / 2));
    for (let i = 0; i <= n; i++) { const s = s0 + (s1 - s0) * i / n, p = at(s), q = nrm(s), h = wf(s) / 2; L.push([p[0] + q[0] * h, p[1] + q[1] * h]); R.push([p[0] - q[0] * h, p[1] - q[1] * h]); }
    return 'M' + L.concat(R.reverse()).map((p) => f(p[0]) + ',' + f(p[1])).join(' L') + ' Z';
  };

  // Левият контур: от края на долното ляво рамо (s0) до началото на горното ляво рамо (s1).
  const s0 = o.arm, s1 = cum[N / 2] - o.arm, half = (s1 - s0) / 2;
  const taper = o.taper * half;
  const W = (d) => d < taper ? w * (1 - (1 - o.wT) * (d / taper)) : w * (o.wT - (o.wT - o.wEnd) * Math.min(1, (d - taper) / (half - taper)));

  const solid = seg(s1, s0 + LEN);           // Х + дясната половина (плътна линия, w)
  const fills = [];                           // изтъняващите плътни участъци + кръгли краища
  const dashes = [];                          // { d, sw }
  for (const dir of [1, -1]) {
    const base = dir > 0 ? s0 : s1, sAt = (d) => base + dir * d;
    const a = sAt(-6), b = sAt(taper);
    fills.push({ d: band(Math.min(a, b), Math.max(a, b), (s) => W(Math.max(0, dir * (s - base)))) });
    const pe = at(b); fills.push({ circle: [pe[0], pe[1], W(taper) / 2] });
    // k тирета с еднакви паузи; дължините намаляват към средата, мащабът се подбира да запълни точно.
    const from = taper + W(taper) / 2, to = half, G = o.gap * w;
    let best = null;
    for (let k = 2; k <= 12; k++) {
      const bl = [...Array(k)].map((_, i) => o.l0 + (o.l1 - o.l0) * i / (k - 1));
      const sc = ((to - from) - (k + 0.5) * G) / (w * bl.reduce((m, v) => m + v, 0));
      if (sc > 0 && (!best || Math.abs(Math.log(sc)) < Math.abs(Math.log(best.sc)))) best = { sc, bl };
    }
    let d = from;
    for (const v of best.bl) {
      d += G; const L2 = v * best.sc * w, sw = W(d + L2 / 2);
      const p = sAt(d + sw / 2), q = sAt(d + L2 - sw / 2);
      dashes.push({ d: seg(Math.min(p, q), Math.max(p, q) + 0.01), sw });
      d += L2;
    }
  }

  /** SVG за знака (без отметката); grad = id на градиента на примката. */
  return (grad) =>
    `<path d="${solid}" fill="none" stroke="url(#${grad})" stroke-width="${f(w)}" stroke-linecap="butt" stroke-linejoin="round"/>` +
    fills.map((x) => x.circle ? `<circle cx="${f(x.circle[0])}" cy="${f(x.circle[1])}" r="${f(x.circle[2])}" fill="url(#${grad})"/>` : `<path d="${x.d}" fill="url(#${grad})"/>`).join('') +
    dashes.map((x) => `<path d="${x.d}" fill="none" stroke="url(#${grad})" stroke-width="${f(x.sw)}" stroke-linecap="round"/>`).join('');
}
